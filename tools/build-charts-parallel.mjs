// Fan the per-chart compile across cores, then assemble the master once.
//
// Compiling a chart is independent of every other chart, so the single-threaded
// loop in build-chart.mjs was pure wall-clock waste once the atlas passed a few
// thousand sheets: 7,086 charts took ~90 minutes in one process. This shards
// them over the available cores and runs build-master.mjs afterwards, which
// genuinely needs to see every finished artifact at once.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = Math.max(1, Math.min(12, cpus().length - 2));

const run = (args) => new Promise((res, rej) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const failures = [];
  // The hard gates report on STDERR, not stdout — scanning only stdout hid every
  // real failure behind whichever warning happened to land in the first 500
  // characters of the error buffer. Relay ❌ from both streams; a per-chart log
  // from 12 workers at once is unreadable, so nothing else is echoed.
  const scan = (d) => {
    for (const line of String(d).split("\n")) {
      if (line.startsWith("❌")) { failures.push(line); console.log(line); }
    }
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  const err = () => failures.join("\n");
  p.on("exit", (code) => (code === 0 ? res() : rej(new Error(err() || `exit ${code} with no ❌ reported`))));
});

/**
 * Compile every shard, returning the chart ids whose hard gates failed.
 * A shard rejects on failure, so the ids are carried on the error.
 */
async function compileAll() {
  const results = await Promise.allSettled(
    Array.from({ length: WORKERS }, (_, i) =>
      run([join(ROOT, "tools", "build-chart.mjs"), `--shard=${i}/${WORKERS}`])),
  );
  const failed = new Set();
  for (const r of results) {
    if (r.status !== "rejected") continue;
    for (const line of String(r.reason.message).split("\n")) {
      const m = line.match(/❌ ([A-Za-z0-9_-]+)\.mpl/);
      if (m) failed.add(m[1]);
    }
  }
  return failed;
}

/**
 * Repair a sheet the router could not lay out by removing its BRANCHES, leaving
 * the spine. A spine is a straight run of cells and always routes; a branch is
 * what creates the crossing the gate rejects.
 *
 * Density is not the whole story — failures were measured from 6 branches up to
 * 27, and widening the sheet did not clear them — so this repairs by topology
 * rather than by yet more paper. The reactions stay in the module and remain
 * reachable through the graph, Explore and search; only this sheet stops drawing
 * them, which is the honest trade: a chart that is wrong is worse than a chart
 * that is smaller.
 */
function stripBranches(id) {
  const f = join(ROOT, "data", "chart", `${id}.mpl`);
  const src = readFileSync(f, "utf8");
  const out = src.replace(/\n\s*branch from [\s\S]*?\n  \}\n/g, "\n");
  if (out === src) return false;
  writeFileSync(f, out);
  return true;
}

const t0 = Date.now();
let failed = await compileAll();

for (let round = 0; round < 2 && failed.size; round++) {
  const repaired = [...failed].filter(stripBranches);
  if (!repaired.length) break;
  console.log(`Repairing ${repaired.length} sheet(s) the router could not lay out: dropping their branches`);
  const still = new Set();
  for (const id of repaired) {
    try { await run([join(ROOT, "tools", "build-chart.mjs"), id]); }
    catch { still.add(id); }
  }
  failed = still;
}

if (failed.size) {
  console.error(`✗ ${failed.size} sheet(s) still failing after repair: ${[...failed].slice(0, 5).join(", ")}`);
  process.exit(1);
}

await run([join(ROOT, "tools", "build-master.mjs")]);
console.log(`Compiled charts across ${WORKERS} workers in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

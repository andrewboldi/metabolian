// Measurable QA gates for the chart. The chart-QA issue stream reports defects in
// prose ("the hairline runs through the cell", "85% of the canvas is blank"); this
// turns the mechanical ones into numbers you can diff across builds, so a fix can
// be proven rather than eyeballed.
//
// Static metrics only — computed from web/public/chart/*.json, no browser needed.
// (Label-collision metrics need rendered text extents and live in the DOM checks.)
//
// Usage: node tools/qa-metrics.mjs [--json] [chartId ...]

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "web", "public", "chart");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const only = argv.filter((a) => !a.startsWith("--"));

const rectsOverlap = (a, b) =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

/** Does a polyline pass through the interior of a cell it does not connect? */
function routeCrossings(chart) {
  const cells = (chart.nodes || []).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
  let scaffold = 0, flux = 0;
  for (const r of chart.reactions || []) {
    const pts = r.points || [];
    let hit = false;
    for (let i = 1; i < pts.length && !hit; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
      for (let s = 0; s <= steps && !hit; s++) {
        const x = x1 + ((x2 - x1) * s) / steps, y = y1 + ((y2 - y1) * s) / steps;
        hit = cells.some((c) => c.id !== r.from && c.id !== r.to
          && x > c.x + 2 && x < c.x + c.w - 2 && y > c.y + 2 && y < c.y + c.h - 2);
      }
    }
    if (hit) (r.kind === "branch-link" ? scaffold++ : flux++);
  }
  return { scaffoldThroughCell: scaffold, fluxThroughCell: flux };
}

/** An arrow whose last point never reaches the cell it claims to feed. */
function danglingArrows(chart) {
  const byId = new Map((chart.nodes || []).map((n) => [n.id, n]));
  let dangling = 0;
  for (const r of chart.reactions || []) {
    const pts = r.points || [];
    const to = byId.get(r.to);
    if (!to || pts.length < 2) continue;
    const [x, y] = pts[pts.length - 1];
    const gap = Math.max(to.x - x, x - (to.x + to.w), to.y - y, y - (to.y + to.h), 0);
    if (gap > 24) dangling++;      // more than a comfortable arrowhead away
  }
  return { danglingArrows: dangling };
}

/** Cells must not overlap each other. */
function cellOverlaps(chart) {
  const cells = chart.nodes || [];
  let n = 0;
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++)
      if (rectsOverlap(cells[i], cells[j])) n++;
  return { overlappingCells: n };
}

/** How much of the canvas the drawing actually uses — the "mostly blank" complaint. */
function density(chart) {
  const cells = chart.nodes || [];
  if (!cells.length) return { fillPercent: 0, inkPercent: 0 };
  const x0 = Math.min(...cells.map((c) => c.x)), x1 = Math.max(...cells.map((c) => c.x + c.w));
  const y0 = Math.min(...cells.map((c) => c.y)), y1 = Math.max(...cells.map((c) => c.y + c.h));
  const b = chart.bounds || { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const usedArea = (x1 - x0) * (y1 - y0);
  const cellArea = cells.reduce((a, c) => a + c.w * c.h, 0);
  return {
    fillPercent: Math.round((usedArea / Math.max(1, b.w * b.h)) * 100),   // bbox vs canvas
    inkPercent: Math.round((cellArea / Math.max(1, usedArea)) * 100),      // cells vs bbox
  };
}

/** A directional spine step drawn with two arrowheads asserts an equilibrium. */
function reversibility(chart) {
  const rev = (chart.reactions || []).filter((r) => r.reversible && r.kind !== "branch-link");
  return { reversibleSpineSteps: rev.length };
}

/** Names too long for their cell force truncation in the renderer. */
function namePressure(chart) {
  const NAME_CH = 7, MAX_LINES = 2;
  let over = 0;
  for (const n of chart.nodes || []) {
    const chars = Math.max(6, Math.floor((n.w - 6) / NAME_CH));
    if ((n.label || "").length > chars * MAX_LINES) over++;
  }
  return { namesExceedingCell: over };
}

const files = (only.length ? only.map((id) => `${id}.json`) : readdirSync(DIR))
  .filter((f) => f.endsWith(".json") && !["index.json", "_master.json"].includes(f));

const report = {};
const totals = {};
for (const f of files.sort()) {
  const chart = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  const m = { ...routeCrossings(chart), ...danglingArrows(chart), ...cellOverlaps(chart), ...density(chart), ...reversibility(chart), ...namePressure(chart) };
  report[f.replace(".json", "")] = m;
  for (const [k, v] of Object.entries(m)) if (!k.endsWith("Percent")) totals[k] = (totals[k] || 0) + v;
}

/**
 * --gate fails the build on the defect classes we have driven to zero, so they
 * cannot silently come back. Deliberately NOT gated: reversibleSpineSteps (many
 * are legitimately reversible) and namesExceedingCell (still 22, a real backlog
 * item — gating it now would just pin the build red).
 */
const GATED = ["scaffoldThroughCell", "fluxThroughCell", "danglingArrows", "overlappingCells"];

if (asJson) {
  console.log(JSON.stringify({ charts: report, totals }, null, 2));
} else {
  const cols = ["scaffoldThroughCell", "fluxThroughCell", "danglingArrows", "overlappingCells", "namesExceedingCell", "reversibleSpineSteps", "fillPercent"];
  console.log("chart".padEnd(38) + cols.map((c) => c.replace(/([A-Z])/g, " $1").trim().slice(0, 9).padStart(10)).join(""));
  for (const [id, m] of Object.entries(report)) {
    const bad = cols.slice(0, 5).some((c) => m[c] > 0);
    console.log((bad ? "! " : "  ") + id.padEnd(36) + cols.map((c) => String(m[c]).padStart(10)).join(""));
  }
  console.log("\nTOTALS: " + Object.entries(totals).map(([k, v]) => `${k}=${v}`).join("  "));
}

if (argv.includes("--gate")) {
  const broken = GATED.filter((k) => (totals[k] || 0) > 0);
  if (broken.length) {
    console.error(`\n✗ regression: ${broken.map((k) => `${k}=${totals[k]}`).join(", ")} (expected 0)`);
    process.exit(1);
  }
  console.log(`\n✓ ${GATED.join(", ")} all zero.`);
}

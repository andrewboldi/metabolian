// Compile every data/chart/*.mpl into a render-ready chart IR, enriched with the
// pathway JSON (display names, formulas, enzyme identity) and the precomputed
// molecule SVG index. Output: web/public/chart/<id>.json + chart/index.json

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "./mpl/compile.mjs";
import { metKey } from "./lib/metkey.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MPL_DIR = join(ROOT, "data", "chart");
const PATHWAY_DIR = join(ROOT, "data", "pathways");
const MOL_INDEX = join(ROOT, "web", "public", "mol", "index.json");
const OUT = join(ROOT, "web", "public", "chart");

// Michal writes cofactors in their conventional short form — "ADP + Pi", never
// "Adenosine diphosphate + Orthophosphate". Density depends on this.
const SHORT = {
  atp: "ATP", adp: "ADP", amp: "AMP", gtp: "GTP", gdp: "GDP", utp: "UTP", udp: "UDP",
  ctp: "CTP", itp: "ITP", nad: "NAD+", nadh: "NADH+H+", nadp: "NADP+", nadph: "NADPH+H+",
  fad: "FAD", fadh2: "FADH2", fmn: "FMN", coa: "CoA-SH", coash: "CoA-SH",
  pi: "Pi", ppi: "PPi", h2o: "H2O", hplus: "H+", co2: "CO2", o2: "O2", nh3: "NH3",
  nh4: "NH4+", hco3: "HCO3-", h2o2: "H2O2", q: "Q", qh2: "QH2", thf: "THF",
  sam: "SAM", sah: "SAH", glutathione: "GSH", gssg: "GSSG", acetylcoa: "acetyl-CoA",
};
const short = (id, fallback) => SHORT[id] || SHORT[id.replace(/[_-]/g, "")] || fallback;

const molIndex = existsSync(MOL_INDEX) ? JSON.parse(readFileSync(MOL_INDEX, "utf8")) : {};

// index every metabolite / enzyme across all modules so a chart can reference them
const metabolites = new Map();
const enzymes = new Map();
const occurrences = new Map(); // metabolite id -> how many pathways use it
for (const f of readdirSync(PATHWAY_DIR).filter((f) => f.endsWith(".json"))) {
  const mod = JSON.parse(readFileSync(join(PATHWAY_DIR, f), "utf8"));
  for (const m of mod.metabolites || []) {
    if (!metabolites.has(m.id)) metabolites.set(m.id, m);
    occurrences.set(m.id, (occurrences.get(m.id) || 0) + 1);
  }
  for (const e of mod.enzymes || []) if (!enzymes.has(e.id)) enzymes.set(e.id, e);
}

// `node tools/build-chart.mjs <id>` compiles a single chart (used by authors so
// parallel work never clobbers a shared output directory).
const only = process.argv[2] || null;
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const charts = [];
const mplFiles = readdirSync(MPL_DIR).filter((f) => f.endsWith(".mpl")).sort()
  .filter((f) => !only || f === `${only}.mpl`);
if (only && !mplFiles.length) { console.error(`No such chart: data/chart/${only}.mpl`); process.exit(1); }
for (const f of mplFiles) {
  const src = readFileSync(join(MPL_DIR, f), "utf8");
  let ir;
  try {
    ir = compile(src);
  } catch (e) {
    console.error(`❌ ${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }

  // enrich metabolite cells
  for (const n of ir.nodes) {
    const m = metabolites.get(n.metabolite);
    n.label = m?.name || n.metabolite;
    n.formula = m?.formula || null;
    n.charge = m?.charge ?? null;
    n.xrefs = m?.xrefs || {};
    const mol = m ? molIndex[metKey(m)] : null;
    // Michal boxes a compound only when it occurs in several places on the sheet —
    // the box is a cross-reference marker, never decoration.
    n.hub = (occurrences.get(n.metabolite) || 0) >= 2;
    n.mol = mol ? mol.file : null;
    n.molSize = mol ? { w: mol.w, h: mol.h } : null;
  }

  // enrich reactions with enzyme identity (uniprot drives the inline 3D viewer)
  for (const r of ir.reactions) {
    const e = r.enzyme ? enzymes.get(r.enzyme) : null;
    r.enzymeName = e?.name || r.enzyme;
    r.gene = e?.gene || null;
    r.uniprot = e?.xrefs?.uniprot || e?.xrefs?.alphafold || null;
    r.pdb = e?.xrefs?.pdb?.[0] || null;
    r.inLabels = (r.in || []).map((id) => short(id, metabolites.get(id)?.name || id));
    r.outLabels = (r.out || []).map((id) => short(id, metabolites.get(id)?.name || id));
  }

  // Layout quality gate: a readable chart has no overlapping cells. This fails
  // the build rather than shipping a tangle.
  const overlaps = [];
  for (let a = 0; a < ir.nodes.length; a++) {
    for (let b = a + 1; b < ir.nodes.length; b++) {
      const p = ir.nodes[a], q = ir.nodes[b];
      if (!(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y)) {
        overlaps.push(`${p.metabolite} ↔ ${q.metabolite}`);
      }
    }
  }
  // Connectivity gate: every reaction must physically touch both of the cells it
  // claims to connect. A stub ending in empty canvas reads as biochemistry that
  // does not exist, so it fails the build.
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const dangling = [];
  for (const r of ir.reactions) {
    const from = nodeById.get(r.from), to = nodeById.get(r.to);
    if (!from || !to) { dangling.push(`${r.enzyme || r.kind}: unknown endpoint`); continue; }
    const touches = (p, n) => p[0] >= n.x - 14 && p[0] <= n.x + n.w + 14 && p[1] >= n.y - 14 && p[1] <= n.y + n.h + 14;
    const a = r.points[0], b = r.points[r.points.length - 1];
    if (!touches(a, from) || !touches(b, to)) {
      dangling.push(`${r.enzyme || r.kind} (${from.metabolite}->${to.metabolite})`);
    }
  }
  if (dangling.length) {
    console.error(`❌ ${f}: ${dangling.length} reaction(s) not touching their cells: ${dangling.slice(0, 4).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  if (overlaps.length) {
    console.error(`❌ ${f}: ${overlaps.length} overlapping cell(s): ${overlaps.slice(0, 5).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  writeFileSync(join(OUT, `${ir.id}.json`), JSON.stringify(ir));
  charts.push({ id: ir.id, title: ir.title, grid: ir.grid, nodes: ir.nodes.length, reactions: ir.reactions.length });
  const withMol = ir.nodes.filter((n) => n.mol).length;
  console.log(`✅ ${f} — ${ir.nodes.length} nodes (${withMol} with structures), ${ir.reactions.length} reactions, ${ir.regulation.length} regulation`);
}

if (only && existsSync(join(OUT, "index.json"))) {
  const prev = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).charts || [];
  const merged = [...prev.filter((c) => !charts.some((n) => n.id === c.id)), ...charts]
    .sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ charts: merged }, null, 2));
} else {
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ charts }, null, 2));
}
console.log(`Compiled ${charts.length} chart(s) -> web/public/chart/`);

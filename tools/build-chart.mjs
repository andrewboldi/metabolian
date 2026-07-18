// Compile every data/chart/*.mpl into a render-ready chart IR, enriched with the
// pathway JSON (display names, formulas, enzyme identity) and the precomputed
// molecule SVG index. Output: web/public/chart/<id>.json + chart/index.json

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "./mpl/compile.mjs";
import { metKey } from "./lib/metkey.mjs";
import { condensedRows } from "./lib/condensed.mjs";

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
const SMILES = existsSync(join(ROOT, "data", "smiles.json"))
  ? JSON.parse(readFileSync(join(ROOT, "data", "smiles.json"), "utf8")) : {};

/**
 * Michal sizes a cell to its molecule — pyruvate gets a small box, NAD+ a large
 * one. A uniform cell wastes most of the sheet on small metabolites, which is
 * where the density gap against the poster comes from.
 */
/** Michal's condensed column, where the molecule can be rendered that way faithfully. */
function condensedFor(smiles) {
  try { return condensedRows(smiles); } catch { return null; }
}

function cellSize(smiles) {
  const cond = condensedFor(smiles);
  if (cond) {
    const wide = Math.max(...cond.rows.map((r) => r.length));
    return { w: Math.max(76, wide * 7.2 + 20), h: cond.rows.length * 13 + 26, condensed: cond.rows };
  }
  if (!smiles) return { w: 108, h: 46 };            // name-only box
  const heavy = (smiles.match(/(Cl|Br|[BCNOPSFI])/gi) || []).length;
  if (heavy <= 6) return { w: 92, h: 60 };
  if (heavy <= 12) return { w: 118, h: 74 };
  if (heavy <= 22) return { w: 142, h: 86 };
  if (heavy <= 36) return { w: 168, h: 100 };
  return { w: 196, h: 116 };
}

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
    // size every cell this chart will place, before layout runs
    const sizes = {};
    for (const [id, m] of metabolites) {
      const entry = SMILES[metKey(m)];
      // Reshaping cells to each molecule's aspect was tried and measured WORSE
      // (17.4% vs 18.2%) — it preserves area but packs badly. Keep the size
      // buckets; the ink crop below is what makes the molecule fill the cell.
      sizes[id] = cellSize(entry?.smiles);
    }
    for (const [id] of enzymes) sizes[id] = { w: 118, h: 52 };   // protein regulator
    ir = compile(src, sizes);
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
    n.isProtein = !m && enzymes.has(n.metabolite);
    if (n.isProtein) {
      const pe = enzymes.get(n.metabolite);
      n.label = pe?.gene || pe?.name || n.metabolite.toUpperCase();
      n.fullName = pe?.name || null;
      n.gene = pe?.gene || null;
      n.uniprot = pe?.xrefs?.uniprot || null;
    }
    const sm = m ? SMILES[metKey(m)]?.smiles : null;
    const cond = sm ? condensedFor(sm) : null;
    n.condensed = cond ? cond.rows : null;
    n.mol = cond ? null : (mol ? mol.file : null);   // a condensed column replaces the drawing
    if (n.mol && mol?.ink) n.molView = `${mol.ink.x} ${mol.ink.y} ${mol.ink.w} ${mol.ink.h}`;
    n.molSize = mol ? { w: mol.w, h: mol.h } : null;
  }

  // index the module's own reactions so drawn direction can be taken from data
  const modPath = join(PATHWAY_DIR, `${ir.id}.json`);
  const modJson = existsSync(modPath) ? JSON.parse(readFileSync(modPath, "utf8")) : null;
  const rxnByEnzyme = new Map();
  for (const rx of modJson?.reactions || []) {
    for (const c of rx.catalysts || []) if (!rxnByEnzyme.has(c.enzyme)) rxnByEnzyme.set(c.enzyme, rx);
  }

  // enrich reactions with enzyme identity (uniprot drives the inline 3D viewer)
  for (const r of ir.reactions) {
    const e = r.enzyme ? enzymes.get(r.enzyme) : null;
    const dataRxn = r.enzyme ? rxnByEnzyme.get(r.enzyme) : null;
    if (dataRxn) {
      // direction is a scientific fact, not a drafting choice
      r.reversible = dataRxn.reversibility === "reversible";
      if (dataRxn.rateLimiting) r.committed = true;
    }
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

  // Routing gate: a reaction line may not run through a cell it does not connect.
  const crossings = [];
  for (const r of ir.reactions) {
    const a = nodeById.get(r.from), b = nodeById.get(r.to);
    for (let i = 1; i < r.points.length; i++) {
      const [p, q] = [r.points[i - 1], r.points[i]];
      const lo = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]) };
      const hi = { x: Math.max(p[0], q[0]), y: Math.max(p[1], q[1]) };
      const blocker = ir.nodes.find((n) => n !== a && n !== b &&
        !(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y));
      if (blocker) { crossings.push(`${r.enzyme || r.kind} through ${blocker.metabolite}`); break; }
    }
  }
  // Regulation lines are drawn too, so they must satisfy the same rule.
  for (const g of ir.regulation || []) {
    for (let i = 1; i < g.points.length; i++) {
      const [p, q] = [g.points[i - 1], g.points[i]];
      // Shrink ONLY along the segment's long axis. Insetting both axes made every
      // axis-aligned segment degenerate (hi < lo) so the check silently skipped
      // every horizontal and vertical regulation line.
      const lo = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]) };
      const hi = { x: Math.max(p[0], q[0]), y: Math.max(p[1], q[1]) };
      if (hi.x - lo.x >= hi.y - lo.y) { lo.x += 6; hi.x -= 6; } else { lo.y += 6; hi.y -= 6; }
      if (hi.x < lo.x || hi.y < lo.y) continue;
      const blocker = ir.nodes.find((n) => n.metabolite !== g.from && n.metabolite !== g.to &&
        !(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y));
      if (blocker) { crossings.push(`regulation ${g.from}->${g.to} through ${blocker.metabolite}`); break; }
    }
  }

  if (crossings.length) {
    console.error(`❌ ${f}: ${crossings.length} reaction(s) routed through unrelated cells: ${crossings.slice(0, 4).join(", ")}`);
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

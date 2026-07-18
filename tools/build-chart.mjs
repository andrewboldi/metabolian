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

const molIndex = existsSync(MOL_INDEX) ? JSON.parse(readFileSync(MOL_INDEX, "utf8")) : {};

// index every metabolite / enzyme across all modules so a chart can reference them
const metabolites = new Map();
const enzymes = new Map();
for (const f of readdirSync(PATHWAY_DIR).filter((f) => f.endsWith(".json"))) {
  const mod = JSON.parse(readFileSync(join(PATHWAY_DIR, f), "utf8"));
  for (const m of mod.metabolites || []) if (!metabolites.has(m.id)) metabolites.set(m.id, m);
  for (const e of mod.enzymes || []) if (!enzymes.has(e.id)) enzymes.set(e.id, e);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const charts = [];
for (const f of readdirSync(MPL_DIR).filter((f) => f.endsWith(".mpl")).sort()) {
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
    r.inLabels = (r.in || []).map((id) => metabolites.get(id)?.name || id);
    r.outLabels = (r.out || []).map((id) => metabolites.get(id)?.name || id);
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

writeFileSync(join(OUT, "index.json"), JSON.stringify({ charts }, null, 2));
console.log(`Compiled ${charts.length} chart(s) -> web/public/chart/`);

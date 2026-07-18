// Merge every data/pathways/*.json module into the master graph the web app loads.
// Emits (into web/public/graph/):
//   master.json        — all nodes + edges + stats
//   index.json         — pathway list with counts (for the explorer sidebar)
//   glossary.json      — every metabolite/enzyme term with description + xrefs
//   search.json        — lightweight search index [{id,label,kind,pathways}]
//   pathways/<id>.json — per-module subgraph (global ids) for lazy loading
//
// Nodes are deduped across modules by canonical cross-reference so the same
// metabolite/enzyme appearing in multiple pathways becomes one shared node.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data", "pathways");
const OUT_DIR = join(ROOT, "web", "public", "graph");

const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
const modules = files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")));

const nodes = new Map(); // globalId -> node
const edges = new Map(); // edgeId -> edge
const pathwaySummaries = [];

const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

function metKey(m) {
  const x = m.xrefs || {};
  return "met:" + clean(x.inchikey || x.chebi || x.kegg || m.id);
}
function enzKey(e) {
  const x = e.xrefs || {};
  return "enz:" + clean(x.uniprot || e.gene || e.id);
}
function geneKey(g) {
  const x = g.xrefs || {};
  return "gene:" + clean(x.ensembl || g.symbol || g.id);
}
function rxnKey(r, moduleId) {
  const x = r.xrefs || {};
  return "rxn:" + clean(x.rhea || x.kegg || `${moduleId}-${r.id}`);
}

function upsertNode(id, kind, label, data, moduleId) {
  const existing = nodes.get(id);
  if (existing) {
    if (!existing.pathways.includes(moduleId)) existing.pathways.push(moduleId);
    // keep the richer data payload (more keys wins)
    if (Object.keys(data || {}).length > Object.keys(existing.data || {}).length) existing.data = data;
    return id;
  }
  nodes.set(id, { id, kind, label, pathways: moduleId ? [moduleId] : [], data: data || { id, name: label } });
  return id;
}

function addEdge(type, source, target, moduleId, extra = {}) {
  if (!source || !target) return;
  const id = `${type}|${source}|${target}|${moduleId}`;
  if (edges.has(id)) return;
  edges.set(id, { id, type, source, target, pathway: moduleId, ...extra });
}

for (const mod of modules) {
  const local = { metabolite: {}, enzyme: {}, complex: {}, gene: {}, reaction: {} };

  for (const m of mod.metabolites || []) local.metabolite[m.id] = upsertNode(metKey(m), "metabolite", m.name, m, mod.id);
  for (const e of mod.enzymes || []) local.enzyme[e.id] = upsertNode(enzKey(e), "enzyme", e.name, e, mod.id);
  for (const g of mod.genes || []) local.gene[g.id] = upsertNode(geneKey(g), "gene", g.symbol, g, mod.id);
  for (const c of mod.complexes || []) local.complex[c.id] = upsertNode(`cpx:${mod.id}:${c.id}`, "complex", c.name, c, mod.id);
  for (const r of mod.reactions || []) local.reaction[r.id] = upsertNode(rxnKey(r, mod.id), "reaction", r.name || r.id, r, mod.id);

  // pathway node (for crosstalk targets)
  upsertNode(`pathway:${mod.id}`, "pathway", mod.name, { id: mod.id, name: mod.name, category: mod.category }, mod.id);

  const resolve = (kind, id) => {
    if (kind === "pathway") return `pathway:${id}`;
    return local[kind]?.[id];
  };

  for (const r of mod.reactions || []) {
    const rId = local.reaction[r.id];
    const reversible = r.reversibility === "reversible";
    for (const s of r.substrates || []) addEdge(reversible ? "reversible" : "substrate", local.metabolite[s.metabolite], rId, mod.id, { stoichiometry: s.stoichiometry ?? 1 });
    for (const p of r.products || []) addEdge(reversible ? "reversible" : "product", rId, local.metabolite[p.metabolite], mod.id, { stoichiometry: p.stoichiometry ?? 1 });
    for (const c of r.catalysts || []) addEdge("catalysis", local.enzyme[c.enzyme] || local.complex[c.enzyme], rId, mod.id, { role: c.role });
    for (const c of r.cofactors || []) addEdge("cofactor", local.metabolite[c.metabolite], rId, mod.id, { role: c.role });
  }
  for (const reg of mod.regulations || []) {
    addEdge(reg.type, resolve(reg.regulator.kind, reg.regulator.id), resolve(reg.target.kind, reg.target.id), mod.id, { effect: reg.effect, mechanism: reg.mechanism });
  }
  for (const rel of mod.relations || []) {
    // ensure pathway endpoint nodes exist even for as-yet-unbuilt modules
    if (rel.source.kind === "pathway") upsertNode(`pathway:${rel.source.id}`, "pathway", rel.source.id, { id: rel.source.id, name: rel.source.id }, mod.id);
    if (rel.target.kind === "pathway") upsertNode(`pathway:${rel.target.id}`, "pathway", rel.target.id, { id: rel.target.id, name: rel.target.id }, mod.id);
    addEdge(rel.type, resolve(rel.source.kind, rel.source.id), resolve(rel.target.kind, rel.target.id), mod.id, { note: rel.note });
  }

  const counts = {
    metabolites: (mod.metabolites || []).length,
    enzymes: (mod.enzymes || []).length,
    reactions: (mod.reactions || []).length,
    regulations: (mod.regulations || []).length,
  };
  pathwaySummaries.push({ id: mod.id, name: mod.name, category: mod.category, summary: mod.summary, counts });
}

const nodeList = [...nodes.values()];
const edgeList = [...edges.values()];

const stats = {
  pathways: modules.length,
  nodes: nodeList.length,
  edges: edgeList.length,
  metabolites: nodeList.filter((n) => n.kind === "metabolite").length,
  enzymes: nodeList.filter((n) => n.kind === "enzyme").length,
  reactions: nodeList.filter((n) => n.kind === "reaction").length,
};
const edgeTypeCounts = {};
for (const e of edgeList) edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;

const master = { version: "1.0.0", generated: BUILD_STAMP(), pathways: pathwaySummaries, nodes: nodeList, edges: edgeList, stats, edgeTypeCounts };

// glossary: metabolites + enzymes with descriptions
const glossary = nodeList
  .filter((n) => n.kind === "metabolite" || n.kind === "enzyme")
  .map((n) => ({
    id: n.id, kind: n.kind, name: n.label,
    description: n.data?.description || "",
    formula: n.data?.formula, ec: n.data?.ec, gene: n.data?.gene,
    xrefs: n.data?.xrefs || {}, pathways: n.pathways,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const search = nodeList.map((n) => ({ id: n.id, label: n.label, kind: n.kind, pathways: n.pathways }));

// reset output dir
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "pathways"), { recursive: true });

// make the arrow registry available to the client (legend + renderer)
try {
  const arrows = readFileSync(join(ROOT, "schema", "arrows.json"), "utf8");
  writeFileSync(join(OUT_DIR, "arrows.json"), arrows);
} catch { /* registry optional at build time */ }

writeFileSync(join(OUT_DIR, "master.json"), JSON.stringify(master));
writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify({ generated: master.generated, stats, edgeTypeCounts, pathways: pathwaySummaries }, null, 2));
writeFileSync(join(OUT_DIR, "glossary.json"), JSON.stringify(glossary));
writeFileSync(join(OUT_DIR, "search.json"), JSON.stringify(search));

// per-pathway subgraphs
for (const mod of modules) {
  const keep = new Set(nodeList.filter((n) => n.pathways.includes(mod.id)).map((n) => n.id));
  const subNodes = nodeList.filter((n) => keep.has(n.id));
  const subEdges = edgeList.filter((e) => e.pathway === mod.id);
  writeFileSync(join(OUT_DIR, "pathways", `${mod.id}.json`), JSON.stringify({ id: mod.id, name: mod.name, nodes: subNodes, edges: subEdges }));
}

function BUILD_STAMP() {
  // Deterministic-ish: use SOURCE_DATE_EPOCH if provided, else file-agnostic label.
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return epoch ? new Date(Number(epoch) * 1000).toISOString() : "build";
}

console.log(`Built master graph: ${stats.pathways} pathways, ${stats.nodes} nodes, ${stats.edges} edges.`);
console.log(`  metabolites=${stats.metabolites} enzymes=${stats.enzymes} reactions=${stats.reactions}`);
console.log(`  edge types: ${Object.entries(edgeTypeCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);

// Assemble every compiled pathway chart into ONE master wall chart, the way the
// Roche poster puts all of metabolism on a single sheet with an A–L / 1–10
// coordinate grid down the margins.
//
// Pathways are shelf-packed into a wide canvas: deterministic, and guaranteed
// not to overlap because each region reserves its own footprint.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CHART_DIR = join(ROOT, "web", "public", "chart");

const GAP = 240;          // gutter between pathway regions
const TARGET_ASPECT = 1.4; // wall charts are wider than tall

const files = readdirSync(CHART_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_") && f !== "index.json");
const charts = files.map((f) => JSON.parse(readFileSync(join(CHART_DIR, f), "utf8")))
  .filter((c) => c && c.bounds && c.nodes?.length);

if (!charts.length) {
  console.error("No compiled charts found — run `npm run chart:build` first.");
  process.exit(1);
}

// Shelf-pack: fill a row until it exceeds the target width, then start a new row.
const totalArea = charts.reduce((s, c) => s + c.bounds.w * c.bounds.h, 0);
const targetW = Math.sqrt(totalArea * TARGET_ASPECT);

const ordered = [...charts].sort((a, b) => b.bounds.h - a.bounds.h); // tall regions first packs tighter
const regions = [];
let cx = 0, cy = 0, rowH = 0;
for (const c of ordered) {
  if (cx > 0 && cx + c.bounds.w > targetW) { cx = 0; cy += rowH + GAP; rowH = 0; }
  regions.push({ chart: c, ox: cx - c.bounds.x, oy: cy - c.bounds.y, x: cx, y: cy, w: c.bounds.w, h: c.bounds.h });
  cx += c.bounds.w + GAP;
  rowH = Math.max(rowH, c.bounds.h);
}

const master = {
  id: "_master",
  title: "Metabolian — Biochemical Pathways",
  isMaster: true,
  bounds: { x: 0, y: 0, w: 0, h: 0 },
  regions: [],
  nodes: [], reactions: [], regulation: [],
};

for (const r of regions) {
  const { chart: c, ox, oy } = r;
  const shift = ([x, y]) => [x + ox, y + oy];
  master.regions.push({ id: c.id, title: c.title, x: r.x, y: r.y, w: r.w, h: r.h });
  for (const n of c.nodes) master.nodes.push({ ...n, id: `${c.id}::${n.id}`, x: n.x + ox, y: n.y + oy, pathway: c.id });
  for (const rx of c.reactions) {
    master.reactions.push({
      ...rx, id: `${c.id}::${rx.id}`,
      from: `${c.id}::${rx.from}`, to: `${c.id}::${rx.to}`,
      points: rx.points.map(shift), pathway: c.id,
    });
  }
  for (const g of c.regulation) master.regulation.push({ ...g, points: g.points.map(shift), pathway: c.id });
}

// Cross-pathway links, the way the poster does it: rather than dragging a line
// across the sheet (which is how you get a ball of yarn), anchor a short arrow at
// the shared metabolite labelled with the destination and its grid reference.
const PATHWAY_DIR = join(ROOT, "data", "pathways");
master.connectors = [];
const regionById = new Map(regions.map((r) => [r.chart.id, r]));
for (const r of regions) {
  const src = join(PATHWAY_DIR, `${r.chart.id}.json`);
  if (!existsSync(src)) continue;
  let mod;
  try { mod = JSON.parse(readFileSync(src, "utf8")); } catch { continue; }
  for (const rel of mod.relations || []) {
    if (rel.type !== "crosstalk" || rel.target?.kind !== "pathway") continue;
    const target = regionById.get(rel.target.id);
    if (!target || target.chart.id === r.chart.id) continue;
    const node = r.chart.nodes.find((n) => n.metabolite === rel.source?.id);
    if (!node) continue;
    const goesRight = target.x >= r.x;
    master.connectors.push({
      from: r.chart.id, to: target.chart.id,
      metabolite: node.metabolite,
      x: node.x + r.ox + (goesRight ? node.w : 0),
      y: node.y + r.oy + node.h / 2,
      dir: goesRight ? 1 : -1,
      label: target.chart.title,
      note: rel.note || "",
    });
  }
}

const maxX = Math.max(...regions.map((r) => r.x + r.w));
const maxY = Math.max(...regions.map((r) => r.y + r.h));
master.bounds = { x: -GAP, y: -GAP, w: maxX + GAP * 2, h: maxY + GAP * 2 };

// Coordinate grid down the margins, like the poster's A–L / 1–10 ruler.
const COLS = 12, ROWS = 10;
master.grid = {
  cols: Array.from({ length: COLS }, (_, i) => ({
    label: String.fromCharCode(65 + i),
    x: master.bounds.x + (master.bounds.w * i) / COLS,
    w: master.bounds.w / COLS,
  })),
  rows: Array.from({ length: ROWS }, (_, i) => ({
    label: String(i + 1),
    y: master.bounds.y + (master.bounds.h * i) / ROWS,
    h: master.bounds.h / ROWS,
  })),
};

// Give every region its coordinate reference (e.g. "C4"), as the poster does.
for (const reg of master.regions) {
  const ci = Math.min(COLS - 1, Math.floor(((reg.x + reg.w / 2 - master.bounds.x) / master.bounds.w) * COLS));
  const ri = Math.min(ROWS - 1, Math.floor(((reg.y + reg.h / 2 - master.bounds.y) / master.bounds.h) * ROWS));
  reg.ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
}

// stamp each connector with its destination's coordinate reference
const refById = new Map(master.regions.map((r) => [r.id, r.ref]));
for (const c of master.connectors) c.ref = refById.get(c.to) || "";

writeFileSync(join(CHART_DIR, "_master.json"), JSON.stringify(master));

// register it at the top of the picker
const idxPath = join(CHART_DIR, "index.json");
const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { charts: [] };
idx.charts = [
  { id: "_master", title: "★ Master chart — all pathways", grid: null, nodes: master.nodes.length, reactions: master.reactions.length },
  ...idx.charts.filter((c) => c.id !== "_master"),
];
writeFileSync(idxPath, JSON.stringify(idx, null, 2));

console.log(`Master chart: ${master.regions.length} pathway regions, ${master.nodes.length} nodes, ${master.reactions.length} reactions`);
console.log(`  canvas ${Math.round(master.bounds.w)}x${Math.round(master.bounds.h)} · regions at ${master.regions.slice(0, 6).map((r) => `${r.id}@${r.ref}`).join(", ")}…`);

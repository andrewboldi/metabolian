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

const GAP = 76;           // gutter between pathway regions (the poster tessellates)
const TARGET_ASPECT = 1.4; // wall charts are wider than tall

const files = readdirSync(CHART_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_") && f !== "index.json");
const charts = files.map((f) => JSON.parse(readFileSync(join(CHART_DIR, f), "utf8")))
  .filter((c) => c && c.bounds && c.nodes?.length);

if (!charts.length) {
  console.error("No compiled charts found — run `npm run chart:build` first.");
  process.exit(1);
}

// Pack into balanced columns (masonry): each region goes to the currently
// shortest column. We try every column count and keep the one whose finished
// canvas is closest to a wall-chart aspect — dense, not a ragged strip.
const ordered = [...charts].sort((a, b) => b.bounds.h - a.bounds.h);

function packInto(colCount) {
  const colX = [];
  const colH = new Array(colCount).fill(0);
  const colW = new Array(colCount).fill(0);
  const out = [];
  for (const c of ordered) {
    let ci = 0;
    for (let i = 1; i < colCount; i++) if (colH[i] < colH[ci]) ci = i;
    out.push({ chart: c, col: ci, y: colH[ci] });
    colH[ci] += c.bounds.h + GAP;
    colW[ci] = Math.max(colW[ci], c.bounds.w);
  }
  let x = 0;
  for (let i = 0; i < colCount; i++) { colX[i] = x; x += colW[i] + GAP; }
  const W = Math.max(0, x - GAP);
  const H = Math.max(...colH) - GAP;
  for (const r of out) {
    r.x = colX[r.col] + (colW[r.col] - r.chart.bounds.w) / 2; // centre in its column
    r.w = r.chart.bounds.w; r.h = r.chart.bounds.h;
    r.ox = r.x - r.chart.bounds.x; r.oy = r.y - r.chart.bounds.y;
  }
  return { out, W, H };
}

let best = null;
// The column ceiling has to scale with the sheet count. Fixed at 10 it could not
// reach a wall-chart aspect once ingestion took the atlas past a hundred sheets:
// 904 regions packed into 10 columns is a strip ~2.5x taller than it is wide,
// which fits a landscape screen at 2% zoom and reads as a smudge. Roughly
// 2*sqrt(n) columns is enough to find a poster-shaped canvas at any size.
const MAX_COLS = Math.min(charts.length, Math.max(10, Math.ceil(Math.sqrt(charts.length) * 2)));
for (let c = 2; c <= MAX_COLS; c++) {
  const p = packInto(c);
  const score = Math.abs(p.W / Math.max(p.H, 1) - TARGET_ASPECT);
  if (!best || score < best.score) best = { ...p, score, cols: c };
}
const regions = best.out;

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

// ---- the weave: adjacent pathways that share a compound are tied together with
// a real drawn edge, the way the poster flows one pathway into the next. Distant
// links keep the labelled off-page connector instead.
master.ties = [];
{
  const cellsOf = (regId) => master.nodes.filter((n) => n.pathway === regId);
  const all = master.nodes;
  const clear = (pts, a, b) => {
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      const lo = { x: Math.min(p[0], q[0]) - 4, y: Math.min(p[1], q[1]) - 4 };
      const hi = { x: Math.max(p[0], q[0]) + 4, y: Math.max(p[1], q[1]) + 4 };
      for (const n of all) {
        if (n === a || n === b) continue;
        if (!(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y)) return false;
      }
    }
    return true;
  };
  const route = (a, b) => {
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const cands = [];
    // horizontal-first and vertical-first L routes between facing edges
    const ax = bcx >= acx ? a.x + a.w : a.x, bx = bcx >= acx ? b.x : b.x + b.w;
    const ay = bcy >= acy ? a.y + a.h : a.y, by = bcy >= acy ? b.y : b.y + b.h;
    cands.push([[ax, acy], [bcx, acy], [bcx, by]]);
    cands.push([[acx, ay], [acx, bcy], [bx, bcy]]);
    // Z-routes through the gutter between the two regions
    const midX = Math.round((ax + bx) / 2), midY = Math.round((ay + by) / 2);
    cands.push([[ax, acy], [midX, acy], [midX, bcy], [bx, bcy]]);
    cands.push([[acx, ay], [acx, midY], [bcx, midY], [bcx, by]]);
    for (const c of cands) if (clear(c, a, b)) return c;
    return null;
  };

  const seen = new Set();
  for (let i = 0; i < master.regions.length; i++) {
    for (let j = i + 1; j < master.regions.length; j++) {
      const A = master.regions[i], B = master.regions[j];
      // only tie regions that actually sit next to each other
      const gapX = Math.max(0, Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w));
      const gapY = Math.max(0, Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h));
      if (Math.hypot(gapX, gapY) > GAP * 9) continue;

      const aCells = cellsOf(A.id), bCells = cellsOf(B.id);
      const shared = [];
      for (const a of aCells) {
        const b = bCells.find((x) => x.metabolite === a.metabolite);
        if (b) shared.push([a, b]);
      }
      // nearest shared compounds first, and only a couple per pair so it reads
      shared.sort((p, q) => dist(p[0], p[1]) - dist(q[0], q[1]));
      for (const [a, b] of shared.slice(0, 3)) {
        const key = `${A.id}|${B.id}|${a.metabolite}`;
        if (seen.has(key)) continue;
        const pts = route(a, b);
        if (!pts) continue;
        seen.add(key);
        master.ties.push({ metabolite: a.metabolite, label: a.label, from: A.id, to: B.id, points: pts });
      }
    }
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
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

console.log(`Master chart: ${master.ties.length} shared-compound ties · ${master.regions.length} pathway regions, ${master.nodes.length} nodes, ${master.reactions.length} reactions`);
console.log(`  canvas ${Math.round(master.bounds.w)}x${Math.round(master.bounds.h)} · regions at ${master.regions.slice(0, 6).map((r) => `${r.id}@${r.ref}`).join(", ")}…`);

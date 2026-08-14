// Slippy Atlas — Stage 1 tiled viewer.
//
// A Google-Earth-style raster overview of the master wall chart. Instead of the
// live SVG renderer's ~30k nodes (5-9s first paint, no 60fps pan), it shows a
// pyramid of pre-baked WebP tiles (tools/build-tiles.mjs) and moves them with a
// single compositor-only CSS transform per level — no DOM relayout on pan/zoom.
//
// It is READ-ONLY: pan, zoom, and region titles on hover. Reading a structure is
// a future hand-off back to the SVG renderer; this is only the fast overview.
// Reached exclusively via ?tiles (see web/src/pages/chart.ts) — the default chart
// renders exactly as before.

import { asset, getJSON } from "./util";

interface TileMeta {
  worldBounds: { x: number; y: number; w: number; h: number };
  tileSize: number;
  levels: { L: number; scale: number; cols: number; rows: number; present: string[] }[];
}
interface Region { id: string; title: string; ref: string; x: number; y: number; w: number; h: number }

const STYLE = `
.tiles-root { position:absolute; inset:0; overflow:hidden; background:#fff; cursor:grab; touch-action:none; }
.tiles-root.dragging { cursor:grabbing; }
.tiles-layer { position:absolute; top:0; left:0; transform-origin:0 0; will-change:transform; }
/* max-width:none is load-bearing: base.css:109 sets img{max-width:100%}, which
   resolves to 0 inside the layer (a 0x0 box holding only absolute children) and
   would clamp every tile to zero width. */
.tiles-layer img { position:absolute; display:block; max-width:none; user-select:none; -webkit-user-drag:none; image-rendering:auto; }
.tiles-tip { position:absolute; z-index:6; pointer-events:none; max-width:22rem; padding:.3rem .55rem;
  font-family:var(--font-sans,system-ui); font-size:var(--step--1,.85rem); line-height:1.25; color:#231F20;
  background:rgba(255,255,255,.94); border:1px solid #e2ded4; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,.14);
  opacity:0; transition:opacity .12s; transform:translate(-50%,-115%); white-space:nowrap; }
.tiles-tip[data-show="true"] { opacity:1; }
.tiles-tip .ref { font-family:var(--font-mono,monospace); color:#8a8574; margin-left:.4rem; }
`;

/**
 * Mount the raster viewer into `canvas`. `tilesId` is the tile directory under
 * web/public/tiles/ (the master's is "master", not its chart id "_master").
 */
export async function mountTiles(canvas: HTMLElement, tilesId: string): Promise<void> {
  const meta = await getJSON<TileMeta>(`tiles/${tilesId}/meta.json`);
  const regions = await getJSON<Region[]>(`tiles/${tilesId}/regions.json`).catch(() => [] as Region[]);
  const B = meta.worldBounds;
  const TILE = meta.tileSize;
  const scale0 = meta.levels[0].scale;
  const maxL = meta.levels.length - 1;
  const present = meta.levels.map((l) => new Set(l.present));

  if (!document.getElementById("tiles-style")) {
    const st = document.createElement("style");
    st.id = "tiles-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  canvas.replaceChildren();
  const root = document.createElement("div");
  root.className = "tiles-root";
  const tip = document.createElement("div");
  tip.className = "tiles-tip";
  root.append(tip);
  canvas.append(root);

  // world -> screen: screen = world * s + t
  let s = 1, tx = 0, ty = 0;
  const vw = () => root.clientWidth;
  const vh = () => root.clientHeight;

  // One <div> layer per pyramid level, built lazily; its tiles are pooled by id.
  const layers = new Map<number, { el: HTMLDivElement; pool: Map<string, HTMLImageElement> }>();
  function layer(L: number) {
    let ly = layers.get(L);
    if (!ly) {
      const el = document.createElement("div");
      el.className = "tiles-layer";
      root.insertBefore(el, tip); // keep the tooltip on top
      ly = { el, pool: new Map() };
      layers.set(L, ly);
    }
    return ly;
  }

  /** The level whose native resolution best matches the current zoom. */
  function pickLevel(): number {
    const L = Math.round(Math.log2(s / scale0));
    return Math.max(0, Math.min(maxL, L));
  }

  function clampAxis(pos: number, size: number, extent: number): number {
    // Larger than the viewport: cover it (no dead band). Smaller: stay inside it.
    const lo = Math.min(0, extent - size), hi = Math.max(0, extent - size);
    return Math.min(hi, Math.max(lo, pos));
  }
  function clamp() {
    const left = B.x * s + tx, top = B.y * s + ty;
    tx += clampAxis(left, B.w * s, vw()) - left;
    ty += clampAxis(top, B.h * s, vh()) - top;
  }

  function fit() {
    s = Math.min(vw() / B.w, vh() / B.h) * 0.98;
    tx = (vw() - B.w * s) / 2 - B.x * s;
    ty = (vh() - B.h * s) / 2 - B.y * s;
    render();
  }

  function zoomBy(factor: number, px = vw() / 2, py = vh() / 2) {
    const nk = Math.min(6, Math.max(scale0 * 0.5, s * factor));
    tx = px - ((px - tx) / s) * nk;
    ty = py - ((py - ty) / s) * nk;
    s = nk;
    clamp();
    render();
  }

  /** Cull+load the visible tiles of one level and place them in its layer. */
  function fillLevel(L: number) {
    const info = meta.levels[L];
    const ly = layer(L);
    const S = s / info.scale;
    const LX = B.x * s + tx, LY = B.y * s + ty;
    ly.el.style.transform = `translate(${LX}px,${LY}px) scale(${S})`;
    // Visible tile range in this level's pixel space, inverse of the layer xform.
    const pxMin = (0 - LX) / S, pxMax = (vw() - LX) / S;
    const pyMin = (0 - LY) / S, pyMax = (vh() - LY) / S;
    const M = 1; // one-tile margin so a fast pan never exposes a blank edge
    const c0 = Math.max(0, Math.floor(pxMin / TILE) - M), c1 = Math.min(info.cols - 1, Math.floor(pxMax / TILE) + M);
    const r0 = Math.max(0, Math.floor(pyMin / TILE) - M), r1 = Math.min(info.rows - 1, Math.floor(pyMax / TILE) + M);
    const want = new Set<string>();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c}_${r}`;
        if (!present[L].has(key)) continue; // blank tile — never baked
        want.add(key);
        if (ly.pool.has(key)) continue;
        const img = new Image();
        img.decoding = "async";
        img.style.left = `${c * TILE}px`;
        img.style.top = `${r * TILE}px`;
        img.style.width = `${TILE}px`;
        img.style.height = `${TILE}px`;
        img.src = asset(`tiles/${tilesId}/${L}/${key}.webp`);
        ly.pool.set(key, img);
        ly.el.append(img);
      }
    }
    // Evict tiles now out of view to bound memory.
    for (const [key, img] of ly.pool) {
      if (!want.has(key)) { img.remove(); ly.pool.delete(key); }
    }
  }

  let raf = 0;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const active = pickLevel();
      // Keep the level below the active one populated as a lower-res backfill so
      // zooming in shows something immediately instead of blank paper.
      const backfill = active > 0 ? active - 1 : -1;
      for (const [L, ly] of layers) {
        if (L === active || L === backfill) continue;
        ly.el.style.display = "none";
      }
      if (backfill >= 0) { layer(backfill).el.style.display = ""; layer(backfill).el.style.zIndex = "0"; fillLevel(backfill); }
      layer(active).el.style.display = ""; layer(active).el.style.zIndex = "1";
      fillLevel(active);
      hud(active);
    });
  }

  // --- HUD: reuse the page's existing zoom controls / readouts ---
  const $ = (id: string) => document.getElementById(id);
  function hud(active: number) {
    const zr = $("zoom-readout"); if (zr) zr.textContent = `${Math.round(s * 100)}%`;
    const lb = $("lod-badge"); if (lb) lb.textContent = `raster · L${active}`;
  }
  $("zoom-in")?.addEventListener("click", () => zoomBy(1.35));
  $("zoom-out")?.addEventListener("click", () => zoomBy(1 / 1.35));
  $("zoom-fit")?.addEventListener("click", () => fit());

  // --- wheel zoom (to cursor) + drag pan ---
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let dragging = false, lx = 0, ly = 0, moved = false;
  root.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    root.classList.add("dragging");
    root.setPointerCapture(e.pointerId);
    tip.dataset.show = "false";
  });
  root.addEventListener("pointermove", (e) => {
    if (dragging) {
      tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY;
      moved = true;
      clamp();
      render();
    } else {
      hover(e);
    }
  });
  const end = () => { dragging = false; root.classList.remove("dragging"); };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  root.addEventListener("pointerleave", () => { tip.dataset.show = "false"; });

  // --- region title on hover: the smallest region under the cursor wins ---
  const byArea = [...regions].sort((a, b) => a.w * a.h - b.w * b.h);
  let hoverRaf = 0, hx = 0, hy = 0;
  function hover(e: PointerEvent) {
    hx = e.clientX; hy = e.clientY;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const r = root.getBoundingClientRect();
      const wx = (hx - r.left - tx) / s, wy = (hy - r.top - ty) / s;
      const hit = byArea.find((rg) => wx >= rg.x && wx <= rg.x + rg.w && wy >= rg.y && wy <= rg.y + rg.h);
      if (!hit || moved) { tip.dataset.show = "false"; return; }
      tip.replaceChildren();
      tip.append(hit.title);
      if (hit.ref) { const sp = document.createElement("span"); sp.className = "ref"; sp.textContent = hit.ref; tip.append(sp); }
      tip.style.left = `${hx - r.left}px`;
      tip.style.top = `${hy - r.top}px`;
      tip.dataset.show = "true";
    });
  }

  new ResizeObserver(() => { if (vw() > 1 && vh() > 1) { clamp(); render(); } }).observe(root);

  const title = document.getElementById("chart-title");
  if (title) title.textContent = "Metabolian — Biochemical Pathways";

  // First paint: frame the whole atlas.
  fit();
}

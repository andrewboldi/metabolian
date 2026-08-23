// Slippy Atlas — Stage 2 hybrid controller (master wall chart only).
//
// The master opens on the instant raster tile overview (Stage 1, tiles-view.ts) and
// hands off to the live SVG renderer (chart-view.ts mountChart) the moment the reader
// zooms in far enough to want detail the tiles do NOT carry — enzyme names, EC
// numbers, hydrated structures (the LOD_NORMAL flip). The handoff is ONE-WAY and
// pixel-verbatim: the raster transform is copied into the SVG unchanged and a short
// compositor-only opacity crossfade swaps the layers, so there is no pan jump and no
// blank/pop frame. Below the threshold the SVG would paint the identical overview ink
// the tiles are literal screenshots of, so the swap is content-identical.
//
// Reached only for id=_master with no ?tiles=off (see web/src/pages/chart.ts). Every
// other chart id never imports this file.

import { mountTiles, type TilesController } from "./tiles-view";
import { LOD_NORMAL } from "./chart-view";

/** The slice of the chart-view control object this controller drives. */
type SvgView = {
  fit(): void;
  zoomBy(f: number, cx?: number, cy?: number): void;
  setTransformRaw(k: number, tx: number, ty: number): void;
  getTransform(): { k: number; tx: number; ty: number };
  readonly zoom: number;
};

export interface HybridOptions {
  /** Tile directory under web/public/tiles/ (the master's is "master"). */
  tilesId: string;
  /** Mount the live SVG chart into `host`; `onZoom` drives the HUD once active. */
  mountSvg(host: HTMLElement, onZoom: (k: number, lod: string) => void): Promise<SvgView>;
}

// Hand off at the exact scale the SVG first paints ink the tiles do not have.
const T = LOD_NORMAL; // 0.26
const FADE_MS = 180;

export async function mountMasterHybrid(canvas: HTMLElement, opts: HybridOptions): Promise<void> {
  canvas.replaceChildren();

  // Two absolutely-positioned inset:0 hosts. chart-view binds its wheel/pointer/
  // ResizeObserver to the element it is GIVEN, so mounting the SVG into svgHost —
  // not #chart-canvas — isolates its input entirely: no shared-canvas double-handling.
  const rasterHost = document.createElement("div");
  rasterHost.className = "hybrid-raster";
  const svgHost = document.createElement("div");
  svgHost.className = "hybrid-svg";
  svgHost.style.opacity = "0";
  svgHost.style.pointerEvents = "none";   // raster is the sole interactive layer until handoff
  canvas.append(rasterHost, svgHost);

  // Default paint: the instant raster overview. If it cannot mount (tile assets
  // missing/broken) restore the canvas and let the caller fall back to pure SVG.
  let tiles: TilesController;
  try {
    tiles = await mountTiles(rasterHost, opts.tilesId, { hud: false, onScale });
  } catch (e) {
    canvas.replaceChildren();
    throw e;
  }

  let crossedT = false;
  let handedOff = false;
  let svgStarted = false;
  let svgReady = false;
  let svgView: SvgView | null = null;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const ac = new AbortController();
  const { signal } = ac;

  // Deep link (?z/cx/cy) parity with the SVG path: frame the opening view instead
  // of a plain fit, and keep the URL current as the reader navigates (shareable).
  const q = new URLSearchParams(location.search);
  const numQ = (k: string) => { const r = q.get(k); if (r === null || r.trim() === "") return undefined; const n = Number(r); return Number.isFinite(n) ? n : undefined; };
  const dz = numQ("z"), dcx = numQ("cx"), dcy = numQ("cy");
  if (dz !== undefined && dz > 0 && dcx !== undefined && dcy !== undefined) {
    tiles.setView(dz, dcx, dcy);
    if (dz >= T) crossedT = true; // a detail-zoom deep link hands straight off to the SVG
  }
  let urlTimer = 0;
  const writeUrl = () => {
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      let z: number, cx: number, cy: number;
      if (handedOff && svgView) { const g = svgView.getTransform(); z = g.k; cx = (canvas.clientWidth / 2 - g.tx) / g.k; cy = (canvas.clientHeight / 2 - g.ty) / g.k; }
      else { const c = tiles.centre(); z = c.z; cx = c.cx; cy = c.cy; }
      const p = new URLSearchParams(location.search);
      p.set("z", z.toFixed(4)); p.set("cx", cx.toFixed(1)); p.set("cy", cy.toFixed(1));
      history.replaceState(null, "", `${location.pathname}?${p}`);
    }, 400);
  };
  canvas.addEventListener("wheel", writeUrl, { passive: true, signal });
  canvas.addEventListener("pointerup", writeUrl, { passive: true, capture: true, signal });

  // Track pointer state so the heavy (~30k-node, multi-second) synchronous SVG mount
  // is never STARTED mid-gesture and janks a live pan. Capture phase: tiles-view
  // captures the pointer on its own root, so a bubbling listener would miss it.
  let pointerActive = false;
  canvas.addEventListener("pointerdown", () => { pointerActive = true; }, { passive: true, capture: true, signal });
  const clearPointer = () => { pointerActive = false; };
  canvas.addEventListener("pointerup", clearPointer, { passive: true, capture: true, signal });
  canvas.addEventListener("pointercancel", clearPointer, { passive: true, capture: true, signal });

  // --- HUD, re-pointed at whichever layer is active ---
  const zr = document.getElementById("zoom-readout");
  const lb = document.getElementById("lod-badge");
  document.getElementById("zoom-in")?.addEventListener("click", () => {
    if (handedOff && svgView) svgView.zoomBy(1.35); else tiles.zoomBy(1.35);
  }, { signal });
  document.getElementById("zoom-out")?.addEventListener("click", () => {
    if (handedOff && svgView) svgView.zoomBy(1 / 1.35); else tiles.zoomBy(1 / 1.35);
  }, { signal });
  document.getElementById("zoom-fit")?.addEventListener("click", () => {
    if (handedOff && svgView) svgView.fit(); else tiles.fit();
  }, { signal });

  function onScale(s: number) {
    if (!handedOff) {
      if (zr) zr.textContent = `${Math.round(s * 100)}%`;
      if (lb) lb.textContent = "overview";
    }
    // One-shot: a single wheel tick can leap past T. We arm at the crossing and
    // hand off at the MATCHED view — the wheel delta is never replayed into the SVG.
    if (!crossedT && s >= T) { crossedT = true; startPrewarm(); }
    maybeHandoff();
  }

  function startPrewarm() {
    if (svgStarted) return;
    svgStarted = true;
    scheduleIdle(async () => {
      try {
        svgView = await opts.mountSvg(svgHost, (k, lod) => {
          // The hidden fit fires onZoom too; only let the HUD follow the SVG once active.
          if (!handedOff) return;
          if (zr) zr.textContent = `${Math.round(k * 100)}%`;
          if (lb) lb.textContent = lod;
        });
      } catch (e) {
        console.warn("hybrid: SVG mount failed; staying on the raster", e);
        return;
      }
      // Overview LOD is synchronous and cheap; one rAF lets it settle before we
      // declare the layer ready to receive the copied frame.
      requestAnimationFrame(() => { svgReady = true; maybeHandoff(); });
    });
  }

  function scheduleIdle(run: () => void) {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    const go = () => { if (pointerActive) { setTimeout(attempt, 140); return; } run(); };
    const attempt = () => { if (ric) ric(go, { timeout: 1500 }); else setTimeout(go, 200); };
    attempt();
  }

  // ONE-WAY handoff: copy the raster frame in verbatim, hand pointer control to the
  // SVG at fade START (so a continued gesture never stalls), crossfade opacity only.
  function maybeHandoff() {
    if (handedOff || !crossedT || !svgReady || !svgView) return;
    handedOff = true;
    const { s, tx, ty } = tiles.getTransform();
    svgView.setTransformRaw(s, tx, ty);   // s===k, tx→tx, ty→ty; NO re-clamp — pixel-exact
    tiles.setActive(false);
    svgHost.style.pointerEvents = "auto";
    if (reduceMotion) {
      // Both layers are already registered at the same transform, so an instant
      // swap is still pop-free.
      svgHost.style.opacity = "1";
      rasterHost.style.display = "none";
      return;
    }
    svgHost.style.transition = `opacity ${FADE_MS}ms linear`;
    rasterHost.style.transition = `opacity ${FADE_MS}ms linear`;
    requestAnimationFrame(() => {
      svgHost.style.opacity = "1";
      rasterHost.style.opacity = "0";
    });
    // Leave the raster painted beneath through the overlap, then display:none it to
    // relieve the compositor once the fade has settled.
    window.setTimeout(() => { rasterHost.style.display = "none"; }, FADE_MS + 60);
  }

  // Prewarm during idle right after first paint — this is what removes the multi-
  // second frozen window on the first detail zoom. It never blocks: the raster stays
  // the sole interactive layer until svgReady is proven, so a slow/failed SVG mount
  // can never strand the reader with neither renderer.
  startPrewarm();
}

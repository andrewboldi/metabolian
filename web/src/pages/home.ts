import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/home.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, fmt } from "../lib/util";
import { loadArrows, arrowSVG } from "../lib/arrows";

mountChrome("");

interface Index { stats: Record<string, number>; edgeTypeCounts: Record<string, number>; pathways: unknown[]; }

async function fillStats() {
  try {
    const idx = await getJSON<Index>("graph/index.json");
    const map: Record<string, number> = {
      pathways: idx.stats.pathways,
      reactions: idx.stats.reactions,
      metabolites: idx.stats.metabolites,
      enzymes: idx.stats.enzymes,
    };
    for (const node of document.querySelectorAll<HTMLElement>("[data-stat]")) {
      const key = node.dataset.stat!;
      if (map[key] != null) countUp(node, map[key]);
    }
  } catch {
    for (const node of document.querySelectorAll<HTMLElement>("[data-stat]")) node.textContent = "—";
  }
}

function countUp(node: HTMLElement, to: number) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { node.textContent = fmt(to); return; }
  const start = performance.now();
  const dur = 900;
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(Math.round(to * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function buildLegend() {
  const host = document.getElementById("legend");
  if (!host) return;
  const reg = await loadArrows();
  const byCat: Record<string, string[]> = {};
  for (const [key, spec] of Object.entries(reg.arrows)) (byCat[spec.category] ??= []).push(key);

  for (const [cat, desc] of Object.entries(reg.categories)) {
    const keys = byCat[cat] || [];
    if (!keys.length) continue;
    host.append(el("div.legend-cat", {}, [
      el("h3", {}, [cat[0].toUpperCase() + cat.slice(1)]),
      el("p.muted", {}, [desc]),
    ]));
    for (const key of keys) {
      const spec = reg.arrows[key];
      host.append(el("div.legend-item", {}, [
        el("span.legend-swatch", { style: "width:54px;height:18px", html: arrowSVG(spec) }),
        el("span.legend-item__body", {}, [
          el("span.legend-item__label", {}, [spec.label]),
          el("span.legend-item__desc", {}, [spec.description]),
        ]),
      ]));
    }
  }
}

async function startHero() {
  const canvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  try { const { initHero } = await import("../lib/hero"); await initHero(canvas); } catch { /* animation is optional */ }
}

fillStats();
buildLegend();
// defer hero until the page is interactive so it never competes with LCP
if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(startHero);
else setTimeout(startHero, 200);

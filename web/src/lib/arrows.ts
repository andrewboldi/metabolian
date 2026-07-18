// Load the canonical arrow registry and draw each arrow as an SVG "specimen"
// — the shared visual grammar used by the home legend and (as a reference) the graph.
import { getJSON } from "./util";

export interface ArrowSpec {
  label: string; category: string; from: string[]; to: string[];
  effect: string; line: "solid" | "dashed" | "dotted"; head: string; color: string; description: string;
}
export interface ArrowRegistry {
  version: string;
  categories: Record<string, string>;
  arrows: Record<string, ArrowSpec>;
}

let cache: ArrowRegistry | null = null;
export async function loadArrows(): Promise<ArrowRegistry> {
  if (!cache) cache = await getJSON<ArrowRegistry>("graph/arrows.json");
  return cache;
}

const dash = (line: string) => (line === "dashed" ? "7 5" : line === "dotted" ? "2 4" : "none");

/** Render one arrow spec as an inline SVG (46x18) with correct line + head. */
export function arrowSVG(spec: ArrowSpec, w = 54, h = 18): string {
  const y = h / 2;
  const x1 = 2;
  const x2 = w - 12;
  const stroke = `var(${spec.color})`;
  const both = spec.head.endsWith("-both");
  const head = spec.head.replace("-both", "");
  let markers = "";
  const capEnd = markerFor(head, x2, y, stroke, 1);
  const capStart = both ? markerFor(head, x1, y, stroke, -1) : "";
  markers = capStart + capEnd;
  const startX = both && head.includes("vee") ? x1 + 6 : x1;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="overflow:visible">
    <line x1="${startX}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="2" stroke-dasharray="${dash(spec.line)}" stroke-linecap="round"/>
    ${markers}
  </svg>`;
}

function markerFor(head: string, x: number, y: number, color: string, dir: 1 | -1): string {
  const d = dir; // 1 => pointing right at x, -1 => pointing left
  switch (head) {
    case "triangle": return `<path d="M${x} ${y} L${x - 9 * d} ${y - 5} L${x - 9 * d} ${y + 5} Z" fill="${color}"/>`;
    case "vee": return `<path d="M${x} ${y} L${x - 9 * d} ${y - 5} M${x} ${y} L${x - 9 * d} ${y + 5}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    case "open": return `<path d="M${x} ${y} L${x - 8 * d} ${y - 4} M${x} ${y} L${x - 8 * d} ${y + 4}" stroke="${color}" stroke-width="1.6" fill="none"/>`;
    case "tee": return `<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
    case "circle": return `<circle cx="${x - 3 * d}" cy="${y}" r="4" fill="none" stroke="${color}" stroke-width="2"/>`;
    case "diamond": return `<path d="M${x} ${y} L${x - 5 * d} ${y - 5} L${x - 10 * d} ${y} L${x - 5 * d} ${y + 5} Z" fill="${color}"/>`;
    case "curve": return `<path d="M${x - 10 * d} ${y - 5} Q${x} ${y} ${x - 10 * d} ${y + 5}" fill="none" stroke="${color}" stroke-width="2"/>`;
    case "none": return "";
    default: return `<path d="M${x} ${y} L${x - 9 * d} ${y - 5} L${x - 9 * d} ${y + 5} Z" fill="${color}"/>`;
  }
}

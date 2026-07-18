// Roche-fidelity chart renderer.
//
// Draws a compiled MPL layout as SVG using Michal's visual language: metabolite
// cells holding real skeletal structures, orthogonal flux lines, blue enzyme
// names, red cofactor side-entries and regulation. Pan/zoom is *semantic* — the
// drawing gains detail as you zoom in rather than merely getting bigger.

const NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, kids: (Node | string)[] = []): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const kid of kids) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

export interface ChartNode {
  id: string; metabolite: string; label: string; x: number; y: number; w: number; h: number;
  formula: string | null; mol: string | null; molSize: { w: number; h: number } | null;
  xrefs: Record<string, unknown>; lane: string;
}
export interface ChartRxn {
  id: string; kind: string; enzyme: string | null; enzymeName: string | null; ec: string | null;
  uniprot: string | null; pdb: string | null; gene: string | null;
  reversible: boolean; committed?: boolean; from: string; to: string; points: [number, number][];
  in: string[]; out: string[]; inLabels: string[]; outLabels: string[]; side?: string;
}
export interface ChartReg { effect: string; kind: string; from: string; to: string; points: [number, number][]; glyph: string; }
export interface ChartIR {
  id: string; title: string; grid: string | null;
  bounds: { x: number; y: number; w: number; h: number };
  nodes: ChartNode[]; reactions: ChartRxn[]; regulation: ChartReg[];
}

export interface ChartHooks {
  onMetabolite?(n: ChartNode): void;
  onEnzyme?(r: ChartRxn): void;
  onZoom?(k: number, lod: string): void;
}

// Tuned so a typical "Fit" view of a single pathway already shows enzyme names.
const LOD_NORMAL = 0.26;
const LOD_DETAIL = 0.7;
const molCache = new Map<string, string>();

export function mountChart(ir: ChartIR, canvas: HTMLElement, base: string, hooks: ChartHooks = {}) {
  canvas.replaceChildren();
  const svg = s("svg", { xmlns: NS, "data-lod": "overview" });
  const defs = s("defs");
  defs.append(
    marker("arrow-flux", "#111"),
    marker("arrow-reg", "#c8102e"),
    marker("arrow-act", "#1a7f37"),
  );
  svg.append(defs);

  const viewport = s("g", { class: "viewport" });
  const layerGrid = s("g", { class: "layer-grid" });
  const layerRegions = s("g", { class: "layer-regions" });
  const layerFlux = s("g", { class: "layer-flux" });
  const layerReg = s("g", { class: "layer-reg" });
  const layerNodes = s("g", { class: "layer-nodes" });
  viewport.append(layerGrid, layerRegions, layerFlux, layerReg, layerNodes);
  svg.append(viewport);
  canvas.append(svg);

  // ---------- master chart: coordinate ruler + pathway regions ----------
  const master = ir as ChartIR & {
    isMaster?: boolean;
    regions?: { id: string; title: string; x: number; y: number; w: number; h: number; ref: string }[];
    grid?: { cols: { label: string; x: number; w: number }[]; rows: { label: string; y: number; h: number }[] };
  };
  if (master.isMaster && master.grid) {
    const b = ir.bounds;
    for (const c of master.grid.cols) {
      layerGrid.append(s("line", { class: "grid-line", x1: c.x, y1: b.y, x2: c.x, y2: b.y + b.h }));
      layerGrid.append(s("text", { class: "grid-label", x: c.x + c.w / 2, y: b.y + 26 }, [c.label]));
      layerGrid.append(s("text", { class: "grid-label", x: c.x + c.w / 2, y: b.y + b.h - 10 }, [c.label]));
    }
    for (const r of master.grid.rows) {
      layerGrid.append(s("line", { class: "grid-line", x1: b.x, y1: r.y, x2: b.x + b.w, y2: r.y }));
      layerGrid.append(s("text", { class: "grid-label", x: b.x + 18, y: r.y + r.h / 2 }, [r.label]));
      layerGrid.append(s("text", { class: "grid-label", x: b.x + b.w - 18, y: r.y + r.h / 2 }, [r.label]));
    }
    layerGrid.append(s("rect", { class: "grid-frame", x: b.x, y: b.y, width: b.w, height: b.h }));
  }
  for (const c of (master as any).connectors || []) {
    const g = s("g", { class: "connector lod-normal" });
    const len = 54;
    const x2 = c.x + c.dir * len;
    g.append(s("line", { class: "connector-line", x1: c.x, y1: c.y, x2, y2: c.y, "marker-end": "url(#arrow-flux)" }));
    g.append(s("text", {
      class: "connector-label", x: x2 + c.dir * 6, y: c.y - 4,
      "text-anchor": c.dir > 0 ? "start" : "end",
    }, [`${c.label} ${c.ref}`]));
    layerRegions.append(g);
  }

  const regionLabels: { el: SVGGElement; reg: any; short: string }[] = [];
  for (const reg of master.regions || []) {
    const g = s("g", { class: "region", "data-region": reg.id });
    g.append(s("rect", { class: "region-frame", x: reg.x - 40, y: reg.y - 40, width: reg.w + 80, height: reg.h + 80, rx: 4 }));
    // Roche-style boxed section title
    const label = s("g", { class: "region-title" });
    const tw = Math.max(160, reg.title.length * 9.2);
    label.append(s("rect", { x: reg.x - 40, y: reg.y - 84, width: tw, height: 30, rx: 3 }));
    const titleText = s("text", { x: reg.x - 30, y: reg.y - 64 }, [reg.title]);
    label.append(titleText);
    label.append(s("text", { class: "region-ref", x: reg.x - 30 + tw - 14, y: reg.y - 64 }, [reg.ref]));
    g.append(label);
    layerRegions.append(g);
    regionLabels.push({ el: label, reg, short: reg.title.replace(/\s*\(.*$/, "") });
  }

  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const nodeEls = new Map<string, SVGGElement>();
  const edgeEls: { el: SVGElement; rxn: ChartRxn }[] = [];

  // ---------- flux reactions ----------
  for (const r of ir.reactions) {
    const g = s("g", { class: "rxn", "data-rxn": r.id });
    const cls = r.kind === "branch-link" ? "branch-line" : `flux-line${r.committed ? " committed" : ""}`;
    const line = s("polyline", {
      class: cls,
      points: r.points.map((p) => p.join(",")).join(" "),
      "marker-end": `url(#arrow-flux)`,
      ...(r.reversible ? { "marker-start": "url(#arrow-flux)" } : {}),
    });
    g.append(line);
    edgeEls.push({ el: line, rxn: r });

    if (r.enzyme) {
      const [mx, my] = midpoint(r.points);
      const dir = r.side === "left" ? -1 : 1;
      const tx = mx + dir * 14;
      const anchor = dir > 0 ? "start" : "end";
      const name = s("text", { class: "enz-name lod-normal", x: tx, y: my - 2, "text-anchor": anchor }, [r.enzymeName || r.enzyme]);
      name.addEventListener("click", (e) => { e.stopPropagation(); hooks.onEnzyme?.(r); });
      g.append(name);
      if (r.ec) g.append(s("text", { class: "enz-ec lod-detail", x: tx, y: my + 10, "text-anchor": anchor }, [`EC ${r.ec}`]));
      // cofactors enter/leave on a curved side-entry, Michal-style
      g.append(cofactorSide(r, mx, my, -dir));
    }
    layerFlux.append(g);
  }

  // ---------- regulation ----------
  for (const reg of ir.regulation) {
    const g = s("g", { class: "reg" });
    const pts = reg.points.map((p) => p.join(",")).join(" ");
    g.append(s("polyline", { class: `reg-line${reg.effect === "activate" ? " activate" : ""}`, points: pts }));
    const [ex, ey] = reg.points[reg.points.length - 1];
    const color = reg.effect === "activate" ? "#1a7f37" : "#c8102e";
    const glyph = s("g", { class: "reg-glyph" });
    glyph.append(s("circle", { cx: ex, cy: ey, r: 7, fill: "#fff", stroke: color, "stroke-width": 1.4 }));
    glyph.append(s("text", { x: ex, y: ey + 3.5, fill: color }, [reg.effect === "activate" ? "+" : "–"]));
    g.append(glyph);
    layerReg.append(g);
  }

  // ---------- metabolite cells ----------
  for (const n of ir.nodes) {
    const g = s("g", { class: "met-cell", "data-node": n.id, transform: `translate(${n.x},${n.y})` });
    g.append(s("text", { class: "met-name", x: n.w / 2, y: -22 }, [n.label.toUpperCase()]));
    // Only hub compounds (those appearing in several pathways) are boxed — the
    // box is a cross-reference marker in Michal's language, not decoration.
    if ((n as ChartNode & { hub?: boolean }).hub) {
      g.append(s("rect", { class: "met-box", x: 0, y: 0, width: n.w, height: n.h }));
    }
    if (n.formula) g.append(s("text", { class: "met-formula lod-normal", x: n.w / 2, y: -9 }, [n.formula]));
    if (!n.mol) {
      // No structure available — Michal boxes the bare name rather than leaving a void.
      g.append(s("rect", { class: "met-box name-only", x: 0, y: 0, width: n.w, height: n.h }));
      const words = n.label.toUpperCase().split(/\s+/);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > 16) { if (cur) lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
      }
      if (cur) lines.push(cur);
      const shown = lines.slice(0, 3);
      shown.forEach((ln, i) => g.append(s("text", {
        class: "met-nameonly", x: n.w / 2, y: n.h / 2 - (shown.length - 1) * 6 + i * 12 + 4,
      }, [ln])));
    }
    g.addEventListener("click", (e) => { e.stopPropagation(); hooks.onMetabolite?.(n); });
    layerNodes.append(g);
    nodeEls.set(n.id, g);
  }

  // ---------- pan / zoom ----------
  let k = 1, tx = 0, ty = 0;
  const apply = () => {
    viewport.setAttribute("transform", `translate(${tx},${ty}) scale(${k})`);
    const lod = k < LOD_NORMAL ? "overview" : k < LOD_DETAIL ? "normal" : "detail";
    if (svg.getAttribute("data-lod") !== lod) {
      svg.setAttribute("data-lod", lod);
    }
    // Map-style labels: region titles and grid letters hold a constant on-screen
    // size so the sheet stays navigable when zoomed all the way out.
    svg.style.setProperty("--title-size", `${Math.min(220, Math.max(14, 17 / k))}px`);
    svg.style.setProperty("--grid-size", `${Math.min(180, Math.max(12, 15 / k))}px`);
    declutterLabels(lod);
    scheduleLoad();
    hooks.onZoom?.(k, lod);
  };

  function fit() {
    const r = canvas.getBoundingClientRect();
    const pad = 40;
    k = Math.min((r.width - pad) / ir.bounds.w, (r.height - pad) / ir.bounds.h);
    tx = (r.width - ir.bounds.w * k) / 2 - ir.bounds.x * k;
    ty = (r.height - ir.bounds.h * k) / 2 - ir.bounds.y * k;
    apply();
  }

  function zoomBy(factor: number, cx?: number, cy?: number) {
    const r = canvas.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const nk = Math.min(6, Math.max(0.08, k * factor));
    // keep the point under the cursor fixed
    tx = px - ((px - tx) / k) * nk;
    ty = py - ((py - ty) / k) * nk;
    k = nk;
    apply();
  }

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lx = e.clientX; ly = e.clientY;
    canvas.classList.add("dragging");
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY;
    apply();
  });
  const endDrag = () => { dragging = false; canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /** Map-style label decluttering — the most important label in an area wins. */
  function declutterLabels(lod: string) {
    if (!regionLabels.length) return;
    // The CSS size is in chart units (17/k) so it renders at a constant ~17px on
    // screen; collision must therefore be measured with the SCREEN size.
    const chartFont = Math.min(220, Math.max(14, 17 / k));
    const fontPx = chartFont * k;
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...regionLabels].sort((a, b) => b.reg.w * b.reg.h - a.reg.w * a.reg.h);
    for (const item of ordered) {
      const text = lod === "overview" ? item.short : item.reg.title;
      const t = item.el.querySelector("text");
      if (t && t.textContent !== text) t.textContent = text;
      const sx = (item.reg.x - 30) * k + tx;
      const sy = (item.reg.y - 64) * k + ty;
      const w = text.length * fontPx * 0.55;
      const h = fontPx * 1.25;
      const box = { x: sx, y: sy - h * 0.8, w, h };
      const clash = boxes.some((b) =>
        !(box.x + box.w <= b.x || b.x + b.w <= box.x || box.y + box.h <= b.y || b.y + b.h <= box.y));
      item.el.style.display = clash ? "none" : "";
      if (!clash) boxes.push(box);
    }
  }

  let loadTimer = 0;
  function scheduleLoad() {
    if (loadTimer) return;
    loadTimer = requestAnimationFrame(() => { loadTimer = 0; loadVisibleStructures(); });
  }

  // ---------- lazy structures (viewport-culled; drawn at every zoom level) ----------
  async function loadVisibleStructures() {
    const r = canvas.getBoundingClientRect();
    for (const n of ir.nodes) {
      if (!n.mol) continue;
      const g = nodeEls.get(n.id);
      if (!g || g.querySelector("svg")) continue;
      const sx = n.x * k + tx, sy = n.y * k + ty;
      if (sx > r.width + 200 || sy > r.height + 200 || sx + n.w * k < -200 || sy + n.h * k < -200) continue;
      try {
        let text = molCache.get(n.mol);
        if (!text) {
          text = await (await fetch(`${base}mol/${n.mol}`)).text();
          molCache.set(n.mol, text);
        }
        if (g.querySelector("svg")) continue;
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        const root = doc.documentElement;
        const vb = root.getAttribute("viewBox") || `0 0 ${n.molSize?.w ?? 200} ${n.molSize?.h ?? 160}`;
        const inner = s("svg", { x: 4, y: 4, width: n.w - 8, height: n.h - 8, viewBox: vb, preserveAspectRatio: "xMidYMid meet", class: "mol-inline" });
        for (const child of Array.from(root.childNodes)) inner.append(child.cloneNode(true));
        g.append(inner);
      } catch { /* structure is an enhancement; never break the chart */ }
    }
  }

  // ---------- tracing ----------
  function trace(nodeId: string | null) {
    if (!nodeId) {
      svg.classList.remove("traced");
      svg.querySelectorAll(".dimmed,.trace-hit,.trace-hit-node").forEach((e) => e.classList.remove("dimmed", "trace-hit", "trace-hit-node"));
      return;
    }
    // walk the reaction graph both ways from this metabolite
    const keepNodes = new Set<string>([nodeId]);
    const keepRxn = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of ir.reactions) {
        if (keepRxn.has(r.id)) continue;
        if (keepNodes.has(r.from) || keepNodes.has(r.to)) {
          keepRxn.add(r.id);
          if (!keepNodes.has(r.from)) { keepNodes.add(r.from); grew = true; }
          if (!keepNodes.has(r.to)) { keepNodes.add(r.to); grew = true; }
        }
      }
    }
    svg.classList.add("traced");
    for (const [id, el] of nodeEls) el.classList.toggle("dimmed", !keepNodes.has(id));
    for (const { el, rxn } of edgeEls) {
      el.classList.toggle("dimmed", !keepRxn.has(rxn.id));
      el.classList.toggle("trace-hit", keepRxn.has(rxn.id));
    }
    nodeEls.get(nodeId)?.classList.add("trace-hit-node");
  }

  canvas.addEventListener("click", (e) => { if (e.target === svg || e.target === canvas) trace(null); });

  let sized = false;
  addEventListener("resize", () => { if (!sized) fit(); else apply(); }, { passive: true });
  fit();
  sized = true;

  /** Deep-linkable view: centre chart coords (cx,cy) at zoom k. */
  function setView(nk: number, cx?: number, cy?: number) {
    const r = canvas.getBoundingClientRect();
    k = Math.min(6, Math.max(0.08, nk));
    const targetX = cx ?? ir.bounds.x + ir.bounds.w / 2;
    const targetY = cy ?? ir.bounds.y + ir.bounds.h / 2;
    tx = r.width / 2 - targetX * k;
    ty = r.height / 2 - targetY * k;
    apply();
  }

  return { fit, zoomBy, trace, setView, get zoom() { return k; } };
}

function marker(id: string, color: string) {
  const m = s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  m.append(s("path", { d: "M0,0.5 L10,5 L0,9.5 L2.8,5 Z", fill: color }));
  return m;
}

function midpoint(points: [number, number][]): [number, number] {
  const a = points[0], b = points[points.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Michal's side-entry: cofactors swing in on a quarter arc across the reaction arrow. */
function cofactorSide(r: ChartRxn, mx: number, my: number, dir: number): SVGGElement {
  const g = s("g", { class: "cofactor lod-detail" });
  const R = 26;
  if (r.inLabels?.length) {
    g.append(s("path", { class: "cofactor-arc", d: `M ${mx + dir * R} ${my - R} Q ${mx + dir * R * 0.5} ${my - R * 0.2} ${mx} ${my - 2}`, "marker-end": "url(#arrow-reg)" }));
    g.append(s("text", { class: "cofactor-label", x: mx + dir * (R + 4), y: my - R - 2, "text-anchor": dir > 0 ? "start" : "end" }, [r.inLabels.join(" + ")]));
  }
  if (r.outLabels?.length) {
    g.append(s("path", { class: "cofactor-arc", d: `M ${mx} ${my + 2} Q ${mx + dir * R * 0.5} ${my + R * 0.2} ${mx + dir * R} ${my + R}`, "marker-end": "url(#arrow-reg)" }));
    g.append(s("text", { class: "cofactor-label", x: mx + dir * (R + 4), y: my + R + 10, "text-anchor": dir > 0 ? "start" : "end" }, [r.outLabels.join(" + ")]));
  }
  return g;
}

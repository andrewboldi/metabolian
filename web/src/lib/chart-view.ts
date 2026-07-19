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

/**
 * Fit an enzyme name into at most two lines of `maxChars`. Horizontal room is the
 * scarce axis on this sheet, vertical room usually is not — so wrap rather than
 * truncate. The trailing parenthesised gene symbol (AKR1C4, BAAT, MFE-2 …) is the
 * identifier you navigate by, so it is never the thing that gets cut.
 */
export function wrapEnzymeName(full: string, maxChars: number): string[] {
  if (full.length <= maxChars) return [full];
  const gene = full.match(/\s(\([^()]*\))\s*$/);
  const head = gene ? full.slice(0, gene.index) : full;
  const tail = gene ? gene[1] : "";
  // The whole name minus its gene symbol fits: park the symbol on line two.
  if (head.length <= maxChars && tail && tail.length <= maxChars) return [head, tail];

  const words = head.split(/\s+/);
  let l1 = "", i = 0;
  for (; i < words.length; i++) {
    const next = l1 ? `${l1} ${words[i]}` : words[i];
    if (next.length > maxChars) break;
    l1 = next;
  }
  let rest: string;
  if (!l1) { l1 = head.slice(0, maxChars); rest = head.slice(maxChars).trim(); }
  else rest = words.slice(i).join(" ");

  let l2 = tail ? (rest ? `${rest} ${tail}` : tail) : rest;
  if (l2.length > maxChars) {
    const room = Math.max(3, maxChars - (tail ? tail.length + 2 : 1));
    l2 = rest.slice(0, room).replace(/[\s(,\-]+$/, "") + "…" + (tail ? ` ${tail}` : "");
  }
  return l2 ? [l1, l2] : [l1];
}

/**
 * Wrap a metabolite name to the cell's real width. Chemical names contain single
 * tokens longer than any cell ("5-PHOSPHO-ALPHA-D-RIBOSE"), so word-only wrapping
 * let them run straight through the cell border; those are split at a hyphen where
 * possible. Overflow is ellipsised on the last line rather than dropped silently.
 */
export function wrapCellName(text: string, maxChars: number, maxLines = 2): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const w of text.split(/\s+/)) {
    if (w.length > maxChars) {
      flush();
      let rest = w;
      while (rest.length > maxChars && out.length < maxLines) {
        const hyphen = rest.lastIndexOf("-", maxChars);
        if (hyphen >= Math.floor(maxChars * 0.45)) {
          out.push(rest.slice(0, hyphen + 1));       // break after an existing hyphen
          rest = rest.slice(hyphen + 1);
        } else {
          // No usable hyphen: break mid-token but mark it, so the reader sees
          // "5-AMINOLEV-/ULINATE" as one hyphenated word, not two fragments.
          out.push(rest.slice(0, maxChars - 1) + "-");
          rest = rest.slice(maxChars - 1);
        }
      }
      cur = rest;
    } else if ((cur ? cur.length + 1 : 0) + w.length > maxChars) {
      flush();
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  flush();
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length > maxChars - 1 ? last.slice(0, Math.max(1, maxChars - 1)) + "…" : last + "…";
    return kept;
  }
  return out;
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
  // Cofactor captions live ABOVE the cells. As children of the reaction group in
  // layer-flux they painted below layer-nodes, so any cell's white-haloed name
  // knocked a side-entry out mid-word. The red arcs stay down in layer-flux with
  // the chemistry; only the text is lifted.
  const layerCofactor = s("g", { class: "layer-cofactor" });
  // Enzyme names paint after the regulation rails. As children of layer-flux they
  // were drawn BEFORE layer-reg, so a rail crossing a name painted straight over
  // it and the white knockout halo — the poster's own trick — could not protect
  // the glyphs. Above the rails, the halo breaks the line behind the text.
  const layerEnzLabels = s("g", { class: "layer-enz-labels" });
  // Region titles paint last: they are map furniture and must sit on top of the
  // chemistry (with their knockout halo), not be struck through by it.
  const layerLabels = s("g", { class: "layer-labels" });
  viewport.append(layerGrid, layerRegions, layerFlux, layerReg, layerNodes, layerCofactor, layerEnzLabels, layerLabels);
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
  // shared-compound ties: adjacent pathways flowing into one another
  for (const t of (master as any).ties || []) {
    const g = s("g", { class: "tie lod-normal" });
    g.append(s("polyline", { class: "tie-line", points: t.points.map((p: number[]) => p.join(",")).join(" ") }));
    const mid = t.points[Math.floor(t.points.length / 2)];
    g.append(s("text", { class: "tie-label", x: mid[0] + 5, y: mid[1] - 4 }, [t.label || t.metabolite]));
    layerRegions.append(g);
  }

  const anchorUse = new Map<string, number>();
  for (const c of (master as any).connectors || []) {
    // Several pathways can leave from the same metabolite; fan the stubs and
    // labels apart or they superimpose into unreadable garble.
    const key = `${Math.round(c.x)}:${Math.round(c.y)}`;
    const n = anchorUse.get(key) || 0;
    anchorUse.set(key, n + 1);
    const g = s("g", { class: "connector lod-normal" });
    const len = 54 + n * 26;
    const yOff = n * 15;
    const x2 = c.x + c.dir * len;
    const y = c.y + yOff;
    g.append(s("line", { class: "connector-line", x1: c.x, y1: c.y, x2, y2: y, "marker-end": "url(#arrow-flux)" }));
    g.append(s("text", {
      class: "connector-label", x: x2 + c.dir * 6, y: y - 4,
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
    layerRegions.append(g);
    layerLabels.append(label);
    regionLabels.push({ el: label, reg, short: reg.title.replace(/\s*\(.*$/, "") });
  }

  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const enzymeLabels: { name: SVGTextElement; ec: SVGTextElement | null; mx: number; my: number; full: string; shown: string }[] = [];
  // Cofactor captions were pinned to their arc geometry and registered only as
  // obstacles for OTHER labels — the one text class on the sheet that was never
  // itself moved. They are now deferred and placed against the same obstacle set.
  const cofactorLabels: CofactorLabel[] = [];
  // The text zone inside a cell — its name band, or the whole cell for a condensed
  // column. A caption landing here is text-on-text, the worst outcome on the sheet;
  // one landing on the structure area is merely text over a drawing, which reads.
  const nameBoxes: { x: number; y: number; w: number; h: number }[] = [];
  const nodeEls = new Map<string, SVGGElement>();
  const edgeEls: { el: SVGElement; rxn: ChartRxn }[] = [];
  const regGlyphs: { el: SVGGElement; x: number; y: number }[] = [];

  // ---------- flux reactions ----------
  for (const r of ir.reactions) {
    const g = s("g", { class: "rxn", "data-rxn": r.id });
    const cls = r.kind === "branch-link" ? "branch-line" : `flux-line${r.committed ? " committed" : ""}`;
    const isScaffold = r.kind === "branch-link";
    const line = s("polyline", {
      class: cls,
      points: r.points.map((p) => p.join(",")).join(" "),
      // A positional link is scaffolding, NOT a reaction — it gets no arrowhead
      // and a distinct hairline so it can never be misread as biochemistry.
      ...(isScaffold ? {} : { "marker-end": "url(#arrow-flux)" }),
      ...(!isScaffold && r.reversible ? { "marker-start": "url(#arrow-flux)" } : {}),
    });
    g.append(line);
    edgeEls.push({ el: line, rxn: r });

    if (r.enzyme) {
      const [mx, my] = midpoint(r.points);
      const dir = r.side === "left" ? -1 : 1;
      const tx = mx + dir * 14;
      const anchor = dir > 0 ? "start" : "end";
      const full = r.enzymeName || r.enzyme || "";
      // Case is semantic in chemical notation, so the blanket CSS uppercase is
      // switched off here and applied selectively by displayLabel().
      const shown = displayLabel(full);
      const name = s("text", {
        class: "enz-name lod-normal", x: tx, y: my - 2, "text-anchor": anchor,
        style: "text-transform:none",
      }, [shown]);
      name.append(s("title", {}, [full]));
      name.addEventListener("click", (e) => { e.stopPropagation(); hooks.onEnzyme?.(r); });
      layerEnzLabels.append(name);
      const ecEl = r.ec ? s("text", { class: "enz-ec lod-detail", x: tx, y: my + 10, "text-anchor": anchor }, [`EC ${r.ec}`]) : null;
      if (ecEl) layerEnzLabels.append(ecEl);
      // register with the anti-collision placer that runs once everything exists
      enzymeLabels.push({ name, ec: ecEl, mx, my, full, shown });
      // cofactors enter/leave on a curved side-entry, Michal-style. Only the arcs
      // are committed here; the captions are placed after the cells exist.
      const elen = r.points.reduce((acc, p, i) => i ? acc + Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]) : 0, 0);
      g.append(cofactorSide(r, -dir, elen, cofactorLabels));
      // Effectors with no clean corridor are tagged onto the step itself, the way
      // the poster annotates a regulated reaction in tight space.
      const tags = (r as ChartRxn & { tags?: { effect: string; label: string; x: number; y: number }[] }).tags;
      (tags || []).forEach((tag, ti) => {
        const color = tag.effect === "activate" ? "#13A950" : "#F14C1C";
        const ty = tag.y + 14 + ti * 12;
        const tg = s("g", { class: "eff-tag lod-detail" });
        tg.append(s("circle", { cx: tag.x - dir * 10, cy: ty - 3, r: 5, fill: "#fff", stroke: color, "stroke-width": 1.2 }));
        tg.append(s("text", { x: tag.x - dir * 10, y: ty, fill: color, class: "eff-glyph" }, [tag.effect === "activate" ? "+" : "–"]));
        tg.append(s("text", { x: tag.x - dir * 10 + 9, y: ty, fill: color, class: "eff-label" }, [tag.label]));
        g.append(tg);
      });
    }
    layerFlux.append(g);
  }

  // ---------- regulation ----------
  // A rail terminates ON the flux line it regulates, so a glyph pinned to the
  // terminus puts the black reaction arrow straight through the circle. Walk back
  // along the rail to the first spot that clears the chemistry; the stub that is
  // left over reads as the tick tying the glyph to its step. A fixed offset cannot
  // do this — a rail often runs alongside a flux line rather than into it.
  const fluxSegs: [number, number, number, number][] = [];
  for (const r of ir.reactions) {
    for (let i = 1; i < r.points.length; i++) {
      fluxSegs.push([r.points[i - 1][0], r.points[i - 1][1], r.points[i][0], r.points[i][1]]);
    }
  }
  const glyphClearance = (x: number, y: number) => {
    for (const n of ir.nodes) if (x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h) return 0;
    let d = Infinity;
    for (const seg of fluxSegs) {
      d = Math.min(d, distToSegment(x, y, seg[0], seg[1], seg[2], seg[3]));
      if (d < 1) break;
    }
    return d;
  };
  for (const reg of ir.regulation) {
    const g = s("g", { class: "reg" });
    const pts = reg.points.map((p) => p.join(",")).join(" ");
    g.append(s("polyline", { class: `reg-line${reg.effect === "activate" ? " activate" : ""}`, points: pts }));
    let ex = 0, ey = 0, clearest = -1;
    for (const back of [13, 18, 24, 31, 39, 48]) {
      const [x, y] = backAlongPath(reg.points as [number, number][], back);
      const clear = glyphClearance(x, y);
      if (clear > clearest) { clearest = clear; ex = x; ey = y; }
      if (clear >= 9) break;                  // the circle clears the ink entirely
    }
    const color = reg.effect === "activate" ? "#1a7f37" : "#c8102e";
    // Radius is zoom-compensated in apply(), the way --title-size is: a fixed
    // 7-unit circle renders at ~2.5px on a sheet that fits at 35%.
    const glyph = s("g", { class: "reg-glyph", transform: `translate(${ex},${ey})` });
    glyph.append(s("circle", { cx: 0, cy: 0, r: 7, fill: "#fff", stroke: color, "stroke-width": 1.4 }));
    glyph.append(s("text", { x: 0, y: 3.5, fill: color }, [reg.effect === "activate" ? "+" : "–"]));
    g.append(glyph);
    regGlyphs.push({ el: glyph, x: ex, y: ey });
    layerReg.append(g);
  }

  // ---------- metabolite cells ----------
  for (const n of ir.nodes) {
    const g = s("g", { class: "met-cell", "data-node": n.id, transform: `translate(${n.x},${n.y})` });
    // The cell frame is always present for hubs; the NAME now sits inside the cell,
    // so an incoming flux line terminating on the box edge can never cross it.
    const isProtein = (n as ChartNode & { isProtein?: boolean }).isProtein;
    if (isProtein) {
      g.append(s("rect", { class: "enz-box", x: 0, y: 18, width: n.w, height: 40, rx: 8 }));
    } else if (n.mol) {
      // One grammar for metabolite cells: every node that draws content is framed.
      // Framing only `hub` nodes split the sheet into boxed and bare nodes and
      // invited the reader to infer a distinction that does not exist — and bare
      // nodes gave incoming edges no bbox to clip against.
      g.append(s("rect", { class: "met-box", x: 0, y: 0, width: n.w, height: n.h }));
    } else {
      // A content-bearing cell keeps its frame at EVERY zoom level. Gating the
      // frame behind lod-normal made these cells render as literally nothing at
      // overview, so incoming arrowheads docked against blank paper.
      g.append(s("rect", { class: "met-box name-only", x: 0, y: 0, width: n.w, height: n.h }));
    }
    const name = displayLabel(n.label);
    // Wrap to the cell's own width (11px uppercase advances ~7px with tracking)
    // rather than a fixed character count, which overflowed narrow cells.
    const NAME_CH = 7;
    const nameChars = Math.max(6, Math.floor((n.w - 6) / NAME_CH));
    const shown = wrapCellName(name, nameChars, 2);
    shown.forEach((ln, i) => g.append(s("text", {
      class: (isProtein ? "prot-name" : "met-name") + " lod-normal",
      x: n.w / 2, y: (isProtein ? 34 : 12) + i * 11,
    }, [ln])));
    const top = 12 + shown.length * 11;
    // Michal's condensed column: stacked atom rows instead of a skeletal drawing.
    // Carries the same LOD class as the name so a condensed cell's contents appear
    // and disappear WITH its frame, never as unframed floating text.
    const cond = (n as ChartNode & { condensed?: string[] }).condensed;
    if (cond?.length) {
      cond.forEach((row, i) => g.append(s("text", {
        class: "cond-row lod-normal", x: n.w / 2, y: top + 12 + i * 13,
      }, [row])));
    }
    if (n.formula) g.append(s("text", { class: "met-formula lod-detail", x: n.w / 2, y: n.h - 4 }, [n.formula]));
    // a condensed cell is text all the way down; every other cell only at the top
    nameBoxes.push({ x: n.x, y: n.y, w: n.w, h: cond?.length ? n.h : top });
    g.setAttribute("data-structure-top", String(top));
    g.addEventListener("click", (e) => { e.stopPropagation(); hooks.onMetabolite?.(n); });
    layerNodes.append(g);
    nodeEls.set(n.id, g);
  }

  // ---------- label placement ----------
  // Labels must not cross a metabolite cell or another label. Try each candidate
  // placement around the reaction midpoint and take the first clear one. Enzyme
  // names go first (they identify the step); cofactor captions are then placed
  // against the SAME obstacle set, so the two classes are mutually aware instead
  // of one class routing around a fixed guess made by the other.
  (function placeLabels() {
    const FONT = 10, EC_H = 11, COF = 9;
    const cells = ir.nodes.map((n) => ({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 }));
    // Regulation rails and scaffolding hairlines are ink too — a label that lands
    // on one gets struck through at its baseline. Reserve a thin corridor along
    // every segment so names and EC numbers are placed clear of them.
    const railBoxes: { x: number; y: number; w: number; h: number }[] = [];
    const reserveRail = (pts: [number, number][] | undefined) => {
      for (let i = 1; i < (pts?.length ?? 0); i++) {
        const [x1, y1] = pts![i - 1], [x2, y2] = pts![i];
        railBoxes.push({
          x: Math.min(x1, x2) - 3, y: Math.min(y1, y2) - 3,
          w: Math.abs(x2 - x1) + 6, h: Math.abs(y2 - y1) + 6,
        });
      }
    };
    for (const g of ir.regulation || []) reserveRail(g.points as [number, number][]);
    for (const r of ir.reactions) if (r.kind === "branch-link") reserveRail(r.points as [number, number][]);
    // Rails are a SOFT obstacle: preferred-against, never disqualifying. Treating
    // them as hard blockers cleared the strike-throughs but demoted half the
    // labels to detail zoom, which hides content rather than fixing it.
    type Box = { x: number; y: number; w: number; h: number };
    const taken: Box[] = [];
    const hit = (b: Box, list: Box[]) =>
      list.some((o) => !(b.x + b.w <= o.x || o.x + o.w <= b.x || b.y + b.h <= o.y || o.y + o.h <= b.y));
    const overlap = (b: Box, list: Box[]) =>
      list.reduce((acc, o) => {
        const ox = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
        const oy = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
        return acc + (ox > 0 && oy > 0 ? ox * oy : 0);
      }, 0);

    // Real extents, not a guessed advance. .enz-name is text-transform:uppercase
    // Helvetica with .02em tracking and runs ~0.63em, not the 0.52em this placer
    // assumed — so every collision box and every measured channel used to be ~20%
    // narrower than its own ink and labels were committed into space they did not
    // fit. Measured once per string and cached.
    const measEnz = textMeasurer(svg, "enz-name", FONT * 0.63);
    const measCof = textMeasurer(svg, "cofactor-label", COF * 0.54);
    const SAMPLE = "DEHYDROGENASE SYNTHASE TRANSFERASE REDUCTASE KINASE";
    const CH = Math.max(4, measEnz.width(SAMPLE) / SAMPLE.length);   // mean glyph advance

    /**
     * How much room a label has before it runs into something, from x outward.
     * `up`/`down` are the label's real ink extent either side of the baseline: a
     * wrapped name's second line and its EC number occupy bands of their own, and
     * testing only the first line let them be placed straight through a cell.
     */
    const channel = (x: number, y: number, anchor: string, up: number, down: number) => {
      let limit = 320;
      const scan = (o: Box) => {
        if (y + down + 2 < o.y || y - up - 2 > o.y + o.h) return;   // not on this band
        if (anchor === "start" && o.x > x) limit = Math.min(limit, o.x - x - 5);
        else if (anchor === "end" && o.x + o.w < x) limit = Math.min(limit, x - (o.x + o.w) - 5);
        else if (anchor === "middle") {
          if (o.x > x) limit = Math.min(limit, (o.x - x - 5) * 2);
          else if (o.x + o.w < x) limit = Math.min(limit, (x - (o.x + o.w) - 5) * 2);
        }
      };
      for (const o of cells) scan(o);
      for (const o of taken) scan(o);
      return Math.max(0, limit);
    };

    for (const L of enzymeLabels) {
      const candidates = [
        { dx: 14, dy: -2, anchor: "start" }, { dx: -14, dy: -2, anchor: "end" },
        { dx: 14, dy: -18, anchor: "start" }, { dx: -14, dy: -18, anchor: "end" },
        { dx: 14, dy: 16, anchor: "start" }, { dx: -14, dy: 16, anchor: "end" },
        { dx: 0, dy: -22, anchor: "middle" }, { dx: 0, dy: 24, anchor: "middle" },
      ];
      // Pick the placement offering the widest clear channel, then truncate the
      // text TO THAT CHANNEL. Truncating to a fixed character budget is what let
      // long names overrun their neighbour regardless of where they were placed.
      let best: { c: typeof candidates[0]; avail: number } | null = null;
      for (const c of candidates) {
        const avail = channel(L.mx + c.dx, L.my + c.dy, c.anchor, FONT, 0);
        if (!best || avail > best.avail) best = { c, avail };
      }
      const chosen = best!.c;
      const budget = (avail: number) => {
        // Below ~12 characters even a wrapped name degrades into a fragment like
        // "Delta4- / 3-o… (AKR1D1)". A label that only appears on zoom is more
        // honest than a mangled one, so lay it out comfortably and defer it.
        const roomChars = Math.floor(avail / CH);
        return { cramped: roomChars < 12, maxChars: roomChars < 12 ? 30 : Math.max(3, roomChars) };
      };
      // Wrap to the measured channel instead of truncating to it: the gene symbol
      // stays on the sheet, which is what makes a step identifiable in print.
      let { cramped, maxChars } = budget(best!.avail);
      let lines = wrapEnzymeName(L.shown, maxChars);
      // The first pass sized the channel as if the label were one line. A wrapped
      // name plus an EC number occupies a much deeper band, which can run into an
      // obstacle the single-line test never saw — re-measure against the real band.
      const below = () => FONT * (lines.length - 1) + (L.ec ? EC_H : 0);
      if (below() > 0) {
        const avail2 = channel(L.mx + chosen.dx, L.my + chosen.dy, chosen.anchor, FONT, below());
        if (avail2 < best!.avail) {
          ({ cramped, maxChars } = budget(avail2));
          lines = wrapEnzymeName(L.shown, maxChars);
        }
      }
      // setting textContent would drop the <title> child that carries the full
      // name on hover — rebuild the node explicitly
      L.name.replaceChildren(
        ...lines.map((ln, i) => s("tspan", { dy: i === 0 ? 0 : FONT }, [ln])),
        s("title", {}, [L.full]),
      );
      if (L.ec) L.ec.classList.add("lod-detail");
      const w = Math.max(...lines.map((l) => measEnz.width(l)));
      const h = FONT * lines.length + (L.ec ? EC_H : 0);

      const commit = (c: { dx: number; dy: number; anchor: string }, x: number, y: number) => {
        L.name.setAttribute("x", String(x));
        L.name.setAttribute("y", String(y));
        L.name.setAttribute("text-anchor", c.anchor);
        // each wrapped line re-anchors at the label's x, or tspans stagger
        for (const ts of Array.from(L.name.querySelectorAll("tspan"))) ts.setAttribute("x", String(x));
        if (L.ec) {
          L.ec.setAttribute("x", String(x));
          L.ec.setAttribute("y", String(y + EC_H + (lines.length - 1) * FONT));
          L.ec.setAttribute("text-anchor", c.anchor);
        }
      };

      let placed = false;
      if (cramped) {
        L.name.classList.remove("lod-normal");
        L.name.classList.add("lod-detail");
      }
      type Spot = { c: typeof candidates[0]; x: number; y: number; box: typeof taken[0]; ovl: number };
      let onRail: Spot | null = null;   // clear of real obstacles, but crosses a rail
      let fallback: Spot | null = null; // nothing is clear — least-bad
      for (const c of [chosen, ...candidates]) {
        const x = L.mx + c.dx, y = L.my + c.dy;
        const bx = c.anchor === "start" ? x : c.anchor === "end" ? x - w : x - w / 2;
        const box = { x: bx, y: y - FONT, w, h };
        const spot: Spot = { c, x, y, box, ovl: overlap(box, cells) + overlap(box, taken) };
        if (!hit(box, cells) && !hit(box, taken)) {
          if (!hit(box, railBoxes)) {         // best: clear of ink entirely
            commit(c, x, y);
            taken.push(box);
            placed = true;
            break;
          }
          if (!onRail || spot.ovl < onRail.ovl) onRail = spot;
        }
        if (!fallback || spot.ovl < fallback.ovl) fallback = spot;
      }
      // Clear of cells and other labels but sitting on a rail: still show it at
      // normal zoom — a rail crossing is far less costly than a hidden enzyme.
      if (!placed && onRail) {
        commit(onRail.c, onRail.x, onRail.y);
        taken.push(onRail.box);
        placed = true;
      }
      // Nowhere clear: hold it back to detail zoom, but still park it at the
      // LEAST-colliding candidate and reserve that space. Leaving it at the
      // reaction midpoint is what made labels pile into runs like
      // "pyBUTYRATE KINASE)N OXIDOREDUCTASE" once detail LOD revealed them all.
      if (!placed) {
        L.name.classList.remove("lod-normal");
        L.name.classList.add("lod-detail");
        if (fallback) { commit(fallback.c, fallback.x, fallback.y); taken.push(fallback.box); }
      }
    }

    // ---------- cofactor captions ----------
    // Same candidate-and-commit treatment the enzyme names get. The caption walks
    // outward along its own arc and, failing that, flips to the far side of the
    // step; the arc's outer end is rebuilt from whichever candidate wins, so the
    // caption and the arc it belongs to can never come apart.
    const b = ir.bounds;
    for (const L of cofactorLabels) {
      // A multi-species entry used to be one ' + ' run that shot off across the
      // sheet. Stack it instead — the poster writes side entries as a column. A
      // single species with no short form ("Enzyme N6-(dihydrolipoyl)lysine …")
      // still overruns the widest cell on the sheet, so wrap that too rather than
      // hand the placer a box nowhere can hold.
      // No side-entry may be wider than a cell — that is the sheet's own grammar,
      // and measured over the atlas it is also where caption-on-name collisions
      // bottom out (19, against 21 for an unbounded run 224 units wide).
      const CAP = 120;
      const wrapToWidth = (text: string): string[] => {
        if (measCof.width(text) <= CAP) return [text];
        const out: string[] = [];
        let cur = "";
        for (const word of text.split(/\s+/)) {
          const next = cur ? `${cur} ${word}` : word;
          if (cur && measCof.width(next) > CAP) { out.push(cur); cur = word; } else cur = next;
        }
        if (cur) out.push(cur);
        return out;
      };
      const joined = L.species.join(" + ");
      const lines = (measCof.width(joined) <= CAP ? [joined] : L.species).flatMap(wrapToWidth);
      L.text.replaceChildren(...lines.map((t, i) => s("tspan", { dy: i === 0 ? 0 : COF + 1 }, [t])));
      const w = Math.max(...lines.map((t) => measCof.width(t)));
      const h = COF * lines.length + 2;

      // Sliding the entry ALONG its own step is the move that actually frees space
      // on a crowded sheet — and it is the poster's own habit: a substrate joins
      // upstream of the midpoint, a product leaves downstream of it.
      const fracs = L.side === "in" ? [0.34, 0.5, 0.22, 0.62, 0.14] : [0.66, 0.5, 0.78, 0.38, 0.86];
      type Spot = { mx: number; my: number; d: number; rx: number; ry: number; anchor: string; x: number; y: number; box: Box; cost: number };
      let best: Spot | null = null;
      outer:
      for (const frac of fracs) {
        const [mx, my] = pointAlong(L.points, frac);
        for (const d of [L.dir, -L.dir]) {
          for (const grow of [0, 12, 26, 44]) {
            const rx = L.rx + grow;
            // reaching further out also lifts the entry clear of the line, as far
            // as the step's own length allows
            const ry = Math.min(L.ryMax, L.ry + grow * 0.45);
            // an "in" entry stacks UPWARD so its last line sits beside the arc
            const ax = mx + d * (rx + 4);
            const ay = L.side === "in" ? my - ry - 2 - COF * (lines.length - 1) : my + ry + 10;
            const rawX = d > 0 ? ax : ax - w;
            const rawY = ay - COF;
            // nothing may be drawn off the sheet
            const cx = Math.min(Math.max(rawX, b.x + 2), Math.max(b.x + 2, b.x + b.w - w - 2));
            const cy = Math.min(Math.max(rawY, b.y + 2), Math.max(b.y + 2, b.y + b.h - h - 2));
            const box = { x: cx, y: cy, w, h };
            // Text on text is the worst outcome on this sheet — worse than text
            // over a structure, which still reads. Price it accordingly so a
            // caption with nowhere clean to go sits over a drawing, not a name.
            const cost = overlap(box, cells) + (overlap(box, taken) + overlap(box, nameBoxes)) * 4
              + (hit(box, railBoxes) ? 60 : 0);
            const spot: Spot = {
              mx, my, d, rx, ry, anchor: d > 0 ? "start" : "end",
              x: ax + (cx - rawX), y: ay + (cy - rawY), box, cost,
            };
            if (!best || spot.cost < best.cost) best = spot;
            if (!cost) break outer;
          }
        }
      }
      const c = best!;
      L.text.setAttribute("x", String(c.x));
      L.text.setAttribute("y", String(c.y));
      L.text.setAttribute("text-anchor", c.anchor);
      for (const ts of Array.from(L.text.querySelectorAll("tspan"))) ts.setAttribute("x", String(c.x));
      // the arc follows the caption, so the two can never come apart
      L.arc.setAttribute("d", cofactorArc(c.mx, c.my, c.d, c.rx, c.ry, L.side));
      taken.push(c.box);
      layerCofactor.append(L.text);
    }

    measEnz.done();
    measCof.done();
  })();

  // ---------- pan / zoom ----------
  let k = 1, tx = 0, ty = 0;
  // Has the reader taken ownership of the framing (zoomed, panned or deep-linked)?
  // While false the chart is free to reframe itself when the canvas resizes.
  let userAdjusted = false;
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
    // A regulation glyph is a legend key, not chemistry drawn to scale: hold it at
    // a readable size instead of letting a 7-unit circle shrink to ~2.5px on a
    // sheet that fits at 35%.
    const gs = Math.min(8, Math.max(1, 6 / (7 * k)));
    for (const gl of regGlyphs) gl.el.setAttribute("transform", `translate(${gl.x},${gl.y}) scale(${gs})`);
    declutterLabels(lod);
    scheduleLoad();
    hooks.onZoom?.(k, lod);
  };

  /** The clear area fit() frames into: the canvas minus the floating HUD and help bar. */
  function clearArea() {
    const r = canvas.getBoundingClientRect();
    const insetTop = 108, insetBottom = 72, insetX = 32;
    return {
      x: insetX, y: insetTop,
      w: Math.max(120, r.width - insetX * 2),
      h: Math.max(120, r.height - insetTop - insetBottom),
    };
  }

  /**
   * Keep the sheet reconciled with the clear area after a zoom or a deep link.
   * Only fit() ever consulted ir.bounds, so any subsequent zoom could leave a wide
   * dead band on one edge while clipping content off the opposite one. When the
   * scaled sheet is larger than the clear area it must cover it (no dead band);
   * when it is smaller it must sit fully inside it (it cannot be pushed off).
   */
  function clampView() {
    const a = clearArea();
    const clampAxis = (pos: number, size: number, min: number, extent: number) => {
      const lo = Math.min(min, min + extent - size), hi = Math.max(min, min + extent - size);
      return Math.min(hi, Math.max(lo, pos));
    };
    const cw = ir.bounds.w * k, ch = ir.bounds.h * k;
    const left = ir.bounds.x * k + tx, top = ir.bounds.y * k + ty;
    tx += clampAxis(left, cw, a.x, a.w) - left;
    ty += clampAxis(top, ch, a.y, a.h) - top;
  }

  function fit() {
    const a = clearArea();
    k = Math.min(a.w / ir.bounds.w, a.h / ir.bounds.h);
    tx = a.x + (a.w - ir.bounds.w * k) / 2 - ir.bounds.x * k;
    ty = a.y + (a.h - ir.bounds.h * k) / 2 - ir.bounds.y * k;
    // A fresh fit is the framing the chart wants; stop treating the view as
    // user-owned so a later resize is free to reframe it.
    userAdjusted = false;
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
    userAdjusted = true;
    clampView();
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
    userAdjusted = true;
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
    // Breathing room, so a near-miss doesn't read as a collision, and a hard clamp
    // to the sheet frame so no title hangs off the edge of the chart.
    const PAD_X = 10, PAD_Y = 5;
    // Keep titles out of the coordinate-ruler gutter as well as inside the frame,
    // or the top row of titles prints straight over the A–L letters.
    const GUTTER = 46;
    const bounds = ir.bounds;
    const frameL = (bounds.x + GUTTER) * k + tx;
    const frameR = (bounds.x + bounds.w - GUTTER) * k + tx;
    const frameT = (bounds.y + GUTTER) * k + ty;
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...regionLabels].sort((a, b) => b.reg.w * b.reg.h - a.reg.w * a.reg.h);
    for (const item of ordered) {
      const text = lod === "overview" ? item.short : item.reg.title;
      const t = item.el.querySelector("text");
      if (t && t.textContent !== text) t.textContent = text;
      const w = text.length * fontPx * 0.55;
      const h = fontPx * 1.25;
      const sx = (item.reg.x - 30) * k + tx;
      const sy = (item.reg.y - 64) * k + ty;
      let dx = 0, dy = 0;
      if (sx + w > frameR) dx = frameR - (sx + w);
      if (sx + dx < frameL) dx = frameL - sx;
      const top = sy - h * 0.8;
      if (top + dy < frameT) dy = frameT - top;
      const box = { x: sx + dx - PAD_X, y: top + dy - PAD_Y, w: w + PAD_X * 2, h: h + PAD_Y * 2 };
      const clash = boxes.some((b) =>
        !(box.x + box.w <= b.x || b.x + b.w <= box.x || box.y + box.h <= b.y || b.y + b.h <= box.y));
      item.el.style.display = clash ? "none" : "";
      if (!clash && (dx || dy)) item.el.setAttribute("transform", `translate(${dx / k},${dy / k})`);
      else item.el.removeAttribute("transform");
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
    const pending: { n: ChartNode; g: SVGGElement }[] = [];
    for (const n of ir.nodes) {
      if (!n.mol) continue;
      const g = nodeEls.get(n.id);
      if (!g || g.querySelector("svg")) continue;
      const sx = n.x * k + tx, sy = n.y * k + ty;
      if (sx > r.width + 200 || sy > r.height + 200 || sx + n.w * k < -200 || sy + n.h * k < -200) continue;
      pending.push({ n, g });
    }
    if (!pending.length) return;

    // Fetch every missing depiction as ONE parallel batch. These used to be
    // awaited inside the loop, so a 13-structure sheet paid 13 serial network
    // round-trips and cells sat empty for ~45s before hydrating.
    const missing = [...new Set(pending.map((p) => p.n.mol!).filter((m) => !molCache.has(m)))];
    await Promise.all(missing.map(async (mol) => {
      try { molCache.set(mol, await (await fetch(`${base}mol/${mol}`)).text()); } catch { /* enhancement only */ }
    }));

    for (const { n, g } of pending) {
      try {
        const text = molCache.get(n.mol!);
        if (!text) continue;
        if (g.querySelector("svg")) continue;
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        const root = doc.documentElement;
        // prefer the precomputed ink box so the cell shows the molecule, not padding
        const vb = (n as ChartNode & { molView?: string }).molView
          || root.getAttribute("viewBox") || `0 0 ${n.molSize?.w ?? 200} ${n.molSize?.h ?? 160}`;
        const top = Number(g.getAttribute("data-structure-top") || 16);
        const inner = s("svg", { x: 4, y: top, width: n.w - 8, height: n.h - top - 12, viewBox: vb, preserveAspectRatio: "xMidYMid meet", class: "mol-inline" });
        // RDKit paints its canvas with a full-bleed opaque white rect before the
        // bonds. Cloned in, it knocks out everything already drawn under the cell —
        // and because the inner <svg> clips to its own viewport, it wipes the whole
        // cell interior, taking the red cofactor arcs with it. Drop the backdrop and
        // keep only the ink; the sheet is white paper anyway.
        const srcW = Number(root.getAttribute("width")?.replace(/px$/, "")) || n.molSize?.w || 0;
        const srcH = Number(root.getAttribute("height")?.replace(/px$/, "")) || n.molSize?.h || 0;
        for (const child of Array.from(root.childNodes)) {
          if (isBackdropRect(child, srcW, srcH)) continue;
          inner.append(child.cloneNode(true));
        }
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

  // Reframe on resize. The old `let sized = false; …; fit(); sized = true;` set the
  // flag synchronously on the next line, so the `!sized` branch was unreachable from
  // any real resize event and the chart only ever rescaled a stale k. A
  // ResizeObserver also catches the cases `resize` misses entirely — the inspector
  // opening, a CSS layout change — and is debounced to one frame.
  let refitPending = 0;
  const onResize = () => {
    if (refitPending) return;
    refitPending = requestAnimationFrame(() => {
      refitPending = 0;
      // Only reframe while the view is still the chart's own. Once the reader has
      // zoomed or panned, keep their framing and merely reconcile it.
      if (userAdjusted) { clampView(); apply(); } else fit();
    });
  };
  new ResizeObserver(onResize).observe(canvas);
  fit();

  /** Deep-linkable view: centre chart coords (cx,cy) at zoom k. */
  function setView(nk: number, cx?: number, cy?: number) {
    const a = clearArea();
    k = Math.min(6, Math.max(0.08, nk));
    const targetX = cx ?? ir.bounds.x + ir.bounds.w / 2;
    const targetY = cy ?? ir.bounds.y + ir.bounds.h / 2;
    // centre in the CLEAR area, not the raw rect — the HUD and help bar float over it
    tx = a.x + a.w / 2 - targetX * k;
    ty = a.y + a.h / 2 - targetY * k;
    // A deep link is a framing request, not a licence to strand the sheet off-screen:
    // reconcile it against the bounds the same way a zoom is reconciled.
    userAdjusted = true;
    clampView();
    apply();
  }

  return { fit, zoomBy, trace, setView, get zoom() { return k; } };
}

function marker(id: string, color: string) {
  const m = s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  m.append(s("path", { d: "M0,0.5 L10,5 L0,9.5 L2.8,5 Z", fill: color }));
  return m;
}

/**
 * RDKit's opaque full-canvas backdrop: `<rect fill:#FFFFFF width=<canvas> x=0 y=0>`,
 * emitted before every depiction. Structures themselves are paths and text, so a
 * white rect covering the whole source canvas is never chemistry — but a small
 * white rect might be (a knockout behind an atom label), hence the coverage test
 * rather than a blanket "drop every white rect".
 */
function isBackdropRect(node: Node, srcW: number, srcH: number): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  if (el.tagName.toLowerCase() !== "rect") return false;
  const style = (el.getAttribute("style") || "").toLowerCase();
  const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/.exec(style)?.[1]?.trim();
  const fill = (styleFill || el.getAttribute("fill") || "").trim().toLowerCase();
  if (fill !== "#ffffff" && fill !== "#fff" && fill !== "white") return false;
  const num = (a: string) => Number(el.getAttribute(a)) || 0;
  if (num("x") > 1 || num("y") > 1) return false;
  // covers (essentially) the whole source canvas
  return srcW > 0 && srcH > 0 && num("width") >= srcW * 0.98 && num("height") >= srcH * 0.98;
}

/** The point `frac` of the way along a polyline, so labels sit ON detoured routes. */
function pointAlong(points: [number, number][], frac: number): [number, number] {
  if (points.length < 2) return points[0] || [0, 0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d); total += d;
  }
  const target = total * frac;
  let walked = 0;
  for (let i = 0; i < seg.length; i++) {
    if (walked + seg[i] >= target) {
      const t = seg[i] ? (target - walked) / seg[i] : 0;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    walked += seg[i];
  }
  return points[points.length - 1];
}

/** True midpoint measured along the polyline. */
function midpoint(points: [number, number][]): [number, number] {
  return pointAlong(points, 0.5);
}

interface CofactorLabel {
  text: SVGTextElement; arc: SVGPathElement;
  points: [number, number][]; dir: number; rx: number; ry: number; ryMax: number;
  side: "in" | "out"; species: string[];
}

/** The quarter arc a side-entry swings in on, as a function of the side it takes. */
function cofactorArc(mx: number, my: number, dir: number, rx: number, ry: number, side: "in" | "out"): string {
  return side === "in"
    ? `M ${mx + dir * rx} ${my - ry} Q ${mx + dir * rx * 0.5} ${my - ry * 0.2} ${mx} ${my - 2}`
    : `M ${mx} ${my + 2} Q ${mx + dir * rx * 0.5} ${my + ry * 0.2} ${mx + dir * rx} ${my + ry}`;
}

/**
 * Michal's side-entry: cofactors swing in on a quarter arc across the reaction
 * arrow. Only the ARCS are committed here — they belong down in the flux layer
 * with the chemistry. The captions are handed to the placer, which decides the
 * side and reach and then rebuilds the arc to match.
 */
function cofactorSide(r: ChartRxn, dir: number, edgeLen: number, out: CofactorLabel[]): SVGGElement {
  const g = s("g", { class: "cofactor lod-detail" });
  const points = r.points as [number, number][];
  const [mx, my] = midpoint(points);
  const rx = Math.max(12, Math.min(26, edgeLen * 0.22));
  // The arc may never reach further ALONG the step than the step is long, or the
  // caption is parked past its own arrowhead on a short link. That ceiling is what
  // the placer is allowed to spend when it needs to escape upward or downward.
  const ry = Math.max(8, Math.min(rx, edgeLen / 2 - 8));
  const ryMax = Math.max(ry, Math.min(ry * 2.2, edgeLen / 2 - 8));
  const add = (species: string[], side: "in" | "out") => {
    const arc = s("path", { class: "cofactor-arc", d: cofactorArc(mx, my, dir, rx, ry, side), "marker-end": "url(#arrow-reg)" });
    g.append(arc);
    out.push({ text: s("text", { class: "cofactor-label lod-detail" }), arc, points, dir, rx, ry, ryMax, side, species });
  };
  if (r.inLabels?.length) add(r.inLabels, "in");
  if (r.outLabels?.length) add(r.outLabels, "out");
  return g;
}

/** Perpendicular distance from a point to a line segment. */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/** The point `dist` back along a polyline from its end, clamped to half its length. */
function backAlongPath(points: [number, number][], dist: number): [number, number] {
  const end = points[points.length - 1];
  if (points.length < 2) return end;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let left = Math.min(dist, total / 2);
  for (let i = points.length - 1; i > 0; i--) {
    const [x2, y2] = points[i], [x1, y1] = points[i - 1];
    const seg = Math.hypot(x2 - x1, y2 - y1);
    if (seg >= left) {
      const t = seg ? left / seg : 0;
      return [x2 + (x1 - x2) * t, y2 + (y1 - y2) * t];
    }
    left -= seg;
  }
  return points[0];
}

/**
 * Real text extents, cached per string. Every collision box on this sheet used to
 * be sized from a guessed mean advance, which is how labels got committed into
 * space they did not fit. Falls back to the guess when the platform cannot measure
 * (headless, or the SVG is not laid out yet) so layout still happens, just coarser.
 */
function textMeasurer(svg: SVGSVGElement, cls: string, fallbackCh: number) {
  const probe = s("text", {
    class: cls, x: -9999, y: -9999,
    style: "visibility:hidden;text-transform:none;pointer-events:none",
  });
  svg.append(probe);
  const cache = new Map<string, number>();
  return {
    width(str: string): number {
      if (!str) return 0;
      const seen = cache.get(str);
      if (seen !== undefined) return seen;
      let w = 0;
      try { probe.textContent = str; w = probe.getComputedTextLength(); } catch { w = 0; }
      if (!(w > 0)) w = str.length * fallbackCh;
      cache.set(str, w);
      return w;
    },
    done() { probe.remove(); },
  };
}

// Case is semantic in chemical notation and a blanket toUpperCase() destroys it:
// Pb is lead but PB is nothing, CoA is coenzyme A but COA is not, and the d in
// dTMP, the c in cAMP and the n in n-butyrate ARE part of the compound's identity.
// Michal still sets names in caps, so we still uppercase — only the runs where
// case carries no meaning.
const ELEMENT_SYMBOLS = new Set([
  "Ag", "Al", "Ba", "Br", "Ca", "Cd", "Cl", "Co", "Cr", "Cu", "Fe", "Hg", "Li",
  "Mg", "Mn", "Mo", "Na", "Ni", "Pb", "Pt", "Se", "Si", "Sn", "Sr", "Ti", "Zn",
]);
// stereo descriptors and locant prefixes, which are lower case by convention
const LOWER_DESCRIPTORS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "omega", "cis", "trans",
  "myo", "scyllo", "sn", "tert", "ortho", "erythro", "threo",
]);

/** Uppercase a label the way the poster does, without mangling its chemistry. */
export function displayLabel(text: string): string {
  return text.replace(/[A-Za-z]+/g, (run) => {
    if (ELEMENT_SYMBOLS.has(run)) return run;
    if (LOWER_DESCRIPTORS.has(run.toLowerCase())) return run.toLowerCase();
    // a single lower-case letter is a locant, not a word: n-butyrate is normal
    // butyrate, N-butyrate would be nitrogen-substituted
    if (run.length === 1 && run === run.toLowerCase()) return run;
    // a capital following a lower-case letter is deliberate abbreviation casing
    // (CoA, dTMP, cAMP, mRNA, pH) — the source has already made that call
    if (/[a-z][A-Z]/.test(run)) return run;
    return run.toUpperCase();
  });
}

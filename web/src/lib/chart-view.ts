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
  // Enzyme names paint after the regulation rails. As children of layer-flux they
  // were drawn BEFORE layer-reg, so a rail crossing a name painted straight over
  // it and the white knockout halo — the poster's own trick — could not protect
  // the glyphs. Above the rails, the halo breaks the line behind the text.
  const layerEnzLabels = s("g", { class: "layer-enz-labels" });
  // Region titles paint last: they are map furniture and must sit on top of the
  // chemistry (with their knockout halo), not be struck through by it.
  const layerLabels = s("g", { class: "layer-labels" });
  viewport.append(layerGrid, layerRegions, layerFlux, layerReg, layerNodes, layerEnzLabels, layerLabels);
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
  const enzymeLabels: { name: SVGTextElement; ec: SVGTextElement | null; mx: number; my: number; chars: number; full: string }[] = [];
  // cofactor labels are fixed to their arc geometry, so they act as obstacles
  // that enzyme names must route around rather than being moved themselves
  const cofactorBoxes: { x: number; y: number; w: number; h: number }[] = [];
  const nodeEls = new Map<string, SVGGElement>();
  const edgeEls: { el: SVGElement; rxn: ChartRxn }[] = [];

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
      const shownName = full.length > 34 ? full.slice(0, 32).replace(/[\s(,-]+$/, "") + "…" : full;
      const name = s("text", { class: "enz-name lod-normal", x: tx, y: my - 2, "text-anchor": anchor }, [shownName]);
      name.append(s("title", {}, [full]));
      name.addEventListener("click", (e) => { e.stopPropagation(); hooks.onEnzyme?.(r); });
      layerEnzLabels.append(name);
      const ecEl = r.ec ? s("text", { class: "enz-ec lod-detail", x: tx, y: my + 10, "text-anchor": anchor }, [`EC ${r.ec}`]) : null;
      if (ecEl) layerEnzLabels.append(ecEl);
      // register with the anti-collision placer that runs once everything exists
      enzymeLabels.push({ name, ec: ecEl, mx, my, chars: shownName.length, full });
      // cofactors enter/leave on a curved side-entry, Michal-style
      const elen = r.points.reduce((acc, p, i) => i ? acc + Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]) : 0, 0);
      const cof = cofactorSide(r, mx, my, -dir, elen);
      g.append(cof);
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
      for (const t of Array.from(cof.querySelectorAll("text"))) {
        const lx = Number(t.getAttribute("x")), ly = Number(t.getAttribute("y"));
        const w = (t.textContent || "").length * 4.5;
        cofactorBoxes.push({ x: t.getAttribute("text-anchor") === "end" ? lx - w : lx, y: ly - 9, w, h: 11 });
      }
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
      // no structure to draw — this box exists only to hold the name, so it must
      // appear and vanish WITH the name instead of leaving a hollow rectangle
      g.append(s("rect", { class: "met-box name-only lod-normal", x: 0, y: 0, width: n.w, height: n.h }));
    }
    const name = n.label.toUpperCase();
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
    // Michal's condensed column: stacked atom rows instead of a skeletal drawing
    const cond = (n as ChartNode & { condensed?: string[] }).condensed;
    if (cond?.length) {
      cond.forEach((row, i) => g.append(s("text", {
        class: "cond-row", x: n.w / 2, y: top + 12 + i * 13,
      }, [row])));
    }
    if (n.formula) g.append(s("text", { class: "met-formula lod-detail", x: n.w / 2, y: n.h - 4 }, [n.formula]));
    g.setAttribute("data-structure-top", String(top));
    g.addEventListener("click", (e) => { e.stopPropagation(); hooks.onMetabolite?.(n); });
    layerNodes.append(g);
    nodeEls.set(n.id, g);
  }

  // ---------- enzyme label placement ----------
  // Labels must not cross a metabolite cell or another label. Try each candidate
  // placement around the reaction midpoint and take the first clear one.
  (function placeEnzymeLabels() {
    const FONT = 10, EC_H = 11;
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
    const taken: { x: number; y: number; w: number; h: number }[] = [...cofactorBoxes];
    const hit = (b: { x: number; y: number; w: number; h: number }, list: typeof taken) =>
      list.some((o) => !(b.x + b.w <= o.x || o.x + o.w <= b.x || b.y + b.h <= o.y || o.y + o.h <= b.y));

    const CH = FONT * 0.52;               // mean glyph advance
    /** How much room a label has before it runs into something, from x outward. */
    const channel = (x: number, y: number, anchor: string) => {
      let limit = 320;
      for (const o of [...cells, ...taken]) {
        if (y + 2 < o.y || y - FONT - 2 > o.y + o.h) continue;   // not on this band
        if (anchor === "start" && o.x > x) limit = Math.min(limit, o.x - x - 5);
        else if (anchor === "end" && o.x + o.w < x) limit = Math.min(limit, x - (o.x + o.w) - 5);
        else if (anchor === "middle") {
          if (o.x > x) limit = Math.min(limit, (o.x - x - 5) * 2);
          else if (o.x + o.w < x) limit = Math.min(limit, (x - (o.x + o.w) - 5) * 2);
        }
      }
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
        const avail = channel(L.mx + c.dx, L.my + c.dy, c.anchor);
        if (!best || avail > best.avail) best = { c, avail };
      }
      const chosen = best!.c;
      const roomChars = Math.floor(best!.avail / CH);
      // Below ~12 characters even a wrapped name degrades into a fragment like
      // "Delta4- / 3-o… (AKR1D1)". A label that only appears on zoom is more
      // honest than a mangled one, so lay it out comfortably and defer it.
      const cramped = roomChars < 12;
      const maxChars = cramped ? 30 : Math.max(3, roomChars);
      // Wrap to the measured channel instead of truncating to it: the gene symbol
      // stays on the sheet, which is what makes a step identifiable in print.
      const lines = wrapEnzymeName(L.full, maxChars);
      // setting textContent would drop the <title> child that carries the full
      // name on hover — rebuild the node explicitly
      L.name.replaceChildren(
        ...lines.map((ln, i) => s("tspan", { dy: i === 0 ? 0 : FONT }, [ln])),
        s("title", {}, [L.full]),
      );
      if (L.ec) L.ec.classList.add("lod-detail");
      const w = Math.max(...lines.map((l) => l.length)) * CH;
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
      const overlap = (b: { x: number; y: number; w: number; h: number }, list: typeof taken) =>
        list.reduce((acc, o) => {
          const ox = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
          const oy = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
          return acc + (ox > 0 && oy > 0 ? ox * oy : 0);
        }, 0);

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
  })();

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
    // The HUD and help bar float over the canvas — fit into the clear area, not
    // the raw rect, or the top and bottom of the drawing hide under them.
    const insetTop = 108, insetBottom = 72, insetX = 32;
    const availW = Math.max(120, r.width - insetX * 2);
    const availH = Math.max(120, r.height - insetTop - insetBottom);
    k = Math.min(availW / ir.bounds.w, availH / ir.bounds.h);
    tx = insetX + (availW - ir.bounds.w * k) / 2 - ir.bounds.x * k;
    ty = insetTop + (availH - ir.bounds.h * k) / 2 - ir.bounds.y * k;
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
    // centre in the CLEAR area, not the raw rect — the HUD and help bar float over it
    const insetTop = 108, insetBottom = 72;
    tx = r.width / 2 - targetX * k;
    ty = insetTop + (r.height - insetTop - insetBottom) / 2 - targetY * k;
    apply();
  }

  return { fit, zoomBy, trace, setView, get zoom() { return k; } };
}

function marker(id: string, color: string) {
  const m = s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  m.append(s("path", { d: "M0,0.5 L10,5 L0,9.5 L2.8,5 Z", fill: color }));
  return m;
}

/** True midpoint measured along the polyline, so labels sit ON detoured routes. */
function midpoint(points: [number, number][]): [number, number] {
  if (points.length < 2) return points[0] || [0, 0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d); total += d;
  }
  let walked = 0;
  for (let i = 0; i < seg.length; i++) {
    if (walked + seg[i] >= total / 2) {
      const t = seg[i] ? (total / 2 - walked) / seg[i] : 0;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    walked += seg[i];
  }
  return points[points.length - 1];
}

/** Michal's side-entry: cofactors swing in on a quarter arc across the reaction arrow. */
function cofactorSide(r: ChartRxn, mx: number, my: number, dir: number, edgeLen = 120): SVGGElement {
  const g = s("g", { class: "cofactor lod-detail" });
  const R = Math.max(12, Math.min(26, edgeLen * 0.22));
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

// MPL — Metabolic Pathway Language.
//
// A small declarative language for laying out a metabolic pathway the way Gerhard
// Michal drew them: vertical reaction spines, side branches, cofactors entering on
// curved side-arrows, and regulation routed orthogonally around the outside.
//
//   pathway glycolysis "Glycolysis" {
//     grid B5
//     spacing 150
//     spine at 0,0 {
//       glucose
//       -> hexokinase [2.7.1.1] +atp -adp !committed
//       g6p
//       <-> gpi [5.3.1.9]
//       f6p
//     }
//     branch from f16bp side left { dhap  <-> tpi [5.3.1.1] }
//     inhibit g6p -> hexokinase feedback
//     activate f26bp -> pfk1 allosteric
//   }
//
// compile(src) -> layout IR consumed by the browser renderer. Deterministic:
// the same source always produces the same picture.

const NODE_W = 148;   // metabolite cell width
const NODE_H = 88;    // metabolite cell height (name + structure live inside)
const COL_GAP = 196;  // horizontal gap between spine and a branch column
const DEFAULT_SPACING = 152; // vertical distance between consecutive metabolites

// Text is geometry. The renderer sets an enzyme name (wrapped to two 10px lines,
// mean glyph advance 5.2) plus an EC line beside every reaction midpoint, and the
// cofactor labels on the opposite side. The compiler's occupancy model used to be
// cells and polylines only, so nothing was ever routed around a name and nothing
// measured one into the fitted bounds — rails were laid along name baselines and
// long labels fell outside the sheet. These constants mirror chart-view.ts.
const LABEL_LINE = 10;      // enzyme-name line height
const LABEL_EC = 11;        // EC number line height
const LABEL_W = 70;         // the always-set head of a name (~13 chars), reserved
const COFACTOR_CH = 4.5;    // cofactor labels are set smaller
const COFACTOR_R = 26;      // the side-entry arc's radius at its largest
const CAPTION_H = 34;       // a cell's name rows: y = 12 + i*11, up to two lines
const ROW_GAP = 52;   // room for the arrow, enzyme name and cofactor arcs
const COL_PAD = 58;   // paper between two columns of the same chain

// The sheet is read on a landscape screen and "Fit" scales by min(kx, ky), so a
// block that comes out square throws away the surplus width. Fold every chain
// towards the viewport's own proportions instead of towards a square.
const TARGET_ASPECT = 1.7;

// A regulator is an ANNOTATION on a step, not a station on the route. Michal
// writes its name beside the arrow; he never gives it a full structure cell out
// in the margin on a canvas-long leash.
const EFF_CHIP_W = 118, EFF_CHIP_H = 56;

// Cofactors that turn up on nearly every step. Placing one as its own cell and
// running a rail back across the sheet asserts a spatial relationship that does
// not exist — these are written ON the step they modulate. ATP/ADP/AMP/GTP/GDP
// are deliberately NOT here: they are genuine allosteric ligands (AMP→PFK1,
// ADP→PRPS1) and the poster draws those feedbacks as real lines.
const CURRENCY = new Set([
  "nad", "nadh", "nadp", "nadph", "fad", "fadh2", "fmn", "fmnh2",
  "coa", "coash", "pi", "ppi", "h2o", "hplus", "co2", "o2", "q", "qh2",
]);

// Module ids are machine-readable (`malonyl_coa`, `f26bp`); a chart must never
// print one. build-chart.mjs has the real display names and overrides `label`
// from `metabolite`; this is the fallback so the raw id can never leak.
const LABEL_WORDS = {
  coa: "CoA", nad: "NAD+", nadh: "NADH", nadp: "NADP+", nadph: "NADPH",
  atp: "ATP", adp: "ADP", amp: "AMP", camp: "cAMP", gtp: "GTP", gdp: "GDP",
  gmp: "GMP", imp: "IMP", ump: "UMP", cmp: "CMP", fad: "FAD", fadh2: "FADH2",
  thf: "THF", sam: "SAM", sah: "SAH", gsh: "GSH", gssg: "GSSG", pi: "Pi", ppi: "PPi",
};
export function prettyName(id) {
  return String(id).split(/[_-]+/).map((w) => {
    if (LABEL_WORDS[w]) return LABEL_WORDS[w];
    if (/\d/.test(w)) return w.toUpperCase();          // g6p -> G6P, f26bp -> F26BP
    if (!/[aeiou]/.test(w) && w.length <= 5) return w.toUpperCase();  // prpp -> PRPP
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join("-");
}

// ---------------------------------------------------------------- tokenizer

export function tokenize(src) {
  const tokens = [];
  const re = /\s*(#[^\n]*|"[^"]*"|<->|->|-\|\||[[\]{}(),]|[+\-!][A-Za-z0-9_.]+|[A-Za-z0-9_.:\-]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const t = m[1];
    if (!t) break;
    if (t.startsWith("#")) continue;
    tokens.push(t);
  }
  return tokens;
}

// ---------------------------------------------------------------- parser

export function parse(src) {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i];
  const next = () => tk[i++];
  const expect = (v) => {
    const t = next();
    if (t !== v) throw new Error(`MPL: expected '${v}' but got '${t}' at token ${i}`);
    return t;
  };
  const str = (t) => t.replace(/^"|"$/g, "");

  if (peek() !== "pathway") throw new Error("MPL: file must start with 'pathway'");
  next();
  const id = next();
  const title = str(next());
  expect("{");

  const ast = { id, title, grid: null, spacing: DEFAULT_SPACING, spine: null, cycle: null, cycleRadius: 340, wrap: null, branches: [], regulation: [] };

  while (peek() && peek() !== "}") {
    const kw = next();
    if (kw === "grid") ast.grid = next();
    else if (kw === "spacing") ast.spacing = Number(next());
    else if (kw === "spine") ast.spine = parseChain();
    else if (kw === "cycle") { ast.cycle = parseChain(); ast.cycleRadius = ast.cycleRadius || 340; }
    else if (kw === "radius") ast.cycleRadius = Number(next());
    else if (kw === "wrap") ast.wrap = Number(next());
    else if (kw === "branch") {
      expect("from");
      const from = next();
      expect("side");
      const side = next(); // left | right
      ast.branches.push({ from, side, chain: parseChain() });
    } else if (kw === "inhibit" || kw === "activate") {
      const from = next();
      expect("->");
      const to = next();
      const kind = peek() && !["inhibit", "activate", "branch", "spine", "}"].includes(peek()) ? next() : kw;
      ast.regulation.push({ effect: kw, from, to, kind });
    } else throw new Error(`MPL: unknown directive '${kw}'`);
  }
  expect("}");
  return ast;

  /** chain := [at x,y] { (metabolite | reaction)* } */
  function parseChain() {
    let at = null;
    if (peek() === "at") { next(); const x = Number(next()); expect(","); const y = Number(next()); at = { x, y }; }
    expect("{");
    const steps = [];
    while (peek() && peek() !== "}") {
      const t = peek();
      if (t === "->" || t === "<->") {
        next();
        const enzyme = next();
        const step = { kind: "reaction", enzyme, reversible: t === "<->", ec: null, in: [], out: [], flags: [] };
        if (peek() === "[") { next(); step.ec = next(); expect("]"); }
        while (peek() && /^[+\-!]/.test(peek())) {
          const mod = next();
          if (mod[0] === "+") step.in.push(mod.slice(1));
          else if (mod[0] === "-") step.out.push(mod.slice(1));
          else step.flags.push(mod.slice(1));
        }
        steps.push(step);
      } else {
        next();
        steps.push({ kind: "metabolite", id: t });
      }
    }
    expect("}");
    return { at: at || { x: 0, y: 0 }, steps };
  }
}

// ---------------------------------------------------------------- layout

/**
 * Place a parsed pathway on a deterministic grid and route every edge
 * orthogonally. Returns the IR the renderer draws.
 */
export function layout(ast, sizes = {}, fold = 1) {
  const spineOriginX = () => (ast.spine || ast.cycle || { at: { x: 0 } }).at.x;
  const nodes = [];      // metabolite cells
  const reactions = [];  // reaction steps (arrow + enzyme label + cofactors)
  const byMetabolite = new Map(); // metabolite id -> node (first placement wins)

  // Occupancy map — nothing may overlap anything else. Cells claim a rectangle
  // (plus a gutter for the name above and labels beside) before they are placed.
  const sizeOf = (id) => {
    const s = sizes[id];
    return { w: s?.w || NODE_W, h: s?.h || NODE_H };
  };

  const placed = [];
  const GUTTER_X = 62;  // room for enzyme names / cofactor labels beside a cell
  const GUTTER_Y = 14;  // clear paper between stacked cells

  function hits(r, except) {
    return placed.some((p) => p !== except &&
      !(r.x + r.w + GUTTER_X <= p.x || p.x + p.w + GUTTER_X <= r.x ||
        r.y + r.h + GUTTER_Y <= p.y || p.y + p.h + GUTTER_Y <= r.y));
  }
  /** Slide horizontally (in `dir`) until the cell no longer collides. */
  function freeX(x, y, dir, w = NODE_W, h = NODE_H, except) {
    let cx = x;
    for (let i = 0; i < 40 && hits({ x: cx, y, w, h }, except); i++) cx += dir * COL_GAP;
    return cx;
  }
  // Occupancy holds the node ITSELF, not a copy of its rectangle. The repair pass
  // below shifts cells out of reaction corridors; against copied rectangles those
  // moves were invisible to hits(), so a nudged cell could be dropped straight on
  // top of a neighbour — which then failed the build's no-overlap gate.
  function claim(node) { placed.push(node); return node; }

  /**
   * Nearest free slot to (x,y), searched over a bounded 2-D neighbourhood.
   * freeX slid horizontally on every collision, so an effector in a congested
   * band could march a dozen columns out and stretch the whole sheet.
   */
  function freeSlotNear(x, y, dir, w = NODE_W, h = NODE_H, except) {
    if (!hits({ x, y, w, h }, except)) return { x, y };
    for (let ring = 1; ring <= 6; ring++) {
      for (const dy of [0, -1, 1, -2, 2]) {
        for (const dxs of [dir, -dir]) {
          const cx = x + dxs * ring * COL_GAP;
          const cy = y + dy * Math.round(ast.spacing * 0.8);
          if (!hits({ x: cx, y: cy, w, h }, except)) return { x: cx, y: cy };
        }
      }
    }
    // Nothing in the neighbourhood: slide out until there genuinely is room.
    // Returning the far offset unchecked put cells on top of each other.
    return { x: freeX(x + dir * 7 * COL_GAP, y, dir, w, h, except), y };
  }

  /** Keep a column clear of a cyclic pathway's ring so chords are never crossed. */
  function outsideRing(x, dir) {
    if (!ast.cycle) return x;
    const cx = ast.cycle.at.x;
    const clearance = ast.cycleRadius + NODE_W + 40;
    return dir < 0 ? Math.min(x, cx - clearance) : Math.max(x, cx + clearance);
  }

  if (ast.cycle) placeCycle(ast.cycle, ast.cycle.at.x, ast.cycle.at.y, ast.cycleRadius);
  if (ast.spine) placeChain(ast.spine, ast.spine.at.x, ast.spine.at.y, "spine");

  // The spine may now span several columns (serpentine), so branches and
  // effectors must clear its real footprint, not just its origin column.
  const coreNodes = nodes.filter((n) => n.lane === "spine" || n.lane === "cycle");
  const coreBox = coreNodes.length ? {
    x0: Math.min(...coreNodes.map((n) => n.x)),
    x1: Math.max(...coreNodes.map((n) => n.x + n.w)),
  } : { x0: 0, x1: NODE_W };
  const outsideCore = (x, dir) => dir < 0
    ? Math.min(x, coreBox.x0 - COL_GAP)
    : Math.max(x, coreBox.x1 + COL_GAP - NODE_W);

  for (const b of ast.branches) {
    const anchor = byMetabolite.get(b.from);
    const dir = b.side === "left" ? -1 : 1;
    const y = (anchor ? anchor.y : 0) + ast.spacing;
    const szB = sizeOf((b.chain.steps.find((s) => s.kind === "metabolite") || {}).id || "");
    const x = freeX(outsideCore(outsideRing((anchor ? anchor.x : 0) + dir * COL_GAP, dir), dir), y, dir, szB.w, szB.h);
    placeChain(b.chain, x, y, `branch:${b.from}:${b.side}`, anchor);
    // connect the anchor into the first node of the branch with an orthogonal elbow
    const first = b.chain.steps.find((s) => s.kind === "metabolite");
    const target = first && byMetabolite.get(first.id);
    // A branch usually RE-LISTS its anchor as its first step so the arm carries
    // its own branch-head enzyme (`branch from imp { imp -> adss2 … }`). The
    // anchor is then already placed, byMetabolite hands back that same cell, and
    // linking it to itself drew a hairline looping back up through its own box.
    //
    // And when a real, named step already joins these two cells, the scaffold is
    // not merely redundant — chart-view draws any branch-link as a grey hairline
    // with no arrowhead, so emitting one DEMOTES an enzyme-catalysed reaction to
    // "not a reaction". The declared step wins; the scaffold is dropped.
    if (anchor && target && anchor !== target && !alreadyJoined(anchor, target)) {
      reactions.push({
        id: `${ast.id}__branchlink__${b.from}__${first.id}`,
        // Positional scaffolding asserts no chemistry, so it cannot be
        // "reversible" — that hard-coded `true` claimed a direction fact about a
        // connector that has no reaction behind it at all.
        kind: "branch-link", enzyme: null, ec: null, reversible: false,
        from: anchor.id, to: target.id,
        points: routeEdge(anchor, target),
        scaffoldDir: dir,
        in: [], out: [], flags: [],
      });
    }
  }

  /** Is there already a real, named reaction joining these two cells either way? */
  function alreadyJoined(a, b) {
    return reactions.some((r) => r.kind === "flux" &&
      ((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)));
  }

  // Effectors that only appear as regulators (citrate, AMP, F2,6BP …) are not on
  // any chain, so give them their own gutter column to the left of the pathway.
  const spineX = (ast.spine || ast.cycle).at.x;
  const branchLeft = ast.branches.some((b) => b.side === "left");
  const effDir = branchLeft ? 1 : -1;   // put effectors opposite the branches
  // Michal parks an effector next to the step it modulates. Doing the same keeps
  // regulation edges short instead of sending them on canvas-spanning detours.
  const targetOf = new Map();
  for (const r of ast.regulation) {
    if (byMetabolite.has(r.from) || targetOf.has(r.from)) continue;
    const rx = reactions.find((x) => x.enzyme === r.to);
    if (rx) targetOf.set(r.from, rx);
  }
  // An effector is named, not depicted: a chip the size of its label, never a
  // 196x116 skeletal-structure cell parked 400 units off-axis. A condensed
  // column is already text-sized, so it is left alone.
  const effectorSize = (id) => {
    const s = sizeOf(id);
    if (sizes[id]?.condensed) return { ...s, compact: false };
    return { w: Math.min(s.w, EFF_CHIP_W), h: Math.min(s.h, EFF_CHIP_H), compact: true };
  };
  const effectorsNeeded = ast.regulation
    .filter((r) => !byMetabolite.has(r.from) && !CURRENCY.has(r.from))
    .map((r) => r.from).filter((v, i, a) => a.indexOf(v) === i);
  const effRows = Math.max(3, Math.ceil(Math.sqrt(effectorsNeeded.length * 1.4)));
  const effBaseX = outsideCore(outsideRing(spineX + effDir * COL_GAP, effDir), effDir);
  const effBaseY = (ast.spine || ast.cycle).at.y;
  effectorsNeeded.forEach((id, i) => {
    const rx = targetOf.get(id);
    const szE = effectorSize(id);
    let x, y;
    if (rx) {
      // sit beside the reaction this effector controls
      const mid = rx.points[Math.floor(rx.points.length / 2)];
      const side = mid[0] >= (coreBox.x0 + coreBox.x1) / 2 ? 1 : -1;
      y = Math.round(mid[1] - szE.h / 2);
      // Sit next to the controlled step. Do NOT clamp outside the whole spine
      // block — that flings effectors to the far margin and inflates the sheet;
      // freeX already slides them clear of any actual cell.
      // ...but stay within a band beside the core, so one distant target cannot
      // stretch the whole sheet. Short lines AND a compact bbox.
      const lo = coreBox.x0 - COL_GAP * 1.6, hi = coreBox.x1 + COL_GAP * 1.6;
      const slot = freeSlotNear(Math.max(lo, Math.min(hi, mid[0] + side * COL_GAP)), y, side, szE.w, szE.h);
      x = slot.x; y = slot.y;
    } else {
      const col = Math.floor(i / effRows), row = i % effRows;
      const slot = freeSlotNear(effBaseX + effDir * col * COL_GAP, effBaseY + row * ast.spacing, effDir, szE.w, szE.h);
      x = slot.x; y = slot.y;
    }
    const node = {
      id: `${ast.id}:${id}`, metabolite: id,
      x, y, lane: "effector", w: szE.w, h: szE.h,
      // build-chart.mjs owns depiction: a compact chip carries its name, not a
      // skeletal drawing shrunk into a sliver.
      compact: szE.compact,
    };
    nodes.push(claim(node));
    byMetabolite.set(id, node);
  });

  // A regulator can point at a protein this chart never draws — a hormone
  // receptor (FFAR2/FFAR3/HCAR2), a kinase that catalyses no step here. Neither
  // `reactions.find(enzyme===to)` nor `byMetabolite` found one, so every such
  // edge used to be dropped in silence: scfa declared six and drew none. Give
  // the target its own chip, on the far side of its regulator, so the
  // relationship is on the sheet.
  for (const r of ast.regulation) {
    if (byMetabolite.has(r.to) || reactions.some((x) => x.enzyme === r.to)) continue;
    // A receptor usually has SEVERAL ligands (FFAR3 binds propionate and
    // butyrate). Parking it beside whichever one is declared first leaves the
    // others with no short corridor, so sit it among all of them.
    const srcs = ast.regulation.filter((o) => o.to === r.to)
      .map((o) => byMetabolite.get(o.from)).filter(Boolean);
    if (!srcs.length) continue;              // neither end exists — nothing to draw
    const cx = srcs.reduce((a, n) => a + n.x + n.w / 2, 0) / srcs.length;
    const cy = srcs.reduce((a, n) => a + n.y + n.h / 2, 0) / srcs.length;
    const side = cx >= (coreBox.x0 + coreBox.x1) / 2 ? 1 : -1;
    const sz = sizeOf(r.to);
    const slot = freeSlotNear(Math.round(cx - sz.w / 2 + side * COL_GAP),
      Math.round(cy - sz.h / 2), side, sz.w, sz.h);
    const node = {
      id: `${ast.id}:${r.to}`, metabolite: r.to,
      x: slot.x, y: slot.y, lane: "effector", w: sz.w, h: sz.h, compact: true,
    };
    nodes.push(claim(node));
    byMetabolite.set(r.to, node);
  }

  repairBlockedRoutes();
  splitSharedShafts();

  // Text is occupancy. The renderer sets an enzyme name, an EC number and the
  // cofactor captions against every reaction midpoint, but the compiler's model
  // was cells and vertices only — so rails were laid along name baselines and
  // "Fit" framed a box smaller than the drawing. Reserve that paper here, once
  // the routes (and therefore the midpoints) are final, and treat it as a real
  // obstacle for everything routed afterwards.
  const labelKeepOut = [];
  for (const r of reactions) {
    const boxes = labelBoxesFor(r);
    if (!boxes.length) continue;
    r.labelBox = boxes[0];        // exported so the renderer can set into it
    labelKeepOut.push(...boxes);
  }

  // What the routed rails have already claimed. Regulation used to be checked
  // against node rectangles ONLY — never against another rail — so independent
  // regulations were handed the same band and merged into one bus.
  const railSegments = [];   // committed rail geometry: no two rails may merge
  const railLandings = [];   // committed glyph centres: no two discs may coincide
  // How hard the router is currently being asked to try. Relaxed one step at a
  // time by the loop below, so the picture degrades only as far as it must.
  const regStrict = { labels: true, rails: true, legacy: false };

  // Scaffolding is routed last, so it can be kept off the text as well as off
  // the flux strokes. It carries no enzyme name of its own, so moving it cannot
  // move any label box.
  routeScaffolds();

  /** Nudge movable cells out of reaction corridors until every route is clear. */
  function repairBlockedRoutes() {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (let pass = 0; pass < 10; pass++) {
      let moved = false;
      for (const r of reactions) {
        if (r.onRing) continue;
        const from = byId.get(r.from), to = byId.get(r.to);
        if (!from || !to) continue;
        const blocker = firstBlocker(r.points, from, to);
        if (!blocker) continue;
        if (blocker.lane === "spine" || blocker.lane === "cycle") continue; // never move the core
        const dir = blocker.x + blocker.w / 2 < (coreBox.x0 + coreBox.x1) / 2 ? -1 : 1;
        // Move it to somewhere that is actually FREE. A blind shift by 0.75 of a
        // column cleared the corridor but could drop the cell straight onto a
        // neighbour, and an overlap fails the build outright — a worse defect
        // than the crossing being repaired.
        const slot = freeSlotNear(blocker.x + dir * Math.round(COL_GAP * 0.75), blocker.y,
          dir, blocker.w, blocker.h, blocker);
        if (slot.x === blocker.x && slot.y === blocker.y) continue;
        blocker.x = slot.x; blocker.y = slot.y;
        moved = true;
      }
      // re-route everything against the new positions
      for (const r of reactions) {
        if (r.onRing) continue;
        const from = byId.get(r.from), to = byId.get(r.to);
        if (from && to) r.points = routeEdge(from, to);
      }
      if (!moved) break;
    }
  }

  /** A y where a horizontal run from x1..x2 crosses no cell (nearest to preferY). */
  function clearBandY(x1, x2, preferY, from, to) {
    const lo = Math.min(x1, x2) - 4, hi = Math.max(x1, x2) + 4;
    const cands = [];
    for (const n of nodes) { cands.push(n.y - 22, n.y + n.h + 22); }
    cands.push(Math.min(...nodes.map((n) => n.y)) - 64, Math.max(...nodes.map((n) => n.y + n.h)) + 64);
    cands.sort((a, b) => Math.abs(a - preferY) - Math.abs(b - preferY));
    for (const y of cands) {
      const blocked = nodes.some((n) => n !== from && n !== to &&
        !(hi <= n.x || n.x + n.w <= lo) && n.y - 4 < y && y < n.y + n.h + 4);
      if (!blocked) return Math.round(y);
    }
    return Math.max(...nodes.map((n) => n.y + n.h)) + 64;
  }

  /** Horizontal bands near y that are worth trying for a regulation approach. */
  function bandCandidates(y) {
    const out = [];
    for (const n of nodes) { out.push(n.y - 20, n.y + n.h + 20); }
    out.sort((a, b) => Math.abs(a - y) - Math.abs(b - y));
    return out.slice(0, 10);
  }

  /**
   * A regulation route may not enter ANY cell — its own effector's included.
   * The rail now leaves the source's frame rather than its centre, so the old
   * `n === src` exemption (which is what let every rail be drawn out through its
   * own box's interior, and what stopped the build gate catching it) is gone.
   * `legacy` restores the looser test as a last resort, so a congested chart
   * still draws its regulation rather than degrading every edge to a tag.
   */
  function regClear(points, src, legacy = regStrict.legacy) {
    // Text and other rails are obstacles too, not just cells.
    if (regStrict.labels && !clearOfLabels(points, labelKeepOut)) return false;
    if (regStrict.rails && !clearOfRails(points, railSegments)) return false;
    const inset = legacy ? 8 : 2;
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
      const hi = { x: Math.max(x1, x2), y: Math.max(y1, y2) };
      if (hi.x - lo.x >= hi.y - lo.y) { lo.x += inset; hi.x -= inset; } else { lo.y += inset; hi.y -= inset; }
      if (hi.x < lo.x || hi.y < lo.y) continue;
      for (const n of nodes) {
        if (legacy && n === src) continue;
        if (!(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y)) return false;
      }
    }
    return true;
  }

  /** True when no segment of a route runs through paper reserved for text. */
  function clearOfLabels(points, boxes) {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
      const hi = { x: Math.max(x1, x2), y: Math.max(y1, y2) };
      for (const b of boxes) {
        if (!(hi.x <= b.x || b.x + b.w <= lo.x || hi.y <= b.y || b.y + b.h <= lo.y)) return false;
      }
    }
    return true;
  }

  /**
   * Rails may CROSS — unavoidable on a dense sheet — but they may never MERGE.
   * Reject a candidate that runs collinear with, and overlapping, a segment some
   * other regulation edge already claimed: that is what turned independent
   * regulations into one indistinguishable bus.
   */
  function clearOfRails(points, claimed) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const horiz = a[1] === b[1], vert = a[0] === b[0];
      for (const s of claimed) {
        if (horiz && s.horiz && Math.abs(a[1] - s.a[1]) <= 3) {
          const ov = Math.min(Math.max(a[0], b[0]), Math.max(s.a[0], s.b[0]))
                   - Math.max(Math.min(a[0], b[0]), Math.min(s.a[0], s.b[0]));
          if (ov > 12) return false;
        } else if (vert && s.vert && Math.abs(a[0] - s.a[0]) <= 3) {
          const ov = Math.min(Math.max(a[1], b[1]), Math.max(s.a[1], s.b[1]))
                   - Math.max(Math.min(a[1], b[1]), Math.min(s.a[1], s.b[1]));
          if (ov > 12) return false;
        }
      }
    }
    return true;
  }

  function firstBlocker(points, from, to) {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      const lo = { x: Math.min(x1, x2) - 4, y: Math.min(y1, y2) - 4 };
      const hi = { x: Math.max(x1, x2) + 4, y: Math.max(y1, y2) + 4 };
      for (const n of nodes) {
        if (n === from || n === to) continue;
        if (!(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y)) return n;
      }
    }
    return null;
  }

  // regulation routed around the outside of the column it targets
  const regulation = [];
  let sheetAreaCache = 0;   // every cell is placed by now, so the sheet is fixed
  // count first, so each regulator can be given its own landing point along the edge
  const targetCount = new Map();
  for (const r of ast.regulation) targetCount.set(r.to, (targetCount.get(r.to) || 0) + 1);
  const perTarget = new Map(); // fan out lines that share a target so they never coincide
  // A chart-GLOBAL lane index. Keying the gutter and band offsets to a per-target
  // counter meant two regulations of different steps were handed the identical
  // gutter distance and the identical band, which is how opposite-effect rails
  // ended up co-linear for hundreds of units.
  let regLane = 0;
  const unrouted = [];
  /** Michal's device in tight spots: name the effector ON the step it modulates. */
  function tagStep(dst, r) {
    if (!dst?.points) { unrouted.push(`${r.from} -> ${r.to}`); return; }
    const mid = polyMid(dst.points);
    (dst.tags ||= []).push({
      effect: r.effect, metabolite: r.from, label: prettyName(r.from),
      x: Math.round(mid[0]), y: Math.round(mid[1]),
    });
  }
  for (const r of ast.regulation) {
    const src = byMetabolite.get(r.from);
    const dstRxn = reactions.find((x) => x.enzyme === r.to);
    const dst = dstRxn || byMetabolite.get(r.to);
    if (!dst) { unrouted.push(`${r.from} -> ${r.to}`); continue; }
    // A currency cofactor has no cell of its own (see CURRENCY) — it is written
    // on the step rather than railed in from the margin.
    if (!src) { tagStep(dst, r); continue; }
    const n = perTarget.get(r.to) || 0;
    perTarget.set(r.to, n + 1);
    // Ask for the best rail first — clear of text, clear of every other rail —
    // and relax one constraint at a time rather than all at once. The cell test
    // (the one the build gate enforces) is only loosened at the last resort.
    let pts = null;
    for (const level of [{ labels: 1, rails: 1 }, { labels: 0, rails: 1 }, { labels: 0, rails: 0 }, { labels: 0, rails: 0, legacy: 1 }]) {
      Object.assign(regStrict, { labels: !!level.labels, rails: !!level.rails, legacy: !!level.legacy });
      pts = regulationRoute(src, dst, n, targetCount.get(r.to) || 1, regLane);
      if (pts) break;
    }
    Object.assign(regStrict, { labels: true, rails: true, legacy: false });
    regLane++;
    // A route that doubles back on itself emits a zero-length segment, which the
    // renderer paints twice and turns from a dash into a solid stub.
    if (pts) pts = simplifyRoute(pts) || pts;
    if (pts) {
      claimRail(pts);
      regulation.push({
        effect: r.effect, kind: r.kind, from: r.from, to: r.to,
        points: pts,
        glyph: r.effect === "inhibit" ? "inhibit" : "activate",
      });
    } else {
      // No corridor exists, or the only one was a sheet-spanning staple.
      tagStep(dst, r);
    }
  }

  // Bounds must contain every drawn thing — cells AND routed edges — or "Fit"
  // silently clips regulation lines that overshoot the cell bounding box.
  const xs = [], ys = [];
  for (const n of nodes) { xs.push(n.x, n.x + n.w); ys.push(n.y, n.y + n.h); }
  for (const r of reactions) for (const p of r.points) { xs.push(p[0]); ys.push(p[1]); }
  for (const g of regulation) for (const p of g.points) { xs.push(p[0]); ys.push(p[1]); }
  // Text is ink too, and the outermost enzyme name, EC number and cofactor
  // caption print past the last cell — bounds taken from rectangles and vertices
  // alone framed a box smaller than the drawing, so "Fit" clipped exactly those
  // captions. labelKeepOut already models that paper for routing; measure the
  // same boxes into the frame so the two can never disagree.
  for (const b of labelKeepOut) { xs.push(b.x, b.x + b.w); ys.push(b.y, b.y + b.h); }
  // The router reserves only the head of a name (see labelBoxesFor), but the
  // renderer wraps the WHOLE name into whatever channel it measures — so a step
  // in the outermost column prints far past its reserved box. Frame the run it
  // can actually reach: the name's own width, or the gap to the next thing on
  // that side, whichever is smaller. This is what was clipping "ACID
  // SPHINGOMYELINASE" mid-word at the sheet edge.
  for (const r of reactions) {
    if (!r.enzyme) continue;
    const [mx, my] = polyMid(r.points);
    const d = r.side === "left" ? -1 : 1;
    xs.push(mx + d * (14 + labelReach(mx + d * 14, my, d)));
  }
  // A regulation glyph is a disc, not a point.
  for (const g of regulation) {
    const [ex, ey] = g.points[g.points.length - 1];
    xs.push(ex - 9, ex + 9); ys.push(ey - 9, ey + 9);
  }
  if (!xs.length) { xs.push(0); ys.push(0); }
  const pad = 44;
  // No `Math.min(..., 0)`: forcing the origin into the frame padded every sheet
  // out to a corner nothing is drawn in.
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad, maxY = Math.max(...ys) + pad;

  return {
    id: ast.id, title: ast.title, grid: ast.grid,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    nodes, reactions, regulation,
    ...(unrouted.length ? { unrouted } : {}),
  };

  /** Midpoint measured ALONG the polyline — exactly where the renderer puts the
   *  enzyme label, so a detoured route is annotated on the route, not beside it. */
  function polyMid(points) {
    if (!points || points.length < 2) return points?.[0] || [0, 0];
    const seg = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      seg.push(d); total += d;
    }
    let walked = 0;
    for (let i = 0; i < seg.length; i++) {
      if (walked + seg[i] >= total / 2) {
        const t = seg[i] ? (total / 2 - walked) / seg[i] : 0;
        return [points[i][0] + (points[i + 1][0] - points[i][0]) * t,
                points[i][1] + (points[i + 1][1] - points[i][1]) * t];
      }
      walked += seg[i];
    }
    return points[points.length - 1];
  }

  /** Lay a cyclic pathway out as a ring, the way the poster draws the TCA. */
  function placeCycle(chain, cx, cy, radius) {
    const mets = chain.steps.filter((s) => s.kind === "metabolite");
    const n = mets.length;
    if (!n) return;
    const ring = [];
    mets.forEach((step, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;   // start at 12 o'clock
      const x = Math.round(cx + radius * Math.cos(a) - NODE_W / 2);
      const y = Math.round(cy + radius * Math.sin(a) - NODE_H / 2);
      let node = byMetabolite.get(step.id);
      if (!node) {
        const sz = sizeOf(step.id);
        node = { id: `${ast.id}:${step.id}`, metabolite: step.id, x, y, lane: "cycle", w: sz.w, h: sz.h };
        nodes.push(claim(node));
        byMetabolite.set(step.id, node);
      }
      ring.push(node);
    });
    // reactions sit between consecutive ring members and CLOSE the ring
    let ri = 0;
    const rxns = chain.steps.filter((s) => s.kind === "reaction");
    for (let i = 0; i < ring.length; i++) {
      const step = rxns[ri++];
      if (!step) break;
      const from = ring[i], to = ring[(i + 1) % ring.length];
      finishReaction(step, from, to, true);
    }
  }

  /**
   * How many cells to stack before folding to the next column.
   *
   * The old rule targeted a SQUARE block, and only for the spine — every branch
   * ran as one unbroken vertical column however long it was. One 10-cell branch
   * then set the whole sheet's height while the spine wrapped beside it, and
   * fit()'s min(kx, ky) threw the surplus width away. Fold every lane, and fold
   * it towards the viewport's proportions rather than towards a square.
   */
  function rowsFor(chain) {
    const mets = chain.steps.filter((s) => s.kind === "metabolite");
    const n = mets.length;
    if (ast.wrap != null) return ast.wrap || Infinity;  // the author pinned it
    if (fold === null) return Infinity;       // this candidate keeps one column
    if (n < 4) return Infinity;               // too short to be worth folding
    const szs = mets.map((s) => sizeOf(s.id));
    const avgW = szs.reduce((a, s) => a + s.w, 0) / n;
    const avgH = szs.reduce((a, s) => a + s.h, 0) / n;
    let best = Infinity, bestScore = Infinity;
    for (let r = 2; r <= n; r++) {
      const c = Math.ceil(n / r);
      const w = c * (avgW + COL_PAD) - COL_PAD;
      const h = r * (avgH + ROW_GAP) - ROW_GAP;
      // log-ratio, so being twice too wide is scored like being twice too tall
      const score = Math.abs(Math.log((w / h) / (TARGET_ASPECT * fold)));
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  function placeChain(chain, x0, y0, lane, entry = null) {
    const rows = rowsFor(chain);
    // A left-hand branch must fold AWAY from the spine; only the spine and the
    // right-hand branches grow to the right.
    const wrapDir = lane === "spine" || lane === "cycle" ? 1 : (x0 < spineOriginX() ? -1 : 1);
    let placedInCol = 0, col = 0;
    let colX = x0, colMaxW = 0;
    let y = y0;
    let lastTop = y0, lastH = 0;   // the turn of the serpentine, in real units
    // A branch is handed its anchor, so a chain may OPEN with a reaction and have
    // that step drawn as the branch's entry edge — with its enzyme, EC and
    // cofactors intact. Without this the leading step was overwritten by the next
    // one and silently vanished, which is why a real catalysed entry (FASN MAT
    // into acetyl-ACP, EC 2.3.1.38) could only ever be drawn as anonymous
    // scaffolding.
    let prevNode = entry;
    let pendingReaction = null;
    for (const step of chain.steps) {
      if (step.kind === "metabolite") {
        const sz = sizeOf(step.id);
        if (placedInCol >= rows) {          // wrap to the next column, reversing flow
          col++; placedInCol = 0;
          colX += wrapDir * (colMaxW + COL_PAD);
          colMaxW = 0;
          // Turn on the cell we just placed rather than on a nominal
          // (rows-1)*NODE_H — cells are content-sized, so a computed row grid
          // stopped matching the real one as soon as heights varied.
          y = col % 2 === 0 ? lastTop : lastTop + lastH;
        }
        // going up: the cursor tracks the BOTTOM edge of the next cell
        const ny = col % 2 === 0 ? y : y - sz.h;
        let node = byMetabolite.get(step.id);
        if (!node) {
          const dir = lane === "spine" ? 1 : (x0 < spineOriginX() ? -1 : 1);
          const nx = lane === "spine" ? colX : freeX(colX, ny, dir, sz.w, sz.h);
          colMaxW = Math.max(colMaxW, sz.w);
          node = { id: `${ast.id}:${step.id}`, metabolite: step.id, x: nx, y: ny, lane, w: sz.w, h: sz.h };
          nodes.push(claim(node));
          byMetabolite.set(step.id, node);
        }
        if (pendingReaction && prevNode) {
          finishReaction(pendingReaction, prevNode, node);
          pendingReaction = null;
        }
        prevNode = node;
        placedInCol++;
        lastTop = node.y; lastH = node.h;
        // advance by THIS cell's height so a small metabolite does not reserve a
        // large metabolite's worth of paper
        y = col % 2 === 0 ? node.y + node.h + ROW_GAP : node.y - ROW_GAP;
      } else {
        pendingReaction = step;
      }
    }
  }

  function finishReaction(step, from, to, onRing = false) {
    if (onRing) {
      const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
      const tx2 = to.x + to.w / 2, ty2 = to.y + to.h / 2;
      const dx = tx2 - fx, dy = ty2 - fy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const edge = (n, ux, uy) => {
        // where the chord leaves this cell's rectangle
        const hx = n.w / 2, hy = n.h / 2;
        const tx = ux ? hx / Math.abs(ux) : Infinity;
        const ty = uy ? hy / Math.abs(uy) : Infinity;
        return Math.min(tx, ty);
      };
      const tFrom = edge(from, ux, uy), tTo = edge(to, ux, uy);
      reactions.push({
        id: `${ast.id}__${step.enzyme}__${from.metabolite}__${to.metabolite}`,
        kind: "flux", enzyme: step.enzyme, ec: step.ec, reversible: step.reversible,
        committed: step.flags.includes("committed") || step.flags.includes("irreversible"),
        from: from.id, to: to.id,
        onRing: true,
        // A chord meets a cell wherever the centre-to-centre vector crosses its
        // frame — including a top corner, which is where the cell's caption rows
        // are set. Slide such an endpoint clear of the caption.
        points: [clearOfCaption([Math.round(fx + ux * tFrom), Math.round(fy + uy * tFrom)], from),
                 clearOfCaption([Math.round(tx2 - ux * tTo), Math.round(ty2 - uy * tTo)], to)],
        in: step.in, out: step.out, flags: step.flags,
        side: (reactions.length % 2 === 0) ? "right" : "left",
      });
      return;
    }
    reactions.push({
      id: `${ast.id}__${step.enzyme}__${from.metabolite}__${to.metabolite}`,
      kind: "flux",
      enzyme: step.enzyme, ec: step.ec, reversible: step.reversible,
      committed: step.flags.includes("committed") || step.flags.includes("irreversible"),
      from: from.id, to: to.id,
      points: routeEdge(from, to),
      in: step.in, out: step.out, flags: step.flags,
      // cofactors enter/leave on alternating sides of the arrow
      side: (reactions.length % 2 === 0) ? "right" : "left",
    });
  }

  /**
   * Orthogonal route between two cells that always TOUCHES both boxes. Handles
   * same-column, same-row and offset cases; never emits a stub that ends in
   * empty canvas (the cause of the dangling-arrow class of defects).
   */
  function routeEdge(from, to) {
    const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
    const tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
    const dx = tcx - fcx, dy = tcy - fcy;

    if (Math.abs(dx) < 10) {                       // same column -> straight vertical
      const direct = dy >= 0
        ? [[fcx, from.y + from.h], [fcx, to.y]]
        : [[fcx, from.y], [fcx, to.y + to.h]];
      return clear(direct, from, to) ? direct : detourX(from, to);
    }
    if (Math.abs(dy) < 10) {                       // same row -> straight horizontal
      const direct = dx >= 0
        ? [[from.x + from.w, fcy], [to.x, fcy]]
        : [[from.x, fcy], [to.x + to.w, fcy]];
      return clear(direct, from, to) ? direct : detourY(from, to);
    }
    // offset -> leave vertically, cross in the gutter between the rows, enter vertically
    const exitY = dy >= 0 ? from.y + from.h : from.y;
    const entryY = dy >= 0 ? to.y : to.y + to.h;
    const midY = Math.round((exitY + entryY) / 2);
    const z = [[fcx, exitY], [fcx, midY], [tcx, midY], [tcx, entryY]];
    if (clear(z, from, to)) return z;
    const dy2 = detourY(from, to);
    if (clear(dy2, from, to)) return dy2;
    return detourX(from, to);
  }

  /** True when no segment of the route crosses a cell other than its endpoints. */
  function clear(points, from, to) {
    const pad = 6;
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      const lo = { x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad };
      const hi = { x: Math.max(x1, x2) + pad, y: Math.max(y1, y2) + pad };
      for (const n of nodes) {
        if (n === from || n === to) continue;
        if (!(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y)) return false;
      }
    }
    return true;
  }

  /** Route over/under the obstructing row. */
  function detourY(from, to) {
    const fcx = from.x + from.w / 2, tcx = to.x + to.w / 2;
    for (const step of [46, 96, 148, 202, 262]) {
      const above = Math.min(from.y, to.y) - step;
      const below = Math.max(from.y + from.h, to.y + to.h) + step;
      for (const [lane, fromEdge, toEdge] of [[above, from.y, to.y], [below, from.y + from.h, to.y + to.h]]) {
        const pts = [[fcx, fromEdge], [fcx, lane], [tcx, lane], [tcx, toEdge]];
        if (clear(pts, from, to)) return pts;
      }
    }
    // Last resort: find a horizontal band that is actually clear across the span.
    const band = clearBandY(fcx, tcx, (from.y + to.y) / 2, from, to);
    const exit = band < from.y ? from.y : from.y + from.h;
    const entry = band < to.y ? to.y : to.y + to.h;
    return [[fcx, exit], [fcx, band], [tcx, band], [tcx, entry]];
  }

  /** Route left/right of the obstructing column. */
  function detourX(from, to) {
    const fcy = from.y + from.h / 2, tcy = to.y + to.h / 2;
    for (const step of [56, 112, 172, 236, 300]) {
      const left = Math.min(from.x, to.x) - step;
      const right = Math.max(from.x + from.w, to.x + to.w) + step;
      for (const [lane, fromEdge, toEdge] of [[right, from.x + from.w, to.x + to.w], [left, from.x, to.x]]) {
        const pts = [[fromEdge, fcy], [lane, fcy], [lane, tcy], [toEdge, tcy]];
        if (clear(pts, from, to)) return pts;
      }
    }
    const far = Math.max(...nodes.map((n) => n.x + n.w), from.x + from.w) + 64;
    return [[from.x + from.w, fcy], [far, fcy], [far, tcy], [to.x + to.w, tcy]];
  }

  /** Right-angle elbow between two cells (never diagonal). */
  /** Regulation runs out to a gutter beside the column, then back in. */
  function regulationRoute(src, dst, index = 0, total = 1, lane = 0) {
    const sx = src.x + src.w / 2;
    // Rails leaving the SAME effector take their own exit row off its frame, so
    // two regulations sharing a source can never be laid down as one line.
    const sy = Math.round(src.y + src.h / 2
      + ((lane % 3) - 1) * Math.min(12, Math.max(0, Math.round(src.h / 2) - 10)));
    // Where the rail meets what it modulates: beside the arrow and out of the
    // band the enzyme name occupies, never interpolated onto the shaft itself.
    const [dx, dy] = regulationLanding(src, dst, index, total);
    // Leave through the cell's FRAME, not its centre. Starting at the centre put
    // the first ~half-width of every rail underneath the opaque effector box, so
    // 129 of 129 dashes appeared to begin in mid-air beside their own cell.
    const exitH = dx >= sx ? src.x + src.w : src.x;
    const exitV = dy >= sy ? src.y + src.h : src.y;

    // The direct orthogonal L, tried before any gutter. Approaching the glyph
    // VERTICALLY is deliberate: the horizontal through the target is the enzyme
    // label's own baseline, and a rail arriving along it strikes the name out.
    const short = [
      [[exitH, sy], [dx, sy], [dx, dy]],
      [[sx, exitV], [sx, dy], [dx, dy]],
    ];
    // Z-routes whose crossing run is offset by this rail's OWN lane. When the
    // straight L would be laid along an enzyme name or another rail, a lane a
    // few units over is usually clear — and it is a far shorter answer than a
    // gutter staple around the outside of the sheet. Measured over the atlas,
    // these lift the share of rails that clear all reserved text from 13% to 45%.
    const nudge = ((lane % 5) - 2) * 9;
    for (const t of [0.5, 0.32, 0.68]) {
      const mx = Math.round(exitH + (dx - exitH) * t) + nudge;
      short.push([[exitH, sy], [mx, sy], [mx, dy], [dx, dy]]);
      const midY = Math.round(sy + (dy - sy) * t) + nudge;
      short.push([[sx, exitV], [sx, midY], [dx, midY], [dx, dy]]);
    }
    for (const pts of short) if (regClear(pts, src)) return pts;

    // Otherwise run out to a gutter. Try the side the TARGET is on first: taking
    // the far side first sent cortisol->th out to x=-443 before running all the
    // way back to x=47 — 508 route units for a 303-unit separation.
    // Gutter distance keyed to the chart-global lane, not to a per-target index:
    // two regulations of DIFFERENT steps used to be handed the same gutter and
    // the same band, which is how an inhibitor and an activator ended up drawn
    // as one 728-unit co-linear rail.
    const spread = (lane % 8) * 13;
    const sides = sx <= dx ? [1, -1] : [-1, 1];
    const direct = Math.abs(dx - sx) + Math.abs(dy - sy);
    let staple = null;   // clear, but long enough that a tag reads better
    for (const g of [70, 104, 146, 196, 254, 320]) {
      for (const side of sides) {
        const gutter = side < 0
          ? Math.min(src.x, dx) - g - spread
          : Math.max(src.x + src.w, dx) + g + spread;
        const start = side < 0 ? src.x : src.x + src.w;
        const cands = [[[start, sy], [gutter, sy], [gutter, dy], [dx, dy]]];
        // or drop into a clear horizontal band, run in, then step to the target
        for (const band of bandCandidates(dy)) {
          cands.push([[start, sy], [gutter, sy], [gutter, band], [dx, band], [dx, dy]]);
        }
        for (const pts of cands) {
          if (!regClear(pts, src)) continue;
          if (acceptableRail(pts, direct)) return pts;
          if (!staple || railLen(pts) < railLen(staple)) staple = pts;
        }
      }
    }
    // Every corridor that exists is a sheet-spanning staple. One of those encloses
    // a third of the drawing in a dashed rectangle that reads as a region border,
    // so the caller tags the step with the effector's name instead — but only a
    // reaction can carry a tag. When the target is a CELL (a receptor, a kinase
    // this chart does not draw a step for) there is nowhere to write the name, so
    // a long rail beats losing the relationship altogether.
    return dst.points ? null : staple;
  }

  /** Points of a route, deduped, with zero-length and collinear middles dropped. */
  function simplifyRoute(points) {
    const out = [];
    for (const p of points) {
      const q = [Math.round(p[0]), Math.round(p[1])];
      const last = out[out.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      out.push(q);
    }
    for (let i = 1; i < out.length - 1;) {
      const [ax, ay] = out[i - 1], [bx, by] = out[i], [cx, cy] = out[i + 1];
      if ((ax === bx && bx === cx) || (ay === by && by === cy)) out.splice(i, 1);
      else i++;
    }
    return out.length >= 2 ? out : null;
  }

  /** A point a fraction ALONG a polyline, with the local direction there. */
  function pointAlong(points, f) {
    const seg = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      seg.push(Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      total += seg[seg.length - 1];
    }
    const want = total * f;
    let walked = 0;
    for (let i = 0; i < seg.length; i++) {
      if (walked + seg[i] >= want || i === seg.length - 1) {
        const len = seg[i] || 1;
        const t = Math.max(0, Math.min(1, (want - walked) / len));
        const [ax, ay] = points[i], [bx, by] = points[i + 1];
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ux: (bx - ax) / len, uy: (by - ay) / len };
      }
      walked += seg[i];
    }
    const last = points[points.length - 1];
    return { x: last[0], y: last[1], ux: 1, uy: 0 };
  }

  /**
   * Where a regulator meets the thing it modulates.
   *
   * Never the middle of the arrow: `polyMid()` is exactly where the renderer
   * anchors the enzyme name and its EC number, so a lone regulator — which used
   * to get f = 0.5 — had its +/- disc placed on top of the label by
   * construction. And never on the shaft: step off it, on the side away from the
   * name, so the disc sits BESIDE the flux arrow rather than straddling it.
   */
  function regulationLanding(src, dst, index, total) {
    const scx = src.x + src.w / 2, scy = src.y + src.h / 2;
    if (!dst.points) {
      // a regulated CELL: stop on its frame — landing at the centre (as it did)
      // drew the disc inside the box
      const side = scx <= dst.x + dst.w / 2 ? -1 : 1;
      const spread = (index - (total - 1) / 2) * 20;
      const y = Math.max(dst.y + 8, Math.min(dst.y + dst.h - 8, dst.y + dst.h / 2 + spread));
      return freeLanding([side < 0 ? dst.x : dst.x + dst.w, y], side, 0);
    }
    let f = 0.5 + (index - (total - 1) / 2) * 0.18;
    if (Math.abs(f - 0.5) < 0.09) f = index % 2 ? 0.36 : 0.64;   // skip the label band
    f = Math.max(0.12, Math.min(0.88, f));
    const labelDir = dst.side === "left" ? -1 : 1;
    const base = pointAlong(dst.points, f);
    const prefer = Math.abs(base.uy) > 0.5
      ? (-base.uy * labelDir > 0 ? -1 : 1)   // vertical shaft: step away from the name
      : (scy <= base.y ? -1 : 1);            // horizontal shaft: step towards the source
    // Walk the shaft (still skipping the label band) until a landing point is
    // found that is clear of every cell and of every glyph already placed.
    for (const df of [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36]) {
      const ff = Math.max(0.12, Math.min(0.88, f + df));
      if (Math.abs(ff - 0.5) < 0.09) continue;
      const at = pointAlong(dst.points, ff);
      for (const s of [prefer, -prefer]) {
        const q = freeLanding([at.x, at.y], -at.uy * s, at.ux * s, true);
        if (q) return q;
      }
    }
    return freeLanding([base.x, base.y], -base.uy * prefer, base.ux * prefer);
  }

  /**
   * Step a landing point off the shaft until the +/- disc it carries sits on
   * clear paper: not on another regulator's glyph, and not on a cell frame.
   */
  function freeLanding(p, ux, uy, strict = false) {
    for (let i = 0; i < 8; i++) {
      const off = 13 + i * 9;
      const q = [Math.round(p[0] + ux * off), Math.round(p[1] + uy * off)];
      if (railLandings.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 17)) continue;
      if (nodes.some((n) => q[0] > n.x - 9 && q[0] < n.x + n.w + 9 && q[1] > n.y - 9 && q[1] < n.y + n.h + 9)) continue;
      return q;
    }
    return strict ? null : [Math.round(p[0] + ux * 13), Math.round(p[1] + uy * 13)];
  }

  /** Record a routed rail so the next one cannot be laid down on top of it. */
  function claimRail(points) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      railSegments.push({ a, b, horiz: a[1] === b[1], vert: a[0] === b[0] });
    }
    railLandings.push(points[points.length - 1]);
  }

  /**
   * The paper the renderer will set this step's text on. chart-view.ts hangs the
   * enzyme name (wrapped to two lines) and its EC number off the polyline
   * midpoint on the side `side` names, and swings the cofactor captions out on
   * the other side — so the compiler can reserve both exactly.
   */
  function labelBoxesFor(r) {
    if (!r.enzyme) return [];
    const [mx, my] = polyMid(r.points);
    const d = r.side === "left" ? -1 : 1;
    // Reserve the part of the name block that is ALWAYS set — the first dozen
    // characters and the EC line under them. Claiming the full width a long name
    // could reach blankets the sheet: measured, 70% of rails then had no legal
    // corridor at all and were routed across the text anyway. The renderer wraps
    // the tail to whatever channel is left, so the tail is negotiable; the head
    // is not.
    const boxes = [{
      x: Math.round(d > 0 ? mx + 10 : mx - 10 - LABEL_W),
      y: Math.round(my - LABEL_LINE - 4),
      w: LABEL_W, h: LABEL_LINE * 2 + LABEL_EC + 4,
    }];
    // Cofactor captions hang off the arc on the other side, at exactly the
    // radius chart-view.ts computes from the edge's own length.
    const len = r.points.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]) : 0), 0);
    const R = Math.max(12, Math.min(COFACTOR_R, len * 0.22));
    for (const [ids, top] of [[r.in, true], [r.out, false]]) {
      const w = labelRun(ids);
      if (!w) continue;
      boxes.push({
        x: Math.round(d > 0 ? mx - 4 - R - w : mx + 4 + R),
        y: Math.round(top ? my - R - 12 : my + R - 2),
        w, h: 14,
      });
    }
    return boxes;
  }

  /**
   * How far an enzyme name can actually run from its anchor before it meets
   * something — the compiler's copy of chart-view.ts's `channel()`, used for
   * measurement only. NAME_REACH is a full 34-character line, the longest run
   * the renderer sets before wrapping.
   */
  function labelReach(x, y, dir) {
    const NAME_REACH = 190;
    let limit = NAME_REACH;
    for (const o of nodes) {
      if (y + 2 < o.y || y - LABEL_LINE - 2 > o.y + o.h) continue;   // not on this band
      if (dir > 0 && o.x > x) limit = Math.min(limit, o.x - x - 5);
      else if (dir < 0 && o.x + o.w < x) limit = Math.min(limit, x - (o.x + o.w) - 5);
    }
    return Math.max(0, limit);
  }

  /** Rendered width of a cofactor caption ("NADPH + H+"). */
  function labelRun(ids) {
    if (!ids || !ids.length) return 0;
    return Math.round(ids.join(" + ").length * COFACTOR_CH + 10);
  }

  /**
   * Scaffolding is not chemistry, so it must not be drawn where chemistry is.
   * A branch anchor leaves its cell SIDEWAYS, which keeps the grey hairline off
   * the vertical flux stroke leaving the same cell — the two used to be laid
   * down on the same corridor and read as one striped arrow.
   */
  function routeScaffolds() {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const r of reactions) {
      if (r.kind !== "branch-link") continue;
      const from = byId.get(r.from), to = byId.get(r.to);
      if (from && to) r.points = routeScaffold(from, to, r.scaffoldDir || 1);
    }
  }

  function routeScaffold(from, to, dir) {
    const fcy = Math.round(from.y + from.h / 2), tcx = Math.round(to.x + to.w / 2);
    const above = to.y + to.h / 2 <= fcy;
    const enterY = above ? to.y + to.h : to.y;
    const cands = [];
    for (const s of [dir, -dir]) cands.push([[s < 0 ? from.x : from.x + from.w, fcy], [tcx, fcy], [tcx, enterY]]);
    // or drop out of the anchor's own face, but off-centre, so the hairline can
    // never lie on the flux stroke that leaves the same face
    const off = Math.round(Math.min(18, from.w / 2 - 8)) * dir;
    const fx = Math.round(from.x + from.w / 2 + off);
    const exitY = above ? from.y : from.y + from.h;
    cands.push([[fx, exitY], [fx, Math.round((exitY + enterY) / 2)], [tcx, Math.round((exitY + enterY) / 2)], [tcx, enterY]]);
    // best: clear of cells, off every flux stroke, and off the reserved text
    for (const raw of cands) {
      const p = simplifyRoute(raw);
      if (p && clear(p, from, to) && !shadowsFlux(p) && clearOfLabels(p, labelKeepOut)) return p;
    }
    for (const raw of cands) {
      const p = simplifyRoute(raw);
      if (p && clear(p, from, to) && !shadowsFlux(p)) return p;
    }
    for (const raw of cands) {
      const p = simplifyRoute(raw);
      if (p && clear(p, from, to)) return p;
    }
    return routeEdge(from, to);
  }

  /** Does this route lie ON a real reaction's stroke? Then it reads as one line. */
  function shadowsFlux(points) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      for (const r of reactions) {
        if (r.kind === "branch-link") continue;
        for (let j = 1; j < r.points.length; j++) {
          const c = r.points[j - 1], d = r.points[j];
          if (a[1] === b[1] && c[1] === d[1] && Math.abs(a[1] - c[1]) <= 6) {
            const ov = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
                     - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
            if (ov > 24) return true;
          }
          if (a[0] === b[0] && c[0] === d[0] && Math.abs(a[0] - c[0]) <= 6) {
            const ov = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
                     - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
            if (ov > 24) return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Two reactions declared in opposite directions between the same pair of cells
   * routed to byte-identical point lists — one line on screen, with every
   * midpoint-anchored decoration (name, EC, cofactor arcs, regulation landing)
   * collapsed onto the same coordinate. Give each its own shaft.
   */
  function splitSharedShafts() {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const groups = new Map();
    for (const r of reactions) {
      if (r.onRing) continue;
      const key = [r.from, r.to].sort().join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const grp of groups.values()) {
      if (grp.length < 2) continue;
      grp.forEach((r, i) => {
        const off = Math.round((i - (grp.length - 1) / 2) * 11);
        if (!off) return;
        const from = byId.get(r.from), to = byId.get(r.to);
        if (!from || !to) return;
        const a = r.points[0], b = r.points[r.points.length - 1];
        const vertical = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
        const moved = r.points.map(([x, y]) => (vertical ? [x + off, y] : [x, y + off]));
        if (clear(moved, from, to) && touchesCell(moved[0], from) && touchesCell(moved[moved.length - 1], to)) {
          r.points = moved;
        }
      });
    }
  }

  /**
   * A cell's name is set in rows at y = 12 + i*11 from its top, so the top strip
   * of the frame is caption, not free border. Push a ring chord's endpoint below
   * it rather than letting the arrow land in the middle of the word.
   */
  function clearOfCaption(p, n) {
    const floor = Math.round(Math.min(n.y + CAPTION_H, n.y + n.h - 8));
    if (p[1] >= floor) return p;
    if (p[0] <= n.x + 2 || p[0] >= n.x + n.w - 2) return [p[0], floor];   // slide down the side
    return [p[0] <= n.x + n.w / 2 ? n.x : n.x + n.w, floor];              // it came in over the top
  }

  /** The build gate's own test: an endpoint must land on the cell it claims. */
  function touchesCell(p, n) {
    return p[0] >= n.x - 10 && p[0] <= n.x + n.w + 10 && p[1] >= n.y - 10 && p[1] <= n.y + n.h + 10;
  }

  function railLen(pts) {
    return pts.reduce((a, p, i) =>
      i ? a + Math.abs(p[0] - pts[i - 1][0]) + Math.abs(p[1] - pts[i - 1][1]) : 0, 0);
  }

  /** A rail earns its ink only if it stays near the direct distance and its
   *  staple does not box in a big fraction of the sheet. */
  function acceptableRail(pts, direct) {
    if (railLen(pts) > Math.max(3 * COL_GAP, 2.4 * direct)) return false;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return area <= 0.14 * sheetArea();
  }

  function sheetArea() {
    if (sheetAreaCache) return sheetAreaCache;
    const w = Math.max(...nodes.map((n) => n.x + n.w)) - Math.min(...nodes.map((n) => n.x));
    const h = Math.max(...nodes.map((n) => n.y + n.h)) - Math.min(...nodes.map((n) => n.y));
    return (sheetAreaCache = Math.max(1, w * h));
  }
}

// The chart page's clear area at a 1500x1000 window, after the HUD insets that
// fit() applies. Only the ratio matters — it is what "Fit" scales against.
const VIEW_W = 1436, VIEW_H = 820;

/** The zoom "Fit" would choose: how large this sheet actually draws on the page. */
function fitScale(ir) {
  return Math.min(VIEW_W / ir.bounds.w, VIEW_H / ir.bounds.h);
}

/**
 * Rails whose staple boxes in a big fraction of the sheet. A dashed rectangle
 * that large stops reading as "A inhibits B" and starts reading as a region
 * border, so a fold that avoids one is worth preferring.
 */
function sprawlingRails(ir) {
  const sheet = Math.max(1, ir.bounds.w * ir.bounds.h);
  return (ir.regulation || []).filter((g) => {
    const xs = g.points.map((p) => p[0]), ys = g.points.map((p) => p[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return area > 0.2 * sheet;
  }).length;
}

/**
 * The defects the build gate rejects — overlapping cells, and a line drawn
 * through a cell it does not connect. Counted here so a candidate layout can be
 * discarded by the compiler instead of failing the build.
 */
function defects(ir) {
  let n = 0;
  const cells = ir.nodes;
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const p = cells[a], q = cells[b];
      if (!(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y)) n++;
    }
  }
  const through = (points, skip) => {
    for (let i = 1; i < points.length; i++) {
      const [p, q] = [points[i - 1], points[i]];
      const lo = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]) };
      const hi = { x: Math.max(p[0], q[0]), y: Math.max(p[1], q[1]) };
      if (hi.x - lo.x >= hi.y - lo.y) { lo.x += 6; hi.x -= 6; } else { lo.y += 6; hi.y -= 6; }
      if (hi.x < lo.x || hi.y < lo.y) continue;
      if (cells.some((c) => !skip(c) &&
        !(hi.x <= c.x || c.x + c.w <= lo.x || hi.y <= c.y || c.y + c.h <= lo.y))) return true;
    }
    return false;
  };
  for (const r of ir.reactions) if (through(r.points, (c) => c.id === r.from || c.id === r.to)) n++;
  for (const g of ir.regulation) if (through(g.points, (c) => c.metabolite === g.from || c.metabolite === g.to)) n++;
  return n;
}

export function compile(src, sizes = {}) {
  const ast = parse(src);
  // How tightly to fold a chain cannot be read off one chain in isolation: the
  // spine, its branches and the effector gutter all compete for the same width,
  // so a fold that squares up the spine can still leave a 3:1 sheet. Lay the
  // whole sheet out at several fold densities and keep the one that measures
  // best — largest at "Fit", and free of the defects the build rejects.
  // `wrap N` is the author pinning the fold by hand; every candidate would come
  // back identical, so take it as given.
  if (ast.wrap != null) return layout(ast, sizes);
  let best = null, lastErr = null;
  for (const fold of [null, 2.4, 1.7, 1.2, 0.85, 0.6, 0.42, 0.3, 0.21]) {
    let ir;
    try { ir = layout(ast, sizes, fold); } catch (e) { lastErr = e; continue; }
    // Correctness first; then declared regulation that could not be drawn at all;
    // then page use, with a light preference for the fold that keeps a regulation
    // as a drawn rail rather than degrading it to a tag.
    const score = fitScale(ir)
      - defects(ir) * 1000
      - (ir.unrouted?.length || 0) * 0.25
      - sprawlingRails(ir) * 0.2
      + ir.regulation.length * 0.006;
    if (!best || score > best.score) best = { ir, score };
  }
  if (!best) throw lastErr;
  return best.ir;
}

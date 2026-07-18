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
export function layout(ast) {
  const spineOriginX = () => (ast.spine || ast.cycle || { at: { x: 0 } }).at.x;
  const nodes = [];      // metabolite cells
  const reactions = [];  // reaction steps (arrow + enzyme label + cofactors)
  const byMetabolite = new Map(); // metabolite id -> node (first placement wins)

  // Occupancy map — nothing may overlap anything else. Cells claim a rectangle
  // (plus a gutter for the name above and labels beside) before they are placed.
  const placed = [];
  const GUTTER_X = 62;  // room for enzyme names / cofactor labels beside a cell
  const GUTTER_Y = 14;  // clear paper between stacked cells

  function hits(r) {
    return placed.some((p) =>
      !(r.x + r.w + GUTTER_X <= p.x || p.x + p.w + GUTTER_X <= r.x ||
        r.y + r.h + GUTTER_Y <= p.y || p.y + p.h + GUTTER_Y <= r.y));
  }
  /** Slide horizontally (in `dir`) until the cell no longer collides. */
  function freeX(x, y, dir) {
    let cx = x;
    for (let i = 0; i < 40 && hits({ x: cx, y, w: NODE_W, h: NODE_H }); i++) cx += dir * COL_GAP;
    return cx;
  }
  function claim(node) { placed.push({ x: node.x, y: node.y, w: node.w, h: node.h }); return node; }

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
    const x = freeX(outsideCore(outsideRing((anchor ? anchor.x : 0) + dir * COL_GAP, dir), dir), y, dir);
    placeChain(b.chain, x, y, `branch:${b.from}:${b.side}`);
    // connect the anchor into the first node of the branch with an orthogonal elbow
    const first = b.chain.steps.find((s) => s.kind === "metabolite");
    const target = first && byMetabolite.get(first.id);
    if (anchor && target) {
      reactions.push({
        id: `${ast.id}__branchlink__${b.from}__${first.id}`,
        kind: "branch-link", enzyme: null, ec: null, reversible: true,
        from: anchor.id, to: target.id,
        points: routeEdge(anchor, target),
        in: [], out: [], flags: [],
      });
    }
  }

  // Effectors that only appear as regulators (citrate, AMP, F2,6BP …) are not on
  // any chain, so give them their own gutter column to the left of the pathway.
  const spineX = (ast.spine || ast.cycle).at.x;
  const branchLeft = ast.branches.some((b) => b.side === "left");
  const effDir = branchLeft ? 1 : -1;   // put effectors opposite the branches
  const effectorsNeeded = ast.regulation.filter((r) => !byMetabolite.has(r.from))
    .map((r) => r.from).filter((v, i, a) => a.indexOf(v) === i);
  const effRows = Math.max(3, Math.ceil(Math.sqrt(effectorsNeeded.length * 1.4)));
  const effBaseX = outsideCore(outsideRing(spineX + effDir * COL_GAP, effDir), effDir);
  const effBaseY = (ast.spine || ast.cycle).at.y;
  effectorsNeeded.forEach((id, i) => {
    const col = Math.floor(i / effRows), row = i % effRows;
    const x = freeX(effBaseX + effDir * col * COL_GAP, effBaseY + row * ast.spacing, effDir);
    const node = {
      id: `${ast.id}:${id}`, metabolite: id,
      x, y: effBaseY + row * ast.spacing, lane: "effector", w: NODE_W, h: NODE_H,
    };
    nodes.push(claim(node));
    byMetabolite.set(id, node);
  });

  repairBlockedRoutes();

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
        blocker.x += dir * Math.round(COL_GAP * 0.75);
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
  // count first, so each regulator can be given its own landing point along the edge
  const targetCount = new Map();
  for (const r of ast.regulation) targetCount.set(r.to, (targetCount.get(r.to) || 0) + 1);
  const perTarget = new Map(); // fan out lines that share a target so they never coincide
  for (const r of ast.regulation) {
    const src = byMetabolite.get(r.from);
    const dstRxn = reactions.find((x) => x.enzyme === r.to);
    const dst = dstRxn || byMetabolite.get(r.to);
    if (!src || !dst) continue;
    const n = perTarget.get(r.to) || 0;
    perTarget.set(r.to, n + 1);
    regulation.push({
      effect: r.effect, kind: r.kind, from: r.from, to: r.to,
      points: regulationRoute(src, dst, n, targetCount.get(r.to) || 1),
      glyph: r.effect === "inhibit" ? "inhibit" : "activate",
    });
  }

  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const pad = 44;
  const minX = Math.min(...xs, 0) - pad, minY = Math.min(...ys, 0) - pad;
  const maxX = Math.max(...xs, 0) + NODE_W + pad, maxY = Math.max(...ys, 0) + NODE_H + pad;

  return {
    id: ast.id, title: ast.title, grid: ast.grid,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    nodes, reactions, regulation,
  };

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
        node = { id: `${ast.id}:${step.id}`, metabolite: step.id, x, y, lane: "cycle", w: NODE_W, h: NODE_H };
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

  function placeChain(chain, x0, y0, lane) {
    const metCount = chain.steps.filter((s) => s.kind === "metabolite").length;
    // choose a row count that makes the block roughly square in real units
    const rows = lane !== "spine" ? Infinity
      : ast.wrap === 0 ? Infinity
      : ast.wrap ? ast.wrap
      : metCount > 6 ? Math.max(3, Math.round(Math.sqrt((metCount * COL_GAP) / ast.spacing)))
      : Infinity;
    let placedInCol = 0, col = 0;
    let y = y0;
    let prevNode = null;
    let pendingReaction = null;
    for (const step of chain.steps) {
      if (step.kind === "metabolite") {
        if (placedInCol >= rows) {          // wrap to the next column, reversing flow
          col++; placedInCol = 0;
          y = col % 2 === 0 ? y0 : y0 + (rows - 1) * ast.spacing;
        }
        let node = byMetabolite.get(step.id);
        const colX = x0 + col * COL_GAP;
        if (!node) {
          const dir = lane === "spine" ? 1 : (x0 < spineOriginX() ? -1 : 1);
          const nx = lane === "spine" ? colX : freeX(colX, y, dir);
          node = { id: `${ast.id}:${step.id}`, metabolite: step.id, x: nx, y, lane, w: NODE_W, h: NODE_H };
          nodes.push(claim(node));
          byMetabolite.set(step.id, node);
        }
        if (pendingReaction && prevNode) {
          finishReaction(pendingReaction, prevNode, node);
          pendingReaction = null;
        }
        prevNode = node;
        placedInCol++;
        y += (col % 2 === 0 ? 1 : -1) * ast.spacing;
      } else {
        pendingReaction = step;
      }
    }
  }

  function finishReaction(step, from, to, onRing = false) {
    if (onRing) {
      const fx = from.x + NODE_W / 2, fy = from.y + NODE_H / 2;
      const tx2 = to.x + NODE_W / 2, ty2 = to.y + NODE_H / 2;
      const dx = tx2 - fx, dy = ty2 - fy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const inset = NODE_H * 0.62;
      reactions.push({
        id: `${ast.id}__${step.enzyme}__${from.metabolite}__${to.metabolite}`,
        kind: "flux", enzyme: step.enzyme, ec: step.ec, reversible: step.reversible,
        committed: step.flags.includes("committed") || step.flags.includes("irreversible"),
        from: from.id, to: to.id,
        onRing: true,
        points: [[Math.round(fx + ux * inset), Math.round(fy + uy * inset)],
                 [Math.round(tx2 - ux * inset), Math.round(ty2 - uy * inset)]],
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
    const fcx = from.x + NODE_W / 2, fcy = from.y + NODE_H / 2;
    const tcx = to.x + NODE_W / 2, tcy = to.y + NODE_H / 2;
    const dx = tcx - fcx, dy = tcy - fcy;

    if (Math.abs(dx) < 10) {                       // same column -> straight vertical
      const direct = dy >= 0
        ? [[fcx, from.y + NODE_H], [fcx, to.y]]
        : [[fcx, from.y], [fcx, to.y + NODE_H]];
      return clear(direct, from, to) ? direct : detourX(from, to);
    }
    if (Math.abs(dy) < 10) {                       // same row -> straight horizontal
      const direct = dx >= 0
        ? [[from.x + NODE_W, fcy], [to.x, fcy]]
        : [[from.x, fcy], [to.x + NODE_W, fcy]];
      return clear(direct, from, to) ? direct : detourY(from, to);
    }
    // offset -> leave vertically, cross in the gutter between the rows, enter vertically
    const exitY = dy >= 0 ? from.y + NODE_H : from.y;
    const entryY = dy >= 0 ? to.y : to.y + NODE_H;
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
    const fcx = from.x + NODE_W / 2, tcx = to.x + NODE_W / 2;
    for (const step of [46, 96, 148, 202, 262]) {
      const above = Math.min(from.y, to.y) - step;
      const below = Math.max(from.y + NODE_H, to.y + NODE_H) + step;
      for (const [lane, fromEdge, toEdge] of [[above, from.y, to.y], [below, from.y + NODE_H, to.y + NODE_H]]) {
        const pts = [[fcx, fromEdge], [fcx, lane], [tcx, lane], [tcx, toEdge]];
        if (clear(pts, from, to)) return pts;
      }
    }
    // Last resort: find a horizontal band that is actually clear across the span.
    const band = clearBandY(fcx, tcx, (from.y + to.y) / 2, from, to);
    const exit = band < from.y ? from.y : from.y + NODE_H;
    const entry = band < to.y ? to.y : to.y + NODE_H;
    return [[fcx, exit], [fcx, band], [tcx, band], [tcx, entry]];
  }

  /** Route left/right of the obstructing column. */
  function detourX(from, to) {
    const fcy = from.y + NODE_H / 2, tcy = to.y + NODE_H / 2;
    for (const step of [56, 112, 172, 236, 300]) {
      const left = Math.min(from.x, to.x) - step;
      const right = Math.max(from.x + NODE_W, to.x + NODE_W) + step;
      for (const [lane, fromEdge, toEdge] of [[right, from.x + NODE_W, to.x + NODE_W], [left, from.x, to.x]]) {
        const pts = [[fromEdge, fcy], [lane, fcy], [lane, tcy], [toEdge, tcy]];
        if (clear(pts, from, to)) return pts;
      }
    }
    const far = Math.max(...nodes.map((n) => n.x + n.w), from.x + NODE_W) + 64;
    return [[from.x + NODE_W, fcy], [far, fcy], [far, tcy], [to.x + NODE_W, tcy]];
  }

  /** Right-angle elbow between two cells (never diagonal). */
  function elbow(a, b) {
    const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
    const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
    const midY = (ay + by) / 2;
    return [[ax, ay], [ax, midY], [bx, midY], [bx, by]];
  }

  /** Regulation runs out to a gutter beside the column, then back in. */
  function regulationRoute(src, dst, index = 0, total = 1) {
    const sx = src.x + NODE_W / 2, sy = src.y + NODE_H / 2;
    // land each regulator at its own fraction along the target edge
    let dx, dy;
    if (dst.points) {
      const a = dst.points[0], b = dst.points[dst.points.length - 1];
      const f = (index + 1) / (total + 1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      dx = Math.round(a[0] + (b[0] - a[0]) * f);
      dy = Math.round(a[1] + (b[1] - a[1]) * f);
      // a short edge cannot separate many regulators along its length alone —
      // step them off the edge as well so the glyphs never pile up
      if (len < total * 26) {
        const px = -(b[1] - a[1]) / len, py = (b[0] - a[0]) / len;
        const off = (index - (total - 1) / 2) * 24;
        dx = Math.round(dx + px * off);
        dy = Math.round(dy + py * off);
      }
    } else {
      dx = dst.x + NODE_W / 2;
      dy = dst.y + NODE_H / 2;
    }
    const goesLeft = sx <= dx;
    // stagger the gutter and the approach height so co-targeted lines stay distinct
    const spread = index * 26;
    const gutter = goesLeft ? Math.min(src.x, dx) - 70 - spread : Math.max(src.x + NODE_W, dx) + 70 + spread;
    return [[sx, sy], [gutter, sy], [gutter, dy], [dx, dy]];
  }
}

export function compile(src) {
  return layout(parse(src));
}

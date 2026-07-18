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
const NODE_H = 96;    // metabolite cell height (structure box; name sits above)
const COL_GAP = 260;  // horizontal gap between spine and a branch column
const DEFAULT_SPACING = 210; // vertical distance between consecutive metabolites

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

  const ast = { id, title, grid: null, spacing: DEFAULT_SPACING, spine: null, branches: [], regulation: [] };

  while (peek() && peek() !== "}") {
    const kw = next();
    if (kw === "grid") ast.grid = next();
    else if (kw === "spacing") ast.spacing = Number(next());
    else if (kw === "spine") ast.spine = parseChain();
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
  const nodes = [];      // metabolite cells
  const reactions = [];  // reaction steps (arrow + enzyme label + cofactors)
  const byMetabolite = new Map(); // metabolite id -> node (first placement wins)

  // Occupancy map — nothing may overlap anything else. Cells claim a rectangle
  // (plus a gutter for the name above and labels beside) before they are placed.
  const placed = [];
  const GUTTER_X = 96;  // room for enzyme names / cofactor labels beside a cell
  const GUTTER_Y = 26;  // room for the metabolite name drawn above the box

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

  placeChain(ast.spine, ast.spine.at.x, ast.spine.at.y, "spine");

  for (const b of ast.branches) {
    const anchor = byMetabolite.get(b.from);
    const dir = b.side === "left" ? -1 : 1;
    const y = (anchor ? anchor.y : 0) + ast.spacing;
    const x = freeX((anchor ? anchor.x : 0) + dir * COL_GAP, y, dir);
    placeChain(b.chain, x, y, `branch:${b.from}:${b.side}`);
    // connect the anchor into the first node of the branch with an orthogonal elbow
    const first = b.chain.steps.find((s) => s.kind === "metabolite");
    const target = first && byMetabolite.get(first.id);
    if (anchor && target) {
      reactions.push({
        id: `${ast.id}__branchlink__${b.from}__${first.id}`,
        kind: "branch-link", enzyme: null, ec: null, reversible: true,
        from: anchor.id, to: target.id,
        points: elbow(anchor, target),
        in: [], out: [], flags: [],
      });
    }
  }

  // Effectors that only appear as regulators (citrate, AMP, F2,6BP …) are not on
  // any chain, so give them their own gutter column to the left of the pathway.
  const spineX = ast.spine.at.x;
  const branchLeft = ast.branches.some((b) => b.side === "left");
  const effDir = branchLeft ? 1 : -1;   // put effectors opposite the branches
  let effectorY = ast.spine.at.y + ast.spacing;
  for (const r of ast.regulation) {
    if (byMetabolite.has(r.from)) continue;
    const x = freeX(spineX + effDir * COL_GAP, effectorY, effDir);
    const node = {
      id: `${ast.id}:${r.from}`, metabolite: r.from,
      x, y: effectorY, lane: "effector", w: NODE_W, h: NODE_H,
    };
    nodes.push(claim(node));
    byMetabolite.set(r.from, node);
    effectorY += Math.round(ast.spacing * 0.9);
  }

  // regulation routed around the outside of the column it targets
  const regulation = [];
  for (const r of ast.regulation) {
    const src = byMetabolite.get(r.from);
    const dstRxn = reactions.find((x) => x.enzyme === r.to);
    const dst = dstRxn || byMetabolite.get(r.to);
    if (!src || !dst) continue;
    regulation.push({
      effect: r.effect, kind: r.kind, from: r.from, to: r.to,
      points: regulationRoute(src, dst),
      glyph: r.effect === "inhibit" ? "inhibit" : "activate",
    });
  }

  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const pad = 140;
  const minX = Math.min(...xs, 0) - pad, minY = Math.min(...ys, 0) - pad;
  const maxX = Math.max(...xs, 0) + NODE_W + pad, maxY = Math.max(...ys, 0) + NODE_H + pad;

  return {
    id: ast.id, title: ast.title, grid: ast.grid,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    nodes, reactions, regulation,
  };

  function placeChain(chain, x0, y0, lane) {
    let y = y0;
    let prevNode = null;
    let pendingReaction = null;
    for (const step of chain.steps) {
      if (step.kind === "metabolite") {
        let node = byMetabolite.get(step.id);
        if (!node) {
          const dir = lane === "spine" ? 1 : (x0 < ast.spine.at.x ? -1 : 1);
          const nx = lane === "spine" ? x0 : freeX(x0, y, dir);
          node = { id: `${ast.id}:${step.id}`, metabolite: step.id, x: nx, y, lane, w: NODE_W, h: NODE_H };
          nodes.push(claim(node));
          byMetabolite.set(step.id, node);
        }
        if (pendingReaction && prevNode) {
          finishReaction(pendingReaction, prevNode, node);
          pendingReaction = null;
        }
        prevNode = node;
        y += ast.spacing;
      } else {
        pendingReaction = step;
      }
    }
  }

  function finishReaction(step, from, to) {
    const x = from.x + NODE_W / 2;
    reactions.push({
      id: `${ast.id}__${step.enzyme}__${from.metabolite}__${to.metabolite}`,
      kind: "flux",
      enzyme: step.enzyme, ec: step.ec, reversible: step.reversible,
      committed: step.flags.includes("committed") || step.flags.includes("irreversible"),
      from: from.id, to: to.id,
      points: [[x, from.y + NODE_H], [x, to.y]],
      in: step.in, out: step.out, flags: step.flags,
      // cofactors enter/leave on alternating sides of the arrow
      side: (reactions.length % 2 === 0) ? "right" : "left",
    });
  }

  /** Right-angle elbow between two cells (never diagonal). */
  function elbow(a, b) {
    const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
    const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
    const midY = (ay + by) / 2;
    return [[ax, ay], [ax, midY], [bx, midY], [bx, by]];
  }

  /** Regulation runs out to a gutter beside the column, then back in. */
  function regulationRoute(src, dst) {
    const sx = src.x + NODE_W / 2, sy = src.y + NODE_H / 2;
    const dx = (dst.points ? dst.points[0][0] : dst.x + NODE_W / 2);
    const dy = (dst.points ? (dst.points[0][1] + dst.points[1][1]) / 2 : dst.y + NODE_H / 2);
    const goesLeft = sx <= dx;
    const gutter = goesLeft ? Math.min(src.x, dx) - 70 : Math.max(src.x + NODE_W, dx) + 70;
    return [[sx, sy], [gutter, sy], [gutter, dy], [dx, dy]];
  }
}

export function compile(src) {
  return layout(parse(src));
}

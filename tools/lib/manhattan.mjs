// Manhattan (rectilinear) cell outlines — the poster's boxes are not rectangles.
//
// From the extracted spec: "Rectilinear Manhattan POLYGON, not necessarily a
// rectangle. It tightly wraps the drawn formula and STEPS in/out to admit
// irregular substituents. Adjacent boxes tessellate with only 10-20 px of clear
// paper."
//
// Two producers:
//   inkExtent()      — the true drawn extent of an RDKit SVG, so a cell can be
//                      sized to its molecule's ink instead of the canvas RDKit
//                      happened to emit (most of which is whitespace).
//   outlineFromRows() — the stepped outline of a condensed Fischer column, whose
//                      rows differ in width; this is where the stepping reads.

/** Parse the drawn coordinates out of an RDKit SVG and return the ink bounds. */
export function inkExtent(svg) {
  const xs = [], ys = [];
  const push = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  };
  for (const m of svg.matchAll(/<path[^>]*\sd=['"]([^'"]+)['"]/g)) {
    for (const c of m[1].matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)) {
      push(Number(c[1]), Number(c[2]));
    }
  }
  for (const m of svg.matchAll(/<line[^>]*x1=['"](-?[\d.]+)['"][^>]*y1=['"](-?[\d.]+)['"][^>]*x2=['"](-?[\d.]+)['"][^>]*y2=['"](-?[\d.]+)['"]/g)) {
    push(Number(m[1]), Number(m[2])); push(Number(m[3]), Number(m[4]));
  }
  for (const m of svg.matchAll(/<text[^>]*\sx=['"](-?[\d.]+)['"][^>]*\sy=['"](-?[\d.]+)['"]/g)) {
    push(Number(m[1]), Number(m[2]));
  }
  if (xs.length < 2) return null;
  const vb = svg.match(/viewBox=['"]([^'"]+)['"]/);
  const view = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : null;
  const pad = 6;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  return {
    x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
    view: view && view.length === 4 ? { x: view[0], y: view[1], w: view[2], h: view[3] } : null,
  };
}

/**
 * Stepped outline for a condensed column. Each row gets its own width, so the
 * box juts out for a wide row (CH2OPO3) and notches in for a narrow one (CH3) —
 * exactly the stepping the poster shows.
 */
export function outlineFromRows(rows, opts = {}) {
  const { charW = 7.2, rowH = 13, padX = 7, padY = 6, minW = 34, nameW = 0, nameH = 0 } = opts;
  if (!rows?.length) return null;
  const widths = rows.map((r) => Math.max(minW, r.length * charW + padX * 2));
  const maxW = Math.max(...widths, nameW);
  const cx = maxW / 2;

  // y band for each row
  const bands = [];
  let y = nameH;
  for (let i = 0; i < rows.length; i++) {
    const h = rowH + (i === rows.length - 1 ? padY : 0);
    bands.push({ y0: y, y1: y + h, half: widths[i] / 2 });
    y += h;
  }
  const bottom = y;

  const pts = [];
  // name band spans the full width
  pts.push([0, 0], [maxW, 0], [maxW, nameH]);
  // down the right edge, stepping per row
  for (const b of bands) pts.push([cx + b.half, b.y0], [cx + b.half, b.y1]);
  // across the bottom
  pts.push([cx - bands[bands.length - 1].half, bottom]);
  // back up the left edge
  for (let i = bands.length - 1; i >= 0; i--) {
    pts.push([cx - bands[i].half, bands[i].y1], [cx - bands[i].half, bands[i].y0]);
  }
  pts.push([0, nameH]);
  return pts.map(([px, py]) => [Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
}

/** SVG points attribute for a polygon. */
export function toPoints(poly) {
  return poly.map((p) => p.join(",")).join(" ");
}

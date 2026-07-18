// Condensed structural formulas — Michal's Fischer-column notation.
//
// Small acyclic metabolites are drawn on the poster as a vertical column of atom
// text (COOH / C=O / CH3) rather than a skeletal drawing. That notation is far
// more compact, which is a large part of how the sheet reaches its density.
//
// SAFETY: a generated column is only returned if its atoms sum EXACTLY to the
// molecule's own formula. Anything we cannot reconstruct faithfully returns null
// and the caller falls back to the RDKit skeletal drawing. This must never
// invent chemistry.

/** Minimal SMILES reader for acyclic, non-aromatic molecules. Returns null otherwise. */
export function parseSimpleSmiles(smiles) {
  if (!smiles || /[0-9]/.test(smiles.replace(/[+-]\d?|\[\d+/g, "")) ) {
    // digits outside charges/isotopes indicate ring closures
    if (/%|[1-9](?![-+])/.test(smiles.replace(/\[[^\]]*\]/g, (m) => m.replace(/\d/g, "")))) return null;
  }
  if (/[a-z]/.test(smiles.replace(/\[[^\]]*\]/g, ""))) return null; // aromatic lowercase
  if (/[@]/.test(smiles)) { /* stereo is fine, we ignore it */ }

  const atoms = [];
  const stack = [];
  let prev = -1;
  let bond = 1;
  let i = 0;
  while (i < smiles.length) {
    const ch = smiles[i];
    if (ch === "(") { stack.push(prev); i++; continue; }
    if (ch === ")") { prev = stack.pop(); i++; continue; }
    if (ch === "=") { bond = 2; i++; continue; }
    if (ch === "#") { bond = 3; i++; continue; }
    if (ch === "/" || ch === "\\" || ch === "-") { i++; continue; }
    if (ch === "[") {
      const end = smiles.indexOf("]", i);
      if (end < 0) return null;
      const inner = smiles.slice(i + 1, end);
      const m = inner.match(/^(\d*)([A-Z][a-z]?)(@{0,2})(H(\d*))?([+-]\d?|[+-]+)?$/);
      if (!m) return null;
      const el = m[2];
      const hs = m[4] ? (m[5] ? Number(m[5]) : 1) : 0;
      let charge = 0;
      if (m[6]) {
        const c = m[6];
        charge = /^[+-]\d$/.test(c) ? Number(c) : (c[0] === "+" ? c.length : -c.length);
      }
      atoms.push({ el, hs, charge, bonds: [], explicitH: !!m[4] });
      if (prev >= 0) { atoms[prev].bonds.push({ to: atoms.length - 1, order: bond }); atoms[atoms.length - 1].bonds.push({ to: prev, order: bond }); }
      prev = atoms.length - 1; bond = 1; i = end + 1; continue;
    }
    const two = smiles.slice(i, i + 2);
    const el = /^(Cl|Br)$/.test(two) ? two : ch;
    if (!/^[BCNOPSFI]|Cl|Br$/.test(el)) return null;
    atoms.push({ el, hs: null, charge: 0, bonds: [], explicitH: false });
    if (prev >= 0) { atoms[prev].bonds.push({ to: atoms.length - 1, order: bond }); atoms[atoms.length - 1].bonds.push({ to: prev, order: bond }); }
    prev = atoms.length - 1; bond = 1; i += el.length;
  }
  if (!atoms.length) return null;
  // ring closure would leave a cycle; a tree has edges = nodes - 1
  const edges = atoms.reduce((s, a) => s + a.bonds.length, 0) / 2;
  if (edges !== atoms.length - 1) return null;

  // implicit hydrogens by standard valence
  const VAL = { C: 4, N: 3, O: 2, P: 5, S: 2, F: 1, Cl: 1, Br: 1, I: 1, B: 3 };
  for (const a of atoms) {
    if (a.hs !== null) continue;
    const used = a.bonds.reduce((s, b) => s + b.order, 0);
    a.hs = Math.max(0, (VAL[a.el] ?? 0) - used + (a.charge > 0 && a.el === "N" ? 1 : 0));
  }
  return atoms;
}

/** Molecular formula (as a count map) implied by a parsed atom list. */
export function formulaOf(atoms) {
  const f = {};
  for (const a of atoms) {
    f[a.el] = (f[a.el] || 0) + 1;
    if (a.hs) f.H = (f.H || 0) + a.hs;
  }
  return f;
}

const groupText = (a, atoms) => {
  // substituent text for a non-backbone neighbour
  const el = a.el;
  if (el === "O") {
    if (a.charge < 0) return "O⁻";
    return a.hs > 0 ? "OH" : "O";
  }
  if (el === "N") return a.hs >= 2 ? "NH₂" : a.hs === 1 ? "NH" : "N";
  if (el === "S") return a.hs > 0 ? "SH" : "S";
  if (el === "P") return "P";
  return el;
};

/**
 * Render an acyclic molecule as Fischer-style rows.
 * Returns { rows: string[] } or null when it cannot be done faithfully.
 */
export function condensedRows(smiles, maxHeavy = 12) {
  const atoms = parseSimpleSmiles(smiles);
  if (!atoms) return null;
  if (atoms.length > maxHeavy) return null;

  const carbons = atoms.map((a, i) => ({ a, i })).filter((x) => x.a.el === "C");
  if (!carbons.length || carbons.length > 8) return null;

  // longest carbon path (the backbone), via BFS from each carbon
  const cAdj = new Map(carbons.map((c) => [c.i, c.a.bonds.filter((b) => atoms[b.to].el === "C").map((b) => b.to)]));
  let best = [];
  for (const start of cAdj.keys()) {
    const seen = new Set([start]);
    const path = [];
    (function walk(n, acc) {
      acc.push(n);
      if (acc.length > best.length) best = [...acc];
      for (const nb of cAdj.get(n) || []) {
        if (seen.has(nb)) continue;
        seen.add(nb); walk(nb, acc); seen.delete(nb);
      }
      acc.pop();
    })(start, path);
  }
  if (!best.length) return null;

  const used = new Set(best);
  const rows = [];
  for (const ci of best) {
    const a = atoms[ci];
    const subs = a.bonds.filter((b) => !used.has(b.to));
    // classify the carbon
    const dblO = subs.find((b) => b.order === 2 && atoms[b.to].el === "O");
    const singleO = subs.filter((b) => b.order === 1 && atoms[b.to].el === "O");
    let text;
    if (dblO && singleO.length === 1 && atoms[singleO[0].to].bonds.length === 1) {
      text = atoms[singleO[0].to].charge < 0 ? "COO⁻" : "COOH";
      singleO.forEach((b) => used.add(b.to));
      used.add(dblO.to);
    } else if (dblO) {
      text = a.hs ? "CHO" : "C=O";
      used.add(dblO.to);
    } else {
      const parts = subs.map((b) => { used.add(b.to); return groupText(atoms[b.to], atoms); });
      const h = a.hs ? (a.hs > 1 ? `H${a.hs === 2 ? "₂" : "₃"}` : "H") : "";
      text = `C${h}${parts.join("")}`;
    }
    rows.push(text);
  }

  // any heavy atom we never accounted for means the column is not faithful
  const accounted = new Set([...used]);
  for (const ci of best) accounted.add(ci);
  if (atoms.some((a, i) => !accounted.has(i))) return null;

  return { rows };
}

// Mass- and charge-balance checking for reactions. A citation-grounded atlas
// should conserve atoms and charge; this catches curation errors mechanically
// (e.g. a metabolite formula written as the neutral acid while its charge is the
// physiological anion). Used by the validator as a warning-level report.

/** Parse a molecular formula like "C6H12O6" or "HO4P" into element counts. Returns null if unparseable. */
export function parseFormula(formula) {
  if (!formula || typeof formula !== "string") return null;
  const f = formula.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9()]+$/.test(f) || /[()]/.test(f)) return f && /^[A-Z]/.test(f) ? parseFlat(f) : null;
  return parseFlat(f);
}

function parseFlat(f) {
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(f))) {
    if (m[0] === "") break;
    counts[m[1]] = (counts[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
    consumed += m[0].length;
  }
  return consumed === f.length ? counts : null;
}

/**
 * Check one reaction for mass + charge balance using the module's metabolite table.
 * Returns { checkable, massOk, chargeOk, massDiff, chargeDiff } — checkable=false when
 * a participant lacks a parseable formula (we don't guess).
 */
export function checkReaction(reaction, metById) {
  const side = (parts, sign) => {
    for (const p of parts || []) {
      const met = metById.get(p.metabolite);
      const stoich = p.stoichiometry ?? 1;
      if (!met || !met.formula) return false;
      const parsed = parseFormula(met.formula);
      if (!parsed) return false;
      for (const [el, n] of Object.entries(parsed)) mass[el] = (mass[el] || 0) + sign * n * stoich;
      if (typeof met.charge === "number") charge += sign * met.charge * stoich;
      else chargeKnown = false;
    }
    return true;
  };
  const mass = {};
  let charge = 0;
  let chargeKnown = true;

  if (!side(reaction.substrates, 1) || !side(reaction.products, -1)) {
    return { checkable: false };
  }
  const massDiff = Object.fromEntries(Object.entries(mass).filter(([, v]) => v !== 0));
  return {
    checkable: true,
    massOk: Object.keys(massDiff).length === 0,
    chargeOk: chargeKnown ? charge === 0 : null,
    massDiff,
    chargeDiff: chargeKnown ? charge : null,
  };
}

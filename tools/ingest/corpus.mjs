// Turn the Rhea + ChEBI bulk downloads into a normalised reaction corpus.
//
// This is the ingestion half of the atlas: 27 hand-authored modules carry ~345
// reactions, and hand-authoring will not reach the density a Roche-style sheet
// needs. Rhea supplies ~18,600 expert-curated reactions, every participant is a
// ChEBI identifier, and each reaction is curated to balance — which is exactly
// what tools/validate.mjs already checks. Both sources are CC-BY, so the result
// stays citable rather than fabricated, per the project's first rule.
//
// Nothing here writes pathway modules; it produces the vetted corpus that
// build-modules.mjs draws from. Kept separate so the expensive parse runs once
// and the module-shaping decisions can be re-run freely.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "data", "ingest");

/** Ubiquitous species. They are cofactors/currency, never the carbon skeleton a
 *  sheet follows, so they must not count when deciding what a reaction is ABOUT
 *  or when chaining reactions into a spine — every reaction touches ATP or water
 *  and chaining on those would connect the entire corpus into one hairball. */
export const CURRENCY = new Set([
  "15377", "16234", "15378", "29101", "29103", "15379", "16240", "16526", "17544",
  "15361", "43474", "18367", "29888", "456216", "30616", "456215", "58189", "57540",
  "57945", "58349", "57783", "18009", "16908", "57692", "58307", "57288", "57287",
  "15346", "29325", "29033", "29034", "18420", "29105", "60240", "597326", "30413",
  "17996", "29191", "26078", "15858", "37565", "61429", "58115", "17552", "16750",
  "17659", "61404", "58223", "16174", "16039",
]);

/** ChEBI writes stereo- and locant markers as HTML: "(<i>R</i>)-linalool",
 *  "<small>L</small>-saccharopinate". Left in, those tags survive slugging as
 *  "i-r-i-linalool" and "small-l-small-saccharopinate" — unreadable as a name and
 *  worse as a module id. Strip the tags, keep the letter they wrap. */
export function cleanName(raw) {
  return String(raw || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m] || m))
    .replace(/\s+/g, " ")
    .trim();
}

/** ChEBI id -> { name, formula, charge }. Formula and charge are what the mass
 *  and charge balance validators need; a participant lacking either is a class
 *  ("a primary alcohol"), not a compound, and its reaction cannot be checked. */
export function chebiTable() {
  const compounds = join(DIR, "compounds.tsv");
  const chem = join(DIR, "chemical_data.tsv");
  if (!existsSync(compounds) || !existsSync(chem)) {
    throw new Error("Missing data/ingest/*.tsv — run tools/ingest/fetch.sh first.");
  }

  // compounds.tsv: internal id -> accession + display name, and a star rating
  // (3 = fully curated by ChEBI, lower = automatic). Keep the mapping by
  // INTERNAL id because chemical_data.tsv joins on that, not on the accession.
  const byInternal = new Map();
  const lines = readFileSync(compounds, "utf8").split("\n");
  const head = lines[0].split("\t");
  const cId = head.indexOf("id"), cName = head.indexOf("name");
  const cAcc = head.indexOf("chebi_accession"), cStars = head.indexOf("stars");
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split("\t");
    if (f.length < 3) continue;
    const acc = (f[cAcc] || "").replace("CHEBI:", "");
    if (!acc) continue;
    byInternal.set(f[cId], { chebi: acc, name: cleanName(f[cName]), stars: Number(f[cStars] || 0) });
  }

  const out = new Map();
  const cl = readFileSync(chem, "utf8").split("\n");
  const ch = cl[0].split("\t");
  const dCompound = ch.indexOf("compound_id"), dFormula = ch.indexOf("formula"), dCharge = ch.indexOf("charge");
  for (let i = 1; i < cl.length; i++) {
    const f = cl[i].split("\t");
    if (f.length < 4) continue;
    const c = byInternal.get(f[dCompound]);
    if (!c) continue;
    const formula = (f[dFormula] || "").trim();
    const charge = f[dCharge] === "" ? null : Number(f[dCharge]);
    const prev = out.get(c.chebi);
    // A compound can carry several rows (different structure records). Prefer a
    // row that actually has a formula, and never let a later blank overwrite one.
    if (prev?.formula && !formula) continue;
    out.set(c.chebi, { name: c.name, stars: c.stars, formula: formula || prev?.formula || "", charge: charge ?? prev?.charge ?? null });
  }
  // Names exist for compounds with no chemical_data row at all; keep them so a
  // participant can still be named even when it cannot be balance-checked.
  for (const c of byInternal.values()) {
    if (!out.has(c.chebi)) out.set(c.chebi, { name: c.name, stars: c.stars, formula: "", charge: null });
  }
  return out;
}

/**
 * Parse one side of a Rhea equation into { coefficient, label } terms.
 * Rhea writes "2 H2O", "a primary alcohol", "n ATP" — a leading integer is
 * stoichiometry, a leading article or variable is a sign the term is generic.
 */
function parseSide(side) {
  return side.split(" + ").map((t) => {
    const term = t.trim();
    const m = term.match(/^(\d+)\s+(.*)$/);
    return m ? { n: Number(m[1]), label: m[2] } : { n: 1, label: term };
  }).filter((t) => t.label);
}

/** Sum a formula string into element counts. Rejects anything with a variable
 *  (Rn, )n, X) — those are the generic classes, which cannot balance. */
export function parseFormula(formula) {
  if (!formula || /[()\[\]nRXx*]/.test(formula.replace(/[A-Z][a-z]?/g, (s) => (/^(Rn|Xe|Nb|Na|Ni|Ne|Rb|Rh|Re|Rf|Ru|Xx)$/.test(s) ? s : s.replace(/[nRXx]/g, "")))) ) {
    // The replace above protects real element symbols containing n/R/X before
    // the variable test runs — without it Na, Ne, Ni, Re, Rb all read as generic.
    if (/[()\[\]*]/.test(formula) || /(?:^|[^A-Za-z])[nRX](?![a-z])/.test(formula)) return null;
  }
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m, seen = false;
  while ((m = re.exec(formula))) {
    if (!m[1]) continue;
    seen = true;
    counts[m[1]] = (counts[m[1]] || 0) + (m[2] ? Number(m[2]) : 1);
  }
  return seen ? counts : null;
}

/** Does this reaction balance in mass and charge? Rhea curates for this, but the
 *  atlas asserts it independently — an unbalanced reaction is a data error the
 *  existing validator would reject, and it must never reach a module. */
export function balances(substrates, products, chebi) {
  const tally = (side, sign) => {
    const acc = { charge: 0, el: {} };
    for (const p of side) {
      const info = chebi.get(p.chebi);
      if (!info || info.charge === null) return null;
      const el = parseFormula(info.formula);
      if (!el) return null;
      acc.charge += sign * p.n * info.charge;
      for (const [k, v] of Object.entries(el)) acc.el[k] = (acc.el[k] || 0) + sign * p.n * v;
    }
    return acc;
  };
  const a = tally(substrates, 1), b = tally(products, -1);
  if (!a || !b) return false;
  if (a.charge + b.charge !== 0) return false;
  const keys = new Set([...Object.keys(a.el), ...Object.keys(b.el)]);
  for (const k of keys) if ((a.el[k] || 0) + (b.el[k] || 0) !== 0) return false;
  return true;
}

/**
 * Read rhea.tsv into reactions with resolved participants.
 *
 * Rhea lists a reaction's ChEBI ids in one flat column in equation order, so the
 * only way to attach an id to a term is to walk both in parallel. That is exact
 * as long as the term count matches the id count — when it does not (generic
 * terms are sometimes collapsed), the reaction is dropped rather than guessed at.
 */
export function loadReactions(chebi) {
  const rows = readFileSync(join(DIR, "rhea.tsv"), "utf8").split("\n");
  const out = [];
  let skippedMismatch = 0, skippedGeneric = 0, skippedUnbalanced = 0;

  for (let i = 1; i < rows.length; i++) {
    const [id, equation, chebiIds, ec] = rows[i].split("\t");
    if (!id || !equation || !chebiIds) continue;
    const sep = equation.includes(" = ") ? " = " : null;
    if (!sep) continue;
    const [lhs, rhs] = equation.split(sep);
    const left = parseSide(lhs), right = parseSide(rhs);
    const ids = chebiIds.split(";").map((s) => s.replace("CHEBI:", "").trim()).filter(Boolean);
    if (ids.length !== left.length + right.length) { skippedMismatch++; continue; }

    const attach = (terms, offset) => terms.map((t, k) => ({ ...t, chebi: ids[offset + k] }));
    const substrates = attach(left, 0), products = attach(right, left.length);

    // Every participant must be a concrete compound: a formula we can parse and
    // a charge. Generic classes ("an aldehyde") have neither and would poison
    // both the balance check and the structure rendering.
    const concrete = [...substrates, ...products].every((p) => {
      const info = chebi.get(p.chebi);
      return info && info.formula && info.charge !== null && parseFormula(info.formula);
    });
    if (!concrete) { skippedGeneric++; continue; }
    if (!balances(substrates, products, chebi)) { skippedUnbalanced++; continue; }

    out.push({
      rhea: id.replace("RHEA:", ""),
      equation,
      ec: (ec || "").split(";").map((e) => e.replace("EC:", "").trim()).filter(Boolean),
      substrates, products,
    });
  }
  return { reactions: out, stats: { skippedMismatch, skippedGeneric, skippedUnbalanced } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chebi = chebiTable();
  console.log(`ChEBI: ${chebi.size} compounds (${[...chebi.values()].filter((c) => c.formula).length} with a formula)`);
  const { reactions, stats } = loadReactions(chebi);
  console.log(`Rhea: ${reactions.length} usable reactions`);
  console.log(`  dropped: ${stats.skippedGeneric} generic, ${stats.skippedUnbalanced} unbalanced, ${stats.skippedMismatch} id/term mismatch`);
  const withEc = reactions.filter((r) => r.ec.length).length;
  const parts = new Set(reactions.flatMap((r) => [...r.substrates, ...r.products].map((p) => p.chebi)));
  console.log(`  ${withEc} carry an EC number - ${parts.size} distinct participants`);
}

/**
 * ChEBI accession -> accessions naming the same compound in another state.
 *
 * Rhea states reactions in MICROSPECIES: the species that actually exists at
 * physiological pH, "S-adenosyl-L-methionine zwitterion" (CHEBI:59789), not the
 * neutral parent (CHEBI:15414) that a textbook and this repo's hand-authored
 * modules call SAM. Without this bridge the two vocabularies never meet, and an
 * ingested sheet captions a cofactor with a 45-character systematic name where
 * the atlas already has a curated three-letter one.
 *
 * ChEBI's parent_id column is not an alternative — it is populated on 3 of
 * 218,259 rows.
 */
export function conjugateMap() {
  const rel = join(DIR, "relation.tsv");
  if (!existsSync(rel)) return new Map();
  // relation.tsv joins on INTERNAL compound ids, so the accession mapping has to
  // be rebuilt here rather than reusing chebiTable()'s accession-keyed output.
  const internalToAcc = new Map();
  const cl = readFileSync(join(DIR, "compounds.tsv"), "utf8").split("\n");
  const ch = cl[0].split("\t");
  const iId = ch.indexOf("id"), iAcc = ch.indexOf("chebi_accession");
  for (let i = 1; i < cl.length; i++) {
    const f = cl[i].split("\t");
    if (f.length < 3) continue;
    const acc = (f[iAcc] || "").replace("CHEBI:", "");
    if (acc) internalToAcc.set(f[iId], acc);
  }

  // 6/7 = is_conjugate_acid_of / is_conjugate_base_of, 11 = is_tautomer_of. All
  // three mean "the same compound in a different protonation or tautomeric
  // state", which is what a microspecies IS. SAM's zwitterion reaches its parent
  // only through the tautomer edge, so omitting 11 leaves the commonest cofactor
  // on the sheet captioned with its systematic name. `is_a` is deliberately NOT
  // included: it would merge SAM into "sulfonium compound".
  const CONJUGATE = new Set(["6", "7", "11"]);
  const out = new Map();
  const rows = readFileSync(rel, "utf8").split("\n");
  const rh = rows[0].split("\t");
  const rType = rh.indexOf("relation_type_id"), rInit = rh.indexOf("init_id"), rFinal = rh.indexOf("final_id");
  for (let i = 1; i < rows.length; i++) {
    const f = rows[i].split("\t");
    if (f.length < 4 || !CONJUGATE.has(f[rType])) continue;
    const a = internalToAcc.get(f[rInit]), b = internalToAcc.get(f[rFinal]);
    if (!a || !b) continue;
    if (!out.has(a)) out.set(a, new Set());
    if (!out.has(b)) out.set(b, new Set());
    out.get(a).add(b);
    out.get(b).add(a);
  }
  return out;
}

/**
 * EC number -> its accepted name, from the ExPASy ENZYME nomenclature database.
 *
 * Without this an ingested sheet labels every step "EC 1.5.1.10" and then prints
 * "EC 1.5.1.10" again underneath as the EC line — the same string twice, telling
 * the reader nothing. The accepted name ("Saccharopine dehydrogenase") is what
 * the poster puts in blue, and it is the single biggest readability win in the
 * ingested set.
 */
export function enzymeNames() {
  const file = join(DIR, "enzyme.dat");
  const out = new Map();
  if (!existsSync(file)) return out;
  let ec = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("ID   ")) { ec = line.slice(5).trim(); continue; }
    // DE is the accepted name. Transferred/deleted entries say so in DE; those
    // carry no chemistry and must not become a label.
    if (line.startsWith("DE   ") && ec) {
      const name = line.slice(5).trim().replace(/\.$/, "");
      if (!/^(Transferred entry|Deleted entry)/i.test(name)) out.set(ec, name);
      ec = null;
    }
  }
  return out;
}

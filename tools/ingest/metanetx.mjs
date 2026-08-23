// Second source: MetaNetX (MNXref), CC-BY.
//
// Rhea is the ceiling for curated reactions from one database — 18,558 entries,
// of which this pipeline draws 12,696. MetaNetX exists to reconcile the others
// (KEGG, MetaCyc, SEED, BiGG, Rhea) into a single namespace, and ships 83,796
// reactions as flat TSVs. 17,199 of those ARE Rhea and are skipped here rather
// than counted twice; the rest is genuinely new chemistry.
//
// Everything is vetted the same way Rhea is: a participant must resolve to a
// concrete formula and charge, and the reaction must balance in mass and charge
// independently of what the source claims. MetaNetX is a reconciliation, not a
// curation, so this matters more here than it did for Rhea — and the numbers at
// the bottom of this file show how much it rejects.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFormula, cleanName } from "./corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "data", "ingest");

/** MNX compound id -> ChEBI accession, so MetaNetX participants land in the same
 *  vocabulary as the Rhea ones and the two sources dedupe against each other
 *  instead of drawing the same compound under two names. */
function mnxToChebi() {
  const f = join(DIR, "mnx2chebi.tsv");
  const out = new Map();
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const [mnx, chebi] = line.split("\t");
    if (mnx && chebi && !out.has(mnx)) out.set(mnx, chebi.trim());
  }
  return out;
}

/** MNX reaction ids that are just Rhea under another name. */
function rheaBacked() {
  const f = join(DIR, "mnx2rhea.tsv");
  const out = new Set();
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const [mnx] = line.split("\t");
    if (mnx) out.add(mnx.trim());
  }
  return out;
}

/** Split "1 MNXM01@MNXD1 + 2 WATER@MNXD1" into terms. */
function parseSide(side) {
  return side.split(" + ").map((t) => {
    const m = t.trim().match(/^(\d+(?:\.\d+)?)\s+(\S+)$/);
    if (!m) return null;
    const [id, compartment] = m[2].split("@");
    return { n: Number(m[1]), mnx: id, compartment };
  }).filter(Boolean);
}

/** Two participants are the SAME species only when they share an elemental
 *  composition AND a charge. MetaNetX and ChEBI often disagree on the latter:
 *  ChEBI states a compound as the microspecies that exists at physiological pH
 *  (a different protonation state), so its formula/charge is not interchangeable
 *  with MNX's for balance arithmetic even when they name "the same" molecule. */
function sameSpecies(elA, chargeA, elB, chargeB) {
  if (chargeA !== chargeB) return false;
  if (!elA || !elB) return false;
  const keys = new Set([...Object.keys(elA), ...Object.keys(elB)]);
  for (const k of keys) if ((elA[k] || 0) !== (elB[k] || 0)) return false;
  return true;
}

/**
 * Resolve one MetaNetX participant to the formula/charge used for balance AND
 * the corpus-wide key it is stored under.
 *
 * The rule that keeps a reaction internally balanced: balance against MetaNetX's
 * OWN native formula/charge whenever it has one, because MNX curates each
 * reaction to balance within its own namespace. A ChEBI xref is adopted as the
 * participant's identity (so MNX and Rhea dedupe against each other) ONLY when
 * ChEBI names the exact same species — same composition and same charge — as MNX.
 * When they differ, keep the mnx: key so the module carries MNX's self-consistent
 * numbers and does not (a) turn a balanced reaction unbalanced by mixing
 * protonation states, or (b) trip validate.mjs's cross-module identity check by
 * claiming a ChEBI accession with a non-ChEBI formula.
 *
 * Balance ALWAYS uses the native MNX formula/charge — never a ChEBI substitute.
 * A participant with no concrete native formula (MNX marks it generic: a "*"
 * polymer, an "R" group) is left unresolved rather than rescued with a ChEBI
 * formula, because that substitution is exactly what silently unbalanced 1,737
 * reactions here and would fabricate balance for MNX's structurally generic set.
 *
 * Returns { key, charge, el } or null when MNX gives no concrete formula+charge.
 */
export function bridgeParticipant(mnx, { props, toChebi, chebi }) {
  const native = props.get(mnx);
  const nativeEl = native && native.charge !== null ? parseFormula(native.formula) : null;
  if (!nativeEl) return null;

  const acc = toChebi.get(mnx);
  const xref = acc && chebi.has(acc) ? chebi.get(acc) : null;
  const xrefEl = xref && xref.charge !== null ? parseFormula(xref.formula) : null;
  const key = xrefEl && sameSpecies(nativeEl, native.charge, xrefEl, xref.charge)
    ? acc
    : `mnx:${mnx}`;
  return { key, charge: native.charge, el: nativeEl };
}

/**
 * Resolve, key, and mass/charge-balance one reaction. Mutates each participant's
 * `.chebi` (the corpus-wide key) in place, exactly as the old inline loop did.
 * Balance arithmetic uses each participant's resolved native formula/charge, so
 * a reaction that balances in MetaNetX's own numbers stays balanced here.
 */
export function bridgeReaction(substrates, products, ctx) {
  const info = new Map();
  for (const p of [...substrates, ...products]) {
    const res = bridgeParticipant(p.mnx, ctx);
    if (!res) return { ok: false, balanced: false };
    p.chebi = res.key;
    info.set(p, res);
  }
  const tally = (side, sign) => {
    const acc = { charge: 0, el: {} };
    for (const p of side) {
      const { el, charge } = info.get(p);
      acc.charge += sign * p.n * charge;
      for (const [k, v] of Object.entries(el)) acc.el[k] = (acc.el[k] || 0) + sign * p.n * v;
    }
    return acc;
  };
  const a = tally(substrates, 1), b = tally(products, -1);
  if (a.charge + b.charge !== 0) return { ok: true, balanced: false };
  for (const k of new Set([...Object.keys(a.el), ...Object.keys(b.el)])) {
    if ((a.el[k] || 0) + (b.el[k] || 0) !== 0) return { ok: true, balanced: false };
  }
  return { ok: true, balanced: true };
}

/**
 * Load MetaNetX reactions that are NOT already in the Rhea corpus.
 *
 * Two passes over the 1.5M-row compound table: collect the ids the reactions
 * actually reference, then read only those. Loading all of it to answer a
 * question about ~60,000 reactions would cost hundreds of megabytes for nothing.
 */
export function loadMetanetx(chebi) {
  const toChebi = mnxToChebi();
  const skipRhea = rheaBacked();

  const rows = readFileSync(join(DIR, "mnx_reac.tsv"), "utf8").split("\n");
  const parsed = [];
  const wanted = new Set();
  let skippedDuplicate = 0, skippedTransport = 0, skippedShape = 0;

  for (const line of rows) {
    if (!line || line.startsWith("#")) continue;
    const [id, equation, , ec] = line.split("\t");
    if (!id || !equation || !equation.includes(" = ")) { skippedShape++; continue; }
    if (skipRhea.has(id)) { skippedDuplicate++; continue; }

    const [lhs, rhs] = equation.split(" = ");
    const substrates = parseSide(lhs), products = parseSide(rhs);
    if (!substrates.length || !products.length) { skippedShape++; continue; }

    // A transport step moves one species between compartments. It is real, but
    // it is not a transformation, and drawn on a sheet it is a cell pointing at
    // an identical cell.
    const sIds = new Set(substrates.map((p) => p.mnx));
    const pIds = new Set(products.map((p) => p.mnx));
    if ([...sIds].every((x) => pIds.has(x)) && [...pIds].every((x) => sIds.has(x))) {
      skippedTransport++;
      continue;
    }

    for (const p of [...substrates, ...products]) wanted.add(p.mnx);
    parsed.push({
      mnx: id,
      ec: (ec || "").split(";").map((e) => e.trim()).filter((e) => /^\d+\.\d+\.\d+\.\d+$/.test(e)),
      substrates, products,
    });
  }

  // second pass: only the compounds these reactions mention
  const props = new Map();
  for (const line of readFileSync(join(DIR, "mnx_chem.tsv"), "utf8").split("\n")) {
    const [id, name, formula, charge] = line.split("\t");
    if (!id || !wanted.has(id)) continue;
    props.set(id, {
      name: cleanName(name) || id,
      formula: (formula || "").trim(),
      charge: charge === "" || charge === undefined ? null : Number(charge),
    });
  }

  // Resolve every participant to a key shared with the Rhea corpus where possible,
  // then balance every reaction against that resolution.
  const out = [];
  let skippedUnresolved = 0, skippedUnbalanced = 0;
  const ctx = { props, toChebi, chebi };

  for (const r of parsed) {
    const { ok, balanced } = bridgeReaction(r.substrates, r.products, ctx);
    if (!ok) { skippedUnresolved++; continue; }
    if (!balanced) { skippedUnbalanced++; continue; }
    out.push({ rhea: null, mnx: r.mnx, equation: null, ec: r.ec, substrates: r.substrates, products: r.products });
  }

  return {
    reactions: out,
    props,
    stats: { skippedDuplicate, skippedTransport, skippedShape, skippedUnresolved, skippedUnbalanced },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chebiTable } = await import("./corpus.mjs");
  const chebi = chebiTable();
  const { reactions, props, stats } = loadMetanetx(chebi);
  console.log(`MetaNetX: ${reactions.length} usable reactions NOT already in Rhea`);
  console.log(`  dropped: ${stats.skippedDuplicate} already Rhea, ${stats.skippedTransport} transport-only,`);
  console.log(`           ${stats.skippedUnresolved} without a formula/charge, ${stats.skippedUnbalanced} unbalanced, ${stats.skippedShape} malformed`);
  console.log(`  ${reactions.filter((r) => r.ec.length).length} carry an EC number - ${props.size} compounds resolved`);
}

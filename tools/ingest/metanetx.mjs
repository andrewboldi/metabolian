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

  // Resolve every participant to a key shared with the Rhea corpus where possible.
  const out = [];
  let skippedUnresolved = 0, skippedUnbalanced = 0;
  const keyOf = (mnx) => {
    const c = toChebi.get(mnx);
    return c && chebi.has(c) ? c : `mnx:${mnx}`;
  };

  for (const r of parsed) {
    const all = [...r.substrates, ...r.products];
    let ok = true;
    for (const p of all) {
      p.chebi = keyOf(p.mnx);                       // "chebi" is the corpus-wide participant key
      const known = chebi.get(p.chebi) || props.get(p.mnx);
      if (!known || !known.formula || known.charge === null || !parseFormula(known.formula)) { ok = false; break; }
    }
    if (!ok) { skippedUnresolved++; continue; }

    // balance, against whichever table holds each participant
    const tally = (side, sign) => {
      const acc = { charge: 0, el: {} };
      for (const p of side) {
        const info = chebi.get(p.chebi) || props.get(p.mnx);
        const el = parseFormula(info.formula);
        acc.charge += sign * p.n * info.charge;
        for (const [k, v] of Object.entries(el)) acc.el[k] = (acc.el[k] || 0) + sign * p.n * v;
      }
      return acc;
    };
    const a = tally(r.substrates, 1), b = tally(r.products, -1);
    if (a.charge + b.charge !== 0) { skippedUnbalanced++; continue; }
    let balanced = true;
    for (const k of new Set([...Object.keys(a.el), ...Object.keys(b.el)])) {
      if ((a.el[k] || 0) + (b.el[k] || 0) !== 0) { balanced = false; break; }
    }
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

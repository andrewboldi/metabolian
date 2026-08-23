// Build-time AS-STORED mass + charge balance gate.
//
// Every generated module's summary asserts each step was "independently verified
// here to balance in mass and charge". That claim is about the module as it ships,
// so it must be checked against the formulas/charges the module ITSELF stores —
// not against the source ChEBI/MetaNetX tables the ingest balanced against. When
// the write layer collapses two distinct species onto one local id, or stores a
// formula that differs from the one the ingest verified, the as-stored reaction no
// longer balances even though the ingest thought it did. This turns that into a
// number you can gate on.
//
// Source of truth is data/pathways/*.json — the module is the authored, as-stored,
// as-drawn artifact (the built web/public/chart/*.json is a lossy projection: the
// id collapse has already happened there and stoichiometry is dropped, so it can
// no longer prove or disprove balance). We reuse the same checkReaction the
// validator uses, built over a Map keyed by the module's own local ids (last write
// wins on a collision — exactly what a loader/renderer sees), so this measures the
// artifact as it actually ships.
//
// Usage: node tools/qa-balance.mjs [--json] [--gate] [moduleId ...]
//   --json  emit the full offender list as JSON
//   --gate  exit 1 if any concrete reaction fails to balance as stored

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReaction } from "./lib/balance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "pathways");

/**
 * Every concrete reaction (both sides carry parseable formulas) that fails to
 * balance against the module's OWN stored formulas/charges. A reaction is only
 * charge-failed when every participant states a charge (checkReaction reports
 * chargeOk=null when a charge is missing — we don't invent one).
 */
export function offendersForModule(mod) {
  const metById = new Map((mod.metabolites || []).map((m) => [m.id, m]));
  const out = [];
  for (const r of mod.reactions || []) {
    const res = checkReaction(r, metById);
    if (!res.checkable) continue; // a participant lacks a parseable formula — not "concrete"
    const massOk = res.massOk;
    const chargeOk = res.chargeOk !== false; // null (unknown) is not a failure
    if (massOk && chargeOk) continue;
    out.push({
      module: mod.id,
      reaction: r.id,
      ...(massOk ? {} : { massDiff: res.massDiff }),
      ...(res.chargeOk === false ? { chargeDiff: res.chargeDiff } : {}),
    });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const gate = argv.includes("--gate");
  const only = argv.filter((a) => !a.startsWith("--"));

  const files = (only.length ? only.map((id) => `${id}.json`) : readdirSync(DIR)).filter((f) =>
    f.endsWith(".json"),
  );

  const offenders = [];
  let moduleCount = 0;
  let concreteRxns = 0;
  for (const f of files.sort()) {
    let mod;
    try {
      mod = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    } catch (e) {
      console.error(`✗ ${f}: invalid JSON — ${e.message}`);
      process.exit(1);
    }
    moduleCount++;
    const metById = new Map((mod.metabolites || []).map((m) => [m.id, m]));
    for (const r of mod.reactions || []) if (checkReaction(r, metById).checkable) concreteRxns++;
    offenders.push(...offendersForModule(mod));
  }

  const massFails = offenders.filter((o) => o.massDiff).length;
  const chargeFails = offenders.filter((o) => o.chargeDiff != null).length;

  if (asJson) {
    console.log(
      JSON.stringify(
        { moduleCount, concreteRxns, unbalanced: offenders.length, massFails, chargeFails, offenders },
        null,
        2,
      ),
    );
  } else {
    const fmt = (o) => {
      const bits = [];
      if (o.massDiff) bits.push("mass " + JSON.stringify(o.massDiff));
      if (o.chargeDiff != null) bits.push(`charge ${o.chargeDiff > 0 ? "+" : ""}${o.chargeDiff}`);
      return `  ${o.module} · ${o.reaction}: ${bits.join(", ")}`;
    };
    for (const o of offenders.slice(0, 40)) console.log(fmt(o));
    if (offenders.length > 40) console.log(`  … +${offenders.length - 40} more`);
    console.log(
      `\n${moduleCount} module(s), ${concreteRxns} concrete reaction(s) — ` +
        `${offenders.length} unbalanced as stored (${massFails} mass, ${chargeFails} charge).`,
    );
  }

  if (gate) {
    if (offenders.length) {
      console.error(
        `\n✗ ${offenders.length} reaction(s) do not balance in mass+charge as stored (expected 0).`,
      );
      process.exit(1);
    }
    console.log("\n✓ every concrete reaction balances in mass and charge as stored.");
  }
}

// Run only when invoked as a script, not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

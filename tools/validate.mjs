// Validate every data/pathways/*.json against schema/pathway.schema.json,
// then run referential-integrity checks (every id referenced by a reaction /
// regulation / relation must exist inside the same module).
// Exit non-zero on any failure so CI blocks bad data.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { checkReaction } from "./lib/balance.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCHEMA = join(ROOT, "schema", "pathway.schema.json");
const DATA_DIR = join(ROOT, "data", "pathways");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
const validate = ajv.compile(schema);

// Optional: `node tools/validate.mjs <file.json>` validates a single module (used by swarm agents).
const only = process.argv[2];
let files = [];
try {
  files = only
    ? [only.replace(/^.*\/data\/pathways\//, "")]
    : readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
} catch {
  console.error(`No data directory at ${DATA_DIR}`);
  process.exit(1);
}

let errorCount = 0;
let moduleCount = 0;
let massWarn = 0;
let chargeWarn = 0;
const seenModuleIds = new Set();

for (const file of files.sort()) {
  const path = join(DATA_DIR, file);
  let mod;
  try {
    mod = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`❌ ${file}: invalid JSON — ${e.message}`);
    errorCount++;
    continue;
  }

  if (!validate(mod)) {
    for (const err of validate.errors) {
      console.error(`❌ ${file} ${err.instancePath || "/"} ${err.message}`);
    }
    errorCount += validate.errors.length;
    continue;
  }

  // --- referential integrity ---
  const errs = referentialErrors(mod);
  if (errs.length) {
    errs.forEach((e) => console.error(`❌ ${file}: ${e}`));
    errorCount += errs.length;
    continue;
  }

  if (seenModuleIds.has(mod.id)) {
    console.error(`❌ ${file}: duplicate module id '${mod.id}'`);
    errorCount++;
    continue;
  }
  seenModuleIds.add(mod.id);
  moduleCount++;
  const rxn = mod.reactions?.length ?? 0;
  const reg = mod.regulations?.length ?? 0;
  console.log(`✅ ${file} — ${mod.metabolites.length} metabolites, ${mod.enzymes.length} enzymes, ${rxn} reactions, ${reg} regulations`);

  // Balance report (warning-level — does not fail the build yet).
  const metById = new Map((mod.metabolites || []).map((m) => [m.id, m]));
  const bad = [];
  for (const r of mod.reactions || []) {
    if (r.transport || r.spontaneous) continue;
    const res = checkReaction(r, metById);
    if (!res.checkable) continue;
    if (!res.massOk || res.chargeOk === false) {
      if (!res.massOk) massWarn++;
      if (res.chargeOk === false) chargeWarn++;
      const bits = [];
      if (!res.massOk) bits.push("mass " + JSON.stringify(res.massDiff));
      if (res.chargeOk === false) bits.push(`charge ${res.chargeDiff > 0 ? "+" : ""}${res.chargeDiff}`);
      bad.push(`   ⚠ ${r.id}: ${bits.join(", ")}`);
    }
  }
  if (bad.length) console.log(bad.slice(0, 6).join("\n") + (bad.length > 6 ? `\n   … +${bad.length - 6} more` : ""));
}

function referentialErrors(mod) {
  const errs = [];
  const metIds = new Set((mod.metabolites || []).map((m) => m.id));
  const enzIds = new Set((mod.enzymes || []).map((e) => e.id));
  const cpxIds = new Set((mod.complexes || []).map((c) => c.id));
  const geneIds = new Set((mod.genes || []).map((g) => g.id));
  const rxnIds = new Set((mod.reactions || []).map((r) => r.id));

  const has = (kind, id) => {
    switch (kind) {
      case "metabolite": return metIds.has(id);
      case "enzyme": return enzIds.has(id);
      case "complex": return cpxIds.has(id);
      case "gene": return geneIds.has(id);
      case "reaction": return rxnIds.has(id);
      case "pathway": return true; // cross-module pathway ids resolved at merge time
      case "compartment": return true;
      default: return false;
    }
  };

  for (const r of mod.reactions || []) {
    for (const p of [...(r.substrates || []), ...(r.products || [])]) {
      if (!metIds.has(p.metabolite)) errs.push(`reaction '${r.id}' references unknown metabolite '${p.metabolite}'`);
    }
    for (const c of r.catalysts || []) {
      if (!enzIds.has(c.enzyme) && !cpxIds.has(c.enzyme)) errs.push(`reaction '${r.id}' references unknown catalyst '${c.enzyme}'`);
    }
    for (const c of r.cofactors || []) {
      if (!metIds.has(c.metabolite)) errs.push(`reaction '${r.id}' references unknown cofactor '${c.metabolite}'`);
    }
  }
  for (const reg of mod.regulations || []) {
    if (!has(reg.regulator.kind, reg.regulator.id)) errs.push(`regulation '${reg.id}' references unknown regulator ${reg.regulator.kind}:${reg.regulator.id}`);
    if (!has(reg.target.kind, reg.target.id)) errs.push(`regulation '${reg.id}' references unknown target ${reg.target.kind}:${reg.target.id}`);
  }
  for (const rel of mod.relations || []) {
    if (!has(rel.source.kind, rel.source.id)) errs.push(`relation '${rel.id}' references unknown source ${rel.source.kind}:${rel.source.id}`);
    if (!has(rel.target.kind, rel.target.id)) errs.push(`relation '${rel.id}' references unknown target ${rel.target.kind}:${rel.target.id}`);
  }
  return errs;
}

console.log(`\n${moduleCount} module(s) validated, ${errorCount} error(s).`);
if (massWarn || chargeWarn) console.log(`⚠ balance: ${massWarn} reaction(s) not mass-balanced, ${chargeWarn} not charge-balanced (warning — see docs/SCHEMA.md; usually a neutral formula paired with an anion charge).`);
process.exit(errorCount ? 1 : 0);

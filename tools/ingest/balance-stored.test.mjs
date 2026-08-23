// Regression tests for the AS-STORED balance gate (tools/qa-balance.mjs).
//
// The bug this guards against: the module-write layer could collapse two distinct
// species onto one local metabolite id (a truncated-name slug collision), or store
// a formula that differs from the one the ingest balanced against. Either way the
// module ships a reaction that does NOT balance against its OWN stored formulas,
// while its summary claims every step "independently verified here to balance".
// offendersForModule reads the module exactly as it ships — a Map keyed by local
// id, last write winning on a collision — and reports every concrete reaction that
// fails to balance in mass or charge as stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offendersForModule } from "../qa-balance.mjs";

// C6H10O5 + H2O -> C6H12O6, all neutral: balances in mass and charge as stored.
const balanced = {
  id: "balanced-fixture",
  metabolites: [
    { id: "x", formula: "C6H10O5", charge: 0 },
    { id: "water", formula: "H2O", charge: 0 },
    { id: "y", formula: "C6H12O6", charge: 0 },
  ],
  reactions: [
    {
      id: "r1",
      substrates: [{ metabolite: "x", stoichiometry: 1 }, { metabolite: "water", stoichiometry: 1 }],
      products: [{ metabolite: "y", stoichiometry: 1 }],
    },
  ],
};

test("a module whose reaction balances as stored yields no offenders", () => {
  assert.deepEqual(offendersForModule(balanced), []);
});

test("id collapse — two distinct species sharing one local id — is caught", () => {
  // The real failure mode: distinct species A and A' collapse to id "a" (last
  // write wins), so a reaction with A on the left and A' on the right references
  // the SAME id on both sides. They cancel and leave d-species minus water.
  const collapsed = {
    id: "collapse-fixture",
    metabolites: [
      { id: "d_ala", formula: "C3H7NO2", charge: 0 },
      // Both peptides collapsed onto one id; the second (larger) wins the Map.
      { id: "peptide", formula: "C95H156N10O26P2", charge: -2 },
      { id: "peptide", formula: "C98H161N11O27P2", charge: -2 },
      { id: "water", formula: "H2O", charge: 0 },
    ],
    reactions: [
      {
        id: "r1",
        substrates: [{ metabolite: "d_ala", stoichiometry: 1 }, { metabolite: "peptide", stoichiometry: 1 }],
        products: [{ metabolite: "peptide", stoichiometry: 1 }, { metabolite: "water", stoichiometry: 1 }],
      },
    ],
  };
  const offenders = offendersForModule(collapsed);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].reaction, "r1");
  // peptides cancel; left has d-alanine (C3H7NO2), right has water (H2O):
  // net C3 H5 N1 O1 on the substrate side.
  assert.deepEqual(offenders[0].massDiff, { C: 3, H: 5, N: 1, O: 1 });
});

test("a stored-formula mismatch that unbalances mass is caught", () => {
  const imbalanced = structuredClone(balanced);
  imbalanced.id = "mass-imbalance-fixture";
  imbalanced.metabolites[2].formula = "C6H11O6"; // product H off by one
  const offenders = offendersForModule(imbalanced);
  assert.equal(offenders.length, 1);
  assert.deepEqual(offenders[0].massDiff, { H: 1 });
  assert.equal(offenders[0].chargeDiff, undefined);
});

test("a stored-charge mismatch is caught even when mass balances", () => {
  const imbalanced = structuredClone(balanced);
  imbalanced.id = "charge-imbalance-fixture";
  imbalanced.metabolites[2].charge = -1; // mass fine, charge off by +1 on substrate side
  const offenders = offendersForModule(imbalanced);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].massDiff, undefined);
  assert.equal(offenders[0].chargeDiff, 1);
});

test("a reaction with an unparseable/absent formula is not 'concrete' and is skipped", () => {
  const partial = structuredClone(balanced);
  partial.id = "partial-fixture";
  delete partial.metabolites[0].formula; // x has no formula -> not checkable
  assert.deepEqual(offendersForModule(partial), []);
});

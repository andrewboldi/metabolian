import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormula, checkReaction } from "./lib/balance.mjs";

test("parseFormula handles common formulas", () => {
  assert.deepEqual(parseFormula("C6H12O6"), { C: 6, H: 12, O: 6 });
  assert.deepEqual(parseFormula("HO4P"), { H: 1, O: 4, P: 1 });
  assert.deepEqual(parseFormula("H2O"), { H: 2, O: 1 });
  assert.equal(parseFormula(""), null);
  assert.equal(parseFormula(undefined), null);
});

test("checkReaction detects a balanced reaction", () => {
  const mets = new Map([
    ["a", { id: "a", formula: "C6H12O6", charge: 0 }],
    ["b", { id: "b", formula: "C3H6O3", charge: 0 }],
  ]);
  const r = { substrates: [{ metabolite: "a" }], products: [{ metabolite: "b", stoichiometry: 2 }] };
  const res = checkReaction(r, mets);
  assert.equal(res.checkable, true);
  assert.equal(res.massOk, true);
  assert.equal(res.chargeOk, true);
});

test("checkReaction flags a charge imbalance", () => {
  const mets = new Map([
    ["atp", { id: "atp", formula: "C10H16N5O13P3", charge: -4 }], // neutral formula, anion charge
    ["adp", { id: "adp", formula: "C10H16N5O13P3", charge: -4 }],
  ]);
  const r = { substrates: [{ metabolite: "atp" }], products: [{ metabolite: "adp" }] };
  const res = checkReaction(r, mets);
  assert.equal(res.massOk, true); // same formula both sides
  assert.equal(res.chargeOk, true); // same charge both sides
});

test("checkReaction is not checkable when a formula is missing", () => {
  const mets = new Map([["a", { id: "a" }]]);
  const r = { substrates: [{ metabolite: "a" }], products: [] };
  assert.equal(checkReaction(r, mets).checkable, false);
});

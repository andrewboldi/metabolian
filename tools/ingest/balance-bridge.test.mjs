// Regression tests for the MetaNetX -> ChEBI participant bridge.
//
// The bug this guards against: the bridge used to adopt a ChEBI microspecies'
// formula/charge in place of MetaNetX's own, mixing protonation states inside a
// single reaction and turning ~1,700 natively-balanced reactions unbalanced. The
// fix balances against each participant's NATIVE MNX formula/charge and adopts a
// ChEBI accession as the identity key ONLY when ChEBI names the exact same
// species (same composition AND charge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeParticipant, bridgeReaction } from "./metanetx.mjs";

// A reaction: C6H10O5 + H2O = C6H12O6 — balances in mass and charge natively.
function fixture(overrides = {}) {
  const props = new Map([
    ["MNXM_X", { name: "X", formula: "C6H10O5", charge: 0 }],
    ["MNXM_W", { name: "water", formula: "H2O", charge: 0 }],
    ["MNXM_Y", { name: "Y", formula: "C6H12O6", charge: 0 }],
    ...(overrides.props || []),
  ]);
  const toChebi = new Map([
    ["MNXM_X", "111"],
    ["MNXM_W", "15377"],
    ["MNXM_Y", "222"],
    ...(overrides.toChebi || []),
  ]);
  // By default the ChEBI xref for X is a DIFFERENT protonation state than MNX's.
  const chebi = new Map([
    ["111", { name: "X-acid", formula: "C6H11O5", charge: 1 }], // mismatch vs native
    ["15377", { name: "water", formula: "H2O", charge: 0 }],
    ["222", { name: "Y", formula: "C6H12O6", charge: 0 }],       // matches native
    ...(overrides.chebi || []),
  ]);
  return { props, toChebi, chebi };
}

const rxn = () => ({
  substrates: [{ n: 1, mnx: "MNXM_X" }, { n: 1, mnx: "MNXM_W" }],
  products: [{ n: 1, mnx: "MNXM_Y" }],
});

test("a reaction balanced in native MNX stays balanced after bridging", () => {
  const ctx = fixture();
  const r = rxn();
  const res = bridgeReaction(r.substrates, r.products, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.balanced, true, "native formulas balance; must not be broken by the ChEBI substitution");
});

test("a mismatched ChEBI xref is NOT adopted — the mnx: key is kept", () => {
  const ctx = fixture();
  // X's ChEBI xref (C6H11O5 / +1) differs from native (C6H10O5 / 0): keep mnx:.
  assert.equal(bridgeParticipant("MNXM_X", ctx).key, "mnx:MNXM_X");
  // Y's ChEBI xref matches native exactly: adopt the accession for dedup.
  assert.equal(bridgeParticipant("MNXM_Y", ctx).key, "222");
  // Balance always uses native numbers regardless of which key is chosen.
  assert.equal(bridgeParticipant("MNXM_X", ctx).charge, 0);
  assert.deepEqual(bridgeParticipant("MNXM_X", ctx).el, { C: 6, H: 10, O: 5 });
});

test("the old ChEBI-substitution would have unbalanced this reaction", () => {
  // Prove the fixture actually exercises the bug: summing with X's ChEBI formula
  // (C6H11O5/+1) instead of its native (C6H10O5/0) does NOT balance.
  const substrateChebi = { C: 6, H: 11 + 2, O: 5 + 1 }; // C6H11O5 + H2O
  const product = { C: 6, H: 12, O: 6 };
  assert.notDeepEqual(substrateChebi, product);
});

test("a genuine mass imbalance is still rejected", () => {
  const ctx = fixture({
    props: [["MNXM_Y", { name: "Y", formula: "C5H10O5", charge: 0 }]], // wrong product mass
    chebi: [["222", { name: "Y", formula: "C5H10O5", charge: 0 }]],
  });
  const r = rxn();
  const res = bridgeReaction(r.substrates, r.products, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.balanced, false);
});

test("a genuine charge imbalance is still rejected", () => {
  const ctx = fixture({
    props: [["MNXM_Y", { name: "Y", formula: "C6H12O6", charge: -1 }]], // mass ok, charge off
    chebi: [["222", { name: "Y", formula: "C6H12O6", charge: -1 }]],
  });
  const r = rxn();
  const res = bridgeReaction(r.substrates, r.products, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.balanced, false);
});

test("a generic native species is left unresolved, never rescued by ChEBI", () => {
  const ctx = fixture({
    // MNX marks X generic (polymer "*"); ChEBI happens to have a concrete formula.
    props: [["MNXM_X", { name: "X", formula: "C6H10O5*2", charge: 0 }]],
    chebi: [["111", { name: "X", formula: "C6H10O5", charge: 0 }]],
  });
  assert.equal(bridgeParticipant("MNXM_X", ctx), null);
  const r = rxn();
  assert.equal(bridgeReaction(r.substrates, r.products, ctx).ok, false);
});

test("a participant with no formula in either table is unresolved", () => {
  const ctx = fixture({
    props: [["MNXM_X", { name: "X", formula: "", charge: null }]],
    chebi: [["111", { name: "X", formula: "", charge: null }]],
  });
  assert.equal(bridgeParticipant("MNXM_X", ctx), null);
});

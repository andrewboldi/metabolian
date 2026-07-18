# Folate one-carbon metabolism — Michal draws this one as a ladder, not a maze:
# a single vertical spine carrying the pteroyl cofactor from its most oxidized
# form (folate) at the top, down through the three one-carbon oxidation levels
# — formate-level (10-formyl-THF, 5,10-methenyl-THF), formaldehyde-level
# (5,10-methylene-THF), methyl-level (5-methyl-THF) — and back to THF, so the
# ring closes exactly the way the TCA chart closes: methionine synthase is the
# last arrow and it runs up the column to regenerate tetrahydrofolate.
#
# Reading the spine downward is reading the one-carbon unit being reduced. The
# three consecutive MTHFD1 rungs are one protein: the cytosolic trifunctional
# C1-THF synthase (6.3.4.3 synthetase, 3.5.4.9 cyclohydrolase, 1.5.1.5
# dehydrogenase), drawn in its physiological cytosolic direction — formate in
# at the top, methylene-THF out at the bottom.
#
# Donors enter from the left at THF (serine's beta-carbon via SHMT, then a
# second unit from the glycine cleavage system) and rejoin at methylene-THF.
# Consumers hang off the right at the oxidation level each one needs: the two
# purine formyl transfers (GART installs C8, ATIC installs C2) off
# 10-formyl-THF, and thymidylate synthase off methylene-THF on the left —
# uniquely, TYMS spends the folate's hydride as well as its carbon, so it
# returns DHF (side arrow) which DHFR must re-reduce at the head of the spine.
# That is the thymidylate cycle, and it is why methotrexate and 5-FU are drawn
# at opposite ends of the same loop.
#
# Formate hangs off methylene-THF on the right as the compartment currency: the
# link out of the spine stands for the mitochondrial oxidative limb (SHMT2 ->
# MTHFD2 -> MTHFD1L), which cannot be drawn as a second ladder because MPL
# gives each metabolite one cell and the matrix carries the same folate
# species. It re-enters as +formate on the MTHFD1 synthetase rung.

pathway folate-one-carbon-metabolism "Folate and one-carbon metabolism" {
  grid F4
  spacing 210

  spine at 0,0 {
    folate
    -> dhfr [1.5.1.3] +nadph +hplus -nadp
    dhf
    -> dhfr [1.5.1.3] +nadph +hplus -nadp
    thf
    <-> mthfd1 [6.3.4.3] +formate +atp -adp -pi
    formyl_thf
    <-> mthfd1 [3.5.4.9] +hplus -h2o
    methenyl_thf
    <-> mthfd1 [1.5.1.5] +nadph -nadp
    methylene_thf
    -> mthfr [1.5.1.20] +nadph +hplus -nadp !committed
    methyl_thf
    -> mtr [2.1.1.13] +homocysteine -methionine
    thf
  }

  # One-carbon donors. THF is the acceptor, so the link out of the spine runs
  # from THF into serine: SHMT hands over the beta-carbon (SHMT1 in the cytosol,
  # its isozyme SHMT2 in the matrix), leaving glycine, which the glycine
  # cleavage system then oxidatively decarboxylates to release a second unit.
  # Both units land on the same pool, so the branch rejoins at methylene-THF.
  branch from thf side left {
    serine
    <-> shmt1 [2.1.2.1] +thf -methylene_thf -h2o
    glycine
    <-> gldc [1.4.4.2] +thf +nad -co2 -nh3 -nadh -hplus
    methylene_thf
  }

  # Purine ring carbon C8 — GAR transformylase spends 10-formyl-THF.
  branch from formyl_thf side right {
    gar
    -> gart [2.1.2.2] +formyl_thf -thf
    fgar
  }

  # Purine ring carbon C2 — AICAR transformylase, the last folate-dependent
  # step of de novo purine synthesis.
  branch from formyl_thf side right {
    aicar
    -> atic [2.1.2.3] +formyl_thf -thf
    faicar
  }

  # Thymidylate. The only reaction on the chart that oxidizes the cofactor:
  # methylene-THF is both methyl donor and reductant, so DHF (not THF) comes
  # back off the arrow and has to be re-reduced by DHFR at the top of the spine.
  branch from methylene_thf side left {
    dump
    -> tyms [2.1.1.45] +methylene_thf -dhf
    dtmp
  }

  # Mitochondrial limb, lumped into the link out of the spine: matrix
  # methylene-THF is oxidized by MTHFD2 (NAD+-linked) and released as formate by
  # MTHFD1L, which crosses to the cytosol and is re-assimilated onto THF at the
  # MTHFD1 synthetase rung above.
  branch from methylene_thf side right {
    formate
  }

  # Methylation charge sets the partitioning: SAM shuts the committed MTHFR step
  # down, SAH displaces it from the same regulatory site, so the SAM:SAH ratio
  # decides how much of the pool is committed to 5-methyl-THF.
  inhibit sam -> mthfr allosteric
  activate sah -> mthfr allosteric

  # Methionine synthase reductase keeps MTR's cobalamin reduced; without it the
  # enzyme oxidizes to cob(II)alamin and the folate pool falls into the methyl
  # trap, since MTHFR is irreversible and MTR is the only outlet.
  activate mtrr -> mtr redox

  # Dihydrofolate polyglutamate piles up when DHFR is blocked and inhibits AICAR
  # transformylase — part of why antifolates kill purine synthesis too.
  inhibit dhf -> atic feedback

  # Not drawable in MPL (the matrix folate species share cells with the
  # cytosolic ones, so the mitochondrial ladder has no column of its own):
  # Mg2+/Pi allosteric activation of the MTHFD2 dehydrogenase. See regulations[]
  # reg_pi_mthfd2.
}

# Heme biosynthesis — Michal draws the porphyrin route as one uninterrupted
# descending column, because that is what it is: eight steps, no side routes,
# no branch that leaves and returns. What ping-pongs is the *compartment*, not
# the carbon — matrix (ALAS), cytosol (ALAD → UROD), then back into the
# mitochondrion (CPOX, PPOX, FECH) — so the spine runs straight and the
# compartment story is carried by the enzymes, not by the geometry.
#
# Succinyl-CoA enters on a side arrow at the top, the way acetyl-CoA enters
# citrate synthase in the TCA chart diagonally adjacent (grid D5) — that side
# arrow *is* the coupling between the citric-acid cycle and heme output. Heme
# lands at the bottom pointing into oxidative phosphorylation (grid E5, directly
# below), which is what it is for: the cytochrome prosthetic group.
#
# Two condensations consume two copies of their own substrate (2 ALA → PBG,
# 4 PBG → HMB), drawn the way cholesterol's thiolase step is: the second copy
# re-enters on the arrow it is consumed by.
#
# Effectors sit in the left gutter. The long line back up the outside is the
# one that matters — heme, made at the bottom, shutting off ALAS1 at the top.

pathway heme-biosynthesis "Heme biosynthesis (porphyrin pathway)" {
  grid E4
  spacing 152

  spine at 0,0 {
    glycine
    -> alas1 [2.3.1.37] +succinyl_coa -coa -co2 !committed
    ala
    -> alad [4.2.1.24] +ala -h2o
    pbg
    -> hmbs [2.5.1.61] +pbg +h2o -nh3
    hmb
    -> uros [4.2.1.75] -h2o
    uroporphyrinogen3
    -> urod [4.1.1.37] -co2
    coproporphyrinogen3
    -> cpox [1.3.3.3] +o2 -co2 -h2o
    protoporphyrinogen9
    -> ppox [1.3.3.4] +o2 -h2o2
    protoporphyrin9
    -> fech [4.98.1.1] +fe2 -hplus
    heme
  }

  # End-product feedback: heme throttles the committed step directly (and blocks
  # import of the ALAS1 precursor into the mitochondrion). Fasting induces ALAS1
  # via PGC-1alpha and carbohydrate suppresses it — the 'glucose effect' that
  # makes IV glucose a treatment for acute porphyric attacks.
  inhibit heme -> alas1 feedback
  inhibit glucose -> alas1 hormonal

  # Lead hits the pathway twice, which is why it produces both the ALA and the
  # zinc-protoporphyrin accumulation seen in plumbism: it displaces the catalytic
  # Zn2+ of ALA dehydratase, and it blocks iron insertion at ferrochelatase.
  inhibit pb2 -> alad metal
  inhibit pb2 -> fech metal

  # Not drawable in MPL:
  #  - heme's transcriptional repression of ALAS1 (reg_heme_alas1_repression)
  #    targets the *gene* ALAS1, not the enzyme; MPL regulation lands on enzymes.
  #    It runs in parallel with the direct feedback line drawn above.
  #  - iron activation of ALAS2 (reg_iron_alas2) is translational control through
  #    a 5' IRE on the erythroid isozyme. ALAS2 catalyzes the identical reaction
  #    as ALAS1 (rel_alas_isozymes), so it has no arrow of its own on this spine;
  #    drawing it would duplicate the committed step rather than add a route.
  #
  # Also omitted from the arrows deliberately: the PLP of ALAS and the catalytic
  # Zn2+ of ALAD are prosthetic groups, not consumed — '+' / '-' on a reaction
  # means stoichiometry, so they stay off the chart. See reactions[].cofactors.
}

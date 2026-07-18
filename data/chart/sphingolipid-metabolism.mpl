# Sphingolipid metabolism — Michal draws the sphingoid series as one long
# descending column. The de novo run starts where L-serine meets palmitoyl-CoA on
# the cytosolic face of the ER and ends, seven arrows lower, at the single
# irreversible exit that takes carbon out of the sphingolipid pool for good.
#
# The two acyl donors ride in from the left as side cells beside the arrow each
# one feeds — palmitoyl-CoA into the SPT condensation, fatty acyl-CoA into the
# ceramide synthase step. They are co-substrates, not intermediates, so they never
# join the spine.
#
# Ceramide is the hub, so both head-group columns hang off it. Sphingomyelin runs
# down the right and glucosylceramide down the left; in both, the head group is
# what actually moves, so the arrow rides on the donor->product pair and ceramide
# enters and leaves on the side. That is also why the TNF line lands on SMPD1: the
# 'sphingomyelin cycle' regenerates ceramide as a stress second messenger.
#
# The rheostat closes at the bottom — SPHK1 lifts sphingosine to S1P, SGPP1 brings
# it back, SGPL1 cleaves what is left.
#
# Species carried in reactions[] but not drawable as +/- side entries, because
# MPL's cofactor token stops at a hyphen (`+palmitoyl-coa` lexes as `+palmitoyl`
# `-coa`). The three that matter are drawn as cells instead; the rest are noted here:
#   sm4  ferro-/ferricytochrome b5 — DES1's electron donor/acceptor pair, re-reduced
#        by cytochrome b5 reductase at the expense of NAD(P)H
#   sm8  fatty acid — released alongside sphingosine by acid ceramidase
# PLP is a prosthetic group, not a co-substrate, of both SPTLC2 and SGPL1, so it is
# not drawn as a side entry (see the cofactors[] of reactions sm1 and sm11).
#
# Not drawable at all: sm12, the salvage re-acylation of sphingosine to ceramide by
# the same ceramide synthases (CERS1-6). It is the quantitatively dominant route to
# ceramide in many cell types, but it runs back UP the spine from sphingosine to
# ceramide and an MPL column only flows one way.

pathway sphingolipid-metabolism "Sphingolipid metabolism (ceramide and the S1P rheostat)" {
  grid B3
  spacing 152

  spine at 0,0 {
    l-serine
    -> sptlc2 [2.3.1.50] -coa -co2 !committed
    ketosphinganine
    <-> kdsr [1.1.1.102] +nadph +hplus -nadp
    sphinganine
    -> cers2 [2.3.1.24] -coa
    dihydroceramide
    -> degs1 [1.14.19.17] +o2 +hplus -h2o
    ceramide
    -> asah1 [3.5.1.23] +h2o
    sphingosine
    -> sphk1 [2.7.1.91] +atp +hplus -adp
    s1p
    -> sgpl1 [4.1.2.27] -phosphoethanolamine
    hexadecenal
  }

  # The C16 acyl donor for the committed step — 16 of the sphingoid base's 18
  # carbons; serine contributes C1-C2 and the nitrogen.
  branch from l-serine side left {
    palmitoyl-coa
  }

  # The N-acyl donor. Chain length (C14-C26) is CERS-isoform specific and is what
  # sets the ceramide species.
  branch from sphinganine side left {
    acyl-coa
  }

  # Sphingomyelin column (Golgi out, lysosome back). Phosphocholine is the moiety
  # in motion: SMS1 hands it from phosphatidylcholine to ceramide and releases DAG;
  # acid sphingomyelinase strips it back off, regenerating ceramide.
  branch from ceramide side right {
    phosphatidylcholine
    -> sgms1 [2.7.8.27] +ceramide -dag
    sphingomyelin
    -> smpd1 [3.1.4.12] +h2o -ceramide
    phosphocholine
  }

  # Glycosphingolipid column. Glucose is the moiety in motion, carried from
  # UDP-glucose onto ceramide — the committed step of glycosphingolipid synthesis
  # and the branch point to lactosylceramide, gangliosides and globosides.
  branch from ceramide side left {
    udp-glucose
    -> ugcg [2.4.1.80] +ceramide -udp
    glucosylceramide
  }

  # S1P phosphatase, the counterweight to sphingosine kinase. Drawn the way the
  # ketolysis limb is drawn: the arrow rides on the hydrolysis pair while the two
  # sphingoid species enter and leave on the side.
  branch from s1p side left {
    h2o
    -> sgpp1 [3.1.3.114] +s1p -sphingosine
    pi
  }

  # reg_ceramide_spt — end-product feedback capping de novo synthesis at the
  # committed step, sensed by ER ORMDL proteins bound to the SPT complex.
  inhibit ceramide -> sptlc2 feedback

  # reg_ormdl3_spt — ORMDL3 is the transducer of that feedback: it forms a stable
  # complex with SPTLC1/SPTLC2 and inhibits catalysis ceramide-dependently.
  inhibit ormdl3 -> sptlc2 allosteric

  # reg_erk2_sphk1 — agonist-activated ERK1/2 phosphorylates SphK1 at Ser225,
  # raising kcat ~14-fold and driving translocation to the plasma membrane.
  activate erk2 -> sphk1 phosphorylation

  # reg_tnf_smase — the sphingomyelin cycle: TNF-alpha and other death-receptor
  # ligands switch on sphingomyelinase to generate ceramide as a stress signal.
  activate tnf -> smpd1 hormonal
}

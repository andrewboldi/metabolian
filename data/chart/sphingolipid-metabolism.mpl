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
# Ceramide is the hub, so both head-group columns hang off it: sphingomyelin down
# the right, glucosylceramide down the left. Both arms RE-LIST ceramide as their
# first step, the way the purine chart re-lists IMP, so that the bold arrow leaves
# the ceramide cell itself. What moves in these steps is a head group, but what the
# arrow must trace is the carbon backbone that survives the step — so ceramide is
# the spine of each arm and the head-group donor/acceptor pair rides in as a +/-
# side entry. Drawing it the other way round (donor on the arrow, ceramide on the
# side) made the boldest mark in each quadrant assert a reaction that does not
# exist, and left ceramide visually unconnected to its own products.
#
# The TNF line still lands on SMPD1: that hydrolysis is the 'sphingomyelin cycle'
# that regenerates ceramide as a stress second messenger, which is why ceramide is
# the side EXIT of the SMPD1 step and the column carries on to phosphocholine. A
# second arrow back to the ceramide cell is not drawable — it would land exactly on
# top of the SMS1 arrow (same two cells, same route reversed) and swap the two
# enzymes' cofactor labels.
#
# The rheostat closes at the bottom — SPHK1 lifts sphingosine to S1P, SGPP1 brings
# it back, SGPL1 cleaves what is left. SGPP1 is drawn as its own arm off S1P for
# the same reason as above: the sphingoid backbone is what it conserves, so the
# arrow runs S1P -> sphingosine with the hydrolysis pair on the side, not
# H2O -> Pi with the two sphingoid species pushed into the side entries.
#
# Species carried in reactions[] but not drawable as +/- side entries, because
# MPL's cofactor token stops at a hyphen (`+palmitoyl-coa` lexes as `+palmitoyl`
# `-coa`). The two acyl donors are drawn as cells instead; the rest are noted here:
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
  wrap 5   # both head-group arms now leave the ceramide cell itself, so ceramide
           # needs open paper below it; the default 3-column serpentine put the
           # SGPL1 tail in the corridor both arms have to cross

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

  # Sphingomyelin column (Golgi out, lysosome back). The ceramide backbone is what
  # is conserved across SMS1, so it stays on the arrow and the phosphocholine donor
  # pair rides in on the side: phosphatidylcholine in, DAG out. Acid sphingomyelinase
  # then hydrolyses the head group back off; the column follows the phosphocholine
  # that leaves and shows the regenerated ceramide as the side exit, because MPL
  # cannot draw a second arrow back to ceramide without laying it exactly on top of
  # the SMS1 arrow (same two cells, same route, reversed) and cross-attributing the
  # two enzymes' cofactor arcs. The TNF line lands on SMPD1 all the same: that step
  # IS the sphingomyelin cycle.
  branch from ceramide side right {
    ceramide
    -> sgms1 [2.7.8.27] +phosphatidylcholine -dag
    sphingomyelin
    -> smpd1 [3.1.4.12] +h2o -ceramide
    phosphocholine
  }

  # Glycosphingolipid column — the committed step of glycosphingolipid synthesis and
  # the branch point to lactosylceramide, gangliosides and globosides. Again the
  # ceramide backbone is the spine; glucose is the moiety in motion, arriving on the
  # side from UDP-glucose. (Spelled `udpglucose` in the side entry, not the module's
  # own `udp-glucose` id: MPL's cofactor token stops at a hyphen, so `+udp-glucose`
  # would lex as `+udp` `-glucose`. The unhyphenated id names the same compound —
  # KEGG C00029 — and is what the label lookup resolves against.)
  branch from ceramide side left {
    ceramide
    -> ugcg [2.4.1.80] +udpglucose -udp
    glucosylceramide
  }

  # S1P phosphatase, the counterweight to sphingosine kinase: it walks the spine's
  # last step back up. The sphingoid backbone is what is conserved across it, so the
  # arrow runs S1P -> sphingosine and the hydrolysis pair enters and leaves on the
  # side. (The two protons released with the Pi are left off, like the fatty acid at
  # ASAH1 — see the notes above.)
  branch from s1p side left {
    s1p
    -> sgpp1 [3.1.3.114] +h2o -pi
    sphingosine
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

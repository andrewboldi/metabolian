# Glycogen metabolism — the storage loop cut open at the nucleotide-sugar step so
# that both arms read downhill in a single Michal spine: activation (UTP + G1P →
# UDP-glucose), the committed synthase step into the granule, then phosphorolysis
# straight back out through the hexose-phosphate pool to blood glucose. Glucose
# 1-phosphate closes the loop as a red side-entry on the pyrophosphorylase arrow
# rather than as a line dragged back up the sheet. Pyrophosphate is hydrolysed in
# the right-hand column — that is what makes glycogenesis one-way. Allosteric
# effectors sit in the left gutter and feed back into the two committed steps.
#
# Not drawn (no distinct small-molecule node to hang them on): glycogenin priming
# and branching enzyme (both glycogen → glycogen), and the debranching enzyme's
# minor free-glucose release. The covalent cascade (glucagon/epinephrine → cAMP →
# PKA → phosphorylase kinase, insulin → GSK-3/PP1) is enzyme-on-enzyme regulation,
# which this grammar does not express — see regulations[] in the module.

pathway glycogen-metabolism "Glycogen synthesis and breakdown (glycogenesis & glycogenolysis)" {
  grid B6
  spacing 152

  spine at 0,0 {
    utp
    <-> ugp2 [2.7.7.9] +g1p +hplus -ppi
    udpglucose
    -> gys1 [2.4.1.11] -udp !committed
    glycogen
    <-> pygm [2.4.1.1] +pi !committed
    g1p
    <-> pgm1 [5.4.2.2]
    g6p
    -> g6pc1 [3.1.3.9] +h2o -pi
    glucose
  }

  # the pyrophosphate split off the UTP: hydrolysing it pulls UDP-glucose synthesis
  branch from utp side right {
    ppi
    -> ppa1 [3.6.1.1] +h2o -hplus
    pi
  }

  # reciprocal control: the same signal that fills the granule empties it
  activate g6p -> gys1 allosteric
  inhibit g6p -> pygm allosteric
  activate amp -> pygm allosteric
  inhibit atp -> pygm allosteric
}

# Glycogen metabolism — drawn as the ring it actually is. Glucose 1-phosphate is
# the hub: it is activated to UDP-glucose, polymerised into the granule, and
# released again by phosphorolysis straight back to G1P. Cutting that loop open
# into a linear spine (the earlier drawing) forced UTP onto the axis as though it
# were the carbon donor, and left G1P as an unconnected stub — so there was no
# traceable route from the hexose-phosphate pool into UDP-glucose at all.
#
# On the ring every cell is a carbon skeleton. UTP enters ugp2 as a red side-entry
# (it activates the sugar, it is not the sugar) and pyrophosphate leaves the same
# way; hydrolysing that PPi in the right-hand column is what makes glycogenesis
# one-way. The hexose-phosphate pool and the exit to blood glucose hang off G1P
# through their own real, named steps rather than through positional scaffolding.
#
# Not drawn (no distinct small-molecule node to hang them on): glycogenin priming
# and branching enzyme (both glycogen → glycogen), and the debranching enzyme's
# minor free-glucose release. The covalent cascade (glucagon/epinephrine → cAMP →
# PKA → phosphorylase kinase, insulin → GSK-3/PP1) is enzyme-on-enzyme regulation,
# which this grammar does not express — see regulations[] in the module.

pathway glycogen-metabolism "Glycogen synthesis and breakdown (glycogenesis & glycogenolysis)" {
  grid B6
  spacing 152
  radius 260

  cycle at 0,0 {
    g1p
    <-> ugp2 [2.7.7.9] +utp +hplus -ppi
    udpglucose
    -> gys1 [2.4.1.11] -udp !committed
    glycogen
    -> pygm [2.4.1.1] +pi !committed
  }

  # The hexose-phosphate pool, and the liver's exit to blood glucose. Re-listing
  # g1p makes phosphoglucomutase a real drawn step rather than a scaffold hairline.
  branch from g1p side right {
    g1p
    <-> pgm1 [5.4.2.2]
    g6p
    -> g6pc1 [3.1.3.9] +h2o -pi
    glucose
  }

  # the pyrophosphate split off the UTP: hydrolysing it pulls UDP-glucose synthesis
  branch from udpglucose side left {
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

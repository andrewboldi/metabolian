# Citric acid cycle — drawn as a true ring, the way Michal draws it. `cycle`
# places the nine members evenly around a circle starting at 12 o'clock and puts
# each reaction on the chord between consecutive members, so the loop actually
# closes (malate dehydrogenase regenerates oxaloacetate) instead of running a
# return line back down the spine through every cell.

pathway citric-acid-cycle "Citric acid cycle (TCA / Krebs cycle)" {
  grid D5
  radius 420

  cycle at 0,0 {
    oxaloacetate
    -> cs [2.3.3.1] +acetyl_coa +h2o -coa -hplus !committed
    citrate
    <-> aco2 [4.2.1.3] -h2o
    cis_aconitate
    <-> aco2 [4.2.1.3] +h2o
    isocitrate
    -> idh3a [1.1.1.41] +nad -co2 -nadh -hplus !committed
    akg
    -> ogdh [1.2.4.2] +coa +nad -co2 -nadh -hplus !committed
    succinyl_coa
    <-> suclg1 [6.2.1.4] +gdp +pi -coa -gtp
    succinate
    <-> sdha [1.3.5.1] +ubiquinone -ubiquinol
    fumarate
    <-> fh [4.2.1.2] +h2o
    malate
    <-> mdh2 [1.1.1.37] +nad -nadh -hplus
  }

  # The bridge reaction: glycolytic pyruvate is oxidatively decarboxylated to the
  # acetyl-CoA that condenses with oxaloacetate at citrate synthase.
  branch from oxaloacetate side left {
    pyruvate
    -> pdha1 [1.2.4.1] +coa +nad -co2 -nadh -hplus !committed
    acetyl_coa
  }

  # Citrate synthase: signalled that downstream intermediates and reducing power
  # are already abundant.
  inhibit succinyl_coa -> cs allosteric
  inhibit nadh -> cs allosteric

  # NAD+-isocitrate dehydrogenase is the principal flux-control point — energy
  # charge and matrix Ca2+ read straight into it.
  activate adp -> idh3a allosteric
  activate calcium -> idh3a allosteric
  inhibit nadh -> idh3a allosteric
  inhibit atp -> idh3a allosteric

  # The 2-oxoglutarate dehydrogenase complex is regulated the same way.
  inhibit succinyl_coa -> ogdh feedback
  inhibit nadh -> ogdh allosteric
  activate calcium -> ogdh allosteric
}

# Citric acid cycle — Michal draws the ring as a closed loop; in MPL a ring is a
# spine that names its opening metabolite again at the end, so the last arrow
# (malate dehydrogenase) runs back up the column to regenerate oxaloacetate.
# The pyruvate dehydrogenase bridge hangs off the left as the entry branch: it
# ends at acetyl-CoA, which rejoins the ring as the second substrate of citrate
# synthase (+acetyl_coa on the oxaloacetate -> citrate step). The effector gutter
# on the right carries the NADH/ATP/ADP/Ca2+ lines into the three control points.

pathway citric-acid-cycle "Citric acid cycle (TCA / Krebs cycle)" {
  grid D5
  spacing 210

  spine at 0,0 {
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
    oxaloacetate
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

  # The alpha-ketoglutarate dehydrogenase complex: Ca2+ on, own products off.
  activate calcium -> ogdh allosteric
  inhibit nadh -> ogdh feedback
  inhibit succinyl_coa -> ogdh feedback

  # PDH complex product inhibition (E2 by acetyl-CoA, E3 by NADH).
  inhibit acetyl_coa -> pdha1 feedback
  inhibit nadh -> pdha1 feedback

  # Not drawable in MPL (covalent enzyme -> enzyme control, not metabolite
  # effectors): PDK1 phosphorylates PDHA1 to switch the PDH complex off and PDP1
  # dephosphorylates it to switch it back on; acetyl-CoA and NADH stimulate PDK1
  # while pyruvate inhibits it, and Ca2+ activates PDP1. See regulations[]
  # reg_pdk_pdh / reg_pdp_pdh / reg_accoa_pdk / reg_nadh_pdk / reg_pyr_pdk /
  # reg_ca_pdp.
}

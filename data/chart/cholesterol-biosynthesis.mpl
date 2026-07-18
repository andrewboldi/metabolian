# Cholesterol biosynthesis — Michal's long descending column: acetyl-CoA at the
# top, the mevalonate/isoprenoid ladder in the middle, and the ~C27 sterol run
# down to cholesterol. The Bloch route (Δ24 retained) hangs off the left as a
# branch that rejoins at cholesterol; the effector gutter on the right feeds the
# statin/hormone control lines back into HMG-CoA reductase.

pathway cholesterol-biosynthesis "Cholesterol biosynthesis (mevalonate pathway)" {
  grid C4
  spacing 210

  spine at 0,0 {
    acetyl_coa
    <-> acat2 [2.3.1.9] +acetyl_coa -coa
    acetoacetyl_coa
    -> hmgcs1 [2.3.3.10] +acetyl_coa +h2o -coa
    hmg_coa
    -> hmgcr [1.1.1.34] +nadph -nadp -coa !committed
    mevalonate
    <-> mvk [2.7.1.36] +atp -adp
    mevalonate_5p
    <-> pmvk [2.7.4.2] +atp -adp
    mevalonate_5pp
    -> mvd [4.1.1.33] +atp -adp -pi -co2
    ipp
    <-> idi1 [5.3.3.2]
    dmapp
    -> fdps [2.5.1.1] +ipp -ppi
    gpp
    -> fdps [2.5.1.10] +ipp -ppi
    fpp
    -> fdft1 [2.5.1.21] +fpp -ppi
    presqualene_pp
    -> fdft1 [2.5.1.21] +nadph -nadp -ppi !committed
    squalene
    -> sqle [1.14.14.17] +o2 +nadph -nadp -h2o !committed
    epoxysqualene
    -> lss [5.4.99.7]
    lanosterol
    -> cyp51a1 [1.14.14.154] +o2 +nadph -nadp -formate
    ffmas
    -> tm7sf2 [1.3.1.70] +nadph -nadp
    tmas
    -> msmo1 [1.14.18.9] +o2 +nadh -nad -h2o
    methylzymosterol_carboxylate
    -> nsdhl [1.1.1.170] +nad -nadh -co2
    keto_methylzymosterol
    -> hsd17b7 [1.1.1.270] +nadph -nadp
    methylzymosterol
    -> msmo1 [1.14.18.9] +o2 +nadh -nad -h2o
    carboxy_cholestadienol
    -> nsdhl [1.1.1.170] +nad -nadh -co2
    zymosterone
    -> hsd17b7 [1.1.1.270] +nadph -nadp
    zymosterol
    -> dhcr24 [1.3.1.72] +nadph -nadp
    zymostenol
    <-> ebp [5.3.3.5]
    lathosterol
    -> sc5d [1.14.19.20] +o2 +nadh -nad -h2o
    dehydrocholesterol_7
    -> dhcr7 [1.3.1.21] +nadph -nadp
    cholesterol
  }

  # Bloch route: the Δ24 side-chain bond is carried through the demethylations
  # instead of being reduced at zymosterol, so the run ends at desmosterol and
  # DHCR24 acts last — rejoining the spine at cholesterol.
  branch from zymosterol side left {
    desmosterol
    -> dhcr24 [1.3.1.72] +nadph -nadp
    cholesterol
  }

  # Every control point converges on HMG-CoA reductase.
  # cholesterol: end-product feedback, exerted through SCAP/INSIG retention of
  # SREBP-2 in the ER (reg_cholesterol_srebp2) which shuts off HMGCR transcription.
  inhibit cholesterol -> hmgcr feedback
  inhibit lanosterol -> hmgcr degradation
  inhibit atorvastatin -> hmgcr competitive
  activate insulin -> hmgcr hormonal
}

# Glutathione — drawn the way Michal drew the γ-glutamyl cycle: the tripeptide's
# own carbon runs down the spine as a closed ring (two ATP-dependent ligations
# build GSH from glutamate, the cell-surface ectoenzyme GGT takes it apart again
# and hands glutamate back to the top of the column), and everything GSH *does*
# hangs off it as side arms. The redox couple is the right-hand loop: peroxide in
# at glutathione peroxidase, GSSG down, NADPH-driven glutathione reductase back up
# to GSH. GPX4 brings the membrane lipid hydroperoxides into the same GSSG pool.
# On the left, the glyoxalase pair detoxifies glycolytic methylglyoxal and returns
# the GSH it borrowed, and the phase II GST arm runs off the chart to the
# mercapturic-acid route. The GSH feedback line and the NRF2/KEAP1 axis sit in the
# effector gutter feeding the committed GCL step.

pathway glutathione-metabolism "Glutathione synthesis and redox cycling (γ-glutamyl cycle)" {
  grid C3
  spacing 152

  spine at 0,0 {
    glutamate
    -> gclc [6.3.2.2] +cysteine +atp -adp -pi -hplus !committed
    glu_cys
    -> gss [6.3.2.3] +glycine +atp -adp -pi -hplus
    gsh
    -> ggt1 [3.4.19.13] +h2o -cysgly
    glutamate
  }

  # The redox cycle. Two GSH reduce hydrogen peroxide to water; NADPH from the
  # oxidative pentose phosphate pathway then pulls GSSG back to 2 GSH, so the arm
  # rejoins the spine at glutathione.
  branch from gsh side right {
    h2o2
    -> gpx1 [1.11.1.9] +gsh -h2o
    gssg
    -> gsr [1.8.1.7] +nadph +hplus -nadp
    gsh
  }

  # GPX4 is the only peroxidase that reaches hydroperoxides of complex membrane
  # lipids; it feeds the same GSSG pool, and its failure is what triggers ferroptosis.
  branch from gsh side right {
    lipid_ooh
    -> gpx4 [1.11.1.12] +gsh -lipid_oh -h2o
    gssg
  }

  # Glyoxalase system: methylglyoxal from the glycolytic triose phosphates is
  # carried through a thioester intermediate to D-lactate. GSH is borrowed by
  # glyoxalase I and released again by glyoxalase II, so the arm returns to GSH.
  branch from gsh side left {
    methylglyoxal
    -> glo1 [4.4.1.5] +gsh !committed
    lactoylglutathione
    -> hagh [3.1.2.6] +h2o -dlactate -hplus
    gsh
  }

  # Phase II conjugation. This arm genuinely terminates here: the S-conjugate is
  # exported by MRP transporters and processed onward to a mercapturic acid
  # (relations[] rel_ct_conj_mercapturate), so it never rejoins the ring.
  branch from gsh side left {
    rx
    -> gstp1 [2.5.1.18] +gsh -halide
    gs_conjugate
  }

  # Product feedback on the rate-limiting ligase — competitive with glutamate,
  # Ki near the resting GSH concentration, so synthesis switches on the moment
  # oxidative stress draws the pool down.
  inhibit gsh -> gclc feedback

  # The antioxidant-response axis: KEAP1 holds NRF2 down until its sensor
  # cysteines are modified; freed NRF2 induces GCLC and GSR through AREs.
  activate nrf2 -> gclc transcriptional
  activate nrf2 -> gsr transcriptional
  inhibit keap1 -> nrf2 degradation

  # Not drawable in MPL: NRF2 also induces the GCL modifier subunit GCLM
  # (regulations[] reg_nrf2_gclm). GCLM has no reaction of its own — it tunes
  # GCLC's Km for glutamate and its Ki for GSH inside the GCL holoenzyme — so
  # there is no arrow on this chart for the effector line to land on.
}

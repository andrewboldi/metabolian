# Purine salvage — Michal's nucleotide corner: the adenosine/AMP column runs down
# the middle to the IMP hub and on into the guanine branch (IMPDH -> GMP). The
# free bases and nucleosides that feed salvage come in from the sides: adenine on
# the right (APRT), inosine/hypoxanthine on the left (ADA, PNP, HGPRT) and
# guanosine/guanine in the outer left column (PNP, HGPRT). The adenylosuccinate
# arm hangs off IMP and ends at fumarate, its anaplerotic output into the TCA
# cycle, with AMP leaving as the side product. Effectors sit in the right gutter
# and feed back into AMP deaminase.

pathway purine-salvage-pathway "Purine salvage pathway" {
  grid G3
  spacing 152

  spine at 0,0 {
    adenosine
    -> adk [2.7.1.20] +atp -adp -hplus
    amp
    -> ampd1 [3.5.4.6] +h2o -nh3
    imp
    -> impdh2 [1.1.1.205] +nad +h2o -nadh -hplus !committed
    xmp
    -> gmps [6.3.5.2] +gln +atp +h2o -glu -amp -ppi -hplus
    gmp
  }

  # The catabolic feed: ADA deaminates adenosine to inosine (the connector),
  # PNP phosphorolyzes it to hypoxanthine, and HGPRT recaptures the base as IMP.
  branch from adenosine side left {
    inosine
    <-> pnp [2.4.2.1] +pi -r1p
    hypoxanthine
    -> hprt1 [2.4.2.8] +prpp -ppi !committed
    imp
  }

  # Adenine has no upstream reaction in this module — it arrives from nucleic-acid
  # and nucleotide turnover. The connector is placement only; the labelled arrow
  # is the real APRT reaction (adenine + PRPP -> AMP + PPi).
  branch from adenosine side right {
    adenine
    -> aprt [2.4.2.7] +prpp -ppi !committed
    amp
  }

  # Adenine branch. The connector IMP -> adenylosuccinate is the ADSS step
  # (6.3.4.4, GTP-dependent committed step); ADSL then splits it, with AMP as the
  # side product and fumarate as the anaplerotic output of the purine nucleotide
  # (Lowenstein) cycle.
  branch from imp side right {
    samp
    <-> adsl [4.3.2.2] -amp
    fumarate
  }

  # Guanosine likewise enters from turnover; PNP and HGPRT then salvage it to GMP.
  branch from inosine side left {
    guanosine
    <-> pnp [2.4.2.1] +pi -r1p
    guanine
    -> hprt1 [2.4.2.8] +prpp -ppi !committed
    gmp
  }

  inhibit gmp -> impdh2 feedback
  inhibit imp -> hprt1 feedback
  inhibit gmp -> hprt1 feedback
  inhibit amp -> aprt feedback
  activate atp -> ampd1 allosteric
  inhibit gtp -> ampd1 allosteric
  inhibit adenosine -> adk substrate

  # Not drawable in MPL: AMP feedback-inhibits adenylosuccinate synthetase
  # (reg_amp_adss) — ADSS rides the IMP -> adenylosuccinate connector rather than a
  # labelled arrow — and ATP allosterically activates cytosolic 5'-nucleotidase II
  # (reg_atp_nt5c2), whose IMP -> inosine step is not on this layout. Guanine
  # deamination to xanthine (GDA, psalv10) is a terminal drain into purine
  # degradation, so it is left to the purine-degradation chart.
}

# De novo purine synthesis — Michal draws this as one long assembly line: the ring
# is built atom by atom on the ribose carrier, straight down the spine from R5P to
# IMP. IMP then forks reciprocally — the adenine arm to the left (GTP-driven), the
# guanine arm to the right (ATP-driven). Both arms re-list IMP as their first cell
# so each carries its own branch-head enzyme. Adenine/guanine effectors sit in the
# right-hand gutter and feed back onto the three committed steps.

pathway purine-de-novo-synthesis "De novo purine nucleotide biosynthesis" {
  grid F3
  spacing 210

  spine at 0,0 {
    r5p
    <-> prps1 [2.7.6.1] +atp -amp
    prpp
    -> ppat [2.4.2.14] +gln +h2o -glu -ppi !committed
    pra
    <-> gart [6.3.4.13] +gly +atp -adp -pi
    gar
    <-> gart [2.1.2.2] +formyl_thf -thf
    fgar
    -> pfas [6.3.5.3] +gln +atp +h2o -glu -adp -pi
    fgam
    -> gart [6.3.3.1] +atp -adp -pi
    air
    <-> paics [4.1.1.21] +co2
    cair
    -> paics [6.3.2.6] +asp +atp -adp -pi
    saicar
    <-> adsl [4.3.2.2] -fumarate
    aicar
    <-> atic [2.1.2.3] +formyl_thf -thf
    faicar
    -> atic [3.5.4.10] -h2o
    imp
  }

  # adenine arm — IMP + aspartate, paid for with GTP; fumarate leaves to the TCA cycle
  branch from imp side left {
    imp
    -> adss2 [6.3.4.4] +asp +gtp -gdp -pi !committed
    adenylosuccinate
    <-> adsl [4.3.2.2] -fumarate
    amp
  }

  # guanine arm — oxidation at C2 then amidation, paid for with ATP
  branch from imp side right {
    imp
    -> impdh2 [1.1.1.205] +nad +h2o -nadh -hplus !committed
    xmp
    -> gmps [6.3.5.2] +gln +atp +h2o -glu -amp -ppi
    gmp
  }

  inhibit adp -> prps1 allosteric
  inhibit gdp -> prps1 allosteric
  activate prpp -> ppat feedforward
  inhibit amp -> ppat feedback
  inhibit adp -> ppat feedback
  inhibit gmp -> ppat feedback
  inhibit gdp -> ppat feedback
  inhibit imp -> ppat feedback
  inhibit amp -> adss2 feedback
  inhibit gmp -> impdh2 feedback
}

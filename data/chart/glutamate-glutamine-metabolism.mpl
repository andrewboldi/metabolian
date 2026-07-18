# Glutamate / glutamine — the nitrogen hub, drawn the way Michal drew a trunk
# route: one vertical spine carries nitrogen from free ammonia through the
# glutamine–glutamate couple down to 2-oxoglutarate (the door to the TCA cycle).
# Every biosynthetic export hangs off that trunk as its own side column, and the
# effectors that gate the committed steps sit in the right-hand gutter.

pathway glutamate-glutamine-metabolism "Glutamate and glutamine metabolism" {
  grid C6
  spacing 152

  spine at 0,0 {
    ammonia
    -> glul [6.3.1.2] +glutamate +atp -adp -pi !committed
    glutamine
    -> gls [3.5.1.2] +h2o -ammonia -hplus !committed
    glutamate
    <-> glud1 [1.4.1.3] +h2o +nad -ammonia -nadh -hplus
    akg
  }

  # the glutamine amide nitrogen is handed to fructose-6-phosphate — the
  # rate-limiting entry into hexosamine biosynthesis
  branch from glutamine side right {
    f6p
    -> gfpt1 [2.6.1.16] -glutamate !committed
    glucosamine6p
  }

  # glutathione: the gamma-carboxyl of glutamate is ligated to cysteine
  branch from glutamate side left {
    cysteine
    -> gclc [6.3.2.2] +atp -adp -pi -hplus !committed
    glu_cys
  }

  # N-acetylglutamate — the switch that turns on the urea cycle
  branch from glutamate side right {
    acetylcoa
    -> nags [2.3.1.1] -coa -hplus
    nag
  }

  # glutamate decarboxylase (GAD65/GAD67) sheds CO2 to give the inhibitory
  # neurotransmitter; GABA leaves the module for the GABA shunt
  branch from glutamate side left {
    gaba
  }

  # transaminases: 2-oxoglutarate collects the amino group and glutamate leaves
  branch from akg side left {
    aspartate
    <-> got2 [2.6.1.1] -glutamate
    oaa
  }

  branch from akg side right {
    alanine
    <-> gpt [2.6.1.2] -glutamate
    pyruvate
  }

  activate pi -> gls allosteric
  inhibit glutamate -> gls feedback
  inhibit glutamine -> glul feedback
  activate adp -> glud1 allosteric
  activate leucine -> glud1 allosteric
  inhibit gtp -> glud1 allosteric
  inhibit udpglcnac -> gfpt1 feedback
  activate arginine -> nags allosteric
  inhibit gsh -> gclc feedback
}

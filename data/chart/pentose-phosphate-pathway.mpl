# Pentose phosphate pathway — the way Michal drew the shunt: the irreversible
# oxidative arm runs straight down the spine off glucose-6-phosphate (2 NADPH,
# one carbon lost as CO2), then the reversible sugar shuffle carries carbon back
# into glycolysis as fructose-6-phosphate. Xylulose-5-P comes into transketolase
# from the right, the triose product of transketolase I comes back into
# transaldolase from the left, and the NADPH/p53/NRF2 effectors sit in the
# gutter feeding regulation into the committed G6PD step.

pathway pentose-phosphate-pathway "Pentose phosphate pathway (hexose monophosphate shunt)" {
  grid C4
  spacing 210

  spine at 0,0 {
    g6p
    -> g6pd [1.1.1.49] +nadp -nadph -hplus !committed
    6pgl
    -> pgls [3.1.1.31] +h2o
    6pgc
    -> pgd [1.1.1.44] +nadp -nadph -hplus -co2
    ru5p
    <-> rpia [5.3.1.6]
    r5p
    <-> tkt [2.2.1.1]
    s7p
    <-> taldo1 [2.2.1.2]
    e4p
    <-> tkt [2.2.1.1]
    f6p
  }

  # xylulose 5-phosphate (ribulose-5-P epimerised) is the second transketolase
  # substrate — it rejoins the spine at sedoheptulose 7-phosphate
  branch from ru5p side right {
    x5p
    <-> tkt [2.2.1.1]
    s7p
  }

  # glyceraldehyde 3-phosphate, the triose released by transketolase I, is the
  # co-substrate of transaldolase and rejoins the spine at erythrose 4-phosphate
  branch from s7p side left {
    g3p
    <-> taldo1 [2.2.1.2]
    e4p
  }

  inhibit nadph -> g6pd feedback
  inhibit tp53 -> g6pd binding
  activate nrf2 -> g6pd transcriptional
}

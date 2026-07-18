# Glycolysis — laid out the way Michal drew it: one vertical spine, the triose
# branch to the left, effectors in a gutter feeding regulation back into the
# committed steps.

pathway glycolysis "Glycolysis (Embden–Meyerhof–Parnas)" {
  grid B5
  spacing 210

  spine at 0,0 {
    glucose
    -> hexokinase [2.7.1.1] +atp -adp !committed
    g6p
    <-> gpi [5.3.1.9]
    f6p
    -> pfk1 [2.7.1.11] +atp -adp !committed
    f16bp
    <-> aldolase [4.1.2.13]
    g3p
    <-> gapdh [1.2.1.12] +nad +pi -nadh -hplus
    bpg13
    <-> pgk1 [2.7.2.3] +adp -atp
    pg3
    <-> pgam1 [5.4.2.11]
    pg2
    <-> enolase [4.2.1.11] -h2o
    pep
    -> pyruvate_kinase [2.7.1.40] +adp -atp !committed
    pyruvate
  }

  # dihydroxyacetone phosphate rejoins the spine at glyceraldehyde-3-phosphate
  branch from f16bp side left {
    dhap
    <-> tpi [5.3.1.1]
    g3p
  }

  inhibit g6p -> hexokinase feedback
  activate f26bp -> pfk1 allosteric
  activate amp -> pfk1 allosteric
  inhibit atp -> pfk1 allosteric
  inhibit citrate -> pfk1 allosteric
  activate f16bp -> pyruvate_kinase feedforward
  inhibit alanine -> pyruvate_kinase allosteric
}

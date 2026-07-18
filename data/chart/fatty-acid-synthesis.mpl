# De novo lipogenesis — the citrate shuttle feeds a single vertical spine that
# runs acetyl-CoA -> malonyl-CoA (the committed carboxylation) into the FASN
# elongation cycle. The acetyl primer arm comes down the left and rejoins at the
# Claisen condensation; ACC's effectors sit in the right-hand gutter.

pathway fatty-acid-synthesis "De novo fatty acid synthesis (palmitate)" {
  grid C4
  spacing 210

  spine at 0,0 {
    citrate
    -> acly [2.3.3.8] +coa +atp -oaa -adp -pi
    acetyl-coa
    -> acc [6.4.1.2] +bicarbonate +atp -adp -pi -hplus !committed
    malonyl-coa
    <-> fasn [2.3.1.39] -coa
    malonyl-acp
    -> fasn [2.3.1.41] -co2
    acetoacetyl-acp
    <-> fasn [1.1.1.100] +nadph +hplus -nadp
    hydroxybutyryl-acp
    <-> fasn [4.2.1.59] -h2o
    butenoyl-acp
    -> fasn [1.3.1.39] +nadph +hplus -nadp
    butyryl-acp
    -> fasn [2.3.1.85] +nadph +hplus -co2 -coa -nadp -h2o
    palmitate
  }

  # The acetyl primer: acetyl-CoA is loaded onto ACP (FASN MAT, 2.3.1.38 — the
  # elbow) and condenses with malonyl-ACP, rejoining the spine at acetoacetyl-ACP.
  branch from acetyl-coa side left {
    acetyl-acp
    -> fasn [2.3.1.41] -co2
    acetoacetyl-acp
  }

  activate citrate -> acc allosteric
  inhibit palmitoyl-coa -> acc feedback
  activate insulin -> acc hormonal
}

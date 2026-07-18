# Gluconeogenesis — glycolysis read upward, drawn as Michal drew it: pyruvate at
# the top of a single descending spine, glucose at the foot. The malate shuttle
# hangs off the left as a short mitochondrial loop that returns to oxaloacetate,
# the triose branch hangs off the left lower down and rejoins at fructose
# 1,6-bisphosphate, and the effector gutter on the right carries the reciprocal
# control lines (AMP / F2,6BP / citrate / acetyl-CoA) plus the fasting hormones
# back into the four bypass enzymes.

pathway gluconeogenesis "Gluconeogenesis (glucose synthesis from pyruvate)" {
  grid B4
  spacing 152

  spine at 0,0 {
    pyruvate
    -> pc [6.4.1.1] +hco3 +atp -adp -pi -hplus !committed
    oaa
    <-> pck1 [4.1.1.32] +gtp -gdp -co2
    pep
    <-> enolase [4.2.1.11] +h2o
    pg2
    <-> pgam1 [5.4.2.11]
    pg3
    <-> pgk1 [2.7.2.3] +atp -adp
    bpg13
    <-> gapdh [1.2.1.12] +nadh +hplus -nad -pi
    g3p
    <-> aldolase [4.1.2.13]
    f16bp
    -> fbp1 [3.1.3.11] +h2o -pi !committed
    f6p
    <-> gpi [5.3.1.9]
    g6p
    -> g6pc [3.1.3.9] +h2o -pi
    glucose
  }

  # Malate shuttle. Oxaloacetate cannot cross the inner mitochondrial membrane,
  # so matrix MDH2 reduces it to malate (the link out of the spine), the
  # dicarboxylate carrier SLC25A11 exports it, and cytosolic MDH1 oxidises it
  # back — regenerating oxaloacetate for PEPCK and, just as importantly, the
  # cytosolic NADH that GAPDH consumes further down the spine.
  branch from oaa side left {
    mal
    <-> mdh1 [1.1.1.37] +nad -nadh -hplus
    oaa
  }

  # Triose branch. One glyceraldehyde 3-phosphate is isomerised to
  # dihydroxyacetone phosphate (triose-phosphate isomerase, 5.3.1.1 — the link
  # out of the spine); the two trioses then condense at aldolase, so the branch
  # rejoins exactly where the carbon does, at fructose 1,6-bisphosphate.
  branch from g3p side left {
    dhap
    <-> aldolase [4.1.2.13]
    f16bp
  }

  # Acetyl-CoA is an obligatory activator: pyruvate carboxylase is essentially
  # dead without it, coupling fatty-acid oxidation to gluconeogenic flux.
  activate accoa -> pc allosteric

  # FBPase-1 is the principal control point, reciprocal to PFK-1 at every input.
  inhibit f26bp -> fbp1 allosteric
  inhibit amp -> fbp1 allosteric
  activate citrate -> fbp1 allosteric
  activate glucagon -> fbp1 hormonal

  # Transcriptional control of the two hormonally regulated bypass enzymes:
  # glucagon/cAMP/CREB induces them, insulin represses them via FOXO1.
  activate camp -> pck1 transcriptional
  inhibit insulin -> pck1 transcriptional
  activate camp -> g6pc transcriptional
  inhibit insulin -> g6pc transcriptional
}

# Short-chain fatty acids — the colonic fermenter drawn the way Michal draws a
# fermentation: one carbon spine down the middle from the pyruvate node, and the
# three acid products hanging off it in their own columns.
#
# The spine is the butyryl-CoA ladder, because that is the longest unbroken
# carbon route in this module and it is where the two committed steps sit
# (thiolase condensing two acetyl-CoA, then the electron-bifurcating Bcd/EtfAB).
# It ends on the CoA-transferase `but` — the dominant colonic butyrate-forming
# enzyme — which is why acetate enters that arrow from the side: butyrate output
# is physically coupled to acetate uptake (cross-feeding).
#
# Acetate sits in the left gutter (acetyl-P -> acetate + ATP), with the
# hydrogenotrophic acetogens one column further out: the same pyruvate oxidation
# that fills the acetyl-CoA pool dumps its electrons as H2, and Wood-Ljungdahl
# acetogens re-fix that H2 with CO2 to yet more acetate. Propionate takes the
# right: the reductive-TCA / methylmalonyl-CoA (succinate) route of the
# Bacteroidetes in the near column, the minority acrylate route from lactate in
# the far one, both converging on propionyl-CoA.
#
# Three enzymes ride on connector elbows rather than labelled arrows, because
# MPL only labels arrows drawn inside a single column: phosphotransacetylase
# (pta, acetyl-CoA -> acetyl-P), phosphotransbutyrylase (ptb, butyryl-CoA ->
# butyryl-P) and D-lactate dehydrogenase (ldh, pyruvate -> lactate). Each is the
# entry step of the limb it points into. The propionyl-CoA -> propionate elbow
# likewise carries no enzyme of its own: propionate is liberated by CoA transfer
# (scpc from succinate, pct from lactate), and both transferases are labelled on
# the arrows where they act.

pathway scfa-microbiome-metabolism "Short-chain fatty acid production by gut microbiota" {
  grid G6
  spacing 210

  # BUTYRATE — the C4 ladder. Two acetyl units are condensed and the chain is
  # then reduced twice; flavin-based electron bifurcation at Bcd/EtfAB is what
  # makes the last reduction pay for low-potential ferredoxin.
  spine at 0,0 {
    pyruvate
    <-> pfor [1.2.7.1] +coa +fd_ox -co2 -fd_red -hplus !committed
    acetyl_coa
    <-> thl [2.3.1.9] +acetyl_coa -coa !committed
    acetoacetyl_coa
    <-> hbd [1.1.1.157] +nadh +hplus -nad
    hydroxybutyryl_coa
    <-> crt [4.2.1.150] -h2o
    crotonoyl_coa
    -> bcd [1.3.8.1] +nadh +fd_ox -nad -fd_red !committed
    butyryl_coa
    <-> but [2.8.3.8] +acetate -acetyl_coa
    butyrate
  }

  # ACETATE — the substrate-level-phosphorylation limb. The elbow off acetyl-CoA
  # is phosphotransacetylase; acetate kinase banks the ATP.
  branch from acetyl_coa side left {
    acetyl_p
    <-> acka [2.7.2.1] +adp -atp -hplus
    acetate
  }

  # REDUCTIVE ACETOGENESIS — the colonic H2 sink. Net Wood-Ljungdahl: 2 CO2 +
  # 4 H2 -> acetate, run by hydrogenotrophic acetogens (e.g. Blautia
  # hydrogenotrophica) on the H2 released by their neighbours' fermentation.
  branch from acetyl_coa side left {
    h2
    -> acs [2.3.1.169] +co2 -hplus -h2o
    acetate
  }

  # The minority terminal route to butyrate: phosphotransbutyrylase (the elbow)
  # then butyrate kinase, mirroring the pta/ackA pair. Less prevalent in the
  # human colon than the butyryl-CoA:acetate CoA-transferase on the spine.
  branch from butyryl_coa side left {
    butyryl_p
    <-> buk [2.7.2.7] +adp -atp -hplus
    butyrate
  }

  # PROPIONATE, route 1 — the succinate (methylmalonyl-CoA) pathway of the
  # Bacteroidetes. PEP is carboxylated, the reductive TCA branch runs down to
  # succinate through fumarate respiration, and the B12 mutase + mmdA
  # decarboxylase deliver propionyl-CoA. Propionate itself comes off the
  # scpC arrow, where the CoA is handed from propionyl-CoA back onto succinate,
  # so the CoA carrier cycles inside this column.
  branch from pyruvate side right {
    pep
    <-> pck [4.1.1.49] +co2 +adp -atp -hplus
    oxaloacetate
    <-> mdh [1.1.1.37] +nadh +hplus -nad
    malate
    <-> fum [4.2.1.2] -h2o
    fumarate
    -> frd [1.3.5.4] +quinol -quinone
    succinate
    <-> scpc [2.8.3.27] +propionyl_coa -propionate -hplus
    succinyl_coa
    <-> mcm [5.4.99.2] !committed
    r_methylmalonyl_coa
    <-> mce [5.1.99.1]
    s_methylmalonyl_coa
    -> mmd [4.1.1.-] -co2 !committed
    propionyl_coa
  }

  # PROPIONATE, route 2 — the acrylate pathway, a minority route (Megasphaera
  # elsdenii, Coprococcus catus). Lactate is charged by CoA transfer from
  # propionyl-CoA (releasing propionate), dehydrated by the radical LcdAB, and
  # reduced back to propionyl-CoA — rejoining route 1.
  branch from pyruvate side right {
    lactate
    <-> pct [2.8.3.1] +propionyl_coa -propionate
    lactoyl_coa
    <-> lcd [4.2.1.54] -h2o
    acryloyl_coa
    -> acr [1.3.1.95] +nadh +hplus -nad
    propionyl_coa
  }

  # Propionate leaves the cell as the free acid; both CoA-transferases above
  # release it, so the connector carries no enzyme of its own.
  branch from propionyl_coa side right {
    propionate
  }

  # HOST SIGNALLING — the point of the whole module. All three acids are
  # receptor ligands rather than effectors of the fermentation itself, so these
  # lines run from the SCFA cells out to host proteins (FFAR2/GPR43,
  # FFAR3/GPR41, HCAR2/GPR109A) that catalyse no reaction on this chart.
  activate acetate -> ffar2 hormonal
  activate propionate -> ffar2 hormonal
  activate propionate -> ffar3 hormonal
  activate butyrate -> ffar3 hormonal
  activate butyrate -> hcar2 hormonal

  # Butyrate's second job: class-I histone deacetylase inhibition in the
  # colonocyte nucleus, which is how fibre intake reaches host epigenetics.
  inhibit butyrate -> hdac1 epigenetic
}

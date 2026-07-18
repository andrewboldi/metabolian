# Ketone bodies — Michal's shunt off the β-oxidation acetyl-CoA pool. One
# ketogenic spine runs down the middle (liver mitochondrion): two acetyl units
# are condensed by thiolase, a third is added by HMGCS2 (the committed step),
# and the lyase snaps HMG-CoA into acetoacetate. BDH1 poises acetoacetate
# against D-β-hydroxybutyrate on the mitochondrial NADH/NAD+ ratio.
#
# Acetone hangs off to the left as the dead end — slow non-enzymatic
# decarboxylation, exhaled, no enzyme to label the arrow with. The ketolytic
# limb sits in the right column: SCOT hands CoA from succinyl-CoA onto
# acetoacetate (succinyl-CoA -> succinate is the arrow, the ketone body enters
# on the side), which is why the ring closes back at acetoacetyl-CoA and why
# the liver — which lacks SCOT — cannot burn what it makes. Effectors converge
# on HMGCS2 in the outer gutter.

pathway ketone-body-metabolism "Ketone body metabolism (ketogenesis / ketolysis)" {
  grid C5
  spacing 152

  spine at 0,0 {
    acetyl_coa
    <-> acat1 [2.3.1.9] -coa
    acetoacetyl_coa
    -> hmgcs2 [2.3.3.10] +acetyl_coa +h2o -coa -hplus !committed
    hmg_coa
    -> hmgcl [4.1.3.4] -acetyl_coa
    acetoacetate
    <-> bdh1 [1.1.1.30] +nadh +hplus -nad
    bhb
  }

  # Acetone: slow spontaneous decarboxylation of acetoacetate — no enzyme, and
  # a true dead end (exhaled / excreted), so it never rejoins the spine.
  branch from acetoacetate side left {
    acetone
  }

  # Ketolysis (extrahepatic mitochondria): SCOT transfers CoA from succinyl-CoA
  # to acetoacetate, regenerating acetoacetyl-CoA, which thiolase then cleaves
  # back to two acetyl-CoA for the TCA cycle.
  branch from acetoacetate side right {
    succinyl_coa
    <-> oxct1 [2.8.3.5] +acetoacetate -acetoacetyl_coa !committed
    succinate
  }

  # Control converges on mitochondrial HMG-CoA synthase.
  inhibit succinyl_coa -> hmgcs2 covalent
  activate sirt3 -> hmgcs2 covalent
  activate ppara -> hmgcs2 transcriptional
  activate glucagon -> hmgcs2 hormonal
  inhibit insulin -> hmgcs2 hormonal
}

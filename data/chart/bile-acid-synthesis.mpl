# Bile acid synthesis — the exit door for cholesterol, and the only run on the
# sheet that ends in detergents rather than in metabolites. Michal's shape for it
# is two ladders standing side by side under one fork. Everything down to
# 7alpha-hydroxycholest-4-en-3-one is shared; CYP8B1 is the switch. Take the
# 12alpha-hydroxylation and the carbon walks down the centre spine to cholic
# acid — skip it and the very same enzymes walk down the left branch to
# chenodeoxycholic acid. AKR1C4, CYP27A1, SLC27A5, AMACR, ACOX2, HSD17B4, SCPx
# and BAAT therefore appear twice, once per column, rung for rung: the two
# products differ by a single hydroxyl and nothing else, and drawing them abreast
# is the clearest way to say so.
#
# The alternative (acidic) route hangs off cholesterol on the right and runs the
# same two chemistries in the opposite order — CYP27A1 oxidises the side chain
# FIRST, then CYP7B1 installs the 7alpha-OH. It feeds the CDCA column, but the
# module only carries it as far as 7alpha,26-dihydroxy-4-cholesten-3-one (bas28),
# so it is drawn short and honest rather than forced into a false rejoin.
#
# Effectors sit in the right gutter. The long lines climbing back up the outside
# are the whole point of the picture: bile acids returning from the gut switching
# off the step that made them.
#
# Four connectors are plain elbows, because MPL can label an enzyme only on a
# reaction drawn inside a column, never on a jump between columns. Every one of
# them is a real, named step, and every one of those enzymes is labelled
# elsewhere on this chart:
#   cholesterol -> 27-hydroxycholesterol              CYP27A1 EC 1.14.15.15  (bas26)
#   7a-OH-cholest-4-en-3-one -> 7a-OH-5b-cholestan-3-one
#                                                     AKR1D1  EC 1.3.1.3     (bas15)
#   choloyl-CoA -> taurocholate                       BAAT    EC 2.3.1.65 +taurine (bas14)
#   chenodeoxycholoyl-CoA -> taurochenodeoxycholate   BAAT    EC 2.3.1.65 +taurine (bas25)

pathway bile-acid-synthesis "Bile acid synthesis (classic and alternative pathways)" {
  grid C3
  spacing 210

  # CLASSIC (NEUTRAL) PATHWAY -> CHOLIC ACID.
  # CYP7A1 is the rate-limiting, committed step of all bile-acid synthesis and
  # CYP8B1 is the committed step of the cholic-acid arm — the enzyme that sets
  # the CA:CDCA ratio. Both are drawn heavy, and both are what the gutter lines
  # come back to.
  # The CYP27A1 arrow is three successive mitochondrial oxidations of C26/C27
  # (26-ol -> 26-al -> 26-oate, bas6: 3 O2 + 3 NADPH); MPL carries no
  # stoichiometry, so the cofactors ride in once.
  # SLC27A5 -> AMACR -> ACOX2 -> HSD17B4 x2 -> SCPx is one turn of peroxisomal
  # beta-oxidation: it lops three carbons off the C27 side chain as propionyl-CoA
  # and hands over the C24 bile acyl-CoA.
  spine at 0,0 {
    cholesterol
    -> cyp7a1 [1.14.14.23] +o2 +nadph +hplus -h2o -nadp !committed
    hydroxycholesterol_7a
    -> hsd3b7 [1.1.1.181] +nad -nadh -hplus
    c7a_hydroxy_4_cholesten_3_one
    -> cyp8b1 [1.14.14.139] +o2 +nadph +hplus -h2o -nadp !committed
    dihydroxy_4_cholesten_3_one_7a12a
    -> akr1d1 [1.3.1.3] +nadph +hplus -nadp
    dihydroxy_5b_cholestan_3_one_7a12a
    -> akr1c4 [1.1.1.50] +nadph +hplus -nadp
    triol_ca
    -> cyp27a1 [1.14.15.15] +o2 +nadph +hplus -nadp -h2o
    thca
    -> slc27a5 [6.2.1.7] +atp +coa -amp -ppi
    thca_coa_25r
    <-> amacr [5.1.99.4]
    thca_coa_25s
    -> acox2 [1.17.99.3] +o2 -h2o2
    thca_enoyl_coa
    <-> hsd17b4 [4.2.1.107] +h2o
    thca_24oh_coa
    <-> hsd17b4 [1.1.1.-] +nad -nadh -hplus
    thca_24oxo_coa
    -> scp2 [2.3.1.176] +coa -propionyl_coa
    choloyl_coa
    -> baat [2.3.1.65] +glycine -coa
    glycocholate
  }

  # CHENODEOXYCHOLIC ACID — the 12alpha-deoxy column. Identical chemistry to the
  # spine from AKR1C4 onward, one hydroxyl lighter throughout, so it is drawn
  # rung for rung beside it. The fork elbow is AKR1D1 (bas15), the same
  # 5beta-reduction the spine runs one step lower down.
  branch from c7a_hydroxy_4_cholesten_3_one side left {
    c7a_hydroxy_5b_cholestan_3_one
    -> akr1c4 [1.1.1.50] +nadph +hplus -nadp
    diol_cdca
    -> cyp27a1 [1.14.15.15] +o2 +nadph +hplus -nadp -h2o
    dhca
    -> slc27a5 [6.2.1.7] +atp +coa -amp -ppi
    dhca_coa_25r
    <-> amacr [5.1.99.4]
    dhca_coa_25s
    -> acox2 [1.17.99.3] +o2 -h2o2
    dhca_enoyl_coa
    <-> hsd17b4 [4.2.1.107] +h2o
    dhca_24oh_coa
    <-> hsd17b4 [1.1.1.-] +nad -nadh -hplus
    dhca_24oxo_coa
    -> scp2 [2.3.1.176] +coa -propionyl_coa
    chenodeoxycholoyl_coa
    -> baat [2.3.1.65] +glycine -coa
    glycochenodeoxycholate
  }

  # BAAT amidates each acyl-CoA with glycine OR taurine — one enzyme, two
  # acceptors, glyco:tauro roughly 3:1 in humans. The glycine arrow carries the
  # label on each column; the taurine conjugate forks off beside it.
  branch from choloyl_coa side right {
    taurocholate
  }

  branch from chenodeoxycholoyl_coa side left {
    taurochenodeoxycholate
  }

  # ALTERNATIVE (ACIDIC) PATHWAY — side chain first. Runs in macrophages and
  # other extrahepatic tissues as well as liver, is quantitatively minor in the
  # healthy adult, and matters in the neonate and in cholestasis. It feeds the
  # CDCA column. 27-Hydroxycholesterol also leaves this column as a signal: it
  # is the oxysterol that licenses LXRalpha (see the gutter).
  branch from cholesterol side right {
    hydroxycholesterol_27
    -> cyp7b1 [1.14.14.29] +o2 +nadph +hplus -h2o -nadp
    dihydroxycholesterol_7a27
    -> hsd3b7 [1.1.1.181] +nad -nadh -hplus
    dihydroxy_4_cholesten_3_one_7a26
  }

  # END-PRODUCT FEEDBACK, drawn as its net effect on the enzymes. Bile acids
  # reabsorbed from the ileum are ligands for FXR (CDCA is the most potent,
  # reg_cdca_fxr; cholate weaker, reg_ca_fxr), and the cascade below them ends
  # in repression of CYP7A1 (reg_shp_cyp7a1, reg_fgf19_cyp7a1) and of CYP8B1
  # (reg_shp_cyp8b1) — so less bile acid is made and, separately, less of what
  # is made is cholic acid.
  inhibit chenodeoxycholate -> cyp7a1 feedback
  inhibit cholate -> cyp7a1 feedback
  inhibit chenodeoxycholate -> cyp8b1 feedback

  # Feed-forward on the other side: oxysterols activate LXRalpha
  # (reg_oxysterol_lxra), which induces CYP7A1 (reg_lxra_cyp7a1) so a cholesterol
  # load is disposed of as bile acid. Species caveat worth reading off the chart:
  # this arm is rodent — the human CYP7A1 promoter lacks a functional LXRE.
  activate hydroxycholesterol_27 -> cyp7a1 transcriptional

  # Not drawable in MPL — MPL regulation runs metabolite -> enzyme, and every
  # link below is protein -> protein or protein -> gene:
  #   reg_fxr_shp        FXR induces SHP (NR0B2)
  #   reg_shp_lrh1 / reg_shp_hnf4a   SHP inactivates LRH-1 and antagonises HNF4a
  #   reg_lrh1_cyp7a1 / reg_hnf4a_cyp7a1 / reg_hnf4a_cyp8b1
  #                      the activators SHP removes from those two promoters
  #   reg_fxr_fgf19 -> reg_fgf19_fgfr4 -> reg_fgf19_cyp7a1
  #                      the enterohepatic arm: ileal FXR induces FGF19, which
  #                      travels in portal blood to hepatic FGFR4/beta-Klotho and
  #                      represses CYP7A1. In humans this, not the hepatic
  #                      FXR/SHP arm, dominates postprandial feedback — it is the
  #                      reason the inhibit lines above are drawn from the bile
  #                      acids themselves rather than from any single receptor.
  #
  # Also off-chart by design: the free acids cholate and chenodeoxycholate sit in
  # the gutter as effectors, not on a ladder, because no enzyme in this module
  # makes them — the conjugates are secreted, and gut bacterial bile-salt
  # hydrolases deconjugate them (rel_microbiome_ca, rel_microbiome_cdca).
}

# The Warburg effect — drawn the way Michal drew a rewired sheet: the glucose
# spine runs straight down the middle from the transported hexose to secreted
# lactate, and every limb that a tumour cell pulls carbon into hangs off it in
# its own column.
#
#   far left   fructose-2,6-bisphosphate futile cycle (PFKFB3 up, TIGAR down)
#   near left  glutaminolysis — the second fuel, a ladder standing parallel to
#              the glucose ladder, ending at alpha-ketoglutarate (TCA anaplerosis)
#   spine      glucose -> G6P .. PEP -> pyruvate -> LACTATE
#   near right serine-synthesis diversion off 3-phosphoglycerate
#   far right  the suppressed oxidative fate: PDH to acetyl-CoA
#
# The gap between glucose-6-phosphate and phosphoenolpyruvate is deliberate and
# honest: those are the shared Embden-Meyerhof steps (PGI, PFK-1, aldolase,
# GAPDH, PGK, PGAM, enolase) and they are drawn in the `glycolysis` module. This
# module only carries the reactions cancer actually changes, so fructose-6-P and
# 3-phosphoglycerate are placed in the limbs where their cancer enzymes act
# (PFKFB3, PHGDH) rather than repeated on the trunk; the elbows off G6P mark
# where each one sits further down the shared backbone.
#
# Effectors converge from the right-hand gutter, and the transcription factors
# sit lowest: HIF-1alpha and MYC drive the whole glycolytic program, p53 drives
# the one brake (TIGAR), and the HIF-1alpha -> PDK1 -| PDH cascade is the covalent
# switch that turns pyruvate away from the mitochondrion.

pathway warburg-effect-cancer "Warburg effect and cancer metabolic rewiring" {
  grid B6
  spacing 210

  # Aerobic glycolysis: glucose in through GLUT1, out again as lactate through
  # MCT4, at a rate that no longer answers to the cell's ATP demand.
  spine at 0,0 {
    glucose
    -> hk2 [2.7.1.1] +atp -adp -hplus !committed
    g6p
    pep
    -> pkm2 [2.7.1.40] +adp +hplus -atp
    pyruvate
    <-> ldha [1.1.1.27] +nadh +hplus -nad
    lactate
  }

  # Glutaminolysis — the second fuel of a proliferating cell, and the reason
  # tumours are "glutamine addicted". It is anchored on ammonia, the nitrogen
  # both steps shed as a side-exit rather than a cell, so the ladder stands free
  # beside the glucose spine: this carbon never rejoins glycolysis, it leaves at
  # alpha-ketoglutarate to replenish the TCA cycle (rel_ct_akg_tca).
  branch from ammonia side left {
    glutamine
    -> gls [3.5.1.2] +h2o -ammonia -hplus !committed
    glutamate
    <-> glud1 [1.4.1.3] +h2o +nad -ammonia -nadh -hplus
    akg
  }

  # The fructose-2,6-bisphosphate cycle: a true futile cycle, so it is drawn as a
  # ring that closes back on fructose-6-phosphate. PFKFB3 makes the activator,
  # p53's TIGAR tears it down. F2,6BP itself carries no flux — it leaves this
  # sheet as the most potent allosteric activator of PFK-1 (rel_ct_f26bp_glycolysis).
  branch from g6p side left {
    f6p
    -> pfkfb3 [2.7.1.105] +atp -adp -hplus
    f26bp
    -> tigar [3.1.3.46] +h2o -pi
    f6p
  }

  # Serine-synthesis diversion. PKM2's restrained activity backs 3-phosphoglycerate
  # up, and amplified PHGDH pulls it out of glycolysis toward serine and one-carbon
  # units. The two steps that finish the job (PSAT1, PSPH) live in the
  # glycine-serine-threonine module, so serine sits below its precursor without an
  # arrow — it is here because it feeds straight back as a PKM2 activator.
  branch from g6p side right {
    pg3
    <-> phgdh [1.1.1.95] +nad -nadh -hplus !committed
    php
    serine
  }

  # The road not taken. Pyruvate's oxidative fate is drawn on the coenzyme A that
  # accepts the acetyl group — pyruvate rides in as the side entry, because in MPL
  # the trunk already spends pyruvate on lactate dehydrogenase. In the Warburg
  # state this limb is throttled shut (see the PDK1 line below).
  branch from pyruvate side right {
    coa
    -> pdh [1.2.4.1] +pyruvate +nad -co2 -nadh
    acetyl_coa
  }

  # Hexokinase 2 is comparatively deaf to this product feedback — mitochondrial
  # docking is what lets it keep phosphorylating glucose (reg_g6p_hk2).
  inhibit g6p -> hk2 feedback

  # PKM2 is a rheostat, not a valve: upstream flux (F1,6BP) and biosynthetic
  # sufficiency (serine) both push it back into the active tetramer, and MYC
  # biases splicing of the PKM gene toward the M2 isoform in the first place.
  activate f16bp -> pkm2 allosteric
  activate serine -> pkm2 allosteric
  activate myc -> pkm2 splicing

  # The pyruvate-dehydrogenase switch — the heart of the Warburg state. PDK1
  # phosphorylates the E1-alpha subunit and shuts the complex down; acetyl-CoA and
  # NADH reinforce it with ordinary product feedback.
  inhibit pdk1 -> pdh phosphorylation
  inhibit acetyl_coa -> pdh feedback
  inhibit nadh -> pdh feedback

  # HIF-1alpha: the master switch of the glycolytic gene program. Drawn onto the
  # enzymes its targets encode, and onto PDK1 itself — HIF-1alpha turns PDK1 on,
  # PDK1 turns PDH off.
  activate hif1a -> hk2 transcriptional
  activate hif1a -> pfkfb3 transcriptional
  activate hif1a -> ldha transcriptional
  activate hif1a -> pdk1 transcriptional

  # MYC runs the parallel program: lactate production and glutamine catabolism
  # (the latter indirectly, by repressing miR-23a/b).
  activate myc -> ldha transcriptional
  activate myc -> gls transcriptional

  # p53 supplies the only brake on this sheet. Losing it is what releases the
  # phenotype.
  activate tp53 -> tigar transcriptional

  # Not drawable in MPL — a cell is one metabolite, and a transporter's substrate
  # and product are the same metabolite in two compartments, so GLUT1 (war1),
  # MCT4 (war6) and ASCT2 (war9) have no arrow to sit on. Their control edges go
  # with them: HIF-1alpha and MYC induce SLC2A1/GLUT1 while p53 represses it
  # (reg_hif_slc2a1, reg_myc_slc2a1, reg_p53_slc2a1), and HIF-1alpha induces
  # SLC16A3/MCT4 to dump the acid load (reg_hif_slc16a3). Read the spine's first
  # cell as post-GLUT1 glucose and its last as pre-MCT4 lactate.
}

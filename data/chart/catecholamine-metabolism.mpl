# Catecholamine metabolism — Michal draws this as one long vertical descent from
# the amino acid to the urine: tyrosine falls through the four biosynthetic
# enzymes (TH, AADC, DBH, PNMT) to adrenaline, then straight on through COMT and
# MAO to vanillylmandelate, the end-metabolite the clinical lab actually measures.
#
# Everything hanging off that spine is the same two clearing enzymes run in the
# opposite order. MAO-first routes go out to the LEFT (via the reactive
# catecholaldehydes DOPAL and DOPEGAL); COMT-first routes go out to the RIGHT
# (via the O-methylated amines 3-MT and normetanephrine). Each pair converges
# again on its shared end-product — the dopamine arms on HVA, the noradrenaline
# arms on VMA — which is exactly the diamond Michal uses to show that two enzymes
# acting in either order reach the same acid.
#
# The connector into each branch (drawn as a plain link, no enzyme name) is the
# fork's first step: dopamine -> DOPAL is MAO, dopamine -> 3-MT is COMT,
# noradrenaline -> DOPEGAL is MAO-A, noradrenaline -> normetanephrine is COMT,
# and DOPEGAL -> DOMA is ALDH2. All five of those enzymes are drawn and named on
# other steps of the chart, so no enzyme identity is lost.

pathway catecholamine-metabolism "Catecholamine biosynthesis and degradation" {
  grid C4
  spacing 210

  # BIOSYNTHESIS (tyrosine -> adrenaline) then adrenaline's clinical degradation
  # route: COMT to metanephrine, MAO to the glycolaldehyde, ALDH2 to VMA.
  spine at 0,0 {
    tyrosine
    -> th [1.14.16.2] +bh4 +o2 -bh2 -h2o !committed
    ldopa
    -> ddc [4.1.1.28] -co2
    dopamine
    -> dbh [1.14.17.1] +ascorbate +o2 -mdha -h2o
    norepinephrine
    -> pnmt [2.1.1.28] +sam -sah
    epinephrine
    -> comt [2.1.1.6] +sam -sah
    metanephrine
    -> maoa [1.4.3.4] +h2o +o2 -methylamine -h2o2
    mhpg_ald
    -> aldh2 [1.2.1.3] +nad +h2o -nadh -hplus
    vma
  }

  # DOPAMINE, MAO first — the intraneuronal route. The link in from dopamine is
  # the MAO step (EC 1.4.3.4) that makes the neurotoxic aldehyde DOPAL.
  branch from dopamine side left {
    dopal
    -> aldh2 [1.2.1.3] +nad +h2o -nadh -hplus
    dopac
    -> comt [2.1.1.6] +sam -sah
    hva
  }

  # DOPAMINE, COMT first — the extraneuronal route, and the other side of the
  # diamond: it rejoins the MAO arm at homovanillate. The link in from dopamine
  # is the COMT step (EC 2.1.1.6) that makes 3-methoxytyramine.
  branch from dopamine side right {
    mtyr
    -> maob [1.4.3.4] +h2o +o2 -nh3 -h2o2
    homovanillin
    -> aldh2 [1.2.1.3] +nad +h2o -nadh -hplus
    hva
  }

  # NORADRENALINE, MAO first. The link in from noradrenaline is the MAO-A step
  # (EC 1.4.3.4) making DOPEGAL. Inside the neuron the aldehyde is reduced, not
  # oxidised, so this arm runs on to MHPG — the principal CNS end-metabolite.
  branch from norepinephrine side left {
    dopegal
    <-> akr1a1 [1.1.1.2] +nadh +hplus -nad
    dhpg
    -> comt [2.1.1.6] +sam -sah
    mhpg
  }

  # The oxidative fate of the same aldehyde: ALDH2 (EC 1.2.1.3, the link in)
  # takes DOPEGAL to 3,4-dihydroxymandelate, which COMT finishes as VMA — so
  # this arm rejoins the spine at the bottom.
  branch from dopegal side left {
    dhma
    -> comt [2.1.1.6] +sam -sah
    vma
  }

  # NORADRENALINE, COMT first. The link in from noradrenaline is the COMT step
  # (EC 2.1.1.6) making normetanephrine — with metanephrine, the fractionated
  # plasma metanephrines that are the sensitive test for phaeochromocytoma. It
  # rejoins the spine at the shared glycolaldehyde.
  branch from norepinephrine side right {
    normetanephrine
    -> maoa [1.4.3.4] +h2o +o2 -nh3 -h2o2
    mhpg_ald
  }

  # End-product feedback on the rate-limiting step: dopamine and noradrenaline
  # compete with the BH4 cofactor at tyrosine hydroxylase (reg_da_th, reg_ne_th).
  # This is the dominant minute-to-minute control of catecholamine synthesis.
  inhibit dopamine -> th feedback
  inhibit norepinephrine -> th feedback

  # Adrenal cortical glucocorticoid, delivered to the medulla at high
  # concentration by the intra-adrenal portal circulation, induces PNMT and TH
  # transcription — which is why adrenaline output is cortisol-dependent
  # (reg_cortisol_pnmt, reg_cortisol_th).
  activate cortisol -> th transcriptional
  activate cortisol -> pnmt transcriptional

  # SAH product-inhibits both SAM-dependent methyltransferases, tying
  # catecholamine methylation to the methionine cycle (reg_sah_comt, reg_sah_pnmt).
  inhibit sah -> comt feedback
  inhibit sah -> pnmt feedback

  # Not drawn:
  # - reg_pka_th: PKA phosphorylates tyrosine hydroxylase at Ser40 (with CaMKII/
  #   PKC at Ser19/Ser31), lowering its affinity for the inhibitory end-products
  #   above. Protein -> enzyme phosphorylation is not a metabolite effector and
  #   has no MPL form; see regulations[] reg_pka_th.
  # - deg_epi_mao: adrenaline is also deaminated by MAO to DOPEGAL, converging on
  #   the noradrenaline arm. Drawing it would require an edge from the spine down
  #   past two rows into the left column, which crosses intervening cells; the
  #   identical noradrenaline -> DOPEGAL step is drawn instead.
}

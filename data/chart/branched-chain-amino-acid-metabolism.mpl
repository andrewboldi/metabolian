# Branched-chain amino acid degradation — Michal draws the three BCAAs as three
# parallel ladders that run the same two opening steps (BCAT transamination, then
# the committed BCKDH decarboxylation) before their carbon skeletons diverge.
# Leucine takes the centre spine (purely ketogenic); isoleucine hangs off the left
# and rejoins the spine at acetyl-CoA; valine runs down the right to propionyl-CoA
# — which is also isoleucine's second product, so the two glucogenic arms converge.
#
# The branches anchor on 2-oxoglutarate: it is the amino-group acceptor shared by
# all three transaminations, and it rides in as a side-entry cofactor rather than a
# cell. That keeps the three ladders standing side by side without drawing a false
# interconversion arrow between the amino acids — leucine, isoleucine and valine
# never convert into one another.

pathway branched-chain-amino-acid-metabolism "Branched-chain amino acid (BCAA) degradation" {
  grid D6
  spacing 152

  # LEUCINE — purely ketogenic. HMG-CoA lyase splits the skeleton into the ketone
  # body acetoacetate (side product) and acetyl-CoA (the cell the spine ends on).
  spine at 0,0 {
    leucine
    <-> bcat2 [2.6.1.42] +akg -glutamate
    kic
    -> bckdha [1.2.4.4] +coa +nad -co2 -nadh !committed
    isovaleryl_coa
    -> ivd [1.3.8.4] +fad -fadh2
    methylcrotonyl_coa
    -> mccc1 [6.4.1.4] +atp +hco3 -adp -pi -hplus
    methylglutaconyl_coa
    <-> auh [4.2.1.18] +h2o
    hmg_coa
    -> hmgcl [4.1.3.4] -acetoacetate
    acetyl_coa
  }

  # ISOLEUCINE — ketogenic AND glucogenic. The terminal thiolysis yields acetyl-CoA,
  # rejoining the spine, plus propionyl-CoA, the cell the valine ladder ends on.
  branch from akg side left {
    isoleucine
    <-> bcat2 [2.6.1.42] +akg -glutamate
    kmv
    -> bckdha [1.2.4.4] +coa +nad -co2 -nadh !committed
    mbutyryl_coa
    -> acadsb [1.3.8.5] +fad -fadh2
    tiglyl_coa
    <-> echs1 [4.2.1.17] +h2o
    mhb_coa
    <-> hsd17b10 [1.1.1.178] +nad -nadh -hplus
    maa_coa
    <-> acat1 [2.3.1.9] +coa -propionyl_coa
    acetyl_coa
  }

  # VALINE — purely glucogenic. Uniquely, HIBCH hydrolyses the CoA thioester off at
  # 3-hydroxyisobutyryl-CoA, so the last two steps run on the free acid before
  # ALDH6A1 re-forms a thioester as propionyl-CoA.
  branch from akg side right {
    valine
    <-> bcat2 [2.6.1.42] +akg -glutamate
    kiv
    -> bckdha [1.2.4.4] +coa +nad -co2 -nadh !committed
    isobutyryl_coa
    -> acad8 [1.3.8.5] +fad -fadh2
    methacrylyl_coa
    <-> echs1 [4.2.1.17] +h2o
    hib_coa
    -> hibch [3.1.2.4] +h2o -coa -hplus
    hydroxyisobutyrate
    <-> hibadh [1.1.1.31] +nad -nadh -hplus
    mmsa
    -> aldh6a1 [1.2.1.27] +coa +nad -co2 -nadh
    propionyl_coa
  }

  # Product feedback on the committed step: NADH on E3/DLD (reg_nadh_bckdh) and the
  # branched-chain acyl-CoAs on E2/DBT (reg_acylcoa_bckdh).
  inhibit nadh -> bckdha feedback
  inhibit isovaleryl_coa -> bckdha feedback

  # reg_kic_inhibits_bckdk, drawn as its net effect on the complex: alpha-keto-
  # isocaproate inhibits the kinase BCKDK, which relieves phosphorylation of
  # E1-alpha — so a rising keto-acid load accelerates its own oxidation.
  activate kic -> bckdha indirect

  # Not drawable in MPL (protein -> enzyme phosphorylation, not a metabolite
  # effector): BCKDK phosphorylates Ser293 of BCKDHA and switches the complex off;
  # the mitochondrial phosphatase PPM1K (PP2Cm) dephosphorylates it back on. This
  # kinase/phosphatase pair is the dominant short-term control of BCAA oxidation.
  # See regulations[] reg_bckdk_phos_e1 / reg_ppm1k_dephos_e1.
}

# De novo pyrimidine synthesis — the ring is built first, then mounted on ribose.
# One vertical spine runs glutamine -> carbamoyl phosphate -> ... -> UMP -> CTP.
# Aspartate and PRPP enter on side arrows where they join the ring; ubiquinone/
# ubiquinol ride the one mitochondrial step (DHODH). Effectors sit in the left
# gutter and feed back into the two committed steps (CPS II of CAD, and CTPS1).

pathway pyrimidine-de-novo-synthesis "De novo pyrimidine nucleotide synthesis" {
  grid E3
  spacing 210

  spine at 0,0 {
    glutamine
    -> cad [6.3.5.5] +bicarbonate +atp +h2o -glutamate -adp -pi -hplus !committed
    carbamoyl-phosphate
    <-> cad [2.1.3.2] +aspartate -pi -hplus
    carbamoyl-aspartate
    <-> cad [3.5.2.3] +hplus -h2o
    dihydroorotate
    -> dhodh [1.3.5.2] +ubiquinone -ubiquinol
    orotate
    <-> umps [2.4.2.10] +prpp -ppi
    omp
    -> umps [4.1.1.23] +hplus -co2
    ump
    <-> cmpk1 [2.7.4.14] +atp -adp
    udp
    <-> nme1 [2.7.4.6] +atp -adp
    utp
    -> ctps1 [6.3.4.2] +glutamine +atp +h2o -glutamate -adp -pi -hplus !committed
    ctp
  }

  # UTP feedback onto the CPS II domain of CAD is the dominant control of
  # mammalian de novo pyrimidine synthesis; PRPP and ATP oppose it.
  inhibit utp -> cad feedback
  activate prpp -> cad allosteric
  activate atp -> cad allosteric

  # the CTP branch is controlled separately
  inhibit ctp -> ctps1 feedback
  activate gtp -> ctps1 allosteric

  # Not drawable in MPL (protein -> enzyme phosphorylation, not a metabolite
  # effector): MAPK1/ERK2 activates CAD, PKA (PRKACA) opposes it, and GSK-3 beta
  # inhibits CTPS1. See regulations[] reg_mapk_cad / reg_pka_cad / reg_gsk3b_ctps.
}

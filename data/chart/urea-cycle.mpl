# Urea cycle — drawn as Michal drew the ornithine ring: one closed vertical spine
# carrying ornithine round through citrulline, argininosuccinate and arginine and
# back to ornithine. The two nitrogen entries hang off opposite sides — ammonia
# via CPS1 on the left, aspartate via ASS1 on the right — and the N-acetylglutamate
# arm sits furthest left, feeding the switch that turns CPS1 on at all.

pathway urea-cycle "Urea cycle (Krebs–Henseleit ornithine cycle)" {
  grid C4
  spacing 210

  spine at 0,0 {
    ornithine
    -> otc [2.1.3.3] +carbamoyl_p -pi
    citrulline
    -> ass1 [6.3.4.5] +atp -amp -ppi -hplus !committed
    argininosuccinate
    <-> asl [4.3.2.1] -hplus
    arginine
    -> arg1 [3.5.3.1] +h2o
    ornithine
  }

  # first nitrogen: ammonia and bicarbonate fixed into carbamoyl phosphate in the
  # matrix, which rejoins the ring as the carbamoyl donor at the OTC step
  branch from ornithine side left {
    nh3
    -> cps1 [6.3.4.16] +hco3 +atp -adp -pi -hplus !committed
    carbamoyl_p
  }

  # no carbon flux, but CPS1 is catalytically dead without N-acetylglutamate
  branch from nh3 side left {
    glutamate
    <-> nags [2.3.1.1] +acetyl_coa -coa
    nag
  }

  # second nitrogen: cytosolic aspartate condenses with citrulline at ASS1
  branch from citrulline side right {
    aspartate
  }

  # aspartate–argininosuccinate shunt: the carbon skeleton leaves as fumarate
  branch from argininosuccinate side right {
    fumarate
  }

  # the excretory end product, split off arginine by arginase-1
  branch from arginine side right {
    urea
  }

  activate nag -> cps1 allosteric
  activate arginine -> nags feedforward
  activate cortisol -> cps1 transcriptional
}

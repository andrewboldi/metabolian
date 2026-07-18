# Methionine & cysteine metabolism — drawn the way Michal drew sulfur amino acids:
# one vertical spine that follows the SULFUR ATOM from methionine all the way to
# hydrogen sulfide (Met -> SAM -> SAH -> homocysteine -> cystathionine -> Cys ->
# 3-mercaptopyruvate -> H2S), with the two remethylation arms swinging out to
# opposite sides at the homocysteine branch point and climbing back up to
# methionine. Every effector here (SAM, SAH, 5-methyl-THF) is already a cell on
# the chart, so regulation routes through the gutters instead of new boxes.
#
# Spine steps are the module's reactions in pathwayStep order: mc1, mc2, mc3,
# ts1, ts2, h2s3, h2s4. The side arms are mc4 (folate/B12) and mc5 (betaine).
# Two alternative H2S routes in the module are NOT drawn as separate arrows
# because both are single steps between two cells that already sit on the spine:
#   h2s1  CBS: L-cysteine + L-homocysteine -> L-cystathionine + H2S
#   h2s2  CSE: L-cysteine + H2O -> pyruvate + NH3 + H2S
# They stay in data/pathways/methionine-cysteine-metabolism.json.

pathway methionine-cysteine-metabolism "Methionine cycle & transsulfuration" {
  grid D3
  spacing 152

  spine at 0,0 {
    methionine
    -> mat1a [2.5.1.6] +atp +h2o -pi -ppi !committed
    sam
    -> gnmt [2.1.1.20] +glycine -sarcosine -hplus
    sah
    <-> ahcy [3.13.2.1] +h2o -adenosine
    homocysteine
    -> cbs [4.2.1.22] +serine -h2o !committed
    cystathionine
    -> cth [4.4.1.1] +h2o -akb -ammonia -hplus
    cysteine
    <-> got1 [2.6.1.3] +akg -glutamate
    mercaptopyruvate
    -> mpst [2.8.1.2] +trx_red -pyruvate -trx_ox
    h2s
  }

  # remethylation arm 1 — the folate/B12 route: the methyl group rides from
  # 5-methyl-THF onto homocysteine, rejoining the spine at methionine.
  branch from homocysteine side left {
    methyl_thf
    -> mtr [2.1.1.13] +homocysteine -thf
    methionine
  }

  # remethylation arm 2 — the betaine route (liver + kidney), folate-independent;
  # also rejoins the spine at methionine.
  branch from homocysteine side right {
    betaine
    -> bhmt [2.1.1.5] +homocysteine -dimethylglycine
    methionine
  }

  # SAM is the master switch: it opens transsulfuration (CBS) while closing the
  # 5-methyl-THF supply line (MTHFR), and it splits the two MAT isozymes.
  # All six are real regulations from the module. Two of them have no arrow to
  # land on in THIS chart and so are not drawn: mat2a (the extrahepatic isozyme
  # of the mat1a step) and mthfr (whose catalytic step belongs to one-carbon
  # metabolism — its substrate 5,10-methylene-THF is not a cell here). They are
  # kept so the source states the full switch, and they cost nothing.
  activate sam -> mat1a allosteric
  inhibit sam -> mat2a feedback
  activate sam -> cbs allosteric
  inhibit sam -> mthfr allosteric
  inhibit sah -> gnmt competitive
  inhibit methyl_thf -> gnmt allosteric
}

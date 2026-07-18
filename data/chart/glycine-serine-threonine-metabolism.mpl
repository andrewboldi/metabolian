# Glycine / serine / threonine — drawn the way Michal drew the amino-acid plates:
# the phosphorylated serine-synthesis route runs down the spine out of glycolysis
# (3-phosphoglycerate), through serine into glycine, and ends in the folate pool.
# The choline → betaine → sarcosine oxidative-demethylation arm runs parallel on
# the right and pours back into glycine; threonine, glyoxylate and the classical
# 2-amino-3-oxobutanoate route feed glycine from the left; effectors sit in the
# right-hand gutter feeding regulation back into the committed steps.

pathway glycine-serine-threonine-metabolism "Glycine, Serine and Threonine Metabolism" {
  grid F5
  spacing 210

  spine at 0,0 {
    pg3
    <-> phgdh [1.1.1.95] +nad -nadh -hplus !committed
    php
    <-> psat1 [2.6.1.52] +glutamate -akg
    pser
    -> psph [3.1.3.3] +h2o -pi
    serine
    <-> shmt2 [2.1.2.1] +thf -mlthf -h2o
    glycine
    <-> gldc [1.4.4.2] +thf +nad -co2 -nh3 -nadh -hplus
    mlthf
  }

  # choline oxidation arm: two one-carbon units are stripped off betaine and
  # handed to the folate pool, and the carbon skeleton rejoins at glycine
  branch from pg3 side right {
    choline
    -> chdh [1.1.99.1]
    betaine_aldehyde
    -> aldh7a1 [1.2.1.8] +nad +h2o -nadh -hplus
    betaine
    -> bhmt [2.1.1.5] +homocysteine -methionine
    dmglycine
    -> dmgdh [1.5.8.4] +thf -mlthf
    sarcosine
    -> sardh [1.5.8.3] +thf -mlthf
    glycine
  }

  # threonine: the major human route is dehydration to 2-oxobutanoate (→ propionyl-CoA);
  # threonine and glycine are also interconverted by the SHMT1 aldolase side activity
  branch from glycine side left {
    threonine
    -> sds [4.3.1.19] -nh3 -hplus
    oxobut
  }

  # D-serine, the NMDA-receptor co-agonist
  branch from serine side left {
    dserine
    <-> srr [5.1.1.18]
    serine
  }

  # peroxisomal glyoxylate detoxification (AGT; lost in primary hyperoxaluria type 1)
  branch from glycine side left {
    glyoxylate
    <-> agxt [2.6.1.44] +alanine -pyruvate
    glycine
  }

  # classical threonine → glycine route; near-silent in humans (TDH is a pseudogene)
  branch from glycine side left {
    amino_oxobutanoate
    <-> gcat [2.3.1.29] +coa -accoa
    glycine
  }

  # SAM disposal: glycine is methylated to sarcosine and recycled by SARDH
  branch from glycine side right {
    sam
    -> gnmt [2.1.1.20] -sah -hplus
    sarcosine
  }

  inhibit serine -> phgdh feedback
  activate atf4 -> phgdh transcriptional
  activate atf4 -> psat1 transcriptional
  activate atf4 -> psph transcriptional
  activate atf4 -> shmt2 transcriptional
  inhibit mthf5 -> gnmt allosteric
}

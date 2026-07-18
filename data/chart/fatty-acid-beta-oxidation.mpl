# Fatty acid β-oxidation — drawn the way Michal drew the mitochondrial spiral:
# activation at the top of the spine, the carnitine shuttle hung off it as a side
# loop (the acyl group leaves as acylcarnitine and comes straight back as
# acyl-CoA), then the four-step spiral running down the spine — oxidation,
# hydration, oxidation, thiolysis — with the effectors in the right-hand gutter.

pathway fatty-acid-beta-oxidation "Fatty acid β-oxidation (mitochondrial)" {
  grid C3
  spacing 210

  spine at 0,0 {
    palmitate
    -> acsl1 [6.2.1.3] +coa +atp -amp -ppi -hplus
    palmitoyl_coa
    <-> acadvl [1.3.8.9] +fad -fadh2
    trans_hexadecenoyl_coa
    <-> hadha [4.2.1.17] +h2o
    hydroxyhexadecanoyl_coa
    <-> hadha [1.1.1.211] +nad -nadh -hplus
    oxopalmitoyl_coa
    -> hadhb [2.3.1.16] +coa -acetyl_coa
    myristoyl_coa
  }

  # Carnitine shuttle, return limb: CPT2 hands the acyl group back to CoA in the
  # matrix and frees carnitine, so the route rejoins the spine at palmitoyl-CoA.
  # (The carnitine–acylcarnitine translocase moves the same species across the
  # inner membrane between these two cells, so it carries no drawn arrow here.)
  branch from palmitate side left {
    palmitoylcarnitine
    <-> cpt2 [2.3.1.21] +coa -carnitine
    palmitoyl_coa
  }

  # Carnitine shuttle, entry limb: CPT1 acylates carnitine on the outer membrane.
  # Committed, rate-limiting step — kinetically controlled by malonyl-CoA rather
  # than thermodynamically irreversible.
  branch from palmitate side right {
    carnitine
    -> cpt1a [2.3.1.21] +palmitoyl_coa -coa !committed
    palmitoylcarnitine
  }

  # Thiolysis shortens the chain by two carbons: myristoyl-CoA re-enters at the
  # acyl-CoA dehydrogenase step, seven turns in all for palmitate.

  inhibit malonyl_coa -> cpt1a allosteric
  inhibit nadh -> hadha feedback
  inhibit acetyl_coa -> hadhb feedback
}

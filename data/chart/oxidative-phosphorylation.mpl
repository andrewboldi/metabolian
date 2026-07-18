# Oxidative phosphorylation — drawn the way Michal drew the respiratory chain:
# one vertical spine carrying the electrons down the redox gradient (NADH -> Q ->
# cytochrome c -> O2), the pumped proton handed on as the coupling currency to the
# phosphorylation limb, succinate/FADH2 entering from the left at the quinone pool,
# and the adenine-nucleotide exchange in the right-hand gutter.
#
# The spine node H+ is the translocated proton (P-side): Complexes I and III pump
# into the same pool (shown as -H+ side-labels), Complex IV's pumping is carried on
# the spine itself, and the pool is spent again by the phosphate carrier and the
# synthase. That is Mitchell's chemiosmotic coupling read top to bottom.

pathway oxidative-phosphorylation "Oxidative phosphorylation (electron transport chain)" {
  grid E5
  spacing 152

  spine at 0,0 {
    nadh
    <-> complex1 [7.1.1.2] +ubiquinone -nad -hplus
    ubiquinol
    <-> complex3 [7.1.1.8] +ferricyt_c -ubiquinone -hplus
    ferrocyt_c
    -> complex4 [7.1.1.9] +o2 -ferricyt_c -h2o !committed
    hplus
    <-> pic
    pi
    <-> complex5 [7.1.2.2] +adp +hplus -h2o
    atp
  }

  # Complex II is the only respiratory complex that pumps no protons: succinate
  # electrons bypass the Complex I site and rejoin the spine at the quinone pool.
  branch from nadh side left {
    succinate
    <-> complex2 [1.3.5.1] +ubiquinone -fumarate
    ubiquinol
  }

  # Adenine-nucleotide translocase: cytosolic ADP in, matrix ATP out — the
  # electrogenic exchange that keeps the synthase supplied and rejoins at ATP.
  branch from hplus side right {
    adp
    <-> ant1
    atp
  }

  activate adp -> complex5 respiratory-control
  activate ca2 -> complex5 allosteric
  inhibit atp -> complex4 allosteric
  inhibit no -> complex4 competitive
  # IF1 (atpif1) also blocks reverse ATP hydrolysis at Complex V, but MPL
  # regulators are metabolites — a protein inhibitor has no metabolite cell.
}

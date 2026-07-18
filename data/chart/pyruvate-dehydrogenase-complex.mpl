# Pyruvate dehydrogenase complex — the bridge Michal draws between the foot of
# glycolysis (B5) and the head of the citric acid cycle (D5). The spine follows
# the two carbons rather than the enzymes: E1 strips CO2 off pyruvate onto the
# thiazolium of TPP, the hydroxyethyl unit is oxidised onto the lipoyl arm of
# E2, and CoA carries it away as acetyl-CoA. Only the first step is drawn
# irreversibly — losing CO2 is what makes the whole complex a one-way gate.
#
# The swinging arm is the loop in the right column: E2 leaves it as the dithiol,
# E3 reoxidises it through its FAD to NAD+, and the regenerated lipoamide feeds
# straight back into the E1 acetylation step as +lipoyllys, closing the
# catalytic cycle without ever leaving the complex.
#
# The left gutter carries the switch: four kinases that phosphorylate E1α off,
# two Ca2+/Mg2+-dependent phosphatases that pull it back on, and the two product
# lines (acetyl-CoA on E2, NADH on E3).

pathway pyruvate-dehydrogenase-complex "Pyruvate dehydrogenase complex (pyruvate → acetyl-CoA)" {
  grid C5
  spacing 152

  spine at 0,0 {
    pyruvate
    -> e1_alpha [1.2.4.1] +tpp +hplus -co2 !committed
    hetpp
    <-> e1_alpha [1.2.4.1] +lipoyllys -tpp
    acetyl_dihydrolipoyllys
    <-> e2 [2.3.1.12] +coa -dihydrolipoyllys
    acetyl_coa
  }

  # The lipoyl swinging arm, reoxidised. E2 hands the acetyl group to CoA and
  # leaves the arm reduced; E3 passes those electrons through enzyme-bound FAD
  # to NAD+, regenerating the lipoamide the E1 step above consumes. FAD is a
  # prosthetic group of E3 — never consumed — so it is deliberately not drawn as
  # a cofactor on the arrow.
  branch from acetyl_dihydrolipoyllys side right {
    dihydrolipoyllys
    <-> e3 [1.8.1.4] +nad -nadh -hplus
    lipoyllys
  }

  # The phosphorylation switch — the defining control of this complex. Four PDH
  # kinases phosphorylate E1α (Ser293/300/232) to lock the complex off; two PDH
  # phosphatases strip the phosphates and switch it back on.
  inhibit pdk1 -> e1_alpha phosphorylation
  inhibit pdk2 -> e1_alpha phosphorylation
  inhibit pdk3 -> e1_alpha phosphorylation
  inhibit pdk4 -> e1_alpha phosphorylation
  activate pdp1 -> e1_alpha dephosphorylation
  activate pdp2 -> e1_alpha dephosphorylation

  # Direct product inhibition of the two downstream components: a high
  # acetyl-CoA/CoA ratio backs up the E2 transacetylase, a high NADH/NAD+ ratio
  # drives E3's terminal electron transfer backward.
  inhibit acetyl_coa -> e2 feedback
  inhibit nadh -> e3 feedback

  # Not drawable in MPL (metabolite effectors acting on the kinases/phosphatases
  # rather than on a drawn reaction arrow): acetyl-CoA and NADH stimulate PDK2
  # while pyruvate and ADP inhibit it, Ca2+ activates PDP1, and insulin promotes
  # PDC dephosphorylation via PDP. See regulations[] reg_acetylcoa_pdk,
  # reg_nadh_pdk, reg_pyruvate_pdk, reg_adp_pdk, reg_ca_pdp1, reg_insulin_pdp1.
}

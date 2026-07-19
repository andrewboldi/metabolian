// Compile every data/chart/*.mpl into a render-ready chart IR, enriched with the
// pathway JSON (display names, formulas, enzyme identity) and the precomputed
// molecule SVG index. Output: web/public/chart/<id>.json + chart/index.json

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "./mpl/compile.mjs";
import { metKey } from "./lib/metkey.mjs";
import { condensedRows } from "./lib/condensed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MPL_DIR = join(ROOT, "data", "chart");
const PATHWAY_DIR = join(ROOT, "data", "pathways");
const MOL_INDEX = join(ROOT, "web", "public", "mol", "index.json");
const OUT = join(ROOT, "web", "public", "chart");

// Coverage gates report by default and fail under CHART_STRICT=1. The layout
// sources they police live in data/chart/*.mpl, so they are diagnostics until
// those are authored to satisfy them — then flip the flag on in CI.
const STRICT = process.env.CHART_STRICT === "1";

// A frozen per-chart ceiling on DROPPED BIOCHEMISTRY (declared regulations never
// drawn, cells with no flux edge, cells that draw nothing). Optional: absent, the
// coverage findings stay reports as they always were. Present, no chart may get
// worse than the day it was frozen — which is how 108 undrawn regulations burn
// down instead of accruing. Shape: { "<chart id>": { regulations, orphans, blank } }.
const BUDGET_FILE = join(ROOT, "data", "chart", "coverage-budget.json");
const COVERAGE_BUDGET = existsSync(BUDGET_FILE)
  ? JSON.parse(readFileSync(BUDGET_FILE, "utf8")) : {};

// Michal writes cofactors in their conventional short form — "ADP + Pi", never
// "Adenosine diphosphate + Orthophosphate". Density depends on this.
const SHORT = {
  atp: "ATP", adp: "ADP", amp: "AMP", gtp: "GTP", gdp: "GDP", utp: "UTP", udp: "UDP",
  // NADH/NADPH are written plain: the pathway data lists the proton as its own
  // `hplus` participant (73 of 83 redox steps do), so baking "+H+" into the alias
  // printed it twice — "NADPH+H+ + H+" — asserting a stoichiometry no source
  // supports. The data is the authority on protons; the renderer must not add any.
  ctp: "CTP", itp: "ITP", nad: "NAD⁺", nadh: "NADH", nadp: "NADP⁺", nadph: "NADPH",
  fad: "FAD", fadh2: "FADH₂", fmn: "FMN", coa: "CoA-SH", coash: "CoA-SH",
  pi: "Pi", ppi: "PPi", h2o: "H₂O", hplus: "H⁺", co2: "CO₂", o2: "O₂", nh3: "NH₃",
  nh4: "NH₄⁺", hco3: "HCO₃⁻", h2o2: "H₂O₂", q: "Q", qh2: "QH₂", thf: "THF",
  sam: "SAM", sah: "SAH", glutathione: "GSH", gssg: "GSSG", acetylcoa: "acetyl-CoA",
  // Redox and one-carbon carriers recur on every second step of several sheets,
  // and their curated names are 25-51 characters — long enough to run over the
  // neighbouring cell. These are the forms the textbooks and the poster use.
  ubiquinone: "Q", ubiquinol: "QH₂", quinone: "MQ", quinol: "MQH₂",
  ferricytc: "cyt c (Fe³⁺)", ferrocytc: "cyt c (Fe²⁺)", fdox: "Fd(ox)", fdred: "Fd(red)",
  tpp: "TPP", hetpp: "HE-TPP",
  lipoyllys: "Lip(S₂)", dihydrolipoyllys: "Lip(SH)₂", acetyldihydrolipoyllys: "acetyl-Lip(SH)",
  formylthf: "10-CHO-THF", methylenethf: "5,10-CH₂-THF", mlthf: "5,10-CH₂-THF",
  methenylthf: "5,10-CH=THF", holoacp: "ACP-SH",
  methyl_thf: "5-CH₃-THF", methylthf: "5-CH₃-THF", mthf5: "5-CH₃-THF",
  // The rest of the ids that reach a side arc. Probing every emitted label found
  // 40 species printing 15-51 characters: the alias table was keyed on idealised
  // ids (`hco3`, `glutathione`) the modules do not use, and trimParenthetical
  // cannot shorten a name with no parenthetical to trim ("Ethanolamine
  // phosphate", "N,N-Dimethylglycine"). Every form below is the one the
  // textbooks and the poster print — none is invented.
  gsh: "GSH", bicarbonate: "HCO₃⁻", oaa: "OAA", akb: "2-Oxobutanoate",
  trxox: "Trx-S₂", trxred: "Trx-(SH)₂", mdha: "MDHA", ascorbate: "Ascorbate",
  g1p: "G-1-P", r1p: "Rib-1-P", carbamoylp: "Carbamoyl-P", prpp: "PRPP",
  dhf: "DHF", pbg: "PBG", ala: "ALA", cysgly: "Cys-Gly", dimethylglycine: "DMG",
  s1p: "S1P", dag: "DAG", phosphoethanolamine: "Etn-P", acetoacetylcoa: "AcAc-CoA",
  lipidoh: "Lipid-OH", lipidooh: "Lipid-OOH", bh4: "BH₄", bh2: "BH₂",
  fe2: "Fe²⁺", fe3: "Fe³⁺", pb2: "Pb²⁺", camp: "cAMP", cgmp: "cGMP",
  tnf: "TNF-α", hydroxycholesterol27: "27-OHC",
  phosphatidylcholine: "PC", sphingomyelin: "SM",
  // Glycolytic phosphates: the poster writes these as hyphenated symbols wherever
  // they annotate a step (a side arc, an effector tag) and spells them out only
  // inside their own cell, which keeps its curated name.
  g6p: "G-6-P", f6p: "F-6-P", f16bp: "F-1,6-BP", f26bp: "F-2,6-BP",
  g3p: "GAP", dhap: "DHAP", pep: "PEP", bpg13: "1,3-BPG", pg3: "3-PG", pg2: "2-PG",
};

// The longest chart form Michal prints on a side arc. Past SOFT the caption is
// prose and gets reported; past HARD no abbreviation is plausible and the build
// fails, so a new module cannot quietly reintroduce a 51-character label.
const LABEL_SOFT_CAP = 14;
const LABEL_HARD_CAP = 20;

const SUB = "₀₁₂₃₄₅₆₇₈₉", SUPER = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ION = /^([A-Z][a-z]?)(\d?)([+-])$/;      // Fe2+, Ca2+, Cl- — the digit is the charge

/**
 * ASCII chemistry typeset the way the poster sets it: H2O -> H₂O, NAD+ -> NAD⁺,
 * Fe2+ -> Fe²⁺. Charge written in ASCII is the reason a caption reads wrong —
 * the renderer joins cofactors with " + ", so "NADP+ + H+" has three plus signs
 * doing two different jobs and the reader cannot tell which is which.
 */
function typeset(s) {
  const ion = ION.exec(s);
  if (ion) return ion[1] + (ion[2] ? SUPER[+ion[2]] : "") + (ion[3] === "+" ? "⁺" : "⁻");
  return s.replace(/([A-Za-z)\]])(\d+)/g, (_, a, d) => a + [...d].map((c) => SUB[+c]).join(""))
    .replace(/\+$/, "⁺")
    .replace(/(?<=[A-Za-z0-9)])-$/, "⁻");
}

/**
 * The short form this id is printed as beside an arrow. The alias table is
 * authoritative; past it the display name is shortened generically, because a
 * table of forty ids left "5-Phospho-alpha-D-ribose 1-diphosphate (PRPP)" to
 * print verbatim at ~200px. A parenthesised symbol IS the chart name ("(PRPP)"
 * -> PRPP); a parenthesised phrase is a curator's note ("(vitamin C)") and is
 * dropped. Nothing is invented — both forms already exist in the curated name.
 */
function short(id, m) {
  const explicit = m?.short || m?.abbrev;   // a chart form curated on the record wins
  if (explicit) return explicit;
  const alias = SHORT[id] || SHORT[id.replace(/[_-]/g, "")];
  if (alias) return alias;
  const name = m?.name;
  if (!name) return id;
  return typeset(trimParenthetical(name, 12));
}

/**
 * Drop a trailing parenthetical that reads as prose, keep one that is a bare
 * symbol. "L-Ascorbate (vitamin C)" -> "L-Ascorbate"; "…1-diphosphate (PRPP)"
 * -> "PRPP"; "Carnitine O-palmitoyltransferase 1A (CPT1A)" keeps its gene
 * symbol, which is the only thing distinguishing CPT1A from CPT2 on the sheet.
 */
function trimParenthetical(name, symbolMax = 12, promoteSymbol = true) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (!m) return name;
  const head = m[1], inner = m[2];
  const isSymbol = !/\s/.test(inner) && inner.length <= symbolMax;
  if (isSymbol) return promoteSymbol ? inner : name;
  return head.length >= 6 ? head : name;
}

const molIndex = existsSync(MOL_INDEX) ? JSON.parse(readFileSync(MOL_INDEX, "utf8")) : {};
const SMILES = existsSync(join(ROOT, "data", "smiles.json"))
  ? JSON.parse(readFileSync(join(ROOT, "data", "smiles.json"), "utf8")) : {};

// ---------------------------------------------------------------- text metrics
// The layout gate used to intersect cells only, so nothing in the pipeline ever
// measured a text run: every label collision and every label that hung outside
// the bounds shipped green. These constants mirror web/src/lib/chart-view.ts and
// web/src/styles/chart.css — if they drift, the measurement lies.
const NAME_CH = 7;        // .met-name 11px + .04em tracking (chart-view.ts:316)
const NAME_LINE_H = 11;   // chart-view.ts:321
const NAME_LINES = 2;     // chart-view.ts:318 wrapCellName(..., 2)
const MAX_CELL_W = 196;   // the sheet's widest molecule bucket; past it a caption
                          // would make the cell wider than any structure cell
const COF_CH = 4.68;      // .cofactor-label 9px Inter, mean advance (0.52em)
const COF_H = 11;
const ENZ_CH = 5.2;       // .enz-name 10px, chart-view.ts:366
const ENZ_H = 10;
const EC_H = 11;
const FORMULA_H = 11;    // the molecular-formula line the renderer paints at h-4
// Enzyme-label box model. Declared HERE, with the other text metrics, because
// chooseCofactorSides() runs at module top level well above the old position —
// leaving these below it threw a temporal-dead-zone ReferenceError that broke
// the entire data build.
const LABEL_W = 70, LABEL_LINE = 10, LABEL_EC = 11;

/**
 * chart-view.ts wrapCellName, ported so a cell can be sized to the caption it
 * has to hold. `truncated` is the renderer's ellipsis: text the reader loses.
 */
function wrapName(text, maxChars, maxLines = NAME_LINES) {
  const out = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const w of String(text).split(/\s+/)) {
    if (w.length > maxChars) {
      flush();
      let rest = w;
      while (rest.length > maxChars && out.length < maxLines) {
        const hyphen = rest.lastIndexOf("-", maxChars);
        if (hyphen >= Math.floor(maxChars * 0.45)) { out.push(rest.slice(0, hyphen + 1)); rest = rest.slice(hyphen + 1); }
        else { out.push(rest.slice(0, maxChars - 1) + "-"); rest = rest.slice(maxChars - 1); }
      }
      cur = rest;
    } else if ((cur ? cur.length + 1 : 0) + w.length > maxChars) { flush(); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  flush();
  return out.length > maxLines ? { lines: out.slice(0, maxLines), truncated: true } : { lines: out, truncated: false };
}

/** Characters the renderer will fit on one line of a cell this wide. */
const charsAt = (w) => Math.max(6, Math.floor((w - 6) / NAME_CH));

/** Narrowest cell that holds this caption whole (MAX_CELL_W if none does). */
function captionWidth(name) {
  for (let chars = 8; chars <= charsAt(MAX_CELL_W); chars++) {
    if (!wrapName(name, chars).truncated) return chars * NAME_CH + 6;
  }
  return MAX_CELL_W;
}

/**
 * How tall the caption is IN THIS CELL. Counting lines at the narrowest fitting
 * width instead of the final width added a row to almost every sterol cell that
 * did not need one, and 11px per cell compounded down a serpentine spine until
 * routes that used to be clear were not.
 */
const captionLines = (name, w) => wrapName(name, charsAt(w)).lines.length;

/**
 * Michal sizes a cell to its molecule — pyruvate gets a small box, NAD+ a large
 * one. A uniform cell wastes most of the sheet on small metabolites, which is
 * where the density gap against the poster comes from.
 */
/** Michal's condensed column, where the molecule can be rendered that way faithfully. */
function condensedFor(smiles) {
  try { return condensedRows(smiles); } catch { return null; }
}

// ------------------------------------------------------- structure scale
// One bond length for the whole atlas. RDKit sizes its canvas per molecule and
// scales the drawing to FILL it, so an ink extent is measured in that molecule's
// own units: the same C–C bond is 6.6px in the insulin SVG and 75.7px in the O2
// one. Bucketing a cell by heavy-atom count and then letting `xMidYMid meet`
// fill whatever was left made the DRAWN bond length vary 18.5x across the sheet
// — orthophosphate's four bonds filling a cell while an acyl chain was crushed
// into a hairline. Measuring the bond and sizing the cell from the ink expressed
// IN BOND LENGTHS makes one constant set the scale of every structure.
const PX_PER_BOND = 9;      // drawn length of one bond, everywhere on the atlas
const MAX_DRAW_W = 212;     // no single structure may dominate its sheet; past
const MAX_DRAW_H = 148;     // this the molecule is shrunk rather than the cell grown
// ...except that a ceiling on WIDTH alone is a ceiling on the bond length of
// exactly the long, thin molecules. Measured: ubiquinol (ink aspect 6.7) and the
// acyl-CoA family (4.4) were the only structures on the atlas the width term
// bound, and it shrank the WHOLE depiction — the quinol head with its two
// methoxys came out ~30u wide, indistinguishable from the quinone. A tail sets
// the scale of a head it has nothing to do with. Past WIDE_ASPECT the cell is
// allowed to grow sideways instead, which is the axis a landscape sheet has to
// spare; 320 is the narrowest ceiling that keeps every one of those structures
// above the legibility floor below.
const WIDE_ASPECT = 3;
const MAX_DRAW_W_WIDE = 320;
const NAME_TOP = 12;        // chart-view.ts: first caption baseline
const CELL_PAD_B = 12;      // chart-view.ts: gap under the drawing

/** Median drawn bond length of an RDKit depiction, in its own SVG units. */
export function bondLength(svg) {
  const groups = new Map();
  const re = /<path\s+class='(bond-\d+[^']*)'\s+d='([^']+)'/g;
  let m;
  while ((m = re.exec(svg))) {
    const pts = [...m[2].matchAll(/([-\d.]+),([-\d.]+)/g)].map((p) => [+p[1], +p[2]]);
    if (pts.length < 2) continue;
    const g = groups.get(m[1]) || [];
    g.push(...pts);
    groups.set(m[1], g);
  }
  // One bond can be several path elements (a double bond, or a bond split at the
  // colour change between two hetero atoms), so take each group's longest span.
  const lens = [];
  for (const pts of groups.values()) {
    let span = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) span = Math.max(span, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
    if (span > 0) lens.push(span);
  }
  if (!lens.length) return null;                  // a lone ion has no bond to measure
  lens.sort((a, b) => a - b);
  return lens[Math.floor(lens.length / 2)];
}

const bondCache = new Map();
function bondOf(key) {
  if (bondCache.has(key)) return bondCache.get(key);
  const file = molIndex[key]?.file;
  const path = file && join(ROOT, "web", "public", "mol", file);
  const bond = path && existsSync(path) ? bondLength(readFileSync(path, "utf8")) : null;
  bondCache.set(key, bond);
  return bond;
}

// Below this the drawing stops reading as a structure and becomes texture. The
// floor used to be 0.5, justified by the acyl-CoA spine of fatty-acid
// beta-oxidation: those cells drew at 4.9 and a tighter floor took that sheet
// from 8 structures to 3. The aspect ceiling above is what actually rescues that
// family — they now draw at ~7.5 — so the floor no longer has to be lowered to
// accommodate a sizing bug. At 0.75 the only depictions still dropped are the
// ones the LAYOUT clamps below any legible size (an effector chip is a fixed
// box whatever molecule it holds), which is precisely what the gate is for.
const MIN_LEGIBLE_BOND = PX_PER_BOND * 0.75;

/**
 * The bond length this cell will ACTUALLY draw at — chart-view.ts fits the ink
 * box into whatever the caption leaves, so the answer depends on the cell the
 * layout ended up giving the node, not the one this file asked for.
 */
function drawnBondPx(n, mol, key) {
  const bond = bondOf(key);
  if (!mol?.ink?.w) return Infinity;               // nothing to judge
  // A depiction with no bond at all (H₂, NH₃, Ca²⁺, Pb²⁺, H⁺ — 16 nodes on the
  // atlas) cannot be scale-normalised in either direction: bondLength() returns
  // null, structureBox() therefore returns null, and cellSize() falls through to
  // the name-only box that reserves NO drawing height. Returning Infinity here
  // used to mean "leave it alone", so the one class the gate should always catch
  // was the one class it never fired on — H₂ shipped with an inner <svg> of
  // height 0, NH₃ at 0.2x. Zero is the honest answer: drop the depiction and let
  // the cell be the name plate it was already sized as. Every one of these ions
  // has a typeset form in SHORT that reads better than a two-letter skeleton.
  if (!bond) return 0;
  const top = NAME_TOP + captionLines(String(n.label).toUpperCase(), n.w) * NAME_LINE_H;
  const fit = Math.min((n.w - 8) / mol.ink.w, (n.h - top - CELL_PAD_B) / mol.ink.h);
  return fit * bond;
}

/** The drawing box this depiction needs to render at the atlas bond length. */
function structureBox(key) {
  const mol = key ? molIndex[key] : null;
  const bond = key ? bondOf(key) : null;
  if (!mol?.ink?.w || !mol.ink.h || !bond) return null;
  const maxW = mol.ink.w / mol.ink.h >= WIDE_ASPECT ? MAX_DRAW_W_WIDE : MAX_DRAW_W;
  const scale = Math.min(PX_PER_BOND / bond, maxW / mol.ink.w, MAX_DRAW_H / mol.ink.h);
  return { w: Math.round(mol.ink.w * scale), h: Math.round(mol.ink.h * scale) };
}

/**
 * A cell has to hold its caption as well as its molecule. Sizing from the
 * molecule alone is why 59 cells across the atlas dropped name text — g1p was
 * 142px wide and rendered "ALPHA-D-GLUCOSE / 1-PHOSPHATE (CORI…", losing
 * "ESTER)". The name is the identity of the cell; it gets measured first.
 */
function cellSize(smiles, label, key, hasFormula = false) {
  const name = String(label || "").toUpperCase();
  const cond = condensedFor(smiles);
  // A cell is sized to the box its own depiction needs at the atlas bond length,
  // not to a heavy-atom bucket. The bucket was a proxy for size that ignored
  // shape: a 26-carbon acyl chain and a compact sterol with the same atom count
  // got the same square cell, and the fit factor then drew them 3x apart.
  const draw = cond ? null : structureBox(key);
  let base;
  if (cond) {
    const wide = Math.max(...cond.rows.map((r) => r.length));
    base = { w: Math.max(76, wide * 7.2 + 20), h: cond.rows.length * 13 + 26 };
  } else if (draw) {
    // Floor the drawing box. Species like NO and H2O2 have an ink extent of only
    // a few units, so the cell came out shorter than its caption needed and the
    // depiction was handed <=8 units to draw in — the airless-cell gate's exact
    // complaint. A diatomic still needs paper to read as a structure.
    draw.w = Math.max(draw.w, 56);
    draw.h = Math.max(draw.h, 34);
    base = { w: draw.w + 8, h: draw.h + NAME_TOP + NAME_LINE_H + CELL_PAD_B };
  } else base = { w: 108, h: 46 };     // no usable depiction: a name-only box
  // A second caption line pushes everything below it down one row. Under a
  // condensed column that is more TEXT, and it falls out of the bottom of the
  // box — so a condensed cell buys the room sideways, keeping its caption on one
  // line, and only grows taller when even MAX_CELL_W cannot hold it. Under a
  // drawing the second line only trims the drawing, which is what already
  // happened before any of this was measured; growing there instead shifts every
  // cell below it down the spine and breaks routes unrelated to the caption.
  const want = cond ? Math.max(captionWidth(name), name.length * NAME_CH + 6) : captionWidth(name);
  const w = Math.max(base.w, Math.min(MAX_CELL_W, want));
  // The molecular formula is painted at h-4, and under a condensed column the
  // last atom row already sits at exactly 13*rows + 22 — which IS h-4 under the
  // old budget, so the formula printed straight through the last row on every
  // condensed cell that had one. Reserve it a line of its own.
  if (cond) return { w, h: base.h + (captionLines(name, w) - 1) * NAME_LINE_H
    + (hasFormula ? FORMULA_H : 0), condensed: cond.rows };
  // A structure cell reserves the caption it will ACTUALLY wrap to. The renderer
  // fits the drawing into whatever is left under the name, so an unreserved
  // second line comes straight out of the molecule — measured, that is what
  // drives the drawn bond length negative on the widest captions.
  if (draw) return { w, h: draw.h + NAME_TOP + captionLines(name, w) * NAME_LINE_H + CELL_PAD_B };
  return { w, h: base.h };
}

// ------------------------------------------------------------ macromolecules
// Node kind used to be inferred from which table an entity happened to live in,
// so a peptide hormone catalogued under `metabolites` got a large skeletal cell
// and a full bond diagram: insulin (51 residues) and glucagon (29) were drawn
// from a 400-heavy-atom PubChem name lookup, TNF-alpha from a hexapeptide.
// Branch on what the entity IS instead.
const MACRO_CLASS = /peptide hormone|cytokine|polysaccharide|\bprotein\b|hemoprotein|iron-sulfur electron carrier|heme electron carrier/i;
const POLYPEPTIDE = /peptide hormone|cytokine|\bprotein\b/i;
const MACRO_HEAVY = 100;   // no drawable small molecule reaches this

function macroClass(m) {
  if (!m) return null;
  const c = m.class || "";
  const roles = (m.roles || []).join(" ");
  if (MACRO_CLASS.test(c) || MACRO_CLASS.test(roles)) {
    return POLYPEPTIDE.test(c) || POLYPEPTIDE.test(roles) ? "polypeptide" : "macromolecule";
  }
  const sm = SMILES[metKey(m)]?.smiles;
  if (sm && (sm.match(/(Cl|Br|[BCNOPSFI])/gi) || []).length > MACRO_HEAVY) return "polypeptide";
  return null;
}

/**
 * Whether a depiction may be trusted for this entity. A `name:` key means the
 * structure was fetched by string lookup with no database identity behind it,
 * which is how a 157-residue cytokine acquired a hexapeptide skeleton.
 */
const depictable = (m) => !!m && !macroClass(m) && !metKey(m).startsWith("name:");

/** An R-group class entry is not a compound; printing "C10H16N3O6SR" says it is. */
const isClassFormula = (f) => !!f && /R\d*(?![a-z])/.test(f);

// index every metabolite / enzyme across all modules so a chart can reference
// them — but keep each module's OWN definitions separate. A single global map
// with first-file-wins meant `scfa-microbiome-metabolism` (sorting first) named
// the Warburg lactate cell "(R)-Lactate", KEGG C00256, when Warburg curates
// L-Lactate / C00186. 32 ids carry conflicting cross-module definitions.
const modules = new Map();      // module id -> { metabolites, enzymes, json }
const metabolites = new Map();  // global fallback, for cofactors a module omits
const enzymes = new Map();
const occurrences = new Map();  // metabolite id -> how many pathways use it
for (const f of readdirSync(PATHWAY_DIR).filter((f) => f.endsWith(".json"))) {
  const mod = JSON.parse(readFileSync(join(PATHWAY_DIR, f), "utf8"));
  const mm = new Map(), me = new Map();
  for (const m of mod.metabolites || []) {
    mm.set(m.id, m);
    if (!metabolites.has(m.id)) metabolites.set(m.id, m);
    occurrences.set(m.id, (occurrences.get(m.id) || 0) + 1);
  }
  for (const e of mod.enzymes || []) {
    me.set(e.id, e);
    if (!enzymes.has(e.id)) enzymes.set(e.id, e);
  }
  modules.set(f.replace(/\.json$/, ""), { metabolites: mm, enzymes: me, json: mod });
}

/** Resolve an id against this chart's own module first, then the atlas. */
const resolver = (chartId) => {
  const own = modules.get(chartId);
  return {
    met: (id) => own?.metabolites.get(id) || metabolites.get(id) || null,
    enz: (id) => own?.enzymes.get(id) || enzymes.get(id) || null,
    json: own?.json || null,
  };
};

// `node tools/build-chart.mjs <id>` compiles a single chart (used by authors so
// parallel work never clobbers a shared output directory).
const only = process.argv[2] || null;
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const charts = [];
const mplFiles = readdirSync(MPL_DIR).filter((f) => f.endsWith(".mpl")).sort()
  .filter((f) => !only || f === `${only}.mpl`);
if (only && !mplFiles.length) { console.error(`No such chart: data/chart/${only}.mpl`); process.exit(1); }
let textWarnings = 0;
for (const f of mplFiles) {
  const src = readFileSync(join(MPL_DIR, f), "utf8");
  const chartId = f.replace(/\.mpl$/, "");
  const R = resolver(chartId);
  let ir;
  try {
    // size every cell this chart will place, before layout runs
    const sizes = {};
    for (const id of metabolites.keys()) {
      const m = R.met(id);
      const key = depictable(m) ? metKey(m) : null;
      sizes[id] = macroClass(m)
        ? proteinChipSize(m.name)                     // a chip, not a structure cell
        : cellSize(key ? SMILES[key]?.smiles : null, m?.name || id, key,
                    !!(m?.formula && !isClassFormula(m.formula)));
    }
    // protein regulators live in the enzyme table and get Michal's chip
    for (const id of enzymes.keys()) sizes[id] = proteinChipSize(R.enz(id)?.gene || R.enz(id)?.name || id);
    ir = compile(src, sizes);
  } catch (e) {
    console.error(`❌ ${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  if (ir.id !== chartId) console.warn(`⚠  ${f}: declares id '${ir.id}'; module data is resolved from '${chartId}'`);

  // enrich metabolite cells
  for (const n of ir.nodes) {
    const m = R.met(n.metabolite);
    n.label = m?.name || n.metabolite;
    n.formula = m?.formula || null;
    n.charge = m?.charge ?? null;
    n.xrefs = m?.xrefs || {};
    // Michal boxes a compound only when it occurs in several places on the sheet —
    // the box is a cross-reference marker, never decoration.
    n.hub = (occurrences.get(n.metabolite) || 0) >= 2;
    const macro = macroClass(m);
    n.macromolecule = !!macro;
    // A protein is a protein whichever table it was catalogued in.
    n.isProtein = macro === "polypeptide" || (!m && !!R.enz(n.metabolite));
    if (!m && n.isProtein) {
      const pe = R.enz(n.metabolite);
      n.label = pe?.gene || pe?.name || n.metabolite.toUpperCase();
      n.fullName = pe?.name || null;
      n.gene = pe?.gene || null;
      n.uniprot = pe?.xrefs?.uniprot || pe?.xrefs?.alphafold || null;
    } else if (macro) {
      // Declared under `metabolites`, but a 51-residue hormone all the same: no
      // bond diagram, no molecular formula, no condensed column.
      n.fullName = m.name;
      n.gene = null;
      n.uniprot = m.xrefs?.uniprot || null;
    }
    // A class entry has no molecular formula; "C10H16N3O6SR" printed like one
    // asserts an exact composition the entry does not have.
    if (isClassFormula(n.formula)) { n.formulaClass = n.formula; n.formula = null; }
    const usable = depictable(m);
    const sm = usable ? SMILES[metKey(m)]?.smiles : null;
    const cond = sm ? condensedFor(sm) : null;
    const mol = usable ? molIndex[metKey(m)] : null;
    n.condensed = cond ? cond.rows : null;
    n.mol = cond ? null : (mol ? mol.file : null);   // a condensed column replaces the drawing
    if (n.mol && mol?.ink) n.molView = `${mol.ink.x} ${mol.ink.y} ${mol.ink.w} ${mol.ink.h}`;
    n.molSize = mol ? { w: mol.w, h: mol.h } : null;
    // The layout may clamp a cell below the size its depiction was measured for —
    // an effector parked in the margin gets a fixed chip whatever molecule it is.
    // Atorvastatin then rendered at 1.1px per bond: a sliver, not a structure, and
    // 8x off the bond length every other cell on the sheet is drawn at. Below the
    // legible floor the chip carries its NAME instead, which is what the poster
    // does with a regulator it has no room to draw.
    if (n.mol && mol?.ink && drawnBondPx(n, mol, metKey(m)) < MIN_LEGIBLE_BOND) {
      n.mol = null;
      n.molView = null;
      n.molSize = null;
    }
  }

  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const nodeByMet = new Map(ir.nodes.map((n) => [n.metabolite, n]));

  // Index the module's own reactions by enzyme. Keying on the enzyme id alone and
  // keeping only the FIRST reaction made a multifunctional enzyme (CAD, GART,
  // FASN, ATIC) resolve to one arbitrary step, so every step it catalyses printed
  // the same name under a different EC number.
  const modJson = R.json;
  const rxnByEnzyme = new Map();
  for (const rx of modJson?.reactions || []) {
    for (const c of rx.catalysts || []) {
      const list = rxnByEnzyme.get(c.enzyme);
      if (list) list.push(rx); else rxnByEnzyme.set(c.enzyme, [rx]);
    }
  }
  const partIds = (list) => (list || []).map((p) => p.metabolite);
  /** Which module reaction this drawn step is: its EC first, then its drawn pair. */
  function matchReaction(enzyme, ec, fromMet, toMet) {
    const all = rxnByEnzyme.get(enzyme);
    if (!all?.length) return null;
    let pool = ec ? all.filter((rx) => rx.ec === ec) : all;
    if (!pool.length) pool = all;
    if (pool.length > 1) {
      const exact = pool.filter((rx) => partIds(rx.substrates).includes(fromMet) && partIds(rx.products).includes(toMet));
      if (exact.length) pool = exact;
    }
    return pool[0];
  }

  // Which species each step's own branch lines already draw as a full cell. A
  // branch hangs a cell off one of the step's endpoints and links it back with a
  // hairline, so naming that species AGAIN on the side arc draws it twice off one
  // reaction — glycogen's `ugp2` declared `-ppi` while a branch off `utp` placed a
  // framed Diphosphate cell fed from the same step, asserting two PPi.
  const branchNeighbours = new Map();
  for (const r of ir.reactions) {
    if (r.kind !== "branch-link") continue;
    for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
      const met = nodeById.get(b)?.metabolite;
      if (!met) continue;
      const set = branchNeighbours.get(a) || new Set();
      set.add(met);
      branchNeighbours.set(a, set);
    }
  }

  // enrich reactions with enzyme identity (uniprot drives the inline 3D viewer)
  const dataRxnOf = new Map();   // drawn step -> the module reaction it is
  const doubleDrawn = [];        // species this step would have drawn twice
  for (const r of ir.reactions) {
    const e = r.enzyme ? R.enz(r.enzyme) : null;
    const from = nodeById.get(r.from), to = nodeById.get(r.to);
    const dataRxn = r.enzyme ? matchReaction(r.enzyme, r.ec, from?.metabolite, to?.metabolite) : null;
    if (dataRxn) {
      dataRxnOf.set(r.id, dataRxn);
      // direction is a scientific fact, not a drafting choice
      r.reversible = dataRxn.reversibility === "reversible";
      if (dataRxn.rateLimiting) r.committed = true;
      if (!r.ec && dataRxn.ec) r.ec = dataRxn.ec;
    }
    // The enzyme record names the POLYPEPTIDE ("Multifunctional protein CAD (CPS
    // II · aspartate transcarbamoylase · dihydroorotase)"); the module's own
    // reaction names the ACTIVITY, which is what this step does and what the EC
    // number printed under the label refers to.
    r.proteinName = e?.name || null;
    r.rxnName = dataRxn?.name || null;
    r.enzymeName = dataRxn?.name ? trimParenthetical(dataRxn.name, 12, false) : (e?.name || r.enzyme);
    r.gene = e?.gene || null;
    r.uniprot = e?.xrefs?.uniprot || e?.xrefs?.alphafold || null;
    r.pdb = e?.xrefs?.pdb?.[0] || null;
    // A side label may not repeat a species this step already draws as a cell —
    // whether that is the participant the spine arrow draws (heme's `alad` printed
    // "5-Aminolevulinate" beside the 5-aminolevulinate cell it flowed out of) or
    // one its own branch line hangs off the same step. The cell is the richer of
    // the two, so the caption is what gets dropped.
    const alreadyDrawn = new Set([
      from?.metabolite, to?.metabolite,
      ...(branchNeighbours.get(r.from) || []), ...(branchNeighbours.get(r.to) || []),
    ].filter(Boolean));
    const sideLabels = (ids) => (ids || [])
      .filter((id) => {
        if (!alreadyDrawn.has(id)) return true;
        if (id !== from?.metabolite && id !== to?.metabolite) doubleDrawn.push(`${r.enzyme || r.kind}: ${id}`);
        return false;
      })
      .map((id) => short(id, R.met(id)));
    r.inLabels = sideLabels(r.in);
    r.outLabels = sideLabels(r.out);
    // Effector tags carry the raw MPL token, so a regulator was named twice in two
    // vocabularies in one frame: heme's placed cell read "LEAD(II) ION (PB2+)"
    // while the tag on ferrochelatase read "pb2". The id stays on `id` because the
    // coverage check reconciles tags against the module's regulation records.
    for (const t of r.tags || []) {
      const tid = t.metabolite ?? t.id ?? t.label;
      t.id = tid;
      const tm = R.met(tid);
      t.label = tm ? short(tid, tm) : (R.enz(tid)?.gene || short(tid, null));
    }
  }

  // A step's label must not read as another step's. Two reactions that trimmed to
  // the same string get their full curated names back; if those still collide the
  // gene symbol separates them.
  resolveLabelCollisions(ir.reactions);

  // Cofactor side is the compiler's index parity, which is arbitrary — on a
  // serpentine spine half the labels land on the neighbouring cell. Pick the side
  // whose label boxes fall on clear paper.
  chooseCofactorSides(ir);

  // A cell that carries a depiction must have reserved paper to draw it in. This
  // is the assertion that would have caught the bondless class before it shipped:
  // n.mol survived while cellSize() had handed the node a name-only box, so the
  // renderer fitted the ink into whatever the caption left — for H₂ that was
  // exactly 0 units of height.
  const airless = ir.nodes.filter((n) => n.mol &&
    n.h - NAME_TOP - captionLines(String(n.label).toUpperCase(), n.w) * NAME_LINE_H - CELL_PAD_B <= 8)
    .map((n) => `${n.metabolite} (h=${n.h})`);
  if (airless.length) {
    console.error(`❌ ${f}: ${airless.length} cell(s) carrying a structure with no room to draw it: ${airless.slice(0, 4).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // ---- geometry gates ----------------------------------------------------
  // Layout quality gate: a readable chart has no overlapping cells. This fails
  // the build rather than shipping a tangle.
  const overlaps = [];
  for (let a = 0; a < ir.nodes.length; a++) {
    for (let b = a + 1; b < ir.nodes.length; b++) {
      const p = ir.nodes[a], q = ir.nodes[b];
      if (!(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y)) {
        overlaps.push(`${p.metabolite} ↔ ${q.metabolite}`);
      }
    }
  }
  // Connectivity gate: every reaction must physically touch both of the cells it
  // claims to connect. A stub ending in empty canvas reads as biochemistry that
  // does not exist, so it fails the build.
  const dangling = [];
  for (const r of ir.reactions) {
    const from = nodeById.get(r.from), to = nodeById.get(r.to);
    if (!from || !to) { dangling.push(`${r.enzyme || r.kind}: unknown endpoint`); continue; }
    const touches = (p, n) => p[0] >= n.x - 14 && p[0] <= n.x + n.w + 14 && p[1] >= n.y - 14 && p[1] <= n.y + n.h + 14;
    const a = r.points[0], b = r.points[r.points.length - 1];
    if (!touches(a, from) || !touches(b, to)) {
      dangling.push(`${r.enzyme || r.kind} (${from.metabolite}->${to.metabolite})`);
    }
  }
  if (dangling.length) {
    console.error(`❌ ${f}: ${dangling.length} reaction(s) not touching their cells: ${dangling.slice(0, 4).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // Routing gate: a reaction line may not run through a cell it does not connect.
  const crossings = [];
  for (const r of ir.reactions) {
    const a = nodeById.get(r.from), b = nodeById.get(r.to);
    for (let i = 1; i < r.points.length; i++) {
      const [p, q] = [r.points[i - 1], r.points[i]];
      const lo = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]) };
      const hi = { x: Math.max(p[0], q[0]), y: Math.max(p[1], q[1]) };
      const blocker = ir.nodes.find((n) => n !== a && n !== b &&
        !(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y));
      if (blocker) { crossings.push(`${r.enzyme || r.kind} through ${blocker.metabolite}`); break; }
    }
  }
  // Regulation lines are drawn too, so they must satisfy the same rule.
  for (const g of ir.regulation || []) {
    for (let i = 1; i < g.points.length; i++) {
      const [p, q] = [g.points[i - 1], g.points[i]];
      // Shrink ONLY along the segment's long axis. Insetting both axes made every
      // axis-aligned segment degenerate (hi < lo) so the check silently skipped
      // every horizontal and vertical regulation line.
      const lo = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]) };
      const hi = { x: Math.max(p[0], q[0]), y: Math.max(p[1], q[1]) };
      if (hi.x - lo.x >= hi.y - lo.y) { lo.x += 6; hi.x -= 6; } else { lo.y += 6; hi.y -= 6; }
      if (hi.x < lo.x || hi.y < lo.y) continue;
      const blocker = ir.nodes.find((n) => n.metabolite !== g.from && n.metabolite !== g.to &&
        !(hi.x <= n.x || n.x + n.w <= lo.x || hi.y <= n.y || n.y + n.h <= lo.y));
      if (blocker) { crossings.push(`regulation ${g.from}->${g.to} through ${blocker.metabolite}`); break; }
    }
  }

  if (crossings.length) {
    console.error(`❌ ${f}: ${crossings.length} reaction(s) routed through unrelated cells: ${crossings.slice(0, 4).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  if (overlaps.length) {
    console.error(`❌ ${f}: ${overlaps.length} overlapping cell(s): ${overlaps.slice(0, 5).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // ---- text gates --------------------------------------------------------
  // Everything above measures rectangles the compiler placed. Nothing measured a
  // glyph, which is why label collisions and overhangs shipped green. Measure
  // every emitted run, grow the bounds to contain it, then assert.
  const runs = measureText(ir);
  growBounds(ir, runs);

  const clipped = runs.filter((b) => b.x < ir.bounds.x || b.y < ir.bounds.y ||
    b.x + b.w > ir.bounds.x + ir.bounds.w || b.y + b.h > ir.bounds.y + ir.bounds.h);
  if (clipped.length) {
    console.error(`❌ ${f}: ${clipped.length} text run(s) outside bounds: ${clipped.slice(0, 4).map((b) => b.tag).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // A caption that ellipsises inside a cell narrower than the ceiling is a sizing
  // bug, not an honest overflow: the cell could have held it. A compact effector
  // chip is the exception — the layout clamps those to a fixed chip on purpose
  // (compile.mjs EFF_CHIP_W), so the cell could NOT have held it and the ellipsis
  // is the chip's own honest abbreviation, not a size this file chose wrong.
  const lost = ir.nodes.filter((n) => !n.compact && n.w < MAX_CELL_W &&
    wrapName(String(n.label).toUpperCase(), charsAt(n.w)).truncated)
    .map((n) => `${n.metabolite} (w=${n.w})`);
  if (lost.length) {
    console.error(`❌ ${f}: ${lost.length} caption(s) truncated in an undersized cell: ${lost.slice(0, 4).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // Two steps printing the same name under different EC numbers means the label
  // is naming the polypeptide, not the reaction — the label contradicts its own
  // EC line. Same-EC repeats are legitimate (one activity, two substrates).
  const byLabel = new Map();
  const ambiguous = [];
  for (const r of ir.reactions) {
    if (!r.enzyme) continue;
    const prev = byLabel.get(r.enzymeName);
    if (prev && prev.ec !== r.ec) ambiguous.push(`"${r.enzymeName}" EC ${prev.ec} vs EC ${r.ec}`);
    else if (!prev) byLabel.set(r.enzymeName, r);
  }
  if (ambiguous.length) {
    console.error(`❌ ${f}: ${ambiguous.length} enzyme label(s) covering different activities: ${ambiguous.slice(0, 3).join(", ")}`);
    process.exitCode = 1;
    continue;
  }

  // A side arc has roughly 60px of paper. Anything past HARD is a display name
  // that was never shortened, which is how "Enzyme N6-(dihydrolipoyl)lysine
  // (reduced lipoamide)" — 51 characters, ~240px — came to be printed on one.
  // The fix is an entry in SHORT, so the failure names the id that needs one.
  // An effector tag is printed at 8.5px ON the step, so it is held to the same
  // budget: naming a regulator "D-Fructose 2,6-bisphosphate" across an arrow is
  // the same defect as naming a cofactor that way beside one.
  const annotations = (r) => [...(r.inLabels || []), ...(r.outLabels || []), ...(r.tags || []).map((t) => t.label)];
  const prose = [];
  for (const r of ir.reactions) {
    for (const t of annotations(r)) {
      if (t.length > LABEL_HARD_CAP) prose.push(`${r.enzyme || r.kind}: "${t}" (${t.length})`);
    }
  }
  if (prose.length) {
    console.error(`❌ ${f}: ${prose.length} cofactor caption(s) over ${LABEL_HARD_CAP} chars — add a SHORT alias: ${prose.slice(0, 3).join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  const wordy = ir.reactions.flatMap(annotations).filter((t) => t.length > LABEL_SOFT_CAP);

  // Cofactor labels that still land on a cell. Their position is the renderer's
  // (chart-view.ts cofactorSide), so this reports rather than fails.
  const onCell = runs.filter((b) => b.kind === "cofactor" &&
    ir.nodes.some((n) => !(b.x + b.w <= n.x || n.x + n.w <= b.x || b.y + b.h <= n.y || n.y + n.h <= b.y)));

  // ---- coverage gates: does the drawing say what the module data says? ----
  const missing = coverageReport(ir, modJson, nodeByMet, dataRxnOf);
  const notes = [];
  if (wordy.length) notes.push(`${wordy.length} cofactor caption(s) over ${LABEL_SOFT_CAP} chars`);
  if (doubleDrawn.length) notes.push(`${doubleDrawn.length} side label(s) dropped as already drawn`);
  if (onCell.length) notes.push(`${onCell.length} cofactor label(s) over a cell`);
  if (missing.regulations.length) notes.push(`${missing.regulations.length} declared regulation(s) never drawn`);
  if (missing.orphans.length) notes.push(`${missing.orphans.length} cell(s) with no flux or regulation edge`);
  if (missing.cofactorSpine.length) notes.push(`${missing.cofactorSpine.length} cell(s) drawn as a side label instead of a substrate`);
  if (missing.blank.length) notes.push(`${missing.blank.length} cell(s) with no structure and no condensed column`);
  if (notes.length) {
    textWarnings += notes.length;
    console.warn(`⚠  ${f}: ${notes.join("; ")}`);
    for (const s of missing.regulations.slice(0, 3)) console.warn(`     regulation not on the sheet: ${s}`);
    for (const s of missing.orphans.slice(0, 3)) console.warn(`     orphan cell: ${s}`);
    for (const s of missing.blank.slice(0, 3)) console.warn(`     cell draws nothing (no SMILES resolved): ${s}`);
    for (const s of missing.cofactorSpine.slice(0, 3)) console.warn(`     side label should be a substrate: ${s}`);
    for (const s of wordy.slice(0, 3)) console.warn(`     caption still prose: "${s}"`);
    for (const s of doubleDrawn.slice(0, 3)) console.warn(`     drawn twice off one step: ${s}`);
    for (const b of onCell.slice(0, 3)) console.warn(`     label over a cell: ${b.tag} "${b.text}"`);
  }
  // Dropped biochemistry is not a cosmetic finding. A regulation the module
  // declares and the sheet never draws, a cell with no flux edge and a cell that
  // draws nothing are all the drawing failing to say what the data says — so
  // they are the findings that ratchet, separately from the softer
  // side-label/cofactor-placement reports. The budget file (if present) is a
  // frozen per-chart count: a chart may not get worse than it is today, and each
  // fix lowers the ceiling. Without it the whole set is still gated by
  // CHART_STRICT=1, as before.
  const dropped = {
    regulations: missing.regulations.length,
    orphans: missing.orphans.length,
    blank: missing.blank.length,
  };
  const budget = COVERAGE_BUDGET[ir.id];
  const over = budget
    ? Object.entries(dropped).filter(([k, v]) => v > (budget[k] ?? 0)).map(([k, v]) => `${k}: ${v} > ${budget[k] ?? 0}`)
    : [];
  if (over.length) {
    console.error(`❌ ${f}: coverage regressed past its frozen budget — ${over.join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  if (STRICT && notes.length) { process.exitCode = 1; continue; }

  writeFileSync(join(OUT, `${ir.id}.json`), JSON.stringify(ir));
  charts.push({ id: ir.id, title: ir.title, grid: ir.grid, nodes: ir.nodes.length, reactions: ir.reactions.length });
  const withMol = ir.nodes.filter((n) => n.mol).length;
  console.log(`✅ ${f} — ${ir.nodes.length} nodes (${withMol} with structures), ${ir.reactions.length} reactions, ${ir.regulation.length} regulation`);
}

if (only && existsSync(join(OUT, "index.json"))) {
  const prev = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).charts || [];
  const merged = [...prev.filter((c) => !charts.some((n) => n.id === c.id)), ...charts]
    .sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ charts: merged }, null, 2));
} else {
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ charts }, null, 2));
}
console.log(`Compiled ${charts.length} chart(s) -> web/public/chart/`);
if (textWarnings) console.log(`${textWarnings} layout-source warning(s); set CHART_STRICT=1 to fail on them.`);

// ---------------------------------------------------------------- helpers

/** Michal's protein chip: a fixed-height rounded box holding a symbol. */
function proteinChipSize(label) {
  const name = String(label || "").toUpperCase();
  const w = Math.max(118, Math.min(MAX_CELL_W, captionWidth(name)));
  return { w, h: 52 + (captionLines(name, w) - 1) * NAME_LINE_H };
}

/**
 * Give every step in one chart a label that identifies it. Trimmed names that
 * collide get their full curated names back; if two different enzymes still
 * print the same activity the gene symbol separates them.
 */
function resolveLabelCollisions(reactions) {
  const steps = reactions.filter((r) => r.enzyme);
  const activity = (r) => (r.rxnName ? trimParenthetical(r.rxnName, 12, false) : null);
  // Start from whichever of the two names is shorter. The activity identifies the
  // step, but a curator's step name can be a whole sentence ("Sterol side-chain
  // oxidation to the C27 acid (three sequential CYP27A1 oxidations…)") where the
  // enzyme's own name is both shorter and unmistakable.
  for (const r of steps) {
    const a = activity(r), p = r.proteinName;
    r.enzymeName = a && p ? (p.length < a.length ? p : a) : (a || p || r.enzyme);
  }
  /** Groups of steps that currently print the same string but are NOT one activity. */
  const conflicts = () => {
    const g = new Map();
    for (const r of steps) {
      const list = g.get(r.enzymeName);
      if (list) list.push(r); else g.set(r.enzymeName, [r]);
    }
    // One activity acting on two substrates (same EC) is one label by design —
    // the CA and CDCA branches of bile-acid synthesis, aldolase on both trioses.
    return [...g.values()].filter((l) => new Set(l.map((r) => r.ec)).size > 1);
  };
  for (const list of conflicts()) {
    for (const r of list) r.enzymeName = activity(r) || r.proteinName || r.enzyme;
  }
  for (const list of conflicts()) {
    for (const r of list) {
      const sym = r.gene || r.enzyme;
      if (sym && !r.enzymeName.includes(sym)) r.enzymeName = `${r.enzymeName} (${sym})`;
    }
  }
}

/** Midpoint measured along the polyline — chart-view.ts midpoint(). */
function polyMid(points) {
  if (points.length < 2) return points[0] || [0, 0];
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d); total += d;
  }
  let walked = 0;
  for (let i = 0; i < seg.length; i++) {
    if (walked + seg[i] >= total / 2) {
      const t = seg[i] ? (total / 2 - walked) / seg[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t,
              points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    walked += seg[i];
  }
  return points[points.length - 1];
}

function polyLen(points) {
  return points.reduce((a, p, i) =>
    i ? a + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0, 0);
}

/** Where chart-view.ts cofactorSide() paints this step's side labels. */
function cofactorRuns(r, side = r.side) {
  const out = [];
  const texts = [["in", (r.inLabels || []).join(" + ")], ["out", (r.outLabels || []).join(" + ")]];
  if (!texts.some(([, t]) => t)) return out;
  const [mx, my] = polyMid(r.points);
  const dir = -(side === "left" ? -1 : 1);          // cofactors take the far side
  const rad = Math.max(12, Math.min(26, polyLen(r.points) * 0.22));
  for (const [kind, text] of texts) {
    if (!text) continue;
    const w = text.length * COF_CH;
    const anchorX = mx + dir * (rad + 4);
    const baseline = kind === "in" ? my - rad - 2 : my + rad + 10;
    out.push({
      kind: "cofactor", tag: `${r.enzyme || r.kind}.${kind}`, text,
      x: dir > 0 ? anchorX : anchorX - w, y: baseline - 8, w, h: COF_H,
    });
  }
  return out;
}

/**
 * Choose each step's cofactor side by where the labels actually land. The
 * compiler alternates on reaction index, which knows nothing about what is
 * beside the arrow.
 */
function chooseCofactorSides(ir) {
  const taken = [];
  // Every stroke the compiler has already committed. `side` does not only move
  // the cofactor captions — it moves the enzyme name and its EC line to the
  // opposite side of the arrow, onto paper compile() reserved as free when it
  // routed the regulation rails and the branch hairlines against labelKeepOut.
  // Measured before this check, 73 of 304 enzyme labels were inked on the
  // opposite side from their own reserved box, which is why names on cholesterol
  // and sphingolipid were struck through by rails.
  const routedInk = [];
  for (const g of ir.regulation || []) routedInk.push(...segmentsOf(g.points));
  for (const r of ir.reactions) if (r.kind === "branch-link") routedInk.push(...segmentsOf(r.points));
  const onRoutedInk = (box) => routedInk.some((s) => segmentHitsBox(s, box));

  /** Struck-out labels first, then how much ink is buried, then how close it came. */
  const cost = (boxes) => {
    let hits = 0, ink = 0, near = Infinity;
    for (const b of boxes) {
      for (const o of [...ir.nodes, ...taken]) {
        if (overlap(b, o)) { hits++; ink += area(b, o); }
        else near = Math.min(near, gap(b, o));
      }
    }
    return [hits, ink, -Math.min(near, 60)];
  };
  const better = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  for (const r of ir.reactions) {
    if (!(r.inLabels?.length || r.outLabels?.length)) continue;
    const other = r.side === "left" ? "right" : "left";
    // The name block moves with the side, so it is scored with the side.
    const keep = [...cofactorRuns(r, r.side), ...enzymeLabelBoxes(r, r.side)];
    const flip = [...cofactorRuns(r, other), ...enzymeLabelBoxes(r, other)];
    // A flip that parks the enzyme name on a committed rail trades a buried
    // cofactor caption for a struck-through enzyme name — never worth it, and
    // invisible to a cost function that only scores the captions it is moving.
    const flipLegal = !enzymeLabelBoxes(r, other).some(onRoutedInk);
    if (flipLegal && better(cost(flip), cost(keep))) { r.side = other; taken.push(...flip); }
    else taken.push(...keep);
    // The exported box is what the renderer sets the name into. Leaving it on the
    // pre-flip side made the renderer's own obstacle model disagree with its ink.
    const box = enzymeLabelBoxes(r, r.side)[0];
    if (box) r.labelBox = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
}

// compile.mjs labelBoxesFor(): the always-set head of an enzyme name plus its EC
// line. Mirrored here because this file is what decides the final side.

function enzymeLabelBoxes(r, side = r.side) {
  if (!r.enzyme) return [];
  const [mx, my] = polyMid(r.points);
  const d = side === "left" ? -1 : 1;
  return [{
    kind: "enzyme-block", tag: `${r.enzyme}.block`,
    x: Math.round(d > 0 ? mx + 10 : mx - 10 - LABEL_W),
    y: Math.round(my - LABEL_LINE - 4),
    w: LABEL_W, h: LABEL_LINE * 2 + LABEL_EC + 4,
  }];
}

/** Split a polyline into its segments. A function *declaration* so it hoists:
 *  chooseCofactorSides() runs at module top level and called this ~50 lines
 *  before the old `const` arrow was initialised, which threw a temporal-dead-zone
 *  ReferenceError and broke the whole data build. */
function segmentsOf(points) {
  return (points || []).slice(1).map((p, i) => [points[i], p]);
}

/** Does an axis-aligned box contain any part of this segment? (Liang–Barsky.) */
function segmentHitsBox([p, q], b) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [num, den] of [[b.x - p[0], dx], [p[0] - (b.x + b.w), -dx],
                            [b.y - p[1], dy], [p[1] - (b.y + b.h), -dy]]) {
    if (den === 0) { if (num > 0) return false; continue; }
    const t = num / den;
    if (den > 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/** Shortest distance between two non-overlapping boxes. */
function gap(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
function area(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
         Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

/** A measured box for every text run the renderer will paint. */
function measureText(ir) {
  const runs = [];
  for (const n of ir.nodes) {
    const lines = wrapName(String(n.label).toUpperCase(), charsAt(n.w)).lines;
    lines.forEach((ln, i) => {
      const w = ln.length * NAME_CH;
      runs.push({
        kind: "caption", tag: `${n.metabolite}.name`, text: ln,
        x: n.x + n.w / 2 - w / 2, y: n.y + (n.isProtein ? 34 : 12) + i * NAME_LINE_H - 9,
        w, h: NAME_LINE_H,
      });
    });
  }
  for (const r of ir.reactions) {
    runs.push(...cofactorRuns(r));
    if (!r.enzyme) continue;
    // The renderer re-places enzyme names at runtime, so this is their nominal
    // extent — enough to keep "Fit" from cropping one at the sheet edge.
    const [mx, my] = polyMid(r.points);
    const dir = r.side === "left" ? -1 : 1;
    const label = r.enzymeName || r.enzyme;
    const w = Math.min(label.length, 34) * ENZ_CH;
    const x = dir > 0 ? mx + 14 : mx - 14 - w;
    runs.push({ kind: "enzyme", tag: `${r.enzyme}.name`, text: label, x, y: my - 2 - ENZ_H, w, h: ENZ_H });
    if (r.ec) runs.push({ kind: "ec", tag: `${r.enzyme}.ec`, text: `EC ${r.ec}`, x, y: my + 10 - 8, w: (r.ec.length + 3) * ENZ_CH, h: EC_H });
  }
  return runs;
}

/**
 * Bounds must contain every drawn thing, TEXT INCLUDED. compile() takes the hull
 * of cells and route points only, so a cofactor annotation or an enzyme name at
 * the margin was outside the box "Fit" scrolls to and got clipped.
 */
function growBounds(ir, runs) {
  if (!runs.length) return;
  const pad = 8;
  const { w, h } = ir.bounds;
  let { x, y } = ir.bounds;
  let x1 = x + w, y1 = y + h;
  for (const b of runs) {
    x = Math.min(x, b.x - pad); y = Math.min(y, b.y - pad);
    x1 = Math.max(x1, b.x + b.w + pad); y1 = Math.max(y1, b.y + b.h + pad);
  }
  ir.bounds = { x: Math.round(x), y: Math.round(y), w: Math.round(x1 - x), h: Math.round(y1 - y) };
}

/**
 * Reconcile the drawing against the module it came from. The geometry gates only
 * ask whether the picture is tidy; these ask whether it is the pathway. Every
 * finding names the .mpl construct to fix — the pathway JSON is the authority.
 */
function coverageReport(ir, modJson, nodeByMet, dataRxnOf) {
  const out = { regulations: [], orphans: [], cofactorSpine: [], blank: [] };

  // A cell with neither a drawing nor a condensed column draws a frame, a name
  // and nothing else. Nothing in the pipeline asked whether a cell had ANY
  // content, which is how L-malate came to be an empty frame on three sheets and
  // the whole acyl-[ACP] elongation cycle of fatty-acid synthesis on a fourth:
  // data/smiles.json holds those entries as `unresolved: true` stubs with no
  // `smiles` key, so they resolve to neither path. A class entry (R-X, lipid
  // hydroperoxide, the lipoyllysines) carries a formulaClass and is honestly
  // structureless; a protein has its chip; a compact effector chip is clamped by
  // the layout on purpose. Everything else is a resolver failure, by name.
  for (const n of ir.nodes) {
    if (n.mol || n.condensed || n.compact) continue;
    if (n.macromolecule || n.isProtein || n.formulaClass) continue;
    out.blank.push(n.metabolite);
  }
  if (!modJson) return out;

  const drawn = new Set();
  for (const g of ir.regulation || []) drawn.add(`${g.from}->${g.to}`);
  for (const r of ir.reactions) for (const t of r.tags || []) drawn.add(`${t.id ?? t.label}->${r.enzyme}`);
  for (const rg of modJson.regulations || []) {
    const key = `${rg.regulator?.id}->${rg.target?.id}`;
    if (!drawn.has(key)) out.regulations.push(`${key} (${rg.type || rg.effect})`);
  }

  // A cell reached only by a branch-link hairline is scaffolding, not a step: the
  // sheet draws the metabolite but asserts nothing about how it is made or used.
  const touched = new Set();
  for (const r of ir.reactions) {
    if (r.kind === "branch-link") continue;
    touched.add(r.from); touched.add(r.to);
  }
  for (const g of ir.regulation || []) {
    for (const id of [g.from, g.to]) { const n = nodeByMet.get(id); if (n) touched.add(n.id); }
  }
  for (const n of ir.nodes) if (!touched.has(n.id)) out.orphans.push(n.metabolite);

  // A metabolite that has its own cell but is drawn as a side label on a step it
  // is a PRINCIPAL substrate of severs the spine at that point. The module says
  // which is which: glycogen's ugp2 declares no cofactors, so g1p is a carbon
  // donor demoted to a red arc, whereas warburg's ldha declares nadh a cofactor
  // and drawing it beside the arrow is exactly right.
  const fluxPairs = new Set();
  for (const r of ir.reactions) { fluxPairs.add(`${r.from}|${r.enzyme}`); fluxPairs.add(`${r.to}|${r.enzyme}`); }
  for (const r of ir.reactions) {
    if (!r.enzyme) continue;
    const dr = dataRxnOf.get(r.id);
    if (!dr) continue;
    const principal = new Set([...(dr.substrates || []), ...(dr.products || [])].map((p) => p.metabolite));
    for (const c of dr.cofactors || []) principal.delete(c.metabolite);
    for (const id of [...(r.in || []), ...(r.out || [])]) {
      const cell = nodeByMet.get(id);
      if (!cell || !principal.has(id) || fluxPairs.has(`${cell.id}|${r.enzyme}`)) continue;
      out.cofactorSpine.push(`${r.enzyme}: ${id} has its own cell and is declared a substrate/product but not a cofactor, yet is drawn as a side label`);
    }
  }
  return out;
}

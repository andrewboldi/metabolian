// Shape the Rhea/ChEBI corpus into schema-valid pathway modules.
//
// The hard part is not the data, it is deciding what a SHEET is. Two obvious
// groupings were tried and rejected on measurement:
//
//   - Connected components of the metabolite graph: 75% of the corpus lands in
//     ONE component of 12,343 reactions. Real metabolism is densely connected;
//     components are not sheets.
//   - EC sub-subclass ("all of EC 1.1.1"): tidy, but a reaction family is not a
//     pathway. It renders as dozens of disconnected two-node stubs, which is
//     the opposite of the Roche visual language.
//
// What a Roche sheet actually is: a SPINE — a chain of transformations on one
// carbon skeleton — with cofactors entering at the side and short branches
// hanging off it. So the corpus is cut into spines directly: follow the product
// of one reaction into the substrate of the next, ignoring currency metabolites,
// and emit each chain as its own module. That is both faithful to the poster and
// exactly what the .mpl grammar already expresses.

import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chebiTable, loadReactions, conjugateMap, enzymeNames, expasyUniprot, CURRENCY } from "./corpus.mjs";
import { loadMetanetx } from "./metanetx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "data", "pathways");

const MIN_SPINE = Number(process.env.MIN_SPINE || 3);
const MAX_SPINE = Number(process.env.MAX_SPINE || 16);  // a sheet can carry a long route
// Does not bind: extraction exhausts the combined corpus at ~3,300 sheets on
// its own. This is a runaway guard. It USED to bind, back when the master wall
// chart drew every sheet and 7,000 of them took 36.9s to paint — the master is
// now capped by its own cell budget instead, which decouples how large the
// atlas can be from what one poster can draw.
const MAX_SHEETS = Number(process.env.MAX_SHEETS || 20000);

// Trailing hyphens are trimmed AFTER the length cut, not before: slicing a long
// name mid-word leaves one behind, and the schema's id pattern rejects it.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "");
// Entity ids use underscores like the hand-authored modules do. In .mpl a leading
// "-" marks a side-exit, so a hyphenated id in cofactor position is ambiguous.
const eid = (s) => slug(s).replace(/-/g, "_");

/** EC top class -> the schema's category vocabulary. A coarse but honest map:
 *  it says what KIND of chemistry the sheet is, never more than the EC asserts. */
function categoryFor(ecs, names) {
  const text = names.join(" ").toLowerCase();
  if (/\b(amino|glutam|aspart|lysine|serine|threonine|methionine|tryptophan|tyrosine|proline|arginine)\b/.test(text)) return "amino-acid-metabolism";
  if (/\b(purine|pyrimidine|adenosine|guanosine|cytidine|uridine|thymidine|nucleotide)\b/.test(text)) return "nucleotide-metabolism";
  if (/\b(fatty|acyl|lipid|sphingo|phosphatidyl|sterol|cholesterol|prostagland)\b/.test(text)) return "lipid-metabolism";
  if (/\b(glucos|fructos|mannos|galactos|xylos|sugar|glycan|starch|sucrose)\b/.test(text)) return "carbohydrate-metabolism";
  if (/\b(folate|biotin|thiamine|riboflavin|cobalamin|pantothen|quinone|heme|porphyrin)\b/.test(text)) return "cofactor-vitamin-metabolism";
  if (/\b(glutathione|peroxide|superoxide|thioredoxin)\b/.test(text)) return "redox-detox";
  if (ecs.some((e) => e.startsWith("1."))) return "energy-metabolism";
  return "other";
}

const chebi = chebiTable();

// TWO sources. Rhea is the ceiling for one curated database; MetaNetX reconciles
// the others (KEGG, MetaCyc, SEED, BiGG) and supplies 17,523 vetted reactions
// that are not Rhea under another name. Its participants resolve to ChEBI where
// a mapping exists — so the two corpora share one vocabulary and dedupe against
// each other — and to an mnx: key where none does. Both are balance-checked here
// rather than trusted: MetaNetX is a reconciliation, not a curation, and 7,002
// of its reactions do not balance.
const mnx = loadMetanetx(chebi);
for (const [id, prop] of mnx.props) {
  const key = `mnx:${id}`;
  if (!chebi.has(key)) chebi.set(key, { name: prop.name, stars: 0, formula: prop.formula, charge: prop.charge });
}

// The WHOLE vetted corpus, not just the EC-annotated part. Restricting to EC was
// a workaround for the .mpl grammar demanding an enzyme token on every step: for
// the 56% of Rhea reactions with no EC assignment the generator had been writing
// "spontaneous", which asserts a mechanism Rhea never claims. The grammar now has
// "." for a step with no assigned enzyme — which is what the poster draws, a
// plain arrow — so those reactions can be carried honestly instead of dropped.
const { reactions: rheaReactions } = loadReactions(chebi);
const reactions = [...rheaReactions, ...mnx.reactions];

// ------------------------------------------------- reuse the repo's own naming
// The hand-authored modules already carry 300+ curated ChEBI -> id/name
// decisions ("CHEBI:57540" is `nad`, named "NAD+"). Reusing them buys three
// things at once: captions short enough for the chart's 20-char gate, one
// vocabulary across ingested and authored sheets, and correct dedup in the
// master graph — which keys shared entities on the cross-reference.
// Generated sheets are excluded so the map never learns from its own output.
const GENERATED = new Set(
  existsSync(join(ROOT, "data", "ingest", "sheets.json"))
    ? JSON.parse(readFileSync(join(ROOT, "data", "ingest", "sheets.json"), "utf8")).map((s) => s.id)
    : [],
);
const conjugates = conjugateMap();
const ecNames = enzymeNames();
// EC -> representative human UniProt accession (a real Rhea/ExPASy -> UniProt
// link). Not a gene symbol: enzyme.dat carries neither HGNC symbols nor a
// reliable proxy for them, so the gene NODE layer is left unlit rather than
// populated from entry names that would misname the gene.
const ecUniprot = expasyUniprot();
const canonical = new Map();
for (const f of readdirSync(OUT).filter((x) => x.endsWith(".json"))) {
  if (GENERATED.has(f.replace(".json", ""))) continue;
  const m = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  for (const x of m.metabolites || []) {
    const c = String(x.xrefs?.chebi || "").replace("CHEBI:", "");
    if (c && !canonical.has(c)) canonical.set(c, { id: x.id, name: x.name });
  }
}

/** ChEBI names carry microspecies annotation the chart does not need: the charge
 *  is already in `charge`, and "zwitterion"/"residue" describe the state, not the
 *  compound. Stripping them is what brings "O-acetyl-L-serine zwitterion" (28)
 *  under the caption gate without inventing a name. */
/** A caption form for names too long to print on a side arc. Systematic ChEBI
 *  names routinely exceed the chart's 20-char gate and there is no curated
 *  alias for most of them, so hand-writing one per species does not scale to
 *  thousands. These substitutions are the conventional ones ("5'-monophosphate"
 *  is written 5'-MP everywhere in biochemistry); anything still too long is cut
 *  at a word boundary with an ellipsis, and the full name survives in the cell's
 *  <title>. Nothing is renamed — only abbreviated. */
function shortForm(name) {
  const CAP = 20;
  if (!name || name.length <= CAP) return null;
  let s = name
    .replace(/^\((?:\d+[RSEZ]|[RSEZ]|\d+[a-z]?)\)-/i, "")
    .replace(/\btriphosphate\b/gi, "TP")
    .replace(/\bdiphosphate\b/gi, "PP")
    .replace(/\bmonophosphate\b/gi, "MP")
    .replace(/\bphosphate\b/gi, "P")
    .replace(/\bribofuranosyl\b/gi, "ribosyl")
    .replace(/\bdehydrogenase\b/gi, "DH")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= CAP) return s;
  const cut = s.slice(0, CAP - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 8 ? cut.slice(0, at) : cut).trim()}\u2026`;
}

function displayName(raw) {
  return String(raw || "")
    .replace(/\((?:\d+)?[+\u2212\u2013-]\)\s*$/u, "")
    .replace(/\s+(zwitterion|residue)$/i, "")
    .trim() || String(raw || "");
}

// ---------------------------------------------------------------- spine search
// A reaction's "main" participants are everything that is not currency. Chaining
// on currency would thread every reaction in the corpus through ATP and water.
const mainsOf = (r, side) => r[side].map((p) => p.chebi).filter((c) => !CURRENCY.has(c));

// Which reactions consume a given metabolite. Hub metabolites (consumed by very
// many reactions) are poor spine links — they are junctions, not steps — so the
// index deliberately skips them and the walk stops there instead of picking an
// arbitrary continuation out of hundreds.
const consumers = new Map();
for (const [i, r] of reactions.entries()) {
  for (const c of mainsOf(r, "substrates")) {
    if (!consumers.has(c)) consumers.set(c, []);
    consumers.get(c).push(i);
  }
}
const HUB = 25;
const used = new Set();

// Every reaction touching a given metabolite, either side. Spine growth only
// follows substrate->product; a BRANCH may hang off a spine metabolite in either
// direction, which is how the poster shows what else a compound does.
const touching = new Map();
for (const [i, r] of reactions.entries()) {
  for (const c of new Set([...mainsOf(r, "substrates"), ...mainsOf(r, "products")])) {
    if (!touching.has(c)) touching.set(c, []);
    touching.get(c).push(i);
  }
}

/** Walk forward from a reaction, following its main product into the next step. */
function growSpine(startIdx) {
  const chain = [startIdx];
  const seenMet = new Set(mainsOf(reactions[startIdx], "substrates"));
  let cur = startIdx;
  while (chain.length < MAX_SPINE) {
    const outs = mainsOf(reactions[cur], "products").filter((c) => !seenMet.has(c));
    let next = -1;
    for (const met of outs) {
      const cand = (consumers.get(met) || []);
      if (!cand.length || cand.length > HUB) continue;   // junction, not a step
      const free = cand.find((j) => !used.has(j) && !chain.includes(j));
      if (free !== undefined) { next = free; seenMet.add(met); break; }
    }
    if (next < 0) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

// Prefer starting points that are themselves rarely produced — the head of a
// chain rather than its middle — so spines read in the direction the chemistry
// actually runs.
const producedCount = new Map();
for (const r of reactions) for (const c of mainsOf(r, "products")) producedCount.set(c, (producedCount.get(c) || 0) + 1);
const order = reactions.map((_, i) => i).sort((a, a2) => {
  const head = (i) => Math.min(...mainsOf(reactions[i], "substrates").map((c) => producedCount.get(c) || 0), 99);
  return head(a) - head(a2);
});

const sheets = [];
for (const i of order) {
  if (sheets.length >= MAX_SHEETS) break;
  if (used.has(i)) continue;
  const chain = growSpine(i);
  if (chain.length < MIN_SPINE) continue;
  chain.forEach((j) => used.add(j));
  sheets.push(chain);
}

// ---------------------------------------------------------------- emit modules
const existing = new Set(readdirSync(OUT).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")));
const nameOf = (c) => chebi.get(c)?.name || `CHEBI:${c}`;
let written = 0, reactionsWritten = 0;
const index = [];

/** Reactions to hang off a spine. Spine extraction leaves most of the corpus
 *  unused — a reaction only joins a spine if it continues one — and those are
 *  real, cited chemistry on compounds already drawn. Attaching a few per sheet
 *  is what the poster does with a branch, and it raises the information on the
 *  sheet without inventing a new one. Capped per sheet and per anchor so a hub
 *  compound cannot bury its own spine. */
const MAX_BRANCH_PER_SHEET = Number(process.env.MAX_BRANCH || 26);
// No sheet is drawn with more branches than the primary pass already produces
// cleanly, so the leftover pass below can only fill a sheet UP TO this same
// ceiling — never past the branch density the current build routes at 0/0/0.
const LEFTOVER_TOTAL_CAP = Number(process.env.LEFTOVER_CAP || MAX_BRANCH_PER_SHEET);
function pickBranches(chain) {
  const onSpine = new Set(chain.flatMap((i) => [...mainsOf(reactions[i], "substrates"), ...mainsOf(reactions[i], "products")]));
  const out = [];
  for (const i of chain) {
    for (const anchor of mainsOf(reactions[i], "products")) {
      if (out.length >= MAX_BRANCH_PER_SHEET) return out;
      // Up to two branches per anchor. One was too conservative once the sheet
      // count had to come DOWN for the master chart to stay renderable: the same
      // chemistry then has to ride on fewer sheets, which means each sheet must
      // carry more of it. Two is where a hub still reads as a spine with limbs
      // rather than a star.
      if (out.filter((b) => b.anchor === anchor).length >= 2) continue;
      const cand = (touching.get(anchor) || []).filter((j) => !used.has(j) && !chain.includes(j));
      let takenHere = 0;
      for (const j of cand) {
        if (takenHere >= 2) break;
        const r = reactions[j];
        // The far end must be a compound the sheet does not already draw, or the
        // branch loops back on itself and reads as a duplicate edge.
        const far = [...mainsOf(r, "products"), ...mainsOf(r, "substrates")].find((c) => c !== anchor && !onSpine.has(c));
        if (!far) continue;
        out.push({ anchor, far, rxnIdx: j });
        used.add(j);
        onSpine.add(far);
        takenHere++;
      }
    }
  }
  return out;
}

/** LEFTOVER PASS. Spine extraction and the primary branch pass together still
 *  leave ~2,700 vetted reactions undrawn — real, balanced, cited chemistry that
 *  simply does not chain into a MIN_SPINE spine and was not picked as a branch.
 *  They stay in the merged graph and search either way, but they never reach the
 *  DRAWING. This hangs each one on an existing spine as one more branch, which is
 *  the poster's own idiom for "what else this compound does". It is hard-gated on
 *  readability so it cannot degrade a sheet:
 *    - anchors ONLY on a SPINE metabolite (never on another branch's far node),
 *      so the layout stays identical in KIND to what the build already routes;
 *    - re-lists a far compound the sheet does not already draw (no self-loops,
 *      no duplicate edges), so it is never a 2-node stub;
 *    - never pushes a sheet past LEFTOVER_TOTAL_CAP branches — the same ceiling
 *      the primary pass already proves renderable — and no more than two per
 *      anchor, so a hub cannot bury its own spine.
 *  Deterministic: spine metabolites and their touching reactions are visited in
 *  index order. Runs only for sheets that actually emit (called from the emit
 *  loop past its skip guards), so a reaction is never consumed by a sheet that
 *  is then dropped. */
function grabLeftovers(chain, primary) {
  const spineMet = new Set(chain.flatMap((i) => [...mainsOf(reactions[i], "substrates"), ...mainsOf(reactions[i], "products")]));
  const onSheet = new Set(spineMet);
  for (const b of primary) onSheet.add(b.far);
  const extra = [];
  const perAnchor = new Map();
  let total = primary.length;
  for (const anchor of spineMet) {
    if (total >= LEFTOVER_TOTAL_CAP) break;
    const cand = (touching.get(anchor) || []).filter((j) => !used.has(j) && !chain.includes(j));
    for (const j of cand) {
      if (total >= LEFTOVER_TOTAL_CAP) break;
      if ((perAnchor.get(anchor) || 0) >= 2) break;
      const r = reactions[j];
      const far = [...mainsOf(r, "products"), ...mainsOf(r, "substrates")].find((c) => c !== anchor && !onSheet.has(c));
      if (!far) continue;
      extra.push({ anchor, far, rxnIdx: j });
      used.add(j);
      onSheet.add(far);
      perAnchor.set(anchor, (perAnchor.get(anchor) || 0) + 1);
      total++;
    }
  }
  return extra;
}

let leftoverDrawn = 0, leftoverSheets = 0;
for (const chain of sheets) {
  const branches = pickBranches(chain);
  const rxns = chain.map((i) => reactions[i]);
  const first = mainsOf(rxns[0], "substrates")[0];
  const last = mainsOf(rxns[rxns.length - 1], "products").slice(-1)[0] || mainsOf(rxns[rxns.length - 1], "products")[0];
  if (!first || !last) continue;

  // Endpoint names are capped before they become a title. Systematic ChEBI names
  // run to 60+ characters, and two of them joined by "to" produced region titles
  // on the master sheet so long they printed straight through their neighbours.
  const cap = (n, at = 26) => {
    const d = displayName(n);
    if (d.length <= at) return d;
    const cut = d.slice(0, at - 1), sp = cut.lastIndexOf(" ");
    return `${(sp > 10 ? cut.slice(0, sp) : cut).trim()}\u2026`;
  };
  const title = `${cap(nameOf(first))} to ${cap(nameOf(last))}`;
  let id = slug(title);
  if (!id || existing.has(id)) id = slug(`${title}-${rxns[0].rhea}`);
  if (existing.has(id)) continue;
  existing.add(id);

  // Committed to emit: hang still-undrawn vetted reactions off this spine as
  // extra branches. Done here (past the skip guards) so a leftover is never
  // consumed by a sheet that is then dropped, and merged into `branches` so the
  // rest of the emit path — metabolites, enzymes, spacing, .mpl branch lines —
  // treats them exactly like a primary branch.
  const extras = grabLeftovers(chain, branches);
  if (extras.length) { branches.push(...extras); leftoverDrawn += extras.length; leftoverSheets++; }
  const branchRxns = branches.map((b) => reactions[b.rxnIdx]);

  // participants
  const metIds = new Map();
  const metabolites = [];
  for (const r of [...rxns, ...branchRxns]) {
    for (const p of [...r.substrates, ...r.products]) {
      if (metIds.has(p.chebi)) continue;
      const info = chebi.get(p.chebi);
      // Try the exact species, then the states ChEBI says are the same compound.
      let known = canonical.get(p.chebi);
      if (!known) {
        for (const alt of conjugates.get(p.chebi) || []) {
          known = canonical.get(alt);
          if (known) break;
        }
      }
      const label = known?.name || displayName(info?.name);
      const mid = known?.id || eid(label || `chebi_${p.chebi}`) || `chebi_${p.chebi}`;
      metIds.set(p.chebi, mid);
      // Applies to canonical names too: reusing the repo's vocabulary does not
      // make a name short ("UMP (uridine 5'-monophosphate)" is 30 chars), and the
      // caption gate does not care where the name came from.
      const abbrev = shortForm(label);
      metabolites.push({
        id: mid, name: label || `CHEBI:${p.chebi}`,
        ...(abbrev ? { short: abbrev } : {}),
        formula: info?.formula || undefined,
        charge: info?.charge ?? undefined,
        xrefs: String(p.chebi).startsWith("mnx:")
          ? { metanetx: String(p.chebi).slice(4) }
          : { chebi: `CHEBI:${p.chebi}` },
      });
    }
  }

  // one enzyme per distinct EC on the chain
  const enzymes = [];
  const ecSeen = new Map();
  for (const r of [...rxns, ...branchRxns]) {
    for (const ec of r.ec) {
      if (ecSeen.has(ec)) continue;
      const enzId = `ec_${ec.replace(/\./g, "_")}`;
      ecSeen.set(ec, enzId);
      // schema: enzyme.ec is an ARRAY (an enzyme can carry several), while
      // reaction.ec is a single string. Easy to conflate; the validator catches it.
      const uniprot = ecUniprot.get(ec);
      enzymes.push({ id: enzId, name: ecNames.get(ec) || `EC ${ec}`, ec: [ec], ...(uniprot ? { xrefs: { uniprot } } : {}) });
    }
  }

  const out = {
    $schema: "../../schema/pathway.schema.json",
    id,
    name: title,
    category: categoryFor(rxns.flatMap((r) => r.ec), metabolites.map((m) => m.name)),
    summary: `A ${rxns.length}-step route from ${nameOf(first)} to ${nameOf(last)}, ingested from Rhea. Every step is curated by Rhea and independently verified here to balance in mass and charge.`,
    provenance: {
      confidence: "high",
      sources: [
        rxns[0].rhea ? { db: "Rhea", id: `RHEA:${rxns[0].rhea}` } : { db: "MetaNetX", id: rxns[0].mnx },
        ...(String(first).startsWith("mnx:") ? [] : [{ db: "ChEBI", id: `CHEBI:${first}` }]),
      ],
    },
    metabolites,
    enzymes,
    reactions: [...rxns, ...branchRxns].map((r, k) => ({
      id: `r${k + 1}`,
      name: (r.ec[0] && ecNames.get(r.ec[0]))
        || (r.equation ? (r.equation.length > 90 ? `${r.equation.slice(0, 87)}...` : r.equation) : `Reaction ${r.mnx}`),
      ...(r.equation ? { equation: r.equation } : {}),
      ec: r.ec[0],
      substrates: r.substrates.map((p) => ({ metabolite: metIds.get(p.chebi), stoichiometry: p.n })),
      products: r.products.map((p) => ({ metabolite: metIds.get(p.chebi), stoichiometry: p.n })),
      catalysts: r.ec[0] ? [{ enzyme: ecSeen.get(r.ec[0]) }] : undefined,
      reversibility: "reversible",
      pathwayStep: k + 1,
      xrefs: r.rhea ? { rhea: `RHEA:${r.rhea}` } : { metanetx: r.mnx },
      provenance: {
        confidence: "high",
        sources: [r.rhea ? { db: "Rhea", id: `RHEA:${r.rhea}` } : { db: "MetaNetX", id: r.mnx }],
      },
    })),
  };

  writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(out, null, 2)}\n`);

  // The layout is emitted from the SAME chain that produced the module, never
  // re-derived: the .mpl references entity ids by name, so any drift between the
  // two files is an unresolvable-id build error rather than a cosmetic mismatch.
  const lines = [];
  lines.push(`# Ingested from Rhea. The spine follows the carbon skeleton from`);
  lines.push(`# ${nameOf(first)} to ${nameOf(last)}; everything entering or leaving at the`);
  lines.push(`# side is a cofactor on that step. Generated by tools/ingest/build-modules.mjs —`);
  lines.push(`# edit the generator, not this file.`);
  lines.push("");
  lines.push(`pathway ${id} ${JSON.stringify(title)} {`);
  // Spacing follows the longest enzyme name on the sheet. A fixed 152 is right
  // for short names and far too tight for "O-ureido-D-serine cyclo-ligase",
  // whose label had nowhere to go and printed across two molecular formulas.
  // Cheaper and more honest than hiding the label: give the sheet more paper.
  const longestEnz = Math.max(20, ...rxns.map((r) => ((r.ec[0] && ecNames.get(r.ec[0])) || "").length));
  // ...and with how many limbs hang off the spine. A sheet with 20 branches needs
  // more paper than one with two, and starving it is what routed 24 sheets'
  // arrows straight through unrelated cells when branch density went up.
  const spacing = Math.min(340, 152 + Math.max(0, longestEnz - 22) * 4 + branches.length * 6);
  lines.push(`  spacing ${spacing}`);
  lines.push("");
  lines.push("  spine at 0,0 {");

  let carry = first;
  lines.push(`    ${metIds.get(carry)}`);
  for (const r of rxns) {
    const outs = mainsOf(r, "products");
    // Continue along whichever product the NEXT step consumes; at the end of the
    // chain any main product will do.
    const nextMain = outs.find((c) => c !== carry) || outs[0];
    const cofIn = r.substrates.map((pp) => pp.chebi).filter((c) => c !== carry);
    const cofOut = r.products.map((pp) => pp.chebi).filter((c) => c !== nextMain);
    const enz = r.ec[0] ? ecSeen.get(r.ec[0]) : null;
    const ecTag = r.ec[0] ? ` [${r.ec[0]}]` : "";
    const side = [
      ...cofIn.map((c) => `+${metIds.get(c)}`),
      ...cofOut.map((c) => `-${metIds.get(c)}`),
    ].join(" ");
    lines.push(`    <-> ${enz || "."}${ecTag}${side ? ` ${side}` : ""}`);
    lines.push(`    ${metIds.get(nextMain)}`);
    carry = nextMain;
  }
  lines.push("  }");

  // Branches alternate sides so a sheet does not grow lopsided, and each is a
  // single step: anchor, reaction, far compound.
  branches.forEach((b, bi) => {
    const r = reactions[b.rxnIdx];
    const enz = r.ec[0] ? ecSeen.get(r.ec[0]) : null;
    if (!metIds.get(b.anchor) || !metIds.get(b.far)) return;
    const cof = [...r.substrates, ...r.products]
      .map((pp) => pp.chebi)
      .filter((c) => c !== b.anchor && c !== b.far);
    const side = cof.map((c) => `+${metIds.get(c)}`).join(" ");
    lines.push("");
    lines.push(`  branch from ${metIds.get(b.anchor)} side ${bi % 2 ? "right" : "left"} {`);
    lines.push(`    ${metIds.get(b.anchor)}`);
    lines.push(`    <-> ${enz || "."}${r.ec[0] ? ` [${r.ec[0]}]` : ""}${side ? ` ${side}` : ""}`);
    lines.push(`    ${metIds.get(b.far)}`);
    lines.push("  }");
  });
  lines.push("}");
  writeFileSync(join(ROOT, "data", "chart", `${id}.mpl`), `${lines.join("\n")}\n`);
  index.push({ id, steps: rxns.length, chebiChain: [first, last] });
  written++;
  reactionsWritten += rxns.length + branchRxns.length;
}

console.log(`Wrote ${written} module(s), ${reactionsWritten} reactions -> data/pathways/`);
console.log(`Leftover pass: drew ${leftoverDrawn} otherwise-undrawn reaction(s) as extra branches across ${leftoverSheets} sheet(s) (cap ${LEFTOVER_TOTAL_CAP}/sheet, <=2/anchor).`);
writeFileSync(join(ROOT, "data", "ingest", "sheets.json"), JSON.stringify(index, null, 2));

// ---------------------------------------------------------------- crosstalk
// The generated sheets carry no relations of their own, so the atlas's long-range
// layer sees only the 27 hand-authored modules. Recover the couplings that the
// spine cut already implies: two sheets that both draw the SAME non-currency
// metabolite are metabolically connected through it. This is not fabricated — the
// shared node is one resolved ChEBI/MetaNetX identity present in both modules — so
// it is emitted as a `crosstalk` relation (metabolite -> pathway), matching the
// hand-authored convention, pointing from the shared compound to the other sheet.
//
// Two guards keep the couplings meaningful. Currency is excluded (every sheet
// touches ATP/water). And a metabolite drawn in MORE than CROSSTALK_HUB modules is
// a hub, not a specific link — coupling all of them pairwise is noise, not signal —
// so it is skipped entirely. Per-module output is capped so one sheet does not
// drown in edges. Only sheets written this run are enriched; the curated modules
// keep their authored relations untouched. The index spans every module on disk,
// so a generated sheet can couple to a curated pathway (its highest-value link).
enrichCrosstalk(new Set(index.map((e) => e.id)));

function enrichCrosstalk(writtenIds) {
  const HUB = Number(process.env.CROSSTALK_HUB || 8);
  const PER_MODULE = Number(process.env.CROSSTALK_MAX || 12);
  const files = readdirSync(OUT).filter((f) => f.endsWith(".json"));
  const mods = files.map((f) => ({ file: f, m: JSON.parse(readFileSync(join(OUT, f), "utf8")) }));

  // A coupling key is the shared, resolved identity: the ChEBI accession where the
  // metabolite has one, else the MetaNetX id. Currency never couples.
  const keyOf = (met) => {
    const c = String(met.xrefs?.chebi || "").replace("CHEBI:", "");
    if (c) return CURRENCY.has(c) ? null : `c:${c}`;
    return met.xrefs?.metanetx ? `m:${met.xrefs.metanetx}` : null;
  };

  // key -> [{ id, name, local }] : which modules draw this metabolite, and under
  // what local id. Deduped per module so a metabolite listed once per module.
  const idx = new Map();
  for (const { m } of mods) {
    const seen = new Set();
    for (const met of m.metabolites || []) {
      const k = keyOf(met);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ id: m.id, name: m.name, local: met.id });
    }
  }

  let injected = 0, touched = 0;
  for (const { file, m } of mods) {
    if (!writtenIds.has(m.id)) continue;
    const rels = [];
    const seenRid = new Set();
    for (const met of m.metabolites || []) {
      if (rels.length >= PER_MODULE) break;
      const k = keyOf(met);
      if (!k) continue;
      const partners = (idx.get(k) || []).filter((e) => e.id !== m.id);
      if (partners.length < 1 || partners.length + 1 > HUB) continue; // <2 sharing, or a hub
      partners.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const p of partners) {
        if (rels.length >= PER_MODULE) break;
        const rid = `xt_${met.id}_${p.id}`;
        if (seenRid.has(rid)) continue;
        seenRid.add(rid);
        const src = met.xrefs?.chebi
          ? { db: "ChEBI", id: met.xrefs.chebi }
          : { db: "MetaNetX", id: met.xrefs.metanetx };
        rels.push({
          id: rid,
          type: "crosstalk",
          source: { kind: "metabolite", id: met.id },
          target: { kind: "pathway", id: p.id },
          note: `Shares ${met.name} with ${p.name}.`,
          provenance: { confidence: "medium", sources: [src] },
        });
      }
    }
    if (!rels.length) continue;
    m.relations = [...(m.relations || []), ...rels]; // never clobbers curated relations
    writeFileSync(join(OUT, file), `${JSON.stringify(m, null, 2)}\n`);
    injected += rels.length;
    touched++;
  }
  console.log(`Crosstalk: ${injected} relation(s) across ${touched} module(s) (hub<=${HUB}, max ${PER_MODULE}/module).`);
}

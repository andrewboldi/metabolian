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
import { chebiTable, loadReactions, conjugateMap, enzymeNames, CURRENCY } from "./corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "data", "pathways");

const MIN_SPINE = Number(process.env.MIN_SPINE || 4);   // shorter reads as a stub, not a pathway
const MAX_SPINE = Number(process.env.MAX_SPINE || 9);   // longer overflows a sheet
const MAX_SHEETS = Number(process.env.MAX_SHEETS || 120);

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
const { reactions } = loadReactions(chebi);

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

for (const chain of sheets) {
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

  // participants
  const metIds = new Map();
  const metabolites = [];
  for (const r of rxns) {
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
        xrefs: { chebi: `CHEBI:${p.chebi}` },
      });
    }
  }

  // one enzyme per distinct EC on the chain
  const enzymes = [];
  const ecSeen = new Map();
  for (const r of rxns) {
    for (const ec of r.ec) {
      if (ecSeen.has(ec)) continue;
      const enzId = `ec_${ec.replace(/\./g, "_")}`;
      ecSeen.set(ec, enzId);
      // schema: enzyme.ec is an ARRAY (an enzyme can carry several), while
      // reaction.ec is a single string. Easy to conflate; the validator catches it.
      enzymes.push({ id: enzId, name: ecNames.get(ec) || `EC ${ec}`, ec: [ec] });
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
      sources: [{ db: "Rhea", id: `RHEA:${rxns[0].rhea}` }, { db: "ChEBI", id: `CHEBI:${first}` }],
    },
    metabolites,
    enzymes,
    reactions: rxns.map((r, k) => ({
      id: `r${k + 1}`,
      name: (r.ec[0] && ecNames.get(r.ec[0])) || (r.equation.length > 90 ? `${r.equation.slice(0, 87)}...` : r.equation),
      equation: r.equation,
      ec: r.ec[0],
      substrates: r.substrates.map((p) => ({ metabolite: metIds.get(p.chebi), stoichiometry: p.n })),
      products: r.products.map((p) => ({ metabolite: metIds.get(p.chebi), stoichiometry: p.n })),
      catalysts: r.ec[0] ? [{ enzyme: ecSeen.get(r.ec[0]) }] : undefined,
      reversibility: "reversible",
      pathwayStep: k + 1,
      xrefs: { rhea: `RHEA:${r.rhea}` },
      provenance: { confidence: "high", sources: [{ db: "Rhea", id: `RHEA:${r.rhea}` }] },
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
  lines.push("  spacing 152");
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
    lines.push(`    <-> ${enz || "spontaneous"}${ecTag}${side ? ` ${side}` : ""}`);
    lines.push(`    ${metIds.get(nextMain)}`);
    carry = nextMain;
  }
  lines.push("  }");
  lines.push("}");
  writeFileSync(join(ROOT, "data", "chart", `${id}.mpl`), `${lines.join("\n")}\n`);
  index.push({ id, steps: rxns.length, chebiChain: [first, last] });
  written++;
  reactionsWritten += rxns.length;
}

console.log(`Wrote ${written} module(s), ${reactionsWritten} reactions -> data/pathways/`);
writeFileSync(join(ROOT, "data", "ingest", "sheets.json"), JSON.stringify(index, null, 2));

# The Metabolian schema

The data model is the foundation everything inherits. It lives in three synchronized files:

- `schema/pathway.schema.json` — JSON Schema (draft 2020-12), the source of truth. The validator enforces it.
- `schema/arrows.json` — the canonical arrow/edge-type registry: one authoritative visual + semantic definition per relationship.
- `schema/types.ts` — TypeScript mirror for the app and tooling.

## A pathway module

One file per pathway: `data/pathways/<id>.json`. Required top-level: `id`, `name`, `category`, `provenance`, `metabolites`, `enzymes`, `reactions`. Optional: `summary`, `description`, `organisms`, `tissues`, `keywords`, `references`, `compartments`, `genes`, `complexes`, `regulations`, `relations`.

### Entities
- **metabolite** — `id`, `name`, `formula`, `charge`, `class`, `roles`, `xrefs` (chebi/kegg/hmdb/pubchem/inchikey), `smiles`.
- **enzyme** — `id`, `name`, `gene`, `ec[]`, `cofactors`, `compartment`, `xrefs` (uniprot/alphafold/pdb). UniProt drives the 3D structure viewer.
- **gene**, **complex** (`subunits[]`), **compartment** (with GO id).

### Reactions
`substrates[]` / `products[]` (each `{metabolite, stoichiometry, compartment}`), `catalysts[]` (`{enzyme, role}`), `cofactors[]`, `reversibility` (reversible / irreversible / direction-forward / direction-reverse / unknown), `deltaGPrimeKjPerMol`, `kinetics[]` (Km/kcat with source), `rateLimiting`, `transport`, `xrefs` (kegg/rhea/reactome), and required `provenance`.

## The arrow taxonomy — "define an arrow for everything"

Every relationship is a typed, color-coded arrow. Two carriers:

- **`regulations[]`** — control edges. `type` ∈ activation, inhibition, allosteric-activation, allosteric-inhibition, competitive-inhibition, noncompetitive-inhibition, feedback-inhibition, feedforward-activation, phosphorylation, dephosphorylation, covalent-modification, hormonal-signal, transcriptional-activation, transcriptional-repression. Each has `regulator`, `target` (`{kind,id}`), `effect`, `mechanism`, `provenance`.
- **`relations[]`** — structural/organizational edges. `type` ∈ gene-encodes, complex-formation, isozyme, pathway-membership, crosstalk, microbiome-host, transport, electron-transfer, spontaneous.

Mass-flow and catalysis arrows (substrate, product, reversible, cofactor, catalysis) are **derived automatically** by the build from each reaction's substrates/products/catalysts/cofactors — you don't write them by hand.

The full registry (with each arrow's color token, line style, and arrowhead) is `schema/arrows.json`, surfaced live as the **grammar of metabolism** on the home page.

## Provenance & confidence

Every reaction and regulation carries `provenance`: `{ confidence, sources[], curator?, lastReviewed?, notes? }`. `confidence` ∈ `high` / `medium` / `low` / `hypothesis`. Each source is `{ db, id?, url? }` with `db` ∈ KEGG, Reactome, MetaCyc, Rhea, BRENDA, UniProt, ChEBI, HMDB, PDB, AlphaFold, PubMed, textbook, review, other.

## Merge semantics

`tools/build-graph.mjs` merges modules into one master graph. Nodes are deduplicated across modules by canonical cross-reference (metabolites by inchikey→chebi→kegg, enzymes by uniprot→gene, reactions by rhea→kegg). Global node ids are namespaced: `met:`, `enz:`, `rxn:`, `gene:`, `cpx:`, `pathway:`. Output: `master.json`, `index.json`, `glossary.json`, `search.json`, `pathways/<id>.json`.

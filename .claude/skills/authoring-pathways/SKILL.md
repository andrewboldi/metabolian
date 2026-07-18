---
name: authoring-pathways
description: Use when researching a metabolic domain and writing it as a Metabolian pathway module (data/pathways/<id>.json). Covers grounding in databases, the schema, defining arrows, provenance/confidence, and validation.
---

# Authoring a Metabolian pathway module

Your job: turn a metabolic domain into **one** valid, **citation-grounded** JSON module at `data/pathways/<id>.json` that passes `node tools/validate.mjs data/pathways/<id>.json`.

## The non-negotiable rule: ground everything

Metabolism is consequential — **never fabricate reactions, enzymes, or identifiers.** Every reaction and regulation must carry `provenance.sources` and an honest `confidence`:

- `high` — textbook / curated-DB consensus (KEGG, Reactome, MetaCyc).
- `medium` — well-supported primary literature.
- `low` — single source or preliminary.
- `hypothesis` — model-suggested, unverified. **Use this instead of guessing.** It is always better to mark low confidence than to invent a plausible-looking reaction.

Prefer these authoritative sources, and put their IDs in `xrefs` and `provenance.sources`:
KEGG (compound `C#####`, reaction `R#####`, pathway `map#####/hsa#####`), Reactome (`R-HSA-…`), Rhea, ChEBI, UniProt (enzymes), PDB + AlphaFold (structures, by UniProt accession), BRENDA (kinetics), HMDB, EC numbers.

Research tools available to you: the `paperclip` skill and the PubMed MCP for literature; `WebSearch`/`WebFetch` for database pages. Verify identifiers — don't invent KEGG/UniProt IDs.

## Steps

1. **Scope** one coherent domain (e.g. "urea cycle", "de novo purine synthesis", "ketogenesis"). Pick a stable kebab-case `id`. Don't overlap another agent's assigned module.
2. **Read the gold standard:** `data/pathways/glycolysis.json`. Match its shape exactly.
3. **Read the schema:** `schema/pathway.schema.json` and the arrow registry `schema/arrows.json`. Every relationship you draw must be one of the registry's arrow types.
4. **Collect entities** — metabolites (formula, charge, class, `xrefs`: chebi/kegg), enzymes (gene, `ec`, `xrefs`: uniprot for AlphaFold/structure, pdb), compartments.
5. **Write reactions** — substrates/products with stoichiometry + compartment, catalysts (enzyme id + role), cofactors, `reversibility`, KEGG/Rhea `xrefs`, `provenance`. Mark `rateLimiting` on committed steps.
6. **Write regulations** — use `regulations[]` for control edges (activation, inhibition, allosteric-*, feedback-inhibition, feedforward-activation, phosphorylation, transcriptional-*). Each has `regulator`, `target` (as `{kind,id}`), `effect`, `mechanism`, `provenance`.
7. **Write relations** — use `relations[]` for structural/organizational edges (`gene-encodes`, `complex-formation`, `isozyme`, `crosstalk`, `microbiome-host`). For links to another pathway, target `{kind:"pathway", id:"<other-module-id>"}` — do **not** edit the other file.
8. **Validate** — `node tools/validate.mjs data/pathways/<id>.json`. Fix every error (schema + referential integrity: every referenced id must exist in your module).

## Common mistakes

- Referencing a metabolite/enzyme id in a reaction that isn't in `metabolites`/`enzymes` → referential-integrity error.
- Putting a control edge in `relations` (it belongs in `regulations`) or vice-versa.
- Inventing UniProt/KEGG IDs. If you can't verify one, omit the xref rather than guess; keep the reaction with lower confidence.
- Forgetting `provenance` on a reaction (required) or on a regulation (required).
- Editing another module's file. One file per pathway — crosstalk is expressed by pointing at a pathway id.

## Return

When done: the filename you wrote, counts (metabolites/enzymes/reactions/regulations), overall confidence, and any reactions you marked `hypothesis` or couldn't fully verify (so a reviewer can check them).

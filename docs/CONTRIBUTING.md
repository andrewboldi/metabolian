# Contributing to Metabolian

## Author a pathway (data)

1. Read `data/pathways/glycolysis.json` (the gold-standard example) and `docs/SCHEMA.md`.
2. Create `data/pathways/<your-id>.json`. One pathway per file — this keeps parallel authoring conflict-free.
3. **Ground every reaction** in a source (KEGG/Reactome/Rhea/UniProt/ChEBI/PubMed). Fill `xrefs` and `provenance.sources`, set an honest `confidence`. Mark unverified items `hypothesis` rather than guessing.
4. Validate just your file: `node tools/validate.mjs data/pathways/<your-id>.json`. Fix all errors.
5. Rebuild the graph and open the app to see it: `npm run data:build && npm run dev`.

## Change the app (code)

- Follow `.claude/skills/metabolian-web/SKILL.md`: MPA structure, design tokens, per-page code splitting, reduced-motion, accessibility.
- `npm run build` must pass. Keep Lighthouse high.

## Quality gates

Run before opening a PR:
```bash
npm run data:validate
npm run lint
npm run build
```
CI runs the same, plus CodeQL. Dependabot keeps dependencies current.

## Issue tracking

This repo uses **beads** (`bd`) alongside GitHub Issues. Create an issue before non-trivial work and close it when done. See the beads section in `CLAUDE.md`.

## Ground rules

- Never fabricate biochemistry. Provenance + confidence on every reaction and regulation.
- Don't edit another pathway's file; express cross-pathway links with a `relations` entry of type `crosstalk`.
- New relationship type → add it to `schema/arrows.json` and the schema enum first.

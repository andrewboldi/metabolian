<div align="center">

# Metabolian

**A living, interactive, citation-grounded successor to the Roche Biochemical Pathways chart.**

Explore metabolism as a graph — every reaction, enzyme, regulator, and protein structure, with the source it came from and an honest confidence level you can audit.

[Live site](https://andrewboldi.github.io/metabolian/) · [Explore the chart](https://andrewboldi.github.io/metabolian/explore.html) · [Method](https://andrewboldi.github.io/metabolian/about.html) · [Original vision](docs/VISION.md)

</div>

---

## What this is

In the 1960s Gerhard Michal drew metabolism by hand for Boehringer/Roche — the legendary *Biochemical Pathways* wall chart. Metabolian rebuilds that idea for today: an open dataset of metabolic pathways in a strict, typed schema, merged into one master graph and rendered as an interactive web atlas.

The premise is simple: **a chart is only as good as its arrows.** Metabolian defines a distinct, color-coded arrow for every relationship in metabolism — substrate/product, catalysis, cofactor use, activation and every flavor of inhibition, allostery, feedback, covalent modification, transport, transcriptional control, and cross-pathway talk — so a glance tells you what's happening.

### Principles

- **Grounded, not guessed.** Every reaction and regulatory edge carries provenance (KEGG, Reactome, Rhea, UniProt, ChEBI, or a paper) and an explicit confidence level (`high` / `medium` / `low` / `hypothesis`). Nothing is presented as fact without a source.
- **Auditable.** The data is plain JSON, validated in CI against a published schema with referential-integrity checks. You can read, diff, and challenge any of it.
- **Not medical advice.** Metabolian is an educational and research aggregation, not a clinical reference.

## Repository layout

```
schema/            The data model — the foundation everything inherits
  pathway.schema.json   JSON Schema (draft 2020-12) for one pathway module
  arrows.json           Canonical arrow/edge-type registry (visual + semantic)
  types.ts              TypeScript mirror of the schema
data/pathways/     One JSON file per pathway module (conflict-free authoring)
tools/             Node build pipeline
  validate.mjs          Schema + referential-integrity validation
  build-graph.mjs       Merge modules → master graph, glossary, search index
web/               Vite multi-page app (the interactive atlas)
  src/lib/              Shared: layout, theme, graph arrows, hero animation
  src/pages/            One entry per page (home, explore, glossary, …)
docs/              Vision, schema docs, contributing
```

## Quick start

```bash
npm install
npm run data:validate   # validate every pathway module
npm run data:build      # merge modules into web/public/graph/*
npm run dev             # local dev server
npm run build           # production build → dist/
```

## Authoring a pathway

Every pathway is one file: `data/pathways/<id>.json`, conforming to `schema/pathway.schema.json`. Use `data/pathways/glycolysis.json` as the reference example. Ground each reaction in a database ID, cite it in `provenance.sources`, set an honest `confidence`, and run `node tools/validate.mjs data/pathways/<id>.json` before committing. See [docs/SCHEMA.md](docs/SCHEMA.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Tech

TypeScript · Vite (multi-page, per-route code splitting) · Cytoscape.js (WebGL graph) · 3Dmol.js (AlphaFold/PDB structures) · Three.js + GSAP (ambient motion, reduced-motion respected) · GitHub Actions → GitHub Pages · Dependabot + CodeQL.

## License

MIT. Pathway data links to and cites third-party databases; those retain their own terms.

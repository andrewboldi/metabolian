# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## What Metabolian is

An open, interactive, **citation-grounded** successor to the Roche Biochemical Pathways chart. Pathways live as typed JSON modules, are merged into one master graph, and are rendered as a Vite multi-page web atlas deployed to GitHub Pages. Original project vision: `docs/VISION.md`.

## Build & Test

```bash
npm install
npm run data:validate     # validate every data/pathways/*.json (schema + referential integrity)
npm run data:build        # merge modules → web/public/graph/{master,index,glossary,search,arrows}.json + per-pathway subgraphs
npm run dev               # local dev (predev runs data:build)
npm run build             # prebuild validates + builds data, then vite build → dist/
npm run typecheck         # tsc --noEmit
npm run lint              # eslint (flat config; warnings don't fail)
node tools/validate.mjs data/pathways/<id>.json   # validate ONE module (use while authoring)
```
Quality gate before committing code: `npm run data:validate && npm run build`. The Rust crate (`Cargo.toml`, `src/`) is reserved for a future WASM graph-layout kernel.

## Architecture Overview

- **`schema/`** — the foundation everything inherits. `pathway.schema.json` (draft 2020-12), `arrows.json` (the canonical arrow/edge-type registry — one authoritative visual + semantic definition per relationship, consumed by BOTH the validator legend and the graph renderer), `types.ts` (TS mirror).
- **`data/pathways/*.json`** — one module per file. **This is why authoring is conflict-free** — parallel authors never touch the same file. Each module self-contains its metabolites/enzymes/reactions/regulations; the build dedupes shared entities across modules by cross-reference IDs.
- **`tools/`** — `validate.mjs` (Ajv 2020 + referential integrity), `build-graph.mjs` (merge → master graph, glossary, search index, per-pathway subgraphs; namespaced node ids `met:/enz:/rxn:/gene:/cpx:/pathway:`).
- **`web/`** — Vite MPA. Each page is its own HTML + `src/pages/<name>.ts` entry so heavy libs (cytoscape, three, 3dmol) load only where used. Shared chrome in `src/lib/layout.ts`; design tokens in `src/styles/tokens.css` (edge color tokens mirror `arrows.json`).
- **`.github/`** — `deploy.yml` (Pages), `ci.yml` (validate/lint/typecheck/build), `codeql.yml`, `dependabot.yml`.

## Conventions & Patterns

- **Never fabricate biochemistry.** Every reaction and regulation needs `provenance.sources` (KEGG/Reactome/Rhea/UniProt/ChEBI/PubMed/textbook) and an honest `confidence` (`high`/`medium`/`low`/`hypothesis`). Prefer curating from authoritative DBs over free-form generation. When unsure, mark it `hypothesis`, don't guess silently.
- **Author against the schema, validate before commit.** Copy `data/pathways/glycolysis.json` as the gold-standard example. Reaction/entity local ids are kebab/snake, unique within the module.
- **One file per pathway** — keeps parallel work conflict-free. Do not edit another module's file to add crosstalk; use a `relations` entry of type `crosstalk` pointing at the other pathway's id.
- **The arrow registry is law.** New relationship type → add it to `schema/arrows.json` (with color token + line + head) AND the schema enum, never hardcode edge styling elsewhere.
- **Web:** vanilla TS, no framework. Lean per-page bundles; dynamic-import heavy libs; respect `prefers-reduced-motion`; keep Lighthouse high. Reference `file_path:line`.
- **Track everything in beads.** Create an issue before non-trivial work; close on completion. See the beads section above.

## Subagent skills

Reusable skills for agents live in `.claude/skills/`: `authoring-pathways` (how to research + write a valid, grounded module) and `metabolian-web` (UI conventions). Read the relevant one before doing that kind of work.

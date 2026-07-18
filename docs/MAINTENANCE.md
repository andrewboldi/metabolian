# Maintenance & the project lifecycle

Metabolian is designed to keep improving without stalling. The lifecycle has three durable loops plus a work queue.

## 1. Detection (runs forever on GitHub, no babysitting)

- **Dependabot** (`.github/dependabot.yml`) — weekly PRs for npm, GitHub Actions, and Cargo dependencies, grouped to reduce noise.
- **CodeQL** (`.github/workflows/codeql.yml`) — security analysis on every push/PR and weekly.
- **Health check** (`.github/workflows/health.yml`) — daily: validates all pathway data, runs tests, builds the site, audits dependencies, and **automatically opens a GitHub issue** (label `health`) if anything breaks. This is the "problem-hunting" loop — it never sleeps.
- **CI** (`.github/workflows/ci.yml`) — on every push/PR: schema + referential-integrity validation, unit tests, lint, typecheck, build. Bad data or a broken build can't reach `main`.

## 2. Work queue

Two synchronized backlogs:

- **beads** (`bd ready`, `bd list`) — epics per workstream plus a filed backlog of 35 expert-sourced feature ideas, each with effort/impact.
- **GitHub Issues** — anything the health check or a reviewer files.

## 3. Implementation loop

For each ready item:

1. `bd update <id> --claim` (or pick a GitHub issue).
2. Branch, implement, follow `.claude/skills/*` conventions.
3. `npm run data:validate && npm test && npm run build` must pass.
4. Open a PR. CI + CodeQL gate it. Merge to `main` → auto-deploys to Pages.
5. `bd close <id>`.

### Fully-autonomous option (opt-in)

To have an agent implement labeled issues automatically, add the Claude Code GitHub Action with an `ANTHROPIC_API_KEY` repo secret and a workflow that triggers on an `agent-fix` label. It is intentionally **not** enabled by default: autonomous code-writing on a public repo costs tokens and should merge via PR review, never straight to `main`. The detection loops above already run free and forever; this only automates the implementation step.

## Data integrity rules (enforced)

- Every reaction and regulation carries `provenance.sources` + `confidence` — the validator and reviewers reject fabricated biochemistry.
- One pathway per file keeps authoring conflict-free.
- New relationship type → add it to `schema/arrows.json` and the schema enum first.

## Release = deploy

`main` is always deployable. Pushing to `main` runs `deploy.yml` → GitHub Pages. The live site is the source of truth for what's shipped.

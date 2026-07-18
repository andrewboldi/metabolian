---
name: metabolian-web
description: Use when building or changing the Metabolian web app (web/). Covers the MPA structure, design tokens, per-page code splitting, accessibility, and performance conventions.
---

# Metabolian web conventions

Vanilla TypeScript, Vite multi-page app. No framework. Deployed to GitHub Pages at base `/metabolian/`.

## Structure

- One route = one `web/<name>.html` + one `web/src/pages/<name>.ts` entry, registered in `vite.config.ts` `rollupOptions.input`.
- Every page: `mountChrome("<activeNavId>")` from `src/lib/layout.ts` injects the shared header/footer into `#app-header` / `#app-footer`.
- Shared helpers: `src/lib/util.ts` (`el()` DOM factory, `getJSON()`, `asset()` base-aware paths, `xrefUrl()`), `src/lib/theme.ts`, `src/lib/arrows.ts` (arrow registry + SVG).
- Graph data is loaded at runtime from `graph/*.json` via `getJSON()` — never import it at build time.

## Design system

- Tokens in `src/styles/tokens.css`. **Edge color tokens mirror `schema/arrows.json`** (`--edge-catalysis`, `--edge-inhibit`, …); node tokens are `--node-*`. Use tokens, never raw hex, in component CSS.
- Aesthetic: "Assay" — luminous teal accent (`--accent`) on deep microscopy-field ink (dark) / cool cellular plate (light). Theme-aware via `data-theme`; both themes must look intentional.
- Scientific identifiers (EC/KEGG/UniProt/formula) render as monospace `.chip` "specimen labels".
- Type: display `--font-display` (Space Grotesk), body `--font-body` (Inter), mono `--font-mono` (JetBrains Mono).

## Performance & a11y (these are requirements, not nice-to-haves)

- **Code-split heavy libs.** `cytoscape`, `three`, `3dmol`, `gsap` must be `await import()`ed inside the page that needs them, never top-level on a light page. Keep home/content pages tiny.
- **Respect `prefers-reduced-motion`** everywhere — gate all animation on it.
- Defer non-critical work (hero animation) to `requestIdleCallback` so it never blocks LCP.
- Keyboard focus visible (`:focus-visible`), skip link, semantic landmarks, `aria-*` on interactive controls, alt/aria-hidden on decorative SVG.
- Every page needs `<title>`, `<meta name="description">`, favicon, `color-scheme`.

## Verify before claiming done

`npm run build` must pass. Prefer checking the live/preview page (`npm run preview` serves at `/metabolian/`). Run Lighthouse and keep scores high; investigate regressions rather than suppressing warnings.

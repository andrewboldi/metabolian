// Render a solid 2D skeletal-structure SVG for every metabolite that has a SMILES,
// using RDKit MinimalLib in Node at build time. Output: web/public/mol/<key>.svg
// (transparent background, currentColor-friendly) plus mol/index.json.
//
// Structures are generated at build time so the client ships static vector art —
// no runtime chemistry toolkit, no layout cost.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { inkExtent } from "./lib/manhattan.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(ROOT, "data", "smiles.json");

/** Above this heavy-atom count a species is a peptide/protein: name it, don't draw it. */
const MACROMOLECULE_ATOMS = 120;
const OUT = join(ROOT, "web", "public", "mol");

const require = createRequire(join(ROOT, "package.json"));
const initRDKit = require("@rdkit/rdkit/dist/RDKit_minimal.js");

/** Filesystem-safe id for a metabolite cache key like "chebi:15361". */
export function safeKey(key) {
  return key.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/**
 * RDKit emits an opaque white background and fixed black ink. Strip the
 * background so structures sit on the chart, and let stroke colour inherit.
 */
export function cleanSvg(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Collapse whitespace BEFORE matching tags. RDKit emits the ground rect as
    // `<rect …>\n</rect>`, so every rule below that expected `></rect>` silently
    // missed while looking correct in isolation — which is exactly how the rect
    // survived on all 321 files through an earlier "fix".
    .replace(/\s*\n\s*/g, " ")
    .replace(/>\s+</g, "><")
    // RDKit paints an opaque white ground rect behind every depiction. These two
    // rules only matched a self-closing tag, but RDKit emits `></rect>` — so the
    // rect survived on all 321 files: dead bytes, and an opaque box inside every
    // cell that hides whatever the sheet draws behind the molecule.
    .replace(/<rect\b[^>]*fill=['"]#FFFFFF['"][^>]*(?:\/>|><\/rect>)/gi, "")
    .replace(/<rect\b[^>]*style=['"][^'"]*fill:#FFFFFF[^'"]*['"][^>]*(?:\/>|><\/rect>)/gi, "")
    // Namespaces and hints no consumer reads. The rdkit/xlink namespaces, the
    // profile and the whitespace hint are pure overhead once the markup is inlined
    // into the chart's own <svg>. The bond-/atom- classes are deliberately KEPT:
    // they are the only handle for highlighting a reacting centre later.
    .replace(/\s+xmlns:(?:rdkit|xlink)=['"][^'"]*['"]/g, "")
    .replace(/\s+(?:baseProfile|version)=['"][^'"]*['"]/g, "")
    .replace(/\s+xml:space=['"][^'"]*['"]/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

async function main() {
  if (!existsSync(CACHE)) {
    console.error("No data/smiles.json — run `node tools/fetch-smiles.mjs` first.");
    process.exit(1);
  }
  const cache = JSON.parse(readFileSync(CACHE, "utf8"));
  const RDKit = await initRDKit();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const index = {};
  let ok = 0, skipped = 0, failed = 0, macro = 0;

  for (const [key, entry] of Object.entries(cache)) {
    if (!entry?.smiles) { skipped++; continue; }

    // Peptides and proteins get NO skeletal depiction. Drawing insulin's 404
    // heavy atoms produced a 267KB file of 1172 paths that renders as an
    // illegible black scribble at cell size — and the poster never draws a
    // hormone's backbone, it names it. Cells without a depiction fall back to
    // the name-only form, which is both faster and the higher-fidelity result.
    // Margin is wide: insulin 404 and glucagon 246 are the only entries above
    // 100; the largest genuine metabolite (a bile-acid CoA conjugate) is 80.
    const heavyAtoms = (entry.smiles.match(/[A-Z]/g) || []).length;
    if (heavyAtoms > MACROMOLECULE_ATOMS) { macro++; continue; }

    let mol;
    try {
      mol = RDKit.get_mol(entry.smiles);
      if (!mol || !mol.is_valid()) { failed++; mol?.delete(); continue; }
      // Size scales a little with molecule complexity so big molecules stay legible.
      const heavy = heavyAtoms;
      const w = Math.min(420, Math.max(150, 90 + heavy * 7));
      const h = Math.round(w * 0.8);
      const svg = cleanSvg(mol.get_svg(w, h));
      const file = `${safeKey(key)}.svg`;
      writeFileSync(join(OUT, file), svg);
      // RDKit pads its canvas generously; record the true ink box so a cell can
      // be sized and cropped to the molecule rather than to that padding.
      const ink = inkExtent(svg);
      index[key] = { file, name: entry.name, w, h, ink: ink ? { x: ink.x, y: ink.y, w: ink.w, h: ink.h } : null };
      ok++;
    } catch {
      failed++;
    } finally {
      mol?.delete();
    }
  }

  writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
  console.log(`Rendered ${ok} molecule SVGs (${skipped} without SMILES, ${macro} macromolecules named not drawn, ${failed} failed) -> web/public/mol/`);
}

main();

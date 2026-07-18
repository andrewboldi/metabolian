// Render a solid 2D skeletal-structure SVG for every metabolite that has a SMILES,
// using RDKit MinimalLib in Node at build time. Output: web/public/mol/<key>.svg
// (transparent background, currentColor-friendly) plus mol/index.json.
//
// Structures are generated at build time so the client ships static vector art —
// no runtime chemistry toolkit, no layout cost.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(ROOT, "data", "smiles.json");
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
    .replace(/<rect[^>]*fill=['"]#FFFFFF['"][^>]*\/>/gi, "")
    .replace(/<rect[^>]*style=['"][^'"]*fill:#FFFFFF[^'"]*['"][^>]*\/>/gi, "")
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
  let ok = 0, skipped = 0, failed = 0;

  for (const [key, entry] of Object.entries(cache)) {
    if (!entry?.smiles) { skipped++; continue; }
    let mol;
    try {
      mol = RDKit.get_mol(entry.smiles);
      if (!mol || !mol.is_valid()) { failed++; mol?.delete(); continue; }
      // Size scales a little with molecule complexity so big molecules stay legible.
      const heavy = (entry.smiles.match(/[A-Z]/g) || []).length;
      const w = Math.min(420, Math.max(150, 90 + heavy * 7));
      const h = Math.round(w * 0.8);
      const svg = cleanSvg(mol.get_svg(w, h));
      const file = `${safeKey(key)}.svg`;
      writeFileSync(join(OUT, file), svg);
      index[key] = { file, name: entry.name, w, h };
      ok++;
    } catch {
      failed++;
    } finally {
      mol?.delete();
    }
  }

  writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
  console.log(`Rendered ${ok} molecule SVGs (${skipped} without SMILES, ${failed} failed) -> web/public/mol/`);
}

main();

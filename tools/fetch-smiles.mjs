// Resolve a SMILES string for every metabolite in the atlas and cache it to
// data/smiles.json (committed) so molecule rendering is reproducible and offline.
// Resolution order: existing module `smiles` -> PubChem by name -> PubChem by
// InChIKey. Unresolved entries are recorded so they can be curated by hand.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "data", "pathways");
const CACHE = join(ROOT, "data", "smiles.json");

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

import { metKey } from "./lib/metkey.mjs";
export { metKey };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pubchem(path) {
  const res = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function pickSmiles(json) {
  const p = json?.PropertyTable?.Properties?.[0];
  if (!p) return null;
  return p.IsomericSMILES || p.CanonicalSMILES || p.ConnectivitySMILES || null;
}

async function resolve(m) {
  // 1) authored in the module
  if (m.smiles) return { smiles: m.smiles, source: "module" };

  const x = m.xrefs || {};
  const props = "property/IsomericSMILES,CanonicalSMILES/JSON";

  // 2) by InChIKey (most precise)
  if (x.inchikey) {
    const j = await pubchem(`compound/inchikey/${encodeURIComponent(x.inchikey)}/${props}`);
    const s = pickSmiles(j);
    if (s) return { smiles: s, source: "pubchem:inchikey" };
    await sleep(220);
  }

  // 3) by name, trying a couple of light normalizations
  // Names are often "Formal name (common synonym)" — try the bare name, the
  // parenthetical synonym on its own, and any declared synonyms.
  const paren = [...m.name.matchAll(/\(([^)]+)\)/g)].map((x) => x[1].trim());
  const variants = [
    m.name,
    m.name.replace(/\s*\(.*?\)\s*/g, " ").trim(),
    ...paren,
    ...(m.synonyms || []),
  ].filter(Boolean).filter((v, i, a) => v.length > 2 && a.indexOf(v) === i);
  for (const v of variants) {
    const j = await pubchem(`compound/name/${encodeURIComponent(v)}/${props}`);
    const s = pickSmiles(j);
    if (s) return { smiles: s, source: `pubchem:name(${v})` };
    await sleep(220);
  }
  return null;
}

const metabolites = new Map();
for (const f of readdirSync(DATA).filter((f) => f.endsWith(".json"))) {
  const mod = JSON.parse(readFileSync(join(DATA, f), "utf8"));
  for (const m of mod.metabolites || []) {
    const k = metKey(m);
    if (!metabolites.has(k)) metabolites.set(k, m);
  }
}

const RETRY = process.env.RETRY_UNRESOLVED === "1";
const todo = [...metabolites.entries()].filter(([k]) => !cache[k] || (!cache[k].smiles && (RETRY || !cache[k].unresolved)));
console.log(`${metabolites.size} unique metabolites; ${todo.length} to resolve; ${Object.keys(cache).length} cached.`);

let ok = 0, fail = 0, n = 0;
for (const [key, m] of todo) {
  n++;
  try {
    const r = await resolve(m);
    if (r?.smiles) { cache[key] = { name: m.name, smiles: r.smiles, source: r.source }; ok++; }
    else { cache[key] = { name: m.name, unresolved: true }; fail++; }
  } catch (e) {
    cache[key] = { name: m.name, unresolved: true, error: String(e).slice(0, 80) };
    fail++;
  }
  if (n % 25 === 0) {
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    console.log(`  ${n}/${todo.length} … resolved=${ok} unresolved=${fail}`);
  }
  await sleep(160);
}

writeFileSync(CACHE, JSON.stringify(cache, null, 1));
const total = Object.values(cache).filter((v) => v.smiles).length;
console.log(`Done. resolved=${ok} unresolved=${fail}. Cache now holds ${total}/${Object.keys(cache).length} with SMILES.`);

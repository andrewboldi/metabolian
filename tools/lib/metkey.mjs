/** Stable cache key for a metabolite: prefer a database id, fall back to the name. */
export function metKey(m) {
  const x = m.xrefs || {};
  if (x.chebi) return `chebi:${String(x.chebi).replace(/^CHEBI:/i, "")}`;
  if (x.kegg) return `kegg:${x.kegg}`;
  if (x.inchikey) return `inchikey:${x.inchikey}`;
  return `name:${m.name.toLowerCase().trim()}`;
}

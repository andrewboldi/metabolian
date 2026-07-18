// Small shared helpers. No framework — just typed DOM + fetch with base-path awareness.

export const BASE = import.meta.env.BASE_URL || "/";

/** Resolve an app-relative asset path against the deployment base. */
export function asset(path: string): string {
  return (BASE + path.replace(/^\//, "")).replace(/\/{2,}/g, "/");
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
/** Terse element factory: el("div.card", { id: "x" }, [child, "text"]) */
export function el(tag: string, attrs: Attrs = {}, children: (Node | string)[] = []): HTMLElement {
  const [name, ...classes] = tag.split(".");
  const node = document.createElement(name || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "html") node.innerHTML = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

export function qs<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Build an external database URL for a cross-reference. */
export function xrefUrl(db: string, id: string): string | null {
  const v = encodeURIComponent(id.replace(/^\w+:/, ""));
  switch (db) {
    case "kegg": return `https://www.kegg.jp/entry/${v}`;
    case "chebi": return `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${id}`;
    case "uniprot": return `https://www.uniprot.org/uniprotkb/${v}/entry`;
    case "alphafold": return `https://alphafold.ebi.ac.uk/entry/${v}`;
    case "pdb": return `https://www.rcsb.org/structure/${v}`;
    case "rhea": return `https://www.rhea-db.org/rhea/${v}`;
    case "reactome": return `https://reactome.org/content/detail/${v}`;
    case "hmdb": return `https://hmdb.ca/metabolites/${v}`;
    case "pubchem": return `https://pubchem.ncbi.nlm.nih.gov/compound/${v}`;
    case "ensembl": return `https://www.ensembl.org/id/${v}`;
    case "brenda": return `https://www.brenda-enzymes.org/enzyme.php?ecno=${v}`;
    default: return null;
  }
}

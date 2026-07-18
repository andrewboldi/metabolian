import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/page.css";
import { mountChrome } from "../lib/layout";
import { el } from "../lib/util";

mountChrome("");

const params = new URLSearchParams(location.search);
let viewer: any = null;
let currentStyle = "cartoon";

function status(msg: string) {
  const s = document.getElementById("viewer-status");
  if (s) s.textContent = msg;
}

async function ensureViewer() {
  if (viewer) return viewer;
  const $3Dmol = await import("3dmol");
  const host = document.getElementById("viewport")!;
  viewer = ($3Dmol as any).createViewer(host, { backgroundColor: "0x00000000", backgroundAlpha: 0 });
  return viewer;
}

async function loadStructure(source: { kind: "alphafold" | "pdb"; id: string }) {
  status(`Fetching ${source.kind === "alphafold" ? "AlphaFold model" : "PDB " + source.id}…`);
  const url = source.kind === "alphafold"
    ? `https://alphafold.ebi.ac.uk/files/AF-${source.id}-F1-model_v4.pdb`
    : `https://files.rcsb.org/download/${source.id}.pdb`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const pdb = await res.text();
    const v = await ensureViewer();
    v.clear();
    v.addModel(pdb, "pdb");
    applyStyle(currentStyle);
    v.zoomTo();
    v.render();
    v.zoom(1.15, 800);
    status("");
    document.getElementById("viewport")!.dataset.loaded = "true";
    setMeta(source);
  } catch (e) {
    status(`Could not load ${source.id} (${(e as Error).message}). Try another accession.`);
  }
}

function applyStyle(style: string) {
  if (!viewer) return;
  currentStyle = style;
  const spectrum = { color: "spectrum" };
  const styles: Record<string, any> = {
    cartoon: { cartoon: { ...spectrum } },
    stick: { stick: { radius: 0.15, ...spectrum } },
    sphere: { sphere: { scale: 0.28, ...spectrum } },
    surface: { cartoon: { ...spectrum } },
  };
  viewer.setStyle({}, styles[style] || styles.cartoon);
  if (style === "surface") viewer.addSurface("VDW", { opacity: 0.72, color: "white" });
  else viewer.removeAllSurfaces?.();
  viewer.render();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rep]")) b.setAttribute("aria-pressed", String(b.dataset.rep === style));
}

function setMeta(source: { kind: string; id: string }) {
  const name = params.get("name") || source.id;
  document.getElementById("prot-name")!.textContent = name;
  const links = document.getElementById("prot-links")!;
  links.replaceChildren();
  const uni = params.get("uniprot");
  if (uni) links.append(el("a.chip", { href: `https://www.uniprot.org/uniprotkb/${uni}/entry`, target: "_blank", rel: "noopener" }, [`UniProt ${uni}`]));
  if (uni) links.append(el("a.chip", { href: `https://alphafold.ebi.ac.uk/entry/${uni}`, target: "_blank", rel: "noopener" }, ["AlphaFold DB"]));
  const pdb = params.get("pdb");
  if (pdb) links.append(el("a.chip", { href: `https://www.rcsb.org/structure/${pdb}`, target: "_blank", rel: "noopener" }, [`PDB ${pdb}`]));
}

function wire() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rep]")) b.addEventListener("click", () => applyStyle(b.dataset.rep!));
  const form = document.getElementById("load-form") as HTMLFormElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const acc = (document.getElementById("acc-input") as HTMLInputElement).value.trim();
    if (!acc) return;
    if (/^\d[A-Za-z0-9]{3}$/.test(acc)) loadStructure({ kind: "pdb", id: acc.toUpperCase() });
    else loadStructure({ kind: "alphafold", id: acc.toUpperCase() });
  });
}

wire();
const uniprot = params.get("uniprot");
const pdb = params.get("pdb");
if (uniprot) loadStructure({ kind: "alphafold", id: uniprot });
else if (pdb) loadStructure({ kind: "pdb", id: pdb });
else status("Enter a UniProt accession (e.g. P04406) or a 4-character PDB ID (e.g. 1HKB) to load a structure.");

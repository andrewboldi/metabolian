// Shared 3D structure loading: resolve the current AlphaFold model URL from the
// prediction API (version-proof) or fall back to the RCSB PDB, and render into a
// container with 3Dmol. Used by both the protein page and the inline chart inspector.

export async function alphaFoldUrl(acc: string): Promise<string> {
  try {
    const r = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${acc}`);
    if (r.ok) {
      const j = await r.json();
      if (j?.[0]?.pdbUrl) return j[0].pdbUrl as string;
    }
  } catch { /* fall through */ }
  return `https://alphafold.ebi.ac.uk/files/AF-${acc}-F1-model_v6.pdb`;
}

export interface StructureRef { uniprot?: string | null; pdb?: string | null; }

/** Load a structure into `host`. Returns the viewer, or null if nothing could be loaded. */
export async function renderStructure(host: HTMLElement, ref: StructureRef, onStatus?: (m: string) => void): Promise<any | null> {
  const src = ref.uniprot
    ? { kind: "alphafold" as const, id: ref.uniprot }
    : ref.pdb ? { kind: "pdb" as const, id: ref.pdb } : null;
  if (!src) { onStatus?.("No structure reference for this enzyme."); return null; }

  onStatus?.(src.kind === "alphafold" ? "Fetching AlphaFold model…" : `Fetching PDB ${src.id}…`);
  const url = src.kind === "alphafold" ? await alphaFoldUrl(src.id) : `https://files.rcsb.org/download/${src.id}.pdb`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const pdb = await res.text();
    const $3Dmol: any = await import("3dmol");
    host.replaceChildren();
    const viewer = ($3Dmol as any).createViewer(host, { backgroundColor: "0x0b0f14" });
    viewer.addModel(pdb, "pdb");
    viewer.setStyle({}, { cartoon: { color: "spectrum" } });
    viewer.zoomTo();
    viewer.render();
    onStatus?.("");
    return viewer;
  } catch (e) {
    onStatus?.(`Could not load structure (${(e as Error).message}).`);
    return null;
  }
}

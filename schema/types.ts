// Metabolian data model — TypeScript mirror of schema/pathway.schema.json.
// Shared by the build tooling (tools/) and the web app (web/). Keep in sync with the JSON Schema.

export type Confidence = "high" | "medium" | "low" | "hypothesis";

export type EntityKind =
  | "metabolite" | "enzyme" | "complex" | "gene"
  | "reaction" | "pathway" | "compartment";

export type PathwayCategory =
  | "carbohydrate-metabolism" | "lipid-metabolism" | "amino-acid-metabolism"
  | "nucleotide-metabolism" | "energy-metabolism" | "cofactor-vitamin-metabolism"
  | "signaling" | "redox-detox" | "one-carbon-metabolism" | "microbiome-host"
  | "cancer-rewiring" | "hormone-endocrine" | "neurotransmitter-metabolism"
  | "specialized-tissue" | "transport" | "other";

/** Regulatory edge types (non mass-flow, non-structural). Mirrors regulation.type in the schema. */
export type RegulationType =
  | "activation" | "inhibition" | "allosteric-activation" | "allosteric-inhibition"
  | "competitive-inhibition" | "noncompetitive-inhibition" | "feedback-inhibition"
  | "feedforward-activation" | "phosphorylation" | "dephosphorylation"
  | "covalent-modification" | "hormonal-signal"
  | "transcriptional-activation" | "transcriptional-repression";

/** Generic typed relations (structural / organizational). Mirrors relation.type. */
export type RelationType =
  | "gene-encodes" | "complex-formation" | "isozyme" | "pathway-membership"
  | "crosstalk" | "microbiome-host" | "transport" | "electron-transfer" | "spontaneous";

/** Every arrow the renderer knows how to draw. Superset used for the merged master graph. */
export type ArrowType =
  | "substrate" | "product" | "reversible" | "cofactor" | "coenzyme-couple" | "spontaneous"
  | "catalysis" | "transport-catalysis"
  | RegulationType
  | "transport" | "electron-transfer"
  | "gene-encodes" | "transcriptional-activation" | "transcriptional-repression"
  | "complex-formation" | "isozyme" | "pathway-membership" | "crosstalk" | "microbiome-host";

export interface Xref {
  chebi?: string; kegg?: string; pubchem?: string; hmdb?: string; metacyc?: string;
  inchikey?: string; uniprot?: string; pdb?: string[]; alphafold?: string; rhea?: string;
  reactome?: string; brenda?: string; ensembl?: string; entrez?: string; go?: string; ec?: string[];
  [k: string]: unknown;
}

export interface Reference { pmid?: string; doi?: string; title?: string; year?: number; url?: string; }

export interface Source {
  db: "KEGG" | "Reactome" | "MetaCyc" | "Rhea" | "BRENDA" | "UniProt" | "ChEBI"
    | "HMDB" | "PDB" | "AlphaFold" | "PubMed" | "textbook" | "review" | "other";
  id?: string; url?: string;
}

export interface Provenance {
  curator?: string;
  confidence: Confidence;
  sources: Source[];
  lastReviewed?: string;
  notes?: string;
}

export interface Compartment { id: string; name: string; go?: string; description?: string; }

export type MetaboliteRole =
  | "fuel" | "cofactor" | "coenzyme" | "second-messenger" | "signaling" | "vitamin"
  | "hormone" | "neurotransmitter" | "electron-carrier" | "building-block" | "waste" | "toxin" | "other";

export interface Metabolite {
  id: string; name: string; synonyms?: string[];
  /** Chart caption form when the curated name is too long for a side arc. */
  short?: string;
  formula?: string; charge?: number;
  monoisotopicMass?: number; smiles?: string; inchikey?: string; class?: string;
  roles?: MetaboliteRole[]; xrefs?: Xref; description?: string; provenance?: Provenance;
}

export interface Enzyme {
  id: string; name: string; gene?: string; ec?: string[]; organism?: string;
  cofactors?: string[]; family?: string; compartment?: string; molecularWeightKda?: number;
  oligomerization?: string; tissues?: string[]; xrefs?: Xref; description?: string; provenance?: Provenance;
}

export interface Gene { id: string; symbol: string; name?: string; xrefs?: Xref; description?: string; }

export interface Complex {
  id: string; name: string; subunits: { enzyme: string; stoichiometry?: number }[];
  xrefs?: Xref; description?: string; provenance?: Provenance;
}

export interface Participant { metabolite: string; stoichiometry?: number; compartment?: string; }

export interface Kinetics {
  enzyme?: string; substrate?: string; kmMilliMolar?: number; kcatPerSec?: number;
  vmax?: string; organism?: string; source?: string;
}

export interface Reaction {
  id: string; name?: string; ec?: string; equation?: string;
  substrates: Participant[]; products: Participant[];
  catalysts?: { enzyme: string; role?: "catalyst" | "transporter" | "rate-limiting" | "committed-step" }[];
  cofactors?: { metabolite: string; role?: string }[];
  reversibility?: "reversible" | "irreversible" | "direction-forward" | "direction-reverse" | "unknown";
  deltaGPrimeKjPerMol?: number; kinetics?: Kinetics[]; spontaneous?: boolean; transport?: boolean;
  compartment?: string; rateLimiting?: boolean; pathwayStep?: number; xrefs?: Xref; provenance: Provenance;
}

export interface Endpoint { kind: EntityKind; id: string; }

export interface Regulation {
  id: string; type: RegulationType; regulator: Endpoint; target: Endpoint;
  effect?: "positive" | "negative" | "neutral" | "signal"; mechanism?: string;
  conditions?: Record<string, unknown>; provenance: Provenance;
}

export interface Relation {
  id: string; type: RelationType; source: Endpoint; target: Endpoint; note?: string; provenance?: Provenance;
}

export interface PathwayModule {
  $schema?: string;
  id: string; name: string; category: PathwayCategory;
  summary?: string; description?: string; organisms?: string[]; tissues?: string[]; keywords?: string[];
  provenance: Provenance; references?: Reference[]; compartments?: Compartment[];
  metabolites: Metabolite[]; enzymes: Enzyme[]; genes?: Gene[]; complexes?: Complex[];
  reactions: Reaction[]; regulations?: Regulation[]; relations?: Relation[];
}

// ---- Merged master graph (produced by tools/build-graph) ----

export interface GraphNode {
  id: string;            // globally unique, namespaced (e.g. "met:glucose", "enz:hexokinase")
  kind: EntityKind;
  label: string;
  pathways: string[];    // module ids this node appears in
  data: Metabolite | Enzyme | Complex | Gene | Reaction | { id: string; name: string };
}

export interface GraphEdge {
  id: string;
  type: ArrowType;
  source: string;        // node id
  target: string;        // node id
  pathway?: string;
  effect?: string;
  meta?: Record<string, unknown>;
}

export interface MasterGraph {
  version: string;
  generated: string;
  pathways: { id: string; name: string; category: PathwayCategory; summary?: string; counts: Record<string, number> }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<string, number>;
}

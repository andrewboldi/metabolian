/**
 * Explore — "Follow a compound".
 *
 * The Chart (chart.html) is the pathway sheet. Explore answers the one question a
 * per-pathway sheet structurally cannot: *where does this compound appear across ALL
 * pathways, and what makes and consumes it?*
 *
 * Design notes worth keeping:
 *  - Search-first. Nothing is drawn until a compound is chosen; the full graph is never
 *    rendered (that is what made this page unreadable).
 *  - Semantic DOM, not a canvas. The neighbourhood of a compound is a two-sided ledger
 *    whose layout is a stack — a force simulation has nothing to solve here, and DOM gives
 *    real focus, tab order, screen-reader semantics, Ctrl+F and user font scaling for free.
 *    Typed arrows are inline SVG from schema/arrows.json via lib/arrows, which renders all
 *    ten head shapes exactly (cytoscape collapsed `open` and `curve` down to `vee`).
 *  - Identity merge. master.json splits 22 compounds into protonation-state variants
 *    (Acetyl-CoA is CHEBI:15351 *and* CHEBI:57288). Answering "across ALL pathways" from a
 *    single node returns roughly half the truth, so clusters are merged on
 *    `xrefs.kegg || data.id` — never on label, which would fuse (R)/(S)-methylmalonyl-CoA
 *    and the lipoyl-lysine redox states. The merge is disclosed in the header, not silent.
 *  - master.json (1.3 MB) is fetched lazily on first interaction, not on load.
 */
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/explore.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, asset, xrefUrl, fmt } from "../lib/util";
import { loadArrows, arrowSVG, type ArrowRegistry, type ArrowSpec } from "../lib/arrows";

mountChrome("explore");

/* ------------------------------------------------------------------ types */

interface GNode { id: string; kind: string; label: string; pathways: string[]; data: Record<string, any>; }
interface GEdge { id: string; type: string; source: string; target: string; pathway?: string; effect?: string; mechanism?: string; }
interface PathwayMeta { id: string; name: string; category: string; counts: Record<string, number> }
interface Master { pathways: PathwayMeta[]; nodes: GNode[]; edges: GEdge[]; stats: Record<string, number>; }
interface SearchEntry { id: string; label: string; kind: string; pathways: string[]; }
interface MolEntry { file: string; name: string; w: number; h: number; ink?: { x: number; y: number; w: number; h: number } }

type Role = "makes" | "both" | "uses";

interface Row {
  rxn: GNode;
  role: Role;
  cofactor: boolean;
  pathway: string;
  enzymes: GNode[];
  score: number;
}
interface Reg { edge: GEdge; target: GNode }
interface Cluster {
  key: string;
  members: GNode[];
  label: string;
  pathways: string[];
  rows: Row[];
  regs: Reg[];
}

/* ------------------------------------------------------- constants / copy */

/** Entry points chosen for teaching value: a fuel, a currency, three junctions, a carrier. */
const SUGGESTED = [
  "met:chebi4167",   // D-Glucose
  "met:chebi15361",  // Pyruvate
  "met:chebi15351",  // Acetyl-CoA
  "met:chebi30616",  // ATP
  "met:chebi16015",  // L-Glutamate
  "met:chebi57945",  // NADH
];

/**
 * Species that touch 80–130 reactions because they are stoichiometric bookkeeping.
 * Their neighbourhood is "everything", which teaches nothing — so they are demoted in
 * search ranking and kept out of the suggestions, but remain fully reachable.
 */
const UBIQUITOUS = new Set([
  "met:chebi15378", // Proton (H+)
  "met:chebi15377", // Water
  "met:chebi43474", // Orthophosphate (Pi)
  "met:chebi16526", // CO2
  "met:chebi15379", // Dioxygen (O2)
]);

const MASS_TYPES = new Set(["substrate", "product", "reversible", "cofactor"]);
const ROLES: Role[] = ["makes", "both", "uses"];
const ROLE_COPY: Record<Role, { head: string; verb: string; arrow: string }> = {
  makes: { head: "Made by", verb: "produce", arrow: "product" },
  both: { head: "Interconverts via", verb: "interconvert", arrow: "reversible" },
  uses: { head: "Used by", verb: "consume", arrow: "substrate" },
};
/** Row budget per column, before spill. Keeps any view inside the 10–40 element target. */
const QUOTA: Record<Role, number> = { makes: 8, both: 6, uses: 8 };

/* ------------------------------------------------------------------ state */

const view = document.getElementById("ex-view")!;
const input = document.getElementById("ex-q") as HTMLInputElement;
const results = document.getElementById("ex-results")!;
const clearBtn = document.getElementById("ex-clear") as HTMLButtonElement;
const live = document.getElementById("ex-live")!;

let searchIndex: SearchEntry[] = [];
let pathwayMeta = new Map<string, PathwayMeta>();
let masterPromise: Promise<Master> | null = null;
let registry: ArrowRegistry | null = null;
const clusters = new Map<string, Cluster>();
const clusterOfNode = new Map<string, string>();
let mols: Record<string, MolEntry> | null = null;
let active = -1;
let currentKey: string | null = null;

/* ------------------------------------------------------------------- boot */

main().catch((err) => {
  console.error(err);
  view.replaceChildren(el("div.wrap", {}, [
    el("p.ex-error", {}, ["Could not load the atlas index. Try rebuilding the data (npm run data:build)."]),
  ]));
});

async function main() {
  const [search, index] = await Promise.all([
    getJSON<SearchEntry[]>("graph/search.json"),
    getJSON<{ pathways: PathwayMeta[]; stats?: Record<string, number> }>("graph/index.json"),
  ]);
  searchIndex = search.filter((e) => e.kind === "metabolite");
  pathwayMeta = new Map((index.pathways || []).map((p) => [p.id, p]));

  wireSearch();
  window.addEventListener("popstate", () => route());
  route();
}

/** ?id=met:… selects a compound; anything else is the landing screen. */
function route() {
  const id = new URLSearchParams(location.search).get("id");
  if (id) void select(id, { push: false });
  else { currentKey = null; renderLanding(); }
}

/* ------------------------------------------------------------ data loading */

function loadMaster(): Promise<Master> {
  if (!masterPromise) {
    masterPromise = Promise.all([getJSON<Master>("graph/master.json"), loadArrows()]).then(([m, reg]) => {
      registry = reg;
      buildIndex(m);
      return m;
    });
  }
  return masterPromise;
}

/** Warm the big fetch as soon as the reader shows intent, so selection feels instant. */
function prefetchMaster() { void loadMaster(); }

/**
 * One pass over 2,958 edges builds every compound neighbourhood in the atlas.
 * Merge key is `xrefs.kegg || data.id` — verified to produce 22 merges and zero
 * false merges across all 351 metabolites. Label merging is forbidden (see header).
 */
function buildIndex(m: Master) {
  const byId = new Map(m.nodes.map((n) => [n.id, n]));

  for (const n of m.nodes) {
    if (n.kind !== "metabolite") continue;
    const key = (n.data?.xrefs?.kegg as string) || (n.data?.id as string) || n.id;
    let c = clusters.get(key);
    if (!c) { c = { key, members: [], label: n.label, pathways: [], rows: [], regs: [] }; clusters.set(key, c); }
    c.members.push(n);
    clusterOfNode.set(n.id, key);
  }

  // Catalysts hang on the reaction row as text rather than becoming their own nodes —
  // reactions and enzymes run ~1:1, so promoting them would double element count for free.
  const catalysts = new Map<string, GNode[]>();
  for (const e of m.edges) {
    if (e.type !== "catalysis") continue;
    const enz = byId.get(e.source);
    if (!enz) continue;
    const list = catalysts.get(e.target) || [];
    if (!list.some((x) => x.id === enz.id)) list.push(enz);
    catalysts.set(e.target, list);
  }

  // (cluster, reaction) → roles. `cofactor` is additive in this data (every cofactor edge
  // co-occurs with a substrate/product edge), so it is a flag on the row, not a role.
  const acc = new Map<string, { c: Cluster; rxn: GNode; makes: boolean; uses: boolean; both: boolean; cofactor: boolean }>();
  const note = (metId: string, rxnId: string, kind: "makes" | "uses" | "both" | "cofactor") => {
    const key = clusterOfNode.get(metId);
    const rxn = byId.get(rxnId);
    if (!key || !rxn || rxn.kind !== "reaction") return;
    const c = clusters.get(key)!;
    const k = `${key} ${rxnId}`;
    let a = acc.get(k);
    if (!a) { a = { c, rxn, makes: false, uses: false, both: false, cofactor: false }; acc.set(k, a); }
    if (kind === "cofactor") a.cofactor = true; else a[kind] = true;
  };

  for (const e of m.edges) {
    if (MASS_TYPES.has(e.type)) {
      const srcIsMet = clusterOfNode.has(e.source);
      const metId = srcIsMet ? e.source : e.target;
      const rxnId = srcIsMet ? e.target : e.source;
      if (e.type === "substrate") note(metId, rxnId, "uses");
      else if (e.type === "product") note(metId, rxnId, "makes");
      else if (e.type === "reversible") note(metId, rxnId, "both");
      else note(metId, rxnId, "cofactor");
      continue;
    }
    if (e.type === "catalysis" || e.type === "gene-encodes" || e.type === "crosstalk") continue;
    // Everything else with a metabolite on the source side is regulation: this compound
    // acting as a signal rather than as mass. Best prose in the dataset, invisible until now.
    const key = clusterOfNode.get(e.source);
    const target = byId.get(e.target);
    if (key && target) clusters.get(key)!.regs.push({ edge: e, target });
  }

  for (const a of acc.values()) {
    const role: Role = a.both || (a.makes && a.uses) ? "both" : a.makes ? "makes" : "uses";
    const d = a.rxn.data || {};
    a.c.rows.push({
      rxn: a.rxn,
      role,
      cofactor: a.cofactor,
      pathway: a.rxn.pathways[0] || "",
      enzymes: catalysts.get(a.rxn.id) || [],
      // Principal participation outranks incidental cofactor donation; committed steps
      // outrank ordinary ones. Only ever reorders *within* a column.
      score: (a.cofactor ? 0 : 3) + (d.rateLimiting ? 2 : 0) + (d.deltaGPrimeKjPerMol != null ? 0.5 : 0),
    });
  }

  for (const c of clusters) {
    const cl = c[1];
    cl.label = [...cl.members].sort((a, b) => b.pathways.length - a.pathways.length)[0].label;
    cl.pathways = [...new Set(cl.members.flatMap((n) => n.pathways))].sort();
    cl.rows.sort((a, b) => b.score - a.score || a.rxn.label.localeCompare(b.rxn.label));
  }
}

/* ----------------------------------------------------------------- search */

function score(entry: SearchEntry, q: string): number {
  const l = entry.label.toLowerCase();
  let s = -1;
  if (l === q) s = 100;
  else if (l.startsWith(q)) s = 70;
  else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l)) s = 50;
  else if (l.includes(q)) s = 25;
  if (s < 0) return s;
  s += Math.min(entry.pathways.length, 12);
  if (UBIQUITOUS.has(entry.id)) s -= 40;
  return s;
}

function query(q: string): SearchEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored: { e: SearchEntry; s: number }[] = [];
  const seen = new Set<string>();
  for (const e of searchIndex) {
    const s = score(e, needle);
    if (s < 0) continue;
    // Collapse protonation variants in the *list* so one compound is offered once.
    const dedupe = e.label.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    scored.push({ e, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label)).slice(0, 10).map((x) => x.e);
}

function wireSearch() {
  const form = document.getElementById("ex-form") as HTMLFormElement;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const hits = query(input.value);
    if (hits.length) void select(hits[active >= 0 ? active : 0].id);
  });

  input.addEventListener("focus", prefetchMaster, { once: true });
  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    renderResults(query(input.value));
  });
  input.addEventListener("keydown", (ev) => {
    const items = [...results.querySelectorAll<HTMLElement>("li")];
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (!items.length) return;
      ev.preventDefault();
      active = ev.key === "ArrowDown"
        ? (active + 1) % items.length
        : (active <= 0 ? items.length : active) - 1;
      highlight(items);
    } else if (ev.key === "Home" && items.length) { ev.preventDefault(); active = 0; highlight(items); }
    else if (ev.key === "End" && items.length) { ev.preventDefault(); active = items.length - 1; highlight(items); }
    else if (ev.key === "Escape") { closeResults(); input.value = ""; clearBtn.hidden = true; }
  });
  input.addEventListener("blur", () => window.setTimeout(closeResults, 120));

  clearBtn.addEventListener("click", () => {
    input.value = ""; clearBtn.hidden = true; closeResults(); input.focus();
  });
}

function highlight(items: HTMLElement[]) {
  items.forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  const cur = items[active];
  if (cur) { input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
  else input.removeAttribute("aria-activedescendant");
}

function renderResults(hits: SearchEntry[]) {
  active = -1;
  input.removeAttribute("aria-activedescendant");
  if (!input.value.trim()) return closeResults();

  results.replaceChildren();
  if (!hits.length) {
    results.append(el("li.ex-result.ex-result--empty", { role: "presentation" }, [
      `No compound matches “${input.value.trim()}”. Try a synonym, or pick one below.`,
    ]));
  } else {
    hits.forEach((h, i) => {
      const li = el("li.ex-result", { id: `ex-opt-${i}`, role: "option", "aria-selected": "false" }, [
        el("span.ex-result__name", {}, [h.label]),
        el("span.ex-result__meta", {}, [`${h.pathways.length} pathway${h.pathways.length === 1 ? "" : "s"}`]),
      ]);
      li.addEventListener("mousedown", (ev) => { ev.preventDefault(); void select(h.id); });
      results.append(li);
    });
  }
  results.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function closeResults() {
  results.hidden = true;
  results.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  active = -1;
}

/* ---------------------------------------------------------------- landing */

function renderLanding() {
  document.title = "Follow a compound — Metabolian";
  const stats = el("p.ex-stats.muted", {}, [
    `${pathwayMeta.size} pathways · ${fmt(searchIndex.length)} compounds · ` +
    `${fmt([...pathwayMeta.values()].reduce((s, p) => s + (p.counts?.reactions || 0), 0))} reactions`,
  ]);

  const chips = el("div.ex-chips", {}, SUGGESTED.map((id) => {
    const e = searchIndex.find((x) => x.id === id);
    if (!e) return el("span");
    const a = el("a.ex-chip", { href: asset(`explore.html?id=${encodeURIComponent(id)}`) }, [
      el("span.ex-chip__name", {}, [e.label]),
      el("span.ex-chip__meta", {}, [`${e.pathways.length} pathways`]),
    ]);
    a.addEventListener("click", (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      void select(id);
    });
    a.addEventListener("pointerenter", prefetchMaster, { once: true });
    return a;
  }));

  view.replaceChildren(el("div.wrap", {}, [
    el("section.ex-landing", {}, [
      el("p.eyebrow", {}, ["Explore"]),
      el("h1.ex-landing__h", {}, ["Follow a compound."]),
      el("p.lead", {}, [
        "Search any metabolite to see every reaction that makes it and every reaction that uses it — " +
        "across all pathways at once, with the enzyme, the pathway, and a link straight to that chart sheet.",
      ]),
      el("h2.ex-landing__sub", {}, ["Start here"]),
      chips,
      stats,
      el("p.ex-landing__foot", {}, [
        "Looking for a whole pathway laid out end to end? That is ",
        el("a", { href: asset("chart.html") }, ["The Chart"]),
        ".",
      ]),
    ]),
  ]));
  window.requestAnimationFrame(() => {
    if (matchMedia("(pointer: fine)").matches) input.focus();
  });
}

/* ------------------------------------------------------- compound ledger */

async function select(nodeId: string, opts: { push?: boolean } = {}) {
  closeResults();
  view.replaceChildren(el("div.wrap", {}, [el("p.ex-loading.muted", {}, ["Loading the atlas…"])]));
  await loadMaster();

  const key = clusterOfNode.get(nodeId);
  const cluster = key ? clusters.get(key) : undefined;
  if (!cluster) {
    view.replaceChildren(el("div.wrap", {}, [el("p.ex-error", {}, [`No compound with id ${nodeId}.`])]));
    return;
  }
  currentKey = cluster.key;

  if (opts.push !== false) {
    const url = `${location.pathname}?id=${encodeURIComponent(nodeId)}`;
    history.pushState({ id: nodeId }, "", url);
  }
  input.value = "";
  clearBtn.hidden = true;
  renderCluster(cluster, nodeId);
}

function renderCluster(c: Cluster, nodeId: string) {
  const reg = registry!;
  const counts: Record<Role, number> = { makes: 0, both: 0, uses: 0 };
  for (const r of c.rows) counts[r.role]++;
  const total = c.rows.length;
  const shown = allocate(counts);
  const capped = ROLES.some((r) => shown[r] < counts[r]);

  const frag = el("div.wrap.ex-compound", {}, [header(c, nodeId, counts, total, capped, shown)]);
  // 27 metabolites (insulin, glucagon, …) exist only as regulators. Rendering an empty
  // two-column skeleton for them would read as a bug; skip straight to the regulation band.
  if (total) frag.append(ledger(c, reg, counts, shown));
  const regs = regulationBand(c, reg);
  if (regs) frag.append(regs);
  if (!total && !regs) {
    frag.append(el("p.ex-col__empty", {}, [
      `${c.label} is recorded in this atlas but takes part in no reaction and no regulation yet.`,
    ]));
  }
  frag.append(el("p.ex-foot.muted", {}, [
    "Reaction rows are grouped by the pathway they belong to; open a sheet to see that pathway laid out in full.",
  ]));

  view.replaceChildren(frag);
  document.title = `${c.label} — Metabolian`;
  const h1 = view.querySelector<HTMLElement>("h1");
  h1?.focus();
  live.textContent = total
    ? `${c.label}: ${counts.makes} reactions make it, ${counts.uses} use it, ${counts.both} interconvert, across ${c.pathways.length} pathways.`
    : `${c.label} takes part in no reactions in this atlas.`;
  void loadStructure(c);
}

/** Per-role caps with spill, so a compound with one producer still fills its budget. */
function allocate(counts: Record<Role, number>): Record<Role, number> {
  const out = {} as Record<Role, number>;
  let spare = 0;
  for (const r of ROLES) { out[r] = Math.min(QUOTA[r], counts[r]); spare += QUOTA[r] - out[r]; }
  for (const r of ROLES) {
    if (spare <= 0) break;
    const extra = Math.min(spare, counts[r] - out[r]);
    out[r] += extra;
    spare -= extra;
  }
  return out;
}

function header(c: Cluster, nodeId: string, counts: Record<Role, number>, total: number, capped: boolean, shown: Record<Role, number>): HTMLElement {
  const primary = c.members.find((n) => n.id === nodeId) || c.members[0];
  const d = primary.data || {};

  const chips = el("div.chips");
  if (d.formula) chips.append(el("span.chip", {}, [d.formula]));
  if (d.class) chips.append(el("span.chip", {}, [d.class]));
  const seen = new Set<string>();
  for (const mem of c.members) {
    for (const [db, id] of Object.entries(mem.data?.xrefs || {})) {
      const text = `${db}:${String(id).replace(/^CHEBI:/, "")}`;
      if (!id || seen.has(text)) continue;
      seen.add(text);
      const href = xrefUrl(db, String(id));
      chips.append(href ? el("a.chip", { href, target: "_blank", rel: "noopener" }, [text]) : el("span.chip", {}, [text]));
    }
  }

  const meta = el("div.ex-head__meta", {}, [
    el("h1.ex-head__name", { tabindex: "-1" }, [c.label]),
    el("p.ex-head__verdict", {}, [
      total
        ? `Made by ${counts.makes} · used by ${counts.uses}` +
          (counts.both ? ` · ${counts.both} reversible` : "") +
          ` · appears in ${c.pathways.length} pathway${c.pathways.length === 1 ? "" : "s"}.`
        : "This compound does not appear as a reactant in any reaction here.",
    ]),
    chips,
  ]);

  if (c.members.length > 1) {
    // Disclosed, never silent: the atlas stores protonation variants as separate nodes.
    meta.append(el("p.ex-note", {}, [
      `${c.members.length} database entries merged (${c.members.map((m) => m.data?.xrefs?.chebi || m.id).join(", ")}) — ` +
      "protonation-state variants of the same compound. Their reactions are shown together.",
    ]));
  }
  if (capped) {
    meta.append(el("p.ex-note.ex-note--cap", {}, [
      `${c.label} takes part in ${total} reactions across ${c.pathways.length} pathways — too many to read at once. ` +
      `Showing the ${ROLES.reduce((s, r) => s + shown[r], 0)} most specific. Every column says how many more there are, and you can open them.`,
    ]));
  }

  const badges = el("div.ex-pathways", {}, [
    el("span.ex-pathways__label", {}, [`Appears in ${c.pathways.length} pathway${c.pathways.length === 1 ? "" : "s"}`]),
    ...c.pathways.map((p) => el("a.ex-pw", { href: asset(`chart.html?id=${encodeURIComponent(p)}`) }, [pathwayName(p)])),
  ]);

  return el("section.ex-head", {}, [
    el("div.ex-head__top", {}, [el("div.ex-structure", { id: "ex-structure" }), meta]),
    c.pathways.length ? badges : el("span"),
  ]);
}

function pathwayName(id: string): string {
  return pathwayMeta.get(id)?.name || id;
}

function ledger(c: Cluster, reg: ArrowRegistry, counts: Record<Role, number>, shown: Record<Role, number>): HTMLElement {
  const cols = ROLES.filter((r) => r !== "both").map((r) => column(c, reg, r, counts[r], shown[r]));
  const grid = el("div.ex-ledger", {}, [
    cols[0],
    el("div.ex-spine", { "aria-hidden": "true" }, [
      el("div.ex-spine__rule"),
      el("div.ex-spine__dot"),
      el("div.ex-spine__label", {}, [c.label]),
      el("div.ex-spine__rule"),
    ]),
    cols[1],
  ]);
  const out = el("div", {}, [grid]);
  if (counts.both) out.append(column(c, reg, "both", counts.both, shown.both, true));
  return out;
}

function column(c: Cluster, reg: ArrowRegistry, role: Role, total: number, limit: number, wide = false): HTMLElement {
  const rows = c.rows.filter((r) => r.role === role);
  const copy = ROLE_COPY[role];
  const list = el("div.ex-col__groups");

  const head = el("h2.ex-col__head", {}, [
    el("span.ex-col__title", {}, [copy.head]),
    el("span.ex-col__count", {}, [total > limit ? `${limit} of ${total}` : String(total)]),
  ]);

  const section = el(`section.ex-col.ex-col--${role}${wide ? ".ex-col--wide" : ""}`, {}, [head]);

  if (!total) {
    section.append(el("p.ex-col__empty", {}, [emptyCopy(c.label, role)]));
    return section;
  }

  const paint = (subset: Row[]) => {
    // Group by pathway inside the column: pathway is the row, direction is the column.
    const byPathway = new Map<string, Row[]>();
    for (const r of subset) {
      const arr = byPathway.get(r.pathway) || [];
      arr.push(r);
      byPathway.set(r.pathway, arr);
    }
    list.replaceChildren();
    for (const [pid, rs] of [...byPathway].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      list.append(el("div.ex-group", {}, [
        el("div.ex-group__head", {}, [
          el("a.ex-group__link", { href: asset(`chart.html?id=${encodeURIComponent(pid)}`) }, [pathwayName(pid)]),
          el("span.ex-group__n", {}, [`${rs.length} rxn`]),
        ]),
        el("ul.ex-rows", {}, rs.map((r) => reactionRow(r, reg, copy.arrow))),
      ]));
    }
  };

  paint(rows.slice(0, limit));
  section.append(list);

  if (total > limit) {
    const more = el("button.ex-more", { type: "button" }, [
      `Show ${total - limit} more reaction${total - limit === 1 ? "" : "s"} that ${copy.verb} ${c.label}`,
    ]);
    more.addEventListener("click", () => {
      paint(rows);
      more.remove();
      (head.querySelector(".ex-col__count") as HTMLElement).textContent = String(total);
      live.textContent = `Showing all ${total} reactions that ${copy.verb} ${c.label}.`;
    });
    section.append(more);
  }
  return section;
}

function emptyCopy(label: string, role: Role): string {
  if (role === "makes") return `No reaction in this atlas produces ${label} — it enters the network from elsewhere.`;
  if (role === "uses") return `No reaction in this atlas consumes ${label} — it is released as an end product.`;
  return `No reversible reaction involves ${label}.`;
}

function reactionRow(r: Row, reg: ArrowRegistry, arrowKey: string): HTMLElement {
  const d = r.rxn.data || {};
  const enzymes = r.enzymes.map((e) => e.label).join(", ");
  const ec = Array.isArray(d.ec) ? d.ec[0] : d.ec;

  const detail = el("div.ex-detail", { hidden: true });
  const name = el("button.ex-row__name", { type: "button", "aria-expanded": "false" }, [r.rxn.label]);
  name.addEventListener("click", () => {
    const open = name.getAttribute("aria-expanded") === "true";
    name.setAttribute("aria-expanded", String(!open));
    if (!open && !detail.childElementCount) detail.append(...reactionDetail(r));
    detail.hidden = open;
  });

  const tags = el("div.ex-row__tags");
  if (d.rateLimiting) tags.append(el("span.chip.ex-tag--rl", { title: "Rate-limiting, committed step" }, ["rate-limiting"]));
  if (r.cofactor) tags.append(el("span.chip.ex-tag--cof", { title: "Participates as a cofactor / co-substrate here" }, ["cofactor"]));
  if (ec) tags.append(el("span.chip", {}, [`EC ${ec}`]));

  return el("li.ex-row", {}, [
    el("span.ex-row__arrow", { "aria-hidden": "true", html: glyph(reg, r.cofactor ? "cofactor" : arrowKey) }),
    el("div.ex-row__body", {}, [
      name,
      enzymes ? el("p.ex-row__enz", {}, [enzymes]) : el("p.ex-row__enz.muted", {}, ["no catalyst recorded"]),
      tags,
      detail,
    ]),
  ]);
}

function glyph(reg: ArrowRegistry, key: string): string {
  const spec: ArrowSpec | undefined = reg.arrows[key];
  return spec ? arrowSVG(spec, 40, 16) : "";
}

function reactionDetail(r: Row): HTMLElement[] {
  const d = r.rxn.data || {};
  const out: HTMLElement[] = [];
  if (d.equation) out.push(el("div.ex-eq", {}, [d.equation]));
  const kv = el("dl.kv");
  const add = (k: string, v: string) => kv.append(el("dt", {}, [k]), el("dd", {}, [v]));
  if (d.reversibility) add("direction", d.reversibility);
  if (d.compartment) add("compartment", d.compartment);
  if (d.deltaGPrimeKjPerMol != null) add("ΔG°′", `${d.deltaGPrimeKjPerMol} kJ/mol`);
  if (r.enzymes.length) add("enzyme", r.enzymes.map((e) => `${e.label}${e.data?.gene ? ` (${e.data.gene})` : ""}`).join("; "));
  if (kv.childElementCount) out.push(kv);

  const prov = d.provenance;
  if (prov) {
    const src = (prov.sources || []).map((s: any) => `${s.db}:${s.id}`).join(" · ");
    out.push(el("p.ex-prov", {}, [
      el("span.conf", { "data-c": prov.confidence || "medium" }, [`confidence: ${prov.confidence || "medium"}`]),
      src ? el("span.ex-prov__src", {}, [src]) : el("span"),
    ]));
  }
  const enz = r.enzymes.find((e) => e.data?.xrefs?.uniprot || e.data?.xrefs?.alphafold);
  if (enz) {
    const acc = enz.data.xrefs.uniprot || enz.data.xrefs.alphafold;
    out.push(el("a.ex-3d", { href: asset(`protein.html?uniprot=${acc}&name=${encodeURIComponent(enz.label)}`) }, ["View 3D structure →"]));
  }
  return out;
}

/** Where the compound acts as a signal rather than as mass — the Roche sheet's other half. */
function regulationBand(c: Cluster, reg: ArrowRegistry): HTMLElement | null {
  if (!c.regs.length) return null;
  const items = c.regs.slice(0, 12);
  const band = el("section.ex-reg", {}, [
    el("h2.ex-reg__head", {}, [`${c.label} also regulates`]),
    el("ul.ex-reg__list", {}, items.map(({ edge, target }) => el("li.ex-reg__item", {}, [
      el("span.ex-row__arrow", { "aria-hidden": "true", html: glyph(reg, edge.type) }),
      el("div", {}, [
        el("p.ex-reg__target", {}, [
          target.label,
          el("span.ex-reg__type", {}, [` — ${reg.arrows[edge.type]?.label || edge.type}`]),
        ]),
        edge.mechanism ? el("p.ex-reg__mech", {}, [edge.mechanism]) : el("span"),
      ]),
    ]))),
  ]);
  if (c.regs.length > items.length) {
    band.append(el("p.muted", {}, [`${c.regs.length - items.length} further regulatory links are not shown.`]));
  }
  return band;
}

/* ----------------------------------------------------- 2D structure (lazy) */

/**
 * Exactly one structure per view — the hero compound. These SVGs are 28–40 KB each,
 * so they must never be fetched per reaction row.
 */
async function loadStructure(c: Cluster) {
  const host = document.getElementById("ex-structure");
  if (!host) return;
  if (!mols) {
    try { mols = await getJSON<Record<string, MolEntry>>("mol/index.json"); }
    catch { mols = {}; }
  }
  if (currentKey !== c.key) return; // a newer selection won the race

  let entry: MolEntry | undefined;
  for (const mem of c.members) {
    const chebi = String(mem.data?.xrefs?.chebi || "").replace("CHEBI:", "");
    if (chebi && mols[`chebi:${chebi}`]) { entry = mols[`chebi:${chebi}`]; break; }
  }
  if (!entry) {
    host.append(el("span.ex-structure__none", {}, [c.members[0]?.data?.formula || c.label.slice(0, 3)]));
    return;
  }
  const ink = entry.ink || { x: 0, y: 0, w: entry.w, h: entry.h };
  host.innerHTML =
    `<svg viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" role="img" aria-label="2D structure of ${c.label}">` +
    `<image href="${asset(`mol/${entry.file}`)}" x="0" y="0" width="${entry.w}" height="${entry.h}"/></svg>`;
}

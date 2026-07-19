import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/page.css";
import "../styles/chart.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, asset, BASE, xrefUrl } from "../lib/util";
import { mountChart, type ChartIR, type ChartNode, type ChartRxn } from "../lib/chart-view";
import { renderStructure } from "../lib/structure";

mountChrome("chart");

let view: ReturnType<typeof mountChart> | null = null;

/** The view the chart re-derives whenever its box changes — the deep link if
 *  there is one, otherwise a plain fit. Cleared the moment the reader takes the
 *  view over by panning or zooming, so auto-correction never fights them. */
let autoView: (() => void) | null = null;

async function main() {
  const canvas = document.getElementById("chart-canvas")!;
  const index = await getJSON<{ charts: { id: string; title: string; grid: string }[] }>("chart/index.json");
  const wanted = new URLSearchParams(location.search).get("id") || index.charts[0]?.id;

  // chart picker
  const picker = document.getElementById("chart-picker") as HTMLSelectElement;
  picker.replaceChildren(...index.charts.map((c) => el("option", { value: c.id, ...(c.id === wanted ? { selected: "true" } : {}) }, [c.title])));
  picker.addEventListener("change", () => { location.search = `?id=${picker.value}`; });

  // The help bar is an onboarding hint painted over the sheet; retire it the
  // moment the reader starts navigating, so it can't sit on top of the EC
  // numbers and structures they zoomed in to read.
  const help = document.querySelector<HTMLElement>(".chart-help");
  if (help) {
    const dismiss = () => help.setAttribute("data-dismissed", "true");
    for (const ev of ["wheel", "pointerdown"]) canvas.addEventListener(ev, dismiss, { once: true, passive: true });
  }

  await load(wanted, canvas);
  wireHud();
}

async function load(id: string, canvas: HTMLElement) {
  // Fetch the sheet and the fonts CONCURRENTLY, then place labels only once the
  // fonts are in. The anti-collision placer measures real glyph extents, and it
  // runs exactly once — so a webfont arriving after layout leaves every label
  // positioned against fallback metrics, permanently. That is not hypothetical:
  // a cold-cache CI runner measured 2 overprints where a warm one measured 0,
  // and a reader on a slow connection would have kept the bad placement.
  // fonts.ready is already resolved on a warm cache, so this costs nothing then.
  const [ir] = await Promise.all([
    getJSON<ChartIR>(`chart/${id}.json`),
    document.fonts?.ready ?? Promise.resolve(),
  ]);
  document.getElementById("chart-title")!.textContent = ir.title;
  view = mountChart(ir, canvas, BASE, {
    onMetabolite: (n) => { openNode(n); view?.trace(n.id); },
    onEnzyme: (r) => openEnzyme(r),
    onZoom: (k, lod) => {
      document.getElementById("zoom-readout")!.textContent = `${Math.round(k * 100)}%`;
      document.getElementById("lod-badge")!.textContent = lod;
    },
  });

  // deep-linkable view: ?z=<zoom>&cx=<chartX>&cy=<chartY>
  // An ABSENT param must stay `undefined` so setView falls back to the bounds
  // centre. Number(null) and Number("") are both 0 and both pass isFinite, so
  // coercing first would forward the literal chart coordinate (0,0) — which is
  // off the top-left corner of every layout — and frame blank sheet.
  const q = new URLSearchParams(location.search);
  const num = (key: string) => {
    const raw = q.get(key);
    if (raw === null || raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const z = num("z");

  // mountChart fits against whatever box the canvas has at mount time and then
  // latches `sized`, so that first measurement is the only one that ever counts
  // — and it is not trustworthy. #chart-canvas takes ALL of its geometry from
  // chart.css (`position:absolute; inset:0` inside a 100vh shell), so until that
  // stylesheet applies the div is a static, zero-height box. Measuring it then
  // yields a centring translate hundreds of px off, and because a stylesheet
  // landing late fires no window `resize`, nothing ever corrects it. So watch
  // the box itself and re-derive the view each time it changes.
  const chart = view;
  autoView = z !== undefined && z > 0
    ? () => chart.setView(z, num("cx"), num("cy"))
    : () => chart.fit();

  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    // A degenerate box means layout has not happened yet; measuring it is what
    // caused the bug. Skip it — a later observation arrives with a real one.
    if (!autoView || r.width < 2 || r.height < 2) return;
    autoView();
  }).observe(canvas);

  // Panning or zooming by hand hands the view to the reader for good.
  const release = () => { autoView = null; };
  for (const ev of ["wheel", "pointerdown"]) canvas.addEventListener(ev, release, { passive: true });
}

function wireHud() {
  // Zooming by hand is the reader taking the view over; Fit is them asking for
  // it back, so it re-arms auto-fit — and drops any deep link, which is an
  // opening frame, not a view the chart should snap back to on the next resize.
  document.getElementById("zoom-in")!.addEventListener("click", () => { autoView = null; view?.zoomBy(1.35); });
  document.getElementById("zoom-out")!.addEventListener("click", () => { autoView = null; view?.zoomBy(1 / 1.35); });
  document.getElementById("zoom-fit")!.addEventListener("click", () => {
    const chart = view;
    if (chart) { autoView = () => chart.fit(); chart.fit(); }
    view?.trace(null);
  });
  document.getElementById("inspector-close")!.addEventListener("click", closeInspector);
}

function inspectorBody(): HTMLElement {
  const insp = document.getElementById("inspector")!;
  insp.setAttribute("data-open", "true");
  const body = document.getElementById("inspector-body")!;
  body.replaceChildren();
  return body;
}
function closeInspector() {
  document.getElementById("inspector")!.setAttribute("data-open", "false");
  view?.trace(null);
}

/** Fields build-chart.mjs puts on a protein/effector node. They are not on
 *  ChartNode (owned by chart-view.ts), so read them through a narrow cast. */
type ProteinFields = { isProtein?: boolean; fullName?: string | null; gene?: string | null; uniprot?: string | null };
const asProtein = (n: ChartNode) => n as ChartNode & ProteinFields;

async function openNode(n: ChartNode) {
  if (asProtein(n).isProtein) await openProtein(n);
  else await openMetabolite(n);
}

/** A regulator drawn as an enzyme chip is a protein, not a metabolite: it gets
 *  the enzyme colour, its full name as the title with the gene symbol beneath,
 *  and UniProt/AlphaFold links built from `n.uniprot` (xrefs is empty on these
 *  nodes — the accession only ever lands on `uniprot`). */
async function openProtein(n: ChartNode) {
  const p = asProtein(n);
  const body = inspectorBody();
  body.append(el("div", {}, [el("span.drawer__kind", { style: "color:var(--node-enzyme)" }, ["protein"])]));
  body.append(el("h2", {}, [p.fullName || n.label]));
  // Only a subtitle when the symbol says something the title did not.
  const symbol = p.gene || n.label;
  if (symbol && symbol !== (p.fullName || n.label)) {
    body.append(el("p.muted", { style: "font-size:var(--step--1);margin-top:-.35rem" }, [symbol]));
  }

  const chips = el("div.chips");
  if (p.gene) chips.append(el("span.chip", {}, [p.gene]));
  if (p.uniprot) {
    chips.append(el("a.chip", { href: `https://www.uniprot.org/uniprotkb/${p.uniprot}/entry`, target: "_blank", rel: "noopener" }, [`UniProt ${p.uniprot}`]));
    chips.append(el("a.chip", { href: `https://alphafold.ebi.ac.uk/entry/${p.uniprot}`, target: "_blank", rel: "noopener" }, ["AlphaFold"]));
  }
  if (chips.childElementCount) body.append(chips);

  if (p.uniprot) await structureBlock(body, { uniprot: p.uniprot, pdb: null }, p.fullName || n.label);

  body.append(el("p.muted", { style: "font-size:var(--step--1)" }, ["Regulatory links are highlighted on the chart. Click empty space to clear the trace."]));
}

async function openMetabolite(n: ChartNode) {
  const body = inspectorBody();
  body.append(el("div", {}, [el("span.drawer__kind", { style: "color:var(--node-metabolite)" }, ["metabolite"])]));
  body.append(el("h2", {}, [n.label]));

  if (n.mol) {
    const holder = el("div.mol-preview");
    body.append(holder);
    try {
      const svg = await (await fetch(asset(`mol/${n.mol}`))).text();
      holder.innerHTML = svg;
    } catch { holder.remove(); }
  }

  const chips = el("div.chips");
  if (n.formula) chips.append(el("span.chip", {}, [n.formula]));
  if (n.charge != null) chips.append(el("span.chip", {}, [`charge ${n.charge}`]));
  for (const [db, id] of Object.entries(n.xrefs || {})) {
    const v = Array.isArray(id) ? id[0] : id;
    if (!v) continue;
    const url = xrefUrl(db, String(v));
    chips.append(url ? el("a.chip", { href: url, target: "_blank", rel: "noopener" }, [`${db}:${v}`]) : el("span.chip", {}, [`${db}:${v}`]));
  }
  if (chips.childElementCount) body.append(chips);
  body.append(el("p.muted", { style: "font-size:var(--step--1)" }, ["Connected reactions are highlighted on the chart. Click empty space to clear the trace."]));
}

async function openEnzyme(r: ChartRxn) {
  const body = inspectorBody();
  body.append(el("div", {}, [el("span.drawer__kind", { style: "color:var(--node-enzyme)" }, ["enzyme"])]));
  body.append(el("h2", {}, [r.enzymeName || r.enzyme || "Enzyme"]));

  const chips = el("div.chips");
  if (r.ec) chips.append(el("a.chip", { href: `https://www.brenda-enzymes.org/enzyme.php?ecno=${r.ec}`, target: "_blank", rel: "noopener" }, [`EC ${r.ec}`]));
  if (r.gene) chips.append(el("span.chip", {}, [r.gene]));
  if (r.uniprot) chips.append(el("a.chip", { href: `https://www.uniprot.org/uniprotkb/${r.uniprot}/entry`, target: "_blank", rel: "noopener" }, [`UniProt ${r.uniprot}`]));
  if (chips.childElementCount) body.append(chips);

  if (r.inLabels?.length || r.outLabels?.length) {
    body.append(el("p.muted", { style: "font-size:var(--step--1)" }, [
      `${r.inLabels?.length ? "consumes " + r.inLabels.join(" + ") : ""}${r.inLabels?.length && r.outLabels?.length ? " · " : ""}${r.outLabels?.length ? "releases " + r.outLabels.join(" + ") : ""}`,
    ]));
  }

  await structureBlock(body, { uniprot: r.uniprot, pdb: r.pdb }, r.enzymeName || "");
}

/** Inline 3D structure + representation buttons + the full-viewer link. Shared
 *  by the enzyme and protein drawers — no page navigation either way. */
async function structureBlock(body: HTMLElement, ref: { uniprot: string | null; pdb: string | null }, name: string) {
  const status = el("p.muted", { style: "font-size:var(--step--1)" }, ["Loading structure…"]);
  const host = el("div", { id: "mol3d" });
  body.append(host, status);
  const viewer = await renderStructure(host as HTMLElement, ref, (m) => { status.textContent = m; });
  if (viewer) {
    const reps = el("div", { style: "display:flex;gap:.35rem;flex-wrap:wrap" });
    for (const [label, style] of [["Cartoon", "cartoon"], ["Sticks", "stick"], ["Spheres", "sphere"]] as const) {
      reps.append(el("button.btn.btn--ghost", {
        type: "button", style: "padding:.35rem .6rem",
        onclick: () => {
          viewer.setStyle({}, style === "cartoon" ? { cartoon: { color: "spectrum" } } : style === "stick" ? { stick: { radius: 0.15, color: "spectrum" } } : { sphere: { scale: 0.28, color: "spectrum" } });
          viewer.render();
        },
      }, [label]));
    }
    body.append(reps);
    body.append(el("a", { href: asset(`protein.html?uniprot=${ref.uniprot ?? ""}&name=${encodeURIComponent(name)}`), style: "font-size:var(--step--1)" }, ["Open full structure viewer →"]));
  }
}

main().catch((e) => {
  console.error(e);
  document.getElementById("chart-title")!.textContent = "Could not load the chart";
});

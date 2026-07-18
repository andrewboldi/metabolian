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

async function main() {
  const canvas = document.getElementById("chart-canvas")!;
  const index = await getJSON<{ charts: { id: string; title: string; grid: string }[] }>("chart/index.json");
  const wanted = new URLSearchParams(location.search).get("id") || index.charts[0]?.id;

  // chart picker
  const picker = document.getElementById("chart-picker") as HTMLSelectElement;
  picker.replaceChildren(...index.charts.map((c) => el("option", { value: c.id, ...(c.id === wanted ? { selected: "true" } : {}) }, [c.title])));
  picker.addEventListener("change", () => { location.search = `?id=${picker.value}`; });

  await load(wanted, canvas);
  wireHud();
}

async function load(id: string, canvas: HTMLElement) {
  const ir = await getJSON<ChartIR>(`chart/${id}.json`);
  document.getElementById("chart-title")!.textContent = ir.title;
  view = mountChart(ir, canvas, BASE, {
    onMetabolite: (n) => { openMetabolite(n); view?.trace(n.id); },
    onEnzyme: (r) => openEnzyme(r),
    onZoom: (k, lod) => {
      document.getElementById("zoom-readout")!.textContent = `${Math.round(k * 100)}%`;
      document.getElementById("lod-badge")!.textContent = lod;
    },
  });

  // deep-linkable view: ?z=<zoom>&cx=<chartX>&cy=<chartY>
  const q = new URLSearchParams(location.search);
  const z = Number(q.get("z"));
  if (Number.isFinite(z) && z > 0) {
    const cx = Number(q.get("cx")), cy = Number(q.get("cy"));
    view.setView(z, Number.isFinite(cx) ? cx : undefined, Number.isFinite(cy) ? cy : undefined);
  }
}

function wireHud() {
  document.getElementById("zoom-in")!.addEventListener("click", () => view?.zoomBy(1.35));
  document.getElementById("zoom-out")!.addEventListener("click", () => view?.zoomBy(1 / 1.35));
  document.getElementById("zoom-fit")!.addEventListener("click", () => { view?.fit(); view?.trace(null); });
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

  // inline 3D structure — no page navigation
  const status = el("p.muted", { style: "font-size:var(--step--1)" }, ["Loading structure…"]);
  const host = el("div", { id: "mol3d" });
  body.append(host, status);
  const viewer = await renderStructure(host as HTMLElement, { uniprot: r.uniprot, pdb: r.pdb }, (m) => { status.textContent = m; });
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
    body.append(el("a", { href: asset(`protein.html?uniprot=${r.uniprot ?? ""}&name=${encodeURIComponent(r.enzymeName || "")}`), style: "font-size:var(--step--1)" }, ["Open full structure viewer →"]));
  }
}

main().catch((e) => {
  console.error(e);
  document.getElementById("chart-title")!.textContent = "Could not load the chart";
});

import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/explore.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, xrefUrl } from "../lib/util";
import { loadArrows, type ArrowRegistry } from "../lib/arrows";
import cytoscape from "cytoscape";
// @ts-expect-error — plugin has no bundled types
import fcose from "cytoscape-fcose";

cytoscape.use(fcose);
mountChrome("explore");

interface GNode { id: string; kind: string; label: string; pathways: string[]; data: Record<string, any>; }
interface GEdge { id: string; type: string; source: string; target: string; pathway?: string; effect?: string; mechanism?: string; }
interface Master { pathways: { id: string; name: string; category: string; counts: Record<string, number> }[]; nodes: GNode[]; edges: GEdge[]; stats: Record<string, number>; }

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

function cyArrowShape(head: string): string {
  const h = head.replace("-both", "");
  return ({ triangle: "triangle", vee: "vee", tee: "tee", circle: "circle", diamond: "diamond", open: "vee", curve: "vee", none: "none" } as Record<string, string>)[h] || "triangle";
}

function buildStyles(reg: ArrowRegistry): cytoscape.StylesheetJSON {
  const nodeColor: Record<string, string> = {
    metabolite: cssVar("--node-metabolite"), enzyme: cssVar("--node-enzyme"), reaction: cssVar("--node-reaction"),
    gene: cssVar("--node-gene"), complex: cssVar("--node-complex"), pathway: cssVar("--node-pathway"),
  };
  const styles: cytoscape.StylesheetJSON = [
    { selector: "node", style: {
      "background-color": (e: any) => nodeColor[e.data("kind")] || "#8aa0b6",
      "label": "data(label)", "color": cssVar("--text"), "font-size": 9, "font-family": "Inter, sans-serif",
      "text-valign": "center", "text-halign": "center", "text-margin-y": -12,
      "text-background-color": cssVar("--bg"), "text-background-opacity": 0.75, "text-background-padding": 2,
      "width": 16, "height": 16, "border-width": 0, "min-zoomed-font-size": 8,
    } },
    { selector: 'node[kind="metabolite"]', style: { shape: "ellipse", width: 20, height: 20 } },
    { selector: 'node[kind="enzyme"]', style: { shape: "round-rectangle", width: 26, height: 15 } },
    { selector: 'node[kind="reaction"]', style: { shape: "diamond", width: 12, height: 12, "background-opacity": 0.9 } },
    { selector: 'node[kind="gene"]', style: { shape: "round-rectangle", width: 22, height: 12 } },
    { selector: 'node[kind="complex"]', style: { shape: "octagon", width: 24, height: 24 } },
    { selector: 'node[kind="pathway"]', style: { shape: "round-rectangle", width: 40, height: 20, "font-size": 11 } },
    { selector: "node:selected", style: { "border-width": 3, "border-color": cssVar("--accent"), "text-background-opacity": 1 } },
    { selector: "node.faded", style: { opacity: 0.12 } },
    { selector: "node.hl", style: { "border-width": 3, "border-color": cssVar("--accent") } },
    { selector: "edge", style: {
      "curve-style": "bezier", "width": 1.6, "opacity": 0.85, "target-arrow-shape": "triangle",
      "line-color": "#8aa0b6", "target-arrow-color": "#8aa0b6", "arrow-scale": 0.9,
    } },
    { selector: "edge.faded", style: { opacity: 0.06 } },
  ];
  for (const [key, spec] of Object.entries(reg.arrows)) {
    const color = cssVar(spec.color);
    const shape = cyArrowShape(spec.head);
    const both = spec.head.endsWith("-both");
    styles.push({ selector: `edge[type="${key}"]`, style: {
      "line-color": color, "target-arrow-color": color, "source-arrow-color": color,
      "target-arrow-shape": shape, "source-arrow-shape": both ? shape : "none",
      "line-style": spec.line === "solid" ? "solid" : spec.line,
    } });
  }
  return styles;
}

async function main() {
  const [reg, master] = await Promise.all([loadArrows(), getJSON<Master>("graph/master.json")]);
  const hint = document.querySelector<HTMLElement>(".stage__hint");
  if (hint) hint.remove();

  const elements: cytoscape.ElementDefinition[] = [
    ...master.nodes.map((n) => ({ data: { id: n.id, kind: n.kind, label: n.label, pathways: n.pathways, payload: n.data } })),
    ...master.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, type: e.type, pathway: e.pathway, effect: e.effect, mechanism: e.mechanism } })),
  ];

  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    style: buildStyles(reg),
    layout: { name: "fcose", quality: "default", animate: false, nodeSeparation: 90, idealEdgeLength: 62, nodeRepulsion: 5200 } as any,
    minZoom: 0.15, maxZoom: 3.5, wheelSensitivity: 0.25,
    pixelRatio: Math.min(devicePixelRatio, 2),
  });
  (window as any).__cy = cy;

  // filters
  buildPathwayFilter(master, cy);
  wireSearch(cy);
  wireTools(cy);

  cy.on("tap", "node", (evt) => openDrawer(evt.target, reg));
  cy.on("tap", (evt) => { if (evt.target === cy) { closeDrawer(); cy.elements().removeClass("faded hl"); } });

  // theme re-style
  const obs = new MutationObserver(() => cy.style(buildStyles(reg)));
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function buildPathwayFilter(master: Master, cy: cytoscape.Core) {
  const host = document.getElementById("pathway-filter");
  if (!host) return;
  const active = new Set(master.pathways.map((p) => p.id));
  for (const p of master.pathways) {
    const cb = el("input", { type: "checkbox", checked: true, value: p.id }) as HTMLInputElement;
    cb.addEventListener("change", () => {
      cb.checked ? active.add(p.id) : active.delete(p.id);
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          const ps: string[] = n.data("pathways") || [];
          n.style("display", ps.some((x) => active.has(x)) ? "element" : "none");
        });
        cy.edges().forEach((e) => e.style("display", active.has(e.data("pathway")) ? "element" : "none"));
      });
    });
    host.append(el("label.rowcheck", {}, [cb, el("span", {}, [`${p.name}`]), el("span.muted", { style: "margin-left:auto;font-family:var(--font-mono);font-size:var(--step--1)" }, [String(p.counts.reactions)])]));
  }
}

function wireSearch(cy: cytoscape.Core) {
  const input = document.getElementById("node-search") as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    cy.elements().removeClass("faded hl");
    if (!q) return;
    const matches = cy.nodes().filter((n) => n.data("label").toLowerCase().includes(q));
    if (!matches.length) return;
    cy.elements().addClass("faded");
    matches.removeClass("faded").addClass("hl");
    matches.connectedEdges().removeClass("faded");
    matches.neighborhood().removeClass("faded");
    cy.animate({ fit: { eles: matches, padding: 80 }, duration: 350 });
  });
}

function wireTools(cy: cytoscape.Core) {
  document.getElementById("tool-fit")?.addEventListener("click", () => cy.animate({ fit: { eles: cy.elements(), padding: 40 }, duration: 300 }));
  document.getElementById("tool-relayout")?.addEventListener("click", () => cy.layout({ name: "fcose", animate: true, animationDuration: 600 } as any).run());
  document.getElementById("rail-toggle")?.addEventListener("click", () => {
    const r = document.querySelector(".rail");
    r?.setAttribute("data-open", r.getAttribute("data-open") === "true" ? "false" : "true");
  });
}

function openDrawer(node: cytoscape.NodeSingular, _reg: ArrowRegistry) {
  const drawer = document.getElementById("drawer")!;
  const body = document.getElementById("drawer-body")!;
  const kind = node.data("kind");
  const p = node.data("payload") || {};
  body.replaceChildren();

  body.append(el("div", {}, [el("span.drawer__kind", { style: `color:var(--node-${kind})` }, [kind])]));
  body.append(el("h2", {}, [node.data("label")]));

  const chips = el("div.chips");
  const xr = p.xrefs || {};
  if (Array.isArray(p.ec)) for (const ec of p.ec) chips.append(chip(`EC ${ec}`, xrefUrl("brenda", ec)));
  else if (p.ec) chips.append(chip(`EC ${p.ec}`));
  if (p.gene) chips.append(chip(p.gene));
  if (p.formula) chips.append(chip(p.formula));
  for (const [db, id] of Object.entries(xr)) {
    if (Array.isArray(id)) id.forEach((v) => chips.append(chip(`${db}:${v}`, xrefUrl(db, String(v)))));
    else if (id) chips.append(chip(`${db}:${id}`, xrefUrl(db, String(id))));
  }
  if (chips.childElementCount) body.append(chips);

  if (kind === "reaction") body.append(...reactionDetail(p));
  if (p.description) body.append(el("p", {}, [p.description]));

  if (kind === "enzyme" && (xr.alphafold || xr.uniprot || (xr.pdb && xr.pdb.length))) {
    const q = new URLSearchParams();
    if (xr.uniprot || xr.alphafold) q.set("uniprot", xr.uniprot || xr.alphafold);
    if (xr.pdb?.length) q.set("pdb", xr.pdb[0]);
    q.set("name", node.data("label"));
    body.append(el("a.btn", { href: `protein.html?${q.toString()}` }, ["View 3D structure →"]));
  }

  const prov = p.provenance;
  if (prov?.confidence) {
    body.append(el("div", { style: "border-top:1px solid var(--line);padding-top:.75rem;margin-top:.5rem" }, [
      el("span.conf", { "data-c": prov.confidence }, [`confidence: ${prov.confidence}`]),
    ]));
  }

  // neighborhood focus
  node.cy().elements().addClass("faded");
  node.removeClass("faded").addClass("hl");
  node.neighborhood().removeClass("faded");
  node.connectedEdges().removeClass("faded");

  drawer.setAttribute("data-open", "true");
}

function reactionDetail(p: Record<string, any>): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (p.equation) out.push(el("div.reaction-eq", {}, [p.equation]));
  const kv = el("dl.kv");
  const add = (k: string, v: string) => { kv.append(el("dt", {}, [k]), el("dd", {}, [v])); };
  if (p.reversibility) add("direction", p.reversibility);
  if (p.rateLimiting) add("role", "rate-limiting step");
  if (p.compartment) add("compartment", p.compartment);
  if (p.deltaGPrimeKjPerMol != null) add("ΔG°′", `${p.deltaGPrimeKjPerMol} kJ/mol`);
  if (kv.childElementCount) out.push(kv);
  return out;
}

function chip(text: string, href?: string | null): HTMLElement {
  if (href) return el("a.chip", { href, target: "_blank", rel: "noopener" }, [text]);
  return el("span.chip", {}, [text]);
}

function closeDrawer() {
  document.getElementById("drawer")?.setAttribute("data-open", "false");
}
document.getElementById("drawer-close")?.addEventListener("click", () => { closeDrawer(); (window as any).__cy?.elements().removeClass("faded hl"); });

main().catch((err) => {
  console.error(err);
  const hint = document.querySelector<HTMLElement>(".stage__hint");
  if (hint) hint.textContent = "Could not load the graph. Try rebuilding the data (npm run data:build).";
});

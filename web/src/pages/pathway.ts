import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/page.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, asset } from "../lib/util";

mountChrome("");

interface Sub { id: string; name: string; nodes: { id: string; kind: string; label: string; data: any }[]; edges: any[]; }

const id = new URLSearchParams(location.search).get("id") || "glycolysis";

async function main() {
  const root = document.getElementById("pathway-root")!;
  let sub: Sub;
  try { sub = await getJSON<Sub>(`graph/pathways/${id}.json`); }
  catch { root.innerHTML = `<p class="muted">Pathway "${id}" not found. <a href="${asset("explore.html")}">Open the chart →</a></p>`; return; }

  document.title = `${sub.name} — Metabolian`;
  const reactions = sub.nodes.filter((n) => n.kind === "reaction").sort((a, b) => (a.data.pathwayStep ?? 0) - (b.data.pathwayStep ?? 0));
  const enzymes = new Map(sub.nodes.filter((n) => n.kind === "enzyme").map((n) => [n.id, n]));

  root.replaceChildren(
    el("header.page-head", {}, [el("div", {}, [
      el("p.eyebrow", {}, ["Pathway"]),
      el("h1", {}, [sub.name]),
      el("p.lead", {}, [`${reactions.length} reactions · ${enzymes.size} enzymes`]),
      el("div", { style: "margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap" }, [
        el("a.btn", { href: asset(`explore.html`) }, ["Open in the interactive chart →"]),
      ]),
    ])]),
  );

  const list = el("ol.stack", { style: "list-style:none;padding:0;counter-reset:step" });
  for (const r of reactions) {
    const cats = (r.data.catalysts || []).map((c: any) => {
      const enz = [...enzymes.values()].find((e) => e.data.id === c.enzyme);
      return enz?.label || c.enzyme;
    });
    list.append(el("li.card", { style: "display:grid;gap:.4rem" }, [
      el("div", { style: "display:flex;gap:.6rem;align-items:baseline" }, [
        el("span", { style: "font-family:var(--font-mono);color:var(--accent)" }, [`${r.data.pathwayStep ?? "•"}`]),
        el("strong", { style: "color:var(--text)" }, [r.label]),
        ...(r.data.ec ? [el("span.chip", { style: "margin-left:auto" }, [`EC ${r.data.ec}`])] : []),
      ]),
      ...(r.data.equation ? [el("div.reaction-eq", {}, [r.data.equation])] : []),
      el("p.muted", { style: "font-size:var(--step--1)" }, [
        `${r.data.reversibility || "unknown"} · ${cats.length ? "catalyzed by " + cats.join(", ") : ""}`,
      ]),
    ]));
  }
  root.append(el("div.wrap.section", {}, [list]));
}

main();

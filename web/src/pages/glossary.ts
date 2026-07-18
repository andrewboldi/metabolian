import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/page.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, xrefUrl, fmt } from "../lib/util";

mountChrome("glossary");

interface Term { id: string; kind: string; name: string; description?: string; formula?: string; ec?: string[]; gene?: string; xrefs?: Record<string, any>; pathways: string[]; }

let terms: Term[] = [];
let kindFilter = "all";
let query = "";

async function main() {
  const list = document.getElementById("glossary-list")!;
  try {
    terms = await getJSON<Term[]>("graph/glossary.json");
  } catch {
    list.innerHTML = "<p class='muted'>Glossary data unavailable — run <code>npm run data:build</code>.</p>";
    return;
  }
  wireControls();
  render();
}

function wireControls() {
  const search = document.getElementById("glossary-search") as HTMLInputElement;
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
  for (const pill of document.querySelectorAll<HTMLButtonElement>(".pill")) {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".pill").forEach((p) => p.setAttribute("aria-pressed", "false"));
      pill.setAttribute("aria-pressed", "true");
      kindFilter = pill.dataset.kind!;
      render();
    });
  }
}

function render() {
  const list = document.getElementById("glossary-list")!;
  const note = document.getElementById("glossary-count")!;
  const filtered = terms.filter((t) =>
    (kindFilter === "all" || t.kind === kindFilter) &&
    (!query || t.name.toLowerCase().includes(query) || (t.description || "").toLowerCase().includes(query) || (t.gene || "").toLowerCase().includes(query)),
  );
  note.textContent = `${fmt(filtered.length)} of ${fmt(terms.length)} terms`;
  list.replaceChildren(...filtered.slice(0, 400).map(termCard));
  if (filtered.length > 400) list.append(el("p.muted", { style: "grid-column:1/-1" }, [`Showing first 400. Refine your search to narrow ${fmt(filtered.length)} matches.`]));
  if (!filtered.length) list.append(el("p.muted", { style: "grid-column:1/-1" }, ["No terms match your search."]));
}

function termCard(t: Term): HTMLElement {
  const chips = el("div.chips");
  if (t.formula) chips.append(el("span.chip", {}, [t.formula]));
  if (t.ec) t.ec.forEach((ec) => chips.append(el("a.chip", { href: xrefUrl("brenda", ec) || "#", target: "_blank", rel: "noopener" }, [`EC ${ec}`])));
  if (t.gene) chips.append(el("span.chip", {}, [t.gene]));
  for (const [db, id] of Object.entries(t.xrefs || {})) {
    const v = Array.isArray(id) ? id[0] : id;
    if (!v) continue;
    const url = xrefUrl(db, String(v));
    if (url) chips.append(el("a.chip", { href: url, target: "_blank", rel: "noopener" }, [`${db}`]));
  }
  return el("article.term", {}, [
    el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:.5rem" }, [
      el("span.term__name", {}, [t.name]),
      el("span.term__kind", { "data-k": t.kind }, [t.kind]),
    ]),
    ...(t.description ? [el("p.muted", { style: "font-size:var(--step--1);margin-top:.4rem" }, [t.description])] : []),
    chips,
  ]);
}

main();

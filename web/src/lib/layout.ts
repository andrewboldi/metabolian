// Shared chrome: header/nav/footer injected into every page. Keeps markup DRY
// and nav consistent. Call mountChrome(activeRouteId) from each page entry.

// Self-hosted fonts (no external CDN → no CSP/privacy issues, no layout shift).
// Only the weights actually used across the site; the browser fetches on demand.
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import { initTheme, toggleTheme } from "./theme";
import { asset, el } from "./util";

const NAV = [
  { id: "chart", label: "The Chart", href: "chart.html" },
  { id: "explore", label: "Explore", href: "explore.html" },
  { id: "learn", label: "Learn", href: "learn.html" },
  { id: "glossary", label: "Glossary", href: "glossary.html" },
  { id: "about", label: "About", href: "about.html" },
];

const MARK = `<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16 2 27.7 9v14L16 30 4.3 23V9z" stroke="var(--accent)" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="3.2" fill="var(--accent)"/>
  <circle cx="16" cy="6.5" r="1.8" fill="var(--accent)"/>
  <circle cx="25" cy="21" r="1.8" fill="var(--accent)"/>
  <circle cx="7" cy="21" r="1.8" fill="var(--accent)"/>
  <path d="M16 9.7V13M18.7 17.6 23 20M13.3 17.6 9 20" stroke="var(--accent)" stroke-width="1.2" opacity="0.7"/>
</svg>`;

export function mountChrome(active = ""): void {
  initTheme();

  const nav = el("nav.nav", { id: "site-nav", "aria-label": "Primary" },
    NAV.map((n) => el("a", { href: asset(n.href), ...(n.id === active ? { "aria-current": "page" } : {}) }, [n.label])),
  );
  const themeBtn = el("button.icon-btn", { type: "button", "aria-label": "Toggle color theme", title: "Toggle theme", onclick: () => toggleTheme() }, [themeIcon()]);
  nav.append(themeBtn, el("a.btn.btn--ghost", { href: asset("login.html"), style: "padding:.4rem .8rem" }, ["Sign in"]));

  const toggle = el("button.icon-btn.nav-toggle", { type: "button", "aria-label": "Menu", "aria-expanded": "false", onclick: (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const open = nav.getAttribute("data-open") === "true";
    nav.setAttribute("data-open", String(!open));
    b.setAttribute("aria-expanded", String(!open));
  } }, ["☰"]);

  const header = el("header.site-header", {}, [
    el("div.wrap", {}, [
      el("div.site-header__inner", {}, [
        el("a.brand", { href: asset("index.html"), "aria-label": "Metabolian home", html: MARK + "<span>Metabolian</span>" }),
        toggle, nav,
      ]),
    ]),
  ]);

  const host = document.getElementById("app-header");
  if (host) host.replaceWith(header); else document.body.prepend(header);

  mountFooter();
}

function themeIcon(): HTMLElement {
  return el("span", { "aria-hidden": "true", html: "◐" });
}

function mountFooter(): void {
  const footer = el("footer.site-footer", {}, [
    el("div.wrap", {}, [
      el("div.footer-grid", {}, [
        el("div", {}, [
          el("a.brand", { href: asset("index.html"), html: MARK + "<span>Metabolian</span>" }),
          el("p.muted", { style: "margin-top:.75rem;max-width:34ch" }, [
            "An open, citation-grounded, interactive atlas of metabolism — a living successor to the Roche Biochemical Pathways chart.",
          ]),
        ]),
        footerCol("Atlas", [["Explore the chart", "explore.html"], ["Glossary", "glossary.html"], ["Learn", "learn.html"]]),
        footerCol("Project", [["About & method", "about.html"], ["Data schema", "about.html#schema"], ["GitHub", "https://github.com/andrewboldi/metabolian"]]),
        footerCol("Sources", [["KEGG", "https://www.kegg.jp"], ["Reactome", "https://reactome.org"], ["UniProt", "https://uniprot.org"], ["AlphaFold DB", "https://alphafold.ebi.ac.uk"]]),
      ]),
      el("p.muted", { style: "margin-top:2.5rem;font-size:var(--step--1)" }, [
        "Metabolian is an educational and research aggregation, not medical advice. Every reaction links to its primary source; confidence levels are shown so you can audit the data.",
      ]),
    ]),
  ]);
  const host = document.getElementById("app-footer");
  if (host) host.replaceWith(footer); else document.body.append(footer);
}

function footerCol(title: string, links: [string, string][]): HTMLElement {
  return el("div", {}, [
    el("div.footer-col-title", {}, [title]),
    el("ul", {}, links.map(([label, href]) =>
      el("li", {}, [el("a", { href: href.startsWith("http") ? href : asset(href) }, [label])]),
    )),
  ]);
}

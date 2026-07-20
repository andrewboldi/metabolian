/**
 * Shared chrome — masthead, primary nav, colophon.
 *
 * Every page entry calls mountChrome(), chart.ts included, so this module sits
 * on the critical path nine times over. Three rules follow from that:
 *
 *  1. Cheap. No fetches, no forced layout during mount. The header is built
 *     detached and inserted in one shot; the only measurement happens in a
 *     ResizeObserver callback, i.e. after layout, never during it.
 *  2. Additive. The redesign owns .site-header / .nav / .brand / .icon-btn /
 *     .site-footer in base.css. Nothing here restyles those; the small
 *     stylesheet below covers only hooks this module introduces, so both files
 *     land instead of fighting.
 *  3. Backwards compatible. mountChrome(active?) is the whole public surface
 *     and its signature is unchanged. Passing "" now means "work it out from
 *     the URL" instead of "nothing is current", which is why pathway.html and
 *     protein.html finally highlight a nav entry without touching their files.
 *
 * Chrome is the instrument the sheet is mounted in: the accent is the chart's
 * own enzyme blue and hovers use the chart's own hover ink, both inherited
 * through tokens.css rather than hardcoded here.
 */

// Self-hosted type. No external CDN → no CSP hole, no privacy leak, no
// third-party round trip in front of first paint.
//
// Space Grotesk is deliberately gone: --font-display resolves to Inter now, so
// the chrome and the sheet are set in the SAME two faces — chart.css puts
// .met-name/.enz-name in Inter and .met-formula/.enz-ec in JetBrains Mono.
// Verified before removing it: "Space Grotesk" appears nowhere in chart.css,
// chart-view.ts, tools/build-chart.mjs or tools/mpl/, so it was never in the
// chart's measured-text path and dropping it cannot move a label.
//
// The imports that remain duplicate @font-face blocks already in tokens.css
// (byte-identical woff2 — md5-checked against node_modules/@fontsource/*/files).
// They are NOT deduped here, on purpose:
//   • tokens.css declares Inter/JBM with no unicode-range and only ships the
//     latin subsets. @fontsource carries greek/cyrillic/vietnamese behind their
//     own ranges, and that is what currently renders the α/β/γ in metabolite
//     names. Dropping these would push those glyphs to a system fallback with
//     different advance widths — precisely the failure tokens.css:5-12
//     documents (3 → 6 label overprints on the chart).
//   • JetBrains Mono 500 has no self-hosted counterpart at all; web/public/fonts
//     ships only jetbrains-mono-latin-400-normal.woff2.
// Reconciling the two pipelines is a separate change that has to be measured
// against the chart's overprint gate, not smuggled in with a nav redesign.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import { initTheme, toggleTheme } from "./theme";
import { asset, el } from "./util";

/** Site version, shown as instrument chrome. Matches the copy already on
 *  index.html and login.html; one constant so the three cannot drift. */
const VERSION = "v0.1";

const REPO = "https://github.com/andrewboldi/metabolian";

const NAV: ReadonlyArray<{ id: string; label: string; href: string }> = [
  { id: "chart", label: "The Chart", href: "chart.html" },
  { id: "explore", label: "Explore", href: "explore.html" },
  { id: "learn", label: "Learn", href: "learn.html" },
  { id: "glossary", label: "Glossary", href: "glossary.html" },
  { id: "about", label: "About", href: "about.html" },
];

/** Pages with no nav entry of their own that belong under one. Both are opened
 *  from the chart inspector, so the masthead should keep saying "The Chart". */
const SUBPAGE_PARENT: Readonly<Record<string, string>> = {
  "pathway.html": "chart",
  "protein.html": "chart",
};

/** Mirrors the breakpoint base.css turns .nav into a disclosure panel at. */
const MOBILE = "(max-width: 820px)";

/* --------------------------------------------------------------- chrome CSS */

/* Only the hooks this module introduces. Hairlines are box-shadow, never
   border, so they cost no layout space; every token has a literal fallback so
   the chrome is correct whether or not the new token block has landed yet. */
const CHROME_CSS = `
:root { --header-h: 58px; }

/* masthead ---------------------------------------------------------------- */
.brand__meta {
  font-family: var(--font-mono);
  font-size: var(--step--2, 0.6875rem);
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 0.36em 0.5em 0.3em;
  border-radius: var(--radius, 2px);
  box-shadow: var(--hairline, 0 0 0 1px color-mix(in oklab, currentColor 34%, transparent));
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
  align-self: center;
  margin-left: 0.15rem;
}
@media (max-width: 1040px) { .brand__meta { display: none; } }

.nav__sep {
  flex: none;
  width: 1px;
  height: 20px;
  margin-inline: 0.4rem;
  background: var(--line-strong, currentColor);
  opacity: 0.55;
}

/* Current page is signalled by more than colour: the sheet's hover ink plus a
   2px rule, so it survives greyscale and colour-vision deficiency. */
.nav a.is-current {
  color: var(--mark, var(--accent));
  box-shadow: inset 0 -2px 0 0 currentColor;
}

.theme-toggle svg { width: 17px; height: 17px; display: block; }
.theme-toggle [data-glyph] { display: none; }
.theme-toggle[data-theme-state="dark"] [data-glyph="sun"] { display: block; }
.theme-toggle[data-theme-state="light"] [data-glyph="moon"] { display: block; }

/* Drafting-instrument menu button: three hairlines that fold into a cross. */
.nav-toggle__bars { display: block; position: relative; width: 16px; height: 12px; }
.nav-toggle__bars i {
  position: absolute; left: 0; right: 0; height: 1.5px; border-radius: 1px;
  background: currentColor;
}
.nav-toggle__bars i:nth-child(1) { top: 0; }
.nav-toggle__bars i:nth-child(2) { top: 5.25px; }
.nav-toggle__bars i:nth-child(3) { top: 10.5px; }
/* Motion is opt-in, never opt-out: with reduced motion the bars simply swap. */
@media (prefers-reduced-motion: no-preference) {
  .nav-toggle__bars i {
    transition: var(--t-base, 180ms) var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
    transition-property: transform, opacity;
  }
}
.nav-toggle[aria-expanded="true"] .nav-toggle__bars i:nth-child(1) { transform: translateY(5.25px) rotate(45deg); }
.nav-toggle[aria-expanded="true"] .nav-toggle__bars i:nth-child(2) { opacity: 0; }
.nav-toggle[aria-expanded="true"] .nav-toggle__bars i:nth-child(3) { transform: translateY(-5.25px) rotate(-45deg); }

.nav__cta { padding: 0.42rem 0.85rem; font-size: var(--step--1); }

/* display:contents keeps the two controls as direct flex children of .nav on
   desktop — base.css's masthead layout is untouched — and only becomes a real
   box in the mobile panel, where they should share a row instead of stacking. */
.nav__actions { display: contents; }

/* colophon ---------------------------------------------------------------- */
.footer-brand { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; }
.footer-mission { max-width: 34ch; font-size: var(--step--1); color: var(--text-faint); }
.footer-note,
.footer-colophon {
  /* inset hairline: a rule that occupies no layout space */
  box-shadow: inset 0 1px 0 0 var(--line, rgba(128, 128, 128, 0.22));
}
.footer-note {
  margin-top: var(--sp-6, 2rem);
  padding-top: var(--sp-4, 1rem);
  max-width: 88ch;
  font-size: var(--step--1);
  color: var(--text-faint);
}
.footer-colophon {
  margin-top: var(--sp-4, 1rem);
  padding-top: var(--sp-4, 1rem);
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem 1.35rem;
  font-family: var(--font-mono);
  font-size: var(--step--2, 0.6875rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums lining-nums;
}
.footer-colophon a { color: inherit; }
.is-ext::after { content: "↗"; margin-left: 0.28em; font-size: 0.85em; opacity: 0.65; }

/* The footer columns are navigation, not running prose, so the standing
   underline base.css puts on `li a` does not buy the WCAG distinguishability it
   is there for — it just prints 13 rules across the colophon. Underline on
   hover instead, in the sheet's own hover ink. */
.site-footer .footer-grid a,
.site-footer .brand,
.footer-colophon a { text-decoration: none; }
.site-footer .footer-grid ul a { line-height: var(--lead-label, 1.3); display: inline-block; }
@media (any-hover: hover) {
  .footer-colophon a:hover,
  .site-footer .footer-grid a:hover {
    color: var(--mark, var(--accent));
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}

/* mobile disclosure ------------------------------------------------------- */
@media (max-width: 820px) {
  /* base.css hardcodes 58px; publish the measured height so the panel stays
     pinned to the masthead when the type scale or the chip changes it. */
  .nav { top: var(--header-h, 58px); max-height: calc(100dvh - var(--header-h, 58px)); overflow-y: auto; }
  .nav__sep { width: auto; height: 1px; margin: 0.45rem 0; }
  .brand__meta { display: none; }
  .nav__actions { display: flex; align-items: center; gap: 0.5rem; }
  .nav__actions .nav__cta { flex: 1; justify-content: center; }
}
`;

function injectChromeStyles(): void {
  if (document.getElementById("chrome-css")) return;
  const style = document.createElement("style");
  style.id = "chrome-css";
  style.textContent = CHROME_CSS;
  document.head.append(style);
}

/* ------------------------------------------------------------------ marks */

const MARK = `<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16 2 27.7 9v14L16 30 4.3 23V9z" stroke="var(--accent)" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="3.2" fill="var(--accent)"/>
  <circle cx="16" cy="6.5" r="1.8" fill="var(--accent)"/>
  <circle cx="25" cy="21" r="1.8" fill="var(--accent)"/>
  <circle cx="7" cy="21" r="1.8" fill="var(--accent)"/>
  <path d="M16 9.7V13M18.7 17.6 23 20M13.3 17.6 9 20" stroke="var(--accent)" stroke-width="1.2" opacity="0.7"/>
</svg>`;

/* Both glyphs ship; CSS reveals the one for the theme you would switch TO. */
const THEME_GLYPHS = `<svg data-glyph="sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.5"/>
  <path d="M12 2.7v2.5M12 18.8v2.5M2.7 12h2.5M18.8 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg><svg data-glyph="moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M20.2 14.6A8.7 8.7 0 0 1 9.4 3.8a8.7 8.7 0 1 0 10.8 10.8Z"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const MENU_BARS = `<span class="nav-toggle__bars" aria-hidden="true"><i></i><i></i><i></i></span>`;

/* ------------------------------------------------------------------- mount */

export function mountChrome(active = ""): void {
  // Idempotent: a second call would otherwise stack a second masthead, since
  // the #app-header placeholder is consumed by the first.
  if (document.querySelector(".site-header")) return;

  // localStorage throws, not returns null, when storage is blocked (Safari with
  // cookies disabled). Chrome must not take the page down with it.
  try { initTheme(); } catch { /* storage unavailable — fall back to the authored theme */ }

  injectChromeStyles();
  ensureSkipLink();

  const file = currentFile();
  const current = resolveActive(active, file);

  const links = NAV.map((n) =>
    el("a", {
      href: asset(n.href),
      ...(n.id === current ? { "aria-current": "page", class: "is-current" } : {}),
    }, [n.label]),
  );

  const nav = el("nav.nav", { id: "site-nav", "aria-label": "Primary" }, links);
  nav.append(
    el("span.nav__sep", { "aria-hidden": "true" }),
    el("div.nav__actions", {}, [
      themeToggle(),
      el("a.btn.btn--ghost.nav__cta", {
        href: asset("login.html"),
        ...(file === "login.html" ? { "aria-current": "page" } : {}),
      }, ["Sign in"]),
    ]),
  );

  const menuBtn = el("button.icon-btn.nav-toggle", {
    type: "button",
    "aria-label": "Menu",
    "aria-expanded": "false",
    "aria-controls": "site-nav",
    html: MENU_BARS,
  }) as HTMLButtonElement;

  const header = el("header.site-header", {}, [
    el("div.wrap", {}, [
      el("div.site-header__inner", {}, [
        el("a.brand", {
          href: asset("index.html"),
          "aria-label": "Metabolian home",
          html: MARK + "<span>Metabolian</span>",
        }),
        el("span.brand__meta", { "aria-hidden": "true" }, [`Atlas ${VERSION}`]),
        menuBtn,
        nav,
      ]),
    ]),
  ]);

  wireDisclosure(header, nav, menuBtn);

  const host = document.getElementById("app-header");
  if (host) host.replaceWith(header); else document.body.prepend(header);

  trackHeaderMetrics(header);
  mountFooter();
}

/* --------------------------------------------------------------- wayfinding */

function currentFile(): string {
  const last = location.pathname.split("/").pop() ?? "";
  return last === "" ? "index.html" : last;
}

/** An explicit id always wins; "" means infer, so sub-pages light up their
 *  parent without their entry files having to know the nav exists. */
function resolveActive(explicit: string, file: string): string {
  if (explicit) return explicit;
  return NAV.find((n) => n.href === file)?.id ?? SUBPAGE_PARENT[file] ?? "";
}

/**
 * Some pages author a skip link, some don't. Two separate repairs, and the
 * focusability one has to happen either way — an authored link whose target
 * cannot take focus is a link that silently does nothing.
 */
function ensureSkipLink(): void {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.id) main.id = "main";
  // Without tabindex the fragment jump scrolls but never moves focus in Chrome
  // or Safari: the next Tab continues from the masthead, i.e. the skip skipped
  // nothing. This is the whole reason the affordance exists.
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  if (document.querySelector("a.skip")) return;
  document.body.prepend(el("a.skip", { href: `#${main.id}` }, ["Skip to content"]));
}

/* -------------------------------------------------------------------- theme */

type Theme = "dark" | "light";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function themeToggle(): HTMLElement {
  const btn = el("button.icon-btn.theme-toggle", { type: "button", html: THEME_GLYPHS });
  syncThemeToggle(btn);
  btn.addEventListener("click", () => {
    try { toggleTheme(); } catch { /* storage blocked; the attribute still flipped */ }
    syncThemeToggle(btn);
    paintThemeColor();
  });
  return btn;
}

/** The control is labelled by what it will do, not by what is on screen — the
 *  one phrasing that reads correctly out of a screen reader. */
function syncThemeToggle(btn: HTMLElement): void {
  const now = currentTheme();
  const next = now === "dark" ? "light" : "dark";
  btn.setAttribute("data-theme-state", now);
  btn.setAttribute("aria-label", `Switch to ${next} theme`);
  btn.setAttribute("title", `Switch to ${next} theme`);
}

/** Keep the mobile browser's own chrome on the same field as the page. */
function paintThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = bg;
}

/* ---------------------------------------------------------------- disclosure */

function wireDisclosure(header: HTMLElement, nav: HTMLElement, btn: HTMLButtonElement): void {
  const mq = matchMedia(MOBILE);
  let open = false;

  const apply = (): void => {
    nav.setAttribute("data-open", String(open));
    btn.setAttribute("aria-expanded", String(open));
    // Closed, the panel is only translated off-screen — still in the tab order
    // and still hit-testable. inert removes it from both without disturbing the
    // transform transition. Desktop must never be inert.
    nav.toggleAttribute("inert", mq.matches && !open);
  };

  const setOpen = (next: boolean, restoreFocus = false): void => {
    if (open === next) return;
    open = next;
    apply();
    if (!next && restoreFocus) btn.focus();
  };

  btn.addEventListener("click", () => setOpen(!open));

  // Escape closes and hands focus back — the panel is a disclosure, so focus
  // has to return to the control that opened it.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) setOpen(false, true);
  });

  // A tap anywhere off the masthead dismisses it, the way a menu should.
  // Passive: this never calls preventDefault, and chart.html pans on pointer
  // events — a non-passive document listener there is a scroll-blocking one.
  document.addEventListener("pointerdown", (e) => {
    if (open && !header.contains(e.target as Node)) setOpen(false);
  }, { passive: true });

  // Same-document targets (a #hash link) would otherwise leave the panel up.
  nav.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) setOpen(false);
  });

  // Resizing past the breakpoint with the panel open must not strand an inert
  // desktop nav or a half-open panel.
  mq.addEventListener("change", () => { open = false; apply(); });

  apply();
}

/** Publish the real masthead height so sticky offsets and the mobile panel stop
 *  guessing 58px. ResizeObserver fires after layout, so this never forces one —
 *  and it picks up the reflow when the webfonts swap in. */
function trackHeaderMetrics(header: HTMLElement): void {
  const set = (): void => {
    const h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--header-h", `${h}px`);
  };
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => { set(); });
    ro.observe(header);
  } else {
    requestAnimationFrame(set);
  }
  // Deferred so the first paint owes it nothing.
  requestAnimationFrame(paintThemeColor);
}

/* ------------------------------------------------------------------- footer */

type Link = [label: string, href: string];

function mountFooter(): void {
  const footer = el("footer.site-footer", {}, [
    el("div.wrap", {}, [
      el("div.footer-grid", {}, [
        el("div.footer-brand", {}, [
          el("a.brand", { href: asset("index.html"), html: MARK + "<span>Metabolian</span>" }),
          el("p.footer-mission", {}, [
            "An open, citation-grounded, interactive atlas of metabolism — a living successor to the Roche Biochemical Pathways chart.",
          ]),
        ]),
        footerCol("Atlas", [
          ["The Chart", "chart.html"],
          ["Explore a compound", "explore.html"],
          ["Glossary", "glossary.html"],
          ["Learn", "learn.html"],
        ]),
        footerCol("Project", [
          ["About & method", "about.html"],
          ["Data schema", "about.html#schema"],
          ["Source & issues", REPO],
        ]),
        // Ordered by how much of the atlas each one actually grounds, and
        // trimmed to the databases the data really cites: across data/pathways
        // ChEBI appears ~42k times, MetaNetX ~39k, Rhea ~13k, KEGG ~1.1k,
        // UniProt ~400, AlphaFold ~380. Reactome used to be listed here and is
        // cited ~49 times in the whole corpus — on a citation-grounded atlas,
        // advertising a source that grounds ~0.05% of it is the one kind of
        // error this project cannot afford, so it is gone.
        footerCol("Sources", [
          ["Rhea", "https://www.rhea-db.org"],
          ["ChEBI", "https://www.ebi.ac.uk/chebi"],
          ["MetaNetX", "https://www.metanetx.org"],
          ["KEGG", "https://www.kegg.jp"],
          ["UniProt", "https://uniprot.org"],
          ["AlphaFold DB", "https://alphafold.ebi.ac.uk"],
        ]),
      ]),
      el("p.footer-note", {}, [
        "Metabolian is an educational and research aggregation, not medical advice. Every reaction links to its primary source; confidence levels are shown so you can audit the data.",
      ]),
      // Deliberately carries no entity counts. They live in graph/index.json and
      // would need a fetch on every page to stay true; a hardcoded number here
      // would be wrong the first time a module is added.
      el("div.footer-colophon", {}, [
        el("span", {}, [`Metabolian ${VERSION}`]),
        el("a.is-ext", { href: REPO, rel: "noopener" }, ["Open source · MIT"]),
        el("span", {}, ["Built on Rhea, ChEBI & MetaNetX"]),
      ]),
    ]),
  ]);

  const host = document.getElementById("app-footer");
  if (host) host.replaceWith(footer); else document.body.append(footer);
}

function footerCol(title: string, links: Link[]): HTMLElement {
  return el("div", {}, [
    el("div.footer-col-title", {}, [title]),
    el("ul", {}, links.map(([label, href]) => {
      const external = href.startsWith("http");
      return el("li", {}, [
        el(external ? "a.is-ext" : "a", {
          href: external ? href : asset(href),
          ...(external ? { rel: "noopener" } : {}),
        }, [label]),
      ]);
    })),
  ]);
}

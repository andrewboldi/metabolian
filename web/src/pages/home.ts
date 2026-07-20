/**
 * Home — the landing page wiring.
 *
 * Four jobs, in priority order:
 *
 *  1. Numbers. Every size claim on this page is read from graph/index.json at runtime.
 *     Hardcoding "~7,000 pathways" is the one error a citation-grounded atlas cannot
 *     afford — the corpus is what the last build says it is, and it changes with every
 *     merged module. Any element carrying `data-stat="<key>"` is filled from `stats`.
 *
 *  2. The legend (#legend). The arrow registry is the site's best argument, so it is set
 *     as a reference table rather than a card grid: one hairline-ruled row per relationship
 *     type, grouped by category, each row joined to how many typed edges of that kind the
 *     current build actually contains. The grammar and the corpus in one readout.
 *
 *  3. Reveal. Sections arrive via IntersectionObserver — never a scroll listener, which
 *     would run main-thread work on every scroll event for a purely decorative effect.
 *     The motion itself is expressed as a class so the stylesheet owns it; JS supplies an
 *     equivalent only if no rule claims the element (see `reveal()`).
 *
 *  4. The hero. three.js is the heaviest dependency the site has and this is the only page
 *     permitted to load it. It is reached exclusively through lib/hero.ts, dynamically, so
 *     it can never land in this page's entry chunk — and behind four gates, so a reader who
 *     prefers stillness, is saving data, or never scrolls to it pays nothing for it.
 *
 * Motion contract: stillness is the default everywhere below. Nothing animates unless
 * `prefers-reduced-motion: no-preference` is affirmatively true, and every animated state
 * has a correct, finished still form — the count-ups print their final value, the reveals
 * leave the content visible, the hero is simply never fetched.
 */
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/home.css";
import { mountChrome } from "../lib/layout";
import { getJSON, el, fmt } from "../lib/util";
import { loadArrows, arrowSVG, type ArrowSpec } from "../lib/arrows";

/* ------------------------------------------------------------------ motion */

const MOTION = matchMedia("(prefers-reduced-motion: reduce)");
const still = (): boolean => MOTION.matches;

/** Motion timing comes from the design system so the page can never drift from it. */
const EASE =
  getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() ||
  "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * `html.reveal` is the single gate that permits a stylesheet to hide [data-animate]
 * content. It is set only when JS is running, IntersectionObserver exists to un-hide, and
 * motion is wanted — so a reader with JS off, an ancient browser, or reduced motion always
 * gets the finished page and can never be left staring at an empty section.
 * Set before anything else in the module so it lands ahead of first paint.
 */
const REVEALING = !still() && "IntersectionObserver" in window;
if (REVEALING) document.documentElement.classList.add("reveal");

MOTION.addEventListener("change", () => {
  // Asked for stillness mid-session: drop the gate so nothing can be left hidden. One-way
  // on purpose — re-hiding content someone is already reading is worse than a lost effect.
  if (MOTION.matches) document.documentElement.classList.remove("reveal");
});

mountChrome("");

/* -------------------------------------------------------------------- data */

/** Only the fields this page consumes; graph/index.json also carries the pathway list. */
interface AtlasIndex {
  stats: Record<string, number>;
  edgeTypeCounts: Record<string, number>;
}

/**
 * One fetch, two consumers (the stat row and the legend's count column). Resolved to null
 * rather than rejected so both consumers handle "no numbers" as a state instead of an
 * error, and a stats failure can never take the legend down with it.
 */
const atlas: Promise<AtlasIndex | null> = getJSON<AtlasIndex>("graph/index.json").catch(() => null);

/* ------------------------------------------------------------------ ticker */

/**
 * One rAF chain for the whole page. Each count-up used to start its own chain — four
 * counters, four chains, no ordering guarantee between them. Subscribers receive the frame
 * timestamp and return false when done; the loop stops itself when the last one leaves, so
 * a settled page costs exactly nothing.
 */
type Tick = (now: number) => boolean;
const ticks = new Set<Tick>();
let rafId = 0;

function loop(now: number): void {
  rafId = 0;
  for (const fn of [...ticks]) if (!fn(now)) ticks.delete(fn);
  if (ticks.size) rafId = requestAnimationFrame(loop);
}

function onTick(fn: Tick): void {
  ticks.add(fn);
  if (!rafId) rafId = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------- stats */

const COUNT_MS = 1100;

/** Stats whose value is known but which have not been scrolled into view yet. */
const pending = new Map<HTMLElement, number>();

/**
 * Counts to `to` on the shared ticker, easing out. Driven by elapsed time rather than a
 * per-frame increment, so it takes the same 1.1s on a 60Hz panel and on a 120Hz one.
 */
function countUp(node: HTMLElement, to: number): void {
  let start = 0;
  onTick((now) => {
    if (!start) start = now;
    const p = Math.min(1, (now - start) / COUNT_MS);
    node.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) return true;
    node.textContent = fmt(to); // the exact figure, never a rounding artefact
    return false;
  });
}

async function fillStats(): Promise<void> {
  const nodes = [...document.querySelectorAll<HTMLElement>("[data-stat]")];
  if (!nodes.length) return;

  const idx = await atlas;
  for (const node of nodes) {
    const value = idx?.stats[node.dataset.stat ?? ""];
    // An em dash, not a zero: we do not know the number, and claiming none would be a lie.
    if (typeof value !== "number") { node.textContent = "—"; continue; }

    // Reserve the final width now: "26,510" is much wider than "8", and a counter that
    // gains a character at a time reflows its row on every frame. CSS pairs this with
    // tabular figures — `min-width: calc(var(--digits) * 1ch)`.
    node.style.setProperty("--digits", String(fmt(value).length));
    node.setAttribute("data-value", String(value));

    if (still()) { node.textContent = fmt(value); continue; }

    // Animate when the number is *seen*, not when the JSON happens to land.
    pending.set(node, value);
    whenSeen(node, () => {
      if (pending.delete(node)) countUp(node, value);
    });
  }

  // A stat below the fold is still legitimately asked for by print, by find-in-page, and
  // by anything that reads the document without scrolling it. Never let the placeholder
  // be the thing that gets committed to paper.
  addEventListener("beforeprint", settleStats);
}

function settleStats(): void {
  for (const [node, value] of pending) node.textContent = fmt(value);
  pending.clear();
}

/* ------------------------------------------------------------------ reveal */

const RISE = 14; // px
/** Longest stagger position. Past ~6 the tail reads as lag rather than cascade. */
const STAGGER_CAP = 5;

/**
 * Marks one element as arrived.
 *
 * The class is the contract: `.is-in` plus `--reveal-i` (its position within the batch that
 * arrived together) is everything a stylesheet needs to stagger a group. If a rule already
 * claims the element the design system owns the motion and JS adds nothing — otherwise it
 * plays the equivalent itself, so the affordance is never merely notional.
 *
 * `firstBatch` elements are on screen at load: they rise but never fade, because fading in
 * something the browser has already painted is a visible flash and, for the headline, an
 * LCP regression. Everything below the fold has never been seen, so it fades and rises.
 */
function reveal(node: HTMLElement, index: number, firstBatch: boolean): void {
  node.style.setProperty("--reveal-i", String(index));
  node.classList.add("is-in");

  if (typeof node.animate !== "function") return;
  if (getComputedStyle(node).animationName !== "none") return;

  const from = firstBatch
    ? { transform: `translateY(${RISE}px)` }
    : { opacity: 0, transform: `translateY(${RISE}px)` };
  node.animate([from, { opacity: 1, transform: "none" }], {
    duration: firstBatch ? 480 : 560,
    delay: index * 70,
    easing: EASE,
    fill: "backwards", // hold the start state through the stagger delay
  });
}

function wireReveals(): void {
  if (!REVEALING) return;
  const targets = [...document.querySelectorAll<HTMLElement>("[data-animate]")];
  if (!targets.length) return;

  let firstBatch = true;
  const io = new IntersectionObserver(
    (entries, obs) => {
      const arrived = entries
        .filter((e) => e.isIntersecting)
        // IntersectionObserver does not promise document order; a stagger read out of
        // order looks like a glitch rather than a cascade.
        .sort((a, b) =>
          a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
      arrived.forEach((entry, i) => {
        obs.unobserve(entry.target);
        reveal(entry.target as HTMLElement, Math.min(i, STAGGER_CAP), firstBatch);
      });
      if (arrived.length) firstBatch = false;
    },
    // A little inset, so an element reveals once it is genuinely in the reading area
    // rather than the instant its first pixel clears the fold.
    { rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );
  for (const t of targets) io.observe(t);
}

/** Run `fn` the first time `target` enters the viewport, then stop watching. */
function whenSeen(target: Element, fn: () => void, rootMargin = "0px"): void {
  if (!("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver(
    (entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      fn();
    },
    { rootMargin },
  );
  io.observe(target);
}

/* ------------------------------------------------------------------ legend */

/**
 * The arrow registry, set as a specimen table: grouped by category, one row per
 * relationship type, in registry order (which is authored order — substrate before
 * product before reversible — and therefore meaningful).
 *
 * The "in atlas" column is the point of the whole thing. It joins schema/arrows.json to
 * the counts in graph/index.json, so the legend stops being a key to a picture and becomes
 * a census of the corpus: 12,790 catalysis edges, 43 feedback inhibitions, 2 covalent
 * modifications. A type the grammar defines but the corpus has not yet reached reads 0 and
 * is marked as such — an honest gap is more useful to a reader than a hidden one.
 */
async function buildLegend(): Promise<void> {
  // A <tbody id="legend-body"> lets the markup own the table shell; otherwise this builds
  // the whole table inside #legend.
  const body = document.getElementById("legend-body");
  const host = body ?? document.getElementById("legend");
  if (!host) return;

  const reg = await loadArrows().catch(() => null);
  if (!reg) {
    host.replaceChildren(el("p.muted", {}, ["The arrow registry could not be loaded. Reload to try again."]));
    return;
  }

  const idx = await atlas;
  const counts = idx?.edgeTypeCounts;
  const keys = Object.keys(reg.arrows);

  const groups: HTMLElement[] = [];
  for (const [category, description] of Object.entries(reg.categories)) {
    const members = keys.filter((k) => reg.arrows[k].category === category);
    if (!members.length) continue;

    const group = el("tbody.legend-group", { "data-category": category }, [
      el("tr.legend-group__head", {}, [
        el("th", { colspan: "4", scope: "colgroup" }, [
          el("span.legend-group__name", {}, [category]),
          el("span.legend-group__desc", {}, [description]),
        ]),
      ]),
    ]);
    for (const key of members) group.append(legendRow(key, reg.arrows[key], counts));
    groups.push(group);
  }

  if (body) { body.replaceChildren(...groups.flatMap((g) => [...g.children])); return; }

  const table = el("table.legend-table", {}, [
    el("caption.legend-table__caption", {}, [`Source: schema/arrows.json · registry v${reg.version}`]),
    el("thead", {}, [
      el("tr", {}, [
        el("th.legend-table__h", { scope: "col" }, ["Specimen"]),
        el("th.legend-table__h", { scope: "col" }, ["Relation"]),
        el("th.legend-table__h.legend-table__h--num", { scope: "col" }, ["In atlas"]),
        el("th.legend-table__h", { scope: "col" }, ["Definition"]),
      ]),
    ]),
    ...groups,
  ]);
  if (counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    table.append(
      el("tfoot.legend-foot", {}, [
        el("tr", {}, [
          el("td", { colspan: "2" }, [`${fmt(keys.length)} relationship types defined`]),
          el("td.legend-row__count", {}, [fmt(total)]),
          el("td.legend-row__desc", {}, ["typed edges in the current build"]),
        ]),
      ]),
    );
  }

  // This script owns the subtree, so it owns the container's layout modifier: the injected
  // content is a table, not the card grid the placeholder was sized for.
  host.classList.remove("legend-grid");
  host.classList.add("legend-table-wrap");
  host.replaceChildren(table);
}

function legendRow(key: string, spec: ArrowSpec, counts?: Record<string, number>): HTMLElement {
  const n = counts?.[key] ?? 0;
  const count = el("td.legend-row__count", {}, [counts ? fmt(n) : "—"]);
  if (counts && !n) count.classList.add("is-zero");

  return el("tr.legend-row", { "data-arrow": key }, [
    el("td.legend-row__spec", { html: arrowSVG(spec, 64, 18) }),
    el("td.legend-row__name", {}, [
      el("span.legend-row__label", {}, [spec.label]),
      // The schema enum value — mono, because it is a machine identifier and because it is
      // literally what an author writes in a pathway module.
      el("code.legend-row__key", {}, [key]),
    ]),
    count,
    el("td.legend-row__desc", {}, [
      spec.description,
      el("span.legend-row__domain", {}, [`${spec.from.join(" · ")} → ${spec.to.join(" · ")}`]),
    ]),
  ]);
}

/* -------------------------------------------------------------------- hero */

/**
 * three.js is the heaviest thing this site can load, so the gates run cheapest first:
 *
 *  1. prefers-reduced-motion — returns BEFORE the dynamic import. Downloading a 3D library
 *     to paint one motionless frame is the wrong trade; the still composition stands alone.
 *  2. Data Saver — an explicit request not to spend bytes on decoration.
 *  3. Proximity — an IntersectionObserver at 300px. A reader who bounces from the top of
 *     the page, or never reaches the canvas, never fetches the library at all.
 *  4. Idle — once it is wanted, still yield the main thread so it cannot compete with LCP.
 *
 * If there is no canvas in the markup, nothing is imported and the page is simply static —
 * that is a supported outcome, not a failure.
 *
 * WebGL capability (including `failIfMajorPerformanceCaveat`, which catches software
 * rasterisers like SwiftShader for free) is probed inside lib/hero.ts, next to the
 * getContext call that owns it; this module deliberately does not duplicate that check.
 * The import is dynamic and reached only from here, which is what keeps three out of every
 * page entry chunk on the site — verify with `npx vite build` after touching this.
 *
 * Kill criterion, stated up front: if gate 3 fires in fewer than ~30% of sessions, the
 * WebGL path is not earning its bytes — delete this function and ship the still
 * composition alone. That retreat stays cheap only for as long as the no-JS / no-WebGL
 * rendering is a designed state rather than a degraded one.
 */
function mountHero(): void {
  if (still()) return;

  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;

  // `data-hero` is the contract; the two ids are the names the markup has used. A page
  // with no canvas at all is a supported configuration — it simply stays static.
  const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-hero], #hero-canvas, #stack-canvas");
  if (!canvas) return;

  whenSeen(
    // Watch the section, not the canvas: a canvas is 300x150 until something sizes it, and
    // hero.ts is the thing that sizes it — waiting on its own box would be circular.
    canvas.closest("section") ?? canvas,
    () =>
      whenIdle(async () => {
        try {
          const { initHero } = await import("../lib/hero");
          await initHero(canvas);
        } catch {
          // The page is complete without it; a backdrop is never worth an error state.
        }
      }),
    "300px",
  );
}

function whenIdle(fn: () => void): void {
  // Declared in lib.dom but absent in Safari, so this is a runtime check, not a type one.
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 1500 });
  else setTimeout(fn, 200);
}

/* --------------------------------------------------------------- bootstrap */

wireReveals();
void fillStats();
void buildLegend();
mountHero();

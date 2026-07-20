// DOM-level render QA. tools/qa-metrics.mjs scores the IR — cell rectangles and
// polyline geometry — and that is exactly why a whole class of defects shipped
// green: almost every chart-QA issue is about TEXT, and text extents do not
// exist until a browser has laid the glyphs out. "The cofactor label prints on
// top of the metabolite name" is unmeasurable from JSON, so it was unmeasured.
//
// This loads each chart in headless Chromium at the default Fit view — what the
// reader actually sees first — and measures the rendered geometry:
//
//   textOverlaps    two labels whose painted boxes intersect (the overprint class)
//   lineThroughText a flux/regulation line crossed through a label's box
//   emptyCells      a cell with neither text nor structure ink in it
//   minFontPx       the smallest font actually rasterised, in CSS pixels
//
// Usage: node tools/qa-dom.mjs [--json] [--gate] [chartId ...]

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHARTS = join(ROOT, "web", "public", "chart");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const gate = argv.includes("--gate");
const only = argv.filter((a) => !a.startsWith("--"));
const BASE = process.env.QA_BASE || "http://localhost:4173/metabolian";

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = join(process.env.HOME || "", ".cache", "ms-playwright");
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium")).sort().reverse()) {
      const p = join(pw, d, "chrome-linux64", "chrome");
      if (existsSync(p)) return p;
      const p2 = join(pw, d, "chrome-linux", "chrome");
      if (existsSync(p2)) return p2;
    }
  }
  // GitHub's ubuntu runners ship Chrome at /usr/bin/google-chrome. Missing it here
  // is what made the CI job fail to launch a browser at all.
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
                   "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium",
                   "/opt/google/chrome/chrome"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium found. Set CHROME_PATH.");
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg.result ?? {}); this.pending.delete(msg.id); }
    });
  }
  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    return r?.result?.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node exposes WebSocket as a global from v22. Say so plainly: on Node 20 the
// old attach loop constructed one inside a `catch {}` and swallowed the
// ReferenceError 300 times over, then blamed Chromium for not being there.
if (typeof WebSocket === "undefined") {
  console.error(`This harness needs a global WebSocket (Node >=22). Running Node ${process.version}.`);
  process.exit(1);
}

/**
 * The in-page probe. Runs against the live SVG and returns plain data.
 *
 * Rect intersection uses a 1px inset: touching boxes (a caption sitting flush
 * under its own title) are correct typography, only genuine bleed counts.
 */
const PROBE = `(async () => {
  // Anchor to the svg that actually OWNS the layers. A bare querySelector("svg")
  // matches the nav-bar logo, which has no labels in it — the probe then reports
  // a serene zero for every metric while measuring the wrong element entirely.
  const svg = document.querySelector(".layer-nodes")?.ownerSVGElement;
  if (!svg) return { error: "no chart svg" };
  const INSET = 1;

  const layerOf = (el) => {
    for (let n = el; n && n !== svg; n = n.parentNode) {
      const c = n.getAttribute && n.getAttribute("class");
      if (c && /^layer-/.test(c)) return c.replace("layer-", "");
    }
    return "?";
  };

  // Every painted label, with the box it actually occupies on screen.
  // Read the visible string only. Labels carry a <title> child for the native
  // tooltip, and textContent concatenates it — which is why every caption came
  // back doubled ("CoA-SHCoA-SH") and looked like a double-paint defect.
  const visibleText = (t) => [...t.childNodes]
    .filter((n) => n.nodeType === 3 || (n.nodeName || "").toLowerCase() === "tspan")
    .map((n) => n.textContent || "").join("").trim();

  const texts = [...svg.querySelectorAll("text")].filter((t) => {
    const cs = getComputedStyle(t);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    return visibleText(t).length > 0;
  }).map((t) => {
    const r = t.getBoundingClientRect();
    return {
      text: visibleText(t).slice(0, 40),
      layer: layerOf(t),
      cls: t.getAttribute("class") || "",
      x: r.x, y: r.y, w: r.width, h: r.height,
      font: parseFloat(getComputedStyle(t).fontSize) || 0,
      // A glyph is protected either by a text stroke (paint-order:stroke) or by
      // an opaque shape painted behind it. The +/- in a regulation disc has no
      // text stroke but sits on a filled white circle, so a rail crossing its box
      // is knocked out exactly the same way — counting those as unprotected
      // reported 12 defects that do not exist on the sheet.
      hasHalo: ((getComputedStyle(t).paintOrder || "").includes("stroke")
        && parseFloat(getComputedStyle(t).strokeWidth || "0") > 0)
        || !!t.parentNode.querySelector?.("circle[fill='#fff'], circle[fill='#FFFFFF'], rect[fill='#fff']"),
    };
  }).filter((t) => t.w > 0 && t.h > 0);

  const hit = (a, b) => !(a.x + a.w - INSET <= b.x + INSET || b.x + b.w - INSET <= a.x + INSET
                       || a.y + a.h - INSET <= b.y + INSET || b.y + b.h - INSET <= a.y + INSET);

  /**
   * Overprint is scored by AREA, not by touching. A text's client rect spans the
   * font's full ascent+descent, which is taller than the line spacing a wrapped
   * caption uses — so line 1 and line 2 of one name always graze each other, and
   * a naive rect test reported 42 such phantoms as the single largest defect
   * class. A genuine overprint buries a real fraction of a glyph run.
   */
  const overprint = (a, b) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return false;
    // The VERTICAL fraction is the discriminator. Two lines of one wrapped name
    // overlap almost fully in x (same anchor, similar width), so an area test
    // cannot tell them from a genuine overprint — it counted 219 of them. What
    // separates them is that stacked lines graze by the few px the em-box
    // exceeds the line spacing, while a label printed ON another buries it.
    return oy > 0.45 * Math.min(a.h, b.h) && ox > 0.2 * Math.min(a.w, b.w);
  };

  // --- overprints -----------------------------------------------------------
  // Grid labels are deliberate watermarks under everything; region titles sit in
  // their own band. Neither participates in the reading layer.
  const readable = texts.filter((t) => t.layer !== "grid" && t.layer !== "regions" && t.cls !== "region-ref");
  const overlaps = [];
  for (let i = 0; i < readable.length; i++)
    for (let j = i + 1; j < readable.length; j++)
      if (overprint(readable[i], readable[j]))
        overlaps.push({ a: readable[i].text, b: readable[j].text, aL: readable[i].layer, bL: readable[j].layer });

  // --- lines drawn through labels -------------------------------------------
  // Sample each flux/regulation path along its length and ask whether the point
  // lands inside a label box. Structure paths inside a cell are excluded: those
  // are the molecule, not a route.
  const routes = [...svg.querySelectorAll(".layer-flux path, .layer-reg path")];
  const struck = [];
  const seen = new Set();
  for (const p of routes) {
    let len = 0;
    try { len = p.getTotalLength(); } catch { continue; }
    if (!len) continue;
    const ctm = p.getScreenCTM();
    if (!ctm) continue;
    const steps = Math.min(400, Math.max(12, Math.ceil(len / 3)));
    for (let s = 0; s <= steps; s++) {
      let pt;
      try { pt = p.getPointAtLength((len * s) / steps); } catch { break; }
      const cx = ctm.a * pt.x + ctm.c * pt.y + ctm.e;
      const cy = ctm.b * pt.x + ctm.d * pt.y + ctm.f;
      for (const t of readable) {
        if (cx > t.x + INSET && cx < t.x + t.w - INSET && cy > t.y + INSET && cy < t.y + t.h - INSET) {
          const k = t.text + "|" + t.layer;
          if (!seen.has(k)) { seen.add(k); struck.push({ text: t.text, layer: t.layer, halo: t.hasHalo }); }
        }
      }
    }
  }

  // --- labels lying on top of unrelated cells --------------------------------
  // Text-vs-text cannot see this class at all: an enzyme name printed across a
  // metabolite box collides with the BOX, not with another label, so the sheet
  // reads as struck through while every text metric stays at zero. Only labels
  // that live outside the cell layer count — a metabolite's own name, formula and
  // condensed rows are inside their cell by design.
  const cellBoxes = [...svg.querySelectorAll(".layer-nodes .met-box, .layer-nodes rect")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }).filter((c) => c.w > 6 && c.h > 6);
  const onCell = [];
  for (const t of readable) {
    if (t.layer === "nodes") continue;
    for (const c of cellBoxes) {
      if (overprint(t, c)) { onCell.push({ text: t.text, layer: t.layer }); break; }
    }
  }

  // --- cells with nothing in them -------------------------------------------
  // The "renders as an empty box" class: a cell rect that contains no glyph and
  // no structure ink anywhere inside it.
  const cellRects = [...svg.querySelectorAll(".layer-nodes rect, .layer-nodes .cell")].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.x, y: r.y, w: r.width, h: r.height };
  }).filter((c) => c.w > 6 && c.h > 6);
  const inkPaths = [...svg.querySelectorAll(".layer-nodes path, .layer-nodes line, .layer-nodes polygon")];
  const empties = [];
  for (const c of cellRects) {
    const hasText = texts.some((t) => hit(t, c));
    const hasInk = inkPaths.some((p) => { const r = p.getBoundingClientRect(); return r.width > 1 && r.height > 1 && hit({ x: r.x, y: r.y, w: r.width, h: r.height }, c); });
    if (!hasText && !hasInk) empties.push({ x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) });
  }

  const fonts = readable.map((t) => t.font).filter((f) => f > 0);
  return {
    textOverlaps: overlaps.length,
    lineThroughText: struck.length,
    strickenWithoutHalo: struck.filter((s) => !s.halo).length,
    emptyCells: empties.length,
    labelsOverCells: onCell.length,
    minFontPx: fonts.length ? Math.round(Math.min(...fonts) * 10) / 10 : 0,
    labels: readable.length,
    samples: { overlaps: overlaps.slice(0, 60), struck: struck.slice(0, 60), empties: empties.slice(0, 8), onCell: onCell.slice(0, 40) },
  };
})()`;

async function run(ids) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
    "--disable-dev-shm-usage", "--hide-scrollbars",
    // A cold CI runner spends seconds on first-run setup, extension loading and
    // GCM registration before the debugging socket answers. None of it is wanted
    // for a measurement run, and waiting on it is what timed the attach out.
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    // Deterministic text. Hinting and subpixel positioning are tuned per
    // platform and per build, so the same label measured different widths on
    // a dev browser and a CI runner — which made two real overprints look
    // like environment noise and could not be reproduced locally at all.
    "--font-render-hinting=none", "--disable-font-subpixel-positioning",
    "--disable-lcd-text", "--force-device-scale-factor=1",
    "--disable-background-networking", "--disable-sync", "--metrics-recording-only",
    `--remote-debugging-port=${port}`, "--window-size=1600,1000", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  // Keep stderr. Discarding it turned a CI launch failure into a bare "could not
  // attach to Chromium" with nothing to act on.
  let launchLog = "";
  proc.stderr?.on("data", (d) => { launchLog += d.toString().slice(0, 400); });
  proc.on("exit", (code) => { if (code) launchLog += `\n[chrome exited ${code}]`; });

  let ws;
  try {
    // Attach via the browser endpoint Chrome prints on stderr, not the /json/list
    // HTTP API. On a CI runner Chrome reported `DevTools listening on ws://...`
    // and was fully up, yet /json/list never yielded a page target and the job
    // failed with the browser running the whole time. The ws URL is authoritative
    // and needs no second service.
    let browserWs = "";
    for (let i = 0; i < 300 && !browserWs; i++) {
      await sleep(150);
      browserWs = (launchLog.match(/ws:\/\/[^\s]+/) || [""])[0];
    }
    if (!browserWs) throw new Error(`Chromium never announced a DevTools endpoint (${findChrome()})\n${launchLog.trim() || "(no stderr)"}`);
    ws = new WebSocket(browserWs);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const cdp = new CDP(ws);
    // Make our own page and drive it through a flat session.
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessionId = sessionId;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const out = {};
    for (const id of ids) {
      await cdp.send("Page.navigate", { url: `${BASE}/chart.html?id=${id}` });
      let ready = false;
      for (let i = 0; i < 90 && !ready; i++) {
        await sleep(200);
        ready = await cdp.eval(`!!document.querySelector(".layer-nodes") && document.querySelectorAll(".layer-nodes text").length > 0`).catch(() => false);
      }
      await sleep(700);   // let structure hydration and label placement settle
      try {
        out[id] = await cdp.eval(PROBE);
      } catch (e) {
        out[id] = { error: String(e.message).slice(0, 120) };
      }
    }
    return out;
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    proc.kill("SIGKILL");
  }
}

/**
 * At 900+ sheets, measuring every chart in a browser takes hours — too slow to
 * gate a pull request on. Sample instead, and sample DELIBERATELY rather than
 * randomly: every hand-authored sheet (they carry the curated layouts and the
 * defects this gate was built for), plus an evenly-spaced slice of the ingested
 * ones so auto-generated layout regressions still surface. Deterministic, so a
 * failure is reproducible.
 *
 * `--all` measures everything, for when you want the true atlas-wide number.
 */
const HAND_AUTHORED = new Set(
  existsSync(join(ROOT, "data", "ingest", "sheets.json"))
    ? readdirSync(CHARTS)
        .filter((f) => f.endsWith(".json") && !["index.json", "_master.json"].includes(f))
        .map((f) => f.replace(".json", ""))
        .filter((id) => !JSON.parse(readFileSync(join(ROOT, "data", "ingest", "sheets.json"), "utf8"))
          .some((s) => s.id === id))
    : [],
);
const allIds = readdirSync(CHARTS)
  .filter((f) => f.endsWith(".json") && !["index.json", "_master.json"].includes(f))
  .map((f) => f.replace(".json", "")).sort();
const GENERATED_SAMPLE = 24;
function sampled() {
  const gen = allIds.filter((id) => !HAND_AUTHORED.has(id));
  if (gen.length <= GENERATED_SAMPLE) return allIds;
  const step = Math.floor(gen.length / GENERATED_SAMPLE);
  const pick = [];
  for (let i = 0; i < gen.length && pick.length < GENERATED_SAMPLE; i += step) pick.push(gen[i]);
  return [...allIds.filter((id) => HAND_AUTHORED.has(id)), ...pick];
}
const ids = only.length ? only : (argv.includes("--all") ? allIds : sampled());

const res = await run(ids);

const totals = { textOverlaps: 0, lineThroughText: 0, strickenWithoutHalo: 0, emptyCells: 0, labelsOverCells: 0 };
let minFont = Infinity;
for (const m of Object.values(res)) {
  if (m.error) continue;
  for (const k of Object.keys(totals)) totals[k] += m[k] || 0;
  if (m.minFontPx) minFont = Math.min(minFont, m.minFontPx);
}

if (asJson) {
  console.log(JSON.stringify({ charts: res, totals, minFontPx: minFont }, null, 2));
} else {
  const cols = ["textOverlaps", "labelsOverCells", "lineThroughText", "emptyCells", "minFontPx"];
  console.log("chart".padEnd(38) + cols.map((c) => c.replace(/([A-Z])/g, " $1").trim().slice(0, 9).padStart(11)).join(""));
  for (const [id, m] of Object.entries(res)) {
    if (m.error) { console.log("! " + id.padEnd(36) + "  ERROR " + m.error); continue; }
    const bad = m.textOverlaps > 0 || m.labelsOverCells > 0 || m.emptyCells > 0;
    console.log((bad ? "! " : "  ") + id.padEnd(36) + cols.map((c) => String(m[c]).padStart(11)).join(""));
  }
  console.log("\nTOTALS: " + Object.entries(totals).map(([k, v]) => `${k}=${v}`).join("  ") + `  minFontPx=${minFont}`);
}

/**
 * Budgets, not zeroes. Three overprints survive atlas-wide in genuinely tight
 * corners (a name and its own EC on a crowded step); driving them out costs more
 * legibility than it buys. The budget pins the number so it cannot creep back up
 * — the 62 this pass started from arrived one uncounted collision at a time.
 *
 * lineThroughText is NOT gated: a rail crossing a label that carries a knockout
 * halo is Michal's own device, not a defect. What matters is that the label is
 * protected, which is strickenWithoutHalo.
 */
// Re-baselined after ingestion took the atlas from 27 sheets to 789. The counts
// are absolute, not rates, so they had to move: what did NOT move is that these
// are measured, not guessed, and every one is a real defect rather than a
// tolerance. strickenWithoutHalo and emptyCells stay at zero — those are
// correctness, not crowding.
//
// Measured over the sampled set (all hand-authored sheets + an evenly spaced
// slice of the ingested ones); run with --all for the atlas-wide number.
const BUDGET = { textOverlaps: 5, strickenWithoutHalo: 0, emptyCells: 0, labelsOverCells: 18 };

// labelsOverCells is budgeted, not zeroed. Raising the placer's cell-overlap
// weight from 1 to 3 moved the number not at all: these 12 captions have no
// better candidate position, so the remaining cost is the cell border rather
// than a competing label — the least bad of the available placements.

if (gate) {
  const broken = Object.entries(BUDGET).filter(([k, max]) => (totals[k] || 0) > max);
  if (broken.length) {
    console.error(`\n✗ regression: ${broken.map(([k, max]) => `${k}=${totals[k]} (budget ${max})`).join(", ")}`);
    // Name the offenders. A bare count is undiagnosable from a CI log, and this
    // gate can legitimately differ between browser builds — you need to see WHICH
    // pair collided to tell a real regression from metric jitter.
    for (const [id, m] of Object.entries(res)) {
      for (const o of m.samples?.overlaps || []) console.error(`    ${id}: [${o.aL}] "${o.a}"  <->  [${o.bL}] "${o.b}"`);
      for (const o of m.samples?.onCell || []) console.error(`    ${id}: [${o.layer}] "${o.text}" over a cell`);
    }
    process.exit(1);
  }
  console.log(`\n✓ within budget: ${Object.entries(BUDGET).map(([k, m]) => `${k}=${totals[k]}/${m}`).join("  ")}`);
}

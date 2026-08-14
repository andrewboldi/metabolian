// Slippy Atlas — Stage 1 tile baker.
//
// The master wall chart is ~30k live SVG nodes; drawn as SVG it takes 5-9s to
// first paint and cannot pan at 60fps. This bakes a Google-Earth-style raster
// pyramid of its OVERVIEW face (cell frames, flux routing, grid, regulation
// glyphs — the dense poster texture, the exact thing that is slow as SVG) so a
// reader gets an instant, buttery overview and only falls back to the live
// renderer when they zoom in to read a structure.
//
// How: `vite preview` serves the built site; headless Chrome renders the REAL
// chart (chart.html?id=_master, the default renderer — tiles are screenshots of
// it, never fabricated); for each pyramid level we drive the chart's own
// world->screen transform to frame each 256px tile and Page.captureScreenshot it
// at deviceScaleFactor 2. Near-uniform tiles (the ~40% the masonry packing leaves
// empty) are detected by encoded size and omitted.
//
// Every target scale sits far below the renderer's LOD_NORMAL (0.26), so the
// chart is in "overview" mode: no molecule depictions or labels hydrate, the
// draw is fully synchronous, and setting the transform directly needs no waiting
// on async content. See web/src/lib/chart-view.ts:1004 (apply) for the transform
// and web/src/styles/chart.css:43 for what "overview" shows.
//
// Usage:
//   node tools/build-tiles.mjs                 # bake L0..L2 (default)
//   node tools/build-tiles.mjs --levels 2      # bake L0..L1 only (faster)
//   node tools/build-tiles.mjs --base http://localhost:4173/metabolian/   # reuse a running preview

import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT_DIR = join(ROOT, "web", "public", "tiles", "master");
const MASTER_JSON = join(ROOT, "web", "public", "chart", "_master.json");

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };

const TILE = 256;                    // logical tile size (CSS px)
const DSF = 2;                       // deviceScaleFactor — tiles bake at 512px physical for retina crispness
const LEVELS = Number(flag("levels", 3));  // number of pyramid levels (L0..L{LEVELS-1})
const QUALITY = Number(flag("quality", 88));
// A 512x512 lossy-WebP of blank white paper encodes to a few hundred bytes; any
// tile carrying real ink (a flux hairline, a cell frame) is multiple KB. The gap
// is wide and bimodal, so a byte-size floor cleanly separates "near-uniform" from
// "has content". Logged per run so the cutoff can be seen to sit inside the gap.
const BLANK_BYTES = Number(flag("blank-bytes", 900));
const OWN_PREVIEW = !argv.includes("--base");
const BASE = flag("base", "http://localhost:4173/metabolian/");
const PORT = Number(flag("port", 4173));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Headless Chromium over the DevTools Protocol — same bootstrap as
// tools/render-perf.mjs (no npm dependency; Node >=22 has a global WebSocket).
// ---------------------------------------------------------------------------
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium-"))) {
      for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const p = join(pw, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium",
    "/opt/google/chrome/chrome"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium found. Set CHROME_PATH.");
}

/** Minimal DevTools Protocol client (mirrors tools/render-perf.mjs). */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
      else if (msg.method) (this.handlers.get(msg.method) || []).forEach((h) => h(msg.params));
    });
  }
  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result ?? {})));
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  async eval(expr, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r?.result?.value;
  }
}

async function launchChrome() {
  const port = 9333 + Math.floor(performance.now() % 400);
  const proc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
    "--disable-dev-shm-usage", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-background-networking",
    "--disable-sync", "--metrics-recording-only", "--force-color-profile=srgb",
    `--remote-debugging-port=${port}`, "--window-size=600,600", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  proc.stderr?.on("data", (d) => { log += d.toString().slice(0, 400); });
  proc.on("exit", (code) => { if (code) log += `\n[chrome exited ${code}]`; });

  let browserWs = "";
  for (let i = 0; i < 300 && !browserWs; i++) { await sleep(150); browserWs = (log.match(/ws:\/\/[^\s]+/) || [""])[0]; }
  if (!browserWs) throw new Error(`Chromium never announced a DevTools endpoint\n${log.trim() || "(no stderr)"}`);
  const ws = new WebSocket(browserWs);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  return { proc, ws };
}

// ---------------------------------------------------------------------------
// Preview server
// ---------------------------------------------------------------------------
async function startPreview() {
  const proc = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout?.on("data", (d) => { log += d.toString(); });
  proc.stderr?.on("data", (d) => { log += d.toString(); });
  for (let i = 0; i < 200; i++) {
    await sleep(150);
    try { if ((await fetch(BASE)).ok) return proc; } catch { /* not up yet */ }
  }
  proc.kill("SIGKILL");
  throw new Error(`vite preview never came up on ${BASE}\n${log.slice(-600)}`);
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(MASTER_JSON)) throw new Error(`missing ${MASTER_JSON} — run the chart build first`);
  const master = JSON.parse(readFileSync(MASTER_JSON, "utf8"));
  const B = master.bounds; // { x, y, w, h } — the world rect
  // L0 frames the whole chart into a handful of tiles (~4 wide); each level doubles.
  const scale0 = (TILE * 4) / B.w;
  const levels = [];
  for (let L = 0; L < LEVELS; L++) {
    const scale = scale0 * 2 ** L;
    levels.push({ L, scale, cols: Math.ceil((B.w * scale) / TILE), rows: Math.ceil((B.h * scale) / TILE) });
  }
  const planned = levels.reduce((a, l) => a + l.cols * l.rows, 0);
  console.log(`master bounds ${B.w}x${B.h}  scale0=${scale0.toFixed(5)}`);
  for (const l of levels) console.log(`  L${l.L}: scale=${l.scale.toFixed(5)} grid=${l.cols}x${l.rows} = ${l.cols * l.rows} tiles`);
  console.log(`planned ${planned} tiles across ${levels.length} levels (before blank-skip)\n`);

  const preview = OWN_PREVIEW ? await startPreview() : null;
  const { proc: chrome, ws } = await launchChrome();
  const t0 = performance.now();
  try {
    const cdp = new CDP(ws);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessionId = sessionId;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // A tile is exactly one 256px CSS viewport, captured at 2x -> 512px physical.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: TILE, height: TILE, deviceScaleFactor: DSF, mobile: false });

    await cdp.send("Page.navigate", { url: `${BASE}chart.html?id=_master` });

    // Wait for the real chart to mount and lay its cells out.
    let ready = false;
    for (let i = 0; i < 400; i++) {
      await sleep(150);
      const n = await cdp.eval(`document.querySelectorAll('.met-cell').length`).catch(() => 0);
      if (n && n > 1000) { ready = true; break; }
    }
    if (!ready) throw new Error("chart never rendered its cells");

    // Strip the page chrome so a tile is pure chart ink on white paper, pin the
    // canvas to the full viewport, and stash the SVG + viewport handles. Fonts
    // must be in before we paint grid labels (see chart.ts:54).
    await cdp.eval(`(() => {
      const st = document.createElement('style');
      // mountChrome (web/src/lib/layout.ts) consumes the #app-header placeholder
      // and mounts a position:sticky .site-header (z-index 50) that would paint
      // over the canvas in every capture — hide it and the rest of the chrome.
      st.textContent = '.site-header,.site-footer,#app-header,.chart-hud,.chart-help,.inspector{display:none!important}'
        + '.chart-shell{height:100vh!important}#chart-canvas{position:fixed;inset:0}'
        + 'html,body{margin:0;background:#fff}';
      document.head.appendChild(st);
      const svg = document.querySelector('#chart-canvas svg');
      window.__svg = svg;
      window.__vp = svg.querySelector('.viewport');
    })()`);
    await cdp.eval(`document.fonts ? document.fonts.ready.then(()=>1) : 1`, true);
    await sleep(150);

    let firstDims = null;
    const meta = { worldBounds: B, tileSize: TILE, levels: [] };
    let wrote = 0, skipped = 0, bytes = 0;
    const sizes = [];

    for (const lvl of levels) {
      const dir = join(OUT_DIR, String(lvl.L));
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      // Grid labels are counter-scaled to a constant on-screen size; match apply()
      // (chart-view.ts:1012) so they read the same as the live chart at overview.
      const gridSize = Math.min(180, Math.max(12, 15 / lvl.scale));
      await cdp.eval(`(() => {
        window.__svg.setAttribute('data-lod','overview');
        window.__svg.style.setProperty('--grid-size','${gridSize}px');
        window.__svg.style.setProperty('--title-size','${gridSize}px');
      })()`);

      const present = [];
      for (let row = 0; row < lvl.rows; row++) {
        for (let col = 0; col < lvl.cols; col++) {
          // Frame this tile's world rect exactly into the 256px viewport:
          //   screen = world*scale + t,  world(bounds.x + col*TILE/scale) -> 0
          const tx = -(B.x * lvl.scale + col * TILE);
          const ty = -(B.y * lvl.scale + row * TILE);
          await cdp.eval(`window.__vp.setAttribute('transform','translate(${tx},${ty}) scale(${lvl.scale})')`);
          // Two frames so the style/layout flush before the shot is taken.
          await cdp.eval(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`, true);
          const shot = await cdp.send("Page.captureScreenshot", {
            format: "webp", quality: QUALITY,
            clip: { x: 0, y: 0, width: TILE, height: TILE, scale: 1 },
            captureBeyondViewport: false,
          });
          const buf = Buffer.from(shot.data, "base64");
          if (firstDims === null) {
            firstDims = await measureDims(cdp, shot.data);
            console.log(`captured tile is ${firstDims} px (want ${TILE * DSF})\n`);
          }
          sizes.push(buf.length);
          if (buf.length < BLANK_BYTES) { skipped++; continue; }
          writeFileSync(join(dir, `${col}_${row}.webp`), buf);
          present.push(`${col}_${row}`);
          wrote++; bytes += buf.length;
        }
      }
      meta.levels.push({ L: lvl.L, scale: lvl.scale, cols: lvl.cols, rows: lvl.rows, present });
      console.log(`L${lvl.L}: wrote ${present.length}/${lvl.cols * lvl.rows} tiles`);
    }

    writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta));
    const regions = (master.regions || []).map((r) => ({ id: r.id, title: r.title, ref: r.ref, x: r.x, y: r.y, w: r.w, h: r.h }));
    writeFileSync(join(OUT_DIR, "regions.json"), JSON.stringify(regions));

    const nonBlank = sizes.filter((s) => s >= BLANK_BYTES);
    const min = nonBlank.length ? Math.min(...nonBlank) : 0;
    const blankMax = sizes.filter((s) => s < BLANK_BYTES).reduce((a, b) => Math.max(a, b), 0);
    console.log(`\n${"=".repeat(56)}`);
    console.log(`baked ${wrote} tiles (${(bytes / 1024).toFixed(0)} KB), skipped ${skipped} blank`);
    console.log(`blank floor ${BLANK_BYTES}B: largest skipped ${blankMax}B, smallest kept ${min}B`);
    console.log(`regions.json: ${regions.length} regions`);
    console.log(`elapsed ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`output: web/public/tiles/master/`);
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill("SIGKILL");
    if (preview) preview.kill("SIGKILL");
  }
}

/** Decode the captured image's physical pixel size, once, via the browser. */
async function measureDims(cdp, b64) {
  return cdp.eval(`new Promise(res => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth);
    img.onerror = () => res(-1);
    img.src = 'data:image/webp;base64,${b64}';
  })`, true);
}

main().catch((e) => { console.error(e); process.exit(1); });

// End-user render performance harness.
//
// Measures what a reader actually feels when they open a chart — not lab metrics:
//   firstCellMs        the sheet stops being blank (a metabolite box is on screen)
//   halfStructuresMs   half the molecules have appeared
//   allStructuresMs    the drawing is complete
//   requests / bytes   what it cost to get there
//
// Drives headless Chromium over the DevTools Protocol with no npm dependencies
// (Node 23 has a global WebSocket). Chromium is located from the Playwright cache
// or the system; override with CHROME_PATH.
//
// Usage:
//   node tools/render-perf.mjs                          # default chart set, local preview
//   node tools/render-perf.mjs --base https://…/        # against a deployment
//   node tools/render-perf.mjs --json _master glycolysis
//   node tools/render-perf.mjs --budget 4000            # exit 1 if allStructuresMs exceeds

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const asJson = argv.includes("--json");
const BASE = flag("base", "http://localhost:4173/metabolian/");
const BUDGET = Number(flag("budget", 0));
const TIMEOUT = Number(flag("timeout", 90000));
const charts = argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);

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
  // GitHub's ubuntu runners ship Chrome at /usr/bin/google-chrome. Missing it here
  // is what made the CI job fail to launch a browser at all.
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
                   "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium",
                   "/opt/google/chrome/chrome"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium found. Set CHROME_PATH.");
}

/** Minimal DevTools Protocol client. */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg.result ?? {}); this.pending.delete(msg.id); }
      else if (msg.method) (this.handlers.get(msg.method) || []).forEach((h) => h(msg.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r?.result?.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(url) {
  const port = 9222 + Math.floor(performance.now() % 500);
  const proc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
    "--disable-dev-shm-usage", "--hide-scrollbars",
    // A cold CI runner spends seconds on first-run setup, extension loading and
    // GCM registration before the debugging socket answers. None of it is wanted
    // for a measurement run, and waiting on it is what timed the attach out.
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
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
    for (let i = 0; i < 300 && !ws; i++) {
      await sleep(150);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === "page");
        if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
      } catch { /* not up yet */ }
    }
    if (!ws) throw new Error(`could not attach to Chromium at ${findChrome()}\n${launchLog.trim() || "(no stderr)"}`);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });

    const cdp = new CDP(ws);
    let requests = 0, bytes = 0, molRequests = 0, molBytes = 0;
    cdp.on("Network.responseReceived", (p) => {
      requests++;
      if ((p.response?.url || "").includes("/mol/")) molRequests++;
    });
    cdp.on("Network.loadingFinished", (p) => { bytes += p.encodedDataLength || 0; });
    cdp.on("Network.dataReceived", (p) => { if (p.encodedDataLength) molBytes += 0; });

    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // How many structures this chart should end up drawing, from its own data —
    // more reliable than asking the page, and works against any deployment.
    let expectedFromData = 0;
    try {
      const id = new URL(url).searchParams.get("id");
      const data = await (await fetch(new URL(`chart/${id}.json`, url).href)).json();
      expectedFromData = (data.nodes || []).filter((n) => n.mol).length;
    } catch { /* fall back to observing the page */ }

    const t0 = performance.now();
    await cdp.send("Page.navigate", { url });

    const since = () => Math.round(performance.now() - t0);
    let firstCellMs = null, halfMs = null, allMs = null, expected = 0, seen = 0;
    while (since() < TIMEOUT) {
      const s = await cdp.eval(`(()=>{const c=document.querySelectorAll('.met-cell').length;
        const m=document.querySelectorAll('.mol-inline').length;
        const w=(window.__chartExpectedStructures)||0;return {c,m,w};})()`);
      if (s) {
        if (!firstCellMs && s.c > 0) firstCellMs = since();
        expected = Math.max(expected, s.w || 0, expectedFromData);
        seen = s.m;
        if (expected && !halfMs && s.m >= expected / 2) halfMs = since();
        if (expected && !allMs && s.m >= expected) { allMs = since(); break; }
      }
      await sleep(100);
    }
    return { url, firstCellMs, halfStructuresMs: halfMs, allStructuresMs: allMs, structures: seen, expected, requests, molRequests, kb: Math.round(bytes / 1024) };
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    proc.kill("SIGKILL");
  }
}

const targets = (charts.length ? charts : ["_master", "bile-acid-synthesis", "glycolysis"]);
const results = [];
for (const id of targets) results.push(await measure(`${BASE}chart.html?id=${id}`));

if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  console.log("chart".padEnd(30) + "firstCell".padStart(11) + "half".padStart(9) + "all".padStart(9) + "structs".padStart(9) + "reqs".padStart(7) + "mol".padStart(6) + "KB".padStart(8));
  for (const r of results) {
    const id = r.url.split("id=")[1] || r.url;
    console.log(id.padEnd(30)
      + String(r.firstCellMs ?? "—").padStart(11) + String(r.halfStructuresMs ?? "—").padStart(9)
      + String(r.allStructuresMs ?? "—").padStart(9) + `${r.structures}/${r.expected}`.padStart(9)
      + String(r.requests).padStart(7) + String(r.molRequests).padStart(6) + String(r.kb).padStart(8));
  }
}

if (BUDGET) {
  const over = results.filter((r) => (r.allStructuresMs ?? Infinity) > BUDGET);
  if (over.length) {
    console.error(`\n✗ ${over.length} chart(s) exceeded the ${BUDGET}ms budget to finish drawing.`);
    process.exit(1);
  }
  console.log(`\n✓ all charts finished drawing within ${BUDGET}ms.`);
}

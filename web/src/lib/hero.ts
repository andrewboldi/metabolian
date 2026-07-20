/**
 * THE STACK — home hero backdrop.
 *
 * The atlas claims N pathway sheets, so the hero shows N pathway sheets. One
 * sheet sits near the camera, face-on and lit like paper on a light table; it
 * is revealed to be the front of a ream receding into the dark until the corpus
 * reads as a single monolithic block. One sheet is readable, a few thousand is
 * a monument — a statement that only parallax can make, which is the entire
 * justification for spending a 3D library here.
 *
 * The sheet count is READ FROM graph/index.json at runtime, never hardcoded: an
 * atlas that misstates its own size is the one error this project cannot afford.
 *
 * ─── DO NOT BREAK EARLY-Z ────────────────────────────────────────────────────
 * Every sheet covers roughly the same screen region, so naive rendering is
 * ~N-times overdraw and will hard-lock an integrated GPU. Three sorts *objects*
 * front-to-back, but an InstancedMesh is ONE object — instances rasterise in
 * buffer order. The stack is static and the camera only ever travels along +Z
 * looking toward −Z, so front-to-back order is known at build time and never
 * changes: instance 0 is the NEAREST sheet, instance N−1 the farthest. The
 * depth test then rejects ~99% of fragments before they shade.
 *
 * That holds ONLY while the material stays opaque and depth-writing. Setting
 * `transparent: true`, adding a `discard`, or writing `gl_FragDepth` silently
 * disables early-Z and melts the page. It looks like a harmless change. It is
 * not. Profile on the integrated GPU (`powerPreference: "low-power"` selects
 * it) — a discrete card will not reveal the problem.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cost discipline: three.js is dynamically imported, and only once the canvas is
 * actually near the viewport, so a bouncing visitor never pays for it. Reduced
 * motion, data-saver, and no-WebGL all resolve without downloading the library
 * (reduced motion still paints one frozen frame — the composition is identical,
 * just still). This is the only page on the site that loads three at all.
 */

import { asset } from "./util";

/** The only place in the file that names the (untyped) three module. Everything
 *  else derives from it, so if `@types/three` is ever installed the whole module
 *  becomes properly typed with no edits here. */
function loadThree() {
  return import("three");
}
type ThreeModule = Awaited<ReturnType<typeof loadThree>>;
type TRenderer = InstanceType<ThreeModule["WebGLRenderer"]>;
type TScene = InstanceType<ThreeModule["Scene"]>;
type TCamera = InstanceType<ThreeModule["PerspectiveCamera"]>;
type TMesh = InstanceType<ThreeModule["InstancedMesh"]>;
type TGeometry = InstanceType<ThreeModule["PlaneGeometry"]>;
type TMaterial = InstanceType<ThreeModule["MeshBasicMaterial"]>;
type TFog = InstanceType<ThreeModule["FogExp2"]>;

/* ── Scene constants ─────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;

/** ISO 216 (√2) sheet, the proportion of real paper. */
const SHEET_W = 1;
const SHEET_H = 1 / Math.SQRT2;

/** Distance between sheets. Tuned so a sheet edge is ~2px wide on screen at the
 *  rest pose: fine enough to read as stock, coarse enough not to alias away. */
const PITCH = 0.052;

/** Per-sheet jitter. THE most important parameter in the file: without it the
 *  ream renders as a solid extrusion; with it the edges break up irregularly
 *  and it reads unmistakably as paper. */
const JITTER_XY = 0.012;
const JITTER_ROLL = 0.35 * DEG;
const JITTER_TONE = 0.075;

/** Sanity cap on allocation (matrix is 64B/instance). Sheets past the fog
 *  horizon still cost a handful of vertex invocations each and nothing more —
 *  early-Z rejects their fragments — so the real limit is memory, not fill. */
const MAX_SHEETS = 6000;
const FALLBACK_SHEETS = 1200;

const FOV = 38;

/** Choreography: t = 0 at rest, t = 1 when the hero has scrolled by REVEAL_SPAN
 *  of its own height. Camera dollies back and yaws; fog thins so the far end
 *  resolves as it recedes. */
const REVEAL_SPAN = 0.65;
const POSE = {
  z: [2.62, 6.4],
  yaw: [-0.17, -0.42],
  tilt: [0.085, 0.15],
  fog: [0.055, 0.034],
};
/** Frozen pose for prefers-reduced-motion: slightly into the reveal, because a
 *  still has to carry the whole idea in one frame. */
const STILL_T = 0.3;

/** Damping on the scroll-driven camera. The inertia is what reads as expensive;
 *  raw scroll values applied directly feel cheap and twitchy. */
const SCRUB_DAMP = 0.08;

/** One-way quality ratchet. Measured FPS beats device sniffing — it sees thermal
 *  throttling and Low Power Mode, which no static probe can. Steps truncate
 *  `mesh.count` (never a buffer repack: the far sheets are already fogged out,
 *  so truncation is visually free) and lower DPR, which is the real lever since
 *  fragment cost is quadratic in it. */
const TIERS = [
  { frac: 1, dpr: 1.5 },
  { frac: 0.5, dpr: 1.3 },
  { frac: 0.25, dpr: 1.15 },
  { frac: 0.12, dpr: 1 },
];
const FPS_FLOOR = 55.5;
const FPS_WARMUP = 30; // skip shader-compile stalls
const FPS_WINDOW = 50;
const FPS_STRIKES = 2; // consecutive bad windows before stepping down

/** Pathway category → an existing design token, so the ream is faintly striped
 *  by biochemical domain. That stripe is data, not decoration. */
const CATEGORY_TOKEN: Record<string, [string, string]> = {
  "amino-acid-metabolism": ["--node-metabolite", "#5ad1c4"],
  "lipid-metabolism": ["--edge-covalent", "#f4a93b"],
  "carbohydrate-metabolism": ["--node-enzyme", "#6aa4ff"],
  "energy-metabolism": ["--edge-redox", "#ffe14d"],
  "nucleotide-metabolism": ["--node-gene", "#b57bff"],
  "redox-detox": ["--edge-transport", "#22c3e6"],
  "cofactor-vitamin-metabolism": ["--edge-cofactor", "#2fb6a8"],
  "neurotransmitter-metabolism": ["--edge-signal", "#ffd24c"],
  "one-carbon-metabolism": ["--edge-catalysis", "#4c8dff"],
  "hormone-signaling": ["--edge-signal", "#ffd24c"],
  "microbiome-host": ["--edge-microbiome", "#52d273"],
  "cancer-rewiring": ["--edge-crosstalk", "#ff4d8d"],
  other: ["--node-pathway", "#9aa7b4"],
};
const FALLBACK_CATEGORY = "other";

/* ── Small math helpers ──────────────────────────────────────────────────── */

type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Deterministic hash in [0,1). Deterministic rather than Math.random so a
 *  rebuild after WebGL context loss reproduces the identical ream — no pop. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453123;
  return s - Math.floor(s);
}
const signedHash = (n: number) => hash(n) * 2 - 1;

/** Smoothstep — the scroll reveal should not start or stop abruptly. */
const ease = (t: number) => t * t * (3 - 2 * t);

function parseHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/* ── Token reader ────────────────────────────────────────────────────────── */

/**
 * Resolves a CSS custom property to sRGB floats. Goes through the browser twice
 * on purpose: a hidden probe element to substitute `var()` and compute the
 * value, then a 1×1 canvas to rasterise whatever syntax that produced. Token
 * values are literal hex today, but the palette is being rebuilt in parallel and
 * `color-mix()` / `oklch()` would defeat any hand-written parser; the rasteriser
 * understands everything the browser does.
 */
function createPalette() {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;top:0;left:-9999px;width:0;height:0;pointer-events:none;visibility:hidden";
  (document.body ?? document.documentElement).appendChild(probe);

  const bmp = document.createElement("canvas");
  bmp.width = bmp.height = 1;
  const ctx = bmp.getContext("2d", { willReadFrequently: true });

  function read(token: string, fallback: string): RGB {
    const fb = parseHex(fallback);
    try {
      probe.style.color = fallback;
      probe.style.color = `var(${token}, ${fallback})`;
      const css = getComputedStyle(probe).color;
      if (!css || !ctx) return fb;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] < 8) return fb;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    } catch {
      return fb;
    }
  }

  return { read, dispose: () => probe.remove() };
}

type Palette = ReturnType<typeof createPalette>;

interface Inks {
  bg: RGB;
  /** Base tone of a sheet, already sunk to backdrop level for the active theme. */
  sheet: RGB;
  /** Undimmed paper — the near sheets are lifted toward it. */
  paper: RGB;
  /** How far the nearest sheets are lifted toward paper. */
  lift: number;
  tint: Record<string, RGB>;
}

/**
 * Derives the ream's inks from tokens. Theme is detected from `--bg` luminance
 * rather than the `data-theme` attribute, so it stays correct under
 * `prefers-color-scheme` with no attribute set, and under whatever the parallel
 * palette rebuild lands on.
 *
 * Dark: paper sunk toward the background — paper in a darkroom, the near edge
 * catching the lamp. Light: paper sunk toward ink, because a white sheet on a
 * warm-white ground has nothing to separate it but its own shadow, and an unlit
 * material casts none.
 */
function readInks(p: Palette): Inks {
  const bg = p.read("--bg", "#0b0f14");
  const paper = p.read("--paper", "#ffffff");
  const ink = p.read("--text", "#0c1116");
  const light = luminance(bg) > 0.5;

  const sheet = light ? mixRGB(paper, ink, 0.24) : mixRGB(paper, bg, 0.42);
  const tint: Record<string, RGB> = {};
  for (const [cat, [token, fallback]] of Object.entries(CATEGORY_TOKEN)) {
    tint[cat] = p.read(token, fallback);
  }
  return { bg, sheet, paper, lift: light ? 0.14 : 0.42, tint };
}

/* ── Atlas data ──────────────────────────────────────────────────────────── */

interface AtlasIndex {
  stats?: { pathways?: number };
  pathways?: { category?: string }[];
}

/**
 * Categories, one per sheet, front-to-back. `force-cache` because home.ts has
 * already fetched this exact URL for the stat readout by the time the hero
 * starts — this should be a cache hit, not a second megabyte.
 */
async function loadSheets(): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(asset("graph/index.json"), {
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const idx = (await res.json()) as AtlasIndex;
    const list = idx.pathways;
    if (Array.isArray(list) && list.length) {
      return list.slice(0, MAX_SHEETS).map((p) => p?.category ?? FALLBACK_CATEGORY);
    }
    const n = clamp(idx.stats?.pathways ?? FALLBACK_SHEETS, 1, MAX_SHEETS);
    return new Array(n).fill(FALLBACK_CATEGORY);
  } catch {
    return new Array(FALLBACK_SHEETS).fill(FALLBACK_CATEGORY);
  } finally {
    clearTimeout(timer);
  }
}

/* ── Guards ──────────────────────────────────────────────────────────────── */

/**
 * `failIfMajorPerformanceCaveat` catches software rasterisers (SwiftShader) for
 * free, which is the tier-0 signal that makes a GPU-benchmark library
 * unnecessary — and every such library fetches its benchmark corpus from a CDN
 * at runtime, which this site does not do.
 */
function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const attrs: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: true,
      alpha: false,
      depth: true,
      antialias: false,
    };
    const gl = (c.getContext("webgl2", attrs) ?? c.getContext("webgl", attrs)) as
      | WebGLRenderingContext
      | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return c?.saveData === true;
}

const noop = () => {};

/* ── Entry point ─────────────────────────────────────────────────────────── */

/**
 * Mounts the stack on `canvas`. Resolves with a teardown function; callers that
 * ignore the result (the current one does) get correct lifecycle handling from
 * the internal `pagehide` hook regardless.
 */
export async function initHero(canvas: HTMLCanvasElement): Promise<() => void> {
  if (saveData() || !webglAvailable()) return noop;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  // Gate the 188 KB download on proximity to the viewport. The hero is above the
  // fold, so this normally fires immediately; a deep link that lands further
  // down the page never pays for three at all — this promise simply never
  // settles, and nothing downstream runs.
  await new Promise<void>((resolve) => {
    if (!("IntersectionObserver" in window)) return resolve();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(canvas);
  });

  // In parallel: the library download and the sheet count. Neither needs the
  // other, and serialising them would put a cache lookup in front of 188 KB.
  const [sheets, THREE] = await Promise.all([loadSheets(), loadThree().catch(() => null)]);
  if (!THREE) return noop;

  return mount(THREE, canvas, sheets, reduce);
}

/* ── Implementation ──────────────────────────────────────────────────────── */

function mount(
  T: ThreeModule,
  canvas: HTMLCanvasElement,
  sheets: string[],
  reduceQuery: MediaQueryList,
): () => void {
  const palette = createPalette();

  let renderer: TRenderer;
  try {
    renderer = new T.WebGLRenderer({
      canvas,
      // Opaque. Fog blends toward the page background, which only composites
      // correctly against a cleared opaque buffer — and an opaque buffer is
      // cheaper besides. See the early-Z note at the top of this file.
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    palette.dispose();
    return noop;
  }
  renderer.setPixelRatio(1); // drawing buffer is sized in device pixels directly

  const scene: TScene = new T.Scene();
  const camera: TCamera = new T.PerspectiveCamera(FOV, 1, 0.1, 400);

  let geometry: TGeometry | null = null;
  let material: TMaterial | null = null;
  let mesh: TMesh | null = null;
  let fog: TFog | null = null;
  let inks = readInks(palette);

  const total = clamp(sheets.length, 1, MAX_SHEETS);
  const color = new T.Color();
  const matrix = new T.Matrix4();
  const quat = new T.Quaternion();
  const euler = new T.Euler();
  const pos = new T.Vector3();
  const scale = new T.Vector3(1, 1, 1);

  let tier = 0;
  let disposed = false;
  let contextLost = false;
  let onScreen = true;
  let tabVisible = !document.hidden;
  let raf = 0;
  let prevTime = 0;
  let clock = 0;
  let targetT = 0;
  let curT = 0;
  let scrollDirty = true;
  let bufferW = 0;
  let bufferH = 0;

  /* -- scene construction (callable, so context restore can rebuild) ------- */

  function sheetColor(i: number): RGB {
    const cat = sheets[i] ?? FALLBACK_CATEGORY;
    const tint = inks.tint[cat] ?? inks.tint[FALLBACK_CATEGORY];
    // Faint domain stripe, then the near-edge lamp falloff, then per-sheet tone
    // jitter so no two sheets in the visible fan are the same value.
    let c = mixRGB(inks.sheet, tint, 0.12);
    c = mixRGB(c, inks.paper, inks.lift * Math.exp(-i / 22));
    const j = 1 + signedHash(i * 7.13 + 3.1) * JITTER_TONE;
    return [clamp(c[0] * j, 0, 1), clamp(c[1] * j, 0, 1), clamp(c[2] * j, 0, 1)];
  }

  function buildScene() {
    geometry = new T.PlaneGeometry(SHEET_W, SHEET_H, 1, 1);
    material = new T.MeshBasicMaterial({
      side: T.FrontSide,
      // transparent stays false and there is no discard — see the file header.
      // `dithering` is wired into the built-in mesh materials and costs nothing;
      // it suppresses 8-bit banding on the fog ramp, which is exactly where a
      // near-black gradient shows it.
      dithering: true,
      fog: true,
    });

    mesh = new T.InstancedMesh(geometry, material, total);
    mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
    // Uploaded once, never rewritten: the ream is rigid, only the camera moves.
    for (let i = 0; i < total; i++) {
      // instance 0 = nearest. Front-to-back order is what preserves early-Z.
      const z = -i * PITCH;
      // A real ream leans; two incommensurate low-frequency drifts keep the
      // stack from reading as a machined extrusion.
      const lean = Math.sin(i * 0.0115) * 0.024 + Math.sin(i * 0.0031) * 0.011;
      const rise = Math.cos(i * 0.0073) * 0.018;
      pos.set(
        signedHash(i + 0.37) * JITTER_XY + lean,
        signedHash(i + 11.9) * JITTER_XY + rise,
        z,
      );
      euler.set(0, 0, signedHash(i + 23.4) * JITTER_ROLL);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
      const [r, g, b] = sheetColor(i);
      mesh.setColorAt(i, color.setRGB(r, g, b, T.SRGBColorSpace));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(T.StaticDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }

    // Three does not cull per instance; leaving culling on would recompute a
    // bounding sphere over every instance each frame for no benefit.
    const depth = total * PITCH;
    mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0, -depth / 2), depth / 2 + SHEET_W);
    mesh.frustumCulled = false;

    scene.add(mesh);

    fog = new T.FogExp2(0x000000, POSE.fog[0]);
    scene.fog = fog;

    applyInks();
    applyTier(tier);
  }

  function disposeScene() {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    geometry?.dispose();
    material?.dispose();
    geometry = null;
    material = null;
    scene.fog = null;
    fog = null;
  }

  /* -- theme ------------------------------------------------------------- */

  function applyInks() {
    color.setRGB(inks.bg[0], inks.bg[1], inks.bg[2], T.SRGBColorSpace);
    renderer.setClearColor(color, 1);
    fog?.color.copy(color);
  }

  function recolor() {
    inks = readInks(palette);
    applyInks();
    if (mesh) {
      for (let i = 0; i < total; i++) {
        const [r, g, b] = sheetColor(i);
        mesh.setColorAt(i, color.setRGB(r, g, b, T.SRGBColorSpace));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (!raf) renderStill();
  }

  /* -- sizing ------------------------------------------------------------ */

  function dprCap(): number {
    // Never above 2 — this is an unfocused backdrop and fragment cost is
    // quadratic in pixel ratio.
    return Math.min(TIERS[tier].dpr, 2);
  }

  function resize(pxW?: number, pxH?: number) {
    const dpr = devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.offsetWidth;
    const cssH = canvas.clientHeight || canvas.offsetHeight;
    let w = pxW ?? Math.round(cssW * dpr);
    let h = pxH ?? Math.round(cssH * dpr);
    if (w < 1 || h < 1) return;

    // Downscale from true device pixels rather than trusting devicePixelRatio,
    // so fractional browser zoom lands on exact pixels.
    const shrink = Math.min(1, dprCap() / dpr);
    w = Math.max(1, Math.round(w * shrink));
    h = Math.max(1, Math.round(h * shrink));
    if (w === bufferW && h === bufferH) return;
    bufferW = w;
    bufferH = h;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    scrollDirty = true;
    if (!raf) renderStill();
  }

  /* -- choreography ------------------------------------------------------ */

  function readScroll() {
    const r = canvas.getBoundingClientRect();
    const span = Math.max(r.height * REVEAL_SPAN, 1);
    targetT = clamp(-r.top / span, 0, 1);
    scrollDirty = false;
  }

  function pose(t: number) {
    const e = ease(t);
    const wide = camera.aspect >= 1.25;
    // Narrow viewports carry far more copy over the canvas, so the ream moves
    // up out of the text column and sits further back.
    const offX = wide ? 0.44 : 0.3;
    const offY = wide ? -0.2 : 0.32;
    const push = wide ? 0 : 0.7;

    camera.position.set(0, 0, lerp(POSE.z[0], POSE.z[1], e) + push);
    if (mesh) {
      mesh.position.set(offX, offY, 0);
      mesh.rotation.set(
        lerp(POSE.tilt[0], POSE.tilt[1], e) + Math.sin(clock * 0.17 + 1.1) * 0.007,
        lerp(POSE.yaw[0], POSE.yaw[1], e) + Math.sin(clock * 0.216) * 0.013,
        0,
      );
    }
    if (fog) fog.density = lerp(POSE.fog[0], POSE.fog[1], e);
  }

  function renderStill() {
    if (disposed || contextLost || !mesh || bufferW < 1) return;
    pose(reduceQuery.matches ? STILL_T : curT);
    renderer.render(scene, camera);
  }

  /* -- quality ratchet --------------------------------------------------- */

  let frames = 0;
  let winFrames = 0;
  let winTime = 0;
  let strikes = 0;

  function applyTier(next: number) {
    tier = clamp(next, 0, TIERS.length - 1);
    if (mesh) mesh.count = Math.max(64, Math.round(total * TIERS[tier].frac));
    bufferW = bufferH = 0; // force resize() through
    resize();
  }

  function sampleFps(rawDt: number) {
    if (++frames <= FPS_WARMUP) return;
    winTime += rawDt;
    if (++winFrames < FPS_WINDOW) return;
    const fps = winFrames / Math.max(winTime, 1e-6);
    winFrames = 0;
    winTime = 0;
    if (fps >= FPS_FLOOR) {
      strikes = 0;
      return;
    }
    // One-way. Climbing back would oscillate visibly.
    if (++strikes >= FPS_STRIKES && tier < TIERS.length - 1) {
      strikes = 0;
      applyTier(tier + 1);
    }
  }

  /* -- loop -------------------------------------------------------------- */

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const rawDt = (now - prevTime) / 1000;
    prevTime = now;
    // Clamped so a resumed tab does not hand us a multi-second delta. Every
    // animated constant is per-second: fixed per-frame increments run 2× fast on
    // a 120 Hz display.
    const dt = Math.min(rawDt, 1 / 30);
    clock += dt;

    if (scrollDirty) readScroll();
    // Frame-rate-corrected damped lerp; without the pow() the damping speed
    // itself would vary with refresh rate.
    curT += (targetT - curT) * (1 - Math.pow(1 - SCRUB_DAMP, dt * 60));

    pose(curT);
    renderer.render(scene, camera);
    sampleFps(rawDt);
  }

  /** Idempotent: every gate routes through here, so starts never stack rAF
   *  chains no matter how the events interleave. */
  function sync() {
    const want = onScreen && tabVisible && !disposed && !contextLost && !reduceQuery.matches;
    if (want && !raf) {
      readScroll();
      curT = targetT; // resume in the right pose instead of catching up
      prevTime = performance.now();
      frames = 0;
      winFrames = 0;
      winTime = 0;
      raf = requestAnimationFrame(loop);
    } else if (!want && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* -- listeners --------------------------------------------------------- */

  const onScroll = () => {
    scrollDirty = true;
  };
  const onVisibility = () => {
    tabVisible = !document.hidden;
    sync();
  };
  const onContextLost = (e: Event) => {
    e.preventDefault(); // mandatory: without it, restore never fires
    contextLost = true;
    sync();
  };
  const onContextRestored = () => {
    if (disposed) return;
    contextLost = false;
    disposeScene();
    buildScene();
    sync();
    if (!raf) renderStill();
  };
  const onReduceChange = () => {
    sync();
    if (!raf) renderStill();
  };
  const onPageHide = (e: PageTransitionEvent) => {
    // A bfcache-persisted page must come back alive; only a real unload tears down.
    if (!e.persisted) destroy();
  };

  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  addEventListener("pagehide", onPageHide);
  reduceQuery.addEventListener("change", onReduceChange);

  const visibilityObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            sync();
          },
          { rootMargin: "120px" },
        )
      : null;
  visibilityObserver?.observe(canvas);

  // device-pixel-content-box gives exact device pixels, so hairline sheet edges
  // stay crisp at 125%/150% zoom. Passing an unsupported box value throws;
  // Safari falls back to content-box with no regression.
  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0]?.devicePixelContentBoxSize?.[0];
    if (box) resize(box.inlineSize, box.blockSize);
    else resize();
  });
  try {
    resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    resizeObserver.observe(canvas);
  }

  // There is no devicepixelratiochange event; the media query has to be renewed
  // after every change.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = () => {
    dprQuery?.removeEventListener("change", onDprChange);
    watchDpr();
    bufferW = bufferH = 0;
    resize();
  };
  function watchDpr() {
    if (disposed) return;
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", onDprChange);
  }
  watchDpr();

  const themeObserver = new MutationObserver(recolor);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const schemeQuery = matchMedia("(prefers-color-scheme: light)");
  schemeQuery.addEventListener("change", recolor);

  /* -- teardown ---------------------------------------------------------- */

  function destroy() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    removeEventListener("pagehide", onPageHide);
    reduceQuery.removeEventListener("change", onReduceChange);
    dprQuery?.removeEventListener("change", onDprChange);
    schemeQuery.removeEventListener("change", recolor);
    visibilityObserver?.disconnect();
    resizeObserver.disconnect();
    themeObserver.disconnect();

    disposeScene();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    palette.dispose();
  }

  /* -- go ---------------------------------------------------------------- */

  buildScene();
  resize();
  readScroll();
  curT = targetT;

  // Reduced motion gets the identical composition, frozen: one frame, no loop.
  if (reduceQuery.matches) renderStill();
  else sync();

  return destroy;
}

/**
 * THE JOURNEY — home hero.
 *
 * One molecule of glucose, drawn as crisp skeletal line-art, rotating in the
 * dark like a specimen on a light table. Scroll, and it descends a glowing
 * metabolic pathway laid out as a transit map: each station (G6P, F6P, F1,6BP,
 * the triose split) lights as the molecule passes, ATP sparks fire across the
 * two kinase steps, and far behind, the atlas itself assembles — a receding
 * ream of pathway sheets resolving out of the fog into a monument. The abstract
 * journey in front, the corpus it becomes behind: the whole thesis in one view.
 *
 * The pathway is glycolysis steps 1–4, the same chemistry as the static plate
 * beside it (data/pathways/glycolysis.json): glucose → G6P → F6P → F1,6-BP →
 * DHAP + GA3P, hexokinase and PFK-1 spending ATP. The molecule follows the
 * productive branch to GA3P; DHAP lights as the mass-action split.
 *
 * ─── DO NOT BREAK EARLY-Z ────────────────────────────────────────────────────
 * The ream is an InstancedMesh of ~N opaque sheets covering the same screen
 * region — naive that is N× overdraw and will hard-lock an integrated GPU.
 * Three sorts *objects* front-to-back; an InstancedMesh is ONE object, so
 * instances rasterise in buffer order. Instance 0 is the NEAREST sheet, N−1 the
 * farthest, and the camera only travels along +Z looking toward −Z, so the
 * depth test rejects ~99% of the ream's fragments before they shade.
 *
 * That holds ONLY while the ream material stays opaque and depth-writing.
 * `transparent:true`, a `discard`, or writing `gl_FragDepth` on the REAM
 * silently disables early-Z and melts the page. The glowing overlays (molecule,
 * pathway, sparks) are separate additive objects drawn AFTER the opaque ream
 * with depthWrite off — that is fine and does not touch the ream's early-Z.
 * Profile on the integrated GPU (`powerPreference:"low-power"` selects it).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cost discipline: three.js AND gsap are dynamically imported, and only after
 * the cheap guards pass (not data-saver, WebGL present, near the viewport), so a
 * bouncing visitor — or one on a device that cannot run WebGL — downloads
 * neither. This is the only page on the site that loads either library, and
 * hero.ts is reached exclusively through a dynamic import in pages/home.ts, which
 * is what keeps both out of every page entry chunk. Reduced motion resolves in
 * pages/home.ts BEFORE this module is fetched: the still SVG plate is the hero
 * there, so we never ship a 3D library to paint one frame.
 */

import { asset } from "./util";

/* ── Module handles (typed via @types/three; loaded at runtime) ──────────── */

type ThreeModule = typeof import("three");
type TRenderer = InstanceType<ThreeModule["WebGLRenderer"]>;
type TScene = InstanceType<ThreeModule["Scene"]>;
type TCamera = InstanceType<ThreeModule["PerspectiveCamera"]>;
type TGroup = InstanceType<ThreeModule["Group"]>;
type TInstanced = InstanceType<ThreeModule["InstancedMesh"]>;
type TMesh = InstanceType<ThreeModule["Mesh"]>;
type TSprite = InstanceType<ThreeModule["Sprite"]>;
type TPoints = InstanceType<ThreeModule["Points"]>;
type TFog = InstanceType<ThreeModule["FogExp2"]>;
type TTexture = InstanceType<ThreeModule["Texture"]>;
type TMaterial = InstanceType<ThreeModule["Material"]>;

/* ── Scene constants ─────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;

/** ISO 216 (√2) sheet — the proportion of real paper. */
const SHEET_W = 1;
const SHEET_H = 1 / Math.SQRT2;
const PITCH = 0.05;
const JITTER_XY = 0.012;
const JITTER_ROLL = 0.35 * DEG;
const JITTER_TONE = 0.075;

/** The ream is now a backdrop monument, so it needs fewer sheets than a
 *  full-screen ream would; the horizon is fogged either way. */
const MAX_SHEETS = 4200;
const FALLBACK_SHEETS = 1200;

const FOV = 40;

/** Choreography, in journey-progress t ∈ [0,1] (0 at rest, 1 when the hero has
 *  scrolled one screen). The molecule leads the drawn line slightly, so its tip
 *  always sits just ahead of the lit track. */
const MOL_SPAN = 0.82; // molecule reaches the triose end near the end of the pinned hold
const LINE_SPAN = 0.86; // the track finishes drawing just after
const STILL_T = 0.62; // frozen pose for reduced motion: fully descended, all lit

const POSE = {
  z: [7.0, 7.9],
  tilt: [0.02, 0.12],
  // FogExp2 is exp(-(density·dist)²), so this thins from "the monument is barely
  // a rumour in the fog" at rest to "resolved, its sheet edges legible" by the
  // end of the hold — the ream assembling itself as the reader scrolls.
  fog: [0.1, 0.04],
};

/** Damping on the scroll-driven progress — the inertia is what reads as
 *  expensive; raw scroll applied directly feels cheap and twitchy. */
const SCRUB_DAMP = 0.09;

/** Quality ratchet: measured FPS beats device sniffing (it sees thermal
 *  throttling and Low Power Mode). Steps truncate the REAM's instance count
 *  (far sheets are fogged out, so truncation is visually free) and lower DPR,
 *  which is the real lever since fragment cost is quadratic in it. */
const TIERS = [
  { frac: 1, dpr: 1.6 },
  { frac: 0.5, dpr: 1.35 },
  { frac: 0.25, dpr: 1.15 },
  { frac: 0.12, dpr: 1 },
];
const FPS_FLOOR = 55.5;
const FPS_WARMUP = 30;
const FPS_WINDOW = 50;
const FPS_STRIKES = 2;

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

/* ── The pathway (world coordinates) ─────────────────────────────────────── */

type Vec2 = [number, number];

/** Stations, top to bottom. `t` is where the molecule sits along its own path
 *  when it reaches this station (used to light labels and stations in step). */
interface Station {
  name: string;
  short: string;
  pos: Vec2;
  t: number;
  main: boolean; // on the molecule's productive route (vs the DHAP side-branch)
}
const STATIONS: Station[] = [
  { name: "D-Glucose", short: "Glucose", pos: [0, 1.4], t: 0.0, main: true },
  { name: "Glucose 6-phosphate", short: "G6P", pos: [0, 0.62], t: 0.24, main: true },
  { name: "Fructose 6-phosphate", short: "F6P", pos: [0, -0.16], t: 0.47, main: true },
  { name: "Fructose 1,6-bisphosphate", short: "F1,6BP", pos: [0, -0.94], t: 0.7, main: true },
  { name: "Dihydroxyacetone-P", short: "DHAP", pos: [-0.86, -1.85], t: 0.86, main: false },
  { name: "Glyceraldehyde 3-P", short: "GA3P", pos: [0.86, -1.85], t: 1.0, main: true },
];
const FORK: Vec2 = [0, -1.34];

/** The molecule's route: down the trunk, then out to GA3P (the triose that
 *  carries glycolysis onward — DHAP is isomerised into it). */
const MOL_ROUTE: Vec2[] = [
  STATIONS[0].pos,
  STATIONS[1].pos,
  STATIONS[2].pos,
  STATIONS[3].pos,
  FORK,
  STATIONS[5].pos,
];

/** The two ATP-spending kinase steps, as fractions along the drawn line, so the
 *  sparks fire exactly as those segments light. */
const KINASE_STEPS = [0.12, 0.58];

/* ── Small math ──────────────────────────────────────────────────────────── */

type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
/** Smoothstep — reveals should not start or stop abruptly. */
const ease = (t: number) => t * t * (3 - 2 * t);
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Deterministic hash in [0,1). Deterministic, not Math.random, so a rebuild
 *  after WebGL context loss reproduces the identical ream — no pop. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453123;
  return s - Math.floor(s);
}
const signedHash = (n: number) => hash(n) * 2 - 1;

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
 * on purpose: a hidden probe to substitute `var()` and compute the value, then a
 * 1×1 canvas to rasterise whatever syntax that produced — so `color-mix()` /
 * `oklch()` in the token layer resolve exactly as the browser would paint them.
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
  sheet: RGB;
  paper: RGB;
  lift: number;
  tint: Record<string, RGB>;
  /** The molecule / line / spark inks, all read from tokens. */
  bond: RGB; // skeletal bonds — the sheet's enzyme blue
  lineTop: RGB; // pathway gradient, top (sugar-phosphate)
  lineBot: RGB; // pathway gradient, bottom (triose)
  spark: RGB; // ATP / energy
  atomO: RGB; // oxygen atoms
}

/**
 * Derives every ink from tokens. Theme is detected from `--bg` luminance rather
 * than the attribute, so it stays correct under `prefers-color-scheme` with no
 * `data-theme` set. Dark: paper sunk toward the background (paper in a darkroom,
 * the near edge catching the lamp). Light: paper sunk toward ink, because a
 * white sheet on warm-white ground separates only by its own shadow.
 */
function readInks(p: Palette): Inks {
  const bg = p.read("--bg", "#0a0d12");
  const paper = p.read("--paper", "#ffffff");
  const ink = p.read("--text", "#e8e6e1");
  const light = luminance(bg) > 0.5;

  // The ream is a background monument, so its stock sits darker (nearer the
  // field) than a face-on ream would, and is lifted toward paper only faintly.
  const sheet = light ? mixRGB(paper, ink, 0.26) : mixRGB(paper, bg, 0.58);
  const tint: Record<string, RGB> = {};
  for (const [cat, [token, fallback]] of Object.entries(CATEGORY_TOKEN)) {
    tint[cat] = p.read(token, fallback);
  }
  const bond = p.read("--accent", "#7198df");
  const lineTop = p.read("--node-enzyme", "#7eaafd");
  const lineBot = p.read("--node-metabolite", "#45c1b4");
  const spark = p.read("--edge-redox", "#ffe14d");
  const atomO = p.read("--paper-red", "#ef2d47");
  return { bg, sheet, paper, lift: light ? 0.12 : 0.2, tint, bond, lineTop, lineBot, spark, atomO };
}

/* ── Atlas data (drives the ream's sheet count + domain stripe) ──────────── */

interface AtlasIndex {
  stats?: { pathways?: number };
  pathways?: { category?: string }[];
}
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

/* ── Library loaders (the only places the untyped-at-runtime modules are named) */

function loadThree() {
  return import("three");
}
function loadGsap() {
  return Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
}
type GsapModule = Awaited<ReturnType<typeof loadGsap>>;

/* ── Entry point ─────────────────────────────────────────────────────────── */

/**
 * Mounts the journey on `canvas`. Resolves with a teardown function; callers
 * that ignore it (the current one does) still get correct lifecycle handling
 * from the internal `pagehide` hook.
 */
export async function initHero(canvas: HTMLCanvasElement): Promise<() => void> {
  if (saveData() || !webglAvailable()) return noop;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  // Gate the download on proximity: the hero is above the fold, so this normally
  // fires at once; a deep link further down never pays for three or gsap — the
  // promise simply never settles and nothing downstream runs.
  //
  // Observe the hero SECTION, never the canvas or its stage: both are
  // display:none until mount() adds .is-hero-live, and a display:none element
  // never intersects — observing one here would deadlock the very mount that is
  // supposed to reveal it.
  const proximityTarget = document.querySelector<HTMLElement>(".hero") ?? canvas;
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
    io.observe(proximityTarget);
  });

  // The sheet count, three, and gsap in parallel — none needs the others.
  const [sheets, THREE, GSAP] = await Promise.all([
    loadSheets(),
    loadThree().catch(() => null),
    loadGsap().catch(() => null),
  ]);
  if (!THREE) return noop;

  return mount(THREE, GSAP, canvas, sheets, reduce);
}

/* ── Implementation ──────────────────────────────────────────────────────── */

function mount(
  T: ThreeModule,
  GSAP: GsapModule | null,
  canvas: HTMLCanvasElement,
  sheets: string[],
  reduceQuery: MediaQueryList,
): () => void {
  const palette = createPalette();
  // The stage is the fixed backdrop the canvas lives in (a body-level element);
  // the hero SECTION is a separate flow element and is what scroll + visibility
  // are measured against. The stage is display:none until we go live, so it is
  // never a safe observation target — always use the hero for that.
  const stage = canvas.parentElement ?? canvas;
  const heroSection = document.querySelector<HTMLElement>(".hero") ?? stage;

  let renderer: TRenderer;
  try {
    renderer = new T.WebGLRenderer({
      canvas,
      // Opaque: the ream blends toward the page background through fog, which
      // only composites correctly against a cleared opaque buffer — and an
      // opaque buffer is cheaper. The canvas edges are masked into the page in
      // CSS. See the early-Z note at the top of this file.
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
  renderer.setPixelRatio(1); // buffer is sized in device pixels directly

  const scene: TScene = new T.Scene();
  const camera: TCamera = new T.PerspectiveCamera(FOV, 1, 0.1, 400);

  let inks = readInks(palette);
  const total = clamp(sheets.length, 1, MAX_SHEETS);

  // Reusable scratch (never allocate in the loop).
  const color = new T.Color();
  const matrix = new T.Matrix4();
  const quat = new T.Quaternion();
  const euler = new T.Euler();
  const pos = new T.Vector3();
  const scl = new T.Vector3(1, 1, 1);
  const proj = new T.Vector3();

  /* -- shared glow sprite texture (soft core + faint ring = a lit station) -- */
  function makeGlowTexture(): TTexture {
    const s = 128;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.18, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // a crisp thin ring — the "transit stop" tell
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    g.stroke();
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  function makeDotTexture(): TTexture {
    const s = 64;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  let glowTex: TTexture | null = null;
  let dotTex: TTexture | null = null;

  /* -- scene graph (nullable so context-restore can rebuild) --------------- */
  let reamGroup: TGroup | null = null;
  let ream: TInstanced | null = null;
  let reamGeo: InstanceType<ThreeModule["PlaneGeometry"]> | null = null;
  let reamMat: InstanceType<ThreeModule["MeshBasicMaterial"]> | null = null;
  let fog: TFog | null = null;

  let fx: TGroup | null = null;
  let molecule: TGroup | null = null;
  let molBonds: InstanceType<ThreeModule["LineSegments"]> | null = null;
  let molAtoms: TPoints | null = null;
  let trackMesh: TMesh | null = null;
  let glowMesh: TMesh | null = null;
  let glowIdxCount = 0;
  let stationSprites: TSprite[] = [];
  let sparks: TPoints | null = null;
  let sparkBase: Float32Array | null = null; // per-point [ax,ay, cx,cy, bx,by, phase] arcs
  let ambient: TSprite | null = null;

  const disposables: TMaterial[] = [];
  const geometries: InstanceType<ThreeModule["BufferGeometry"]>[] = [];

  /* -- station labels (a transit map wants names) -------------------------- */
  let labelWrap: HTMLElement | null = null;
  const labels: HTMLElement[] = [];
  function buildLabels() {
    if (!(stage instanceof HTMLElement)) return;
    labelWrap = document.createElement("div");
    labelWrap.className = "hero-stage__labels";
    labelWrap.setAttribute("aria-hidden", "true");
    for (const st of STATIONS) {
      const el = document.createElement("span");
      el.className = "hero-label" + (st.main ? "" : " hero-label--branch");
      el.textContent = st.short;
      el.style.opacity = "0";
      labelWrap.appendChild(el);
      labels.push(el);
    }
    stage.appendChild(labelWrap);
  }

  /* -- ream: the atlas as a receding monument ------------------------------ */
  function sheetColor(i: number): RGB {
    const cat = sheets[i] ?? FALLBACK_CATEGORY;
    const tint = inks.tint[cat] ?? inks.tint[FALLBACK_CATEGORY];
    let c = mixRGB(inks.sheet, tint, 0.12);
    c = mixRGB(c, inks.paper, inks.lift * Math.exp(-i / 26));
    const j = 1 + signedHash(i * 7.13 + 3.1) * JITTER_TONE;
    return [clamp(c[0] * j, 0, 1), clamp(c[1] * j, 0, 1), clamp(c[2] * j, 0, 1)];
  }
  function buildReam() {
    reamGeo = new T.PlaneGeometry(SHEET_W, SHEET_H, 1, 1);
    reamMat = new T.MeshBasicMaterial({ side: T.FrontSide, dithering: true, fog: true });
    ream = new T.InstancedMesh(reamGeo, reamMat, total);
    ream.instanceMatrix.setUsage(T.StaticDrawUsage);
    for (let i = 0; i < total; i++) {
      const z = -i * PITCH; // instance 0 = nearest — preserves early-Z
      const lean = Math.sin(i * 0.0115) * 0.02 + Math.sin(i * 0.0031) * 0.01;
      const rise = Math.cos(i * 0.0073) * 0.016;
      pos.set(signedHash(i + 0.37) * JITTER_XY + lean, signedHash(i + 11.9) * JITTER_XY + rise, z);
      euler.set(0, 0, signedHash(i + 23.4) * JITTER_ROLL);
      quat.setFromEuler(euler);
      matrix.compose(pos, quat, scl);
      ream.setMatrixAt(i, matrix);
      const [r, g, b] = sheetColor(i);
      ream.setColorAt(i, color.setRGB(r, g, b, T.SRGBColorSpace));
    }
    ream.instanceMatrix.needsUpdate = true;
    if (ream.instanceColor) {
      ream.instanceColor.setUsage(T.StaticDrawUsage);
      ream.instanceColor.needsUpdate = true;
    }
    // Three does not cull per instance; leaving culling on recomputes a bounding
    // sphere over every instance each frame for no benefit.
    const depth = total * PITCH;
    ream.boundingSphere = new T.Sphere(new T.Vector3(0, 0, -depth / 2), depth / 2 + SHEET_W);
    ream.frustumCulled = false;

    reamGroup = new T.Group();
    reamGroup.add(ream);
    // Sit it deep in the far upper-right, yawed enough that the reader looks
    // ALONG the stack and sees the sheet faces receding (a single face would
    // read as a blank card) — but never far enough to invert the instance depth
    // order, which would break early-Z.
    reamGroup.position.set(3.5, 1.7, -5.0);
    reamGroup.rotation.set(0.05, -0.5, 0.05);
    reamGroup.scale.setScalar(1.75);
    scene.add(reamGroup);

    fog = new T.FogExp2(0x000000, POSE.fog[0]);
    scene.fog = fog;
  }

  /* -- the glowing pathway (transit map) ----------------------------------- */
  function ribbonArrays(halfW: number) {
    // edges in reveal order: trunk top→fork, then both branches
    const cTop = inks.lineTop;
    const cMid = mixRGB(inks.lineTop, inks.lineBot, 0.5);
    const cBot = inks.lineBot;
    const edges: { a: Vec2; b: Vec2; ca: RGB; cb: RGB }[] = [
      { a: STATIONS[0].pos, b: STATIONS[1].pos, ca: cTop, cb: cTop },
      { a: STATIONS[1].pos, b: STATIONS[2].pos, ca: cTop, cb: cMid },
      { a: STATIONS[2].pos, b: STATIONS[3].pos, ca: cMid, cb: cBot },
      { a: STATIONS[3].pos, b: FORK, ca: cBot, cb: cBot },
      { a: FORK, b: STATIONS[4].pos, ca: cBot, cb: cBot },
      { a: FORK, b: STATIONS[5].pos, ca: cBot, cb: cBot },
    ];
    const position: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    let v = 0;
    for (const e of edges) {
      const dx = e.b[0] - e.a[0];
      const dy = e.b[1] - e.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;
      position.push(
        e.a[0] + nx, e.a[1] + ny, 0,
        e.a[0] - nx, e.a[1] - ny, 0,
        e.b[0] + nx, e.b[1] + ny, 0,
        e.b[0] - nx, e.b[1] - ny, 0,
      );
      colors.push(...e.ca, ...e.ca, ...e.cb, ...e.cb);
      index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      v += 4;
    }
    return { position, colors, index };
  }
  function buildPathway() {
    const r = ribbonArrays(0.028);
    // faint full "track" — the unlit line, present from the start so the reader
    // sees there is a journey to scroll through
    const trackGeo = new T.BufferGeometry();
    trackGeo.setAttribute("position", new T.Float32BufferAttribute(r.position, 3));
    trackGeo.setIndex(r.index);
    geometries.push(trackGeo);
    const trackMat = new T.MeshBasicMaterial({
      color: color.setRGB(inks.lineTop[0], inks.lineTop[1], inks.lineTop[2], T.SRGBColorSpace).clone(),
      transparent: true,
      opacity: 0.1,
      blending: T.AdditiveBlending,
      depthWrite: false,
      side: T.DoubleSide,
      fog: false,
    });
    disposables.push(trackMat);
    trackMesh = new T.Mesh(trackGeo, trackMat);

    // the bright lit line, revealed by drawRange as the molecule descends
    const glowGeo = new T.BufferGeometry();
    glowGeo.setAttribute("position", new T.Float32BufferAttribute(r.position, 3));
    glowGeo.setAttribute("color", new T.Float32BufferAttribute(r.colors, 3));
    glowGeo.setIndex(r.index);
    geometries.push(glowGeo);
    glowIdxCount = r.index.length;
    glowGeo.setDrawRange(0, 0);
    const glowMat = new T.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: T.AdditiveBlending,
      depthWrite: false,
      side: T.DoubleSide,
      fog: false,
    });
    disposables.push(glowMat);
    glowMesh = new T.Mesh(glowGeo, glowMat);

    fx?.add(trackMesh, glowMesh);
  }

  /* -- stations (lit dots) ------------------------------------------------- */
  function buildStations() {
    stationSprites = [];
    for (const st of STATIONS) {
      const mat = new T.SpriteMaterial({
        map: glowTex,
        color: color
          .setRGB(inks.lineTop[0], inks.lineTop[1], inks.lineTop[2], T.SRGBColorSpace)
          .clone(),
        transparent: true,
        opacity: 0,
        blending: T.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const grad = st.pos[1] > 0 ? 0.2 : 0.85;
      mat.color.setRGB(
        lerp(inks.lineTop[0], inks.lineBot[0], grad),
        lerp(inks.lineTop[1], inks.lineBot[1], grad),
        lerp(inks.lineTop[2], inks.lineBot[2], grad),
        T.SRGBColorSpace,
      );
      disposables.push(mat);
      const sprite = new T.Sprite(mat);
      sprite.position.set(st.pos[0], st.pos[1], 0.01);
      const base = st.main ? 0.34 : 0.28;
      sprite.scale.set(base, base, 1);
      sprite.userData.base = base;
      fx?.add(sprite);
      stationSprites.push(sprite);
    }
  }

  /* -- the molecule: glucose, skeletal line-art ---------------------------- */
  function buildMolecule() {
    molecule = new T.Group();
    // pyranose ring (5 C + 1 O), chair-puckered so it reads in 3D as it turns
    const R = 0.52;
    const ring: RGB[] = [];
    const ringPos: [number, number, number][] = [];
    const angles = [90, 30, -30, -90, -150, 150];
    for (let k = 0; k < 6; k++) {
      const a = angles[k] * DEG;
      ringPos.push([Math.cos(a) * R, Math.sin(a) * R, (k % 2 ? 1 : -1) * 0.09]);
      ring.push(inks.bond);
    }
    const O_RING = 1; // ring oxygen at the 30° vertex
    const C5 = 0; // bears the CH2OH, adjacent to the ring O

    const seg: number[] = []; // bond line-segment endpoints
    const push = (p: number[], q: number[]) => seg.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    for (let k = 0; k < 6; k++) push(ringPos[k], ringPos[(k + 1) % 6]);

    // substituent stubs — radial OH on ring carbons, the CH2OH arm off C5
    const atomPts: number[] = [];
    const atomCol: number[] = [];
    const oCol = inks.atomO;
    const stub = (k: number, len: number): [number, number, number] => {
      const a = angles[k] * DEG;
      return [ringPos[k][0] + Math.cos(a) * len, ringPos[k][1] + Math.sin(a) * len, ringPos[k][2] * 0.4];
    };
    for (const k of [2, 3, 4, 5]) {
      const o = stub(k, 0.24);
      push(ringPos[k], o);
      atomPts.push(o[0], o[1], o[2]);
      atomCol.push(oCol[0], oCol[1], oCol[2]);
    }
    // CH2OH arm off C5: up and out to a terminal O
    const c6: [number, number, number] = [ringPos[C5][0] - 0.08, ringPos[C5][1] + 0.34, ringPos[C5][2] + 0.05];
    const o6: [number, number, number] = [c6[0] - 0.24, c6[1] + 0.16, c6[2]];
    push(ringPos[C5], c6);
    push(c6, o6);
    atomPts.push(o6[0], o6[1], o6[2]);
    atomCol.push(oCol[0], oCol[1], oCol[2]);
    // ring O, emphasised
    atomPts.push(ringPos[O_RING][0], ringPos[O_RING][1], ringPos[O_RING][2]);
    atomCol.push(oCol[0], oCol[1], oCol[2]);

    const bondGeo = new T.BufferGeometry();
    bondGeo.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
    geometries.push(bondGeo);
    const bondMat = new T.LineBasicMaterial({
      color: color.setRGB(inks.bond[0], inks.bond[1], inks.bond[2], T.SRGBColorSpace).clone(),
      transparent: true,
      opacity: 0.92,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    disposables.push(bondMat);
    molBonds = new T.LineSegments(bondGeo, bondMat);
    molecule.add(molBonds);

    const atomGeo = new T.BufferGeometry();
    atomGeo.setAttribute("position", new T.Float32BufferAttribute(atomPts, 3));
    atomGeo.setAttribute("color", new T.Float32BufferAttribute(atomCol, 3));
    geometries.push(atomGeo);
    const atomMat = new T.PointsMaterial({
      map: dotTex,
      size: 0.17,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    disposables.push(atomMat);
    molAtoms = new T.Points(atomGeo, atomMat);
    molecule.add(molAtoms);

    fx?.add(molecule);
  }

  /* -- ATP sparks across the two kinase steps ------------------------------ */
  const SPARK_PER_ARC = 11;
  function buildSparks() {
    const arcs = KINASE_STEPS.map((tStep) => {
      const p = routeAt(tStep);
      const a: Vec2 = [p[0], p[1] + 0.22];
      const b: Vec2 = [p[0], p[1] - 0.22];
      const ctrl: Vec2 = [p[0] - 0.62, p[1]]; // bulge left, like the plate's ATP arc
      return { a, b, ctrl };
    });
    const n = arcs.length * SPARK_PER_ARC;
    const posArr = new Float32Array(n * 3);
    sparkBase = new Float32Array(n * 7);
    let i = 0;
    for (let arcI = 0; arcI < arcs.length; arcI++) {
      const arc = arcs[arcI];
      for (let k = 0; k < SPARK_PER_ARC; k++) {
        sparkBase[i * 7 + 0] = arc.a[0];
        sparkBase[i * 7 + 1] = arc.a[1];
        sparkBase[i * 7 + 2] = arc.ctrl[0];
        sparkBase[i * 7 + 3] = arc.ctrl[1];
        sparkBase[i * 7 + 4] = arc.b[0];
        sparkBase[i * 7 + 5] = arc.b[1];
        sparkBase[i * 7 + 6] = k / SPARK_PER_ARC + arcI * 0.5;
        i++;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(posArr, 3));
    geometries.push(geo);
    const mat = new T.PointsMaterial({
      map: dotTex,
      size: 0.13,
      sizeAttenuation: true,
      color: color.setRGB(inks.spark[0], inks.spark[1], inks.spark[2], T.SRGBColorSpace).clone(),
      transparent: true,
      opacity: 0,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    disposables.push(mat);
    sparks = new T.Points(geo, mat);
    fx?.add(sparks);
  }

  /* -- ambient light-table pool behind the molecule ------------------------ */
  function buildAmbient() {
    const mat = new T.SpriteMaterial({
      // the ringless soft dot, NOT glowTex — glowTex carries a crisp ring that
      // at this scale would draw a giant circle outline behind the molecule
      map: dotTex,
      color: color.setRGB(inks.bond[0], inks.bond[1], inks.bond[2], T.SRGBColorSpace).clone(),
      transparent: true,
      opacity: 0.12,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    disposables.push(mat);
    ambient = new T.Sprite(mat);
    ambient.scale.set(3.4, 3.4, 1);
    ambient.position.set(-0.1, 0.35, -0.5);
    fx?.add(ambient);
  }

  function buildScene() {
    glowTex = makeGlowTexture();
    dotTex = makeDotTexture();
    fx = new T.Group();
    scene.add(fx);
    buildAmbient();
    buildPathway();
    buildStations();
    buildMolecule();
    buildSparks();
    buildReam();
    applyInks();
    applyTier(tier);
  }

  function disposeScene() {
    if (reamGroup) scene.remove(reamGroup);
    if (fx) scene.remove(fx);
    reamGeo?.dispose();
    reamMat?.dispose();
    ream?.dispose();
    for (const g of geometries) g.dispose();
    for (const m of disposables) m.dispose();
    glowTex?.dispose();
    dotTex?.dispose();
    geometries.length = 0;
    disposables.length = 0;
    reamGroup = ream = reamGeo = reamMat = null;
    fx = molecule = null;
    molBonds = molAtoms = null;
    trackMesh = glowMesh = null;
    sparks = null;
    ambient = null;
    stationSprites = [];
    scene.fog = null;
    fog = null;
    glowTex = dotTex = null;
  }

  /* -- geometry helpers ---------------------------------------------------- */

  /** Point at fraction `t` along the molecule's polyline route. */
  function routeAt(t: number): Vec2 {
    const pts = MOL_ROUTE;
    let totalLen = 0;
    const segLen: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segLen.push(l);
      totalLen += l;
    }
    let d = clamp01(t) * totalLen;
    for (let i = 0; i < segLen.length; i++) {
      if (d <= segLen[i] || i === segLen.length - 1) {
        const f = segLen[i] ? d / segLen[i] : 0;
        return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
      }
      d -= segLen[i];
    }
    return pts[pts.length - 1];
  }

  /* -- theme --------------------------------------------------------------- */
  function applyInks() {
    color.setRGB(inks.bg[0], inks.bg[1], inks.bg[2], T.SRGBColorSpace);
    renderer.setClearColor(color, 1);
    fog?.color.copy(color);
  }
  function recolor() {
    inks = readInks(palette);
    disposeScene();
    buildScene();
    if (!raf) renderStill();
  }

  /* -- sizing -------------------------------------------------------------- */
  let tier = 0;
  let bufferW = 0;
  let bufferH = 0;
  function dprCap(): number {
    return Math.min(TIERS[tier].dpr, 2);
  }
  function resize(pxW?: number, pxH?: number) {
    const dpr = devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.offsetWidth;
    const cssH = canvas.clientHeight || canvas.offsetHeight;
    let w = pxW ?? Math.round(cssW * dpr);
    let h = pxH ?? Math.round(cssH * dpr);
    if (w < 1 || h < 1) return;
    const shrink = Math.min(1, dprCap() / dpr);
    w = Math.max(1, Math.round(w * shrink));
    h = Math.max(1, Math.round(h * shrink));
    if (w === bufferW && h === bufferH) return;
    bufferW = w;
    bufferH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layoutLabels();
    if (!raf) renderStill();
  }

  /* -- choreography -------------------------------------------------------- */
  let curT = 0;
  let targetT = 0;
  let clock = 0;

  function frameFor(t: number) {
    const e = ease(t);
    const wide = camera.aspect >= 1.2;
    // On desktop the journey sits in the right column, where the (now faded)
    // plate was, with the type clear to its left. Narrow viewports have no room
    // to take sides, so it centres and shrinks to sit behind the copy quietly.
    if (fx) {
      const s = wide ? 1 : 0.78;
      fx.scale.setScalar(s);
      fx.position.set(wide ? 1.7 : 0, wide ? -0.15 : -0.35, 0);
    }

    // camera: a gentle dolly back with a slight downward tilt as the ream resolves
    camera.position.set(
      Math.sin(clock * 0.16) * 0.05,
      Math.sin(clock * 0.21) * 0.04,
      lerp(POSE.z[0], POSE.z[1], e),
    );
    camera.rotation.set(-lerp(POSE.tilt[0], POSE.tilt[1], e), 0, 0);

    if (fog) fog.density = lerp(POSE.fog[0], POSE.fog[1], e);
    if (reamGroup) {
      reamGroup.rotation.y = -0.5 + Math.sin(clock * 0.12) * 0.02;
      reamGroup.position.y = 1.7 + lerp(-0.3, 0.15, e); // rises into place as it resolves
    }

    const line = ease(clamp01(t / LINE_SPAN));
    const molT = ease(clamp01(t / MOL_SPAN));

    // draw the lit line
    if (glowMesh) glowMesh.geometry.setDrawRange(0, Math.round(line * glowIdxCount));

    // molecule rides the head of the line, shrinking as it recedes down the map
    if (molecule) {
      const p = routeAt(molT);
      molecule.position.set(p[0], p[1], 0.02);
      const s = lerp(0.7, 0.36, molT);
      molecule.scale.setScalar(s);
      molecule.rotation.y = clock * 0.5;
      molecule.rotation.x = 0.32 + Math.sin(clock * 0.33) * 0.12;
    }
    if (ambient && molecule) {
      ambient.position.set(molecule.position.x - 0.1, molecule.position.y + 0.15, -0.5);
      ambient.material.opacity = lerp(0.16, 0.05, molT);
    }

    // stations + labels light as the line front passes them
    for (let i = 0; i < stationSprites.length; i++) {
      const st = STATIONS[i];
      const lit = smoothstep(st.t - 0.12, st.t + 0.01, line);
      const spr = stationSprites[i];
      const base = spr.userData.base as number;
      spr.material.opacity = lit * (st.main ? 0.95 : 0.7);
      const pulse = 1 + 0.06 * Math.sin(clock * 2 + i);
      spr.scale.setScalar(base * (0.55 + 0.45 * lit) * pulse);
      const label = labels[i];
      if (label) label.style.opacity = String(lit * (st.main ? 1 : 0.72));
    }

    // sparks: gold energy across the kinase steps, gated by the line front
    if (sparks && sparkBase) {
      const arr = (sparks.geometry.getAttribute("position") as InstanceType<ThreeModule["BufferAttribute"]>);
      const data = arr.array as Float32Array;
      let vis = 0;
      for (let i = 0; i < SPARK_PER_ARC * 2; i++) {
        const arcI = i < SPARK_PER_ARC ? 0 : 1;
        const gate = smoothstep(KINASE_STEPS[arcI] - 0.06, KINASE_STEPS[arcI] + 0.02, line) *
          (1 - smoothstep(KINASE_STEPS[arcI] + 0.16, KINASE_STEPS[arcI] + 0.3, line));
        vis = Math.max(vis, gate);
        const ph = (clock * 0.55 + sparkBase[i * 7 + 6]) % 1;
        const u = ph;
        const iu = 1 - u;
        const ax = sparkBase[i * 7 + 0], ay = sparkBase[i * 7 + 1];
        const cx = sparkBase[i * 7 + 2], cy = sparkBase[i * 7 + 3];
        const bx = sparkBase[i * 7 + 4], by = sparkBase[i * 7 + 5];
        // quadratic Bézier
        const x = iu * iu * ax + 2 * iu * u * cx + u * u * bx;
        const y = iu * iu * ay + 2 * iu * u * cy + u * u * by;
        data[i * 3 + 0] = x;
        data[i * 3 + 1] = y;
        data[i * 3 + 2] = 0.02;
      }
      arr.needsUpdate = true;
      (sparks.material as InstanceType<ThreeModule["PointsMaterial"]>).opacity = vis * 0.9;
    }

    layoutLabels();
  }

  /** Project station world positions into the label overlay's local px box.
   *  Uses cached box size (no per-frame getBoundingClientRect). */
  function layoutLabels() {
    if (!labelWrap || !fx) return;
    const w = bufferWCss();
    const h = bufferHCss();
    if (w < 1 || h < 1) return;
    for (let i = 0; i < STATIONS.length; i++) {
      const label = labels[i];
      if (!label) continue;
      const st = STATIONS[i];
      proj.set(
        st.pos[0] * fx.scale.x + fx.position.x,
        st.pos[1] * fx.scale.y + fx.position.y,
        0.01,
      );
      proj.project(camera);
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      // offset the pill to the side that keeps it clear of the line
      const dx = st.pos[0] <= 0 ? 14 : -14;
      const align = st.pos[0] <= 0 ? "0%" : "-100%";
      label.style.transform = `translate(calc(${x}px + ${dx}px), ${y}px) translate(${align}, -50%)`;
    }
  }
  const bufferWCss = () => canvas.clientWidth || canvas.offsetWidth;
  const bufferHCss = () => canvas.clientHeight || canvas.offsetHeight;

  function renderStill() {
    if (disposed || contextLost || !fx || bufferW < 1) return;
    curT = reduceQuery.matches ? STILL_T : curT;
    frameFor(curT);
    renderer.render(scene, camera);
  }

  /* -- quality ratchet ----------------------------------------------------- */
  let frames = 0;
  let winFrames = 0;
  let winTime = 0;
  let strikes = 0;
  function applyTier(next: number) {
    tier = clamp(next, 0, TIERS.length - 1);
    if (ream) ream.count = Math.max(64, Math.round(total * TIERS[tier].frac));
    bufferW = bufferH = 0;
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
    if (++strikes >= FPS_STRIKES && tier < TIERS.length - 1) {
      strikes = 0;
      applyTier(tier + 1);
    }
  }

  /* -- loop ---------------------------------------------------------------- */
  let raf = 0;
  let prevTime = 0;
  let disposed = false;
  let contextLost = false;
  let onScreen = true;
  let tabVisible = !document.hidden;

  // GSAP ScrollTrigger progress source + its disposable context. Structural
  // types: all we read is `progress`, and teardown goes through the context's
  // `revert()`, so the exact gsap instance types never have to be named.
  let st: { readonly progress: number } | null = null;
  let gsapCtx: { revert: () => void } | null = null;

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const rawDt = (now - prevTime) / 1000;
    prevTime = now;
    // clamped so a resumed tab does not hand us a multi-second delta; every
    // animated constant is per-second (fixed per-frame runs 2× fast at 120 Hz).
    const dt = Math.min(rawDt, 1 / 30);
    clock += dt;

    if (st) targetT = st.progress;
    else readScrollFallback();
    curT += (targetT - curT) * (1 - Math.pow(1 - SCRUB_DAMP, dt * 60));

    frameFor(curT);
    renderer.render(scene, camera);
    sampleFps(rawDt);
  }

  /** Idempotent: every gate routes through here, so starts never stack rAF
   *  chains no matter how the events interleave. */
  function sync() {
    const want = onScreen && tabVisible && !disposed && !contextLost && !reduceQuery.matches;
    if (want && !raf) {
      if (st) targetT = st.progress;
      else readScrollFallback();
      curT = targetT;
      prevTime = performance.now();
      frames = winFrames = 0;
      winTime = 0;
      raf = requestAnimationFrame(loop);
    } else if (!want && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* -- GSAP ScrollTrigger (drives progress + the canvas fade) -------------- */
  function applyFade(progress: number) {
    // hold the world through the descent (the molecule reaches GA3P at ~0.82),
    // then let it recede in the last stretch of the pin so it is gone as the
    // section releases into the grammar plate and its legend
    const o = 1 - smoothstep(0.86, 1, progress);
    if (stage instanceof HTMLElement) stage.style.opacity = String(o);
  }

  function initScroll() {
    if (!GSAP || reduceQuery.matches) return;
    const [gsapMod, stMod] = GSAP;
    const gsap = gsapMod.gsap;
    const ScrollTrigger = stMod.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
    gsapCtx = gsap.context(() => {
      // Pin the hero for one extra screen: the type and the journey hold on
      // screen while the molecule descends the pathway, then the section
      // releases into the grammar plate. ScrollTrigger owns the spacer, so with
      // no gsap (or reduced motion) there is no pin and the page is unchanged.
      st = ScrollTrigger.create({
        trigger: heroSection,
        start: "top top",
        end: "+=100%",
        pin: heroSection,
        pinSpacing: true,
        anticipatePin: 1,
        onUpdate: (self: { progress: number }) => {
          targetT = self.progress;
          applyFade(self.progress);
        },
        onRefresh: (self: { progress: number }) => {
          targetT = self.progress;
          applyFade(self.progress);
        },
      });
    });
  }

  /** Fallback if gsap failed to load: read progress straight off the hero rect. */
  function readScrollFallback() {
    const r = heroSection.getBoundingClientRect();
    const span = Math.max(r.height, 1);
    targetT = clamp01(-r.top / span);
    applyFade(targetT);
  }

  /** Seed the pose from the initial scroll position, before the loop starts.
   *  In a function body so `st` keeps its declared type (top-level flow would
   *  have narrowed it to the null it was initialised with). */
  function primeProgress() {
    if (st) {
      targetT = curT = st.progress;
      applyFade(st.progress);
    } else {
      readScrollFallback();
      curT = targetT;
    }
  }

  /* -- listeners ----------------------------------------------------------- */
  const onScroll = () => {
    if (!st && !raf) {
      readScrollFallback();
      renderStill();
    }
  };
  const onVisibility = () => {
    tabVisible = !document.hidden;
    sync();
  };
  const onContextLost = (e: Event) => {
    e.preventDefault();
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
    if (reduceQuery.matches) {
      // Fall back to the pure static hero: stop the loop, drop the triggers, and
      // hand the composition back to the plate (which un-hides with `hero-live`
      // gone) — do not paint a frozen 3D frame over it.
      gsapCtx?.revert();
      gsapCtx = null;
      st = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (stage instanceof HTMLElement) stage.classList.remove("is-hero-live");
      document.body.classList.remove("hero-live");
    } else {
      if (stage instanceof HTMLElement) stage.classList.add("is-hero-live");
      document.body.classList.add("hero-live");
      if (!st) initScroll();
      resize();
      sync();
    }
  };
  const onPageHide = (e: PageTransitionEvent) => {
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
  // Gate the loop on the HERO's visibility (the canvas is fixed and always on
  // screen); once the reader scrolls past the hero, the journey is done and the
  // loop can stop.
  visibilityObserver?.observe(heroSection);

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

  /* -- teardown ------------------------------------------------------------ */
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

    gsapCtx?.revert();
    gsapCtx = null;
    st = null;

    disposeScene();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    palette.dispose();
    labelWrap?.remove();
    labelWrap = null;
    if (stage instanceof HTMLElement) stage.classList.remove("is-hero-live");
    document.body.classList.remove("hero-live");
  }

  /* -- go ------------------------------------------------------------------ */
  if (stage instanceof HTMLElement) stage.classList.add("is-hero-live");
  document.body.classList.add("hero-live"); // fades the static plate; the journey stands in
  buildLabels();
  buildScene();
  resize();
  initScroll();
  primeProgress();

  // Reduced motion: one frozen frame, no loop. (Normally unreachable — home.ts
  // does not fetch this module under reduced motion — but correct if the user
  // toggles the preference after load.)
  if (reduceQuery.matches) renderStill();
  else sync();

  return destroy;
}

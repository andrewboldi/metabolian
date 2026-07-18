// Hero background: a slowly drifting molecular graph rendered in Three.js, with
// bright "flux" pulses traveling along edges. Restrained, GPU-light, and fully
// disabled under prefers-reduced-motion. Dynamically imported so it never blocks LCP.

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

export async function initHero(canvas: HTMLCanvasElement): Promise<void> {
  // Skip entirely (no Three.js load, no console errors) where it can't or shouldn't run.
  if (!webglAvailable()) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const THREE = await import("three");

  const accent = getVar("--accent") || "#00e0c6";
  const dim = getVar("--node-enzyme") || "#6aa4ff";

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 26;

  const N = 64;
  const R = 17;
  const pts: InstanceType<typeof THREE.Vector3>[] = [];
  for (let i = 0; i < N; i++) {
    // fibonacci-ish sphere for even spread
    const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    pts.push(new THREE.Vector3(
      R * Math.sin(phi) * Math.cos(theta),
      R * Math.sin(phi) * Math.sin(theta),
      R * Math.cos(phi) * 0.55,
    ));
  }

  // nodes
  const nodeGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const nodeMat = new THREE.PointsMaterial({ color: new THREE.Color(accent), size: 0.5, transparent: true, opacity: 0.9, sizeAttenuation: true });
  scene.add(new THREE.Points(nodeGeo, nodeMat));

  // edges between nearby nodes
  const edges: [number, number][] = [];
  const linePositions: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (pts[i].distanceTo(pts[j]) < 6.2 && edges.length < 120) {
        edges.push([i, j]);
        linePositions.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(dim), transparent: true, opacity: 0.18 });
  scene.add(new THREE.LineSegments(lineGeo, lineMat));

  // flux pulses
  const PULSES = reduce ? 0 : 10;
  const pulseGeo = new THREE.BufferGeometry();
  const pulsePos = new Float32Array(Math.max(PULSES, 1) * 3);
  pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
  const pulseMat = new THREE.PointsMaterial({ color: new THREE.Color(accent), size: 0.9, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(pulseGeo, pulseMat));
  const pulseState = Array.from({ length: PULSES }, () => ({ edge: (Math.random() * edges.length) | 0, t: Math.random(), speed: 0.004 + Math.random() * 0.01 }));

  const group = scene;
  function resize() {
    const w = canvas.clientWidth || canvas.offsetWidth;
    const h = canvas.clientHeight || canvas.offsetHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize, { passive: true });

  function frame() {
    for (let k = 0; k < PULSES; k++) {
      const p = pulseState[k];
      p.t += p.speed;
      if (p.t > 1) { p.t = 0; p.edge = (Math.random() * edges.length) | 0; }
      const [a, b] = edges[p.edge] || [0, 0];
      pulsePos[k * 3] = pts[a].x + (pts[b].x - pts[a].x) * p.t;
      pulsePos[k * 3 + 1] = pts[a].y + (pts[b].y - pts[a].y) * p.t;
      pulsePos[k * 3 + 2] = pts[a].z + (pts[b].z - pts[a].z) * p.t;
    }
    pulseGeo.attributes.position.needsUpdate = true;
    group.rotation.y += 0.0016;
    group.rotation.x = Math.sin(group.rotation.y * 0.4) * 0.12;
    renderer.render(scene, camera);
  }

  if (reduce) { frame(); return; }

  let running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) loop(); });
  function loop() { if (!running) return; frame(); requestAnimationFrame(loop); }
  loop();
}

function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

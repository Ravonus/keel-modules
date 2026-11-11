// What painterly-demo renders, in the browser: a seeded person in a knit cap holding a card, before a lake and
// mountains, under a soft studio light; drawn raw, smoothed, and stroked along the form. Everything here is code.
import * as lit from "keel-lit";
import { createSkinBodies } from "../../modules/keel-web3/render/skin-body/src/index.ts";
import { meshTop } from "../../modules/keel-web3/render/lit-portrait/src/index.ts";
import { faceAt, meshOf, personOf, poseMesh, skeletonOf } from "../../modules/keel-web3/generative/people/src/index.ts";
import type { Person, PersonMesh } from "../../modules/keel-web3/generative/people/src/index.ts";
import { GLAZE_SETTINGS, STROKED_SETTINGS, createPainterly, hash32, unit } from "../../modules/keel-web3/render/painterly/src/index.ts";
import { DETAIL, buildBust, createPortrait } from "../../modules/keel-web3/generative/portrait/src/index.ts";
import { LAKE_VALLEY, createPlatePainter, planPlate } from "../../modules/keel-web3/generative/plate-painter/src/index.ts";
import type { Painterly, PainterlySettings } from "../../modules/keel-web3/render/painterly/src/index.ts";

type Vec = readonly [number, number, number];
// (keel-lit is untyped here, as in people-sheet: a node or a matrix is whatever lit hands back.)
type Node3 = any;
type Matrix = any;
type Variant = "raw" | "glaze" | "strokes" | "flow" | "detail" | "depth";
interface Shot { width: number; height: number; dpr: number; seed: number; backdrop?: string; figure?: string }
interface Timing { gpu: number[]; sync: number[]; raf: number[] }

const ACTION = "wave";
const YAW = 0.22;
const HEAD_BONE = 4;
const SETTINGS: Readonly<Record<Variant, PainterlySettings>> = {
  raw: GLAZE_SETTINGS, glaze: GLAZE_SETTINGS, strokes: STROKED_SETTINGS, flow: GLAZE_SETTINGS, detail: GLAZE_SETTINGS,
  depth: GLAZE_SETTINGS,
};

const unitOf = (v: Vec): Vec => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const madd = (a: Vec, b: Vec, k: number): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const v3 = (v: Vec): unknown => new lit.Vector3(v[0], v[1], v[2]);

/** Value noise on a grid, seeded by integer hashing: the same hills every run. */
function noise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const at = (i: number, j: number): number => unit(hash32(i, j, seed));
  const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * sx;
  const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * sx;
  return a + (b - a) * sz;
}

/** The land: a bank under the figure, a basin for the lake behind, and mountains rising past it. */
function height(x: number, z: number): number {
  const rolling = noise(x * 0.12, z * 0.12, 3) * 0.9 + noise(x * 0.35, z * 0.35, 4) * 0.4 + noise(x * 1.1, z * 1.1, 7) * 0.08;
  const bank = Math.max(0, 1 - Math.hypot(x * 0.6, (z + 0.3) * 1.1) / 1.6);
  const basin = Math.max(0, 1 - Math.abs(z + 14) / 11) * (1 - bank);
  const far = Math.max(0, (-z - 22) / 16);
  const ridge = (1 - Math.abs(noise(x * 0.05 + 7, z * 0.05, 5) * 2 - 1)) * 12 + noise(x * 0.2, z * 0.2, 6) * 3;
  return rolling * (1 - bank) * 0.6 - basin * 2.4 + far * far * ridge + bank * 0.02;
}

function landColour(x: number, y: number, z: number): Vec {
  const grass: Vec = [0.11, 0.15, 0.06], rock: Vec = [0.26, 0.25, 0.27], snow: Vec = [0.8, 0.82, 0.86], shore: Vec = [0.26, 0.22, 0.15];
  if (z > -8) {
    const dry = Math.min(1, Math.max(0, noise(x * 0.5, z * 0.5, 8) * 1.6 - 0.4));
    const near: Vec = [grass[0] + (shore[0] - grass[0]) * dry, grass[1] + (shore[1] - grass[1]) * dry, grass[2] + (shore[2] - grass[2]) * dry];
    return y < -0.3 ? shore : near;
  }
  const k = Math.min(1, Math.max(0, (y - 2.5) / 4));
  const base: Vec = [rock[0] + (snow[0] - rock[0]) * k, rock[1] + (snow[1] - rock[1]) * k, rock[2] + (snow[2] - rock[2]) * k];
  const g = Math.min(1, Math.max(0, (1.5 - y) / 1.5));
  return [base[0] + (grass[0] - base[0]) * g, base[1] + (grass[1] - base[1]) * g, base[2] + (grass[2] - base[2]) * g];
}

function land(): Node3 {
  const wide = 80, deep = 64, across = 160, along = 128;
  const geometry = lit.plane(wide, deep, across, along);
  const position = geometry.getAttribute("position")!.array as Float32Array;
  const normal = geometry.getAttribute("normal")!.array as Float32Array;
  const colour = new Float32Array(position.length);
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i]!, z = -position[i + 1]!;
    const y = height(x, z);
    position[i + 1] = y;
    position[i + 2] = z;
    const e = 0.15;
    const n = unitOf(cross([0, height(x, z + e) - height(x, z - e), 2 * e], [2 * e, height(x + e, z) - height(x - e, z), 0]));
    normal.set(n, i);
    colour.set(landColour(x, y, z), i);
  }
  geometry.setAttribute("color", new lit.Attribute(colour, 3));
  const material = new lit.LitMaterial({ vertexColors: true, roughness: 0.95 });
  const mesh = new lit.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function lake(): Node3 {
  const mesh = new lit.Mesh(lit.plane(80, 30), new lit.LitMaterial({ color: "#56798a", roughness: 0.12, metalness: 0.05 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -0.45, -14);
  return mesh;
}

function sky(): Node3 {
  const material = new lit.CustomMaterial({
    side: "back", depthWrite: false,
    vertexShader: `varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = normalize(w.xyz).y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying float vY; void main() { float t = clamp(vY * 2.4 + 0.08, 0.0, 1.0); vec3 c = mix(vec3(0.72, 0.69, 0.62), vec3(0.34, 0.44, 0.58), t); gl_FragColor = vec4(c, 1.0); }`,
  });
  return new lit.Mesh(lit.sphere(45, 24, 16), material);
}

/** A bone's three rows of four, with the body's yaw, as a node's matrix. */
function boneMatrix(bones: Float32Array, bone: number, yaw: number): Matrix {
  const b = (i: number): number => bones[bone * 12 + i] ?? 0;
  const m = new lit.Matrix4().set(b(0), b(1), b(2), b(3), b(4), b(5), b(6), b(7), b(8), b(9), b(10), b(11), 0, 0, 0, 1);
  return m.premultiply(new lit.Matrix4().makeRotationY(yaw));
}

/** A knit cap from a lathe and a torus, seated on the head at rest and carried by the head's bone. */
function cap(mesh: PersonMesh, bones: Float32Array): Node3 {
  const [l, r] = mesh.face.eyes;
  const R = mesh.face.head * 1.15;
  // (The eyes lie on the front of the head: its centre is behind them; the brim sits above the brows.)
  const centre: Vec = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2 - R * 0.8];
  const brim = centre[1] + R * 0.42;
  const points = [[0.9, -0.1], [1.0, 0], [1.04, 0.3], [0.98, 0.62], [0.84, 0.9], [0.6, 1.1], [0.3, 1.2], [0, 1.22]].map(
    ([x, y]) => new lit.Vector2(x! * R, y! * R),
  );
  const wool = new lit.LitMaterial({ color: "#8e2430", roughness: 0.96 });
  const crown = new lit.Mesh(lit.lathe(points, 48), wool);
  crown.position.set(0, brim, 0);
  const fold = new lit.Mesh(lit.torus(R * 1.0, R * 0.09, 12, 64), wool);
  fold.rotation.x = Math.PI / 2;
  fold.position.set(0, brim + R * 0.04, 0);
  const group = new lit.Group();
  group.add(crown, fold);
  for (const part of [crown, fold]) { part.castShadow = true; part.receiveShadow = true; }
  group.position.set(centre[0], 0, centre[2]);
  group.matrixAutoUpdate = false;
  group.matrix.copy(boneMatrix(bones, HEAD_BONE, YAW)).multiply(new lit.Matrix4().makeTranslation(centre[0], 0, centre[2]));
  return group;
}

/** A payment card with a gold chip, from a rounded box, held in the raised hand. */
function card(p: Person): Node3 {
  const w = 0.086, h = 0.054, radius = 0.004;
  const outline = new lit.Shape();
  outline.moveTo(-w / 2 + radius, -h / 2);
  outline.lineTo(w / 2 - radius, -h / 2);
  outline.absarc(w / 2 - radius, -h / 2 + radius, radius, -Math.PI / 2, 0, false);
  outline.lineTo(w / 2, h / 2 - radius);
  outline.absarc(w / 2 - radius, h / 2 - radius, radius, 0, Math.PI / 2, false);
  outline.lineTo(-w / 2 + radius, h / 2);
  outline.absarc(-w / 2 + radius, h / 2 - radius, radius, Math.PI / 2, Math.PI, false);
  outline.lineTo(-w / 2, -h / 2 + radius);
  outline.absarc(-w / 2 + radius, -h / 2 + radius, radius, Math.PI, Math.PI * 1.5, false);
  const body = new lit.Mesh(lit.extrude(outline, { depth: 0.0012, bevelEnabled: false, curveSegments: 6 }), new lit.LitMaterial({ color: "#1e3f36", roughness: 0.4, metalness: 0.25 }));
  const chip = new lit.Mesh(lit.box(0.011, 0.009, 0.0008), new lit.LitMaterial({ color: "#d9a93c", roughness: 0.3, metalness: 0.9 }));
  chip.position.set(-0.022, 0.006, 0.0016);
  const group = new lit.Group();
  group.add(body, chip);
  for (const part of [body, chip]) { part.castShadow = true; part.receiveShadow = true; }
  const k = p.build.size, arm = skeletonOf(p, ACTION, 0).right.arm;
  const scale = (v: Vec): Vec => [v[0] * k, v[1] * k, v[2] * k];
  const hand = scale(arm.hand), tip = scale(arm.tip);
  const normal = unitOf(arm.faces), up = unitOf([tip[0] - hand[0], tip[1] - hand[1], tip[2] - hand[2]]);
  const right = unitOf(cross(up, normal));
  const at = madd(madd(hand, normal, 0.012), up, 0.035);
  group.matrixAutoUpdate = false;
  group.matrix.makeBasis(v3(right), v3(up), v3(normal)).setPosition(at[0], at[1], at[2]).premultiply(new lit.Matrix4().makeRotationY(YAW));
  return group;
}

interface Scene { renderer: Node3; stage: Node3; camera: Node3; paint: Painterly; info: Record<string, unknown>; backdrop?: () => void; before?: () => void }

/** A plate-painter plate at seed 0, covering the frame: the painted backdrop the painter will usually run over. */
function plate(renderer: Node3, shot: Shot): () => void {
  const painter = createPlatePainter(renderer.getContext());
  const size = { width: Math.round(shot.width * shot.dpr), height: Math.round(shot.height * shot.dpr) };
  const painted = painter.paint(planPlate(LAKE_VALLEY, { seed: 0 }), size);
  return () => { painter.draw(painted, size); };
}

/** Aims the camera from `eye` at `at`, then shifts the aim so `at` lands at `screen` (shares of the frame, from the top left). */
function frameOn(camera: Node3, fov: number, eye: Vec, at: Vec, screen: readonly [number, number]): void {
  camera.position.set(eye[0], eye[1], eye[2]);
  camera.lookAt(at[0], at[1], at[2]);
  camera.updateMatrixWorld(true);
  const v = new lit.Vector3(at[0], at[1], at[2]).project(camera);
  const dx = (screen[0] * 2 - 1) - v.x;
  const dy = (1 - screen[1] * 2) - v.y;
  const dist = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
  const h = Math.tan((fov * Math.PI) / 360) * dist;
  const right = new lit.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new lit.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const aim = new lit.Vector3(at[0], at[1], at[2]).addScaledVector(right, -dx * h * camera.aspect).addScaledVector(up, -dy * h);
  camera.lookAt(aim.x, aim.y, aim.z);
  camera.updateMatrixWorld(true);
}

/** The portrait bust (face A, the card pinched, hero detail) framed as its own demo frames it, with its own light. */
function portrait(renderer: Node3, stage: Node3, camera: Node3): { before: () => void; info: Record<string, unknown> } {
  const bust = buildBust({ seed: 7, face: "A", hand: "pinch", detail: DETAIL.hero });
  const sitter = createPortrait(lit, bust);
  const group: Node3 = sitter.group;
  const UNIT = 0.23;
  group.scale.set(1 / UNIT, 1 / UNIT, 1 / UNIT);
  group.rotation.y = (-25 * Math.PI) / 180;
  stage.add(group);
  group.updateMatrixWorld(true);
  const faceAt = new lit.Vector3(0, 0.13, 0.07).applyMatrix4(group.matrixWorld);
  frameOn(camera, 36, [-0.55, 0.78, 3.44], [faceAt.x, faceAt.y, faceAt.z], [0.575, 0.45]);
  sitter.face({ lid: 0, at: [camera.position.x, camera.position.y, camera.position.z] });
  const vertices = bust.parts.reduce((n, part) => n + part.position.length / 3, 0);
  return { before: () => { sitter.shadows(renderer); }, info: { figure: "portrait", face: "A", vertices } };
}

function build(shot: Shot): Scene {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = lit.createLitRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(shot.dpr);
  renderer.setSize(shot.width, shot.height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = "pcf-soft";
  renderer.toneMapping = "none";
  const stage = new lit.Stage();
  const onPlate = shot.backdrop === "plate";
  const onBust = shot.figure === "portrait";
  if (!onPlate) stage.fog = new lit.Fog("#b7b9b6", 12, 110);
  if (onBust) {
    const camera = new lit.PerspectiveCamera(36, shot.width / shot.height, 0.05, 50);
    const sitter = portrait(renderer, stage, camera);
    const paint = createPainterly(lit, renderer, GLAZE_SETTINGS);
    paint.setSize(shot.width, shot.height, shot.dpr);
    const info = { seed: shot.seed, backdrop: shot.backdrop ?? "scene", ...sitter.info };
    return { renderer, stage, camera, paint, info, before: sitter.before, ...(onPlate ? { backdrop: plate(renderer, shot) } : {}) };
  }
  const camera = new lit.PerspectiveCamera(30, shot.width / shot.height, 0.3, 90);
  camera.position.set(0.3, 1.5, 2.7);
  camera.lookAt(-0.1, 1.35, 0);
  const sunAt: Vec = [1.4, 3.6, 1.2];
  const sun = new lit.SunLight("#fff0da", 2.4);
  sun.position.set(...sunAt);
  sun.target.position.set(0, 1.2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -2.5; sun.shadow.camera.right = 2.5; sun.shadow.camera.top = 2.5; sun.shadow.camera.bottom = -2.5;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 14;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
  const fill = new lit.SunLight("#b9c9e2", 0.55);
  fill.position.set(-2.4, 1.6, 1.2);
  stage.add(sun, sun.target, fill, fill.target, new lit.SkyLight("#a4b8cc", "#5c4a38", 0.85));
  if (!onPlate) stage.add(land(), lake(), sky());
  const p = personOf(shot.seed, "mild");
  const mesh = meshOf(p, 0.016);
  const bodies = createSkinBodies(lit);
  stage.add(bodies.group);
  const bones = poseMesh(p, ACTION, 0);
  bodies.add(mesh).pose(bones, [0, 0, 0], YAW, { face: faceAt(p, 0, false, ACTION) });
  const sunDir = unitOf(sunAt);
  bodies.light({
    sun: sunDir, sunColor: [2.9, 2.7, 2.4], fill: unitOf([-2.4, 1.6, 1.2]), fillColor: [0.5, 0.56, 0.72],
    sky: [0.58, 0.66, 0.78], ground: [0.3, 0.25, 0.2], rim: [-0.3, 0.4, -0.85], rimColor: [1.1, 1.2, 1.5], front: [0.12, 0.12, 0.12],
  });
  stage.add(cap(mesh, bones), card(p));
  const paint = createPainterly(lit, renderer, GLAZE_SETTINGS);
  paint.setSize(shot.width, shot.height, shot.dpr);
  const info = { seed: shot.seed, backdrop: shot.backdrop ?? "scene", figure: "person", vertices: mesh.position.length / 3, top: meshTop(mesh.position), head: mesh.face.head, eyes: mesh.face.eyes, outfit: p.outfit };
  return { renderer, stage, camera, paint, info, ...(onPlate ? { backdrop: plate(renderer, shot) } : {}) };
}

/** A variant by name, or "set:key=value,key=value" for any settings over the glaze. */
function settingsOf(variant: string): PainterlySettings {
  if (!variant.startsWith("set:")) return SETTINGS[variant as Variant];
  const over: Record<string, number> = {};
  for (const pair of variant.slice(4).split(",")) {
    const [key, value] = pair.split("=");
    if (key && value) over[key] = Number(value);
  }
  return { ...GLAZE_SETTINGS, ...over };
}

function show(scene: Scene, variant: string): void {
  const { paint } = scene;
  // (The checking views show the glaze's flow and fineness.)
  const views = ["raw", "flow", "detail", "depth"] as const;
  const view = views.find((v) => v === variant);
  paint.setView(view ?? "painted");
  paint.setSettings(settingsOf(variant));
  scene.before?.();
  paint.render(scene.stage, scene.camera, scene.backdrop);
}

/**
 * Frame times. `gpu` is each frame's time on the GPU from `EXT_disjoint_timer_query_webgl2` (empty when the browser
 * has none); `sync` is a frame drawn and then one pixel read back, which waits for it (CPU and GPU together); `raf`
 * the interval between frames the page was given.
 */
async function time(scene: Scene, variant: string, frames: number): Promise<Timing> {
  const gl: WebGL2RenderingContext = scene.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pixel = new Uint8Array(4);
  const sync: number[] = [];
  const queries: WebGLQuery[] = [];
  for (let i = 0; i < frames + 10; i += 1) {
    const query = ext && i >= 10 ? gl.createQuery() : null;
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    const t0 = performance.now();
    show(scene, variant);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (i >= 10) sync.push(performance.now() - t0);
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(query); }
  }
  const gpu: number[] = [];
  for (const query of queries) {
    while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await new Promise((done) => setTimeout(done, 5));
    if (!gl.getParameter(ext!.GPU_DISJOINT_EXT)) gpu.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
    gl.deleteQuery(query);
  }
  const raf: number[] = [];
  await new Promise<void>((done) => {
    let last = 0, count = 0;
    const tick = (now: number): void => {
      show(scene, variant);
      if (last > 0) raf.push(now - last);
      last = now;
      count += 1;
      if (count > frames) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { gpu, sync, raf };
}

/** Four pictures tiled two by two at `w` by `h` each: the three variants and, if given, another image to compare. */
async function sheet(stills: readonly string[], compare: string | null, w: number, h: number): Promise<string> {
  const out = document.createElement("canvas");
  out.width = w * 2;
  out.height = h * 2;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, out.width, out.height);
  const sources = compare ? [...stills, compare] : stills;
  await Promise.all(sources.map((src, i) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, (i % 2) * w, Math.floor(i / 2) * h, w, h); done(); };
    img.src = src;
  })));
  return out.toDataURL("image/png");
}

/**
 * How crisp a still is within a box (CSS pixels): the mean absolute gradient of its luminance there. The glaze over a
 * face is held to at least the raw render's.
 */
async function crispness(still: string, box: readonly [number, number, number, number], dpr: number): Promise<number> {
  const img = new Image();
  await new Promise<void>((done) => { img.onload = () => { done(); }; img.src = still; });
  const [bx, by, bw, bh] = box.map((v) => Math.round(v * dpr)) as [number, number, number, number];
  const work = document.createElement("canvas");
  work.width = bw;
  work.height = bh;
  const ctx = work.getContext("2d")!;
  ctx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
  const { data } = ctx.getImageData(0, 0, bw, bh);
  const lum = (i: number): number => (data[i * 4]! * 0.2126 + data[i * 4 + 1]! * 0.7152 + data[i * 4 + 2]! * 0.0722) / 255;
  let sum = 0;
  for (let y = 1; y < bh - 1; y += 1) {
    for (let x = 1; x < bw - 1; x += 1) {
      const i = y * bw + x;
      sum += Math.abs(lum(i + 1) - lum(i - 1)) + Math.abs(lum(i + bw) - lum(i - bw));
    }
  }
  return sum / ((bw - 2) * (bh - 2));
}

const api = {
  ready: false,
  scene: null as Scene | null,
  build(shot: Shot): Record<string, unknown> { api.scene = build(shot); api.ready = true; return api.scene.info; },
  still(variant: string): string { show(api.scene!, variant); return api.scene!.renderer.domElement.toDataURL("image/png"); },
  time(variant: string, frames: number): Promise<Timing> { return time(api.scene!, variant, frames); },
  sheet,
  crispness,
};
(globalThis as unknown as { painterly: typeof api }).painterly = api;

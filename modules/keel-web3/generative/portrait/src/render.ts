// The bust drawn with keel/lit: one mesh a part, each with the portrait program and its own `PART`, all sharing one
// set of light uniforms. keel/lit is passed in; this file never imports it.

import { FRAGMENT_GLSL, SHADOW_FRAGMENT_GLSL, SHADOW_VERTEX_GLSL, VERTEX_GLSL } from "./portrait.glsl.js";
import { deg, sine, cosine } from "./exact.js";
import { ARMS } from "./body.js";
import { CANTHUS, EYE } from "./head.js";
import type { Bust, Part } from "./bust.js";
import type { V3 } from "./sdf.js";

interface Uniform { value: unknown }
interface V3Like { set(x: number, y: number, z: number): unknown }
interface ColorLike { r: number; g: number; b: number }
interface NodeLike {
  add(...nodes: unknown[]): void;
  matrixAutoUpdate: boolean;
  matrixWorldNeedsUpdate: boolean;
  matrix: { copy(m: unknown): unknown };
  frustumCulled: boolean;
  matrixWorld: { elements: ArrayLike<number> };
  updateMatrixWorld(force?: boolean): void;
}
interface Disposable { dispose(): void }
interface GeometryLike extends Disposable {
  setAttribute(name: string, attribute: unknown): void;
  setIndex(attribute: unknown): void;
}
interface TargetLike extends Disposable { readonly texture: unknown }
interface CameraLike {
  position: V3Like;
  updateProjectionMatrix(): void;
  lookAt(x: number, y: number, z: number): void;
  updateMatrixWorld(force?: boolean): void;
  projectionMatrix: { elements: ArrayLike<number> };
  matrixWorldInverse: { elements: ArrayLike<number> };
}
interface RendererLike {
  setClearColor(color: number | ColorLike, alpha: number): void;
  getClearColor(target: ColorLike): ColorLike;
  getClearAlpha(): number;
  clear(color: boolean, depth: boolean, stencil: boolean): void;
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  render(scene: unknown, camera: unknown): void;
}

/** What this module uses of keel/lit. Pass the keel/lit namespace itself. */
export interface PortraitLit {
  readonly Group: new () => NodeLike;
  readonly Stage: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array | Uint32Array, size: number) => unknown;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => Disposable;
  readonly Vector2: new (x?: number, y?: number) => { set(x: number, y: number): unknown };
  readonly Vector3: new (x?: number, y?: number, z?: number) => V3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => unknown;
  readonly Matrix3: new () => { set(...n: number[]): unknown };
  readonly Matrix4: new () => { set(...n: number[]): unknown; elements: number[] };
  readonly Color: new (value?: string) => ColorLike;
  readonly RenderTarget: new (w: number, h: number, options: Readonly<Record<string, unknown>>) => TargetLike;
  readonly OrthoCamera: new (l: number, r: number, t: number, b: number, n: number, f: number) => CameraLike;
}

/** The colours of a sitter, as hex. */
export interface Palette {
  readonly skin: string;
  readonly lip: string;
  readonly blush: string;
  readonly brow: string;
  readonly iris: string;
  readonly sclera: string;
  readonly cap: string;
  readonly hair: string;
  readonly dress: string;
  readonly chemise: string;
  readonly gown: string;
  readonly gold: string;
  readonly card: string;
}

export const PALETTE: Palette = {
  skin: "#e8cbb0", lip: "#c47e74", blush: "#e88a7e", brow: "#8a5638", iris: "#7b8c87", sclera: "#efe9e0",
  cap: "#ff2f78", hair: "#b5683a", dress: "#626658", chemise: "#e8e4d8", gown: "#171b19", gold: "#c9a24a",
  card: "#ff2a62",
};

/** The light: the key's direction (toward it) and colour, the fill's sky and ground. */
export interface PortraitLight {
  readonly key: V3;
  readonly keyColor: string;
  readonly keyStrength: number;
  readonly sky: string;
  readonly ground: string;
  readonly fillStrength: number;
}

/** One soft warm key from the upper left (azimuth -40°, elevation 35°), a cool fill at half of it. */
export const LIGHT: PortraitLight = {
  key: [-sine(deg(40)) * cosine(deg(35)), sine(deg(35)), cosine(deg(40)) * cosine(deg(35))],
  keyColor: "#fff1dc", keyStrength: 1.8, sky: "#c9d6d9", ground: "#8d8a7c", fillStrength: 0.42,
};

export interface FaceState {
  /** How far the lids are down, 0 open to 1 shut. */
  readonly lid: number;
  /** Where the eyes look, in the world. */
  readonly at: V3;
}

export interface Portrait {
  /** Everything drawn, under one node: place, turn and scale it. */
  readonly group: NodeLike;
  light(light: PortraitLight): void;
  /** The lids and the gaze this frame. */
  face(state: FaceState): void;
  /** Draw the key's shadow map; call before each frame is drawn when the bust or the light has moved. */
  shadows(renderer: RendererLike): void;
  dispose(): void;
}

interface Built {
  readonly lit: PortraitLit;
  readonly bust: Bust;
  readonly uniforms: Record<string, Uniform>;
  readonly group: NodeLike;
  readonly shadowStage: NodeLike;
  readonly casters: NodeLike;
  readonly owned: Disposable[];
  target?: TargetLike;
  camera?: CameraLike;
}

function geometryOf(lit: PortraitLit, part: Part): GeometryLike {
  const g = new lit.Geometry();
  g.setAttribute("position", new lit.Attribute(part.position, 3));
  g.setAttribute("normal", new lit.Attribute(part.normal, 3));
  g.setAttribute("aOpen", new lit.Attribute(part.open, 1));
  g.setAttribute("aRest", new lit.Attribute(part.rest, 3));
  g.setAttribute("aFlow", new lit.Attribute(part.flow ?? new Float32Array((part.position.length / 3) * 4), 4));
  g.setIndex(new lit.Attribute(part.index, 1));
  return g;
}

const colour = (lit: PortraitLit, hex: string): V3Like => {
  const c = new lit.Color(hex);
  return new lit.Vector3(c.r, c.g, c.b);
};

function sharedUniforms(lit: PortraitLit, bust: Bust, palette: Palette): Record<string, Uniform> {
  const [l, r] = bust.eyes;
  const t = bust.pose.turn;
  const m3 = new lit.Matrix3();
  m3.set(t[0], t[3], t[6], t[1], t[4], t[7], t[2], t[5], t[8]);
  const c = (hex: string): Uniform => ({ value: colour(lit, hex) });
  return {
    uKey: { value: new lit.Vector3() }, uKeyColor: { value: new lit.Vector3() }, uSky: { value: new lit.Vector3() },
    uGround: { value: new lit.Vector3() }, uFillDir: { value: new lit.Vector3(0.3, 0.9, 0.3) },
    uShadowMap: { value: null }, uShadow: { value: new lit.Vector4(0, 0, 0, 0) },
    uShadowMatrix: { value: new lit.Matrix4() },
    uShadowBox: { value: new lit.Vector2(1, 1) }, uShadowFar: { value: 1 },
    uTime: { value: 0 },
    uEyeL: { value: new lit.Vector4(l[0], l[1], l[2], EYE) }, uEyeR: { value: new lit.Vector4(r[0], r[1], r[2], EYE) },
    uLid: { value: new lit.Vector4(0, sine(CANTHUS), cosine(CANTHUS), 0) },
    uLookL: { value: new lit.Vector3(0, 0, 1) }, uLookR: { value: new lit.Vector3(0, 0, 1) },
    uHeadTurn: { value: m3 },
    uSkinTone: c(palette.skin), uLipTone: c(palette.lip), uBlushTone: c(palette.blush), uBrowTone: c(palette.brow),
    uIris: c(palette.iris), uSclera: c(palette.sclera),
    ...partUniforms(lit, bust, palette),
  };
}

/** What the cap, the hair, the sleeve and the nails need to be painted. */
function partUniforms(lit: PortraitLit, bust: Bust, palette: Palette): Record<string, Uniform> {
  const { normal: n, edge, cuff, centre } = bust.cap;
  const tone = (hex: string, s: number): V3Like => {
    const k = new lit.Color(hex);
    return new lit.Vector3(k.r * s, k.g * s, k.b * s);
  };
  const v4 = (a: readonly number[], w: number): unknown => new lit.Vector4(a[0], a[1], a[2], w);
  return {
    uCapAxis: { value: v4(n, edge) }, uCapCentre: { value: v4(centre, cuff) },
    uCapTones: { value: [tone(palette.cap, 1), tone(palette.cap, 0.62), tone("#ff9bbd", 1)] },
    uHairTones: { value: [tone(palette.hair, 0.5), tone(palette.hair, 1), tone("#d99a5e", 1)] },
    uWrist: { value: new lit.Vector3(...ARMS.wrist) }, uElbow: { value: new lit.Vector3(...ARMS.elbow) },
    uTips: { value: bust.nails.map((t) => v4(t.from, t.radius)) },
    uTipEnds: { value: bust.nails.map((t) => v4(t.to, 0)) },
    uBacks: { value: bust.nails.map((t) => new lit.Vector3(...t.back)) },
  };
}

const PART_COLOUR: readonly (keyof Palette)[] = [
  "skin", "skin", "sclera", "cap", "hair", "dress", "chemise", "gown", "gold", "card",
];

function addPart(built: Built, part: Part, palette: Palette): void {
  const { lit } = built;
  const geometry = geometryOf(lit, part);
  const material = new lit.CustomMaterial({
    defines: { PART: part.kind },
    uniforms: { ...built.uniforms, uColor: { value: colour(lit, palette[PART_COLOUR[part.kind] ?? "skin"]) } },
    vertexShader: VERTEX_GLSL,
    fragmentShader: FRAGMENT_GLSL,
    side: "both",
  });
  const mesh = new lit.Mesh(geometry, material);
  mesh.frustumCulled = false;
  built.group.add(mesh);
  const depth = new lit.CustomMaterial({
    uniforms: { uShadowFar: built.uniforms.uShadowFar }, vertexShader: SHADOW_VERTEX_GLSL,
    fragmentShader: SHADOW_FRAGMENT_GLSL, side: "both",
  });
  const caster = new lit.Mesh(geometry, depth);
  caster.frustumCulled = false;
  built.casters.add(caster);
  built.owned.push(geometry, material, depth);
}

function setLight(built: Built, light: PortraitLight): void {
  const { lit, uniforms } = built;
  const set = (name: string, v: V3): void => {
    (uniforms[name]?.value as V3Like).set(v[0], v[1], v[2]);
  };
  const scaled = (hex: string, s: number): V3 => {
    const c = new lit.Color(hex);
    return [c.r * s, c.g * s, c.b * s];
  };
  set("uKey", light.key);
  set("uKeyColor", scaled(light.keyColor, light.keyStrength));
  set("uSky", scaled(light.sky, light.fillStrength));
  set("uGround", scaled(light.ground, light.fillStrength * 0.6));
}

/** The bust as meshes for keel/lit, under one group. */
export function createPortrait(lit: PortraitLit, bust: Bust, palette: Palette = PALETTE): Portrait {
  const built: Built = {
    lit, bust, uniforms: sharedUniforms(lit, bust, palette), group: new lit.Group(), shadowStage: new lit.Stage(),
    casters: new lit.Group(), owned: [],
  };
  built.shadowStage.add(built.casters);
  built.casters.matrixAutoUpdate = false;
  for (const part of bust.parts) addPart(built, part, palette);
  setLight(built, LIGHT);
  return {
    group: built.group,
    light: (light) => { setLight(built, light); },
    face: (state) => { faceInto(built, state); },
    shadows: (renderer) => { drawShadows(built, renderer); },
    dispose: () => { for (const d of built.owned) d.dispose(); },
  };
}

type Row3 = readonly [number, number, number];
const at3 = (a: readonly number[]): Row3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

/** A point (`w` 1) or a direction (`w` 0) through a column-major 4×4 matrix. */
function through(m: ArrayLike<number>, p: Row3, w: number): Row3 {
  return at3([0, 1, 2].map((k) => (m[k] ?? 0) * p[0] + (m[4 + k] ?? 0) * p[1] + (m[8 + k] ?? 0) * p[2] +
    (m[12 + k] ?? 0) * w));
}

/** A direction back through the rotation of a column-major 4×4 matrix (its transpose; the scale stays). */
function back(m: ArrayLike<number>, d: Row3): Row3 {
  return at3([0, 1, 2].map((k) => (m[k * 4] ?? 0) * d[0] + (m[k * 4 + 1] ?? 0) * d[1] + (m[k * 4 + 2] ?? 0) * d[2]));
}

/** The gaze: each eye turned toward a point in the world, taken into the head's frame. */
function faceInto(built: Built, state: FaceState): void {
  const { uniforms, bust, group } = built;
  group.updateMatrixWorld(true);
  const m = group.matrixWorld.elements;
  const lid = uniforms.uLid?.value as { x: number };
  lid.x = state.lid;
  const { turn: t, at } = bust.pose;
  bust.eyes.forEach((eye, i) => {
    // The eye's centre in the bust's frame, then the world; the direction to the target back into the bust's frame,
    // then the head's.
    const b = at3([0, 1, 2].map((k) => (t[k] ?? 0) * eye[0] + (t[3 + k] ?? 0) * eye[1] + (t[6 + k] ?? 0) * eye[2] +
      (at[k] ?? 0)));
    const w = through(m, b, 1);
    const local = back(m, [state.at[0] - w[0], state.at[1] - w[1], state.at[2] - w[2]]);
    const head = at3([0, 1, 2].map((k) => (t[k * 3] ?? 0) * local[0] + (t[k * 3 + 1] ?? 0) * local[1] +
      (t[k * 3 + 2] ?? 0) * local[2]));
    const l = Math.sqrt(head[0] * head[0] + head[1] * head[1] + head[2] * head[2]) || 1;
    (uniforms[i === 0 ? "uLookL" : "uLookR"]?.value as V3Like).set(head[0] / l, head[1] / l, head[2] / l);
  });
}

/** The bust's reach in its own frame, metres: a ball the key's shadow map covers. */
const REACH: readonly [number, number, number, number] = [0, -0.05, 0.0, 0.62];
const SHADOW_SIZE = 2048;

/** Aim the shadow camera down the key at the bust's reach, and hand the shaders its matrix; returns its radius. */
function aimShadow(built: Built, camera: CameraLike): number {
  const { uniforms, group } = built;
  group.updateMatrixWorld(true);
  const m = group.matrixWorld.elements;
  built.casters.matrix.copy(group.matrixWorld);
  built.casters.matrixWorldNeedsUpdate = true;
  const radius = REACH[3] * Math.sqrt((m[0] ?? 0) ** 2 + (m[1] ?? 0) ** 2 + (m[2] ?? 0) ** 2);
  const centre = through(m, [REACH[0], REACH[1], REACH[2]], 1);
  const key = (uniforms.uKey?.value ?? { x: 0, y: 1, z: 0 }) as { x: number; y: number; z: number };
  const from = radius * 2;
  camera.position.set(centre[0] + key.x * from, centre[1] + key.y * from, centre[2] + key.z * from);
  camera.lookAt(...centre);
  const far = radius * 3.5;
  Object.assign(camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius * 0.5, far });
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  (uniforms.uShadowMatrix?.value as { copy(m: unknown): unknown }).copy(camera.matrixWorldInverse);
  (uniforms.uShadowBox?.value as { set(x: number, y: number): unknown }).set(radius, far);
  return radius;
}

function drawShadows(built: Built, renderer: RendererLike): void {
  const { lit, uniforms } = built;
  built.target ??= new lit.RenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
    type: "float", format: "red", minFilter: "nearest", magFilter: "nearest", depthBuffer: true,
  });
  built.camera ??= new lit.OrthoCamera(-1, 1, 1, -1, 0.01, 10);
  const { target, camera } = built;
  const radius = aimShadow(built, camera);
  if (uniforms.uShadowFar) uniforms.uShadowFar.value = radius * 3.5;
  // Materials hold these very uniform objects, so their values are set, never the objects replaced.
  if (uniforms.uShadowMap) uniforms.uShadowMap.value = target.texture;
  (uniforms.uShadow?.value as { set(a: number, b: number, c: number, d: number): unknown })
    .set(1 / SHADOW_SIZE, 2.5, 0.004 / 3.5, 1);
  const previous = renderer.getRenderTarget();
  const clear = new lit.Color();
  renderer.getClearColor(clear);
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear(true, true, false);
  renderer.render(built.shadowStage, camera);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
}

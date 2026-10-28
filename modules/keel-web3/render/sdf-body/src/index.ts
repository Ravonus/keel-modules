/**
 * Smooth bodies from parts. Any generator that poses a creature (or a plane, a
 * balloon, a prop) as capsules hands them here, and each body is drawn as ONE
 * continuous surface: the capsules are joined by a smooth union in a signed
 * distance field and raymarched on the GPU inside the body's bounding box, so
 * a neck flows into a chest and a leg into a hip with no seams and no blocks.
 * Small parts (eyes, noses, a lantern) stay crisp. Colour blends across a join
 * the same way the surface does. MIT.
 *
 * The distance functions are the KEEL pixel engine's (src/gpu/shaders.js
 * sdCap, core/sdf.js smin), with a flattened capsule for wings, ears and fins.
 * The march writes true depth, so bodies sort against the rest of the scene,
 * and a shadow proxy of plain spheres lets them cast shadows on it.
 *
 *   const bodies = createSdfBodies(lit, { shadows: true });
 *   scene.add(bodies.group);
 *   // every frame:
 *   bodies.draw(herd.at(t, stage), { sun, sunColor, sky, ground });
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export type Vec = readonly [number, number, number];

/** One part: a capsule from a to b, r thick; `flat` < 1 squashes it across `up` (a wing, an ear). */
export interface BodyPart {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: string;
  readonly flat?: number;
  readonly up?: Vec;
}

export interface BodyInput {
  readonly capsules: readonly BodyPart[];
  /** Colour per role (hex). */
  readonly palette: Readonly<Record<string, string>>;
  /** 0 lit as usual; 1 glows from its own colour. */
  readonly glow?: number;
  /** Roles that light themselves on this body only (an owl's eyes at night). */
  readonly lit?: readonly string[];
}

/** The scene's light, as the bodies see it. Directions point toward the light. */
export interface BodyLight {
  readonly sun: Vec;
  /** Linear RGB times intensity, as a keel/lit light's colour × intensity. */
  readonly sunColor: Vec;
  /** A second, softer light (a moon, a bounce). */
  readonly fill?: Vec;
  readonly fillColor?: Vec;
  /** Hemisphere light: colour times intensity above and below. */
  readonly sky: Vec;
  readonly ground: Vec;
  readonly rim?: Vec;
  readonly rimColor?: Vec;
}

export interface SdfBodiesOptions {
  /** Most parts in one body (the shader's array). */
  readonly maxParts?: number;
  /** Most bodies drawn at once. */
  readonly maxBodies?: number;
  /** Cast shadows through a proxy of plain spheres. */
  readonly shadows?: boolean;
  /** How far parts melt into each other, as a share of the thinner one's radius. */
  readonly blend?: number;
  /** Roles drawn crisp, never melted into their neighbours. */
  readonly crisp?: readonly string[];
  /** Roles that light themselves. */
  readonly emissive?: readonly string[];
  readonly renderOrder?: number;
  /**
   * The ink line round each body, in screen pixels (0 for none). It keeps a
   * small animal's silhouette against busy ground at any pixel size.
   */
  readonly ink?: number;
  /** The least margin left round a body for its ink, in the parts' units. */
  readonly inkPad?: number;
}

// ---------------------------------------------------------------- the parts of keel/lit used

interface ColorLike { r: number; g: number; b: number; set(value: string): ColorLike }
interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector3Like }
interface UniformLike<T> { value: T }
interface MaterialLike { dispose(): void; uniforms?: Record<string, UniformLike<unknown>> }
interface NodeLike {
  visible: boolean;
  frustumCulled: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  position: Vector3Like;
  scale: Vector3Like;
  add(...objects: unknown[]): void;
}
interface InstancedLike extends NodeLike {
  count: number;
  readonly instanceMatrix: { needsUpdate: boolean };
  setMatrixAt(index: number, matrix: unknown): void;
}
interface Matrix4Like { makeScale(x: number, y: number, z: number): Matrix4Like; setPosition(x: number, y: number, z: number): Matrix4Like }
interface DisposableLike { dispose(): void }

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancedLike;
  box(x: number, y: number, z: number): DisposableLike;
  sphere(r: number, w: number, h: number): DisposableLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly FlatMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => unknown;
  readonly Color: new (value?: string) => ColorLike;
  readonly Matrix4: new () => Matrix4Like;
}

// ---------------------------------------------------------------- the shader

// The box is drawn from its back faces so the march still starts when the
// camera is inside it. The ray is taken into the parts' own space (the box's
// parent), so a body under a moved or scaled group is still found.
const VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vEye;
void main() {
  vLocal = position;
  vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FIELD = /* glsl */ `
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform vec4 uA[MAXP];     // a, r
uniform vec4 uB[MAXP];     // b, role + 64 when crisp
uniform vec4 uU[MAXP];     // thin axis, flatness
uniform int uCount;
uniform vec3 uPal[ROLES];
uniform float uLit[ROLES];
uniform vec3 uMin, uMax;
uniform float uK, uGlow, uInk;
uniform vec3 uCenter, uSize;
uniform vec3 uSun, uSunCol, uFill, uFillCol, uSky, uGround, uRim, uRimCol;
varying vec3 vLocal;
varying vec3 vEye;

// The pixel engine's capsule, squashed across its thin axis when flat < 1.
float part(vec3 p, int i) {
  vec3 a = uA[i].xyz, b = uB[i].xyz;
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  vec3 v = pa - ba * h;
  float f = uU[i].w;
  if (f < 0.999) { float t = dot(v, uU[i].xyz); v += uU[i].xyz * t * (1.0 / f - 1.0); return (length(v) - uA[i].w) * f; }
  return length(v) - uA[i].w;
}

// Part i melted into the surface so far; h is its share.
float melt(int i, float d, float di, out float h) {
  float k = min(uK, uA[i].w * 0.8);
  h = clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0);
  return mix(d, di, h) - k * h * (1.0 - h);
}
// The surface alone, for the march, the normal and the occlusion.
float dist(vec3 p) {
  float d = 1e9, h;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float di = part(p, i);
    d = uB[i].w >= 64.0 ? min(d, di) : melt(i, d, di, h);
  }
  return d;
}
// The colour, melted by the same weights: once a pixel.
vec3 paint(vec3 p, out float lit) {
  float d = 1e9, h; vec3 col = vec3(0.0); lit = 0.0;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float di = part(p, i), tag = uB[i].w;
    int role = int(mod(tag, 64.0) + 0.5);
    if (tag >= 64.0) { if (di < d) { col = uPal[role]; lit = uLit[role]; } d = min(d, di); continue; }
    d = melt(i, d, di, h);
    col = mix(col, uPal[role], h); lit = mix(lit, uLit[role], h);
  }
  return col;
}
vec3 normalAt(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * dist(p + k.xyy * e) + k.yyx * dist(p + k.yyx * e) + k.yxy * dist(p + k.yxy * e) + k.xxx * dist(p + k.xxx * e));
}`;

// The march. A ray that misses the body by under uInk pixels
// (their width from the screen derivative) draws its ink line, a deep shade
// of the nearest part, so a small animal keeps its outline on grass or bark.
const MARCH = /* glsl */ `
const float INV_PI = 0.3183098862;
void main() {
  vec3 ro = uCenter + vEye * uSize;
  vec3 rd = normalize((vLocal - vEye) * uSize);
  float px = length(fwidth(rd));
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uMin - ro) * inv, t1 = (uMax - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float tn = max(max(max(lo.x, lo.y), lo.z), 0.0);
  float tf = min(min(hi.x, hi.y), hi.z);
  if (tn >= tf) discard;
  float scale = length(uSize);
  float eps = scale * 0.0006;
  float t = tn, d = 1e9, near = 1e9, nearT = tn;
  bool hit = false;
  // (Plain steps: over-relaxed ones jump a flat ear edge-on.)
  for (int s = 0; s < 56; s++) {
    d = dist(ro + rd * t);
    if (d < max(eps, px * t * 0.35)) { hit = true; break; }
    float gap = d / max(t, eps);
    if (gap < near) { near = gap; nearT = t; }
    t += d;
    if (t > tf) break;
  }
  // (Steps run out grazing a thin part: within a pixel of it is on it.)
  if (!hit && t < tf && d < max(eps * 12.0, px * t)) hit = true;
  vec3 p;
  if (!hit) {
    if (near > px * uInk || uGlow > 0.5) discard;
    p = ro + rd * nearT;
    float litInk;
    vec3 ink = paint(p, litInk);
    gl_FragColor = vec4(ink * 0.22 + vec3(0.004, 0.0035, 0.006), 1.0);
  } else {
    p = ro + rd * t;
    float lit;
    vec3 base = paint(p, lit);
    vec3 n = normalAt(p, eps * 1.5);
    // A little occlusion where parts meet (a leg against a belly), straight from the field.
    float reach = scale * 0.05;
    float ao = clamp(0.5 + 0.5 * dist(p + n * reach) / reach, 0.4, 1.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    float facing = max(dot(n, -rd), 0.0);
    float rim = pow(1.0 - facing, 3.0);
    // Light as keel/lit's LitMaterial takes it (colour x intensity, Lambert over pi), the sun wrapped a little.
    vec3 light = hemi * ao + uSunCol * max(dot(n, uSun) * 0.8 + 0.2, 0.0) + uFillCol * max(dot(n, uFill), 0.0);
    light = light * INV_PI + uRimCol * rim * max(dot(n, uRim), 0.0) * INV_PI * 2.0;
    // A soft sheen along the sun, so fur and feathers turn with the light.
    vec3 halfway = normalize(uSun - rd);
    light += uSunCol * INV_PI * 0.12 * pow(max(dot(n, halfway), 0.0), 18.0);
    // A sky-lit edge lifts the body off the ground behind it.
    light += uSky * INV_PI * 0.6 * rim;
    float glow = max(uGlow, lit);
    vec3 col = mix(base * light, base * (1.0 + 0.5 * rim), glow);
    // Bright sun would clip a coat channel by channel and turn a brown deer
    // orange; instead the highlight rolls off as a whole, keeping its hue.
    float peak = max(max(col.r, col.g), col.b);
    if (peak > 0.75) col *= (0.75 + 0.25 * (1.0 - exp(-(peak - 0.75) * 4.0))) / peak;
    gl_FragColor = vec4(col, 1.0);
  }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4((p - uCenter) / uSize, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const fragment = (maxParts: number, roles: number): string => `#define MAXP ${String(maxParts)}\n#define ROLES ${String(roles)}\n${FIELD}\n${MARCH}`;

// ---------------------------------------------------------------- bodies

const DEFAULT_CRISP = ["eye", "pupil", "shine", "nose", "glow", "horn"];
const DEFAULT_EMISSIVE = ["glow", "shine"];

export interface SdfBodies {
  /** Add this to the scene once. */
  readonly group: unknown;
  /** Draw these bodies this frame (the rest are hidden). */
  draw(bodies: readonly BodyInput[], light: BodyLight): void;
  dispose(): void;
}

interface Slot {
  readonly mesh: NodeLike;
  readonly material: MaterialLike;
  readonly u: Record<string, UniformLike<unknown>>;
}

function makeSlot(lit: LitLike, geometry: DisposableLike, shader: string, maxParts: number, roles: number, order: number): Slot {
  const u: Record<string, UniformLike<unknown>> = {
    uA: { value: Array.from({ length: maxParts }, () => new lit.Vector4()) },
    uB: { value: Array.from({ length: maxParts }, () => new lit.Vector4()) },
    uU: { value: Array.from({ length: maxParts }, () => new lit.Vector4(0, 1, 0, 1)) },
    uCount: { value: 0 },
    uPal: { value: Array.from({ length: roles }, () => new lit.Color("#ffffff")) },
    uLit: { value: new Array<number>(roles).fill(0) },
    uMin: { value: new lit.Vector3() }, uMax: { value: new lit.Vector3() },
    uCenter: { value: new lit.Vector3() }, uSize: { value: new lit.Vector3(1, 1, 1) },
    uFill: { value: new lit.Vector3(0, 1, 0) }, uFillCol: { value: new lit.Vector3(0, 0, 0) },
    uK: { value: 0.02 }, uGlow: { value: 0 }, uInk: { value: 0.85 },
    uSun: { value: new lit.Vector3(0, 1, 0) }, uSunCol: { value: new lit.Vector3(1, 1, 1) },
    uSky: { value: new lit.Vector3(0.6, 0.6, 0.7) }, uGround: { value: new lit.Vector3(0.2, 0.2, 0.2) },
    uRim: { value: new lit.Vector3(0, 0, 1) }, uRimCol: { value: new lit.Vector3(0, 0, 0) },
  };
  const material = new lit.CustomMaterial({ uniforms: u, vertexShader: VERTEX, fragmentShader: shader, side: "back", depthTest: true, depthWrite: true });
  const mesh = new lit.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = order;
  return { mesh, material, u };
}

interface Bounds { readonly min: Vec; readonly max: Vec; readonly k: number }

const UP: Vec = [0, 1, 0];
interface Ink { readonly width: number; readonly pad: number }
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The box the body is marched in. Its margin leaves room for the ink line:
 * a twelfth of the body's length, never less than `inkPad`. (Every pixel of
 * margin is marched, so it is kept to that.)
 */
function boundsOf(parts: readonly BodyPart[], count: number, blend: number, inkPad: number): Bounds {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (let i = 0; i < count; i += 1) {
    const part = parts[i];
    if (!part) continue;
    for (let axis = 0; axis < 3; axis += 1) span(lo, hi, axis, part);
    radius += part.r;
  }
  const [lx = 0, ly = 0, lz = 0] = lo;
  const [hx = 0, hy = 0, hz = 0] = hi;
  const mean = radius / Math.max(1, count);
  const pad = Math.max(mean * 0.5, inkPad > 0 ? Math.max(inkPad, Math.max(hx - lx, hy - ly, hz - lz) / 12) : 0);
  return { min: [lx - pad, ly - pad, lz - pad], max: [hx + pad, hy + pad, hz + pad], k: mean * blend };
}

/** Widen the box along one axis to take in a part. */
function span(lo: number[], hi: number[], axis: number, part: BodyPart): void {
  const a = part.a[axis] ?? 0;
  const b = part.b[axis] ?? 0;
  lo[axis] = Math.min(lo[axis] ?? Infinity, Math.min(a, b) - part.r);
  hi[axis] = Math.max(hi[axis] ?? -Infinity, Math.max(a, b) + part.r);
}

/** The part's thin direction: its `up`, made square to its length. */
function thinAxis(part: BodyPart): Vec {
  const up = part.up ?? [0, 1, 0];
  const ax = sub(part.b, part.a);
  const l2 = dot(ax, ax);
  if (l2 < 1e-18) return up;
  const t = sub(up, times(ax, dot(ax, up) / l2));
  const tl = Math.hypot(t[0], t[1], t[2]);
  return tl > 1e-9 ? times(t, 1 / tl) : [0, 1, 0];
}

interface Vector4Like { set(x: number, y: number, z: number, w: number): void }
interface ShaderState {
  readonly roles: Map<string, number>;
  readonly crisp: ReadonlySet<string>;
  readonly emissive: ReadonlySet<string>;
}

function roleIndex(state: ShaderState, role: string, limit: number): number {
  let index = state.roles.get(role);
  if (index === undefined) { index = Math.min(state.roles.size, limit - 1); state.roles.set(role, index); }
  return index;
}

function paint(slot: Slot, body: BodyInput, state: ShaderState): void {
  const pal = slot.u.uPal?.value as ColorLike[];
  const lit = slot.u.uLit?.value as number[];
  for (const [role, index] of state.roles) {
    pal[index]?.set(body.palette[role] ?? "#ff00ff");
    lit[index] = state.emissive.has(role) || body.lit?.includes(role) === true ? 1 : 0;
  }
}

function writePart(part: BodyPart, a: Vector4Like, b: Vector4Like, u: Vector4Like, tag: number): void {
  const flat = Math.max(0.05, Math.min(1, part.flat ?? 1));
  // (A round part has no thin axis to find.)
  const thin = flat < 0.999 ? thinAxis(part) : UP;
  a.set(part.a[0], part.a[1], part.a[2], part.r);
  b.set(part.b[0], part.b[1], part.b[2], tag);
  u.set(thin[0], thin[1], thin[2], flat);
}

function fill(slot: Slot, body: BodyInput, state: ShaderState, maxParts: number, roles: number, blend: number, ink: Ink): void {
  const parts = body.capsules;
  const count = Math.min(parts.length, maxParts);
  const { min, max, k } = boundsOf(parts, count, blend, ink.pad);
  const A = slot.u.uA?.value as Vector4Like[];
  const B = slot.u.uB?.value as Vector4Like[];
  const U = slot.u.uU?.value as Vector4Like[];
  for (let i = 0; i < count; i += 1) {
    const part = parts[i];
    const a = A[i];
    const b = B[i];
    const u = U[i];
    if (part && a && b && u) writePart(part, a, b, u, roleIndex(state, part.role, roles) + (state.crisp.has(part.role) ? 64 : 0));
  }
  paint(slot, body, state);
  (slot.u.uInk as UniformLike<number>).value = ink.width;
  (slot.u.uCount as UniformLike<number>).value = count;
  (slot.u.uK as UniformLike<number>).value = k;
  (slot.u.uGlow as UniformLike<number>).value = Math.min(1, body.glow ?? 0);
  place(slot, min, max);
  slot.mesh.visible = count > 0;
}

/** Set the marching box: its bounds for the ray, and the mesh that draws it. */
function place(slot: Slot, min: Vec, max: Vec): void {
  const center = times(add(min, max), 0.5);
  const size = sub(max, min);
  (slot.u.uMin?.value as Vector3Like).set(min[0], min[1], min[2]);
  (slot.u.uMax?.value as Vector3Like).set(max[0], max[1], max[2]);
  (slot.u.uCenter?.value as Vector3Like).set(center[0], center[1], center[2]);
  (slot.u.uSize?.value as Vector3Like).set(size[0], size[1], size[2]);
  slot.mesh.position.set(center[0], center[1], center[2]);
  slot.mesh.scale.set(size[0], size[1], size[2]);
}

function lightSlot(slot: Slot, light: BodyLight): void {
  const set = (name: string, v: Vec | undefined): void => { if (v) (slot.u[name]?.value as Vector3Like).set(v[0], v[1], v[2]); };
  set("uSun", light.sun);
  set("uSunCol", light.sunColor);
  set("uFill", light.fill);
  set("uFillCol", light.fillColor ?? [0, 0, 0]);
  set("uSky", light.sky);
  set("uGround", light.ground);
  set("uRim", light.rim);
  set("uRimCol", light.rimColor ?? [0, 0, 0]);
}

/** Shadows: each part as a few plain spheres that only the shadow pass sees. */
function shadowProxy(lit: LitLike, limit: number): { mesh: InstancedLike; matrix: Matrix4Like; geometry: DisposableLike; material: MaterialLike } {
  const geometry = lit.sphere(1, 8, 6);
  const material = new lit.FlatMaterial({ colorWrite: false, depthWrite: false });
  const mesh = new lit.Instances(geometry, material, limit);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, matrix: new lit.Matrix4(), geometry, material };
}

function castShadows(proxy: ReturnType<typeof shadowProxy>, bodies: readonly BodyInput[], limit: number): void {
  let n = 0;
  for (const body of bodies) {
    for (const part of body.capsules) {
      const r = part.r * (part.flat !== undefined && part.flat < 1 ? 0.6 : 1);
      // A round part is one sphere; a long one three along its length.
      const steps = part.a[0] === part.b[0] && part.a[1] === part.b[1] && part.a[2] === part.b[2] ? 1 : 3;
      for (let s = 0; s < steps && n < limit; s += 1) {
        const k = steps === 1 ? 0 : s * 0.5;
        proxy.matrix.makeScale(r, r, r).setPosition(part.a[0] + (part.b[0] - part.a[0]) * k, part.a[1] + (part.b[1] - part.a[1]) * k, part.a[2] + (part.b[2] - part.a[2]) * k);
        proxy.mesh.setMatrixAt(n, proxy.matrix);
        n += 1;
      }
    }
  }
  proxy.mesh.count = n;
  proxy.mesh.instanceMatrix.needsUpdate = true;
}

/** A pool of smooth raymarched bodies, drawn from capsule parts each frame. */
export function createSdfBodies(lit: LitLike, options: SdfBodiesOptions = {}): SdfBodies {
  const maxParts = Math.max(4, Math.min(64, options.maxParts ?? 48));
  const maxBodies = Math.max(1, options.maxBodies ?? 48);
  const roles = 16;
  const blend = options.blend ?? 0.6;
  const width = Math.max(0, options.ink ?? 0.85);
  const ink: Ink = { width, pad: width > 0 ? Math.max(0, options.inkPad ?? 0.08) : 0 };
  const shader = fragment(maxParts, roles);
  const geometry = lit.box(1, 1, 1);
  const group = new lit.Group();
  const state: ShaderState = { roles: new Map(), crisp: new Set(options.crisp ?? DEFAULT_CRISP), emissive: new Set(options.emissive ?? DEFAULT_EMISSIVE) };
  const slots: Slot[] = [];
  const proxy = options.shadows === true ? shadowProxy(lit, maxBodies * maxParts) : null;
  if (proxy) group.add(proxy.mesh);
  return {
    group,
    draw(bodies, light) {
      while (slots.length < Math.min(bodies.length, maxBodies)) {
        const slot = makeSlot(lit, geometry, shader, maxParts, roles, options.renderOrder ?? 0);
        slots.push(slot);
        group.add(slot.mesh);
      }
      slots.forEach((slot, i) => {
        const body = bodies[i];
        if (!body) { slot.mesh.visible = false; return; }
        fill(slot, body, state, maxParts, roles, blend, ink);
        lightSlot(slot, light);
      });
      if (proxy) castShadows(proxy, bodies.slice(0, maxBodies), maxBodies * maxParts);
    },
    dispose() {
      for (const slot of slots) slot.material.dispose();
      geometry.dispose();
      proxy?.geometry.dispose();
      proxy?.material.dispose();
    },
  };
}


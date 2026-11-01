// Bodies: a marching box a body, its parts written to uniforms, its shadow proxy and its lights.

import type {
  BodyInput, BodyLight, BodyPart, Eye, Grain, Material, Pattern, Pelt, PeltBone, ScalePatch, SdfBodiesOptions, Vec,
} from "./body.js";
import type {
  ColorLike, DisposableLike, InstancedLike, LitLike, MaterialLike, Matrix4Like, NodeLike, UniformLike, Vector3Like,
} from "./lit.js";
import { FLOWS, VERTEX, fragment } from "./march.glsl.js";

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
    uK: { value: 0.02 }, uGlow: { value: 0 }, uFade: { value: 1 }, uInk: { value: 0.85 }, uSat: { value: 1 },
    uSun: { value: new lit.Vector3(0, 1, 0) }, uSunCol: { value: new lit.Vector3(1, 1, 1) },
    uSky: { value: new lit.Vector3(0.6, 0.6, 0.7) }, uGround: { value: new lit.Vector3(0.2, 0.2, 0.2) },
    uRim: { value: new lit.Vector3(0, 0, 1) }, uRimCol: { value: new lit.Vector3(0, 0, 0) },
    uFront: { value: new lit.Vector3(0, 0, 0) },
    uGrain: { value: 0 }, uGrainKind: { value: 0 }, uGrainRise: { value: 1 }, uGrainOn: { value: -1 }, uCrown: { value: new lit.Vector4(0, 0, 0, 0) }, uDome: { value: new lit.Vector3(1, 1, 1) }, uDomeGene: { value: new lit.Vector3(1, 0, 0) }, uScale: { value: Array.from({ length: 3 }, () => new lit.Vector4()) }, uScaleSize: { value: new lit.Vector3(1, 1, 1) }, uAft: { value: new lit.Vector3(0, 0, -1) },
    uOrigin: { value: new lit.Vector3(0, 0, 0) }, uSide: { value: new lit.Vector3(1, 0, 0) }, uUp: { value: new lit.Vector3(0, 1, 0) }, uFwd: { value: new lit.Vector3(0, 0, 1) },
    uMat: { value: new lit.Vector4(0, 0, 0, 0) }, uLift: { value: 1 }, uNeutral: { value: 0 }, uPattern: { value: new lit.Vector4(0, 1, 0, 0) }, uForm: { value: new lit.Vector3(0, 1, 0) }, uEyeRole: { value: -1 }, uEyeLid: { value: new lit.Vector4(0, 0, 0, 1) }, uEyeLidCol: { value: new lit.Color("#000000") }, uEyeWhite: { value: new lit.Color("#000000") }, uEyeLook: { value: new lit.Vector4(0, 0, 0, 0) }, uEyeSpark: { value: 0.2 }, uPatSeed: { value: new lit.Vector3(0, 0, 0) }, uPatGene: { value: new lit.Vector4(1, 1, 0, 0) }, uPatCol: { value: new lit.Color("#000000") }, uPatTwo: { value: new lit.Color("#000000") }, uTrunk: { value: new lit.Vector3(0, 0, 0) }, uDorsal: { value: 1e6 },
    uFlowN: { value: 0 }, uFlowA: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowB: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowU: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowFall: { value: new Array<number>(FLOWS).fill(0) },
    uPelt: { value: new lit.Vector4(0.4, 0, 0, 0) }, uPeltCast: { value: new lit.Vector3(0, 0, 0) }, uPeltLine: { value: new lit.Vector3(0, 0, 0) },
    uPeltRoot: { value: new lit.Color("#000000") }, uPeltBand: { value: new lit.Color("#000000") }, uPeltTip: { value: new lit.Color("#000000") }, uPeltBack: { value: new lit.Color("#000000") }, uPeltFront: { value: new lit.Color("#000000") },
    uVane: { value: new lit.Vector4(-1, 0, 0, 0) }, uSkinRole: { value: -1 }, uSkin: { value: new lit.Vector3(1, 0, 0) }, uSkinPale: { value: new lit.Color("#000000") },
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
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitOr = (v: Vec, fallback: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : fallback;
};

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
    // (A decal has no surface and a carve only takes one away: neither widens the box.)
    if (!part || surfaceless(part)) continue;
    for (let axis = 0; axis < 3; axis += 1) span(lo, hi, axis, part);
    radius += meanRadius(part);
  }
  const [lx = 0, ly = 0, lz = 0] = lo;
  const [hx = 0, hy = 0, hz = 0] = hi;
  const mean = radius / Math.max(1, count);
  const pad = Math.max(mean * 0.5, inkPad > 0 ? Math.max(inkPad, Math.max(hx - lx, hy - ly, hz - lz) / 12) : 0);
  return { min: [lx - pad, ly - pad, lz - pad], max: [hx + pad, hy + pad, hz + pad], k: mean * blend };
}

/** A part that adds no surface of its own: a decal (paint only) or a carve (it cuts one away). */
const surfaceless = (part: BodyPart): boolean => part.decal === true || part.carve === true;
/** A part that casts a shadow: one with a surface, not kept out of it. */
const casts = (part: BodyPart): boolean => !surfaceless(part) && part.shadow !== false;

/** A part's mean thickness, along a taper. */
const meanRadius = (part: BodyPart): number => (part.r + (part.r1 ?? part.r)) / 2;

/** Widen the box along one axis to take in a part. */
function span(lo: number[], hi: number[], axis: number, part: BodyPart): void {
  const a = part.a[axis] ?? 0;
  const b = part.b[axis] ?? 0;
  const r1 = part.r1 ?? part.r;
  // (A digit reaches past its row and a bowed part stands off its line: the box holds both, or a wing's tip is cut
  // straight.)
  const out = (part.reach?.[axis] ?? 0) + (part.bow?.[axis] ?? 0);
  lo[axis] = Math.min(lo[axis] ?? Infinity, a - part.r + Math.min(out, 0), b - r1 + Math.min(out, 0));
  hi[axis] = Math.max(hi[axis] ?? -Infinity, a + part.r + Math.max(out, 0), b + r1 + Math.max(out, 0));
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

/**
 * The tag a part carries to the shader: its role, its melt in 16ths (0 crisp), 1024 for a decal and 2048 more for one
 * under the pattern, or 4096 more for one that is bare skin, 2048 alone for a carve.
 */
export function tagOf(role: number, crisp: boolean, part: Pick<BodyPart, "melt" | "decal" | "under" | "carve" | "bare">): number {
  // (A carve is never crisp: its melt is how soft its rim is.)
  const melt = crisp && part.carve !== true ? 0 : Math.round(Math.max(0, Math.min(2, part.melt ?? 1)) * 16);
  if (part.carve === true) return role + 16 * Math.max(1, melt) + 2048;
  return role + 16 * melt + (part.decal === true ? (part.bare === true ? 5120 : part.under === true ? 3072 : 1024) : 0);
}

function writePart(part: BodyPart, a: Vector4Like, b: Vector4Like, u: Vector4Like, tag: number): void {
  const flat = Math.max(0.05, Math.min(1, part.flat ?? 1));
  // (A round part has no thin axis to find. The axis is stored scaled by the flatness.)
  const thin = flat < 0.999 ? thinAxis(part) : UP;
  const f = flat < 0.999 ? flat : 1;
  const bow = bowOf(part);
  a.set(part.a[0], part.a[1], part.a[2], part.r);
  b.set(part.b[0], part.b[1], part.b[2], tag);
  if (part.row !== undefined) { u.set(...(part.reach ?? part.bow ?? [0, 0, 0]), rowTag(part)); return; }
  u.set(bow ? bow[0] : thin[0] * f, bow ? bow[1] : thin[1] * f, bow ? bow[2] : thin[2] * f, Math.max(0, part.r1 ?? part.r));
}

/** A row's count as the shader takes it, under nought, its fraction saying what kind of row. */
const rowTag = (part: BodyPart): number => -Math.max(2, part.row ?? 2) - (part.sharp ? 0.5 : part.reach ? 0.25 : 0);

/** A part's bow as the shader takes it: its way, 2 plus its size long. */
function bowOf(part: BodyPart): Vec | null {
  const size = part.bow ? Math.hypot(part.bow[0], part.bow[1], part.bow[2]) : 0;
  return part.bow && size > 1e-9 ? times(part.bow, (2 + size) / size) : null;
}

function fill(slot: Slot, body: BodyInput, state: ShaderState, maxParts: number, roles: number, blend: number, ink: Ink): void {
  const parts = fitParts(body.capsules, maxParts);
  const count = Math.min(parts.length, maxParts);
  // (The grain stands off the surface: the box leaves it room.)
  const { min, max, k } = boundsOf(parts, count, blend, ink.pad + standOff(body));
  const A = slot.u.uA?.value as Vector4Like[];
  const B = slot.u.uB?.value as Vector4Like[];
  const U = slot.u.uU?.value as Vector4Like[];
  for (let i = 0; i < count; i += 1) {
    const part = parts[i];
    const a = A[i];
    const b = B[i];
    const u = U[i];
    if (part && a && b && u) writePart(part, a, b, u, tagOf(roleIndex(state, part.role, roles), state.crisp.has(part.role) || part.melt === 0, part));
  }
  paint(slot, body, state);
  (slot.u.uInk as UniformLike<number>).value = ink.width;
  (slot.u.uCount as UniformLike<number>).value = count;
  (slot.u.uK as UniformLike<number>).value = k;
  (slot.u.uGlow as UniformLike<number>).value = Math.min(1, body.glow ?? 0);
  (slot.u.uFade as UniformLike<number>).value = body.fade ?? 1;
  grainSlot(slot, body, state, roles);
  place(slot, min, max);
  slot.mesh.visible = count > 0;
}

const SMOOTH: Grain = { kind: "fur", size: 0 };
/** The way a coat lies when its grain names none: back along the body and a little down. */
const AFT: Vec = [0, -0.33, -0.944];
const GRAIN_KINDS: Readonly<Record<Grain["kind"], number>> = { fur: 0, feather: 1, scale: 2, spine: 3, plate: 4 };
const grainOf = (body: BodyInput): Grain => (body.grain && body.grain.size > 0 ? body.grain : SMOOTH);
/** How far the surface stands off its parts: its grain and its relief. */
const standOff = (body: BodyInput): number => grainReach(grainOf(body)) + (body.form?.amount ?? 0);
/** How far a grain stands off the surface: a spine its whole height, a shell's plates and its brim. */
const grainReach = (grain: Grain): number => grain.size * (grain.kind === "spine" ? 1.1 : 0.4) * (grain.rise ?? 1) + (grain.dome?.[1] ?? 0) * 0.12 + grain.size * (grain.rise ?? 1) * peltLong(grain);
/** A pelt's longest hair, in grain sizes. */
const peltLong = (grain: Grain): number => (grain.pelt?.flow ?? []).reduce((most, bone) => Math.max(most, ...bone.long), 0);

/**
 * How each grain takes the light when the body names no material of its own: fur soft and fuzzy, feathers and scales
 * glossy.
 */
const MATERIALS: Readonly<Record<Grain["kind"], Required<Material>>> = {
  fur: { sheen: 0.6, fuzz: 0.45, gloss: 0, iridescence: 0, lift: 1, neutral: 0 },
  feather: { sheen: 0.15, fuzz: 0.1, gloss: 0.35, iridescence: 0, lift: 1, neutral: 0 },
  scale: { sheen: 0, fuzz: 0, gloss: 0.7, iridescence: 0, lift: 1, neutral: 0 },
  spine: { sheen: 0, fuzz: 0.1, gloss: 0.3, iridescence: 0, lift: 1, neutral: 0.3 },
  plate: { sheen: 0, fuzz: 0, gloss: 0.3, iridescence: 0, lift: 1, neutral: 0 },
};
const PATTERN_KINDS: Readonly<Record<Pattern["kind"], number>> = { dapple: 1, spots: 2, stripes: 3, streaks: 4, bars: 5, chevrons: 6, mackerel: 7, patches: 8, grizzle: 9, tips: 10, scutes: 11 };

interface Vector4Set { set(x: number, y: number, z: number, w: number): unknown }

/** The point a grain is set about, and the dome a plated one lies on. */
function crownSlot(slot: Slot, grain: Grain): void {
  (slot.u.uCrown?.value as Vector4Set).set(...(grain.crown ?? [0, 0, 0]), grain.crown ? 1 : 0);
  (slot.u.uDome?.value as Vector3Like).set(...(grain.dome ?? [1, 1, 1]));
  const tilt = grain.tilt ?? 0;
  (slot.u.uDomeGene?.value as Vector3Like).set(Math.cos(tilt), Math.sin(tilt), grain.teeth ?? 0);
  scaleSlot(slot, grain.scales ?? []);
}

/** Where a plated animal's hide wears scales of their own. */
function scaleSlot(slot: Slot, scales: readonly ScalePatch[]): void {
  const at = slot.u.uScale?.value as Vector4Set[];
  at.forEach((each, i) => { const patch = scales[i]; each.set(...(patch?.at ?? [0, 0, 0]), patch?.reach ?? 0); });
  (slot.u.uScaleSize?.value as Vector3Like).set(scales[0]?.size ?? 1, scales[1]?.size ?? 1, scales[2]?.size ?? 1);
}

/** The body's frame (its grain and pattern ride on it), its grain, its material and its pattern. */
function grainSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const grain = grainOf(body);
  (slot.u.uGrain as UniformLike<number>).value = grain.size;
  (slot.u.uGrainKind as UniformLike<number>).value = GRAIN_KINDS[grain.kind];
  (slot.u.uGrainRise as UniformLike<number>).value = grain.rise ?? 1;
  (slot.u.uGrainOn as UniformLike<number>).value = grain.on === undefined ? -1 : roleIndex(state, grain.on, roles);
  crownSlot(slot, grain);
  const fwd = unitOr(body.front ?? [0, 0, 1], [0, 0, 1]);
  const side = unitOr(cross(UP, fwd), [1, 0, 0]);
  const up = cross(fwd, side);
  const set = (name: string, v: Vec): void => { (slot.u[name]?.value as Vector3Like).set(v[0], v[1], v[2]); };
  set("uOrigin", body.at ?? [0, 0, 0]);
  set("uSide", side);
  set("uUp", up);
  set("uFwd", fwd);
  set("uAft", unitOr(grain.lie ?? AFT, AFT));
  const m = { ...(grain.size > 0 ? MATERIALS[grain.kind] : MATERIALS.scale), ...(grain.size > 0 ? {} : { gloss: 0 }), ...body.material };
  (slot.u.uMat?.value as Vector4Set).set(m.sheen, m.fuzz, m.gloss, m.iridescence);
  (slot.u.uLift as UniformLike<number>).value = m.lift;
  (slot.u.uNeutral as UniformLike<number>).value = m.neutral;
  patternSlot(slot, body, state, roles);
  skinSlot(slot, body, state, roles);
}

/** What lies over the coat's own light: the eyes' lids and the body's relief. */
/** A display feather's roles. (Its eye's may be worn by no part of this body, so they are painted here.) */
function vaneSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const uniform = slot.u.uVane?.value as Vector4Set;
  const { vane } = body;
  if (!vane) { uniform.set(-1, 0, 0, 0); return; }
  uniform.set(roleIndex(state, vane.role, roles), roleIndex(state, vane.heart, roles), roleIndex(state, vane.ring, roles), roleIndex(state, vane.gold, roles));
  paint(slot, body, state);
}

function skinSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  eyeSlot(slot, body, state, roles);
  vaneSlot(slot, body, state, roles);
  (slot.u.uForm?.value as Vector3Like).set(body.form?.amount ?? 0, Math.max(body.form?.size ?? 1, 1e-4), 0);
  peltSlot(slot, grainOf(body).pelt);
  bareSlot(slot, body, state, roles);
}

/** How this body's bare skin takes the light. */
function bareSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const { skin } = body;
  (slot.u.uSkinRole as UniformLike<number>).value = skin ? roleIndex(state, skin.role, roles) : -1;
  if (!skin) return;
  (slot.u.uSkin?.value as Vector3Like).set(skin.chroma, skin.flush ?? 0, skin.depth ?? 1);
  (slot.u.uSkinPale?.value as ColorLike).set(skin.pale ?? body.palette[skin.role] ?? "#000000");
}

/** The bones a pelt grows from, each square to its own long side. */
function flowSlot(slot: Slot, flow: readonly PeltBone[]): void {
  const A = slot.u.uFlowA?.value as Vector4Like[];
  const B = slot.u.uFlowB?.value as Vector4Like[];
  const U = slot.u.uFlowU?.value as Vector4Like[];
  const fall = slot.u.uFlowFall?.value as number[];
  const count = Math.min(flow.length, FLOWS);
  for (let i = 0; i < count; i += 1) {
    const bone = flow[i];
    if (!bone) continue;
    const along = unitOr(sub(bone.b, bone.a), [0, 0, 1]);
    const up = unitOr(sub(bone.up, times(along, dot(along, bone.up))), [0, 1, 0]);
    A[i]?.set(...bone.a, bone.long[0]);
    B[i]?.set(...bone.b, bone.long[1]);
    U[i]?.set(...up, bone.girth);
    fall[i] = bone.fall ?? 0;
  }
  (slot.u.uFlowN as UniformLike<number>).value = count;
}

/** A pelt's plain defaults: a soft undercoat, its hair one colour root to tip. */
const PELT: Required<Omit<Pelt, "flow">> = { under: 0.45, thin: 0, crease: 0.2, tint: 0, root: "#000000", band: ["#000000", 0], tip: ["#ffffff", 0], back: "#000000", front: "#ffffff", dorsal: 0, ventral: 0 };

/** What a pelt grows from and the colours along its hair. */
function peltSlot(slot: Slot, pelt: Pelt | undefined): void {
  if (!pelt) { (slot.u.uFlowN as UniformLike<number>).value = 0; return; }
  flowSlot(slot, pelt.flow);
  const { under, thin, crease, tint, root, band, tip, back, front, dorsal, ventral } = { ...PELT, ...pelt };
  const color = (name: string, hex: string): void => { (slot.u[name]?.value as ColorLike).set(hex); };
  (slot.u.uPelt?.value as Vector4Set).set(under, thin, crease, tint);
  (slot.u.uPeltCast?.value as Vector3Like).set(dorsal, ventral, 0);
  (slot.u.uPeltLine?.value as Vector3Like).set(band[1], tip[1], 0);
  color("uPeltRoot", root);
  color("uPeltBand", band[0]);
  color("uPeltTip", tip[0]);
  color("uPeltBack", back);
  color("uPeltFront", front);
}

const EYE_PUPILS: Readonly<Record<Eye["pupil"], number>> = { round: 0, slit: 1, bar: 2, dark: 3 };

/** The eyes' lids, and the role whose lens they are painted on. */
function whiteSlot(slot: Slot, eye: Eye): void {
  const [x, y] = eye.look ?? [0, 0];
  (slot.u.uEyeLook?.value as Vector4Set).set(x, y, eye.white ? 1 : 0, 0);
  if (eye.white) (slot.u.uEyeWhite?.value as ColorLike).set(eye.white);
}

function eyeSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const eye = body.eye;
  (slot.u.uEyeRole as UniformLike<number>).value = eye ? roleIndex(state, eye.role, roles) : -1;
  if (!eye) return;
  (slot.u.uEyeLid?.value as Vector4Set).set(eye.lid, eye.slant, EYE_PUPILS[eye.pupil], eye.ring ? 1 : 0);
  (slot.u.uEyeLidCol?.value as ColorLike).set(eye.color);
  (slot.u.uEyeSpark as UniformLike<number>).value = eye.spark ?? 0.2;
  whiteSlot(slot, eye);
}

/** The pattern over the coat, in its own colour or its role's; none when it has no contrast. */
function patternSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const pattern = body.pattern;
  if (!pattern || pattern.contrast <= 0) { (slot.u.uPattern?.value as Vector4Set).set(0, 1, 0, 0); return; }
  roleIndex(state, pattern.role, roles);
  (slot.u.uPattern?.value as Vector4Set).set(PATTERN_KINDS[pattern.kind], Math.max(pattern.scale, 1e-4), Math.min(1, pattern.contrast), pattern.run ?? 0);
  geneSlot(slot, pattern);
  (slot.u.uPatCol?.value as ColorLike).set(pattern.color ?? body.palette[pattern.role] ?? "#000000");
  (slot.u.uPatTwo?.value as ColorLike).set(pattern.second ?? "#000000");
  trunkSlot(slot, pattern);
}

/** Where in the noise this animal's coat grew, and how its marks grow there. */
function geneSlot(slot: Slot, pattern: Pattern): void {
  const at = (k: number): number => ((Math.imul(pattern.seed >>> 0, k) >>> 0) % 4093) * 0.0731;
  (slot.u.uPatSeed?.value as Vector3Like).set(at(2654435761), at(1597334677), at(3812015801));
  const [warp, stretch, density, drift] = pattern.genes ?? [1, 1, 0, 0];
  (slot.u.uPatGene?.value as Vector4Set).set(warp, Math.max(stretch, 0.05), density, drift);
}

/** Where a pattern that goes by the trunk finds it, and how high its spine line starts. */
function trunkSlot(slot: Slot, pattern: Pattern): void {
  const [low, back, front] = pattern.trunk ?? [0, 0, 0];
  (slot.u.uTrunk?.value as Vector3Like).set(low, back, front);
  (slot.u.uDorsal as UniformLike<number>).value = pattern.dorsal ?? 1e6;
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
  set("uFront", light.front ?? [0, 0, 0]);
  (slot.u.uSat as UniformLike<number>).value = light.saturation ?? 1;
}

/**
 * How far apart a part's shadow spheres sit, in its radii; the most a part takes; and the smallest part that casts,
 * against the body's largest.
 */
const SHADOW_STEP = 1.25;
const SHADOW_MOST = 12;
const SHADOW_LEAST = 0.05;
/** The pool's spheres a part, on average, so a full scene's last bodies keep their shadows. */
const SHADOW_POOL = 5;

/** Shadows: each part as a few plain spheres that only the shadow pass sees. */
function shadowProxy(lit: LitLike, limit: number): { mesh: InstancedLike; matrix: Matrix4Like; geometry: DisposableLike; material: MaterialLike } {
  const geometry = lit.sphere(1, 12, 8);
  const material = new lit.FlatMaterial({ colorWrite: false, depthWrite: false });
  const mesh = new lit.Instances(geometry, material, limit);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, matrix: new lit.Matrix4(), geometry, material };
}

/**
 * The spheres a part casts its shadow with: enough to run its length without gaps, each its own width along a taper.
 */
function castsAlong(part: BodyPart): number {
  const length = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]);
  return Math.min(Math.ceil(length / (Math.max(meanRadius(part), 1e-5) * SHADOW_STEP)) + 1, SHADOW_MOST);
}

function castShadows(proxy: ReturnType<typeof shadowProxy>, bodies: readonly BodyInput[], limit: number): void {
  let n = 0;
  for (const body of bodies) {
    // (Parts too small to show in a shadow, an eye, a claw, are left out of it: most of the cost and none of the look.)
    const least = Math.max(...body.capsules.map(meanRadius), 0) * SHADOW_LEAST;
    for (const part of body.capsules) {
      if (!casts(part) || meanRadius(part) < least) continue;
      const squash = (part.flat ?? 1) < 1 ? 0.6 : 1;
      const steps = castsAlong(part);
      for (let s = 0; s < steps && n < limit; s += 1) {
        const k = steps === 1 ? 0 : s / (steps - 1);
        const r = (part.r + ((part.r1 ?? part.r) - part.r) * k) * squash;
        proxy.matrix.makeScale(r, r, r).setPosition(part.a[0] + (part.b[0] - part.a[0]) * k, part.a[1] + (part.b[1] - part.a[1]) * k, part.a[2] + (part.b[2] - part.a[2]) * k);
        proxy.mesh.setMatrixAt(n, proxy.matrix);
        n += 1;
      }
    }
  }
  proxy.mesh.count = n;
  proxy.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * The most parts a body can have, and the uniform vectors the shader spends on all else (measured from a linked
 * program).
 */
export const MOST_PARTS = 64;
export const OTHER_UNIFORMS = 154;

/** The parts a device's fragment uniform vectors can hold: each costs three. */
export const partsFor = (uniforms: number): number => Math.min(MOST_PARTS, Math.floor((uniforms - OTHER_UNIFORMS) / 3));

/**
 * A body's parts cut to `most`, dropping whole `detail` groups from the highest down, so a left paw never keeps claws a
 * right one lost.
 */
export function fitParts<T extends { readonly detail?: number }>(parts: readonly T[], most: number): readonly T[] {
  let kept = parts;
  while (kept.length > most) {
    const top = kept.reduce((high, part) => Math.max(high, part.detail ?? 0), 0);
    if (top === 0) break;
    kept = kept.filter((part) => (part.detail ?? 0) !== top);
  }
  return kept;
}

/** A pool of smooth raymarched bodies, drawn from capsule parts each frame. */
export function createSdfBodies(lit: LitLike, options: SdfBodiesOptions = {}): SdfBodies {
  const maxParts = Math.max(4, Math.min(MOST_PARTS, options.maxParts ?? 48));
  const maxBodies = Math.max(1, options.maxBodies ?? 48);
  const roles = 16;
  const blend = options.blend ?? 0.46;
  const width = Math.max(0, options.ink ?? 0.85);
  const ink: Ink = { width, pad: width > 0 ? Math.max(0, options.inkPad ?? 0.08) : 0 };
  const shader = fragment(maxParts, roles);
  const geometry = lit.box(1, 1, 1);
  const group = new lit.Group();
  const state: ShaderState = { roles: new Map(), crisp: new Set(options.crisp ?? DEFAULT_CRISP), emissive: new Set(options.emissive ?? DEFAULT_EMISSIVE) };
  const slots: Slot[] = [];
  const proxy = options.shadows === true ? shadowProxy(lit, maxBodies * maxParts * SHADOW_POOL) : null;
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
      if (proxy) castShadows(proxy, bodies.slice(0, maxBodies), maxBodies * maxParts * SHADOW_POOL);
    },
    dispose() {
      for (const slot of slots) slot.material.dispose();
      geometry.dispose();
      proxy?.geometry.dispose();
      proxy?.material.dispose();
    },
  };
}

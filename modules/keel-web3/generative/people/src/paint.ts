// The face's paint: marks, spots, stubble and shade baked into the head's vertices.

import { FAR, UP, clamp, mix, unit } from "./vec.js";
import type { Vec } from "./vec.js";
import { blend } from "./roll.js";
import type { Bone, Person } from "./person.js";
import { deepOf, glowOf } from "./palette.js";
import { restSkeleton } from "./skeleton.js";
import { headFrame } from "./head.js";
import type { HeadFrame } from "./head.js";
import { HEAD, boneIndex } from "./bones.js";
import type { Net } from "./field.js";
import { FABRICS } from "./fabric.js";
import { WRAPPED } from "./cloth.js";
import { SKULL, SKULL_AT, scalped, styleOf } from "./hair.js";

// ---------------------------------------------------------------- the face's paint

export const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A face's landmarks as built, in head radii from the head's centre: all that places a feature, a shadow or a line. */
export interface Marks { readonly eyeX: number; readonly pupil: number; readonly sn: number; readonly sto: number; readonly pog: number; readonly men: number; readonly jaw: number; readonly gon: number }

export function marksOf(p: Person): Marks {
  const b = p.face.bone, down = (y: number): number => y * b.L;
  return { eyeX: p.face.apart, pupil: b.pupil, sn: down(b.sub), sto: down(b.sto), pog: down(b.men + 0.16), men: down(b.men), jaw: down(b.gonY + 0.1), gon: b.gon * b.W };
}

/** How low the jaw's edge comes at `x`: at the corner out at the side, at the chin in the middle. */
const jawAt = (k: Marks, x: number): number => mix(k.men, k.jaw, clamp(x * x / (k.gon * k.gon), 0, 1));

/** One round of paint on a face, on both sides of it: where, how wide and tall, and what it does on fair skin and on deep. */
type Spot = readonly [x: number, y: number, rx: number, ry: number, fair: number, deep: number];

/** Where a face is lifted or shut down. No spot is finer than the mesh's own cell, which could only land as flecks. */
function spotsOf(p: Person, k: Marks, cr: number): readonly Spot[] {
  const b = p.face.bone, w = p.face.mouthWide, nose = mix(0.5, 1, b.m), ex = k.eyeX, wide = (v: number): number => Math.max(v, cr), lower = k.sto - 0.17 + (p.face.lips - 1) * 0.07;
  // (A small face has its shadows closer together, and over deep skin they would run into a beard.)
  const soft = mix(0.6, 1, b.m);
  return [
    [ex, k.pupil + 0.03, 0.34, 0.22, 0.05, 0.12],
    [ex * 1.15, k.pupil - 0.3, 0.26, 0.2, 0.08, 0.2],
    [ex, k.pupil + 0.17, 0.26, 0.1, 0.02, 0.1],
    [0, 0.62, 0.34, 0.2, 0.05, 0.24],
    [0, k.sn + 0.2, 0.08, 0.28, 0.05 * nose, 0.14 * nose],
    [0, k.sn + 0.12, 0.08, 0.07, 0.1 * nose, 0.3 * nose],
    [0, k.sn - 0.03, 0.2, wide(0.06), -0.26 * soft, -0.3 * soft],
    [0.075 * nose + 0.03, k.sn + 0.015, wide(0.04), wide(0.03), -0.3 * soft, -0.36 * soft],
    [0, k.sto, 0.86 * w, wide(0.028), -0.26, -0.34],
    [0, k.sto - 0.1, 0.8 * w, 0.1, 0.04 * b.m, 0.2 * b.m],
    [0, lower, 0.5 * w, wide(0.04), -0.1 * soft, -0.14 * soft],
    [w * 1.02, k.sto + 0.02, wide(0.045), wide(0.04), -0.14 * soft, -0.18 * soft],
    [w + 0.16, k.sto + 0.2, 0.24, 0.2, 0.02, 0.08],
    [0, k.pog, 0.2, 0.12, 0.05, 0.3],
    [0.56, k.sto + 0.08, 0.26, 0.3, -0.07 * b.lean, -0.12 * b.lean],
    ...(b.old ? agedSpots(k, w, cr, b.old) : []),
  ];
}

/** What years leave: under the eyes, across the brow, beside the mouth and along the jaw. */
const agedSpots = (k: Marks, w: number, cr: number, by: number): readonly Spot[] => [
  [k.eyeX, k.pupil - 0.17, 0.16, Math.max(0.04, cr), -0.1 * by, -0.16 * by],
  [0, 0.56, 0.36, Math.max(0.03, cr), -0.08 * by, -0.12 * by],
  [w + 0.1, k.sto + 0.1, Math.max(0.04, cr), 0.14, -0.14 * by, -0.2 * by],
  [w + 0.2, k.sto - 0.16, 0.08, 0.1, -0.1 * by, -0.14 * by],
];

/** What one vertex of a face has from every spot: lifts held to what skin can take, shadows not. */
function spotted(spots: readonly Spot[], x: number, y: number, deep: number): number {
  let lift = 1, dark = 1;
  for (const [cx, cy, rx, ry, fair, rich] of spots) {
    const a = (x - cx) / rx, b = (y - cy) / ry, d = a * a + b * b;
    if (d > 6) continue;
    const by = mix(fair, rich, deep) * Math.exp(-d);
    if (by > 0) lift *= 1 + by; else dark *= 1 + by;
  }
  return Math.min(lift, 1.7) * dark;
}

/** The planes of a face, from which way it looks: its front lifted, its sides and undersides let go. */
function planed(deep: number, [nx, ny, nz]: Vec, y: number, grown: number): number {
  const front = mix(1, mix(1.02, 1.42, deep), smooth(0.1, 1, nz));
  const side = 1 - mix(0.18, 0.2, deep) * smooth(0.4, 0.85, Math.abs(nx));
  const under = 1 - mix(0.16, 0.12, deep) * mix(0.6, 1, grown) * smooth(0.2, 0.75, -ny) * smooth(-0.1, -0.4, y);
  return front * side * under;
}

/** How low hair on a face comes up: over the lip, along the cheek and up to the ear. */
const beardLine = (k: Marks, ax: number): number => mix(k.sn - 0.04, -0.1, smooth(0.3, 0.66, ax));

/** How clear of a mouth a point is, 0 on it: `wide` how far round the lips the clearing goes. */
function clearOfMouth(k: Marks, w: number, ax: number, y: number, wide: number): number {
  return 1 - (1 - smooth(w * (0.72 + wide), w * (0.92 + wide), ax)) * smooth(k.sto - 0.12 - wide, k.sto - 0.08 - wide, y) * (1 - smooth(k.sto + 0.03 + wide * 0.5, k.sto + 0.06 + wide * 0.5, y));
}

/** A day's growth is a shadow on the skin and no colour of its own: a colour stops dead at a vertex, and on pale skin that shows as facets. */
function stubbleAt(p: Person, k: Marks, x: number, y: number, deep: number): number {
  if (p.face.hair !== "stubble") return 1;
  const ax = Math.abs(x), grain = (Math.sin(x * 211 + y * 97) + 1) * 0.15;
  return 1 - mix(0.12, 0.2, deep) * smooth(0, 0.09, beardLine(k, ax) - y) * clearOfMouth(k, p.face.mouthWide, ax, y, 0) * (0.7 + grain);
}

/** The neck under the jaw, and what lies behind the face: the head's own shadow, which a head and a neck cannot give each other being separate shells. */
function underJaw(p: Person, k: Marks, x: number, y: number, deep: number): number {
  const shut = mix(0.56, 0.5, deep), fade = 0.42 * mix(0.55, 1, p.face.bone.m);
  return mix(shut, 1, smooth(0, fade, jawAt(k, x) - y)) * mix(1, 1.3, deep);
}

/** Hair throws a little shadow on the skin below its line, and that is what seats it on the head. */
function underHair(q: Vec, b: Bone): number {
  const e: Vec = [q[0] / (b.W * 0.84) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], u = unit(e, UP);
  const near = (by: number): number => (scalped(unit([u[0], u[1] + by, u[2]], UP)) ? 1 : 0);
  return 1 - 0.1 * (near(0.02) + near(0.07) + near(0.12));
}

/** All one person's bake needs, worked out once. `rise` lifts the very deepest skins, which `deep` has stopped telling apart, or a face goes to black. */
interface Bake { readonly p: Person; readonly k: Marks; readonly spots: readonly Spot[]; readonly deep: number; readonly haired: boolean; readonly rise: number; readonly toHead: (at: Vec) => Vec }

export const vecAt = (list: readonly number[], v: number): Vec => [list[v * 3] ?? 0, list[v * 3 + 1] ?? 0, list[v * 3 + 2] ?? 0];

/** One vertex of the face proper. */
function bakeFace(net: Net, bake: Bake, v: number, q: Vec, was: number): number {
  const { p, k, deep } = bake, [x, y] = q;
  // (A fold of the melted skull is no crease of a face: most of what `creases` found there goes, or a cheek bruises.)
  const open = mix(1, was, 0.15);
  const marked = (bake.haired ? underHair(q, p.face.bone) : 1) * bake.rise;
  return open * marked * stubbleAt(p, k, x, y, deep) * spotted(bake.spots, Math.abs(x), y, deep) * planed(deep, vecAt(net.normal, v), y, p.face.bone.m);
}

/** A vertex of the skin of the head or the neck. */
function bakeVertex(net: Net, bake: Bake, v: number, bone: number, was: number): number {
  const q = bake.toHead(vecAt(net.position, v)), [x, y, z] = q;
  if (y > 1.4 || y < -2.4 || Math.abs(x) > 1.4) return was;
  if (bone !== HEAD) return was * underJaw(bake.p, bake.k, x, y, bake.deep);
  const back = was * mix(1, 1.2, bake.deep);
  return z < -0.4 ? back : mix(back, bakeFace(net, bake, v, q, was), smooth(-0.4, 0.1, z));
}

const FACE_BONES: ReadonlySet<number> = new Set([HEAD, boneIndex("neck"), boneIndex("chest")]);

/** A face's light, baked into `shade`, where the renderer multiplies it: planes, a shadow under each thing that overhangs, a lift on each that stands proud. Over a deep skin a multiply barely shows, so there it works hardest; and hair on the face goes on here too. `skip` is the vertices at the end that have their shade already. */
export function faceBake(net: Net, shade: Float32Array, p: Person, roles: readonly string[], cell: number, skip: number): void {
  if (p.outfit.costume === "fursuit") return;
  const size = p.build.size, h = headFrame(restSkeleton(p), p.build.head, p.face), r = h.r * size, skin = roles.indexOf("skin"), k = marksOf(p);
  const toHead = (at: Vec): Vec => [(at[0] / size - h.c[0]) / h.r, (at[1] / size - h.c[1]) / h.r, (at[2] / size - h.c[2]) / h.r];
  const bake: Bake = { p, k, spots: spotsOf(p, k, (cell * 0.5) / r), deep: deepOf(p.palette.skin ?? "#888888"), haired: styleOf(p) !== "bald", rise: 1 + 0.45 * clamp((0.075 - glowOf(p.palette.skin ?? "#888888")) / 0.04, 0, 1), toHead };
  for (let v = 0; v < shade.length - skip; v += 1) {
    const bone = net.bones[v * 2] ?? 0;
    if (net.fabric[v] === FABRICS.skin && net.role[v] === skin && FACE_BONES.has(bone)) shade[v] = bakeVertex(net, bake, v, bone, bone === HEAD && cell < WRAPPED ? 1 : shade[v] ?? 1);
  }
}

/** An iris as it is painted: well under its own colour, for a small face has room for one thing in an eye and that is its dark. */
const inkedIris = (iris: string): string => blend(iris, "#0c0806", 0.42);

/** What the renderer paints a face with, over the bake: the shader dims a white under its lid, so it is given as white as it can be; and a line along the lashes that holds on any skin. */
export function faceInks(p: Person): { readonly brow: string; readonly lash: string; readonly white: string; readonly iris: string } {
  const skin = p.palette.skin ?? "#888888", brow = p.palette.brow ?? "#3a2a22", deep = deepOf(skin);
  return { brow: blend(brow, "#140c08", 0.5), lash: deep > 0.3 ? "#070403" : "#160c09", white: blend("#fffdf8", "#c6b8aa", deep), iris: inkedIris(p.face.iris) };
}

/** How far forward the skin of a face lies at any `x`, `y`, from its own vertices, a cell or so at a time. */
export function surfaceOf(net: Net, h: HeadFrame, size: number, step: number): (x: number, y: number) => number {
  const bins = new Map<number, number>(), key = (x: number, y: number): number => Math.round(x / step) * 4096 + Math.round(y / step);
  const toHead = (v: number): Vec => { const [x, y, z] = vecAt(net.position, v); return [(x / size - h.c[0]) / h.r, (y / size - h.c[1]) / h.r, (z / size - h.c[2]) / h.r]; };
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (net.fabric[v] !== FABRICS.skin || net.bones[v * 2] !== HEAD) continue;
    const [x, y, z] = toHead(v);
    if (z > 0.2) bins.set(key(x, y), Math.max(z, bins.get(key(x, y)) ?? -FAR));
  }
  const reach = [0, -step, step, -2 * step, 2 * step];
  const near = (x: number, y: number): number => Math.max(...reach.flatMap((dx) => reach.map((dy) => bins.get(key(x + dx, y + dy)) ?? -FAR)));
  return (x, y) => bins.get(key(x, y)) ?? near(x, y);
}

/** How wide a brow's hairs lie at its thickest. */
function browHalf(p: Person): number {
  const b = p.face.bone, male = p.build.sex === "male" ? 1 : 0;
  return mix(0.032, mix(0.034, 0.048, male) * (0.75 + p.face.brow * 0.3), b.m) * b.browK * (1 - b.old * 0.2);
}

/** A brow's line for the renderer, in eyes: its height over the pupil, its arch, its tilt and how wide it lies. */
export function browLineOf(p: Person): readonly [number, number, number, number] {
  const { eye: e, bone: b, browTilt } = p.face;
  return [1.3 + (0.13 + b.browUp) / e, b.arch / e, (browTilt * 0.9) / e, browHalf(p) / e];
}

/** A line of depths with its gaps filled and its steps eased, never let down into what it lies on. */
export function evened(zs: readonly number[]): readonly number[] {
  const seen = zs.filter((z) => z > -FAR / 2), low = Math.min(...seen, 0.3), held = zs.map((z) => (z > -FAR / 2 ? z : low));
  const eased = (list: readonly number[]): readonly number[] => list.map((z, i) => Math.max(z, ((list[i - 1] ?? z) + 2 * z + (list[i + 1] ?? z)) / 4));
  return eased(eased(held));
}

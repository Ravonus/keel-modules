// Bones: the skinning skeleton, cloth that arrives late, which bone each part hangs on, and a pose as bone matrices.

import { FRONT, UP, add, cross, dot, lerpV, scale, sub, unit, clamp } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "./person.js";
import { restSkeleton } from "../motion/skeleton.js";
import type { Skeleton } from "../motion/skeleton.js";
import { handFrame, swungFrame } from "../mesh/parts.js";
import type { Line } from "../mesh/parts.js";

// ---------------------------------------------------------------- the skinned mesh

/** Every bone, in the order a pose's matrices come: its joint, the way it runs, and what of a skeleton gives them. */
/**
 * How much of a forward swing the back of a skirt takes: drawn under the thighs of someone sitting, not left hanging
 * behind them.
 */
const BACK_DRAWN = 0.5;
/**
 * How much of the thigh's length a panel is: what lies on a lap from a hinge ahead of the hips reaches the knee and no
 * further.
 */
const PANEL_LONG = 0.72;
/** How softly the lead goes from one knee to the other, metres. */
const PASSING = 0.03;
/**
 * Where a panel hinges, in front of or behind the hips by their width, the front over the top of the thighs: on the
 * surface, so what turns lies on the lap and not under it.
 */
const HINGE_OUT = 0.6;
const HINGE_UP = 0.11;
/** How far the front of a skirt is shoved ahead of a leg coming forward, of how far the knee has come. */
const PUSHED = 0.4;
const PUSHED_MOST = 0.05;

/**
 * How far the leg leading a panel has come. The further of the two knees, without the corner where they pass each
 * other: cloth has no way to reverse in an instant.
 */
function ledOf({ left, right }: Skeleton, side: 1 | -1): number {
  const [a, b] = [left, right].map(({ leg }) => sub(leg.knee, leg.hip)[2]) as [number, number];
  return (a + b) / 2 + side * (Math.hypot((a - b) / 2, PASSING) - PASSING);
}

/**
 * A panel of a skirt, from between the hips to level with the knees: the front is pushed by whichever leg leads, the
 * back by whichever trails, so neither leg ever comes through it.
 */
/** How far a panel is pushed by the leg that leads it; the back panel is drawn a little after the one that trails. */
function pushedBy(led: number, side: 1 | -1): number {
  if (led * side > 0) return led;
  return side > 0 ? 0 : Math.max(0, led) * BACK_DRAWN;
}

function panelOf(s: Skeleton, side: 1 | -1): readonly [Vec, Vec] {
  const { left, right } = s;
  const from = lerpV(left.leg.hip, right.leg.hip, 0.5);
  const led = ledOf(s, side);
  const z = pushedBy(led, side) * PANEL_LONG;
  const span = Math.hypot(...sub(left.leg.knee, left.leg.hip)) * PANEL_LONG;
  const down = Math.sqrt(Math.max(0, span * span - z * z));
  const hinge = add(from, [
    0,
    side > 0 ? HINGE_UP : 0,
    side * Math.abs(left.leg.hip[0] - right.leg.hip[0]) * HINGE_OUT +
      (side > 0 ? Math.min(z * PUSHED, PUSHED_MOST) : 0),
  ]);
  return [hinge, add(hinge, [0, -down, z])];
}

/**
 * Below the knees cloth has nothing under it, and falls straight down: but what is drawn under someone sitting lies on
 * along the seat, the further the more it is drawn.
 */
export function hangOf(s: Skeleton, side: 1 | -1): readonly [Vec, Vec] {
  const [start, end] = panelOf(s, side);
  const [, drop, on] = sub(end, start);
  const lies = side < 0 ? clamp(on / Math.max(1e-3, Math.hypot(drop, on)) / LIES_BY, 0, 1) : 0;
  return [end, add(end, [0, -0.3 * Math.cos(lies * LIES_MOST), 0.3 * Math.sin(lies * LIES_MOST)])];
}

/** How forward a back panel is, as a slope, when what hangs from it lies flat out, and how far round that takes it. */
const LIES_BY = 0.6;
const LIES_MOST = 1.3;

const BONES: readonly (readonly [string, (s: Skeleton) => readonly [Vec, Vec]])[] = [
  ["pelvis", (s) => [s.pelvis, s.waist]],
  ["spine", (s) => [s.waist, s.chest]],
  ["chest", (s) => [s.chest, s.neck]],
  ["neck", (s) => [s.neck, s.head]],
  ["head", (s) => [s.head, add(s.head, sub(s.head, s.neck))]],
  ...(["left", "right"] as const).flatMap((side) => {
    const L = side === "left" ? "L" : "R";
    return [
      [`upper.${L}`, (s: Skeleton) => [s[side].arm.shoulder, s[side].arm.elbow]],
      [`fore.${L}`, (s: Skeleton) => [s[side].arm.elbow, s[side].arm.wrist]],
      [`hand.${L}`, (s: Skeleton) => [s[side].arm.wrist, s[side].arm.hand]],
      [`thigh.${L}`, (s: Skeleton) => [s[side].leg.hip, s[side].leg.knee]],
      [`shin.${L}`, (s: Skeleton) => [s[side].leg.knee, s[side].leg.ankle]],
      [`foot.${L}`, (s: Skeleton) => [s[side].leg.ankle, s[side].leg.toe]],
    ] as readonly (readonly [string, (s: Skeleton) => readonly [Vec, Vec]])[];
  }),
  // (Last, so the bones before keep their numbers. A hand's fingers on their own bone, so it can open and shut.)
  ["fingers.L", (s) => [s.left.arm.hand, s.left.arm.tip]],
  ["fingers.R", (s) => [s.right.arm.hand, s.right.arm.tip]],
  ["tips.L", (s) => [s.left.arm.tip, s.left.arm.nail]],
  ["tips.R", (s) => [s.right.arm.tip, s.right.arm.nail]],
  ["toes.L", (s) => [s.left.leg.toe, s.left.leg.end]],
  ["toes.R", (s) => [s.right.leg.toe, s.right.leg.end]],
  ["thumb.L", (s) => [s.left.arm.wrist, s.left.arm.thumb]],
  ["thumb.R", (s) => [s.right.arm.wrist, s.right.arm.thumb]],
  // (Cloth has no bones of its own in a body: these are the legs as a skirt feels them.)
  ["skirt.front", (s) => panelOf(s, 1)],
  ["skirt.back", (s) => panelOf(s, -1)],
  ["hang.front", (s) => hangOf(s, 1)],
  ["hang.back", (s) => hangOf(s, -1)],
];

export const BONE_COUNT = BONES.length;

export const boneIndex = (name: string): number => BONES.findIndex(([bone]) => bone === name);

/** Where a body was a moment ago: what its cloth is still answering to. */
interface Late { readonly panel: Skeleton; readonly hang: Skeleton }
/** How far behind the legs cloth is, seconds: it arrives after them, the hem after the rest. */
export const PANEL_LATE = 0.06;
export const HANG_LATE = 0.14;
const CLOTH_LATE: ReadonlyMap<number, readonly ["panel" | "hang", 1 | -1]> = new Map([["skirt.front", "panel", 1], ["skirt.back", "panel", -1], ["hang.front", "hang", 1], ["hang.back", "hang", -1]].map(([bone, when, side]) => [boneIndex(bone as string), [when, side] as ["panel" | "hang", 1 | -1]]));
/** What a piece of cloth answers to: a leg shoves it at once, but what the leg has left comes after it late. */
function clothTime(bone: number, now: Skeleton, late?: Late): Skeleton {
  const piece = CLOTH_LATE.get(bone);
  if (!late || !piece) return now;
  const [when, side] = piece;
  const then = late[when];
  return ledOf(then, side) * side > ledOf(now, side) * side ? then : now;
}

/** The forearms, which take half a hand's roll. */
const FOREARMS: ReadonlyMap<number, "left" | "right"> = new Map([[boneIndex("fore.L"), "left"], [boneIndex("fore.R"), "right"]]);

/** The bones of a hand, and whose knuckles they turn with. */
const HAND_BONES: ReadonlyMap<number, "left" | "right"> = new Map((["left", "right"] as const).flatMap((side) => ["hand", "fingers", "tips", "thumb"].map((bone) => [boneIndex(`${bone}.${side === "left" ? "L" : "R"}`), side] as const)));

const PART_BONES: readonly (readonly [RegExp, (side: string) => string])[] = [
  [/^arm\.([LR])/, (L) => `upper.${L}`],
  [/^fore\.([LR])/, (L) => `fore.${L}`],
  [/^tips\.([LR])/, (L) => `tips.${L}`],
  [/^fingers\.([LR])/, (L) => `fingers.${L}`],
  [/^thumb\.([LR])/, (L) => `thumb.${L}`],
  [/^palm\.([LR])/, (L) => `hand.${L}`],
  [/^thigh\.([LR])/, (L) => `thigh.${L}`],
  [/^shin\.([LR])/, (L) => `shin.${L}`],
  [/^boot\.([LR])/, (L) => `shin.${L}`],
  [/^(?:shoe|toe|sole)\.([LR])/, (L) => `foot.${L}`],
  [/^(hips|skirt|brush)/, () => "pelvis"],
  [/^belly/, () => "spine"],
  [/^(ribs|bust|yoke|hood|collar)/, () => "chest"],
  [/^neck/, () => "neck"],
];

/** The bone a drawn part hangs from; whatever is on the head, by default. */
export function boneOfPart(part: string): number {
  for (const [match, name] of PART_BONES) {
    const hit = match.exec(part);
    if (hit) return boneIndex(name(hit[1] ?? ""));
  }
  return boneIndex("head");
}

export const HEAD = boneIndex("head");
const ARM_BONES = new Set(BONES.flatMap(([name], i) => (/^(upper|fore|hand|fingers|tips|thumb)\./.test(name) ? [i] : [])));
export const PELVIS = boneIndex("pelvis");


/** The frame of a bone running from `a` to `b`, as columns: across, along, forward. */
function boneFrame(a: Vec, b: Vec, turn = 0): readonly [Vec, Vec, Vec] {
  const along = unit(sub(b, a), UP);
  const forward = unit(cross([Math.cos(turn), 0, -Math.sin(turn)], along), FRONT);
  return [cross(along, forward), along, forward];
}

/** Each bone's matrix in a pose, three rows of four: rest space to posed space, in order of `BONES`. */
/** How much of the shoulders' turn each of the first bones takes: the hips going the other way. */
const TURNS: readonly number[] = [-0.6, 0.5, 1];

/** How far round a forearm takes the roll of its hand: half, the rest in the wrist, so neither is wrung. */
function halfRolled(swing: readonly [Vec, Vec, Vec], hand: readonly [Vec, Vec, Vec]): readonly [Vec, Vec, Vec] {
  const [x, along, z] = swing;
  const a = Math.atan2(dot(cross(x, hand[0]), along), dot(x, hand[0])) / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [add(scale(x, c), scale(z, -s)), along, add(scale(x, s), scale(z, c))];
}


type Frame = readonly [Vec, Vec, Vec];

/** A bone's frame at rest: a hand's or a forearm's set by its knuckles, any other's by its own line. */
function restFrame(i: number, rest: Skeleton, [ra, rb]: Line): Frame {
  const hand = HAND_BONES.get(i);
  if (hand) return handFrame(ra, rb, rest[hand].arm.knuckles);
  const arm = FOREARMS.get(i);
  if (arm) return handFrame(ra, rb, rest[arm].arm.knuckles);
  return boneFrame(ra, rb);
}

/**
 * A bone's frame as posed, from its rest frame `r` and its line then and now: a forearm half rolled with its hand, a
 * hand set by its knuckles, the rest of an arm swung, and anything else turned about its own line.
 */
function posedFrame(i: number, now: Skeleton, r: Frame, [[ra, rb], [na, nb]]: readonly [Line, Line]): Frame {
  const arm = FOREARMS.get(i);
  if (arm) return halfRolled(swungFrame(r, [ra, rb], [na, nb]), handFrame(na, nb, now[arm].arm.knuckles));
  const hand = HAND_BONES.get(i);
  if (hand) return handFrame(na, nb, now[hand].arm.knuckles);
  if (ARM_BONES.has(i)) return swungFrame(r, [ra, rb], [na, nb]);
  return boneFrame(na, nb, i === HEAD ? now.turn : now.spin * (TURNS[i] ?? 0));
}

export function bonesOf(p: Person, now: Skeleton, late?: Late): Float32Array {
  const rest = restSkeleton(p);
  const k = p.build.size;
  const out = new Float32Array(BONES.length * 12);
  BONES.forEach(([, joints], i) => {
    const [ra, rb] = joints(rest);
    const [na, nb] = joints(clothTime(i, now, late));
    const r = restFrame(i, rest, [ra, rb]);
    const m = posedFrame(i, now, r, [[ra, rb], [na, nb]]);
    for (let row = 0; row < 3; row += 1) {
      const line: Vec = [0, 1, 2].map((c) =>
        r.reduce((sum, axis, j) => sum + (m[j]?.[row] ?? 0) * (axis[c] ?? 0), 0),
      ) as unknown as Vec;
      out.set(line, i * 12 + row * 4);
      out[i * 12 + row * 4 + 3] = (na[row] ?? 0) * k - (line[0] * ra[0] + line[1] * ra[1] + line[2] * ra[2]) * k;
    }
  });
  return out;
}

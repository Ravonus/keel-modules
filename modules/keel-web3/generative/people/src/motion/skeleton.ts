// The skeleton: each action as a pose and the swing of each limb through its beat, then the joints placed from it,
// feet planted and limbs kept clear of the trunk and each other.

import { FAR, FRONT, SIDE, TAU, UP, add, clamp, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import { TALL, limbWide } from "../body/build.js";
import { LONG_TOP } from "../clothes/outfit.js";
import { neckBy } from "../mesh/parts.js";
import { SPOKES } from "../body/cage.js";
import { SLEEVE_RINGS, topLift } from "../clothes/cloth.js";
import { hemOf } from "../clothes/skirt.js";
import { MOTIONS, STILL, sideIndex } from "./motions.js";
import type { Pose, Swing } from "./motions.js";

// ---------------------------------------------------------------- the skeleton

export type Action = "rest" | "seated" | "stand" | "idle" | "walk" | "power" | "jog" | "run" | "sprint" | "jump" | "sit" | "crouch" | "wave" | "clap" | "laugh" | "cheer" | "dance" | "shrug" | "bow" | "nod" | "fold" | "hips" | "think" | "talk" | "stretch";
export const ACTIONS: readonly Action[] = ["stand", "idle", "walk", "power", "jog", "run", "sprint", "jump", "sit", "crouch", "wave", "clap", "laugh", "cheer", "dance", "shrug", "bow", "nod", "fold", "hips", "think", "talk", "stretch"];

export interface Leg {
  readonly hip: Vec;
  readonly knee: Vec;
  readonly ankle: Vec;
  readonly toe: Vec;
  /** The toes' ends: they stay flat on the ground as the heel comes up. */ readonly end: Vec;
}
export interface Arm {
  /** Where the thumb ends: in over the palm as the hand shuts. */ readonly thumb: Vec;
  readonly shoulder: Vec;
  readonly elbow: Vec;
  readonly wrist: Vec;
  readonly hand: Vec;
  /** Where the fingers end: bent in toward the palm as far as the hand is closed. */ readonly tip: Vec;
  /** Which way the palm is turned to face. */ readonly faces: Vec;
  /** How far the wrist is bent toward the palm. */ readonly flex: number;
  /** The line across the knuckles. */ readonly knuckles: Vec;
  /** And where their last joints end. */ readonly nail: Vec;
}

/** Where the bones are, on the frame of a person facing +z: everything drawn hangs on this. */
export interface Skeleton {
  /** How far the shoulders have turned against the hips. */
  readonly spin: number;
  /** How far the head has turned from straight ahead, radians. */
  readonly turn: number;
  readonly pelvis: Vec;
  readonly waist: Vec;
  readonly chest: Vec;
  readonly neck: Vec;
  readonly head: Vec;
  readonly left: { readonly leg: Leg; readonly arm: Arm };
  readonly right: { readonly leg: Leg; readonly arm: Arm };
}

/** A limb's direction, swung `a` radians forward of hanging straight down. */
const pitched = (a: number): Vec => [0, -Math.cos(a), Math.sin(a)];

function legOf(p: Person, hip: Vec, swing: Swing, side = 0): Leg {
  const length = TALL * p.build.legs * 0.5;
  const out = (a: number): Vec => unit(add(pitched(a), [side * (swing.splay ?? 0), 0, 0]));
  const knee = madd(hip, out(swing.thigh), length);
  const ankle = madd(knee, out(swing.thigh - swing.knee), length * 0.96);
  // (The foot stays near level, tipping only as the leg swings through.)
  const toe = madd(
    add(ankle, [0, -0.02, 0]),
    unit([side * (swing.turned ?? 0), -0.12 + clamp(swing.thigh - swing.knee, -1, 1) * 1.1 + (swing.pitch ?? 0), 1]),
    TALL * 0.08 * p.build.foot,
  );
  return { hip, knee, ankle, toe, end: madd(toe, unit(sub(toe, ankle)), 0.05) };
}

/** A foot that would go through the ground stays on it, the knee taking up the slack. */
function planted(p: Person, leg: Leg): Leg {
  if (leg.ankle[1] >= SOLE + 0.019) return leg;
  const length = TALL * p.build.legs * 0.5;
  const ankle: Vec = [leg.ankle[0], SOLE + 0.02, leg.ankle[2]];
  const reach = Math.min(sub(ankle, leg.hip).reduce((n, v) => n + v * v, 0) ** 0.5, length * 1.95);
  const along = unit(sub(ankle, leg.hip));
  const up = (reach * reach + length * length - (length * 0.96) ** 2) / (2 * reach);
  const bend = Math.sqrt(Math.max(0, length * length - up * up));
  const knee = madd(madd(leg.hip, along, up), unit([0, along[2], -along[1]]), bend);
  return { ...leg, knee, ankle, toe: add(leg.toe, [0, ankle[1] - leg.ankle[1], 0]) };
}

/** An elbow and wrist that put the wrist at `to`, the elbow falling out and back as elbows do. */
function reached(
  shoulder: Vec,
  to: Vec,
  side: number,
  [upper, fore]: readonly [number, number],
): { readonly elbow: Vec; readonly wrist: Vec } {
  const way = sub(to, shoulder);
  const along = unit(way, FRONT);
  const far = clamp(Math.hypot(...way), Math.abs(upper - fore) + 0.02, (upper + fore) * 0.985);
  const a = (far * far + upper * upper - fore * fore) / (2 * far);
  const rise = Math.sqrt(Math.max(0, upper * upper - a * a));
  const pole: Vec = [side * 0.7, -0.6, -0.4];
  const off = unit(sub(pole, scale(along, dot(pole, along))), scale(UP, -1));
  return { elbow: madd(madd(shoulder, along, a), off, rise), wrist: madd(shoulder, along, far) };
}

/** Where an arm hangs from, and the chest its reach is measured from. */
interface ArmRoot {
  readonly shoulder: Vec;
  readonly chest: Vec;
}

function armOf(p: Person, swing: Swing, side: number, { shoulder, chest }: ArmRoot): Arm {
  const length = TALL * 0.186;
  const forearm = length * 0.8;
  const clear =
    swing.out +
    Math.max(0, p.build.girth - 1) * 0.28 +
    (LONG_TOP[p.outfit.top] === undefined ? 0 : 0.1 + p.outfit.fit * 0.08);
  const down = (a: number, out: number): Vec => unit(add(pitched(a), [side * out, 0, 0]));
  const elbow = madd(shoulder, down(swing.upper, clear), length);
  // (A bent forearm comes back in across the body; it does not stick out where the upper arm is going.)
  const free = {
    elbow,
    wrist: madd(
      elbow,
      down(swing.upper + swing.fore, clear * (1 - 1.5 * clamp(swing.fore / 1.5, 0, 1)) - (swing.across ?? 0)),
      forearm,
    ),
  };
  // (A hand reaching round a big body has further to go.)
  const big = Math.max(0, p.build.girth - 1);
  const joints = swing.reach
    ? reached(
        shoulder,
        add(chest, [
          side * (swing.reach[0] + (swing.reach[1] < 0.1 ? big * 0.1 : 0)),
          swing.reach[1],
          swing.reach[2] + (swing.reach[1] < 0.1 ? big * 0.2 : 0),
        ]),
        side,
        [length, forearm],
      )
    : free;
  return handed(
    { shoulder, ...joints, faces: swing.palm ?? [-side, -0.3, 0], flex: swing.flex ?? 0 },
    side,
    swing.curl ?? 0,
  );
}

/** How long the hand's own bone is, wrist to knuckles. */
const PALM = TALL * 0.058;

/** A hand on the end of a forearm, bent at the wrist as far as it is. */
function handed(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb" | "hand">, side: number, curl: number): Arm {
  const along = unit(sub(arm.wrist, arm.elbow));
  const palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  return tipped(
    { ...arm, hand: madd(arm.wrist, add(scale(along, Math.cos(arm.flex)), scale(palm, Math.sin(arm.flex))), PALM) },
    side,
    curl,
  );
}

/**
 * A hand's fingers, bent `curl` from its line in toward its palm, which turns to face the body wherever the arm goes:
 * thumb up on a forearm held out, as a forearm really rolls.
 */
function tipped(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb">, side: number, curl: number): Arm {
  const along = unit(sub(arm.hand, arm.wrist));
  const palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  const bent = (a: number): Vec => add(scale(along, Math.cos(a)), scale(palm, Math.sin(a)));
  const tip = madd(arm.hand, bent(curl), 0.046);
  const knuckles = cross(along, palm);
  const shut = clamp(curl / 1.2, 0, 1);
  const thumb = madd(
    madd(madd(arm.wrist, along, 0.06 + 0.03 * shut), knuckles, -side * 0.042 * (1 - 1.4 * shut)),
    palm,
    0.036 * shut,
  );
  return { ...arm, tip, nail: madd(tip, bent(curl * 2), 0.04), knuckles, thumb };
}

/** How far under the pelvis the hip joints sit. */
export const HIP_DROP = 0.04;

/** How high the sole stands under the lowest point of a foot's bones. */
const SOLE = 0.083;

/** How high the hips sit to put the lower foot, whatever its angle, on the ground. */
export function feetDown(p: Person, a: Swing, b: Swing): number {
  const lowest = (s: Swing): number => {
    const { ankle, toe } = legOf(p, [0, 0, 0], s);
    return Math.min(ankle[1] - 0.02, toe[1] - Math.max(0, ankle[1] - toe[1] - 0.05) * 0.5);
  };
  return SOLE + HIP_DROP - Math.min(lowest(a), lowest(b));
}

export const standHips = (p: Person): number => feetDown(p, STILL, STILL);

/** Legs stand apart as far as thick thighs need, so they meet and no more. */
function stance(p: Person, swing: Swing): Swing {
  const crowded = 0.09 * limbWide(p.build) - p.build.hip * 0.6;
  return { ...swing, splay: Math.max(swing.splay ?? 0, clamp(crowded / 0.42, 0, 0.22)) };
}

/** The arm that holds an umbrella up, whatever the rest of them does. */
const HOLDING = { upper: 0.36, fore: 1.62, out: 0.16, curl: 0, flex: 0, across: 0, reach: undefined, palm: undefined };

/** The bones of a pose. */
function skeletonFrom(p: Person, pose: Pose, loose: boolean): Skeleton {
  const { shoulder, hip, stoop } = p.build;
  const leftSwing = stance(p, pose.left);
  const body = {
    lean: 0,
    curve: 0,
    side: 0,
    twist: 0,
    shift: 0,
    drop: 0,
    nod: 0,
    tilt: 0,
    turn: 0,
    breath: 0,
    wide: 0.6,
    shrug: [0, 0] as const,
    ...pose.body,
  };
  const rightSwing = stance(p, p.outfit.carry === "umbrella" && !loose ? { ...pose.right, ...HOLDING } : pose.right);
  const pelvis: Vec = [body.shift, body.hips, 0];
  const { breath, drop, curve, twist } = body;
  // (What the height leaves between the standing hips and the crown.)
  const trunk = TALL - standHips(p) - p.build.head * (p.face.bone.rise + 1.28);
  const bent = (more: number): Vec => unit([body.side, 1, stoop + body.lean + more]);
  const low = madd(pelvis, bent(0), trunk * 0.22);
  // (The waist leans the way the pelvis tips, so the pelvis itself drops over the swinging leg.)
  const waist = add(low, [-drop * trunk * 0.22 / hip, 0, 0]);
  const chest = madd(low, bent(curve * 0.5), trunk * 0.36 + breath);
  const top = bent(curve);
  const neck = madd(chest, top, trunk * 0.42);
  const head = madd(neck, unit([body.tilt, 1, stoop * 2 + body.nod]), p.build.head * p.face.bone.rise);
  const sideOf = (side: number, s: Swing): { leg: Leg; arm: Arm } => ({
    leg: planted(
      p,
      legOf(p, add(pelvis, [side * hip * body.wide, -HIP_DROP + side * drop, -side * twist * 0.6]), s, side),
    ),
    arm: armOf(p, s, side, {
      shoulder: add(madd(neck, top, -trunk * 0.13), [side * shoulder, body.shrug[sideIndex(side)], side * twist]),
      chest,
    }),
  });
  const posed: Skeleton = {
    turn: body.turn,
    spin: Math.asin(clamp(twist / shoulder, -1, 1)),
    pelvis,
    waist,
    chest,
    neck,
    head,
    left: sideOf(-1, leftSwing),
    right: sideOf(1, rightSwing),
  };
  return loose ? posed : untangled(p, posed, leftSwing.curl ?? 0, rightSwing.curl ?? 0);
}

/** A person's bones in an action: `phase` is how far along its beat, radians. */
export const skeletonOf = (p: Person, action: Action, phase: number): Skeleton => skeletonFrom(p, MOTIONS[action].at(p, phase), action === "rest");

/**
 * Two sets of bones `k` of the way from one to the other, however the two got there: what makes any motion fade into
 * any other.
 */
export function blended<T>(a: T, b: T, k: number): T {
  if (typeof a === "number" && typeof b === "number") return mix(a, b, k) as T;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v: unknown, i) => blended(v, b[i] as unknown, k)) as T;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) return Object.fromEntries(Object.entries(a).map(([key, v]) => [key, blended(v as unknown, (b as Record<string, unknown>)[key], k)])) as T;
  return a;
}

/** How thick the limbs that can meet are, and how wide what they meet is at a height, as it is worn. */
interface Solid {
  readonly arm: number;
  readonly thigh: number;
  readonly at: (y: number) => { readonly wide: number; readonly front: number; readonly back: number } | undefined;
}

const solids = new WeakMap<Person, Solid>();

/**
 * A person's solid shape, standing: the same stations their surface is lofted through, and what they have on over it.
 */
function solidOf(p: Person): Solid {
  const known = solids.get(p);
  if (known) return known;
  const rest = restSkeleton(p);
  const rings = torsoStations(p, rest);
  const { top, bottom, fit } = p.outfit;
  const k = limbWide(p.build);
  const sleeved = SLEEVE_RINGS[top] > 2 ? topLift(top, fit) : 0;
  const hung = LONG_TOP[top] !== undefined || bottom === "skirt";
  const hem = hung ? hemOf(p) : FAR;
  const tube = hung ? 1.22 + fit * 0.14 : 1;
  const fall = rings[1];
  const ring = (y: number): Station | undefined => [...rings].reverse().find((r) => r.at[1] <= y);
  const solid: Solid = {
    arm: 0.04 * k + sleeved,
    thigh: 0.09 * k,
    at: (y) => {
      const lower = hung && y < rest.pelvis[1] && y >= hem - 0.1;
      const a = lower ? fall : ring(y);
      const b = lower ? fall : rings[(a ? rings.indexOf(a) : 0) + 1];
      if (!a || !b || y > rest.left.arm.shoulder[1] - 0.05) return undefined;
      const t = clamp((y - a.at[1]) / Math.max(0.001, b.at[1] - a.at[1]), 0, 1);
      const lift = topLift(top, fit);
      const wrap = lower ? tube : 1;
      return {
        wide: mix(a.wide, b.wide, t) * wrap + lift,
        front: (mix(a.front, b.front, t) + (a.bust ?? 0) * 0.6) * wrap + lift,
        back: (mix(a.back, b.back, t) + (a.rear ?? 0)) * wrap + lift,
      };
    },
  };
  solids.set(p, solid);
  return solid;
}

/** A point out of the trunk, to its surface, the way it is nearest. */
function outOfTrunk(p: Person, s: Skeleton, at: Vec): Vec {
  const solid = solidOf(p);
  const rest = restSkeleton(p);
  const rise = s.pelvis[1] - rest.pelvis[1];
  const ring = solid.at(at[1] - rise);
  if (!ring) return at;
  const k = clamp((at[1] - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]), 0, 1);
  const middle = mix(s.pelvis[2], s.neck[2], k);
  const z = at[2] - middle;
  const wide = ring.wide + solid.arm;
  const deep = (z > 0 ? ring.front : ring.back) + solid.arm;
  const q = Math.hypot(at[0] / wide, z / deep);
  if (q >= 1) return at;
  if (q < 1e-3) return [wide, at[1], at[2]];
  return [at[0] / q, at[1], middle + z / q];
}

/** A point off a limb running from `a` to `b`, a capsule `r` round it. */
function offLimb(at: Vec, a: Vec, b: Vec, r: number): Vec {
  const d = sub(b, a);
  const t = clamp(dot(sub(at, a), d) / Math.max(1e-6, dot(d, d)), 0, 1);
  const near = madd(a, d, t);
  const off = sub(at, near);
  const l = Math.hypot(...off);
  return l >= r ? at : madd(near, unit(off, SIDE), r);
}

/** An arm kept out of the body, bone by bone, each keeping its length: `hand` is its side and how far it is closed. */
function armClear(p: Person, s: Skeleton, arm: Arm, [side, curl]: readonly [number, number]): Arm {
  const { thigh, arm: r } = solidOf(p);
  const off = (at: Vec): Vec =>
    [s.left.leg, s.right.leg].reduce((n, leg) => offLimb(n, leg.hip, leg.knee, thigh + r), outOfTrunk(p, s, at));
  const held = (from: Vec, to: Vec, length: number): Vec => madd(from, unit(sub(off(to), from)), length);
  const upper = Math.hypot(...sub(arm.elbow, arm.shoulder));
  const fore = Math.hypot(...sub(arm.wrist, arm.elbow));
  const palm = Math.hypot(...sub(arm.hand, arm.wrist));
  const elbow = held(arm.shoulder, arm.elbow, upper);
  const wrist = held(elbow, add(arm.wrist, sub(elbow, arm.elbow)), fore);
  const hand = handed({ ...arm, elbow, wrist }, side, curl).hand;
  return tipped({ ...arm, elbow, wrist, hand: held(wrist, hand, palm) }, side, curl);
}

/** A foot never goes under the ground: its toe comes up to it. */
function footClear(leg: Leg): Leg {
  const toe: Vec = [leg.toe[0], Math.max(leg.toe[1], SOLE), leg.toe[2]];
  const along = unit(sub(toe, leg.ankle));
  const flat = unit([along[0], 0, along[2]]);
  // (Toes bend back only against the ground: a foot in the air is stiff to its tip.)
  const off = clamp((toe[1] - SOLE) / 0.05, 0, 1);
  return { ...leg, toe, end: madd(toe, along[1] < 0 ? unit(lerpV(flat, along, off)) : along, 0.05) };
}

/** A pose with nothing through anything: arms outside the body and legs, feet on or over the ground. */
function untangled(p: Person, s: Skeleton, leftCurl: number, rightCurl: number): Skeleton {
  return {
    ...s,
    left: { leg: footClear(s.left.leg), arm: armClear(p, s, s.left.arm, [-1, leftCurl]) },
    right: { leg: footClear(s.right.leg), arm: armClear(p, s, s.right.arm, [1, rightCurl]) },
  };
}


/** The bones of a rest pose, inverted: what takes a vertex from rest back to its bone's own frame. */
export const restSkeleton = (p: Person): Skeleton => skeletonOf(p, "rest", 0);

export interface Station {
  readonly at: Vec;
  readonly wide: number;
  readonly front: number;
  readonly back: number;
  readonly bones: readonly (readonly [string, number])[];
  readonly bust?: number;
  readonly rear?: number;
}

/** A squared circle's point at `a`, front and back each their own depth. */
export function spokeOf(st: Station, k: number): Vec {
  const a = (k / SPOKES) * TAU;
  const soft = (v: number): number => Math.sign(v) * Math.abs(v) ** 0.78;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lobe = (centre: number): number =>
    Math.exp(-(((Math.abs(((a + Math.PI) % TAU) - Math.PI) - centre) / 0.62) ** 2));
  const z = (c > 0 ? st.front + (st.bust ?? 0) * lobe(0.5) : st.back + (st.rear ?? 0) * lobe(2.6)) * soft(c);
  return add(st.at, [st.wide * soft(s), 0, z]);
}

type Bones = readonly (readonly [string, number])[];

/** How grown a body is, for its chest: fully, a teenager's part way, a child's not at all. */
function grownBy(age: Person["build"]["age"]): number {
  if (age === "adult" || age === "elder") return 1;
  return age === "teen" ? 0.6 : 0;
}

/** What a torso's rings are measured from: its breadths, what is soft on it, and the skeleton they sit on. */
interface Torso {
  readonly s: Skeleton;
  readonly hipW: number;
  readonly mid: number;
  readonly shoulderW: number;
  readonly neckR: number;
  readonly nape: number;
  readonly chest: number;
  readonly stomach: number;
  readonly bustSize: number;
  /** How far the seat stands out: a woman's curve, the fat on it, and the build's own. */
  readonly seat: (k: number) => number;
}

function torsoOf(p: Person, s: Skeleton): Torso {
  const { shoulder, hip, girth, head, chest, waist, belly, bust, rear, sex } = p.build;
  const fat = Math.max(0, girth - 1);
  const hipW = hip * 1.02 * (1 + fat * 0.3);
  const mid = mix(hip, shoulder, 0.16) * mix(0.76, 1.08, girth - 0.78) * waist;
  const shoulderW = shoulder * 0.98 * (1 + fat * 0.22);
  const grown = grownBy(p.build.age);
  const neckR = Math.min(head * 0.5 * neckBy(p) * Math.sqrt(girth * p.build.limb), shoulder * 0.3);
  const nape = head * 0.1 * p.face.bone.m;
  const curve = sex === "female" ? 1.1 : 1;
  const muscle = clamp((p.build.limb - 1) / 0.2, 0, 1) * (waist < 0.9 ? 1 : 0);
  // (A grown woman's is shaped on the finished surface, by `bustOf`; the cage carries only what is broad.)
  const young = grown === 1 ? 0 : 0.05 * bust * grown;
  const bustSize = sex === "male" ? (0.012 + muscle * 0.03) * bust : young;
  const stomach = fat * 0.08 + belly;
  const seat = (k: number): number => (k === 0 ? (0.024 * curve + fat * 0.02) * rear : 0.012 * curve * rear);
  return { s, hipW, mid, shoulderW, neckR, nape, chest, stomach, bustSize, seat };
}

/** Where a ring sits: at `y` on the line from the pelvis to the neck, `forward` of it. */
function ringAt(s: Skeleton, y: number, forward = 0): Vec {
  const k = (y - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]);
  return [0, y, lerpV(s.pelvis, s.neck, k)[2] + forward];
}

/** The rings from the crotch up through the belly to the waist. */
function hipStations(t: Torso): readonly Station[] {
  const { s, hipW, mid, stomach } = t;
  const crotch = s.left.leg.hip[1];
  const y = (k: number): number => mix(crotch, s.left.arm.shoulder[1], k);
  const low: Bones = [["pelvis", 1]];
  const waistB: Bones = [["pelvis", 0.4], ["spine", 0.6]];
  return [
    { at: ringAt(s, crotch - 0.05), wide: hipW * 0.86, front: hipW * 0.5, back: hipW * 0.56, bones: low },
    {
      at: ringAt(s, crotch + 0.04),
      wide: hipW,
      front: hipW * 0.62 + stomach * 0.5,
      back: hipW * 0.72,
      rear: t.seat(0),
      bones: low,
    },
    {
      at: ringAt(s, y(0.17)),
      wide: hipW * 0.97,
      front: hipW * 0.6 + stomach * 0.85,
      back: hipW * 0.66,
      rear: t.seat(1),
      bones: low,
    },
    {
      at: ringAt(s, y(0.29)),
      wide: mix(hipW, mid, 0.62),
      front: mid * 0.62 + stomach,
      back: mid * 0.62,
      bones: waistB,
    },
    { at: ringAt(s, y(0.41)), wide: mid, front: mid * 0.6 + stomach * 0.95, back: mid * 0.56, bones: waistB },
  ];
}

/** The rings of the ribs and the chest, up to the shoulders. */
function chestStations(t: Torso): readonly Station[] {
  const { s, mid, shoulderW, neckR, chest, stomach, bustSize } = t;
  const chestY = s.left.arm.shoulder[1];
  const y = (k: number): number => mix(s.left.leg.hip[1], chestY, k);
  const ribsB: Bones = [["spine", 0.5], ["chest", 0.5]];
  const chestB: Bones = [["chest", 1]];
  return [
    {
      at: ringAt(s, y(0.52)),
      wide: mix(mid, shoulderW * 0.82, 0.32),
      front: mid * 0.62 + stomach * 0.75,
      back: mid * 0.58,
      bones: ribsB,
    },
    {
      at: ringAt(s, y(0.64)),
      wide: mix(mid, shoulderW * 0.86, 0.7),
      front: shoulderW * 0.5 + chest * 0.5 + stomach * 0.45,
      back: shoulderW * 0.5,
      bust: bustSize * 0.4,
      bones: ribsB,
    },
    {
      at: ringAt(s, y(0.76), chest * 0.4),
      wide: shoulderW * 0.86,
      front: shoulderW * 0.54 + chest * 0.6,
      back: shoulderW * 0.52,
      bust: bustSize,
      bones: chestB,
    },
    {
      at: ringAt(s, y(0.86), chest * 0.3),
      wide: shoulderW * 0.9,
      front: shoulderW * 0.5 + chest * 0.4,
      back: shoulderW * 0.52,
      bust: bustSize * 0.5,
      bones: chestB,
    },
    { at: ringAt(s, chestY), wide: shoulderW * 1.02, front: shoulderW * 0.44, back: shoulderW * 0.48, bones: chestB },
    {
      at: ringAt(s, chestY + 0.045),
      wide: mix(shoulderW, neckR * 1.8, 0.4),
      front: shoulderW * 0.31,
      back: shoulderW * 0.38,
      bones: chestB,
    },
  ];
}

/** The rings of the neck, from its root to under the head, set back by the nape. */
function neckStations(t: Torso): readonly Station[] {
  const { s, neckR, nape } = t;
  return [
    {
      at: add(s.neck, [0, -0.01, -0.008]),
      wide: neckR * 1.62,
      front: neckR * 0.98,
      back: neckR * 1.42,
      bones: [["chest", 0.6], ["neck", 0.4]],
    },
    {
      at: madd(lerpV(s.neck, s.head, 0.26), FRONT, -nape * 0.4),
      wide: neckR * 0.9,
      front: neckR * 0.84,
      back: neckR * 0.98,
      bones: [["neck", 1]],
    },
    {
      at: madd(lerpV(s.neck, s.head, 0.72), FRONT, -nape),
      wide: neckR * 0.86,
      front: neckR * 0.8,
      back: neckR * 0.96,
      bones: [["neck", 0.6], ["head", 0.4]],
    },
  ];
}

/** The torso's rings, hips to the top of the neck. */
export function torsoStations(p: Person, s: Skeleton): readonly Station[] {
  const t = torsoOf(p, s);
  return [...hipStations(t), ...chestStations(t), ...neckStations(t)];
}

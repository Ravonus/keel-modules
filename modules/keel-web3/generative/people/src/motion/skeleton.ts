// The skeleton: each action as a pose and the swing of each limb through its beat, then the joints placed from it,
// feet planted and limbs kept clear of the trunk and each other.

import { FAR, FRONT, SIDE, TAU, UP, add, clamp, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Age, Gait, Person } from "../body/person.js";
import { TALL, limbWide } from "../body/build.js";
import { LONG_TOP } from "../clothes/outfit.js";
import { neckBy } from "../mesh/parts.js";
import { SPOKES } from "../body/cage.js";
import { SLEEVE_RINGS, hemOf, topLift } from "../clothes/cloth.js";

// ---------------------------------------------------------------- the skeleton

export type Action = "rest" | "seated" | "stand" | "idle" | "walk" | "power" | "jog" | "run" | "sprint" | "jump" | "sit" | "crouch" | "wave" | "clap" | "laugh" | "cheer" | "dance" | "shrug" | "bow" | "nod" | "fold" | "hips" | "think" | "talk" | "stretch";
export const ACTIONS: readonly Action[] = ["stand", "idle", "walk", "power", "jog", "run", "sprint", "jump", "sit", "crouch", "wave", "clap", "laugh", "cheer", "dance", "shrug", "bow", "nod", "fold", "hips", "think", "talk", "stretch"];

/** How a mesh is built: arms and legs held clear of the body, so no surface joins what must part. */
export const REST: Swing = { thigh: 0, knee: 0.02, upper: 0, fore: 0, out: 30, splay: 0.17 };

export interface Leg { readonly hip: Vec; readonly knee: Vec; readonly ankle: Vec; readonly toe: Vec; /** The toes' ends: they stay flat on the ground as the heel comes up. */ readonly end: Vec }
export interface Arm { /** Where the thumb ends: in over the palm as the hand shuts. */ readonly thumb: Vec; readonly shoulder: Vec; readonly elbow: Vec; readonly wrist: Vec; readonly hand: Vec; /** Where the fingers end: bent in toward the palm as far as the hand is closed. */ readonly tip: Vec; /** Which way the palm is turned to face. */ readonly faces: Vec; /** How far the wrist is bent toward the palm. */ readonly flex: number; /** The line across the knuckles. */ readonly knuckles: Vec; /** And where their last joints end. */ readonly nail: Vec }

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

/** A leg's and an arm's angles at one moment, radians forward of hanging straight down. */
interface Swing {
  /** How far a leg stands out from the body. */
  readonly splay?: number; readonly thigh: number; readonly knee: number; readonly upper: number; readonly fore: number; readonly out: number; /** How far the fingers are closed, radians at the knuckles. */ readonly curl?: number; /** Which way the palm faces, where it is not in toward the body. */ readonly palm?: Vec | undefined; /** How far the toes are raised past what the leg gives them. */ readonly pitch?: number; /** How far the toes turn out. */ readonly turned?: number; /** How far the forearm comes in across the body. */ readonly across?: number; /** Where the wrist is to go, from the chest: out to its own side, up, forward. The arm finds its own way there. */ readonly reach?: Vec | undefined; /** How far the wrist bends toward the palm. */ readonly flex?: number }

/** What the trunk and head are doing, all but the height of the hips optional. */
interface Body {
  readonly hips: number;
  /** Forward, radians; how much more the upper back bends; over to the left or right. */
  readonly lean?: number; readonly curve?: number; readonly side?: number;
  /** How far the shoulders turn, metres at the joint; the hips to one side; the swinging hip's dip. */
  readonly twist?: number; readonly shift?: number; readonly drop?: number;
  /** The head: down, over to a side, and round. */
  readonly nod?: number; readonly tilt?: number; readonly turn?: number;
  readonly breath?: number;
  /** How far apart the feet are, of the hips' width. */
  readonly wide?: number;
  /** Each shoulder lifted, metres. */
  readonly shrug?: readonly [number, number];
}

/** One moment of a body: everything a motion has to say. */
interface Pose { readonly left: Swing; readonly right: Swing; readonly body: Body }

/**
 * A way of moving: how many beats a second, how many heights a second it carries a body, and the pose at any point of a
 * beat. Adding one is adding a line to `MOTIONS`.
 */
interface Motion { readonly beat: number; readonly pace?: number; /** Personal: taken at a person's own cadence, out of step with everyone else. */ readonly own?: boolean; readonly at: (p: Person, phase: number) => Pose }

const pitched = (a: number): Vec => [0, -Math.cos(a), Math.sin(a)];

const STILL: Swing = { thigh: 0.02, knee: 0.04, upper: 0.03, fore: 0.16, out: 0.05, curl: 0.32, flex: 0.1 };

/** One side's swing: `phase` runs a full stride, the other side half a stride behind. */
/**
 * A jump's body, at `u` of the way through it: how deep the crouch, how high off the ground, how far the arms have
 * swung up.
 */
function jumpAt(u: number): { readonly crouch: number; readonly high: number; readonly arms: number } {
  const ease = (v: number): number => { const k = clamp(v, 0, 1); return k * k * (3 - 2 * k); };
  const air = (u - 0.3) / 0.46;
  const flying = air > 0 && air < 1;
  const crouch = u < 0.3 ? ease(u / 0.2) * (1 - ease((u - 0.22) / 0.08)) : flying ? 0.28 * Math.sin(air * Math.PI) : (1 - ease((u - 0.82) / 0.18)) * 0.8 * ease((u - 0.76) / 0.06);
  return { crouch, high: flying ? 0.44 * 4 * air * (1 - air) : 0, arms: flying ? Math.sin(air * Math.PI) : -crouch };
}

const sideIndex = (side: number): 0 | 1 => (side < 0 ? 0 : 1);

const swungJump = (phase: number, offset: number): Swing => {
  const { crouch, arms } = jumpAt(((phase / TAU) % 1 + 1) % 1);
  return { thigh: 0.02 + 1.05 * crouch + offset, knee: 0.04 + 2 * crouch + 0.7 * Math.max(0, arms), upper: 0.03 + (arms > 0 ? 2.2 * arms : 0.8 * arms), fore: 0.3 + 0.2 * Math.abs(arms), out: 0.08 + 0.2 * Math.max(0, arms), curl: 0.6, flex: 0.1 };
};

const bump = (phase: number, at: number, wide: number): number => {
  const d = Math.atan2(Math.sin(phase - at), Math.cos(phase - at)) / wide;
  return Math.exp(-d * d);
};

/** How far an arm swings: most people favour one. */
const armSwing = (g: Gait, side: number): number => g.swing * (side === g.lazy ? g.lazyBy : 1);

/**
 * Walking, one side at `phase`: the leg forward at the heel's strike, a knee that gives as it takes the weight, and
 * that bends most just after the thigh has passed under the hip. The arms hang and swing a little further back than
 * forward.
 */
function walkSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase), arm = armSwing(g, side);
  return { thigh: 0.05 + 0.38 * g.stride * s, knee: 0.05 + 0.76 * g.kick * bump(phase, 0.5, 0.75) + 0.2 * bump(phase, 2.1, 0.35), upper: -0.06 + g.carry * 0.3 - 0.4 * arm * s, fore: 0.26 + 0.16 * arm * (1 - s), out: 0.03 + g.flare * 0.4, pitch: 0.34 * bump(phase, 1.6, 0.4) - 0.5 * bump(phase, -1.35, 0.45), turned: g.turned, curl: g.walking[sideIndex(side)], flex: 0.14 };
}

/** Power walking: a walk's legs, long and quick and one foot always down, with a runner's arms. */
function powerSwing(g: Gait, phase: number, side: number): Swing {
  const s = Math.sin(phase);
  return { ...walkSwing({ ...g, stride: g.stride * 1.28, kick: g.kick * 0.8 }, phase, side), upper: -0.12 + g.carry * 0.5 - 0.5 * armSwing(g, side) * s, fore: g.pump[sideIndex(side)], out: 0.08 + g.flare, across: g.across * 0.7, curl: g.running[sideIndex(side)], flex: 0.04 };
}

/** How far a knee shuts: past this the calf is through the thigh. */
const FOLD = 2.2;

/**
 * Running at `effort`, one side at `phase`: pushed off behind at -π/2, the heel folds up under the hip, the knee drives
 * through high, and the foot comes down bent-kneed under the body.
 */
function runSwing(g: Gait, phase: number, side: number, effort: number): Swing {
  const s = Math.sin(phase);
  return { thigh: 0.26 + (0.4 + 0.32 * effort) * g.stride * s, knee: Math.min(FOLD, 0.22 + (0.9 + 1.1 * effort) * g.kick * bump(phase, -0.32, 0.85) + 0.42 * bump(phase, 1.5, 0.55) + 0.4 * bump(phase, 2.7, 0.55)), upper: -0.16 + g.carry - (0.3 + 0.34 * effort) * armSwing(g, side) * s, fore: g.pump[sideIndex(side)], out: 0.06 + g.flare, across: g.across, turned: g.turned * 0.6, curl: g.running[sideIndex(side)], flex: 0.03 };
}

/**
 * The weight going from foot to foot, and with it the pelvis, the spine and the shoulders: women's hips travel further
 * than men's, whose shoulders turn more.
 */
function strideBody(p: Person, phase: number, hips: number, sway: number, lean: number): Body {
  const grown = GROWN_GAIT.includes(p.build.age), female = p.build.sex === "female" && grown, g = p.gait, c = Math.cos(phase);
  return { hips, lean, twist: 0.05 * (p.build.sex === "male" && grown ? 1.3 : 0.8) * g.twist * Math.sin(phase), shift: c * sway * (female ? 0.024 : 0.014) * g.sway, drop: c * Math.min(1, sway) * (female ? 0.016 : 0.01) * g.sway, wide: (female ? 0.46 : 0.6) * g.wide };
}

const opposed = (p: Person, phase: number, swing: (g: Gait, phase: number, side: number) => Swing): readonly [Swing, Swing] => [swing(p.gait, phase, -1), swing(p.gait, phase + Math.PI, 1)];

function walked(p: Person, phase: number, swing: (g: Gait, phase: number, side: number) => Swing, sway: number, lean: number): Pose {
  const [left, right] = opposed(p, phase, swing);
  return { left, right, body: strideBody(p, phase, feetDown(p, left, right), sway, lean) };
}

/** Both feet leave the ground between steps: the hips lowest over the foot and highest in the air. */
function ran(p: Person, phase: number, effort: number): Pose {
  const [left, right] = opposed(p, phase, (g, at, side) => runSwing(g, at, side, effort));
  return { left, right, body: strideBody(p, phase, standHips(p) - 0.13 + 0.05 * effort * p.gait.bounce * (1 - Math.cos(2 * phase)), 0.6, 0.07 + 0.15 * effort + p.gait.lean) };
}

/** A pose on the ground, the hips as high as the feet let them be. */
const grounded = (p: Person, left: Swing, right: Swing, body: Omit<Body, "hips"> = {}): Pose => ({ left, right, body: { hips: feetDown(p, left, right), ...body } });

/** The same on both sides. */
const held = (p: Person, swing: (side: number) => Swing, body: Omit<Body, "hips"> = {}): Pose => grounded(p, swing(-1), swing(1), body);

/** Knees giving in time, as anything to a beat. */
const bouncing = (phase: number, deep: number, side = 0): Swing => ({ ...STILL, thigh: 0.1 + deep * (1 + Math.cos(phase * 2 + side)), knee: 0.2 + deep * 2 * (1 + Math.cos(phase * 2 + side)) });

function danced(p: Person, phase: number): Pose {
  const s = Math.sin(phase), c = Math.cos(phase), flip = (side: number): number => (side < 0 ? 1 : -1);
  const body = { shift: 0.085 * s, side: -0.085 * s, turn: 0.2 * s, wide: 0.9, tilt: 0.06 * c };
  const moves: readonly ((side: number) => Swing)[] = [
    (side) => ({ ...bouncing(phase, 0.1), upper: 0.25 + 0.3 * s * flip(side), fore: 1.5, out: 0.2, curl: 1 }),
    (side) => ({ ...bouncing(phase, 0.08), reach: [0.26, 0.6 + 0.14 * s * flip(side), 0.12], palm: [-side, 0, 0.3], curl: 0.5 }),
    (side) => ({ ...bouncing(phase, 0.1, side), reach: [0.3 + 0.05 * s, -0.08 + 0.1 * c, 0.26], palm: [0, -1, 0], curl: 0.4, flex: 0.3 }),
    (side) => ({ ...bouncing(phase, 0.12), reach: s * flip(side) > 0 ? [0.34, 0.5, 0.2] : [0.12, -0.14, 0.26], curl: 0.9 }),
  ];
  return held(p, moves[p.gait.dance % (p.build.age === "adult" || p.build.age === "elder" ? 4 : 2)] ?? (() => STILL), { ...body, curve: 0.08 * c });
}

function laughed(p: Person, phase: number): Pose {
  const shake = Math.sin(phase * 3), k = Math.sin(phase);
  const left: Swing = { ...STILL, reach: [0.05, -0.22, 0.2], palm: [0, 0, -1], curl: 0.3 };
  const right: Swing = { ...STILL, reach: [0.1 + 0.02 * shake, -0.14, 0.2], palm: [0, 0, -1], curl: 0.3 };
  return grounded(p, left, right, { lean: -0.1 + 0.08 * k, curve: 0.1 + 0.2 * k, nod: -0.34 + 0.3 * k, shrug: [0.012 * shake, 0.012 * shake], tilt: 0.08, breath: 0.012 * shake });
}

const idled = (p: Person, phase: number): Pose => {
  const s = Math.sin(phase * 0.5), turn = Math.sin(phase * 0.21 + p.seed) * 0.42, hand = p.gait.idle === 1 ? { reach: [0.21, -0.2, 0.03] as Vec, palm: [-0.7, 0, -1] as Vec, curl: 0.3 } : {};
  return { left: { ...STILL, upper: 0.03 + 0.02 * Math.sin(phase - 1), fore: 0.16 + 0.03 * Math.sin(phase * 0.7), curl: 0.36 }, right: { ...STILL, upper: 0.03 + 0.02 * Math.sin(phase + 1), fore: 0.16 + 0.03 * Math.sin(phase * 0.7), curl: 0.36, ...hand }, body: { hips: feetDown(p, STILL, STILL), lean: s * 0.02, shift: s * 0.035, turn, breath: Math.sin(phase) * 0.014, side: -s * 0.02 } };
};

const bowed = (p: Person, phase: number): Pose => {
  const k = (1 - Math.cos(phase)) / 2;
  return held(p, () => ({ ...STILL, upper: 0.2 * k, curl: 0.3 }), { lean: 0.86 * k, curve: 0.2 * k, nod: 0.3 * k });
};

export const MOTIONS: Readonly<Record<Action, Motion>> = {
  rest: { beat: 0, at: (p) => ({ left: REST, right: REST, body: { hips: feetDown(p, STILL, STILL) } }) },
  // (Sitting with the arms held out, so that nothing lies over what the cloth is doing: for looking at clothes.)
  seated: { beat: 0, at: (p) => { const sat = MOTIONS.sit.at(p, 0), arms = { upper: 0, fore: 0, out: REST.out, curl: 0, flex: 0 }; return { ...sat, left: { ...sat.left, ...arms }, right: { ...sat.right, ...arms } }; } },
  stand: { beat: 0.28, at: (p, phase) => held(p, () => STILL, { breath: Math.sin(phase) * 0.014 }) },
  idle: { beat: 0.28, at: idled },
  walk: { beat: 0.92, pace: 0.8, own: true, at: (p, phase) => walked(p, phase, walkSwing, 1, 0.03 + p.gait.lean * 0.4) },
  power: { beat: 1.2, pace: 1.3, own: true, at: (p, phase) => walked(p, phase, powerSwing, 1.5, 0.08 + p.gait.lean * 0.6) },
  jog: { beat: 1.3, pace: 1.5, own: true, at: (p, phase) => ran(p, phase, 0.55) },
  run: { beat: 1.55, pace: 2.6, own: true, at: (p, phase) => ran(p, phase, 1) },
  sprint: { beat: 1.9, pace: 3.8, own: true, at: (p, phase) => ran(p, phase, 1.35) },
  jump: { beat: 0.8, at: (p, phase) => { const { high } = jumpAt(((phase / TAU) % 1 + 1) % 1), left = swungJump(phase, -0.04), right = swungJump(phase, 0.04); return { left, right, body: { hips: high > 0 ? standHips(p) + high : feetDown(p, left, right) } }; } },
  sit: { beat: 0.28, at: (p, phase) => { const leg: Swing = { thigh: 1.5, knee: 1.5, upper: 0.35, fore: 0.95, out: 0.12, curl: 0.4, flex: 0.2 }; return { left: leg, right: leg, body: { hips: standHips(p) * 0.56, breath: Math.sin(phase) * 0.014 } }; } },
  crouch: { beat: 0.28, at: (p, phase) => held(p, () => ({ ...STILL, thigh: 1.5, knee: 2.3, pitch: 0.5, upper: 0.5, fore: 1.2, out: 0.2, curl: 0.4 }), { lean: 0.5, wide: 1, breath: Math.sin(phase) * 0.014 }) },
  wave: { beat: 1.6, at: (p, phase) => grounded(p, STILL, { ...STILL, reach: [0.3 + 0.08 * Math.sin(phase), 0.48, 0.12], palm: FRONT, curl: 0.08, flex: -0.15 + 0.3 * Math.sin(phase) }, { tilt: 0.05, side: -0.03 }) },
  clap: { beat: 2.1, at: (p, phase) => held(p, (side) => ({ ...STILL, reach: [0.036 + 0.075 * (0.5 + 0.5 * Math.cos(phase)), -0.03, 0.27], palm: [-side, 0, 0], curl: 0.1, flex: 0 })) },
  laugh: { beat: 0.9, at: laughed },
  cheer: { beat: 1.4, at: (p, phase) => held(p, (side) => ({ ...bouncing(phase, 0.1), reach: [0.34, 0.72 + 0.08 * Math.sin(phase * 2), 0.12], palm: [-side, 0, 0.4], curl: 1.2 }), { nod: -0.25 }) },
  dance: { beat: 1, at: danced },
  shrug: { beat: 0.6, at: (p, phase) => { const k = Math.max(0, Math.sin(phase)); return held(p, (side) => ({ ...STILL, reach: [0.3 + 0.1 * k, -0.2 + 0.1 * k, 0.2], palm: [-side * 0.3, 1, 0], curl: 0.12 }), { shrug: [0.09 * k, 0.09 * k], tilt: 0.14 * k }); } },
  bow: { beat: 0.4, at: bowed },
  nod: { beat: 1.2, at: (p, phase) => held(p, () => STILL, { nod: 0.1 + 0.2 * Math.sin(phase) }) },
  fold: { beat: 0.28, at: (p, phase) => grounded(p, { ...STILL, reach: [-0.1, -0.09, 0.19], palm: [0, 1, 0.3], curl: 0.6 }, { ...STILL, reach: [-0.1, -0.13, 0.2], palm: [0, -1, 0.3], curl: 0.6 }, { breath: Math.sin(phase) * 0.014, lean: -0.02 }) },
  hips: { beat: 0.28, at: (p, phase) => held(p, () => ({ ...STILL, reach: [0.24, -0.2, 0], palm: [-0.7, 0, -1], curl: 0.3, flex: -0.2 }), { breath: Math.sin(phase) * 0.014 }) },
  think: { beat: 0.28, at: (p, phase) => grounded(p, { ...STILL, reach: [-0.08, -0.12, 0.17], palm: [0, 1, 0], curl: 0.5 }, { ...STILL, reach: [0.02, 0.28, 0.2], palm: [-1, 0.3, 0], curl: 0.9 }, { nod: 0.1, tilt: 0.1, breath: Math.sin(phase) * 0.014 }) },
  talk: { beat: 0.8, at: (p, phase) => held(p, (side) => ({ ...STILL, reach: [0.2 + 0.06 * Math.sin(phase + side), -0.14 + 0.05 * Math.sin(phase * 2 + side), 0.24], palm: [-side * 0.5, 0.8, 0], curl: 0.4 }), { nod: 0.06 * Math.sin(phase * 2), turn: 0.14 * Math.sin(phase * 0.5) }) },
  stretch: { beat: 0.3, at: (p, phase) => { const k = (1 - Math.cos(phase)) / 2; return held(p, (side) => ({ ...STILL, reach: [0.3 - 0.14 * k, -0.2 + 0.86 * k, 0.1 - 0.02 * k], palm: [-side, k, 0], curl: 0.3 }), { nod: -0.3 * k, curve: -0.12 * k, breath: 0.02 * k }); } },
};

function legOf(p: Person, hip: Vec, swing: Swing, side = 0): Leg {
  const length = TALL * p.build.legs * 0.5;
  const out = (a: number): Vec => unit(add(pitched(a), [side * (swing.splay ?? 0), 0, 0]));
  const knee = madd(hip, out(swing.thigh), length);
  const ankle = madd(knee, out(swing.thigh - swing.knee), length * 0.96);
  // (The foot stays near level, tipping only as the leg swings through.)
  const toe = madd(add(ankle, [0, -0.02, 0]), unit([side * (swing.turned ?? 0), -0.12 + clamp(swing.thigh - swing.knee, -1, 1) * 1.1 + (swing.pitch ?? 0), 1]), TALL * 0.08 * p.build.foot);
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
function reached(shoulder: Vec, to: Vec, side: number, upper: number, fore: number): { readonly elbow: Vec; readonly wrist: Vec } {
  const way = sub(to, shoulder), along = unit(way, FRONT), far = clamp(Math.hypot(...way), Math.abs(upper - fore) + 0.02, (upper + fore) * 0.985);
  const a = (far * far + upper * upper - fore * fore) / (2 * far), rise = Math.sqrt(Math.max(0, upper * upper - a * a));
  const pole: Vec = [side * 0.7, -0.6, -0.4], off = unit(sub(pole, scale(along, dot(pole, along))), scale(UP, -1));
  return { elbow: madd(madd(shoulder, along, a), off, rise), wrist: madd(shoulder, along, far) };
}

function armOf(p: Person, shoulder: Vec, side: number, swing: Swing, chest: Vec): Arm {
  const length = TALL * 0.186, forearm = length * 0.8;
  const clear = swing.out + Math.max(0, p.build.girth - 1) * 0.28 + (LONG_TOP[p.outfit.top] === undefined ? 0 : 0.1 + p.outfit.fit * 0.08);
  const down = (a: number, out: number): Vec => unit(add(pitched(a), [side * out, 0, 0]));
  const elbow = madd(shoulder, down(swing.upper, clear), length);
  // (A bent forearm comes back in across the body; it does not stick out where the upper arm is going.)
  const free = { elbow, wrist: madd(elbow, down(swing.upper + swing.fore, clear * (1 - 1.5 * clamp(swing.fore / 1.5, 0, 1)) - (swing.across ?? 0)), forearm) };
  // (A hand reaching round a big body has further to go.)
  const big = Math.max(0, p.build.girth - 1), joints = swing.reach ? reached(shoulder, add(chest, [side * (swing.reach[0] + (swing.reach[1] < 0.1 ? big * 0.1 : 0)), swing.reach[1], swing.reach[2] + (swing.reach[1] < 0.1 ? big * 0.2 : 0)]), side, length, forearm) : free;
  return handed({ shoulder, ...joints, faces: swing.palm ?? [-side, -0.3, 0], flex: swing.flex ?? 0 }, side, swing.curl ?? 0);
}

/** How long the hand's own bone is, wrist to knuckles. */
const PALM = TALL * 0.058;

/** A hand on the end of a forearm, bent at the wrist as far as it is. */
function handed(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb" | "hand">, side: number, curl: number): Arm {
  const along = unit(sub(arm.wrist, arm.elbow)), palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  return tipped({ ...arm, hand: madd(arm.wrist, add(scale(along, Math.cos(arm.flex)), scale(palm, Math.sin(arm.flex))), PALM) }, side, curl);
}

/**
 * A hand's fingers, bent `curl` from its line in toward its palm, which turns to face the body wherever the arm goes:
 * thumb up on a forearm held out, as a forearm really rolls.
 */
function tipped(arm: Omit<Arm, "tip" | "nail" | "knuckles" | "thumb">, side: number, curl: number): Arm {
  const along = unit(sub(arm.hand, arm.wrist)), palm = unit(sub(arm.faces, scale(along, dot(arm.faces, along))), scale(UP, -1));
  const bent = (a: number): Vec => add(scale(along, Math.cos(a)), scale(palm, Math.sin(a)));
  const tip = madd(arm.hand, bent(curl), 0.046);
  const knuckles = cross(along, palm), shut = clamp(curl / 1.2, 0, 1);
  const thumb = madd(madd(madd(arm.wrist, along, 0.06 + 0.03 * shut), knuckles, -side * 0.042 * (1 - 1.4 * shut)), palm, 0.036 * shut);
  return { ...arm, tip, nail: madd(tip, bent(curl * 2), 0.04), knuckles, thumb };
}

/** How far under the pelvis the hip joints sit. */
export const HIP_DROP = 0.04;

/** How high the sole stands under the lowest point of a foot's bones. */
const SOLE = 0.083;

/** How high the hips sit to put the lower foot, whatever its angle, on the ground. */
function feetDown(p: Person, a: Swing, b: Swing): number {
  const lowest = (s: Swing): number => { const { ankle, toe } = legOf(p, [0, 0, 0], s); return Math.min(ankle[1] - 0.02, toe[1] - Math.max(0, ankle[1] - toe[1] - 0.05) * 0.5); };
  return SOLE + HIP_DROP - Math.min(lowest(a), lowest(b));
}

const standHips = (p: Person): number => feetDown(p, STILL, STILL);

/** Legs stand apart as far as thick thighs need, so they meet and no more. */
function stance(p: Person, swing: Swing): Swing {
  const crowded = 0.09 * limbWide(p.build) - p.build.hip * 0.6;
  return { ...swing, splay: Math.max(swing.splay ?? 0, clamp(crowded / 0.42, 0, 0.22)) };
}

/** The arm that holds an umbrella up, whatever the rest of them does. */
const HOLDING = { upper: 0.36, fore: 1.62, out: 0.16, curl: 0, flex: 0, across: 0, reach: undefined, palm: undefined };

const GROWN_GAIT: readonly Age[] = ["teen", "adult", "elder"];

/** The bones of a pose. */
function skeletonFrom(p: Person, pose: Pose, loose: boolean): Skeleton {
  const { shoulder, hip, stoop } = p.build, leftSwing = stance(p, pose.left);
  const body = { lean: 0, curve: 0, side: 0, twist: 0, shift: 0, drop: 0, nod: 0, tilt: 0, turn: 0, breath: 0, wide: 0.6, shrug: [0, 0] as const, ...pose.body };
  const rightSwing = stance(p, p.outfit.carry === "umbrella" && !loose ? { ...pose.right, ...HOLDING } : pose.right);
  const pelvis: Vec = [body.shift, body.hips, 0], { breath, drop, curve, twist } = body;
  // (What the height leaves between the standing hips and the crown.)
  const trunk = TALL - standHips(p) - p.build.head * (p.face.bone.rise + 1.28);
  const bent = (more: number): Vec => unit([body.side, 1, stoop + body.lean + more]);
  const low = madd(pelvis, bent(0), trunk * 0.22);
  // (The waist leans the way the pelvis tips, so the pelvis itself drops over the swinging leg.)
  const waist = add(low, [-drop * trunk * 0.22 / hip, 0, 0]);
  const chest = madd(low, bent(curve * 0.5), trunk * 0.36 + breath), top = bent(curve), neck = madd(chest, top, trunk * 0.42);
  const head = madd(neck, unit([body.tilt, 1, stoop * 2 + body.nod]), p.build.head * p.face.bone.rise);
  const sideOf = (side: number, s: Swing): { leg: Leg; arm: Arm } => ({
    leg: planted(p, legOf(p, add(pelvis, [side * hip * body.wide, -HIP_DROP + side * drop, -side * twist * 0.6]), s, side)),
    arm: armOf(p, add(madd(neck, top, -trunk * 0.13), [side * shoulder, body.shrug[sideIndex(side)], side * twist]), side, s, chest),
  });
  const posed: Skeleton = { turn: body.turn, spin: Math.asin(clamp(twist / shoulder, -1, 1)), pelvis, waist, chest, neck, head, left: sideOf(-1, leftSwing), right: sideOf(1, rightSwing) };
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
interface Solid { readonly arm: number; readonly thigh: number; readonly at: (y: number) => { readonly wide: number; readonly front: number; readonly back: number } | undefined }

const solids = new WeakMap<Person, Solid>();

/**
 * A person's solid shape, standing: the same stations their surface is lofted through, and what they have on over it.
 */
function solidOf(p: Person): Solid {
  const known = solids.get(p);
  if (known) return known;
  const rest = restSkeleton(p), rings = torsoStations(p, rest), { top, bottom, fit } = p.outfit;
  const k = limbWide(p.build), sleeved = SLEEVE_RINGS[top] > 2 ? topLift(top, fit) : 0;
  const hung = LONG_TOP[top] !== undefined || bottom === "skirt", hem = hung ? hemOf(p) : FAR, tube = hung ? 1.22 + fit * 0.14 : 1;
  const fall = rings[1], ring = (y: number): Station | undefined => [...rings].reverse().find((r) => r.at[1] <= y);
  const solid: Solid = {
    arm: 0.04 * k + sleeved,
    thigh: 0.09 * k,
    at: (y) => {
      const lower = hung && y < rest.pelvis[1] && y >= hem - 0.1;
      const a = lower ? fall : ring(y), b = lower ? fall : rings[(a ? rings.indexOf(a) : 0) + 1];
      if (!a || !b || y > rest.left.arm.shoulder[1] - 0.05) return undefined;
      const t = clamp((y - a.at[1]) / Math.max(0.001, b.at[1] - a.at[1]), 0, 1), lift = topLift(top, fit), wrap = lower ? tube : 1;
      return { wide: mix(a.wide, b.wide, t) * wrap + lift, front: (mix(a.front, b.front, t) + (a.bust ?? 0) * 0.6) * wrap + lift, back: (mix(a.back, b.back, t) + (a.rear ?? 0)) * wrap + lift };
    },
  };
  solids.set(p, solid);
  return solid;
}

/** A point out of the trunk, to its surface, the way it is nearest. */
function outOfTrunk(p: Person, s: Skeleton, at: Vec): Vec {
  const solid = solidOf(p), rest = restSkeleton(p), rise = s.pelvis[1] - rest.pelvis[1];
  const ring = solid.at(at[1] - rise);
  if (!ring) return at;
  const k = clamp((at[1] - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]), 0, 1), middle = mix(s.pelvis[2], s.neck[2], k), z = at[2] - middle;
  const wide = ring.wide + solid.arm, deep = (z > 0 ? ring.front : ring.back) + solid.arm, q = Math.hypot(at[0] / wide, z / deep);
  if (q >= 1) return at;
  if (q < 1e-3) return [wide, at[1], at[2]];
  return [at[0] / q, at[1], middle + z / q];
}

/** A point off a limb running from `a` to `b`, a capsule `r` round it. */
function offLimb(at: Vec, a: Vec, b: Vec, r: number): Vec {
  const d = sub(b, a), t = clamp(dot(sub(at, a), d) / Math.max(1e-6, dot(d, d)), 0, 1), near = madd(a, d, t), off = sub(at, near), l = Math.hypot(...off);
  return l >= r ? at : madd(near, unit(off, SIDE), r);
}

/** An arm kept out of the body, bone by bone, each keeping its length. */
function armClear(p: Person, s: Skeleton, arm: Arm, side: number, curl: number): Arm {
  const { thigh, arm: r } = solidOf(p);
  const off = (at: Vec): Vec => [s.left.leg, s.right.leg].reduce((n, leg) => offLimb(n, leg.hip, leg.knee, thigh + r), outOfTrunk(p, s, at));
  const held = (from: Vec, to: Vec, length: number): Vec => madd(from, unit(sub(off(to), from)), length);
  const upper = Math.hypot(...sub(arm.elbow, arm.shoulder)), fore = Math.hypot(...sub(arm.wrist, arm.elbow)), palm = Math.hypot(...sub(arm.hand, arm.wrist));
  const elbow = held(arm.shoulder, arm.elbow, upper);
  const wrist = held(elbow, add(arm.wrist, sub(elbow, arm.elbow)), fore);
  const hand = handed({ ...arm, elbow, wrist }, side, curl).hand;
  return tipped({ ...arm, elbow, wrist, hand: held(wrist, hand, palm) }, side, curl);
}

/** A foot never goes under the ground: its toe comes up to it. */
function footClear(leg: Leg): Leg {
  const toe: Vec = [leg.toe[0], Math.max(leg.toe[1], SOLE), leg.toe[2]];
  const along = unit(sub(toe, leg.ankle)), flat = unit([along[0], 0, along[2]]);
  // (Toes bend back only against the ground: a foot in the air is stiff to its tip.)
  const off = clamp((toe[1] - SOLE) / 0.05, 0, 1);
  return { ...leg, toe, end: madd(toe, along[1] < 0 ? unit(lerpV(flat, along, off)) : along, 0.05) };
}

/** A pose with nothing through anything: arms outside the body and legs, feet on or over the ground. */
function untangled(p: Person, s: Skeleton, leftCurl: number, rightCurl: number): Skeleton {
  return { ...s, left: { leg: footClear(s.left.leg), arm: armClear(p, s, s.left.arm, -1, leftCurl) }, right: { leg: footClear(s.right.leg), arm: armClear(p, s, s.right.arm, 1, rightCurl) } };
}


/** The bones of a rest pose, inverted: what takes a vertex from rest back to its bone's own frame. */
export const restSkeleton = (p: Person): Skeleton => skeletonOf(p, "rest", 0);

export interface Station { readonly at: Vec; readonly wide: number; readonly front: number; readonly back: number; readonly bones: readonly (readonly [string, number])[]; readonly bust?: number; readonly rear?: number }

/** A squared circle's point at `a`, front and back each their own depth. */
export function spokeOf(st: Station, k: number): Vec {
  const a = (k / SPOKES) * TAU;
  const soft = (v: number): number => Math.sign(v) * Math.abs(v) ** 0.78;
  const c = Math.cos(a), s = Math.sin(a);
  const lobe = (centre: number): number => Math.exp(-(((Math.abs(((a + Math.PI) % TAU) - Math.PI) - centre) / 0.62) ** 2));
  const z = (c > 0 ? st.front + (st.bust ?? 0) * lobe(0.5) : st.back + (st.rear ?? 0) * lobe(2.6)) * soft(c);
  return add(st.at, [st.wide * soft(s), 0, z]);
}

/** The torso's rings, hips to the top of the neck. */
export function torsoStations(p: Person, s: Skeleton): readonly Station[] {
  const { shoulder, hip, girth, head, chest, waist, belly, bust, rear, sex } = p.build;
  const fat = Math.max(0, girth - 1);
  const hipW = hip * 1.02 * (1 + fat * 0.3), mid = mix(hip, shoulder, 0.16) * mix(0.76, 1.08, girth - 0.78) * waist;
  const shoulderW = shoulder * 0.98 * (1 + fat * 0.22), grown = p.build.age === "adult" || p.build.age === "elder" ? 1 : p.build.age === "teen" ? 0.6 : 0;
  const chestY = s.left.arm.shoulder[1], crotch = s.left.leg.hip[1], neckR = Math.min(head * 0.5 * neckBy(p) * Math.sqrt(girth * p.build.limb), shoulder * 0.3), nape = head * 0.1 * p.face.bone.m;
  const curve = sex === "female" ? 1.1 : 1;
  const at = (y: number, forward = 0): Vec => {
    const k = (y - s.pelvis[1]) / (s.neck[1] - s.pelvis[1]);
    return [0, y, lerpV(s.pelvis, s.neck, k)[2] + forward];
  };
  const low: readonly (readonly [string, number])[] = [["pelvis", 1]], waistB: readonly (readonly [string, number])[] = [["pelvis", 0.4], ["spine", 0.6]];
  const ribsB: readonly (readonly [string, number])[] = [["spine", 0.5], ["chest", 0.5]], chestB: readonly (readonly [string, number])[] = [["chest", 1]];
  const muscle = clamp((p.build.limb - 1) / 0.2, 0, 1) * (waist < 0.9 ? 1 : 0);
  // (A grown woman's is shaped on the finished surface, by `bustOf`; the cage carries only what is broad.)
  const bustSize = sex === "male" ? (0.012 + muscle * 0.03) * bust : grown === 1 ? 0 : 0.05 * bust * grown;
  const stomach = fat * 0.08 + belly;
  const y = (k: number): number => mix(crotch, chestY, k);
  return [
    { at: at(crotch - 0.05), wide: hipW * 0.86, front: hipW * 0.5, back: hipW * 0.56, bones: low },
    { at: at(crotch + 0.04), wide: hipW, front: hipW * 0.62 + stomach * 0.5, back: hipW * 0.72, rear: (0.024 * curve + fat * 0.02) * rear, bones: low },
    { at: at(y(0.17)), wide: hipW * 0.97, front: hipW * 0.6 + stomach * 0.85, back: hipW * 0.66, rear: 0.012 * curve * rear, bones: low },
    { at: at(y(0.29)), wide: mix(hipW, mid, 0.62), front: mid * 0.62 + stomach, back: mid * 0.62, bones: waistB },
    { at: at(y(0.41)), wide: mid, front: mid * 0.6 + stomach * 0.95, back: mid * 0.56, bones: waistB },
    { at: at(y(0.52)), wide: mix(mid, shoulderW * 0.82, 0.32), front: mid * 0.62 + stomach * 0.75, back: mid * 0.58, bones: ribsB },
    { at: at(y(0.64)), wide: mix(mid, shoulderW * 0.86, 0.7), front: shoulderW * 0.5 + chest * 0.5 + stomach * 0.45, back: shoulderW * 0.5, bust: bustSize * 0.4, bones: ribsB },
    { at: at(y(0.76), chest * 0.4), wide: shoulderW * 0.86, front: shoulderW * 0.54 + chest * 0.6, back: shoulderW * 0.52, bust: bustSize, bones: chestB },
    { at: at(y(0.86), chest * 0.3), wide: shoulderW * 0.9, front: shoulderW * 0.5 + chest * 0.4, back: shoulderW * 0.52, bust: bustSize * 0.5, bones: chestB },
    { at: at(chestY), wide: shoulderW * 1.02, front: shoulderW * 0.44, back: shoulderW * 0.48, bones: chestB },
    { at: at(chestY + 0.045), wide: mix(shoulderW, neckR * 1.8, 0.4), front: shoulderW * 0.31, back: shoulderW * 0.38, bones: chestB },
    { at: add(s.neck, [0, -0.01, -0.008]), wide: neckR * 1.62, front: neckR * 0.98, back: neckR * 1.42, bones: [["chest", 0.6], ["neck", 0.4]] },
    { at: madd(lerpV(s.neck, s.head, 0.26), FRONT, -nape * 0.4), wide: neckR * 0.9, front: neckR * 0.84, back: neckR * 0.98, bones: [["neck", 1]] },
    { at: madd(lerpV(s.neck, s.head, 0.72), FRONT, -nape), wide: neckR * 0.86, front: neckR * 0.8, back: neckR * 0.96, bones: [["neck", 0.6], ["head", 0.4]] },
  ];
}

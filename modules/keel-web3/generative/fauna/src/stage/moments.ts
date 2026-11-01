// Moments and poses: where an actor is this instant, how far through its act, and the frame its body stands in.

import { TAU, UP, add, clamp, dirOf, dot, flat, frameOf, length, madd, mix, scale, smooth, sub, unit } from "../vec.js";
import type { Frame, Vec } from "../vec.js";
import { wingStyle } from "../roster.js";
import type { Action, Role } from "../roster.js";
import { anchorOf, trunkPoint } from "./stage.js";
import type { Place, Stage } from "./stage.js";
import { alongPath, bankedUp, branchWay, pathLength, woodMapOf, woodNear } from "./paths.js";
import type { PathPoint } from "./paths.js";
import { offWood, pathFor, springOf, yawFrom } from "./director.js";
import type { Actor, MoveMode, Scene, Segment } from "./director.js";
import { ownPhase } from "../animals/kit.js";
import type { Who } from "../animals/bodies.js";
import { clearOfLimbs } from "./collision.js";

// ---------------------------------------------------------------- moments and poses

/** One capsule of an animal's body, in the world: a ball when a and b meet. */
export interface Capsule {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: Role;
  readonly part: string;
  /** Thickness across `up`, as a share of r (1 round, 0.2 a flat wing). */
  readonly flat: number;
  /** The capsule's thin axis (the animal's up for most parts). */
  readonly up: Vec;
  /** The animal's front, for orienting balls. */
  readonly fw: Vec;
  /** Radius at b, when the part tapers (a muzzle, a tail, a leg toward the ankle); r at a. */
  readonly r1?: number;
  /** How far it melts into the rest of the body: 0 a crisp seam, 1 the body's own (the default). */
  readonly melt?: number;
  /** How far, and which way, its middle stands off the straight line from a to b: a curved part, in place of `flat`. */
  readonly bow?: Vec;
  /**
   * A row of this many beads, each `r` round, from `a` to `b`, the way of `bow` at its middle: a foot's nails as one
   * part.
   */
  readonly row?: number;
  /** On a row: each bead drawn out this far and this way into a digit (a hand's fingers as one part). */
  readonly reach?: Vec;
  readonly sharp?: boolean;
  /** A finishing part's group: see sdf-body's `fitParts`. */
  readonly detail?: number;
  /** On a decal: bare skin, which a pelt thins out toward (see sdf-body's BodyPart). */
  readonly bare?: boolean;
  /** Paint only: no surface of its own, it colours the body inside it (a bib, a rump patch, a mask). */
  readonly decal?: boolean;
  /** A decal painted under the coat's pattern, so the pattern still runs over it (an owl's barred breast). */
  readonly under?: boolean;
  /** A hollow cut into the body, painted in its role (an owl's dished face): no surface of its own. */
  readonly carve?: boolean;
  /**
   * False when it casts no shadow: a small part standing off the body, whose shadow would fall as a speck apart from
   * the rest.
   */
  readonly shadow?: boolean;
}

/** A part's taper, melt, decal, carve and shadow flags, as `cap` takes them. */
export interface Finish {
  readonly sharp?: boolean;
  readonly detail?: number;
  readonly r1?: number;
  readonly melt?: number;
  readonly decal?: boolean;
  readonly under?: boolean;
  readonly carve?: boolean;
  readonly shadow?: boolean;
  readonly bow?: Vec;
  readonly row?: number;
  readonly reach?: Vec;
  readonly bare?: boolean;
}

const POSE_KEYS = ["crouch", "sit", "lie", "curl", "rear", "bow", "roll", "headPitch", "headYaw", "headRoll", "tailUp", "tailWag", "earBack", "mouth", "scratch", "dig", "shake", "wing", "flap", "peck", "fan", "reach", "hand", "hang", "hop", "lift"] as const;
type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;
export const restPose = (): Pose => Object.fromEntries(POSE_KEYS.map((key) => [key, 0])) as Pose;

export const bump = (k: number): number => Math.sin(Math.PI * clamp(k, 0, 1));
export const pulse = (t: number, every: number, width: number): number => { const u = (t % every) / every;
return u < width ? bump(u / width) : 0; };

type PoseFn = (tl: number, k: number, d: number) => Partial<Pose>;
/** What each action does to the body, `tl` seconds into it, `k` of the way through. */
const ACTION_POSE: Readonly<Record<Action, PoseFn>> = {
  stand: (tl) => ({ headYaw: 0.25 * Math.sin(tl * 0.7), tailWag: 0.15 * Math.sin(tl * 2) }),
  look: (tl) => ({ headYaw: 1.05 * Math.sin(tl * 0.9) * Math.min(1, tl), headPitch: 0.15, earBack: -0.3 }),
  sniff: (tl) => ({ headPitch: -0.55 + 0.08 * Math.sin(tl * 14), crouch: 0.15, headYaw: 0.3 * Math.sin(tl * 1.7) }),
  graze: (tl) => {
    const up = pulse(tl + 2, 5.5, 0.3);
    return {
      headPitch: -1.25 * (1 - up),
      bow: 0.3 * (1 - up),
      mouth: Math.sin(tl * 9) > 0 ? 0.3 : 0,
      tailWag: 0.2 * Math.sin(tl * 3),
    };
  },
  groom: (tl) => ({
    curl: 0.5,
    sit: 0.35,
    headYaw: 1.45,
    headPitch: -0.5 + 0.15 * Math.sin(tl * 8),
    reach: 1,
    hand: 0.5 + 0.5 * Math.sin(tl * 3),
  }),
  scratch: (tl) => ({ sit: 0.65, scratch: 1, headRoll: 0.35, headPitch: -0.1, hand: 0.5 + 0.5 * Math.sin(tl * 20) }),
  sit: (tl) => ({ sit: 1, headYaw: 0.4 * Math.sin(tl * 0.5), tailWag: 0.1 * Math.sin(tl) }),
  lie: (tl) => ({ lie: 1, headYaw: 0.3 * Math.sin(tl * 0.4), headPitch: -0.15 }),
  sleep: (tl) => ({ lie: 1, sit: 0.3, curl: 1, headPitch: -0.45, earBack: 0.6, lift: 0.04 * Math.sin(tl * 1.6) }),
  stretch: (_tl, k) => ({ bow: bump(k / 0.6), tailUp: 0.8 * bump(k), rear: 0.2 * bump((k - 0.6) / 0.4) }),
  shake: (_tl, k) => ({ shake: bump(k), earBack: 0.4 }),
  yawn: (_tl, k) => ({ mouth: bump(k), headPitch: 0.5 * bump(k), sit: 0.3 }),
  rear: (tl) => ({ rear: 1, headYaw: 0.6 * Math.sin(tl * 0.8), earBack: -0.4 }),
  dig: (tl) => ({ dig: 1, crouch: 0.25, headPitch: -0.6, tailUp: 0.3 + 0.1 * Math.sin(tl * 7) }),
  roll: (_tl, k) => ({ lie: 1, roll: bump(k), tailWag: 0.5 * bump(k) }),
  howl: (_tl, k) => ({ sit: 1, headPitch: 1.15 * bump(k * 1.1), mouth: 0.55 * bump(k * 1.1), earBack: 0.5 }),
  eat: (tl) => ({ sit: 1, hand: 1, mouth: Math.sin(tl * 10) > 0 ? 0.35 : 0, headPitch: -0.15, rear: 0.2 }),
  peck: (tl) => ({ peck: pulse(tl, 0.55, 0.45), headPitch: -0.3 }),
  preen: (tl) => ({ headYaw: 2.3, headPitch: -0.45 + 0.1 * Math.sin(tl * 9), wing: 0.25 }),
  flap: (tl, k) => ({
    wing: bump(k * 1.05) > 0.1 ? 1 : bump(k * 1.05) * 10,
    flap: Math.sin(tl * 22),
    hop: 0.15 * Math.abs(Math.sin(tl * 11)),
  }),
  sing: (tl) => ({ headPitch: 0.45, mouth: Math.abs(Math.sin(tl * 13)) * 0.8, tailWag: 0.2 * Math.sin(tl * 6) }),
  display: (tl, k, d) => ({
    fan: smooth(Math.min(k * d, (1 - k) * d) / 0.8),
    wing: 0.7,
    flap: 0.4 * Math.sin(tl * 4),
    hop: 0.5 * Math.max(0, Math.sin(tl * 3.2)),
    headPitch: 0.3,
  }),
  drum: (tl) => ({ peck: pulse(tl, 0.09, 0.9) * (pulse(tl, 1.6, 0.6) > 0 ? 1 : 0) }),
  bask: (tl) => ({ lie: 1, headPitch: 0.15 + 0.05 * Math.sin(tl * 0.5) }),
  coil: (tl) => ({ curl: 1, lie: 1, headPitch: 0.2, headYaw: 0.3 * Math.sin(tl * 0.3) }),
  flick: (tl) => ({ mouth: pulse(tl, 0.5, 0.5), headPitch: 0.25, lie: 1 }),
  hover: (tl) => ({ flap: Math.sin(tl * 18), lift: 0.5 + 0.15 * Math.sin(tl * 1.3) }),
  wave: (tl) => ({ reach: 0.5 + 0.5 * Math.sin(tl * 7), hand: Math.abs(Math.sin(tl * 3.5)) }),
  hang: (tl) => ({ hang: 1, headYaw: 0.4 * Math.sin(tl * 0.3), hand: 0.5 + 0.5 * Math.sin(tl * 0.8) }),
  nuzzle: (tl) => ({
    headPitch: -0.3 + 0.08 * Math.sin(tl * 3),
    crouch: 0.1,
    headYaw: 0.15 * Math.sin(tl * 2),
    tailWag: 0.7 * Math.sin(tl * 7),
    earBack: 0.3,
  }),
  play: (tl) => ({
    bow: 1,
    tailWag: Math.sin(tl * 10),
    tailUp: 0.6,
    hop: 0.35 * Math.abs(Math.sin(tl * 5)),
    headYaw: 0.25 * Math.sin(tl * 3),
  }),
  wander: () => ({}),
  run: () => ({ earBack: 0.5, tailUp: 0.3 }),
  hop: () => ({}),
  climb: () => ({}),
  fly: () => ({ wing: 1, flap: 1 }),
  // A hunter creeping up: low, head level and still, ears forward, tail down.
  stalk: (tl) => ({
    crouch: 0.6,
    headPitch: 0.05,
    headYaw: 0.06 * Math.sin(tl * 0.7),
    earBack: -0.4,
    tailUp: -0.25,
    tailWag: 0.12 * Math.sin(tl * 5),
  }),
};

export const FADE = 0.45;

export function paramsOf(segment: Segment, t: number): Pose {
  const d = Math.max(0.01, segment.t1 - segment.t0);
  const tl = Math.max(0, t - segment.t0);
  return { ...restPose(), ...ACTION_POSE[segment.act](tl, clamp(tl / d, 0, 1), d) };
}

/** The pose at `t`, cross-faded from the action before for the first moments of this one. */
function blendedPose(segment: Segment, prev: Segment | undefined, t: number): Pose {
  const now = paramsOf(segment, t);
  const k = smooth((t - segment.t0) / FADE);
  if (!prev || k >= 1) return now;
  const before = paramsOf(prev, Math.min(t, prev.t1 + FADE));
  return Object.fromEntries(POSE_KEYS.map((key) => [key, mix(before[key], now[key], k)])) as Pose;
}

export interface Moment {
  readonly frame: Frame;
  /** For a body that lies along its way, a snake: that way in the world, from its head back. */
  readonly trail?: readonly Vec[] | undefined;
  /** Gait phase, in strides. */
  readonly phase: number;
  /** 0 standing, 1 moving at full gait. */
  readonly moving: number;
  readonly pace: number;
  readonly mode: MoveMode | null;
  readonly segment: Segment;
  readonly pose: Pose;
  /** Facing a partner: where its head is. */
  readonly t: number;
}

function segmentAt(actor: Actor, t: number): { segment: Segment; prev: Segment | undefined } {
  const list = actor.segments;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const segment = list[i];
    if (segment && segment.t0 <= t) return { segment, prev: list[i - 1] };
  }
  const first = list[0];
  if (!first) throw new Error("fauna: an actor has no timeline");
  return { segment: first, prev: undefined };
}

const turnToward = (from: number, to: number, k: number): number =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

/** A flier's heading: it climbs and dives at a slant, never nose to the sky. */
const level = (v: Vec): Vec => dirOf(Math.atan2(v[0], v[2]), clamp(Math.asin(clamp(v[1], -1, 1)), -0.5, 0.45));

const TURN_TIME = 0.4;
/** How far the body travels in one gait cycle; a foot planted for `duty` of it moves back `duty` of this. */
export const bodyStride = (who: Who): number => who.member.size * Math.max(0.5, who.spec.build.len) * 1.1;

/** The way back from `share` along a path: where the body is now, then each bend behind it, nearest first. */
function trailBehind(path: readonly PathPoint[], share: number): Vec[] {
  const want = share * pathLength(path);
  const back: Vec[] = [];
  let walked = 0;
  path.forEach((point, i) => {
    const before = path[i - 1];
    if (before) walked += length(sub(point.p, before.p));
    if (walked < want) back.unshift(point.p);
  });
  return [alongPath(path, share).p, ...back];
}

/** The wood behind a perch, from its tip back to the trunk and down it. */
function perchTrail(place: Place, scene: Scene): Vec[] | undefined {
  const way = branchWay(place, scene.stage);
  if (!way) return undefined;
  // (Winding round the trunk at one pitch: two that share it, from different limbs, never cross.)
  const wound = Array.from({ length: TRUNK_WINDS }, (_, i) => {
    const h = way.foot.h * (1 - (i + 1) / TRUNK_WINDS);
    return trunkPoint(scene.stage, h, way.foot.a + (way.foot.h - h) * TRUNK_PITCH).p;
  });
  return [...[...way.points].reverse().map((point) => point.p), ...wound];
}

const TRUNK_WINDS = 10;
const TRUNK_PITCH = 11;
export const liesAlong = (actor: Actor): boolean => actor.spec.plan === "serpent" && actor.spec.build.leg === 0;

export function movingFrame(
  actor: Actor,
  segment: Segment,
  t: number,
  scene: Scene,
  from = segment.yaw,
): { frame: Frame; phase: number; moving: number; trail?: readonly Vec[] } {
  const mode = segment.mode ?? "walk";
  const path = pathFor(
    mode,
    segment.from,
    segment.to,
    scene,
    actor.member.size,
    springOf(actor),
    segment.loop,
    segment.via,
  );
  const d = Math.max(0.01, segment.t1 - segment.t0);
  const u = clamp((t - segment.t0) / d, 0, 1);
  const stride = bodyStride(actor);
  let share = 0.75 * u + 0.25 * smooth(u);
  if (mode === "climb") {
    // A climber reaches, grips and pulls: it all but stops while a hand goes
    // up, then surges as it hauls itself after it, once for each hand.
    const total = Math.max(1e-6, pathLength(path));
    const along = share * total;
    const reach = stride * 0.5;
    share = clamp((along - (reach * 0.7 * Math.sin((TAU * along) / reach)) / TAU) / total, 0, 1);
  }
  const at = alongPath(path, share);
  // Climbing, it follows the wood's slope; walking, it keeps level, and it
  // turns onto its way over its first steps instead of all at once.
  let fw = mode === "climb" ? at.fw : mode === "fly" ? level(at.fw) : flat(at.fw);
  const turning = (t - segment.t0) / TURN_TIME;
  if (mode !== "climb" && turning < 1)
    fw = dirOf(turnToward(from, Math.atan2(fw[0], fw[2]), smooth(turning)), Math.asin(clamp(fw[1], -1, 1)));
  const moving = clamp(Math.min(1, (t - segment.t0) / 0.25, (segment.t1 - t) / 0.25), 0, 1);
  if (mode === "fly")
    return { frame: flyingFrame(actor, segment, t, path, share, at.p, fw), phase: at.travelled / stride, moving };
  const p = add(mode === "climb" ? outOfWood(at.p, scene.stage) : at.p, [
    0,
    hopLift(actor, segment, mode, at.travelled) * moving,
    0,
  ]);
  return {
    frame: frameOf(p, fw, at.up),
    phase: at.travelled / stride,
    moving,
    ...(mode === "climb" && liesAlong(actor) ? { trail: trailBehind(path, share) } : {}),
  };
}

/**
 * A point on a way, brought out of any wood it cuts: a straight stretch between two bends runs through the bend's
 * inside, and through a fork's other limb.
 */
function outOfWood(p: Vec, stage: Stage): Vec {
  const map = woodMapOf(stage);
  let out: Vec = [0, 0, 0];
  let deepest = 0;
  for (const { a, b } of woodNear(map, p, map.thickest)) {
    const depth = -offWood(p, a, b);
    if (depth <= deepest) continue;
    const ab = sub(b.p, a.p);
    const k = clamp(dot(sub(p, a.p), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
    deepest = depth;
    out = scale(unit(sub(p, madd(a.p, ab, k)), UP), depth);
  }
  return add(p, out);
}

/**
 * A flier's frame along its way: banked into its turns (its up tipped toward
 * the turn's middle, by how hard it turns at its speed), and, for a bird
 * that bounds, rising on each burst of wingbeats and dipping with its wings
 * shut.
 */
function flyingFrame(
  actor: Actor,
  segment: Segment,
  t: number,
  path: readonly PathPoint[],
  share: number,
  p: Vec,
  fw: Vec,
): Frame {
  const total = Math.max(1e-6, pathLength(path));
  const span = Math.max(0.01, segment.t1 - segment.t0);
  const step = Math.min(0.08, 0.5 / total);
  const before = alongPath(path, Math.max(0, share - step));
  const after = alongPath(path, Math.min(1, share + step));
  const up =
    actor.spec.plan === "bird" ? bankedUp(before.fw, after.fw, after.travelled - before.travelled, total / span) : UP;
  const style = actor.spec.plan === "bird" ? wingStyle(actor) : null;
  if (!style?.bound) return frameOf(p, fw, up);
  const since = clamp(t - segment.t0, 0, span);
  const c = (since / style.bout + ownPhase(actor)) % 1;
  const rise = c < 0.6 ? smooth(c / 0.6) : 1 - smooth((c - 0.6) / 0.4);
  const fade = Math.min(1, since / 1, (span - since) / 1);
  return frameOf(add(p, [0, actor.member.size * 0.5 * (rise - 0.5) * Math.max(0, fade), 0]), fw, up);
}

/** A bird going a little way on the ground goes in hops, not a glide. */
function hopLift(actor: Actor, segment: Segment, mode: MoveMode, travelled: number): number {
  if (mode !== "walk" || segment.act !== "hop" || actor.spec.plan !== "bird") return 0;
  const size = actor.member.size;
  return size * 0.22 * Math.abs(Math.sin((Math.PI * travelled) / (size * 0.8)));
}

/**
 * Which way an animal sits on a branch: a bird across it, gripping it, facing the side it came in on; others along it.
 */
function perchYaw(actor: Actor, along: Vec, came: number): number {
  const yaw = Math.atan2(along[0], along[2]);
  if (actor.spec.plan !== "bird") return yaw;
  const left = yaw + Math.PI / 2;
  return Math.cos(left - came) >= 0 ? left : yaw - Math.PI / 2;
}

function restingFrame(
  actor: Actor,
  segment: Segment,
  t: number,
  scene: Scene,
  partners: readonly Actor[],
  turn = segment.turn,
): Frame {
  const anchor = anchorOf(segment.to, scene.stage, scene.backs);
  if (segment.to.on === "trunk") {
    return segment.act === "drum" || actor.spec.plan === "bird"
      ? frameOf(madd(anchor.p, anchor.up, actor.member.size * 0.15), scale(anchor.up, -1), UP)
      : frameOf(anchor.p, UP, anchor.up);
  }
  let yaw = anchor.along ? perchYaw(actor, anchor.along, segment.yaw) : segment.yaw;
  const partner = segment.face >= 0 ? partners[segment.face] : undefined;
  if (partner) yaw = turnToward(turn ?? segment.yaw, yawFrom(anchor.p, partner.pos), smooth((t - segment.t0) / 0.6));
  else if (turn !== undefined && !anchor.along)
    yaw = turnToward(turn, segment.yaw, smooth((t - segment.t0) / (TURN_TIME * 2)));
  return frameOf(anchor.p, dirOf(yaw, 0), anchor.up);
}

export const frameYaw = (f: Frame): number => Math.atan2(f.z[0], f.z[2]);

export function momentOf(actor: Actor, t: number, scene: Scene, partners: readonly Actor[]): Moment {
  const { segment, prev } = segmentAt(actor, t);
  const pose = blendedPose(segment, prev, t);
  // Each action turns on from the heading the last one really ended on (a
  // partner it watched may have moved on; a short look may not have finished
  // turning), so the body never snaps round between them.
  const from = prev?.mode === null && prev.to.on === "ground" ? frameYaw(restingFrame(actor, prev, t, scene, partners)) : undefined;
  if (segment.mode) {
    const { frame, phase, moving, trail } = movingFrame(actor, segment, t, scene, from);
    return {
      frame,
      trail: trail && overLimbs(trail, actor, scene.stage),
      phase,
      moving,
      pace: segment.pace,
      mode: segment.mode,
      segment,
      pose,
      t,
    };
  }
  const trail = liesAlong(actor) ? perchTrail(segment.to, scene) : undefined;
  const lying = trail && overLimbs(trail, actor, scene.stage);
  return {
    frame: restingFrame(actor, segment, t, scene, partners, from ?? segment.turn),
    trail: lying,
    phase: 0,
    moving: 0,
    pace: 0,
    mode: null,
    segment,
    pose,
    t,
  };
}


/** A trail lifted over each limb that lies across it, so a snake on the trunk drapes over the branches it meets. */
function overLimbs(trail: readonly Vec[], actor: Actor, stage: Stage): Vec[] {
  const limbs = woodMapOf(stage);
  const r = actor.spec.build.body * actor.member.size * 2.4;
  return trail.map((p) => add(p, clearOfLimbs({ balls: [p], r, weight: 1, side: UP }, limbs)));
}

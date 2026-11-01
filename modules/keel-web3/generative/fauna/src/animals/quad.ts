// Four legs: the quadruped's gaits, spine, stance, feet, paws and legs.

import { TAU, UP, add, clamp, lerpV, madd, mix, solveTwoBone, sub } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import { HOPPERS } from "../roster.js";
import type { Action, Build, Foot, Role, SitStyle } from "../roster.js";
import { bodyStride } from "../stage/moments.js";
import type { Moment, Pose } from "../stage/moments.js";
import { buildOf, cap, cone, footCycle } from "./kit.js";
import type { Kit } from "./kit.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- four legs

/**
 * A four-legged body: its pelvis P and shoulders S, and how far it is into
 * each way of resting. Each rest is its own fold (a dog's sit drops the rump
 * by the heels with the forelegs straight; a deer folds its legs under and
 * lies), never one straight spine tipped up from the hip.
 */
export interface QuadBody {
  readonly P: Vec;
  readonly S: Vec;
  readonly r: number;
  readonly w: number;
  readonly L: number;
  readonly legF: number;
  readonly legH: number;
  readonly sit: number;
  readonly loaf: number;
  readonly lie: number;
  readonly rump: number;
  readonly haunch: number;
  readonly rear: number;
  readonly gait: QuadGait;
  /** 0 standing still, 1 striding (and not resting). */
  readonly free: number;
}


export const LEG = ["FL", "FR", "HL", "HR"] as const;
type LegId = (typeof LEG)[number];
const sideOf = (leg: LegId): number => (leg.endsWith("L") ? -1 : 1);
const foreLeg = (leg: LegId): boolean => leg.startsWith("F");

/**
 * Lateral-sequence walk, diagonal trot, rotary gallop, the hopper's bound
 * (forefeet, then the hind pair landing past them) and the kangaroo's hop
 * (both hind feet at once). `flex` bends the spine through each stride; the
 * airborne gaits leave the ground between footfalls.
 */
const QUAD_GAITS = {
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.64, lift: 0.14, bob: 0.02, flex: 0.01, air: 0 },
  trot: { at: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, duty: 0.45, lift: 0.2, bob: 0.03, flex: 0.02, air: 0 },
  gallop: { at: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.52 }, duty: 0.26, lift: 0.26, bob: 0.03, flex: 0.08, air: 0.2 },
  bound: { at: { HL: 0, HR: 0.04, FL: 0.5, FR: 0.54 }, duty: 0.24, lift: 0.3, bob: 0.04, flex: 0.1, air: 0.6 },
  hop: { at: { HL: 0, HR: 0, FL: 0.5, FR: 0.5 }, duty: 0.28, lift: 0.3, bob: 0.03, flex: 0.04, air: 0.7 },
} as const;
type QuadGait = (typeof QUAD_GAITS)[keyof typeof QUAD_GAITS];

/** Two-legged hoppers (a kangaroo): short forelegs held off the ground. */
const bipedal = (b: Build): boolean => b.fore < 0.6;

function quadGait(actor: Who, m: Moment): QuadGait {
  const b = buildOf(actor);
  if (bipedal(b)) return QUAD_GAITS.hop;
  // (A rabbit hops at any pace; it never walks a lateral sequence.)
  if (HOPPERS.has(actor.member.species) && (m.pace > 1.2 || actor.member.species === "rabbit")) return QUAD_GAITS.bound;
  if (m.pace > 3.6 && b.foot !== "plant" && b.sit !== "tuck") return b.foot === "hoof" ? QUAD_GAITS.bound : QUAD_GAITS.gallop;
  return m.pace > 2.2 ? QUAD_GAITS.trot : QUAD_GAITS.walk;
}

/** Standing heights: the shoulders at the animal's size for a usual leg, lower for short legs, higher for long. */
export const shoulderOf = (b: Build, size: number): number => size * 0.92 * Math.pow(clamp(b.leg / 0.6, 0.2, 1.4), 0.8);

/**
 * The body through a stride: walking it bobs twice a stride; the airborne
 * gaits rise off the ground between footfalls, and the spine flexes (the
 * chest up as the pelvis drops) and stretches through each one.
 */
/**
 * How far through a moment with every foot off the ground the stride is (0
 * on the ground, rising to 1 at the top of the leap and back): between one
 * pair's last footfall and the next pair's first.
 */
function airborne(gait: QuadGait, phase: number): number {
  if (gait.air <= 0) return 0;
  const u = phase - Math.floor(phase);
  let last = -Infinity;
  let next = Infinity;
  for (const at of Object.values(gait.at)) {
    for (const k of [-1, 0, 1]) {
      const down = at + k;
      const up = down + gait.duty;
      if (u >= down && u < up) return 0;
      if (up <= u) last = Math.max(last, up);
      if (down > u) next = Math.min(next, down);
    }
  }
  return Math.sin((Math.PI * (u - last)) / Math.max(1e-6, next - last));
}

/** Which way a leap is going: rising toward 1 on the way up, falling toward -1 on the way down, 0 on the ground. */
function leaping(gait: QuadGait, phase: number): number {
  const up = airborne(gait, phase + 0.012) - airborne(gait, phase - 0.012);
  return clamp(up * 9, -1, 1);
}

function strideOf(
  gait: QuadGait,
  m: Moment,
  q: Pose,
  size: number,
  r: number,
  free: number,
): { lift: number; flex: number; reach: number } {
  const cyc = TAU * m.phase;
  const arc = airborne(gait, m.phase);
  // (A leap gathers on the ground: it sinks over its feet, drives up nose first and comes down nose first.)
  const bob = gait.bob * size * Math.cos(cyc * 2) + gait.air * size * (arc - 0.08 * (1 - arc) ** 2);
  const hop = q.hop * 0.3 * size * (gait.air > 0 ? 2 : 1.6);
  const lift = -q.crouch * 0.25 * size + free * bob + q.lift * r + hop;
  return {
    lift,
    flex: free * size * (gait.flex * Math.sin(cyc) + gait.air * 0.55 * leaping(gait, m.phase)),
    reach: free * (gait.flex * size * 0.7 * Math.cos(cyc) + gait.air * size * 0.3 * arc),
  };
}

/** How far into each way of resting: an action's sit becomes this animal's own sit (a deer lies, a bear sits back). */
function restsOf(
  b: Build,
  q: Pose,
  m: Moment,
): { sit: number; loaf: number; rump: number; haunch: number; lie: number; rear: number } {
  const own = (style: SitStyle): number => (b.sit === style ? q.sit : 0);
  const lie = b.sit === "lie" || b.sit === "tuck" ? Math.max(q.lie, q.sit) : q.lie;
  const loaf = own("loaf");
  // (A kangaroo stands tall at rest and pitches forward as it hops.)
  const rear = (bipedal(b) ? Math.max(q.rear, 1 - 0.55 * m.moving) : q.rear) * (1 - lie) * (1 - loaf);
  return { sit: own("dog"), loaf, rump: own("rump"), haunch: own("haunch"), lie, rear };
}

/** How far an animal that stoops has its nose down, 0 to 1, on all fours only. */
export function nosing(b: Build, q: Pose): number {
  return b.stoop === undefined ? 0 : clamp(-q.headPitch / 0.55, 0, 1) * (1 - clamp(q.sit + q.lie + q.curl, 0, 1));
}

export function quadSpine(actor: Who, q: Pose, m: Moment): QuadBody {
  const size = actor.member.size;
  const b = buildOf(actor);
  const L = b.len * size;
  const r = b.body * size;
  // (Shorter forelegs set the shoulders lower: a rabbit's back slopes down to its head.)
  const stand = shoulderOf(b, size);
  const shY = stand * (bipedal(b) ? 1 : b.fore);
  const hipY = stand * b.hip;
  const { sit, loaf, rump, haunch, lie, rear } = restsOf(b, q, m);
  const hu = r * b.haunch;
  let P: Vec = [0, hipY, -L / 2];
  let S: Vec = [0, shY, L / 2];
  // A dog's sit: the rump down by its heels and the back raised steeply, the
  // body drawn up short over straight forelegs (the shoulders stay where
  // they stood, so the forelegs still reach the ground).
  const sitA = 1.0;
  const sitL = clamp((shY * 0.97 - hu * 0.95) / Math.sin(sitA), L * 0.45, L);
  const sitS: Vec = [0, hu * 0.95 + sitL * Math.sin(sitA), L * 0.42];
  P = lerpV(P, madd(sitS, [0, -Math.sin(sitA), -Math.cos(sitA)], sitL), sit);
  S = lerpV(S, sitS, sit);
  // Up on its haunches (forepaws free), or back on its rump like a bear.
  // (Sitting up, the body draws up short: it is upright, not a long ramp.)
  const up = haunch + rump;
  const upP: Vec = [0, hu * 0.9, -L * 0.1];
  const upA = rump > 0 ? 1.2 : 1.3;
  P = lerpV(P, upP, up);
  S = lerpV(S, madd(upP, [0, Math.sin(upA), Math.cos(upA)], L * 0.72), up);
  // Up on its hind legs: upright for the animals that sit up (a meerkat on watch), leaning for the rest.
  const rearP: Vec = [0, hipY * 0.95, -L * 0.12];
  const rearA = bipedal(b) ? 1.28 : b.sit === "haunch" ? 1.42 : 1.25;
  const rearK = rear * (1 - sit) * (1 - up);
  P = lerpV(P, rearP, rearK);
  S = lerpV(S, madd(rearP, [0, Math.sin(rearA), Math.cos(rearA)], L * (bipedal(b) ? 1 : 0.85)), rearK);
  // Lying, or loafed with every foot tucked under and the back hunched.
  const down = Math.max(lie, loaf);
  P = lerpV(P, [0, hu * 1.0, -L / 2], down);
  S = lerpV(S, [0, r * b.chest * (loaf > lie ? 1.25 : 1.05), L * (loaf > lie ? 0.42 : 0.5)], down);
  S = madd(S, UP, -q.bow * Math.max(0, S[1] - r * 1.4) * 0.55);
  S = madd(S, UP, -nosing(b, q) * (b.stoop ?? 0) * r);
  const gait = quadGait(actor, m);
  const free = m.moving * (1 - sit) * (1 - down) * (1 - up);
  const { lift, flex, reach } = strideOf(gait, m, q, size, r, free);
  // (However hard it lands, the belly stays out of the ground.)
  const belly = free > 0 ? r * 1.5 : -Infinity;
  P = [P[0], Math.max(P[1] + lift - flex, Math.min(P[1], belly)), P[2] - reach];
  S = [S[0], Math.max(S[1] + lift + flex, Math.min(S[1], belly)), S[2] + reach];
  return {
    P,
    S,
    r,
    w: r * (b.stance ?? 0.72),
    L,
    legF: (shY - r * 0.45) * (bipedal(b) ? b.fore : 1),
    legH: hipY - r * 0.2,
    sit,
    loaf,
    lie,
    rump,
    haunch,
    rear,
    gait,
    free,
  };
}

/** Each foot's share of its leg: the paw's pastern and hock, a hoof's long cannon, a sole laid flat. */
const LOWER: Readonly<Record<Foot, { fore: number; hind: number; foreTilt: number; hindTilt: number }>> = {
  paw: { fore: 0.2, hind: 0.3, foreTilt: -0.25, hindTilt: 0.22 },
  hoof: { fore: 0.32, hind: 0.38, foreTilt: -0.05, hindTilt: 0.12 },
  plant: { fore: 0.16, hind: 0.24, foreTilt: -1.1, hindTilt: 1.3 },
};

interface FootPlan { readonly foot: Vec; readonly tilt: number }

/**
 * Where a foot rests and how its lowest bone lies: `tilt` turns that bone from
 * upright; on a hind leg a positive tilt sets the hock behind the foot, on a
 * foreleg it sets the wrist ahead of the paw.
 */
function stanceFoot(b: Build, body: QuadBody, leg: LegId, q: Pose): FootPlan {
  const x = sideOf(leg);
  const { P, S, w, L, legF, legH, r } = body;
  const low = LOWER[b.foot];
  if (foreLeg(leg)) {
    // (A foreleg made as a column stands right under its shoulder.)
    let foot: Vec = [x * w, 0, b.legMake ? S[2] - r * 0.1 : S[2] + 0.05 * L];
    let tilt = b.legMake ? 0 : low.foreTilt;
    foot = lerpV(foot, [x * w * 0.9, 0, S[2] + 0.04 * L], body.sit);
    // A bear sits back with its forepaws down between its knees; a squirrel holds them to its mouth.
    foot = lerpV(foot, [x * w * 0.75, 0, S[2] + L * 0.12], body.rump);
    tilt = mix(tilt, -0.8, body.rump);
    foot = lerpV(foot, add(S, [x * w * 0.55, -r * 0.05, r * 1.0 + legF * 0.12]), body.haunch);
    tilt = mix(tilt, 2.4, body.haunch);
    // Lying: a dog's forearms flat out in front (a sphinx); a deer's folded back under its chest.
    const hoof = b.foot === "hoof";
    foot = lerpV(foot, hoof ? [x * w * 0.9, 0, S[2] - legF * 0.05] : [x * w * 1.05, 0, S[2] + legF * 0.62], body.lie);
    tilt = mix(tilt, hoof ? 1.5 : -1.5, body.lie);
    foot = lerpV(foot, [x * w * 0.8, 0, S[2] + r * 0.25], body.loaf);
    tilt = mix(tilt, 1.45, body.loaf);
    foot = lerpV(foot, [x * w, 0, S[2] + legF * 0.55], q.bow);
    tilt = mix(tilt, -1.3, q.bow);
    const rear = bipedal(b) ? 1 : body.rear * (1 - body.sit) * (1 - body.lie);
    foot = lerpV(
      foot,
      add(S, bipedal(b) ? [x * w * 1.05, -legF * 0.62, legF * 0.62] : [x * w * 0.9, -legF * 0.42, legF * 0.3]),
      rear,
    );
    tilt = mix(tilt, 1.0, rear);
    return { foot, tilt };
  }
  let foot: Vec = [x * w, 0, b.legMake ? P[2] + r * 0.25 : P[2]];
  let tilt = low.hindTilt;
  // Every fold lays the hock flat on the ground with the foot out ahead of it.
  const folded = Math.max(body.sit, body.haunch, body.loaf);
  foot = lerpV(foot, [x * w * 1.35, 0, P[2] + L * 0.24], folded);
  tilt = mix(tilt, 1.5, folded);
  foot = lerpV(foot, [x * w * 1.6, 0, P[2] + L * 0.32], body.lie);
  tilt = mix(tilt, 1.5, body.lie);
  // A bear on its rump: legs out in front, soles to the world.
  foot = lerpV(foot, [x * w * 1.5, legH * low.hind * 0.9, P[2] + L * 0.72], body.rump);
  tilt = mix(tilt, 2.9, body.rump);
  return { foot, tilt };
}

export function quadFoot(actor: Who, body: QuadBody, leg: LegId, q: Pose, m: Moment, head: Vec): FootPlan {
  const b = buildOf(actor);
  const plan = stanceFoot(b, body, leg, q);
  let { foot, tilt } = plan;
  const gait = body.gait;
  const fore = foreLeg(leg);
  // (A kangaroo's forepaws stay up off the ground while it hops.)
  const grounded = !(fore && (body.rear > 0.5 || bipedal(b)));
  if (body.free > 0 && grounded) {
    const lift = gait.lift * (fore ? body.legF : body.legH);
    const c = footCycle(m.phase - gait.at[leg], gait.duty, gait.duty * bodyStride(actor), lift);
    // (In a leap every foot is off the ground with the body: a rabbit's hop, a deer's bound.)
    const arc = airborne(gait, m.phase);
    const air = gait.air * actor.member.size * arc;
    // (Up there the legs reach out: the hind pair trailing from the push, the fore pair stretching for the ground.)
    const reach = (fore ? 1 : -1) * gait.air * body.legH * 1.1 * arc;
    foot = add(foot, [0, (c.y + air * 0.8) * body.free, (c.z + reach) * body.free]);
    // Swinging, the paw flips back under the wrist and the toes trail the hock.
    const swing = (c.y / Math.max(1e-9, lift)) * body.free;
    tilt += swing * (fore ? 1.5 : -0.95);
  }
  return pawWork({ foot, tilt }, body, leg, q, m.t, head);
}

/** A hind paw scratching behind an ear, forepaws digging. */
function pawWork(plan: FootPlan, body: QuadBody, leg: LegId, q: Pose, t: number, head: Vec): FootPlan {
  let { foot, tilt } = plan;
  if (leg === "HR" && q.scratch > 0) foot = add(lerpV(foot, add(head, [body.w * 1.4, -body.r * 0.9, -body.r * 1.2]), q.scratch * 0.85), [0, Math.sin(t * 26) * body.r * 0.3 * q.scratch, 0]);
  if (foreLeg(leg) && q.dig > 0) {
    const s = Math.sin(t * 14 + (sideOf(leg) > 0 ? Math.PI : 0));
    foot = add(foot, [0, Math.max(0, s) * body.legF * 0.25 * q.dig, s * body.legF * 0.3 * q.dig]);
    tilt += Math.max(0, s) * q.dig;
  }
  return { foot, tilt };
}

/**
 * One leg in three bones: the upper bone thick where it leaves the body,
 * the middle one slimmer, and the lowest (pastern, cannon, hock or sole)
 * slimmest, down to a paw, a hoof or a flat foot. A hind leg zigzags (the
 * knee forward, the hock back); a foreleg's elbow sits behind.
 */
/**
 * Each foot's radius as a share of the leg's, and the leg's thickness down its two upper bones (root, knee, knee,
 * joint).
 */
const SOLE: Readonly<Record<Foot, number>> = { paw: 0.6, hoof: 0.78, plant: 0.55 };
const LEG_TAPER = { fore: [1.45, 0.95, 0.9, 0.68], hind: [1.95, 1.1, 1.0, 0.62] } as const;

/** Which way a leg's middle joint bends: a knee forward, an elbow back, a folded knee out to the side. */
function poleOf(fore: boolean, body: QuadBody, b: Build, x: number): Vec {
  // (A tortoise's foreleg bows out from under its shell, the elbow to the side.)
  if (fore && b.extras.includes("shell")) return [x, 0, -0.35];
  if (fore) return body.lie > 0.5 && b.foot !== "hoof" ? [0, 1, -0.3] : [0, 0, -1];
  if (Math.max(body.lie, body.loaf, body.sit, body.haunch) > 0.5) return [x * 0.7, 0.5, 0.6];
  // (Standing, a soft leg's joint is its hock, behind the foot, where another's is a knee ahead of it.)
  return [0, 0, b.legMake ? -1 : 1];
}

/** A leg as it was drawn, for what a body spends on it last: its joints and what its foot stands on. */
export interface LegLine {
  readonly name: string;
  readonly root: Vec;
  readonly mid: Vec;
  readonly sole: Vec;
  readonly ground: number;
  readonly legR: number;
  readonly x: number;
}

export function quadLeg(kit: Kit, actor: Who, body: QuadBody, leg: LegId, plan: FootPlan, lines: LegLine[]): void {
  const b = buildOf(actor);
  const x = sideOf(leg);
  const fore = foreLeg(leg);
  const legR = Math.max(0.004, body.r * 0.32 * b.legR);
  // (A shell hides where a leg starts: from well up inside it, so all of a column shows below the rim.)
  const hidden = b.extras.includes("shell") ? body.r * 0.34 : 0;
  const reach = (fore ? body.legF : body.legH) + hidden;
  const { share, lean, upper, lower } = lowOf(b, fore);
  const lowLen = reach * share;
  const root = fore
    ? add(body.S, [x * body.w * 0.85, hidden - body.r * 0.45, -body.r * 0.1])
    : add(body.P, [x * body.w, hidden - body.r * 0.2, hidden * 0.6]);
  const span = Math.max(1e-4, reach - lowLen * Math.cos(lean));
  const dir: Vec = [0, Math.cos(plan.tilt), Math.sin(plan.tilt) * (fore ? 1 : -1)];
  const plantR = legR * (b.legMake ? 0.72 : SOLE[b.foot]);
  const sole: Vec = add(plan.foot, [0, plantR, 0]);
  const { mid, end } = solveTwoBone(
    root,
    madd(sole, dir, lowLen),
    span * upper,
    span * lower,
    poleOf(fore, body, b, x),
  );
  const name = `leg.${leg}`;
  const [r0, r1, r2, r3] = taperOf(b, fore);
  if (b.extras.includes("shell")) { columnLeg(kit, name, [root, mid, end], [r0, r1, r2, r3], legR, fore);
  stumpFoot(kit, name, sole, legR, fore, x);
  return; }
  lines.push({ name, root, mid, sole, ground: plan.foot[1], legR, x });
  cone(kit, `${name}.upper`, "coat", root, mid, legR * r0, legR * r1);
  cone(kit, `${name}.lower`, "coat", mid, end, legR * r2, legR * r3, b.legMake ? 0.8 : 0.45);
  if (b.legMake) softPaw(kit, b, name, sole, legR, fore);
  else footParts(kit, b, name, end, sole, legR, plantR);
}

/** A tortoise's leg: a tapered column, the foreleg's front flattened into a shield for its big scales. */
function columnLeg(
  kit: Kit,
  name: string,
  [root, mid, end]: readonly [Vec, Vec, Vec],
  [r0, r1, r2, r3]: readonly [number, number, number, number],
  legR: number,
  fore: boolean,
): void {
  const flat = fore ? 0.78 : 1;
  cap(kit, `${name}.upper`, "coat", root, mid, legR * r0, flat, [0, 0, 1], { r1: legR * r1, melt: 0.6 });
  cap(kit, `${name}.lower`, "coat", mid, end, legR * r2, flat, [0, 0, 1], { r1: legR * r3, melt: 0.5 });
}

/**
 * A leg's lowest bone: its share of the leg and how it leans at rest; and the two upper bones, as shares of what is
 * left.
 */
function lowOf(b: Build, fore: boolean): { share: number; lean: number; upper: number; lower: number } {
  const low = LOWER[b.foot];
  if (b.legMake) {
    const [upper, lower] = fore ? [b.foreBone, b.foreBone] : b.legMake.hindBones;
    return { share: 0, lean: 0, upper, lower };
  }
  if (fore) return { share: low.fore, lean: low.foreTilt, upper: b.foreBone, lower: b.foreBone };
  // (A kangaroo's hind foot is long: it stands on it.)
  return { share: bipedal(b) ? 0.42 : low.hind, lean: low.hindTilt, upper: 0.56, lower: 0.56 };
}

const taperOf = (b: Build, fore: boolean): readonly [number, number, number, number] =>
  fore ? (b.legMake?.fore ?? b.taper?.fore ?? LEG_TAPER.fore) : (b.legMake?.hind ?? b.taper?.hind ?? LEG_TAPER.hind);

const softRole = (b: Build): Role => (b.extras.includes("mitts") ? "belly" : b.extras.includes("socks") ? "dark" : "coat");

/**
 * The foot of a soft leg: a low oval paw the leg flows into with no neck above it, its pale fur running up into the
 * leg.
 */
function softPaw(kit: Kit, b: Build, name: string, sole: Vec, legR: number, fore: boolean): void {
  if (b.extras.includes("toes")) {
    toedPaw(kit, name, sole, legR, fore);
    return;
  }
  cap(
    kit,
    `${name}.paw`,
    softRole(b),
    madd(sole, [0, 0, 1], -legR * 0.2),
    madd(sole, [0, 0, 1], legR * 0.75),
    legR * 1.18,
    0.62,
    UP,
    { melt: 0.9 },
  );
  // (A raccoon's forepaw is a hand: two lines over its front part three fingers, each a blade deep enough to follow the
  // paw's curve.)
  if (fore && b.extras.includes("fingers"))
    for (const x of [-1, 1])
      cap(
        kit,
        `${name}.finger`,
        "alt",
        add(sole, [x * legR * 0.36, legR * 0.3, legR * 0.8]),
        add(sole, [x * legR * 0.44, legR * 0.05, legR * 1.5]),
        legR * 0.6,
        0.16,
        [1, 0, 0],
        { decal: true },
      );
}

/**
 * An elephant's foot on a tortoise: the column's end spread round and flat on the ground, a row of stout blunt nails of
 * pale horn along its toe edge, turned out a little.
 */
function stumpFoot(kit: Kit, name: string, sole: Vec, legR: number, fore: boolean, x: number): void {
  cap(kit, `${name}.paw`, "coat", sole, sole, legR * 1.06, 0.68, UP, { melt: 0.3 });
  const span = legR * (fore ? 0.92 : 0.74);
  const toe = add(sole, [x * legR * 0.22, -legR * 0.38, legR * 0.68]);
  cap(kit, `${name}.nails`, "horn", add(toe, [-span, 0, -x * legR * 0.2]), add(toe, [span, 0, x * legR * 0.2]), legR * 0.215, 1, UP, { row: fore ? 5 : 4, bow: [0, 0, legR * 0.36], shadow: false });
}

/**
 * A low flat paw of bare skin with its toes as nubs of their own, a hedgehog's: three to a forepaw and two to a hind
 * one, all a body's parts can spare.
 */
function toedPaw(kit: Kit, name: string, sole: Vec, legR: number, fore: boolean): void {
  for (const x of fore ? [-1, 0, 1] : [-0.6, 0.6]) {
    const nub = add(sole, [x * legR * 0.85, -legR * 0.3, legR * (1.7 - Math.abs(x) * 0.25)]);
    cap(kit, `${name}.toe${String(x)}`, "accent", nub, nub, legR * 0.5, 0.75, UP, { melt: 0.15 });
  }
  cap(kit, `${name}.paw`, "accent", madd(sole, [0, 0, 1], -legR * 0.2), madd(sole, [0, 0, 1], legR * 0.5), legR * 1.18, 0.5, UP, { melt: 0.25 });
}

/**
 * A kind's paw, in leg radii: its toes, how long and stout a claw is and how far it curls under, how wide the toes fan;
 * `sheathed` claws stay in until they are wanted.
 */
interface Paw {
  readonly toes: number;
  readonly long: number;
  readonly stout: number;
  readonly curl: number;
  readonly fan: number;
  readonly sheathed?: boolean;
}
const PAW: Paw = { toes: 4, long: 0.36, stout: 0.15, curl: 0.45, fan: 0.6 };
const PAWS: Partial<Readonly<Record<string, Paw>>> = {
  cat: { toes: 4, long: 0.46, stout: 0.13, curl: 0.8, fan: 0.62, sheathed: true },
  bear: { toes: 5, long: 0.8, stout: 0.18, curl: 0.62, fan: 0.8 },
  badger: { toes: 5, long: 0.85, stout: 0.15, curl: 0.3, fan: 0.72 },
  koala: { toes: 5, long: 0.75, stout: 0.13, curl: 0.9, fan: 0.74 },
  marmot: { toes: 4, long: 0.62, stout: 0.14, curl: 0.4, fan: 0.66 },
  squirrel: { toes: 4, long: 0.6, stout: 0.1, curl: 0.95, fan: 0.66 },
  mouse: { toes: 4, long: 0.5, stout: 0.09, curl: 0.7, fan: 0.7 },
  rabbit: { toes: 4, long: 0.3, stout: 0.14, curl: 0.3, fan: 0.46 },
  wolf: { toes: 4, long: 0.4, stout: 0.17, curl: 0.35, fan: 0.56 },
};
/** The acts a sheathed claw comes out for. */
const CLAW_ACTS: readonly Action[] = ["scratch", "stalk", "climb", "rear", "play", "hang"];
/**
 * How far out its claws are: all the way on most animals; on a sheathed one only through the acts that want them,
 * sliding out and back in at either end.
 */
function clawsOut(paw: Paw, m: Moment): number {
  if (!paw.sheathed) return 1;
  if (!CLAW_ACTS.includes(m.segment.act)) return 0;
  return clamp(Math.min(m.t - m.segment.t0, m.segment.t1 - m.t) * 3, 0, 1);
}

/**
 * A paw's toes as one part, fanned from the foot's front edge and melting back
 * into it, and its claws as another, rooted inside the toes' tips and drawn
 * out to points. Shaped by its kind, and a little by the animal.
 */
function pawDigits(kit: Kit, b: Build, line: LegLine, paw: Paw, out: number, gene: () => number): void {
  const { name, sole, ground, legR, x } = line;
  const span = legR * paw.fan * mix(0.92, 1.08, gene());
  const long = legR * paw.long * mix(0.85, 1.15, gene());
  const toe = legR * mix(0.54, 0.68, gene());
  const edge: Vec = [sole[0] + x * legR * 0.08, ground + legR * 0.26, sole[2] + legR * 0.72];
  const row = (o: Vec): { a: Vec; b: Vec } => ({
    a: add(o, [-span, 0, -legR * 0.06]),
    b: add(o, [span, 0, -legR * 0.06]),
  });
  // (Claws a cat has just put out matter more than its toes, so they go last.)
  const toes = row(edge);
  cap(kit, `${name}.toes`, b.legMake ? softRole(b) : "dark", toes.a, toes.b, legR * 0.26, 0.8, UP, { row: paw.toes, reach: [0, -legR * 0.02, toe], melt: 0.32, shadow: false, detail: paw.sheathed && out >= 0.05 ? 2 : 1 });
  if (out < 0.05) return;
  const claws = row(add(edge, [0, -legR * 0.05, toe * 0.86]));
  cap(kit, `${name}.claws`, "horn", claws.a, claws.b, legR * paw.stout, 1, UP, { row: paw.toes, reach: [0, -long * paw.curl * out, long * out], sharp: true, melt: 0.1, shadow: false, detail: paw.sheathed ? 1 : 2 });
}

/** The muscle a leg hangs from, a flat sheet down its outside: a shoulder blade and upper arm, a thigh. */
const legMass = (kit: Kit, { name, root, mid, legR }: LegLine): void => {
  cap(kit, `${name}.mass`, "coat", add(root, [0, legR * 1.1, 0]), lerpV(root, mid, 0.72), legR * 1.5, 0.6, [1, 0, 0], { r1: legR * 0.95, melt: 0.95, shadow: false, detail: 3 });
};

/** A leg's finishing parts, each set one `detail` group, so a device short of parts drops them whole, muscle first. */
export function legFinish(kit: Kit, actor: Who, lines: readonly LegLine[], m: Moment): void {
  const b = buildOf(actor);
  const paw = PAWS[actor.member.species] ?? PAW;
  const gene = createRandom(markOf(actor) ^ 0x7ac3119d);
  const shape = [gene(), gene(), gene()];
  if (b.foot !== "hoof" && !b.extras.includes("toes") && !b.extras.includes("fingers")) for (const line of lines) { let i = 0;
  pawDigits(kit, b, line, paw, clawsOut(paw, m), () => shape[i++] ?? 0.5); }
  for (const line of lines) legMass(kit, line);
  // (A deer's slim leg shows its joints: a knobbed knee or hock, the fetlock over each hoof.)
  if (b.foot === "hoof") for (const { name, mid, legR } of lines) cap(kit, `${name}.knee`, "coat", mid, mid, legR * 0.72, 0.9, [1, 0, 0], { melt: 0.5, shadow: false, detail: 2 });
}

/** The lowest bone and what it stands on: a hoof's cannon and hoof, a flat sole, a pastern and paw. */
function footParts(kit: Kit, b: Build, name: string, end: Vec, sole: Vec, legR: number, plantR: number): void {
  const lowRole: Role = b.extras.includes("socks") ? "dark" : "coat";
  if (b.foot === "hoof") {
    cone(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.55, legR * 0.48, 0.35);
    // (Cloven: two toes of horn, wedged forward from the fetlock.)
    const wide: Vec = [plantR * 0.55, 0, 0];
    cap(kit, `${name}.paw`, "dark", sub(sole, wide), add(sole, wide), plantR * 0.62, 1, UP, { row: 2, reach: [0, -plantR * 0.5, plantR * 1.1], melt: 0.1 });
    return;
  }
  const toe = madd(sole, [0, 0, 1], plantR * (b.foot === "plant" ? 0.6 : 0.35));
  // (A sole lies flat, heel to toe, so the foot reads from the side.)
  if (b.foot === "plant") cap(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.75, 0.7, UP, { r1: legR * 0.85, melt: 0.4 });
  else cone(kit, `${name}.cannon`, lowRole, end, sole, legR * (b.taper ? 0.42 : 0.62), legR * (b.taper ? 0.46 : 0.55), 0.35);
  cap(kit, `${name}.paw`, "dark", toe, toe, plantR * (b.foot === "plant" ? 1.25 : 1.35), b.foot === "plant" ? 0.6 : 0.7, UP, { melt: 0.3 });
}

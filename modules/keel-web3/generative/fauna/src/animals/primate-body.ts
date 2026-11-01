// A primate's shared frame: spine and stance, hands, feet, head and tail, that sloths, macaques and monkeys build on.

import { TAU, add, clamp, dirOf, lerpV, madd, mix, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { bodyStride } from "../stage/moments.js";
import type { Moment, Pose } from "../stage/moments.js";
import { ball, cap, decal, footCycle, headAxes } from "./kit.js";
import type { Kit } from "./kit.js";
import { CHARM, at3, earsOf, eyeOf, onFace } from "./quad-head.js";
import type { Head } from "./quad-head.js";
import { eyeOfSpecies } from "./coats.js";
import type { Who } from "./bodies.js";

export interface PrimateBody {
  readonly hips: Vec;
  readonly chest: Vec;
  readonly tdir: Vec;
  readonly r: number;
  readonly w: number;
  readonly arm: number;
  readonly leg: number;
  readonly climbing: boolean;
}

export function primateSpine(who: Who, m: Moment): PrimateBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const leg = b.leg * size;
  const arm = leg * armShare(who);
  const climbing = m.mode === "climb" && Math.abs(m.frame.y[1]) < 0.6;
  // (A monkey stands on all fours, as it walks: upright only to sit, reach, eat or hang.)
  const walking = !climbing && (m.moving > 0.05 || onFours(who, q));
  const stance = primateStance(who, m, climbing, walking);
  const hipY = mix(stance.hipY, r * 0.9, q.sit);
  const lean = mix(stance.lean, stance.sat, q.sit) + q.reach * 0.25;
  let hips: Vec = [0, hipY + Math.abs(Math.sin(TAU * m.phase)) * r * 0.25 * m.moving, 0];
  let tdir = dirOf(0, Math.PI / 2 - lean);
  if (q.hang > 0) {
    const sloth = b.extras.includes("claws");
    // (A sloth hangs by its long arms from the branch above, its body down below them, head up: hanging, not lying on
    // its back.)
    const hangHips: Vec = sloth
      ? [0, -arm * 0.85 - b.len * size * 0.95, -b.len * size * 0.15]
      : [0, -arm * 0.95 - b.len * size, 0];
    hips = lerpV(hips, hangHips, q.hang);
    tdir = unit(lerpV(tdir, sloth ? [0, 1, 0.18] : [0, 1, 0.05], q.hang));
  }
  return { hips, chest: madd(hips, tdir, b.len * size), tdir, r, w: r * 1.05, arm, leg, climbing };
}

/** How it carries itself before it sits, and how far it leans sitting. */
function primateStance(
  who: Who,
  m: Moment,
  climbing: boolean,
  walking: boolean,
): { hipY: number; lean: number; sat: number } {
  const b = who.spec.build;
  const r = b.body * who.member.size;
  const leg = b.leg * who.member.size;
  if (!climbing && macaqueKind(who)) {
    const own = macaqueCarriage(settled(who, m), leg, r);
    return { ...own, sat: own.lean };
  }
  // (A sloth at rest sits low on its rump, curled a little forward round its middle.)
  if (!climbing && !walking && b.extras.includes("claws")) return { hipY: r * 1.1, lean: 0.26, sat: 0.12 };
  return { ...primateCarriage({ climbing, fours: walking, moving: m.moving > 0.05 }, leg, r), sat: 0.12 };
}

/** The two that go on all fours and sit down to use their hands, a snow monkey and a long-tailed one. */
export const macaqueKind = (who: Who): boolean => who.member.species === "macaque" || who.member.species === "monkey" || who.member.species === "loris";

/**
 * An arm's length against the leg: a snow monkey's a little the shorter, a long-tailed one's nearly as long, a sloth's
 * over twice as long.
 */
function armShare(who: Who): number {
  if (macaqueKind(who)) return who.member.species === "macaque" ? 0.86 : 0.97;
  return who.spec.build.extras.includes("claws") ? 2.2 : 1.15;
}

/**
 * How high its hips ride and how far its body leans from upright: climbing, on all fours (a little higher at rest than
 * walking) or sitting up.
 */
function primateCarriage(
  way: { readonly climbing: boolean; readonly fours: boolean; readonly moving: boolean },
  leg: number,
  r: number,
): { hipY: number; lean: number } {
  const { climbing, fours, moving } = way;
  if (climbing) return { hipY: r * 1.4, lean: 1.45 };
  if (fours) return { hipY: leg * 0.8, lean: moving ? 1.15 : 1.0 };
  return { hipY: leg * 0.85, lean: 0.2 };
}

/**
 * Standing about on all fours: a monkey (not a sloth or a loris, which only climb and hang) doing nothing with its
 * hands.
 */
const onFours = (who: Who, q: Pose): boolean => (who.spec.build.tail !== "none" || who.member.species === "loris") && q.sit < 0.3 && q.hang <= 0 && q.reach < 0.3 && q.hand < 0.3 && q.scratch <= 0;

/**
 * A hand down on what it walks on: a sloth's reaching wide and far ahead, on arms too long to do otherwise, hooked
 * round the trunk when it climbs.
 */
function handDown(who: Who, body: PrimateBody, x: number, step: { z: number; y: number }): Vec {
  const { chest, w, arm, r } = body;
  if (!who.spec.build.extras.includes("claws")) return [x * w, step.y, chest[2] + arm * 0.25 + step.z];
  return body.climbing
    ? [x * w * 1.35, step.y + r * 0.1, chest[2] + arm * 0.62 + step.z]
    : [x * w * 1.8, step.y + r * 0.7, chest[2] + arm * 0.46 + step.z];
}

/**
 * A sloth's hands at rest: raised in front of its chest and hooked, as if round a branch it has only just let go of.
 */
const slothRest = (body: PrimateBody, x: number): Vec =>
  add(body.chest, [
    x * body.w * (x < 0 ? 1.7 : 1.45),
    body.r * (x < 0 ? -0.55 : -1.3),
    body.arm * (x < 0 ? 0.56 : 0.5),
  ]);

/** Its hand as it sits: out by its foot, or a macaque's on its raised knee. */
function sitHand(who: Who, body: PrimateBody, x: number): Vec {
  const { w, r, arm } = body;
  return macaqueKind(who) ? [x * w * 1.02, r * 1.42, arm * 0.78] : [x * w * 1.3, r * 0.4, arm * 0.45];
}

/**
 * A macaque grooming: one arm held out across its knee, away from its side, the other hand picking through the hair of
 * it.
 */
function groomHand(body: PrimateBody, x: number, t: number): Vec {
  const { w, r, arm } = body;
  if (x > 0) return [w * 1.56, r * 1.8, arm * 0.86];
  return [
    w * 0.9 + r * 0.16 * Math.sin(t * 3),
    r * 2.24 + r * 0.1 * Math.sin(t * 7),
    arm * 0.84 + r * 0.14 * Math.sin(t * 2),
  ];
}

/** A primate's body with its head placed, which its hands go by. */
export interface HeadedBody extends PrimateBody { readonly head: Vec }

/** Where a primate's hand is this moment. */
export const primateHand = (who: Who, body: HeadedBody, x: number, m: Moment): Vec => (macaqueKind(who) && m.segment.act === "groom" ? groomHand(body, x, m.t) : handOf(who, body, x, m));

/** A hand at rest, down by its side; a sloth's raised and hooked. */
function restingHand(who: Who, body: PrimateBody, x: number): Vec {
  const { chest, w, arm } = body;
  if (who.spec.build.extras.includes("claws")) return slothRest(body, x);
  return add(chest, [x * w * 1.2, -arm * 0.85, arm * 0.2]);
}

function handOf(who: Who, body: HeadedBody, x: number, m: Moment): Vec {
  const q = m.pose;
  const { chest, w, arm, r, head } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step = walking
    ? footCycle(m.phase - (x < 0 ? 0 : 0.5), 0.6, 0.6 * bodyStride(who), arm * 0.25)
    : { z: 0, y: 0 };
  let hand: Vec = walking ? handDown(who, body, x, step) : restingHand(who, body, x);
  hand = lerpV(hand, sitHand(who, body, x), q.sit);
  hand = lerpV(
    hand,
    add(chest, [x * w * 0.5, -r * 0.2 + 0.03 * Math.sin(m.t * 5 + x), arm * 0.75]),
    q.reach * (x > 0 ? 1 : 0.6),
  );
  if (x > 0) hand = lerpV(hand, add(head, [w * 0.25, -r * 0.5, r * 0.55]), q.hand * (1 - q.scratch));
  if (x > 0 && q.scratch > 0) {
    hand = lerpV(hand, add(head, [w * 1.1, r * 0.3 * Math.sin(m.t * 22), -r * 0.3]), q.scratch);
  }
  return q.hang > 0 ? lerpV(hand, gripOf(who, body, x, m.t), q.hang) : hand;
}

/** Where a hanging animal's hands hold the branch: a sloth both hands up, a monkey by one, the other swinging free. */
function gripOf(who: Who, body: PrimateBody, x: number, t: number): Vec {
  const { w, arm } = body;
  if (who.spec.build.extras.includes("claws")) return [x * w * 1.1, 0, w * 0.4];
  // (A macaque's short arm goes up past its ear, not through its head.)
  if (x > 0) return macaqueKind(who) ? [w * 1.1, 0, 0] : [0, 0, 0];
  return [-w, -arm * 0.6 + 0.1 * Math.sin(t), arm * 0.4];
}

export function primateFoot(who: Who, body: PrimateBody, x: number, m: Moment): Vec {
  const q = m.pose;
  const { hips, w, leg } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step =
    walking && m.moving > 0.05
      ? footCycle(m.phase - (x < 0 ? 0.5 : 0), 0.6, 0.6 * bodyStride(who), leg * 0.25)
      : { z: 0, y: 0 };
  let foot: Vec = [x * w * 0.8, step.y, hips[2] - leg * 0.1 + step.z];
  foot = macaqueKind(who)
    ? lerpV(foot, [x * w * 1.2, 0, leg * 0.5], settled(who, m))
    : lerpV(foot, [x * w * 1.4, 0, leg * 0.75], q.sit);
  if (q.hang > 0) {
    const sloth = who.spec.build.extras.includes("claws");
    foot = lerpV(
      foot,
      add(hips, sloth ? [x * w * 0.9, -leg * 0.6, leg * 0.55] : [x * w * 0.6, -leg * 0.9, leg * 0.25]),
      q.hang,
    );
  }
  return foot;
}

/**
 * How far it looks out ahead and not down: not at all hanging, well up a trunk, and `fours` as far when it is on
 * all fours or moving.
 */
export function lookOut(who: Who, body: PrimateBody, m: Moment, fours: number): number {
  const q = m.pose;
  if (q.hang > 0.5) return 0;
  if (body.climbing) return 0.9;
  return m.moving > 0.05 || onFours(who, q) ? fours : 0;
}

export function primateHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const { hips, chest, tdir, r } = body;
  const hr = b.head * size * CHARM;
  const look = lookOut(who, body, m, 0.35);
  const hd = dirOf(q.headYaw * 0.8, -0.1 + q.headPitch * 0.6 + look * 0.7);
  const neckTop = madd(chest, tdir, b.neck * size + r * 0.35);
  const head = madd(neckTop, hd, hr * 0.3);
  cap(kit, "torso", "coat", { a: hips, b: chest, r });
  ball(kit, "chest", "coat", { p: chest, r: r * 1.05 });
  cap(kit, "belly", "belly", { a: madd(hips, [0, 0, 1], r * 0.35), b: madd(chest, [0, 0, 1], r * 0.35), r: r * 0.62 });
  cap(kit, "neck", "coat", { a: chest, b: neckTop, r: r * 0.5 });
  const h: Head = { c: head, d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(who) };
  ball(kit, "head", "coat", { p: head, r: hr });
  // (A flat face set into the fur, not a ball stuck on the front.)
  cap(kit, "face", "accent", { a: at3(h, 0.56, 0, -0.08), b: at3(h, 0.56, 0, -0.08), r: hr * 0.68, flat: 0.45, up: hd, finish: { melt: 0.2 } });
  const eyes = [-1, 1].map((x) => onFace(h, [0.95, x * 0.34, 0.14]));
  eyes.forEach((at, i) => {
    eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, { toward: at, r: hr * 0.17, open: m.segment.act !== "sleep" });
  });
  // (Through both eyes, so each sits in its patch.)
  if (b.extras.includes("mask")) decal(kit, "mask", "dark", { a: eyes[0] ?? head, b: eyes[1] ?? head, r: hr * 0.17 * (h.eye?.size ?? 1) * 1.7 });
  earsOf(kit, h, { kind: b.ears, back: 0 });
  return head;
}

export function primateTail(kit: Kit, who: Who, body: PrimateBody, m: Moment): void {
  const b = who.spec.build;
  const { hips, r } = body;
  if (b.tail === "puff") {
    ball(kit, "tail", "coat", { p: madd(hips, [0, 0, -1], r), r: r * 0.4 });
    return;
  }
  if (b.tail === "none") return;
  let at = madd(hips, [0, 0, -1], r * 0.8);
  for (let i = 0; i < 4; i += 1) {
    const hang = m.pose.hang > 0.5 ? -1.4 : 0.3 + i * 0.35 - m.pose.sit * 0.9;
    const reach = madd(at, dirOf(Math.PI + 0.3 * Math.sin(m.t * 1.2 - i), hang), (b.tailLen * who.member.size) / 4);
    const next: Vec = m.pose.hang > 0.5 ? reach : [reach[0], Math.max(reach[1], r * 0.15), reach[2]];
    cap(kit, `tail.${i}`, "coat", { a: at, b: next, r: r * 0.16 });
    at = next;
  }
}

/** How far it has settled onto its rump: it sits to do anything with its hands, and gets up again only to walk. */
export function settled(who: Who, m: Moment): number {
  const q = m.pose;
  if (q.hang > 0 || m.mode === "climb") return 0;
  return clamp(Math.max(q.sit, q.reach, q.hand, q.scratch) / 0.3, 0, 1) * (1 - clamp(m.moving * 5, 0, 1));
}

/**
 * From all fours, its back near level and its rump a little the higher, down onto its haunches with its back bowed
 * over.
 */
export const macaqueCarriage = (down: number, leg: number, r: number): { hipY: number; lean: number } => ({
  hipY: mix(leg * 0.8, r * 0.92, down),
  lean: mix(1.46, 0.5, down),
});

// Primates: the shared frame, then sloths, macaques, monkeys and the loris, each posed its own way.

import { UP, add, clamp, cross, dirOf, dirToWorld, dot, lerpV, madd, mix, scale, solveTwoBone, sub, toWorld, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Role, Station } from "../roster.js";
import { bump } from "../stage/moments.js";
import type { Capsule, Moment, Pose } from "../stage/moments.js";
import { cap, cone, headAxes, limb } from "./kit.js";
import type { Kit } from "./kit.js";
import { CHARM, at3, eyeOf, facePatch, frontAt, loft, onFace, toSkin } from "./quad-head.js";
import type { Head } from "./quad-head.js";
import { eyeOfSpecies, mixColor } from "./coats.js";
import { markOf } from "./bodies.js";
import type { PeltSpec, Who } from "./bodies.js";
import { lookOut, primateFoot, primateHand, primateHead, primateSpine, primateTail, settled } from "./primate-body.js";
import type { HeadedBody, PrimateBody } from "./primate-body.js";

// ---------------------------------------------------------------- primates

export function posePrimate(kit: Kit, who: Who, m: Moment): void {
  if (who.member.species === "sloth") {
    poseSloth(kit, who, m);
    return;
  }
  if (who.member.species === "macaque") {
    poseMacaque(kit, who, m);
    return;
  }
  if (who.member.species === "monkey") {
    poseMonkey(kit, who, m);
    return;
  }
  if (who.member.species === "loris") {
    poseLoris(kit, who, m);
    return;
  }
  const q = m.pose;
  const b = who.spec.build;
  const body = primateSpine(who, m);
  const { hips, chest, r, w } = body;
  const headed: HeadedBody = { ...body, head: primateHead(kit, who, body, m) };
  const claws: Role = b.extras.includes("claws") ? "horn" : "dark";
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    limb(kit, `arm.${side}`, "coat", { root: add(chest, [x * w, -r * 0.2, 0]), target: primateHand(who, headed, x, m), lengths: [body.arm * 0.5, body.arm * 0.5], radius: r * 0.34, pole: [x * 0.3, 0, -1], end: claws, melt: 0.45 });
    limb(kit, `leg.${side}`, "coat", { root: add(hips, [x * w * 0.6, 0, 0]), target: primateFoot(who, body, x, m), lengths: [body.leg * 0.5, body.leg * 0.5], radius: r * 0.4, pole: q.sit > 0.5 ? [x * 0.4, 1, 0.6] : [0, 0, 1], end: claws });
  }
  primateTail(kit, who, body, m);
}

// ---------------------------------------------------------------- sloths

/** The way down a body's back from its spine, whatever it is leaning. */
const spineBack = (tdir: Vec): Vec => unit(cross(tdir, [1, 0, 0]), [0, 0, -1]);

/**
 * A sloth's body: small and lean under its coat, fuller low down, narrowing
 * up into a thin neck, its skirt of fur running on past the hips so its
 * thighs are lost in it.
 */
const SLOTH_BODY: readonly Station[] = [
  [-0.14, 0.8, 0.9, 0.94],
  [0.42, 1, 1.2, 1.12],
  [0.94, 0.86, 0.92, 0.9],
  [1.2, 0.48, 0.54, 0.54],
];

/** Along a sloth's spine, in a soft C: its back rounded out and its chest let in. */
const slothSpine = (body: PrimateBody, k: number): Vec =>
  madd(lerpV(body.hips, body.chest, k), spineBack(body.tdir), Math.sin(Math.PI * clamp(k, 0, 1)) * body.r * 0.3);

function slothTorso(kit: Kit, body: PrimateBody): void {
  const { tdir, r } = body;
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", { st: SLOTH_BODY, along: (k) => slothSpine(body, k), u: back, s: [1, 0, 0], size: r, melt: 1 });
  // (Algae in the hair over the back and shoulders, soft at its edge and mottled over by the coat's pattern; the
  // belly's shade is painted by the melt alone, so it has no edge.)
  cap(kit, "moss", "belly", { a: madd(slothSpine(body, 0.3), back, r * 0.3), b: madd(slothSpine(body, 1.1), back, r * 0.3), r: r * 1.05, flat: 1, up: UP, finish: { decal: true, under: true, melt: 2 } });
  cone(kit, "under", "alt", { a: madd(slothSpine(body, -0.1), back, -r * 0.76), b: madd(slothSpine(body, 0.85), back, -r * 0.56), r: r * 0.5, r1: r * 0.4 });
}

/**
 * A claw's two parts, as the arc from root to tip (in radians turned): horn, then a dark tip, thinning from `thick` to
 * `end` of its root.
 */
const CLAW: readonly (readonly [from: number, to: number, role: Role, thick: number, end: number])[] = [[0, 1.45, "horn", 1, 0.62], [1.45, 2.05, "dark", 0.62, 0.1]];

/**
 * One part of a claw, along the arc from `root` of radius `bend` out along `along` and round toward `curl`, from turn
 * `from` to turn `to`.
 */
interface Arc {
  readonly root: Vec;
  readonly along: Vec;
  readonly curl: Vec;
  readonly bend: number;
  readonly from: number;
  readonly to: number;
  readonly r: number;
  readonly r1: number;
}
function sickle(kit: Kit, part: string, role: Role, arc: Arc): void {
  const { root, along, curl, bend, from, to, r, r1 } = arc;
  const on = (a: number): Vec => madd(madd(root, along, Math.sin(a) * bend), curl, (1 - Math.cos(a)) * bend);
  const a = on(from);
  const b = on(to);
  cap(kit, `${part}.claw`, role, { a, b, r, flat: 1, up: UP, finish: { r1, melt: 0, bow: sub(on((from + to) / 2), lerpV(a, b, 0.5)) } });
}

/**
 * Three long claws curving off a hand: out along `along` and round toward
 * `palm`, one even sickle each. A sloth does not grip, it hangs on these.
 */
interface Hooks {
  readonly at: Vec;
  readonly along: Vec;
  readonly palm: Vec;
  readonly width: number;
  readonly len: number;
  readonly r: number;
}
function hookClaws(kit: Kit, part: string, hooks: Hooks): void {
  const { at, along, palm, width, len, r } = hooks;
  const curl = unit(madd(palm, along, -dot(palm, along)), [0, 0, -1]);
  const across = cross(along, curl);
  for (const i of [-1, 0, 1]) {
    for (const [from, to, role, thick, end] of CLAW) sickle(kit, part, role, {
      root: madd(at, across, i * width),
      along,
      curl,
      bend: len / 2,
      from,
      to,
      r: r * thick,
      r1: r * end,
    });
  }
}

/** Which way hair hangs off a limb along `along`: down, or down the trunk when it climbs, square to the limb. */
function hangOff(body: PrimateBody, along: Vec): Vec {
  const fall: Vec = body.climbing ? [0, 0, -1] : [0, -1, 0];
  return unit(madd(fall, along, -dot(fall, along)), [0, -0.5, -0.5]);
}

/** A long thin arm, shaggy to a small fur mitten, with a soft bend at the elbow and hair hanging under the forearm. */
function slothArm(kit: Kit, body: PrimateBody, m: Moment, hand: { readonly x: number; readonly at: Vec }): void {
  const { x, at: target } = hand;
  const { chest, tdir, w, r, arm } = body;
  const side = x < 0 ? "L" : "R";
  const root = madd(add(chest, [x * w * 0.86, 0, 0]), tdir, -r * 0.28);
  // (Elbows out and down at rest, and down when a hand comes to its mouth; out from the trunk as it climbs.)
  const pole = lerpV(
    m.mode === null ? [x * 0.8, -0.8, -0.15] : [x * 0.9, body.climbing ? 0.2 : -0.2, -0.45],
    [x * 0.7, -1, -0.3],
    m.pose.hand,
  );
  const { mid, end } = solveTwoBone(root, target, arm * 0.5, arm * 0.5, pole);
  cone(kit, `arm.${side}.upper`, "coat", { a: root, b: mid, r: r * 0.4, r1: r * 0.3, melt: 0.6 });
  cone(kit, `arm.${side}.lower`, "coat", { a: mid, b: end, r: r * 0.34, r1: r * 0.18, melt: 0.5 });
  const along = unit(sub(end, mid));
  const off = hangOff(body, along);
  cap(kit, `arm.${side}.fringe`, "coat", { a: madd(mid, off, r * 0.22), b: madd(lerpV(mid, end, 0.7), off, r * 0.14), r: r * 0.2, flat: 0.6, up: cross(along, off), finish: { r1: r * 0.06, melt: 0.5 } });
  const heel = madd(end, along, r * 0.26);
  cone(kit, `arm.${side}.mitten`, "coat", { a: end, b: heel, r: r * 0.2, r1: r * 0.2, melt: 0.5 });
  const down = m.mode === null ? 0 : 1;
  const palm = lerpV(lerpV([-x * 0.9, -0.5, 0], [0, -1, -0.2], down), [0, -0.2, 1], m.pose.hang);
  hookClaws(kit, `arm.${side}`, { at: heel, along, palm, width: r * 0.16, len: r * 1.7, r: r * 0.075 });
}

/** Where a sloth's foot goes: out past its skirt as it sits, gripping the trunk below its hips as it climbs. */
function slothFoot(body: PrimateBody, target: Vec, q: Pose): Vec {
  const { r, leg } = body;
  if (body.climbing) return [target[0] * 1.5, r * 0.1, target[2] - leg * 0.1];
  const out = (1 - q.hang) * (1 - q.sit);
  return [target[0] * (1 + 0.8 * out), target[1] + r * 0.3 * (1 - q.hang), target[2] + leg * 0.62 * out];
}

/** A short leg lost in the coat as far as its foot, with two hooks. */
function slothLeg(kit: Kit, body: PrimateBody, q: Pose, toward: { readonly x: number; readonly at: Vec }): void {
  const { x, at: target } = toward;
  const { hips, tdir, w, r } = body;
  const side = x < 0 ? "L" : "R";
  const root = madd(add(hips, [x * w * 0.62, 0, 0]), tdir, r * 0.1);
  const foot = slothFoot(body, target, q);
  const along = unit(sub(foot, root));
  cone(kit, `leg.${side}.upper`, "coat", { a: root, b: foot, r: r * 0.56, r1: r * 0.26, melt: 1 });
  const curl = unit(madd(body.climbing ? [0, -1, 0] : [0, -1, -0.2], along, -dot([0, -1, -0.2], along)), [0, -1, 0]);
  // (Two will do, the same hooks as the hands'.)
  for (const i of [-1, 1]) sickle(kit, `leg.${side}`, "horn", { root: madd(foot, cross(along, curl), i * r * 0.1), along, curl, bend: r * 0.56, from: 0, to: 1.8, r: r * 0.09, r1: r * 0.012 });
}

/**
 * A sloth's face: a wide pale mask wrapped round the head to the temples,
 * its edge as broken as the fur it lies in, about a blunt muzzle; each small
 * eye in a dark stripe running back and down across the cheek, a tiny nose
 * and a curved line under it that makes it look as if it is smiling.
 * Everything is found from the eyes, so the stripes never drift off them.
 */
function slothFace(kit: Kit, h: Head, m: Moment): void {
  const eyeR = h.r * 0.15;
  const spots = [-1, 1].map((x) => frontAt(x * 0.5, 0.14));
  spots.forEach((spot, i) => {
    const x = i === 0 ? -1 : 1;
    const run = sub(onFace(h, toSkin([-0.2, x * 0.8, spot[2] - 0.72])), onFace(h, spot));
    facePatch(kit, "mask", "pupil", { h, at: onFace(h, frontAt(x * 0.4, spot[2] + 0.03)), run, reach: h.r * 1.02, r: eyeR * 1.4, r1: eyeR * 0.4, flat: 0.66, melt: 0.4 });
  });
  // (A pale lip laid over a dark bar a little below it, which leaves a crescent: the first paint keeps a point.)
  const open = m.pose.mouth * 0.14;
  for (const [part, role, u] of [["lip", "accent", -0.34], ["smile", "dark", -0.4 - open]] as const) {
    cap(kit, part, role, {
      a: at3(h, 1.08, -0.16, u),
      b: at3(h, 1.08, 0.16, u),
      r: h.r * 0.17,
      flat: 1,
      up: UP,
      finish: { decal: true, melt: 0.2 },
    });
  }
  cap(kit, "face", "accent", { a: at3(h, 0.42, -0.42, -0.06), b: at3(h, 0.42, 0.42, -0.06), r: h.r * 0.66, flat: 1, up: UP, finish: { decal: true, melt: 1.5 } });
  cap(kit, "muzzle", "accent", { a: at3(h, 0.76, 0, -0.26), b: at3(h, 0.76, 0, -0.26), r: h.r * 0.5, flat: 0.74, up: h.d, finish: { melt: 0.6 } });
  cap(kit, "nose", "nose", { a: at3(h, 1.14, -0.04, -0.2), b: at3(h, 1.14, 0.04, -0.2), r: h.r * 0.075, flat: 0.7, up: h.d });
  spots.forEach((spot, i) => {
    eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, { toward: onFace(h, spot), r: eyeR, open: m.segment.act !== "sleep" });
  });
}

/**
 * Where a sloth's head sits: out ahead of its shoulders on a thin neck, so head and muzzle clear the outline from the
 * side, the throat dark under them.
 */
const slothPoll = (body: PrimateBody): Vec =>
  madd(madd(body.chest, body.tdir, body.r * 1.3), spineBack(body.tdir), -body.r * (body.climbing ? 0.2 : 1.05));

/** How far a sloth looks out: not at all hanging, well up a trunk, half as far on the move. */
function slothLook(body: PrimateBody, m: Moment): number {
  if (m.pose.hang > 0.5) return 0;
  if (body.climbing) return 0.9;
  return m.moving > 0.05 ? 0.5 : 0;
}

function slothHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const q = m.pose;
  const size = who.member.size;
  const { chest, tdir, r } = body;
  const hr = who.spec.build.head * size * CHARM;
  const look = slothLook(body, m);
  // (It can turn its head right round: on a trunk it looks out over its shoulder.)
  const hd = body.climbing ? unit([0.7, 0.72, 0.1]) : dirOf(q.headYaw * 0.8, -0.05 + q.headPitch * 0.6 + look * 0.7);
  const fore = scale(spineBack(tdir), -1);
  const c = slothPoll(body);
  const hs = unit(cross(tdir, hd), [1, 0, 0]);
  const axes = body.climbing ? { s: hs, u: cross(hd, hs) } : headAxes(hd, q.headRoll);
  const h: Head = { c, d: hd, ...axes, r: hr, ...eyeOfSpecies(who) };
  slothFace(kit, h, m);
  cap(kit, "head", "coat", { a: c, b: c, r: hr, flat: 1, up: UP, finish: { melt: 0.45 } });
  // (Out of sight just under the face: the fur lies short round a crisp part, so the mask stays smooth and the crown
  // shaggy.)
  cap(kit, "plate", "accent", { a: at3(h, 0.38, 0, 0), b: at3(h, 0.38, 0, 0), r: hr * 0.6, flat: 1, up: UP, finish: { melt: 0, shadow: false } });
  cone(kit, "neck", "alt", { a: madd(madd(chest, tdir, r * 0.5), fore, r * 0.4), b: madd(c, tdir, -hr * 0.55), r: r * 0.54, r1: r * 0.5, melt: 0.7 });
  return c;
}

/**
 * Where a sloth's coat falls from: a whorl on the crown of its head, so it runs back off the skull and down its flanks
 * and arms.
 */
export function slothCrown(who: Who, m: Moment): Vec {
  const body = primateSpine(who, m);
  const up = who.spec.build.head * who.member.size * CHARM;
  return toWorld(m.frame, madd(madd(slothPoll(body), body.tdir, up * 0.8), spineBack(body.tdir), up * 0.5));
}

function poseSloth(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const headed: HeadedBody = { ...body, head: slothHead(kit, who, body, m) };
  slothTorso(kit, body);
  for (const x of [-1, 1]) {
    slothArm(kit, body, m, { x, at: primateHand(who, headed, x, m) });
    slothLeg(kit, body, m.pose, { x, at: primateFoot(who, body, x, m) });
  }
}

// ---------------------------------------------------------------- macaques

/**
 * A macaque's trunk under its winter coat: haunches, a waist tucked in under
 * the loin, and the deep chest and shoulders its mantle hangs from, for the
 * coat to make more of them and never to average them out.
 */
const MACAQUE_BODY: readonly Station[] = [
  [-0.24, 0.84, 0.82, 0.86],
  [0.2, 1, 0.98, 1.02],
  [0.56, 0.84, 0.6, 0.78],
  [0.98, 1.06, 1.02, 1.04],
  [1.3, 0.6, 0.5, 0.66],
];

/** Along a macaque's spine, bowed out over the shoulders. */
const macaqueSpine = (body: PrimateBody, k: number): Vec =>
  madd(lerpV(body.hips, body.chest, k), spineBack(body.tdir), bump(k * 0.86) * body.r * 0.3);

/**
 * Where its head sits: carried out ahead of its shoulders in line with its back on all fours, down on its chest when it
 * sits.
 */
const macaquePoll = (body: PrimateBody, hr: number): Vec =>
  madd(
    madd(body.chest, body.tdir, body.r * 1.25 + hr * 0.75),
    spineBack(body.tdir),
    -body.r * mix(-0.7, 0.42, clamp(body.tdir[1], 0, 1)),
  );

/** The radius of its head. */
const macaqueHeadR = (who: Who): number => who.spec.build.head * who.member.size * CHARM;

/** Its head, posed. (On so little neck it turns only part way.) */
function macaqueHeadOf(who: Who, body: PrimateBody, m: Moment): Head {
  const q = m.pose;
  const look = lookOut(who, body, m, 0.2);
  // (Grooming it looks down to its own arm, not away over its shoulder as a cat looks to its flank.)
  const hd = dirOf(body.climbing ? 0.8 : q.headYaw * (m.segment.act === "groom" ? -0.34 : 0.5), -0.08 + q.headPitch * 0.6 + look * 0.5);
  return {
    c: macaquePoll(body, macaqueHeadR(who)),
    d: hd,
    ...headAxes(hd, q.headRoll),
    r: macaqueHeadR(who),
    ...eyeOfSpecies(who),
  };
}

function macaqueTorso(kit: Kit, body: PrimateBody): void {
  const { hips, tdir, r } = body;
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", { st: MACAQUE_BODY, along: (k) => macaqueSpine(body, k), u: back, s: [1, 0, 0], size: r, melt: 1 });
  // (A small soft callus right under its tail, the coat thinning out to it.)
  const seat = madd(madd(hips, tdir, -r * 1.3), back, -r * 0.16);
  cap(kit, "seat", "accent", { a: add(seat, [-r * 0.17, 0, 0]), b: add(seat, [r * 0.17, 0, 0]), r: r * 0.2, flat: 0.6, up: tdir, finish: { melt: 0.3 } });
}

/** A short round stump of a tail, set high on the rump and carried out a little down. */
function macaqueTail(kit: Kit, who: Who, body: PrimateBody): void {
  const { hips, tdir, r } = body;
  const root = madd(madd(hips, tdir, -r * 1.1), spineBack(tdir), r * 0.4);
  const tip = madd(root, unit(add(scale(tdir, -0.9), [0, -0.3, -0.2])), who.spec.build.tailLen * who.member.size);
  cap(kit, "tail", "coat", { a: root, b: [tip[0], Math.max(tip[1], r * 0.2), tip[2]], r: r * 0.27, flat: 1, up: UP, finish: { r1: r * 0.23, melt: 0.5 } });
}

/**
 * A bare hand or foot: a short palm or sole along `along`, four long spread fingers or toes off its end and a thumb or
 * big toe set back along its side, standing away.
 */
interface PawSpec {
  readonly at: Vec;
  readonly along: Vec;
  readonly flat: Vec;
  readonly r: number;
  readonly long: number;
  readonly x: number;
}
function macaquePaw(kit: Kit, part: string, paw: PawSpec, skin: Role = "alt"): void {
  const { at, along, flat, r, long, x } = paw;
  const tip = madd(at, along, long * 0.62);
  const across = cross(flat, along);
  cap(kit, `${part}.paw`, skin, { a: madd(at, along, -r * 0.4), b: tip, r: r * 0.66, flat: 0.5, up: flat, finish: { r1: r * 0.8, melt: 0.4 } });
  cap(kit, `${part}.digits`, skin, { a: madd(tip, across, -r * 0.88), b: madd(tip, across, r * 0.88), r: r * 0.17, flat: 1, up: UP, finish: { row: 4, reach: scale(along, r * 2), melt: 0.22, shadow: false } });
  const heel = madd(madd(at, along, long * 0.2), across, -x * r * 0.6);
  cap(kit, `${part}.thumb`, skin, { a: heel, b: madd(madd(heel, along, r * 1.1), across, -x * r * 1.3), r: r * 0.22, flat: 1, up: UP, finish: { r1: r * 0.15, melt: 0.2, shadow: false } });
}

/**
 * An arm or a leg, slimmer than its hair makes it, its elbow or heel showing: from `root` to `target`, bending toward
 * `pole`, down to a bare paw.
 */
/** A limb's reach: from `root` to `target`, bending toward `pole`, its length and radius, and which side it is on. */
interface LimbReach {
  readonly root: Vec;
  readonly target: Vec;
  readonly length: number;
  readonly r: number;
  readonly pole: Vec;
  readonly x: number;
}
function macaqueLimb(kit: Kit, part: string, reach: LimbReach & { readonly long: number }): void {
  const { root, target, length, r, pole, long, x } = reach;
  const sole = r * 0.3;
  const { mid, end } = solveTwoBone(
    root,
    [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]],
    length / 2,
    length / 2,
    pole,
  );
  cone(kit, `${part}.upper`, "coat", { a: root, b: mid, r, r1: r * 0.62, melt: 0.8 });
  cone(kit, `${part}.lower`, "coat", { a: mid, b: end, r: r * 0.64, r1: r * 0.36, melt: 0.6 });
  // (Flat on what it stands on; held out along the limb when it lifts.)
  const up = clamp(Math.abs(target[1]) / (r * 1.5), 0, 1);
  const flat = unit(sub(end, mid));
  const along = unit(lerpV([0, 0, 1], flat, up));
  macaquePaw(kit, part, { at: end, along, flat: unit(lerpV(UP, [0, 0, 1], up)), r: r * 0.42, long: r * long, x });
}

/**
 * The skin's raised parts: a brow standing out in an arch over each eye, and a short box of a muzzle, its flat front
 * low on the face, lip over chin.
 */
function macaqueSkin(kit: Kit, h: Head, gap: number): void {
  const { r } = h;
  for (const x of [-1, 1]) cap(kit, "brow", "accent", { a: at3(h, 0.9, x * 0.03, 0.24), b: at3(h, 0.74, x * 0.5, 0.12), r: r * 0.1, flat: 1, up: UP, finish: { bow: add(scale(h.u, r * 0.1), scale(h.d, r * 0.03)), melt: 0.4 } });
  cap(kit, "lip", "accent", { a: at3(h, 0.96, -0.23, -0.2), b: at3(h, 0.96, 0.23, -0.2), r: r * 0.22, flat: 0.56, up: h.d, finish: { melt: 0.5 } });
  const chin = madd(at3(h, 0.9, 0, -0.45), h.u, -gap);
  cap(kit, "chin", "accent", { a: madd(chin, h.s, -r * 0.2), b: madd(chin, h.s, r * 0.2), r: r * 0.15, flat: 0.62, up: h.d, finish: { melt: 0.8 } });
}

/** Its bare skin, over no more than its eyes and muzzle: the coat thins out to it on every side. */
function macaqueMask(kit: Kit, h: Head): void {
  const { r } = h;
  cap(kit, "mask", "accent", { a: at3(h, 0.74, -0.3, 0.08), b: at3(h, 0.74, 0.3, 0.08), r: r * 0.36, flat: 1, up: UP, finish: { decal: true, bare: true } });
  cap(kit, "mask", "accent", { a: at3(h, 0.86, 0, -0.16), b: at3(h, 0.86, 0, -0.5), r: r * 0.44, flat: 1, up: UP, finish: { decal: true, bare: true } });
}

/** An eye, or shut, its bare lens alone for the renderer to draw its lid down over. */
function macaqueEye(kit: Kit, h: Head, x: number, open: boolean): void {
  const at = onFace(h, frontAt(x * 0.24, 0.06));
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const n = unit(sub(at, h.c));
  if (open) eyeOf(kit, part, h, { toward: at, r: h.r * 0.105, open: true });
  else cap(kit, part, "eye", { a: madd(madd(h.c, n, h.r * 0.9), h.s, -h.r * 0.03), b: madd(madd(h.c, n, h.r * 0.9), h.s, h.r * 0.03), r: h.r * 0.1, flat: 0.8, up: n });
}

/**
 * Its face: close-set eyes hooded under the brow, slit nostrils close together on a flat nose, a thin straight mouth.
 */
function macaqueFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  const open = m.pose.mouth;
  const gap = r * open * 0.36;
  macaqueSkin(kit, h, gap);
  macaqueMask(kit, h);
  // (A thin sheet through the muzzle, so the surface finds it wherever it lies; opening, a dark gape.)
  const u = -0.4 - (open * 0.26);
  cap(kit, "mouth", "dark", { a: at3(h, 1.14, -0.2, u), b: at3(h, 1.14, 0.2, u), r: r * 0.2 + r * 0.14 * open, flat: mix(0.09, 0.9, open), up: h.u, finish: { decal: true, melt: 0.2 } });
  // (The fold under the brow.)
  cap(kit, "socket", "accent", { a: at3(h, 0.98, -0.34, 0.1), b: at3(h, 0.98, 0.34, 0.1), r: r * 0.12, flat: 0.7, up: h.u, finish: { carve: true, melt: 0.5 } });
  cap(kit, "nostril", "dark", { a: at3(h, 0.7, -0.07, -0.04), b: at3(h, 0.7, 0.07, -0.04), r: r * 0.04, flat: 1, up: UP, finish: { row: 2, reach: scale(h.d, r * 0.7), decal: true, melt: 0.3 } });
  for (const x of [-1, 1]) macaqueEye(kit, h, x, m.segment.act !== "sleep");
}

/** A small thin ear, high on the side of its head, half tucked into the hair, its hollow turned forward. */
function macaqueEars(kit: Kit, h: Head, high = 0.42, size = 0.17): void {
  for (const x of [-1, 1]) {
    const part = `ear.${x < 0 ? "L" : "R"}`;
    const at = at3(h, -0.1, x * 0.92, high);
    const face = unit(add(scale(h.s, x), scale(h.d, 0.7)));
    cap(kit, part, "shell", { a: at, b: at, r: h.r * size, flat: 0.26, up: face, finish: { melt: 0.2 } });
    const hollow = madd(at, face, h.r * size * 0.6);
    cap(kit, `${part}.in`, "shell", { a: hollow, b: hollow, r: h.r * size * 0.65, flat: 0.7, up: face, finish: { carve: true, melt: 0.3 } });
  }
}

function macaqueHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const { chest, tdir, r } = body;
  const h = macaqueHeadOf(who, body, m);
  const { c, r: hr } = h;
  macaqueFace(kit, h, m);
  // (A low skull behind the face, flat on top; its coat makes the ruff of its cheeks.)
  cap(kit, "head", "coat", { a: at3(h, -0.12, 0, 0), b: at3(h, -0.12, 0, 0), r: hr * 1.04, flat: 0.84, up: h.u, finish: { melt: 0.45 } });
  macaqueEars(kit, h);
  cone(kit, "neck", "coat", { a: madd(chest, tdir, r * 0.5), b: madd(c, h.d, -hr * 0.4), r: r * 0.62, r1: hr * 0.74 });
  return c;
}

/** One bone of its pelt, from `a` to `b` in the world. */
const peltBone = ({ a, b, long, up, girth, fall = 0 }: Omit<PeltSpec["flow"][number], "fall"> & { readonly fall?: number }): PeltSpec["flow"][number] => ({ a, b, long, up, girth, fall });

/**
 * A limb's two bones, off the parts it is drawn from, its hair `shoulder` long at the top down to `cuff` at the wrist
 * or ankle, longest on its outside.
 */
function limbFlow(capsules: readonly Capsule[], part: string, out: Vec, [shoulder, elbow, cuff]: readonly [number, number, number]): PeltSpec["flow"] {
  const upper = capsules.find((c) => c.part === `${part}.upper`);
  const lower = capsules.find((c) => c.part === `${part}.lower`);
  if (!upper || !lower) return [];
  return [
    peltBone({ a: upper.a, b: upper.b, long: [shoulder, elbow], up: out, girth: upper.r * 0.8, fall: 0.12 }),
    peltBone({ a: lower.a, b: lower.b, long: [elbow, cuff], up: out, girth: lower.r * 0.8, fall: 0.08 }),
  ];
}

/**
 * How long a coat's hair runs, in grains, end to end of each bone: over the crown, down the nape, the spine, each arm
 * and leg (shoulder, elbow, cuff) and the tail.
 */
interface HairLengths {
  readonly crown: readonly [number, number];
  readonly nape: readonly [number, number];
  readonly spine: readonly [number, number];
  readonly arm: readonly [number, number, number];
  readonly leg: readonly [number, number, number];
  readonly tail: readonly [number, number];
}
/**
 * A snow monkey's winter coat: long over the mantle, the shoulders, the back and the cheeks, short on its forearms and
 * shins and round its face.
 */
const WINTER_HAIR: HairLengths = {
  crown: [0.34, 1.05],
  nape: [1.1, 1.5],
  spine: [1.6, 1.25],
  arm: [1.2, 0.66, 0.34],
  leg: [1.25, 0.72, 0.4],
  tail: [0.7, 0.55],
};
/** A long-tailed monkey's, short and close all over, for the bones and muscle under it to show. */
const SLEEK_HAIR: HairLengths = {
  crown: [0.3, 0.9],
  nape: [0.9, 1],
  spine: [1, 0.85],
  arm: [0.8, 0.55, 0.3],
  leg: [0.85, 0.55, 0.3],
  tail: [0.6, 0.4],
};

/**
 * Its coat, off its skeleton: back from the bare face over the crown, down the nape and the spine to the rump, and down
 * each limb.
 */
function macaqueFlow(who: Who, m: Moment, capsules: readonly Capsule[], hair: HairLengths): PeltSpec["flow"] {
  const body = primateSpine(who, m);
  const h = macaqueHeadOf(who, body, m);
  const world = (v: Vec): Vec => toWorld(m.frame, v);
  const dir = (v: Vec): Vec => dirToWorld(m.frame, v);
  const back = dir(spineBack(body.tdir));
  const r = body.r;
  const poll = world(at3(h, -0.5, 0, 0.1));
  const rump = world(madd(body.hips, body.tdir, -r * 0.74));
  const shoulders = world(macaqueSpine(body, 0.98));
  const tail = tailBone(capsules);
  const side = (x: number): Vec => dir([x, 0, 0]);
  return [
    peltBone({
      a: world(at3(h, 0.86, 0, 0.1)),
      b: world(at3(h, -1, 0, 0.1)),
      long: hair.crown,
      up: dir(h.u),
      girth: h.r * 0.84,
    }),
    peltBone({ a: poll, b: shoulders, long: hair.nape, up: back, girth: r * 0.7, fall: 0.2 }),
    peltBone({ a: shoulders, b: rump, long: hair.spine, up: back, girth: r * 0.92, fall: 0.5 }),
    ...limbFlow(capsules, "arm.L", side(-1), hair.arm),
    ...limbFlow(capsules, "arm.R", side(1), hair.arm),
    ...limbFlow(capsules, "leg.L", side(-1), hair.leg),
    ...limbFlow(capsules, "leg.R", side(1), hair.leg),
    ...(tail ? [peltBone({ a: tail.a, b: tail.b, long: hair.tail, up: back, girth: tail.r * 0.9 })] : []),
  ];
}

/** A tail's whole length as one bone, however many parts it is drawn in. */
function tailBone(capsules: readonly Capsule[]): { a: Vec; b: Vec; r: number } | null {
  const parts = capsules.filter((c) => c.part === "tail" || c.part.startsWith("tail."));
  const first = parts[0];
  const last = parts[parts.length - 1];
  return first && last ? { a: first.a, b: last.b, r: first.r } : null;
}

/** Its winter coat, a dusky grey-brown back over a silver front, each guard hair banded and pale at its end. */
export function macaquePelt(who: Who, m: Moment, capsules: readonly Capsule[]): PeltSpec {
  const { coat, alt, belly, dark } = who.member.palette;
  return {
    flow: macaqueFlow(who, m, capsules, WINTER_HAIR), under: 0.3, thin: 0.62, crease: 0.34, tint: 0.09, root: "#b4aaa6",
    band: [mixColor(alt, dark, 0.2), 0.42], tip: [belly, 0.2],
    back: mixColor(coat, alt, 0.8), front: belly, dorsal: 0.78, ventral: 0.6,
  };
}

function poseMacaque(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const headed: HeadedBody = { ...body, head: macaqueHead(kit, who, body, m) };
  macaqueTorso(kit, body);
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    macaqueLimb(kit, `arm.${side}`, { root: madd(add(chest, [x * w * 0.84, 0, 0]), tdir, -r * 0.16), target: primateHand(who, headed, x, m), length: arm, r: r * 0.35, pole: [x * 0.45, -0.4, -1], long: 0.9, x });
    macaqueLimb(kit, `leg.${side}`, { root: add(hips, [x * w * 0.7, 0, 0]), target: primateFoot(who, body, x, m), length: leg, r: r * 0.56, pole: lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), long: 1.05, x });
  }
  macaqueTail(kit, who, body);
}

// ---------------------------------------------------------------- monkeys

/**
 * A long-tailed monkey's trunk, built to stay narrow: slim hips, a waist drawn
 * in under the ribs, a deep narrow chest and the shoulders over it, so what
 * stands on those long limbs is a lean animal and no bean.
 */
const MONKEY_BODY: readonly Station[] = [
  [-0.16, 0.74, 0.74, 0.74],
  [0.1, 0.98, 0.9, 0.86],
  [0.46, 0.8, 0.56, 0.64],
  [0.82, 1.04, 1.12, 0.86],
  [1.12, 0.74, 0.6, 0.7],
];

/**
 * A long lean arm or leg from `root` to `target`, bending toward `pole`: the muscle high on each bone and the joint
 * standing out between, down to a bare hand or foot.
 */
function monkeyLimb(kit: Kit, part: string, reach: LimbReach): void {
  const { root, target, length, r, pole, x } = reach;
  const sole = r * 0.5;
  const { mid, end } = solveTwoBone(
    root,
    [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]],
    length / 2,
    length / 2,
    pole,
  );
  cone(kit, `${part}.upper`, "coat", { a: root, b: mid, r, r1: r * 0.6, melt: 0.6 });
  cone(kit, `${part}.lower`, "coat", { a: mid, b: end, r: r * 0.78, r1: r * 0.44, melt: 0.5 });
  const up = clamp(Math.abs(target[1]) / (r * 2.5), 0, 1);
  const along = unit(lerpV([0, 0, 1], unit(sub(end, mid)), up));
  macaquePaw(kit, part, { at: end, along, flat: unit(lerpV(UP, [0, 0, 1], up)), r: r * 0.62, long: length * 0.3, x }, "dark");
}

/** Its bare face: a muzzle a little forward of the flat of it, the macaque's brow, lip, chin, eyes and nose on that. */
function monkeyFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  cap(kit, "muzzle", "accent", { a: at3(h, 0.62, 0, -0.2), b: at3(h, 0.94, 0, -0.3), r: r * 0.34, flat: 0.8, up: h.u, finish: { r1: r * 0.28, melt: 0.5 } });
  macaqueFace(kit, h, m);
}

function monkeyHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const { chest, tdir, r } = body;
  const h = macaqueHeadOf(who, body, m);
  const { c, r: hr } = h;
  monkeyFace(kit, h, m);
  // (A round skull behind the flat of the face.)
  cap(kit, "head", "coat", { a: at3(h, -0.1, 0, 0.04), b: at3(h, -0.1, 0, 0.04), r: hr, flat: 0.94, up: h.u, finish: { melt: 0.45 } });
  macaqueEars(kit, h, 0.14, 0.2);
  cone(kit, "neck", "coat", { a: madd(chest, tdir, r * 0.4), b: madd(c, h.d, -hr * 0.4), r: r * 0.66, r1: hr * 0.56 });
  return c;
}

/**
 * How its tail is carried: the line of each of its parts along it, out and down in a long arc and up again at the end.
 */
function monkeyTailLine(k: number, q: Pose, t: number, lift: number): number {
  const held = 0.5 - 1.5 * Math.sin(Math.PI * Math.min(k * 1.2, 1)) + lift * k * k * 2.4;
  const sway = 0.05 * Math.sin(t * 1.1 - k * 4);
  if (q.hang > 0.5) return -1.4 + 0.9 * k * k * k;
  return mix(held, -0.5 + 0.5 * k, q.sit) + sway;
}

/** Its long tail, thin from root to tip: set high on the rump, in a curve this animal carries its own way. */
function monkeyTail(kit: Kit, who: Who, body: PrimateBody, m: Moment): void {
  const { hips, tdir, r } = body;
  const gene = createRandom(markOf(who) ^ 0x2d9c41e3);
  const lift = mix(0.7, 1.15, gene());
  const bend = mix(-0.14, 0.14, gene());
  // (The curve is walked in fine steps and drawn as three bowed bones, so a tail never shows an elbow.)
  const n = 9;
  const step = (who.spec.build.tailLen * who.member.size) / (n - 1);
  const line: Vec[] = [madd(madd(hips, tdir, -r * 0.7), spineBack(tdir), r * 0.5)];
  for (let i = 1; i < n; i += 1) {
    const k = (i - 1) / (n - 2);
    const at = line[i - 1] ?? hips;
    const reach = madd(
      at,
      dirOf(
        Math.PI + bend * Math.sin(k * 3) + 0.14 * Math.sin(m.t * 0.9 - k * 3),
        monkeyTailLine(k, m.pose, m.t, lift),
      ),
      step,
    );
    line.push(m.pose.hang > 0.5 ? reach : [reach[0], Math.max(reach[1], r * 0.28), reach[2]]);
  }
  for (let i = 0; i < 3; i += 1) {
    const [from, by, to] = [line[i * 3] ?? hips, line[i * 3 + 1] ?? hips, line[i * 3 + 3] ?? hips];
    const middle = lerpV(line[i * 3 + 1] ?? by, line[i * 3 + 2] ?? by, 0.5);
    cap(kit, `tail.${String(i)}`, "coat", { a: from, b: to, r: r * mix(0.36, 0.17, i / 3), flat: 1, up: UP, finish: { r1: r * mix(0.36, 0.17, (i + 1) / 3), bow: sub(middle, lerpV(from, to, 0.5)), melt: i === 0 ? 0.8 : 0.3 } });
  }
}

export function monkeyPelt(who: Who, m: Moment, capsules: readonly Capsule[]): PeltSpec {
  const { coat, alt, belly, dark } = who.member.palette;
  return {
    flow: macaqueFlow(who, m, capsules, SLEEK_HAIR), under: 0.5, thin: 0.5, crease: 0.3, tint: 0.07, root: "#c4bab0",
    band: [mixColor(alt, dark, 0.3), 0.4], tip: [mixColor(coat, belly, 0.6), 0.24],
    back: mixColor(coat, alt, 0.7), front: belly, dorsal: 0.7, ventral: 0.8,
  };
}

/** A loris along its spine: long and low, a little deeper at the chest, with no tail to taper into. */
const LORIS_BODY: readonly Station[] = [
  [-0.2, 0.74, 0.72, 0.74],
  [0.15, 1, 0.94, 0.98],
  [0.55, 0.9, 0.8, 0.84],
  [0.95, 0.98, 0.9, 0.92],
  [1.25, 0.6, 0.55, 0.6],
];

/**
 * Its face: a round skull, a short pale muzzle, a dark ring round each huge eye, the pale stripe between them running
 * up its brow, small ears set low in the fur.
 */
function lorisFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  cap(kit, "head", "coat", { a: at3(h, -0.08, 0, 0.03), b: at3(h, -0.08, 0, 0.03), r, flat: 0.95, up: h.u, finish: { melt: 0.45 } });
  cap(kit, "muzzle", "belly", { a: at3(h, 0.72, 0, -0.26), b: at3(h, 1, 0, -0.3), r: r * 0.34, flat: 0.86, up: h.u, finish: { r1: r * 0.24, melt: 0.6 } });
  cap(kit, "nose", "dark", { a: at3(h, 1.24, 0, -0.26), b: at3(h, 1.24, 0, -0.26), r: r * 0.1, flat: 0.75, up: h.d, finish: { melt: 0.2 } });
  const eyes = [-1, 1].map((x) => ({ x, at: onFace(h, frontAt(x * 0.42, 0.14)) }));
  for (const { x, at } of eyes) {
    cap(kit, "ring", "dark", { a: at, b: at3(h, 0.42, x * 0.46, -0.34), r: r * 0.3, flat: 1, up: UP, finish: { decal: true, r1: r * 0.14, melt: 1.2 } });
    cap(kit, "ring", "dark", { a: at, b: at3(h, 0.3, x * 0.42, 0.62), r: r * 0.3, flat: 1, up: UP, finish: { decal: true, r1: r * 0.12, melt: 1.2 } });
  }
  cap(kit, "stripe", "belly", { a: at3(h, 0.96, 0, -0.12), b: at3(h, 0.3, 0, 0.92), r: r * 0.13, flat: 1, up: UP, finish: { decal: true, r1: r * 0.08, melt: 1.1 } });
  for (const { x, at } of eyes) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, { toward: at, r: r * 0.125, open: m.segment.act !== "sleep" });
  macaqueEars(kit, h, 0.32, 0.16);
}

function poseLoris(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const head = macaqueHeadOf(who, body, m);
  const headed: HeadedBody = { ...body, head: head.c };
  lorisFace(kit, head, m);
  cone(kit, "neck", "coat", { a: madd(chest, tdir, r * 0.4), b: madd(head.c, head.d, -head.r * 0.4), r: r * 0.62, r1: head.r * 0.6 });
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", { st: LORIS_BODY, along: (k) => macaqueSpine(body, k), u: back, s: [1, 0, 0], size: r, melt: 1 });
  // (The dark line down its back, breaking up as it nears the rump.)
  cap(kit, "stripe", "dark", { a: madd(hips, back, r * 0.82), b: madd(chest, back, r * 0.9), r: r * 0.12, flat: 1, up: UP, finish: { decal: true, r1: r * 0.16, melt: 1.4 } });
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    monkeyLimb(kit, `arm.${side}`, { root: madd(add(chest, [x * w * 0.8, 0, 0]), tdir, -r * 0.1), target: primateHand(who, headed, x, m), length: arm, r: r * 0.3, pole: [x * 0.35, -0.4, -1], x });
    monkeyLimb(kit, `leg.${side}`, { root: add(hips, [x * w * 0.66, 0, 0]), target: primateFoot(who, body, x, m), length: leg, r: r * 0.38, pole: lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), x });
  }
}

function poseMonkey(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const headed: HeadedBody = { ...body, head: monkeyHead(kit, who, body, m) };
  loft(kit, "torso", "coat", { st: MONKEY_BODY, along: (k) => macaqueSpine(body, k), u: spineBack(tdir), s: [1, 0, 0], size: r, melt: 1 });
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    monkeyLimb(kit, `arm.${side}`, { root: madd(add(chest, [x * w * 0.76, 0, 0]), tdir, -r * 0.1), target: primateHand(who, headed, x, m), length: arm, r: r * 0.52, pole: [x * 0.35, -0.4, -1], x });
    monkeyLimb(kit, `leg.${side}`, { root: add(hips, [x * w * 0.62, 0, 0]), target: primateFoot(who, body, x, m), length: leg, r: r * 0.7, pole: lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), x });
  }
  monkeyTail(kit, who, body, m);
}

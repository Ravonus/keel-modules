// Four legs, the rest: tails, the trunk and its coat marks, shells, mantles and quills, and the animal posed whole.

import { UP, add, cross, dirOf, lerpV, madd, mix, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Build, Role, Station, Tail } from "../roster.js";
import type { Moment, Pose } from "../stage/moments.js";
import { ball, buildOf, cap, cone, decal } from "./kit.js";
import type { Kit } from "./kit.js";
import { LEG, legFinish, nosing, quadFoot, quadLeg, quadSpine } from "./quad.js";
import type { LegLine, QuadBody } from "./quad.js";
import { TABBIES, at3, faceOf, loft, onFace, quadNeck, roundEyes } from "./quad-head.js";
import type { Head } from "./quad-head.js";
import { hexRgb } from "./coats.js";
import { grizzled, markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

/** Tails: how each rises and curls, its girth and segments, and its thickness down its length (root to tip). */
const TAILS: Readonly<
  Record<Tail, { rise: number; curl: number; girth: number; n: number; profile: readonly number[]; root?: number }>
> = {
  bushy: { rise: 0.1, curl: -0.12, girth: 0.6, n: 3, profile: [0.5, 0.95, 0.9, 0.4] },
  curl: { rise: 1.25, curl: 0.5, girth: 0.6, n: 4, profile: [0.55, 0.95, 1, 0.9, 0.55] },
  // (A thin tail falls from the rump and curves up toward its tip, a J, never a straight stick.)
  thin: { rise: 0.1, curl: 0.25, girth: 0.16, n: 4, profile: [1, 0.85, 0.7, 0.55, 0.4] },
  puff: { rise: 0.6, curl: 0, girth: 0.45, n: 1, profile: [1, 1] },
  ring: { rise: 0.35, curl: 0.05, girth: 0.45, n: 4, profile: [0.75, 1, 0.95, 0.85, 0.55] },
  // (A raccoon's: full and blunt, carried low; its bands are painted along its length, more of them than it has segments.)
  banded: { rise: 0.05, curl: -0.12, girth: 0.62, n: 3, profile: [0.72, 1.04, 1.06, 0.64], root: 1.7 },
  thick: { rise: -0.55, curl: 0.1, girth: 0.6, n: 3, profile: [1, 0.7, 0.45, 0.22] },
  fan: { rise: 0, curl: 0, girth: 0.4, n: 1, profile: [1, 1] },
  stub: { rise: 0, curl: 0, girth: 0.16, n: 0, profile: [0] },
  none: { rise: 0, curl: 0, girth: 0, n: 0, profile: [0] },
};

/**
 * Which way each tail segment runs: up or down by its kind, wagging, and
 * laid round the feet when the animal sits or loafs; a cat's thin tail held
 * up hooks over at its tip.
 */
function tailLay(b: Build, body: QuadBody, q: Pose, t: number): (i: number) => Vec {
  const shape = TAILS[b.tail];
  const wrap = (body.sit + body.loaf + body.haunch * 0.5) * (b.tail === "curl" || b.tail === "thick" ? 0 : 1);
  const settled = body.sit + body.lie + body.loaf;
  const hook = b.tail === "thin" && b.tailRise > 0.3 ? 0.9 * (1 - settled) : 0;
  // (Nose down, a cat's tail eases into a low relaxed curve.)
  const held = Math.max(0, 1 - settled) * (1 - nosing(b, q) * 0.8);
  return (i) => {
    const [climb, sway] = b.tailLine?.[i] ?? [0, 0, 0];
    const wag =
      q.tailWag * 0.6 * Math.sin(t * 8 - i * 0.8) +
      0.15 * Math.sin(t * 1.3 - i) +
      q.curl * 0.9 +
      wrap * (0.55 + i * 0.5) +
      sway * held;
    const rise =
      shape.rise +
      b.tailRise * (1 - settled) +
      q.tailUp * 0.9 +
      shape.curl * i +
      (i === shape.n - 1 ? hook : 0) -
      q.sit * 0.7 -
      q.lie * 0.4 -
      wrap * 0.6 +
      climb * held;
    return dirOf(Math.PI + wag, rise);
  };
}

/** Where a banded tail's dark rings lie, as shares of its length; the last is its tip. */
const TAIL_BANDS = [0.36, 0.51, 0.66, 0.81, 0.98] as const;

/** A banded tail's dark rings, each a flat disc a touch wider than the tail where it lies, so it paints an even band right round it; the last is its whole tip. */
function tailBands(
  kit: Kit,
  path: readonly Vec[],
  girth: number,
  profile: readonly number[],
  gene: () => number,
): void {
  TAIL_BANDS.forEach((rest, j) => {
    // (Each animal's rings fall a little differently; the tip stays a tip.)
    const k = j < TAIL_BANDS.length - 1 ? rest + mix(-0.04, 0.04, gene()) : rest;
    const i = Math.min(Math.floor(k * (path.length - 1)), path.length - 2);
    const f = k * (path.length - 1) - i;
    const at = lerpV(path[i] ?? UP, path[i + 1] ?? UP, f);
    const r = girth * mix(profile[i] ?? 1, profile[i + 1] ?? 1, f);
    const along = unit(sub(path[i + 1] ?? UP, path[i] ?? UP));
    cap(
      kit,
      `tail.ring.${j}`,
      "dark",
      at,
      at,
      r * (j < TAIL_BANDS.length - 1 ? 1.35 : 1.14),
      j < TAIL_BANDS.length - 1 ? 0.25 : 1,
      along,
      { decal: true, melt: 0.5 },
    );
  });
}

/** A tail segment's share of the tail: an even one, unless the tail has a line of its own. */
const tailShare = (b: Build, i: number, n: number): number => b.tailLine?.[i]?.[2] ?? 1 / n;
/** How far a tail segment melts into the last: the first, into the rump. */
const tailMelt = (tail: Tail, i: number): number => (i === 0 ? TAILS[tail].root ?? 1 : 0.7);
/** A tabby's tail ends dark. */
const darkTipped = (who: Who): boolean => who.member.species === "cat" && TABBIES.has(who.member.coat);

function quadTail(kit: Kit, actor: Who, body: QuadBody, q: Pose, t: number): void {
  const b = buildOf(actor);
  const shape = TAILS[b.tail];
  // (A hedgehog's is a bare nub low on its rump, under the skirt.)
  if (b.tail === "stub") { const root = add(body.P, [0, -body.r * 0.25, -body.r * 0.5]);
  cone(
    kit,
    "tail",
    "accent",
    root,
    add(root, [0, -body.r * 0.22, -body.r * 0.2]),
    body.r * shape.girth,
    body.r * shape.girth * 0.6,
    0.5,
  );
  return; }
  if (shape.n === 0) return;
  const hu = body.r * b.haunch;
  let at = add(body.P, [0, hu * 0.35, -hu * 0.8]);
  if (b.tail === "puff") { ball(kit, "tail", "belly", add(body.P, [0, hu * 0.55, -hu * 0.88]), body.r * shape.girth * b.tailGirth);
  return; }
  const girth = body.r * shape.girth * b.tailGirth;
  const lay = tailLay(b, body, q, t);
  const path: Vec[] = [at];
  for (let i = 0; i < shape.n; i += 1) {
    const reach = madd(at, lay(i), b.tailLen * actor.member.size * tailShare(b, i, shape.n));
    const r0 = girth * (shape.profile[i] ?? 1);
    const r1 = girth * (shape.profile[i + 1] ?? 1);
    const next: Vec = [reach[0], Math.max(reach[1], r1 * 0.9), reach[2]];
    cap(kit, `tail.${i}`, i === shape.n - 1 && darkTipped(actor) ? "dark" : "coat", at, next, r0, 1, UP, { r1, melt: tailMelt(b.tail, i) });
    // (A ringed tail's dark bands are painted round it, crisp, one between each pair of pale ones.)
    if (b.tail === "ring") decal(kit, `tail.ring.${i}`, "dark", lerpV(at, next, 0.75), lerpV(at, next, 0.75), mix(r0, r1, 0.75) * 1.12);
    at = next;
    path.push(at);
  }
  if (b.tail === "banded") tailBands(kit, path, girth, shape.profile, createRandom(markOf(actor) ^ 0x1f83d9ab));
  // (A fox's brush ends in white; a mouse's or a meerkat's tail in dark.)
  if (b.tail === "bushy") decal(kit, "tail.tip", "accent", at, at, girth * 0.75);
}

function quadTrunk(kit: Kit, actor: Who, body: QuadBody): void {
  const { P, S, r } = body;
  const b = buildOf(actor);
  const extras = b.extras;
  const ch = r * b.chest;
  const hu = r * b.haunch;
  // (A tortoise is all shell: its trunk would only stand out of it.)
  if (extras.includes("shell")) { shellOf(kit, body);
  return; }
  if (b.torso) {
    // The species' own outline along the spine, however the spine lies (standing, sat up, lying).
    const f = unit(sub(S, P), [0, 0, 1]);
    const side: Vec = [1, 0, 0];
    loft(kit, "body", "coat", b.torso, (k) => lerpV(P, S, k), unit(cross(f, side), UP), side, r, 1);
  } else {
    // A chest set forward and low, a haunch over the hind legs, a waist between.
    cone(kit, "body", "coat", P, S, hu * 0.85, ch * 0.88);
    ball(kit, "haunch", "coat", add(P, [0, hu * 0.05, -hu * 0.1]), hu);
    ball(kit, "chest", "coat", add(S, [0, -ch * 0.12, ch * 0.08]), ch);
    if (extras.includes("hump")) ball(kit, "hump", "coat", add(S, [0, ch * 0.7, -ch * 0.35]), ch * 0.72);
  }
  if (extras.includes("pouch")) ball(kit, "pouch", "belly", add(lerpV(P, S, 0.45), [0, -r * 0.35, r * 0.25]), r * 0.75);
  if (extras.includes("quills")) quillsOf(kit, body);
  coatMarks(kit, actor, b, body);
}

/** Markings painted on the coat: a pale belly, a dark saddle, a white rump, stripes, a fawn's spots. */
function coatMarks(kit: Kit, actor: Who, b: Build, body: QuadBody): void {
  const { P, S, r } = body;
  const extras = b.extras;
  const ch = r * b.chest;
  const hu = r * b.haunch;
  const spot = (part: string, role: Role, at: Vec, radius: number): void => { decal(kit, part, role, at, at, radius); };
  // (A grizzled coat grows paler to its belly by itself.)
  if (!grizzled(actor)) decal(kit, "belly", "belly", add(P, [0, -hu * 0.8, 0]), add(S, [0, -ch * 0.85, 0]), r * 0.58);
  if (extras.includes("saddle")) decal(kit, "saddle", "alt", add(P, [0, hu * 0.95, 0]), add(S, [0, ch * 0.95, -ch * 0.2]), r * 0.62);
  if (extras.includes("rump")) spot("rump", "belly", add(P, [0, hu * 0.25, -hu * 0.95]), hu * 0.72);
  if (extras.includes("stripes") && !extras.includes("mask")) {
    // A skunk's pale pair down the back where its second colour is the lighter, a mongoose's dark bands across it where it is the darker.
    const tone = (hex: string): number => {
      const [cr, cg, cb] = hexRgb(hex);
      return cr * 0.3 + cg * 0.59 + cb * 0.11;
    };
    if (tone(actor.member.palette.alt) > tone(actor.member.palette.coat))
      for (const x of [-1, 1])
        decal(
          kit,
          "stripe",
          "alt",
          add(S, [x * r * 0.42, ch * 0.92, ch * 0.2]),
          add(P, [x * r * 0.42, hu * 0.92, -hu * 0.3]),
          r * 0.28,
        );
    else
      for (const k of [0.15, 0.38, 0.62, 0.85]) {
        const c = lerpV(P, S, k);
        decal(kit, "stripe", "alt", add(c, [-r * 1.1, r * 0.55, 0]), add(c, [r * 1.1, r * 0.55, 0]), r * 0.16);
      }
  }
  if (extras.includes("spots") && actor.member.young) for (let i = 0; i < 5; i += 1) spot("spot", "accent", add(lerpV(P, S, 0.15 + i * 0.17), [((i % 2) * 2 - 1) * r * 0.45, r * 0.8, 0]), r * 0.2);
}

/**
 * A tortoise's carapace, in body radii along its spine: a high dome, its top
 * just behind the middle of its length and falling more steeply to the tail
 * than to the neck. It is one smooth form: the plates are grown on it (see
 * `plateGrain`), and the shell's own grain stops it flat at its rim, where
 * its sides have come down to a near-upright wall, so it is a dome and never a ball.
 */
const CARAPACE: readonly Station[] = [
  [-0.03, 0.76, 0.76, 0.84],
  [0.4, 1.38, 1.38, 1.1],
  [0.72, 1.12, 1.12, 1],
  [1.1, 0.6, 0.6, 0.7],
];
export const shellHeart = (body: QuadBody): Vec => lerpV(body.P, body.S, 0.45);
/** The dome as a shell's grain takes it: half width, height and half length. */
export const domeOf = (body: QuadBody): Vec => [body.r * 1.2, body.r * 1.38, body.L / 2 + body.r * 0.8];
function shellOf(kit: Kit, body: QuadBody): void {
  const { P, S, r } = body;
  loft(kit, "shell", "shell", CARAPACE, (k) => lerpV(P, S, k), UP, [1, 0, 0], r, 0.6);
  // (Under it the horn of its belly, up to the rim, the bridge showing as a pale band between the legs.)
  cap(kit, "shell.under", "horn", add(lerpV(P, S, 0.3), [0, -r * 0.22, 0]), add(lerpV(P, S, 0.74), [0, -r * 0.22, 0]), r * 0.84, 0.32);
  // (A short cone of a tail under the rim, tipped with horn.)
  const root = add(P, [0, -r * 0.28, -r * 0.6]);
  const tip = add(root, [0, -r * 0.26, -r * 0.3]);
  cap(kit, "tail", "coat", root, tip, r * 0.14, 1, UP, { r1: r * 0.06, melt: 0.3, shadow: false });
  cap(kit, "tail.tip", "horn", tip, add(tip, [0, -r * 0.03, -r * 0.08]), r * 0.065, 1, UP, { r1: r * 0.02, shadow: false });
}

/**
 * A hedgehog's mantle: a low oval dome of its second colour from the rump to
 * the brow, highest just behind the middle of its back, its edge a skirt that
 * comes down near the ground over its flanks and overhangs the head's rear
 * third, its peak run on down the forehead between the ears. The dome only
 * says where the spines stand; they are grown on it as its grain (see
 * `quillGrain`), so they keep to it and leave the face, the belly and the
 * feet soft.
 */
const MANTLE: readonly Station[] = [
  [0, 0.96, 0.7, 0.92],
  [0.37, 1.44, 0.7, 1.12],
  [1, 1.02, 0.7, 0.76],
  [1.8, 0.585, -0.185, 0.15],
];
export function mantleLine(body: QuadBody, k: number): Vec {
  return add(lerpV(body.P, body.S, k), [0, body.r * 0.12, 0]);
}
function quillsOf(kit: Kit, body: QuadBody): void {
  // (Melting only a little, so its brim stands off the face and the flanks.)
  loft(kit, "quills", "alt", MANTLE, (k) => mantleLine(body, k), UP, [1, 0, 0], body.r, 0.2);
}

/** A hedgehog's skull drawn out into a broad blunt wedge down to the muzzle, which a round head alone never is, and the soft dark mask round its eyes and on down the bridge of its nose. */
function wedgeFace(kit: Kit, b: Build, h: Head): void {
  cone(kit, "wedge", "coat", at3(h, 0.1, 0, -0.08), at3(h, 0.95, 0, -0.14), h.r * 0.77, h.r * 0.44);
  const bridge = at3(h, 1.18, 0, 0.2);
  for (const eyeSpot of roundEyes(b)) cap(kit, "mask", "accent", madd(onFace(h, eyeSpot), h.d, -h.r * 0.12), bridge, h.r * 0.33, 1, UP, { decal: true, r1: h.r * 0.17, melt: 1.3 });
  cap(kit, "mask.bridge", "accent", bridge, at3(h, 1.55, 0, 0.08), h.r * 0.17, 1, UP, { decal: true, r1: h.r * 0.2, melt: 1.3 });
}

export function poseQuad(kit: Kit, actor: Who, m: Moment): void {
  const q = m.pose;
  const body = quadSpine(actor, q, m);
  const head = quadNeck(kit, actor, body, q, m);
  const lines: LegLine[] = [];
  for (const leg of LEG) quadLeg(kit, actor, body, leg, quadFoot(actor, body, leg, q, m, head.c), lines);
  quadTrunk(kit, actor, body);
  faceOf(kit, actor, head, q, m.segment.act === "sleep");
  if (buildOf(actor).extras.includes("quills")) wedgeFace(kit, buildOf(actor), head);
  quadTail(kit, actor, body, q, m.t);
  legFinish(kit, actor, lines, m);
}

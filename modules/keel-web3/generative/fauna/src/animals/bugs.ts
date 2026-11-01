// Insects and crabs: butterflies and fireflies on the wing, and a crab on its legs with claws up.

import { TAU, UP, add, clamp, cross, lerpV, madd, mix, scale, smooth, solveTwoBone, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Role } from "../roster.js";
import type { Place } from "../stage/stage.js";
import { bodyStride, pulse } from "../stage/moments.js";
import type { Moment } from "../stage/moments.js";
import { ball, cap, cone, footCycle, ownPhase } from "./kit.js";
import type { Kit } from "./kit.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

// ---------------------------------------------------------------- insects

/** Where a bug's body is: drifting over its spot, settled on a leaf, or flying between, at the same heights. */
/** A firefly's own spot in the air, off its seed: anywhere round it, near or well out, low or high. */
const fireflySpot = (seed: number): Vec => {
  const out = 0.7 + 2 * Math.sqrt((seed * 13) % 1);
  return [Math.cos(seed * TAU) * out, 0.2 + 0.8 * ((seed * 37) % 1), Math.sin(seed * TAU) * out];
};

function bugCentre(who: Who, m: Moment): Vec {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const drift: Vec = [
    Math.sin(t * 0.6 + phase) * 0.35,
    Math.sin(t * 0.9 + phase * 2) * 0.18,
    Math.cos(t * 0.5 + phase) * 0.35,
  ];
  // (Fireflies hang well apart over the grass, never in a clump.)
  // (Each keeps a spot of its own in the air, so a pack is spread through the dusk and never a heap on the grass.)
  const wander = firefly ? add(fireflySpot(ownPhase(who)), scale(drift, 1.4)) : scale(drift, 0.3);
  if (m.mode !== "fly") return m.segment.act === "sit" && !firefly ? [0, size * 0.1, 0] : add([0, 0.35 + m.pose.lift * 0.4, 0], wander);
  const airy = (place: Place): number => (place.on === "ground" ? 0.35 + m.pose.lift * 0.4 : size * 0.1);
  const flying = mix(
    airy(m.segment.from),
    airy(m.segment.to),
    smooth(clamp((t - m.segment.t0) / Math.max(0.01, m.segment.t1 - m.segment.t0), 0, 1)),
  );
  const grounded = m.segment.from.on === "ground" || m.segment.to.on === "ground";
  return add(
    [0, flying + Math.sin(t * 9 + phase) * size * 0.6 * m.moving, 0],
    grounded ? scale(wander, 1 - m.moving) : [0, 0, 0],
  );
}

/** A butterfly's wing: from its root to its tip, its radius at each, the way it faces, and how many spots it bears. */
interface ButterflyWing {
  readonly root: Vec;
  readonly tip: Vec;
  readonly r: readonly [number, number];
  readonly normal: Vec;
  readonly spots: number;
}

/** A butterfly's wing, drawn flat: a dark margin, its colour set inside it, pale spots along the edge. */
function butterflyWing(kit: Kit, part: string, wing: ButterflyWing): void {
  const { root, tip, r, normal, spots } = wing;
  // (A layer of the wing to `to`, `k` of its radius and `flat` across.)
  const shape = (name: string, role: Role, to: Vec, [k, flat]: readonly [number, number]): void => {
    cap(kit, `${part}.${name}`, role, { a: root, b: to, r: r[0] * k, flat, up: normal, finish: { r1: r[1] * k, melt: 0 } });
  };
  shape("edge", "alt", tip, [1, 0.08]);
  // (Most of a wing is its colour: the margin is a line round it, not a frame.)
  shape("colour", "coat", lerpV(root, tip, 0.93), [0.9, 0.13]);
  const across = unit(cross(normal, sub(tip, root)));
  for (let k = 0; k < spots; k += 1)
    ball(
      kit,
      `${part}.spot`,
      "accent",
      { p: madd(tip, across, r[1] * ((k + 0.5) / spots - 0.5) * 1.5), r: r[1] * 0.12, flat: 0.8, up: normal },
    );
}

/** A firefly's wing case: from the bug's middle `C` out along `dir`, over a body `size` big that faces `fw`. */
interface WingCase { readonly C: Vec; readonly dir: Vec; readonly fw: Vec; readonly normal: Vec; readonly size: number }

/** A firefly's wings: hard dark cases over its back, parted as it flies. */
function fireflyWing(kit: Kit, part: string, wing: WingCase): void {
  const { C, dir, fw, normal, size } = wing;
  cap(kit, part, "coat", { a: madd(C, fw, size * 0.12), b: add(madd(C, dir, size * 0.32), scale(fw, -size * 0.3)), r: size * 0.08, flat: 0.14, up: normal, finish: { r1: size * 0.11, melt: 0 } });
}

/** A bug's body about its middle `C`: abdomen, thorax and head, and a firefly's lantern. */
function bugBody(kit: Kit, who: Who, C: Vec, m: Moment): void {
  const size = who.member.size;
  const phase = size * 977;
  const fw: Vec = [0, 0, 1];
  cap(kit, "abdomen", "dark", { a: madd(C, fw, -size * 0.04), b: madd(C, fw, -size * 0.42), r: size * 0.055, flat: 1, up: UP, finish: { r1: size * 0.024 } });
  ball(kit, "thorax", "dark", { p: madd(C, fw, size * 0.08), r: size * 0.085 });
  ball(kit, "head", "dark", { p: madd(C, fw, size * 0.24), r: size * 0.058 });
  if (who.spec.build.extras.includes("glowtail")) {
    const blink = pulse(m.t + phase, 2.4 + (phase % 1.7), 0.9);
    // (The lantern is its tail end; lit, it swells past the bug itself, or a grove's pixels would never catch it.)
    cap(kit, "lantern", "glow", { a: madd(C, fw, -size * 0.28), b: madd(C, fw, -size * 0.5), r: size * (0.1 + 0.5 * blink), flat: 1, up: UP, finish: { r1: size * (0.085 + 0.45 * blink), shadow: false } });
  }
}

export function poseBug(kit: Kit, who: Who, m: Moment): void {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const perched = m.segment.act === "sit";
  const C = bugCentre(who, m);
  const fw: Vec = [0, 0, 1];
  const gene = createRandom(markOf(who) ^ 0x4b1f6a27);
  const spots = 2 + Math.floor(gene() * 3);
  const sweep = mix(-0.04, 0.08, gene());
  bugBody(kit, who, C, m);
  const open = perched
    ? 1.35 + 0.2 * Math.sin(t * 1.4 + phase)
    : 0.15 + 1.1 * (0.5 + 0.5 * Math.sin(t * (firefly ? 30 : 19) + phase));
  for (const x of [-1, 1]) {
    const dir = unit(add(scale([x, 0, 0], Math.cos(open)), scale(UP, Math.sin(open))));
    const normal = unit(cross(dir, fw), UP);
    const side = x < 0 ? "L" : "R";
    if (firefly) fireflyWing(kit, `wing.${side}`, { C, dir, fw, normal, size });
    else {
      // A forewing swept forward, a rounder hindwing behind it, overlapping as they do.
      butterflyWing(kit, `wing.${side}`, { root: madd(C, fw, size * 0.1), tip: add(madd(C, dir, size * 0.74), scale(fw, size * (0.26 + sweep))), r: [size * 0.07, size * 0.27], normal, spots });
      butterflyWing(kit, `hindwing.${side}`, { root: madd(C, fw, size * 0.02), tip: add(madd(C, dir, size * 0.46), scale(fw, -size * 0.26)), r: [size * 0.07, size * 0.25], normal, spots: spots - 1 });
    }
    const tip = add(madd(C, fw, size * 0.62), [x * size * 0.2, size * 0.2, 0]);
    cap(kit, "antenna", "dark", { a: madd(C, fw, size * 0.28), b: tip, r: size * 0.011, flat: 1, up: UP, finish: { melt: 0, shadow: false } });
    ball(kit, "antenna.club", "dark", { p: tip, r: size * 0.024 });
  }
}

// ---------------------------------------------------------------- crabs

export function poseCrab(kit: Kit, who: Who, m: Moment): void {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const legLen = b.leg * size;
  // Resting, a crab settles its shell down onto the sand.
  const C: Vec = [0, mix(legLen * 0.55, r * 0.45, Math.max(q.sit * 0.6, q.lie)), 0];
  // (Its shell wider than long, flat over a low belly, its front edge drawn straight across between the eyes.)
  cap(kit, "body", "coat", { a: add(C, [-r * 0.5, 0, -r * 0.08]), b: add(C, [r * 0.5, 0, -r * 0.08]), r: r * 0.86, flat: 0.46, up: UP, finish: { melt: 0.3 } });
  cap(kit, "brow", "coat", { a: add(C, [-r * 0.82, r * 0.06, r * 0.5]), b: add(C, [r * 0.82, r * 0.06, r * 0.5]), r: r * 0.22, flat: 0.5, up: UP, finish: { melt: 0.5 } });
  cap(kit, "belly", "belly", { a: add(C, [-r * 0.5, -r * 0.2, 0]), b: add(C, [r * 0.5, -r * 0.2, 0]), r: r * 0.66, flat: 0.34, up: UP, finish: { melt: 0.2 } });
  for (const x of [-1, 1]) {
    const stalk = add(C, [x * r * 0.26, r * 0.2, r * 0.68]);
    cap(kit, "eyestalk", "coat", { a: stalk, b: add(stalk, [x * r * 0.04, r * 0.34, r * 0.05]), r: r * 0.06 });
    ball(kit, "eye", "pupil", { p: add(stalk, [x * r * 0.04, r * 0.4, r * 0.05]), r: r * 0.1 });
    ball(kit, "eye.shine", "shine", { p: add(stalk, [x * r * 0.04, r * 0.47, r * 0.1]), r: r * 0.03 });
    const side: CrabSide = { C, x, r, legLen };
    crabLegs(kit, who, m, side);
    crabClaw(kit, side, { big: clawSize(who, x), wave: x > 0 ? q.reach : 0, open: q.hand });
  }
}

/** One side of a crab: its middle, which side, its radius and its legs' length. */
interface CrabSide { readonly C: Vec; readonly x: number; readonly r: number; readonly legLen: number }

/** How big a claw is: a fiddler's one huge and the other small, any other crab's a pair. */
function clawSize(who: Who, x: number): number {
  if (who.member.coat !== "fiddler") return 1;
  return x > 0 ? 2.2 : 0.6;
}

/** Four walking legs down a side, thin and jointed high, each ending in a sharp point on the sand. */
function crabLegs(kit: Kit, who: Who, m: Moment, side: CrabSide): void {
  const { C, x, r, legLen } = side;
  for (let i = 0; i < 4; i += 1) {
    const z = (i - 1.6) * r * 0.42;
    const step = footCycle(m.phase - i / 4 - (x > 0 ? 0.5 : 0), 0.5, 0.5 * bodyStride(who) * m.moving, legLen * 0.3);
    const foot: Vec = [x * (r * 1.25 + legLen * 0.8) + step.z, step.y, z * 1.5];
    const root = add(C, [x * r * 1.05, -r * 0.05, z]);
    const { mid, end } = solveTwoBone(root, foot, [legLen * 0.62, legLen * 0.62], [x, 1, 0]);
    cone(kit, `leg.${String(x)}.${String(i)}.upper`, "alt", { a: root, b: mid, r: r * 0.1, r1: r * 0.075, melt: 0.2 });
    cap(kit, `leg.${String(x)}.${String(i)}.lower`, "alt", { a: mid, b: end, r: r * 0.075, flat: 1, up: UP, finish: { r1: r * 0.012, melt: 0.1 } });
  }
}

/**
 * A claw: an arm folded in front of the face, a swollen palm, a fixed finger and a moving one that open and close on
 * each other. (A fiddler's one claw is huge, and it is the one it waves.)
 */
function crabClaw(
  kit: Kit,
  side: CrabSide,
  claw: { readonly big: number; readonly wave: number; readonly open: number },
): void {
  const { C, x, r } = side;
  const { big, wave, open } = claw;
  const root = add(C, [x * r * 1.0, 0, r * 0.55]);
  const palm = add(C, [x * r * 0.86, r * 0.1 + wave * r * 1.5, r * 1.3]);
  const { mid } = solveTwoBone(root, palm, [r * 0.62, r * 0.62], [x, 0, -0.4]);
  cone(kit, `claw.${String(x)}`, "coat", { a: root, b: mid, r: r * 0.14, r1: r * 0.17 * Math.sqrt(big), melt: 0.3 });
  cone(kit, `claw.${String(x)}.wrist`, "coat", {
    a: mid,
    b: palm,
    r: r * 0.17 * Math.sqrt(big),
    r1: r * 0.22 * big,
    melt: 0.3,
  });
  const way: Vec = [-x * 0.3, 0, 1];
  cap(kit, "pincer", "coat", {
    a: palm,
    b: madd(palm, way, r * 0.3 * big),
    r: r * 0.25 * big,
    flat: 0.72,
    up: [1, 0, 0],
    finish: { r1: r * 0.2 * big, melt: 0.3 },
  });
  const base = madd(palm, way, r * 0.3 * big);
  const gape = (0.18 + open * 0.3) * r * big;
  cap(kit, "pincer.tip", "accent", {
    a: add(base, [0, -r * 0.08 * big, 0]),
    b: add(madd(base, way, r * 0.62 * big), [0, -r * 0.05 * big, 0]),
    r: r * 0.15 * big,
    flat: 1,
    up: UP,
    finish: { r1: r * 0.015, bow: [0, -r * 0.05 * big, 0], melt: 0.15 },
  });
  cap(kit, "pincer.tip", "accent", {
    a: add(base, [0, r * 0.1 * big, 0]),
    b: add(madd(base, way, r * 0.56 * big), [0, gape, 0]),
    r: r * 0.12 * big,
    flat: 1,
    up: UP,
    finish: { r1: r * 0.015, bow: [0, r * 0.06 * big, 0], melt: 0.15 },
  });
}

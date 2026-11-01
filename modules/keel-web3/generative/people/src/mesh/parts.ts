// Parts: the capsules of limbs, torso and clothes, in the skeleton's frame.

import { FRONT, SIDE, UP, add, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person, Top } from "../body/person.js";
import { limbWide } from "../body/build.js";
import { LONG_TOP } from "../clothes/outfit.js";
import { restSkeleton, skeletonOf } from "../motion/skeleton.js";
import type { Arm, Leg, Skeleton } from "../motion/skeleton.js";

// ---------------------------------------------------------------- parts

/** How thick a neck goes against the head: a man's thicker, a woman's less, a child's thin and the same for both. */
export const neckBy = (p: Person): number => mix(0.8, p.build.sex === "male" ? 1 : 0.8, p.face.bone.m);

/** One drawn part: sdf-body's shape, named for what it is. */
export interface Capsule {
  readonly part: string;
  readonly role: string;
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly r1?: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly melt?: number;
  readonly decal?: boolean;
  readonly carve?: boolean;
  readonly detail?: number;
  /** A row of this many beads, each drawn out by `reach` into a digit: a hand's fingers as one part. */
  readonly row?: number;
  readonly reach?: Vec;
  /** A mesh cuts it off level at this height: a hem. */
  readonly hem?: number;
  /** Whether it casts a shadow: a hat's or hair's would lie across the face and hide it. */
  readonly shadow?: boolean;
}

type Finish = Partial<Pick<Capsule, "r1" | "flat" | "up" | "melt" | "decal" | "carve" | "detail" | "row" | "reach" | "shadow" | "hem">>;
export type Kit = Capsule[];

/** What a capsule is called: its part, and the role it is painted. */
export type Named = readonly [part: string, role: string];
/** A capsule's two ends. */
export type Line = readonly [a: Vec, b: Vec];
/** How big a capsule is, and whatever else finishes it. */
export type Shape = Finish & { readonly r: number };

export const put = (kit: Kit, [part, role]: Named, [a, b]: Line, shape: Shape): void => {
  const { r, ...finish } = shape;
  kit.push({ part, role, a, b, r, flat: 1, up: UP, ...finish });
};
export const ball = (kit: Kit, named: Named, p: Vec, shape: Shape): void => {
  put(kit, named, [p, p], shape);
};
/**
 * A level band round whatever passes through it, a thin sheet that finds the surface wherever it lies: a stripe, a
 * belt.
 */
const band = (kit: Kit, named: Named, at: Vec, [wide, thick]: readonly [number, number]): void => {
  put(kit, named, [at, at], { r: wide, decal: true, flat: thick / wide, up: UP, melt: 0.2 });
};
export const paint = (kit: Kit, named: Named, [a, b]: Line, r: number): void => {
  put(kit, named, [a, b], { r, decal: true });
};

const TOP_SLEEVE: Readonly<Record<Top, number>> = {
  tee: 0.5,
  polo: 0.46,
  tank: 0,
  long: 1,
  hoodie: 1,
  jacket: 1,
  blazer: 1,
  coat: 1,
  robe: 0.8,
  dress: 0.3,
  raincoat: 1,
  puffer: 1,
  swimsuit: 0,
  bikini: 0,
  string: 0,
  bare: 0,
};



/** How much bigger than the limb its cloth is, at a fit. */
const clothWide = (fit: number): number => 1.04 + fit * 0.14;

/** A limb's three radii, from its root to its end. */
type Radii = readonly [number, number, number];

/** How a limb swells: its radii, where along it the belly of the muscle lies, and which way it stands out. */
interface Bulge {
  readonly r: Radii;
  readonly belly: number;
  readonly on: Vec;
}

/** A limb's stretch from `a` to `b`, swelling at `belly` of the way: a muscle, not a tube, in `role`. */
function muscle(kit: Kit, [part, role]: Named, [a, b]: Line, { r, belly, on }: Bulge): void {
  const mid = madd(lerpV(a, b, belly), on, r[1] * 0.1);
  put(kit, [`${part}.0`, role], [a, mid], { r: r[0], r1: r[1], melt: 0.8 });
  put(kit, [`${part}.1`, role], [mid, b], { r: r[1], r1: r[2], melt: 0.8 });
}

/** What a limb wears: its own radii, how far down it the cloth comes, which way it swells, and how the cloth fits. */
interface Sleeve {
  readonly r: Radii;
  readonly upto: number;
  readonly on: Vec;
  readonly fit: number;
}

/** Skin, or the cloth over it, up to `upto` of the limb's length. */
function clad(kit: Kit, [part, role]: Named, [a, b]: Line, { r, upto, on, fit }: Sleeve): void {
  const k = clothWide(fit);
  const wide: Radii = [r[0] * k, r[1] * k, r[2] * k * (1 + fit * 0.12)];
  if (upto >= 1) {
    muscle(kit, [part, role], [a, b], { r: wide, belly: 0.34, on });
    return;
  }
  if (upto <= 0) {
    muscle(kit, [part, "skin"], [a, b], { r, belly: 0.34, on });
    return;
  }
  const cut = lerpV(a, b, upto);
  put(kit, [`${part}.cloth`, role], [a, cut], { r: wide[0], r1: wide[1] * 1.04, melt: 0.2 });
  put(kit, [part, "skin"], [cut, b], { r: r[1], r1: r[2], melt: 0.2 });
}

/** Which way an umbrella's shaft leans, held up and over its holder. */
export const SHAFT: Vec = unit([-0.2, 0.98, 0.02]);

/** A vector carried the shortest way round from one direction to another, with no twist about it. */
function swung(d: Vec, from: Vec, to: Vec): Vec {
  const axis = cross(from, to);
  const c = dot(from, to);
  if (c < -0.9999) return add(scale(UP, 2 * dot(UP, d)), scale(d, -1));
  return add(add(scale(d, c), cross(axis, d)), scale(axis, dot(axis, d) / (1 + c)));
}

/**
 * A rest frame as an arm's bone carries it to a pose: swung, never wrung round its own length, so a shoulder is not
 * twisted shut.
 */
export function swungFrame(frame: readonly [Vec, Vec, Vec], [ra, rb]: Line, [na, nb]: Line): readonly [Vec, Vec, Vec] {
  const from = unit(sub(rb, ra));
  const to = unit(sub(nb, na));
  const [x, y, z] = frame;
  return [swung(x, from, to), swung(y, from, to), swung(z, from, to)];
}

/** A hand's bone's frame: its own line, and the knuckles' line square to it, so the roll of a forearm comes with it. */
export function handFrame(a: Vec, b: Vec, knuckles: Vec): readonly [Vec, Vec, Vec] {
  const along = unit(sub(b, a), UP);
  const x = unit(sub(knuckles, scale(along, dot(knuckles, along))), SIDE);
  return [x, along, cross(x, along)];
}

/**
 * The right hand's way from holding pose to rest and back: anything carried is made where it is held, and ridden home
 * to the bone.
 */
export function heldHand(p: Person): {
  readonly toRest: (at: Vec) => Vec;
  readonly toHeld: (at: Vec) => Vec;
  readonly spin: (d: Vec) => Vec;
} {
  const held = { ...p, outfit: { ...p.outfit, carry: "umbrella" as const } };
  const rest = restSkeleton(p).right.arm;
  const now = skeletonOf(held, "stand", 0).right.arm;
  const r = handFrame(rest.wrist, rest.hand, rest.knuckles);
  const m = handFrame(now.wrist, now.hand, now.knuckles);
  const swap = (from: readonly [Vec, Vec, Vec], to: readonly [Vec, Vec, Vec], d: Vec): Vec =>
    from.reduce<Vec>((n, axis, i) => madd(n, to[i] ?? axis, dot(axis, d)), [0, 0, 0]);
  return {
    toRest: (at) => add(rest.wrist, swap(m, r, sub(at, now.wrist))),
    toHeld: (at) => add(now.wrist, swap(r, m, sub(at, rest.wrist))),
    spin: (d) => swap(m, r, d),
  };
}

/** Where a fist's middle is, the shaft running through it, on a hand at rest. */
export function gripOf(arm: Arm, u: Vec): { readonly centre: Vec; readonly along: Vec; readonly round: Vec } {
  const along = unit(sub(arm.hand, arm.wrist), SIDE);
  const flat = unit(sub(u, scale(along, dot(u, along))));
  const round = unit(cross(along, flat));
  return { centre: madd(madd(arm.wrist, along, 0.075), round, 0.03), along, round };
}

/** A hand shut round a shaft: a palm against it, four fingers and a thumb coming back the other way. */
function drawFist(kit: Kit, p: Person, arm: Arm): void {
  const u = unit(heldHand(p).spin(SHAFT));
  const { centre, along, round } = gripOf(arm, u);
  const finger = 0.0088;
  put(kit, ["palm.R", "skin"], [madd(arm.wrist, along, 0.012), madd(centre, round, -0.02)], { r: 0.032, r1: 0.038, flat: 0.6, up: round, melt: 0.8 });
  for (let i = 0; i < 4; i += 1) {
    const at = madd(centre, u, (i - 1.5) * 0.021);
    const knuckle = madd(madd(at, along, 0.024), round, -0.024);
    const bend = madd(madd(at, along, 0.03), round, 0.012);
    const tip = madd(madd(at, along, -0.002), round, 0.03);
    put(kit, [`fingers.R.${String(i)}.0`, "skin"], [knuckle, bend], { r: finger * 1.1, r1: finger, melt: 0.3, detail: 1 });
    put(kit, [`fingers.R.${String(i)}.1`, "skin"], [bend, tip], { r: finger, r1: finger * 0.8, melt: 0.3, detail: 1 });
  }
  const root = madd(madd(centre, along, -0.04), u, 0.03);
  put(kit, ["thumb.R", "skin"], [root, madd(madd(centre, u, 0.036), round, 0.024)], { r: 0.0125, r1: 0.009, melt: 0.4, detail: 1 });
}

function drawHand(kit: Kit, p: Person, arm: Arm, side: number): void {
  const L = side < 0 ? "L" : "R";
  if (p.outfit.carry === "umbrella" && side > 0 && unit(sub(arm.hand, arm.wrist))[0] > 0.9) {
    drawFist(kit, p, arm);
    return;
  }
  const along = unit(sub(arm.hand, arm.wrist), scale(UP, -1));
  const across = FRONT;
  const palm = lerpV(arm.wrist, arm.hand, 0.75);
  put(kit, [`palm.${L}`, "skin"], [madd(arm.wrist, along, 0.02), madd(palm, along, 0.012)], { r: 0.027, r1: 0.041, flat: 0.5, up: unit(cross(along, FRONT)), melt: 0.8 });
  put(kit, [`fingers.${L}`, "skin"], [madd(arm.hand, across, -0.03), madd(arm.hand, across, 0.03)], { r: 0.0098, row: 4, reach: sub(arm.tip, arm.hand), detail: 1 });
  put(kit, [`tips.${L}`, "skin"], [madd(arm.tip, across, -0.03), madd(arm.tip, across, 0.03)], { r: 0.0088, row: 4, reach: sub(arm.nail, arm.tip), detail: 1 });
  put(kit, [`thumb.${L}`, "skin"], [madd(arm.wrist, FRONT, 0.024), add(madd(palm, FRONT, 0.042), [-side * 0.01, 0, 0])], { r: 0.012, r1: 0.009, detail: 1 });
}

export function drawArm(kit: Kit, p: Person, arm: Arm, side: number): void {
  const L = side < 0 ? "L" : "R";
  const k = limbWide(p.build);
  const sleeve = TOP_SLEEVE[p.outfit.top];
  const out: Vec = [side, 0, 0];
  clad(kit, [`arm.${L}`, "top"], [arm.shoulder, arm.elbow], { r: [0.044 * k, 0.047 * k, 0.037 * k], upto: Math.min(1, sleeve * 2), on: out, fit: p.outfit.fit });
  clad(kit, [`fore.${L}`, "top"], [arm.elbow, arm.wrist], { r: [0.038 * k, 0.041 * k, 0.027], upto: Math.max(0, sleeve * 2 - 1), on: FRONT, fit: p.outfit.fit });
  drawHand(kit, p, arm, side);
}

function drawShoe(kit: Kit, p: Person, leg: Leg, L: string): void {
  const { shoe } = p.outfit;
  const back = unit(sub(leg.ankle, leg.toe));
  const { foot } = p.build;
  const heel = add(madd(leg.ankle, back, 0.03 * foot), [0, -0.038, 0]);
  const arch = add(lerpV(leg.ankle, leg.toe, 0.7), [0, -0.036, 0]);
  const sandal = shoe === "sandal";
  if (shoe === "boot") put(kit, [`boot.${L}`, "shoe"], [lerpV(leg.knee, leg.ankle, 0.6), leg.ankle], { r: 0.05, r1: 0.052 });
  put(kit, [`shoe.${L}`, sandal ? "skin" : "shoe"], [heel, arch], { r: (sandal ? 0.036 : 0.05) * foot, r1: (sandal ? 0.034 : 0.046) * foot, flat: 0.8, up: UP });
  put(kit, [`toe.${L}`, sandal ? "skin" : "shoe"], [arch, add(leg.toe, [0, -0.044, 0])], { r: (sandal ? 0.034 : 0.046) * foot, r1: 0.04 * foot, flat: 0.72, up: UP });
  put(kit, [`sole.${L}`, "sole"], [add(heel, [0, -0.036, 0]), add(leg.toe, [0, -0.07, 0])], { r: 0.05 * foot, r1: 0.044 * foot, flat: 0.16, up: UP, melt: 0, detail: 2 });
}

/** How far down a thigh its cloth comes: none under a skirt, most of the way in shorts, all of it otherwise. */
function thighCover(skirted: boolean, shorts: boolean): number {
  if (skirted) return 0;
  return shorts ? 0.72 : 1;
}

export function drawLeg(kit: Kit, p: Person, leg: Leg, L: string): void {
  const k = limbWide(p.build);
  const { bottom, top } = p.outfit;
  const skirted = bottom === "skirt" || top === "dress" || top === "robe";
  const fit = bottom === "leggings" ? 0 : p.outfit.fit;
  const shorts = bottom === "shorts";
  clad(kit, [`thigh.${L}`, "bottom"], [leg.hip, leg.knee], { r: [0.09 * k, 0.082 * k, 0.056 * k], upto: thighCover(skirted, shorts), on: FRONT, fit: fit });
  clad(kit, [`shin.${L}`, "bottom"], [leg.knee, leg.ankle], { r: [0.054 * k, 0.058 * k, 0.036], upto: skirted || shorts ? 0 : 1, on: scale(FRONT, -1), fit: fit });
  drawShoe(kit, p, leg, L);
}

/** Round a torso's station: its half width and depth at a height. */
export function drawTorso(kit: Kit, p: Person, s: Skeleton): void {
  const { shoulder, hip, girth, chest, head } = p.build;
  const up = FRONT;
  const { top } = p.outfit;
  const low = LONG_TOP[top] === undefined ? "bottom" : "top";
  const belly = Math.max(0, girth - 1) * 0.06 + p.build.belly;
  const waist = mix(hip, shoulder, 0.16) * mix(0.76, 1.08, girth - 0.78) * p.build.waist;
  const ribs = madd(s.chest, FRONT, chest);
  put(kit, ["hips", low], [madd(s.pelvis, FRONT, -0.008), lerpV(s.pelvis, s.waist, 0.72)], { r: hip * 1.04 * Math.sqrt(girth), r1: waist * 1.02, flat: 0.72, up, melt: 0.12 });
  put(kit, ["belly", "top"], [madd(lerpV(s.pelvis, s.waist, 0.72), FRONT, belly), ribs], { r: waist * 1.03, r1: shoulder * 0.88, flat: 0.66, up, melt: 1 });
  put(kit, ["ribs", "top"], [ribs, lerpV(ribs, s.neck, 0.38)], { r: shoulder * 0.88, r1: shoulder * 0.6, flat: 0.6, up, melt: 1 });
  for (const [x, arm] of [[-1, s.left.arm], [1, s.right.arm]] as const) put(kit, [`yoke.${String(x)}`, "top"], [add(s.neck, [x * 0.03, -0.075, -0.012]), arm.shoulder], { r: 0.034, r1: 0.052, melt: 1 });
  if (p.build.sex === "female" && p.build.age !== "toddler" && p.build.age !== "child") for (const x of [-1, 1]) ball(kit, [`bust.${String(x)}`, "top"], add(ribs, [x * shoulder * 0.42, -0.015, shoulder * 0.42]), { r: shoulder * (p.build.age === "teen" ? 0.26 : 0.34) * p.build.bust, melt: 1.4 });
  put(kit, ["neck", "skin"], [add(s.neck, [0, -0.03, -0.012]), madd(madd(s.head, UP, -head * 0.62), FRONT, -head * 0.08)], { r: head * 0.54 * neckBy(p) * Math.sqrt(girth * p.build.limb), r1: head * 0.47 * neckBy(p) * Math.sqrt(p.build.limb), melt: 1 });
}

/** A skirt, or the lower half of something long: a cone flaring from the hips, cut off level at its hem. */
function drawSkirt(kit: Kit, p: Person, s: Skeleton): void {
  const { hip } = p.build;
  const { top, bottom, fit } = p.outfit;
  const long = LONG_TOP[top];
  if (long === undefined && bottom !== "skirt") return;
  const reach = long ?? 0.78;
  const hem = lerpV(
    lerpV(s.left.leg.hip, s.left.leg.knee, reach),
    lerpV(s.right.leg.hip, s.right.leg.knee, reach),
    0.5,
  );
  const flare = hip * (1.26 + fit * 0.4);
  put(kit, ["skirt", long === undefined ? "bottom" : "top"], [s.pelvis, madd(hem, UP, -flare * 0.72)], { r: hip * 1.04, r1: flare, flat: 0.78, up: FRONT, melt: 0.5, hem: hem[1] });
}

/** A collar, a shirt and a tie under a jacket. */
function drawLapels(kit: Kit, s: Skeleton): void {
  put(kit, ["collar", "top"], [add(s.neck, [-0.075, -0.045, -0.01]), add(s.neck, [0.075, -0.045, -0.01])], { r: 0.034, flat: 0.6, up: UP, melt: 0.3 });
}

function drawStripes(kit: Kit, p: Person, s: Skeleton, ribs: Vec): void {
  const { top, stripes, costume } = p.outfit;
  if (LONG_TOP[top] !== undefined && costume !== "firefighter") return;
  for (let i = 0; i < stripes; i += 1) band(kit, [`stripe.${String(i)}`, "trim"], lerpV(s.waist, ribs, (i + 0.5) / stripes), [p.build.shoulder * 1.4, 0.013]);
}

/**
 * A hood that is down: its opening a thick roll of cloth round the neck, crossing at the throat, and the bag of it
 * lying flat on the back; two cords down the front. Only the bag where parts are few.
 */
function drawHood(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { head } = p.build;
  const r = head * 0.62;
  const base = add(s.neck, [0, -0.035, -0.006]);
  const rim = (t: number, side: number): Vec =>
    add(base, [
      side * Math.sin(t) * r,
      0.022 * (1 - Math.cos(t)) - 0.018 * Math.max(0, Math.cos(t)),
      Math.cos(t) * r * 0.86,
    ]);
  if (rich) for (const side of [-1, 1]) for (let i = 0; i < 4; i += 1) put(kit, [`hood.rim.${String(side)}.${String(i)}`, "top"], [rim(-0.12 + i * 1.02, side), rim(-0.12 + (i + 1) * 1.02, side)], { r: head * 0.2, melt: 0.5 });
  const back = lerpV(s.neck, s.chest, 0.5);
  put(kit, ["hood.bag", "top"], [add(lerpV(s.neck, s.chest, 0.2), [0, 0, -0.095]), add(back, [0, -0.06, -0.125])], { r: head * 0.62, r1: head * 0.22, flat: 0.16, up: FRONT, melt: 0.8 });
  if (rich) for (const side of [-1, 1]) put(kit, [`cord.${String(side)}`, "trim"], [add(s.neck, [side * 0.03, -0.06, 0.14]), add(lerpV(s.neck, s.chest, 0.82), [side * 0.036, -0.09, 0.15])], { r: 0.012, decal: true, flat: 0.5, up: FRONT, melt: 0.2 });
}

export function drawClothes(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { top, bottom } = p.outfit;
  const { hip, chest } = p.build;
  const ribs = madd(s.chest, FRONT, chest);
  if (top === "hoodie") {
    drawHood(kit, p, s, rich);
    const low = lerpV(s.waist, s.pelvis, 0.12);
    put(kit, ["pouch", "trim"], [add(low, [-hip * 0.5, 0, 0.1]), add(low, [hip * 0.5, 0, 0.1])], { r: 0.075, decal: true, flat: 0.5, up: UP, melt: 0.2 });
  }
  if (top === "jacket" || top === "blazer" || top === "coat") drawLapels(kit, s);
  if (top === "polo") put(kit, ["collar", "trim"], [add(s.neck, [-0.06, -0.045, 0.02]), add(s.neck, [0.06, -0.045, 0.02])], { r: 0.026, flat: 0.6, up: UP, melt: 0.3 });
  drawStripes(kit, p, s, ribs);
  const belt = lerpV(s.pelvis, s.waist, 0.72);
  if (bottom === "jeans" || bottom === "trousers" || bottom === "cargo") band(kit, ["belt", "dark"], belt, [hip * 1.2, 0.013]);
  drawSkirt(kit, p, s);
  if (p.outfit.costume === "fursuit") put(kit, ["brush", "skin"], [add(s.pelvis, [0, 0, -0.12]), add(s.pelvis, [0, -0.24, -0.56])], { r: 0.07, r1: 0.13, melt: 0.6 });
}

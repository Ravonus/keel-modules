// The head: skull, eyes, nose, mouth, ears, hat and hair as capsules.

import { FRONT, SIDE, UP, add, madd, mix, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Face, HairStyle, Hat, Person } from "../body/person.js";
import type { Skeleton } from "../motion/skeleton.js";
import { ball, paint, put } from "../mesh/parts.js";
import type { Kit } from "../mesh/parts.js";
import { AFRO, AFRO_AT, tuckOf } from "./hair.js";

// ---------------------------------------------------------------- the head

/**
 * A head's room. `at` is the old frame hair and hats hang on, x in shares of the skull's width; `bone` and `mark` take
 * x in head radii, `mark` for what stays put whatever the skull's width.
 */
export interface HeadFrame {
  readonly c: Vec;
  readonly r: number;
  readonly at: (x: number, y: number, z: number) => Vec;
  readonly bone: (x: number, y: number, z: number) => Vec;
  readonly mark: (x: number, y: number, z: number) => Vec;
}

export function headFrame(s: Skeleton, r: number, face: Face): HeadFrame {
  const { W, L, D } = face.bone;
  const on = (x: number, y: number, z: number): Vec =>
    add(s.head, [x * r, (y < 0 ? y * L : y) * r, (z < 0 ? z * D : z) * r]);
  return { c: s.head, r, at: (x, y, z) => on(x * W * 0.84, y, z), bone: (x, y, z) => on(x * W, y, z), mark: on };
}

/** A melt that is the same share of any head, a child's as a grown one's. */
const meltBy = (p: Person) => (share: number): number => (share * p.build.head * p.build.size) / 0.03;

function drawEyes(kit: Kit, p: Person, h: HeadFrame): void {
  const { face } = p;
  const { r } = h;
  for (const x of [-1, 1]) {
    const L = x < 0 ? "L" : "R";
    const at = h.mark(x * face.apart, face.bone.pupil, 0.74);
    const eye = r * face.eye;
    // (Drawn out across the face and sunk under the skin: sdf-body paints the eye on whatever lies over it.)
    put(kit, `eye.${L}`, "eye", add(at, [-eye * 0.42, 0, 0]), add(at, [eye * 0.42, 0, 0]), eye * 0.74, { flat: 0.3, up: unit([x * 0.16, 0, 1]), melt: 0 });
    const brow = h.mark(x * face.apart, face.bone.pupil + 0.28, 0.94);
    paint(kit, `brow.${L}`, "brow", add(brow, [-x * r * 0.2, -face.browTilt * r * 0.6, 0]), add(brow, [x * r * 0.2, face.browTilt * r * 0.6, -r * 0.04]), r * 0.05 * (0.5 + face.brow * 0.7));
  }
}

/** How far forward the lip lies under the nose, on any head: a nose stands off this, so no jaw can bury it. */
const NOSE_ROOT = 1.02;

function drawNose(kit: Kit, p: Person, h: HeadFrame): void {
  const { nose, noseWide, bone: b } = p.face;
  const melt = meltBy(p);
  const r = h.r;
  const fine = p.build.sex === "female" ? mix(1, 0.8, b.m) : 1;
  const top = b.pupil + 0.02;
  const y = b.sub + b.tipY;
  const far = Math.min(NOSE_ROOT + nose * 0.62 * mix(1, 0.86, 1 - fine), 1.3);
  const bulb = mix(0.095, 0.125, b.m);
  const tip = h.mark(b.askew, y, far - bulb);
  put(kit, "bridge", "skin", h.mark(0, top, 0.8), madd(tip, [0, 1, -0.3], r * 0.05), r * mix(0.075, 0.1, b.m) * fine, { r1: r * mix(0.085, 0.125, b.m) * fine, flat: 0.85, up: SIDE, melt: melt(0.07) });
  ball(kit, "tip", "skin", tip, r * bulb, { melt: melt(0.07) });
  for (const x of [-1, 1]) ball(kit, `ala.${String(x)}`, "skin", h.mark(x * (noseWide - mix(0.05, 0.08, b.m)) + b.askew * 0.5, b.sub + 0.05, NOSE_ROOT - 0.04), r * mix(0.06, 0.09, b.m), { flat: 0.8, up: SIDE, melt: melt(0.07) });
  if (b.hump > 0.02) ball(kit, "hump", "skin", h.mark(0, (top + y) * 0.52, (0.86 + far) * 0.5 + b.hump - 0.03), r * 0.08, { flat: 0.75, up: SIDE, melt: melt(0.05) });
}

/**
 * A line and no more, the lower lip only hinted under it: thin sheets through the face, so they find it wherever it
 * lies and never stand off it as a beak.
 */
function drawMouth(kit: Kit, p: Person, h: HeadFrame): void {
  const { mouthWide: w, lips, bone } = p.face;
  const y = bone.sto;
  put(kit, "mouth", "dark", h.mark(0, y, 0.5), h.mark(0, y, 1.2), h.r * w * 0.78, { decal: true, flat: 0.085, up: UP, melt: 0.2 });
  // (A full lower lip, melted into the face.)
  put(kit, "lip", "lip", h.mark(-w * 0.42, y - 0.085, 0.92), h.mark(w * 0.42, y - 0.085, 0.92), h.r * lips * 0.07, { flat: 0.6, up: UP, melt: 0.2 });
  put(kit, "lip.top", "lip", h.mark(-w * 0.5, y + 0.05, 0.92), h.mark(w * 0.5, y + 0.05, 0.92), h.r * lips * 0.05, { flat: 0.55, up: UP, melt: 0.18 });
}

/**
 * A renderer that paints a part on gets a beard as paint. On a mesh it is painted on the vertices, by `faceBake`, and
 * stands proud of the jaw.
 */
function drawFaceHair(kit: Kit, p: Person, h: HeadFrame, rich: boolean): void {
  const { hair, mouthWide: w, bone: b } = p.face;
  if (hair !== "beard" && hair !== "moustache") return;
  if (rich) { if (hair === "beard") beardVolume(kit, p, h);
  return; }
  if (hair === "beard") paint(kit, "beard", "hair", h.bone(0, b.men + 0.2, 0.5), h.bone(0, b.men + 0.3, 0.7), h.r * 0.42);
  paint(kit, "tache", "hair", h.mark(-w * 1.05, b.sub - 0.08, 0.96), h.mark(w * 1.05, b.sub - 0.08, 0.96), h.r * 0.075);
}

/**
 * A beard is one clean shape first: a shell that stands off the jaw from the ear round the chin and up over the lip,
 * its edge wherever it leaves the skin, and the mouth left clear.
 */
function beardVolume(kit: Kit, p: Person, h: HeadFrame): void {
  const { mouthWide: w, bone: b } = p.face;
  const melt = meltBy(p);
  const r = h.r;
  const y = b.men + 0.17;
  const z = b.pogZ - 0.16;
  ball(kit, "beard.chin", "beard", h.bone(0, y, z), r * 0.25, { melt: melt(0.14) });
  put(kit, "beard.lip", "beard", h.mark(-w * 1.02, b.sub - 0.09, 0.9), h.mark(w * 1.02, b.sub - 0.09, 0.9), r * 0.075, { melt: melt(0.06) });
  for (const x of [-1, 1]) {
    const side = String(x);
    const corner = h.bone(x * (b.gon - 0.14), b.gonY + 0.14, b.gonZ + 0.16);
    put(kit, `beard.jaw.${side}`, "beard", corner, h.bone(x * 0.12, y, z - 0.02), r * 0.2, { r1: r * 0.23, melt: melt(0.14) });
    put(kit, `beard.burn.${side}`, "beard", h.bone(x * (b.zyg - 0.1), -0.04, 0.02), corner, r * 0.09, { r1: r * 0.17, melt: melt(0.12) });
    put(kit, `beard.soul.${side}`, "beard", h.mark(x * (w + 0.1), b.sub - 0.09, 0.84), h.bone(x * (w + 0.06), b.sto - 0.2, 0.74), r * 0.08, { r1: r * 0.11, melt: melt(0.1) });
  }
}

function drawEars(kit: Kit, p: Person, h: HeadFrame): void {
  const tucks = tuckOf(p);
  [-1, 1].forEach((x, side) => {
    const size = p.face.ears * (tucks[side] ? 1 : 0.3);
    put(kit, `ear.${String(x)}`, "skin", h.at(x * 0.92, 0.12, -0.06), h.at(x * 0.9, -0.16, 0.02), h.r * size, { r1: h.r * size * 0.66, flat: 0.34, up: unit([x, 0, 0.3]), melt: 0.3, detail: 1 });
  });
}

/** How wide each hat's brim runs all round, in head radii. */
const BRIMS: Partial<Record<Hat, number>> = {
  fedora: 1.5,
  sunhat: 2,
  stetson: 1.9,
  helmet: 1.5,
  bucket: 1.42,
  bowler: 1.34,
  tophat: 1.36,
};

/** How much taller than the skull each hat's crown stands. */
export const CROWN_RISE: Partial<Record<Hat, number>> = {
  stetson: 0.24,
  peaked: 0.24,
  bowler: 0.12,
  bucket: 0.07,
  beret: 0.1,
  headwrap: 0.2,
  hardhat: 0.1,
};

/**
 * The crown is the skull's own shape a little bigger, cut off level across the forehead: it sits on the head, not over
 * it. A hood and a helmet stand well clear of it.
 */
function drawCrown(kit: Kit, hat: Hat, h: HeadFrame, wide: number): void {
  const clear = hat === "hood" || hat === "helmet" || hat === "hardhat";
  const brim = h.at(0, hat === "hood" ? -0.1 : clear ? 0.58 : 0.5, 0)[1];
  const tall = CROWN_RISE[hat] ?? 0;
  put(kit, "hat", hat === "hood" ? "top" : "trim", h.at(0, 0.3, -0.12), h.at(0, 0.14 + tall, -0.06), h.r * (clear ? 1.2 : 1.16) * mix(1, wide, 0.75), { flat: clear ? 0.88 : 0.76, up: SIDE, melt: 0.08, hem: brim, shadow: false });
}

/** What makes one hat not another: a bobble, a ridge, a knot. */
function drawTrim(kit: Kit, hat: Hat, h: HeadFrame): void {
  if (hat === "pompom") ball(kit, "hat.pom", "trim", h.at(0, 1.42, -0.1), h.r * 0.3, { melt: 0.2, shadow: false });
  if (hat === "hardhat") put(kit, "hat.ridge", "trim", h.at(0, 1.2, 0.5), h.at(0, 1.2, -0.7), h.r * 0.18, { melt: 0.5, shadow: false });
  if (hat === "headwrap") ball(kit, "hat.knot", "trim", h.at(0.16, 1.2, 0.5), h.r * 0.3, { melt: 0.3, shadow: false });
  if (hat === "bandana") for (const x of [-1, 1]) put(kit, `hat.tail.${String(x)}`, "trim", h.at(x * 0.05, 0.5, -1.16), h.at(x * 0.26, -0.1, -1.3), h.r * 0.1, { r1: h.r * 0.04, flat: 0.4, up: FRONT, melt: 0.3, shadow: false });
}

function drawHat(kit: Kit, p: Person, h: HeadFrame): void {
  const { hat } = p.outfit;
  if (hat === "none") return;
  if (hat === "beret") { ball(kit, "hat", "trim", h.at(0.1, 0.72, -0.14), h.r * 1.04, { flat: 0.5, up: UP, melt: 0.08, shadow: false });
  return; }
  if (hat === "tophat") put(kit, "hat.top", "trim", h.at(0, 0.62, -0.1), h.at(0, 1.42, -0.1), h.r * 0.92, { melt: 0.05, shadow: false });
  else if (hat !== "visor") drawCrown(kit, hat, h, p.face.bone.W);
  drawTrim(kit, hat, h);
  const wide = BRIMS[hat];
  if (wide !== undefined) ball(kit, "peak", "trim", h.at(0, 0.6, hat === "helmet" ? -0.26 : -0.1), h.r * wide, { flat: 0.06, up: UP, melt: 0.1, shadow: false });
  if (hat === "cap" || hat === "peaked" || hat === "flatcap" || hat === "visor" || hat === "hardhat") put(kit, "peak", "trim", h.at(0, 0.56, 0.9), h.at(0, 0.46, 1.4), h.r * 0.5, { r1: h.r * 0.38, flat: 0.22, up: unit([0, 1, 0.2]), melt: 0.5, shadow: false });
}

/** A fursuit's head: a muzzle, a nose and ears, in the pelt. */
function drawFur(kit: Kit, h: HeadFrame): void {
  put(kit, "muzzle", "belly", h.at(0, -0.3, 0.9), h.at(0, -0.36, 1.4), h.r * 0.48, { r1: h.r * 0.3, melt: 1 });
  ball(kit, "snout", "dark", h.at(0, -0.26, 1.68), h.r * 0.13, { melt: 0.2 });
  for (const x of [-1, 1]) put(kit, `ear.${String(x)}`, "skin", h.at(x * 0.6, 0.9, -0.1), h.at(x * 0.86, 1.86, -0.12), h.r * 0.44, { r1: h.r * 0.06, flat: 0.5, up: FRONT, melt: 0.5 });
}

/**
 * The hair's shell: up over the crown and down the back of the skull, its line clear of the brow and the ears' fronts.
 */
const hairCap = (kit: Kit, h: HeadFrame, k: number): void => { put(kit, "hair", "hair", h.at(0, 0.56, -0.26), h.at(0, 0.24, -0.42), h.r * 0.98 * k, { melt: 0.1, shadow: false }); };

/** The hair, on a head: each style a few parts, the same on every side of them. */
const HAIR_STYLES: Readonly<Record<HairStyle, (kit: Kit, h: HeadFrame) => void>> = {
  bald: () => undefined,
  crop: (kit, h) => { hairCap(kit, h, 0.98); },
  side: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "fringe", "hair", h.at(-0.5, 0.86, 0.5), h.at(0.68, 0.62, 0.58), h.r * 0.2, { r1: h.r * 0.13, melt: 0.7 });
  },
  curly: (kit, h) => {
    hairCap(kit, h, 0.98);
    for (const [i, [x, y, z]] of ([[0, 1.08, 0.2], [-0.66, 0.84, 0.16], [0.66, 0.84, 0.16], [-0.72, 0.5, -0.5], [0.72, 0.5, -0.5], [0, 0.78, -0.9]] as const).entries()) ball(kit, `curl.${String(i)}`, "hair", h.at(x, y, z), h.r * 0.42, { melt: 0.3 });
  },
  afro: (kit, h) => { ball(kit, "hair", "hair", h.at(AFRO_AT[0], AFRO_AT[1], AFRO_AT[2]), h.r * AFRO, { melt: 0.1, shadow: false }); },
  bob: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const x of [-1, 1]) put(kit, `bob.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.2), h.at(x * 0.82, -0.82, -0.14), h.r * 0.36, { r1: h.r * 0.3, melt: 0.6 });
    put(kit, "bob.back", "hair", h.at(0, 0.2, -0.76), h.at(0, -0.86, -0.72), h.r * 0.86, { melt: 0.6, flat: 0.6, up: FRONT });
  },
  long: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const x of [-1, 1]) put(kit, `lock.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.24), h.at(x * 0.92, -1.5, -0.2), h.r * 0.34, { r1: h.r * 0.2, melt: 0.6 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2.5, -0.96), h.r * 0.92, { r1: h.r * 0.56, flat: 0.5, up: FRONT, melt: 0.6 });
  },
  bun: (kit, h) => {
    hairCap(kit, h, 1);
    ball(kit, "bun", "hair", h.at(0, 1.26, -0.5), h.r * 0.42, { melt: 0.3 });
  },
  pony: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "tail", "hair", h.at(0, 0.7, -1.1), h.at(0, -1.5, -1.5), h.r * 0.3, { r1: h.r * 0.1, melt: 0.3 });
  },
  shag: (kit, h) => {
    hairCap(kit, h, 1.02);
    for (const [i, [x, z]] of ([[-0.9, 0.1], [0.9, 0.1], [-0.7, -0.6], [0.7, -0.6], [0, -0.96]] as const).entries()) put(kit, `lock.${String(i)}`, "hair", h.at(x, 0.4, z), h.at(x * 1.08, -0.95, z * 1.1), h.r * 0.34, { r1: h.r * 0.1, melt: 0.5 });
    put(kit, "fringe", "hair", h.at(-0.5, 0.74, 0.62), h.at(0.5, 0.74, 0.62), h.r * 0.24, { melt: 0.6 });
  },
  bangs: (kit, h) => {
    hairCap(kit, h, 1.02);
    put(kit, "fringe", "hair", h.at(-0.6, 0.66, 0.66), h.at(0.6, 0.66, 0.66), h.r * 0.36, { melt: 1.2 });
    for (const x of [-1, 1]) put(kit, `lock.${String(x)}`, "hair", h.at(x * 0.86, 0.3, -0.24), h.at(x * 0.9, -1.3, -0.2), h.r * 0.32, { r1: h.r * 0.2, melt: 0.6 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2, -0.9), h.r * 0.9, { r1: h.r * 0.6, flat: 0.5, up: FRONT, melt: 0.6 });
  },
  wavy: (kit, h) => {
    hairCap(kit, h, 1.04);
    for (const x of [-1, 1]) for (const [i, y] of [0.1, -0.6, -1.3].entries()) ball(kit, `wave.${String(x)}.${String(i)}`, "hair", h.at(x * (0.86 + (i % 2) * 0.16), y, -0.2), h.r * (0.42 - i * 0.05), { melt: 1.2 });
    put(kit, "fall", "hair", h.at(0, 0.2, -0.8), h.at(0, -2, -0.9), h.r * 0.94, { r1: h.r * 0.66, flat: 0.5, up: FRONT, melt: 0.8 });
  },
  braids: (kit, h) => {
    hairCap(kit, h, 1);
    for (const x of [-1, 1]) for (let i = 0; i < 5; i += 1) ball(kit, `plait.${String(x)}.${String(i)}`, "hair", h.at(x * (0.86 - i * 0.03) + (i % 2) * 0.05, -0.4 - i * 0.4, 0), h.r * (0.2 - i * 0.012), { melt: 0.5 });
  },
  locs: (kit, h) => {
    hairCap(kit, h, 1);
    put(kit, "locs", "hair", h.at(-0.95, 0.2, -0.5), h.at(0.95, 0.2, -0.5), h.r * 0.16, { row: 7, reach: [0, -h.r * 2.3, -h.r * 0.2] });
    put(kit, "locs.back", "hair", h.at(-0.6, 0.3, -1), h.at(0.6, 0.3, -1), h.r * 0.16, { row: 5, reach: [0, -h.r * 2.5, -h.r * 0.2] });
  },
  twintails: (kit, h) => {
    hairCap(kit, h, 1);
    for (const x of [-1, 1]) put(kit, `tail.${String(x)}`, "hair", h.at(x * 1, 0.6, -0.3), h.at(x * 1.34, -1.2, -0.4), h.r * 0.3, { r1: h.r * 0.1, melt: 0.3 });
  },
  undercut: (kit, h) => {
    put(kit, "hair", "hair", h.at(0, 0.84, -0.06), h.at(0, 0.7, -0.4), h.r * 0.74, { melt: 0.1, shadow: false });
    put(kit, "fringe", "hair", h.at(-0.34, 1.06, 0.56), h.at(0.5, 0.98, 0.62), h.r * 0.24, { melt: 0.6 });
  },
  mohawk: (kit, h) => { put(kit, "hair", "hair", h.at(0, 1.34, 0.5), h.at(0, 1.22, -0.92), h.r * 0.34, { flat: 0.34, up: SIDE, melt: 0.3 }); },
};

/** What each style comes to under a hat. */
export const HATTED: Partial<Record<HairStyle, HairStyle>> = { afro: "crop", curly: "crop", mohawk: "crop", undercut: "crop", bun: "bob", twintails: "bob" };

/** A head for a renderer with few parts to spare: the same masses as `boneHead`, each stood for by one. */
function leanHead(kit: Kit, p: Person, h: HeadFrame): void {
  const b = p.face.bone;
  const r = h.r;
  const melt = meltBy(p);
  const inX = b.gon - 0.13;
  put(kit, "maxilla", "skin", h.bone(0, 0.14, 0.3), h.bone(0, b.sto, 0.56), r * 0.6, { r1: r * 0.44, melt: melt(0.18) });
  put(kit, "floor", "skin", h.bone(0, b.gonY + 0.02, 0.08), h.bone(0, b.men + 0.22, 0.6), r * 0.34, { r1: r * 0.2, flat: 0.62, up: UP, melt: melt(0.1) });
  put(kit, "chin", "skin", h.bone(-Math.max(0.02, b.chin - 0.14), b.men + 0.16, b.pogZ - 0.14), h.bone(Math.max(0.02, b.chin - 0.14), b.men + 0.16, b.pogZ - 0.14), r * 0.14, { melt: melt(0.07) });
  for (const x of [-1, 1]) {
    ball(kit, `cheek.${String(x)}`, "skin", h.bone(x * 0.46, b.cheekY, 0.5), r * 0.24, { melt: melt(0.16) });
    ball(kit, `gonion.${String(x)}`, "skin", h.bone(x * inX, b.gonY + 0.1, 0.1), r * 0.2, { melt: melt(0.15) });
  }
}

/**
 * A head for a mesh: the face's solid is `loftOf`'s, so only what stands on it is melted in: the chin's seat, and lips
 * that catch the light.
 */
function boneHead(kit: Kit, p: Person, h: HeadFrame): void {
  const { lips, mouthWide: w, bone: b } = p.face;
  const r = h.r;
  const melt = meltBy(p);
  ball(kit, "chin", "skin", h.bone(0, b.men + 0.14, b.pogZ - 0.2), r * 0.13, { melt: melt(0.05) });
  put(kit, "lips.up", "skin", h.mark(-w * 0.62, b.sto + 0.05, 0.95), h.mark(w * 0.62, b.sto + 0.05, 0.95), r * 0.05 * mix(0.8, 1, b.m) * lips, { flat: 0.7, up: UP, melt: melt(0.05) });
  put(kit, "lips.low", "skin", h.mark(-w * 0.5, b.sto - 0.07, 0.94), h.mark(w * 0.5, b.sto - 0.07, 0.94), r * 0.065 * mix(0.8, 1, b.m) * lips, { flat: 0.75, up: UP, melt: melt(0.05) });
}

/** `rich` for a mesh, which can carry as many parts as it likes; sdf-body has only so many. */
export function drawHead(kit: Kit, p: Person, s: Skeleton, rich: boolean): void {
  const { head } = p.build;
  const b = p.face.bone;
  const h = headFrame(s, head, p.face);
  // (The braincase, its lower end kept up so it never sets the width of the jaw.)
  put(kit, "skull", "skin", h.bone(0, 0.3, -1.12 + 1 / b.D), h.bone(0, 0.3, -0.06), head, { flat: 0.74 * b.W, up: SIDE });
  (rich ? boneHead : leanHead)(kit, p, h);
  drawEyes(kit, p, h);
  drawNose(kit, p, h);
  drawMouth(kit, p, h);
  drawEars(kit, p, h);
  drawFaceHair(kit, p, h, rich);
  HAIR_STYLES[p.outfit.hat === "none" ? p.hair : HATTED[p.hair] ?? p.hair](kit, h);
  drawHat(kit, p, h);
  if (p.outfit.costume === "fursuit") drawFur(kit, h);
}

// Owls: the facial disc by coat, the turned head, folded wings, barred belly, feathered legs and veil.

import { UP, add, cross, dirOf, lerpV, madd, scale, sub, unit } from "./vec.js";
import type { Vec } from "./vec.js";
import { wingStyle } from "./roster.js";
import type { Role, WingStyle } from "./roster.js";
import type { Finish, Moment } from "./moments.js";
import { ball, cap, decal } from "./kit.js";
import type { Kit } from "./kit.js";
import { at3 } from "./quad-head.js";
import type { Head } from "./quad-head.js";
import { owlShapeOf } from "./birds.js";
import type { BirdBody } from "./birds.js";
import type { Who } from "./bodies.js";

/**
 * An owl's face, by its coat: a barn owl's disc a heart (two lobes meeting
 * in a point under the bill, split by a pale ridge down from its forehead),
 * every other one round in two halves either side of it; the disc's colour
 * and the line round its rim and how wide it is (a great horned owl's dark
 * and only down its outer sides, a barn owl's thin and rust, a snowy owl's a
 * faint grey); how deep the disc is dished, in head radii (only a little: it
 * lies nearly flush with the head, so the crown never wraps it like a hood);
 * its eyes' size and where they sit across and up the face, in head radii,
 * and the ring painted round a round eye, as a share of it (a snowy owl's
 * only a thin lid); how far its crown runs flat between its corners (a snowy
 * owl's head rounder); its bill's length, in head radii, and the hooked tip
 * of it; and whether it sits in a tuft of bristles (a snowy owl's).
 */
interface OwlFace {
  readonly heart: boolean; readonly disc: Role; readonly rim: Role; readonly ring: number; readonly open: boolean; readonly dish: number;
  readonly eye: number; readonly apart: number; readonly high: number; readonly lid: number; readonly crown: number; readonly bill: number; readonly tip: Role; readonly bristle: boolean;
}
const OWL_FACE: OwlFace = { heart: false, disc: "accent", rim: "dark", ring: 0.13, open: false, dish: 0.04, eye: 0.3, apart: 0.46, high: 0.1, lid: 1.28, crown: 0.4, bill: 0.3, tip: "dark", bristle: false };
const OWL_FACES: Readonly<Record<string, OwlFace>> = {
  barn: { ...OWL_FACE, heart: true, disc: "belly", rim: "accent", ring: 0.05, dish: 0.02, eye: 0.17, apart: 0.36, high: 0.1, crown: 0.36, bill: 0.2 },
  "great horned": { ...OWL_FACE, disc: "belly", open: true, lid: 1.2 },
  snowy: { ...OWL_FACE, rim: "alt", ring: 0.06, dish: 0.05, eye: 0.27, apart: 0.4, high: 0.14, lid: 1.12, crown: 0.2, bill: 0.2, tip: "horn", bristle: true },
};
const owlFaceOf = (who: Who): OwlFace => OWL_FACES[who.member.coat] ?? OWL_FACE;

/** An owl's skull: how far back of its middle it sits, its radius across, and how flat its front, in head radii. */
const owlSkull = (face: OwlFace): { readonly back: number; readonly r: number; readonly flat: number } => ({ back: -0.05, r: 1.2 - face.crown * 0.5, flat: 0.76 });

/** A point `s` across and `u` up an owl's face, `out` head radii off the skull's front (as `owlHead` draws it). */
function onOwlFace(h: Head, face: OwlFace, s: number, u: number, out = 0): Vec {
  const skull = owlSkull(face);
  const ds = Math.max(0, Math.abs(s) - face.crown);
  return at3(h, skull.back + skull.flat * Math.sqrt(Math.max(0, skull.r * skull.r - ds * ds - u * u)) + out, s, u);
}

/**
 * An owl's head: broad and flat-crowned, sunk into its shoulders with no
 * neck between them, its face a disc nearly flush with its front, both eyes
 * forward in it and the bill hooked down between them; a great horned owl's
 * ear tufts up from the corners of its crown.
 */
export function owlHead(kit: Kit, who: Who, head: Head, m: Moment): void {
  const face = owlFaceOf(who);
  const skull = owlSkull(face);
  // (Carried back, right over its toes.)
  const h: Head = { ...head, c: madd(head.c, [0, 0, 1], -head.r * 0.05) };
  // (Wider than it is tall, so the crown runs flat between its corners, and flattened in front for the face;
  // sunk into the top of its body and melted into it, so no neck or notch shows between them.)
  cap(kit, "head", "coat", at3(h, skull.back, -face.crown, 0), at3(h, skull.back, face.crown, 0), h.r * skull.r, skull.flat, h.d, { melt: 0.9 });
  owlFaceMarks(kit, who, h, face, m.segment.act !== "sleep");
  owlDisc(kit, h, face);
  // (A barn owl's pale ridge, standing out of its heart down from its forehead to the bill.)
  if (face.heart) cap(kit, "ridge", "horn", onOwlFace(h, face, 0, 0.58, -0.05), onOwlFace(h, face, 0, -0.06, -0.03), h.r * 0.075, 1, UP, { r1: h.r * 0.06, melt: 0 });
  for (const x of [-1, 1]) owlEye(kit, h, face, x, m.segment.act !== "sleep");
  owlBeak(kit, h, face, m.pose.mouth);
  if (who.member.coat === "great horned") owlTufts(kit, h);
}

/**
 * One half of the face disc, `grow` head radii past its own edge: a lobe
 * from beside the brow down to the chin (a heart's), or round. Its flat side
 * faces out of the face, turned a little toward its own side. Painted, it
 * lies across the face; carved, it stands off it so it cuts in only `dish`
 * head radii at its deepest.
 */
function discHalf(kit: Kit, part: string, role: Role, h: Head, face: OwlFace, x: number, grow: number, finish: Finish): void {
  // (A heart's lobes overlap down its middle, so it reads as one white face and never as two goggles.)
  const [top, end] = face.heart ? [[0.42, 0.22], [0.04, -0.52]] as const : [[0.52, 0.12], [0.3, -0.24]] as const;
  const [r, r1] = face.heart ? [0.66 + grow, 0.26 + grow] : [0.66 + grow, 0.54 + grow];
  const n = unit(madd(h.d, h.s, x * 0.3));
  // (Painted, nearly round, so it marks the face the same however far the face curves back from it.)
  const thick = finish.carve === true ? 0.12 : r * 0.75;
  // (A tapered part thins with its radius: each end stands off by its own thickness.)
  const off = (k: number): number => (finish.carve === true ? thick * k - face.dish : 0);
  cap(kit, part, role, onOwlFace(h, face, x * top[0], top[1], off(1)), onOwlFace(h, face, x * end[0], end[1], off(r1 / r)), h.r * r, thick / r, n, { ...finish, r1: h.r * r1 });
}

/**
 * The face disc, in two halves: painted on the face, a thin line round its
 * rim in a darker colour, and dished only a little (a carve), so its edge
 * reads as a soft crease and never as a ring of the crown's colour.
 */
function owlDisc(kit: Kit, h: Head, face: OwlFace): void {
  // (Both halves' paint first, so inside either the rims, which are the halves grown a little, give way to it.)
  for (const x of [-1, 1]) discHalf(kit, `disc.${x < 0 ? "L" : "R"}`, face.disc, h, face, x, 0, { decal: true });
  for (const x of [-1, 1]) owlRim(kit, h, face, x);
  if (face.heart) for (const x of [-1, 1]) discHalf(kit, `dish.${x < 0 ? "L" : "R"}`, face.disc, h, face, x, -0.04, { carve: true, melt: 0.6 });
  // (A round disc's dish is one wide cut across both its halves.)
  else cap(kit, "dish", face.disc, onOwlFace(h, face, -0.46, 0.1, 0.1 - face.dish), onOwlFace(h, face, 0.46, 0.1, 0.1 - face.dish), h.r * 0.62, 0.16, h.d, { carve: true, melt: 0.6 });
}

/** The line round a half of the disc: all the way round it, or (an `open` rim) a crescent down its outer side only. */
function owlRim(kit: Kit, h: Head, face: OwlFace, x: number): void {
  const part = `rim.${x < 0 ? "L" : "R"}`;
  if (face.open) cap(kit, part, face.rim, onOwlFace(h, face, x * 0.94, 0.34), onOwlFace(h, face, x * 0.78, -0.24), h.r * 0.25, 1, UP, { r1: h.r * 0.2, decal: true });
  else discHalf(kit, part, face.rim, h, face, x, face.ring, { decal: true });
}

/**
 * Marks on the face, painted before the disc so they lie over it: the dark
 * ring round a round eye; a barn owl's crown dropping in a notch between the
 * lobes of its heart down to the bill; a great horned owl's pale brows in a V over the bill (its white
 * throat is on its body, see `owlBib`).
 */
function owlFaceMarks(kit: Kit, who: Who, h: Head, face: OwlFace, open: boolean): void {
  const on = (s: number, u: number): Vec => onOwlFace(h, face, s, u);
  // (Each stands off the face at its upper end, so it still lies on the face where the face bulges out between its ends.)
  if (who.member.coat === "barn") cap(kit, "notch", "coat", onOwlFace(h, face, 0, 0.92, 0.12), on(0, 0.14), h.r * 0.15, 1, UP, { r1: h.r * 0.03, decal: true });
  // (A round eye's dark ring painted round it on the disc, so it frames the eye however the face curves.)
  if (open && !face.heart) for (const x of [-1, 1]) decal(kit, `eye.${x < 0 ? "L" : "R"}.ring`, "dark", onOwlFace(h, face, x * face.apart, face.high), onOwlFace(h, face, x * face.apart, face.high), h.r * face.eye * face.lid);
  if (who.member.coat === "great horned") for (const x of [-1, 1]) cap(kit, `brow.${x < 0 ? "L" : "R"}`, "accent", onOwlFace(h, face, x * 0.03, -0.04, 0.02), onOwlFace(h, face, x * 0.56, 0.56, 0.05), h.r * 0.12, 1, UP, { r1: h.r * 0.07, decal: true });
}

/**
 * An owl's eye, big and forward in its disc, a little above its middle and
 * set flush into it, a flat lens that never stands out of the head's
 * outline side on: a barn owl's black, a great horned owl's or a
 * snowy owl's big and lemon yellow in a dark ring, only a thin lid on a
 * snowy owl (painted on the disc, see `owlFaceMarks`). Shut, a dark slit across the disc.
 */
function owlEye(kit: Kit, h: Head, face: OwlFace, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const r = h.r * face.eye;
  const n = unit(madd(h.d, h.s, x * 0.12));
  const surface = onOwlFace(h, face, x * face.apart, face.high, -face.dish);
  if (!open) {
    // (Up out of the dish, its ends drawn back round the face, so the slit lies on it and never stands off it.)
    const lid = madd(madd(surface, h.u, -r * 0.1), n, h.r * face.dish);
    const end = (k: number): Vec => madd(madd(lid, h.s, k * r * 0.6), n, -r * 0.1);
    cap(kit, part, "dark", end(-1), end(1), r * 0.1, 1, UP, { melt: 0 });
    return;
  }
  const across = unit(cross(n, h.u), h.s);
  const up = cross(across, n);
  // (Sunk so only a shallow lens of it stands proud, its pupil and its spark flat on it.)
  const c = madd(surface, n, -r * 0.15);
  ball(kit, part, "eye", c, r, 0.3, n);
  const dark = h.eye?.pupil === "dark";
  ball(kit, `${part}.pupil`, "pupil", madd(c, n, r * 0.2), r * (dark ? 0.76 : 0.42), 0.25, n);
  ball(kit, `${part}.shine`, "shine", madd(madd(madd(c, n, r * 0.28), up, r * 0.32), across, -r * 0.18), r * (dark ? 0.28 : 0.2), 0.4, n);
}

/**
 * An owl's bill: a short fat wedge from just under its eyes, hooked down
 * and just out past its face, its hooked tip darker: a barn owl's ivory, a
 * great horned owl's dark grey, a snowy owl's black, sunk in a tuft of white
 * bristles.
 */
function owlBeak(kit: Kit, h: Head, face: OwlFace, mouth: number): void {
  const wide = face.bill * 0.46;
  const tall = face.bill;
  const sunk = face.bristle ? 0.08 : face.heart ? 0.06 : 0;
  // (A heart's set low, down its ridge between the eyes.)
  const root = onOwlFace(h, face, 0, face.high - face.bill * (face.heart ? 1.1 : 0.75), -sunk);
  const knee = madd(madd(root, h.d, h.r * tall * 0.5), h.u, -h.r * tall * 0.4);
  const tip = madd(madd(knee, h.d, -h.r * tall * 0.16), h.u, -h.r * tall * 0.46);
  if (face.bristle) ball(kit, "beak.bristle", "accent", madd(root, h.u, -h.r * tall * 0.2), h.r * tall * 1.05, 0.62, h.d);
  cap(kit, "beak", "horn", root, knee, h.r * wide, 0.95, h.s, { r1: h.r * wide * 0.72 });
  cap(kit, "beak.tip", face.tip, knee, tip, h.r * wide * 0.72, 0.85, h.s, { r1: h.r * 0.025, melt: 0 });
  if (mouth > 0.05) cap(kit, "beak.lower", "horn", madd(root, h.u, -h.r * tall * 0.5), madd(madd(root, h.d, h.r * tall * 0.4), h.u, -h.r * tall * (0.5 + 0.6 * mouth)), h.r * wide * 0.5);
}

/**
 * A great horned owl's ear tufts: broad feathered plumes, flat and wide at
 * their base, up off its brow over each eye in a V, leaning out and a
 * little back. (They cast no shadow: off the head, theirs would fall as specks.)
 */
function owlTufts(kit: Kit, h: Head): void {
  for (const x of [-1, 1]) {
    const root = at3(h, 0.22, x * 0.42, 0.72);
    const dir = unit(add(add(h.u, scale(h.s, x * 0.42)), scale(h.d, -0.2)));
    cap(kit, `ear.${x < 0 ? "L" : "R"}`, "alt", root, madd(root, dir, h.r * 0.6), h.r * 0.4, 0.46, h.d, { r1: h.r * 0.11, melt: 0.35, shadow: false });
  }
}



/** A direction on an owl's body, turned with its shoulders (see `bodyTurn`). */
function owlTurned(body: BirdBody, [x, y, z]: Vec): Vec {
  const [c, s] = [Math.cos(body.turn), Math.sin(body.turn)];
  return [x * c + z * s, y, z * c - x * s];
}

/**
 * A point on an owl, `up` its body radii up its middle (its feet nearly two
 * below), `out` to the side `x` and `back` toward its back (negative, its
 * breast). It twists on its hips as its shoulders turn, and leans away from
 * where it looks to balance its head.
 */
function owlAt(body: BirdBody, x: number): (up: number, out: number, back: number) => Vec {
  const along = owlTurned(body, add(dirOf(0, body.pitch), [-body.turn * 0.35, 0, 0]));
  const over = owlTurned(body, [0, Math.cos(body.pitch), -Math.sin(body.pitch)]);
  const side = owlTurned(body, [x, 0, 0]);
  return (up, out, back) => madd(madd(madd(body.C, along, up * body.r), side, out * body.r), over, back * body.r);
}

/**
 * An owl's body (see `owlTorso`), three rings from its shoulders down, each
 * how far `up` its middle, its radius and how far toward its back, in its
 * radii: its shoulders high and broad so its head sinks into them, and a
 * near straight barrel from there to a full low end, a bullet with no waist
 * (kept this near straight because the pixel look steps a turned-under
 * surface a shade darker in one hard line); `OWL_DEEP` how far it runs front
 * to back as a share of across.
 */
const OWL_TRUNK = [[0.6, 1.02, 0.24], [-0.2, 1.07, 0.16], [-0.74, 1, 0.14]] as const;
const OWL_DEEP = 0.84;

/** Where an owl's folded primaries end, as `owlAt` takes them. */
const OWL_PRIMARIES = [[-0.5, 1, 0.34], [-0.82, 0.84, 0.56], [-1.12, 0.52, 0.86]] as const;

/**
 * An owl's folded wing, one long leaf wrapped round its flank from shoulder
 * to tail: a round part buried in the body so only its outer face stands
 * proud, curving with the flank so no edge of it stands off the outline,
 * broad under the shoulder and running to a point over the tail; from under
 * its lower edge the primaries' tips, each a step longer and further back
 * than the one before, so that edge comes down in stairs, in the wing's
 * darker colour.
 */
export function owlFold(kit: Kit, style: WingStyle, body: BirdBody, x: number): void {
  const r = body.r;
  const L = x < 0 ? "L" : "R";
  const [panel, tips] = style.fold;
  const at = owlAt(body, x);
  const wrist = at(0.36, 0.48, 0.3);
  const point = at(-1.1, 0.3, 0.78);
  const face = owlTurned(body, unit([x * 0.8, 0, -0.6]));
  cap(kit, `wing.${L}`, panel, wrist, point, r * 0.72, 0.94, face, { r1: r * 0.27, melt: 0.1 });
  // (Fanned from under the wing's middle, each tip a step lower and further back along its edge, the longest last at its point.)
  const root = at(-0.05, 0.93, 0.5);
  OWL_PRIMARIES.forEach(([up, out, back], i) => {
    // (Hardly melted, so each keeps its own edge and still wears the coat's pattern.)
    cap(kit, `wingtip.${L}${String(i)}`, tips, root, at(up, out, back), r * 0.22, 0.4, face, { r1: r * 0.14, melt: 0.08 });
  });
}

/** A row of pale spots across an open wing, from near its root out toward its tip. */
export function wingSpots(kit: Kit, role: Role, L: string, root: Vec, tip: Vec, chord: number): void {
  for (let i = 0; i < 4; i += 1) {
    const at = lerpV(root, tip, 0.3 + i * 0.17);
    decal(kit, `wing.spot.${L}${String(i)}`, role, at, at, chord * 0.14);
  }
}

/** An owl's tail, sitting: a short broad wedge fused into its rump and fanning a little, the crossed tips of its wings lying over its root. */
export function owlTail(kit: Kit, who: Who, body: BirdBody): void {
  const at = owlAt(body, 1);
  // (Its face turned back, so it hangs on down the line of the back.)
  const fan = unit(sub(at(0.3, 0, 1), at(0, 0, 0)));
  cap(kit, "tail.1", wingStyle(who).fold[1], at(-0.74, 0, 0.78), at(-1.12, 0, 0.92), body.r * 0.46, 0.32, fan, { r1: body.r * 0.52, melt: 0.4 });
}

/** An owl's pale underside, breast and feathered legs: a great horned owl's buff (its white kept for its bib), barred. */
const owlUnder = (coat: string): Role => (coat === "great horned" ? "shell" : "belly");

/**
 * An owl's body: a compact upright bullet, its head sunk into broad shoulders
 * and a near straight barrel below them, with a soft ruff of chest feathers
 * under its face; its pale underside painted down its front and round under
 * its wings, so the wing's own edge is where the coat begins, and under the
 * coat's pattern so it is still barred or speckled (a snowy owl's over its
 * bars and short of its belly, its chest plain white and its flanks marked).
 */
export function owlTorso(kit: Kit, coat: string, body: BirdBody): void {
  const r = body.r;
  const at = owlAt(body, 1);
  const [top, mid, low] = OWL_TRUNK;
  const ring = (k: readonly [number, number, number]): Vec => at(k[0], 0, k[2]);
  const over = sub(at(0, 0, 1), at(0, 0, 0));
  const snowy = coat === "snowy";
  cap(kit, "body", "coat", ring(mid), ring(top), r * mid[1], OWL_DEEP, over, { r1: r * top[1] * owlShapeOf(coat).chest });
  cap(kit, "belly", "coat", ring(mid), ring(low), r * mid[1], OWL_DEEP, over, { r1: r * low[1] });
  // (Its bars first, so they lie over the plain white of its breast.)
  if (snowy) owlBars(kit, body);
  cap(kit, "breast", owlUnder(coat), at(snowy ? 0.3 : -1.7, 0, -0.75), at(0.55, 0, -0.62), r * (snowy ? 0.7 : 1.4), 1, UP, { r1: r * (snowy ? 0.8 : 1.06), decal: true, under: !snowy });
}

/**
 * A great horned owl's white throat: a broad band under its face and turning
 * with it, painted after the face so the face stays over it and only a
 * crescent shows below the disc, its horns rising to either side.
 */
export function owlBib(kit: Kit, h: Head): void {
  cap(kit, "bib", "accent", at3(h, 0.5, -0.5, -0.92), at3(h, 0.5, 0.5, -0.92), h.r * 0.5, 1, UP, { decal: true });
}

/**
 * An owl's legs by coat: the thigh's radius, the shank's, a toe's and a
 * claw's, in body radii, and what colour its toes are: a barn owl's slim and
 * pale, a great horned owl's thick and feathered on big dark talons, a snowy
 * owl's white feather mitts with only the claws' tips showing black.
 */
interface OwlLeg { readonly thigh: number; readonly shank: number; readonly toe: number; readonly claw: number; readonly skin: Role }
const OWL_LEG: OwlLeg = { thigh: 0.46, shank: 0.2, toe: 0.11, claw: 0.075, skin: "belly" };
const OWL_LEGS: Readonly<Record<string, OwlLeg>> = {
  barn: { ...OWL_LEG, thigh: 0.42, shank: 0.13, toe: 0.095, claw: 0.06, skin: "horn" },
  "great horned": { ...OWL_LEG, shank: 0.25, toe: 0.12, claw: 0.095, skin: "shell" },
  snowy: { ...OWL_LEG, thigh: 0.5, shank: 0.28, toe: 0.14, claw: 0.05 },
};

/**
 * An owl's foot, under its belly: a feathered thigh melted into it, standing
 * out a little past its flank as a soft tuft and breaking the shade that
 * gathers there, tapering to its shank on a chunky foot of three toes, each
 * with a dark hooked claw.
 */
export function owlFoot(kit: Kit, who: Who, body: BirdBody, x: number, foot: Vec): void {
  const r = body.r;
  const L = x < 0 ? "L" : "R";
  const leg = OWL_LEGS[who.member.coat] ?? OWL_LEG;
  const heel = add(foot, [0, r * 0.13, 0]);
  cap(kit, `leg.${L}`, owlUnder(who.member.coat), owlAt(body, x)(-1.06, 0.56, -0.04), heel, r * leg.thigh, 1, UP, { r1: r * leg.shank, melt: 0.65 });
  for (const [k, yaw, len] of [[0, -0.6, 0.42], [1, 0, 0.5], [2, 0.6, 0.42]] as const) {
    const dir = dirOf(yaw + x * 0.14, -0.1);
    const tip = madd(heel, dir, r * len);
    // (Crisp, so the breast's paint never reaches down onto them.)
    cap(kit, `leg.${L}.toe${String(k)}`, leg.skin, heel, tip, r * leg.toe, 1, UP, { r1: r * leg.toe * 0.82, melt: 0 });
    // (A hooked claw, curling down to grip, crisp so the toe's colour never pales it.)
    cap(kit, `leg.${L}.claw${String(k)}`, "dark", madd(tip, dir, r * leg.toe * 0.3), madd(madd(tip, dir, r * 0.17), UP, -r * 0.1), r * leg.claw, 1, UP, { r1: r * 0.015, melt: 0 });
  }
}

/** Where a snowy owl's two bold chevrons lie on its belly, each tip how far `up` and `out` as `owlAt` takes them: big enough to last at a sprite's size, and breaking the shade that gathers low on its front. */
const OWL_BELLY_MARKS = [[-0.4, -0.5], [-0.74, 0.3]] as const;

/** A snowy owl's chevrons, each a V cupped down the lie (its pattern's own, finer ones leave a front nearly bare). */
function owlBars(kit: Kit, body: BirdBody): void {
  const at = owlAt(body, 1);
  // (Each end on the curve of its belly, so both arms of the V lie on it.)
  const on = (up: number, out: number): Vec => at(up, out, 0.16 - 0.88 * Math.sqrt(Math.max(0, 1 - (out * out) / 1.15)));
  OWL_BELLY_MARKS.forEach(([up, out], i) => {
    for (const x of [-1, 1]) cap(kit, `bar.${String(i)}${x < 0 ? "L" : "R"}`, "dark", on(up, out), on(up + 0.18, out + x * 0.32), body.r * 0.06, 1, UP, { r1: body.r * 0.04, decal: true, melt: 0.7 });
  });
}

/** A barn owl's grey veil, soft and broken over its gold: down its crown and across its back and wings. */
export function owlVeil(kit: Kit, body: BirdBody, h: Head): void {
  const at = owlAt(body, 1);
  cap(kit, "veil.crown", "alt", at3(h, -0.5, 0, 0.8), at3(h, -0.95, 0, 0.2), h.r * 0.56, 1, UP, { decal: true, melt: 1.7 });
  cap(kit, "veil.back", "alt", at(0.5, 0, 1.05), at(-0.6, 0, 1.15), body.r * 0.8, 1, UP, { decal: true, melt: 1.7 });
}

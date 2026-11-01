// Four legs, the head: lofted from its outline, with neck, ears, eyes, face, markings and antlers.

import { TAU, UP, add, clamp, cross, dirOf, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Build, Ears, Role, Station } from "../roster.js";
import type { Moment, Pose } from "../stage/moments.js";
import { ball, buildOf, cap, cone, decal, headAxes, ownPhase } from "./kit.js";
import type { Kit } from "./kit.js";
import { nosing } from "./quad.js";
import type { QuadBody } from "./quad.js";
import { EYE, eyeOfSpecies } from "./coats.js";
import type { EyeStyle } from "./coats.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";

/** The cross-section of an outline at one point along it: its middle off the line, its half height, its half width. */
interface Section { readonly o: number; readonly h: number; readonly w: number }

export function sectionAt(st: readonly Station[], k: number): Section {
  let i = 0;
  while (i < st.length - 2 && k > (st[i + 1]?.[0] ?? k)) i += 1;
  const [k0, t0, b0, w0] = st[i] ?? [0, 1, 1, 1];
  const [k1, t1, b1, w1] = st[i + 1] ?? [k0, t0, b0, w0];
  const f = clamp((k - k0) / Math.max(k1 - k0, 1e-6), 0, 1);
  const top = mix(t0, t1, f);
  const bottom = mix(b0, b1, f);
  return { o: (top - bottom) / 2, h: (top + bottom) / 2, w: mix(w0, w1, f) };
}

/**
 * An outline lofted into one smooth body: each pair of stations is one part
 * from one cross-section to the next, tapered and squashed to the sections'
 * height and width, so the silhouette follows the species' own back line,
 * belly line and girth (a bear's hump, a dog's tucked waist) and not a tube's.
 */
export function loft(kit: Kit, part: string, role: Role, st: readonly Station[], along: (k: number) => Vec, u: Vec, s: Vec, size: number, melt: number): void {
  for (let i = 0; i + 1 < st.length; i += 1) {
    const [ka, ta, ba, wa] = st[i] ?? [0, 1, 1, 1];
    const [kb, tb, bb, wb] = st[i + 1] ?? [ka, ta, ba, wa];
    const ha = (ta + ba) / 2;
    const hb = (tb + bb) / 2;
    const wide = wa + wb > ha + hb;
    const flat = wide ? (ha + hb) / (wa + wb) : (wa + wb) / (ha + hb);
    const a = madd(along(ka), u, ((ta - ba) / 2) * size);
    const b = madd(along(kb), u, ((tb - bb) / 2) * size);
    cap(kit, `${part}.${String(i)}`, role, a, b, Math.max(ha, wa) * size, flat, wide ? u : s, { r1: Math.max(hb, wb) * size, melt });
  }
}

/**
 * A head. One drawn from an outline carries its sections (`sec`, in head
 * radii along `d`), where its brow drops to the muzzle (`stop`) and where
 * the muzzle ends (`tip`); a round head has none.
 */
export interface Head {
  readonly c: Vec; readonly d: Vec; readonly s: Vec; readonly u: Vec; readonly r: number;
  readonly sec?: (k: number) => Section; readonly stations?: readonly Station[]; readonly stop?: number; readonly tip?: number;
  /** How its eyes are made; without one, round. */
  readonly eye?: EyeStyle;
}
/** Heads a touch big for the body, as a toy's are: the face is what makes an animal read at a glance. */
export const CHARM = 1.18;

/** A skull's outline and its muzzle's, joined: the muzzle's stations run from the stop (0) to the nose (1), its length the animal's own snout. */
function headStations(b: Build, snout: number, hr: number): { stations: Station[]; stop: number; tip: number } | null {
  if (!b.skull) return null;
  const skull = [...b.skull];
  const stop = skull[skull.length - 1]?.[0] ?? 0.35;
  const tip = stop + snout / hr + 0.15;
  const muzzle = (b.muzzle ?? []).filter(([k]) => k > 0).map(([k, t, bt, w]): Station => [mix(stop, tip, k), t, bt, w]);
  return { stations: [...skull, ...muzzle], stop, tip };
}

/** How far a head's line lies below level for a nod of `nod`, no further than its build lets it. */
const headDrop = (b: Build, nod: number): number => Math.max(-0.15 + nod, -(b.dip ?? Infinity));

/**
 * A neck that draws back into a shell: out from under the rim and forward,
 * then up to a head held level or, grazing, on over and down to the ground, a
 * short S with the skull still upright on the end of it. Its loose skin stands
 * in a collar and a fold at the shell only, the rest of it smooth.
 */
function shellNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose): Head {
  const b = buildOf(actor);
  const size = actor.member.size;
  const { S, r } = body;
  const [neckUp, neckOut] = b.neckRoot ?? [0, 0.5];
  const n0 = add(S, [0, r * neckUp, r * neckOut]);
  const down = clamp(-q.headPitch, 0, 1.4) / 1.25;
  const up = clamp(q.headPitch, 0, 1.3) / 1.2;
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  // (A tortoise draws its head in when it tucks down.)
  const reach = Math.max(b.neck * size, r * 0.4) * (1 - body.lie * 0.7);
  const bend = madd(n0, dirOf(yaw, mix(mix(b.rise, 0.5, down), 1.1, up)), reach * mix(0.56, 0.6, down));
  const n1 = madd(bend, dirOf(yaw * 1.5, mix(mix(b.rise * 1.3, -1.02, down), 1.3, up)), reach * mix(0.52, 0.68, down));
  const hr = b.head * size * CHARM;
  const girth = r * (b.neckEnd ?? 0.15);
  cone(kit, "neck", "coat", n0, bend, r * 0.62 * b.neckGirth, girth * 1.1, 0.5);
  cone(kit, "neck.end", "coat", bend, n1, girth * 1.1, girth * mix(0.86, 0.68, down), 0.5);
  const out = unit(sub(bend, n0), [0, 0, 1]);
  cap(kit, "neck.collar", "coat", madd(n0, out, reach * 0.16), madd(n0, out, reach * 0.16), girth * 1.5, 0.42, out, { melt: 0.3, shadow: false });
  cap(kit, "neck.fold", "coat", madd(n0, out, reach * 0.32), madd(n0, out, reach * 0.32), girth * 1.22, 0.4, out, { melt: 0.3, shadow: false });
  const hd = dirOf(yaw * 1.8, mix(-0.1, -0.54, down) + up * 0.5);
  return { c: madd(madd(n1, hd, hr * 0.5), UP, -hr * 0.2 * down), d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(actor) };
}

export function quadNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose, m: Moment): Head {
  const b = buildOf(actor);
  if (b.extras.includes("shell")) return shellNeck(kit, actor, body, q);
  const size = actor.member.size;
  const { P, S, r } = body;
  const chest = r * b.chest;
  const [neckUp, neckOut] = b.neckRoot ?? [0.45, 0.45];
  const n0 = add(S, [0, r * neckUp, r * neckOut]);
  const bodyPitch = Math.atan2(S[1] - P[1], S[2] - P[2]);
  // A hoofed walker nods with its stride; every head stays steadier than its body.
  const nod = b.foot === "hoof" ? 0.09 * Math.sin(TAU * 2 * m.phase) * body.free : 0;
  const pitch = q.headPitch + nod;
  const down = clamp(-pitch, 0, 1.4) / 1.25;
  const up = clamp(pitch, 0, 1.3) / 1.2;
  const nose = nosing(b, q);
  let np = b.rise - bodyPitch * 0.6;
  np = mix(mix(mix(np, -0.9, down), 1.35, up), -0.12, nose);
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  const n1 = madd(n0, dirOf(yaw, np), Math.max(b.neck * size, r * 0.4) * (1 + nose * 0.3));
  const hr = b.head * size * CHARM;
  cone(kit, "neck", "coat", n0, n1, r * 0.62 * b.neckGirth, Math.max(hr * 0.55 * b.neckGirth, r * (b.neckEnd ?? 0.32)), b.neckEnd === undefined ? 1 : 0.3);
  if (b.extras.includes("ruff")) cap(kit, "ruff", "coat", lerpV(n0, S, 0.4), lerpV(n0, n1, 0.35), chest * 0.82, 1, UP, { melt: 1.4 });
  if (b.extras.includes("bib")) decal(kit, "bib", "belly", add(S, [0, -chest * 0.35, chest * 0.75]), madd(n1, dirOf(yaw, np - 1.2), hr * 0.4), chest * 0.5);
  const hd = dirOf(yaw * 1.8 + q.curl * 0.8, headDrop(b, (pitch * 0.55 - down * 0.45) * (1 - nose * 0.45)) - q.curl * 0.4);
  const head: Head = { c: madd(madd(n1, hd, hr * 0.55), [0, 0, 1], -(b.curlIn ?? 0) * q.curl * r), d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(actor) };
  const outline = headStations(b, b.snout * size, hr);
  if (!outline) return head;
  const { stations } = outline;
  return { ...head, ...outline, sec: (k: number) => sectionAt(stations, k) };
}

/**
 * A point on (or in) the head, `d` along it and `s`, `u` across it, as on a
 * round head of radius 1. On an outlined head the point sits as far out on
 * that station's own section as it would on the round one, so an ear or an
 * eye set on a round head's surface lands on a bear's broad crown too.
 */
export const at3 = (h: Head, d: number, s: number, u: number): Vec => {
  if (!h.sec) return add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, s * h.r)), scale(h.u, u * h.r)));
  const sec = h.sec(d);
  const rho = Math.sqrt(Math.max(1 - d * d, 0.2));
  return add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, (s / rho) * sec.w * h.r)), scale(h.u, (sec.o + (u / rho) * sec.h) * h.r)));
};

export function earsOf(kit: Kit, kind: Ears, h: Head, back: number, size = 1, role: Role = "coat", base = 1): void {
  for (const x of [-1, 1]) earOf(kit, `ear.${x < 0 ? "L" : "R"}`, kind, h, x, back, size, role, base);
}

function earOf(kit: Kit, part: string, kind: Ears, h: Head, x: number, back: number, size: number, role: Role, base: number): void {
  if (kind === "point" || kind === "tuft") {
    const root = at3(h, -0.05, x * (0.5 + (base - 1) * 0.15), 0.6);
    const dir = unit(add(add(scale(h.u, 1), scale(h.d, -(0.25 + back * 0.8))), scale(h.s, x * 0.3)));
    const len = h.r * (kind === "tuft" ? 0.7 : 0.95) * size;
    // (Pointed: broad at the root, narrowing to the tip.)
    cap(kit, part, kind === "tuft" ? "alt" : role, root, madd(root, dir, len), h.r * 0.4 * Math.sqrt(size) * base, 0.34, unit(madd(h.d, h.s, -x * 0.4)), { r1: h.r * 0.06, melt: 0.45 });
  } else if (kind === "cup") cupEar(kit, part, h, x, size);
  else if (kind === "round" || kind === "fluffy" || kind === "rimmed") roundEar(kit, part, kind, h, x, size);
  else if (kind === "long") {
    // (Splayed in a V, so the pair reads from behind as well as from the side.)
    // (Broad and standing up off the head, so they clear the hunched back and still read when the head is a few pixels.)
    const root = at3(h, -0.12, x * 0.36, 0.72);
    const dir = unit(add(add(scale(h.u, 1.15 - back * 0.7), scale(h.d, -(0.08 + back))), scale(h.s, x * 0.3)));
    cap(kit, part, "coat", root, madd(root, dir, h.r * 2.2 * size), h.r * 0.42, 0.75, h.d, { r1: h.r * 0.4, melt: 0.35 });
    decal(kit, `${part}.tip`, "dark", madd(root, dir, h.r * 2.45 * size), madd(root, dir, h.r * 2.45 * size), h.r * 0.45);
  } else if (kind === "flop") {
    const root = at3(h, -0.05, x * 0.7, 0.4);
    cap(kit, part, "alt", root, madd(root, unit(add(scale(h.s, x), scale(h.u, -1.2))), h.r * 0.9 * size), h.r * 0.25, 0.4, h.s);
  }
}

/** A round ear set out on top of the head, so even a mouse's clears its outline; a koala's with a pale fringe of fur, a raccoon's white round its edge with the dark inside it. */
function roundEar(kit: Kit, part: string, kind: Ears, h: Head, x: number, size: number): void {
  const fluffy = kind === "fluffy";
  const rimmed = kind === "rimmed";
  // (A raccoon's sits wide on the skull's corner, thick and turned well outward, so its white rim shows from every side.)
  const at = rimmed ? at3(h, -0.16, x * 0.7, 0.84) : fluffy ? at3(h, -0.1, x * 0.8, 0.85) : at3(h, -0.2, x * 0.6, 0.98);
  const er = h.r * 0.32 * size;
  cap(kit, part, rimmed ? "accent" : "coat", at, at, er, rimmed ? 0.66 : 0.55, rimmed ? unit(madd(h.d, h.s, x * 0.72)) : h.d, { melt: 0.35 });
  if (fluffy) decal(kit, `${part}.fluff`, "belly", madd(at, h.s, x * er * 0.35), madd(at, h.s, x * er * 0.35), er * 0.75);
  if (rimmed) decal(kit, `${part}.in`, "alt", at, at, er * 0.86);
}

/** A leathery cup set low on the side of the head and turned out and forward, its pale rim round the dark of its hollow (a hedgehog's, just under its spines). */
function cupEar(kit: Kit, part: string, h: Head, x: number, size: number): void {
  const at = at3(h, -0.2, x * 0.86, 0.62);
  const er = h.r * 0.32 * size;
  const face = unit(add(add(scale(h.d, 0.9), scale(h.s, x * 0.6)), scale(h.u, 0.2)));
  cap(kit, part, "coat", at, at, er, 0.5, face, { melt: 0.3 });
  decal(kit, `${part}.in`, "accent", madd(at, face, er * 0.3), madd(at, face, er * 0.3), er * 0.84);
}

/**
 * An eye that reads at a glance: the iris set proud of the head, a dark
 * pupil on it and a spark of light; shut, just a dark lid. It sits on the
 * head's surface where `toward` points from the head's middle.
 */
export function eyeOf(kit: Kit, part: string, h: Head, toward: Vec, r: number, open: boolean): void {
  const n = unit(sub(toward, h.c), h.d);
  eyeAt(kit, part, h, madd(h.c, n, h.r * (h.eye?.set ? 0.97 : 0.92)), n, r, open);
}

/**
 * A point on a head's face, as (along, out, up) on its unit sphere (see
 * `at3`): where an eye sits, so the markings round it (a mask, an eye
 * stripe, a rim) are placed from the eye itself and never drift off it.
 */
export type FacePoint = readonly [number, number, number];
const FACE = 0.97;

/** The eye's place: `d` along the head, its (out, up) direction pushed out to the surface there. */
export function eyeSpot(d: number, s: number, u: number): FacePoint {
  const k = (Math.sqrt(Math.max(1 - d * d, 0.2)) * FACE) / Math.max(Math.hypot(s, u), 1e-6);
  return [d, s * k, u * k];
}

/** Any direction from the head's middle, out to the face's surface. */
export function toSkin(p: FacePoint): FacePoint {
  const k = FACE / Math.max(Math.hypot(...p), 1e-6);
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** A point on the face at a given height `u`: out to `s` across it, as far forward as the surface lies there. */
export function frontAt(s: number, u: number): FacePoint {
  return [Math.sqrt(Math.max(FACE * FACE - s * s - u * u, 0.02)), s, u];
}

/** A point on the side of the head at `d` along it and height `u`, as far out as the surface lies there. */
export function sideAt(x: number, d: number, u: number): FacePoint {
  return [d, x * Math.sqrt(Math.max(FACE * FACE - d * d - u * u, 0.02)), u];
}

/** A face point on the head's surface: through its section on an outlined head, out to the skin of a round one. */
export const onFace = (h: Head, p: FacePoint): Vec => {
  const at = at3(h, p[0], p[1], p[2]);
  return h.sec ? at : madd(h.c, unit(sub(at, h.c), h.d), h.r * 0.92);
};

/** An eye on an outlined head: on its section's surface at `spot` (the brow above, the cheek below). */

export function outlinedEye(kit: Kit, part: string, h: Head, spot: FacePoint, r: number, open: boolean): void {
  const [d] = spot;
  const at = onFace(h, spot);
  const sec = h.sec?.(d) ?? { o: 0, h: 1, w: 1 };
  const axis = add(h.c, add(scale(h.d, d * h.r), scale(h.u, sec.o * h.r)));
  eyeAt(kit, part, h, at, unit(madd(sub(at, axis), h.d, h.r * 0.35), h.d), r, open);
}

/**
 * An eye as its species has it (see `EYES`): framed by a dark rim on the
 * coat, the iris in its own colour, the pupil its own shape (a cat's slit,
 * a deer's bar, a mouse's eye all pupil) and a catchlight high on it.
 */
export function eyeAt(kit: Kit, part: string, h: Head, at: Vec, n: Vec, r0: number, open: boolean): void {
  const style = h.eye ?? EYE;
  const r = r0 * style.size * 0.9;
  if (!open) {
    ball(kit, part, "dark", at, r, 0.3, n);
    return;
  }
  // (Across and up on the eye's own face, whichever way the head is turned.)
  const across = unit(cross(n, h.u), h.s);
  const up = cross(across, n);
  // Set into the head, a shallow lens and not a ball stuck on it; a mammal's drawn out to an almond.
  const lens = style.set ? LOW_LENS : LENS;
  const c = madd(at, n, -r * lens.sink);
  // (Never quite none: which way the lens lies is how the shader finds its lid.)
  const long = r * Math.max(0.3 * style.almond, 0.02);
  // (A bead is all pupil, so it needs none laid on it.)
  cap(kit, part, style.pupil === "bead" ? "pupil" : "eye", madd(c, across, -long), madd(c, across, long), r, lens.flat, n);
  // (The renderer paints a lens's pupil and spark on it; a bead is all pupil, so it carries its own spark.)
  if (style.pupil !== "bead") return;
  ball(kit, `${part}.shine`, "shine", madd(madd(madd(c, n, r * lens.out), up, r * lens.high), across, -r * lens.aside), r * (style.spark ?? (style.set ? 0.12 : 0.24)));
}

/** A lens: how far it sinks into the head, how flat it is, and where its spark sits on it (out along it, up it, and aside). */
const LENS = { sink: 0.15, flat: 0.8, out: 0.82, high: 0.36, aside: 0.2 };
const LOW_LENS = { sink: 0.2, flat: 0.55, out: 0.47, high: 0.3, aside: 0.16 };

/** Where the eyes sit on a round head, as face points; a build can set its own. */
export function roundEyes(b: Build): FacePoint[] {
  const [d, s, u] = b.eyeSet ?? [0.62, 0.5, 0.28];
  return [-1, 1].map((x) => [d, x * s, u]);
}

/**
 * A tortoise's face: a short blunt wedge, its crown flat, breaking at the brow
 * to a muzzle that drops to its beak; a beak of pale horn with a small hook at
 * the front of the upper one, its dark gape running back and up toward the eye;
 * a pair of nostrils; and its eye set halfway along the side under a heavy brow.
 */
function shellFace(kit: Kit, h: Head, q: Pose, asleep: boolean): void {
  const from = kit.out.length;
  cap(kit, "head", "coat", at3(h, -0.58, 0, 0.06), at3(h, 0.24, 0, 0.06), h.r * 0.84, 0.68, h.u, { r1: h.r * 0.72, melt: 0.5 });
  cap(kit, "snout", "coat", at3(h, 0.3, 0, -0.1), at3(h, 0.7, 0, -0.2), h.r * 0.62, 0.76, h.u, { r1: h.r * 0.46, melt: 0.2 });
  const gap = h.r * q.mouth * 0.6;
  cone(kit, "jaw", "belly", at3(h, -0.1, 0, -0.44), madd(at3(h, 0.8, 0, -0.56), h.u, -gap), h.r * 0.44, h.r * 0.3, 0.35);
  cap(kit, "beak", "horn", at3(h, 1.02, 0, -0.24), at3(h, 1.15, 0, -0.5), h.r * 0.33, 0.5, h.d, { r1: h.r * 0.14 });
  const chin = madd(at3(h, 1, 0, -0.66), h.u, -gap);
  cap(kit, "beak.low", "horn", madd(chin, h.s, -h.r * 0.14), madd(chin, h.s, h.r * 0.14), h.r * 0.15, 0.7, h.u);
  const mouth = at3(h, 0.5, 0, -0.5);
  cap(kit, "mouth", "dark", mouth, mouth, h.r * 1.3, 0.085, madd(h.u, h.d, 0.34), { decal: true, melt: 0.25 });
  for (const x of [-1, 1]) {
    const nostril = at3(h, 1.06, x * 0.13, 0.06);
    decal(kit, "nostril", "dark", nostril, nostril, h.r * 0.05);
    const eye = at3(h, 0.22, x * 0.71, 0.2);
    eyeAt(kit, `eye.${x < 0 ? "L" : "R"}`, h, eye, unit(add(scale(h.s, x * 0.82), add(scale(h.d, 0.52), scale(h.u, 0.18)))), h.r * 0.22, !asleep);
    cone(kit, "brow", "coat", at3(h, -0.2, x * 0.56, 0.5), at3(h, 0.58, x * 0.42, 0.4), h.r * 0.17, h.r * 0.1, 0.4);
  }
  // (Too small to shade the ground: only the skull casts a shadow.)
  for (let i = from + 1; i < kit.out.length; i += 1) { const part = kit.out[i]; if (part) kit.out[i] = { ...part, shadow: false }; }
}

export function faceOf(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  if (actor.member.species === "cat") catFace(kit, actor, h, q, asleep);
  else if (buildOf(actor).extras.includes("shell")) shellFace(kit, h, q, asleep);
  else if (h.stations) outlinedFace(kit, actor, h, q, asleep);
  else roundFace(kit, actor, h, q, asleep);
}

/** A round head: a ball, its muzzle, jaw and nose, its eyes, marks and ears. */
function roundFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = buildOf(actor);
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", h.c, h.r);
  // The muzzle tapers from the face to the nose: to a point on a fox, hardly at all on a capybara.
  const root = at3(h, 0.35, 0, -0.1);
  const tip = madd(madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15), h.u, h.r * (b.snoutUp ?? 0));
  const tipR = h.r * 0.5 * b.snoutTip;
  cone(kit, "snout", "coat", root, tip, h.r * 0.5, tipR);
  const jawRoot = at3(h, 0.3, 0, -0.32);
  const jawTip = madd(madd(jawRoot, h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cone(kit, "jaw", "belly", jawRoot, jawTip, h.r * 0.36, Math.max(tipR * 0.7, h.r * 0.12));
  noseOf(kit, b, h, tip, tipR);
  const eyes = roundEyes(b);
  eyes.forEach((spot, i) => { eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, onFace(h, spot), h.r * 0.25, !asleep); });
  faceMarks(kit, actor, h, tip, eyes, h.r * 0.25 * (h.eye?.size ?? 1));
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  if (b.extras.includes("jowls")) for (const x of [-1, 1]) jowlOf(kit, h, x);
  earsOf(kit, b.ears, h, q.earBack, b.earLen, b.extras.includes("cheeks") || b.extras.includes("wet") ? "accent" : "coat", b.earBase);
}

/** A round head's nose on the end of its muzzle. */
function noseOf(kit: Kit, b: Build, h: Head, tip: Vec, tipR: number): void {
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", madd(tip, h.u, h.r * 0.2), madd(tip, h.u, -h.r * 0.12), h.r * 0.3, 0.7, h.d);
  else if (b.extras.includes("button")) {
    // (A broad rounded triangle, wide across the top, on the muzzle's blunt end, with a spark of wet light on it.)
    const top = add(tip, add(scale(h.d, tipR * 0.75), scale(h.u, tipR * 0.42)));
    cap(kit, "nose", "nose", top, madd(top, h.u, -h.r * 0.14), h.r * 0.21, 0.72, h.d, { r1: h.r * 0.085 });
    ball(kit, "nose.shine", "shine", add(top, add(scale(h.d, h.r * 0.09), add(scale(h.u, h.r * 0.12), scale(h.s, -h.r * 0.09)))), h.r * 0.024);
  } else if (b.extras.includes("wet")) {
    // (A small ball on the very end of a pointed muzzle, a spark of wet light high on it.)
    const end = madd(tip, h.d, tipR * 0.85);
    ball(kit, "nose", "nose", end, tipR * 0.68);
    ball(kit, "nose.shine", "shine", add(end, add(scale(h.d, tipR * 0.42), add(scale(h.u, tipR * 0.32), scale(h.s, -tipR * 0.22)))), tipR * 0.13);
  // (A pointed muzzle ends in its nose; a blunt one's, a tortoise's, stays in it.)
  } else ball(kit, "nose", "nose", madd(tip, h.d, b.snoutTip < 0.5 ? tipR * 0.8 : 0), Math.max(tipR * 0.6, h.r * 0.12));
}

/** A tuft of pale fur back from the cheek and out past the jaw to a soft point, which makes a broad head of a narrow muzzle from the front and breaks its outline from the side. */
function jowlOf(kit: Kit, h: Head, x: number): void {
  cap(kit, `jowl.${x < 0 ? "L" : "R"}`, "belly", at3(h, 0.4, x * 0.56, -0.36), at3(h, -0.38, x * 0.98, -0.56), h.r * 0.42, 1, UP, { r1: h.r * 0.17, melt: 1 });
}

/**
 * A face drawn from its species' outline: skull and muzzle lofted as one
 * surface, the jaw under the muzzle (it drops as the mouth opens), the nose
 * capping the muzzle's end and the eyes under the brow, just behind the stop.
 */
function outlinedFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = buildOf(actor);
  const stop = h.stop ?? 0.35;
  const tip = h.tip ?? 1;
  const sec = h.sec ?? ((): Section => ({ o: 0, h: 1, w: 1 }));
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  loft(kit, "head", "coat", h.stations ?? [], along, h.u, h.s, h.r, 1);
  const root = sec(stop);
  const end = sec(tip);
  const front = madd(along(tip), h.u, (end.o + end.h * 0.25) * h.r);
  const nose = madd(front, h.d, Math.max(end.h, end.w) * h.r * 0.8);
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", madd(nose, h.u, h.r * 0.2), madd(nose, h.u, -h.r * 0.12), h.r * 0.3, 0.7, h.d);
  else ball(kit, "nose", "nose", nose, Math.max(end.w * 0.45, 0.1) * h.r, 0.75, h.d);
  const jawRoot = madd(along(stop - 0.1), h.u, (root.o - root.h * 0.5) * h.r);
  const jawEnd = madd(along(tip), h.u, (end.o - end.h * 0.5) * h.r - (tip - stop) * h.r * q.mouth * 0.5);
  cone(kit, "jaw", "coat", jawRoot, jawEnd, root.h * 0.5 * h.r, end.h * 0.55 * h.r);
  const [ed, es, eu] = EYE_SET;
  const eyes = [-1, 1].map((x) => eyeSpot(stop + ed, x * es, eu));
  eyes.forEach((spot, i) => { outlinedEye(kit, `eye.${i === 0 ? "L" : "R"}`, h, spot, h.r * 0.22, !asleep); });
  faceMarks(kit, actor, h, nose, eyes, h.r * 0.22 * (h.eye?.size ?? 1));
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  earsOf(kit, b.ears, h, q.earBack, b.earLen, b.extras.includes("cheeks") ? "accent" : "coat", b.earBase);
}

/**
 * A cat's face: a round skull full in the cheek, a short wide muzzle of two
 * whisker pads over a neat chin, a small nose, the slanted eyes painted flat
 * into the skull and set forward, and broad ears on the corners of its head.
 * (Paint: the first decal to cover a point keeps it, so the eyes come before
 * the markings round them.)
 */
function catFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  // (A point on the face: along the head, then out and up from its axis, in head radii.)
  const on: FaceAt = (d, s, u) => add(along(d), add(scale(h.s, s * h.r), scale(h.u, u * h.r)));
  // (The skull lies across the head, so it is round from the side and broad from the front; this is a point on its skin.)
  const skin: Skin = (s, u) => on(Math.sqrt(Math.max(0.88 ** 2 - Math.max(Math.abs(s) - 0.1, 0) ** 2 - u ** 2, 0.02)), s, u);
  cap(kit, "head.0", "coat", on(0, -0.1, 0), on(0, 0.1, 0), h.r * 0.88);
  // (The muzzle is one short wide pale roll across the face, parted down its middle into two whisker pads.)
  cap(kit, "pad", "belly", on(0.78, -0.2, -0.22), on(0.78, 0.2, -0.22), h.r * 0.42, 0.86, h.u);
  decal(kit, "mouth", "dark", on(1.26, 0, -0.1), on(1.16, 0, -0.4), h.r * 0.03);
  cone(kit, "jaw", "belly", on(0.6, 0, -0.5), on(0.96, 0, -0.5 - q.mouth * 0.3), h.r * 0.24, h.r * 0.2);
  cap(kit, "nose", "nose", on(1.17, 0, -0.05), on(1.15, 0, -0.11), h.r * 0.12, 0.6, h.d, { r1: h.r * 0.05 });
  for (const x of [-1, 1]) catEye(kit, h, skin(x * 0.54, 0.13), x, !asleep);
  const roles = coatFace(kit, actor, h, on, skin);
  for (const x of [-1, 1]) {
    catEar(kit, h, on, x, q.earBack, x < 0 ? roles[0] : roles[1]);
    // (Two fine pale whiskers from each pad, fanned a little and drooping to their tips.)
    cap(kit, "whisker", "shine", on(0.9, x * 0.5, -0.2), on(0.9, x * 0.5, -0.3), h.r * 0.012, 1, UP, { row: 2, reach: sub(on(0.4, x * 1.3, -0.25), on(0.9, x * 0.5, -0.25)), sharp: true, shadow: false });
  }
}

/** A point on the face: along the head, out and up from its axis, in head radii. */
type FaceAt = (d: number, s: number, u: number) => Vec;
/** A point on the skin of the skull, from where it lies across the face. */
type Skin = (s: number, u: number) => Vec;

/** Coats with a tabby's marks on the face as on the body. */
export const TABBIES: ReadonlySet<string> = new Set(["tabby", "grey"]);

/** What a coat paints on the face round the eyes; it gives back each ear's colour. */
function coatFace(kit: Kit, actor: Who, h: Head, on: FaceAt, skin: Skin): readonly [Role, Role] {
  if (TABBIES.has(actor.member.coat)) tabbyFace(kit, h, on, skin);
  if (actor.member.coat !== "calico") return ["coat", "coat"];
  // (Whichever side the black falls on is the animal's own.)
  const x = ownPhase(actor) < 0.5 ? -1 : 1;
  const gene = createRandom(markOf(actor) ^ 0x3c6ef372);
  calicoPatch(kit, h, skin, x, "dark", gene);
  calicoPatch(kit, h, skin, -x, "alt", gene);
  return x < 0 ? ["dark", "alt"] : ["alt", "dark"];
}

/** A tabby's face: the dark M on the brow, two peaks over a dip between the eyes, and a line back from each eye's outer corner. */
function tabbyFace(kit: Kit, h: Head, on: FaceAt, skin: Skin): void {
  // (Each a thin blade, flat across its own line and deep into the head, so it meets the curve of the crown from end to end.)
  const line = (a: Vec, b: Vec, wide: number): void => {
    const n = unit(sub(lerpV(a, b, 0.5), h.c), h.d);
    cap(kit, "brow", "alt", a, b, h.r * 0.2, wide / 0.2, unit(cross(sub(b, a), n), h.s), { decal: true });
  };
  for (const x of [-1, 1]) {
    line(skin(x * 0.38, 0.44), skin(x * 0.24, 0.76), 0.06);
    line(skin(x * 0.24, 0.76), skin(0, 0.46), 0.06);
    line(skin(x * 0.8, 0.2), skin(x * 0.93, 0.1), 0.05);
  }
}

/** A calico's patch on one side of its face, from the ear down round the eye: the eye framed in it, the nose and the blaze left white. */
function calicoPatch(kit: Kit, h: Head, skin: Skin, x: number, role: Role, gene: () => number): void {
  decal(kit, "face", role, skin(x * mix(0.6, 0.8, gene()), mix(0.5, 0.72, gene())), skin(x * mix(0.44, 0.64, gene()), mix(-0.02, 0.2, gene())), h.r * mix(0.34, 0.56, gene()));
}

/** A cat's eye, painted flat into the skull: a dark almond tilted up to its outer corner, heavier along its upper lid, the iris in it, the slit tall and narrow down its middle, the one catch of light on the same side of both; shut, a dark line. */
function catEye(kit: Kit, h: Head, at: Vec, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const n = unit(add(h.d, add(scale(h.s, x * 0.8), scale(h.u, 0.2))));
  // (Across and up on the eye's own face, the outer corner lifted.)
  const tilted = madd(h.s, h.u, x * 0.3);
  const across = unit(madd(tilted, n, -dot(tilted, n)));
  if (!open) { cap(kit, part, "dark", madd(at, across, -h.r * 0.27), madd(at, across, h.r * 0.27), h.r * 0.045, 1, UP, { melt: 0.2 }); return; }
  // (The renderer paints the slit, iris, rim and spark on its lens, like any other eye.)
  eyeAt(kit, part, h, at, n, h.r * 0.2, true);
}

/** A cat's ear: a broad low triangle, a little rounded at its tip, on the corner of its head, held up however the head tilts, its pink inside turned forward so both show. */
function catEar(kit: Kit, h: Head, on: FaceAt, x: number, back: number, role: Role): void {
  const part = `ear.${x < 0 ? "L" : "R"}`;
  const root = on(-0.1, x * 0.6, 0.55);
  const dir = unit(add(add(lerpV(h.u, UP, 0.65), scale(h.s, x * 0.34)), scale(h.d, -(0.02 + back * 0.8))));
  const n = unit(madd(h.d, h.s, x * 0.5));
  const r = h.r * 0.5;
  cap(kit, part, role, root, madd(root, dir, h.r * 0.84), r, 0.56, n, { r1: h.r * 0.1, melt: 0.35 });
  const inner = madd(madd(root, n, r * 0.4), dir, h.r * 0.24);
  cap(kit, `${part}.in`, "accent", inner, madd(inner, dir, h.r * 0.5), r * 0.62, 0.46, n, { r1: h.r * 0.1, decal: true });
}

/** Where the eyes sit on an outlined head: just behind the stop, on the sides, under the brow. */
const EYE_SET = [-0.12, 0.62, 0.5] as const;

/**
 * A bandit's mask round one eye, found from the eye itself: one band from
 * near the bridge of the nose (where it meets its pair) back and a little
 * down over the cheek, with the eye at its middle, so the eye always sits in
 * its patch however the head is shaped.
 */
function maskBand(kit: Kit, h: Head, eye: FacePoint, eyeR: number): void {
  const x = Math.sign(eye[1]) || 1;
  const bridge = frontAt(x * 0.06, eye[2] + 0.02);
  // (In from the eye halfway to the bridge, and as far again out past it, a little down:
  // one band with the eye at its middle.)
  const [d, s, u] = eye;
  const inner: FacePoint = [(d + bridge[0]) / 2, (s + bridge[1]) / 2, (u + bridge[2]) / 2];
  const out = [2 * d - inner[0], 2 * s - inner[1], 2 * u - inner[2] - 0.12] as const;
  decal(kit, "mask", "dark", onFace(h, inner), onFace(h, toSkin(out)), eyeR * 1.6);
}

/**
 * A long oval of paint laid on the head at `at` and drawn out along `run` by
 * `reach`, narrowing from `r` to `r1` as it goes: `flat` is its width against
 * its length, and it stays as deep as it is long, so it meets the head's curve
 * from end to end.
 */
export function facePatch(kit: Kit, part: string, role: Role, h: Head, at: Vec, run: Vec, reach: number, r: number, r1: number, flat: number, melt: number): void {
  const n = unit(sub(at, h.c), h.d);
  const along = unit(madd(run, n, -dot(run, n)), h.s);
  cap(kit, part, role, at, madd(at, along, reach), r, flat, cross(n, along), { decal: true, r1, melt });
}

/** A raccoon's mask round one eye: an oval from just short of the bridge, where it barely meets its pair, back and down past the eye, narrowing toward the jaw's corner. */
function banditMask(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  const run = sub(onFace(h, toSkin([d - 0.62, x * 0.92, u - 0.5])), onFace(h, frontAt(x * 0.06, u + 0.06)));
  facePatch(kit, "mask", "dark", h, onFace(h, eye), run, h.r * 0.5, band * 2.6, band * 1, 0.52, 1.1);
}

/** A pale brow over one eye's mask, found from the eye too: nearly level along the mask's top, out from over the eye, thin and fading at its outer end. */
function browMark(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  facePatch(kit, "brow", "accent", h, onFace(h, toSkin([d - 0.04, s * 0.74, u + 0.42])), scale(h.s, x), h.r * 0.24, band * 1.45, band * 0.6, 0.36, 1.1);
}

/**
 * A raccoon's face: the black mask, a white brow over it, a white muzzle
 * under it and a soft dark blaze down the nose between, broad on the forehead
 * and gone before the nose. (The first decal to cover a point keeps it, so the
 * black comes first and the white meets its edge clean.)
 */
function banditMarks(kit: Kit, h: Head, tip: Vec, eyes: readonly FacePoint[], eyeR: number): void {
  // (A small eye in a big patch: the band is sized to the head's mask, not to the eye.)
  const band = eyeR * 1.3;
  for (const eye of eyes) { banditMask(kit, h, eye, band); browMark(kit, h, eye, band); }
  const brow = frontAt(0, (eyes[0]?.[2] ?? 0) + 0.46);
  // (A blade, flat across the face and deep into it, so it meets the curve down the bridge from end to end.)
  cap(kit, "line", "alt", onFace(h, brow), add(tip, add(scale(h.u, h.r * 0.2), scale(h.d, -h.r * 0.14))), h.r * 0.56, 0.32, h.s, { decal: true, r1: h.r * 0.14, melt: 1.4 });
  decal(kit, "muzzle", "accent", at3(h, 0.3, 0, -0.5), tip, h.r * 0.7);
}

/** Face markings, set across the head's surface so they paint it from any side. */
function faceMarks(kit: Kit, actor: Who, h: Head, tip: Vec, eyes: readonly FacePoint[], eyeR: number): void {
  const b = buildOf(actor);
  const cheeks = b.extras.includes("cheeks");
  const mask = b.extras.includes("mask");
  if (b.extras.includes("brows")) { banditMarks(kit, h, tip, eyes, eyeR); return; }
  if (b.extras.includes("muzzle")) decal(kit, "muzzle", cheeks || actor.member.species === "marmot" ? "accent" : "belly", at3(h, 0.65, 0, -0.4), tip, h.r * 0.45);
  if (mask) { const wide = eyeR * mix(0.86, 1.2, createRandom(markOf(actor) ^ 0x6a09e667)()); for (const eye of eyes) maskBand(kit, h, eye, wide); }
  // (A badger's white blaze runs from its nose over its crown, between dark stripes.)
  if (mask && b.extras.includes("stripes")) decal(kit, "blaze", "accent", tip, at3(h, -0.4, 0, 1.0), h.r * 0.3);
  if (cheeks) for (const x of [-1, 1]) decal(kit, "cheek", "accent", at3(h, 0.4, x * 0.88, -0.15), at3(h, 0.7, x * 0.6, 0.5), h.r * 0.3);
}

/** A buck's antlers: a beam sweeping up, out and forward, with tines off its front. */
function antlersOf(kit: Kit, h: Head, size: number): void {
  for (const x of [-1, 1]) {
    const root = at3(h, -0.1, x * 0.42, 0.85);
    const beam = unit(add(add(scale(h.u, 1), scale(h.d, -0.45)), scale(h.s, x * 0.75)));
    const bend = madd(root, beam, size * 0.18);
    const top = madd(bend, unit(add(add(scale(h.u, 1), scale(h.d, 0.55)), scale(h.s, x * 0.25))), size * 0.16);
    cap(kit, "antler", "horn", root, bend, size * 0.026, 1, UP, { r1: size * 0.02, melt: 0.3 });
    cap(kit, "antler", "horn", bend, top, size * 0.02, 1, UP, { r1: size * 0.012, melt: 0.3 });
    const brow = madd(root, beam, size * 0.05);
    cap(kit, "tine", "horn", brow, madd(brow, unit(add(scale(h.d, 1), scale(h.u, 0.5))), size * 0.08), size * 0.016, 1, UP, { r1: size * 0.008, melt: 0.3 });
    cap(kit, "tine", "horn", bend, madd(bend, unit(add(scale(h.u, 1), scale(h.d, 0.3))), size * 0.11), size * 0.016, 1, UP, { r1: size * 0.008, melt: 0.3 });
  }
}

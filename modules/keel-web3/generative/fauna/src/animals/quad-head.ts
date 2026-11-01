// Four legs, the head: lofted from its outline, with neck, ears, eyes, face, markings and antlers.

import { TAU, UP, add, clamp, cross, dirOf, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Build, Ears, Role, Station } from "../roster.js";
import type { Moment, Pose } from "../stage/moments.js";
import { ball, buildOf, cap, cone, decal, headAxes } from "./kit.js";
import type { Kit } from "./kit.js";
import { nosing } from "./quad.js";
import type { QuadBody } from "./quad.js";
import { EYE, eyeOfSpecies } from "./coats.js";
import type { EyeStyle } from "./coats.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";
import { catFace } from "./cat-face.js";

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
export interface Outline {
  /** The stations along it. */
  readonly st: readonly Station[];
  /** Where a station's middle lies, by its place along the line. */
  readonly along: (k: number) => Vec;
  /** Up and sideways across it. */
  readonly u: Vec;
  readonly s: Vec;
  /** The unit its stations are in, and how far each part melts into the next. */
  readonly size: number;
  readonly melt: number;
}
export function loft(kit: Kit, part: string, role: Role, outline: Outline): void {
  const { st, along, u, s, size, melt } = outline;
  for (let i = 0; i + 1 < st.length; i += 1) {
    const [ka, ta, ba, wa] = st[i] ?? [0, 1, 1, 1];
    const [kb, tb, bb, wb] = st[i + 1] ?? [ka, ta, ba, wa];
    const ha = (ta + ba) / 2;
    const hb = (tb + bb) / 2;
    const wide = wa + wb > ha + hb;
    const flat = wide ? (ha + hb) / (wa + wb) : (wa + wb) / (ha + hb);
    const a = madd(along(ka), u, ((ta - ba) / 2) * size);
    const b = madd(along(kb), u, ((tb - bb) / 2) * size);
    cap(kit, `${part}.${String(i)}`, role, { a, b, r: Math.max(ha, wa) * size, flat, up: wide ? u : s, finish: {
      r1: Math.max(hb, wb) * size,
      melt,
    } });
  }
}

/**
 * A head. One drawn from an outline carries its sections (`sec`, in head
 * radii along `d`), where its brow drops to the muzzle (`stop`) and where
 * the muzzle ends (`tip`); a round head has none.
 */
export interface Head {
  readonly c: Vec;
  readonly d: Vec;
  readonly s: Vec;
  readonly u: Vec;
  readonly r: number;
  readonly sec?: (k: number) => Section;
  readonly stations?: readonly Station[];
  readonly stop?: number;
  readonly tip?: number;
  /** How its eyes are made; without one, round. */
  readonly eye?: EyeStyle;
}
/** Heads a touch big for the body, as a toy's are: the face is what makes an animal read at a glance. */
export const CHARM = 1.18;

/**
 * A skull's outline and its muzzle's, joined: the muzzle's stations run from the stop (0) to the nose (1), its length
 * the animal's own snout.
 */
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
  cone(kit, "neck", "coat", { a: n0, b: bend, r: r * 0.62 * b.neckGirth, r1: girth * 1.1, melt: 0.5 });
  cone(kit, "neck.end", "coat", { a: bend, b: n1, r: girth * 1.1, r1: girth * mix(0.86, 0.68, down), melt: 0.5 });
  const out = unit(sub(bend, n0), [0, 0, 1]);
  cap(kit, "neck.collar", "coat", { a: madd(n0, out, reach * 0.16), b: madd(n0, out, reach * 0.16), r: girth * 1.5, flat: 0.42, up: out, finish: { melt: 0.3, shadow: false } });
  cap(kit, "neck.fold", "coat", { a: madd(n0, out, reach * 0.32), b: madd(n0, out, reach * 0.32), r: girth * 1.22, flat: 0.4, up: out, finish: { melt: 0.3, shadow: false } });
  const hd = dirOf(yaw * 1.8, mix(-0.1, -0.54, down) + up * 0.5);
  return {
    c: madd(madd(n1, hd, hr * 0.5), UP, -hr * 0.2 * down),
    d: hd,
    ...headAxes(hd, q.headRoll),
    r: hr,
    ...eyeOfSpecies(actor),
  };
}

/** How a head is carried off its neck: how far it is pitched down and up, and how far its nose is to the ground. */
interface Carriage { readonly pitch: number; readonly down: number; readonly up: number; readonly nose: number }

/** How the head is pitched this moment: by the pose, and on a hoofed walker nodding with its stride. */
function carriageOf(b: Build, body: QuadBody, q: Pose, m: Moment): Carriage {
  // A hoofed walker nods with its stride; every head stays steadier than its body.
  const nod = b.foot === "hoof" ? 0.09 * Math.sin(TAU * 2 * m.phase) * body.free : 0;
  const pitch = q.headPitch + nod;
  const down = clamp(-pitch, 0, 1.4) / 1.25;
  const up = clamp(pitch, 0, 1.3) / 1.2;
  return { pitch, down, up, nose: nosing(b, q) };
}

export function quadNeck(kit: Kit, actor: Who, body: QuadBody, m: Moment): Head {
  const q = m.pose;
  const b = buildOf(actor);
  if (b.extras.includes("shell")) return shellNeck(kit, actor, body, q);
  const size = actor.member.size;
  const { P, S, r } = body;
  const chest = r * b.chest;
  const [neckUp, neckOut] = b.neckRoot ?? [0.45, 0.45];
  const n0 = add(S, [0, r * neckUp, r * neckOut]);
  const bodyPitch = Math.atan2(S[1] - P[1], S[2] - P[2]);
  const { pitch, down, up, nose } = carriageOf(b, body, q, m);
  let np = b.rise - bodyPitch * 0.6;
  np = mix(mix(mix(np, -0.9, down), 1.35, up), -0.12, nose);
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  const n1 = madd(n0, dirOf(yaw, np), Math.max(b.neck * size, r * 0.4) * (1 + nose * 0.3));
  const hr = b.head * size * CHARM;
  cone(kit, "neck", "coat", { a: n0, b: n1, r: r * 0.62 * b.neckGirth, r1: Math.max(hr * 0.55 * b.neckGirth, r * (b.neckEnd ?? 0.32)), melt: b.neckEnd === undefined ? 1 : 0.3 });
  if (b.extras.includes("ruff")) cap(kit, "ruff", "coat", { a: lerpV(n0, S, 0.4), b: lerpV(n0, n1, 0.35), r: chest * 0.82, flat: 1, up: UP, finish: { melt: 1.4 } });
  if (b.extras.includes("bib")) decal(kit, "bib", "belly", { a: add(S, [0, -chest * 0.35, chest * 0.75]), b: madd(n1, dirOf(yaw, np - 1.2), hr * 0.4), r: chest * 0.5 });
  const hd = dirOf(
    yaw * 1.8 + q.curl * 0.8,
    headDrop(b, (pitch * 0.55 - down * 0.45) * (1 - nose * 0.45)) - q.curl * 0.4,
  );
  const head: Head = {
    c: madd(madd(n1, hd, hr * 0.55), [0, 0, 1], -(b.curlIn ?? 0) * q.curl * r),
    d: hd,
    ...headAxes(hd, q.headRoll),
    r: hr,
    ...eyeOfSpecies(actor),
  };
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
  return add(
    h.c,
    add(add(scale(h.d, d * h.r), scale(h.s, (s / rho) * sec.w * h.r)), scale(h.u, (sec.o + (u / rho) * sec.h) * h.r)),
  );
};

/** A pair of ears: their kind, how far back they are laid, their size, colour and how broad their base is. */
export interface EarSet {
  readonly kind: Ears;
  readonly back: number;
  readonly size?: number | undefined;
  readonly role?: Role | undefined;
  readonly base?: number | undefined;
}

/** The name of the ear on side `x`. */
const earPart = (x: number): string => `ear.${x < 0 ? "L" : "R"}`;

export function earsOf(kit: Kit, h: Head, ears: EarSet): void {
  for (const x of [-1, 1]) earOf(kit, h, x, ears);
}

/** A pointed ear, or a tuft: broad at the root, narrowing to the tip, leaning back as the pose has it. */
function pointEar(kit: Kit, h: Head, x: number, ears: EarSet): void {
  const { kind, back, size = 1, role = "coat", base = 1 } = ears;
  const part = earPart(x);
  const root = at3(h, -0.05, x * (0.5 + (base - 1) * 0.15), 0.6);
  const dir = unit(add(add(scale(h.u, 1), scale(h.d, -(0.25 + back * 0.8))), scale(h.s, x * 0.3)));
  const len = h.r * (kind === "tuft" ? 0.7 : 0.95) * size;
  // (Pointed: broad at the root, narrowing to the tip.)
  cap(kit, part, kind === "tuft" ? "alt" : role, {
    a: root,
    b: madd(root, dir, len),
    r: h.r * 0.4 * Math.sqrt(size) * base,
    flat: 0.34,
    up: unit(madd(h.d, h.s, -x * 0.4)),
    finish: { r1: h.r * 0.06, melt: 0.45 },
  });
}

/** A long ear, a hare's: splayed in a V and standing up off the head, dark at the tip. */
function longEar(kit: Kit, h: Head, x: number, ears: EarSet): void {
  const { back, size = 1 } = ears;
  const part = earPart(x);
  // (Splayed in a V, so the pair reads from behind as well as from the side.)
  // (Broad and standing up off the head, so they clear the hunched back and still read when the head is a few
  // pixels.)
  const root = at3(h, -0.12, x * 0.36, 0.72);
  const dir = unit(add(add(scale(h.u, 1.15 - back * 0.7), scale(h.d, -(0.08 + back))), scale(h.s, x * 0.3)));
  cap(kit, part, "coat", { a: root, b: madd(root, dir, h.r * 2.2 * size), r: h.r * 0.42, flat: 0.75, up: h.d, finish: {
    r1: h.r * 0.4,
    melt: 0.35,
  } });
  decal(
    kit,
    `${part}.tip`,
    "dark",
    { a: madd(root, dir, h.r * 2.45 * size), b: madd(root, dir, h.r * 2.45 * size), r: h.r * 0.45 },
  );
}

function earOf(kit: Kit, h: Head, x: number, ears: EarSet): void {
  const { kind, size = 1 } = ears;
  const part = earPart(x);
  if (kind === "point" || kind === "tuft") pointEar(kit, h, x, ears);
  else if (kind === "cup") cupEar(kit, h, x, size);
  else if (kind === "round" || kind === "fluffy" || kind === "rimmed") roundEar(kit, h, x, ears);
  else if (kind === "long") longEar(kit, h, x, ears);
  else if (kind === "flop") {
    const root = at3(h, -0.05, x * 0.7, 0.4);
    cap(kit, part, "alt", {
      a: root,
      b: madd(root, unit(add(scale(h.s, x), scale(h.u, -1.2))), h.r * 0.9 * size),
      r: h.r * 0.25,
      flat: 0.4,
      up: h.s,
    });
  }
}

/**
 * A round ear set out on top of the head, so even a mouse's clears its outline; a koala's with a pale fringe of fur, a
 * raccoon's white round its edge with the dark inside it.
 */
function roundEar(kit: Kit, h: Head, x: number, ears: EarSet): void {
  const { kind, size = 1 } = ears;
  const part = earPart(x);
  const fluffy = kind === "fluffy";
  const rimmed = kind === "rimmed";
  const at = roundEarSeat(h, x, kind);
  const er = h.r * 0.32 * size;
  cap(kit, part, rimmed ? "accent" : "coat", {
    a: at,
    b: at,
    r: er,
    flat: rimmed ? 0.66 : 0.55,
    up: rimmed ? unit(madd(h.d, h.s, x * 0.72)) : h.d,
    finish: { melt: 0.35 },
  });
  if (fluffy)
    decal(kit, `${part}.fluff`, "belly", { a: madd(at, h.s, x * er * 0.35), b: madd(at, h.s, x * er * 0.35), r: er * 0.75 });
  if (rimmed) decal(kit, `${part}.in`, "alt", { a: at, b: at, r: er * 0.86 });
}

/**
 * Where a round ear sits. (A raccoon's sits wide on the skull's corner, thick and turned well outward, so its white
 * rim shows from every side.)
 */
function roundEarSeat(h: Head, x: number, kind: Ears): Vec {
  if (kind === "rimmed") return at3(h, -0.16, x * 0.7, 0.84);
  if (kind === "fluffy") return at3(h, -0.1, x * 0.8, 0.85);
  return at3(h, -0.2, x * 0.6, 0.98);
}

/**
 * A leathery cup set low on the side of the head and turned out and forward, its pale rim round the dark of its hollow
 * (a hedgehog's, just under its spines).
 */
function cupEar(kit: Kit, h: Head, x: number, size: number): void {
  const part = earPart(x);
  const at = at3(h, -0.2, x * 0.86, 0.62);
  const er = h.r * 0.32 * size;
  const face = unit(add(add(scale(h.d, 0.9), scale(h.s, x * 0.6)), scale(h.u, 0.2)));
  cap(kit, part, "coat", { a: at, b: at, r: er, flat: 0.5, up: face, finish: { melt: 0.3 } });
  decal(kit, `${part}.in`, "accent", { a: madd(at, face, er * 0.3), b: madd(at, face, er * 0.3), r: er * 0.84 });
}

/**
 * An eye that reads at a glance: the iris set proud of the head, a dark
 * pupil on it and a spark of light; shut, just a dark lid. It sits on the
 * head's surface where `toward` points from the head's middle.
 */
export function eyeOf(kit: Kit, part: string, h: Head, eye: EyeToward): void {
  const { toward, r, open } = eye;
  const n = unit(sub(toward, h.c), h.d);
  eyeAt(kit, part, h, { at: madd(h.c, n, h.r * (h.eye?.set ? 0.97 : 0.92)), n, r, open });
}

/** An eye of radius `r`, open or shut. */
export interface EyeLook { readonly r: number; readonly open: boolean }
/** One where `toward` points from the head's middle. */
export interface EyeToward extends EyeLook { readonly toward: Vec }
/** One on an outlined head's surface, at `spot`. */
export interface EyeSpot extends EyeLook { readonly spot: FacePoint }
/** One at `at` on the head, facing `n`. */
export interface EyeAt extends EyeLook { readonly at: Vec; readonly n: Vec }

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

export function outlinedEye(kit: Kit, part: string, h: Head, eye: EyeSpot): void {
  const { spot, r, open } = eye;
  const [d] = spot;
  const at = onFace(h, spot);
  const sec = h.sec?.(d) ?? { o: 0, h: 1, w: 1 };
  const axis = add(h.c, add(scale(h.d, d * h.r), scale(h.u, sec.o * h.r)));
  eyeAt(kit, part, h, { at, n: unit(madd(sub(at, axis), h.d, h.r * 0.35), h.d), r, open });
}

/**
 * An eye as its species has it (see `EYES`): framed by a dark rim on the
 * coat, the iris in its own colour, the pupil its own shape (a cat's slit,
 * a deer's bar, a mouse's eye all pupil) and a catchlight high on it.
 */
export function eyeAt(kit: Kit, part: string, h: Head, eye: EyeAt): void {
  const { at, n, r: r0, open } = eye;
  const style = h.eye ?? EYE;
  const r = r0 * style.size * 0.9;
  if (!open) {
    ball(kit, part, "dark", { p: at, r, flat: 0.3, up: n });
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
  cap(kit, part, style.pupil === "bead" ? "pupil" : "eye", { a: madd(c, across, -long), b: madd(c, across, long), r, flat: lens.flat, up: n });
  // (The renderer paints a lens's pupil and spark on it; a bead is all pupil, so it carries its own spark.)
  if (style.pupil !== "bead") return;
  ball(kit, `${part}.shine`, "shine", { p: madd(madd(madd(c, n, r * lens.out), up, r * lens.high), across, -r * lens.aside), r: r * (style.spark ?? (style.set ? 0.12 : 0.24)) });
}

/**
 * A lens: how far it sinks into the head, how flat it is, and where its spark sits on it (out along it, up it, and
 * aside).
 */
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
  cap(kit, "head", "coat", { a: at3(h, -0.58, 0, 0.06), b: at3(h, 0.24, 0, 0.06), r: h.r * 0.84, flat: 0.68, up: h.u, finish: { r1: h.r * 0.72, melt: 0.5 } });
  cap(kit, "snout", "coat", { a: at3(h, 0.3, 0, -0.1), b: at3(h, 0.7, 0, -0.2), r: h.r * 0.62, flat: 0.76, up: h.u, finish: { r1: h.r * 0.46, melt: 0.2 } });
  const gap = h.r * q.mouth * 0.6;
  cone(kit, "jaw", "belly", { a: at3(h, -0.1, 0, -0.44), b: madd(at3(h, 0.8, 0, -0.56), h.u, -gap), r: h.r * 0.44, r1: h.r * 0.3, melt: 0.35 });
  cap(kit, "beak", "horn", { a: at3(h, 1.02, 0, -0.24), b: at3(h, 1.15, 0, -0.5), r: h.r * 0.33, flat: 0.5, up: h.d, finish: { r1: h.r * 0.14 } });
  const chin = madd(at3(h, 1, 0, -0.66), h.u, -gap);
  cap(kit, "beak.low", "horn", { a: madd(chin, h.s, -h.r * 0.14), b: madd(chin, h.s, h.r * 0.14), r: h.r * 0.15, flat: 0.7, up: h.u });
  const mouth = at3(h, 0.5, 0, -0.5);
  cap(kit, "mouth", "dark", { a: mouth, b: mouth, r: h.r * 1.3, flat: 0.085, up: madd(h.u, h.d, 0.34), finish: { decal: true, melt: 0.25 } });
  for (const x of [-1, 1]) {
    const nostril = at3(h, 1.06, x * 0.13, 0.06);
    decal(kit, "nostril", "dark", { a: nostril, b: nostril, r: h.r * 0.05 });
    const eye = at3(h, 0.22, x * 0.71, 0.2);
    eyeAt(kit, `eye.${x < 0 ? "L" : "R"}`, h, { at: eye, n: unit(add(scale(h.s, x * 0.82), add(scale(h.d, 0.52), scale(h.u, 0.18)))), r: h.r * 0.22, open: !asleep });
    cone(kit, "brow", "coat", { a: at3(h, -0.2, x * 0.56, 0.5), b: at3(h, 0.58, x * 0.42, 0.4), r: h.r * 0.17, r1: h.r * 0.1, melt: 0.4 });
  }
  // (Too small to shade the ground: only the skull casts a shadow.)
  for (let i = from + 1; i < kit.out.length; i += 1) {
    const part = kit.out[i];
    if (part) kit.out[i] = { ...part, shadow: false };
  }
}

/** Whether the animal is asleep this moment, its eyes shut. */
export const asleepIn = (m: Moment): boolean => m.segment.act === "sleep";

export function faceOf(kit: Kit, actor: Who, h: Head, m: Moment): void {
  if (actor.member.species === "cat") catFace(kit, actor, h, m);
  else if (buildOf(actor).extras.includes("shell")) shellFace(kit, h, m.pose, asleepIn(m));
  else if (h.stations) outlinedFace(kit, actor, h, m);
  else roundFace(kit, actor, h, m);
}

/** A round head: a ball, its muzzle, jaw and nose, its eyes, marks and ears. */
function roundFace(kit: Kit, actor: Who, h: Head, m: Moment): void {
  const q = m.pose;
  const asleep = asleepIn(m);
  const b = buildOf(actor);
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", { p: h.c, r: h.r });
  // The muzzle tapers from the face to the nose: to a point on a fox, hardly at all on a capybara.
  const root = at3(h, 0.35, 0, -0.1);
  const tip = madd(madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15), h.u, h.r * (b.snoutUp ?? 0));
  const tipR = h.r * 0.5 * b.snoutTip;
  cone(kit, "snout", "coat", { a: root, b: tip, r: h.r * 0.5, r1: tipR });
  const jawRoot = at3(h, 0.3, 0, -0.32);
  const jawTip = madd(madd(jawRoot, h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cone(kit, "jaw", "belly", { a: jawRoot, b: jawTip, r: h.r * 0.36, r1: Math.max(tipR * 0.7, h.r * 0.12) });
  noseOf(kit, b, h, { at: tip, r: tipR });
  const eyes = roundEyes(b);
  eyes.forEach((spot, i) => {
    eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, { toward: onFace(h, spot), r: h.r * 0.25, open: !asleep });
  });
  faceMarks(kit, actor, h, { tip, eyes, eyeR: h.r * 0.25 * (h.eye?.size ?? 1) });
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  if (b.extras.includes("jowls")) for (const x of [-1, 1]) jowlOf(kit, h, x);
  earsOf(kit, h, { kind: b.ears, back: q.earBack, size: b.earLen, role: b.extras.includes("cheeks") || b.extras.includes("wet") ? "accent" : "coat", base: b.earBase });
}

/** A round head's nose on the end of its muzzle. */
function noseOf(kit: Kit, b: Build, h: Head, end: { readonly at: Vec; readonly r: number }): void {
  const { at: tip, r: tipR } = end;
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", { a: madd(tip, h.u, h.r * 0.2), b: madd(tip, h.u, -h.r * 0.12), r: h.r * 0.3, flat: 0.7, up: h.d });
  else if (b.extras.includes("button")) {
    // (A broad rounded triangle, wide across the top, on the muzzle's blunt end, with a spark of wet light on it.)
    const top = add(tip, add(scale(h.d, tipR * 0.75), scale(h.u, tipR * 0.42)));
    cap(kit, "nose", "nose", { a: top, b: madd(top, h.u, -h.r * 0.14), r: h.r * 0.21, flat: 0.72, up: h.d, finish: { r1: h.r * 0.085 } });
    ball(kit, "nose.shine", "shine", { p: add(top, add(scale(h.d, h.r * 0.09), add(scale(h.u, h.r * 0.12), scale(h.s, -h.r * 0.09)))), r: h.r * 0.024 });
  } else if (b.extras.includes("wet")) {
    // (A small ball on the very end of a pointed muzzle, a spark of wet light high on it.)
    const end = madd(tip, h.d, tipR * 0.85);
    ball(kit, "nose", "nose", { p: end, r: tipR * 0.68 });
    ball(kit, "nose.shine", "shine", { p: add(end, add(scale(h.d, tipR * 0.42), add(scale(h.u, tipR * 0.32), scale(h.s, -tipR * 0.22)))), r: tipR * 0.13 });
  // (A pointed muzzle ends in its nose; a blunt one's, a tortoise's, stays in it.)
  } else ball(kit, "nose", "nose", { p: madd(tip, h.d, b.snoutTip < 0.5 ? tipR * 0.8 : 0), r: Math.max(tipR * 0.6, h.r * 0.12) });
}

/**
 * A tuft of pale fur back from the cheek and out past the jaw to a soft point, which makes a broad head of a narrow
 * muzzle from the front and breaks its outline from the side.
 */
function jowlOf(kit: Kit, h: Head, x: number): void {
  cap(kit, `jowl.${x < 0 ? "L" : "R"}`, "belly", { a: at3(h, 0.4, x * 0.56, -0.36), b: at3(h, -0.38, x * 0.98, -0.56), r: h.r * 0.42, flat: 1, up: UP, finish: { r1: h.r * 0.17, melt: 1 } });
}

/**
 * A face drawn from its species' outline: skull and muzzle lofted as one
 * surface, the jaw under the muzzle (it drops as the mouth opens), the nose
 * capping the muzzle's end and the eyes under the brow, just behind the stop.
 */
function outlinedFace(kit: Kit, actor: Who, h: Head, m: Moment): void {
  const q = m.pose;
  const asleep = asleepIn(m);
  const b = buildOf(actor);
  const stop = h.stop ?? 0.35;
  const tip = h.tip ?? 1;
  const sec = h.sec ?? ((): Section => ({ o: 0, h: 1, w: 1 }));
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  loft(kit, "head", "coat", { st: h.stations ?? [], along, u: h.u, s: h.s, size: h.r, melt: 1 });
  const root = sec(stop);
  const end = sec(tip);
  const front = madd(along(tip), h.u, (end.o + end.h * 0.25) * h.r);
  const nose = madd(front, h.d, Math.max(end.h, end.w) * h.r * 0.8);
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", { a: madd(nose, h.u, h.r * 0.2), b: madd(nose, h.u, -h.r * 0.12), r: h.r * 0.3, flat: 0.7, up: h.d });
  else ball(kit, "nose", "nose", { p: nose, r: Math.max(end.w * 0.45, 0.1) * h.r, flat: 0.75, up: h.d });
  const jawRoot = madd(along(stop - 0.1), h.u, (root.o - root.h * 0.5) * h.r);
  const jawEnd = madd(along(tip), h.u, (end.o - end.h * 0.5) * h.r - (tip - stop) * h.r * q.mouth * 0.5);
  cone(kit, "jaw", "coat", { a: jawRoot, b: jawEnd, r: root.h * 0.5 * h.r, r1: end.h * 0.55 * h.r });
  const [ed, es, eu] = EYE_SET;
  const eyes = [-1, 1].map((x) => eyeSpot(stop + ed, x * es, eu));
  eyes.forEach((spot, i) => {
    outlinedEye(kit, `eye.${i === 0 ? "L" : "R"}`, h, { spot, r: h.r * 0.22, open: !asleep });
  });
  faceMarks(kit, actor, h, { tip: nose, eyes, eyeR: h.r * 0.22 * (h.eye?.size ?? 1) });
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  earsOf(kit, h, { kind: b.ears, back: q.earBack, size: b.earLen, role: b.extras.includes("cheeks") ? "accent" : "coat", base: b.earBase });
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
  decal(kit, "mask", "dark", { a: onFace(h, inner), b: onFace(h, toSkin(out)), r: eyeR * 1.6 });
}

/**
 * A long oval of paint laid on the head at `at` and drawn out along `run` by
 * `reach`, narrowing from `r` to `r1` as it goes: `flat` is its width against
 * its length, and it stays as deep as it is long, so it meets the head's curve
 * from end to end.
 */
export interface FacePaint {
  /** The head it lies on. */
  readonly h: Head;
  readonly at: Vec;
  readonly run: Vec;
  readonly reach: number;
  readonly r: number;
  readonly r1: number;
  readonly flat: number;
  readonly melt: number;
}
export function facePatch(kit: Kit, part: string, role: Role, paint: FacePaint): void {
  const { h, at, run, reach, r, r1, flat, melt } = paint;
  const n = unit(sub(at, h.c), h.d);
  const along = unit(madd(run, n, -dot(run, n)), h.s);
  cap(kit, part, role, {
    a: at,
    b: madd(at, along, reach),
    r,
    flat,
    up: cross(n, along),
    finish: { decal: true, r1, melt },
  });
}

/**
 * A raccoon's mask round one eye: an oval from just short of the bridge, where it barely meets its pair, back and down
 * past the eye, narrowing toward the jaw's corner.
 */
function banditMask(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  const run = sub(onFace(h, toSkin([d - 0.62, x * 0.92, u - 0.5])), onFace(h, frontAt(x * 0.06, u + 0.06)));
  facePatch(kit, "mask", "dark", { h, at: onFace(h, eye), run, reach: h.r * 0.5, r: band * 2.6, r1: band * 1, flat: 0.52, melt: 1.1 });
}

/**
 * A pale brow over one eye's mask, found from the eye too: nearly level along the mask's top, out from over the eye,
 * thin and fading at its outer end.
 */
function browMark(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  facePatch(kit, "brow", "accent", { h, at: onFace(h, toSkin([d - 0.04, s * 0.74, u + 0.42])), run: scale(h.s, x), reach: h.r * 0.24, r: band * 1.45, r1: band * 0.6, flat: 0.36, melt: 1.1 });
}

/**
 * A raccoon's face: the black mask, a white brow over it, a white muzzle
 * under it and a soft dark blaze down the nose between, broad on the forehead
 * and gone before the nose. (The first decal to cover a point keeps it, so the
 * black comes first and the white meets its edge clean.)
 */
/** What a face's marks are set from: the end of its muzzle, where its eyes sit and how big they are. */
interface Features { readonly tip: Vec; readonly eyes: readonly FacePoint[]; readonly eyeR: number }

function banditMarks(kit: Kit, h: Head, features: Features): void {
  const { tip, eyes, eyeR } = features;
  // (A small eye in a big patch: the band is sized to the head's mask, not to the eye.)
  const band = eyeR * 1.3;
  for (const eye of eyes) {
    banditMask(kit, h, eye, band);
    browMark(kit, h, eye, band);
  }
  const brow = frontAt(0, (eyes[0]?.[2] ?? 0) + 0.46);
  // (A blade, flat across the face and deep into it, so it meets the curve down the bridge from end to end.)
  cap(kit, "line", "alt", { a: onFace(h, brow), b: add(tip, add(scale(h.u, h.r * 0.2), scale(h.d, -h.r * 0.14))), r: h.r * 0.56, flat: 0.32, up: h.s, finish: { decal: true, r1: h.r * 0.14, melt: 1.4 } });
  decal(kit, "muzzle", "accent", { a: at3(h, 0.3, 0, -0.5), b: tip, r: h.r * 0.7 });
}

/** Face markings, set across the head's surface so they paint it from any side. */
function faceMarks(kit: Kit, actor: Who, h: Head, features: Features): void {
  const { tip, eyes, eyeR } = features;
  const b = buildOf(actor);
  const cheeks = b.extras.includes("cheeks");
  const mask = b.extras.includes("mask");
  if (b.extras.includes("brows")) {
    banditMarks(kit, h, features);
    return;
  }
  if (b.extras.includes("muzzle")) decal(kit, "muzzle", cheeks || actor.member.species === "marmot" ? "accent" : "belly", { a: at3(h, 0.65, 0, -0.4), b: tip, r: h.r * 0.45 });
  if (mask) {
    const wide = eyeR * mix(0.86, 1.2, createRandom(markOf(actor) ^ 0x6a09e667)());
    for (const eye of eyes) maskBand(kit, h, eye, wide);
  }
  // (A badger's white blaze runs from its nose over its crown, between dark stripes.)
  if (mask && b.extras.includes("stripes")) decal(kit, "blaze", "accent", { a: tip, b: at3(h, -0.4, 0, 1.0), r: h.r * 0.3 });
  if (cheeks) for (const x of [-1, 1]) decal(kit, "cheek", "accent", { a: at3(h, 0.4, x * 0.88, -0.15), b: at3(h, 0.7, x * 0.6, 0.5), r: h.r * 0.3 });
}

/** A buck's antlers: a beam sweeping up, out and forward, with tines off its front. */
function antlersOf(kit: Kit, h: Head, size: number): void {
  for (const x of [-1, 1]) {
    const root = at3(h, -0.1, x * 0.42, 0.85);
    const beam = unit(add(add(scale(h.u, 1), scale(h.d, -0.45)), scale(h.s, x * 0.75)));
    const bend = madd(root, beam, size * 0.18);
    const top = madd(bend, unit(add(add(scale(h.u, 1), scale(h.d, 0.55)), scale(h.s, x * 0.25))), size * 0.16);
    cap(kit, "antler", "horn", { a: root, b: bend, r: size * 0.026, flat: 1, up: UP, finish: { r1: size * 0.02, melt: 0.3 } });
    cap(kit, "antler", "horn", { a: bend, b: top, r: size * 0.02, flat: 1, up: UP, finish: { r1: size * 0.012, melt: 0.3 } });
    const brow = madd(root, beam, size * 0.05);
    cap(kit, "tine", "horn", { a: brow, b: madd(brow, unit(add(scale(h.d, 1), scale(h.u, 0.5))), size * 0.08), r: size * 0.016, flat: 1, up: UP, finish: { r1: size * 0.008, melt: 0.3 } });
    cap(kit, "tine", "horn", { a: bend, b: madd(bend, unit(add(scale(h.u, 1), scale(h.d, 0.3))), size * 0.11), r: size * 0.016, flat: 1, up: UP, finish: { r1: size * 0.008, melt: 0.3 } });
  }
}

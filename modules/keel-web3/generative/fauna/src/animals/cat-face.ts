// A cat's face: its coat's pattern carried onto it, tabby lines and calico patches, and its own eyes and ears.

import { UP, add, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import type { Role } from "../roster.js";
import type { Moment } from "../stage/moments.js";
import { cap, cone, decal, ownPhase } from "./kit.js";
import type { Kit } from "./kit.js";
import { markOf } from "./bodies.js";
import type { Who } from "./bodies.js";
import { asleepIn, eyeAt } from "./quad-head.js";
import type { Head } from "./quad-head.js";

/**
 * A cat's face: a round skull full in the cheek, a short wide muzzle of two
 * whisker pads over a neat chin, a small nose, the slanted eyes painted flat
 * into the skull and set forward, and broad ears on the corners of its head.
 * (Paint: the first decal to cover a point keeps it, so the eyes come before
 * the markings round them.)
 */
export function catFace(kit: Kit, actor: Who, h: Head, m: Moment): void {
  const q = m.pose;
  const asleep = asleepIn(m);
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  // (A point on the face: along the head, then out and up from its axis, in head radii.)
  const on: FaceAt = (d, s, u) => add(along(d), add(scale(h.s, s * h.r), scale(h.u, u * h.r)));
  // (The skull lies across the head, so it is round from the side and broad from the front; this is a point on its
  // skin.)
  const skin: Skin = (s, u) =>
    on(Math.sqrt(Math.max(0.88 ** 2 - Math.max(Math.abs(s) - 0.1, 0) ** 2 - u ** 2, 0.02)), s, u);
  const cat: CatHead = { h, on, skin };
  cap(kit, "head.0", "coat", { a: on(0, -0.1, 0), b: on(0, 0.1, 0), r: h.r * 0.88 });
  // (The muzzle is one short wide pale roll across the face, parted down its middle into two whisker pads.)
  cap(kit, "pad", "belly", { a: on(0.78, -0.2, -0.22), b: on(0.78, 0.2, -0.22), r: h.r * 0.42, flat: 0.86, up: h.u });
  decal(kit, "mouth", "dark", { a: on(1.26, 0, -0.1), b: on(1.16, 0, -0.4), r: h.r * 0.03 });
  cone(kit, "jaw", "belly", { a: on(0.6, 0, -0.5), b: on(0.96, 0, -0.5 - q.mouth * 0.3), r: h.r * 0.24, r1: h.r * 0.2 });
  cap(kit, "nose", "nose", { a: on(1.17, 0, -0.05), b: on(1.15, 0, -0.11), r: h.r * 0.12, flat: 0.6, up: h.d, finish: { r1: h.r * 0.05 } });
  for (const x of [-1, 1]) catEye(kit, cat, x, !asleep);
  const roles = coatFace(kit, actor, cat);
  for (const x of [-1, 1]) {
    catEar(kit, cat, x, { back: q.earBack, role: x < 0 ? roles[0] : roles[1] });
    // (Two fine pale whiskers from each pad, fanned a little and drooping to their tips.)
    cap(kit, "whisker", "shine", { a: on(0.9, x * 0.5, -0.2), b: on(0.9, x * 0.5, -0.3), r: h.r * 0.012, flat: 1, up: UP, finish: {
      row: 2,
      reach: sub(on(0.4, x * 1.3, -0.25), on(0.9, x * 0.5, -0.25)),
      sharp: true,
      shadow: false,
    } });
  }
}

/** A point on the face: along the head, out and up from its axis, in head radii. */
type FaceAt = (d: number, s: number, u: number) => Vec;
/** A point on the skin of the skull, from where it lies across the face. */
type Skin = (s: number, u: number) => Vec;
/** A cat's head, with its own ways of finding a point on its face and on its skull. */
interface CatHead { readonly h: Head; readonly on: FaceAt; readonly skin: Skin }

/** Coats with a tabby's marks on the face as on the body. */
export const TABBIES: ReadonlySet<string> = new Set(["tabby", "grey"]);

/** What a coat paints on the face round the eyes; it gives back each ear's colour. */
function coatFace(kit: Kit, actor: Who, cat: CatHead): readonly [Role, Role] {
  if (TABBIES.has(actor.member.coat)) tabbyFace(kit, cat);
  if (actor.member.coat !== "calico") return ["coat", "coat"];
  // (Whichever side the black falls on is the animal's own.)
  const x = ownPhase(actor) < 0.5 ? -1 : 1;
  const gene = createRandom(markOf(actor) ^ 0x3c6ef372);
  calicoPatch(kit, cat, x, { role: "dark", gene });
  calicoPatch(kit, cat, -x, { role: "alt", gene });
  return x < 0 ? ["dark", "alt"] : ["alt", "dark"];
}

/**
 * A tabby's face: the dark M on the brow, two peaks over a dip between the eyes, and a line back from each eye's outer
 * corner.
 */
function tabbyFace(kit: Kit, cat: CatHead): void {
  const { h, skin } = cat;
  // (Each a thin blade, flat across its own line and deep into the head, so it meets the curve of the crown from end to
  // end.)
  const line = (a: Vec, b: Vec, wide: number): void => {
    const n = unit(sub(lerpV(a, b, 0.5), h.c), h.d);
    cap(kit, "brow", "alt", { a, b, r: h.r * 0.2, flat: wide / 0.2, up: unit(cross(sub(b, a), n), h.s), finish: { decal: true } });
  };
  for (const x of [-1, 1]) {
    line(skin(x * 0.38, 0.44), skin(x * 0.24, 0.76), 0.06);
    line(skin(x * 0.24, 0.76), skin(0, 0.46), 0.06);
    line(skin(x * 0.8, 0.2), skin(x * 0.93, 0.1), 0.05);
  }
}

/**
 * A calico's patch on one side of its face, from the ear down round the eye: the eye framed in it, the nose and the
 * blaze left white.
 */
function calicoPatch(
  kit: Kit,
  cat: CatHead,
  x: number,
  paint: { readonly role: Role; readonly gene: () => number },
): void {
  const { h, skin } = cat;
  const { role, gene } = paint;
  decal(kit, "face", role, {
    a: skin(x * mix(0.6, 0.8, gene()), mix(0.5, 0.72, gene())),
    b: skin(x * mix(0.44, 0.64, gene()), mix(-0.02, 0.2, gene())),
    r: h.r * mix(0.34, 0.56, gene()),
  });
}

/**
 * A cat's eye, painted flat into the skull: a dark almond tilted up to its outer corner, heavier along its upper lid,
 * the iris in it, the slit tall and narrow down its middle, the one catch of light on the same side of both; shut, a
 * dark line.
 */
function catEye(kit: Kit, cat: CatHead, x: number, open: boolean): void {
  const { h } = cat;
  const at = cat.skin(x * 0.54, 0.13);
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const n = unit(add(h.d, add(scale(h.s, x * 0.8), scale(h.u, 0.2))));
  // (Across and up on the eye's own face, the outer corner lifted.)
  const tilted = madd(h.s, h.u, x * 0.3);
  const across = unit(madd(tilted, n, -dot(tilted, n)));
  if (!open) {
    cap(kit, part, "dark", {
      a: madd(at, across, -h.r * 0.27),
      b: madd(at, across, h.r * 0.27),
      r: h.r * 0.045,
      flat: 1,
      up: UP,
      finish: {
        melt: 0.2,
      },
    });
    return;
  }
  // (The renderer paints the slit, iris, rim and spark on its lens, like any other eye.)
  eyeAt(kit, part, h, { at, n, r: h.r * 0.2, open: true });
}

/**
 * A cat's ear: a broad low triangle, a little rounded at its tip, on the corner of its head, held up however the head
 * tilts, its pink inside turned forward so both show.
 */
function catEar(kit: Kit, cat: CatHead, x: number, ear: { readonly back: number; readonly role: Role }): void {
  const { h, on } = cat;
  const { back, role } = ear;
  const part = `ear.${x < 0 ? "L" : "R"}`;
  const root = on(-0.1, x * 0.6, 0.55);
  const dir = unit(add(add(lerpV(h.u, UP, 0.65), scale(h.s, x * 0.34)), scale(h.d, -(0.02 + back * 0.8))));
  const n = unit(madd(h.d, h.s, x * 0.5));
  const r = h.r * 0.5;
  cap(kit, part, role, {
    a: root,
    b: madd(root, dir, h.r * 0.84),
    r,
    flat: 0.56,
    up: n,
    finish: { r1: h.r * 0.1, melt: 0.35 },
  });
  const inner = madd(madd(root, n, r * 0.4), dir, h.r * 0.24);
  cap(kit, `${part}.in`, "accent", { a: inner, b: madd(inner, dir, h.r * 0.5), r: r * 0.62, flat: 0.46, up: n, finish: { r1: h.r * 0.1, decal: true } });
}

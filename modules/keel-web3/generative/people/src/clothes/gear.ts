// Gear: glasses, earrings, a stud or ring in the nose, a chain, what is clipped in the hair, and the small things laid
// on a face near to, a mouth's corners and a moustache.

import { FRONT, SIDE, TAU, UP, add, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Gear, Person } from "../body/person.js";
import { restSkeleton } from "../motion/skeleton.js";
import type { HeadFrame } from "../head/head.js";
import { HEAD, boneIndex } from "../body/bones.js";
import type { Wearer } from "../body/field.js";
import { FABRICS } from "./fabric.js";
import { WRAPPED } from "./cloth.js";
import { FAR_HAIR } from "../head/hair.data.js";
import { layLock } from "../head/lock.js";
import type { Lay, Worn } from "../head/lock.js";
import { boundOf } from "../head/ears.js";
import type { Bound, Seat } from "../head/ears.js";
import { evened, marksOf, surfaceOf } from "../head/paint.js";
import type { Marks } from "../head/paint.js";

/** Whatever lays one piece of what a person wears, in head radii. */
type LayGear = (line: readonly Vec[], size: readonly [number, number, number], worn: Worn) => void;
/** Whatever fills a flat shape, seen from both sides. */
type LayPane = (outline: readonly Vec[], normal: Vec, worn: { readonly role: string; readonly fabric: number }) => void;

const METAL = { role: "metal", fabric: FABRICS.latex };
const FRAME = { role: "dark", fabric: FABRICS.latex };
const LENS = { role: "lens", fabric: FABRICS.latex };
const CLIP = { role: "clip", fabric: FABRICS.satin };
const bead = (s: number): number => Math.sqrt(Math.max(0.02, 1 - (2 * s - 1) ** 2));

/** A closed line round a middle, however it is bent. */
const ringOf = (count: number, at: (c: number, s: number) => Vec): readonly Vec[] =>
  Array.from({ length: count + 1 }, (_, i) => at(Math.cos((i / count) * TAU), Math.sin((i / count) * TAU)));

/**
 * What a kind of frame is: how wide its lens is against the eye, how tall against its width, how square, how thick its
 * rim, whether it is wire, and how far its outer corners flick up.
 */
interface FrameKind {
  readonly wide: number;
  readonly tall: number;
  readonly square: number;
  readonly rim: readonly [number, number];
  readonly wire: boolean;
  readonly flick: number;
}

const FRAMES: Readonly<Record<Exclude<Gear["glasses"], "none">, FrameKind>> = {
  clear: { wide: 1.75, tall: 0.74, square: 0.62, rim: [0.024, 0.018], wire: false, flick: 0 },
  round: { wide: 1.6, tall: 1, square: 1, rim: [0.014, 0.012], wire: true, flick: 0 },
  cat: { wide: 1.8, tall: 0.68, square: 0.7, rim: [0.028, 0.02], wire: false, flick: 0.09 },
  sun: { wide: 1.95, tall: 0.82, square: 0.72, rim: [0.028, 0.022], wire: false, flick: 0 },
};

/** How far each lens is turned back from the face's plane, a slope. */
const FRAME_WRAP = 0.1;

/** A pair of glasses, as one rigid thing. A lens is a flat shape; `x` says which side. */
interface Frame {
  readonly rx: number;
  readonly ry: number;
  readonly front: number;
  readonly centre: (x: number) => Vec;
  readonly rim: (x: number, c: number, s: number) => Vec;
  readonly facing: (x: number) => Vec;
}

/** What there is to hang gear on: the person, the marks of their face and its surface, and what lays a piece. */
interface Trim {
  readonly p: Person;
  readonly k: Marks;
  readonly seat: Seat;
  readonly surface: (x: number, y: number) => number;
  readonly h: HeadFrame;
  /** The boundary of everything but the eyes, that clips and bands lie on. */
  readonly outer: Bound;
  readonly lay: LayGear;
  readonly pane: LayPane;
}

/**
 * Where a pair of glasses sits: lenses square on each eye, as close as the brow, the cheek and the lashes allow, and
 * the bridge down on the nose.
 */
function frameOn(kind: Exclude<Gear["glasses"], "none">, { p, k, surface }: Trim): Frame {
  const f = FRAMES[kind];
  const rx = Math.min(p.face.eye * f.wide, k.eyeX - 0.06);
  const ry = rx * f.tall;
  const y = k.pupil - 0.01;
  const clear = [-1, 1].flatMap((x) =>
    [-0.8, 0, 0.8].flatMap((c) =>
      [-0.8, 0, 0.8].map(
        (v) => surface(x * k.eyeX + rx * c, y + ry * v) + (x * k.eyeX * c > 0 ? FRAME_WRAP * rx * Math.abs(c) : 0),
      ),
    ),
  );
  const front = Math.max(...clear, surface(0, y) + 0.01) + 0.015;
  const shape = (v: number): number => Math.sign(v) * Math.abs(v) ** f.square;
  const rim = (x: number, c: number, s: number): Vec => {
    const u = rx * shape(c);
    const v = ry * shape(s) + f.flick * Math.max(0, c * x * s) ** 2;
    return [x * k.eyeX + u, y + v, front - FRAME_WRAP * Math.abs(u) * Math.sign(u * x)];
  };
  const facing = (x: number): Vec => unit([x * FRAME_WRAP, 0, 1], FRONT);
  return { rx, ry, front, centre: (x) => [x * k.eyeX, y, front], rim, facing };
}

/**
 * An arm of a pair of glasses: straight back from its hinge, clear of the skin, over the top of the ear and hooked down
 * behind it.
 */
function templeArm(seat: Seat, hinge: Vec, side: number): readonly Vec[] {
  const top = seat.tops[side];
  const end: Vec = top ? add(top, [0, 0.03, 0]) : [hinge[0], hinge[1], -0.2];
  const wide = (q: Vec): Vec => {
    const d = unit(q, SIDE);
    const need = seat.skin.far(d) + 0.02;
    const far = Math.hypot(...q);
    return far < need ? scale(d, need) : q;
  };
  const along = [0.25, 0.5, 0.75, 1].map((t) => wide(lerpV(hinge, end, t)));
  const hooked = [[0.1, -0.05], [0.18, -0.13], [0.22, -0.23]];
  const hook = top ? hooked.map(([back = 0, down = 0]) => wide(add(end, [0, down, -back]))) : [];
  return [hinge, ...along, ...hook];
}

/**
 * Glasses: a flat lens in a rim on each eye, a bridge between them, a hinge at each outer corner and an arm back to
 * each ear.
 */
function layGlasses(t: Trim): void {
  const { lay, pane, p, seat } = t;
  const kind = p.gear.glasses;
  if (kind === "none") return;
  const f = FRAMES[kind];
  const frame = frameOn(kind, t);
  const stuff = f.wire ? METAL : FRAME;
  [-1, 1].forEach((x, side) => {
    const round = ringOf(32, (c, s) => frame.rim(x, c, s));
    lay(round, [f.rim[0], f.rim[1], 6], { ...stuff, up: frame.facing(x) });
    if (kind === "sun") pane(round, frame.facing(x), LENS);
    const edge = frame.rim(x, x, 0.45);
    const hinge: Vec = [edge[0] + x * 0.03, edge[1], edge[2] - 0.05];
    lay([edge, lerpV(edge, hinge, 0.5), hinge], [f.rim[0] * 0.9, f.rim[1], 4], { ...stuff, up: UP });
    lay(templeArm(seat, hinge, side), [f.wire ? 0.012 : 0.02, f.wire ? 0.01 : 0.01, 4], { ...stuff, up: [x, 0, 0] });
  });
  const inner = (x: number): Vec => frame.rim(x, -x, 0.42);
  const a = inner(-1);
  const b = inner(1);
  const lift = frame.ry * 0.16;
  const bridge = [a, add(lerpV(a, b, 0.3), [0, lift, 0]), add(lerpV(a, b, 0.7), [0, lift, 0]), b];
  lay(bridge, [f.rim[0], f.rim[1], 4], { ...stuff, up: FRONT });
}

/** Earrings, hanging from lobes that are really there. */
function layEars({ lay, p, seat }: Trim): void {
  const kind = p.gear.ears;
  if (kind === "none") return;
  [-1, 1].forEach((x, side) => {
    const lobe = seat.lobes[side];
    if (!lobe) return;
    if (kind === "stud") {
      const stud = [lobe, add(lobe, [x * 0.02, 0, 0.01]), add(lobe, [x * 0.04, 0, 0.02])];
      lay(stud, [0.026, 0.026, 6], { ...METAL, taper: bead });
    }
    if (kind === "hoop") {
      const hoop = ringOf(14, (c, s) => [lobe[0] + x * 0.01, lobe[1] - 0.11 + 0.11 * s, lobe[2] + 0.11 * c]);
      lay(hoop, [0.011, 0.011, 4], METAL);
    }
    if (kind === "drop") {
      lay([lobe, add(lobe, [0, -0.14, 0])], [0.007, 0.007, 4], METAL);
      const drop = [add(lobe, [0, -0.14, 0]), add(lobe, [0, -0.2, 0]), add(lobe, [0, -0.26, 0])];
      lay(drop, [0.036, 0.036, 6], { ...METAL, taper: bead });
    }
  });
}

/** A stud in the wing of the nose, or a ring through its middle. */
function layNose({ lay, p, k, surface }: Trim): void {
  const side = p.seed % 2 === 0 ? -1 : 1;
  const z = surface(side * 0.16, k.sn + 0.08);
  if (p.gear.nose === "stud") {
    const stud: Vec[] = [
      [side * 0.16, k.sn + 0.08, z],
      [side * 0.17, k.sn + 0.08, z + 0.02],
      [side * 0.18, k.sn + 0.08, z + 0.04],
    ];
    lay(stud, [0.02, 0.02, 6], { ...METAL, taper: bead });
  }
  if (p.gear.nose === "ring") {
    lay(ringOf(10, (c, s) => [0.05 * c, k.sn - 0.03 + 0.05 * s, surface(0, k.sn) - 0.02]), [0.008, 0.008, 4], METAL);
  }
}

/** A chain round the neck, lying on what they wear, and what hangs from it. */
function layNeck({ lay, p, h }: Trim): void {
  if (p.gear.neck === "none" || !["tee", "tank", "dress", "swimsuit", "bikini", "bare"].includes(p.outfit.top)) return;
  const s = restSkeleton(p);
  const head = (at: Vec): Vec => scale(sub(at, h.c), 1 / h.r);
  const base = head(lerpV(s.neck, s.chest, 0.3));
  const chest = { ...METAL, bone: boneIndex("chest") };
  const chain = ringOf(26, (c, si) => [
    base[0] + 0.86 * si,
    base[1] - 0.42 * ((c + 1) / 2) ** 2,
    base[2] + 0.1 + 0.62 * c,
  ]);
  lay(chain, [0.012, 0.01, 4], chest);
  const low = add(base, [0, -0.42, 0.74]);
  if (p.gear.neck === "pendant") {
    lay([low, add(low, [0, -0.07, 0.01]), add(low, [0, -0.14, 0])], [0.05, 0.03, 6], { ...chest, taper: bead });
  }
}

/** A direction `along` from one ear over the top to the other, leaning `fore` forward. */
const overHead = (along: number, fore: number): Vec => unit([Math.sin(along), Math.cos(along), fore], UP);

/** An arc over a head from ear to ear, lying on its boundary. */
const arcOver = (outer: Bound, fore: number, half: number, lift: number): readonly Vec[] =>
  Array.from({ length: 21 }, (_, i) => outer.on(overHead(half * (i / 10 - 1), fore), lift));

/** Clips along the side of the hair, each lying on it. */
function layClips(lay: LayGear, outer: Bound, side: number, places: readonly number[]): void {
  for (const at of places) {
    const clip = [0.42, 0.36, 0.3].map((fore, i) => outer.on(overHead(side * (at + i * 0.03), fore), 0.012));
    lay(clip, [0.045, 0.016, 4], CLIP);
  }
}

/**
 * What is in the hair, a clip or a row of them, a bow, a band, and headphones over all of it: all of it lying on what
 * is there.
 */
function layHair({ lay, p, outer }: Trim): void {
  const kind = p.gear.hair;
  const side = p.seed % 2 === 0 ? -1 : 1;
  if (p.hair !== "bald") {
    if (kind === "band") lay(arcOver(outer, 0.2, 1.45, 0.008), [0.07, 0.022, 4], CLIP);
    if (kind === "clip" || kind === "clips") layClips(lay, outer, side, kind === "clip" ? [0.8] : [0.62, 0.8, 0.98]);
    if (kind === "bow") {
      const at = outer.on(overHead(side * 0.8, 0.4), 0.02);
      const taper = (s: number): number => 0.35 + 1.3 * Math.abs(s - 0.5);
      lay([add(at, [-0.2, 0.05, 0]), at, add(at, [0.2, 0.05, 0])], [0.1, 0.02, 4], { ...CLIP, taper });
    }
  }
  if (!p.gear.phones) return;
  lay(arcOver(outer, 0, 1.38, 0.016), [0.06, 0.026, 4], FRAME);
  for (const x of [-1, 1]) {
    const at = outer.on(unit([x, 0, -0.12], SIDE));
    const d = unit(at, SIDE);
    lay([at, madd(at, d, 0.06), madd(at, d, 0.13)], [0.27, 0.27, 12], { ...FRAME, taper: bead });
  }
}

/** A flat shape filled in, a sheet each way so it shows from either side. */
function paneOf(lay: Lay, outline: readonly Vec[], normal: Vec, worn: Pick<Worn, "role" | "fabric">): number {
  const { net, roles, to } = lay;
  const role = Math.max(0, roles.indexOf(worn.role));
  const count = outline.length;
  const middle = scale(outline.reduce(add, [0, 0, 0]), 1 / count);
  const base = net.position.length / 3;
  for (const facing of [1, -1]) {
    for (const q of [middle, ...outline]) {
      net.position.push(...to(q));
      net.normal.push(...scale(normal, facing));
      net.role.push(role);
      net.bones.push(HEAD, HEAD);
      net.weight.push(1);
      net.fabric.push(worn.fabric);
      net.loose.push(0);
      net.soft.push(0);
      net.cloth.push(0, 0, 0, 1);
    }
  }
  const back = base + count + 1;
  for (let i = 0; i < count; i += 1) {
    const a = i + 1;
    const b = ((i + 1) % count) + 1;
    net.index.push(base, base + a, base + b, back, back + b, back + a);
  }
  return (count + 1) * 2;
}

/** Everything small a person wears, near enough to see it. */
export function gearOn(w: Wearer, h: HeadFrame, seat: Seat): readonly number[] {
  const { net, p, roles, cell } = w;
  if (cell >= WRAPPED || p.outfit.costume === "fursuit") return [];
  const size = p.build.size;
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size);
  const k = marksOf(p);
  const surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const outer = boundOf(net, h, size, (v) => net.role[v] !== roles.indexOf("eye"));
  let count = 0;
  const at: Lay = { net, roles, to };
  const lay: LayGear = (line, wide, worn) => {
    count += layLock(at, line, wide, worn);
  };
  const pane: LayPane = (outline, normal, worn) => {
    count += paneOf(at, outline, normal, worn);
  };
  const trim: Trim = { p, k, seat, surface, h, outer, lay, pane };
  layGlasses(trim);
  layEars(trim);
  layNose(trim);
  layNeck(trim);
  layHair(trim);
  return Array.from({ length: count }, () => 1);
}

/**
 * Where a mouth's corners go at rest: a short line up from each end of the shader's, each person's own, a little higher
 * on one side.
 */
export function cornersOf(w: Wearer, h: HeadFrame): readonly number[] {
  const { net, p, roles, cell } = w;
  if (p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const size = p.build.size;
  const { mouthWide: wide, bone: b } = p.face;
  const surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const lay: Lay = { net, roles, to: (q) => scale(add(h.c, scale(q, h.r)), size) };
  const taper = (s: number): number => mix(1, 0.3, s);
  return [-1, 1].flatMap((x) => {
    const lift = 0.02 + b.rest * 0.05 + x * b.askew * 0.6;
    const line = [0, 1, 2, 3].map((i): readonly [number, number] => [
      wide * mix(0.8, 0.98, i / 3),
      b.sto * b.L + lift * (i / 3) ** 2,
    ]);
    const depth = evened(line.map(([ax, y]) => surface(x * ax, y)));
    const crease = line.map(([ax, y], i): Vec => [x * ax, y, (depth[i] ?? 0) + 0.012]);
    const verts = layLock(lay, crease, [0.015, 0.008, 4], { role: "crease", fabric: FABRICS.hair, taper });
    return Array.from({ length: verts }, () => 1);
  });
}

/** A moustache lies on the skin as a brow does, so one clean shape follows the lip whatever the lip does. */
export function moustacheOf(w: Wearer, h: HeadFrame): readonly number[] {
  const { net, p, roles, cell } = w;
  if (p.face.hair !== "moustache" || p.outfit.costume === "fursuit") return [];
  const size = p.build.size;
  const { mouthWide: wide, bone: b } = p.face;
  const surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const line = [-3, -2, -1, 0, 1, 2, 3].map((i): readonly [number, number] => [
    (i / 3) * Math.max(wide * 1.08, 0.36),
    b.sub * b.L - 0.09 - 0.06 * (i / 3) ** 2,
  ]);
  const depth = evened(line.map(([x, y]) => surface(x, y)));
  const lay: Lay = { net, roles, to: (q) => scale(add(h.c, scale(q, h.r)), size) };
  const taper = (s: number): number => mix(0.45, 1, Math.sin(s * Math.PI));
  const lip = line.map(([x, y], i): Vec => [x, y, (depth[i] ?? 0) + 0.035]);
  const verts = layLock(lay, lip, [0.05, 0.03, 6], { role: "beard", fabric: FABRICS.hair, taper });
  return Array.from({ length: verts }, () => 1);
}

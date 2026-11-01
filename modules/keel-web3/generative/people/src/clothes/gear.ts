// Gear: glasses, earrings, chains, clips, the fronts of jackets and polos, and the hat's crown and bill.

import { FAR, FRONT, SIDE, TAU, UP, add, clamp, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Gear, Hat, Person } from "../body/person.js";
import { restSkeleton } from "../motion/skeleton.js";
import { CROWN_RISE } from "../head/head.js";
import type { HeadFrame } from "../head/head.js";
import { HEAD, boneIndex } from "../body/bones.js";
import type { Net } from "../body/field.js";
import { headNormals, smoothedFar } from "../head/wrap.js";
import { NO_EDGE } from "../body/cage.js";
import { FABRICS, hatCloth, topCloth } from "./fabric.js";
import { WRAPPED } from "./cloth.js";
import { FAR_HAIR, bearingOf, boundOf, layLock } from "../head/hair.js";
import type { Bound, Seat } from "../head/hair.js";
import { evened, marksOf, smooth, surfaceOf, vecAt } from "../head/paint.js";
import type { Marks } from "../head/paint.js";

/** Whatever lays one piece of what a person wears, in head radii. */
type LayGear = (line: readonly Vec[], size: readonly [number, number, number], worn: { readonly up?: Vec; readonly role: string; readonly fabric: number; readonly bone?: number; readonly taper?: (s: number) => number }) => void;
/** Whatever fills a flat shape, seen from both sides. */
type LayPane = (outline: readonly Vec[], normal: Vec, worn: { readonly role: string; readonly fabric: number }) => void;

const METAL = { role: "metal", fabric: FABRICS.latex }, FRAME = { role: "dark", fabric: FABRICS.latex }, LENS = { role: "lens", fabric: FABRICS.latex }, CLIP = { role: "clip", fabric: FABRICS.satin };
const bead = (s: number): number => Math.sqrt(Math.max(0.02, 1 - (2 * s - 1) ** 2));

/** A closed line round a middle, however it is bent. */
const ringOf = (count: number, at: (c: number, s: number) => Vec): readonly Vec[] => Array.from({ length: count + 1 }, (_, i) => at(Math.cos((i / count) * TAU), Math.sin((i / count) * TAU)));

/** What each kind of frame is: how wide its lens is against the eye, how tall against its width, how square, how thick its rim, and whether it is wire. */
const FRAMES: Readonly<Record<Exclude<Gear["glasses"], "none">, { readonly wide: number; readonly tall: number; readonly square: number; readonly rim: readonly [number, number]; readonly wire: boolean; readonly flick: number }>> = {
  clear: { wide: 1.75, tall: 0.74, square: 0.62, rim: [0.024, 0.018], wire: false, flick: 0 },
  round: { wide: 1.6, tall: 1, square: 1, rim: [0.014, 0.012], wire: true, flick: 0 },
  cat: { wide: 1.8, tall: 0.68, square: 0.7, rim: [0.028, 0.02], wire: false, flick: 0.09 },
  sun: { wide: 1.95, tall: 0.82, square: 0.72, rim: [0.028, 0.022], wire: false, flick: 0 },
};

/** How far each lens is turned back from the face's plane, a slope. */
const FRAME_WRAP = 0.1;

/** A pair of glasses, as one rigid thing. A lens is a flat shape; `x` says which side. */
interface Frame { readonly rx: number; readonly ry: number; readonly front: number; readonly centre: (x: number) => Vec; readonly rim: (x: number, c: number, s: number) => Vec; readonly facing: (x: number) => Vec }

/** Where a pair of glasses sits: lenses square on each eye, as close as the brow, the cheek and the lashes allow, and the bridge down on the nose. */
function frameOn(kind: Exclude<Gear["glasses"], "none">, p: Person, k: Marks, surface: (x: number, y: number) => number): Frame {
  const f = FRAMES[kind], rx = Math.min(p.face.eye * f.wide, k.eyeX - 0.06), ry = rx * f.tall, y = k.pupil - 0.01;
  const clear = [-1, 1].flatMap((x) => [-0.8, 0, 0.8].flatMap((c) => [-0.8, 0, 0.8].map((v) => surface(x * k.eyeX + rx * c, y + ry * v) + (x * k.eyeX * c > 0 ? FRAME_WRAP * rx * Math.abs(c) : 0))));
  const front = Math.max(...clear, surface(0, y) + 0.01) + 0.015, shape = (v: number): number => Math.sign(v) * Math.abs(v) ** f.square;
  const rim = (x: number, c: number, s: number): Vec => {
    const u = rx * shape(c), v = ry * shape(s) + f.flick * Math.max(0, c * x * s) ** 2;
    return [x * k.eyeX + u, y + v, front - FRAME_WRAP * Math.abs(u) * Math.sign(u * x)];
  };
  return { rx, ry, front, centre: (x) => [x * k.eyeX, y, front], rim, facing: (x) => unit([x * FRAME_WRAP, 0, 1], FRONT) };
}

/** An arm of a pair of glasses: straight back from its hinge, clear of the skin, over the top of the ear and hooked down behind it. */
function templeArm(seat: Seat, hinge: Vec, side: number): readonly Vec[] {
  const top = seat.tops[side], end: Vec = top ? add(top, [0, 0.03, 0]) : [hinge[0], hinge[1], -0.2];
  const wide = (q: Vec): Vec => { const d = unit(q, SIDE), need = seat.skin.far(d) + 0.02, far = Math.hypot(...q); return far < need ? scale(d, need) : q; };
  const along = [0.25, 0.5, 0.75, 1].map((t) => wide(lerpV(hinge, end, t)));
  const hook = top ? [[0.1, -0.05], [0.18, -0.13], [0.22, -0.23]].map(([back = 0, down = 0]) => wide(add(end, [0, down, -back]))) : [];
  return [hinge, ...along, ...hook];
}

/** Glasses: a flat lens in a rim on each eye, a bridge between them, a hinge at each outer corner and an arm back to each ear. */
function layGlasses(lay: LayGear, pane: LayPane, p: Person, k: Marks, seat: Seat, surface: (x: number, y: number) => number): void {
  const kind = p.gear.glasses;
  if (kind === "none") return;
  const f = FRAMES[kind], frame = frameOn(kind, p, k, surface), stuff = f.wire ? METAL : FRAME;
  [-1, 1].forEach((x, side) => {
    const round = ringOf(32, (c, s) => frame.rim(x, c, s));
    lay(round, [f.rim[0], f.rim[1], 6], { ...stuff, up: frame.facing(x) });
    if (kind === "sun") pane(round, frame.facing(x), LENS);
    const edge = frame.rim(x, x, 0.45), hinge: Vec = [edge[0] + x * 0.03, edge[1], edge[2] - 0.05];
    lay([edge, lerpV(edge, hinge, 0.5), hinge], [f.rim[0] * 0.9, f.rim[1], 4], { ...stuff, up: UP });
    lay(templeArm(seat, hinge, side), [f.wire ? 0.012 : 0.02, f.wire ? 0.01 : 0.01, 4], { ...stuff, up: [x, 0, 0] });
  });
  const inner = (x: number): Vec => frame.rim(x, -x, 0.42), a = inner(-1), b = inner(1), lift = frame.ry * 0.16;
  lay([a, add(lerpV(a, b, 0.3), [0, lift, 0]), add(lerpV(a, b, 0.7), [0, lift, 0]), b], [f.rim[0], f.rim[1], 4], { ...stuff, up: FRONT });
}

/** Earrings, hanging from lobes that are really there. */
function layEars(lay: LayGear, p: Person, seat: Seat): void {
  const kind = p.gear.ears;
  if (kind === "none") return;
  [-1, 1].forEach((x, side) => {
    const lobe = seat.lobes[side];
    if (!lobe) return;
    if (kind === "stud") lay([lobe, add(lobe, [x * 0.02, 0, 0.01]), add(lobe, [x * 0.04, 0, 0.02])], [0.026, 0.026, 6], { ...METAL, taper: bead });
    if (kind === "hoop") lay(ringOf(14, (c, s) => [lobe[0] + x * 0.01, lobe[1] - 0.11 + 0.11 * s, lobe[2] + 0.11 * c]), [0.011, 0.011, 4], METAL);
    if (kind === "drop") { lay([lobe, add(lobe, [0, -0.14, 0])], [0.007, 0.007, 4], METAL); lay([add(lobe, [0, -0.14, 0]), add(lobe, [0, -0.2, 0]), add(lobe, [0, -0.26, 0])], [0.036, 0.036, 6], { ...METAL, taper: bead }); }
  });
}

/** A stud in the wing of the nose, or a ring through its middle. */
function layNose(lay: LayGear, p: Person, k: Marks, surface: (x: number, y: number) => number): void {
  const side = p.seed % 2 === 0 ? -1 : 1, z = surface(side * 0.16, k.sn + 0.08);
  if (p.gear.nose === "stud") lay([[side * 0.16, k.sn + 0.08, z], [side * 0.17, k.sn + 0.08, z + 0.02], [side * 0.18, k.sn + 0.08, z + 0.04]], [0.02, 0.02, 6], { ...METAL, taper: bead });
  if (p.gear.nose === "ring") lay(ringOf(10, (c, s) => [0.05 * c, k.sn - 0.03 + 0.05 * s, surface(0, k.sn) - 0.02]), [0.008, 0.008, 4], METAL);
}

/** A chain round the neck, lying on what they wear, and what hangs from it. */
function layNeck(lay: LayGear, p: Person, h: HeadFrame): void {
  if (p.gear.neck === "none" || !["tee", "tank", "dress", "swimsuit", "bikini", "bare"].includes(p.outfit.top)) return;
  const s = restSkeleton(p), head = (at: Vec): Vec => scale(sub(at, h.c), 1 / h.r), base = head(lerpV(s.neck, s.chest, 0.3)), chest = { ...METAL, bone: boneIndex("chest") };
  lay(ringOf(26, (c, si) => [base[0] + 0.86 * si, base[1] - 0.42 * ((c + 1) / 2) ** 2, base[2] + 0.1 + 0.62 * c]), [0.012, 0.01, 4], chest);
  const low = add(base, [0, -0.42, 0.74]);
  if (p.gear.neck === "pendant") lay([low, add(low, [0, -0.07, 0.01]), add(low, [0, -0.14, 0])], [0.05, 0.03, 6], { ...chest, taper: bead });
}

/** A direction `along` from one ear over the top to the other, leaning `fore` forward. */
const overHead = (along: number, fore: number): Vec => unit([Math.sin(along), Math.cos(along), fore], UP);

/** An arc over a head from ear to ear, lying on its boundary. */
const arcOver = (outer: Bound, fore: number, half: number, lift: number): readonly Vec[] => Array.from({ length: 21 }, (_, i) => outer.on(overHead(half * (i / 10 - 1), fore), lift));

/** Clips along the side of the hair, each lying on it. */
function layClips(lay: LayGear, outer: Bound, side: number, places: readonly number[]): void {
  for (const at of places) lay([0.42, 0.36, 0.3].map((fore, i) => outer.on(overHead(side * (at + i * 0.03), fore), 0.012)), [0.045, 0.016, 4], CLIP);
}

/** What is in the hair, a clip or a row of them, a bow, a band, and headphones over all of it: all of it lying on what is there. */
function layHair(lay: LayGear, p: Person, outer: Bound): void {
  const kind = p.gear.hair, side = p.seed % 2 === 0 ? -1 : 1;
  if (p.hair !== "bald") {
    if (kind === "band") lay(arcOver(outer, 0.2, 1.45, 0.008), [0.07, 0.022, 4], CLIP);
    if (kind === "clip" || kind === "clips") layClips(lay, outer, side, kind === "clip" ? [0.8] : [0.62, 0.8, 0.98]);
    if (kind === "bow") {
      const at = outer.on(overHead(side * 0.8, 0.4), 0.02);
      lay([add(at, [-0.2, 0.05, 0]), at, add(at, [0.2, 0.05, 0])], [0.1, 0.02, 4], { ...CLIP, taper: (s) => 0.35 + 1.3 * Math.abs(s - 0.5) });
    }
  }
  if (!p.gear.phones) return;
  lay(arcOver(outer, 0, 1.38, 0.016), [0.06, 0.026, 4], FRAME);
  for (const x of [-1, 1]) { const at = outer.on(unit([x, 0, -0.12], SIDE)), d = unit(at, SIDE); lay([at, madd(at, d, 0.06), madd(at, d, 0.13)], [0.27, 0.27, 12], { ...FRAME, taper: bead }); }
}

/** A flat shape filled in, a sheet each way so it shows from either side. */
function paneOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, outline: readonly Vec[], normal: Vec, worn: { readonly role: string; readonly fabric: number }): number {
  const role = Math.max(0, roles.indexOf(worn.role)), count = outline.length, middle = scale(outline.reduce(add, [0, 0, 0]), 1 / count), base = net.position.length / 3;
  for (const facing of [1, -1]) for (const q of [middle, ...outline]) {
    net.position.push(...to(q)); net.normal.push(...scale(normal, facing)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(worn.fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(0, 0, 0, 1);
  }
  const back = base + count + 1;
  for (let i = 0; i < count; i += 1) { const a = i + 1, b = (i + 1) % count + 1; net.index.push(base, base + a, base + b, back, back + b, back + a); }
  return (count + 1) * 2;
}

/** The front of what a body has on: how far forward it lies at any `x`, `y`, and the vertex there, from which a thing laid on it takes its bones. */
interface Front { readonly z: (x: number, y: number) => number; readonly near: (x: number, y: number) => number }

/** The boundary of a person's front, over the vertices `keep` takes, as a head has its own. */
function frontBound(net: Net, keep: (v: number) => boolean, step: number): Front {
  const depth = new Map<number, number>(), owner = new Map<number, number>(), key = (i: number, j: number): number => i * 8192 + j, cellOf = (v: number): number => Math.round(v / step);
  const fill = (a: number, b: number, c: number): void => {
    const [ax, ay, az] = vecAt(net.position, a), [bx, by, bz] = vecAt(net.position, b), [cx, cy, cz] = vecAt(net.position, c), area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return;
    for (let i = cellOf(Math.min(ax, bx, cx)); i <= cellOf(Math.max(ax, bx, cx)); i += 1) for (let j = cellOf(Math.min(ay, by, cy)); j <= cellOf(Math.max(ay, by, cy)); j += 1) {
      const x = i * step, y = j * step, w = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area, u = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area, v = 1 - w - u;
      if (w < -0.05 || u < -0.05 || v < -0.05) continue;
      const z = w * az + u * bz + v * cz, k = key(i, j);
      if (z > (depth.get(k) ?? -FAR)) { depth.set(k, z); owner.set(k, a); }
    }
  };
  for (let i = 0; i < net.index.length; i += 3) { const a = net.index[i] ?? 0, b = net.index[i + 1] ?? 0, c = net.index[i + 2] ?? 0; if (keep(a) && keep(b) && keep(c)) fill(a, b, c); }
  const at = <T>(map: ReadonlyMap<number, T>, x: number, y: number, or: T): T => map.get(key(cellOf(x), cellOf(y))) ?? map.get(key(cellOf(x) + 1, cellOf(y))) ?? map.get(key(cellOf(x) - 1, cellOf(y))) ?? map.get(key(cellOf(x), cellOf(y) - 1)) ?? or;
  return { near: (x, y) => at(owner, x, y, -1), z: (x, y) => at(depth, x, y, 0) };
}

/** A sheet laid on a person's front: `at` says where each corner of a grid goes, and each vertex rides the bones of what is under it. */
function drape(net: Net, front: Front, rows: number, cols: number, at: (t: number, u: number) => readonly [number, number], lift: number, role: number, fabric: number): number {
  const from = net.position.length / 3, point = (r: number, c: number): Vec => { const [x, y] = at(r / rows, c / cols); return [x, y, front.z(x, y) + lift]; };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c <= cols; c += 1) {
    const q = point(r, c), n = unit(cross(sub(point(r, Math.min(cols, c + 1)), point(r, Math.max(0, c - 1))), sub(point(Math.max(0, r - 1), c), point(Math.min(rows, r + 1), c))), FRONT), under = Math.max(0, front.near(q[0], q[1]));
    net.position.push(...q); net.normal.push(...n); net.role.push(role); net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0); net.weight.push(net.weight[under] ?? 1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(q[0], q[2], q[1], NO_EDGE);
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; net.index.push(a, d, e, a, e, b); }
  return (rows + 1) * (cols + 1);
}

/** A jacket's open front, near to: a shirt in the V of it, lapels turned back along each edge, a formal one's tie, and the buttons below. */
export function jacketFront(net: Net, p: Person, roles: readonly string[], cell: number): readonly number[] {
  const { top, costume } = p.outfit;
  if ((top !== "jacket" && top !== "blazer") || costume === "firefighter" || cell >= WRAPPED) return [];
  const size = p.build.size, s = restSkeleton(p), topRole = roles.indexOf("top"), high = (s.neck[1] - 0.03) * size, low = (s.waist[1] + 0.05) * size, mid = s.chest[2] * size;
  const cloth = topCloth(p), front = frontBound(net, (v) => net.fabric[v] === cloth && (net.position[v * 3 + 2] ?? 0) > mid, 0.01 * size);
  const crest = Array.from({ length: 12 }, (_, i) => high + (i - 4) * 0.008 * size).reduce((best, at) => (front.near(0, at) >= 0 ? at : best), low);
  const open = (t: number): number => (0.006 + t * 0.05) * size, y = (t: number): number => mix(low, crest, t);
  let count = drape(net, front, 12, 6, (t, u) => [mix(-open(t), open(t), u), y(t)], 0.006 * size, roles.indexOf("shirt"), FABRICS.cotton);
  for (const x of [-1, 1]) count += drape(net, front, 12, 3, (t, u) => { const wide = (0.012 + 0.04 * Math.sin(t * Math.PI * 0.92)) * size; return [x * (open(t) + u * wide - 0.003 * size), y(t)]; }, 0.009 * size, topRole, cloth);
  if (top === "blazer") count += drape(net, front, 10, 3, (t, u) => { const wide = mix(0.016, 0.008, t) * size; return [mix(-wide, wide, u), y(mix(0.08, 0.98, t))]; }, 0.01 * size, roles.indexOf("dark"), FABRICS.satin);
  count += drape(net, front, 5, 1, (t, u) => [(u - 0.5) * 0.004 * size, mix(y(0) - 0.16 * size, y(0), t)], 0.008 * size, roles.indexOf("dark"), FABRICS.cotton);
  return Array.from({ length: count }, () => 0.88);
}

/** How high a top reaches at each bearing round a point: its neckline, as an elevation, smoothed. */
function necklineOf(net: Net, c: Vec, size: number, keep: (v: number) => boolean): Float64Array {
  const around = 36, rim = new Float64Array(around).fill(-Math.PI / 2);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = sub(scale(vecAt(net.position, v), 1 / size), c), a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * around) % around;
    rim[a] = Math.max(rim[a] ?? 0, Math.asin(clamp(q[1] / (Math.hypot(...q) || 1), -1, 1)));
  }
  for (let pass = 0; pass < 3; pass += 1) { const was = rim.slice(); for (let a = 0; a < around; a += 1) rim[a] = ((was[(a + around - 1) % around] ?? 0) + (was[a] ?? 0) * 2 + (was[(a + 1) % around] ?? 0)) / 4; }
  return rim;
}

/** A polo's collar, near to: one strip from the neckline round the back of the neck and down to two points at the front, and the short placket under them. */
export function poloFront(net: Net, p: Person, roles: readonly string[], cell: number): readonly number[] {
  if (p.outfit.top !== "polo" || cell >= WRAPPED) return [];
  const size = p.build.size, s = restSkeleton(p), cloth = topCloth(p), mid = s.chest[2] * size, topRole = roles.indexOf("top"), hi = s.chest[1] * size;
  const worn = (v: number): boolean => net.fabric[v] === cloth && net.bones[v * 2] !== HEAD && (net.position[v * 3 + 1] ?? 0) > hi;
  const c: Vec = [0, s.neck[1] - 0.05, s.neck[2]], r = 0.07, bound = boundOf(net, { c, r }, size, worn), rim = necklineOf(net, c, size, worn), rows = 5, cols = 56, from = net.position.length / 3, front = frontBound(net, (v) => worn(v) && (net.position[v * 3 + 2] ?? 0) > mid, 0.008 * size);
  const rimAt = (az: number): number => { const a = (az / TAU) * rim.length - 0.5, a0 = Math.floor(a), at = (i: number): number => rim[(i + rim.length) % rim.length] ?? 0; return mix(at(a0), at(a0 + 1), a - a0); };
  const pointAt = (t: number, u: number): Vec => {
    const open = mix(0.2, 0.62, t), az = mix(open, TAU - open, u), fore = (1 + Math.cos(az)) / 2, el = rimAt(az) + 0.12 - t * mix(0.2, 0.6, fore * fore), d = bearingOf(az, el);
    return add(c, scale(d, r * (bound.far(d) + mix(0.18, 0.11, t))));
  };
  for (let t = 0; t <= rows; t += 1) for (let u = 0; u <= cols; u += 1) {
    const q = pointAt(t / rows, u / cols), at = scale(q, size), n = unit(sub(q, c), FRONT), under = Math.max(0, front.near(at[0], at[1]));
    net.position.push(...at); net.normal.push(...n); net.role.push(topRole); net.bones.push(net.bones[under * 2] ?? 0, net.bones[under * 2 + 1] ?? 0); net.weight.push(net.weight[under] ?? 1); net.fabric.push(cloth); net.loose.push(0); net.soft.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE);
  }
  for (let t = 0; t < rows; t += 1) for (let u = 0; u < cols; u += 1) { const a = from + t * (cols + 1) + u, b = a + 1, d = a + cols + 1, e = d + 1; net.index.push(a, d, e, a, e, b); }
  const placket = drape(net, front, 3, 1, (t, u) => [(u - 0.5) * 0.022 * size, mix(s.chest[1] + 0.03, s.neck[1] - 0.04, t) * size], 0.003 * size, topRole, cloth);
  return [...Array.from({ length: (rows + 1) * (cols + 1) }, () => 0.8), ...Array.from({ length: placket }, () => 0.85)];
}

/** How far from a head's centre a crown goes to clear its hair, in head radii. */
const CROWN_REACH = 1.6;

/** The hats whose crown is built over what is under it. The rest are their own shape. */
const FITTED_HATS: ReadonlySet<Hat> = new Set<Hat>(["cap", "beanie", "pompom", "bucket", "flatcap", "bandana", "hardhat", "helmet", "fedora", "stetson", "bowler", "peaked", "sunhat", "headwrap", "visor", "beret"]);

/** Whether a person's hat is near enough to be built over their head. */
export const fitsHat = (p: Person, cell: number): boolean => cell < WRAPPED && FITTED_HATS.has(p.outfit.hat) && p.outfit.costume !== "fursuit";

/** How far out a boundary reaches anywhere near a direction: what a crown has to clear, for it cannot follow every lock. */
function highestNear(bound: Bound, dir: Vec): number {
  const reach = [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14], [0.24, 0], [-0.24, 0], [0, 0.24]] as const;
  return Math.max(...reach.map(([a, b]) => bound.far(unit(add(dir, [a, b, a - b]), UP))));
}

/** Where a crown's hem lies at each bearing: level round the head and only a little lower behind, as a hat sits. A helmet and a tied scarf come down the neck. */
const crownHem = (hat: Hat, az: number): number => mix(0.5, hat === "helmet" || hat === "bandana" ? 0.24 : 0.42, (1 - Math.cos(az)) / 2);

const BERET_SLUMP = unit([0.72, 0.66, -0.2], UP);

/** How far a hat's bill reaches past its hem, in head radii. */
export const BILLS: Partial<Record<Hat, number>> = {
  cap: 0.74, peaked: 0.56, flatcap: 0.44, hardhat: 0.46, visor: 0.7,
};

/** A bill: one thin curved sheet out of the crown's hem across the brow, its sides falling away and its edge rounded. Returns how many vertices it took. */
function billOn(net: Net, role: number, fabric: number, to: (q: Vec) => Vec, hat: Hat, hemAt: (az: number) => Vec): number {
  const reach = BILLS[hat] ?? 0, rows = 7, side = 16, cols = (side + 1) * 2, wide = 1.1, from = net.position.length / 3;
  if (reach <= 0) return 0;
  const at = (s: number, u: number, under: boolean): Vec => {
    const [x, y, z] = hemAt(u * wide), long = s * Math.sqrt(1 - u * u), fall = (0.14 + 0.2 * u * u) * long;
    return [x, y - fall - (under ? 0.04 * (1 - s ** 4) : 0), z + reach * long];
  };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const under = c > side, u = under ? -1 + (2 * (c - side - 1)) / side : 1 - (2 * c) / side, q = to(at(r / rows, u, under));
    net.position.push(...q); net.normal.push(0, under ? -1 : 1, 0); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(q[0], q[2], q[1], NO_EDGE);
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * cols + c, b = from + r * cols + (c + 1) % cols, d = a + cols, e = b + cols; net.index.push(a, b, e, a, e, d); }
  headNormals(net, from, rows + 1, cols);
  return (rows + 1) * cols;
}

/** Hair that a crown cannot clear goes under it: `over` says how far out the crown lies along a direction. */
function tuckedHair(net: Net, roles: readonly string[], h: HeadFrame, size: number, over: (d: Vec) => number): void {
  const hair = roles.indexOf("hair");
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (net.role[v] !== hair || net.bones[v * 2] !== HEAD) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r), far = Math.hypot(...q), d = unit(q, UP), most = over(d) - 0.03;
    if (far <= most) continue;
    const at = scale(add(h.c, scale(d, most * h.r)), size);
    net.position[v * 3] = at[0]; net.position[v * 3 + 1] = at[1]; net.position[v * 3 + 2] = at[2];
  }
}

/** How far out a crown lies along `d`, from what it must clear: under hair the skull has no skin to read, so its reach is held to a head's. */
function crownFar(skin: number, hair: number, d: Vec, hat: Hat): number {
  const ridge = hat === "hardhat" ? 0.035 * smooth(0.3, 0.12, Math.abs(d[0])) * smooth(0.4, 0.7, d[1]) : 0;
  // (A beret slumps to one side.)
  const slump = hat === "beret" ? 0.2 * smooth(0.3, 1, dot(d, BERET_SLUMP)) : 0;
  return Math.max(skin + 0.05 * smooth(0.5, 1, d[1]), Math.min(hair + 0.05, CROWN_REACH)) + (CROWN_RISE[hat] ?? 0) * smooth(0.3, 1, d[1]) + ridge + slump;
}

/** A crown, built over the head and the hair really under it: the hem level round the brow and lower behind, the top only as much taller as the hat is. */
export function crownOver(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame, seat: Seat): readonly number[] {
  if (!fitsHat(p, cell)) return [];
  const size = p.build.size, hat = p.outfit.hat, trim = roles.indexOf("trim"), under = boundOf(net, h, size, (v) => net.role[v] !== trim);
  const rows = 14, cols = 64, clear = hat === "helmet" || hat === "hardhat" ? 0.09 : 0.035, far = new Float64Array((rows + 1) * cols);
  const dirOf = (r: number, c: number): Vec => { const az = (c / cols) * TAU; const hem = crownHem(hat, az); return bearingOf(az, mix(hem, hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02, (r / rows) ** 0.8)); };
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const d = dirOf(r, c), skin = seat.skin.far(d) + clear;
    far[r * cols + c] = crownFar(skin, highestNear(under, d), d, hat);
  }
  smoothedFar(far, rows + 1, cols, 7);
  far.forEach((was, i) => { far[i] = Math.max(was, Math.min(under.far(dirOf(Math.floor(i / cols), i % cols)) + 0.02, CROWN_REACH + 0.1)); });
  smoothedFar(far, rows + 1, cols, 1);
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), from = net.position.length / 3, role = Math.max(0, roles.indexOf("trim")), fabric = hatCloth(hat);
  for (let r = -1; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const d = dirOf(Math.max(0, r), c), at = to(scale(d, (far[Math.max(0, r) * cols + c] ?? 1) - (r < 0 ? 0.05 : 0)));
    net.position.push(...at); net.normal.push(...d); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(fabric); net.loose.push(0); net.soft.push(0); net.cloth.push(at[0], at[2], at[1], NO_EDGE);
  }
  for (let r = 0; r <= rows; r += 1) for (let c = 0; c < cols; c += 1) { const a = from + r * cols + c, b = from + r * cols + (c + 1) % cols, d = a + cols, e = b + cols; net.index.push(a, b, e, a, e, d); }
  headNormals(net, from, rows + 2, cols);
  tuckedHair(net, roles, h, size, (d) => { const az = (Math.atan2(d[0], d[2]) + TAU) % TAU, el = Math.asin(clamp(d[1], -1, 1)), hem = crownHem(hat, az), top = hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02, t = (el - hem) / (top - hem); return t < 0 || t > 1 ? FAR : (far[Math.round(t ** 1.25 * rows) * cols + Math.round((az / TAU) * cols) % cols] ?? FAR); });
  const hemAt = (az: number): Vec => { const turn = ((az / TAU + 1) % 1) * cols, c = Math.floor(turn), d = bearingOf(az, crownHem(hat, az)); return scale(d, mix(far[c % cols] ?? 1, far[(c + 1) % cols] ?? 1, turn - c) - 0.04); };
  const bill = billOn(net, role, fabric, to, hat, hemAt);
  return Array.from({ length: (rows + 2) * cols + bill }, () => 1);
}

/** Everything small a person wears, near enough to see it. */
export function gearOn(net: Net, p: Person, roles: readonly string[], cell: number, h: HeadFrame, seat: Seat): readonly number[] {
  if (cell >= WRAPPED || p.outfit.costume === "fursuit") return [];
  const size = p.build.size, to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), k = marksOf(p), surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const outer = boundOf(net, h, size, (v) => net.role[v] !== roles.indexOf("eye"));
  let count = 0;
  const lay: LayGear = (line, wide, worn) => { count += layLock(net, roles, to, line, wide, worn); };
  const pane: LayPane = (outline, normal, worn) => { count += paneOf(net, roles, to, outline, normal, worn); };
  layGlasses(lay, pane, p, k, seat, surface);
  layEars(lay, p, seat);
  layNose(lay, p, k, surface);
  layNeck(lay, p, h);
  layHair(lay, p, outer);
  return Array.from({ length: count }, () => 1);
}

/** Where a mouth's corners go at rest: a short line up from each end of the shader's, each person's own, a little higher on one side. */
export function cornersOf(
  net: Net,
  p: Person,
  roles: readonly string[],
  cell: number,
  h: HeadFrame,
): readonly number[] {
  if (p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const size = p.build.size, { mouthWide: w, bone: b } = p.face, surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), taper = (s: number): number => mix(1, 0.3, s);
  return [-1, 1].flatMap((x) => {
    const lift = 0.02 + b.rest * 0.05 + x * b.askew * 0.6, line = [0, 1, 2, 3].map((i): readonly [number, number] => [w * mix(0.8, 0.98, i / 3), b.sto * b.L + lift * (i / 3) ** 2]);
    const depth = evened(line.map(([ax, y]) => surface(x * ax, y)));
    return Array.from({ length: layLock(net, roles, to, line.map(([ax, y], i) => [x * ax, y, (depth[i] ?? 0) + 0.012]), [0.015, 0.008, 4], { role: "crease", fabric: FABRICS.hair, taper }) }, () => 1);
  });
}

/** A moustache lies on the skin as a brow does, so one clean shape follows the lip whatever the lip does. */
export function moustacheOf(
  net: Net,
  p: Person,
  roles: readonly string[],
  cell: number,
  h: HeadFrame,
): readonly number[] {
  if (p.face.hair !== "moustache" || p.outfit.costume === "fursuit") return [];
  const size = p.build.size, { mouthWide: w, bone: b } = p.face, surface = surfaceOf(net, h, size, Math.max(0.07, ((cell * 0.5) / (h.r * size)) * 1.2));
  const line = [-3, -2, -1, 0, 1, 2, 3].map((i): readonly [number, number] => [(i / 3) * Math.max(w * 1.08, 0.36), b.sub * b.L - 0.09 - 0.06 * (i / 3) ** 2]);
  const depth = evened(line.map(([x, y]) => surface(x, y))), to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size);
  const taper = (s: number): number => mix(0.45, 1, Math.sin(s * Math.PI));
  return Array.from({ length: layLock(net, roles, to, line.map(([x, y], i) => [x, y, (depth[i] ?? 0) + 0.035]), [0.05, 0.03, 6], { role: "beard", fabric: FABRICS.hair, taper }) }, () => 1);
}

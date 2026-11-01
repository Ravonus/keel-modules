// Paths: walks round the trunk, flights out and back, climbs along the wood, and the map of the wood they follow.

import { TAU, UP, add, clamp, cross, dot, flat, length, lerpV, madd, mix, scale, smooth, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { createRandom } from "../roll.js";
import { bareY, groundY, perchOf, trunkAxis, trunkClear, trunkPoint, trunkR, trunkShare } from "./stage.js";
import type { Anchor, Place, Stage, Wood } from "./stage.js";

// ---------------------------------------------------------------- paths

export interface PathPoint { readonly p: Vec; readonly up: Vec }

/** Push a point on the ground out of the trunk's way. */
function clearOfTrunk(stage: Stage, p: Vec, size: number): Vec {
  const clear = trunkClear(stage, size);
  const d = Math.hypot(p[0], p[2]);
  if (d >= clear || d < 1e-6) return p;
  const k = clear / d;
  return [p[0] * k, groundY(stage, p[0] * k, p[2] * k), p[2] * k];
}

/**
 * Over the ground, round the trunk, and up and over the roots: the way
 * follows the ground's real height closely enough to find every root, and
 * where one crosses it the body rises before it and comes down after, in an
 * arc. A springy animal (`spring` near 1: a bird, a rabbit) hops it with room
 * to spare; a heavy one steps over.
 */
export function walkPath(a: Anchor, b: Anchor, stage: Stage, size: number, spring = 0): PathPoint[] {
  const span = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
  const steps = clamp(Math.ceil(span / Math.max(0.03, size * 0.2)), 8, 96);
  const points: Vec[] = [];
  const bare: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const q = clearOfTrunk(stage, lerpV(a.p, b.p, i / steps), size);
    points.push([q[0], groundY(stage, q[0], q[2]), q[2]]);
    bare.push(bareY(stage, q[0], q[2]));
  }
  const over = (i: number): number => (points[i]?.[1] ?? 0) - (bare[i] ?? 0);
  if (points.every((_, i) => over(i) < 0.004)) return points.map((p) => ({ p, up: UP }));
  const reach = size * (0.45 + spring * 0.5);
  const spare = size * spring * 0.3;
  const stride = span / steps;
  const lifted = points.map((p, i): Vec => {
    let y = p[1];
    for (let j = 0; j < points.length; j += 1) {
      const d = Math.abs(i - j) * stride;
      if (d >= reach || over(j) < 0.004) continue;
      y = Math.max(y, (bare[i] ?? 0) + (over(j) + spare) * (1 - (d / reach) ** 2));
    }
    return [p[0], y, p[2]];
  });
  return lifted.map((p) => ({ p, up: UP }));
}

/**
 * Which way a flight leaves one end (or comes into the other): toward the
 * far end when that is well off to the side, but out from the trunk when the
 * way is short or all but straight up, so a bird swings out and comes back
 * in instead of rising like a lift.
 */
function flightHeading(p: Vec, other: Vec, span: number, reach: number): Vec {
  const radial = unit([p[0], 0, p[2]], [0, 0, 1]);
  const way = unit([other[0] - p[0], 0, other[2] - p[2]], radial);
  return unit(lerpV(radial, way, clamp(span / (reach * 1.5), 0, 1)), radial);
}

/** A point on a Catmull-Rom curve through four points. */
function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, u: number): Vec {
  const u2 = u * u;
  const u3 = u2 * u;
  return [0, 1, 2].map((i) => {
    const [a, b, c, d] = [p0[i] ?? 0, p1[i] ?? 0, p2[i] ?? 0, p3[i] ?? 0];
    return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
  }) as unknown as Vec;
}

/** Out of the trunk's way, sideways, keeping its height. */
function roundTrunk(p: Vec, clear: number): Vec {
  const off = Math.hypot(p[0], p[2]);
  if (off >= clear) return p;
  const k = clear / Math.max(off, 1e-3);
  return off < 1e-3 ? [clear, p[1], 0] : [p[0] * k, p[1], p[2] * k];
}

/**
 * Out of the trunk's wood at its own height, following its spine, by
 * `margin` past the bark: a flight never passes through the trunk, though
 * at its ends (margin 0) it may come right onto the bark.
 */
function offTrunk(stage: Stage, p: Vec, margin: number): Vec {
  const trunk = stage.trunk;
  if (!trunk || p[1] > trunk.top[1] + margin) return p;
  const axis = trunkAxis(trunk, trunkShare(trunk, p[1]));
  const need = axis.r + margin;
  const dx = p[0] - axis.p[0];
  const dz = p[2] - axis.p[2];
  const d = Math.hypot(dx, dz);
  if (d >= need) return p;
  if (d < 1e-4) return [axis.p[0] + need, p[1], axis.p[2]];
  return [axis.p[0] + (dx / d) * need, p[1], axis.p[2] + (dz / d) * need];
}

/** How far a flier keeps off the bark `g` of the way along its flight: its own size and a little, fading to nothing at the ends. */
const barkRoom = (size: number, g: number): number => (size * 0.3 + 0.04) * smooth(clamp(Math.min(g, 1 - g) / 0.2, 0, 1));

/**
 * A flight as a bird flies one. A bird climbs or drops at a slant, never
 * straight up, so a way with more height in it than ground under it becomes
 * a loop: out from the tree, round, and back in. It springs off and climbs
 * out, crosses, and comes in on a long glide, from a little below a branch
 * to swoop up onto it, or from above the ground to drop onto it.
 */
export function flyPath(a: Anchor, b: Anchor, stage: Stage, size: number, onWood: boolean): PathPoint[] {
  const span = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
  const rise = b.p[1] - a.p[1];
  // (Climbing, at most about one up for two across, so even a big bird winds up to a high branch on a wide loop.)
  const needed = Math.abs(rise) * (rise > 0 ? 1.8 : 1.4) + 0.6;
  const loop = clamp((needed - span) / needed, 0, 1);
  const reach = Math.max(0.3, (needed - span) / 2.4);
  const out = flightHeading(a.p, b.p, span, reach);
  const into = scale(flightHeading(b.p, a.p, span, reach), -1);
  const turn = (Math.floor(Math.abs(a.p[0] + a.p[2]) * 7) % 2) * 2 - 1;
  const side: Vec = [out[2] * turn, 0, -out[0] * turn];
  const clear = trunkClear(stage, size) * 1.4;
  const climbed = madd(madd(a.p, out, reach * 0.8), side, reach * 0.45 * loop);
  // Into a branch from a little below it; onto the ground on a shallow glide from above.
  const drop = onWood ? -0.22 : 0.2 + Math.max(-rise, 0) * 0.1;
  const coming = madd(madd(b.p, into, -Math.max(reach * 0.8, onWood ? 0 : 0.3 + drop * 1.8)), side, -reach * 0.45 * loop);
  const leave = roundTrunk([climbed[0], a.p[1] + 0.15 + Math.max(rise, 0) * 0.55, climbed[2]], clear);
  const near = roundTrunk([coming[0], b.p[1] + drop, coming[2]], clear);
  const keys = [a.p, a.p, leave, near, b.p, b.p].map((p) => withinReach(stage, p));
  const legs = keys.length - 3;
  const points: PathPoint[] = [];
  for (let i = 0; i <= legs * 10; i += 1) {
    const leg = Math.min(legs - 1, Math.floor(i / 10));
    const p = catmull(keys[leg] ?? a.p, keys[leg + 1] ?? a.p, keys[leg + 2] ?? b.p, keys[leg + 3] ?? b.p, i / 10 - leg);
    // Never through the ground on the way, only off it and onto it at the ends.
    const g = i / (legs * 10);
    const lift = size * 0.3 * Math.min(1, g / 0.15, (1 - g) / 0.15);
    const q = offTrunk(stage, withinReach(stage, p), barkRoom(size, g));
    points.push({ p: [q[0], Math.max(q[1], bareY(stage, q[0], q[2]) + lift), q[2]], up: UP });
  }
  return points;
}

/** Held within a flier's circle round the tree (the crown's reach and a little), so a long climb to a high branch stays in the picture. */
function withinReach(stage: Stage, p: Vec): Vec {
  const crown = crownOf(stage);
  const cap = crown.reach + 2.6;
  const r = Math.hypot(p[0] - crown.c[0], p[2] - crown.c[2]);
  return r <= cap ? p : [crown.c[0] + ((p[0] - crown.c[0]) * cap) / r, p[1], crown.c[2] + ((p[2] - crown.c[2]) * cap) / r];
}

/**
 * A flight's shape beyond its two ends. A `sortie` is a bird's flight out
 * round the tree: past the crown to a circle of radius `R` about the trunk,
 * at height `h` (rising `climb` over it and coming down again, as a gull
 * rides a thermal), `laps` times round in `dir`, its circle wandering in and
 * out by `wobble`. A `flutter` is a butterfly's (or a firefly's) looping
 * way, kept under `ceiling` and within `reach` of the trunk.
 */
export type Loop =
  | { readonly kind: "sortie"; readonly R: number; readonly cap?: number; readonly h: number; readonly climb: number; readonly laps: number; readonly dir: number; readonly wobble: number; readonly seed: number; readonly start?: Vec }
  | { readonly kind: "flutter"; readonly seed: number; readonly loops: number; readonly ceiling: number; readonly reach: number };

/** How far out and how high the tree's crown reaches, about the trunk's foot: where a bird flies to be clear of it. */
export function crownOf(stage: Stage): { readonly reach: number; readonly top: number; readonly low: number; readonly c: Vec } {
  const c: Vec = stage.trunk?.base ?? [0, stage.top, 0];
  let reach = trunkR(stage) + 0.6;
  let top = stage.trunk?.top[1] ?? stage.top + 1.5;
  let low = Infinity;
  for (const perch of stage.perches ?? []) {
    reach = Math.max(reach, Math.hypot(perch.p[0] - c[0], perch.p[2] - c[2]));
    top = Math.max(top, perch.p[1]);
    low = Math.min(low, perch.p[1]);
  }
  return { reach, top, low: Number.isFinite(low) ? low : top, c };
}

/** Catmull-Rom through keys, ten points a span, kept off the ground and out of the trunk except where it starts and ends, and inside `out`'s bounds when given. */
function smoothWay(keys: readonly Vec[], stage: Stage, size: number, out?: (p: Vec) => Vec): PathPoint[] {
  const legs = keys.length - 3;
  const points: PathPoint[] = [];
  const first = keys[0] ?? [0, 0, 0];
  const last = keys[keys.length - 1] ?? first;
  for (let i = 0; i <= legs * 10; i += 1) {
    const leg = Math.min(legs - 1, Math.floor(i / 10));
    const p = catmull(keys[leg] ?? first, keys[leg + 1] ?? first, keys[leg + 2] ?? last, keys[leg + 3] ?? last, i / 10 - leg);
    const g = i / (legs * 10);
    const lift = size * 0.3 * Math.min(1, g / 0.08, (1 - g) / 0.08);
    const q = offTrunk(stage, out ? out(p) : p, barkRoom(size, g));
    points.push({ p: [q[0], Math.max(q[1], bareY(stage, q[0], q[2]) + lift), q[2]], up: UP });
  }
  return points;
}

/** Which way round a sortie goes and how far: its own way, its laps and on to where it comes in; going home, the short way. */
function sortieTurn(loop: Extract<Loop, { kind: "sortie" }>, from: number, to: number): { dir: number; sweep: number } {
  const wrap = (v: number): number => Math.atan2(Math.sin(v), Math.cos(v));
  if (loop.start) {
    const short = wrap(to - from);
    return { dir: short < 0 ? -1 : 1, sweep: Math.max(0.3, Math.abs(short)) };
  }
  const base = loop.laps * TAU;
  return { dir: loop.dir, sweep: Math.max(1.2, base + wrap(loop.dir * (to - from) - base)) };
}

/**
 * A sortie: it drops off its branch (or springs up off the ground) and
 * swings out from the tree, widens onto its circle round the crown, goes
 * round it at its own height and back in to land: from a little below a
 * branch to swoop up onto it, or from above the ground to drop onto it. The
 * circle ends where it comes in, so it turns home on its way round.
 */
export function sortiePath(a: Anchor, b: Anchor, stage: Stage, size: number, loop: Extract<Loop, { kind: "sortie" }>, fromWood: boolean, onWood: boolean): PathPoint[] {
  const c = stage.trunk?.base ?? [0, stage.top, 0];
  const outward = (p: Vec): Vec => unit([p[0] - c[0], 0, p[2] - c[2]], [1, 0, 0]);
  const clear = trunkClear(stage, size) * 1.4;
  // (Called home mid-flight, it sets off from where it is in the air.)
  const from = loop.start ?? a.p;
  const leave = loop.start ?? roundTrunk(add(madd(a.p, outward(a.p), 1.1 + size), [0, fromWood ? -0.3 : 0.7, 0]), clear);
  const near = roundTrunk(add(madd(b.p, outward(b.p), 1.2 + size), [0, onWood ? -0.3 : 0.6, 0]), clear);
  const angleOf = (p: Vec): number => Math.atan2(p[2] - c[2], p[0] - c[0]);
  const radiusOf = (p: Vec): number => Math.hypot(p[0] - c[0], p[2] - c[2]);
  const t0 = angleOf(leave);
  const { dir, sweep } = sortieTurn(loop, t0, angleOf(near));
  const steps = Math.max(3, Math.ceil(sweep / 0.6));
  const keys: Vec[] = loop.start ? [from, from] : [from, from, leave];
  for (let i = 1; i < steps; i += 1) {
    const s = i / steps;
    const angle = t0 + dir * sweep * s;
    const k = smooth(Math.min(1, (sweep * s) / 1.1, (sweep * (1 - s)) / 1.1));
    const end = s < 0.5 ? leave : near;
    const R = mix(radiusOf(end), Math.min(loop.cap ?? Infinity, loop.R * (1 + loop.wobble * Math.sin(angle * 2 + loop.seed * TAU))), k);
    const h = mix(end[1], loop.h + loop.climb * Math.sin(Math.PI * s) + 0.3 * Math.sin(angle * 3 + loop.seed * 9), k);
    keys.push([c[0] + Math.cos(angle) * R, h, c[2] + Math.sin(angle) * R]);
  }
  keys.push(near, b.p, b.p);
  // (The curve through the keys swings a little wide of them: held to the cap too, so it stays in the picture.)
  const cap = loop.cap;
  const inside = cap === undefined ? undefined : (p: Vec): Vec => {
    const r = radiusOf(p);
    return r <= cap ? p : [c[0] + ((p[0] - c[0]) * cap) / r, p[1], c[2] + ((p[2] - c[2]) * cap) / r];
  };
  return smoothWay(keys, stage, size, inside);
}

/**
 * A butterfly's way: a wandering line of seeded jinks to either side and up
 * and down, with a loop-the-loop now and then, kept low (under its
 * `ceiling`) and near the tree.
 */
export function flutterPath(a: Anchor, b: Anchor, stage: Stage, size: number, loop: Extract<Loop, { kind: "flutter" }>): PathPoint[] {
  const rand = createRandom(Math.floor(loop.seed * 4294967295) >>> 0);
  const c = stage.trunk?.base ?? [0, stage.top, 0];
  const way = sub(b.p, a.p);
  const fw = unit([way[0], 0, way[2]], [0, 0, 1]);
  const side = unit(cross(UP, fw), [1, 0, 0]);
  const n = clamp(Math.round(length(way) / 0.7), 1, 4);
  const keep = (p: Vec): Vec => {
    const off = Math.hypot(p[0] - c[0], p[2] - c[2]);
    const k = off > loop.reach ? loop.reach / off : 1;
    const x = c[0] + (p[0] - c[0]) * k;
    const z = c[2] + (p[2] - c[2]) * k;
    return [x, clamp(p[1], bareY(stage, x, z) + 0.05, Math.max(loop.ceiling, a.p[1], b.p[1])), z];
  };
  const keys: Vec[] = [a.p, a.p];
  for (let i = 1; i <= n; i += 1) {
    const u = i / (n + 1);
    const p = keep(madd(add(lerpV(a.p, b.p, u), [0, Math.sin(u * Math.PI) * 0.35 + (rand() - 0.5) * 0.4, 0]), side, (rand() - 0.5) * 1.1));
    keys.push(p);
    if (i === loop.loops) {
      const r = 0.22 + rand() * 0.22;
      const turn = rand() < 0.5 ? -1 : 1;
      for (const q of [0.25, 0.5, 0.75]) {
        const angle = q * TAU;
        keys.push(keep(add(madd(madd(p, side, turn * r * (1 - Math.cos(angle))), fw, r * Math.sin(angle)), [0, r * 0.5 * Math.sin(angle), 0])));
      }
      keys.push(p);
    }
  }
  keys.push(b.p, b.p);
  return smoothWay(keys, stage, size);
}

/** A flier's up as it banks into a turn: tipped toward the turn's middle by how hard it turns at its speed. */
export function bankedUp(before: Vec, after: Vec, ds: number, speed: number): Vec {
  const lean = scale(sub(flat(after), flat(before)), (speed * speed) / (4 * Math.max(ds, 1e-3)));
  const l = length(lean);
  return unit(add(UP, l > 1.1 ? scale(lean, 1.1 / l) : lean), UP);
}

/** The height on the trunk and the side of it a place is reached by. */
function trunkFoot(place: Place, a: Anchor, stage: Stage): { h: number; a: number } {
  if (place.on === "trunk") return { h: place.h, a: place.a };
  const trunk = stage.trunk;
  const side = Math.atan2(a.p[2], a.p[0]);
  if (!trunk || place.on === "ground") return { h: 0, a: side };
  return { h: trunkShare(trunk, a.p[1]), a: side };
}

/** A perch's branch as a climber walks it, from the trunk outward: on top of the wood, and where it leaves the trunk. */
export const inTrunk = (p: Vec, trunk: Stage["trunk"]): boolean => {
  if (!trunk) return false;
  const axis = trunkAxis(trunk, trunkShare(trunk, p[1]));
  return Math.hypot(p[0] - axis.p[0], p[2] - axis.p[2]) < axis.r;
};

/** A limb's top to its underside, by way of its flank. */
const ROUND_LIMB = [0, 0.8, 1.6, 2.4, Math.PI];

/**
 * Where a climber's feet go on a limb: its top, square to the limb and not
 * straight up, or a steep limb's "up" runs down its own middle and the climber
 * goes inside it. A limb that stands upright has no top: it goes round the side
 * away from the tree. Where the top is buried in the trunk, a limb hugging it
 * on the way up, the way turns round the limb to the face that isn't.
 */
function onTopOf(w: Wood, back: Wood, on: Wood, trunk: Stage["trunk"]): PathPoint {
  const along = unit(sub(on.p, back.p), UP);
  const square = (v: Vec): Vec => madd(v, along, -dot(v, along));
  const top = square(UP);
  const crown = unit(length(top) > 0.15 ? top : square([w.p[0], 0, w.p[2]]), UP);
  const flank = cross(along, crown);
  for (const turn of ROUND_LIMB) {
    const up = madd(scale(crown, Math.cos(turn)), flank, Math.sin(turn));
    const p = madd(w.p, up, w.r);
    if (!inTrunk(p, trunk)) return { p, up };
  }
  return { p: madd(w.p, crown, w.r), up: crown };
}

/** A limb starts inside the trunk: a point on that stretch comes out to the bark, or the way runs through the tree. */
function outOfTrunk(point: PathPoint, trunk: Stage["trunk"]): PathPoint {
  if (!trunk || !inTrunk(point.p, trunk)) return point;
  const axis = trunkAxis(trunk, trunkShare(trunk, point.p[1]));
  const side = unit([point.p[0] - axis.p[0], 0, point.p[2] - axis.p[2]], point.up);
  return { p: [axis.p[0] + side[0] * axis.r, point.p[1], axis.p[2] + side[2] * axis.r], up: side };
}

export function branchWay(place: Place, stage: Stage): { points: PathPoint[]; foot: { h: number; a: number }; wood: readonly Wood[] } | null {
  if (place.on !== "perch" || !stage.trunk) return null;
  const wood = perchOf(stage, place.i)?.path ?? [];
  const first = wood[0];
  const next = wood[1];
  if (!first || !next) return null;
  const a = Math.atan2(next.p[2] - first.p[2], next.p[0] - first.p[0]);
  const foot = { h: trunkShare(stage.trunk, first.p[1]), a };
  const points: PathPoint[] = [trunkPoint(stage, foot.h, a)];
  wood.slice(1).forEach((w, i) => { points.push(outOfTrunk(onTopOf(w, wood[i] ?? w, wood[i + 2] ?? w, stage.trunk), stage.trunk)); });
  return { points, foot, wood };
}

/**
 * The tree's wood as a map: every stretch of branch once, however many perches
 * run along it, known by its two ends, and filed in a grid of the air so a body
 * asks only about the wood around it. Built once for a frame's stage.
 */
export interface WoodMap { readonly edges: readonly WoodEdge[]; readonly cells: ReadonlyMap<number, readonly number[]>; readonly thickest: number }
export interface WoodEdge { readonly a: Wood; readonly b: Wood; readonly keys: readonly [string, string] }

const WOOD_CELL = 0.25;
const woodMaps = new WeakMap<Stage, WoodMap>();
export const woodKey = (w: Wood): string => `${Math.round(w.p[0] * 1e3)},${Math.round(w.p[1] * 1e3)},${Math.round(w.p[2] * 1e3)}`;
const cellOf = (v: number): number => Math.floor(v / WOOD_CELL) + 512;
const cellKey = (x: number, y: number, z: number): number => (x * 1024 + y) * 1024 + z;

/** Each grid cell between two corners. */
function cellsBetween(low: Vec, high: Vec, visit: (key: number) => void): void {
  for (let x = cellOf(low[0]); x <= cellOf(high[0]); x += 1) for (let y = cellOf(low[1]); y <= cellOf(high[1]); y += 1) for (let z = cellOf(low[2]); z <= cellOf(high[2]); z += 1) visit(cellKey(x, y, z));
}

const corner = (a: Vec, b: Vec, pick: (x: number, y: number) => number, by: number): Vec => [pick(a[0], b[0]) + by, pick(a[1], b[1]) + by, pick(a[2], b[2]) + by];

function fileEdge(cells: Map<number, number[]>, edge: WoodEdge, i: number): void {
  const pad = Math.max(edge.a.r, edge.b.r);
  cellsBetween(corner(edge.a.p, edge.b.p, Math.min, -pad), corner(edge.a.p, edge.b.p, Math.max, pad), (key) => {
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });
}

export function woodMapOf(stage: Stage): WoodMap {
  const known = woodMaps.get(stage);
  if (known) return known;
  const seen = new Set<string>();
  const edges: WoodEdge[] = [];
  for (const perch of stage.perches ?? []) for (const [k, b] of (perch.path ?? []).entries()) {
    const a = perch.path?.[k - 1];
    if (!a) continue;
    const keys = [woodKey(a), woodKey(b)] as const;
    if (seen.has(`${keys[0]}|${keys[1]}`)) continue;
    seen.add(`${keys[0]}|${keys[1]}`);
    edges.push({ a, b, keys });
  }
  const cells = new Map<number, number[]>();
  edges.forEach((edge, i) => { fileEdge(cells, edge, i); });
  const map = { edges, cells, thickest: edges.reduce((most, e) => Math.max(most, e.a.r, e.b.r), 0) };
  woodMaps.set(stage, map);
  return map;
}

/** The wood filed within `reach` of a point. */
export function woodNear(map: WoodMap, p: Vec, reach: number): WoodEdge[] {
  const found = new Set<number>();
  cellsBetween(sub(p, [reach, reach, reach]), add(p, [reach, reach, reach]), (key) => { for (const i of map.cells.get(key) ?? []) found.add(i); });
  return [...found].flatMap((i) => map.edges[i] ?? []);
}

const sameWood = (a: Wood | undefined, b: Wood | undefined): boolean => !!a && !!b && length(sub(a.p, b.p)) < 1e-4;

type BranchWay = NonNullable<ReturnType<typeof branchWay>>;

/** Two perches on the same limb: back along one to where they fork, then out the other. */
export function sameLimb(from: BranchWay | null, to: BranchWay | null): PathPoint[] | null {
  if (!from || !to) return null;
  let shared = 0;
  while (sameWood(from.wood[shared], to.wood[shared])) shared += 1;
  return shared >= 2 ? [...from.points.slice(shared - 1).reverse(), ...to.points.slice(shared)] : null;
}

/**
 * Over the ground to the trunk, up (or down) the trunk, out along the branch:
 * a climber's way between two places. It keeps to the wood: in along its own
 * branch, round and up the trunk to where the other branch leaves it, and out
 * along that one. Two perches on the same limb meet where their branches part.
 */
export function climbPath(from: Place, to: Place, a: Anchor, b: Anchor, stage: Stage, size: number): PathPoint[] {
  if (!stage.trunk || (from.on === "ground" && to.on === "ground")) return walkPath(a, b, stage, size, 0);
  const out: PathPoint[] = [{ p: a.p, up: a.up }];
  const fromWay = branchWay(from, stage);
  const toWay = branchWay(to, stage);
  const fork = sameLimb(fromWay, toWay);
  if (fork) return [...out, ...fork, { p: b.p, up: b.up }];
  if (fromWay) out.push(...[...fromWay.points].reverse());
  const f = fromWay?.foot ?? trunkFoot(from, a, stage);
  const t = toWay?.foot ?? trunkFoot(to, b, stage);
  const steps = Math.max(4, Math.ceil(Math.abs(t.h - f.h) * 14));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const point = trunkPoint(stage, mix(f.h, t.h, u), mix(f.a, t.a + Math.round((f.a - t.a) / TAU) * TAU, u));
    out.push({ p: point.p, up: point.up });
  }
  if (toWay) out.push(...toWay.points);
  out.push({ p: b.p, up: b.up });
  return out;
}

interface PathAt { readonly p: Vec; readonly fw: Vec; readonly up: Vec; readonly travelled: number }

/** The point a share `u` of the way along a path, its heading and its surface's up. */
export function alongPath(path: readonly PathPoint[], u: number): PathAt {
  const want = clamp(u, 0, 1) * pathLength(path);
  let a: PathPoint = path[0] ?? { p: [0, 0, 0], up: UP };
  let start = 0;
  for (let i = 1; i < path.length; i += 1) {
    const b = path[i] ?? a;
    const span = length(sub(b.p, a.p));
    if (start + span >= want || i === path.length - 1) {
      const k = clamp((want - start) / Math.max(1e-6, span), 0, 1);
      return { p: lerpV(a.p, b.p, k), fw: unit(sub(b.p, a.p), [0, 0, 1]), up: unit(lerpV(a.up, b.up, k), UP), travelled: want };
    }
    start += span;
    a = b;
  }
  return { p: a.p, fw: [0, 0, 1], up: a.up, travelled: 0 };
}

export const pathLength = (path: readonly PathPoint[]): number => {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += length(sub(path[i]?.p ?? UP, path[i - 1]?.p ?? UP));
  return total;
};

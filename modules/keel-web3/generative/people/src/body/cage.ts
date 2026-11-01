// The body's cage: torso stations, limb hoops and foot rings quadded, subdivided and shelled.

import { FRONT, SIDE, UP, add, clamp, cross, dot, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "./person.js";
import { limbWide } from "./build.js";
import { HIP_DROP, restSkeleton, spokeOf, torsoStations } from "../motion/skeleton.js";
import type { Arm, Leg, Station } from "../motion/skeleton.js";
import { BONE_COUNT, PELVIS, boneIndex } from "./bones.js";
import type { Net } from "./field.js";

// ---------------------------------------------------------------- the body's cage

/** One point of a cage: where it is, then how much each bone has of it, so subdividing carries both. */
export type Row = number[];
export interface Cage { readonly rows: Row[]; readonly quads: (readonly [number, number, number, number])[]; readonly tags: number[] }

/** Where on the body a quad is: a limb's kind, and how far along it the ring. */
export const TORSO = 0, ARM = 100, LEG = 200, FOOT = 300;
/** A vertex this far or further from any edge of what it is part of, in metres. */
export const NO_EDGE = 0.09;
const TOP_RING = 13;
/** The torso's rings the arm's opening is cut from, and how many spokes a torso has. */
export const ARMPIT = 8, SPOKES = 12;

export const rowOf = (at: Vec, weights: readonly (readonly [string, number])[]): Row => {
  const row: Row = [...at, ...new Array<number>(BONE_COUNT).fill(0)];
  for (const [bone, w] of weights) row[3 + boneIndex(bone)] = w;
  return row;
};
export const pointOf = (row: Row | undefined): Vec => [row?.[0] ?? 0, row?.[1] ?? 0, row?.[2] ?? 0];

/** A quad, wound to face away from `inside`. */
export function quad(cage: Cage, q: readonly [number, number, number, number], inside: Vec, tag: number): void {
  const [a, b, c, d] = q.map((i) => pointOf(cage.rows[i])) as unknown as readonly [Vec, Vec, Vec, Vec];
  const facing = cross(sub(c, a), sub(d, b));
  const out = sub(scale(add(add(a, b), add(c, d)), 0.25), inside);
  cage.quads.push(dot(facing, out) < 0 ? [q[3], q[2], q[1], q[0]] : q);
  cage.tags.push(tag);
}

/** The quads between two rings of the same size. */
function joined(cage: Cage, a: readonly number[], b: readonly number[], tag: number): void {
  const inside = scale([...a, ...b].reduce<Vec>((n, i) => add(n, pointOf(cage.rows[i])), [0, 0, 0]), 1 / (a.length + b.length));
  a.forEach((v, i) => {
    const j = (i + 1) % a.length;
    quad(cage, [v, a[j] ?? 0, b[j] ?? 0, b[i] ?? 0], inside, tag);
  });
}

/** An even ring closed over a point past its middle. */
function capped(cage: Cage, ring: readonly number[], tip: Vec, tag: number): void {
  const inside = scale(ring.reduce<Vec>((n, i) => add(n, pointOf(cage.rows[i])), [0, 0, 0]), 1 / ring.length);
  const row = rowOf(tip, []);
  (cage.rows[ring[0] ?? 0] ?? []).slice(3).forEach((w, i) => { row[3 + i] = w; });
  cage.rows.push(row);
  const pole = cage.rows.length - 1;
  for (let i = 0; i < ring.length; i += 2) quad(cage, [pole, ring[i] ?? 0, ring[i + 1] ?? 0, ring[(i + 2) % ring.length] ?? 0], inside, tag);
}



/** The torso: rings of spokes, with the two quads each arm comes out of left open. */
function torsoOf(cage: Cage, stations: readonly Station[]): readonly (readonly number[])[] {
  const rings = stations.map((st) => Array.from({ length: SPOKES }, (_, k) => {
    cage.rows.push(rowOf(spokeOf(st, k), st.bones));
    return cage.rows.length - 1;
  }));
  const open = (r: number, k: number): boolean => r >= ARMPIT && r < ARMPIT + 2 && [2, 3, 8, 9].includes(k);
  rings.slice(0, -1).forEach((ring, r) => {
    const next = rings[r + 1] ?? [];
    const inside = stations[r]?.at ?? [0, 0, 0];
    ring.forEach((v, k) => {
      if (open(r, k)) return;
      const j = (k + 1) % SPOKES;
      quad(cage, [v, ring[j] ?? 0, next[j] ?? 0, next[k] ?? 0], lerpV(inside, stations[r + 1]?.at ?? inside, 0.5), TORSO + r);
    });
  });
  capped(cage, rings[TOP_RING] ?? [], add(stations[TOP_RING]?.at ?? [0, 0, 0], [0, 0.02, 0]), TORSO + TOP_RING);
  return rings;
}

interface Hoop { readonly at: Vec; readonly a: Vec; readonly b: Vec; readonly ra: number; readonly rb: number; readonly bones: readonly (readonly [string, number])[]; readonly tag: number }

/** A ring of eight round `at`, on the axes `a` and `b`. */
function hoop(cage: Cage, h: Hoop, angleOf: (i: number) => number): readonly number[] {
  return Array.from({ length: 8 }, (_, i) => {
    const t = angleOf(i);
    cage.rows.push(rowOf(madd(madd(h.at, h.a, Math.cos(t) * h.ra), h.b, Math.sin(t) * h.rb), h.bones));
    return cage.rows.length - 1;
  });
}

/** The second axis of a limb at `along`, kept as near `like` as it can be. */
const across = (along: Vec, like: Vec): Vec => unit(sub(like, scale(along, dot(like, along))), SIDE);

/** An arm out of its opening in the torso, ending inside the hand. */
function armOf8(cage: Cage, p: Person, rings: readonly (readonly number[])[], arm: Arm, side: number): void {
  const L = side < 0 ? "L" : "R", k = limbWide(p.build) * (p.build.sex === "male" ? 1 : 0.9);
  const c = side > 0 ? 3 : 9;
  const pump = 1 + clamp((p.build.limb - 1) / 0.2, 0, 1) * (p.build.waist < 0.9 ? 0.3 : 0);
  const at = (r: number, s: number): number => rings[ARMPIT + r]?.[(c + s + SPOKES) % SPOKES] ?? 0;
  const mouth = [at(0, -1), at(0, 0), at(0, 1), at(1, 1), at(2, 1), at(2, 0), at(2, -1), at(1, -1)];
  const angle = (i: number): number => { const t = ((-45 - 45 * i) * Math.PI) / 180; return side > 0 ? t : Math.PI - t; };
  const up: readonly (readonly [string, number])[] = [[`upper.${L}`, 1]], fore: readonly (readonly [string, number])[] = [[`fore.${L}`, 1]];
  const stops: readonly (readonly [Vec, Vec, number, number, readonly (readonly [string, number])[]])[] = [
    [arm.shoulder, arm.elbow, 0.14, 0.052 * pump, [["chest", 0.45], [`upper.${L}`, 0.55]]],
    [arm.shoulder, arm.elbow, 0.4, 0.05 * pump, [["chest", 0.12], [`upper.${L}`, 0.88]]], [arm.shoulder, arm.elbow, 0.72, 0.042, up],
    [arm.shoulder, arm.elbow, 0.92, 0.037, [[`upper.${L}`, 0.85], [`fore.${L}`, 0.15]]],
    [arm.shoulder, arm.elbow, 1, 0.036, [[`upper.${L}`, 0.5], [`fore.${L}`, 0.5]]],
    [arm.elbow, arm.wrist, 0.1, 0.038, [[`upper.${L}`, 0.15], [`fore.${L}`, 0.85]]],
    [arm.elbow, arm.wrist, 0.3, 0.041, fore], [arm.elbow, arm.wrist, 0.68, 0.032, fore], [arm.elbow, arm.wrist, 0.92, 0.0265, [[`fore.${L}`, 0.7], [`hand.${L}`, 0.3]]], [arm.elbow, arm.wrist, 1.06, 0.0255, [[`hand.${L}`, 1]]],
  ];
  let prev: readonly number[] = mouth, front = FRONT;
  stops.forEach(([a, b, t, r, bones], i) => {
    const along = unit(sub(b, a));
    front = across(along, front);
    // (A wrist is flat, broader across the back of the hand than through it.)
    const flat = i >= 7 ? 0.74 : 1;
    const ring = hoop(cage, { at: lerpV(a, b, t), a: front, b: scale(unit(cross(along, front)), -side), ra: r * k * (i >= 7 ? 1.14 : 1), rb: r * k * flat, bones, tag: ARM + i }, angle);
    joined(cage, prev, ring, ARM + i);
    prev = ring;
  });
  capped(cage, prev, madd(arm.wrist, unit(sub(arm.wrist, arm.elbow)), 0.034), ARM + stops.length);
}

/** One leg's rings, the first the half of the torso's last on its side; the foot follows on. */
function legOf8(cage: Cage, p: Person, bottom: readonly number[], crotch: number, leg: Leg, side: number): void {
  const L = side < 0 ? "L" : "R", k = limbWide(p.build);
  const half = side > 0 ? [0, 1, 2, 3, 4, 5, 6] : [0, 11, 10, 9, 8, 7, 6];
  const mouth = [...half.map((i) => bottom[i] ?? 0), crotch];
  const angle = (i: number): number => ((135 - 45 * i) * Math.PI) / 180;
  const th: readonly (readonly [string, number])[] = [[`thigh.${L}`, 1]], sh: readonly (readonly [string, number])[] = [[`shin.${L}`, 1]];
  const stops: readonly (readonly [Vec, Vec, number, number, number, number, readonly (readonly [string, number])[]])[] = [
    [leg.hip, leg.knee, 0.2, 0.094, 0.096, 0, [["pelvis", 0.35], [`thigh.${L}`, 0.65]]],
    [leg.hip, leg.knee, 0.42, 0.084, 0.09, 0.004, th], [leg.hip, leg.knee, 0.7, 0.066, 0.072, 0.004, th],
    [leg.hip, leg.knee, 0.92, 0.054, 0.056, 0.002, [[`thigh.${L}`, 0.85], [`shin.${L}`, 0.15]]],
    [leg.hip, leg.knee, 1, 0.052, 0.054, 0.006, [[`thigh.${L}`, 0.5], [`shin.${L}`, 0.5]]],
    [leg.knee, leg.ankle, 0.1, 0.05, 0.052, 0, [[`thigh.${L}`, 0.15], [`shin.${L}`, 0.85]]],
    [leg.knee, leg.ankle, 0.3, 0.054, 0.061, -0.012, sh], [leg.knee, leg.ankle, 0.62, 0.042, 0.046, -0.006, sh], [leg.knee, leg.ankle, 0.92, 0.03, 0.034, 0, [[`shin.${L}`, 0.8], [`foot.${L}`, 0.2]]],
  ];
  const fill = mix(k, (p.build.hip / 0.17) * Math.sqrt(p.build.girth), 0.6);
  let prev: readonly number[] = mouth, front = FRONT;
  stops.forEach(([a, b, t, rx, rz, z, bones], i) => {
    const along = unit(sub(b, a));
    front = across(along, front);
    const ring = hoop(cage, { at: madd(lerpV(a, b, t), front, z), a: [side, 0, 0], b: front, ra: rx * (i < 3 ? fill : k), rb: rz * (i < 3 ? fill : k), bones, tag: LEG + i }, angle);
    joined(cage, prev, ring, LEG + i);
    prev = ring;
  });
  footOf8(cage, p, prev, leg, side, angle);
}

/** The foot: rings that swing from lying flat round the ankle to standing across the toes. */
function footOf8(cage: Cage, p: Person, from: readonly number[], leg: Leg, side: number, angle: (i: number) => number): void {
  const L = side < 0 ? "L" : "R", f = p.build.foot;
  const ahead = unit([0, 0, Math.max(0.01, leg.toe[2] - leg.ankle[2])]);
  const bones: readonly (readonly [string, number])[] = [[`foot.${L}`, 1]];
  const out: Vec = [side, 0, 0];
  const lift = (forward: number, up: number): Vec => add(madd(leg.ankle, ahead, forward * f), [0, up, 0]);
  const stops: readonly (readonly [Vec, Vec, number, number])[] = [
    [lift(-0.005, -0.05), unit(add(ahead, UP)), 0.04, 0.076],
    [lift(0.05, -0.058), UP, 0.043, 0.042],
    [lift(0.112, -0.071), UP, 0.051, 0.03],
    [lift(0.16, -0.079), UP, 0.046, 0.021],
  ];
  let prev: readonly number[] = from;
  const toes: readonly (readonly [string, number])[] = [[`toes.${L}`, 1]], ball: readonly (readonly [string, number])[] = [[`foot.${L}`, 0.5], [`toes.${L}`, 0.5]];
  stops.forEach(([at, b, rx, rz], i) => {
    const ring = hoop(cage, { at, a: out, b, ra: rx * f, rb: rz, bones: i === 3 ? toes : i === 2 ? ball : bones, tag: FOOT + i }, angle);
    joined(cage, prev, ring, FOOT + i);
    prev = ring;
  });
  capped(cage, prev, lift(0.2, -0.084), FOOT + stops.length);
}

/** A person's one closed body, in its resting pose. */
export function cageOf(p: Person): Cage {
  const s = restSkeleton(p);
  const cage: Cage = { rows: [], quads: [], tags: [] };
  const rings = torsoOf(cage, torsoStations(p, s));
  const bottom = rings[0] ?? [];
  cage.rows.push(rowOf(add(s.pelvis, [0, -HIP_DROP - 0.1, 0]), [["pelvis", 0.5], ["thigh.L", 0.25], ["thigh.R", 0.25]]));
  const crotch = cage.rows.length - 1;
  bottom.forEach((v, k) => {
    const row = cage.rows[v];
    if (!row || k % 6 === 0) return;
    row[3 + PELVIS] = 0.6;
    row[3 + boneIndex(k < 6 ? "thigh.R" : "thigh.L")] = 0.4;
  });
  armOf8(cage, p, rings, s.left.arm, -1);
  armOf8(cage, p, rings, s.right.arm, 1);
  legOf8(cage, p, bottom, crotch, s.left.leg, -1);
  legOf8(cage, p, bottom, crotch, s.right.leg, 1);
  return cage;
}

/** One step of Catmull-Clark: a closed quad mesh into one four times as fine, bone shares and all. */
export function subdivided(cage: Cage): Cage {
  const { rows, quads, tags } = cage;
  const width = rows[0]?.length ?? 0, n = rows.length;
  const sum = (list: readonly Row[], k: number): Row => Array.from({ length: width }, (_, c) => list.reduce((t, r) => t + (r[c] ?? 0), 0) * k);
  const corners = (q: readonly number[]): Row[] => q.map((i) => rows[i] ?? []);
  const faces = quads.map((q) => sum(corners(q), 0.25));
  const edges = new Map<number, { readonly a: number; readonly b: number; readonly faces: number[]; id: number }>();
  const touched = rows.map(() => ({ faces: [] as number[], near: new Set<number>() }));
  quads.forEach((q, f) => {
    q.forEach((a, i) => {
      const b = q[(i + 1) % 4] ?? 0, key = Math.min(a, b) * n + Math.max(a, b);
      const e = edges.get(key) ?? { a, b, faces: [], id: 0 };
      e.faces.push(f);
      edges.set(key, e);
      touched[a]?.faces.push(f);
      touched[a]?.near.add(b);
      touched[b]?.near.add(a);
    });
  });
  const next: Cage = { rows: [], quads: [], tags: [] };
  rows.forEach((row, i) => {
    const t = touched[i], v = t?.near.size ?? 0;
    if (!t || v === 0) { next.rows.push(row); return; }
    const f = sum(t.faces.map((x) => faces[x] ?? []), 1 / t.faces.length);
    const r = sum([...t.near].map((x) => rows[x] ?? []), 1 / v);
    next.rows.push(row.map((c, k) => ((f[k] ?? 0) + 2 * (r[k] ?? 0) + (v - 3) * c) / v));
  });
  const faceBase = next.rows.length;
  next.rows.push(...faces);
  for (const e of edges.values()) {
    e.id = next.rows.length;
    next.rows.push(sum([rows[e.a] ?? [], rows[e.b] ?? [], ...e.faces.map((x) => faces[x] ?? [])], 1 / (2 + e.faces.length)));
  }
  const edgeOf = (a: number, b: number): number => edges.get(Math.min(a, b) * n + Math.max(a, b))?.id ?? 0;
  quads.forEach((q, f) => {
    q.forEach((v, i) => {
      next.quads.push([v, edgeOf(v, q[(i + 1) % 4] ?? 0), faceBase + f, edgeOf(q[(i + 3) % 4] ?? 0, v)]);
      next.tags.push(tags[f] ?? 0);
    });
  });
  return next;
}

/** Every point's normal, from the quads round it. */
export function normalsOf(cage: Cage): readonly Vec[] {
  const out = cage.rows.map((): Vec => [0, 0, 0]);
  for (const q of cage.quads) {
    const [a, b, c, d] = q.map((i) => pointOf(cage.rows[i])) as unknown as readonly [Vec, Vec, Vec, Vec];
    const n = cross(sub(c, a), sub(d, b));
    for (const i of q) out[i] = add(out[i] ?? [0, 0, 0], n);
  }
  return out.map((n) => unit(n, UP));
}

/** The two bones with most of a point. */
export function strongest(row: Row): readonly [number, number, number] {
  const shares = row.slice(3);
  let a = 0, b = 0;
  shares.forEach((w, i) => { if (w > (shares[a] ?? 0)) a = i; });
  if (a === 0) b = 1;
  shares.forEach((w, i) => { if (i !== a && w > (shares[b] ?? 0)) b = i; });
  const wa = shares[a] ?? 0, wb = shares[b] ?? 0;
  return [a, b, wa / Math.max(1e-6, wa + wb)];
}

export type Cut = (at: Vec) => number;

export interface Shell {
  /** Which of the body's quads it is. */
  readonly on: (tag: number) => boolean;
  readonly lift: number;
  readonly role: (at: Vec, vertex?: number) => string;
  readonly fabric: number;
  /** How deep a shag stands off it. */
  readonly shag?: number;
  /** How it hangs, if not as the body under it does: its two bones, the first's share, and how free. */
  readonly hang?: (at: Vec, row: Row) => readonly [number, number, number, number];
  /** How cloth lies on it: where a point is round its limb, and along it. */
  readonly lay?: (at: Vec, tag: number) => Vec;
  /** Whether an open edge here is an edge at all, not a join to more of the same garment. */
  readonly edge?: (at: Vec) => boolean;
  /** Which of its quads to build, by their middles. */
  readonly keep?: (at: Vec, tag: number) => boolean;
  /** A cut through it that does not follow the rings: how far inside it a point is. */
  readonly cut?: Cut | undefined;
  /** How much soft flesh rides under a point of it. */
  readonly soft?: (at: Vec) => number;
  /** How far forward a vertex stands, over what it does not follow in. */
  readonly span?: (at: Vec) => number;
  /** How far under the surface a vertex is pushed: skin nothing shows of goes in under what covers it. */
  readonly sink?: (vertex: number) => number;
}

const edgeKey = (a: number, b: number): number => Math.min(a, b) * 1048576 + Math.max(a, b);

/** The vertices of a set of quads on an open edge, and who each vertex neighbours. */
function edgesOf(quads: readonly (readonly number[])[]): { readonly open: Set<number>; readonly next: Map<number, Set<number>> } {
  const seen = new Map<number, number>(), next = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => { next.set(a, (next.get(a) ?? new Set<number>()).add(b)); };
  for (const q of quads) q.forEach((a, i) => {
    const b = q[(i + 1) % q.length] ?? a, key = edgeKey(a, b);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    link(a, b);
    link(b, a);
  });
  const open = new Set<number>();
  for (const [key, count] of seen) if (count === 1) { open.add(Math.floor(key / 1048576)); open.add(key % 1048576); }
  return { open, next };
}

/** How far each vertex of a set of quads is from its open edges, walking the surface, up to `NO_EDGE`. */
function edgeDistance(quads: readonly (readonly number[])[], point: (v: number) => Vec, isEdge: (at: Vec) => boolean): Map<number, number> {
  const { open, next } = edgesOf(quads);
  const far = new Map<number, number>();
  const queue = [...open].filter((v) => isEdge(point(v)));
  for (const v of queue) far.set(v, 0);
  while (queue.length > 0) {
    const v = queue.pop() ?? 0, at = point(v), so = far.get(v) ?? 0;
    for (const n of next.get(v) ?? []) {
      const d = so + Math.hypot(...sub(point(n), at));
      if (d < NO_EDGE && d < (far.get(n) ?? NO_EDGE)) { far.set(n, d); queue.push(n); }
    }
  }
  return far;
}

/** How cloth lies on a body: arms and legs each along their own bone, the rest upright round the trunk. */
export function layOf(p: Person): (at: Vec, tag: number) => Vec {
  const s = restSkeleton(p);
  const round = (at: Vec, from: Vec, to: Vec, a: Vec, b: Vec): Vec => {
    const d = unit(sub(to, from)), r = sub(at, from);
    return [dot(r, a), dot(r, b), dot(r, d)];
  };
  return (at, tag) => {
    const side = at[0] > 0 ? s.right : s.left;
    if (tag >= LEG && tag < FOOT) return round(at, side.leg.hip, side.leg.ankle, SIDE, FRONT);
    if (tag >= ARM && tag < LEG) return round(at, side.arm.shoulder, side.arm.wrist, UP, FRONT);
    return [at[0], at[2] - s.chest[2], at[1]];
  };
}

/** Tufts: a rough 0 to 1 over the surface, drawn out downward as fur lies. */
const shagAt = (at: Vec): number => 0.5 + 0.25 * Math.sin(at[0] * 83 + at[2] * 61) * Math.sin(at[1] * 37 + at[0] * 29) + 0.25 * Math.sin(at[2] * 113 - at[1] * 53);

/** What a vertex's edge number is: how far inside a cut, if it has one, or from its open edge. */
const edgeOf = (shell: Shell, at: Vec, edge: number): number => (shell.cut ? clamp(shell.cut(at), -NO_EDGE, NO_EDGE) : edge);

/** How far off the surface a shell stands at a vertex. */
const standOff = (shell: Shell, at: Vec, i: number): number => shell.lift + (shell.shag ?? 0) * shagAt(at) - (shell.sink?.(i) ?? 0);

/** One vertex of a shell, into the net. */
function vertexOf(net: Net, body: Cage, normal: Vec, shell: Shell, [roles, size]: readonly [readonly string[], number], i: number, tag: number, edge: number): void {
  const at = pointOf(body.rows[i]);
  net.position.push(...scale(add(madd(at, normal, standOff(shell, at, i)), [0, 0, shell.span?.(at) ?? 0]), size));
  net.normal.push(...normal);
  net.role.push(Math.max(0, roles.indexOf(shell.role(at, i))));
  const row = body.rows[i] ?? [];
  const [a, b, w, free = 0] = shell.hang?.(at, row) ?? strongest(row);
  net.bones.push(a, b);
  net.weight.push(w);
  net.fabric.push(shell.fabric);
  net.loose.push(free);
  net.soft.push(shell.soft?.(at) ?? 0);
  net.cloth.push(...(shell.lay?.(at, tag) ?? [at[0], at[2], at[1]]), edgeOf(shell, at, edge));
}

/** Part of the body, stood off it, into the net. */
export function shellOf(net: Net, body: Cage, normals: readonly Vec[], shell: Shell, roles: readonly string[], size: number): void {
  const base = new Map<number, number>();
  const middleOf = (q: readonly number[]): Vec => q.reduce<Vec>((n, v) => madd(n, pointOf(body.rows[v]), 1 / q.length), [0, 0, 0]);
  const wanted = (q: readonly number[], tag: number): boolean => shell.on(tag) && (shell.keep?.(middleOf(q), tag) ?? true) && (shell.cut?.(middleOf(q)) ?? 1) > -0.04;
  const chosen = body.quads.filter((q, f) => wanted(q, body.tags[f] ?? 0));
  const edges = edgeDistance(chosen, (v) => pointOf(body.rows[v]), shell.edge ?? (() => true));
  body.quads.forEach((q, f) => {
    const tag = body.tags[f] ?? 0;
    if (!wanted(q, tag)) return;
    const ids = q.map((i) => {
      const seen = base.get(i);
      if (seen !== undefined) return seen;
      const id = net.position.length / 3;
      base.set(i, id);
      vertexOf(net, body, normals[i] ?? UP, shell, [roles, size], i, tag, edges.get(i) ?? NO_EDGE);
      return id;
    });
    const [a = 0, b = 0, c = 0, d = 0] = ids;
    net.index.push(a, b, c, a, c, d);
  });
}

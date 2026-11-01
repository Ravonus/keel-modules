// Vectors and frames, and a two-bone solve: the geometry every part of an animal is laid out with.

// ---------------------------------------------------------------- vectors

export type Vec = readonly [number, number, number];

export const TAU = Math.PI * 2;
export const UP: Vec = [0, 1, 0];
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const smooth = (v: number): number => { const t = clamp(v, 0, 1);
return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: Vec, b: Vec, s: number): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec, fallback: Vec = [0, 0, 1]): Vec => { const l = length(a);
return l > 1e-9 ? scale(a, 1 / l) : fallback; };
export const lerpV = (a: Vec, b: Vec, k: number): Vec => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
/** Turn about +z: a positive angle tips +y toward +x. */
export const rollV = (v: Vec, a: number): Vec => { const c = Math.cos(a);
const s = Math.sin(a);
return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; };
/** A direction from a heading and a pitch (pitch > 0 points up). */
export const dirOf = (yaw: number, pitch: number): Vec => [
  Math.sin(yaw) * Math.cos(pitch),
  Math.sin(pitch),
  Math.cos(yaw) * Math.cos(pitch),
];

/** An animal's own frame in the world: origin on what it stands on, x right, y up, z front. */
export interface Frame { readonly o: Vec; readonly x: Vec; readonly y: Vec; readonly z: Vec }

/** The frame whose front is `front` and whose up is as near `up` as a right angle lets it be. */
export function frameOf(o: Vec, front: Vec, up: Vec = UP): Frame {
  const z = unit(front);
  let x = cross(up, z);
  if (length(x) < 1e-6) x = cross([0, 0, 1], z);
  x = unit(x, [1, 0, 0]);
  return { o, x, y: cross(z, x), z };
}
export const toWorld = (f: Frame, v: Vec): Vec =>
  add(f.o, add(add(scale(f.x, v[0]), scale(f.y, v[1])), scale(f.z, v[2])));
export const dirToWorld = (f: Frame, v: Vec): Vec => add(add(scale(f.x, v[0]), scale(f.y, v[1])), scale(f.z, v[2]));

/**
 * Two bones from `a` of lengths l1 and l2 reaching for `target`, the middle joint
 * bending toward `pole`. Lengths are kept: a target out of reach is fallen short of.
 * (The pixel engine's rig.js solveTwoBone.)
 */
export function solveTwoBone(a: Vec, target: Vec, l1: number, l2: number, pole: Vec): { mid: Vec; end: Vec } {
  const d = sub(target, a);
  let dist = length(d);
  const n = dist > 1e-9 ? scale(d, 1 / dist) : unit(pole);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const end = madd(a, n, dist);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  let q = sub(pole, scale(n, dot(pole, n)));
  if (length(q) < 1e-9) q = Math.abs(n[1]) < 0.9 ? cross(n, UP) : cross(n, [1, 0, 0]);
  q = unit(q);
  return { mid: add(a, add(scale(n, l1 * cosA), scale(q, l1 * sinA))), end };
}


export const flat = (v: Vec): Vec => unit([v[0], 0, v[2]], [0, 0, 1]);

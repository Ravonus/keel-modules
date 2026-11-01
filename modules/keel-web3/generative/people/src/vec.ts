// Vectors: front is +z, right +x, up +y, in metres.

export type Vec = readonly [number, number, number];

export const UP: Vec = [0, 1, 0];
export const FRONT: Vec = [0, 0, 1];
export const SIDE: Vec = [1, 0, 0];
export const TAU = Math.PI * 2;
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const madd = (a: Vec, b: Vec, k: number): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const lerpV = (a: Vec, b: Vec, k: number): Vec => madd(a, sub(b, a), k);
export const unit = (a: Vec, fallback: Vec = FRONT): Vec => { const l = Math.hypot(...a);
return l > 1e-9 ? scale(a, 1 / l) : fallback; };
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** How far an empty cell counts as being from any surface. */
export const FAR = 1e3;

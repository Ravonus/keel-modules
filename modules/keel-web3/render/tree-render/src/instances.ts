// Instance matrices, column-major and written in place: boxes, slabs, voxels, segments and leaf blades.

import { at } from "./math.js";
import type { Flutter } from "./wind.js";

// ---------------------------------------------------------------- instance matrices (column-major, written in place)

export function writeColumns(array: Float32Array, index: number, columns: readonly number[]): void {
  const offset = index * 16;
  for (let i = 0; i < 12; i += 1) array[offset + i] = columns[i] ?? 0;
  array[offset + 15] = 1;
}

export function writeOrigin(array: Float32Array, index: number, origin: readonly [number, number, number]): void {
  const offset = index * 16;
  array[offset + 12] = origin[0];
  array[offset + 13] = origin[1];
  array[offset + 14] = origin[2];
  array[offset + 15] = 1;
}

/** Hides one instance far below the scene, scaled to nothing. */
export function clearSlot(array: Float32Array, index: number): void {
  array.fill(0, index * 16, index * 16 + 16);
  array[index * 16 + 13] = -50;
  array[index * 16 + 15] = 1;
}

export type V3 = readonly [number, number, number];

/** A box's place: its origin, its size along each axis, and its turn about up. */
export interface BoxPlace {
  readonly at: V3;
  readonly size: V3;
  readonly yaw: number;
}

/** A box turned `yaw` about up, scaled by `size`. */
export function writeBox(array: Float32Array, index: number, box: BoxPlace): void {
  const [sx, sy, sz] = box.size;
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  writeColumns(array, index, [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0]);
  writeOrigin(array, index, box.at);
}

/** A limb a slab lies on: its middle, the way it runs, and its radius. */
export interface Limb {
  readonly at: V3;
  readonly along: V3;
  readonly radius: number;
}

/** A slab's size: across the limb, through, and along it. */
export interface SlabSize {
  readonly width: number;
  readonly depth: number;
  readonly long: number;
}

/**
 * A slab `width` wide and `depth` thick lying on the top of a limb from its middle along (dx, dy, dz), which it follows
 * however it slopes.
 */
export function writeSlab(array: Float32Array, index: number, limb: Limb, slab: SlabSize): void {
  const [x, y, z] = limb.at;
  const [dx, dy, dz] = limb.along;
  const { radius } = limb;
  const { width, depth, long } = slab;
  const length = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dz);
  if (length < 1e-5 || flat < 1e-5) {
    clearSlot(array, index);
    return;
  }
  const ax = dx / length;
  const ay = dy / length;
  const az = dz / length;
  const sx = dz / flat;
  const sz = -dx / flat;
  const nx = sz * ay;
  const ny = sx * az - sz * ax;
  const nz = -sx * ay;
  writeColumns(array, index, [
    sx * width,
    0,
    sz * width,
    0,
    nx * depth,
    ny * depth,
    nz * depth,
    0,
    ax * long,
    ay * long,
    az * long,
    0,
  ]);
  const lift = radius + depth / 2;
  writeOrigin(array, index, [x + nx * lift, y + ny * lift, z + nz * lift]);
}

/** A voxel's look: how wide it is, how it is turned, and how much it is flattened (1, the default, is a cube). */
export interface VoxelLook {
  readonly size: number;
  readonly yaw: number;
  readonly flat?: number;
}

/** A cube `size` wide, flattened by `flat`, turned `yaw`. */
export function writeVoxel(array: Float32Array, index: number, at: V3, voxel: VoxelLook): void {
  const { size, yaw } = voxel;
  const flat = voxel.flat ?? 1;
  writeBox(array, index, { at, size: [size, size * flat, size], yaw });
}

/** One piece of wood: from `a` to `b`, `radius` thick. */
export interface WoodPiece {
  readonly a: V3;
  readonly b: V3;
  readonly radius: number;
}

/**
 * One wood piece from a to b, `radius` thick, overlapping its joints. Rotation is the shortest arc from up, so bark
 * never swims.
 */
export function writeSegment(array: Float32Array, index: number, piece: WoodPiece): void {
  const { a, b, radius } = piece;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-5 || radius <= 0) {
    clearSlot(array, index);
    return;
  }
  const ax = dx / length;
  const ay = dy / length;
  const az = dz / length;
  const thick = Math.max(radius * 2, 0.045);
  const long = length + thick * 0.5;
  if (ay < -0.9999) {
    writeColumns(array, index, [thick, 0, 0, 0, 0, -long, 0, 0, 0, 0, -thick, 0]);
  } else {
    const f = 1 / (1 + ay);
    writeColumns(array, index, [
      (1 - ax * ax * f) * thick,
      -ax * thick,
      -ax * az * f * thick,
      0,
      ax * long,
      ay * long,
      az * long,
      0,
      -ax * az * f * thick,
      -az * thick,
      (1 - az * az * f) * thick,
      0,
    ]);
  }
  writeOrigin(array, index, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

export const UP: readonly [number, number, number] = [0, 1, 0];
export const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return l > 1e-6 ? [x / l, y / l, z / l] : [0, 0, 0];
};
export const cross3 = (a: V3, b: V3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const isZero = (v: V3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

// A blade's frame, x then y then z, as scalars in one scratch: writeBlade runs for every leaf every frame, so it
// allocates nothing.
const AXES = new Float64Array(9);

/** The blade's y axis: its heading, drooped from there toward the ground, more so the heavier the rank. */
function bladeUp(n: V3, droop: number): void {
  let yx = n[0];
  let yy = n[1] - droop;
  let yz = n[2];
  const l2 = Math.hypot(yx, yy, yz);
  if (l2 > 1e-6) {
    yx /= l2;
    yy /= l2;
    yz /= l2;
  } else {
    yx = 0;
    yy = 1;
    yz = 0;
  }
  AXES[3] = yx;
  AXES[4] = yy;
  AXES[5] = yz;
}

/** The blade's x axis: up × y, normalised. */
function bladeSide(): void {
  const yx = at(AXES, 3);
  const yz = at(AXES, 5);
  let xx = yz;
  let xz = -yx;
  const l2 = Math.hypot(xx, xz);
  if (l2 > 1e-6) {
    xx /= l2;
    xz /= l2;
  } else {
    xx = 1;
    xz = 0;
  }
  AXES[0] = xx;
  AXES[2] = xz;
}

/** The blade's z axis: x × y (x has no y part), normalised. */
function bladeFace(): void {
  const xx = at(AXES, 0);
  const xz = at(AXES, 2);
  const yx = at(AXES, 3);
  const yy = at(AXES, 4);
  const yz = at(AXES, 5);
  let zx = -xz * yy;
  let zy = xz * yx - xx * yz;
  let zz = xx * yy;
  const l2 = Math.hypot(zx, zy, zz);
  if (l2 > 1e-6) {
    zx /= l2;
    zy /= l2;
    zz /= l2;
  } else {
    zx = 0;
    zy = 0;
    zz = 0;
  }
  AXES[6] = zx;
  AXES[7] = zy;
  AXES[8] = zz;
}

/** The blade's axes into AXES: y from its heading and droop, then x and z square to it. */
function bladeAxes(n: V3, droop: number): void {
  bladeUp(n, droop);
  bladeSide();
  bladeFace();
}

/** One leaf blade: its stalk `p`, the way it points `n`, its size, and `long` times longer than wide (1). */
export interface Blade {
  readonly p: V3;
  readonly n: V3;
  readonly size: number;
  readonly long?: number;
}

/**
 * One leaf blade at its stalk, pointing along `n`, drooped, twisted and nodded by `motion`; `long` draws it
 * that much longer than wide.
 */
export function writeBlade(array: Float32Array, index: number, blade: Blade, motion: Flutter): void {
  const { p, n, size } = blade;
  const long = blade.long ?? 1;
  bladeAxes(n, motion.droop);
  const c = Math.cos(motion.twist);
  const s = Math.sin(motion.twist);
  const w = size * 1.05;
  const l = size * long * (1 + motion.nod * 0.15);
  const o = index * 16;
  array[o] = (at(AXES, 0) * c + at(AXES, 6) * s) * w;
  array[o + 1] = at(AXES, 7) * s * w;
  array[o + 2] = (at(AXES, 2) * c + at(AXES, 8) * s) * w;
  array[o + 3] = 0;
  array[o + 4] = at(AXES, 3) * l;
  array[o + 5] = at(AXES, 4) * l;
  array[o + 6] = at(AXES, 5) * l;
  array[o + 7] = 0;
  array[o + 8] = (at(AXES, 6) * c - at(AXES, 0) * s) * w;
  array[o + 9] = at(AXES, 7) * c * w;
  array[o + 10] = (at(AXES, 8) * c - at(AXES, 2) * s) * w;
  array[o + 11] = 0;
  array[o + 12] = p[0];
  array[o + 13] = p[1];
  array[o + 14] = p[2];
  array[o + 15] = 1;
}

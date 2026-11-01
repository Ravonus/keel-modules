// Instance matrices, column-major and written in place: boxes, slabs, voxels, segments and leaf blades.

import type { Flutter } from "./wind.js";

// ---------------------------------------------------------------- instance matrices (column-major, written in place)

export function writeColumns(array: Float32Array, index: number, columns: readonly number[]): void {
  const offset = index * 16;
  for (let i = 0; i < 12; i += 1) array[offset + i] = columns[i] ?? 0;
  array[offset + 15] = 1;
}

export function writeOrigin(array: Float32Array, index: number, x: number, y: number, z: number): void {
  const offset = index * 16;
  array[offset + 12] = x; array[offset + 13] = y; array[offset + 14] = z; array[offset + 15] = 1;
}

/** Hides one instance far below the scene, scaled to nothing. */
export function clearSlot(array: Float32Array, index: number): void {
  array.fill(0, index * 16, index * 16 + 16);
  array[index * 16 + 13] = -50;
  array[index * 16 + 15] = 1;
}

/** A box turned `yaw` about up, scaled (sx, sy, sz). */
export function writeBox(array: Float32Array, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  writeColumns(array, index, [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0]);
  writeOrigin(array, index, x, y, z);
}

/** A slab `width` wide and `depth` thick lying on the top of a limb from its middle along (dx, dy, dz), which it follows however it slopes. */
export function writeSlab(array: Float32Array, index: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, radius: number, width: number, depth: number, long: number): void {
  const length = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz);
  if (length < 1e-5 || flat < 1e-5) { clearSlot(array, index); return; }
  const ax = dx / length, ay = dy / length, az = dz / length;
  const sx = dz / flat, sz = -dx / flat;
  const nx = sz * ay, ny = sx * az - sz * ax, nz = -sx * ay;
  writeColumns(array, index, [sx * width, 0, sz * width, 0, nx * depth, ny * depth, nz * depth, 0, ax * long, ay * long, az * long, 0]);
  const lift = radius + depth / 2;
  writeOrigin(array, index, x + nx * lift, y + ny * lift, z + nz * lift);
}

/** A cube `size` wide, flattened by `flat`, turned `yaw`. */
export function writeVoxel(array: Float32Array, index: number, x: number, y: number, z: number, size: number, yaw: number, flat = 1): void {
  writeBox(array, index, x, y, z, size, size * flat, size, yaw);
}

/** One wood piece from a to b, `radius` thick, overlapping its joints. Rotation is the shortest arc from up, so bark never swims. */
export function writeSegment(array: Float32Array, index: number, a: readonly [number, number, number], b: readonly [number, number, number], radius: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-5 || radius <= 0) { clearSlot(array, index); return; }
  const ax = dx / length, ay = dy / length, az = dz / length;
  const thick = Math.max(radius * 2, 0.045);
  const long = length + thick * 0.5;
  if (ay < -0.9999) {
    writeColumns(array, index, [thick, 0, 0, 0, 0, -long, 0, 0, 0, 0, -thick, 0]);
  } else {
    const f = 1 / (1 + ay);
    writeColumns(array, index, [
      (1 - ax * ax * f) * thick, -ax * thick, -ax * az * f * thick, 0,
      ax * long, ay * long, az * long, 0,
      -ax * az * f * thick, -az * thick, (1 - az * az * f) * thick, 0,
    ]);
  }
  writeOrigin(array, index, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

export const UP: readonly [number, number, number] = [0, 1, 0];
export const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return l > 1e-6 ? [x / l, y / l, z / l] : [0, 0, 0];
};
export type V3 = readonly [number, number, number];
export const cross3 = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const isZero = (v: V3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

/** One leaf blade at its stalk, pointing along (nx, ny, nz), drooped, twisted and nodded by `motion`; `long` draws it that much longer than wide. */
export function writeBlade(
  array: Float32Array,
  index: number,
  p: V3,
  n: V3,
  size: number,
  motion: Flutter,
  long = 1,
): void {
  // Leaves droop from their heading toward the ground, more so the heavier the rank. Scalar
  // locals throughout: this runs for every leaf every frame, so it allocates nothing.
  let yx = n[0], yy = n[1] - motion.droop, yz = n[2];
  let l2 = Math.hypot(yx, yy, yz);
  if (l2 > 1e-6) { yx /= l2; yy /= l2; yz /= l2; } else { yx = 0; yy = 1; yz = 0; }
  // x = up × y, normalised.
  let xx = yz, xz = -yx;
  l2 = Math.hypot(xx, xz);
  if (l2 > 1e-6) { xx /= l2; xz /= l2; } else { xx = 1; xz = 0; }
  // z = x × y (x has no y part), normalised.
  let zx = -xz * yy, zy = xz * yx - xx * yz, zz = xx * yy;
  l2 = Math.hypot(zx, zy, zz);
  if (l2 > 1e-6) { zx /= l2; zy /= l2; zz /= l2; } else { zx = 0; zy = 0; zz = 0; }
  const c = Math.cos(motion.twist);
  const s = Math.sin(motion.twist);
  const w = size * 1.05;
  const l = size * long * (1 + motion.nod * 0.15);
  const o = index * 16;
  array[o] = (xx * c + zx * s) * w; array[o + 1] = zy * s * w; array[o + 2] = (xz * c + zz * s) * w; array[o + 3] = 0;
  array[o + 4] = yx * l; array[o + 5] = yy * l; array[o + 6] = yz * l; array[o + 7] = 0;
  array[o + 8] = (zx * c - xx * s) * w; array[o + 9] = zy * c * w; array[o + 10] = (zz * c - xz * s) * w; array[o + 11] = 0;
  array[o + 12] = p[0]; array[o + 13] = p[1]; array[o + 14] = p[2]; array[o + 15] = 1;
}

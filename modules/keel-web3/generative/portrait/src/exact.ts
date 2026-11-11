// Maths with the same bits on every engine: a language promises plus, minus, times, divide, remainder and the
// square root, and nothing else. Angles, turns and what a seed decides are worked out here.

import type { M3 } from "./sdf.js";

const QUARTER = 1.5707963267948966;
const QUARTER_REST = 6.123233995736766e-17;

function series(first: number, squared: number, from: number): number {
  let term = first;
  let sum = first;
  for (let n = from; n < from + 16; n += 2) {
    term *= -squared / (n * (n + 1));
    sum += term;
  }
  return sum;
}

/** The sine of an angle of any size, within 5e-16 of Math.sin's. */
export function sine(x: number): number {
  const over = x % QUARTER;
  const near = Math.abs(over) > QUARTER / 2 ? over - Math.sign(x) * QUARTER : over;
  const turns = Math.round((x - near) / QUARTER);
  const angle = near - turns * QUARTER_REST;
  const quarter = ((turns % 4) + 4) % 4;
  const part = quarter % 2 === 1 ? series(1, angle * angle, 1) : series(angle, angle * angle, 2);
  return quarter < 2 ? part : -part;
}

export function cosine(x: number): number {
  return sine(x + QUARTER);
}

/** Degrees to radians. */
export const deg = (d: number): number => (d * QUARTER) / 90;

/**
 * A rotation from turns about x (pitch, + tips the top forward so the front looks down), y (yaw, + turns the front
 * toward +x) and z (roll, + tips the top toward -x), applied z, then x, then y. Rows take a point into the frame.
 */
export function turn(pitch: number, yaw: number, roll: number): M3 {
  const [sx, cx] = [sine(pitch), cosine(pitch)];
  const [sy, cy] = [sine(yaw), cosine(yaw)];
  const [sz, cz] = [sine(roll), cosine(roll)];
  // Out of the frame: Ry · Rx · Rz. Its transpose takes a point in.
  const r00 = cy * cz + sy * sx * sz;
  const r01 = -cy * sz + sy * sx * cz;
  const r02 = sy * cx;
  const r10 = cx * sz;
  const r11 = cx * cz;
  const r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz;
  const r21 = sy * sz + cy * sx * cz;
  const r22 = cy * cx;
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
}

/** A 32-bit hash of whole numbers (integer only). */
export function hash32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** A share in [0, 1) from whole numbers. */
export function unit(...values: number[]): number {
  return hash32(...values) / 4294967296;
}

/** A number between `lo` and `hi`, decided by a seed and a name. */
export function pick(seed: number, slot: number, lo: number, hi: number): number {
  return lo + (hi - lo) * unit(seed, slot);
}

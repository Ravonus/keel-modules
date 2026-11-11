// What a seed decides is worked out here with integer hashes, plus, minus, times, divide and the square root: a
// language promises the same bits of those on every engine, and of Math.pow and Math.sin it does not. So a seed is
// the same plate wherever it is asked, and its digest is the same digest.

/** A 32-bit hash of two integers. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A stream of numbers in 0..1 from a seed and a stream name. */
export interface Draw {
  /** The next number, from 0 up to 1. */
  (): number;
  /** The next number between `low` and `high`. */
  within(low: number, high: number): number;
}

/** A stream of numbers that depends on the seed and on `stream` only. */
export function draws(seed: number, stream: number): Draw {
  let n = 0;
  const next = (): number => {
    n += 1;
    return hash(hash(seed, stream), n) / 4294967296;
  };
  const within = (low: number, high: number): number => low + (high - low) * next();
  return Object.assign(next, { within });
}

/** The smooth step of 0..1, a polynomial. */
export function ease(t: number): number {
  const c = t < 0 ? 0 : Math.min(t, 1);
  return c * c * (3 - 2 * c);
}

/** Value noise in one dimension, 0..1, a lattice point every 1 of `x`. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const t = ease(x - i);
  const a = hash(seed, i) / 4294967296;
  const b = hash(seed, i + 1) / 4294967296;
  return a + (b - a) * t;
}

/** A unit vector turned from `x, y` by the angle whose half-tangent is `t` (-1..1 is a half turn each way). */
export function turn(x: number, y: number, t: number): [number, number] {
  const d = 1 + t * t;
  const c = (1 - t * t) / d;
  const s = (2 * t) / d;
  const ox = x * c - y * s;
  const oy = x * s + y * c;
  const l = Math.sqrt(ox * ox + oy * oy) || 1;
  return [ox / l, oy / l];
}

/** FNV-1a over the bytes of 32-bit floats, two lanes, as 16 hex digits. */
export function digestOf(parts: readonly Float32Array[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const part of parts) {
    const bytes = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
    for (const byte of bytes) {
      a = Math.imul(a ^ byte, 0x01000193);
      b = Math.imul(b ^ byte, 0x0100019d) ^ (a >>> 7);
    }
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

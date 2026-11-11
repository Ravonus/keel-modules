// Maths with the same bits on every engine. A language promises that of plus, minus, times, divide, remainder and
// the square root, and of nothing else: Math.sin may differ in its last bit from one engine to the next. Everything a
// seed or a figure decides goes through here, so the same figure gives the same mesh and the same motion everywhere.

/** A 32-bit integer hash of a seed, an index and a channel, as a number in [0, 1) by an exact division. */
export function puppetHash(seed: number, index: number, channel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77) ^ Math.imul(channel + 1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// A quarter turn as the nearest double, and what that leaves out of it.
const QUARTER = 1.5707963267948966;
const QUARTER_REST = 6.123233995736766e-17;

/** A sine's or a cosine's series from its `first` term, for the square of an angle within an eighth of a turn. */
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
  // (A remainder is exact, so the angle is taken down to the nearest quarter turn with nothing lost.)
  const over = x % QUARTER;
  const near = Math.abs(over) > QUARTER / 2 ? over - Math.sign(x) * QUARTER : over;
  const turns = Math.round((x - near) / QUARTER);
  const angle = near - turns * QUARTER_REST;
  const quarter = ((turns % 4) + 4) % 4;
  const part = quarter % 2 === 1 ? series(1, angle * angle, 1) : series(angle, angle * angle, 2);
  return quarter < 2 ? part : -part;
}

/** The cosine, as the sine a quarter turn on. */
export const cosine = (x: number): number => sine(x + QUARTER);

/** Degrees to radians. */
export const radians = (degrees: number): number => (degrees * QUARTER) / 90;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 3t² − 2t³ on t clamped to 0..1: an ease with no slope at either end. */
export function smooth(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** An FNV-1a digest of the bytes of some typed arrays: equal digests, equal arrays. */
export function digestOf(arrays: readonly ArrayBufferView[]): number {
  let h = 2166136261;
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) h = Math.imul(h ^ byte, 16777619);
  }
  return h >>> 0;
}

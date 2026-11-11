// What a seed decides is worked out with integer hashes, plus, minus, times, divide and the square root: a language
// promises the same bits of those on every engine, and of Math.pow and Math.sin it does not. The per-pixel noise uses
// the same hash as the shaders, so the CPU path and the GPU path read the same lattice.

/** A 32-bit hash of two integers. The shaders' `hh` is the same function. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A stream of numbers between `low` and `high` that depends on the seed and on `stream` only. */
export function draws(seed: number, stream: number): (low: number, high: number) => number {
  let n = 0;
  return (low, high) => {
    n += 1;
    return low + ((high - low) * hash(hash(seed, stream), n)) / 4294967296;
  };
}

/** The unit vector along `x, y`, turned by the angle whose half-tangent is `t`. */
export function turn(x: number, y: number, t = 0): [number, number] {
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
    for (const byte of new Uint8Array(part.buffer, part.byteOffset, part.byteLength)) {
      a = Math.imul(a ^ byte, 0x01000193);
      b = Math.imul(b ^ byte, 0x0100019d) ^ (a >>> 7);
    }
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

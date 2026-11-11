// What a seed decides is worked out with integer hashes, plus, minus, times, divide and the square root: a language
// promises the same bits of those on every engine, and of Math.pow and Math.sin it does not. The hash and the unit
// are painterly's (`render/painterly` settings.ts), the digest plate-painter's, so the same seed gives the same grain.

/**
 * A 32-bit hash of three integers.
 *
 * @returns An unsigned 32-bit number.
 */
export function hash32(a: number, b: number, c: number): number {
  // (A constant first, so three noughts are not a nought.)
  let h = 0x27d4eb2f ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A hash as a number from 0 up to 1: one division by a power of two, which is exact. */
export const unit = (hash: number): number => hash / 4294967296;

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

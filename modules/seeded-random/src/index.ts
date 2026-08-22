/** Deterministic xoshiro128** helpers for replayable browser art. MIT. */

/** A deterministic generator returning values in [0, 1). */
export type SeededRandom = () => number;

/**
 * Folds a hex seed string into four unsigned 32-bit state words.
 *
 * The seed is stripped of an optional 0x prefix, padded with "0" to 64 hex
 * characters, and truncated to 64. Each word xors an early 8-character
 * slice with a late one.
 *
 * @param hexSeed Hex string, with or without a 0x prefix.
 * @returns Four unsigned 32-bit words.
 */
export function seedWords(hexSeed: string): [number, number, number, number] {
  const clean = String(hexSeed).replace(/^0x/u, "").padEnd(64, "0").slice(0, 64);
  const word = (index: number): number => {
    const high = Number.parseInt(clean.slice(index * 8, index * 8 + 8), 16) >>> 0;
    const low = Number.parseInt(clean.slice((index + 4) * 8, (index + 5) * 8), 16) >>> 0;
    return (high ^ low) >>> 0;
  };
  return [word(0), word(1), word(2), word(3)];
}

/**
 * Creates a xoshiro128** generator seeded from a hex string.
 *
 * An all-zero seed is nudged to a nonzero state so the stream never
 * degenerates. The same seed always produces the same sequence.
 *
 * @param hexSeed Hex string, with or without a 0x prefix.
 * @returns A function producing deterministic values in [0, 1).
 */
export function createSeededRandom(hexSeed: string): SeededRandom {
  let [a, b, c, d] = seedWords(hexSeed);
  if ((a | b | c | d) === 0) d = 1;
  return function random(): number {
    const result = Math.imul(((b * 5) >>> 0), 0x7fffffff) >>> 0;
    const value = (((result << 7) | (result >>> 25)) * 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    return value / 0x1_0000_0000;
  };
}

/**
 * Draws a uniform integer from an inclusive range.
 *
 * @param random The injected generator, typically from {@link createSeededRandom}.
 * @param minimum Inclusive lower bound; must be a safe integer.
 * @param maximum Inclusive upper bound; must be a safe integer of at least minimum.
 * @returns An integer between minimum and maximum inclusive.
 * @throws RangeError when the bounds are not a valid safe-integer range.
 */
export function randomInt(random: SeededRandom, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new RangeError("randomInt expects an inclusive safe-integer range.");
  }
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

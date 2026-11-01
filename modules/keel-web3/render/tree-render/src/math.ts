// Small math: the seeded stream, the hash and the smooth step the rest leans on.

// ---------------------------------------------------------------- small math

export const TAU = Math.PI * 2;
export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
export const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A stable 32-bit hash. */
export function hash32(value: number): number {
  let result = value >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x21f0aaad);
  result = Math.imul(result ^ (result >>> 15), 0x735a2d97);
  return (result ^ (result >>> 15)) >>> 0;
}

/** A small seeded stream (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

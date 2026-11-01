// Seeded randomness: a seed to a number, and a stream a voice and a bar.

// ---------------------------------------------------------------- seeded randomness

/** A 32-bit integer from a seed: a number, a 0x hex string or any text. */
export function seedNumber(seed: number | string): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.floor(seed) >>> 0;
  const text = String(seed);
  if (/^0x[0-9a-f]+$/iu.test(text)) return Number.parseInt(text.slice(2, 10), 16) >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function mixHash(...parts: readonly number[]): number {
  let hash = 0x9e3779b9;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part >>> 0), 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast, seeded generator in [0, 1). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const VOICE_SALT = { keys: 1, bass: 2, melody: 3, drums: 4, nature: 5, crackle: 6 } as const;
export const barRandom = (seed: number, bar: number, voice: keyof typeof VOICE_SALT): (() => number) => random(mixHash(seed, bar, VOICE_SALT[voice]));

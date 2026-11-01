// Seeded streams: the same numbers on every machine, named so no two rolls share one.

// ---------------------------------------------------------------- seeded streams

export function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded stream of numbers in [0, 1) (mulberry32). */
export function createRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every choice draws from its own named stream, so adding one never reshuffles another. */
export const streamOf = (seed: number, name: string): (() => number) => createRandom((seed ^ hashName(name)) >>> 0);

export function pick<T>(rand: () => number, entries: readonly (readonly [T, number])[]): T {
  const first = entries[0];
  if (first === undefined) throw new Error("fauna: nothing to pick from");
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  let roll = rand() * total;
  for (const [value, w] of entries) {
    roll -= Math.max(0, w);
    if (roll < 0) return value;
  }
  return first[0];
}
export const between = (rand: () => number, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * rand();
export const intBetween = (rand: () =>
  number, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

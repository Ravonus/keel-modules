/** Seeded randomness for the band: one hash, one generator, one safe list read. MIT. */

/** A 32-bit number for any seed: a number is used as it is, text is hashed. */
export function seedNumber(seed: number | string): number {
  if (typeof seed === "number") return seed >>> 0;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Mixes whole numbers into one 32-bit hash, so a seed, a bar and a part give their own stream. */
export function mixHash(...parts: readonly number[]): number {
  let hash = 0x9e3779b9;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part >>> 0), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return hash >>> 0;
}

/** A number in [0, 1) for a hash, the same every time. */
export const unit = (hash: number): number => (mixHash(hash, 0x51ed270b) >>> 0) / 4294967296;

/** A generator of numbers in [0, 1) from a seed (mulberry32). */
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

/** The item at an index, wrapped round the list. Throws on an empty list. */
export function at<T>(list: readonly T[], index: number): T {
  const size = list.length;
  const item = list[((Math.floor(index) % size) + size) % size];
  if (item === undefined) throw new RangeError("Empty list.");
  return item;
}

/** The item a roll in [0, 1) lands on. */
export const pick = <T>(list: readonly T[], roll: number): T => at(list, Math.min(list.length - 1, roll * list.length));

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

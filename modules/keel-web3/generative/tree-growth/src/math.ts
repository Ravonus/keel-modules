// Numbers: the seeded stream and the little vector algebra the simulation grows with.

// ---------------------------------------------------------------- numbers

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const ramp = (value: number, start: number, end: number): number => clamp01((value - start) / Math.max(end - start, 1e-6));
export const smooth = (value: number): number => value * value * (3 - 2 * value);
export const at = (values: ArrayLike<number>, index: number): number => values[index] ?? 0;

export interface Vec { x: number; y: number; z: number }

export const vec = (x: number, y: number, z: number): Vec => ({ x, y, z });
export const add = (a: Vec, b: Vec, scale = 1): Vec => vec(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
export const lengthOf = (a: Vec): number => Math.hypot(a.x, a.y, a.z);
export const cross = (a: Vec, b: Vec): Vec => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export function normalize(a: Vec, fallback: Vec = vec(0, 1, 0)): Vec {
  const length = lengthOf(a);
  return length < 1e-9 ? fallback : vec(a.x / length, a.y / length, a.z / length);
}

/** Rotates `v` about the unit `axis` by `angle` radians (Rodrigues). */
export function rotate(v: Vec, axis: Vec, angle: number): Vec {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const k = cross(axis, v);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  return vec(
    v.x * cos + k.x * sin + axis.x * dot * (1 - cos),
    v.y * cos + k.y * sin + axis.y * dot * (1 - cos),
    v.z * cos + k.z * sin + axis.z * dot * (1 - cos),
  );
}

/** Any unit vector perpendicular to `a`. */
export function perpendicular(a: Vec): Vec {
  return normalize(Math.abs(a.y) < 0.9 ? cross(a, vec(0, 1, 0)) : cross(a, vec(1, 0, 0)));
}

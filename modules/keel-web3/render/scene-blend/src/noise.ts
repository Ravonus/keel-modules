// The seeded noise the blend thresholds against: a tiling square of value noise, worked out with integer hashes,
// plus, times and divide only, so a seed gives the same bytes on every engine (Math.random is never used).

/** Texels along a side of the noise texture. */
export const NOISE_SIZE = 256;

/** A lattice point and a seed to a share in [0, 1), by 32-bit integer mixing. */
export function latticeHash(x: number, y: number, seed: number): number {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000;
}

const smooth = (v: number): number => v * v * (3 - 2 * v);

/** Value noise at (x, y) in tile units (0..1 is one tile) on a lattice of `cells` a side that wraps, so it tiles. */
function tiledNoise(x: number, y: number, cells: number, seed: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const sx = smooth(fx - i);
  const sy = smooth(fy - j);
  const at = (u: number, v: number): number => latticeHash(u % cells, v % cells, seed);
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Four octaves of tiled value noise from `cells` a side, halving in strength as they double in detail. */
function tiledFbm(x: number, y: number, cells: number, seed: number): number {
  let total = 0;
  let amplitude = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    total += tiledNoise(x, y, cells << octave, seed + octave) * amplitude;
    amplitude /= 2;
  }
  return total / 1.875;
}

/** Spreads a channel's values over the whole 0..255 range, so a threshold of 0..1 sweeps from none to all. */
function stretch(values: Float64Array): Uint8Array {
  let low = Infinity;
  let high = -Infinity;
  for (const v of values) {
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  const span = high > low ? high - low : 1;
  return Uint8Array.from(values, (v) => Math.round(((v - low) / span) * 255));
}

/**
 * The noise texture's texels, RGBA, `size` a side (a power of two). R: fine fractal noise (16 cells a side and up),
 * the threshold a reveal follows. G: broad fractal noise (4 cells and up), for a torn edge's shape. B: white noise
 * for grain. A: 255. R and G are stretched to the full range. The same seed gives the same bytes everywhere.
 *
 * @param seed An integer seed.
 * @param size Texels a side, a power of two from 32; 256 by default.
 */
export function noiseTexels(seed = 0, size = NOISE_SIZE): Uint8Array {
  const count = size * size;
  const fine = new Float64Array(count);
  const broad = new Float64Array(count);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      fine[y * size + x] = tiledFbm(x / size, y / size, 16, seed);
      broad[y * size + x] = tiledFbm(x / size, y / size, 4, seed + 101);
    }
  }
  const r = stretch(fine);
  const g = stretch(broad);
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = r[i] ?? 0;
    out[i * 4 + 1] = g[i] ?? 0;
    out[i * 4 + 2] = Math.floor(latticeHash(i % size, Math.floor(i / size), seed + 7) * 256);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Tiny seeded value-noise field with smooth interpolation. MIT. */

/** Options for {@link fractalNoise2d}. */
export interface FractalNoiseOptions {
  /** Base integer seed; each octave offsets it by its index. Defaults to 0. */
  readonly seed?: number;
  /** Number of noise layers to sum. Defaults to 4. */
  readonly octaves?: number;
  /** Amplitude multiplier applied per octave. Defaults to 0.5. */
  readonly persistence?: number;
  /** Frequency multiplier applied per octave. Defaults to 2. */
  readonly lacunarity?: number;
}

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000;
}

const smooth = (value: number): number => value * value * (3 - 2 * value);
const mix = (left: number, right: number, amount: number): number => left + (right - left) * amount;

/**
 * Samples deterministic 2D value noise at a point.
 *
 * @param x Sample x coordinate; integer steps land on lattice points.
 * @param y Sample y coordinate.
 * @param seed Integer seed selecting the noise field. Defaults to 0.
 * @returns A smoothly interpolated value in [0, 1).
 */
export function noise2d(x: number, y: number, seed = 0): number {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const fx = smooth(x - left);
  const fy = smooth(y - top);
  return mix(mix(hash(left, top, seed), hash(left + 1, top, seed), fx), mix(hash(left, top + 1, seed), hash(left + 1, top + 1, seed), fx), fy);
}

/**
 * Sums several octaves of {@link noise2d} into fractal noise.
 *
 * @param x Sample x coordinate.
 * @param y Sample y coordinate.
 * @param options Seed, octave count, persistence, and lacunarity.
 * @returns The amplitude-normalized sum, or 0 when the total amplitude is 0.
 */
export function fractalNoise2d(x: number, y: number, { seed = 0, octaves = 4, persistence = 0.5, lacunarity = 2 }: FractalNoiseOptions = {}): number {
  let total = 0; let amplitude = 1; let frequency = 1; let scale = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise2d(x * frequency, y * frequency, seed + octave) * amplitude;
    scale += amplitude; amplitude *= persistence; frequency *= lacunarity;
  }
  return scale === 0 ? 0 : total / scale;
}

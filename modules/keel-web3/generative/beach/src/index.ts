/**
 * A shore as a function: the height of the ground at any place, from the sea
 * floor up through the surf zone to the dunes, and what covers it. Deterministic
 * and renderer-free. MIT.
 *
 *   const beach = createBeach({ seed });
 *   beach.groundAt(x, z)  -> height above still water
 *   beach.zoneAt(x, z)    -> "seabed" | "surf" | "wet" | "dry" | "dune"
 *   beach.colorAt(x, y, z) -> linear RGB, dry: wet sand follows the tide, so its renderer darkens it
 *
 * It knows nothing of the sea and works alone. To join them, give the sea this
 * ground, and the land carries on under the water as one surface:
 *
 *   const sea = createSea({ seed, ground: beach.groundAt });
 *
 * The profile is a real one: a flat floor, a sandbar with its trough behind it,
 * a rise to the shoreline (Dean's h = A x^(2/3) with a shelf's slope added), a steeper foreshore, a
 * berm where storms stop, and dunes behind. Frame: +y up, still water at y = 0.
 */

export type Vec3 = readonly [number, number, number];
export type Zone = "seabed" | "surf" | "wet" | "dry" | "dune";

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const smooth = (value: number): number => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

const lattice = (x: number, z: number, seed: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 0x1e3779b1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  return mix(mix(lattice(ix, iz, seed), lattice(ix + 1, iz, seed), fx), mix(lattice(ix, iz + 1, seed), lattice(ix + 1, iz + 1, seed), fx), fz);
}

function fractal(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let scale = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * scale, z * scale, seed + octave) * amplitude;
    amplitude *= 0.5;
    scale *= 2.03;
  }
  return sum;
}

export interface BeachInput {
  readonly seed?: number;
  /** Which way is inland, radians from +z toward +x. */
  readonly heading?: number;
  /** How far the shoreline stands from the origin, inland, metres. */
  readonly offset?: number;
  /** How far the shoreline wanders along the coast, metres. */
  readonly bays?: number;
  /** The depth of the open floor, metres. */
  readonly depth?: number;
  /** How high the dunes stand, metres. */
  readonly dunes?: number;
}

export interface Beach {
  readonly seed: number;
  /** A unit vector pointing inland, on the water: x then z. */
  readonly inland: readonly [number, number];
  /** How far (x, z) lies inland of the shoreline, negative out to sea. */
  inlandOf(x: number, z: number): number;
  /** The ground's height above still water at (x, z). */
  readonly groundAt: (x: number, z: number) => number;
  /** What covers the ground at (x, z). */
  zoneAt(x: number, z: number): Zone;
  /** The ground's colour at a place on it, linear RGB. */
  readonly colorAt: (x: number, y: number, z: number) => Vec3;
}

/** Offshore of the shoreline, metres: the concave rise, with its bar and trough. */
function underwater(out: number, depth: number): number {
  const rise = -Math.min(depth, 0.24 * Math.pow(out, 2 / 3) + out * 0.045);
  const bar = Math.exp(-(((out - 62) / 16) ** 2)) * 1.1;
  const trough = -Math.exp(-(((out - 34) / 11) ** 2)) * 0.5;
  return rise + (bar + trough) * smooth(out / 30);
}

/** Inland of the shoreline: the foreshore, the berm, the dunes. */
function onshore(inland: number, dunes: number, swell: number): number {
  const foreshore = Math.min(inland * 0.085, 1.5);
  const berm = 0.2 * smooth((inland - 18) / 14);
  const rise = smooth((inland - 34) / 26);
  return foreshore + berm + rise * dunes * (0.45 + swell * 0.95);
}

/**
 * Makes a shore.
 *
 * @param input The seed, which way is inland, and the shape of the coast.
 * @returns A beach whose every answer is a pure function of its input.
 */
export function createBeach(input: BeachInput = {}): Beach {
  const seed = (input.seed ?? 1) >>> 0;
  const heading = input.heading ?? 0;
  const offset = input.offset ?? 0;
  const bays = input.bays ?? 14;
  const depth = input.depth ?? 26;
  const dunes = input.dunes ?? 4.5;
  const inlandDir: readonly [number, number] = [Math.sin(heading), Math.cos(heading)];
  const inlandOf = (x: number, z: number): number => {
    const across = x * inlandDir[1] - z * inlandDir[0];
    return x * inlandDir[0] + z * inlandDir[1] - offset - (fractal(across * 0.007, 3.7, seed, 3) * 2 - 0.875) * bays;
  };
  const groundAt = (x: number, z: number): number => {
    const inland = inlandOf(x, z);
    if (inland < 0) return underwater(-inland, depth) + (fractal(x * 0.03, z * 0.03, seed + 21, 3) - 0.44) * smooth(-inland / 90) * 1.6;
    return onshore(inland, dunes, fractal(x * 0.022, z * 0.022, seed + 5, 3) * 1.15);
  };
  const zoneOf = (inland: number): Zone => {
    if (inland < -70) return "seabed";
    if (inland < 0) return "surf";
    if (inland < 9) return "wet";
    return inland < 38 ? "dry" : "dune";
  };
  return {
    seed, inland: inlandDir, inlandOf, groundAt,
    zoneAt: (x, z) => zoneOf(inlandOf(x, z)),
    colorAt(x, y, z) {
      const inland = inlandOf(x, z);
      const grass = smooth((inland - 44) / 18) * smooth((fractal(x * 0.06, z * 0.06, seed + 11, 3) - 0.34) / 0.2);
      const grain = 0.94 + fractal(x * 0.9, z * 0.9, seed + 3, 2) * 0.12;
      const sand: Vec3 = [0.74 * grain, 0.6 * grain, 0.4 * grain];
      const under = y < -2 ? 0.8 : 1;
      return [mix(sand[0], 0.2, grass) * under, mix(sand[1], 0.26, grass) * under, mix(sand[2], 0.1, grass) * under];
    },
  };
}

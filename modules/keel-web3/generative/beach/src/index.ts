/**
 * A shore as a function: the height of the ground at any place, from the sea
 * floor up through the surf zone to the dunes or cliffs, and what covers it.
 * Deterministic and renderer-free. MIT.
 *
 *   const beach = createBeach({ seed, kind: "cove" });
 *   beach.groundAt(x, z)  -> height above still water
 *   beach.zoneAt(x, z)    -> "seabed" | "surf" | "wet" | "dry" | "dune" | "cliff" | "rock"
 *   beach.colorAt(x, y, z) -> linear RGB, dry: wet sand follows the tide, so its renderer darkens it
 *   beach.rocksWithin(x, z, radius) -> the boulders and sea stacks there
 *   beach.trails(count, near) -> footprints people have left on the sand
 *
 * It knows nothing of the sea and works alone. To join them, give the sea this
 * ground, and the land carries on under the water as one surface:
 *
 *   const sea = createSea({ seed, ground: beach.groundAt });
 *
 * The profile is a real one: a flat floor, a sandbar with its trough behind it,
 * a rise to the shoreline (Dean's h = A x^(2/3) with a shelf's slope added), a steeper foreshore
 * scalloped into cusps, a berm where storms stop, and dunes behind. Along the
 * coast headlands push out to sea, and on them the sand gives way to cliffs and
 * rock. Frame: +y up, still water at y = 0.
 */

export type Vec3 = readonly [number, number, number];
export type Zone = "seabed" | "surf" | "wet" | "dry" | "dune" | "cliff" | "rock";
/** How a coast is built: "dunes" runs open and sandy, and "cliffs" is mostly rock with sand in its gaps. */
export type BeachKind = "dunes" | "bay" | "cove" | "cliffs" | "rocky";
export type SandKind = "golden" | "pale" | "dark" | "shell" | "shingle";

interface Shape {
  readonly bays: number;
  readonly dunes: number;
  readonly cliffs: number;
  readonly rocks: number;
  readonly cliffHeight: number;
}

const KINDS: Readonly<Record<BeachKind, Shape>> = {
  dunes: { bays: 14, dunes: 5.5, cliffs: 0.1, rocks: 0.12, cliffHeight: 12 },
  bay: { bays: 26, dunes: 3.5, cliffs: 0.4, rocks: 0.35, cliffHeight: 18 },
  cove: { bays: 34, dunes: 2, cliffs: 0.62, rocks: 0.6, cliffHeight: 24 },
  cliffs: { bays: 20, dunes: 1.5, cliffs: 0.85, rocks: 0.8, cliffHeight: 34 },
  rocky: { bays: 18, dunes: 2, cliffs: 0.45, rocks: 1, cliffHeight: 12 },
};

/** Each sand with the rock it came from and the band of pebbles the swash sorts out of it. */
const SANDS: Readonly<Record<SandKind, { readonly sand: Vec3; readonly rock: Vec3; readonly pebbles: Vec3 }>> = {
  golden: { sand: [0.74, 0.6, 0.4], rock: [0.3, 0.25, 0.2], pebbles: [0.42, 0.36, 0.28] },
  pale: { sand: [0.88, 0.82, 0.68], rock: [0.5, 0.46, 0.4], pebbles: [0.66, 0.62, 0.54] },
  dark: { sand: [0.15, 0.13, 0.13], rock: [0.08, 0.075, 0.08], pebbles: [0.1, 0.09, 0.09] },
  shell: { sand: [0.82, 0.62, 0.53], rock: [0.42, 0.3, 0.26], pebbles: [0.68, 0.5, 0.45] },
  shingle: { sand: [0.46, 0.43, 0.39], rock: [0.24, 0.24, 0.25], pebbles: [0.32, 0.31, 0.3] },
};

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const smooth = (value: number): number => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const TAU = Math.PI * 2;

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
  /** How the coast is built. By default the seed picks. */
  readonly kind?: BeachKind;
  /** What the sand is. By default the seed picks. */
  readonly sand?: SandKind;
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
  /** How much of the coast is headland, from 0 to 1. */
  readonly cliffs?: number;
  /** How high the cliffs stand, metres. */
  readonly cliffHeight?: number;
  /** How many rocks lie along the shore, from 0 to 1. */
  readonly rocks?: number;
}

/** A boulder or sea stack. */
export interface Rock {
  /** Where its foot stands on the ground. */
  readonly at: Vec3;
  /** Across the foot, metres. */
  readonly radius: number;
  /** How far it stands above its foot, metres. */
  readonly height: number;
  /** Which way it is turned, radians. */
  readonly yaw: number;
}

/** One foot pressed into the sand. */
export interface Print {
  readonly x: number;
  readonly z: number;
  /** The ground's height there. */
  readonly y: number;
  /** Which way the toes point, radians from +z toward +x. */
  readonly heading: number;
  /** -1 for the left foot, 1 for the right. */
  readonly foot: number;
}

export interface Beach {
  readonly seed: number;
  readonly kind: BeachKind;
  readonly sand: SandKind;
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
  /** The colour of this coast's rock, linear RGB. */
  readonly rockColor: Vec3;
  /** The rocks around a place: draw these, the ground only knows their bulk. */
  rocksWithin(x: number, z: number, radius: number): Rock[];
  /** Whether a foot would leave a mark at (x, z). */
  takesPrints(x: number, z: number): boolean;
  /** The footprints seeded walks have left near a place. */
  trails(count: number, near?: readonly [number, number]): Print[];
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
 * Where the feet land on a walk: a stride along the path, left and right of it.
 *
 * @param path The walk's points, x then z.
 * @param groundAt The ground's height.
 * @param stride Metres from one foot to the next.
 * @param stance Metres from the path to either foot.
 * @returns The prints in the order they were made.
 */
export function stepsAlong(path: readonly (readonly [number, number])[], groundAt: (x: number, z: number) => number, stride = 0.72, stance = 0.11): Print[] {
  const prints: Print[] = [];
  let next = 0;
  let walked = 0;
  let foot = -1;
  for (let at = 1; at < path.length; at += 1) {
    const from = path[at - 1] ?? ([0, 0] as const);
    const to = path[at] ?? from;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    const [dx, dz] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    for (; next <= walked + length; next += stride) {
      const along = next - walked;
      const [x, z] = [from[0] + dx * along + dz * stance * foot, from[1] + dz * along - dx * stance * foot];
      prints.push({ x, z, y: groundAt(x, z), heading: Math.atan2(dx, dz) + foot * 0.09, foot });
      foot = -foot;
    }
    walked += length;
  }
  return prints;
}

/** The size of the lattice rocks are scattered on, metres. */
const ROCK_CELL = 14;

interface Coast {
  readonly seed: number;
  readonly dir: readonly [number, number];
  readonly offset: number;
  readonly depth: number;
  readonly shape: Shape;
}

const acrossOf = (coast: Coast, x: number, z: number): number => x * coast.dir[1] - z * coast.dir[0];

/** How much of a headland stands here, along the coast: 0 on open sand, 1 on the point. */
function headlandAt(coast: Coast, across: number): number {
  const wander = fractal(across * 0.0048, 9.1, coast.seed + 31, 3) / 0.875;
  return smooth((wander - mix(0.8, 0.22, coast.shape.cliffs)) / 0.24) * (coast.shape.cliffs > 0 ? 1 : 0);
}

function inlandAt(coast: Coast, x: number, z: number): number {
  const across = acrossOf(coast, x, z);
  const headland = headlandAt(coast, across);
  const cusps = Math.sin((across * TAU) / (24 + (coast.seed % 9)) + fractal(across * 0.02, 1.3, coast.seed + 2, 2) * 7) * 1.2 * (1 - headland);
  return x * coast.dir[0] + z * coast.dir[1] - coast.offset - (fractal(across * 0.007, 3.7, coast.seed, 3) * 2 - 0.875) * coast.shape.bays + headland * 46 + cusps;
}

/** How far up its face a cliff stands here, from 0 at the toe to 1 on top. The face wanders in and out, gullies bite into it, and it climbs in uneven ledges. */
function cliffShare(coast: Coast, x: number, z: number, inland: number, headland: number): number {
  if (headland <= 0) return 0;
  const { seed } = coast;
  const across = acrossOf(coast, x, z);
  const wander = (fractal(x * 0.016, z * 0.016, seed + 51, 3) - 0.44) * 34 + (fractal(x * 0.07, z * 0.07, seed + 53, 3) - 0.44) * 14;
  const gully = (1 - Math.abs((fractal(across * 0.045, inland * 0.012, seed + 57, 2) / 0.75) * 2 - 1)) ** 3 * 16;
  const run = mix(16, 8, headland) * (0.7 + fractal(x * 0.03, z * 0.03, seed + 55, 2) * 1.4);
  const up = smooth((inland - mix(24, -5, headland) + wander - gully) / run);
  return clamp(up + Math.sin(up * TAU * 2.5 + fractal(x * 0.02, z * 0.02, seed + 58, 2) * 9) * 0.07 * (1 - up) * up * 4, 0, 1);
}

/** The land without its rocks. */
function landAt(coast: Coast, x: number, z: number): number {
  const inland = inlandAt(coast, x, z);
  const headland = headlandAt(coast, acrossOf(coast, x, z));
  const base = inland < 0
    ? underwater(-inland, coast.depth) + (fractal(x * 0.03, z * 0.03, coast.seed + 21, 3) - 0.44) * smooth(-inland / 90) * 1.6
    : onshore(inland, coast.shape.dunes, fractal(x * 0.022, z * 0.022, coast.seed + 5, 3) * 1.15);
  if (headland <= 0) return base;
  const share = cliffShare(coast, x, z, inland, headland);
  const tall = coast.shape.cliffHeight * (0.35 + fractal(x * 0.014, z * 0.014, coast.seed + 61, 3) * 1.6) * smooth(headland * 1.6);
  const rough = (fractal(x * 0.17, z * 0.17, coast.seed + 59, 3) - 0.44) * 7 * share * (1 - share) * 4;
  return base + tall * share + rough * smooth(headland * 2);
}

/** The rock on a lattice cell, if the seed put one there. */
function rockOfCell(coast: Coast, ix: number, iz: number): Rock | null {
  const seed = coast.seed + 41;
  const [x, z] = [(ix + 0.2 + lattice(ix, iz, seed + 1) * 0.6) * ROCK_CELL, (iz + 0.2 + lattice(ix, iz, seed + 2) * 0.6) * ROCK_CELL];
  const inland = inlandAt(coast, x, z);
  const headland = headlandAt(coast, acrossOf(coast, x, z));
  const band = smooth(1 - Math.abs(inland + 12) / 44);
  if (lattice(ix, iz, seed) > coast.shape.rocks * (0.14 + 0.56 * headland) * band) return null;
  const size = lattice(ix, iz, seed + 3);
  const stack = headland > 0.35 && inland < -6 && size > 0.55;
  const radius = stack ? 4 + size * 5 : 0.8 + 5.5 * size * size * size;
  return { at: [x, landAt(coast, x, z) - radius * 0.1, z], radius, height: radius * (stack ? 1.5 + size * 1.5 : 0.7 + size * 0.5), yaw: lattice(ix, iz, seed + 4) * TAU };
}

/** Rocks by lattice cell, each worked out once. */
function rocksOf(coast: Coast): (ix: number, iz: number) => Rock | null {
  const cells = new Map<number, Rock | null>();
  return (ix, iz) => {
    const key = ix * 131071 + iz;
    let rock = cells.get(key);
    if (rock === undefined) {
      rock = coast.shape.rocks > 0 ? rockOfCell(coast, ix, iz) : null;
      cells.set(key, rock);
    }
    return rock;
  };
}

/** The rock whose bulk stands tallest at (x, z), with that height. */
function rockTopAt(rockAt: (ix: number, iz: number) => Rock | null, x: number, z: number): number {
  const [ix, iz] = [Math.floor(x / ROCK_CELL), Math.floor(z / ROCK_CELL)];
  let top = -Infinity;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const rock = rockAt(ix + dx, iz + dz);
      if (!rock) continue;
      const out = Math.hypot(x - rock.at[0], z - rock.at[2]) / rock.radius;
      // (A little under the drawn rock, so the mesh is always what shows.)
      if (out < 1) top = Math.max(top, rock.at[1] + rock.height * 0.82 * (1 - out * out));
    }
  }
  return top;
}

/** The ground's own colour: sand, its pebbles and tide wrack, grass behind, and rock wherever a cliff stands. */
function paint(coast: Coast, sands: (typeof SANDS)[SandKind], x: number, y: number, z: number): Vec3 {
  const { seed } = coast;
  const inland = inlandAt(coast, x, z);
  const headland = headlandAt(coast, acrossOf(coast, x, z));
  const patch = fractal(x * 0.06, z * 0.06, seed + 11, 3);
  const grass = smooth((inland - 44) / 18) * smooth((patch - 0.34) / 0.2);
  const grain = 0.94 + fractal(x * 0.9, z * 0.9, seed + 3, 2) * 0.12;
  const pebbled = smooth((patch - 0.46) / 0.1) * smooth(1 - Math.abs(inland - 1) / 5) * (0.35 + coast.shape.rocks * 0.65);
  const wrack = smooth(1 - Math.abs(inland - 13 - patch * 4) / 1.1) * smooth((fractal(x * 0.3, z * 0.3, seed + 8, 2) - 0.4) / 0.12) * 0.55;
  const rocky = smooth((cliffShare(coast, x, z, inland, headland) - 0.04) / 0.14) * smooth(1 - (cliffShare(coast, x, z, inland, headland) - 0.82) / 0.18);
  const strata = 0.8 + 0.26 * Math.sin(y * 1.9 + fractal(x * 0.04, z * 0.04, seed + 9, 2) * 9);
  const under = y < -2 ? 0.8 : 1;
  return [0, 1, 2].map((channel) => {
    const ground = mix(mix(sands.sand[channel] ?? 0, sands.pebbles[channel] ?? 0, pebbled) * grain, 0.05, wrack);
    return mix(mix(ground, [0.2, 0.26, 0.1][channel] ?? 0, grass), (sands.rock[channel] ?? 0) * strata, rocky) * under;
  }) as unknown as Vec3;
}

function zoneOf(inland: number): Zone {
  if (inland < -70) return "seabed";
  if (inland < 0) return "surf";
  if (inland < 9) return "wet";
  return inland < 38 ? "dry" : "dune";
}

/** A seeded walker's route along the sand: the way people walk a beach, wandering in and out of the wet. */
function walkOf(coast: Coast, index: number, near: readonly [number, number]): (readonly [number, number])[] {
  const seed = coast.seed + 71 + index * 3;
  const [dx, dz] = coast.dir;
  const middle = acrossOf(coast, near[0], near[1]) + (lattice(index, 1, seed) - 0.5) * 90;
  const keep = 2 + lattice(index, 2, seed) * 22;
  const length = 40 + lattice(index, 3, seed) * 70;
  return Array.from({ length: Math.ceil(length) }, (_, step) => {
    const across = middle + (step - length / 2) * (index % 2 === 0 ? 1 : -1);
    const target = keep + Math.sin(step * 0.05 + index) * 5 + Math.sin(step * 0.13 + index * 2) * 1.5;
    const [x, z] = [across * dz + dx * (near[0] * dx + near[1] * dz), -across * dx + dz * (near[0] * dx + near[1] * dz)];
    const off = target - inlandAt(coast, x, z);
    return [x + dx * off, z + dz * off] as const;
  });
}

const seededKind = (seed: number): BeachKind => (["dunes", "bay", "cove", "cliffs", "rocky"] as const)[Math.floor(lattice(seed, 7, 3) * 5)] ?? "bay";
const seededSand = (seed: number): SandKind => (["golden", "golden", "pale", "dark", "shell", "shingle"] as const)[Math.floor(lattice(seed, 8, 3) * 6)] ?? "golden";

function coastOf(input: BeachInput, seed: number, kind: BeachKind): Coast {
  const shape = KINDS[kind];
  const heading = input.heading ?? 0;
  return {
    seed, dir: [Math.sin(heading), Math.cos(heading)], offset: input.offset ?? 0, depth: input.depth ?? 26,
    shape: { bays: input.bays ?? shape.bays, dunes: input.dunes ?? shape.dunes, cliffs: input.cliffs ?? shape.cliffs, rocks: input.rocks ?? shape.rocks, cliffHeight: input.cliffHeight ?? shape.cliffHeight },
  };
}

/**
 * Makes a shore.
 *
 * @param input The seed, which way is inland, and the shape of the coast.
 * @returns A beach whose every answer is a pure function of its input.
 */
export function createBeach(input: BeachInput = {}): Beach {
  const seed = (input.seed ?? 1) >>> 0;
  const kind = input.kind ?? seededKind(seed);
  const sand = input.sand ?? seededSand(seed);
  const coast = coastOf(input, seed, kind);
  const rockAt = rocksOf(coast);
  const groundAt = (x: number, z: number): number => Math.max(landAt(coast, x, z), rockTopAt(rockAt, x, z));
  const zone = (x: number, z: number): Zone => {
    if (rockTopAt(rockAt, x, z) > landAt(coast, x, z)) return "rock";
    const inland = inlandAt(coast, x, z);
    return cliffShare(coast, x, z, inland, headlandAt(coast, acrossOf(coast, x, z))) > 0.1 ? "cliff" : zoneOf(inland);
  };
  const takesPrints = (x: number, z: number): boolean => ["wet", "dry", "dune", "surf"].includes(zone(x, z));
  return {
    seed, kind, sand, inland: coast.dir, groundAt, takesPrints,
    rockColor: SANDS[sand].rock,
    inlandOf: (x, z) => inlandAt(coast, x, z),
    zoneAt: zone,
    colorAt: (x, y, z) => paint(coast, SANDS[sand], x, y, z),
    rocksWithin(x, z, radius) {
      const reach = Math.ceil(radius / ROCK_CELL);
      const [ix, iz] = [Math.floor(x / ROCK_CELL), Math.floor(z / ROCK_CELL)];
      const found: Rock[] = [];
      for (let dz = -reach; dz <= reach; dz += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const rock = rockAt(ix + dx, iz + dz);
          if (rock) found.push(rock);
        }
      }
      return found;
    },
    trails: (count, near = [0, 0]) => Array.from({ length: count }, (_, index) => stepsAlong(walkOf(coast, index, near), groundAt)).flat().filter((print) => takesPrints(print.x, print.z)),
  };
}

/**
 * A sea as a function: the height of the water at any place and moment, the
 * ground under it, the current through it, the tide, and how light dies on
 * the way down. Deterministic and renderer-free: a seed and a wind make the
 * sea, and everything that floats, swims or draws asks the same waves. MIT.
 *
 *   const sea = createSea({ seed, wind: 7 });
 *   sea.surfaceAt(x, z, t)   -> { height, normal }
 *   sea.seabedAt(x, z)       -> the ground's height
 *   sea.currentAt(x, y, z, t) -> [x, y, z] metres per second
 *   sea.waves                -> the same waves, packed for a shader
 *
 * The waves are Gerstner waves on deep water's dispersion: a crest travels at
 * the speed its length gives it, so nothing here is tuned by eye. Frame: +y
 * up, the still water at y = 0, metres and seconds.
 */

export type Vec3 = readonly [number, number, number];

const TAU = Math.PI * 2;
const GRAVITY = 9.81;
/** How steep the waves may stand before a Gerstner crest loops over itself. */
const MOST_STEEP = 0.82;
/** Fixed-point rounds to undo the waves' sideways push: 6 lands within a millimetre, even in a gale. */
const SETTLE = 6;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const smooth = (value: number): number => value * value * (3 - 2 * value);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** mulberry32: a seed's stream of numbers in [0, 1). */
function streamOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const near = mix(lattice(ix, iz, seed), lattice(ix + 1, iz, seed), fx);
  const far = mix(lattice(ix, iz + 1, seed), lattice(ix + 1, iz + 1, seed), fx);
  return mix(near, far, fz);
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

// ---------------------------------------------------------------- the waves

/** One travelling wave. */
export interface Wave {
  /** Unit direction of travel on the water, x then z. */
  readonly dir: readonly [number, number];
  /** Wavenumber, radians per metre. */
  readonly k: number;
  /** Frequency, radians per second, from deep water's dispersion. */
  readonly omega: number;
  /** Height of a crest above the still water, metres. */
  readonly amp: number;
  /** How far the wave pushes water sideways toward its crest, as a share of `amp`. */
  readonly q: number;
  readonly phase: number;
}

export interface SeaInput {
  readonly seed?: number;
  /** Wind over the water, metres per second. 2 is a glassy calm, 7 a fresh sea, 15 a gale. */
  readonly wind?: number;
  /** Where the wind blows toward, radians from +z toward +x. */
  readonly heading?: number;
  /** How many waves make the sea. A shader pays for each one, so 12 is the default. */
  readonly count?: number;
  /** Depth of the open floor, metres. */
  readonly depth?: number;
  /** How far the floor's hills rise and fall, metres. */
  readonly relief?: number;
  /**
   * The ground's height at (x, z), in place of the open floor: where it nears
   * still water the waves shoal, and where it rises past it there is a shore.
   * `generative/beach`'s `groundAt` fits, and is all it takes to join the two.
   */
  readonly ground?: (x: number, z: number) => number;
}

export interface SurfacePoint {
  readonly height: number;
  readonly normal: Vec3;
}

export interface Sea {
  readonly seed: number;
  readonly wind: number;
  readonly heading: number;
  readonly depth: number;
  readonly waves: readonly Wave[];
  /** The waves as eight floats each (dirX, dirZ, k, omega, amp, q, phase, 0), for a shader's uniform array. */
  readonly packed: Float32Array;
  /** Where the water that started at (x, z) has moved to at t. */
  displace(x: number, z: number, t: number): Vec3;
  /** The water's height and normal directly above or below (x, z) at t, with the tide at `level`, breakers and swash included. */
  surfaceAt(x: number, z: number, t: number, level?: number): SurfacePoint;
  /** The height of the ground at (x, z). */
  seabedAt(x: number, z: number): number;
  /** How the water moves at a point: a slow drift, plus the orbit of the waves, fading with depth. */
  currentAt(x: number, y: number, z: number, t: number): Vec3;
}

/**
 * The waves a wind raises. Lengths run in a geometric series up to the wind's
 * own peak (Pierson-Moskowitz: the waves that travel about as fast as the
 * wind); each is as tall as the spectrum gives it and fans out around the
 * wind's heading, the short ones furthest.
 *
 * @param input The sea's seed, wind, heading and wave count.
 * @returns The waves, longest first.
 */
export function wavesOf(input: SeaInput = {}): Wave[] {
  const wind = Math.max(0.5, input.wind ?? 7);
  const count = Math.max(1, Math.floor(input.count ?? 12));
  const random = streamOf(input.seed ?? 1);
  const heading = input.heading ?? random() * TAU;
  const peak = (TAU * wind * wind * 1.3) / GRAVITY;
  const waves: Wave[] = [];
  let steep = 0;
  for (let index = 0; index < count; index += 1) {
    const length = peak * Math.pow(0.72, index) * (0.92 + random() * 0.16);
    const k = TAU / length;
    const spread = (0.25 + (index / count) * 0.9) * (random() * 2 - 1);
    const angle = heading + spread;
    // (A share of the peak wave's height that falls as the lengths shorten.)
    const amp = 0.012 * wind * wind * Math.pow(length / peak, 1.25) * (0.75 + random() * 0.5);
    steep += k * amp;
    waves.push({ dir: [Math.sin(angle), Math.cos(angle)], k, omega: Math.sqrt(GRAVITY * k), amp, q: 1, phase: random() * TAU });
  }
  // All the waves can crest in one spot, so their steepness has to share out MOST_STEEP between them.
  const q = Math.min(1.1, MOST_STEEP / Math.max(steep, 1e-6));
  return waves.map((wave) => ({ ...wave, q }));
}

function pack(waves: readonly Wave[]): Float32Array {
  const packed = new Float32Array(waves.length * 8);
  waves.forEach((wave, index) => {
    packed.set([wave.dir[0], wave.dir[1], wave.k, wave.omega, wave.amp, wave.q, wave.phase, 0], index * 8);
  });
  return packed;
}

/** Waves start to feel the bottom at this depth or a quarter of their length, whichever is less. */
const FEELS_BOTTOM = 6;

/**
 * How much of a wave survives over shallow water: short waves die on the way
 * in, and long ones keep enough to run up and back down a shore.
 *
 * @param k The wave's wavenumber.
 * @param depth Metres of water under it.
 * @returns A share of its height, 1 in deep water.
 */
export function shoalOf(k: number, depth: number): number {
  const share = smooth(clamp(depth / Math.min(1.6 / k, FEELS_BOTTOM), 0, 1));
  const kept = Math.min(0.45, 0.06 / k);
  return kept + (1 - kept) * share;
}

const SURF_PERIOD = 9;
const SURF_OMEGA = TAU / SURF_PERIOD;
/** Fronts travel at sqrt(g depth): on a beach's slope this is the phase that builds up on the way in, so they wrap to the shore. */
const SURF_TRAVEL = 9;

/** Where a set stands along the coast, in radians: fronts arrive at a slant and in sets. */
const slant = (x: number, z: number): number => Math.sin(x * 0.021 + z * 0.033) * 0.9 + Math.sin(x * 0.0071 - z * 0.011 + 1.3) * 1.3;

const sawOf = (phase: number): number => phase / TAU - Math.floor(phase / TAU);

/**
 * What the surf adds to the water near a shore: a front that steepens as the
 * depth runs out, collapses in the last metre, and runs up the sand as swash
 * before draining back. Only depth, place and time go in, so fronts follow the
 * ground's contours and bend into a bay by themselves.
 *
 * @param depth Water over the ground, negative where the ground stands above the tide.
 * @param x Where on the water.
 * @param z Where on the water.
 * @param t Seconds.
 * @param wind The sea's wind, which sets the surf's size.
 * @returns Metres added to the water's height.
 */
export function surfAt(depth: number, x: number, z: number, t: number, wind: number): number {
  const sets = 0.72 + 0.28 * Math.sin(t * 0.09 + slant(x, z));
  const phase = SURF_OMEGA * t + SURF_TRAVEL * Math.sqrt(Math.max(depth, 0)) + slant(x, z);
  const saw = sawOf(phase);
  const front = Math.pow(1 - saw, 3) * clamp(saw / 0.05, 0, 1);
  const build = smooth(clamp((4.5 - depth) / 3, 0, 1)) * smooth(clamp((depth - 0.15) / 0.7, 0, 1));
  const swash = Math.sin(SURF_OMEGA * t + slant(x, z) - 1.1) * 0.5 + 0.5;
  const shore = smooth(clamp((1.4 - depth) / 1.1, 0, 1));
  return (0.14 * wind * front * build + 0.07 * wind * swash * shore) * sets;
}

function displaceBy(waves: readonly Wave[], x: number, z: number, t: number, depth: number): Vec3 {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const wave of waves) {
    const theta = wave.k * (wave.dir[0] * x + wave.dir[1] * z) - wave.omega * t + wave.phase;
    const amp = wave.amp * shoalOf(wave.k, depth);
    const push = wave.q * amp * Math.cos(theta);
    dx += wave.dir[0] * push;
    dz += wave.dir[1] * push;
    dy += amp * Math.sin(theta);
  }
  return [x + dx, dy, z + dz];
}

function normalBy(waves: readonly Wave[], x: number, z: number, t: number, depth: number): Vec3 {
  let nx = 0;
  let nz = 0;
  let ny = 1;
  for (const wave of waves) {
    const theta = wave.k * (wave.dir[0] * x + wave.dir[1] * z) - wave.omega * t + wave.phase;
    const lift = wave.k * wave.amp * shoalOf(wave.k, depth);
    nx -= wave.dir[0] * lift * Math.cos(theta);
    nz -= wave.dir[1] * lift * Math.cos(theta);
    ny -= wave.q * lift * Math.sin(theta);
  }
  const length = Math.hypot(nx, ny, nz);
  return [nx / length, ny / length, nz / length];
}

function orbit(waves: readonly Wave[], x: number, y: number, z: number, t: number): Vec3 {
  let vx = 0;
  let vy = 0;
  let vz = 0;
  const below = Math.min(y, 0);
  for (const wave of waves) {
    const theta = wave.k * (wave.dir[0] * x + wave.dir[1] * z) - wave.omega * t + wave.phase;
    const speed = wave.omega * wave.amp * Math.exp(wave.k * below);
    vx += wave.dir[0] * speed * Math.sin(theta);
    vz += wave.dir[1] * speed * Math.sin(theta);
    vy -= speed * Math.cos(theta);
  }
  return [vx, vy, vz];
}

/**
 * Makes a sea.
 *
 * @param input Seed, wind, and the shape of the floor.
 * @returns A sea whose every answer is a pure function of its input.
 */
export function createSea(input: SeaInput = {}): Sea {
  const seed = (input.seed ?? 1) >>> 0;
  const wind = Math.max(0.5, input.wind ?? 7);
  const heading = input.heading ?? streamOf(seed ^ 0x51ed270b)() * TAU;
  const depth = input.depth ?? 22;
  const relief = input.relief ?? 9;
  const waves = wavesOf({ ...input, seed, wind, heading });
  const drift = 0.016 * wind;
  const floor = (x: number, z: number): number => {
    const hills = fractal(x * 0.018, z * 0.018, seed, 4) * 2 - 0.94;
    const ripples = Math.sin((x + 0.4 * z) * 0.9 + fractal(x * 0.05, z * 0.05, seed + 9, 2) * 9) * 0.05;
    return -depth + hills * relief + ripples;
  };
  const seabedAt = input.ground ?? floor;
  return {
    seed, wind, heading, depth, waves,
    packed: pack(waves),
    displace: (x, z, t) => displaceBy(waves, x, z, t, Math.max(0, -seabedAt(x, z))),
    surfaceAt(x, z, t, level = 0) {
      const signed = level - seabedAt(x, z);
      const water = Math.max(0, signed);
      let sx = x;
      let sz = z;
      for (let round = 0; round < SETTLE; round += 1) {
        const moved = displaceBy(waves, sx, sz, t, water);
        sx += x - moved[0];
        sz += z - moved[2];
      }
      return { height: level + displaceBy(waves, sx, sz, t, water)[1] + surfAt(signed, x, z, t, wind), normal: normalBy(waves, sx, sz, t, water) };
    },
    seabedAt,
    currentAt(x, y, z, t) {
      const swing = orbit(waves, x, y, z, t);
      const fade = Math.exp(clamp(y, -60, 0) * 0.05);
      return [Math.sin(heading) * drift * fade + swing[0], swing[1], Math.cos(heading) * drift * fade + swing[2]];
    },
  };
}

// ---------------------------------------------------------------- the tide

export interface TideInput {
  /** The moon's elevation above the horizon, degrees (celestial's `moonFrom`, or world-light's moon). */
  readonly moon: number;
  /** The sun's elevation, degrees. */
  readonly sun: number;
  /** The tide's height from dead low to dead high at springs, metres. */
  readonly range?: number;
}

const pull = (elevation: number): number => {
  const fromZenith = Math.sin((elevation * Math.PI) / 180);
  return (3 * fromZenith * fromZenith - 1) / 2;
};

/**
 * The equilibrium tide: water heaped under the moon and on the far side of the
 * Earth, the sun adding 46% as much. High when the moon is overhead or
 * underfoot, low when it is on the horizon, and largest when sun and moon agree.
 *
 * @param input Where the sun and moon stand, and the place's tidal range.
 * @returns The water's height above mean sea level, metres.
 */
export function tideAt(input: TideInput): number {
  const range = input.range ?? 2;
  return (((pull(input.moon) + pull(input.sun) * 0.46) / 1.46) * range) / 2;
}

// ---------------------------------------------------------------- light and depth

/** Hours from one high water to the next: half a lunar day. */
export const TIDE_PERIOD = 12.4206;
/** Hours from one spring tide to the next. */
const SPRING_PERIOD = 354.37;

export interface TideClock {
  /** The place's tidal range at springs, metres. */
  readonly range?: number;
  /** Hours after the clock's zero of the first high water. */
  readonly offset?: number;
}

/**
 * The tide at a clock time, for a scene with no moon to ask: high water every
 * 12 h 25 min, larger at springs and smaller at neaps.
 *
 * @param hours Hours since the clock's zero.
 * @param clock The range and the hour of high water.
 * @returns The water's height above mean sea level, metres.
 */
export function tideOn(hours: number, clock: TideClock = {}): number {
  const range = clock.range ?? 2;
  const at = hours - (clock.offset ?? 0);
  const springs = 0.75 + 0.25 * Math.cos((TAU * at) / SPRING_PERIOD);
  return (range / 2) * springs * Math.cos((TAU * at) / TIDE_PERIOD);
}

export interface TideTime {
  readonly kind: "high" | "low";
  /** Hours since the clock's zero. */
  readonly at: number;
}

/**
 * The next high and low waters after a time.
 *
 * @param hours Hours since the clock's zero.
 * @param clock The range and the hour of high water.
 * @param count How many turns of the tide to give.
 * @returns High and low waters in order.
 */
export function tideTimes(hours: number, clock: TideClock = {}, count = 4): TideTime[] {
  const half = TIDE_PERIOD / 2;
  const offset = clock.offset ?? 0;
  const first = Math.ceil((hours - offset) / half);
  return Array.from({ length: count }, (_, index) => ({ kind: (first + index) % 2 === 0 ? "high" : "low", at: offset + (first + index) * half }));
}

export type Zone = "sunlit" | "twilight" | "midnight";

/**
 * Which of the ocean's layers a depth lies in.
 *
 * @param depth Metres below the surface.
 * @returns sunlit to 200 m, twilight to 1000 m, midnight below.
 */
export function zoneAt(depth: number): Zone {
  if (depth < 200) return "sunlit";
  return depth < 1000 ? "twilight" : "midnight";
}

/** Clear ocean water's absorption of red, green and blue, per metre (Jerlov type I, roughly). */
export const CLEAR_WATER: Vec3 = [0.34, 0.052, 0.019];

/** A murky coast's, where plankton and silt take the blue as well (Jerlov type 3). */
export const COASTAL_WATER: Vec3 = [0.42, 0.14, 0.22];

/**
 * Beer-Lambert: the share of each colour of light left after crossing water.
 *
 * @param metres How far the light has travelled through the water.
 * @param absorption Per-metre absorption of red, green and blue.
 * @returns The share of red, green and blue that gets through, each in [0, 1].
 */
export function lightThrough(metres: number, absorption: Vec3 = CLEAR_WATER): Vec3 {
  const path = Math.max(0, metres);
  return [Math.exp(-absorption[0] * path), Math.exp(-absorption[1] * path), Math.exp(-absorption[2] * path)];
}

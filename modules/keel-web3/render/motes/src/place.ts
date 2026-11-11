// Where each mote starts and how it lives, from a seed. Only integer hashing, plus, minus, times and divide are used,
// so a seed lays the same field to the last bit on every engine; what moves after that is the vertex shader's.

export type Vec3 = readonly [number, number, number];

/** How a field of motes looks and moves. Every field has a default (`DEFAULT_MOTES`). */
export interface MoteSettings {
  /** How many motes, 0 to 4096. */
  readonly count: number;
  /** Lays the field: the same seed, the same field. */
  readonly seed: number;
  /** The box the motes live in: its centre and its size along x, y and z, in world units. */
  readonly centre: Vec3;
  readonly box: Vec3;
  /** A mote's size in world units, and how far it may differ, as a share either way (0.5: 0.5 to 1.5 times). */
  readonly size: number;
  readonly sizeSpread: number;
  /** The smallest a mote is drawn, in drawing-buffer pixels: a smaller one is drawn this big and dimmer. */
  readonly minPixels: number;
  /** Hex colours; each mote takes one, seeded. */
  readonly colors: readonly string[];
  /** Opacity at full blink, 0 to 1, and a multiplier on the colour (over 1 reaches a bloom threshold). */
  readonly opacity: number;
  readonly intensity: number;
  /** World units a second the whole field drifts; the box wraps, so the field never empties. */
  readonly drift: Vec3;
  /** How far, in world units, each mote wanders about its drifting place. */
  readonly turbulence: number;
  /** The shortest and longest blink period, seconds; each mote takes one between, seeded. */
  readonly blinkPeriod: readonly [number, number];
  /** How deep the blink goes: 0 a steady light, 1 out to nothing at the trough. */
  readonly blink: number;
  /** The share of motes drawn as four-pointed sparkles, 0 to 1. */
  readonly sparkle: number;
  /** True: `size` is in world units and shrinks with distance. False: `size` is in drawing-buffer pixels. */
  readonly attenuate: boolean;
}

export const DEFAULT_MOTES: MoteSettings = {
  count: 300,
  seed: 1,
  centre: [0, 0, 0],
  box: [3, 3, 4],
  size: 0.07,
  sizeSpread: 0.5,
  minPixels: 1.5,
  colors: ["#ffbe26"],
  opacity: 0.88,
  intensity: 1,
  drift: [0.014, 0.014, 0],
  turbulence: 0.03,
  blinkPeriod: [2, 5],
  blink: 1,
  sparkle: 0,
  attenuate: true,
};

/** Where motes are welcome, 0 (never) to 1 (always), at a point in world units; the field is thinned by it. */
export type MoteDensity = (x: number, y: number, z: number) => number;

/**
 * The field laid out, one entry a mote. `mote` is four numbers a mote: x, y, z and the blink phase in radians. `life`
 * is four: the blink period in seconds, the size, 1 for a sparkle or 0 for a dot, and a seed from 0 to 1 for the
 * turbulence. `color` is each mote's index into the colours.
 */
export interface MoteField {
  readonly count: number;
  readonly mote: Float32Array;
  readonly life: Float32Array;
  readonly color: Uint8Array;
}

const TURN = 6.283185307179586;
const MAX_COUNT = 4096;
/** How many places a mote tries before it settles for the last, when a density thins the field. */
const TRIES = 8;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A uniform number in [0, 1) for a seed, a mote and a channel: a 32-bit integer hash, exact everywhere. */
export function moteHash(seed: number, index: number, channel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77) ^ Math.imul(channel + 1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Settings with every missing or out-of-range field put right. */
export function moteSettings(partial: Partial<MoteSettings> = {}): MoteSettings {
  const s = { ...DEFAULT_MOTES, ...partial };
  const lo = Math.max(0.05, Math.min(s.blinkPeriod[0], s.blinkPeriod[1]));
  return {
    ...s,
    count: clamp(Math.floor(s.count), 0, MAX_COUNT),
    seed: s.seed | 0,
    box: [Math.max(1e-3, s.box[0]), Math.max(1e-3, s.box[1]), Math.max(1e-3, s.box[2])],
    size: Math.max(0, s.size),
    sizeSpread: clamp(s.sizeSpread, 0, 1),
    minPixels: Math.max(0, s.minPixels),
    colors: s.colors.length > 0 ? s.colors.slice(0, 255) : DEFAULT_MOTES.colors,
    opacity: clamp(s.opacity, 0, 1),
    intensity: Math.max(0, s.intensity),
    turbulence: Math.max(0, s.turbulence),
    blinkPeriod: [lo, Math.max(lo, s.blinkPeriod[0], s.blinkPeriod[1])],
    blink: clamp(s.blink, 0, 1),
    sparkle: clamp(s.sparkle, 0, 1),
  };
}

/** A place in the box for mote `index`'s try `attempt`. */
function placeIn(s: MoteSettings, index: number, attempt: number): Vec3 {
  const c = attempt * 3;
  return [
    s.centre[0] + (moteHash(s.seed, index, c) - 0.5) * s.box[0],
    s.centre[1] + (moteHash(s.seed, index, c + 1) - 0.5) * s.box[1],
    s.centre[2] + (moteHash(s.seed, index, c + 2) - 0.5) * s.box[2],
  ];
}

/** The first of a few seeded places the density takes, or the last tried. */
function choosePlace(s: MoteSettings, index: number, density: MoteDensity | undefined): Vec3 {
  let at = placeIn(s, index, 0);
  if (!density) return at;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    at = placeIn(s, index, attempt);
    if (moteHash(s.seed, index, 100 + attempt) < density(at[0], at[1], at[2])) return at;
  }
  return at;
}

/**
 * Lays a field of motes from its settings: the same settings and seed give the same numbers on every engine.
 *
 * @param partial Settings; anything missing takes `DEFAULT_MOTES`.
 * @param density Optional: where motes are welcome, to make a field denser in some places than others.
 * @returns The field, ready to upload as instance attributes.
 */
export function placeMotes(partial: Partial<MoteSettings> = {}, density?: MoteDensity): MoteField {
  const s = moteSettings(partial);
  const mote = new Float32Array(s.count * 4);
  const life = new Float32Array(s.count * 4);
  const color = new Uint8Array(s.count);
  const [shortest, longest] = s.blinkPeriod;
  for (let i = 0; i < s.count; i += 1) {
    const at = choosePlace(s, i, density);
    mote.set([at[0], at[1], at[2], moteHash(s.seed, i, 40) * TURN], i * 4);
    const size = s.size * (1 + (moteHash(s.seed, i, 42) * 2 - 1) * s.sizeSpread);
    const sparkle = moteHash(s.seed, i, 43) < s.sparkle ? 1 : 0;
    const period = shortest + moteHash(s.seed, i, 41) * (longest - shortest);
    life.set([period, size, sparkle, moteHash(s.seed, i, 44)], i * 4);
    color[i] = Math.floor(moteHash(s.seed, i, 45) * s.colors.length);
  }
  return { count: s.count, mote, life, color };
}

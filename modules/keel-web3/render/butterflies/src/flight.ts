// Where each butterfly is at a time: a sum of three sines an axis about a centre, its rates and phases from a seed.
// The seeded numbers use only integer hashing, plus, minus, times and divide, so a seed is the same flock on every
// engine; the sines of the time are the only thing worked out per frame.

export type Vec3 = readonly [number, number, number];

/** A sphere no butterfly enters (a face, a product): one that would is pushed to its surface. */
export interface KeepOut {
  readonly centre: Vec3;
  readonly radius: number;
}

/** The three colours of a butterfly, as hex. */
export interface ButterflyColors {
  /** The wings' upper side, their underside, and the body. */
  readonly upper: string;
  readonly under: string;
  readonly body: string;
}

/** How a flock looks and flies. Every field has a default (`DEFAULT_BUTTERFLIES`). */
export interface ButterflySettings {
  /** How many, 0 to 50. */
  readonly count: number;
  /** Lays the flock: the same seed, the same flights. */
  readonly seed: number;
  /** The point they wander about, and how far along x, y and z they may go from it, world units. */
  readonly centre: Vec3;
  readonly radius: Vec3;
  /** Wingspan, world units. */
  readonly scale: number;
  /** The slowest wander's rate, radians a second; the faster sines run at about 2 and 4 times it. */
  readonly speed: number;
  /** Wingbeats a second. */
  readonly flapHz: number;
  readonly colors: ButterflyColors;
  /** Multiplies the white edge light: over about 1 it reaches a bloom threshold of 1, so the edges glow. */
  readonly glow: number;
  /** Multiplies the wing and body colours. */
  readonly light: number;
  readonly keepOut: readonly KeepOut[];
}

export const DEFAULT_BUTTERFLIES: ButterflySettings = {
  count: 4,
  seed: 1,
  centre: [0, 0, 0],
  radius: [1.2, 0.6, 0.6],
  scale: 0.06,
  speed: 0.3,
  flapHz: 6,
  colors: { upper: "#2d5de0", under: "#7ea2ff", body: "#1b2f6e" },
  glow: 1.5,
  light: 1,
  keepOut: [],
};

/** One butterfly's flight: three rates, amplitudes and phases an axis (x0 x1 x2 y0 ... z2), and its wingbeat phase. */
export interface Flight {
  readonly rate: readonly number[];
  readonly reach: readonly number[];
  readonly phase: readonly number[];
  readonly flap: number;
}

/** Where a butterfly is and the way it faces (a unit vector). */
export interface Pose {
  readonly at: Vec3;
  readonly front: Vec3;
}

const TURN = 6.283185307179586;
const MAX_COUNT = 50;
/** Each sine's share of the reach (they sum to 1, so a flight stays inside the radius), and its rate's multiple. */
const SHARE = [0.6, 0.28, 0.12];
const PACE = [1, 2.1, 3.9];

/** A uniform number in [0, 1) for a seed, a butterfly and a channel: a 32-bit integer hash, exact everywhere. */
export function flightHash(seed: number, index: number, channel: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77) ^ Math.imul(channel + 1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Settings with every missing or out-of-range field put right. */
export function butterflySettings(partial: Partial<ButterflySettings> = {}): ButterflySettings {
  const s = { ...DEFAULT_BUTTERFLIES, ...partial };
  return {
    ...s,
    count: clamp(Math.floor(s.count), 0, MAX_COUNT),
    seed: s.seed | 0,
    radius: [Math.max(0, s.radius[0]), Math.max(0, s.radius[1]), Math.max(0, s.radius[2])],
    scale: Math.max(0, s.scale),
    speed: Math.max(0, s.speed),
    flapHz: Math.max(0, s.flapHz),
    colors: { ...DEFAULT_BUTTERFLIES.colors, ...s.colors },
    glow: Math.max(0, s.glow),
    light: Math.max(0, s.light),
  };
}

/**
 * Lays a flock's flights from its settings: the same seed gives the same numbers on every engine.
 *
 * @param partial Settings; anything missing takes `DEFAULT_BUTTERFLIES`.
 * @returns One flight a butterfly.
 */
export function planFlights(partial: Partial<ButterflySettings> = {}): Flight[] {
  const s = butterflySettings(partial);
  const flights: Flight[] = [];
  for (let i = 0; i < s.count; i += 1) {
    const rate: number[] = [];
    const reach: number[] = [];
    const phase: number[] = [];
    for (let axis = 0; axis < 3; axis += 1) {
      for (let k = 0; k < 3; k += 1) {
        const channel = axis * 3 + k;
        rate.push(s.speed * (PACE[k] ?? 1) * (0.7 + 0.6 * flightHash(s.seed, i, channel)));
        reach.push((s.radius[axis] ?? 0) * (SHARE[k] ?? 0));
        phase.push(flightHash(s.seed, i, 10 + channel) * TURN);
      }
    }
    flights.push({ rate, reach, phase, flap: flightHash(s.seed, i, 20) * TURN });
  }
  return flights;
}

/** Pushes a point out of every keep-out sphere it is inside (straight up from a sphere's very centre). */
function keptOut(p: [number, number, number], keepOut: readonly KeepOut[]): void {
  for (const zone of keepOut) {
    const d = [p[0] - zone.centre[0], p[1] - zone.centre[1], p[2] - zone.centre[2]] as const;
    const far = Math.hypot(d[0], d[1], d[2]);
    if (far >= zone.radius) continue;
    const away = far > 1e-9 ? [d[0] / far, d[1] / far, d[2] / far] : [0, 1, 0];
    for (let axis = 0; axis < 3; axis += 1) p[axis] = (zone.centre[axis] ?? 0) + (away[axis] ?? 0) * zone.radius;
  }
}

/** Faces along the velocity, held near level: a butterfly climbs and dives less than it wanders. */
function frontOf(v: readonly number[]): Vec3 {
  const x = v[0] ?? 0;
  const y = (v[1] ?? 0) * 0.5;
  const z = v[2] ?? 0;
  const length = Math.hypot(x, y, z);
  return length > 1e-9 ? [x / length, y / length, z / length] : [0, 0, 1];
}

/**
 * Where a butterfly is at a time, and the way it faces.
 *
 * @param flight One of `planFlights`'s flights.
 * @param time Seconds on the host's clock.
 * @param settings The flock's settings (its centre and keep-outs).
 * @returns The pose.
 */
export function flyAt(flight: Flight, time: number, settings: Partial<ButterflySettings> = {}): Pose {
  const centre = settings.centre ?? DEFAULT_BUTTERFLIES.centre;
  const at: [number, number, number] = [centre[0], centre[1], centre[2]];
  const velocity = [0, 0, 0];
  for (let j = 0; j < 9; j += 1) {
    const axis = Math.floor(j / 3);
    const rate = flight.rate[j] ?? 0;
    const reach = flight.reach[j] ?? 0;
    const angle = rate * time + (flight.phase[j] ?? 0);
    at[axis] = (at[axis] ?? 0) + reach * Math.sin(angle);
    velocity[axis] = (velocity[axis] ?? 0) + reach * rate * Math.cos(angle);
  }
  keptOut(at, settings.keepOut ?? []);
  return { at, front: frontOf(velocity) };
}

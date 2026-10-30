/**
 * Life in the water: who lives in a sea, where each one is at any moment, and
 * its body at that moment as capsule parts. Deterministic and renderer-free. MIT.
 *
 *   const cast = castFor({ seed, sea });
 *   const swim = createSwim(cast, sea);
 *   for (const swimmer of swim.at(t)) draw(poseSwimmer(swimmer));
 *
 * Nothing here steps a simulation. Every swimmer is a closed-form function of
 * the seed and t: a school follows a path that a shark's path crosses, each
 * fish trails the path by its own lag and holds its own place in the ball, and
 * opens a hole round the shark as it passes. So any moment can be asked for in
 * any order, no moment costs more than the last, and two viewers of one seed
 * see the same fish in the same places.
 *
 * Frame (shared with fauna): +y up, a body's front is its +z, its right hand +x.
 */

export type Vec = readonly [number, number, number];

/** The part of a sea this module swims in: `generative/ocean`'s Sea fits it. */
export interface SeaLike {
  surfaceAt(x: number, z: number, t: number): { readonly height: number };
  seabedAt(x: number, z: number): number;
  displace(x: number, z: number, t: number): Vec;
}

/** One capsule of a body, as `render/sdf-body` draws it. */
export interface Part {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: string;
  readonly r1?: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly melt?: number;
  readonly decal?: boolean;
  readonly carve?: boolean;
  readonly bow?: Vec;
  readonly shadow?: boolean;
  readonly detail?: number;
}

export interface MarineBody {
  readonly capsules: readonly Part[];
  readonly palette: Readonly<Record<string, string>>;
  readonly front: Vec;
  readonly at: Vec;
  readonly glow?: number;
  readonly material?: { readonly gloss?: number; readonly sheen?: number; readonly iridescence?: number };
}

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const smooth = (value: number): number => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec, fallback: Vec = [0, 0, 1]): Vec => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : fallback;
};
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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

// ---------------------------------------------------------------- who lives here

export type Plan = "fish" | "jelly";

/** One station along a fish: how far back it lies, and the body's half-height there, both as shares of its length. */
type Station = readonly [back: number, half: number];

export interface Species {
  readonly label: string;
  readonly plan: Plan;
  /** Length, or a jelly's bell across, metres. */
  readonly size: number;
  /** Zones it lives in. */
  readonly zones: readonly string[];
  /** Tail beats (or bell pulses) a second. */
  readonly beat: number;
  /** How far the tail swings, as a share of its length. */
  readonly swing: number;
  /** How wide the body is to how tall (under 1 a thin fish). */
  readonly slim: number;
  readonly stations: readonly Station[];
  readonly palette: Readonly<Record<string, string>>;
}

export const SPECIES: Readonly<Record<string, Species>> = {
  sardine: {
    label: "Sardine", plan: "fish", size: 0.34, zones: ["sunlit"], beat: 3.2, swing: 0.13, slim: 0.62,
    stations: [[0, 0.03], [0.1, 0.075], [0.3, 0.1], [0.55, 0.085], [0.78, 0.045], [0.9, 0.02]],
    palette: { back: "#2c6a86", flank: "#b9ced6", belly: "#eef3f2", fin: "#7f9ba6", eye: "#0c1014" },
  },
  shark: {
    label: "Reef shark", plan: "fish", size: 2.3, zones: ["sunlit"], beat: 0.9, swing: 0.11, slim: 0.86,
    stations: [[0, 0.018], [0.08, 0.055], [0.24, 0.1], [0.42, 0.098], [0.62, 0.062], [0.8, 0.028], [0.88, 0.015]],
    palette: { back: "#5e6c74", flank: "#7d8a90", belly: "#e6e8e4", fin: "#4f5c64", eye: "#090b0d" },
  },
  jelly: {
    label: "Moon jelly", plan: "jelly", size: 0.42, zones: ["sunlit", "twilight"], beat: 0.55, swing: 0.2, slim: 1,
    stations: [],
    palette: { bell: "#cfe0ee", rim: "#f3c4d4", inner: "#e9a8c0", arm: "#e8dcea", tentacle: "#dbe6f2" },
  },
};

export const SPECIES_IDS = Object.keys(SPECIES);

const speciesOf = (id: string): Species => {
  const species = SPECIES[id];
  if (!species) throw new RangeError(`marine: no species "${id}"`);
  return species;
};

/** One group in the sea. */
export interface Company {
  readonly id: string;
  readonly count: number;
  readonly home: Vec;
  /** How far from home it ranges, metres. */
  readonly reach: number;
  readonly seed: number;
}

export interface Cast {
  readonly seed: number;
  readonly companies: readonly Company[];
}

export interface CastInput {
  readonly seed?: number;
  readonly sea: SeaLike;
  /** Which zone of the ocean this water is. */
  readonly zone?: string;
  /** Where the scene's middle is, on the water. */
  readonly center?: readonly [number, number];
  /** How much life, 1 by default. */
  readonly plenty?: number;
}

/**
 * Casts a sea: a school, the shark that follows it, and the jellies drifting
 * through. A zone only gets the species that live in it.
 *
 * @param input The seed, the sea, and how much life.
 * @returns The companies living here.
 */
export function castFor(input: CastInput): Cast {
  const seed = (input.seed ?? 1) >>> 0;
  const random = streamOf(seed ^ 0x2f0b4a87);
  const zone = input.zone ?? "sunlit";
  const [cx, cz] = input.center ?? [0, 0];
  const plenty = input.plenty ?? 1;
  const middle = input.sea.seabedAt(cx, cz) * 0.5;
  const lives = (id: string): boolean => speciesOf(id).zones.includes(zone);
  const companies: Company[] = [];
  const add1 = (id: string, count: number, reach: number): void => {
    if (lives(id)) companies.push({ id, count: Math.max(1, Math.round(count * plenty)), home: [cx, middle, cz], reach, seed: Math.floor(random() * 2 ** 32) });
  };
  add1("sardine", 140 + random() * 80, 12);
  add1("shark", 1 + Math.floor(random() * 1.6), 18);
  add1("jelly", 6 + random() * 6, 16);
  return { seed, companies };
}

// ---------------------------------------------------------------- where they are

/** One animal at one moment. Plain data: nothing here has a body until it is posed. */
export interface Swimmer {
  readonly id: string;
  readonly index: number;
  readonly at: Vec;
  readonly front: Vec;
  /** Where its tail or bell is in its beat, radians. */
  readonly phase: number;
  /** Its length as a share of its species'. */
  readonly build: number;
  readonly seed: number;
}

export interface Swim {
  /** Everyone, at the moment t. */
  at(t: number): Swimmer[];
}

type Path = (t: number) => Vec;

/** A smooth wander round home, in three sines to an axis so it never quite repeats. */
function wanderOf(company: Company, pace: number): Path {
  const random = streamOf(company.seed);
  // (Up and down runs slower than across: a swimmer rises and dives far less steeply than it turns.)
  const terms = [1, 0.35, 1].map((calm) => [0, 1, 2].map((order) => ({ rate: pace * calm * (0.6 + random() * 0.8) * (order + 1), phase: random() * TAU, weight: 1 / (order + 1.4) })));
  const reaches = [company.reach, company.reach * 0.22, company.reach];
  const axis = (index: number, t: number): number => (terms[index] ?? []).reduce((sum, term) => sum + term.weight * Math.sin(term.rate * t + term.phase), 0) * (reaches[index] ?? 0);
  return (t) => [company.home[0] + axis(0, t), company.home[1] + axis(1, t), company.home[2] + axis(2, t)];
}

/** Holds a point inside the water, `margin` from its surface and floor. */
function inWater(sea: SeaLike, at: Vec, t: number, margin: number): Vec {
  const top = sea.surfaceAt(at[0], at[2], t).height - margin;
  const floor = sea.seabedAt(at[0], at[2]) + margin;
  return [at[0], clamp(at[1], floor, Math.max(floor, top)), at[2]];
}

/** A random point in a ball, more of them toward its middle. */
function placeInBall(random: () => number): Vec {
  const toward = unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]);
  return scale(toward, Math.pow(random(), 0.5));
}

interface Fin {
  readonly lag: number;
  readonly place: Vec;
  readonly rates: Vec;
  readonly phase: number;
  readonly build: number;
}

function schoolOf(company: Company): Fin[] {
  const random = streamOf(company.seed ^ 0x7a3d91c5);
  return Array.from({ length: company.count }, () => ({
    lag: random() * 2.2,
    place: placeInBall(random),
    rates: [0.3 + random() * 0.5, 0.3 + random() * 0.5, 0.3 + random() * 0.5],
    phase: random() * TAU,
    build: 0.85 + random() * 0.3,
  }));
}

const SCHOOL_RADIUS = 3.4;
/** How far a fish keeps from a shark. */
const FEAR_RADIUS = 3.8;

function fishPlace(path: Path, sharks: readonly Path[], fin: Fin, t: number): Vec {
  const center = path(t - fin.lag);
  const breath = 1 + 0.16 * Math.sin(t * 0.21 + fin.phase * 0.2);
  const stir: Vec = [Math.sin(t * fin.rates[0] + fin.phase) * 0.5, Math.sin(t * fin.rates[1] + fin.phase * 2) * 0.3, Math.sin(t * fin.rates[2] + fin.phase * 3) * 0.5];
  const place = add(center, add(scale(fin.place, SCHOOL_RADIUS * breath), stir));
  return sharks.reduce<Vec>((at, shark) => {
    const away = sub(at, shark(t));
    const gap = length(away);
    return gap < FEAR_RADIUS ? add(at, scale(unit(away), (FEAR_RADIUS - gap) * smooth(1 - gap / FEAR_RADIUS + 0.35))) : at;
  }, place);
}

function fearOf(sharks: readonly Path[], at: Vec, t: number): number {
  return sharks.reduce((most, shark) => Math.max(most, smooth(1 - length(sub(at, shark(t))) / (FEAR_RADIUS * 2))), 0);
}

function schoolAt(company: Company, school: readonly Fin[], sea: SeaLike, path: Path, sharks: readonly Path[], t: number): Swimmer[] {
  const species = speciesOf(company.id);
  const held: Path = (when) => inWater(sea, path(when), when, SCHOOL_RADIUS * 0.8);
  return school.map((fin, index) => {
    const at = fishPlace(held, sharks, fin, t);
    const front = unit(sub(at, fishPlace(held, sharks, fin, t - 0.14)));
    const beat = species.beat * TAU * t * (1 + 1.4 * fearOf(sharks, at, t));
    return { id: company.id, index, at, front, phase: beat + fin.phase, build: fin.build, seed: company.seed + index };
  });
}

function loners(company: Company, sea: SeaLike, paths: readonly Path[], t: number): Swimmer[] {
  const species = speciesOf(company.id);
  return paths.map((path, index) => {
    const held: Path = (when) => inWater(sea, path(when), when, species.size);
    return { id: company.id, index, at: held(t), front: unit(sub(held(t + 0.3), held(t - 0.3))), phase: species.beat * TAU * t + index, build: 1, seed: company.seed + index };
  });
}

function jellyAt(company: Company, sea: SeaLike, index: number, t: number): Swimmer {
  const species = speciesOf(company.id);
  const random = streamOf(company.seed + index * 7919);
  const home: Vec = [company.home[0] + (random() * 2 - 1) * company.reach, company.home[1] + (random() * 2 - 1) * 7, company.home[2] + (random() * 2 - 1) * company.reach];
  const rate = 0.05 + random() * 0.05;
  const phase = random() * TAU;
  const tilt = 0.2 + random() * 0.3;
  const beat = species.beat * (0.85 + random() * 0.3) * TAU * t + phase;
  // It rises a little on each pulse and sinks between, and the waves carry it to and fro with the water round it.
  const rest: Vec = [home[0], home[1] + Math.sin(t * rate + phase) * 2.4 + Math.sin(beat - 1) * 0.05, home[2]];
  const moved = sea.displace(rest[0], rest[2], t);
  const carried = Math.exp(clamp(rest[1], -60, 0) * 0.14);
  const at = inWater(sea, [rest[0] + (moved[0] - rest[0]) * carried, rest[1] + moved[1] * carried, rest[2] + (moved[2] - rest[2]) * carried], t, species.size);
  return { id: company.id, index, at, front: unit([Math.sin(t * rate * 2 + phase) * tilt, 1, Math.cos(t * rate * 1.6 + phase) * tilt]), phase: beat, build: 0.8 + random() * 0.45, seed: company.seed + index };
}

/**
 * Sets a cast swimming in a sea.
 *
 * @param cast Who lives here, from {@link castFor}.
 * @param sea The water they swim in.
 * @returns A swim whose `at(t)` is a pure function of the cast, the sea and t.
 */
export function createSwim(cast: Cast, sea: SeaLike): Swim {
  const school = cast.companies.filter((company) => speciesOf(company.id).plan === "fish" && company.count > 8);
  const hunters = cast.companies.filter((company) => speciesOf(company.id).plan === "fish" && company.count <= 8);
  const drifters = cast.companies.filter((company) => speciesOf(company.id).plan === "jelly");
  const schoolPaths = new Map(school.map((company) => [company, { path: wanderOf(company, 0.075), fins: schoolOf(company) }]));
  const hunterPaths = new Map(hunters.map((company) => [company, Array.from({ length: company.count }, (_, index) => wanderOf({ ...company, seed: company.seed + index * 104729 }, 0.06))]));
  const sharks = [...hunterPaths.values()].flat();
  return {
    at(t) {
      const swimmers: Swimmer[] = [];
      for (const [company, { path, fins }] of schoolPaths) swimmers.push(...schoolAt(company, fins, sea, path, sharks, t));
      for (const [company, paths] of hunterPaths) swimmers.push(...loners(company, sea, paths, t));
      for (const company of drifters) for (let index = 0; index < company.count; index += 1) swimmers.push(jellyAt(company, sea, index, t));
      return swimmers;
    },
  };
}

// ---------------------------------------------------------------- bodies

interface Frame {
  readonly o: Vec;
  readonly x: Vec;
  readonly y: Vec;
  readonly z: Vec;
}

function frameOf(o: Vec, front: Vec): Frame {
  const z = unit(front);
  const side = cross([0, 1, 0], z);
  const x = length(side) > 1e-4 ? unit(side) : [1, 0, 0] as Vec;
  return { o, x, y: cross(z, x), z };
}

const place = (f: Frame, x: number, y: number, z: number): Vec => [
  f.o[0] + f.x[0] * x + f.y[0] * y + f.z[0] * z,
  f.o[1] + f.x[1] * x + f.y[1] * y + f.z[1] * z,
  f.o[2] + f.x[2] * x + f.y[2] * y + f.z[2] * z,
];
const turn = (f: Frame, x: number, y: number, z: number): Vec => unit(sub(place(f, x, y, z), f.o));

/** Options for {@link poseSwimmer}. */
export interface PoseOptions {
  /** Hold the body straight: the shape a renderer can cut a far copy from. */
  readonly rest?: boolean;
}

/** A fish's swing at a share of the way down its body: nothing at the head, most at the tail, travelling backward. */
const swingAt = (back: number, phase: number, swing: number, size: number): number => swing * size * back * back * Math.sin(phase - back * 5.2);

function trunkParts(f: Frame, species: Species, size: number, phase: number, swing: number): Part[] {
  const stations = species.stations;
  const point = (back: number): Vec => place(f, swingAt(back, phase, swing, size), 0, size * (0.5 - back));
  const parts: Part[] = [];
  for (let index = 0; index + 1 < stations.length; index += 1) {
    const [from, r] = stations[index] ?? [0, 0];
    const [to, r1] = stations[index + 1] ?? [0, 0];
    parts.push({ a: point(from), b: point(to), r: r * size, r1: r1 * size, role: "flank", flat: species.slim, up: turn(f, 1, 0, 0) });
  }
  // Countershading: dark above, pale below, painted along the same swing.
  for (let index = 0; index + 2 < stations.length; index += 2) {
    const [from, r] = stations[index] ?? [0, 0];
    const [to, r1] = stations[index + 2] ?? [0, 0];
    const low = (back: number, half: number): Vec => place(f, swingAt(back, phase, swing, size), -half * size * 0.75, size * (0.5 - back));
    const high = (back: number, half: number): Vec => place(f, swingAt(back, phase, swing, size), half * size * 0.8, size * (0.5 - back));
    parts.push({ a: high(from, r), b: high(to, r1), r: r * size * 0.62, r1: r1 * size * 0.62, role: "back", decal: true, melt: 0.7 });
    parts.push({ a: low(from, r), b: low(to, r1), r: r * size * 0.62, r1: r1 * size * 0.62, role: "belly", decal: true, melt: 0.7 });
  }
  return parts;
}

function caudalParts(f: Frame, size: number, phase: number, swing: number, top: number, low: number): Part[] {
  const root = place(f, swingAt(0.9, phase, swing, size), 0, -size * 0.4);
  const tip = (rise: number): Vec => place(f, swingAt(1, phase, swing, size) * 1.25, rise * size, -size * (0.5 + Math.abs(rise) * 0.55));
  const up = turn(f, 1, 0, 0);
  return [
    { a: root, b: tip(top), r: size * 0.032, r1: size * 0.004, role: "fin", flat: 0.22, up, melt: 0.5 },
    { a: root, b: tip(-low), r: size * 0.032, r1: size * 0.004, role: "fin", flat: 0.22, up, melt: 0.5 },
  ];
}

function finParts(f: Frame, size: number, phase: number, swing: number, species: Species): Part[] {
  const shark = species.size > 1;
  const up = turn(f, 1, 0, 0);
  const sail = (back: number, height: number, lean: number, r: number): Part => {
    const x = swingAt(back, phase, swing, size);
    const half = species.stations[2]?.[1] ?? 0.1;
    return { a: place(f, x, half * size * 0.7, size * (0.5 - back)), b: place(f, swingAt(back + lean, phase, swing, size), (half + height) * size, size * (0.5 - back - lean)), r: size * r, r1: size * 0.004, role: "fin", flat: 0.2, up, melt: 0.5 };
  };
  const pectoral = (side: number): Part => {
    const back = shark ? 0.27 : 0.24;
    const reach = shark ? 0.19 : 0.1;
    const z = size * (0.5 - back);
    const x = swingAt(back, phase, swing, size);
    return { a: place(f, x + side * size * 0.05, -size * 0.05, z), b: place(f, x + side * size * reach, -size * reach * 0.6, z - size * reach * 0.7), r: size * (shark ? 0.04 : 0.018), r1: size * 0.004, role: "fin", flat: 0.2, up: turn(f, 0, 1, 0), melt: 0.5, detail: 2 };
  };
  const dorsal = shark ? sail(0.36, 0.13, 0.08, 0.05) : sail(0.42, 0.05, 0.06, 0.02);
  return [dorsal, pectoral(1), pectoral(-1), ...(shark ? [sail(0.7, 0.03, 0.05, 0.016)] : [])];
}

function eyeParts(f: Frame, size: number, phase: number, swing: number, species: Species): Part[] {
  const shark = species.size > 1;
  const back = shark ? 0.1 : 0.11;
  const r = size * (shark ? 0.0085 : 0.022);
  const out = (species.stations[1]?.[1] ?? 0.07) * size * species.slim * 0.92;
  const z = size * (0.5 - back);
  const x = swingAt(back, phase, swing, size);
  const eye = (side: number): Part => {
    const at = place(f, x + side * out, size * 0.012, z);
    return { a: at, b: at, r, role: "eye", shadow: false };
  };
  return [eye(1), eye(-1)];
}

function fishBody(swimmer: Swimmer, species: Species, options: PoseOptions): MarineBody {
  const size = species.size * swimmer.build;
  const f = frameOf(swimmer.at, swimmer.front);
  const swing = options.rest === true ? 0 : species.swing;
  const phase = swimmer.phase;
  const shark = species.size > 1;
  const capsules = [
    ...trunkParts(f, species, size, phase, swing),
    ...caudalParts(f, size, phase, swing, shark ? 0.2 : 0.11, shark ? 0.1 : 0.11),
    ...finParts(f, size, phase, swing, species),
    ...eyeParts(f, size, phase, swing, species),
  ];
  return { capsules, palette: species.palette, front: f.z, at: swimmer.at, material: shark ? { gloss: 0.3 } : { gloss: 0.9, sheen: 0.5, iridescence: 0.4 } };
}

function tentacle(f: Frame, size: number, angle: number, reach: number, phase: number, role: string, r: number): Part[] {
  const out = (share: number): number => share * Math.cos(phase * 0.5 + angle) * 0.1 + 0.42;
  const stop = (share: number): Vec => {
    const wave = Math.sin(phase * 0.6 - share * 4 + angle * 3) * 0.1 * share;
    const spread = out(share) * size + wave * size;
    return place(f, Math.cos(angle) * spread, -share * reach * size, Math.sin(angle) * spread);
  };
  const shares = [0, 0.35, 0.7, 1];
  const parts: Part[] = [];
  for (let index = 0; index + 1 < shares.length; index += 1) {
    parts.push({ a: stop(shares[index] ?? 0), b: stop(shares[index + 1] ?? 1), r: r * size * (1 - (index / 3) * 0.7), r1: r * size * (1 - ((index + 1) / 3) * 0.7), role, melt: 0.3, shadow: false, detail: 1 });
  }
  return parts;
}

function jellyBody(swimmer: Swimmer, species: Species): MarineBody {
  const size = species.size * swimmer.build;
  // A jelly's front is the top of its bell: it swims bell first, so its frame stands on that.
  const axis = unit(swimmer.front, [0, 1, 0]);
  const seam = frameOf(swimmer.at, axis);
  const f: Frame = { o: swimmer.at, x: seam.x, y: axis, z: seam.y };
  const squeeze = Math.pow(Math.sin(swimmer.phase) * 0.5 + 0.5, 2);
  const wide = size * (0.5 - squeeze * 0.09);
  const crown = place(f, 0, size * (0.06 + squeeze * 0.05), 0);
  const capsules: Part[] = [
    { a: crown, b: crown, r: wide, role: "bell", flat: 0.56 + squeeze * 0.14, up: axis },
    { a: place(f, 0, -size * 0.2, 0), b: place(f, 0, -size * 0.2, 0), r: wide * 0.82, role: "bell", carve: true, melt: 0.6 },
    { a: place(f, 0, size * 0.03, 0), b: place(f, 0, size * 0.03, 0), r: wide * 0.42, role: "inner", decal: true, melt: 1.4 },
    { a: place(f, wide, -size * 0.07, 0), b: place(f, wide * -1, -size * 0.07, 0), r: size * 0.02, role: "rim", decal: true, melt: 1.4 },
  ];
  for (let index = 0; index < 4; index += 1) capsules.push(...tentacle(f, size * 0.4, (index / 4) * TAU + 0.6, 1.5, swimmer.phase, "arm", 0.09));
  for (let index = 0; index < 6; index += 1) capsules.push(...tentacle(f, size, (index / 6) * TAU, 1.1, swimmer.phase + index, "tentacle", 0.013));
  return { capsules, palette: species.palette, front: axis, at: swimmer.at, glow: 0.3, material: { gloss: 0.8 } };
}

/**
 * The body of a swimmer at its moment, as capsule parts.
 *
 * @param swimmer One animal, from {@link Swim.at}.
 * @param options `rest` straightens it, for cutting a far copy from the same body.
 * @returns A body `render/sdf-body` can draw.
 */
export function poseSwimmer(swimmer: Swimmer, options: PoseOptions = {}): MarineBody {
  const species = speciesOf(swimmer.id);
  return species.plan === "jelly" ? jellyBody(swimmer, species) : fishBody(swimmer, species, options);
}

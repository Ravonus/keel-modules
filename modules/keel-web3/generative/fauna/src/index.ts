/**
 * Living things for a KEEL scene: a roster of animals, how rarely each turns up,
 * the groups they come in, what they do when left alone, what they do together,
 * and the traffic of the sky (flocks passing over, planes far off). Deterministic
 * and renderer-free: a seed casts the scene, and any moment of it poses every
 * animal as a list of capsules a renderer can draw as voxels, spheres or lines.
 * MIT.
 *
 * The body plans grow out of the KEEL pixel engine's entity system
 * (src/entity: a quadruped rig, two-bone IK, gait cycles, capsule skins) and add
 * primates, birds, serpents, insects and crabs. Each animal's idle life is a
 * Markov chain over a matrix of actions (`idleMatrix`), weighted by its temper.
 * A group's director interleaves those solo chains with joint scenes that need
 * two or more animals at once: grooming, nuzzling, chasing, following a leader,
 * a howling chorus, a huddle, a dance, a mother and young, a bird riding a deer.
 *
 *   const cast = castFor({ seed, region: "tokyo", world: "nature", season: "spring", radius: 4 });
 *   const herd = createHerd(cast);
 *   // every frame, with the scene's ground, trunk and branch perches:
 *   for (const body of herd.at(elapsed, stage)) draw(body.capsules);
 *
 * Frame convention (shared with the pixel engine): +y up, an animal's front is
 * its +z, its right hand +x, and a heading yaw turns +z toward +x.
 */

// ---------------------------------------------------------------- vectors

export type Vec = readonly [number, number, number];

const TAU = Math.PI * 2;
const UP: Vec = [0, 1, 0];
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (v: number): number => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a: Vec, b: Vec, s: number): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec, fallback: Vec = [0, 0, 1]): Vec => { const l = length(a); return l > 1e-9 ? scale(a, 1 / l) : fallback; };
const lerpV = (a: Vec, b: Vec, k: number): Vec => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
/** Turn about +z: a positive angle tips +y toward +x. */
const rollV = (v: Vec, a: number): Vec => { const c = Math.cos(a); const s = Math.sin(a); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; };
/** A direction from a heading and a pitch (pitch > 0 points up). */
const dirOf = (yaw: number, pitch: number): Vec => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

/** An animal's own frame in the world: origin on what it stands on, x right, y up, z front. */
export interface Frame { readonly o: Vec; readonly x: Vec; readonly y: Vec; readonly z: Vec }

/** The frame whose front is `front` and whose up is as near `up` as a right angle lets it be. */
export function frameOf(o: Vec, front: Vec, up: Vec = UP): Frame {
  const z = unit(front);
  let x = cross(up, z);
  if (length(x) < 1e-6) x = cross([0, 0, 1], z);
  x = unit(x, [1, 0, 0]);
  return { o, x, y: cross(z, x), z };
}
const toWorld = (f: Frame, v: Vec): Vec => add(f.o, add(add(scale(f.x, v[0]), scale(f.y, v[1])), scale(f.z, v[2])));
const dirToWorld = (f: Frame, v: Vec): Vec => add(add(scale(f.x, v[0]), scale(f.y, v[1])), scale(f.z, v[2]));

/**
 * Two bones from `a` of lengths l1 and l2 reaching for `target`, the middle joint
 * bending toward `pole`. Lengths are kept: a target out of reach is fallen short of.
 * (The pixel engine's rig.js solveTwoBone.)
 */
export function solveTwoBone(a: Vec, target: Vec, l1: number, l2: number, pole: Vec): { mid: Vec; end: Vec } {
  const d = sub(target, a);
  let dist = length(d);
  const n = dist > 1e-9 ? scale(d, 1 / dist) : unit(pole);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const end = madd(a, n, dist);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  let q = sub(pole, scale(n, dot(pole, n)));
  if (length(q) < 1e-9) q = Math.abs(n[1]) < 0.9 ? cross(n, UP) : cross(n, [1, 0, 0]);
  q = unit(q);
  return { mid: add(a, add(scale(n, l1 * cosA), scale(q, l1 * sinA))), end };
}

// ---------------------------------------------------------------- seeded streams

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A seeded stream of numbers in [0, 1) (mulberry32). */
export function createRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every choice draws from its own named stream, so adding one never reshuffles another. */
export const streamOf = (seed: number, name: string): (() => number) => createRandom((seed ^ hashName(name)) >>> 0);

function pick<T>(rand: () => number, entries: readonly (readonly [T, number])[]): T {
  const first = entries[0];
  if (first === undefined) throw new Error("fauna: nothing to pick from");
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  let roll = rand() * total;
  for (const [value, w] of entries) { roll -= Math.max(0, w); if (roll < 0) return value; }
  return first[0];
}
const between = (rand: () => number, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * rand();
const intBetween = (rand: () => number, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

// ---------------------------------------------------------------- the roster

export type Plan = "quad" | "primate" | "bird" | "serpent" | "bug" | "crab";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type RegionId = "rockies" | "atlantic" | "alps" | "tokyo" | "sydney" | "nairobi" | "bali";
export type WorldKey = "nature" | "beach" | "city" | "synth" | "vapor" | "crystal" | "cosmic" | "voxel";
export type Season = "spring" | "summer" | "autumn" | "winter";
/** What a capsule is made of; a palette turns each into a colour. */
/** The pupil and the spark of light in an eye; every creature's palette has them, a craft's need not. */
export type EyeRole = "pupil" | "shine";
export type Role = "coat" | "alt" | "belly" | "dark" | "eye" | "nose" | "accent" | "glow" | "horn" | "shell" | EyeRole;
export type Palette = Readonly<Record<Exclude<Role, EyeRole>, string>> & Readonly<Partial<Record<EyeRole, string>>>;

export type Action =
  | "stand" | "look" | "sniff" | "graze" | "groom" | "scratch" | "sit" | "lie" | "sleep" | "stretch" | "shake"
  | "yawn" | "rear" | "dig" | "roll" | "howl" | "eat" | "peck" | "preen" | "flap" | "sing" | "display" | "drum"
  | "bask" | "coil" | "flick" | "hover" | "wave" | "hang" | "nuzzle" | "play"
  | "wander" | "run" | "hop" | "climb" | "fly";

/** Actions that carry an animal somewhere else. */
export const MOVES: ReadonlySet<Action> = new Set<Action>(["wander", "run", "hop", "climb", "fly"]);

type Ears = "point" | "round" | "long" | "flop" | "tuft" | "none";
type Tail = "bushy" | "curl" | "thin" | "puff" | "ring" | "thick" | "fan" | "none";
type Extra = "bignose" | "antlers" | "mask" | "quills" | "shell" | "pouch" | "crest" | "stripes" | "longneck" | "train" | "crown" | "glowtail" | "claws" | "cheeks" | "spots";

/** Proportions, in units of the animal's size (its shoulder height; a bird's or a snake's length). */
export interface Build {
  readonly len: number;
  readonly leg: number;
  readonly body: number;
  readonly neck: number;
  readonly rise: number;
  readonly head: number;
  readonly snout: number;
  readonly ears: Ears;
  readonly tail: Tail;
  readonly tailLen: number;
  readonly hip: number;
  readonly extras: readonly Extra[];
}

type GroupKind = "solo" | "pair" | "family" | "pack";

export interface SpeciesSpec {
  readonly label: string;
  readonly plan: Plan;
  /** Size in scene units: a quad's shoulder height, a bird's or snake's length. */
  readonly size: number;
  readonly rarity: Rarity;
  /** Relative odds among the species a scene could have. */
  readonly weight: number;
  readonly regions: readonly RegionId[];
  readonly worlds: readonly WorldKey[];
  readonly active: "day" | "night" | "any";
  /** Out in winter (bears sleep it through, bugs and reptiles are gone). */
  readonly winter: boolean;
  /** Climbs trunks and sits in the crown. */
  readonly climbs: boolean;
  readonly flies: boolean;
  /** Odds of a lone animal, a pair, a parent with young, a pack. */
  readonly groups: readonly [number, number, number, number];
  readonly pack: readonly [number, number];
  /** Walking speed, in sizes a second. */
  readonly speed: number;
  readonly build: Build;
  /** Named coats: coat, alt, belly, dark, accent. */
  readonly coats: readonly (readonly [string, readonly [string, string, string, string, string]])[];
  /** How much more (or less) than its plan this animal does each thing: the idle matrix's column weights. */
  readonly temper: Partial<Record<Action, number>>;
  /** Species it is seen with in a mixed group. */
  readonly friends: readonly string[];
}

const ALL_REGIONS: readonly RegionId[] = ["rockies", "atlantic", "alps", "tokyo", "sydney", "nairobi", "bali"];
const TEMPERATE: readonly RegionId[] = ["rockies", "atlantic", "alps", "tokyo"];
const WILD: readonly WorldKey[] = ["nature", "voxel", "crystal"];

const BUILD: Build = { len: 1.3, leg: 0.6, body: 0.24, neck: 0.3, rise: 0.7, head: 0.17, snout: 0.16, ears: "point", tail: "thin", tailLen: 0.8, hip: 1, extras: [] };
type SpeciesDraft = Omit<SpeciesSpec, "build" | "temper" | "friends" | "groups" | "pack" | "winter" | "climbs" | "flies" | "active" | "worlds">
  & Partial<Pick<SpeciesSpec, "temper" | "friends" | "groups" | "pack" | "winter" | "climbs" | "flies" | "active" | "worlds">>
  & { readonly build?: Partial<Build> };
const define = (draft: SpeciesDraft): SpeciesSpec => ({
  worlds: WILD, active: "day", winter: true, climbs: false, flies: draft.plan === "bird" || draft.plan === "bug",
  groups: [6, 2, 1, 0], pack: [3, 4], temper: {}, friends: [],
  ...draft,
  build: { ...BUILD, ...draft.build },
});

export const SPECIES = {
  rabbit: define({ label: "Rabbit", plan: "quad", size: 0.2, rarity: "common", weight: 70, regions: TEMPERATE, speed: 1.4, groups: [6, 3, 2, 1], pack: [3, 5],
    build: { len: 0.85, leg: 0.42, body: 0.4, neck: 0.1, rise: 0.9, head: 0.3, snout: 0.08, ears: "long", tail: "puff", tailLen: 0.25, hip: 1.15 },
    coats: [["wild", ["#9a7e5e", "#7c6248", "#efe6d6", "#3a2c22", "#e8a8a8"]], ["snowshoe", ["#f2efe8", "#d8d2c8", "#ffffff", "#5a4a40", "#f0b0b8"]], ["dutch", ["#3a3230", "#f4f0ea", "#f4f0ea", "#1e1a18", "#e8a8a8"]]],
    temper: { graze: 2.2, groom: 1.6, rear: 1.4, hop: 1.8, sit: 1.3, wander: 0.4, sniff: 1.4 }, friends: ["songbird", "deer"] }),
  fox: define({ label: "Fox", plan: "quad", size: 0.36, rarity: "uncommon", weight: 34, regions: TEMPERATE, speed: 1.6, groups: [7, 2, 2, 0],
    build: { len: 1.55, leg: 0.62, body: 0.22, neck: 0.32, rise: 0.75, head: 0.18, snout: 0.24, ears: "point", tail: "bushy", tailLen: 1.15 },
    coats: [["red", ["#d2662a", "#a8481c", "#f4efe6", "#2a1a14", "#f4efe6"]], ["silver", ["#5a5a62", "#2e2e34", "#e8e8ec", "#16161a", "#f0f0f4"]], ["arctic", ["#f4f4f0", "#dcdcd6", "#ffffff", "#2a2a2a", "#ffffff"]]],
    temper: { sniff: 2.2, dig: 1.4, play: 1.4, stretch: 1.3, sit: 1.2, sleep: 1.2, look: 1.3, graze: 0 }, friends: [] }),
  deer: define({ label: "Deer", plan: "quad", size: 0.95, rarity: "uncommon", weight: 26, regions: TEMPERATE, speed: 1.1, groups: [4, 3, 4, 2], pack: [3, 4],
    build: { len: 1.15, leg: 0.68, body: 0.17, neck: 0.5, rise: 1.05, head: 0.11, snout: 0.15, ears: "point", tail: "puff", tailLen: 0.18, extras: ["antlers", "spots"] },
    coats: [["whitetail", ["#a87a4e", "#8a6038", "#f4ece0", "#2a1e16", "#f8f4ec"]], ["sika", ["#9a5e34", "#7a4422", "#f0e4d0", "#241810", "#f6efe2"]], ["fallow", ["#c8925a", "#9e6c3e", "#f6ecd8", "#2e2014", "#ffffff"]]],
    temper: { graze: 2.8, look: 1.8, groom: 1, wander: 0.8, lie: 1.2, run: 0.3, dig: 0, roll: 0 }, friends: ["rabbit", "songbird", "crow"] }),
  wolf: define({ label: "Wolf", plan: "quad", size: 0.72, rarity: "rare", weight: 10, regions: ["rockies", "alps"], speed: 1.3, groups: [3, 2, 1, 5], pack: [3, 5],
    build: { len: 1.4, leg: 0.64, body: 0.21, neck: 0.32, rise: 0.6, head: 0.16, snout: 0.22, ears: "point", tail: "bushy", tailLen: 0.8 },
    coats: [["grey", ["#7c7a74", "#4e4c48", "#e0dcd4", "#1e1c1a", "#d6d0c4"]], ["timber", ["#8a6a4a", "#4a3828", "#dcccb4", "#1c1610", "#cdb898"]], ["white", ["#e8e6e0", "#c8c4bc", "#ffffff", "#2a2826", "#ffffff"]], ["black", ["#2c2a2a", "#1a1818", "#4a4644", "#0c0a0a", "#5a5654"]]],
    temper: { howl: 2.4, sniff: 1.6, lie: 1.6, play: 1.4, look: 1.5, wander: 1, graze: 0 }, friends: [] }),
  bear: define({ label: "Bear", plan: "quad", size: 0.9, rarity: "rare", weight: 8, regions: ["rockies", "alps", "tokyo"], speed: 0.8, winter: false, groups: [6, 0, 3, 0],
    build: { len: 1.35, leg: 0.52, body: 0.34, neck: 0.22, rise: 0.4, head: 0.2, snout: 0.15, ears: "round", tail: "none", tailLen: 0.1, hip: 0.95 },
    coats: [["brown", ["#6a4a30", "#4a3220", "#8a6a4a", "#1a120c", "#a88a68"]], ["black", ["#262220", "#141210", "#3a3430", "#0a0808", "#b89a72"]], ["cinnamon", ["#9a6236", "#764824", "#b8865a", "#22140a", "#c8a07a"]]],
    temper: { rear: 1.6, scratch: 2, sit: 1.8, sniff: 1.4, dig: 1.3, lie: 1.4, roll: 0.8, graze: 0 }, friends: ["songbird"] }),
  raccoon: define({ label: "Raccoon", plan: "quad", size: 0.3, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "tokyo"], worlds: ["nature", "voxel", "city"], speed: 1.1, active: "night", climbs: true, groups: [5, 2, 3, 0],
    build: { len: 1.3, leg: 0.55, body: 0.3, neck: 0.2, rise: 0.6, head: 0.2, snout: 0.16, ears: "round", tail: "ring", tailLen: 0.9, hip: 1.08, extras: ["mask"] },
    coats: [["raccoon", ["#8a8682", "#5a5652", "#c8c4bc", "#1e1c1a", "#e8e4dc"]], ["tanuki", ["#8a6c4a", "#4a3828", "#b89a78", "#1a120c", "#d8c4a4"]]],
    temper: { dig: 1.8, sniff: 1.8, rear: 1.4, eat: 1.6, climb: 1.2, groom: 1.2, graze: 0 }, friends: ["cat"] }),
  cat: define({ label: "Cat", plan: "quad", size: 0.24, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1, active: "any", climbs: true, groups: [8, 2, 2, 0],
    build: { len: 1.5, leg: 0.6, body: 0.24, neck: 0.24, rise: 0.7, head: 0.21, snout: 0.08, ears: "point", tail: "thin", tailLen: 1.2 },
    coats: [["tabby", ["#b07a44", "#7a4e26", "#efe0c8", "#2a1a10", "#f0a0a0"]], ["black", ["#1e1c1e", "#121012", "#2a282a", "#060606", "#f0c040"]], ["calico", ["#f2ece2", "#d0782e", "#ffffff", "#2a2420", "#f0a0a0"]], ["grey", ["#8a8c94", "#5e6068", "#d8dadf", "#202226", "#f0a0b0"]]],
    temper: { groom: 2.4, sit: 2, sleep: 1.8, stretch: 1.6, look: 1.4, play: 1.1, yawn: 1.4, climb: 0.8, graze: 0 }, friends: ["raccoon", "crow"] }),
  hedgehog: define({ label: "Hedgehog", plan: "quad", size: 0.11, rarity: "uncommon", weight: 14, regions: ["atlantic", "alps"], speed: 0.9, active: "night", winter: false,
    build: { len: 1.2, leg: 0.25, body: 0.55, neck: 0.08, rise: 0.1, head: 0.28, snout: 0.38, ears: "round", tail: "none", tailLen: 0.1, hip: 1, extras: ["quills"] },
    coats: [["brown", ["#6a5240", "#3a2a1e", "#c8b098", "#140e0a", "#d8c8b0"]], ["blond", ["#b8a080", "#806a50", "#efe4d4", "#2a2018", "#f0e8d8"]]],
    temper: { sniff: 2.6, dig: 1.6, coil: 1.2, wander: 1.4, sleep: 1, run: 0, graze: 0 }, friends: [] }),
  mouse: define({ label: "Field mouse", plan: "quad", size: 0.07, rarity: "common", weight: 30, regions: ALL_REGIONS, speed: 2.4, active: "night", groups: [5, 2, 2, 2], pack: [3, 4],
    build: { len: 1.4, leg: 0.42, body: 0.36, neck: 0.12, rise: 0.4, head: 0.24, snout: 0.2, ears: "round", tail: "thin", tailLen: 1.4, hip: 1.1 },
    coats: [["field", ["#9a7a58", "#6a5038", "#efe2cc", "#1a120c", "#f0a8a8"]], ["grey", ["#7c7a78", "#55524f", "#d8d4cc", "#141210", "#f0a8a8"]]],
    temper: { sniff: 2.4, eat: 2, groom: 1.6, rear: 1.4, run: 1.4, wander: 1.2, graze: 0 }, friends: [] }),
  capybara: define({ label: "Capybara", plan: "quad", size: 0.5, rarity: "rare", weight: 9, regions: ["tokyo", "bali"], worlds: ["nature", "beach", "voxel"], speed: 0.6, groups: [3, 3, 3, 2], pack: [3, 4],
    build: { len: 1.5, leg: 0.42, body: 0.36, neck: 0.18, rise: 0.4, head: 0.22, snout: 0.26, ears: "round", tail: "none", tailLen: 0.05 },
    coats: [["capybara", ["#9a6c42", "#764e2c", "#a87c52", "#20140c", "#b88c62"]]],
    temper: { lie: 2.6, graze: 2, sit: 1.6, sleep: 1.6, look: 0.6, wander: 0.5, run: 0, roll: 0 }, friends: ["songbird", "parrot", "monkey"] }),
  kangaroo: define({ label: "Kangaroo", plan: "quad", size: 0.9, rarity: "rare", weight: 14, regions: ["sydney"], speed: 1.8, groups: [3, 2, 4, 2], pack: [3, 4],
    build: { len: 1, leg: 0.7, body: 0.24, neck: 0.22, rise: 1.2, head: 0.13, snout: 0.16, ears: "long", tail: "thick", tailLen: 1.1, hip: 0.75, extras: ["pouch"] },
    coats: [["red", ["#b06a3e", "#8a4e2a", "#e4cdb0", "#2a1a10", "#d8b898"]], ["grey", ["#8a8278", "#5e564e", "#d8d0c4", "#1e1a16", "#c8bcae"]]],
    temper: { graze: 1.8, rear: 2.6, groom: 1.2, hop: 2, look: 1.4, lie: 1, dig: 0, roll: 0 }, friends: [] }),
  tortoise: define({ label: "Tortoise", plan: "quad", size: 0.16, rarity: "rare", weight: 10, regions: ["nairobi", "bali", "sydney"], worlds: ["nature", "beach", "voxel"], speed: 0.25, winter: false,
    build: { len: 1.6, leg: 0.36, body: 0.42, neck: 0.36, rise: 0.4, head: 0.17, snout: 0.08, ears: "none", tail: "none", tailLen: 0.1, extras: ["shell"] },
    coats: [["leopard", ["#8a7a5a", "#5a4a32", "#c8b88e", "#1a1408", "#3a3020"]], ["star", ["#6a5a3a", "#2a2010", "#c8a860", "#141008", "#e8c870"]]],
    temper: { graze: 2.4, bask: 2.6, sleep: 1.2, look: 0.6, wander: 0.8, run: 0, roll: 0, shake: 0, rear: 0, scratch: 0, groom: 0, stretch: 0 }, friends: ["songbird", "crab"] }),
  meerkat: define({ label: "Meerkat", plan: "quad", size: 0.22, rarity: "rare", weight: 12, regions: ["nairobi"], speed: 1.8, groups: [1, 2, 3, 6], pack: [3, 6],
    build: { len: 1.2, leg: 0.5, body: 0.24, neck: 0.22, rise: 0.8, head: 0.2, snout: 0.18, ears: "round", tail: "thin", tailLen: 0.9, hip: 1, extras: ["mask"] },
    coats: [["meerkat", ["#b8966c", "#8a6c48", "#d8c4a4", "#1a120a", "#e8d8bc"]]],
    temper: { rear: 3.2, look: 2.4, dig: 2, groom: 1.4, bask: 1.2, run: 1, graze: 0 }, friends: [] }),
  squirrel: define({ label: "Squirrel", plan: "quad", size: 0.12, rarity: "common", weight: 60, regions: TEMPERATE, worlds: ["nature", "voxel", "crystal", "city"], speed: 2.2, climbs: true, groups: [6, 3, 1, 1], pack: [3, 3],
    build: { len: 1.3, leg: 0.5, body: 0.3, neck: 0.14, rise: 0.8, head: 0.25, snout: 0.12, ears: "tuft", tail: "curl", tailLen: 1.25, hip: 1.12 },
    coats: [["red", ["#b8582a", "#8a3e1a", "#f0e4d4", "#24140a", "#f4ece0"]], ["grey", ["#86827c", "#5e5a54", "#e8e4dc", "#1c1a18", "#efe8de"]], ["black", ["#2a2624", "#181614", "#4a4440", "#0a0808", "#4a4440"]]],
    temper: { eat: 2.6, climb: 2.6, rear: 1.6, dig: 1.4, look: 1.4, run: 1.4, play: 1.4, graze: 0 }, friends: ["songbird", "woodpecker"] }),
  redpanda: define({ label: "Red panda", plan: "quad", size: 0.28, rarity: "epic", weight: 5, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [6, 2, 2, 0],
    build: { len: 1.4, leg: 0.5, body: 0.3, neck: 0.18, rise: 0.6, head: 0.24, snout: 0.12, ears: "point", tail: "ring", tailLen: 1.2, hip: 1.05, extras: ["mask", "cheeks"] },
    coats: [["red panda", ["#b84a1e", "#5a2210", "#1e1210", "#140a06", "#f4ece0"]]],
    temper: { climb: 2.4, eat: 2, sleep: 1.8, groom: 1.4, stretch: 1.2, rear: 1.2, roll: 0, graze: 0 }, friends: [] }),
  koala: define({ label: "Koala", plan: "quad", size: 0.3, rarity: "epic", weight: 7, regions: ["sydney"], speed: 0.4, climbs: true, groups: [7, 1, 3, 0],
    build: { len: 0.9, leg: 0.5, body: 0.38, neck: 0.1, rise: 1, head: 0.32, snout: 0.1, ears: "round", tail: "none", tailLen: 0.05, hip: 1, extras: ["bignose"] },
    coats: [["koala", ["#8a8a8e", "#5e5e62", "#e8e6e2", "#1a1a1c", "#2a2a2c"]]],
    temper: { sleep: 3.4, eat: 2.2, climb: 1.4, look: 0.6, wander: 0.2, scratch: 1.2, run: 0, roll: 0 }, friends: [] }),
  macaque: define({ label: "Snow monkey", plan: "primate", size: 0.5, rarity: "rare", weight: 12, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [3, 3, 4, 3], pack: [3, 5],
    build: { len: 0.55, leg: 0.42, body: 0.2, neck: 0.06, head: 0.15, snout: 0.05, ears: "none", tail: "puff", tailLen: 0.2 },
    coats: [["snow", ["#a89a8a", "#7a6c5e", "#c8bcb0", "#2a2018", "#e8786c"]]],
    temper: { groom: 3, sit: 2, eat: 1.6, look: 1.4, climb: 1.4, sleep: 1.2, hang: 0.4 }, friends: [] }),
  monkey: define({ label: "Long-tailed macaque", plan: "primate", size: 0.44, rarity: "uncommon", weight: 18, regions: ["bali", "nairobi"], worlds: ["nature", "beach", "voxel"], speed: 1.2, climbs: true, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { len: 0.5, leg: 0.45, body: 0.17, neck: 0.06, head: 0.14, snout: 0.07, ears: "round", tail: "thin", tailLen: 1.3 },
    coats: [["macaque", ["#8a7a5e", "#5e5038", "#c8b898", "#241c12", "#d8a088"]], ["vervet", ["#8a8c78", "#5a5c4a", "#e8e6dc", "#141410", "#2a2a2a"]]],
    temper: { climb: 2.4, hang: 1.6, groom: 2.2, eat: 1.8, play: 1.6, look: 1.2, scratch: 1.4 }, friends: ["capybara", "parrot"] }),
  sloth: define({ label: "Sloth", plan: "primate", size: 0.45, rarity: "epic", weight: 4, regions: ["bali"], worlds: ["nature", "beach", "voxel"], speed: 0.12, climbs: true, groups: [9, 0, 2, 0],
    build: { len: 0.55, leg: 0.5, body: 0.22, neck: 0.1, head: 0.14, snout: 0.03, ears: "none", tail: "none", tailLen: 0.05, extras: ["mask", "claws"] },
    coats: [["sloth", ["#9a8a6a", "#6a5c44", "#c8b896", "#2a2016", "#e8dcc0"]]],
    temper: { hang: 4, sleep: 3, eat: 1.2, look: 0.8, climb: 0.6 }, friends: [] }),
  songbird: define({ label: "Songbird", plan: "bird", size: 0.13, rarity: "common", weight: 80, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "city", "beach"], speed: 1.4, groups: [5, 4, 2, 2], pack: [3, 5],
    build: { len: 1, leg: 0.22, body: 0.2, neck: 0.1, rise: 0.4, head: 0.16, snout: 0.12, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["robin", ["#6a5a4a", "#4a3e32", "#e2702e", "#141010", "#e8c048"]], ["bluebird", ["#3a6ad0", "#2a4a9a", "#e8945a", "#0e1220", "#2a2a2a"]], ["goldfinch", ["#f0d020", "#2a2a2a", "#f8e870", "#121212", "#e8a060"]], ["sparrow", ["#9a7a5a", "#5e4a36", "#d8ccb8", "#1a1410", "#3a3028"]]],
    temper: { sing: 2.6, peck: 2.2, hop: 2, preen: 1.6, look: 1.4, fly: 1.6 }, friends: ["deer", "rabbit", "bear", "capybara", "tortoise", "squirrel"] }),
  crow: define({ label: "Crow", plan: "bird", size: 0.24, rarity: "common", weight: 34, regions: ALL_REGIONS, worlds: ["nature", "voxel", "city", "synth", "crystal"], speed: 1.2, active: "day", groups: [5, 3, 1, 3], pack: [3, 5],
    build: { len: 1.15, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.3, head: 0.15, snout: 0.2, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["crow", ["#1a1c22", "#0e1014", "#262830", "#060608", "#3a3c44"]], ["hooded", ["#8a8a8e", "#1a1a1e", "#9a9a9e", "#0a0a0c", "#2a2a2e"]]],
    temper: { peck: 2.4, look: 2, hop: 1.6, flap: 1.2, sing: 0.8, fly: 1.4 }, friends: ["deer", "cat"] }),
  owl: define({ label: "Owl", plan: "bird", size: 0.3, rarity: "rare", weight: 10, regions: ["rockies", "atlantic", "alps", "tokyo", "nairobi"], worlds: ["nature", "voxel", "crystal", "city"], speed: 0.8, active: "night", groups: [8, 2, 2, 0],
    build: { len: 0.9, leg: 0.16, body: 0.32, neck: 0.04, rise: 1.2, head: 0.27, snout: 0.06, ears: "tuft", tail: "fan", tailLen: 0.3 },
    coats: [["barn", ["#d8b078", "#a8804a", "#f6eee0", "#2a1e10", "#f4ead8"]], ["great horned", ["#7a6248", "#4a3a28", "#c8b494", "#1a120a", "#f0d050"]], ["snowy", ["#f4f4f0", "#c8c8c4", "#ffffff", "#2a2a2a", "#f0d040"]]],
    temper: { look: 3, preen: 1.6, sleep: 2, flap: 0.8, fly: 0.8, peck: 0, hop: 0, sing: 0 }, friends: [] }),
  parrot: define({ label: "Parrot", plan: "bird", size: 0.28, rarity: "rare", weight: 14, regions: ["bali", "sydney"], worlds: ["nature", "beach", "voxel", "vapor"], speed: 1, groups: [4, 4, 1, 3], pack: [3, 5],
    build: { len: 1.2, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.9, head: 0.16, snout: 0.14, ears: "none", tail: "fan", tailLen: 0.9, extras: ["crest"] },
    coats: [["macaw", ["#e2282e", "#2a5ad8", "#f0d020", "#141414", "#3ab84a"]], ["cockatoo", ["#f8f8f4", "#e8e4d8", "#ffffff", "#2a2a2a", "#f8d830"]], ["lorikeet", ["#2ab84a", "#3a4ad8", "#f06a20", "#141414", "#e83030"]]],
    temper: { preen: 2.4, sing: 2, eat: 1.6, flap: 1.6, look: 1.2, hang: 0.8 }, friends: ["monkey", "capybara"] }),
  gull: define({ label: "Gull", plan: "bird", size: 0.32, rarity: "common", weight: 36, regions: ["atlantic", "sydney", "bali", "tokyo"], worlds: ["beach", "city", "nature"], speed: 1.2, groups: [4, 3, 1, 3], pack: [3, 5],
    build: { len: 1.2, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.4, head: 0.14, snout: 0.18, ears: "none", tail: "fan", tailLen: 0.4 },
    coats: [["herring", ["#f4f4f2", "#9aa4ae", "#ffffff", "#141414", "#f0c030"]], ["black-backed", ["#f4f4f2", "#2a2e34", "#ffffff", "#141414", "#f0c030"]]],
    temper: { look: 2, peck: 1.8, flap: 1.6, sing: 1.4, preen: 1.2, fly: 1.8 }, friends: ["crab"] }),
  peacock: define({ label: "Peacock", plan: "bird", size: 0.55, rarity: "epic", weight: 5, regions: ["bali", "nairobi"], speed: 0.7, flies: false, groups: [5, 4, 2, 0],
    build: { len: 1, leg: 0.3, body: 0.18, neck: 0.3, rise: 1.1, head: 0.1, snout: 0.1, ears: "none", tail: "fan", tailLen: 1.2, extras: ["crown", "train"] },
    coats: [["indian", ["#1a5ad8", "#2a8a5a", "#1a4ab8", "#0a1020", "#e8c040"]], ["white", ["#f8f8f4", "#e8e8e2", "#ffffff", "#2a2a2a", "#f0f0ea"]]],
    temper: { display: 3, peck: 1.8, look: 1.4, preen: 1.2, wander: 1, sing: 0 }, friends: [] }),
  crane: define({ label: "Crane", plan: "bird", size: 0.85, rarity: "epic", weight: 6, regions: ["tokyo", "nairobi"], speed: 0.8, groups: [3, 6, 2, 0],
    build: { len: 0.85, leg: 0.55, body: 0.16, neck: 0.55, rise: 1.2, head: 0.07, snout: 0.16, ears: "none", tail: "fan", tailLen: 0.3, extras: ["longneck", "crown"] },
    coats: [["red-crowned", ["#f6f6f2", "#1a1a1a", "#ffffff", "#141414", "#e02828"]], ["grey crowned", ["#8a9098", "#f4f4f0", "#a0a6ae", "#141414", "#e8c040"]]],
    temper: { display: 2.2, peck: 2, preen: 1.6, look: 1.4, flap: 1.2, hop: 0, sing: 0 }, friends: [] }),
  woodpecker: define({ label: "Woodpecker", plan: "bird", size: 0.18, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "alps", "tokyo"], speed: 1, groups: [8, 2, 1, 0],
    build: { len: 1.1, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.6, head: 0.15, snout: 0.22, ears: "none", tail: "fan", tailLen: 0.5, extras: ["crest"] },
    coats: [["downy", ["#1e1e20", "#f4f4f0", "#f4f4f0", "#0e0e10", "#e02828"]], ["green", ["#6a8a3a", "#4a6a2a", "#c8d098", "#1a1a10", "#e02828"]]],
    temper: { drum: 4, look: 1.2, preen: 1, fly: 1.2, peck: 0, hop: 0, sing: 0 }, friends: ["squirrel"] }),
  snake: define({ label: "Snake", plan: "serpent", size: 1.1, rarity: "rare", weight: 9, regions: ["nairobi", "bali", "sydney", "rockies"], worlds: ["nature", "voxel", "beach"], speed: 0.35, winter: false, climbs: true,
    build: { len: 1, leg: 0, body: 0.028, neck: 0, rise: 0, head: 0.04, snout: 0.03, ears: "none", tail: "thin", tailLen: 0.3 },
    coats: [["green", ["#3a9a3a", "#1e6a22", "#c8e090", "#0e1a0a", "#e83030"]], ["corn", ["#e07a3a", "#b8401e", "#f4e0c0", "#2a120a", "#e83030"]], ["banded", ["#2a2a2a", "#f0e8d8", "#f0e8d8", "#0a0a0a", "#e83030"]]],
    temper: { bask: 2.6, coil: 2.2, flick: 2, climb: 1.4, look: 0.6, wander: 1 }, friends: [] }),
  gecko: define({ label: "Gecko", plan: "serpent", size: 0.16, rarity: "uncommon", weight: 18, regions: ["bali", "sydney", "nairobi"], worlds: ["nature", "voxel", "beach", "vapor", "synth"], speed: 1.2, winter: false, climbs: true, active: "any", groups: [6, 2, 1, 0],
    build: { len: 1, leg: 0.12, body: 0.08, neck: 0, rise: 0, head: 0.1, snout: 0.06, ears: "none", tail: "thin", tailLen: 0.45, extras: ["spots"] },
    coats: [["tokay", ["#7a8aa8", "#e88a3a", "#c8d0e0", "#141820", "#e88a3a"]], ["leaf", ["#5ab84a", "#e8c040", "#c8e8a0", "#0e1a0a", "#e86040"]], ["neon", ["#3af0e0", "#ff3ad8", "#c8fff8", "#0a0a14", "#ff3ad8"]]],
    temper: { bask: 2.4, climb: 2.4, flick: 1.6, look: 1.2, run: 1.2 }, friends: [] }),
  butterfly: define({ label: "Butterfly", plan: "bug", size: 0.09, rarity: "common", weight: 50, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "beach", "vapor"], speed: 1, winter: false, groups: [4, 4, 0, 2], pack: [3, 5],
    build: { len: 1, leg: 0, body: 0.08, neck: 0, rise: 0, head: 0.06, snout: 0, ears: "none", tail: "none", tailLen: 0 },
    coats: [["monarch", ["#f07a1a", "#1a1a1a", "#f8f4ec", "#0a0a0a", "#ffffff"]], ["morpho", ["#2a8af0", "#0a2a6a", "#7ad0ff", "#0a0a14", "#ffffff"]], ["swallowtail", ["#f0d84a", "#1a1a1a", "#f8f0b0", "#0a0a0a", "#3a6ad0"]], ["cabbage", ["#f6f4ea", "#2a2a2a", "#ffffff", "#141414", "#f6f4ea"]]],
    temper: { hover: 3, wander: 2, sit: 1.2 }, friends: [] }),
  firefly: define({ label: "Fireflies", plan: "bug", size: 0.035, rarity: "uncommon", weight: 30, regions: ["tokyo", "atlantic", "rockies", "bali"], worlds: ["nature", "voxel", "crystal"], speed: 0.5, winter: false, active: "night", groups: [0, 1, 0, 6], pack: [5, 9],
    build: { len: 1, leg: 0, body: 0.12, neck: 0, rise: 0, head: 0.08, snout: 0, ears: "none", tail: "none", tailLen: 0, extras: ["glowtail"] },
    coats: [["firefly", ["#3a3020", "#2a2418", "#4a4030", "#0a0806", "#d8ff5a"]]],
    temper: { hover: 3, wander: 2 }, friends: [] }),
  crab: define({ label: "Crab", plan: "crab", size: 0.12, rarity: "uncommon", weight: 40, regions: ["bali", "sydney", "atlantic", "tokyo", "nairobi"], worlds: ["beach", "vapor", "synth"], speed: 1, active: "any", groups: [4, 3, 1, 2], pack: [3, 4],
    build: { len: 1, leg: 0.5, body: 0.42, neck: 0, rise: 0, head: 0.1, snout: 0, ears: "none", tail: "none", tailLen: 0, extras: ["claws"] },
    coats: [["red", ["#d8402a", "#a8281a", "#f0c8a0", "#141010", "#f4f0e8"]], ["ghost", ["#e8d8b8", "#c8b890", "#f8f0dc", "#1a1610", "#ffffff"]], ["fiddler", ["#3a5ad0", "#e8c040", "#e8e0d0", "#0e0e14", "#ffffff"]]],
    temper: { wave: 2.4, dig: 1.8, wander: 2, look: 1.2 }, friends: ["gull", "tortoise"] }),
} as const satisfies Record<string, SpeciesSpec>;

export type SpeciesId = keyof typeof SPECIES;
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
const speciesOf = (id: SpeciesId): SpeciesSpec => SPECIES[id];

// ---------------------------------------------------------------- the idle matrix

/** What each body plan can do, and how readily, before an animal's temper weights it. */
const PLAN_ACTIONS: Readonly<Record<Plan, Partial<Record<Action, number>>>> = {
  quad: { stand: 1, look: 1.2, sniff: 1, graze: 0.5, groom: 0.8, scratch: 0.5, sit: 1, lie: 0.7, sleep: 0.4, stretch: 0.4, shake: 0.3, yawn: 0.3, rear: 0.2, dig: 0.3, roll: 0.12, wander: 1.6, run: 0.25 },
  primate: { stand: 0.5, sit: 1.4, look: 1, groom: 1, scratch: 0.8, eat: 0.8, sleep: 0.4, yawn: 0.3, wander: 0.9, climb: 1, hang: 0.4 },
  bird: { stand: 1, look: 1.2, peck: 1, preen: 0.8, flap: 0.4, sing: 0.6, hop: 1, fly: 0.8, sleep: 0.25 },
  serpent: { bask: 1, coil: 0.8, flick: 0.8, look: 0.6, wander: 1, climb: 0.3 },
  bug: { hover: 1, wander: 1, sit: 0.5 },
  crab: { stand: 1, wave: 0.8, dig: 0.6, look: 0.6, wander: 1.4, sit: 0.9, lie: 0.5 },
};

/** How one action leads to the next: a row's multipliers on the plan's odds (1 when left out). */
const FLOW: Partial<Record<Action, Partial<Record<Action, number>>>> = {
  stand: { sleep: 0.05, roll: 0.3 },
  look: { sleep: 0.05, rear: 1.6, run: 1.5 },
  wander: { sniff: 1.6, look: 1.4, graze: 1.5, peck: 1.5, wander: 0.4, sleep: 0.05 },
  run: { stand: 2, look: 2, shake: 1.6, run: 0.1, sleep: 0 },
  sit: { lie: 2.2, groom: 1.6, scratch: 1.6, yawn: 1.4, howl: 2, eat: 1.6, sleep: 0.6 },
  lie: { sleep: 4, roll: 2.5, sit: 1.5, stretch: 2, groom: 1.4, run: 0.1, wander: 0.4 },
  sleep: { lie: 3, stretch: 3, yawn: 3, sit: 1.5, sleep: 0, wander: 0.2, run: 0, hang: 2 },
  stretch: { shake: 2, yawn: 1.5, wander: 1.4, stretch: 0 },
  roll: { shake: 3, lie: 2, roll: 0 },
  graze: { graze: 1.2, look: 1.8, wander: 1.4, sleep: 0.05 },
  peck: { peck: 0.8, hop: 1.6, look: 1.6, fly: 1.2 },
  hang: { hang: 0.4, sleep: 2.5, eat: 1.6, climb: 1.6 },
  bask: { bask: 0.6, flick: 2, coil: 1.4 },
  hover: { hover: 0.5, wander: 2, sit: 1.6 },
  howl: { howl: 0.2, sit: 2, lie: 1.4 },
  display: { display: 0, preen: 2, peck: 1.4 },
  drum: { drum: 0.4, look: 2, fly: 1.4 },
};

const SPAN: Readonly<Record<Action, readonly [number, number]>> = {
  stand: [2, 5], look: [2, 4.5], sniff: [1.5, 3.5], graze: [4, 10], groom: [3, 7], scratch: [1.5, 3], sit: [4, 10], lie: [6, 14],
  sleep: [12, 30], stretch: [1.8, 2.6], shake: [0.9, 1.3], yawn: [1.4, 2], rear: [2, 5], dig: [2, 5], roll: [2.5, 4], howl: [3, 5],
  eat: [3, 8], peck: [1.2, 3], preen: [2, 5], flap: [1, 2], sing: [2, 4.5], display: [5, 9], drum: [1.5, 3.5], bask: [6, 14],
  coil: [6, 12], flick: [1, 2], hover: [2, 5], wave: [1.5, 3], hang: [6, 16], nuzzle: [2.5, 4], play: [1.6, 2.6],
  wander: [2, 5], run: [1, 2], hop: [1, 2.5], climb: [3, 6], fly: [2, 4],
};

/** Actions that only make sense on the ground; an animal up a tree comes down first. */
const GROUNDED: ReadonlySet<Action> = new Set<Action>(["graze", "dig", "roll", "run", "wander", "hop", "display", "wave", "play", "stretch"]);

export interface IdleMatrix {
  readonly actions: readonly Action[];
  /** rows[i][j]: the chance that action j follows action i. Every row sums to 1. */
  readonly rows: readonly (readonly number[])[];
}

/** The columns an animal can choose: its plan's actions and the ones its temper adds. */
function actionsOf(spec: SpeciesSpec): Action[] {
  const base = PLAN_ACTIONS[spec.plan];
  const out = new Set<Action>(Object.keys(base) as Action[]);
  // A temper of 0 takes an action off the animal's menu: a tortoise does not run, a fox does not graze.
  for (const [action, weight] of Object.entries(spec.temper) as [Action, number][]) if (weight > 0) out.add(action); else out.delete(action);
  if (!spec.climbs && spec.plan !== "bird") { out.delete("climb"); out.delete("hang"); }
  if (!spec.flies) out.delete("fly");
  return [...out];
}

function columnWeight(spec: SpeciesSpec, action: Action, night: boolean): number {
  const base = PLAN_ACTIONS[spec.plan][action] ?? 0.6;
  const temper = spec.temper[action] ?? 1;
  const asleepNow = spec.active !== "any" && (spec.active === "day") === night;
  if (!asleepNow) return base * temper;
  const drowsy: Partial<Record<Action, number>> = { sleep: 8, lie: 3, sit: 2, hang: 3, coil: 3, hover: 0.1 };
  return base * temper * (drowsy[action] ?? (MOVES.has(action) ? 0.15 : 0.35));
}

/**
 * The animal's matrix of idle actions: which action follows which, and how
 * often. A sleeping row leads to waking things, a lying row to sleep or a roll,
 * and at the wrong time of day (an owl at noon, a deer at midnight) every row
 * leans toward rest.
 */
export function idleMatrix(id: SpeciesId, { night = false }: { night?: boolean } = {}): IdleMatrix {
  const spec = speciesOf(id);
  const actions = actionsOf(spec);
  const columns = actions.map((action) => columnWeight(spec, action, night));
  const rows = actions.map((from) => {
    const flow = FLOW[from] ?? {};
    const raw = actions.map((to, j) => (columns[j] ?? 0) * (flow[to] ?? (to === from ? 0.25 : 1)));
    const total = raw.reduce((sum, value) => sum + value, 0) || 1;
    return raw.map((value) => value / total);
  });
  return { actions, rows };
}

function nextAction(matrix: IdleMatrix, from: Action, rand: () => number): Action {
  const row = matrix.rows[matrix.actions.indexOf(from)] ?? matrix.rows[0] ?? [];
  return pick(rand, matrix.actions.map((action, j) => [action, row[j] ?? 0] as const));
}

// ---------------------------------------------------------------- where animals are

/** A place an animal can be: a spot on the ground, a branch perch, a point on the trunk, another animal's back. */
export type Place =
  | { readonly on: "ground"; readonly x: number; readonly z: number }
  | { readonly on: "perch"; readonly i: number }
  | { readonly on: "trunk"; readonly h: number; readonly a: number }
  | { readonly on: "back"; readonly m: number };

/** A point on a branch or the trunk's centreline, and the wood's radius there. */
export interface Wood { readonly p: Vec; readonly r: number }

export interface Perch {
  /** Where on the branch. */
  readonly p: Vec;
  /** Along the branch, outward. */
  readonly d: Vec;
  readonly r: number;
  /** The branch from where it leaves the trunk out to this perch, so climbers walk the wood instead of the air. */
  readonly path?: readonly Wood[] | undefined;
}

/** A surface root, as a capsule lying on the ground: animals step or hop over it, and can stand on it. */
export interface Root { readonly a: Vec; readonly b: Vec; readonly r: number }

/** What the scene gives the animals each frame: the ground they walk, the trunk they climb, the branches they sit in. */
export interface Stage {
  /** Walkable radius of the ground around the origin. */
  readonly radius: number;
  /** Height of the ground. */
  readonly top: number;
  /** The ground's height at a point, when it isn't flat. */
  readonly ground?: ((x: number, z: number) => number) | undefined;
  /** The trunk: a straight run from base to top, or its real spine in `path` when it leans or bends. */
  readonly trunk?: { readonly base: Vec; readonly top: Vec; readonly r: number; readonly path?: readonly Wood[] | undefined } | null | undefined;
  readonly perches?: readonly Perch[] | undefined;
  /** Roots on the ground, which raise it where they lie. */
  readonly roots?: readonly Root[] | undefined;
  /** Fruit to eat, on the branches and on the ground. */
  readonly food?: readonly Food[] | undefined;
  readonly night?: boolean | undefined;
}

/** Something to eat: a fruit up in the tree (reached from a perch) or lying on the ground. */
export interface Food {
  /** Holds while it hangs, falls and lies, so two animals never go for the same one. */
  readonly key: string;
  readonly p: Vec;
  /** The perch (an index into `Stage.perches`) it is eaten from; left out, it lies on the ground. */
  readonly perch?: number | undefined;
}

/**
 * Who eats fruit, and where it gets it: "tree" off the branch (it must climb
 * or fly), "ground" only what has fallen, "both" either.
 */
export const FRUIT_EATERS: Readonly<Partial<Record<SpeciesId, "tree" | "ground" | "both">>> = {
  rabbit: "ground", fox: "ground", deer: "ground", bear: "ground", raccoon: "both", hedgehog: "ground", mouse: "ground",
  capybara: "ground", tortoise: "ground", squirrel: "both", redpanda: "both", macaque: "both", monkey: "both", sloth: "tree",
  songbird: "both", crow: "both", parrot: "both", peacock: "ground",
};
/** How often an eater with fruit in reach goes to eat instead of idling. */
const APPETITE = 0.3;

interface Anchor { readonly p: Vec; readonly up: Vec; readonly along: Vec | null }

const bareY = (stage: Stage, x: number, z: number): number => stage.ground?.(x, z) ?? stage.top;

/** The top of whatever root lies under a point, or -Infinity where none does. */
function rootTop(stage: Stage, x: number, z: number): number {
  let top = -Infinity;
  for (const root of stage.roots ?? []) {
    const dx = root.b[0] - root.a[0];
    const dz = root.b[2] - root.a[2];
    const span = dx * dx + dz * dz;
    const t = span > 1e-9 ? clamp(((x - root.a[0]) * dx + (z - root.a[2]) * dz) / span, 0, 1) : 0;
    const gap = Math.hypot(x - (root.a[0] + dx * t), z - (root.a[2] + dz * t));
    if (gap < root.r) top = Math.max(top, mix(root.a[1], root.b[1], t) + Math.sqrt(root.r * root.r - gap * gap));
  }
  return top;
}

/** The ground's height at a point, roots included. */
const groundY = (stage: Stage, x: number, z: number): number => Math.max(bareY(stage, x, z), rootTop(stage, x, z));
const perchOf = (stage: Stage, i: number): Perch | undefined => {
  const list = stage.perches ?? [];
  return list.length > 0 ? list[((i % list.length) + list.length) % list.length] : undefined;
};
const trunkR = (stage: Stage): number => stage.trunk?.r ?? 0;

/** The trunk's centre and radius at height share `h` (0 at its base, 1 at its top), following its spine when it has one. */
function trunkAxis(trunk: NonNullable<Stage["trunk"]>, h: number): Wood {
  const k = clamp(h, 0, 1);
  const spine = trunk.path ?? [];
  if (spine.length < 2) return { p: lerpV(trunk.base, trunk.top, k), r: trunk.r * (1 - 0.35 * k) };
  const y = mix(trunk.base[1], trunk.top[1], k);
  let a = spine[0] ?? { p: trunk.base, r: trunk.r };
  for (const b of spine.slice(1)) {
    if (y <= b.p[1]) {
      const u = clamp((y - a.p[1]) / Math.max(1e-6, b.p[1] - a.p[1]), 0, 1);
      return { p: lerpV(a.p, b.p, u), r: mix(a.r, b.r, u) };
    }
    a = b;
  }
  return a;
}

function trunkPoint(stage: Stage, h: number, a: number): Anchor {
  const trunk = stage.trunk;
  if (!trunk) return { p: [Math.cos(a) * 0.2, stage.top, Math.sin(a) * 0.2], up: UP, along: null };
  const out: Vec = [Math.cos(a), 0, Math.sin(a)];
  const axis = trunkAxis(trunk, h);
  return { p: madd(axis.p, out, axis.r), up: out, along: null };
}

/** Height share of a world height on the trunk. */
const trunkShare = (trunk: NonNullable<Stage["trunk"]>, y: number): number => clamp((y - trunk.base[1]) / Math.max(0.01, trunk.top[1] - trunk.base[1]), 0, 1);

/** Where a place is in the world this frame. */
function anchorOf(place: Place, stage: Stage, backs: readonly (Anchor | null)[]): Anchor {
  if (place.on === "ground") return { p: [place.x, groundY(stage, place.x, place.z), place.z], up: UP, along: null };
  if (place.on === "trunk") return trunkPoint(stage, place.h, place.a);
  if (place.on === "back") return backs[place.m] ?? { p: [0, stage.top, 0], up: UP, along: null };
  const perch = perchOf(stage, place.i);
  if (!perch) return { p: [trunkR(stage) + 0.3, stage.top, 0], up: UP, along: null };
  return { p: add(perch.p, [0, perch.r, 0]), up: UP, along: perch.d };
}

/** Where another animal is, or is headed, and how much room it takes. */
interface Spot { readonly p: Vec; readonly size: number }

/** How far from the trunk's middle an animal stands so its head and legs keep out of the bark. */
const trunkClear = (stage: Stage, size: number): number => trunkR(stage) + size * 1.2 + 0.1;

/** A free spot on the ground, clear of the trunk, the rim and the others. */
function groundSpot(rand: () => number, stage: Stage, size: number, near?: Vec, reach = 0, taken: readonly Spot[] = []): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.2, stage.radius - size * 0.8);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const a = rand() * TAU;
    const r = near ? reach * Math.sqrt(rand()) : mix(inner, outer, Math.sqrt(rand()));
    const x = (near?.[0] ?? 0) + Math.cos(a) * r;
    const z = (near?.[2] ?? 0) + Math.sin(a) * r;
    const d = Math.hypot(x, z);
    const room = taken.every((other) => Math.hypot(other.p[0] - x, other.p[2] - z) >= (other.size + size) * 0.8);
    if (d >= inner && d <= outer && room) return { on: "ground", x, z };
  }
  const a = rand() * TAU;
  const r = mix(inner, outer, 0.5);
  return { on: "ground", x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// ---------------------------------------------------------------- paths

interface PathPoint { readonly p: Vec; readonly up: Vec }

/** Push a point on the ground out of the trunk's way. */
function clearOfTrunk(stage: Stage, p: Vec, size: number): Vec {
  const clear = trunkClear(stage, size);
  const d = Math.hypot(p[0], p[2]);
  if (d >= clear || d < 1e-6) return p;
  const k = clear / d;
  return [p[0] * k, groundY(stage, p[0] * k, p[2] * k), p[2] * k];
}

/**
 * Over the ground, round the trunk, and up and over the roots: the way
 * follows the ground's real height closely enough to find every root, and
 * where one crosses it the body rises before it and comes down after, in an
 * arc. A springy animal (`spring` near 1: a bird, a rabbit) hops it with room
 * to spare; a heavy one steps over.
 */
function walkPath(a: Anchor, b: Anchor, stage: Stage, size: number, spring = 0): PathPoint[] {
  const span = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
  const steps = clamp(Math.ceil(span / Math.max(0.03, size * 0.2)), 8, 96);
  const points: Vec[] = [];
  const bare: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const q = clearOfTrunk(stage, lerpV(a.p, b.p, i / steps), size);
    points.push([q[0], groundY(stage, q[0], q[2]), q[2]]);
    bare.push(bareY(stage, q[0], q[2]));
  }
  const over = (i: number): number => (points[i]?.[1] ?? 0) - (bare[i] ?? 0);
  if (points.every((_, i) => over(i) < 0.004)) return points.map((p) => ({ p, up: UP }));
  const reach = size * (0.45 + spring * 0.5);
  const spare = size * spring * 0.3;
  const stride = span / steps;
  const lifted = points.map((p, i): Vec => {
    let y = p[1];
    for (let j = 0; j < points.length; j += 1) {
      const d = Math.abs(i - j) * stride;
      if (d >= reach || over(j) < 0.004) continue;
      y = Math.max(y, (bare[i] ?? 0) + (over(j) + spare) * (1 - (d / reach) ** 2));
    }
    return [p[0], y, p[2]];
  });
  return lifted.map((p) => ({ p, up: UP }));
}

/**
 * Which way a flight leaves one end (or comes into the other): toward the
 * far end when that is well off to the side, but out from the trunk when the
 * way is short or all but straight up, so a bird swings out and comes back
 * in instead of rising like a lift.
 */
function flightHeading(p: Vec, other: Vec, span: number, reach: number): Vec {
  const radial = unit([p[0], 0, p[2]], [0, 0, 1]);
  const way = unit([other[0] - p[0], 0, other[2] - p[2]], radial);
  return unit(lerpV(radial, way, clamp(span / (reach * 1.5), 0, 1)), radial);
}

/** A point on a Catmull-Rom curve through four points. */
function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, u: number): Vec {
  const u2 = u * u;
  const u3 = u2 * u;
  return [0, 1, 2].map((i) => {
    const [a, b, c, d] = [p0[i] ?? 0, p1[i] ?? 0, p2[i] ?? 0, p3[i] ?? 0];
    return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
  }) as unknown as Vec;
}

/** Out of the trunk's way, sideways, keeping its height. */
function roundTrunk(p: Vec, clear: number): Vec {
  const off = Math.hypot(p[0], p[2]);
  if (off >= clear) return p;
  const k = clear / Math.max(off, 1e-3);
  return off < 1e-3 ? [clear, p[1], 0] : [p[0] * k, p[1], p[2] * k];
}

/**
 * A flight as a bird flies one. A bird climbs or drops at a slant, never
 * straight up, so a way with more height in it than ground under it becomes
 * a loop: out from the tree, round, and back in. It springs off and climbs
 * out, crosses, and comes in on a long glide, from a little below a branch
 * to swoop up onto it, or from above the ground to drop onto it.
 */
function flyPath(a: Anchor, b: Anchor, stage: Stage, size: number, onWood: boolean): PathPoint[] {
  const span = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
  const rise = b.p[1] - a.p[1];
  const needed = Math.abs(rise) * 1.4 + 0.6;
  const loop = clamp((needed - span) / needed, 0, 1);
  const reach = Math.max(0.3, (needed - span) / 2.4);
  const out = flightHeading(a.p, b.p, span, reach);
  const into = scale(flightHeading(b.p, a.p, span, reach), -1);
  const turn = (Math.floor(Math.abs(a.p[0] + a.p[2]) * 7) % 2) * 2 - 1;
  const side: Vec = [out[2] * turn, 0, -out[0] * turn];
  const clear = trunkClear(stage, size) * 1.4;
  const climbed = madd(madd(a.p, out, reach * 0.8), side, reach * 0.45 * loop);
  // Into a branch from a little below it; onto the ground on a shallow glide from above.
  const drop = onWood ? -0.22 : 0.2 + Math.max(-rise, 0) * 0.1;
  const coming = madd(madd(b.p, into, -Math.max(reach * 0.8, onWood ? 0 : 0.3 + drop * 1.8)), side, -reach * 0.45 * loop);
  const leave = roundTrunk([climbed[0], a.p[1] + 0.15 + Math.max(rise, 0) * 0.55, climbed[2]], clear);
  const near = roundTrunk([coming[0], b.p[1] + drop, coming[2]], clear);
  const keys = [a.p, a.p, leave, near, b.p, b.p];
  const legs = keys.length - 3;
  const points: PathPoint[] = [];
  for (let i = 0; i <= legs * 10; i += 1) {
    const leg = Math.min(legs - 1, Math.floor(i / 10));
    const p = catmull(keys[leg] ?? a.p, keys[leg + 1] ?? a.p, keys[leg + 2] ?? b.p, keys[leg + 3] ?? b.p, i / 10 - leg);
    // Never through the ground on the way, only off it and onto it at the ends.
    const g = i / (legs * 10);
    const lift = size * 0.3 * Math.min(1, g / 0.15, (1 - g) / 0.15);
    points.push({ p: [p[0], Math.max(p[1], bareY(stage, p[0], p[2]) + lift), p[2]], up: UP });
  }
  return points;
}

/** The height on the trunk and the side of it a place is reached by. */
function trunkFoot(place: Place, a: Anchor, stage: Stage): { h: number; a: number } {
  if (place.on === "trunk") return { h: place.h, a: place.a };
  const trunk = stage.trunk;
  const side = Math.atan2(a.p[2], a.p[0]);
  if (!trunk || place.on === "ground") return { h: 0, a: side };
  return { h: trunkShare(trunk, a.p[1]), a: side };
}

/** A perch's branch as a climber walks it, from the trunk outward: on top of the wood, and where it leaves the trunk. */
function branchWay(place: Place, stage: Stage): { points: PathPoint[]; foot: { h: number; a: number }; wood: readonly Wood[] } | null {
  if (place.on !== "perch" || !stage.trunk) return null;
  const wood = perchOf(stage, place.i)?.path ?? [];
  const first = wood[0];
  const next = wood[1];
  if (!first || !next) return null;
  const a = Math.atan2(next.p[2] - first.p[2], next.p[0] - first.p[0]);
  const foot = { h: trunkShare(stage.trunk, first.p[1]), a };
  const points: PathPoint[] = [trunkPoint(stage, foot.h, a)];
  for (const w of wood.slice(1)) points.push({ p: add(w.p, [0, w.r, 0]), up: UP });
  return { points, foot, wood };
}

const sameWood = (a: Wood | undefined, b: Wood | undefined): boolean => !!a && !!b && length(sub(a.p, b.p)) < 1e-4;

type BranchWay = NonNullable<ReturnType<typeof branchWay>>;

/** Two perches on the same limb: back along one to where they fork, then out the other. */
function sameLimb(from: BranchWay | null, to: BranchWay | null): PathPoint[] | null {
  if (!from || !to) return null;
  let shared = 0;
  while (sameWood(from.wood[shared], to.wood[shared])) shared += 1;
  return shared >= 2 ? [...from.points.slice(shared - 1).reverse(), ...to.points.slice(shared)] : null;
}

/**
 * Over the ground to the trunk, up (or down) the trunk, out along the branch:
 * a climber's way between two places. It keeps to the wood: in along its own
 * branch, round and up the trunk to where the other branch leaves it, and out
 * along that one. Two perches on the same limb meet where their branches part.
 */
function climbPath(from: Place, to: Place, a: Anchor, b: Anchor, stage: Stage, size: number): PathPoint[] {
  if (!stage.trunk || (from.on === "ground" && to.on === "ground")) return walkPath(a, b, stage, size, 0);
  const out: PathPoint[] = [{ p: a.p, up: a.up }];
  const fromWay = branchWay(from, stage);
  const toWay = branchWay(to, stage);
  const fork = sameLimb(fromWay, toWay);
  if (fork) return [...out, ...fork, { p: b.p, up: b.up }];
  if (fromWay) out.push(...[...fromWay.points].reverse());
  const f = fromWay?.foot ?? trunkFoot(from, a, stage);
  const t = toWay?.foot ?? trunkFoot(to, b, stage);
  const steps = Math.max(4, Math.ceil(Math.abs(t.h - f.h) * 14));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const point = trunkPoint(stage, mix(f.h, t.h, u), mix(f.a, t.a + Math.round((f.a - t.a) / TAU) * TAU, u));
    out.push({ p: point.p, up: point.up });
  }
  if (toWay) out.push(...toWay.points);
  out.push({ p: b.p, up: b.up });
  return out;
}

interface PathAt { readonly p: Vec; readonly fw: Vec; readonly up: Vec; readonly travelled: number }

/** The point a share `u` of the way along a path, its heading and its surface's up. */
function alongPath(path: readonly PathPoint[], u: number): PathAt {
  const want = clamp(u, 0, 1) * pathLength(path);
  let a: PathPoint = path[0] ?? { p: [0, 0, 0], up: UP };
  let start = 0;
  for (let i = 1; i < path.length; i += 1) {
    const b = path[i] ?? a;
    const span = length(sub(b.p, a.p));
    if (start + span >= want || i === path.length - 1) {
      const k = clamp((want - start) / Math.max(1e-6, span), 0, 1);
      return { p: lerpV(a.p, b.p, k), fw: unit(sub(b.p, a.p), [0, 0, 1]), up: unit(lerpV(a.up, b.up, k), UP), travelled: want };
    }
    start += span;
    a = b;
  }
  return { p: a.p, fw: [0, 0, 1], up: a.up, travelled: 0 };
}

const pathLength = (path: readonly PathPoint[]): number => {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += length(sub(path[i]?.p ?? UP, path[i - 1]?.p ?? UP));
  return total;
};

// ---------------------------------------------------------------- the director

type MoveMode = "walk" | "fly" | "climb";

interface Segment {
  readonly act: Action;
  readonly t0: number;
  readonly t1: number;
  readonly from: Place;
  readonly to: Place;
  /** Heading while it stays put. */
  readonly yaw: number;
  /** The troupe member it turns to face (-1: none). */
  readonly face: number;
  readonly mode: MoveMode | null;
  /** Gait speed, in sizes a second (0 when it stays put). */
  readonly pace: number;
  /** The heading it turns from as it settles, when that is not `yaw`. */
  readonly turn?: number;
  /** The food it eats while it stays (a `Food.key`). */
  readonly meal?: string;
}

interface Actor {
  readonly index: number;
  readonly member: CastMember;
  readonly spec: SpeciesSpec;
  readonly rand: () => number;
  readonly day: IdleMatrix;
  readonly night: IdleMatrix;
  readonly segments: Segment[];
  until: number;
  place: Place;
  yaw: number;
  last: Action;
  /** Where it was last frame (for others turning to face it). */
  pos: Vec;
  /** The top of its back last frame: where a rider sits. */
  back: Anchor | null;
  /** Its troupe, itself included, to keep out of each other's way. */
  mates: readonly Actor[];
  /** The whole herd's meals, so no fruit is eaten twice. */
  readonly pantry: Pantry;
}

/** Fruit claimed for eating, by key: when the meal ends and who eats it. */
type Pantry = Map<string, { readonly t: number; readonly by: Actor }>;

/** Where the rest of its troupe stands or is headed on the ground. */
const takenBy = (actor: Actor, scene: Scene): Spot[] =>
  actor.mates.filter((mate) => mate !== actor && mate.place.on === "ground").map((mate) => ({ p: placeTop(mate.place, scene), size: mate.member.size }));

interface Troupe {
  readonly kind: CastGroup["kind"];
  readonly actors: Actor[];
  readonly rand: () => number;
  readonly cohesion: number;
}

interface Scene { readonly stage: Stage; readonly backs: readonly (Anchor | null)[] }

const tempo = (actor: Actor): number => (actor.spec.speed < 0.5 ? 1.8 : 1);
const placeTop = (place: Place, scene: Scene): Vec => anchorOf(place, scene.stage, scene.backs).p;

function stay(actor: Actor, act: Action, duration: number, face = -1, yaw = actor.yaw, turn?: number): void {
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to: actor.place, yaw, face, mode: null, pace: 0, ...(turn === undefined ? {} : { turn }) });
  actor.until = t0 + duration;
  actor.last = act;
}

function modeFor(actor: Actor, act: Action, from: Place, to: Place): MoveMode {
  if (actor.spec.flies && (act === "fly" || actor.spec.plan === "bug")) return "fly";
  if (actor.spec.flies && (from.on !== "ground" || to.on !== "ground")) return "fly";
  if (from.on !== "ground" || to.on !== "ground") return "climb";
  return "walk";
}

function pathFor(mode: MoveMode, from: Place, to: Place, scene: Scene, size: number, spring = 0): PathPoint[] {
  const a = anchorOf(from, scene.stage, scene.backs);
  const b = anchorOf(to, scene.stage, scene.backs);
  if (mode === "fly") return flyPath(a, b, scene.stage, size, to.on === "perch" || to.on === "trunk");
  if (mode === "climb") return climbPath(from, to, a, b, scene.stage, size);
  return walkPath(a, b, scene.stage, size, spring);
}

/** How readily an animal hops what is in its way: birds and hoppers spring, small things skip, big ones step. */
function springOf(who: Who): number {
  if (who.spec.plan === "bird") return 1;
  if (HOPPERS.has(who.member.species)) return 0.8;
  if (who.spec.plan === "bug" || who.spec.plan === "serpent") return 0;
  return who.member.size < 0.35 ? 0.5 : 0;
}

const PACE: Partial<Record<Action, number>> = { run: 3.2, hop: 1.4, fly: 4, climb: 0.8 };

/** Go somewhere: a move segment whose length (and so its time) comes from the path. */
function travel(actor: Actor, to: Place, act: Action, scene: Scene, hurry = 1): void {
  const foot = act === "climb" ? trunkSide(actor, to, scene) : null;
  if (foot && actor.place.on === "ground") {
    leg(actor, foot, "wander", scene, hurry);
    leg(actor, to, act, scene, hurry);
  } else if (foot) {
    leg(actor, foot, act, scene, hurry);
    leg(actor, to, "wander", scene, hurry);
  } else {
    leg(actor, to, act, scene, hurry);
  }
}

/**
 * Where a climber steps onto or off the trunk, when it climbs between the
 * tree and a spot on the ground away from it: it walks that part on its feet.
 */
function trunkSide(actor: Actor, to: Place, scene: Scene): Place | null {
  const ground = actor.place.on === "ground" ? actor.place : to.on === "ground" ? to : null;
  if (!ground || !scene.stage.trunk || (actor.place.on === "ground") === (to.on === "ground")) return null;
  const base = scene.stage.trunk.base;
  const dx = ground.x - base[0];
  const dz = ground.z - base[2];
  const d = Math.hypot(dx, dz);
  const near = trunkClear(scene.stage, actor.member.size);
  if (d < near + actor.member.size * 0.8) return null;
  return { on: "ground", x: base[0] + (dx / d) * near, z: base[2] + (dz / d) * near };
}

function leg(actor: Actor, there: Place, act: Action, scene: Scene, hurry: number): void {
  const to: Place = there.on === "ground" ? onGround(scene.stage, actor.member.size, there.x, there.z) : there;
  const mode = modeFor(actor, act, actor.place, to);
  const path = pathFor(mode, actor.place, to, scene, actor.member.size, springOf(actor));
  const pace = actor.spec.speed * (PACE[act] ?? 1) * hurry * (mode === "fly" ? 2.5 : 1);
  const duration = Math.max(0.5, pathLength(path) / Math.max(0.02, pace * actor.member.size));
  const end = alongPath(path, 1);
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to, yaw: actor.yaw, face: -1, mode, pace });
  actor.until = t0 + duration;
  actor.place = to;
  if (Math.hypot(end.fw[0], end.fw[2]) > 0.2) actor.yaw = Math.atan2(end.fw[0], end.fw[2]);
  actor.last = act;
}

const perchCount = (scene: Scene): number => scene.stage.perches?.length ?? 0;
/** Whether a spot on a branch is far enough out from the trunk that the animal's body and tail keep out of the bark. */
function perchRoom(stage: Stage, i: number, size: number): boolean {
  const perch = perchOf(stage, i);
  const trunk = stage.trunk;
  if (!perch || !trunk) return true;
  const axis = trunkAxis(trunk, trunkShare(trunk, perch.p[1]));
  return Math.hypot(perch.p[0] - axis.p[0], perch.p[2] - axis.p[2]) >= axis.r + size * 0.7;
}

/** A branch to sit on, thick enough to take the animal (a monkey keeps off the twigs a songbird uses) and out from the trunk. */
function randomPerch(actor: Actor, scene: Scene): Place {
  const size = actor.member.size;
  let i = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    i = Math.floor(actor.rand() * 9973);
    if ((perchOf(scene.stage, i)?.r ?? 1) >= size * 0.12 && perchRoom(scene.stage, i, size)) break;
  }
  return { on: "perch", i };
}

/** The branch spot nearest `i` in the list that has room for the animal, or `i` when none does. */
function roomyPerch(stage: Stage, i: number, size: number): number {
  const count = stage.perches?.length ?? 0;
  for (let k = 0; k < count; k += 1) {
    for (const j of [i + k, i - k]) if (perchRoom(stage, j, size)) return j;
  }
  return i;
}

/** Where a move action takes this animal from where it is. */
function destination(actor: Actor, act: Action, scene: Scene): Place | null {
  const size = actor.member.size;
  const up = actor.place.on !== "ground";
  const perches = perchCount(scene) > 0;
  const perchOr = (odds: number): Place => (perches && actor.rand() < odds ? randomPerch(actor, scene) : groundSpot(actor.rand, scene.stage, size, undefined, 0, takenBy(actor, scene)));
  if (act === "climb") return perches ? perchOr(up ? 0.55 : 1) : null;
  if (act === "fly" || actor.spec.plan === "bug") return perchOr(0.55);
  if (up) return perchOr(actor.spec.climbs ? 0.5 : 0);
  const reach = act === "run" ? scene.stage.radius : Math.max(size * 4, 0.8);
  return groundSpot(actor.rand, scene.stage, size, placeTop(actor.place, scene), reach, takenBy(actor, scene));
}

/** Get to where an action can be done: down from the tree, up to a branch, onto the trunk. */
function prepare(actor: Actor, act: Action, scene: Scene): Action {
  const size = actor.member.size;
  if (GROUNDED.has(act) && actor.place.on !== "ground") {
    travel(actor, groundSpot(actor.rand, scene.stage, size, undefined, 0, takenBy(actor, scene)), actor.spec.flies ? "fly" : "climb", scene);
    return act;
  }
  if (act === "hang") {
    if (perchCount(scene) === 0) return "sit";
    if (actor.place.on !== "perch") travel(actor, randomPerch(actor, scene), "climb", scene);
    return act;
  }
  if (act === "drum" && actor.place.on !== "trunk") {
    if (!scene.stage.trunk) return "look";
    travel(actor, { on: "trunk", h: 0.25 + actor.rand() * 0.5, a: actor.rand() * TAU }, "fly", scene);
  }
  return act;
}

/** The fruit an eater goes for: the nearest it can reach that no one else has claimed, give or take. */
function pickFood(actor: Actor, scene: Scene): Food | null {
  const reach = FRUIT_EATERS[actor.member.species];
  const food = scene.stage.food ?? [];
  if (!reach || food.length === 0) return null;
  const size = actor.member.size;
  const up = reach !== "ground" && (actor.spec.climbs || actor.spec.flies) && perchCount(scene) > 0;
  const here = placeTop(actor.place, scene);
  let best: Food | null = null;
  let nearest = Infinity;
  for (const item of food) {
    const perch = item.perch;
    if (perch === undefined ? reach === "tree" : !up || (perchOf(scene.stage, perch)?.r ?? 0) < size * 0.12 || !perchRoom(scene.stage, perch, size)) continue;
    if ((actor.pantry.get(item.key)?.t ?? -Infinity) > actor.until) continue;
    const d = length(sub(item.p, here)) * (0.75 + actor.rand() * 0.5);
    if (d < nearest) { nearest = d; best = item; }
  }
  return best;
}

const MOUTHS = new Map<string, number>();
/** How far ahead of where it stands an animal's mouth comes down when it eats this way, read off its own pose. */
function mouthReach(actor: Actor, act: Action): number {
  const id = actor.member.species;
  const key = `${id}.${act}`;
  let reach = MOUTHS.get(key);
  if (reach === undefined) {
    let low = Infinity;
    reach = 0;
    for (const t of [0.5, 1.5, 2.5, 3.5]) {
      for (const c of poseSpecies(id, act, t).capsules) {
        if (!/head|muzzle|snout|beak|jaw|mouth/.test(c.part)) continue;
        for (const p of [c.a, c.b]) if (p[1] < low) { low = p[1]; reach = p[2]; }
      }
    }
    reach /= actor.spec.size;
    MOUTHS.set(key, reach);
  }
  return reach * actor.member.size;
}

/**
 * Go and eat a fruit, now and then, when there is one in reach and it is the
 * animal's waking hours: up to the branch it hangs from, or over to where it
 * lies, then a while eating it facing it. The meal goes in the pantry.
 */
function forage(actor: Actor, scene: Scene): boolean {
  if (!FRUIT_EATERS[actor.member.species] || (scene.stage.food?.length ?? 0) === 0) return false;
  if (actor.spec.active === (scene.stage.night === true ? "day" : "night") || actor.rand() >= APPETITE) return false;
  const item = pickFood(actor, scene);
  if (!item) return false;
  const size = actor.member.size;
  const act: Action = actor.spec.plan === "bird" ? "peck" : actor.spec.plan === "primate" || can(actor, "eat") ? "eat" : "graze";
  if (item.perch !== undefined) {
    if (actor.place.on !== "perch" || actor.place.i !== item.perch) travel(actor, { on: "perch", i: item.perch }, actor.spec.flies ? "fly" : "climb", scene);
  } else {
    // It comes up to the fruit from its own side and stops with its mouth over it.
    const from = placeTop(actor.place, scene);
    const side = Math.atan2(from[0] - item.p[0], from[2] - item.p[2]);
    const gap = Math.max(size * 0.15, mouthReach(actor, act));
    const spot = onGround(scene.stage, size, item.p[0] + Math.sin(side) * gap, item.p[2] + Math.cos(side) * gap);
    travel(actor, spot, groundMove(actor, spot, scene), scene);
  }
  stay(actor, act, between(actor.rand, [3, 7]) * tempo(actor), -1, yawFrom(placeTop(actor.place, scene), item.p));
  const last = actor.segments.length - 1;
  const segment = actor.segments[last];
  if (segment) actor.segments[last] = { ...segment, meal: item.key };
  actor.pantry.set(item.key, { t: actor.until, by: actor });
  return true;
}

/** One link of an animal's own chain of idle actions. */
function soloStep(actor: Actor, scene: Scene): void {
  if (forage(actor, scene)) return;
  const matrix = scene.stage.night === true ? actor.night : actor.day;
  const act = nextAction(matrix, actor.last, actor.rand);
  if (MOVES.has(act)) {
    const to = destination(actor, act, scene);
    if (to) { travel(actor, to, to.on === "ground" && actor.place.on === "ground" && actor.spec.plan === "bird" ? groundMove(actor, to, scene) : act, scene); return; }
    stay(actor, "look", between(actor.rand, SPAN.look));
    return;
  }
  const ready = prepare(actor, act, scene);
  stay(actor, ready, between(actor.rand, SPAN[ready]) * tempo(actor));
}

/** Hold the troupe members still (looking about, or resting) until `time`. */
function waitUntil(actors: readonly Actor[], time: number): void {
  for (const actor of actors) {
    if (actor.until < time - 0.05) stay(actor, actor.last === "lie" || actor.last === "sleep" ? "lie" : "look", time - actor.until);
  }
}

/** Bring members down out of the tree for a scene on the ground. */
function toGround(actors: readonly Actor[], scene: Scene): void {
  for (const actor of actors) {
    if (actor.place.on !== "ground") travel(actor, groundSpot(actor.rand, scene.stage, actor.member.size, undefined, 0, takenBy(actor, scene)), actor.spec.flies ? "fly" : "climb", scene);
  }
}

const placeBeside = (target: Vec, yaw: number, side: number, gap: number): Place => ({ on: "ground", x: target[0] + Math.cos(yaw) * side * gap, z: target[2] - Math.sin(yaw) * side * gap });
const yawFrom = (a: Vec, b: Vec): number => Math.atan2(b[0] - a[0], b[2] - a[2]);

// ---------------------------------------------------------------- joint scenes

/** Hold an actor in one action until `time`. */
function holdAs(actor: Actor, act: Action, time: number, partner?: Actor, scene?: Scene): void {
  if (actor.until >= time - 0.02) return;
  if (partner && scene) stayFacing(actor, act, time - actor.until, partner, scene);
  else stay(actor, act, time - actor.until);
}

/** Stay turned to a partner, and keep facing that way after, so the next action starts from there. */
function stayFacing(actor: Actor, act: Action, duration: number, partner: Actor, scene: Scene): void {
  stay(actor, act, duration, partner.index);
  const here = placeTop(actor.place, scene);
  const there = placeTop(partner.place, scene);
  if (actor.place.on === "ground" && Math.hypot(there[0] - here[0], there[2] - here[2]) > 1e-3) actor.yaw = yawFrom(here, there);
}

/** Bring the actors together in time (and down to the ground when the scene needs it). */
function begin(actors: readonly Actor[], scene: Scene, ground = true): number {
  if (ground) toGround(actors, scene);
  const start = Math.max(...actors.map((actor) => actor.until));
  waitUntil(actors, start);
  return start;
}

const can = (actor: Actor, act: Action): boolean => actor.day.actions.includes(act);
const walkers = (troupe: Troupe): Actor[] => troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "primate");
function twoOf(list: readonly Actor[], rand: () => number): [Actor, Actor] | null {
  if (list.length < 2) return null;
  const i = Math.floor(rand() * list.length);
  const j = (i + 1 + Math.floor(rand() * (list.length - 1))) % list.length;
  const a = list[i];
  const b = list[j];
  return a && b ? [a, b] : null;
}

/** How far ahead of its middle an animal's nose is. */
const headReach = (actor: Actor): number => actor.member.size * (actor.spec.build.len * 0.5 + actor.spec.build.neck + actor.spec.build.head * 1.5);

/** One animal grooms another, who lies (or sits) still for it. */
function groomScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(walkers(troupe).filter((actor) => can(actor, "groom")), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const bp = placeTop(b.place, scene);
  travel(a, placeBeside(bp, b.yaw, troupe.rand() < 0.5 ? -1 : 1, (a.member.size + b.member.size) * 0.5), "wander", scene);
  holdAs(b, "sit", a.until);
  const length = between(troupe.rand, [5, 9]);
  stay(b, b.spec.plan === "primate" ? "sit" : "lie", length);
  stayFacing(a, "groom", length, b, scene);
  return true;
}

/** Two meet face to face and touch noses (or beaks). */
function nuzzleScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "bird"), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const pa = placeTop(a.place, scene);
  const pb = placeTop(b.place, scene);
  const mid = lerpV(pa, pb, 0.5);
  const dir = unit(sub(pb, pa), [1, 0, 0]);
  const gap = (headReach(a) + headReach(b)) * 0.5 + 0.02;
  travel(a, { on: "ground", x: mid[0] - dir[0] * gap, z: mid[2] - dir[2] * gap }, "wander", scene);
  travel(b, { on: "ground", x: mid[0] + dir[0] * gap, z: mid[2] + dir[2] * gap }, "wander", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  holdAs(b, "look", start, a, scene);
  const length = between(troupe.rand, SPAN.nuzzle);
  stayFacing(a, "nuzzle", length, b, scene);
  stayFacing(b, "nuzzle", length, a, scene);
  return true;
}

/**
 * Plan a move for `actor` that gets in no sooner than `leader` does: it waits,
 * watching, before setting off, so it never pulls up where the leader is still to run.
 */
function arriveAfter(actor: Actor, leader: Actor, move: () => void): void {
  const at = actor.place;
  const start = actor.until;
  const first = actor.segments.length;
  move();
  const late = leader.until + 0.15 - actor.until;
  if (late <= 0) return;
  const moved = actor.segments.splice(first).map((segment) => ({ ...segment, t0: segment.t0 + late, t1: segment.t1 + late }));
  actor.segments.push({ act: "look", t0: start, t1: start + late, from: at, to: at, yaw: moved[0]?.yaw ?? actor.yaw, face: leader.index, mode: null, pace: 0 }, ...moved);
  actor.until += late;
}

/** A chase: one runs a loop, the other runs after it; then a play bow. */
function chaseScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(walkers(troupe).filter((actor) => actor.spec.speed >= 0.8), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const stops = [0, 1, 2].map(() => groundSpot(troupe.rand, scene.stage, a.member.size));
  stayFacing(b, "play", 0.7, a, scene);
  for (const stop of stops) {
    const from = placeTop(a.place, scene);
    travel(a, stop, "run", scene);
    const to = placeTop(stop, scene);
    const back = unit(sub(from, to), [0, 0, -1]);
    const gap = a.member.size * a.spec.build.len + b.member.size * b.spec.build.len;
    arriveAfter(b, a, () => { travel(b, { on: "ground", x: to[0] + back[0] * gap, z: to[2] + back[2] * gap }, "run", scene, 1.05); });
  }
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  holdAs(b, "look", start, a, scene);
  stayFacing(a, "play", 1.8, b, scene);
  stayFacing(b, "play", 1.8, a, scene);
  return true;
}

/** The pack follows its leader across the ground, single file. */
function followScene(troupe: Troupe, scene: Scene): boolean {
  const pack = troupe.actors.filter((actor) => actor.spec.plan === "quad" || actor.spec.plan === "primate" || actor.spec.plan === "crab");
  const leader = pack[0];
  if (!leader || pack.length < 2) return false;
  begin(pack, scene);
  for (let leg = 0; leg < 2; leg += 1) {
    const stop = groundSpot(troupe.rand, scene.stage, leader.member.size);
    const from = placeTop(leader.place, scene);
    travel(leader, stop, "wander", scene);
    const to = placeTop(stop, scene);
    const back = unit(sub(from, to), [0, 0, -1]);
    pack.slice(1).forEach((actor, i) => {
      const gap = (i + 1) * (leader.member.size * leader.spec.build.len + 0.08);
      holdAs(actor, "look", actor.until + 0.5 + i * 0.4);
      travel(actor, { on: "ground", x: to[0] + back[0] * gap, z: to[2] + back[2] * gap }, "wander", scene);
    });
  }
  return true;
}

/** Everyone sings (or howls, or stands up to keep watch), one after another. */
function chorusScene(troupe: Troupe, scene: Scene): boolean {
  const voice = (actor: Actor): Action | null => (can(actor, "howl") ? "howl" : can(actor, "sing") ? "sing" : actor.spec.temper.rear !== undefined && actor.spec.temper.rear >= 2 ? "rear" : null);
  const singers = troupe.actors.filter((actor) => voice(actor) !== null);
  if (singers.length < 2) return false;
  const start = begin(singers, scene, false);
  singers.forEach((actor, i) => {
    holdAs(actor, actor.spec.plan === "quad" ? "sit" : "look", start + i * 0.7);
    stay(actor, voice(actor) ?? "look", between(troupe.rand, [3.5, 5.5]));
  });
  return true;
}

/** All curl up together around one spot. */
function huddleScene(troupe: Troupe, scene: Scene): boolean {
  const sleepers = troupe.actors.filter((actor) => can(actor, "sleep") && actor.spec.plan !== "bird");
  if (sleepers.length < 2) return false;
  begin(sleepers, scene);
  const first = sleepers[0];
  if (!first) return false;
  const centre = placeTop(groundSpot(troupe.rand, scene.stage, first.member.size * 2), scene);
  // Neighbours lie a body's width apart round the ring, each curled along it.
  const widest = Math.max(...sleepers.map((actor) => actor.spec.build.body * actor.member.size));
  const longest = Math.max(...sleepers.map((actor) => actor.spec.build.len * actor.member.size));
  const ring = Math.max(widest * 2.4, longest * 1.05) / (2 * Math.sin(Math.PI / sleepers.length));
  const turn = troupe.rand() * TAU;
  const arrived = sleepers.map((actor, i) => {
    const a = (i / sleepers.length) * TAU + turn;
    travel(actor, { on: "ground", x: centre[0] + Math.cos(a) * ring, z: centre[2] + Math.sin(a) * ring }, "wander", scene);
    const yaw = actor.yaw;
    actor.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    return yaw;
  });
  const start = Math.max(...sleepers.map((actor) => actor.until));
  const length = between(troupe.rand, [16, 34]);
  sleepers.forEach((actor, i) => {
    const wait = start - actor.until;
    if (wait > 0.02) stay(actor, "lie", wait, -1, actor.yaw, arrived[i]);
    stay(actor, scene.stage.night === true ? "sleep" : "lie", length, -1, actor.yaw, wait > 0.02 ? undefined : arrived[i]);
  });
  return true;
}

/** Two birds face each other and dance (a crane's leaping, a peacock's fan). */
function danceScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => can(actor, "display")), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const pa = placeTop(a.place, scene);
  const gap = headReach(a) + headReach(b);
  const yaw = troupe.rand() * TAU;
  travel(b, { on: "ground", x: pa[0] + Math.sin(yaw) * gap, z: pa[2] + Math.cos(yaw) * gap }, "wander", scene);
  holdAs(a, "look", b.until, b, scene);
  const length = between(troupe.rand, SPAN.display);
  stayFacing(a, "display", length, b, scene);
  stayFacing(b, a.member.species === "peacock" ? "peck" : "display", length, a, scene);
  return true;
}

/** A young one comes to its parent: to nurse, or to be fed. */
function feedScene(troupe: Troupe, scene: Scene): boolean {
  const parent = troupe.actors.find((actor) => !actor.member.young);
  const young = troupe.actors.find((actor) => actor.member.young);
  if (!parent || !young || parent.spec.plan === "bug") return false;
  begin([parent, young], scene);
  const pp = placeTop(parent.place, scene);
  const gap = parent.spec.plan === "bird" ? parent.member.size * 0.6 : parent.member.size * 0.35;
  travel(young, placeBeside(pp, parent.yaw, troupe.rand() < 0.5 ? -1 : 1, gap), "wander", scene);
  holdAs(parent, "look", young.until, young, scene);
  const length = between(troupe.rand, [5, 10]);
  const bird = parent.spec.plan === "bird";
  stay(parent, bird ? "peck" : can(parent, "graze") ? "graze" : "groom", length, bird ? young.index : -1);
  stayFacing(young, bird ? "flap" : "nuzzle", length, parent, scene);
  return true;
}

/** A bird flies down onto a bigger animal's back and rides along a while. */
function rideScene(troupe: Troupe, scene: Scene): boolean {
  const rider = troupe.actors.find((actor) => actor.spec.plan === "bird" && actor.spec.flies);
  const mount = troupe.actors.find((actor) => actor.spec.plan === "quad" && actor.member.size >= 0.4 && actor.index < (rider?.index ?? -1));
  if (!rider || !mount || rider.place.on === "back") return false;
  begin([rider], scene, false);
  travel(rider, { on: "back", m: mount.index }, "fly", scene);
  for (let i = 0; i < 4; i += 1) stay(rider, pick(troupe.rand, [["look", 3], ["preen", 2], ["sing", 1.5], ["stand", 1]]), between(troupe.rand, [3, 6]));
  return true;
}

/** Climbers go up the tree together and sit near each other. */
function climbScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.climbs && !actor.spec.flies), troupe.rand);
  if (!pair || perchCount(scene) === 0) return false;
  const [a, b] = pair;
  begin(pair, scene, false);
  const i = Math.floor(troupe.rand() * 9973);
  travel(a, { on: "perch", i }, "climb", scene);
  stayFacing(b, "look", 0.8, a, scene);
  travel(b, { on: "perch", i: i + 1 }, "climb", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "sit", start);
  const length = between(troupe.rand, [6, 12]);
  stay(a, can(a, "eat") ? "eat" : "sit", length);
  stayFacing(b, can(b, "groom") ? "groom" : "sit", length, a, scene);
  return true;
}

type SceneFn = (troupe: Troupe, scene: Scene) => boolean;
const SCENES: readonly (readonly [SceneFn, number])[] = [
  [groomScene, 3], [nuzzleScene, 1.2], [chaseScene, 2], [followScene, 2], [chorusScene, 1.5],
  [huddleScene, 1], [danceScene, 3], [feedScene, 3], [rideScene, 4], [climbScene, 2],
];

/** Try the joint scenes in a seeded order until one fits the troupe. */
function tryScene(troupe: Troupe, scene: Scene): boolean {
  const left = [...SCENES];
  while (left.length > 0) {
    const fn = pick(troupe.rand, left);
    if (fn(troupe, scene)) return true;
    left.splice(left.findIndex(([candidate]) => candidate === fn), 1);
  }
  return false;
}

/** Write each troupe's timelines on until every member is busy past `horizon`. */
function extend(troupe: Troupe, horizon: number, scene: Scene): void {
  for (let guard = 0; guard < 96; guard += 1) {
    let next: Actor | undefined;
    for (const actor of troupe.actors) if (!next || actor.until < next.until) next = actor;
    if (!next || next.until >= horizon) return;
    if (troupe.actors.length > 1 && troupe.rand() < troupe.cohesion && tryScene(troupe, scene)) continue;
    soloStep(next, scene);
  }
}

// ---------------------------------------------------------------- moments and poses

/** One capsule of an animal's body, in the world: a ball when a and b meet. */
export interface Capsule {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: Role;
  readonly part: string;
  /** Thickness across `up`, as a share of r (1 round, 0.2 a flat wing). */
  readonly flat: number;
  /** The capsule's thin axis (the animal's up for most parts). */
  readonly up: Vec;
  /** The animal's front, for orienting balls. */
  readonly fw: Vec;
}

const POSE_KEYS = ["crouch", "sit", "lie", "curl", "rear", "bow", "roll", "headPitch", "headYaw", "headRoll", "tailUp", "tailWag", "earBack", "mouth", "scratch", "dig", "shake", "wing", "flap", "peck", "fan", "reach", "hand", "hang", "hop", "lift"] as const;
type PoseKey = (typeof POSE_KEYS)[number];
type Pose = Record<PoseKey, number>;
const restPose = (): Pose => Object.fromEntries(POSE_KEYS.map((key) => [key, 0])) as Pose;

const bump = (k: number): number => Math.sin(Math.PI * clamp(k, 0, 1));
const pulse = (t: number, every: number, width: number): number => { const u = (t % every) / every; return u < width ? bump(u / width) : 0; };

type PoseFn = (tl: number, k: number, d: number) => Partial<Pose>;
/** What each action does to the body, `tl` seconds into it, `k` of the way through. */
const ACTION_POSE: Readonly<Record<Action, PoseFn>> = {
  stand: (tl) => ({ headYaw: 0.25 * Math.sin(tl * 0.7), tailWag: 0.15 * Math.sin(tl * 2) }),
  look: (tl) => ({ headYaw: 1.05 * Math.sin(tl * 0.9) * Math.min(1, tl), headPitch: 0.15, earBack: -0.3 }),
  sniff: (tl) => ({ headPitch: -0.55 + 0.08 * Math.sin(tl * 14), crouch: 0.15, headYaw: 0.3 * Math.sin(tl * 1.7) }),
  graze: (tl) => { const up = pulse(tl + 2, 5.5, 0.3); return { headPitch: -1.25 * (1 - up), bow: 0.3 * (1 - up), mouth: Math.sin(tl * 9) > 0 ? 0.3 : 0, tailWag: 0.2 * Math.sin(tl * 3) }; },
  groom: (tl) => ({ curl: 0.5, sit: 0.35, headYaw: 1.45, headPitch: -0.5 + 0.15 * Math.sin(tl * 8), reach: 1, hand: 0.5 + 0.5 * Math.sin(tl * 3) }),
  scratch: (tl) => ({ sit: 0.65, scratch: 1, headRoll: 0.35, headPitch: -0.1, hand: 0.5 + 0.5 * Math.sin(tl * 20) }),
  sit: (tl) => ({ sit: 1, headYaw: 0.4 * Math.sin(tl * 0.5), tailWag: 0.1 * Math.sin(tl) }),
  lie: (tl) => ({ lie: 1, headYaw: 0.3 * Math.sin(tl * 0.4), headPitch: -0.15 }),
  sleep: (tl) => ({ lie: 1, sit: 0.3, curl: 1, headPitch: -0.45, earBack: 0.6, lift: 0.04 * Math.sin(tl * 1.6) }),
  stretch: (_tl, k) => ({ bow: bump(k / 0.6), tailUp: 0.8 * bump(k), rear: 0.2 * bump((k - 0.6) / 0.4) }),
  shake: (_tl, k) => ({ shake: bump(k), earBack: 0.4 }),
  yawn: (_tl, k) => ({ mouth: bump(k), headPitch: 0.5 * bump(k), sit: 0.3 }),
  rear: (tl) => ({ rear: 1, headYaw: 0.6 * Math.sin(tl * 0.8), earBack: -0.4 }),
  dig: (tl) => ({ dig: 1, crouch: 0.25, headPitch: -0.6, tailUp: 0.3 + 0.1 * Math.sin(tl * 7) }),
  roll: (_tl, k) => ({ lie: 1, roll: bump(k), tailWag: 0.5 * bump(k) }),
  howl: (_tl, k) => ({ sit: 1, headPitch: 1.15 * bump(k * 1.1), mouth: 0.55 * bump(k * 1.1), earBack: 0.5 }),
  eat: (tl) => ({ sit: 1, hand: 1, mouth: Math.sin(tl * 10) > 0 ? 0.35 : 0, headPitch: -0.15, rear: 0.2 }),
  peck: (tl) => ({ peck: pulse(tl, 0.55, 0.45), headPitch: -0.3 }),
  preen: (tl) => ({ headYaw: 2.3, headPitch: -0.45 + 0.1 * Math.sin(tl * 9), wing: 0.25 }),
  flap: (tl, k) => ({ wing: bump(k * 1.05) > 0.1 ? 1 : bump(k * 1.05) * 10, flap: Math.sin(tl * 22), hop: 0.15 * Math.abs(Math.sin(tl * 11)) }),
  sing: (tl) => ({ headPitch: 0.45, mouth: Math.abs(Math.sin(tl * 13)) * 0.8, tailWag: 0.2 * Math.sin(tl * 6) }),
  display: (tl, k, d) => ({ fan: smooth(Math.min(k * d, (1 - k) * d) / 0.8), wing: 0.7, flap: 0.4 * Math.sin(tl * 4), hop: 0.5 * Math.max(0, Math.sin(tl * 3.2)), headPitch: 0.3 }),
  drum: (tl) => ({ peck: pulse(tl, 0.09, 0.9) * (pulse(tl, 1.6, 0.6) > 0 ? 1 : 0) }),
  bask: (tl) => ({ lie: 1, headPitch: 0.15 + 0.05 * Math.sin(tl * 0.5) }),
  coil: (tl) => ({ curl: 1, lie: 1, headPitch: 0.2, headYaw: 0.3 * Math.sin(tl * 0.3) }),
  flick: (tl) => ({ mouth: pulse(tl, 0.5, 0.5), headPitch: 0.25, lie: 1 }),
  hover: (tl) => ({ flap: Math.sin(tl * 18), lift: 0.5 + 0.15 * Math.sin(tl * 1.3) }),
  wave: (tl) => ({ reach: 0.5 + 0.5 * Math.sin(tl * 7), hand: Math.abs(Math.sin(tl * 3.5)) }),
  hang: (tl) => ({ hang: 1, headYaw: 0.4 * Math.sin(tl * 0.3), hand: 0.5 + 0.5 * Math.sin(tl * 0.8) }),
  nuzzle: (tl) => ({ headPitch: -0.3 + 0.08 * Math.sin(tl * 3), crouch: 0.1, headYaw: 0.15 * Math.sin(tl * 2), tailWag: 0.7 * Math.sin(tl * 7), earBack: 0.3 }),
  play: (tl) => ({ bow: 1, tailWag: Math.sin(tl * 10), tailUp: 0.6, hop: 0.35 * Math.abs(Math.sin(tl * 5)), headYaw: 0.25 * Math.sin(tl * 3) }),
  wander: () => ({}), run: () => ({ earBack: 0.5, tailUp: 0.3 }), hop: () => ({}), climb: () => ({}), fly: () => ({ wing: 1, flap: 1 }),
};

const FADE = 0.45;

function paramsOf(segment: Segment, t: number): Pose {
  const d = Math.max(0.01, segment.t1 - segment.t0);
  const tl = Math.max(0, t - segment.t0);
  return { ...restPose(), ...ACTION_POSE[segment.act](tl, clamp(tl / d, 0, 1), d) };
}

/** The pose at `t`, cross-faded from the action before for the first moments of this one. */
function blendedPose(segment: Segment, prev: Segment | undefined, t: number): Pose {
  const now = paramsOf(segment, t);
  const k = smooth((t - segment.t0) / FADE);
  if (!prev || k >= 1) return now;
  const before = paramsOf(prev, Math.min(t, prev.t1 + FADE));
  return Object.fromEntries(POSE_KEYS.map((key) => [key, mix(before[key], now[key], k)])) as Pose;
}

interface Moment {
  readonly frame: Frame;
  /** Gait phase, in strides. */
  readonly phase: number;
  /** 0 standing, 1 moving at full gait. */
  readonly moving: number;
  readonly pace: number;
  readonly mode: MoveMode | null;
  readonly segment: Segment;
  readonly pose: Pose;
  /** Facing a partner: where its head is. */
  readonly t: number;
}

function segmentAt(actor: Actor, t: number): { segment: Segment; prev: Segment | undefined } {
  const list = actor.segments;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const segment = list[i];
    if (segment && segment.t0 <= t) return { segment, prev: list[i - 1] };
  }
  const first = list[0];
  if (!first) throw new Error("fauna: an actor has no timeline");
  return { segment: first, prev: undefined };
}

const turnToward = (from: number, to: number, k: number): number => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
const flat = (v: Vec): Vec => unit([v[0], 0, v[2]], [0, 0, 1]);
/** A flier's heading: it climbs and dives at a slant, never nose to the sky. */
const level = (v: Vec): Vec => dirOf(Math.atan2(v[0], v[2]), clamp(Math.asin(clamp(v[1], -1, 1)), -0.5, 0.45));

const TURN_TIME = 0.4;
/** How far the body travels in one gait cycle; a foot planted for `duty` of it moves back `duty` of this. */
const bodyStride = (who: Who): number => who.member.size * Math.max(0.5, who.spec.build.len) * 1.1;

function movingFrame(actor: Actor, segment: Segment, t: number, scene: Scene, from = segment.yaw): { frame: Frame; phase: number; moving: number } {
  const mode = segment.mode ?? "walk";
  const path = pathFor(mode, segment.from, segment.to, scene, actor.member.size, springOf(actor));
  const d = Math.max(0.01, segment.t1 - segment.t0);
  const u = clamp((t - segment.t0) / d, 0, 1);
  const stride = bodyStride(actor);
  let share = 0.75 * u + 0.25 * smooth(u);
  if (mode === "climb") {
    // A climber reaches, grips and pulls: it all but stops while a hand goes
    // up, then surges as it hauls itself after it, once for each hand.
    const total = Math.max(1e-6, pathLength(path));
    const along = share * total;
    const reach = stride * 0.5;
    share = clamp((along - (reach * 0.7 * Math.sin((TAU * along) / reach)) / TAU) / total, 0, 1);
  }
  const at = alongPath(path, share);
  // Climbing, it follows the wood's slope; walking, it keeps level, and it
  // turns onto its way over its first steps instead of all at once.
  let fw = mode === "climb" ? at.fw : mode === "fly" ? level(at.fw) : flat(at.fw);
  const turning = (t - segment.t0) / TURN_TIME;
  if (mode !== "climb" && turning < 1) fw = dirOf(turnToward(from, Math.atan2(fw[0], fw[2]), smooth(turning)), Math.asin(clamp(fw[1], -1, 1)));
  const moving = clamp(Math.min(1, (t - segment.t0) / 0.25, (segment.t1 - t) / 0.25), 0, 1);
  const p = add(at.p, [0, hopLift(actor, segment, mode, at.travelled) * moving, 0]);
  return { frame: frameOf(p, fw, mode === "fly" ? UP : at.up), phase: at.travelled / stride, moving };
}

/** A bird going a little way on the ground goes in hops, not a glide. */
function hopLift(actor: Actor, segment: Segment, mode: MoveMode, travelled: number): number {
  if (mode !== "walk" || segment.act !== "hop" || actor.spec.plan !== "bird") return 0;
  const size = actor.member.size;
  return size * 0.22 * Math.abs(Math.sin((Math.PI * travelled) / (size * 0.8)));
}

/** Which way an animal sits on a branch: a bird across it, gripping it, facing the side it came in on; others along it. */
function perchYaw(actor: Actor, along: Vec, came: number): number {
  const yaw = Math.atan2(along[0], along[2]);
  if (actor.spec.plan !== "bird") return yaw;
  const left = yaw + Math.PI / 2;
  return Math.cos(left - came) >= 0 ? left : yaw - Math.PI / 2;
}

function restingFrame(actor: Actor, segment: Segment, t: number, scene: Scene, partners: readonly Actor[], turn = segment.turn): Frame {
  const anchor = anchorOf(segment.to, scene.stage, scene.backs);
  if (segment.to.on === "trunk") {
    return segment.act === "drum" || actor.spec.plan === "bird" ? frameOf(madd(anchor.p, anchor.up, actor.member.size * 0.15), scale(anchor.up, -1), UP) : frameOf(anchor.p, UP, anchor.up);
  }
  let yaw = anchor.along ? perchYaw(actor, anchor.along, segment.yaw) : segment.yaw;
  const partner = segment.face >= 0 ? partners[segment.face] : undefined;
  if (partner) yaw = turnToward(turn ?? segment.yaw, yawFrom(anchor.p, partner.pos), smooth((t - segment.t0) / 0.6));
  else if (turn !== undefined && !anchor.along) yaw = turnToward(turn, segment.yaw, smooth((t - segment.t0) / (TURN_TIME * 2)));
  return frameOf(anchor.p, dirOf(yaw, 0), anchor.up);
}

const frameYaw = (f: Frame): number => Math.atan2(f.z[0], f.z[2]);

function momentOf(actor: Actor, t: number, scene: Scene, partners: readonly Actor[]): Moment {
  const { segment, prev } = segmentAt(actor, t);
  const pose = blendedPose(segment, prev, t);
  // Each action turns on from the heading the last one really ended on (a
  // partner it watched may have moved on; a short look may not have finished
  // turning), so the body never snaps round between them.
  const from = prev?.mode === null && prev.to.on === "ground" ? frameYaw(restingFrame(actor, prev, t, scene, partners)) : undefined;
  if (segment.mode) {
    const { frame, phase, moving } = movingFrame(actor, segment, t, scene, from);
    return { frame, phase, moving, pace: segment.pace, mode: segment.mode, segment, pose, t };
  }
  return { frame: restingFrame(actor, segment, t, scene, partners, from ?? segment.turn), phase: 0, moving: 0, pace: 0, mode: null, segment, pose, t };
}

// ---------------------------------------------------------------- the kit: capsules in the animal's own frame

interface Kit {
  readonly f: Frame;
  readonly out: Capsule[];
  /** A turn of the whole body about its long axis (a roll onto the back, a shake), about `pivot`. */
  readonly roll: number;
  readonly pivot: Vec;
}

const rolled = (kit: Kit, v: Vec): Vec => (kit.roll === 0 ? v : add(rollV(sub(v, kit.pivot), kit.roll), kit.pivot));

function cap(kit: Kit, part: string, role: Role, a: Vec, b: Vec, r: number, flatness = 1, up: Vec = UP): void {
  if (!(r > 0.0002)) return;
  const upRolled = kit.roll === 0 ? up : rollV(up, kit.roll);
  kit.out.push({ a: toWorld(kit.f, rolled(kit, a)), b: toWorld(kit.f, rolled(kit, b)), r, role, part, flat: flatness, up: unit(dirToWorld(kit.f, upRolled), kit.f.y), fw: kit.f.z });
}
const ball = (kit: Kit, part: string, role: Role, p: Vec, r: number, flatness = 1, up: Vec = UP): void => { cap(kit, part, role, p, p, r, flatness, up); };

/** A two-bone limb from `root` to `target`, bending toward `pole`, with a paw (or hand, or foot) at the end. */
function limb(kit: Kit, part: string, role: Role, root: Vec, target: Vec, lengths: readonly [number, number], radius: number, pole: Vec, end: Role = "dark"): Vec {
  // A target on the ground (or the bark) is where the sole meets it: the paw's
  // centre sits its own height above, fading out as the foot lifts.
  const sole = radius * 0.8;
  const lifted: Vec = [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]];
  const { mid, end: tip } = solveTwoBone(root, lifted, lengths[0], lengths[1], pole);
  cap(kit, `${part}.upper`, role, root, mid, radius);
  cap(kit, `${part}.lower`, role, mid, tip, radius * 0.78);
  ball(kit, `${part}.paw`, end, tip, radius * 0.95, 0.75);
  return tip;
}

/** A footfall cycle: the foot slides back on the ground for `duty` of the stride, then lifts and swings forward. */
function footCycle(q: number, duty: number, stride: number, lift: number): { z: number; y: number } {
  const u = q - Math.floor(q);
  if (u < duty) return { z: stride * (0.5 - u / duty), y: 0 };
  const s = (u - duty) / (1 - duty);
  return { z: stride * (s - 0.5), y: lift * Math.sin(Math.PI * s) };
}

// ---------------------------------------------------------------- four legs

interface QuadBody { readonly P: Vec; readonly S: Vec; readonly r: number; readonly w: number; readonly L: number; readonly legF: number; readonly legH: number }

const HOPPERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["rabbit", "mouse", "squirrel", "kangaroo"]);
const LEG = ["FL", "FR", "HL", "HR"] as const;
type LegId = (typeof LEG)[number];
const sideOf = (leg: LegId): number => (leg.endsWith("L") ? -1 : 1);
const foreLeg = (leg: LegId): boolean => leg.startsWith("F");

/** Lateral-sequence walk, diagonal trot, and the hopper's bound. */
const QUAD_GAITS = {
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.64, lift: 0.14, bob: 0.02 },
  trot: { at: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, duty: 0.45, lift: 0.2, bob: 0.03 },
  bound: { at: { HL: 0, HR: 0.04, FL: 0.5, FR: 0.54 }, duty: 0.32, lift: 0.3, bob: 0.12 },
} as const;

function quadGait(actor: Who, m: Moment): (typeof QUAD_GAITS)[keyof typeof QUAD_GAITS] {
  if (HOPPERS.has(actor.member.species) && (m.pace > 1.2 || actor.member.species === "kangaroo")) return QUAD_GAITS.bound;
  return m.pace > 2.2 ? QUAD_GAITS.trot : QUAD_GAITS.walk;
}

function quadSpine(actor: Who, q: Pose, m: Moment): QuadBody {
  const size = actor.member.size;
  const b = actor.spec.build;
  const L = b.len * size;
  const r = b.body * size;
  const hipY = size * 0.92 * b.hip;
  const shY = size * 0.92;
  const rear = b.extras.includes("pouch") ? Math.max(q.rear, 0.55) * (1 - q.lie) : q.rear;
  const sitP: Vec = [0, r * 1.05, -L * 0.32];
  const rearP: Vec = [0, hipY * 0.95, -L * 0.12];
  let P: Vec = [0, hipY, -L / 2];
  let S: Vec = [0, shY, L / 2];
  P = lerpV(P, sitP, q.sit);
  S = lerpV(S, madd(sitP, [0, Math.sin(0.9), Math.cos(0.9)], L), q.sit);
  P = lerpV(P, rearP, rear * (1 - q.sit));
  S = lerpV(S, madd(rearP, [0, Math.sin(1.25), Math.cos(1.25)], L), rear * (1 - q.sit));
  P = lerpV(P, [0, r * 1.0, -L / 2], q.lie);
  S = lerpV(S, [0, r * 1.12, L / 2], q.lie);
  S = madd(S, UP, -q.bow * Math.max(0, S[1] - r * 1.4) * 0.55);
  const gait = quadGait(actor, m);
  const bob = m.moving * gait.bob * size * Math.cos(TAU * 2 * m.phase) + q.hop * 0.35 * size * (gait === QUAD_GAITS.bound ? 1 : 0.6);
  const hopBounce = m.moving * (gait === QUAD_GAITS.bound ? Math.max(0, Math.sin(TAU * m.phase)) * size * 0.18 : 0);
  const lift: Vec = [0, -q.crouch * 0.25 * size + bob + hopBounce + q.lift * r + q.hop * 0.3 * size, 0];
  return { P: add(P, lift), S: add(S, lift), r, w: r * 0.72, L, legF: (shY - r * 0.35) * 1.04, legH: (hipY - r * 0.35) * 1.04 };
}

function stanceFoot(body: QuadBody, leg: LegId, q: Pose, rear: number): Vec {
  const x = sideOf(leg);
  const { P, S, w, L, legF } = body;
  if (foreLeg(leg)) {
    let foot: Vec = [x * w, 0, S[2] + 0.05 * L];
    foot = lerpV(foot, [x * w * 0.9, 0, S[2] + 0.04 * L], q.sit);
    foot = lerpV(foot, [x * w * 1.05, 0, S[2] + legF * 0.6], q.lie);
    foot = lerpV(foot, [x * w, 0, S[2] + legF * 0.55], q.bow);
    return lerpV(foot, add(S, [x * w * 0.9, -legF * 0.45, legF * 0.25]), rear * (1 - q.sit) * (1 - q.lie));
  }
  let foot: Vec = [x * w, 0, P[2]];
  foot = lerpV(foot, [x * w * 1.5, 0, P[2] + L * 0.32], q.sit);
  return lerpV(foot, [x * w * 1.8, 0, P[2] + L * 0.3], q.lie);
}

function quadFoot(actor: Who, body: QuadBody, leg: LegId, q: Pose, m: Moment, head: Vec): Vec {
  const rear = actor.spec.build.extras.includes("pouch") ? Math.max(q.rear, 0.55) : q.rear;
  let foot = stanceFoot(body, leg, q, rear);
  const gait = quadGait(actor, m);
  const free = m.moving * (1 - q.sit) * (1 - q.lie);
  if (free > 0 && !(foreLeg(leg) && rear > 0.5)) {
    const reach = foreLeg(leg) ? body.legF : body.legH;
    const c = footCycle(m.phase - gait.at[leg], gait.duty, gait.duty * bodyStride(actor), gait.lift * reach);
    foot = add(foot, [0, c.y * free, c.z * free]);
  }
  const t = m.t;
  if (leg === "HR" && q.scratch > 0) foot = add(lerpV(foot, add(head, [body.w * 1.4, -body.r * 0.9, -body.r * 1.2]), q.scratch * 0.85), [0, Math.sin(t * 26) * body.r * 0.3 * q.scratch, 0]);
  if (foreLeg(leg) && q.dig > 0) {
    const s = Math.sin(t * 14 + (sideOf(leg) > 0 ? Math.PI : 0));
    foot = add(foot, [0, Math.max(0, s) * body.legF * 0.25 * q.dig, s * body.legF * 0.3 * q.dig]);
  }
  return foot;
}

function headAxes(hd: Vec, roll: number): { s: Vec; u: Vec } {
  const hs = unit(cross(UP, hd), [1, 0, 0]);
  const hu = cross(hd, hs);
  return roll === 0 ? { s: hs, u: hu } : { s: unit(madd(hs, hu, -roll)), u: unit(madd(hu, hs, roll)) };
}

interface Head { readonly c: Vec; readonly d: Vec; readonly s: Vec; readonly u: Vec; readonly r: number }

function quadNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose): Head {
  const b = actor.spec.build;
  const size = actor.member.size;
  const { P, S, r } = body;
  const n0 = add(S, [0, r * 0.45, r * 0.45]);
  const bodyPitch = Math.atan2(S[1] - P[1], S[2] - P[2]);
  const down = clamp(-q.headPitch, 0, 1.4) / 1.25;
  const up = clamp(q.headPitch, 0, 1.3) / 1.2;
  let np = b.rise - bodyPitch * 0.6;
  np = mix(mix(np, -0.9, down), 1.35, up);
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  const n1 = madd(n0, dirOf(yaw, np), Math.max(b.neck * size, r * 0.4));
  cap(kit, "neck", "coat", n0, n1, r * 0.62);
  const hd = dirOf(yaw * 1.8 + q.curl * 0.8, -0.15 + q.headPitch * 0.55 - down * 0.45 - q.curl * 0.4);
  const hr = b.head * size;
  return { c: madd(n1, hd, hr * 0.55), d: hd, ...headAxes(hd, q.headRoll), r: hr };
}

const at3 = (h: Head, d: number, s: number, u: number): Vec => add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, s * h.r)), scale(h.u, u * h.r)));

function earsOf(kit: Kit, kind: Ears, h: Head, back: number): void {
  for (const x of [-1, 1]) {
    const part = `ear.${x < 0 ? "L" : "R"}`;
    if (kind === "point" || kind === "tuft") {
      const root = at3(h, -0.05, x * 0.5, 0.6);
      const dir = unit(add(add(scale(h.u, 1), scale(h.d, -(0.25 + back * 0.8))), scale(h.s, x * 0.3)));
      cap(kit, part, kind === "tuft" ? "alt" : "coat", root, madd(root, dir, h.r * (kind === "tuft" ? 0.7 : 0.95)), h.r * 0.24, 0.45, h.d);
    } else if (kind === "round") {
      ball(kit, part, "coat", at3(h, -0.1, x * 0.68, 0.72), h.r * 0.32, 0.55, h.d);
    } else if (kind === "long") {
      const root = at3(h, -0.15, x * 0.32, 0.7);
      const dir = unit(add(add(scale(h.u, 1 - back * 0.7), scale(h.d, -(0.15 + back))), scale(h.s, x * 0.18)));
      cap(kit, part, "coat", root, madd(root, dir, h.r * 2.2), h.r * 0.22, 0.45, h.d);
    } else if (kind === "flop") {
      const root = at3(h, -0.05, x * 0.7, 0.4);
      cap(kit, part, "alt", root, madd(root, unit(add(scale(h.s, x), scale(h.u, -1.2))), h.r * 0.9), h.r * 0.25, 0.4, h.s);
    }
  }
}

/**
 * An eye that reads at a glance: the iris set proud of the head, a dark
 * pupil on it and a spark of light; shut, just a dark lid. It sits on the
 * head's surface where `toward` points from the head's middle.
 */
function eyeOf(kit: Kit, part: string, h: Head, toward: Vec, r: number, open: boolean): void {
  const n = unit(sub(toward, h.c), h.d);
  const at = madd(h.c, n, h.r * 0.92);
  if (!open) {
    ball(kit, part, "dark", at, r, 0.3, n);
    return;
  }
  ball(kit, part, "eye", at, r);
  ball(kit, `${part}.pupil`, "pupil", madd(at, n, r * 0.78), r * 0.5, 0.55, n);
  ball(kit, `${part}.shine`, "shine", madd(madd(at, n, r * 0.98), h.u, r * 0.3), r * 0.16);
}

function faceOf(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = actor.spec.build;
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", h.c, h.r);
  const tip = madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15);
  cap(kit, "snout", "coat", at3(h, 0.35, 0, -0.1), tip, h.r * 0.5);
  const jawTip = madd(madd(at3(h, 0.3, 0, -0.32), h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cap(kit, "jaw", "belly", at3(h, 0.3, 0, -0.32), jawTip, h.r * 0.36);
  ball(kit, "nose", "nose", tip, h.r * (b.extras.includes("bignose") ? 0.42 : 0.22));
  for (const x of [-1, 1]) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.62, x * 0.5, 0.28), h.r * 0.21, !asleep);
  if (b.extras.includes("mask")) cap(kit, "mask", "dark", at3(h, 0.55, -0.55, 0.22), at3(h, 0.55, 0.55, 0.22), h.r * 0.24, 0.6);
  if (b.extras.includes("cheeks")) for (const x of [-1, 1]) ball(kit, "cheek", "accent", at3(h, 0.45, x * 0.55, -0.15), h.r * 0.3);
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  earsOf(kit, b.ears, h, q.earBack);
}

function antlersOf(kit: Kit, h: Head, size: number): void {
  for (const x of [-1, 1]) {
    const root = at3(h, -0.1, x * 0.42, 0.85);
    const beam = unit(add(add(scale(h.u, 1), scale(h.d, -0.35)), scale(h.s, x * 0.6)));
    const top = madd(root, beam, size * 0.34);
    cap(kit, "antler", "horn", root, top, size * 0.018);
    for (const [k, out] of [[0.4, 0.7], [0.75, 0.5]] as const) {
      const at = lerpV(root, top, k);
      cap(kit, "tine", "horn", at, madd(at, unit(add(scale(h.u, 0.9), scale(h.d, out))), size * 0.12), size * 0.013);
    }
  }
}

const TAILS: Readonly<Record<Tail, { rise: number; curl: number; girth: number; n: number }>> = {
  bushy: { rise: 0.15, curl: -0.12, girth: 0.55, n: 3 }, curl: { rise: 1.25, curl: 0.5, girth: 0.48, n: 4 }, thin: { rise: 0.55, curl: 0.15, girth: 0.14, n: 3 },
  puff: { rise: 0.6, curl: 0, girth: 0.45, n: 1 }, ring: { rise: 0.35, curl: 0.05, girth: 0.42, n: 4 }, thick: { rise: -0.55, curl: 0.1, girth: 0.5, n: 3 },
  fan: { rise: 0, curl: 0, girth: 0.4, n: 1 }, none: { rise: 0, curl: 0, girth: 0, n: 0 },
};

function quadTail(kit: Kit, actor: Who, body: QuadBody, q: Pose, t: number): void {
  const b = actor.spec.build;
  const shape = TAILS[b.tail];
  if (shape.n === 0) return;
  let at = add(body.P, [0, body.r * 0.35, -body.r * 0.8]);
  if (b.tail === "puff") { ball(kit, "tail", "belly", at, body.r * shape.girth); return; }
  const seg = (b.tailLen * actor.member.size) / shape.n;
  for (let i = 0; i < shape.n; i += 1) {
    const wag = q.tailWag * 0.6 * Math.sin(t * 8 - i * 0.8) + 0.15 * Math.sin(t * 1.3 - i) + q.curl * 0.9;
    const rise = shape.rise + q.tailUp * 0.9 + shape.curl * i - q.sit * 0.7 - q.lie * 0.4;
    const reach = madd(at, dirOf(Math.PI + wag, rise), seg);
    const next: Vec = [reach[0], Math.max(reach[1], body.r * shape.girth * 0.6), reach[2]];
    const role: Role = b.tail === "ring" ? (i % 2 === 0 ? "coat" : "dark") : b.tail === "bushy" && i === shape.n - 1 ? "accent" : "coat";
    cap(kit, `tail.${i}`, role, at, next, body.r * shape.girth * (1 - i * 0.12));
    at = next;
  }
}

function quadTrunk(kit: Kit, actor: Who, body: QuadBody, t: number): void {
  const { P, S, r } = body;
  const extras = actor.spec.build.extras;
  cap(kit, "body", "coat", P, S, r * 0.95);
  ball(kit, "haunch", "coat", P, r);
  ball(kit, "chest", "coat", S, r * 1.04);
  cap(kit, "belly", "belly", add(P, [0, -r * 0.32, 0]), add(S, [0, -r * 0.32, 0]), r * 0.72);
  if (extras.includes("pouch")) ball(kit, "pouch", "belly", add(lerpV(P, S, 0.45), [0, -r * 0.35, r * 0.25]), r * 0.75);
  if (extras.includes("shell")) {
    cap(kit, "shell", "shell", add(P, [0, r * 0.35, 0]), add(S, [0, r * 0.35, 0]), r * 1.32, 0.62);
    cap(kit, "shell.rim", "alt", add(P, [0, -r * 0.05, 0]), add(S, [0, -r * 0.05, 0]), r * 1.42, 0.25);
    for (const k of [0.2, 0.5, 0.8]) ball(kit, "scute", "accent", add(lerpV(P, S, k), [0, r * 1.15, 0]), r * 0.3, 0.5);
  }
  if (extras.includes("quills")) {
    for (let i = 0; i < 12; i += 1) {
      const side = (i % 3) - 1;
      const base = add(lerpV(P, S, Math.floor(i / 3) / 3), [side * r * 0.6, r * (0.7 - Math.abs(side) * 0.25), 0]);
      cap(kit, "quill", i % 4 === 0 ? "alt" : "dark", base, add(base, [side * r * 0.45, r * 0.4, -r * 0.55]), r * 0.24);
    }
  }
  if (extras.includes("spots") && actor.member.young) for (let i = 0; i < 5; i += 1) ball(kit, "spot", "accent", add(lerpV(P, S, 0.15 + i * 0.17), [((i % 2) * 2 - 1) * r * 0.45, r * 0.75, 0]), r * 0.13, 0.5);
  void t;
}

function poseQuad(kit: Kit, actor: Who, m: Moment): void {
  const q = m.pose;
  const body = quadSpine(actor, q, m);
  const head = quadNeck(kit, actor, body, q);
  const legR = Math.max(0.006, body.r * 0.32);
  for (const leg of LEG) {
    const x = sideOf(leg);
    const fore = foreLeg(leg);
    const root = add(fore ? body.S : body.P, [x * body.w, -body.r * 0.35, 0]);
    const length = fore ? body.legF : body.legH;
    const pole: Vec = q.lie > 0.5 ? (fore ? [0, 1, -0.3] : [x * 0.8, 0.5, 0.5]) : [0, 0, fore ? -1 : 1];
    limb(kit, `leg.${leg}`, "coat", root, quadFoot(actor, body, leg, q, m, head.c), [length * 0.5, length * 0.5], legR * (fore ? 1 : 1.15), pole);
  }
  quadTrunk(kit, actor, body, m.t);
  faceOf(kit, actor, head, q, m.segment.act === "sleep");
  quadTail(kit, actor, body, q, m.t);
}

// ---------------------------------------------------------------- primates

interface PrimateBody { readonly hips: Vec; readonly chest: Vec; readonly tdir: Vec; readonly r: number; readonly w: number; readonly arm: number; readonly leg: number; readonly climbing: boolean }

function primateSpine(who: Who, m: Moment): PrimateBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const leg = b.leg * size;
  const arm = leg * (b.extras.includes("claws") ? 1.45 : 1.15);
  const climbing = m.mode === "climb" && Math.abs(m.frame.y[1]) < 0.6;
  const walking = m.moving > 0.05 && !climbing;
  let hipY = climbing ? r * 1.4 : walking ? leg * 0.8 : leg * 0.85;
  let lean = climbing ? 1.45 : walking ? 1.15 : 0.2;
  hipY = mix(hipY, r * 0.9, q.sit);
  lean = mix(lean, 0.12, q.sit) + q.reach * 0.25;
  let hips: Vec = [0, hipY + Math.abs(Math.sin(TAU * m.phase)) * r * 0.25 * m.moving, 0];
  let tdir = dirOf(0, Math.PI / 2 - lean);
  if (q.hang > 0) {
    const sloth = b.extras.includes("claws");
    const hangHips: Vec = sloth ? [0, -arm * 0.75, -b.len * size * 0.5] : [0, -arm * 0.95 - b.len * size, 0];
    hips = lerpV(hips, hangHips, q.hang);
    tdir = unit(lerpV(tdir, sloth ? [0, 0, 1] : [0, 1, 0.05], q.hang));
  }
  return { hips, chest: madd(hips, tdir, b.len * size), tdir, r, w: r * 1.05, arm, leg, climbing };
}

function primateHand(who: Who, body: PrimateBody, x: number, m: Moment, head: Vec): Vec {
  const q = m.pose;
  const { chest, w, arm, r } = body;
  const walking = m.moving > 0.05 || body.climbing;
  const step = walking ? footCycle(m.phase - (x < 0 ? 0 : 0.5), 0.6, 0.6 * bodyStride(who), arm * 0.25) : { z: 0, y: 0 };
  let hand: Vec = walking ? [x * w, step.y, chest[2] + arm * 0.25 + step.z] : add(chest, [x * w * 1.2, -arm * 0.85, arm * 0.2]);
  hand = lerpV(hand, [x * w * 1.3, r * 0.4, arm * 0.45], q.sit);
  hand = lerpV(hand, add(chest, [x * w * 0.5, -r * 0.2 + 0.03 * Math.sin(m.t * 5 + x), arm * 0.75]), q.reach * (x > 0 ? 1 : 0.6));
  if (x > 0) hand = lerpV(hand, add(head, [w * 0.25, -r * 0.5, r * 0.55]), q.hand * (1 - q.scratch));
  if (x > 0 && q.scratch > 0) hand = lerpV(hand, add(head, [w * 1.1, r * 0.3 * Math.sin(m.t * 22), -r * 0.3]), q.scratch);
  if (q.hang > 0) {
    const sloth = who.spec.build.extras.includes("claws");
    const grip: Vec = sloth ? [x * w, 0, who.spec.build.len * who.member.size * 0.5] : x > 0 ? [0, 0, 0] : [-w, -arm * 0.6 + 0.1 * Math.sin(m.t), arm * 0.4];
    hand = lerpV(hand, grip, q.hang);
  }
  return hand;
}

function primateFoot(who: Who, body: PrimateBody, x: number, m: Moment): Vec {
  const q = m.pose;
  const { hips, w, leg } = body;
  const walking = m.moving > 0.05 || body.climbing;
  const step = walking ? footCycle(m.phase - (x < 0 ? 0.5 : 0), 0.6, 0.6 * bodyStride(who), leg * 0.25) : { z: 0, y: 0 };
  let foot: Vec = [x * w * 0.8, step.y, hips[2] - leg * 0.1 + step.z];
  foot = lerpV(foot, [x * w * 1.4, 0, leg * 0.75], q.sit);
  if (q.hang > 0) {
    const sloth = who.spec.build.extras.includes("claws");
    foot = lerpV(foot, sloth ? [x * w, 0, -who.spec.build.len * who.member.size * 0.5] : add(hips, [x * w * 0.6, -leg * 0.9, leg * 0.25]), q.hang);
  }
  return foot;
}

function primateHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const { hips, chest, tdir, r } = body;
  const hr = b.head * size;
  const look = q.hang > 0.5 ? 0 : body.climbing || m.moving > 0.05 ? 0.9 : 0;
  const hd = dirOf(q.headYaw * 0.8, -0.1 + q.headPitch * 0.6 + look * 0.7);
  const neckTop = madd(chest, tdir, b.neck * size + r * 0.35);
  const head = madd(neckTop, hd, hr * 0.3);
  cap(kit, "torso", "coat", hips, chest, r);
  ball(kit, "chest", "coat", chest, r * 1.05);
  cap(kit, "belly", "belly", madd(hips, [0, 0, 1], r * 0.35), madd(chest, [0, 0, 1], r * 0.35), r * 0.62);
  cap(kit, "neck", "coat", chest, neckTop, r * 0.5);
  const h: Head = { c: head, d: hd, ...headAxes(hd, q.headRoll), r: hr };
  ball(kit, "head", "coat", head, hr);
  ball(kit, "face", "accent", at3(h, 0.55, 0, -0.1), hr * 0.62, 0.7, hd);
  for (const x of [-1, 1]) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.95, x * 0.34, 0.14), hr * 0.17, m.segment.act !== "sleep");
  if (b.extras.includes("mask")) cap(kit, "mask", "dark", at3(h, 0.8, -0.6, 0.12), at3(h, 0.8, 0.6, 0.12), hr * 0.18, 0.6);
  earsOf(kit, b.ears, h, 0);
  return head;
}

function primateTail(kit: Kit, who: Who, body: PrimateBody, m: Moment): void {
  const b = who.spec.build;
  const { hips, r } = body;
  if (b.tail === "puff") { ball(kit, "tail", "coat", madd(hips, [0, 0, -1], r), r * 0.4); return; }
  if (b.tail === "none") return;
  let at = madd(hips, [0, 0, -1], r * 0.8);
  for (let i = 0; i < 4; i += 1) {
    const hang = m.pose.hang > 0.5 ? -1.4 : 0.3 + i * 0.35 - m.pose.sit * 0.9;
    const reach = madd(at, dirOf(Math.PI + 0.3 * Math.sin(m.t * 1.2 - i), hang), (b.tailLen * who.member.size) / 4);
    const next: Vec = m.pose.hang > 0.5 ? reach : [reach[0], Math.max(reach[1], r * 0.15), reach[2]];
    cap(kit, `tail.${i}`, "coat", at, next, r * 0.16);
    at = next;
  }
}

function posePrimate(kit: Kit, who: Who, m: Moment): void {
  const q = m.pose;
  const b = who.spec.build;
  const body = primateSpine(who, m);
  const { hips, chest, r, w } = body;
  const head = primateHead(kit, who, body, m);
  const claws: Role = b.extras.includes("claws") ? "horn" : "dark";
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    limb(kit, `arm.${side}`, "coat", add(chest, [x * w, -r * 0.2, 0]), primateHand(who, body, x, m, head), [body.arm * 0.5, body.arm * 0.5], r * 0.34, [x * 0.3, 0, -1], claws);
    limb(kit, `leg.${side}`, "coat", add(hips, [x * w * 0.6, 0, 0]), primateFoot(who, body, x, m), [body.leg * 0.5, body.leg * 0.5], r * 0.4, q.sit > 0.5 ? [x * 0.4, 1, 0.6] : [0, 0, 1], claws);
  }
  primateTail(kit, who, body, m);
}

// ---------------------------------------------------------------- birds

/** Beak colours; the rest of a bird's look is its coat. */
const BEAKS: Partial<Record<SpeciesId, string>> = { songbird: "#3a2a1a", crow: "#141414", owl: "#5a4a30", parrot: "#2a2a2a", gull: "#f0c030", peacock: "#8a8a80", crane: "#c8c0a0", woodpecker: "#2a2a2a" };
const FLAP_RATE: Partial<Record<SpeciesId, number>> = { songbird: 26, woodpecker: 22, parrot: 16, crow: 13, owl: 9, gull: 8, peacock: 10, crane: 6 };

interface BirdBody { readonly C: Vec; readonly K: Vec; readonly T: Vec; readonly r: number; readonly pitch: number; readonly flying: boolean; readonly flight: Flight }

/**
 * Where a bird is in its flight: beating hard to climb off, gliding in on
 * spread wings, then flaring, its body tipped up and its feet thrown forward,
 * to kill its speed and land.
 */
interface Flight { readonly launch: number; readonly glide: number; readonly flare: number }

const ON_FOOT: Flight = { launch: 0, glide: 0, flare: 0 };

function flightOf(m: Moment): Flight {
  if (m.mode !== "fly") return ON_FOOT;
  const u = clamp((m.t - m.segment.t0) / Math.max(0.01, m.segment.t1 - m.segment.t0), 0, 1);
  const flare = smooth((u - 0.84) / 0.14);
  return { launch: 1 - smooth(u / 0.18), glide: smooth((u - 0.55) / 0.12) * (1 - flare), flare };
}

function birdSpine(who: Who, m: Moment): BirdBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const flying = m.mode === "fly";
  const flight = flightOf(m);
  const drum = m.segment.act === "drum";
  let pitch = flying ? 0.05 + flight.launch * 0.3 + flight.flare * 0.8 : drum ? 1.35 : 0.2 + b.rise * 0.5;
  pitch -= q.peck * (drum ? 0.15 : 0.6);
  const legH = b.leg * size;
  const along = dirOf(0, pitch);
  // Standing or asleep, the low end of the body (its tail end, as it leans up) stays on top of the ground.
  const rest = Math.max(legH + r * 0.9 + q.hop * size * 0.3 - (m.segment.act === "sleep" ? r * 0.3 : 0), r * 0.85 + Math.max(0, along[1]) * size * 0.26);
  const C: Vec = flying ? [0, 0, 0] : drum ? [0, 0, -r * 0.4] : [0, rest, 0];
  return { C, K: madd(C, along, size * 0.22), T: madd(C, along, -size * 0.26), r: r * 0.85, pitch, flying, flight };
}

function birdHead(kit: Kit, who: Who, body: BirdBody, m: Moment): Head {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const drum = m.segment.act === "drum";
  const tuck = m.segment.act === "sleep" ? 1 : 0;
  const neckBase = madd(body.K, UP, body.r * 0.45);
  const neckDir = dirOf(q.headYaw * 0.5 + tuck * 2.6, (drum ? 0.2 : 1.2) - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0));
  const neckTop = madd(neckBase, neckDir, Math.max(b.neck * size, body.r * 0.3) * (1 - tuck * 0.6));
  if (b.neck * size > body.r * 0.6) cap(kit, "neck", "coat", neckBase, neckTop, body.r * 0.38);
  const hd = dirOf(q.headYaw + tuck * 2.6, -0.1 + q.headPitch * 0.5 - q.peck * (drum ? 0.1 : 1.1) - (drum ? 1.2 : 0) + (body.flying ? 0.05 : 0));
  const hr = b.head * size;
  const c = madd(madd(neckTop, hd, hr * 0.4), drum ? [0, 0, 1] : UP, drum ? q.peck * size * 0.12 : 0);
  return { c, d: hd, ...headAxes(hd, q.headRoll), r: hr };
}

function birdFace(kit: Kit, who: Who, h: Head, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const owl = who.member.species === "owl";
  ball(kit, "head", "coat", h.c, h.r);
  const beak = b.snout * size;
  cap(kit, "beak", "horn", at3(h, 0.65, 0, 0.05), madd(at3(h, 0.65, 0, 0.05), h.d, beak), h.r * 0.3);
  if (m.pose.mouth > 0.05) cap(kit, "beak.lower", "horn", at3(h, 0.6, 0, -0.15), madd(madd(at3(h, 0.6, 0, -0.15), h.d, beak * 0.85), h.u, -beak * 0.5 * m.pose.mouth), h.r * 0.2);
  for (const x of [-1, 1]) {
    const eye = owl ? at3(h, 0.7, x * 0.38, 0.1) : at3(h, 0.35, x * 0.62, 0.2);
    eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, eye, h.r * (owl ? 0.3 : 0.2), m.segment.act !== "sleep");
  }
  if (owl) ball(kit, "disc", "belly", at3(h, 0.45, 0, 0), h.r * 0.82, 0.45, h.d);
  birdCrest(kit, who, h);
}

function birdCrest(kit: Kit, who: Who, h: Head): void {
  const b = who.spec.build;
  if (b.extras.includes("crest")) cap(kit, "crest", "accent", at3(h, -0.1, 0, 0.8), madd(at3(h, -0.1, 0, 0.8), unit(add(h.u, scale(h.d, -0.8))), h.r * 1.1), h.r * 0.28, 0.4, h.s);
  if (b.extras.includes("crown")) {
    if (who.member.species === "peacock") for (const x of [-0.4, 0, 0.4]) ball(kit, "crown", "accent", madd(at3(h, -0.1, x, 0.9), h.u, h.r * 0.8), h.r * 0.22);
    else ball(kit, "crown", "accent", at3(h, 0.1, 0, 0.78), h.r * 0.5, 0.5);
  }
  if (b.ears === "tuft") earsOf(kit, "tuft", h, 0);
}

/** The wings' beat in the air: deep and quick off the ground, held out to glide in, short fast strokes as it flares. */
function flyingBeat(who: Who, flight: Flight, t: number, rate: number): number {
  const cruising = Math.sin(t * 0.37 + who.member.size * 31) > 0.55 ? 0.12 : Math.sin(t * rate);
  const air = mix(cruising, Math.sin(t * rate * 1.25) * 1.1, flight.launch);
  return mix(mix(air, 0.15 + 0.05 * Math.sin(t * 3), flight.glide), 0.3 + 0.6 * Math.sin(t * rate * 1.4), flight.flare);
}

function wingOf(kit: Kit, who: Who, body: BirdBody, x: number, m: Moment): void {
  const q = m.pose;
  const size = who.member.size;
  const open = body.flying ? 1 : clamp(q.wing, 0, 1);
  const rate = FLAP_RATE[who.member.species] ?? 14;
  const beat = body.flying ? flyingBeat(who, body.flight, m.t, rate) : q.flap;
  const a = 0.25 + 0.75 * beat;
  const span = size * (who.spec.size > 0.25 ? 0.72 : 0.55);
  const side: Vec = [x, 0, 0];
  const shoulder = madd(body.K, side, body.r * 0.75);
  const armDir = unit(add(add(scale(side, Math.cos(a)), scale(UP, Math.sin(a))), [0, 0, -0.15]));
  const handDir = unit(add(add(scale(side, Math.cos(a * 1.3)), scale(UP, Math.sin(a * 1.3))), [0, 0, -0.4]));
  const foldElbow = madd(madd(body.C, side, body.r * 0.95), [0, 0, 1], -size * 0.05);
  const foldTip = madd(madd(body.T, side, body.r * 0.6), dirOf(0, body.pitch), -size * 0.18);
  const elbow = lerpV(foldElbow, madd(shoulder, armDir, span * 0.45), open);
  const tip = lerpV(foldTip, madd(elbow, handDir, span * 0.55), open);
  const thin = (from: Vec, to: Vec): Vec => unit(cross(sub(to, from), [0, 0, 1]), UP);
  cap(kit, `wing.${x < 0 ? "L" : "R"}`, "alt", shoulder, elbow, body.r * 0.6, 0.28, open > 0.3 ? thin(shoulder, elbow) : side);
  cap(kit, `wingtip.${x < 0 ? "L" : "R"}`, open > 0.3 ? "dark" : "alt", elbow, tip, body.r * 0.5, 0.24, open > 0.3 ? thin(elbow, tip) : side);
}

function birdTail(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const back = dirOf(Math.PI + 0.15 * m.pose.tailWag, -body.pitch * 0.8 - 0.1 + m.pose.tailUp);
  // On the ground a tail (or a train) drags along it, never through it.
  const floor = m.mode !== "fly" && m.segment.to.on === "ground" && m.segment.from.on === "ground";
  const above = (tip: Vec, r: number): Vec => (floor ? [tip[0], Math.max(tip[1], r), tip[2]] : tip);
  if (!b.extras.includes("train")) {
    cap(kit, "tail", "alt", body.T, above(madd(body.T, back, b.tailLen * size), body.r * 0.7 * 0.3), body.r * 0.7, 0.25);
    return;
  }
  const fan = m.pose.fan;
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 8 - 0.5) * 2.6;
    const spread = unit(add(scale(UP, Math.cos(a)), scale([1, 0, 0], Math.sin(a))));
    const dir = unit(lerpV(dirOf(Math.PI + (i / 8 - 0.5) * 0.3, -0.25), add(spread, [0, 0, -0.25]), fan));
    const tip = above(madd(body.T, dir, b.tailLen * size * (0.85 + 0.15 * Math.cos(a))), body.r * 0.42);
    cap(kit, `train.${i}`, "alt", body.T, tip, body.r * 0.42, 0.18, unit(cross(dir, [0, 0, 1]), UP));
    if (fan > 0.3) ball(kit, `eyespot.${i}`, "accent", lerpV(body.T, tip, 0.85), body.r * 0.32, 0.3, [0, 0, 1]);
  }
}

function poseBird(kit: Kit, who: Who, m: Moment): void {
  const body = birdSpine(who, m);
  const b = who.spec.build;
  const size = who.member.size;
  cap(kit, "body", "coat", body.T, body.K, body.r);
  ball(kit, "breast", "belly", madd(lerpV(body.C, body.K, 0.5), UP, -body.r * 0.3), body.r * 0.85);
  const head = birdHead(kit, who, body, m);
  birdFace(kit, who, head, m);
  for (const x of [-1, 1]) wingOf(kit, who, body, x, m);
  birdTail(kit, who, body, m);
  const legH = b.leg * size;
  for (const x of [-1, 1]) {
    const hip = add(body.C, [x * body.r * 0.35, -body.r * 0.6, 0]);
    if (body.flying) {
      // Tucked back in flight; thrown down and forward to meet the perch as it lands.
      const tucked: Vec = [0, -body.r * 0.2, -body.r * 1.1];
      const reaching: Vec = [x * body.r * 0.2, -legH - body.r * 0.3, body.r * 0.5];
      cap(kit, "leg", "horn", hip, add(hip, lerpV(tucked, reaching, body.flight.flare)), body.r * 0.12);
      continue;
    }
    const step = m.moving > 0 ? footCycle(m.phase - (m.segment.act === "hop" ? 0 : x < 0 ? 0 : 0.5), 0.5, 0.5 * bodyStride(who) * m.moving, legH * 0.35 * m.moving) : { z: 0, y: 0 };
    const foot: Vec = m.segment.act === "drum" ? [x * body.r * 0.5, -size * 0.12, 0] : [x * body.r * 0.45, step.y, step.z];
    limb(kit, `leg.${x < 0 ? "L" : "R"}`, "horn", hip, foot, [legH * 0.55, legH * 0.55], Math.max(0.006, body.r * 0.12), [0, 0, 1], "horn");
  }
}

// ---------------------------------------------------------------- snakes and lizards

function serpentSpine(who: Who, m: Moment): Vec[] {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const lizard = b.leg > 0;
  const n = lizard ? 8 : 12;
  const r0 = b.body * size;
  const seg = size / n;
  const points: Vec[] = [];
  for (let i = 0; i <= n; i += 1) {
    const moving = m.moving * Math.sin(TAU * m.phase * 0.8 - i * 0.7) * size * 0.06 * (lizard ? 0.4 : 1) * Math.min(1, i / 3);
    const rest = size * 0.07 * Math.sin(i * 0.55 + 0.2 * Math.sin(m.t * 0.3)) * (1 - m.moving);
    const straight: Vec = [moving + rest, r0, -i * seg * 0.95];
    const a = i * 0.8;
    const ring = r0 * (6.5 - i * 0.38);
    const coil: Vec = [Math.cos(a) * ring, r0 + (n - i) * r0 * 0.22, Math.sin(a) * ring - r0 * 6.5];
    const lift = Math.max(0, 3 - i) / 3;
    points.push(add(lerpV(straight, coil, lizard ? 0 : q.curl), [0, lift * (q.headPitch * size * 0.08 + q.mouth * size * 0.02), 0]));
  }
  return points;
}

function poseSerpent(kit: Kit, who: Who, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const points = serpentSpine(who, m);
  const r0 = b.body * size;
  const n = points.length - 1;
  const banded = who.member.coat === "banded";
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const c = points[i + 1];
    if (!a || !c) continue;
    const taper = 1 - Math.pow(i / n, 2) * 0.85;
    cap(kit, `body.${i}`, banded && i % 2 === 1 ? "alt" : "coat", a, c, r0 * taper, 0.8);
    if (b.extras.includes("spots") && i % 2 === 0) ball(kit, "spot", "accent", add(lerpV(a, c, 0.5), [0, r0 * 0.6, 0]), r0 * 0.35, 0.5);
  }
  serpentHead(kit, who, points, m);
  if (b.leg > 0) lizardLegs(kit, who, points, m);
}

function serpentHead(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const r0 = b.body * size;
  const head = points[0] ?? [0, r0, 0];
  const hd = unit(sub(head, points[1] ?? [0, r0, -1]));
  const h: Head = { c: madd(head, hd, b.head * size * 0.4), d: hd, ...headAxes(hd, 0), r: b.head * size };
  ball(kit, "head", "coat", h.c, h.r, 0.75);
  for (const x of [-1, 1]) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.3, x * 0.6, 0.35), h.r * 0.24, true);
  if (m.pose.mouth > 0.2 && m.segment.act === "flick") cap(kit, "tongue", "accent", at3(h, 1, 0, -0.1), madd(at3(h, 1, 0, -0.1), hd, h.r * 1.4 * m.pose.mouth), h.r * 0.08);
}

function lizardLegs(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const size = who.member.size;
  const r0 = who.spec.build.body * size;
  for (const [k, at] of [["F", 2], ["H", 5]] as const) {
    const body = points[at] ?? [0, r0, 0];
    for (const x of [-1, 1]) {
      const leg = `${k}${x < 0 ? "L" : "R"}`;
      const step = footCycle(m.phase - (leg === "FL" || leg === "HR" ? 0 : 0.5), 0.55, 0.55 * bodyStride(who) * m.moving, size * 0.06);
      const foot: Vec = [body[0] + x * size * 0.2, step.y, body[2] + step.z + (k === "F" ? size * 0.05 : -size * 0.03)];
      limb(kit, `leg.${leg}`, "coat", add(body, [x * r0, 0, 0]), foot, [size * 0.11, size * 0.11], r0 * 0.38, [x, 1, 0], "coat");
    }
  }
}

// ---------------------------------------------------------------- insects

/** Where a bug's body is: drifting over its spot, settled on a leaf, or flying between, at the same heights. */
function bugCentre(who: Who, m: Moment): Vec {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const drift: Vec = [Math.sin(t * 0.6 + phase) * 0.35, Math.sin(t * 0.9 + phase * 2) * 0.18, Math.cos(t * 0.5 + phase) * 0.35];
  const wander = firefly ? drift : scale(drift, 0.3);
  if (m.mode !== "fly") return m.segment.act === "sit" ? [0, size * 0.1, 0] : add([0, 0.35 + m.pose.lift * 0.4, 0], wander);
  const airy = (place: Place): number => (place.on === "ground" ? 0.35 + m.pose.lift * 0.4 : size * 0.1);
  const flying = mix(airy(m.segment.from), airy(m.segment.to), smooth(clamp((t - m.segment.t0) / Math.max(0.01, m.segment.t1 - m.segment.t0), 0, 1)));
  const grounded = m.segment.from.on === "ground" || m.segment.to.on === "ground";
  return add([0, flying + Math.sin(t * 9 + phase) * size * 0.6 * m.moving, 0], grounded ? scale(wander, 1 - m.moving) : [0, 0, 0]);
}

function poseBug(kit: Kit, who: Who, m: Moment): void {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const perched = m.segment.act === "sit";
  const C = bugCentre(who, m);
  const fw: Vec = [0, 0, 1];
  cap(kit, "body", "dark", madd(C, fw, -size * 0.25), madd(C, fw, size * 0.22), size * 0.07);
  ball(kit, "head", "dark", madd(C, fw, size * 0.28), size * 0.07);
  if (firefly) {
    const blink = pulse(t + phase, 2.4 + (phase % 1.7), 0.3);
    ball(kit, "lantern", "glow", madd(C, fw, -size * 0.3), size * (0.25 + 1.1 * blink));
  }
  const open = perched ? 1.35 + 0.2 * Math.sin(t * 1.4 + phase) : 0.15 + 1.1 * (0.5 + 0.5 * Math.sin(t * (firefly ? 30 : 19) + phase));
  for (const x of [-1, 1]) {
    const dir = unit(add(scale([x, 0, 0], Math.cos(open)), scale(UP, Math.sin(open))));
    const normal = unit(cross(dir, fw), UP);
    const reach = firefly ? 0.35 : 1;
    cap(kit, `wing.${x}`, "coat", madd(C, fw, size * 0.05), add(madd(C, dir, size * 0.55 * reach), scale(fw, size * 0.22)), size * 0.26 * reach, 0.1, normal);
    cap(kit, `hindwing.${x}`, "alt", madd(C, fw, -size * 0.05), add(madd(C, dir, size * 0.42 * reach), scale(fw, -size * 0.2)), size * 0.2 * reach, 0.1, normal);
    if (!firefly) ball(kit, "wingspot", "accent", add(madd(C, dir, size * 0.36), scale(fw, size * 0.12)), size * 0.07, 0.3, normal);
    cap(kit, "antenna", "dark", madd(C, fw, size * 0.3), add(madd(C, fw, size * 0.5), [x * size * 0.12, size * 0.15, 0]), size * 0.012);
  }
}

// ---------------------------------------------------------------- crabs

function poseCrab(kit: Kit, who: Who, m: Moment): void {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const legLen = b.leg * size;
  // Resting, a crab settles its shell down onto the sand.
  const C: Vec = [0, mix(legLen * 0.55, r * 0.45, Math.max(q.sit * 0.6, q.lie)), 0];
  ball(kit, "body", "coat", C, r, 0.5);
  ball(kit, "belly", "belly", add(C, [0, -r * 0.2, 0]), r * 0.8, 0.35);
  for (const x of [-1, 1]) {
    const stalk = add(C, [x * r * 0.35, r * 0.3, r * 0.7]);
    cap(kit, "eyestalk", "coat", stalk, add(stalk, [0, r * 0.45, 0]), r * 0.08);
    ball(kit, "eye", "pupil", add(stalk, [0, r * 0.5, 0]), r * 0.12);
    ball(kit, "eye.shine", "shine", add(stalk, [0, r * 0.58, r * 0.06]), r * 0.035);
    for (let i = 0; i < 3; i += 1) {
      const z = (i - 1) * r * 0.55;
      const step = footCycle(m.phase - i / 3 - (x > 0 ? 0.5 : 0), 0.5, 0.5 * bodyStride(who) * m.moving, legLen * 0.3);
      limb(kit, `leg.${x}.${i}`, "alt", add(C, [x * r * 0.85, 0, z]), [x * (r + legLen * 0.9) + step.z, step.y, z * 1.3], [legLen * 0.6, legLen * 0.6], r * 0.12, [x, 1, 0], "alt");
    }
    const fiddler = who.member.coat === "fiddler" && x > 0 ? 1.8 : 1;
    const wave = x > 0 ? q.reach : 0;
    const claw = add(C, [x * r * 0.9, r * 0.3 + wave * r * 1.5, r * 1.5]);
    limb(kit, `claw.${x}`, "coat", add(C, [x * r * 0.7, 0, r * 0.6]), claw, [r * 0.8, r * 0.8], r * 0.16, [x, 0, 1], "accent");
    ball(kit, "pincer", "coat", claw, r * 0.38 * fiddler, 0.6);
    ball(kit, "pincer.tip", "accent", add(claw, [0, r * 0.15 * (0.5 + q.hand), r * 0.3 * fiddler]), r * 0.18 * fiddler);
  }
}

// ---------------------------------------------------------------- coats and rare morphs

/**
 * Special skins. The natural ones turn up anywhere, rarely: no pigment, too
 * much, patches, pale, red. The themed ones belong to their worlds: neon in
 * synth, pastel in vapor, crystal in crystal, spirit in the cosmos.
 */
export type Morph = "normal" | "albino" | "melanistic" | "golden" | "spirit" | "piebald" | "leucistic" | "erythristic" | "neon" | "pastel" | "crystal";
export const MORPHS: Readonly<Record<Morph, { readonly label: string; readonly rarity: Rarity; readonly glow: number; readonly lit?: readonly Role[] }>> = {
  normal: { label: "", rarity: "common", glow: 0 },
  albino: { label: "albino", rarity: "epic", glow: 0 },
  melanistic: { label: "black", rarity: "epic", glow: 0 },
  golden: { label: "golden", rarity: "legendary", glow: 0.45 },
  spirit: { label: "spirit", rarity: "epic", glow: 0.35, lit: ["eye", "glow"] },
  piebald: { label: "piebald", rarity: "rare", glow: 0 },
  leucistic: { label: "pale", rarity: "rare", glow: 0 },
  erythristic: { label: "red-phase", rarity: "epic", glow: 0 },
  neon: { label: "neon", rarity: "rare", glow: 0, lit: ["accent", "eye", "glow"] },
  pastel: { label: "pastel", rarity: "rare", glow: 0.1 },
  crystal: { label: "crystal", rarity: "rare", glow: 0.3, lit: ["eye"] },
};

/** The odds of each skin in a world: themed worlds favour their own. */
const WORLD_SKINS: Partial<Record<WorldKey, readonly (readonly [Morph, number])[]>> = {
  synth: [["neon", 0.12]],
  vapor: [["pastel", 0.12]],
  crystal: [["crystal", 0.14], ["spirit", 0.02]],
  cosmic: [["spirit", 0.1]],
};
const WILD_SKINS: readonly (readonly [Morph, number])[] = [
  ["albino", 0.012], ["melanistic", 0.015], ["piebald", 0.02], ["leucistic", 0.012], ["erythristic", 0.008], ["golden", 0.003], ["spirit", 0.004],
];

/** Iris colours: dark brown unless the species is known for other eyes. */
const IRIS: Partial<Record<SpeciesId, string>> = {
  fox: "#c8861c", wolf: "#d8a22a", cat: "#a8b830", owl: "#f0a820", gull: "#e8d878", parrot: "#e8d070",
  crow: "#2a2420", snake: "#d8b040", gecko: "#c8a038", raccoon: "#2a1a10", crane: "#d84a20", peacock: "#3a2414",
  macaque: "#8a5a2a", monkey: "#8a5a2a", koala: "#3a2a1a", kangaroo: "#3a2414", woodpecker: "#5a2418", crab: "#1a1410",
};

const hexRgb = (hex: string): [number, number, number] => { const v = Number.parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const rgbHex = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
const mixColor = (a: string, b: string, k: number): string => { const x = hexRgb(a); const y = hexRgb(b); return rgbHex(x.map((c, i) => mix(c, y[i] ?? c, k))); };

type CoatColors = readonly [string, string, string, string, string];

/**
 * No two animals quite alike: each one's coat is a touch lighter or darker,
 * warmer or cooler than the breed's, and a young one's is softer.
 */
function varied(colors: CoatColors, rand: () => number, young: boolean): CoatColors {
  const shade = (rand() - 0.5) * 0.24;
  const warmth = (rand() - 0.5) * 0.16;
  const tone = (hex: string, depth: number): string => {
    const lit = shade > 0 ? mixColor(hex, "#ffffff", shade * depth) : mixColor(hex, "#000000", -shade * depth);
    const warm = warmth > 0 ? mixColor(lit, "#c87a3a", warmth * depth) : mixColor(lit, "#7a8ab0", -warmth * depth);
    return young ? mixColor(warm, "#f4ece0", 0.12) : warm;
  };
  const [coat, alt, belly, dark, accent] = colors;
  return [tone(coat, 1), tone(alt, 1), tone(belly, 0.5), tone(dark, 0.4), accent];
}

function skinOf(base: Palette, morph: Morph): Palette {
  const { coat, alt, belly, accent } = base;
  switch (morph) {
    case "albino": return { ...base, coat: "#f6f3ee", alt: "#e9e4dc", belly: "#ffffff", eye: "#e05a6a", pupil: "#a02a3a", nose: "#e8a0a8", shell: "#efe8de" };
    case "melanistic": return { ...base, coat: mixColor(coat, "#0c0a0a", 0.75), alt: mixColor(alt, "#0c0a0a", 0.7), belly: mixColor(belly, "#1a1616", 0.65), eye: "#e8c040" };
    case "golden": return { ...base, coat: "#e8b830", alt: "#c08a18", belly: "#f8e088", accent: "#fff0a0", glow: "#ffe060", horn: "#f8d050", shell: "#d8a020" };
    case "spirit": return { ...base, coat: mixColor(coat, "#bff6ff", 0.75), alt: mixColor(alt, "#7fe0ff", 0.7), belly: "#f0ffff", glow: "#9ff4ff", eye: "#ffffff", pupil: "#5ad8ff", accent: mixColor(accent, "#ffffff", 0.5) };
    case "piebald": return { ...base, alt: "#f6f2ea", belly: "#ffffff", shell: "#f6f2ea" };
    case "leucistic": return { ...base, coat: mixColor(coat, "#f4ecdc", 0.72), alt: mixColor(alt, "#e8dcc8", 0.65), belly: mixColor(belly, "#ffffff", 0.6) };
    case "erythristic": return { ...base, coat: mixColor(coat, "#b8482a", 0.55), alt: mixColor(alt, "#8a3018", 0.5), belly: mixColor(belly, "#e8b8a0", 0.4) };
    case "neon": return { ...base, coat: mixColor(coat, "#16122a", 0.82), alt: mixColor(alt, "#241c44", 0.8), belly: "#2e2650", dark: "#0a0816", accent: "#ff3ad8", glow: "#3af0ff", eye: "#3af0ff", pupil: "#0a0816", horn: "#ff3ad8" };
    case "pastel": return { ...base, coat: mixColor(coat, "#f6c6de", 0.6), alt: mixColor(alt, "#b8d4ff", 0.55), belly: "#fff2f8", accent: "#a8f0dc", horn: mixColor(base.horn, "#f6c6de", 0.5) };
    case "crystal": return { ...base, coat: mixColor(coat, "#d4ecff", 0.65), alt: mixColor(alt, "#9ab4ff", 0.6), belly: "#f4faff", glow: "#e8f4ff", eye: "#9ff4ff", pupil: "#3a6ad8", shell: "#c8dcff" };
    default: return base;
  }
}

function paletteOf(id: SpeciesId, colors: CoatColors, morph: Morph): Palette {
  const [coat, alt, belly, dark, accent] = colors;
  const base: Palette = { coat, alt, belly, dark, accent, eye: IRIS[id] ?? "#4a2a16", pupil: "#070505", shine: "#ffffff", nose: dark, glow: accent, horn: BEAKS[id] ?? "#cbb38c", shell: alt };
  return skinOf(base, morph);
}

// ---------------------------------------------------------------- casting

export interface CastMember {
  readonly species: SpeciesId;
  readonly label: string;
  readonly size: number;
  readonly coat: string;
  readonly palette: Palette;
  readonly morph: Morph;
  readonly young: boolean;
  /** Antlered (a stag, not a doe). */
  readonly horned: boolean;
}

export interface CastGroup { readonly kind: GroupKind | "mixed"; readonly members: readonly CastMember[] }

/** Craft and lights in the sky. */
export type PlaneKind = "airliner" | "prop" | "jet" | "ufo" | "balloon" | "helicopter" | "blimp" | "kite" | "satellite" | "rocket" | "comet";
/** What can pass over: birds (a loose flock, a V, a swirling murmuration), bats, or a craft. */
export type SkyKind = PlaneKind | "flock" | "vee" | "murmuration" | "bats";

/** One kind of sky traffic, how often it comes, and when it can. */
export interface SkyTraffic {
  readonly kind: SkyKind;
  readonly weight: number;
  /** Only by day, or only by night. */
  readonly when?: "day" | "night";
  /** Only in fair weather: not in rain or snow. */
  readonly fair?: boolean;
  /** Only in these seasons (a migration). */
  readonly seasons?: readonly Season[];
}

/** What passes over this world. */
export interface SkyPlan {
  /** The birds that flock over, those that fly in a V, and those that gather in a murmuration (null where none do). */
  readonly birds: SpeciesId | null;
  readonly vee: SpeciesId | null;
  readonly swarm: SpeciesId | null;
  /** Everything that can pass over, weighted; what fits the moment is picked as each pass comes. */
  readonly traffic: readonly SkyTraffic[];
  /** Seconds between passes. */
  readonly every: readonly [number, number];
}

/** The sky right now, so what passes fits it: bats and satellites by night, balloons and kites in fair weather by day. */
export interface SkyNow {
  /** Scales how far off things pass. */
  readonly radius?: number;
  readonly night?: boolean;
  /** "rain" and "snow" keep fair-weather traffic down; anything else is fair. */
  readonly weather?: string;
  readonly season?: string;
}

export interface Cast {
  readonly seed: number;
  readonly rarity: Rarity;
  readonly label: string;
  readonly groups: readonly CastGroup[];
  readonly sky: SkyPlan;
}

export interface CastInput {
  readonly seed?: number | string | undefined;
  readonly region?: string | undefined;
  readonly world?: string | undefined;
  readonly season?: string | undefined;
  /** Walkable radius: big animals need room. */
  readonly radius?: number | undefined;
  /** Force a species ("none" for an empty scene). */
  readonly species?: string | undefined;
  /** Force a group: solo, pair, family, pack, mixed. */
  readonly group?: string | undefined;
  /** Force a morph: albino, melanistic, golden, spirit. */
  readonly morph?: string | undefined;
}

interface CastContext { readonly region: RegionId | null; readonly world: WorldKey; readonly season: Season; readonly radius: number }

const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const rarer = (a: Rarity, b: Rarity): Rarity => (RARITY_ORDER.indexOf(a) >= RARITY_ORDER.indexOf(b) ? a : b);
const bumpRarity = (r: Rarity): Rarity => RARITY_ORDER[Math.min(4, RARITY_ORDER.indexOf(r) + 1)] ?? r;
const isSpecies = (id: string | undefined): id is SpeciesId => id !== undefined && Object.hasOwn(SPECIES, id);
const WORLD_KEYS: readonly WorldKey[] = ["nature", "beach", "city", "synth", "vapor", "crystal", "cosmic", "voxel"];
const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

function numericSeed(seed: CastInput["seed"]): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  return hashName(String(seed ?? "keel-fauna"));
}

function contextOf(input: CastInput): CastContext {
  const region = ALL_REGIONS.find((id) => id === input.region) ?? null;
  return {
    region,
    world: WORLD_KEYS.find((id) => id === input.world) ?? "nature",
    season: SEASONS.find((id) => id === input.season) ?? "summer",
    radius: Math.max(0.5, input.radius ?? 5),
  };
}

/** Whether a species belongs in this place, world, season and space. */
export function fits(id: SpeciesId, input: CastInput): boolean {
  const ctx = contextOf(input);
  const spec = speciesOf(id);
  const span = spec.plan === "serpent" ? spec.size * 0.3 : spec.size;
  if (ctx.region !== null && !spec.regions.includes(ctx.region)) return false;
  if (!spec.worlds.includes(ctx.world)) return false;
  if (ctx.season === "winter" && !spec.winter) return false;
  return span <= ctx.radius * 0.3;
}

function memberOf(rand: () => number, id: SpeciesId, coat: string, young: boolean, input: CastInput): CastMember {
  const spec = speciesOf(id);
  const colors = spec.coats.find(([name]) => name === coat)?.[1] ?? spec.coats[0]?.[1] ?? ["#888888", "#666666", "#cccccc", "#222222", "#ffffff"];
  const ctx = contextOf(input);
  const forced = Object.hasOwn(MORPHS, input.morph ?? "") ? (input.morph as Morph) : null;
  const skins = [...(WORLD_SKINS[ctx.world] ?? []), ...WILD_SKINS];
  const rare = skins.reduce((sum, [, odds]) => sum + odds, 0);
  const morph: Morph = forced ?? pick(rand, [["normal", Math.max(0, 1 - rare)], ...skins]);
  const size = spec.size * between(rand, [0.88, 1.12]) * (young ? 0.55 : 1);
  return { species: id, label: spec.label, size, coat, palette: paletteOf(id, varied(colors, rand, young), morph), morph, young, horned: !young && rand() < 0.5 };
}

function groupOf(rand: () => number, id: SpeciesId, kind: GroupKind, input: CastInput): CastGroup {
  const spec = speciesOf(id);
  // The first coat is the species' own; the others are rarer variants.
  const coats = spec.coats.map(([name], i) => [name, i === 0 ? 5 : 1] as const);
  const coat = pick(rand, coats);
  const count = kind === "solo" ? 1 : kind === "pair" ? 2 : kind === "family" ? 1 + intBetween(rand, 1, 2) : intBetween(rand, spec.pack[0], spec.pack[1]);
  const members = Array.from({ length: count }, (_, i) => memberOf(rand, id, rand() < 0.15 ? pick(rand, coats) : coat, kind === "family" && i > 0, input));
  return { kind, members };
}

function pickSpecies(rand: () => number, input: CastInput, not: readonly SpeciesId[] = []): SpeciesId | null {
  const pool = SPECIES_IDS.filter((id) => fits(id, input) && !not.includes(id));
  if (pool.length === 0) return null;
  return pick(rand, pool.map((id) => [id, speciesOf(id).weight] as const));
}

const GROUP_KINDS: readonly GroupKind[] = ["solo", "pair", "family", "pack"];

function kindFor(rand: () => number, id: SpeciesId, together: boolean): GroupKind {
  const odds = speciesOf(id).groups;
  return pick(rand, GROUP_KINDS.map((kind, i) => [kind, together && kind === "solo" ? 0 : odds[i] ?? 0] as const).filter(([, w]) => w > 0).concat(together ? [] : [["solo", 0.01]]));
}

/** Two species that are seen together: a deer and a songbird, a capybara and a monkey. */
function mixedGroup(rand: () => number, input: CastInput): CastGroup | null {
  const host = pickSpecies(rand, input);
  if (!host) return null;
  const friends = speciesOf(host).friends.filter((id): id is SpeciesId => isSpecies(id) && fits(id, input));
  const guest = friends.length > 0 ? pick(rand, friends.map((id) => [id, 1] as const)) : null;
  if (!guest) return null;
  const a = groupOf(rand, host, rand() < 0.6 ? "solo" : "pair", input);
  const b = groupOf(rand, guest, rand() < 0.65 ? "solo" : "pair", input);
  const members = [...a.members, ...b.members].sort((x, y) => y.size - x.size);
  return { kind: "mixed", members };
}

const TIERS = [["none", 440], ["solo", 300], ["group", 170], ["mixed", 70], ["menagerie", 20]] as const;
type Tier = (typeof TIERS)[number][0];

function tierFor(rand: () => number, input: CastInput): Tier {
  const roll = pick(rand, TIERS);
  if (input.species === "none" || input.group === "none") return "none";
  if (input.group === "mixed") return "mixed";
  if (input.group !== undefined && GROUP_KINDS.includes(input.group as GroupKind)) return "group";
  return isSpecies(input.species) && roll === "none" ? "solo" : roll;
}

function groupsFor(rand: () => number, tier: Tier, input: CastInput): CastGroup[] {
  if (tier === "none") return [];
  if (tier === "mixed") { const g = mixedGroup(rand, input); return g ? [g] : groupsFor(rand, "solo", input); }
  const forced = isSpecies(input.species) ? input.species : null;
  const id = forced ?? pickSpecies(rand, input);
  if (!id) return [];
  const asked = GROUP_KINDS.find((kind) => kind === input.group);
  // (Some never go alone: a lone firefly is a pack of them.)
  const kind = asked ?? (tier === "solo" && speciesOf(id).groups[0] > 0 ? "solo" : kindFor(rand, id, true));
  const first = groupOf(rand, id, kind, input);
  return tier === "menagerie" ? [first, ...secondGroup(rand, id, input)] : [first];
}

/** A menagerie's other company: a mixed group, or another species of its own. */
function secondGroup(rand: () => number, first: SpeciesId, input: CastInput): CastGroup[] {
  const mixed = rand() < 0.5 ? mixedGroup(rand, input) : null;
  if (mixed) return [mixed];
  const other = pickSpecies(rand, input, [first]);
  return other ? [groupOf(rand, other, kindFor(rand, other, false), input)] : [];
}

const PLURALS: Partial<Record<SpeciesId, string>> = { deer: "deer", mouse: "field mice", fox: "foxes", wolf: "wolves", butterfly: "butterflies", firefly: "fireflies", sloth: "sloths", redpanda: "red pandas" };
const plural = (id: SpeciesId): string => PLURALS[id] ?? `${speciesOf(id).label.toLowerCase()}s`;

function labelOf(groups: readonly CastGroup[]): string {
  if (groups.length === 0) return "no animals";
  return groups.map((group) => {
    const first = group.members[0];
    if (!first) return "";
    const morph = MORPHS[first.morph].label;
    const name = `${morph ? `${morph} ` : ""}${first.label.toLowerCase()}`;
    if (group.kind === "solo") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
    if (group.kind === "pair") return `a pair of ${plural(first.species)}`;
    if (group.kind === "family") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name} with ${group.members.length - 1} young`;
    if (group.kind === "pack") return `${group.members.length} ${plural(first.species)}`;
    return [...new Set(group.members.map((m) => m.species))].map((id) => plural(id)).join(" and ");
  }).join(", ");
}

function rarityOf(tier: Tier, groups: readonly CastGroup[]): Rarity {
  let rarity: Rarity = "common";
  for (const group of groups) {
    for (const member of group.members) rarity = rarer(rarer(rarity, speciesOf(member.species).rarity), MORPHS[member.morph].rarity);
    if (group.kind === "pack" || group.kind === "family") rarity = rarer(rarity, "uncommon");
  }
  if (tier === "mixed") rarity = bumpRarity(rarer(rarity, "uncommon"));
  if (tier === "menagerie") rarity = rarer(bumpRarity(rarity), "epic");
  return rarity;
}

const tr = (kind: SkyKind, weight: number, extra: Omit<SkyTraffic, "kind" | "weight"> = {}): SkyTraffic => ({ kind, weight, ...extra });
const DAY = { when: "day" } as const;
const NIGHT = { when: "night" } as const;
const FAIR_DAY = { when: "day", fair: true } as const;
const FAIR_NIGHT = { when: "night", fair: true } as const;
const MIGRATING = { when: "day", seasons: ["spring", "autumn"] } as const;

const COUNTRY_SKY: readonly SkyTraffic[] = [
  tr("flock", 5, DAY), tr("vee", 3, MIGRATING), tr("murmuration", 1, FAIR_DAY), tr("bats", 3, NIGHT),
  tr("airliner", 3), tr("prop", 1.5, FAIR_DAY), tr("balloon", 1.2, FAIR_DAY), tr("satellite", 2.5, FAIR_NIGHT), tr("comet", 1.2, FAIR_NIGHT),
];

/** What each world's sky carries, and how busy it is. */
const WORLD_SKY: Readonly<Record<WorldKey, { readonly traffic: readonly SkyTraffic[]; readonly every: readonly [number, number] }>> = {
  nature: { traffic: COUNTRY_SKY, every: [12, 34] },
  voxel: { traffic: COUNTRY_SKY, every: [12, 34] },
  beach: {
    traffic: [tr("flock", 6, DAY), tr("vee", 1.5, DAY), tr("kite", 2.5, FAIR_DAY), tr("prop", 3, FAIR_DAY), tr("airliner", 2), tr("balloon", 0.8, FAIR_DAY), tr("bats", 1.5, NIGHT), tr("satellite", 2.5, FAIR_NIGHT), tr("comet", 1.2, FAIR_NIGHT)],
    every: [10, 30],
  },
  city: {
    traffic: [tr("flock", 4, DAY), tr("murmuration", 1.2, FAIR_DAY), tr("helicopter", 2.5), tr("blimp", 1.2, FAIR_DAY), tr("airliner", 5), tr("jet", 1.5), tr("bats", 1, NIGHT), tr("satellite", 0.6, FAIR_NIGHT)],
    every: [8, 24],
  },
  synth: { traffic: [tr("jet", 5), tr("ufo", 1.8), tr("helicopter", 1), tr("comet", 1.5, NIGHT), tr("satellite", 1, NIGHT)], every: [14, 36] },
  vapor: { traffic: [tr("jet", 3), tr("balloon", 2, FAIR_DAY), tr("blimp", 2, { fair: true }), tr("flock", 1, DAY), tr("kite", 1, FAIR_DAY), tr("ufo", 1), tr("comet", 0.8, NIGHT)], every: [14, 36] },
  crystal: { traffic: [tr("vee", 2.5, DAY), tr("flock", 2, DAY), tr("balloon", 3, FAIR_DAY), tr("airliner", 1), tr("comet", 1.8, NIGHT), tr("satellite", 1.5, FAIR_NIGHT)], every: [14, 38] },
  cosmic: { traffic: [tr("ufo", 2), tr("satellite", 3), tr("rocket", 1.5), tr("comet", 3)], every: [9, 24] },
};
const FLOCK_WEIGHTS: Partial<Record<SpeciesId, number>> = { songbird: 4, crow: 2, gull: 4, parrot: 2, crane: 0.6 };
const BIRDS_FOR: Readonly<Record<"vee" | "murmuration", readonly SpeciesId[]>> = { vee: ["crane", "gull", "crow"], murmuration: ["songbird", "crow"] };

function skyFor(rand: () => number, input: CastInput): SkyPlan {
  const ctx = contextOf(input);
  const here = (id: SpeciesId): boolean => (ctx.region === null || speciesOf(id).regions.includes(ctx.region)) && speciesOf(id).worlds.includes(ctx.world === "voxel" ? "nature" : ctx.world);
  const flockers = (Object.keys(FLOCK_WEIGHTS) as SpeciesId[]).filter(here);
  const birds = flockers.length > 0 ? pick(rand, flockers.map((id) => [id, FLOCK_WEIGHTS[id] ?? 1] as const)) : null;
  const vee = BIRDS_FOR.vee.find(here) ?? null;
  const swarm = BIRDS_FOR.murmuration.find(here) ?? null;
  const has: Partial<Record<SkyKind, boolean>> = { flock: birds !== null, vee: vee !== null, murmuration: swarm !== null };
  const sky = WORLD_SKY[ctx.world];
  return { birds, vee, swarm, traffic: sky.traffic.filter((each) => has[each.kind] !== false), every: sky.every };
}

/**
 * Cast a scene: which animals live in it (most scenes have none; a lone
 * animal is likelier than a pair, a pair than a family or pack, and mixed
 * company rarest), their coats and rare morphs, and what passes over in the sky.
 */
export function castFor(input: CastInput = {}): Cast {
  const seed = numericSeed(input.seed);
  const rand = streamOf(seed, "fauna.cast");
  const tier = tierFor(rand, input);
  const groups = groupsFor(rand, tier, input);
  return { seed, rarity: groups.length > 0 ? rarityOf(tier, groups) : "common", label: labelOf(groups), groups, sky: skyFor(streamOf(seed, "fauna.sky"), input) };
}

// ---------------------------------------------------------------- bodies

type Who = Pick<Actor, "member" | "spec">;

/** One posed animal (or plane): its capsules and the colours their roles take. */
export interface Body {
  readonly id: string;
  readonly kind: SpeciesId | PlaneKind | "bat";
  readonly label: string;
  readonly action: Action;
  readonly morph: Morph;
  readonly at: Vec;
  readonly front: Vec;
  readonly capsules: readonly Capsule[];
  readonly palette: Palette;
  /** How brightly it glows (a spirit animal, a golden one, a saucer's lights). */
  readonly glow: number;
  /** Colours that light themselves (a neon skin's markings). */
  readonly lit?: readonly Role[];
  /** Where it bears on the tree (a branch it sits on, wood it climbs), or null on the ground and in the air. */
  readonly contact?: Vec | null;
  /** Its weight, to bend the wood it bears on: a bird is light for its size, a bear is not. */
  readonly weight?: number;
  /** The food it is eating (a `Food.key`), while it eats. */
  readonly meal?: string;
}

const POSERS: Readonly<Record<Plan, (kit: Kit, who: Who, m: Moment) => void>> = {
  quad: poseQuad, primate: posePrimate, bird: poseBird, serpent: poseSerpent, bug: poseBug, crab: poseCrab,
};

function poseWho(who: Who, m: Moment): Capsule[] {
  const q = m.pose;
  const roll = who.spec.plan === "quad" ? q.roll * Math.PI + q.shake * 0.45 * Math.sin(m.t * 32) : 0;
  // (A crab walks sideways: its right hand leads.)
  const f = who.spec.plan === "crab" ? { o: m.frame.o, x: m.frame.z, y: m.frame.y, z: scale(m.frame.x, -1) } : m.frame;
  const kit: Kit = { f, out: [], roll, pivot: [0, who.spec.build.body * who.member.size * 1.05, 0] };
  POSERS[who.spec.plan](kit, who, m);
  return kit.out;
}

/** Where an animal bears on the tree this moment: the branch it rests on or the wood it is climbing. */
function contactOf(m: Moment, scene: Scene): Vec | null {
  if (m.mode === "climb") return m.frame.o;
  if (m.mode !== null) return null;
  const place = m.segment.to;
  if (place.on === "perch") return perchOf(scene.stage, place.i)?.p ?? null;
  if (place.on === "trunk") return m.frame.o;
  return null;
}

const weightOf = (who: Who): number => who.member.size ** 3 * (who.spec.plan === "bird" || who.spec.plan === "bug" ? 0.3 : 1);

function bodyOf(id: string, who: Who, m: Moment, capsules: readonly Capsule[], scene?: Scene): Body {
  return {
    id, kind: who.member.species, label: who.member.label, action: m.segment.act, morph: who.member.morph,
    at: m.frame.o, front: m.frame.z, capsules, palette: who.member.palette, glow: MORPHS[who.member.morph].glow, lit: MORPHS[who.member.morph].lit ?? [],
    contact: scene ? contactOf(m, scene) : null, weight: weightOf(who),
    ...(m.segment.meal === undefined ? {} : { meal: m.segment.meal }),
  };
}

/** Where a rider sits: the top of the body capsule's middle. */
function backOf(capsules: readonly Capsule[]): Anchor | null {
  const body = capsules.find((c) => c.part === "body" || c.part === "torso");
  if (!body) return null;
  return { p: madd(lerpV(body.a, body.b, 0.5), body.up, body.r * 0.95), up: body.up, along: unit(sub(body.b, body.a)) };
}

/**
 * Any species doing any action at time `t`, standing at the origin facing +z:
 * for galleries, thumbnails and tests.
 */
export function poseSpecies(id: SpeciesId, action: Action = "stand", t = 0, options: { readonly morph?: Morph; readonly young?: boolean; readonly seed?: number } = {}): Body {
  const spec = speciesOf(id);
  const member = memberOf(createRandom(options.seed ?? 1), id, spec.coats[0]?.[0] ?? "", options.young ?? false, { morph: options.morph });
  const m = galleryMoment(spec, action, t);
  const who: Who = { member, spec };
  return bodyOf(id, who, m, poseWho(who, m));
}

const GALLERY_MODES: Partial<Record<Action, MoveMode>> = { fly: "fly", climb: "climb", wander: "walk", run: "walk", hop: "walk" };

function galleryMoment(spec: SpeciesSpec, action: Action, t: number): Moment {
  const ground: Place = { on: "ground", x: 0, z: 0 };
  const mode = GALLERY_MODES[action] ?? null;
  const pace = mode ? spec.speed * (PACE[action] ?? 1) : 0;
  const segment: Segment = { act: action, t0: 0, t1: Math.max(t, 0) + 4, from: ground, to: ground, yaw: 0, face: -1, mode, pace };
  const lift: Vec = action === "fly" ? [0, spec.size * 2, 0] : [0, 0, 0];
  return { frame: frameOf(lift, [0, 0, 1]), phase: (t * pace) / Math.max(0.5, spec.build.len), moving: mode ? 1 : 0, pace, mode, segment, pose: paramsOf(segment, t + FADE), t };
}

// ---------------------------------------------------------------- the sky

interface Pass {
  readonly kind: SkyKind;
  readonly start: number;
  readonly end: number;
  readonly from: Vec;
  readonly to: Vec;
  readonly count: number;
  readonly v: boolean;
  readonly seed: number;
}

/** Schedule passes ahead to `t`; `make` may decline one (nothing fits the sky just then). */
function passesUntil(list: Pass[], clock: { last: number }, rand: () => number, every: readonly [number, number], t: number, make: (start: number) => Pass | null): void {
  while (clock.last < t + 1) {
    clock.last += between(rand, every);
    const pass = make(clock.last);
    if (pass) list.push(pass);
  }
  while (list.length > 0 && (list[0]?.end ?? 0) < t - 5) list.shift();
}

function chord(rand: () => number, near: readonly [number, number], height: readonly [number, number], span: number): { from: Vec; to: Vec } {
  const heading = rand() * TAU;
  const offset = between(rand, near) * (rand() < 0.5 ? -1 : 1);
  const y = between(rand, height);
  const dir: Vec = [Math.sin(heading), 0, Math.cos(heading)];
  const side: Vec = [Math.cos(heading), 0, -Math.sin(heading)];
  const mid: Vec = [side[0] * offset, y, side[2] * offset];
  return { from: madd(mid, dir, -span), to: madd(mid, dir, span) };
}

/** How each kind crosses the sky: how far off, how high, how long a path, how fast, how many together. */
interface Route { readonly near: readonly [number, number]; readonly height: readonly [number, number]; readonly span: number; readonly speed: readonly [number, number]; readonly count: readonly [number, number] }
const ROUTES: Readonly<Record<SkyKind, Route>> = {
  flock: { near: [8, 26], height: [6, 15], span: 45, speed: [3.5, 5.5], count: [1, 9] },
  vee: { near: [10, 30], height: [12, 22], span: 55, speed: [4, 5.5], count: [5, 11] },
  murmuration: { near: [14, 26], height: [9, 15], span: 40, speed: [1.6, 2.4], count: [14, 20] },
  bats: { near: [1.5, 7], height: [3, 7], span: 20, speed: [2.4, 3.4], count: [3, 7] },
  airliner: { near: [50, 75], height: [26, 38], span: 110, speed: [7, 10], count: [1, 1] },
  prop: { near: [25, 45], height: [12, 20], span: 80, speed: [5, 7], count: [1, 1] },
  jet: { near: [45, 70], height: [24, 36], span: 120, speed: [13, 17], count: [1, 1] },
  ufo: { near: [50, 75], height: [26, 38], span: 110, speed: [4, 6], count: [1, 1] },
  balloon: { near: [30, 50], height: [16, 26], span: 110, speed: [1.7, 2.5], count: [1, 1] },
  helicopter: { near: [18, 40], height: [9, 16], span: 70, speed: [3, 4.5], count: [1, 1] },
  blimp: { near: [35, 55], height: [16, 24], span: 90, speed: [1.4, 2], count: [1, 1] },
  kite: { near: [11, 17], height: [7, 11], span: 1.5, speed: [0.04, 0.06], count: [1, 1] },
  satellite: { near: [20, 70], height: [70, 95], span: 150, speed: [10, 13], count: [1, 1] },
  rocket: { near: [70, 95], height: [1, 3], span: 0, speed: [9, 13], count: [1, 1] },
  comet: { near: [20, 70], height: [45, 70], span: 60, speed: [45, 60], count: [1, 1] },
};

const SKY_AT_ONCE = 2;
const FOUL = new Set(["rain", "snow"]);
const fitsNow = (each: SkyTraffic, now: SkyNow): boolean =>
  (each.when === undefined || (each.when === "night") === (now.night === true))
  && (each.fair !== true || !FOUL.has(now.weather ?? ""))
  && (each.seasons === undefined || each.seasons.some((season) => season === now.season));

/** What passes next, chosen from what fits the sky right now (null when nothing does). */
function nextTraffic(rand: () => number, plan: SkyPlan, now: SkyNow): SkyKind | null {
  const roll = rand();
  const fitting = plan.traffic.filter((each) => fitsNow(each, now));
  // Birds keep low and few in rain and snow.
  const weights = fitting.map((each) => each.weight * (FOUL.has(now.weather ?? "") && BIRD_KINDS.has(each.kind) ? 0.3 : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let left = roll * total;
  for (const [i, each] of fitting.entries()) {
    left -= weights[i] ?? 0;
    if (left < 0) return each.kind;
  }
  return null;
}
const BIRD_KINDS: ReadonlySet<SkyKind> = new Set<SkyKind>(["flock", "vee", "murmuration", "bats"]);

function routeOf(kind: SkyKind, rand: () => number, reach: number): { from: Vec; to: Vec } {
  const route = ROUTES[kind];
  const near: [number, number] = [route.near[0] * reach, route.near[1] * reach];
  if (kind === "rocket") {
    // A rocket climbs from far off on the horizon, straight up and leaning over.
    const heading = rand() * TAU;
    const d = between(rand, near);
    const from: Vec = [Math.sin(heading) * d, between(rand, route.height), Math.cos(heading) * d];
    return { from, to: add(from, [Math.sin(heading) * 20, 140, Math.cos(heading) * 20]) };
  }
  const { from, to } = chord(rand, near, route.height, route.span * reach);
  // A shooting star falls as it crosses.
  return kind === "comet" ? { from: add(from, [0, 14, 0]), to: add(to, [0, -14, 0]) } : { from, to };
}

function passOf(kind: SkyKind, start: number, rand: () => number, reach: number, plan: SkyPlan): Pass {
  const route = ROUTES[kind];
  const { from, to } = routeOf(kind, rand, reach);
  const crane = kind === "flock" && plan.birds === "crane";
  const count = crane ? intBetween(rand, 3, 7) : intBetween(rand, route.count[0], route.count[1]);
  const v = kind === "vee" || (kind === "flock" && count >= 5 && rand() < 0.4);
  return { kind, start, end: start + Math.max(1.2, length(sub(to, from)) / between(rand, route.speed)), from, to, count, v, seed: Math.floor(rand() * 1e6) };
}

const FLY_SEGMENT: Segment = { act: "fly", t0: 0, t1: 1e9, from: { on: "ground", x: 0, z: 0 }, to: { on: "ground", x: 0, z: 0 }, yaw: 0, face: -1, mode: "fly", pace: 4 };

function flyingBird(id: string, who: Who, p: Vec, dir: Vec, t: number): Body {
  const m: Moment = { frame: frameOf(p, dir), phase: 0, moving: 1, pace: 4, mode: "fly", segment: FLY_SEGMENT, pose: { ...restPose(), wing: 1 }, t };
  return bodyOf(id, who, m, poseWho(who, m));
}

function flockBodies(pass: Pass, who: Who, t: number): Body[] {
  const u = (t - pass.start) / (pass.end - pass.start);
  const dir = unit(sub(pass.to, pass.from));
  const side = unit(cross(UP, dir));
  const out: Body[] = [];
  for (let i = 0; i < pass.count; i += 1) {
    const rank = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
    const spread = pass.v ? [rank * 0.9, -Math.abs(rank) * 1.1] : [Math.sin(i * 2.4 + pass.seed) * 2.2, Math.cos(i * 1.7 + pass.seed) * 2.4];
    const bobbing = Math.sin(t * 1.3 + i * 1.1) * 0.25;
    const p = add(madd(madd(lerpV(pass.from, pass.to, u), side, spread[0] ?? 0), dir, spread[1] ?? 0), [0, bobbing + (pass.v ? 0 : Math.sin(i * 3.3) * 0.8), 0]);
    out.push(flyingBird(`flock.${String(pass.seed)}.${String(i)}`, who, p, dir, t + i * 0.37));
  }
  return out;
}

/**
 * A swarm that wheels as it goes: each one weaves on its own slow loops about
 * the moving middle, the whole cloud breathing in and out, and faces the way
 * it is moving. A murmuration is wide and smooth; bats flit, tight and quick.
 */
function swarmAt(pass: Pass, i: number, t: number, bats: boolean): Vec {
  const u = (t - pass.start) / (pass.end - pass.start);
  const k = i * 1.618 + (pass.seed % 97);
  const breath = 1 + 0.45 * Math.sin(t * 0.37 + pass.seed);
  const wide = bats ? 1.1 : 3.2 * breath;
  const quick = bats ? 3 : 0.8;
  const off: Vec = [
    (Math.sin(t * quick * 1.1 + k * 2.1) + 0.6 * Math.sin(t * quick * 0.43 + k)) * wide,
    (Math.sin(t * quick * 1.3 + k * 1.3) * 0.5 + 0.4 * Math.sin(t * 0.21 + k * 0.7)) * wide * 0.5,
    (Math.cos(t * quick * 0.9 + k * 1.7) + 0.6 * Math.cos(t * quick * 0.51 + k * 0.4)) * wide,
  ];
  return add(lerpV(pass.from, pass.to, clamp(u, 0, 1)), off);
}

function swarmBodies(pass: Pass, who: Who | null, t: number): Body[] {
  const bats = pass.kind === "bats";
  const out: Body[] = [];
  for (let i = 0; i < pass.count; i += 1) {
    const p = swarmAt(pass, i, t, bats);
    const dir = unit(sub(swarmAt(pass, i, t + 0.05, bats), p), [0, 0, 1]);
    const id = `${pass.kind}.${String(pass.seed)}.${String(i)}`;
    if (bats || !who) out.push(batBody(id, p, dir, t + i * 0.21));
    else out.push(flyingBird(id, who, p, dir, t + i * 0.29));
  }
  return out;
}

const BAT_LOOK: Palette = { coat: "#3a2e34", alt: "#2a2026", belly: "#4a3a40", dark: "#1a1216", eye: "#ffd27a", nose: "#2a1a1e", accent: "#5a4048", glow: "#ffd27a", horn: "#2a2026", shell: "#2a2026" };

/** A bat: a small furred body, big ears, and membranes that beat fast and fold. */
function batBody(id: string, p: Vec, dir: Vec, t: number): Body {
  const size = 0.22;
  const kit: Kit = { f: frameOf(p, dir), out: [], roll: 0, pivot: [0, 0, 0] };
  ball(kit, "body", "coat", [0, 0, 0], size * 0.22, 0.85);
  ball(kit, "head", "coat", [0, size * 0.04, size * 0.22], size * 0.14);
  for (const x of [-1, 1]) {
    cap(kit, "ear", "dark", [x * size * 0.06, size * 0.12, size * 0.24], [x * size * 0.09, size * 0.26, size * 0.2], size * 0.04, 0.4, [0, 0, 1]);
    const beat = Math.sin(t * 15 + (x > 0 ? 0 : 0.2));
    const tip: Vec = [x * size * 0.95, beat * size * 0.5, -size * 0.05];
    const elbow: Vec = [x * size * 0.45, beat * size * 0.3 + size * 0.08, size * 0.1];
    cap(kit, "wing", "alt", [x * size * 0.1, 0, size * 0.05], elbow, size * 0.16, 0.12);
    cap(kit, "wing", "alt", elbow, tip, size * 0.14, 0.12);
  }
  return { id, kind: "bat", label: "Bat", action: "fly", morph: "normal", at: p, front: dir, capsules: kit.out, palette: BAT_LOOK, glow: 0 };
}

const PLANE_LOOKS: Readonly<Record<PlaneKind, Palette>> = {
  airliner: { coat: "#f4f6f8", alt: "#c8d0d8", belly: "#e8ecf0", dark: "#3a4250", eye: "#1a2230", nose: "#3a4250", accent: "#2a5ad0", glow: "#ff4a3a", horn: "#9aa4ae", shell: "#c8d0d8" },
  prop: { coat: "#f0d040", alt: "#d83a2a", belly: "#f8f0d0", dark: "#2a2a2a", eye: "#1a1a1a", nose: "#2a2a2a", accent: "#f4f0e8", glow: "#ff4a3a", horn: "#8a7a5a", shell: "#d83a2a" },
  jet: { coat: "#1a1a2a", alt: "#ff3ad8", belly: "#2a2a3a", dark: "#0a0a14", eye: "#0a0a14", nose: "#0a0a14", accent: "#3af0ff", glow: "#f4f8ff", horn: "#3af0ff", shell: "#ff3ad8" },
  ufo: { coat: "#c8ccd8", alt: "#8a90a0", belly: "#5a6070", dark: "#2a2e38", eye: "#1a1e28", nose: "#2a2e38", accent: "#7affc8", glow: "#9ff4ff", horn: "#f0f4ff", shell: "#8a90a0" },
  balloon: { coat: "#e83a3a", alt: "#f0d040", belly: "#3a6ad0", dark: "#6a4a2a", eye: "#2a1a10", nose: "#6a4a2a", accent: "#ffffff", glow: "#ffb050", horn: "#6a4a2a", shell: "#f0d040" },
  helicopter: { coat: "#d83a2a", alt: "#f4f0e8", belly: "#2a2a2a", dark: "#22262c", eye: "#1a1a1a", nose: "#22262c", accent: "#9fd8ff", glow: "#ff4a3a", horn: "#8a8a8a", shell: "#f4f0e8" },
  blimp: { coat: "#d8dce4", alt: "#2a5ad0", belly: "#f0f2f6", dark: "#3a4250", eye: "#1a2230", nose: "#3a4250", accent: "#f0c040", glow: "#ff4a3a", horn: "#9aa4ae", shell: "#2a5ad0" },
  kite: { coat: "#ff4a6a", alt: "#ffd040", belly: "#40c8ff", dark: "#f4f0e8", eye: "#1a1a1a", nose: "#2a2a2a", accent: "#40c8ff", glow: "#ffd040", horn: "#f4f0e8", shell: "#ffd040" },
  satellite: { coat: "#d8d0b0", alt: "#2a4a9a", belly: "#c8c0a0", dark: "#3a3a3a", eye: "#1a1a1a", nose: "#3a3a3a", accent: "#4a7ad8", glow: "#fffbe8", horn: "#9a9a9a", shell: "#2a4a9a" },
  rocket: { coat: "#f4f4f4", alt: "#2a2a2a", belly: "#e8e8e8", dark: "#2a2a2a", eye: "#1a1a1a", nose: "#d83a2a", accent: "#d83a2a", glow: "#ffb040", horn: "#c8c8c8", shell: "#f0f0f0" },
  comet: { coat: "#fff8e0", alt: "#c8e8ff", belly: "#fff8e0", dark: "#fff8e0", eye: "#fff8e0", nose: "#fff8e0", accent: "#c8e8ff", glow: "#fffbe8", horn: "#fff8e0", shell: "#fff8e0" },
};

/** A red light that blinks: on aircraft by day and night. */
function beacon(kit: Kit, at: Vec, r: number, t: number): void {
  if (Math.sin(t * 5.2) > 0.6) ball(kit, "beacon", "glow", at, r);
}

function airliner(kit: Kit, size: number, prop: boolean, t: number): void {
  const L = size;
  cap(kit, "fuselage", "coat", [0, 0, -L * 0.5], [0, 0, L * 0.5], L * 0.07);
  for (const x of [-1, 1]) {
    cap(kit, "wing", "alt", [0, -L * 0.02, L * 0.02], [x * L * 0.5, -L * 0.02, -L * 0.12], L * 0.06, 0.18);
    cap(kit, "tailplane", "alt", [0, 0, -L * 0.45], [x * L * 0.18, 0, -L * 0.52], L * 0.03, 0.2);
    ball(kit, "light", "glow", [x * L * 0.5, -L * 0.02, -L * 0.12], L * 0.025);
    if (!prop) ball(kit, "engine", "dark", [x * L * 0.18, -L * 0.07, L * 0.06], L * 0.04);
  }
  cap(kit, "fin", "accent", [0, 0, -L * 0.4], [0, L * 0.18, -L * 0.52], L * 0.04, 0.2, [1, 0, 0]);
  if (prop) ball(kit, "propeller", "dark", [0, 0, L * 0.53], L * 0.09, 0.08, [0, 0, 1]);
  beacon(kit, [0, L * 0.09, 0], L * 0.03, t);
  beacon(kit, [0, -L * 0.08, 0.1 * L], L * 0.03, t + 0.5);
}

function banner(kit: Kit, size: number, t: number): void {
  cap(kit, "rope", "dark", [0, 0, -size * 0.5], [0, -size * 0.05, -size * 0.9], size * 0.006);
  for (let i = 0; i < 5; i += 1) {
    const wave = Math.sin(t * 6 - i) * size * 0.03;
    cap(kit, "banner", i % 2 === 0 ? "accent" : "alt", [wave, -size * 0.05, -size * (0.92 + i * 0.22)], [wave, -size * 0.05, -size * (1.12 + i * 0.22)], size * 0.09, 0.08, [1, 0, 0]);
  }
}

function saucer(kit: Kit, size: number, t: number): void {
  ball(kit, "disc", "coat", [0, 0, 0], size * 0.5, 0.22);
  ball(kit, "rim", "alt", [0, -size * 0.04, 0], size * 0.56, 0.08);
  ball(kit, "dome", "glow", [0, size * 0.12, 0], size * 0.2, 0.8);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + t * 1.5;
    if (Math.sin(t * 5 + i) > -0.2) ball(kit, "light", "accent", [Math.cos(a) * size * 0.52, -size * 0.04, Math.sin(a) * size * 0.52], size * 0.04);
  }
}

function balloonShape(kit: Kit, size: number): void {
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    cap(kit, "gore", i % 2 === 0 ? "coat" : "alt", [Math.cos(a) * size * 0.2, size * 0.75, Math.sin(a) * size * 0.2], [Math.cos(a) * size * 0.14, size * 0.25, Math.sin(a) * size * 0.14], size * 0.27);
  }
  ball(kit, "envelope", "belly", [0, size * 0.55, 0], size * 0.4);
  for (const x of [-1, 1]) cap(kit, "rope", "dark", [x * size * 0.12, size * 0.12, 0], [x * size * 0.06, -size * 0.22, 0], size * 0.006);
  ball(kit, "basket", "dark", [0, -size * 0.27, 0], size * 0.07, 0.8);
  ball(kit, "flame", "glow", [0, -size * 0.1, 0], size * 0.04);
}

function helicopter(kit: Kit, size: number, t: number): void {
  ball(kit, "cabin", "coat", [0, 0, size * 0.1], size * 0.22, 0.9);
  ball(kit, "window", "accent", [0, size * 0.05, size * 0.22], size * 0.13, 0.7);
  cap(kit, "boom", "coat", [0, size * 0.03, -size * 0.08], [0, size * 0.09, -size * 0.66], size * 0.05);
  cap(kit, "fin", "alt", [0, size * 0.08, -size * 0.62], [0, size * 0.24, -size * 0.7], size * 0.04, 0.25, [1, 0, 0]);
  cap(kit, "mast", "dark", [0, size * 0.18, size * 0.06], [0, size * 0.28, size * 0.06], size * 0.025);
  for (let blade = 0; blade < 2; blade += 1) {
    const a = t * 31 + blade * (Math.PI / 2);
    const d: Vec = [Math.cos(a) * size * 0.68, 0, Math.sin(a) * size * 0.68];
    cap(kit, "blade", "dark", add([0, size * 0.29, size * 0.06], d), sub([0, size * 0.29, size * 0.06], d), size * 0.022, 0.3);
  }
  const tail = t * 40;
  cap(kit, "tail-rotor", "dark", [size * 0.03, size * 0.09 + Math.cos(tail) * size * 0.1, -size * 0.66 + Math.sin(tail) * size * 0.1], [size * 0.03, size * 0.09 - Math.cos(tail) * size * 0.1, -size * 0.66 - Math.sin(tail) * size * 0.1], size * 0.012);
  for (const x of [-1, 1]) cap(kit, "skid", "dark", [x * size * 0.14, -size * 0.25, -size * 0.12], [x * size * 0.14, -size * 0.25, size * 0.26], size * 0.016);
  beacon(kit, [0, -size * 0.2, 0], size * 0.03, t);
}

function blimp(kit: Kit, size: number, t: number): void {
  cap(kit, "envelope", "coat", [0, 0, -size * 0.3], [0, 0, size * 0.3], size * 0.18);
  cap(kit, "band", "alt", [0, 0, -size * 0.04], [0, 0, size * 0.04], size * 0.185);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    cap(kit, "fin", "alt", [x * size * 0.08, y * size * 0.08, -size * 0.38], [x * size * 0.2, y * size * 0.2, -size * 0.47], size * 0.05, 0.2, x === 0 ? [1, 0, 0] : UP);
  }
  ball(kit, "gondola", "dark", [0, -size * 0.2, size * 0.05], size * 0.06, 0.7);
  for (let i = 0; i < 3; i += 1) ball(kit, "window", "glow", [size * 0.04, -size * 0.2, size * (i * 0.04 - 0.01)], size * 0.012);
  beacon(kit, [0, size * 0.19, 0], size * 0.015, t);
}

function kiteShape(kit: Kit, size: number, t: number): void {
  // Faces the way it looks; a diamond of two crossed sails, bows down its tail, and the long line down to the ground.
  cap(kit, "sail", "coat", [0, -size * 0.55, 0], [0, size * 0.45, 0], size * 0.26, 0.08, [0, 0, 1]);
  cap(kit, "sail", "alt", [-size * 0.32, size * 0.12, 0.01], [size * 0.32, size * 0.12, 0.01], size * 0.18, 0.08, [0, 0, 1]);
  for (let i = 0; i < 6; i += 1) ball(kit, "bow", i % 2 === 0 ? "accent" : "alt", [Math.sin(t * 3.4 - i * 0.8) * size * 0.12, -size * (0.7 + i * 0.22), -size * 0.05 * i], size * 0.05, 0.4, [0, 0, 1]);
  cap(kit, "line", "dark", [0, -size * 0.45, 0], [0, -9, -7], 0.008);
}

function satellite(kit: Kit, size: number, t: number): void {
  // Far off it is a steady point of light, now and then flaring as its panels catch the sun.
  const flare = Math.max(0, Math.sin(t * 0.7) - 0.9) * 10;
  ball(kit, "light", "glow", [0, 0, 0], size * (0.3 + flare * 0.5));
  for (const x of [-1, 1]) cap(kit, "panel", "alt", [x * size * 0.3, 0, 0], [x * size * 0.9, 0, 0], size * 0.16, 0.1, [0, 0, 1]);
}

function rocket(kit: Kit, size: number, t: number): void {
  cap(kit, "hull", "coat", [0, 0, -size * 0.35], [0, 0, size * 0.3], size * 0.09);
  ball(kit, "nose", "accent", [0, 0, size * 0.38], size * 0.08, 0.9);
  for (const a of [0, 2.1, 4.2]) cap(kit, "fin", "alt", [0, 0, -size * 0.25], [Math.cos(a) * size * 0.18, Math.sin(a) * size * 0.18, -size * 0.4], size * 0.03, 0.25);
  ball(kit, "flame", "glow", [0, 0, -size * (0.48 + 0.04 * Math.sin(t * 40))], size * 0.1, 0.7);
  for (let i = 1; i <= 9; i += 1) ball(kit, "smoke", "belly", [Math.sin(t * 2 + i) * size * 0.04 * i, 0, -size * (0.55 + i * 0.4)], size * (0.08 + i * 0.03), 0.9);
}

function comet(kit: Kit, size: number): void {
  // A bright head and a tail of light streaming back along its path.
  ball(kit, "head", "glow", [0, 0, 0], size * 0.22);
  for (let i = 1; i <= 10; i += 1) ball(kit, "tail", "glow", [0, 0, -size * i * 0.6], size * 0.2 * (1 - i / 12));
}

const PLANE_SIZE: Readonly<Record<PlaneKind, number>> = { airliner: 3.4, prop: 1.6, jet: 2.4, ufo: 2.6, balloon: 3, helicopter: 1.8, blimp: 7, kite: 0.9, satellite: 1.4, rocket: 4, comet: 2.2 };

const PLANE_SHAPES: Readonly<Record<PlaneKind, (kit: Kit, size: number, t: number) => void>> = {
  airliner: (kit, size, t) => { airliner(kit, size, false, t); },
  prop: (kit, size, t) => { airliner(kit, size, true, t); banner(kit, size, t); },
  jet: (kit, size, t) => {
    airliner(kit, size, false, t);
    for (let i = 1; i <= 10; i += 1) ball(kit, "contrail", "glow", [0, 0, -size * (0.5 + i * 0.45)], size * (0.03 + i * 0.012), 0.9);
  },
  ufo: saucer,
  balloon: (kit, size) => { balloonShape(kit, size); },
  helicopter,
  blimp,
  kite: kiteShape,
  satellite,
  rocket,
  comet: (kit, size) => { comet(kit, size); },
};
const PLANE_DRIFT: Partial<Record<PlaneKind, (t: number) => Vec>> = {
  ufo: (t) => [Math.sin(t * 0.7) * 3, Math.sin(t * 1.9) * 1.2, 0],
  balloon: (t) => [0, Math.sin(t * 0.2) * 0.8, 0],
  helicopter: (t) => [0, Math.sin(t * 0.9) * 0.3, 0],
  kite: (t) => [Math.sin(t * 0.6) * 1.4 + Math.sin(t * 1.7) * 0.3, Math.sin(t * 1.1) * 0.5, 0],
};
const PLANE_LABELS: Readonly<Record<PlaneKind, string>> = {
  airliner: "Airliner", prop: "Banner plane", jet: "Jet", ufo: "Saucer", balloon: "Hot-air balloon", helicopter: "Helicopter",
  blimp: "Blimp", kite: "Kite", satellite: "Satellite", rocket: "Rocket", comet: "Shooting star",
};

function planeBody(kind: PlaneKind, pass: Pass, t: number): Body {
  const u = (t - pass.start) / (pass.end - pass.start);
  const route = unit(sub(pass.to, pass.from));
  // A kite faces back down its line toward whoever flies it.
  const dir: Vec = kind === "kite" ? unit([-pass.from[0], 0, -pass.from[2]], [0, 0, 1]) : route;
  const p = add(lerpV(pass.from, pass.to, kind === "ufo" ? smooth(u) * 0.6 + u * 0.4 : u), PLANE_DRIFT[kind]?.(t) ?? [0, 0, 0]);
  const kit: Kit = { f: frameOf(p, dir), out: [], roll: 0, pivot: [0, 0, 0] };
  PLANE_SHAPES[kind](kit, PLANE_SIZE[kind], t);
  const bright = kind === "ufo" || kind === "jet" ? 0.6 : kind === "comet" || kind === "satellite" ? 1 : 0;
  return { id: `${kind}.${String(pass.seed)}`, kind, label: PLANE_LABELS[kind], action: "fly", morph: "normal", at: p, front: dir, capsules: kit.out, palette: PLANE_LOOKS[kind], glow: bright };
}

// ---------------------------------------------------------------- the herd

export interface Herd {
  readonly cast: Cast;
  /** Every resident animal posed at `t` seconds, on this frame's stage. */
  at(t: number, stage: Stage): Body[];
  /** What is passing over at `t`: birds, bats, craft, lights; `now` says what the sky is like, so what comes fits it. */
  sky(t: number, now?: SkyNow): Body[];
  /**
   * Send animals somewhere from `t`: one by its body `id`, or everyone. They
   * drop what they are doing, go there their own way (walk, run, climb, fly)
   * and look about before carrying on. Returns the ids that went.
   */
  command(t: number, order: Order, stage: Stage): string[];
  /** The food eaten by `t`, each key reported once: take it out of the scene (tree-render's `eat`). */
  eaten(t: number): string[];
}

/** Where to send animals: a spot on the ground or a branch, for one animal (`id`) or all of them. */
export interface Order {
  readonly id?: string | undefined;
  readonly to: { readonly on: "ground"; readonly x: number; readonly z: number } | { readonly on: "perch"; readonly i: number };
}

function actorOf(member: CastMember, index: number, seed: number, centre: Place, stage: Stage, taken: readonly Spot[], pantry: Pantry): Actor {
  const rand = streamOf(seed, `fauna.actor.${index}.${member.species}`);
  const spec = speciesOf(member.species);
  const near = anchorOf(centre, stage, []).p;
  const arboreal = (spec.climbs || spec.flies) && (stage.perches?.length ?? 0) > 0 && rand() < (spec.temper.hang !== undefined || member.species === "koala" || member.species === "owl" ? 0.85 : 0.3);
  const place: Place = arboreal && spec.plan !== "bug" ? { on: "perch", i: Math.floor(rand() * 9973) } : groundSpot(rand, stage, member.size, near, member.size * 3 + 0.3, taken);
  const actor: Actor = { index, member, spec, rand, day: idleMatrix(member.species), night: idleMatrix(member.species, { night: true }), segments: [], until: 0, place, yaw: rand() * TAU, last: "stand", pos: anchorOf(place, stage, []).p, back: null, mates: [], pantry };
  stay(actor, spec.plan === "bug" ? "hover" : "stand", 0.3 + rand() * 1.5);
  return actor;
}

const COHESION: Readonly<Record<CastGroup["kind"], number>> = { solo: 0, pair: 0.22, family: 0.26, pack: 0.24, mixed: 0.3 };

function troupesOf(cast: Cast, stage: Stage, pantry: Pantry): Troupe[] {
  return cast.groups.map((group, g) => {
    const rand = streamOf(cast.seed, `fauna.troupe.${g}`);
    const first = group.members[0];
    const centre = groundSpot(rand, stage, first?.size ?? 0.3);
    const actors: Actor[] = [];
    group.members.forEach((member, i) => {
      const taken = actors.filter((actor) => actor.place.on === "ground").map((actor) => ({ p: anchorOf(actor.place, stage, []).p, size: actor.member.size }));
      actors.push(actorOf(member, i, cast.seed + g * 101, centre, stage, taken, pantry));
    });
    for (const actor of actors) actor.mates = actors;
    return { kind: group.kind, actors, rand, cohesion: COHESION[group.kind] };
  });
}

function prune(actor: Actor, t: number): void {
  let drop = 0;
  while (drop < actor.segments.length - 2 && (actor.segments[drop]?.t1 ?? t) < t - 3) drop += 1;
  if (drop > 0) actor.segments.splice(0, drop);
}

/**
 * Stop an animal at `t` so it can be sent somewhere new: a rest ends now, a
 * walk ends where it has got to, and a climb or flight (it cannot let go of a
 * trunk or stop in the air) runs out first. Everything planned after is dropped.
 */
function interrupt(actor: Actor, t: number, scene: Scene): void {
  // A meal it has not finished is left for someone else.
  for (const [key, meal] of actor.pantry) if (meal.by === actor && meal.t > t) actor.pantry.delete(key);
  const list = actor.segments;
  let index = list.length - 1;
  while (index > 0 && (list[index]?.t0 ?? 0) > t) index -= 1;
  const segment = list[index];
  if (!segment) return;
  list.length = index + 1;
  if (segment.mode === null) {
    const end = Math.max(segment.t0 + 0.05, Math.min(segment.t1, t));
    list[index] = { ...segment, t1: end };
    actor.until = end;
    actor.place = segment.to;
  } else if (segment.mode === "walk" && t < segment.t1) {
    const here = movingFrame(actor, segment, t, scene).frame.o;
    const to: Place = { on: "ground", x: here[0], z: here[2] };
    list[index] = { ...segment, t1: Math.max(segment.t0 + 0.05, t), to };
    actor.until = list[index]?.t1 ?? t;
    actor.place = to;
  } else {
    actor.until = segment.t1;
    actor.place = segment.to;
  }
  actor.last = segment.act;
}

/** A ground spot kept on the walkable ring, clear of the trunk. */
function onGround(stage: Stage, size: number, x: number, z: number): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.05, stage.radius - size * 0.8);
  const d = Math.hypot(x, z);
  const k = d < 1e-6 ? 0 : clamp(d, inner, outer) / d;
  return d < 1e-6 ? { on: "ground", x: inner, z: 0 } : { on: "ground", x: x * k, z: z * k };
}

/** How an animal crosses to a spot on the ground: down out of the tree, a hop or a flight, a walk or a run. */
function groundMove(actor: Actor, place: Place, scene: Scene): Action {
  const { spec } = actor;
  if (actor.place.on !== "ground") return spec.flies ? "fly" : "climb";
  const span = length(sub(placeTop(place, scene), placeTop(actor.place, scene)));
  if (spec.plan === "bug") return "fly";
  if (spec.plan === "bird") return birdGait(actor, span, scene.stage.radius);
  return span > scene.stage.radius * 0.6 && can(actor, "run") ? "run" : "wander";
}

/**
 * How a bird crosses the ground: a step or two it walks, a little way it
 * mostly hops (a big bird walks it), and anything farther it flies.
 */
function birdGait(actor: Actor, span: number, radius: number): Action {
  const size = actor.member.size;
  if (actor.spec.flies && span > Math.max(size * 9, radius * 0.45)) return "fly";
  if (span < size * 2.5 || size > 0.45) return "wander";
  return actor.rand() < 0.7 ? "hop" : "wander";
}

/** Go where told, the animal's own way, then look about. */
function obey(actor: Actor, to: Order["to"], scene: Scene, spot: number): void {
  const size = actor.member.size;
  const { spec } = actor;
  if (to.on === "perch" && perchCount(scene) > 0 && (spec.flies || spec.climbs)) {
    travel(actor, { on: "perch", i: roomyPerch(scene.stage, to.i + spot, size) }, spec.flies ? "fly" : "climb", scene);
  } else {
    // A branch it cannot climb: it comes to stand under it and looks up.
    const target = to.on === "perch" ? anchorOf({ on: "perch", i: to.i }, scene.stage, scene.backs).p : [to.x, 0, to.z] as Vec;
    const angle = spot * 2.4;
    const gap = spot === 0 ? 0 : size * 1.6 + 0.1;
    const place = onGround(scene.stage, size, target[0] + Math.cos(angle) * gap, target[2] + Math.sin(angle) * gap);
    travel(actor, place, groundMove(actor, place, scene), scene);
  }
  stay(actor, "look", 2 + actor.rand() * 1.5);
}

function commandTroupes(troupes: readonly Troupe[], t: number, order: Order, stage: Stage): string[] {
  const sent: string[] = [];
  troupes.forEach((troupe, g) => {
    const scene: Scene = { stage, backs: troupe.actors.map((actor) => actor.back) };
    for (const actor of troupe.actors) {
      const id = `${g}.${actor.index}`;
      if (order.id !== undefined && order.id !== id) continue;
      if (actor.spec.active === "night" && actor.spec.plan === "bug" && stage.night !== true) continue;
      interrupt(actor, t, scene);
      obey(actor, order.to, scene, sent.length);
      sent.push(id);
    }
  });
  return sent;
}

/** The scene's living cast: call `at` every frame with the stage, and `sky` for what flies over. */
export function createHerd(cast: Cast): Herd {
  let troupes: Troupe[] | null = null;
  const pantry: Pantry = new Map();
  const passes: Pass[] = [];
  const clock = { last: 0 };
  const skyRand = streamOf(cast.seed, "fauna.sky.passes");
  clock.last = -between(skyRand, [0.2, 0.8]) * cast.sky.every[0];
  const flyer = (species: SpeciesId | null, name: string): Who | null => (species ? { member: memberOf(streamOf(cast.seed, `fauna.sky.${name}`), species, speciesOf(species).coats[0]?.[0] ?? "", false, { morph: "normal" }), spec: speciesOf(species) } : null);
  const flyers = { flock: flyer(cast.sky.birds, "bird"), vee: flyer(cast.sky.vee, "vee"), swarm: flyer(cast.sky.swarm, "swarm") };
  const drawPass = (pass: Pass, t: number): Body[] => {
    if (pass.kind === "flock") return flyers.flock ? flockBodies(pass, flyers.flock, t) : [];
    if (pass.kind === "vee") return flyers.vee ? flockBodies(pass, flyers.vee, t) : [];
    if (pass.kind === "murmuration" || pass.kind === "bats") return swarmBodies(pass, pass.kind === "bats" ? null : flyers.swarm, t);
    return [planeBody(pass.kind, pass, t)];
  };
  return {
    cast,
    at(t: number, stage: Stage): Body[] {
      troupes ??= troupesOf(cast, stage, pantry);
      const out: Body[] = [];
      troupes.forEach((troupe, g) => {
        extend(troupe, t + 1, { stage, backs: troupe.actors.map((actor) => actor.back) });
        for (const actor of troupe.actors) {
          prune(actor, t);
          const m = momentOf(actor, t, { stage, backs: troupe.actors.map((a) => a.back) }, troupe.actors);
          const capsules = poseWho(actor, m);
          actor.pos = m.frame.o;
          actor.back = backOf(capsules);
          // (Fireflies are only seen when they light up, after dark.)
          if (actor.spec.active === "night" && actor.spec.plan === "bug" && stage.night !== true) continue;
          out.push(bodyOf(`${g}.${actor.index}`, actor, m, capsules, { stage, backs: troupe.actors.map((a) => a.back) }));
        }
      });
      return out;
    },
    sky(t: number, now: SkyNow = {}): Body[] {
      const reach = now.radius ?? 1;
      passesUntil(passes, clock, skyRand, cast.sky.every, t, (start) => {
        const kind = nextTraffic(skyRand, cast.sky, now);
        // A busy sky still clears between passes: never more than a few at once.
        const crowded = passes.filter((pass) => pass.end > start).length >= SKY_AT_ONCE;
        return kind && !crowded ? passOf(kind, start, skyRand, reach, cast.sky) : null;
      });
      return passes.filter((pass) => t >= pass.start && t < pass.end).flatMap((pass) => drawPass(pass, t));
    },
    command(t: number, order: Order, stage: Stage): string[] {
      troupes ??= troupesOf(cast, stage, pantry);
      return commandTroupes(troupes, t, order, stage);
    },
    eaten(t: number): string[] {
      const done: string[] = [];
      for (const [key, meal] of pantry) if (meal.t <= t) { done.push(key); pantry.delete(key); }
      return done;
    },
  };
}

/** How near a ray from `o` along unit `d` passes a segment ab, and how far along the ray that is. */
function rayToSegment(o: Vec, d: Vec, a: Vec, b: Vec): { gap: number; along: number } {
  const ab = sub(b, a);
  const ee = dot(ab, ab);
  // Project back and forth between the ray and the segment; both are convex, so it settles fast.
  let s = 0.5;
  let along = 0;
  for (let k = 0; k < 6; k += 1) {
    along = Math.max(0, dot(d, sub(madd(a, ab, s), o)));
    s = ee < 1e-12 ? 0 : clamp(dot(sub(madd(o, d, along), a), ab) / ee, 0, 1);
  }
  along = Math.max(0, dot(d, sub(madd(a, ab, s), o)));
  return { gap: length(sub(madd(o, d, along), madd(a, ab, s))), along };
}

/**
 * The body a ray from `origin` along `direction` hits first (a click picked
 * into the scene), or null. A little slack makes small animals easy to tap.
 */
export function pickBody(bodies: readonly Body[], origin: Vec, direction: Vec, slack = 1.25): { id: string; distance: number } | null {
  const d = unit(direction);
  let best: { id: string; distance: number } | null = null;
  for (const body of bodies) {
    for (const c of body.capsules) {
      const hit = rayToSegment(origin, d, c.a, c.b);
      if (hit.gap <= c.r * slack + 0.02 && (!best || hit.along < best.distance)) best = { id: body.id, distance: hit.along };
    }
  }
  return best;
}

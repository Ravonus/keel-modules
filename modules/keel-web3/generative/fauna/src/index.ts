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
export type Role = "coat" | "alt" | "belly" | "dark" | "eye" | "nose" | "accent" | "glow" | "horn" | "shell";
export type Palette = Readonly<Record<Role, string>>;

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
    temper: { sniff: 2.2, dig: 1.4, play: 1.4, stretch: 1.3, sit: 1.2, sleep: 1.2, look: 1.3 }, friends: [] }),
  deer: define({ label: "Deer", plan: "quad", size: 0.95, rarity: "uncommon", weight: 26, regions: TEMPERATE, speed: 1.1, groups: [4, 3, 4, 2], pack: [3, 4],
    build: { len: 1.15, leg: 0.68, body: 0.17, neck: 0.5, rise: 1.05, head: 0.11, snout: 0.15, ears: "point", tail: "puff", tailLen: 0.18, extras: ["antlers", "spots"] },
    coats: [["whitetail", ["#a87a4e", "#8a6038", "#f4ece0", "#2a1e16", "#f8f4ec"]], ["sika", ["#9a5e34", "#7a4422", "#f0e4d0", "#241810", "#f6efe2"]], ["fallow", ["#c8925a", "#9e6c3e", "#f6ecd8", "#2e2014", "#ffffff"]]],
    temper: { graze: 2.8, look: 1.8, groom: 1, wander: 0.8, lie: 1.2, run: 0.3 }, friends: ["rabbit", "songbird", "crow"] }),
  wolf: define({ label: "Wolf", plan: "quad", size: 0.72, rarity: "rare", weight: 10, regions: ["rockies", "alps"], speed: 1.3, groups: [3, 2, 1, 5], pack: [3, 5],
    build: { len: 1.4, leg: 0.64, body: 0.21, neck: 0.32, rise: 0.6, head: 0.16, snout: 0.22, ears: "point", tail: "bushy", tailLen: 0.8 },
    coats: [["grey", ["#7c7a74", "#4e4c48", "#e0dcd4", "#1e1c1a", "#d6d0c4"]], ["timber", ["#8a6a4a", "#4a3828", "#dcccb4", "#1c1610", "#cdb898"]], ["white", ["#e8e6e0", "#c8c4bc", "#ffffff", "#2a2826", "#ffffff"]], ["black", ["#2c2a2a", "#1a1818", "#4a4644", "#0c0a0a", "#5a5654"]]],
    temper: { howl: 2.4, sniff: 1.6, lie: 1.6, play: 1.4, look: 1.5, wander: 1 }, friends: [] }),
  bear: define({ label: "Bear", plan: "quad", size: 0.9, rarity: "rare", weight: 8, regions: ["rockies", "alps", "tokyo"], speed: 0.8, winter: false, groups: [6, 0, 3, 0],
    build: { len: 1.35, leg: 0.52, body: 0.34, neck: 0.22, rise: 0.4, head: 0.2, snout: 0.15, ears: "round", tail: "none", tailLen: 0.1, hip: 0.95 },
    coats: [["brown", ["#6a4a30", "#4a3220", "#8a6a4a", "#1a120c", "#a88a68"]], ["black", ["#262220", "#141210", "#3a3430", "#0a0808", "#b89a72"]], ["cinnamon", ["#9a6236", "#764824", "#b8865a", "#22140a", "#c8a07a"]]],
    temper: { rear: 1.6, scratch: 2, sit: 1.8, sniff: 1.4, dig: 1.3, lie: 1.4, roll: 0.8 }, friends: ["songbird"] }),
  raccoon: define({ label: "Raccoon", plan: "quad", size: 0.3, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "tokyo"], worlds: ["nature", "voxel", "city"], speed: 1.1, active: "any", climbs: true, groups: [5, 2, 3, 0],
    build: { len: 1.3, leg: 0.55, body: 0.3, neck: 0.2, rise: 0.6, head: 0.2, snout: 0.16, ears: "round", tail: "ring", tailLen: 0.9, hip: 1.08, extras: ["mask"] },
    coats: [["raccoon", ["#8a8682", "#5a5652", "#c8c4bc", "#1e1c1a", "#e8e4dc"]], ["tanuki", ["#8a6c4a", "#4a3828", "#b89a78", "#1a120c", "#d8c4a4"]]],
    temper: { dig: 1.8, sniff: 1.8, rear: 1.4, eat: 1.6, climb: 1.2, groom: 1.2 }, friends: ["cat"] }),
  cat: define({ label: "Cat", plan: "quad", size: 0.24, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1, active: "any", climbs: true, groups: [8, 2, 2, 0],
    build: { len: 1.5, leg: 0.6, body: 0.24, neck: 0.24, rise: 0.7, head: 0.21, snout: 0.08, ears: "point", tail: "thin", tailLen: 1.2 },
    coats: [["tabby", ["#b07a44", "#7a4e26", "#efe0c8", "#2a1a10", "#f0a0a0"]], ["black", ["#1e1c1e", "#121012", "#2a282a", "#060606", "#f0c040"]], ["calico", ["#f2ece2", "#d0782e", "#ffffff", "#2a2420", "#f0a0a0"]], ["grey", ["#8a8c94", "#5e6068", "#d8dadf", "#202226", "#f0a0b0"]]],
    temper: { groom: 2.4, sit: 2, sleep: 1.8, stretch: 1.6, look: 1.4, play: 1.1, yawn: 1.4, climb: 0.8 }, friends: ["raccoon", "crow"] }),
  hedgehog: define({ label: "Hedgehog", plan: "quad", size: 0.11, rarity: "uncommon", weight: 14, regions: ["atlantic", "alps"], speed: 0.9, active: "any", winter: false,
    build: { len: 1.2, leg: 0.25, body: 0.55, neck: 0.08, rise: 0.1, head: 0.28, snout: 0.38, ears: "round", tail: "none", tailLen: 0.1, hip: 1, extras: ["quills"] },
    coats: [["brown", ["#6a5240", "#3a2a1e", "#c8b098", "#140e0a", "#d8c8b0"]], ["blond", ["#b8a080", "#806a50", "#efe4d4", "#2a2018", "#f0e8d8"]]],
    temper: { sniff: 2.6, dig: 1.6, coil: 1.2, wander: 1.4, sleep: 1 }, friends: [] }),
  mouse: define({ label: "Field mouse", plan: "quad", size: 0.07, rarity: "common", weight: 30, regions: ALL_REGIONS, speed: 2.4, active: "any", groups: [5, 2, 2, 2], pack: [3, 4],
    build: { len: 1.4, leg: 0.42, body: 0.36, neck: 0.12, rise: 0.4, head: 0.24, snout: 0.2, ears: "round", tail: "thin", tailLen: 1.4, hip: 1.1 },
    coats: [["field", ["#9a7a58", "#6a5038", "#efe2cc", "#1a120c", "#f0a8a8"]], ["grey", ["#7c7a78", "#55524f", "#d8d4cc", "#141210", "#f0a8a8"]]],
    temper: { sniff: 2.4, eat: 2, groom: 1.6, rear: 1.4, run: 1.4, wander: 1.2 }, friends: [] }),
  capybara: define({ label: "Capybara", plan: "quad", size: 0.5, rarity: "rare", weight: 9, regions: ["tokyo", "bali"], worlds: ["nature", "beach", "voxel"], speed: 0.6, groups: [3, 3, 3, 2], pack: [3, 4],
    build: { len: 1.5, leg: 0.42, body: 0.36, neck: 0.18, rise: 0.4, head: 0.22, snout: 0.26, ears: "round", tail: "none", tailLen: 0.05 },
    coats: [["capybara", ["#9a6c42", "#764e2c", "#a87c52", "#20140c", "#b88c62"]]],
    temper: { lie: 2.6, graze: 2, sit: 1.6, sleep: 1.6, look: 0.6, wander: 0.5 }, friends: ["songbird", "parrot", "monkey"] }),
  kangaroo: define({ label: "Kangaroo", plan: "quad", size: 0.9, rarity: "rare", weight: 14, regions: ["sydney"], speed: 1.8, groups: [3, 2, 4, 2], pack: [3, 4],
    build: { len: 1, leg: 0.7, body: 0.24, neck: 0.22, rise: 1.2, head: 0.13, snout: 0.16, ears: "long", tail: "thick", tailLen: 1.1, hip: 0.75, extras: ["pouch"] },
    coats: [["red", ["#b06a3e", "#8a4e2a", "#e4cdb0", "#2a1a10", "#d8b898"]], ["grey", ["#8a8278", "#5e564e", "#d8d0c4", "#1e1a16", "#c8bcae"]]],
    temper: { graze: 1.8, rear: 2.6, groom: 1.2, hop: 2, look: 1.4, lie: 1 }, friends: [] }),
  tortoise: define({ label: "Tortoise", plan: "quad", size: 0.16, rarity: "rare", weight: 10, regions: ["nairobi", "bali", "sydney"], worlds: ["nature", "beach", "voxel"], speed: 0.25, winter: false,
    build: { len: 1.6, leg: 0.36, body: 0.42, neck: 0.36, rise: 0.4, head: 0.17, snout: 0.08, ears: "none", tail: "none", tailLen: 0.1, extras: ["shell"] },
    coats: [["leopard", ["#8a7a5a", "#5a4a32", "#c8b88e", "#1a1408", "#3a3020"]], ["star", ["#6a5a3a", "#2a2010", "#c8a860", "#141008", "#e8c870"]]],
    temper: { graze: 2.4, bask: 2.6, sleep: 1.2, look: 0.6, wander: 0.8 }, friends: ["songbird", "crab"] }),
  meerkat: define({ label: "Meerkat", plan: "quad", size: 0.22, rarity: "rare", weight: 12, regions: ["nairobi"], speed: 1.8, groups: [1, 2, 3, 6], pack: [3, 6],
    build: { len: 1.2, leg: 0.5, body: 0.24, neck: 0.22, rise: 0.8, head: 0.2, snout: 0.18, ears: "round", tail: "thin", tailLen: 0.9, hip: 1, extras: ["mask"] },
    coats: [["meerkat", ["#b8966c", "#8a6c48", "#d8c4a4", "#1a120a", "#e8d8bc"]]],
    temper: { rear: 3.2, look: 2.4, dig: 2, groom: 1.4, bask: 1.2, run: 1 }, friends: [] }),
  squirrel: define({ label: "Squirrel", plan: "quad", size: 0.12, rarity: "common", weight: 60, regions: TEMPERATE, worlds: ["nature", "voxel", "crystal", "city"], speed: 2.2, climbs: true, groups: [6, 3, 1, 1], pack: [3, 3],
    build: { len: 1.3, leg: 0.5, body: 0.3, neck: 0.14, rise: 0.8, head: 0.25, snout: 0.12, ears: "tuft", tail: "curl", tailLen: 1.25, hip: 1.12 },
    coats: [["red", ["#b8582a", "#8a3e1a", "#f0e4d4", "#24140a", "#f4ece0"]], ["grey", ["#86827c", "#5e5a54", "#e8e4dc", "#1c1a18", "#efe8de"]], ["black", ["#2a2624", "#181614", "#4a4440", "#0a0808", "#4a4440"]]],
    temper: { eat: 2.6, climb: 2.6, rear: 1.6, dig: 1.4, look: 1.4, run: 1.4, play: 1.4 }, friends: ["songbird", "woodpecker"] }),
  redpanda: define({ label: "Red panda", plan: "quad", size: 0.28, rarity: "epic", weight: 5, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [6, 2, 2, 0],
    build: { len: 1.4, leg: 0.5, body: 0.3, neck: 0.18, rise: 0.6, head: 0.24, snout: 0.12, ears: "point", tail: "ring", tailLen: 1.2, hip: 1.05, extras: ["mask", "cheeks"] },
    coats: [["red panda", ["#b84a1e", "#5a2210", "#1e1210", "#140a06", "#f4ece0"]]],
    temper: { climb: 2.4, eat: 2, sleep: 1.8, groom: 1.4, stretch: 1.2, rear: 1.2 }, friends: [] }),
  koala: define({ label: "Koala", plan: "quad", size: 0.3, rarity: "epic", weight: 7, regions: ["sydney"], speed: 0.4, climbs: true, groups: [7, 1, 3, 0],
    build: { len: 0.9, leg: 0.5, body: 0.38, neck: 0.1, rise: 1, head: 0.32, snout: 0.1, ears: "round", tail: "none", tailLen: 0.05, hip: 1, extras: ["bignose"] },
    coats: [["koala", ["#8a8a8e", "#5e5e62", "#e8e6e2", "#1a1a1c", "#2a2a2c"]]],
    temper: { sleep: 3.4, eat: 2.2, climb: 1.4, look: 0.6, wander: 0.2, scratch: 1.2 }, friends: [] }),
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
  crow: define({ label: "Crow", plan: "bird", size: 0.24, rarity: "common", weight: 34, regions: ALL_REGIONS, worlds: ["nature", "voxel", "city", "synth", "crystal"], speed: 1.2, active: "any", groups: [5, 3, 1, 3], pack: [3, 5],
    build: { len: 1.15, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.3, head: 0.15, snout: 0.2, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["crow", ["#1a1c22", "#0e1014", "#262830", "#060608", "#3a3c44"]], ["hooded", ["#8a8a8e", "#1a1a1e", "#9a9a9e", "#0a0a0c", "#2a2a2e"]]],
    temper: { peck: 2.4, look: 2, hop: 1.6, flap: 1.2, sing: 0.8, fly: 1.4 }, friends: ["deer", "cat"] }),
  owl: define({ label: "Owl", plan: "bird", size: 0.3, rarity: "rare", weight: 10, regions: ["rockies", "atlantic", "alps", "tokyo", "nairobi"], worlds: ["nature", "voxel", "crystal", "city"], speed: 0.8, active: "night", groups: [8, 2, 2, 0],
    build: { len: 0.9, leg: 0.16, body: 0.32, neck: 0.04, rise: 1.2, head: 0.27, snout: 0.06, ears: "tuft", tail: "fan", tailLen: 0.3 },
    coats: [["barn", ["#d8b078", "#a8804a", "#f6eee0", "#2a1e10", "#f4ead8"]], ["great horned", ["#7a6248", "#4a3a28", "#c8b494", "#1a120a", "#f0d050"]], ["snowy", ["#f4f4f0", "#c8c8c4", "#ffffff", "#2a2a2a", "#f0d040"]]],
    temper: { look: 3, preen: 1.6, sleep: 2, flap: 0.8, fly: 0.8 }, friends: [] }),
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
    temper: { display: 3, peck: 1.8, look: 1.4, preen: 1.2, wander: 1 }, friends: [] }),
  crane: define({ label: "Crane", plan: "bird", size: 0.85, rarity: "epic", weight: 6, regions: ["tokyo", "nairobi"], speed: 0.8, groups: [3, 6, 2, 0],
    build: { len: 0.85, leg: 0.55, body: 0.16, neck: 0.55, rise: 1.2, head: 0.07, snout: 0.16, ears: "none", tail: "fan", tailLen: 0.3, extras: ["longneck", "crown"] },
    coats: [["red-crowned", ["#f6f6f2", "#1a1a1a", "#ffffff", "#141414", "#e02828"]], ["grey crowned", ["#8a9098", "#f4f4f0", "#a0a6ae", "#141414", "#e8c040"]]],
    temper: { display: 2.2, peck: 2, preen: 1.6, look: 1.4, flap: 1.2 }, friends: [] }),
  woodpecker: define({ label: "Woodpecker", plan: "bird", size: 0.18, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "alps", "tokyo"], speed: 1, groups: [8, 2, 1, 0],
    build: { len: 1.1, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.6, head: 0.15, snout: 0.22, ears: "none", tail: "fan", tailLen: 0.5, extras: ["crest"] },
    coats: [["downy", ["#1e1e20", "#f4f4f0", "#f4f4f0", "#0e0e10", "#e02828"]], ["green", ["#6a8a3a", "#4a6a2a", "#c8d098", "#1a1a10", "#e02828"]]],
    temper: { drum: 4, look: 1.2, preen: 1, fly: 1.2 }, friends: ["squirrel"] }),
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
  crab: { stand: 1, wave: 0.8, dig: 0.6, look: 0.6, wander: 1.4 },
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
  for (const [action, weight] of Object.entries(spec.temper) as [Action, number][]) if (weight > 0) out.add(action);
  if (!spec.climbs && spec.plan !== "bird") { out.delete("climb"); out.delete("hang"); }
  if (!spec.flies) out.delete("fly");
  return [...out];
}

function columnWeight(spec: SpeciesSpec, action: Action, night: boolean): number {
  const base = PLAN_ACTIONS[spec.plan][action] ?? 0.6;
  const temper = spec.temper[action] ?? 1;
  const asleepNow = spec.active !== "any" && (spec.active === "day") === night;
  if (!asleepNow) return base * temper;
  const drowsy: Partial<Record<Action, number>> = { sleep: 8, lie: 3, sit: 2, hang: 3, coil: 3 };
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

export interface Perch {
  /** Where on the branch. */
  readonly p: Vec;
  /** Along the branch, outward. */
  readonly d: Vec;
  readonly r: number;
}

/** What the scene gives the animals each frame: the ground they walk, the trunk they climb, the branches they sit in. */
export interface Stage {
  /** Walkable radius of the ground around the origin. */
  readonly radius: number;
  /** Height of the ground. */
  readonly top: number;
  /** The ground's height at a point, when it isn't flat. */
  readonly ground?: ((x: number, z: number) => number) | undefined;
  readonly trunk?: { readonly base: Vec; readonly top: Vec; readonly r: number } | null | undefined;
  readonly perches?: readonly Perch[] | undefined;
  readonly night?: boolean | undefined;
}

interface Anchor { readonly p: Vec; readonly up: Vec; readonly along: Vec | null }

const groundY = (stage: Stage, x: number, z: number): number => stage.ground?.(x, z) ?? stage.top;
const perchOf = (stage: Stage, i: number): Perch | undefined => {
  const list = stage.perches ?? [];
  return list.length > 0 ? list[((i % list.length) + list.length) % list.length] : undefined;
};
const trunkR = (stage: Stage): number => stage.trunk?.r ?? 0;

function trunkPoint(stage: Stage, h: number, a: number): Anchor {
  const trunk = stage.trunk;
  if (!trunk) return { p: [Math.cos(a) * 0.2, stage.top, Math.sin(a) * 0.2], up: UP, along: null };
  const out: Vec = [Math.cos(a), 0, Math.sin(a)];
  const axis = lerpV(trunk.base, trunk.top, clamp(h, 0, 1));
  return { p: madd(axis, out, trunk.r * (1 - 0.35 * h)), up: out, along: null };
}

/** Where a place is in the world this frame. */
function anchorOf(place: Place, stage: Stage, backs: readonly (Anchor | null)[]): Anchor {
  if (place.on === "ground") return { p: [place.x, groundY(stage, place.x, place.z), place.z], up: UP, along: null };
  if (place.on === "trunk") return trunkPoint(stage, place.h, place.a);
  if (place.on === "back") return backs[place.m] ?? { p: [0, stage.top, 0], up: UP, along: null };
  const perch = perchOf(stage, place.i);
  if (!perch) return { p: [trunkR(stage) + 0.3, stage.top, 0], up: UP, along: null };
  return { p: add(perch.p, [0, perch.r, 0]), up: UP, along: perch.d };
}

/** A free spot on the ground, clear of the trunk and the rim. */
function groundSpot(rand: () => number, stage: Stage, size: number, near?: Vec, reach = 0): Place {
  const inner = trunkR(stage) + size * 0.9 + 0.15;
  const outer = Math.max(inner + 0.2, stage.radius - size * 0.8);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const a = rand() * TAU;
    const r = near ? reach * Math.sqrt(rand()) : mix(inner, outer, Math.sqrt(rand()));
    const x = (near?.[0] ?? 0) + Math.cos(a) * r;
    const z = (near?.[2] ?? 0) + Math.sin(a) * r;
    const d = Math.hypot(x, z);
    if (d >= inner && d <= outer) return { on: "ground", x, z };
  }
  const a = rand() * TAU;
  const r = mix(inner, outer, 0.5);
  return { on: "ground", x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// ---------------------------------------------------------------- paths

interface PathPoint { readonly p: Vec; readonly up: Vec }

/** Push a point on the ground out of the trunk's way. */
function clearOfTrunk(stage: Stage, p: Vec, size: number): Vec {
  const clear = trunkR(stage) + size * 0.8 + 0.1;
  const d = Math.hypot(p[0], p[2]);
  if (d >= clear || d < 1e-6) return p;
  const k = clear / d;
  return [p[0] * k, groundY(stage, p[0] * k, p[2] * k), p[2] * k];
}

function walkPath(a: Anchor, b: Anchor, stage: Stage, size: number): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 0; i <= 8; i += 1) out.push({ p: clearOfTrunk(stage, lerpV(a.p, b.p, i / 8), size), up: UP });
  return out;
}

function flyPath(a: Anchor, b: Anchor): PathPoint[] {
  const span = length(sub(b.p, a.p));
  const top = add(lerpV(a.p, b.p, 0.5), [0, 0.4 + span * 0.35, 0]);
  const out: PathPoint[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const u = i / 12;
    out.push({ p: add(add(scale(a.p, (1 - u) * (1 - u)), scale(top, 2 * u * (1 - u))), scale(b.p, u * u)), up: UP });
  }
  return out;
}

/** The height on the trunk and the side of it a place is reached by. */
function trunkFoot(place: Place, a: Anchor, stage: Stage): { h: number; a: number } {
  if (place.on === "trunk") return { h: place.h, a: place.a };
  const trunk = stage.trunk;
  const side = Math.atan2(a.p[2], a.p[0]);
  if (!trunk || place.on === "ground") return { h: 0, a: side };
  const h = (a.p[1] - trunk.base[1]) / Math.max(0.01, trunk.top[1] - trunk.base[1]);
  return { h: clamp(h, 0, 1), a: side };
}

/** Over the ground to the trunk, up (or down) the trunk, out along the branch: a climber's way between two places. */
function climbPath(from: Place, to: Place, a: Anchor, b: Anchor, stage: Stage, size: number): PathPoint[] {
  if (!stage.trunk || (from.on === "ground" && to.on === "ground")) return walkPath(a, b, stage, size);
  const f = trunkFoot(from, a, stage);
  const t = trunkFoot(to, b, stage);
  const out: PathPoint[] = [{ p: a.p, up: a.up }];
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const point = trunkPoint(stage, mix(f.h, t.h, u), mix(f.a, t.a + Math.round((f.a - t.a) / TAU) * TAU, u));
    out.push({ p: point.p, up: point.up });
  }
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
}

interface Troupe {
  readonly kind: CastGroup["kind"];
  readonly actors: Actor[];
  readonly rand: () => number;
  readonly cohesion: number;
}

interface Scene { readonly stage: Stage; readonly backs: readonly (Anchor | null)[] }

const tempo = (actor: Actor): number => (actor.spec.speed < 0.5 ? 1.8 : 1);
const placeTop = (place: Place, scene: Scene): Vec => anchorOf(place, scene.stage, scene.backs).p;

function stay(actor: Actor, act: Action, duration: number, face = -1, yaw = actor.yaw): void {
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to: actor.place, yaw, face, mode: null, pace: 0 });
  actor.until = t0 + duration;
  actor.last = act;
}

function modeFor(actor: Actor, act: Action, from: Place, to: Place): MoveMode {
  if (actor.spec.flies && (act === "fly" || actor.spec.plan === "bug")) return "fly";
  if (actor.spec.flies && (from.on !== "ground" || to.on !== "ground")) return "fly";
  if (from.on !== "ground" || to.on !== "ground") return "climb";
  return "walk";
}

function pathFor(mode: MoveMode, from: Place, to: Place, scene: Scene, size: number): PathPoint[] {
  const a = anchorOf(from, scene.stage, scene.backs);
  const b = anchorOf(to, scene.stage, scene.backs);
  if (mode === "fly") return flyPath(a, b);
  if (mode === "climb") return climbPath(from, to, a, b, scene.stage, size);
  return walkPath(a, b, scene.stage, size);
}

const PACE: Partial<Record<Action, number>> = { run: 3.2, hop: 1.4, fly: 4, climb: 0.8 };

/** Go somewhere: a move segment whose length (and so its time) comes from the path. */
function travel(actor: Actor, to: Place, act: Action, scene: Scene, hurry = 1): void {
  const mode = modeFor(actor, act, actor.place, to);
  const path = pathFor(mode, actor.place, to, scene, actor.member.size);
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
const randomPerch = (actor: Actor): Place => ({ on: "perch", i: Math.floor(actor.rand() * 9973) });

/** Where a move action takes this animal from where it is. */
function destination(actor: Actor, act: Action, scene: Scene): Place | null {
  const size = actor.member.size;
  const up = actor.place.on !== "ground";
  const perches = perchCount(scene) > 0;
  const perchOr = (odds: number): Place => (perches && actor.rand() < odds ? randomPerch(actor) : groundSpot(actor.rand, scene.stage, size));
  if (act === "climb") return perches ? perchOr(up ? 0.55 : 1) : null;
  if (act === "fly" || actor.spec.plan === "bug") return perchOr(0.55);
  if (up) return perchOr(actor.spec.climbs ? 0.5 : 0);
  const reach = act === "run" ? scene.stage.radius : Math.max(size * 4, 0.8);
  return groundSpot(actor.rand, scene.stage, size, placeTop(actor.place, scene), reach);
}

/** Get to where an action can be done: down from the tree, up to a branch, onto the trunk. */
function prepare(actor: Actor, act: Action, scene: Scene): Action {
  const size = actor.member.size;
  if (GROUNDED.has(act) && actor.place.on !== "ground") {
    travel(actor, groundSpot(actor.rand, scene.stage, size), actor.spec.flies ? "fly" : "climb", scene);
    return act;
  }
  if (act === "hang") {
    if (perchCount(scene) === 0) return "sit";
    if (actor.place.on !== "perch") travel(actor, randomPerch(actor), "climb", scene);
    return act;
  }
  if (act === "drum" && actor.place.on !== "trunk") {
    if (!scene.stage.trunk) return "look";
    travel(actor, { on: "trunk", h: 0.25 + actor.rand() * 0.5, a: actor.rand() * TAU }, "fly", scene);
  }
  return act;
}

/** One link of an animal's own chain of idle actions. */
function soloStep(actor: Actor, scene: Scene): void {
  const matrix = scene.stage.night === true ? actor.night : actor.day;
  const act = nextAction(matrix, actor.last, actor.rand);
  if (MOVES.has(act)) {
    const to = destination(actor, act, scene);
    if (to) { travel(actor, to, act, scene); return; }
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
    if (actor.place.on !== "ground") travel(actor, groundSpot(actor.rand, scene.stage, actor.member.size), actor.spec.flies ? "fly" : "climb", scene);
  }
}

const placeBeside = (target: Vec, yaw: number, side: number, gap: number): Place => ({ on: "ground", x: target[0] + Math.cos(yaw) * side * gap, z: target[2] - Math.sin(yaw) * side * gap });
const yawFrom = (a: Vec, b: Vec): number => Math.atan2(b[0] - a[0], b[2] - a[2]);

// ---------------------------------------------------------------- joint scenes

/** Hold an actor in one action until `time`. */
function holdAs(actor: Actor, act: Action, time: number, face = -1): void {
  if (actor.until < time - 0.02) stay(actor, act, time - actor.until, face);
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
  stay(a, "groom", length, b.index);
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
  const gap = (a.member.size * a.spec.build.len + b.member.size * b.spec.build.len) * 0.42 + 0.04;
  travel(a, { on: "ground", x: mid[0] - dir[0] * gap, z: mid[2] - dir[2] * gap }, "wander", scene);
  travel(b, { on: "ground", x: mid[0] + dir[0] * gap, z: mid[2] + dir[2] * gap }, "wander", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b.index);
  holdAs(b, "look", start, a.index);
  const length = between(troupe.rand, SPAN.nuzzle);
  stay(a, "nuzzle", length, b.index);
  stay(b, "nuzzle", length, a.index);
  return true;
}

/** A chase: one runs a loop, the other runs after it; then a play bow. */
function chaseScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(walkers(troupe).filter((actor) => actor.spec.speed >= 0.8), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const stops = [0, 1, 2].map(() => groundSpot(troupe.rand, scene.stage, a.member.size));
  stay(b, "play", 0.7, a.index);
  for (const stop of stops) { travel(a, stop, "run", scene); travel(b, stop, "run", scene, 1.05); }
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b.index);
  holdAs(b, "look", start, a.index);
  stay(a, "play", 1.8, b.index);
  stay(b, "play", 1.8, a.index);
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
  sleepers.forEach((actor, i) => {
    const a = (i / sleepers.length) * TAU + troupe.rand() * 0.4;
    const r = actor.member.size * actor.spec.build.len * 0.55;
    travel(actor, { on: "ground", x: centre[0] + Math.cos(a) * r, z: centre[2] + Math.sin(a) * r }, "wander", scene);
  });
  const start = Math.max(...sleepers.map((actor) => actor.until));
  const length = between(troupe.rand, [16, 34]);
  for (const actor of sleepers) { holdAs(actor, "lie", start); stay(actor, scene.stage.night === true ? "sleep" : "lie", length); }
  return true;
}

/** Two birds face each other and dance (a crane's leaping, a peacock's fan). */
function danceScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => can(actor, "display")), troupe.rand);
  if (!pair) return false;
  const [a, b] = pair;
  begin(pair, scene);
  const pa = placeTop(a.place, scene);
  const gap = (a.member.size + b.member.size) * 0.7;
  const yaw = troupe.rand() * TAU;
  travel(b, { on: "ground", x: pa[0] + Math.sin(yaw) * gap, z: pa[2] + Math.cos(yaw) * gap }, "wander", scene);
  holdAs(a, "look", b.until, b.index);
  const length = between(troupe.rand, SPAN.display);
  stay(a, "display", length, b.index);
  stay(b, a.member.species === "peacock" ? "peck" : "display", length, a.index);
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
  holdAs(parent, "look", young.until, young.index);
  const length = between(troupe.rand, [5, 10]);
  const bird = parent.spec.plan === "bird";
  stay(parent, bird ? "peck" : can(parent, "graze") ? "graze" : "groom", length, bird ? young.index : -1);
  stay(young, bird ? "flap" : "nuzzle", length, parent.index);
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
  stay(b, "look", 0.8, a.index);
  travel(b, { on: "perch", i: i + 1 }, "climb", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "sit", start);
  const length = between(troupe.rand, [6, 12]);
  stay(a, can(a, "eat") ? "eat" : "sit", length);
  stay(b, can(b, "groom") ? "groom" : "sit", length, a.index);
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
  groom: (tl) => ({ curl: 0.5, sit: 0.35, headYaw: 1.45, headPitch: -0.5 + 0.15 * Math.sin(tl * 8), reach: 1, hand: Math.sin(tl * 3) }),
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

function movingFrame(actor: Actor, segment: Segment, t: number, scene: Scene): { frame: Frame; phase: number; moving: number } {
  const mode = segment.mode ?? "walk";
  const path = pathFor(mode, segment.from, segment.to, scene, actor.member.size);
  const d = Math.max(0.01, segment.t1 - segment.t0);
  const u = clamp((t - segment.t0) / d, 0, 1);
  const at = alongPath(path, 0.75 * u + 0.25 * smooth(u));
  const onTrunk = mode === "climb" && Math.abs(at.up[1]) < 0.6;
  const fw = mode === "fly" || onTrunk ? at.fw : flat(at.fw);
  const stride = actor.member.size * Math.max(0.5, actor.spec.build.len) * 1.1;
  const moving = Math.min(1, (t - segment.t0) / 0.25, (segment.t1 - t) / 0.25);
  return { frame: frameOf(at.p, fw, mode === "fly" ? UP : at.up), phase: at.travelled / stride, moving: clamp(moving, 0, 1) };
}

function restingFrame(actor: Actor, segment: Segment, t: number, scene: Scene, partners: readonly Actor[]): Frame {
  const anchor = anchorOf(segment.to, scene.stage, scene.backs);
  if (segment.to.on === "trunk") {
    return segment.act === "drum" || actor.spec.plan === "bird" ? frameOf(madd(anchor.p, anchor.up, actor.member.size * 0.15), scale(anchor.up, -1), UP) : frameOf(anchor.p, UP, anchor.up);
  }
  let yaw = anchor.along ? Math.atan2(anchor.along[0], anchor.along[2]) : segment.yaw;
  const partner = segment.face >= 0 ? partners[segment.face] : undefined;
  if (partner) yaw = turnToward(segment.yaw, yawFrom(anchor.p, partner.pos), smooth((t - segment.t0) / 0.6));
  return frameOf(anchor.p, dirOf(yaw, 0), anchor.up);
}

function momentOf(actor: Actor, t: number, scene: Scene, partners: readonly Actor[]): Moment {
  const { segment, prev } = segmentAt(actor, t);
  const pose = blendedPose(segment, prev, t);
  if (segment.mode) {
    const { frame, phase, moving } = movingFrame(actor, segment, t, scene);
    return { frame, phase, moving, pace: segment.pace, mode: segment.mode, segment, pose, t };
  }
  return { frame: restingFrame(actor, segment, t, scene, partners), phase: 0, moving: 0, pace: 0, mode: null, segment, pose, t };
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
  if (!(r > 0.0005)) return;
  const upRolled = kit.roll === 0 ? up : rollV(up, kit.roll);
  kit.out.push({ a: toWorld(kit.f, rolled(kit, a)), b: toWorld(kit.f, rolled(kit, b)), r, role, part, flat: flatness, up: unit(dirToWorld(kit.f, upRolled), kit.f.y), fw: kit.f.z });
}
const ball = (kit: Kit, part: string, role: Role, p: Vec, r: number, flatness = 1, up: Vec = UP): void => { cap(kit, part, role, p, p, r, flatness, up); };

/** A two-bone limb from `root` to `target`, bending toward `pole`, with a paw (or hand, or foot) at the end. */
function limb(kit: Kit, part: string, role: Role, root: Vec, target: Vec, lengths: readonly [number, number], radius: number, pole: Vec, end: Role = "dark"): Vec {
  const { mid, end: tip } = solveTwoBone(root, target, lengths[0], lengths[1], pole);
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
    const c = footCycle(m.phase - gait.at[leg], gait.duty, reach * (0.7 + Math.min(1, m.pace / 4) * 0.5), gait.lift * reach);
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

function faceOf(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = actor.spec.build;
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", h.c, h.r);
  const tip = madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15);
  cap(kit, "snout", "coat", at3(h, 0.35, 0, -0.1), tip, h.r * 0.5);
  const jawTip = madd(madd(at3(h, 0.3, 0, -0.32), h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cap(kit, "jaw", "belly", at3(h, 0.3, 0, -0.32), jawTip, h.r * 0.36);
  ball(kit, "nose", "nose", tip, h.r * (b.extras.includes("bignose") ? 0.42 : 0.22));
  for (const x of [-1, 1]) ball(kit, `eye.${x < 0 ? "L" : "R"}`, asleep ? "dark" : "eye", at3(h, 0.62, x * 0.5, 0.28), h.r * 0.17, asleep ? 0.3 : 1, h.u);
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
  const step = walking ? footCycle(m.phase - (x < 0 ? 0 : 0.5), 0.6, arm * 0.6, arm * 0.25) : { z: 0, y: 0 };
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
  const step = walking ? footCycle(m.phase - (x < 0 ? 0.5 : 0), 0.6, leg * 0.7, leg * 0.25) : { z: 0, y: 0 };
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
  for (const x of [-1, 1]) ball(kit, `eye.${x < 0 ? "L" : "R"}`, m.segment.act === "sleep" ? "dark" : "eye", at3(h, 0.95, x * 0.32, 0.12), hr * 0.15);
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

interface BirdBody { readonly C: Vec; readonly K: Vec; readonly T: Vec; readonly r: number; readonly pitch: number; readonly flying: boolean }

function birdSpine(who: Who, m: Moment): BirdBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const flying = m.mode === "fly";
  const drum = m.segment.act === "drum";
  let pitch = flying ? 0.05 : drum ? 1.35 : 0.2 + b.rise * 0.5;
  pitch -= q.peck * (drum ? 0.15 : 0.6);
  const legH = b.leg * size;
  const C: Vec = flying ? [0, 0, 0] : drum ? [0, 0, -r * 0.4] : [0, legH + r * 0.9 + q.hop * size * 0.3 - (m.segment.act === "sleep" ? r * 0.3 : 0), 0];
  const along = dirOf(0, pitch);
  return { C, K: madd(C, along, size * 0.22), T: madd(C, along, -size * 0.26), r: r * 0.85, pitch, flying };
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
    ball(kit, `eye.${x < 0 ? "L" : "R"}`, m.segment.act === "sleep" ? "dark" : "eye", eye, h.r * (owl ? 0.3 : 0.17), owl ? 0.6 : 1, owl ? h.d : h.s);
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

function wingOf(kit: Kit, who: Who, body: BirdBody, x: number, m: Moment): void {
  const q = m.pose;
  const size = who.member.size;
  const open = body.flying ? 1 : clamp(q.wing, 0, 1);
  const rate = FLAP_RATE[who.member.species] ?? 14;
  const glide = body.flying && Math.sin(m.t * 0.37 + who.member.size * 31) > 0.55;
  const beat = glide ? 0.12 : body.flying ? Math.sin(m.t * rate) : q.flap;
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
  if (!b.extras.includes("train")) {
    cap(kit, "tail", "alt", body.T, madd(body.T, back, b.tailLen * size), body.r * 0.7, 0.25);
    return;
  }
  const fan = m.pose.fan;
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 8 - 0.5) * 2.6;
    const spread = unit(add(scale(UP, Math.cos(a)), scale([1, 0, 0], Math.sin(a))));
    const dir = unit(lerpV(dirOf(Math.PI + (i / 8 - 0.5) * 0.3, -0.25), add(spread, [0, 0, -0.25]), fan));
    const tip = madd(body.T, dir, b.tailLen * size * (0.85 + 0.15 * Math.cos(a)));
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
    if (body.flying) { cap(kit, "leg", "horn", hip, add(hip, [0, -body.r * 0.2, -body.r * 1.1]), body.r * 0.12); continue; }
    const foot: Vec = m.segment.act === "drum" ? [x * body.r * 0.5, -size * 0.12, 0] : [x * body.r * 0.45, 0, 0];
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
  for (const x of [-1, 1]) ball(kit, `eye.${x < 0 ? "L" : "R"}`, "eye", at3(h, 0.3, x * 0.6, 0.35), h.r * 0.22);
  if (m.pose.mouth > 0.2 && m.segment.act === "flick") cap(kit, "tongue", "accent", at3(h, 1, 0, -0.1), madd(at3(h, 1, 0, -0.1), hd, h.r * 1.4 * m.pose.mouth), h.r * 0.08);
}

function lizardLegs(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const size = who.member.size;
  const r0 = who.spec.build.body * size;
  for (const [k, at] of [["F", 2], ["H", 5]] as const) {
    const body = points[at] ?? [0, r0, 0];
    for (const x of [-1, 1]) {
      const leg = `${k}${x < 0 ? "L" : "R"}`;
      const step = footCycle(m.phase - (leg === "FL" || leg === "HR" ? 0 : 0.5), 0.55, size * 0.18 * m.moving, size * 0.06);
      const foot: Vec = [body[0] + x * size * 0.2, step.y, body[2] + step.z + (k === "F" ? size * 0.05 : -size * 0.03)];
      limb(kit, `leg.${leg}`, "coat", add(body, [x * r0, 0, 0]), foot, [size * 0.11, size * 0.11], r0 * 0.38, [x, 1, 0], "coat");
    }
  }
}

// ---------------------------------------------------------------- insects

function poseBug(kit: Kit, who: Who, m: Moment): void {
  const size = who.member.size;
  const t = m.t;
  const phase = who.member.size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const perched = m.segment.act === "sit";
  const drift: Vec = [Math.sin(t * 0.6 + phase) * 0.35, Math.sin(t * 0.9 + phase * 2) * 0.18, Math.cos(t * 0.5 + phase) * 0.35];
  const hover = m.mode === "fly" ? [0, Math.sin(t * 9 + phase) * size * 0.6, 0] as Vec : perched ? [0, size * 0.1, 0] as Vec : add([0, 0.35 + m.pose.lift * 0.4, 0], firefly ? drift : scale(drift, 0.3));
  const C = hover;
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
  const C: Vec = [0, legLen * 0.55, 0];
  ball(kit, "body", "coat", C, r, 0.5);
  ball(kit, "belly", "belly", add(C, [0, -r * 0.2, 0]), r * 0.8, 0.35);
  for (const x of [-1, 1]) {
    const stalk = add(C, [x * r * 0.35, r * 0.3, r * 0.7]);
    cap(kit, "eyestalk", "coat", stalk, add(stalk, [0, r * 0.45, 0]), r * 0.08);
    ball(kit, "eye", "eye", add(stalk, [0, r * 0.5, 0]), r * 0.12);
    for (let i = 0; i < 3; i += 1) {
      const z = (i - 1) * r * 0.55;
      const step = footCycle(m.phase - i / 3 - (x > 0 ? 0.5 : 0), 0.5, legLen * 0.8 * m.moving, legLen * 0.3);
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

export type Morph = "normal" | "albino" | "melanistic" | "golden" | "spirit";
export const MORPHS: Readonly<Record<Morph, { readonly label: string; readonly rarity: Rarity; readonly glow: number }>> = {
  normal: { label: "", rarity: "common", glow: 0 },
  albino: { label: "albino", rarity: "epic", glow: 0 },
  melanistic: { label: "black", rarity: "epic", glow: 0 },
  golden: { label: "golden", rarity: "legendary", glow: 0.45 },
  spirit: { label: "spirit", rarity: "epic", glow: 1 },
};

const hexRgb = (hex: string): [number, number, number] => { const v = Number.parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const rgbHex = (rgb: readonly number[]): string => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
const mixColor = (a: string, b: string, k: number): string => { const x = hexRgb(a); const y = hexRgb(b); return rgbHex(x.map((c, i) => mix(c, y[i] ?? c, k))); };

function paletteOf(id: SpeciesId, colors: readonly [string, string, string, string, string], morph: Morph): Palette {
  const [coat, alt, belly, dark, accent] = colors;
  const base: Palette = { coat, alt, belly, dark, accent, eye: id === "owl" ? "#f0a820" : "#0e0c0c", nose: dark, glow: accent, horn: BEAKS[id] ?? "#cbb38c", shell: alt };
  if (morph === "albino") return { ...base, coat: "#f6f3ee", alt: "#e9e4dc", belly: "#ffffff", eye: "#e05a6a", nose: "#e8a0a8", shell: "#efe8de" };
  if (morph === "melanistic") return { ...base, coat: mixColor(coat, "#0c0a0a", 0.75), alt: mixColor(alt, "#0c0a0a", 0.7), belly: mixColor(belly, "#1a1616", 0.65), eye: "#e8c040" };
  if (morph === "golden") return { ...base, coat: "#e8b830", alt: "#c08a18", belly: "#f8e088", accent: "#fff0a0", glow: "#ffe060", horn: "#f8d050", shell: "#d8a020" };
  if (morph === "spirit") return { ...base, coat: mixColor(coat, "#bff6ff", 0.75), alt: mixColor(alt, "#7fe0ff", 0.7), belly: "#f0ffff", glow: "#9ff4ff", eye: "#ffffff", accent: mixColor(accent, "#ffffff", 0.5) };
  return base;
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

export type PlaneKind = "airliner" | "prop" | "jet" | "ufo" | "balloon";
export interface SkyPlan {
  /** Birds that pass over now and then (none in some scenes). */
  readonly flock: { readonly species: SpeciesId; readonly size: readonly [number, number]; readonly every: readonly [number, number] } | null;
  /** Something flying far off: a plane, a balloon, a saucer (only over some worlds). */
  readonly plane: { readonly kind: PlaneKind; readonly every: readonly [number, number] } | null;
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
  const spirited = ctx.world === "crystal" || ctx.world === "cosmic" ? 0.6 : 0.004;
  const morph: Morph = forced ?? pick(rand, [["normal", 1 - spirited - 0.033], ["albino", 0.015], ["melanistic", 0.015], ["golden", 0.003], ["spirit", spirited]]);
  const size = spec.size * between(rand, [0.88, 1.12]) * (young ? 0.55 : 1);
  return { species: id, label: spec.label, size, coat, palette: paletteOf(id, colors, morph), morph, young, horned: !young && rand() < 0.5 };
}

function groupOf(rand: () => number, id: SpeciesId, kind: GroupKind, input: CastInput): CastGroup {
  const spec = speciesOf(id);
  const coats = spec.coats.map(([name]) => [name, 1] as const);
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

const FLOCK_ODDS: Readonly<Record<WorldKey, number>> = { nature: 0.7, voxel: 0.6, beach: 0.8, city: 0.6, crystal: 0.45, vapor: 0.3, synth: 0.1, cosmic: 0 };
const PLANE_ODDS: Readonly<Record<WorldKey, readonly [number, readonly (readonly [PlaneKind, number])[]]>> = {
  city: [0.85, [["airliner", 6], ["jet", 3], ["prop", 1]]], beach: [0.7, [["prop", 5], ["airliner", 3], ["balloon", 1]]],
  nature: [0.35, [["airliner", 3], ["prop", 2], ["balloon", 2]]], voxel: [0.35, [["airliner", 3], ["prop", 2], ["balloon", 2]]],
  crystal: [0.35, [["balloon", 4], ["airliner", 2]]], synth: [0.6, [["jet", 6], ["ufo", 1]]],
  vapor: [0.6, [["jet", 5], ["balloon", 2], ["ufo", 1]]], cosmic: [0.5, [["ufo", 1]]],
};
const FLOCK_WEIGHTS: Partial<Record<SpeciesId, number>> = { songbird: 4, crow: 2, gull: 4, parrot: 2, crane: 0.6 };

function skyFor(rand: () => number, input: CastInput): SkyPlan {
  const ctx = contextOf(input);
  const birds = (Object.keys(FLOCK_WEIGHTS) as SpeciesId[]).filter((id) => (ctx.region === null || speciesOf(id).regions.includes(ctx.region)) && speciesOf(id).worlds.includes(ctx.world === "voxel" ? "nature" : ctx.world));
  const flocking = birds.length > 0 && rand() < FLOCK_ODDS[ctx.world];
  const species = flocking ? pick(rand, birds.map((id) => [id, FLOCK_WEIGHTS[id] ?? 1] as const)) : null;
  const [odds, kinds] = PLANE_ODDS[ctx.world];
  const plane = rand() < odds ? pick(rand, kinds) : null;
  return {
    flock: species ? { species, size: species === "crane" ? [3, 7] : [1, 9], every: [14, 50] } : null,
    plane: plane ? { kind: plane, every: plane === "balloon" ? [60, 140] : [35, 90] } : null,
  };
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
  readonly kind: SpeciesId | PlaneKind;
  readonly label: string;
  readonly action: Action;
  readonly morph: Morph;
  readonly at: Vec;
  readonly front: Vec;
  readonly capsules: readonly Capsule[];
  readonly palette: Palette;
  /** How brightly it glows (a spirit animal, a golden one, a saucer's lights). */
  readonly glow: number;
}

const POSERS: Readonly<Record<Plan, (kit: Kit, who: Who, m: Moment) => void>> = {
  quad: poseQuad, primate: posePrimate, bird: poseBird, serpent: poseSerpent, bug: poseBug, crab: poseCrab,
};

function poseWho(who: Who, m: Moment): Capsule[] {
  const q = m.pose;
  const roll = who.spec.plan === "quad" ? q.roll * Math.PI + q.shake * 0.45 * Math.sin(m.t * 32) : 0;
  // (A crab walks sideways: its right hand leads.)
  const f = who.spec.plan === "crab" ? { o: m.frame.o, x: m.frame.z, y: m.frame.y, z: scale(m.frame.x, -1) } : m.frame;
  const kit: Kit = { f, out: [], roll, pivot: [0, who.member.size * 0.45, 0] };
  POSERS[who.spec.plan](kit, who, m);
  return kit.out;
}

function bodyOf(id: string, who: Who, m: Moment, capsules: readonly Capsule[]): Body {
  return {
    id, kind: who.member.species, label: who.member.label, action: m.segment.act, morph: who.member.morph,
    at: m.frame.o, front: m.frame.z, capsules, palette: who.member.palette, glow: MORPHS[who.member.morph].glow,
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

interface Pass { readonly start: number; readonly end: number; readonly from: Vec; readonly to: Vec; readonly count: number; readonly v: boolean; readonly seed: number }

function passesUntil(list: Pass[], rand: () => number, every: readonly [number, number], t: number, make: (start: number) => Pass): void {
  let last = list[list.length - 1]?.start ?? -between(rand, [0.3, 0.9]) * every[0];
  while (last < t + 1) {
    last += between(rand, every);
    list.push(make(last));
  }
  while (list.length > 2 && (list[0]?.end ?? 0) < t - 5) list.shift();
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

const FLY_SEGMENT: Segment = { act: "fly", t0: 0, t1: 1e9, from: { on: "ground", x: 0, z: 0 }, to: { on: "ground", x: 0, z: 0 }, yaw: 0, face: -1, mode: "fly", pace: 4 };

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
    const m: Moment = { frame: frameOf(p, dir), phase: 0, moving: 1, pace: 4, mode: "fly", segment: FLY_SEGMENT, pose: { ...restPose(), wing: 1 }, t: t + i * 0.37 };
    out.push(bodyOf(`flock.${pass.seed}.${i}`, who, m, poseWho(who, m)));
  }
  return out;
}

const PLANE_LOOKS: Readonly<Record<PlaneKind, Palette>> = {
  airliner: { coat: "#f4f6f8", alt: "#c8d0d8", belly: "#e8ecf0", dark: "#3a4250", eye: "#1a2230", nose: "#3a4250", accent: "#2a5ad0", glow: "#ff4a3a", horn: "#9aa4ae", shell: "#c8d0d8" },
  prop: { coat: "#f0d040", alt: "#d83a2a", belly: "#f8f0d0", dark: "#2a2a2a", eye: "#1a1a1a", nose: "#2a2a2a", accent: "#f4f0e8", glow: "#ff4a3a", horn: "#8a7a5a", shell: "#d83a2a" },
  jet: { coat: "#1a1a2a", alt: "#ff3ad8", belly: "#2a2a3a", dark: "#0a0a14", eye: "#0a0a14", nose: "#0a0a14", accent: "#3af0ff", glow: "#f4f8ff", horn: "#3af0ff", shell: "#ff3ad8" },
  ufo: { coat: "#c8ccd8", alt: "#8a90a0", belly: "#5a6070", dark: "#2a2e38", eye: "#1a1e28", nose: "#2a2e38", accent: "#7affc8", glow: "#9ff4ff", horn: "#f0f4ff", shell: "#8a90a0" },
  balloon: { coat: "#e83a3a", alt: "#f0d040", belly: "#3a6ad0", dark: "#6a4a2a", eye: "#2a1a10", nose: "#6a4a2a", accent: "#ffffff", glow: "#ffb050", horn: "#6a4a2a", shell: "#f0d040" },
};

function airliner(kit: Kit, size: number, prop: boolean): void {
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

const PLANE_SIZE: Readonly<Record<PlaneKind, number>> = { airliner: 3.4, prop: 1.6, jet: 2.4, ufo: 2.6, balloon: 3 };

const PLANE_SHAPES: Readonly<Record<PlaneKind, (kit: Kit, size: number, t: number) => void>> = {
  airliner: (kit, size) => { airliner(kit, size, false); },
  prop: (kit, size, t) => { airliner(kit, size, true); banner(kit, size, t); },
  jet: (kit, size) => {
    airliner(kit, size, false);
    for (let i = 1; i <= 10; i += 1) ball(kit, "contrail", "glow", [0, 0, -size * (0.5 + i * 0.45)], size * (0.03 + i * 0.012), 0.9);
  },
  ufo: saucer,
  balloon: (kit, size) => { balloonShape(kit, size); },
};
const PLANE_DRIFT: Partial<Record<PlaneKind, (t: number) => Vec>> = {
  ufo: (t) => [Math.sin(t * 0.7) * 3, Math.sin(t * 1.9) * 1.2, 0],
  balloon: (t) => [0, Math.sin(t * 0.2) * 0.8, 0],
};

function planeBody(kind: PlaneKind, pass: Pass, t: number): Body {
  const u = (t - pass.start) / (pass.end - pass.start);
  const dir = unit(sub(pass.to, pass.from));
  const p = add(lerpV(pass.from, pass.to, kind === "ufo" ? smooth(u) * 0.6 + u * 0.4 : u), PLANE_DRIFT[kind]?.(t) ?? [0, 0, 0]);
  const kit: Kit = { f: frameOf(p, dir), out: [], roll: 0, pivot: [0, 0, 0] };
  PLANE_SHAPES[kind](kit, PLANE_SIZE[kind], t);
  return { id: `plane.${pass.seed}`, kind, label: kind, action: "fly", morph: "normal", at: p, front: dir, capsules: kit.out, palette: PLANE_LOOKS[kind], glow: kind === "ufo" || kind === "jet" ? 0.6 : 0 };
}

// ---------------------------------------------------------------- the herd

export interface Herd {
  readonly cast: Cast;
  /** Every resident animal posed at `t` seconds, on this frame's stage. */
  at(t: number, stage: Stage): Body[];
  /** What is passing over at `t`: a flock, a plane. `radius` scales how far off they pass. */
  sky(t: number, options?: { readonly radius?: number }): Body[];
}

function actorOf(member: CastMember, index: number, seed: number, centre: Place, stage: Stage): Actor {
  const rand = streamOf(seed, `fauna.actor.${index}.${member.species}`);
  const spec = speciesOf(member.species);
  const near = anchorOf(centre, stage, []).p;
  const arboreal = (spec.climbs || spec.flies) && (stage.perches?.length ?? 0) > 0 && rand() < (spec.temper.hang !== undefined || member.species === "koala" || member.species === "owl" ? 0.85 : 0.3);
  const place: Place = arboreal && spec.plan !== "bug" ? { on: "perch", i: Math.floor(rand() * 9973) } : groundSpot(rand, stage, member.size, near, member.size * 3 + 0.3);
  const actor: Actor = { index, member, spec, rand, day: idleMatrix(member.species), night: idleMatrix(member.species, { night: true }), segments: [], until: 0, place, yaw: rand() * TAU, last: "stand", pos: anchorOf(place, stage, []).p, back: null };
  stay(actor, spec.plan === "bug" ? "hover" : "stand", 0.3 + rand() * 1.5);
  return actor;
}

const COHESION: Readonly<Record<CastGroup["kind"], number>> = { solo: 0, pair: 0.22, family: 0.26, pack: 0.24, mixed: 0.3 };

function troupesOf(cast: Cast, stage: Stage): Troupe[] {
  return cast.groups.map((group, g) => {
    const rand = streamOf(cast.seed, `fauna.troupe.${g}`);
    const first = group.members[0];
    const centre = groundSpot(rand, stage, first?.size ?? 0.3);
    const actors = group.members.map((member, i) => actorOf(member, i, cast.seed + g * 101, centre, stage));
    return { kind: group.kind, actors, rand, cohesion: COHESION[group.kind] };
  });
}

function prune(actor: Actor, t: number): void {
  let drop = 0;
  while (drop < actor.segments.length - 2 && (actor.segments[drop]?.t1 ?? t) < t - 3) drop += 1;
  if (drop > 0) actor.segments.splice(0, drop);
}

/** The scene's living cast: call `at` every frame with the stage, and `sky` for what flies over. */
export function createHerd(cast: Cast): Herd {
  let troupes: Troupe[] | null = null;
  const flocks: Pass[] = [];
  const planes: Pass[] = [];
  const flockRand = streamOf(cast.seed, "fauna.sky.flocks");
  const planeRand = streamOf(cast.seed, "fauna.sky.planes");
  const flockWho: Who | null = cast.sky.flock ? { member: memberOf(streamOf(cast.seed, "fauna.sky.bird"), cast.sky.flock.species, speciesOf(cast.sky.flock.species).coats[0]?.[0] ?? "", false, { morph: "normal" }), spec: speciesOf(cast.sky.flock.species) } : null;
  const flockSky = (t: number, reach: number): Body[] => {
    const flock = cast.sky.flock;
    if (!flock || !flockWho) return [];
    passesUntil(flocks, flockRand, flock.every, t, (start) => {
      const { from, to } = chord(flockRand, [8 * reach, 26 * reach], [6, 15], 45 * reach);
      const count = intBetween(flockRand, flock.size[0], flock.size[1]);
      return { start, end: start + length(sub(to, from)) / between(flockRand, [3.5, 5.5]), from, to, count, v: count >= 5 && flockRand() < 0.6, seed: Math.floor(flockRand() * 1e6) };
    });
    return flocks.filter((pass) => t >= pass.start && t < pass.end).flatMap((pass) => flockBodies(pass, flockWho, t));
  };
  const planeSky = (t: number, reach: number): Body[] => {
    const plane = cast.sky.plane;
    if (!plane) return [];
    const slow = plane.kind === "balloon" ? 0.25 : plane.kind === "ufo" ? 0.6 : 1;
    const balloon = plane.kind === "balloon";
    passesUntil(planes, planeRand, plane.every, t, (start) => {
      const { from, to } = chord(planeRand, balloon ? [30 * reach, 50 * reach] : [50 * reach, 75 * reach], balloon ? [16, 26] : [26, 38], 110 * reach);
      return { start, end: start + length(sub(to, from)) / (between(planeRand, [7, 10]) * slow), from, to, count: 1, v: false, seed: Math.floor(planeRand() * 1e6) };
    });
    return planes.filter((pass) => t >= pass.start && t < pass.end).map((pass) => planeBody(plane.kind, pass, t));
  };
  return {
    cast,
    at(t: number, stage: Stage): Body[] {
      troupes ??= troupesOf(cast, stage);
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
          out.push(bodyOf(`${g}.${actor.index}`, actor, m, capsules));
        }
      });
      return out;
    },
    sky(t: number, options: { readonly radius?: number } = {}): Body[] {
      const reach = options.radius ?? 1;
      return [...flockSky(t, reach), ...planeSky(t, reach)];
    },
  };
}

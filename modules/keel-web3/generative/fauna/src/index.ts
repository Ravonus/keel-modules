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
  | "wander" | "run" | "hop" | "climb" | "fly" | "stalk";

/** Actions that carry an animal somewhere else. */
export const MOVES: ReadonlySet<Action> = new Set<Action>(["wander", "run", "hop", "climb", "fly", "stalk"]);

type Ears = "point" | "round" | "long" | "flop" | "tuft" | "fluffy" | "none";
type Tail = "bushy" | "curl" | "thin" | "puff" | "ring" | "thick" | "fan" | "none";
/**
 * Extra parts and markings. Markings are paint only (sdf-body decals): a pale
 * `bib` down the throat and chest, a white `rump`, a pale `muzzle`, a dark
 * `saddle` down the back, dark `socks` on the lower legs, a `mask` across the
 * eyes; a `ruff` of fur round the neck, a `hump` over the shoulders.
 */
type Extra = "bignose" | "antlers" | "mask" | "quills" | "shell" | "pouch" | "crest" | "stripes" | "longneck" | "train" | "crown" | "glowtail" | "claws" | "cheeks" | "spots"
  | "bib" | "rump" | "muzzle" | "saddle" | "socks" | "ruff" | "hump";
/** What a leg stands on: a paw on its toes, a hoof on its tips, or a flat sole, heel down (a bear's, a raccoon's). */
type Foot = "paw" | "hoof" | "plant";
/**
 * How it sits: a dog's sit (rump down, forelegs straight); a rabbit's loaf; a
 * deer folds down to lie instead; a bear sits back on its rump; a squirrel
 * sits up on its haunches, forepaws free; a tortoise tucks in.
 */
type SitStyle = "dog" | "loaf" | "lie" | "rump" | "haunch" | "tuck";

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
  /** Four legs: what each leg stands on. */
  readonly foot: Foot;
  /** The forelegs' length as a share of the hind legs' (a kangaroo's are short). */
  readonly fore: number;
  /** Leg thickness, as a share of the usual. */
  readonly legR: number;
  /** The chest's and the haunch's mass, as shares of the body's radius. */
  readonly chest: number;
  readonly haunch: number;
  readonly sit: SitStyle;
  /** Ear length, as a share of the usual for its kind. */
  readonly earLen: number;
  /** The muzzle's tip, as a share of its root: small for a fox's point, near 1 for a capybara's block. */
  readonly snoutTip: number;
  /** The tail's thickness, as a share of the usual, and how far it rises above (or hangs below) its kind's. */
  readonly tailGirth: number;
  readonly tailRise: number;
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

const BUILD: Build = {
  len: 1.3, leg: 0.6, body: 0.24, neck: 0.3, rise: 0.7, head: 0.17, snout: 0.16, ears: "point", tail: "thin", tailLen: 0.8, hip: 1, extras: [],
  foot: "paw", fore: 1, legR: 1, chest: 1.1, haunch: 1, sit: "dog", earLen: 1, snoutTip: 0.7, tailGirth: 1, tailRise: 0,
};
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
    build: { len: 0.85, leg: 0.36, body: 0.4, neck: 0.1, rise: 0.9, head: 0.27, snout: 0.08, ears: "long", tail: "puff", tailLen: 0.25, hip: 1.18, fore: 0.78, haunch: 1.3, chest: 0.95, sit: "loaf", snoutTip: 0.8, legR: 1.1 },
    coats: [["wild", ["#9a7e5e", "#7c6248", "#efe6d6", "#3a2c22", "#e8a8a8"]], ["snowshoe", ["#f2efe8", "#d8d2c8", "#ffffff", "#5a4a40", "#f0b0b8"]], ["dutch", ["#3a3230", "#f4f0ea", "#f4f0ea", "#1e1a18", "#e8a8a8"]]],
    temper: { graze: 2.2, groom: 1.6, rear: 1.4, hop: 1.8, sit: 1.3, wander: 0.4, sniff: 1.4 }, friends: ["songbird", "deer"] }),
  fox: define({ label: "Fox", plan: "quad", size: 0.36, rarity: "uncommon", weight: 34, regions: TEMPERATE, speed: 1.6, groups: [7, 2, 2, 0],
    build: { len: 1.35, leg: 0.62, body: 0.25, neck: 0.3, rise: 0.75, head: 0.18, snout: 0.26, ears: "point", tail: "bushy", tailLen: 1.1, extras: ["socks", "bib"], earLen: 1.35, snoutTip: 0.32, chest: 1.15, haunch: 0.95, tailGirth: 1.15, legR: 0.85 },
    coats: [["red", ["#d2662a", "#a8481c", "#f4efe6", "#2a1a14", "#f4efe6"]], ["silver", ["#5a5a62", "#2e2e34", "#e8e8ec", "#16161a", "#f0f0f4"]], ["arctic", ["#f4f4f0", "#dcdcd6", "#ffffff", "#2a2a2a", "#ffffff"]]],
    temper: { sniff: 2.2, dig: 1.6, play: 1.4, stretch: 1.3, sit: 1, sleep: 1, look: 1.4, wander: 1.4, stalk: 1.2, graze: 0 }, friends: ["crow"] }),
  deer: define({ label: "Deer", plan: "quad", size: 0.95, rarity: "uncommon", weight: 26, regions: TEMPERATE, speed: 1.1, groups: [4, 3, 4, 2], pack: [3, 4],
    build: { len: 1.1, leg: 0.72, body: 0.22, neck: 0.55, rise: 1.05, head: 0.12, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.18, extras: ["antlers", "spots", "rump"], foot: "hoof", sit: "lie", legR: 0.55, chest: 1.2, earLen: 1.5, snoutTip: 0.5 },
    coats: [["whitetail", ["#a87a4e", "#8a6038", "#f4ece0", "#2a1e16", "#f8f4ec"]], ["sika", ["#9a5e34", "#7a4422", "#f0e4d0", "#241810", "#f6efe2"]], ["fallow", ["#c8925a", "#9e6c3e", "#f6ecd8", "#2e2014", "#ffffff"]]],
    temper: { graze: 2.8, look: 1.8, groom: 1, wander: 0.8, lie: 1.6, run: 0.3, dig: 0, roll: 0, sit: 0 }, friends: ["rabbit", "songbird", "crow"] }),
  wolf: define({ label: "Wolf", plan: "quad", size: 0.72, rarity: "rare", weight: 10, regions: ["rockies", "alps"], speed: 1.3, groups: [3, 2, 1, 5], pack: [3, 5],
    build: { len: 1.35, leg: 0.7, body: 0.25, neck: 0.3, rise: 0.55, head: 0.17, snout: 0.24, ears: "point", tail: "bushy", tailLen: 0.75, extras: ["ruff", "bib", "saddle", "muzzle"], earLen: 1.15, snoutTip: 0.45, chest: 1.25, haunch: 0.9, tailRise: -0.5, tailGirth: 0.9, legR: 0.95 },
    coats: [["grey", ["#7c7a74", "#4e4c48", "#e0dcd4", "#1e1c1a", "#d6d0c4"]], ["timber", ["#8a6a4a", "#4a3828", "#dcccb4", "#1c1610", "#cdb898"]], ["white", ["#e8e6e0", "#c8c4bc", "#ffffff", "#2a2826", "#ffffff"]], ["black", ["#2c2a2a", "#1a1818", "#4a4644", "#0c0a0a", "#5a5654"]]],
    temper: { howl: 2.4, sniff: 1.6, lie: 1.6, play: 1.4, look: 1.5, wander: 1.4, run: 0.6, graze: 0 }, friends: ["crow"] }),
  bear: define({ label: "Bear", plan: "quad", size: 0.9, rarity: "rare", weight: 8, regions: ["rockies", "alps", "tokyo"], speed: 0.8, winter: false, groups: [6, 0, 3, 0],
    build: { len: 1.3, leg: 0.5, body: 0.36, neck: 0.25, rise: 0.15, head: 0.2, snout: 0.17, ears: "round", tail: "none", tailLen: 0.1, hip: 0.92, extras: ["hump", "muzzle"], foot: "plant", sit: "rump", legR: 1.5, chest: 1.15, earLen: 1.15, snoutTip: 0.6 },
    coats: [["brown", ["#6a4a30", "#4a3220", "#8a6a4a", "#1a120c", "#a88a68"]], ["black", ["#262220", "#141210", "#3a3430", "#0a0808", "#b89a72"]], ["cinnamon", ["#9a6236", "#764824", "#b8865a", "#22140a", "#c8a07a"]]],
    temper: { rear: 1.6, scratch: 2, sit: 1.8, sniff: 1.4, dig: 1.3, lie: 1.4, roll: 0.8, graze: 0 }, friends: ["songbird"] }),
  raccoon: define({ label: "Raccoon", plan: "quad", size: 0.3, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 1.1, active: "night", climbs: true, groups: [5, 2, 3, 0],
    build: { len: 1.2, leg: 0.42, body: 0.32, neck: 0.18, rise: 0.55, head: 0.21, snout: 0.16, ears: "round", tail: "ring", tailLen: 0.85, hip: 1.18, extras: ["mask", "muzzle"], foot: "plant", sit: "haunch", haunch: 1.15, chest: 1, snoutTip: 0.4 },
    coats: [["raccoon", ["#8a8682", "#5a5652", "#c8c4bc", "#1e1c1a", "#e8e4dc"]], ["tanuki", ["#8a6c4a", "#4a3828", "#b89a78", "#1a120c", "#d8c4a4"]]],
    temper: { dig: 1.8, sniff: 1.8, rear: 1.4, eat: 1.6, climb: 1.2, groom: 1.2, graze: 0 }, friends: ["cat"] }),
  cat: define({ label: "Cat", plan: "quad", size: 0.24, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1, active: "any", climbs: true, groups: [8, 2, 2, 0],
    build: { len: 1.25, leg: 0.55, body: 0.27, neck: 0.18, rise: 0.75, head: 0.24, snout: 0.06, ears: "point", tail: "thin", tailLen: 1.1, tailRise: 0.5, chest: 1.05, haunch: 1.05, earLen: 1.05, snoutTip: 0.8, legR: 0.85 },
    coats: [["tabby", ["#b07a44", "#7a4e26", "#efe0c8", "#2a1a10", "#f0a0a0"]], ["black", ["#1e1c1e", "#121012", "#2a282a", "#060606", "#f0c040"]], ["calico", ["#f2ece2", "#d0782e", "#ffffff", "#2a2420", "#f0a0a0"]], ["grey", ["#8a8c94", "#5e6068", "#d8dadf", "#202226", "#f0a0b0"]]],
    temper: { groom: 2.4, sit: 2, sleep: 1.8, stretch: 1.6, look: 1.4, play: 1.1, yawn: 1.4, climb: 0.8, stalk: 1, graze: 0 }, friends: ["raccoon", "crow", "songbird"] }),
  hedgehog: define({ label: "Hedgehog", plan: "quad", size: 0.11, rarity: "uncommon", weight: 14, regions: ["alps"], speed: 0.9, active: "night", winter: false,
    build: { len: 0.9, leg: 0.2, body: 0.55, neck: 0.08, rise: 0.1, head: 0.26, snout: 0.4, ears: "round", tail: "none", tailLen: 0.1, hip: 1, extras: ["quills", "muzzle"], foot: "plant", sit: "lie", earLen: 0.7, snoutTip: 0.3, legR: 0.9 },
    coats: [["brown", ["#8a6e54", "#5a4634", "#e0ccb0", "#140e0a", "#d8c8b0"]], ["blond", ["#b8a080", "#806a50", "#efe4d4", "#2a2018", "#f0e8d8"]]],
    temper: { sniff: 2.6, dig: 1.6, coil: 1.2, wander: 1.4, sleep: 1, run: 0, graze: 0 }, friends: [] }),
  mouse: define({ label: "Field mouse", plan: "quad", size: 0.07, rarity: "common", weight: 30, regions: ALL_REGIONS, speed: 2.4, active: "night", groups: [5, 2, 2, 2], pack: [3, 4],
    build: { len: 1.2, leg: 0.3, body: 0.42, neck: 0.1, rise: 0.4, head: 0.26, snout: 0.2, ears: "round", tail: "thin", tailLen: 1.3, hip: 1.15, haunch: 1.3, chest: 0.85, sit: "haunch", earLen: 1.9, snoutTip: 0.35, tailRise: -0.7, legR: 0.8 },
    coats: [["field", ["#9a7a58", "#6a5038", "#efe2cc", "#1a120c", "#f0a8a8"]], ["grey", ["#7c7a78", "#55524f", "#d8d4cc", "#141210", "#f0a8a8"]]],
    temper: { sniff: 2.4, eat: 2, groom: 1.6, rear: 1.4, run: 1.4, wander: 1.2, graze: 0 }, friends: [] }),
  capybara: define({ label: "Capybara", plan: "quad", size: 0.5, rarity: "rare", weight: 9, regions: ["tokyo"], worlds: ["nature", "beach", "voxel"], speed: 0.6, groups: [3, 3, 3, 2], pack: [3, 4],
    build: { len: 1.45, leg: 0.36, body: 0.38, neck: 0.2, rise: 0.35, head: 0.28, snout: 0.3, ears: "round", tail: "none", tailLen: 0.05, earLen: 0.55, snoutTip: 0.85, haunch: 1.1, legR: 1.2 },
    coats: [["capybara", ["#9a6c42", "#764e2c", "#a87c52", "#20140c", "#b88c62"]]],
    temper: { lie: 2.6, graze: 2, sit: 1.6, sleep: 1.6, look: 0.6, wander: 0.5, run: 0, roll: 0 }, friends: ["songbird", "parrot", "monkey"] }),
  kangaroo: define({ label: "Kangaroo", plan: "quad", size: 0.9, rarity: "rare", weight: 14, regions: ["sydney"], speed: 1.8, groups: [3, 2, 4, 2], pack: [3, 4],
    build: { len: 0.95, leg: 0.75, body: 0.25, neck: 0.22, rise: 1.2, head: 0.13, snout: 0.18, ears: "long", tail: "thick", tailLen: 1.15, hip: 0.8, extras: ["pouch"], fore: 0.45, foot: "plant", sit: "haunch", haunch: 1.4, chest: 0.9, earLen: 0.55, snoutTip: 0.55, tailGirth: 1.1 },
    coats: [["red", ["#b06a3e", "#8a4e2a", "#e4cdb0", "#2a1a10", "#d8b898"]], ["grey", ["#8a8278", "#5e564e", "#d8d0c4", "#1e1a16", "#c8bcae"]]],
    temper: { graze: 1.8, rear: 2.6, groom: 1.2, hop: 2, look: 1.4, lie: 1, dig: 0, roll: 0 }, friends: [] }),
  tortoise: define({ label: "Tortoise", plan: "quad", size: 0.16, rarity: "rare", weight: 10, regions: ["nairobi"], worlds: ["nature", "beach", "voxel"], speed: 0.25, winter: false,
    build: { len: 0.6, leg: 0.44, body: 0.42, neck: 0.4, rise: 0.4, head: 0.22, snout: 0.08, ears: "none", tail: "none", tailLen: 0.1, extras: ["shell"], foot: "plant", sit: "tuck", legR: 1.6, snoutTip: 0.9 },
    coats: [["leopard", ["#8a7a5a", "#5a4a32", "#c8b88e", "#1a1408", "#3a3020"]], ["star", ["#6a5a3a", "#2a2010", "#c8a860", "#141008", "#e8c870"]]],
    temper: { graze: 2.4, bask: 2.6, sleep: 1.2, look: 0.6, wander: 0.8, run: 0, roll: 0, shake: 0, rear: 0, scratch: 0, groom: 0, stretch: 0, sit: 0 }, friends: ["songbird", "crab", "guineafowl"] }),
  meerkat: define({ label: "Meerkat", plan: "quad", size: 0.22, rarity: "rare", weight: 12, regions: [], speed: 1.8, groups: [1, 2, 3, 6], pack: [3, 6],
    build: { len: 1.25, leg: 0.36, body: 0.24, neck: 0.22, rise: 0.8, head: 0.19, snout: 0.2, ears: "round", tail: "thin", tailLen: 0.85, hip: 1, extras: ["mask"], sit: "haunch", earLen: 0.6, snoutTip: 0.4, tailRise: -0.2 },
    coats: [["meerkat", ["#b8966c", "#8a6c48", "#d8c4a4", "#1a120a", "#e8d8bc"]]],
    temper: { rear: 3.2, look: 2.4, dig: 2, groom: 1.4, bask: 1.2, run: 1, graze: 0 }, friends: [] }),
  squirrel: define({ label: "Squirrel", plan: "quad", size: 0.12, rarity: "common", weight: 60, regions: TEMPERATE, worlds: ["nature", "voxel", "crystal", "city"], speed: 2.2, climbs: true, groups: [6, 3, 1, 1], pack: [3, 3],
    build: { len: 1, leg: 0.4, body: 0.32, neck: 0.08, rise: 0.8, head: 0.26, snout: 0.12, ears: "tuft", tail: "curl", tailLen: 1.25, hip: 1.18, fore: 0.85, haunch: 1.25, chest: 0.95, sit: "haunch", tailGirth: 1.3 },
    coats: [["red", ["#b8582a", "#8a3e1a", "#f0e4d4", "#24140a", "#f4ece0"]], ["grey", ["#86827c", "#5e5a54", "#e8e4dc", "#1c1a18", "#efe8de"]], ["black", ["#2a2624", "#181614", "#4a4440", "#0a0808", "#4a4440"]]],
    temper: { eat: 2.6, climb: 2.6, rear: 1.6, dig: 1.4, look: 1.4, run: 1.4, play: 1.4, graze: 0 }, friends: ["songbird", "woodpecker"] }),
  redpanda: define({ label: "Red panda", plan: "quad", size: 0.28, rarity: "epic", weight: 5, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [6, 2, 2, 0],
    build: { len: 1.3, leg: 0.45, body: 0.3, neck: 0.16, rise: 0.6, head: 0.26, snout: 0.12, ears: "point", tail: "ring", tailLen: 1.1, hip: 1.08, extras: ["cheeks", "muzzle", "socks"], foot: "plant", earLen: 0.85, snoutTip: 0.55, tailGirth: 1.2 },
    coats: [["red panda", ["#b84a1e", "#5a2210", "#1e1210", "#140a06", "#f4ece0"]]],
    temper: { climb: 2.4, eat: 2, sleep: 1.8, groom: 1.4, stretch: 1.2, rear: 1.2, roll: 0, graze: 0 }, friends: [] }),
  koala: define({ label: "Koala", plan: "quad", size: 0.3, rarity: "epic", weight: 7, regions: ["sydney"], speed: 0.4, climbs: true, groups: [7, 1, 3, 0],
    build: { len: 0.85, leg: 0.45, body: 0.4, neck: 0.08, rise: 1, head: 0.33, snout: 0.06, ears: "fluffy", tail: "none", tailLen: 0.05, hip: 1, extras: ["bignose"], foot: "plant", sit: "rump", earLen: 1.8, snoutTip: 0.9, legR: 1.2 },
    coats: [["koala", ["#8a8a8e", "#5e5e62", "#e8e6e2", "#1a1a1c", "#2a2a2c"]]],
    temper: { sleep: 3.4, eat: 2.2, climb: 1.4, look: 0.6, wander: 0.2, scratch: 1.2, run: 0, roll: 0 }, friends: [] }),
  macaque: define({ label: "Snow monkey", plan: "primate", size: 0.5, rarity: "rare", weight: 12, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [3, 3, 4, 3], pack: [3, 5],
    build: { len: 0.5, leg: 0.55, body: 0.18, neck: 0.12, head: 0.16, snout: 0.05, ears: "none", tail: "puff", tailLen: 0.2 },
    coats: [["snow", ["#a89a8a", "#7a6c5e", "#c8bcb0", "#2a2018", "#e8786c"]]],
    temper: { groom: 3, sit: 2, eat: 1.6, look: 1.4, climb: 1.4, sleep: 1.2, hang: 0.4 }, friends: ["crow", "deer"] }),
  monkey: define({ label: "Long-tailed macaque", plan: "primate", size: 0.44, rarity: "uncommon", weight: 18, regions: ["bali", "nairobi"], worlds: ["nature", "beach", "voxel"], speed: 1.2, climbs: true, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { len: 0.5, leg: 0.55, body: 0.15, neck: 0.1, head: 0.14, snout: 0.07, ears: "round", tail: "thin", tailLen: 1.3 },
    coats: [["macaque", ["#8a7a5e", "#5e5038", "#c8b898", "#241c12", "#d8a088"]], ["vervet", ["#8a8c78", "#5a5c4a", "#e8e6dc", "#141410", "#2a2a2a"]]],
    temper: { climb: 2.4, hang: 1.6, groom: 2.2, eat: 1.8, play: 1.6, look: 1.2, scratch: 1.4 }, friends: ["parrot", "peacock", "guineafowl"] }),
  sloth: define({ label: "Sloth", plan: "primate", size: 0.45, rarity: "epic", weight: 4, regions: [], worlds: ["nature", "beach", "voxel"], speed: 0.12, climbs: true, groups: [9, 0, 2, 0],
    build: { len: 0.55, leg: 0.5, body: 0.22, neck: 0.1, head: 0.14, snout: 0.03, ears: "none", tail: "none", tailLen: 0.05, extras: ["mask", "claws"] },
    coats: [["sloth", ["#9a8a6a", "#6a5c44", "#c8b896", "#2a2016", "#e8dcc0"]]],
    temper: { hang: 4, sleep: 3, eat: 1.2, look: 0.8, climb: 0.6 }, friends: [] }),
  songbird: define({ label: "Songbird", plan: "bird", size: 0.13, rarity: "common", weight: 80, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "city", "beach"], speed: 1.4, groups: [5, 4, 2, 2], pack: [3, 5],
    build: { len: 1, leg: 0.22, body: 0.27, neck: 0.1, rise: 0.4, head: 0.17, snout: 0.11, ears: "none", tail: "fan", tailLen: 0.38 },
    coats: [["robin", ["#6a5a4a", "#4a3e32", "#e2702e", "#141010", "#e8c048"]], ["bluebird", ["#3a6ad0", "#2a4a9a", "#e8945a", "#0e1220", "#2a2a2a"]], ["goldfinch", ["#f0d020", "#2a2a2a", "#f8e870", "#121212", "#e8a060"]], ["sparrow", ["#9a7a5a", "#5e4a36", "#d8ccb8", "#1a1410", "#3a3028"]]],
    temper: { sing: 2.6, peck: 2.2, hop: 2, preen: 1.6, look: 1.4, fly: 2.2 }, friends: ["deer", "rabbit", "bear", "capybara", "tortoise", "squirrel"] }),
  crow: define({ label: "Crow", plan: "bird", size: 0.24, rarity: "common", weight: 34, regions: ALL_REGIONS, worlds: ["nature", "voxel", "city", "synth", "crystal"], speed: 1.2, active: "day", groups: [5, 3, 1, 3], pack: [3, 5],
    build: { len: 1.15, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.3, head: 0.15, snout: 0.2, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["crow", ["#23262e", "#2c3346", "#2e3038", "#08080a", "#4a5068"]], ["hooded", ["#8a8a8e", "#1a1a1e", "#9a9a9e", "#0a0a0c", "#2a2a2e"]]],
    temper: { peck: 2.4, look: 2, hop: 1.6, flap: 1.2, sing: 0.8, fly: 2 }, friends: ["deer", "cat", "wolf"] }),
  owl: define({ label: "Owl", plan: "bird", size: 0.3, rarity: "rare", weight: 10, regions: ["rockies", "atlantic", "alps", "tokyo", "nairobi"], worlds: ["nature", "voxel", "crystal", "city"], speed: 0.8, active: "night", groups: [8, 2, 2, 0],
    build: { len: 0.9, leg: 0.16, body: 0.33, neck: 0.04, rise: 1.2, head: 0.24, snout: 0.06, ears: "tuft", tail: "fan", tailLen: 0.3 },
    coats: [["barn", ["#d8b078", "#a8804a", "#f6eee0", "#2a1e10", "#f4ead8"]], ["great horned", ["#7a6248", "#4a3a28", "#c8b494", "#1a120a", "#f0d050"]], ["snowy", ["#f4f4f0", "#c8c8c4", "#ffffff", "#2a2a2a", "#f0d040"]]],
    temper: { look: 3, preen: 1.6, sleep: 2, flap: 0.8, fly: 1.3, peck: 0, hop: 0, sing: 0 }, friends: ["crow"] }),
  parrot: define({ label: "Parrot", plan: "bird", size: 0.28, rarity: "rare", weight: 14, regions: ["bali", "sydney"], worlds: ["nature", "beach", "voxel", "vapor"], speed: 1, groups: [4, 4, 1, 3], pack: [3, 5],
    build: { len: 1.2, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.9, head: 0.16, snout: 0.14, ears: "none", tail: "fan", tailLen: 0.9, extras: ["crest"] },
    coats: [["macaw", ["#e2282e", "#2a5ad8", "#f0d020", "#141414", "#3ab84a"]], ["cockatoo", ["#f8f8f4", "#e8e4d8", "#ffffff", "#2a2a2a", "#f8d830"]], ["lorikeet", ["#2ab84a", "#3a4ad8", "#f06a20", "#141414", "#e83030"]]],
    temper: { preen: 2.4, sing: 2, eat: 1.6, flap: 1.6, look: 1.2, hang: 0.8, fly: 1.6 }, friends: ["monkey", "kangaroo", "koala"] }),
  gull: define({ label: "Gull", plan: "bird", size: 0.32, rarity: "common", weight: 36, regions: ["atlantic", "sydney", "bali", "tokyo"], worlds: ["beach", "city", "nature"], speed: 1.2, groups: [4, 3, 1, 3], pack: [3, 5],
    build: { len: 1.2, leg: 0.24, body: 0.19, neck: 0.12, rise: 0.4, head: 0.14, snout: 0.18, ears: "none", tail: "fan", tailLen: 0.36 },
    coats: [["herring", ["#f4f4f2", "#9aa4ae", "#ffffff", "#141414", "#f0c030"]], ["black-backed", ["#f4f4f2", "#2a2e34", "#ffffff", "#141414", "#f0c030"]]],
    temper: { look: 2, peck: 1.8, flap: 1.6, sing: 1.4, preen: 1.2, fly: 2.6 }, friends: ["crab"] }),
  peacock: define({ label: "Peacock", plan: "bird", size: 0.55, rarity: "epic", weight: 5, regions: ["bali"], speed: 0.7, groups: [5, 4, 2, 0],
    build: { len: 1, leg: 0.3, body: 0.18, neck: 0.3, rise: 1.1, head: 0.1, snout: 0.1, ears: "none", tail: "fan", tailLen: 1.2, extras: ["crown", "train"] },
    coats: [["indian", ["#1a5ad8", "#2a8a5a", "#1a4ab8", "#0a1020", "#e8c040"]], ["white", ["#f8f8f4", "#e8e8e2", "#ffffff", "#2a2a2a", "#f0f0ea"]]],
    temper: { display: 3, peck: 1.8, look: 1.4, preen: 1.2, wander: 1, fly: 0.3, sing: 0 }, friends: [] }),
  crane: define({ label: "Crane", plan: "bird", size: 0.85, rarity: "epic", weight: 6, regions: ["tokyo", "nairobi"], speed: 0.8, groups: [3, 6, 2, 0],
    build: { len: 0.85, leg: 0.55, body: 0.16, neck: 0.55, rise: 1.2, head: 0.07, snout: 0.16, ears: "none", tail: "fan", tailLen: 0.3, extras: ["longneck", "crown"] },
    coats: [["red-crowned", ["#f6f6f2", "#1a1a1a", "#ffffff", "#141414", "#e02828"]], ["grey crowned", ["#8a9098", "#f4f4f0", "#a0a6ae", "#141414", "#e8c040"]]],
    temper: { display: 2.2, peck: 2, preen: 1.6, look: 1.4, flap: 1.2, fly: 1.2, wander: 1.2, hop: 0, sing: 0 }, friends: ["deer", "dikdik"] }),
  woodpecker: define({ label: "Woodpecker", plan: "bird", size: 0.18, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "alps", "tokyo"], speed: 1, groups: [8, 2, 1, 0],
    build: { len: 1.1, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.6, head: 0.15, snout: 0.22, ears: "none", tail: "fan", tailLen: 0.5, extras: ["crest"] },
    coats: [["downy", ["#1e1e20", "#f4f4f0", "#f4f4f0", "#0e0e10", "#e02828"]], ["green", ["#6a8a3a", "#4a6a2a", "#c8d098", "#1a1a10", "#e02828"]]],
    temper: { drum: 4, look: 1.2, preen: 1, fly: 1.4, peck: 0, hop: 0, sing: 0 }, friends: ["squirrel"] }),
  snake: define({ label: "Snake", plan: "serpent", size: 1.1, rarity: "rare", weight: 9, regions: ["nairobi", "bali", "sydney", "rockies"], worlds: ["nature", "voxel", "beach"], speed: 0.35, winter: false, climbs: true,
    build: { len: 1, leg: 0, body: 0.034, neck: 0, rise: 0, head: 0.048, snout: 0.03, ears: "none", tail: "thin", tailLen: 0.3 },
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
  // ---- local animals, so each region has its own cast (builds are first drafts from the shared parts)
  tanuki: define({ label: "Tanuki", plan: "quad", size: 0.3, rarity: "uncommon", weight: 16, regions: ["tokyo"], worlds: ["nature", "voxel", "city"], speed: 1, active: "night", groups: [4, 5, 3, 0],
    build: { len: 1.25, leg: 0.42, body: 0.36, neck: 0.16, rise: 0.55, head: 0.22, snout: 0.17, ears: "round", tail: "bushy", tailLen: 0.55, hip: 1.02, extras: ["mask"], foot: "paw", sit: "dog", tailGirth: 1.2, tailRise: -0.4 },
    coats: [["tanuki", ["#8a6c4a", "#4a3828", "#c8b08c", "#1a120c", "#e8dcc4"]], ["winter", ["#9a8060", "#5a4430", "#d8c4a4", "#1e140c", "#f0e6d4"]]],
    temper: { sniff: 2.2, dig: 1.6, eat: 1.4, sleep: 1.4, groom: 1.4, wander: 1.3, look: 1.2, graze: 0, run: 0.4 }, friends: ["crow"] }),
  marmot: define({ label: "Marmot", plan: "quad", size: 0.26, rarity: "uncommon", weight: 18, regions: ["alps", "rockies"], speed: 1, winter: false, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { len: 1.3, leg: 0.36, body: 0.42, neck: 0.12, rise: 0.5, head: 0.25, snout: 0.13, ears: "round", tail: "bushy", tailLen: 0.5, hip: 1.1, foot: "plant", sit: "haunch", haunch: 1.25, snoutTip: 0.8, earLen: 0.7 },
    coats: [["alpine", ["#8a6e4e", "#5e4a34", "#c8a878", "#1e160e", "#e8dcc8"]], ["yellow-bellied", ["#7a6450", "#4e3e30", "#d8a850", "#1a140e", "#efe4cc"]]],
    temper: { rear: 3, bask: 2, graze: 2, look: 2, groom: 1.2, dig: 1.4, run: 1.2, sleep: 1, wander: 0.8 }, friends: ["crow"] }),
  badger: define({ label: "Badger", plan: "quad", size: 0.3, rarity: "rare", weight: 9, regions: ["alps"], speed: 0.9, active: "night", groups: [5, 3, 3, 0],
    build: { len: 1.35, leg: 0.34, body: 0.4, neck: 0.15, rise: 0.35, head: 0.2, snout: 0.24, ears: "round", tail: "puff", tailLen: 0.22, hip: 1, extras: ["mask", "stripes"], foot: "plant", sit: "lie", snoutTip: 0.35, earLen: 0.6 },
    coats: [["badger", ["#9a9a98", "#2a2a2a", "#2a2826", "#121212", "#f4f4f0"]]],
    temper: { dig: 3, sniff: 2.4, groom: 1.2, sleep: 1.2, wander: 1.3, roll: 0.5, graze: 0, sit: 0.4, run: 0.3 }, friends: [] }),
  skunk: define({ label: "Skunk", plan: "quad", size: 0.2, rarity: "uncommon", weight: 12, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", groups: [7, 1, 3, 0],
    build: { len: 1.3, leg: 0.4, body: 0.38, neck: 0.12, rise: 0.5, head: 0.22, snout: 0.2, ears: "round", tail: "bushy", tailLen: 1.1, hip: 1.12, extras: ["stripes"], foot: "plant", sit: "haunch", tailGirth: 1.4, tailRise: 0.6, snoutTip: 0.4 },
    coats: [["striped", ["#1a1a1c", "#f4f4f0", "#2a2a2c", "#0a0a0a", "#f4f4f0"]]],
    temper: { dig: 2.4, sniff: 2.4, groom: 1, wander: 1.2, graze: 0, run: 0.2, look: 0.8 }, friends: [] }),
  possum: define({ label: "Brushtail possum", plan: "quad", size: 0.26, rarity: "uncommon", weight: 14, regions: ["sydney"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", climbs: true, groups: [7, 2, 3, 0],
    build: { len: 1.3, leg: 0.42, body: 0.32, neck: 0.14, rise: 0.6, head: 0.22, snout: 0.16, ears: "point", tail: "bushy", tailLen: 1.1, hip: 1.05, foot: "plant", sit: "haunch", earLen: 1.2, tailGirth: 0.9, tailRise: -0.3 },
    coats: [["brushtail", ["#8a8a88", "#5a5a58", "#e8e4dc", "#1a1a1a", "#2a2624"]], ["copper", ["#9a6a4a", "#6a4430", "#e8d8c4", "#1e140c", "#2a1a10"]]],
    temper: { climb: 2.8, eat: 2.2, sit: 1.4, look: 1.6, sleep: 1.2, groom: 1.4, graze: 0, run: 0.4 }, friends: ["koala"] }),
  kookaburra: define({ label: "Kookaburra", plan: "bird", size: 0.36, rarity: "uncommon", weight: 16, regions: ["sydney"], worlds: ["nature", "voxel", "city", "beach"], speed: 1, groups: [3, 4, 3, 3], pack: [3, 5],
    build: { len: 1, leg: 0.18, body: 0.24, neck: 0.08, rise: 0.5, head: 0.24, snout: 0.24, ears: "none", tail: "fan", tailLen: 0.55 },
    coats: [["laughing", ["#e2d6c0", "#6a5034", "#f4eee2", "#2a2018", "#4a7ab8"]]],
    temper: { sing: 3, look: 2.6, preen: 1.2, fly: 1.4, peck: 0.6, hop: 0.3 }, friends: ["kangaroo"] }),
  mongoose: define({ label: "Banded mongoose", plan: "quad", size: 0.18, rarity: "uncommon", weight: 16, regions: ["nairobi"], speed: 1.8, groups: [1, 2, 2, 7], pack: [4, 7],
    build: { len: 1.5, leg: 0.36, body: 0.26, neck: 0.2, rise: 0.6, head: 0.18, snout: 0.22, ears: "round", tail: "thin", tailLen: 0.9, hip: 1, extras: ["stripes"], foot: "paw", sit: "haunch", snoutTip: 0.35, earLen: 0.6 },
    coats: [["banded", ["#7a6e5e", "#4a4034", "#a89a84", "#1a1610", "#c8bca4"]]],
    temper: { rear: 2.2, dig: 2.4, sniff: 2.4, look: 1.6, groom: 1.6, run: 1.4, play: 1.4, bask: 1, graze: 0 }, friends: ["guineafowl"] }),
  dikdik: define({ label: "Dik-dik", plan: "quad", size: 0.4, rarity: "rare", weight: 12, regions: ["nairobi"], speed: 1.2, groups: [3, 7, 2, 0],
    build: { len: 1, leg: 0.75, body: 0.2, neck: 0.4, rise: 0.95, head: 0.15, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.12, foot: "hoof", sit: "lie", legR: 0.6, earLen: 1.2, snoutTip: 0.5 },
    coats: [["kirk", ["#a08468", "#7a6048", "#e8dccb", "#241a12", "#f4ece0"]]],
    temper: { graze: 2.4, look: 2.4, groom: 1, lie: 1.4, run: 0.6, sit: 0, dig: 0, roll: 0 }, friends: ["guineafowl", "songbird"] }),
  guineafowl: define({ label: "Guineafowl", plan: "bird", size: 0.5, rarity: "uncommon", weight: 14, regions: ["nairobi"], speed: 1, groups: [1, 2, 1, 8], pack: [4, 7],
    build: { len: 1, leg: 0.3, body: 0.3, neck: 0.22, rise: 0.7, head: 0.11, snout: 0.08, ears: "none", tail: "fan", tailLen: 0.2, extras: ["spots", "crown"] },
    coats: [["helmeted", ["#4a4e5c", "#3a3e4a", "#5e6270", "#101216", "#5a8ae0"]]],
    temper: { peck: 3, wander: 2, look: 1.4, preen: 1, sing: 1, fly: 0.3, hop: 0.3 }, friends: ["dikdik", "mongoose"] }),
  loris: define({ label: "Slow loris", plan: "primate", size: 0.24, rarity: "epic", weight: 6, regions: ["bali"], worlds: ["nature", "beach", "voxel"], speed: 0.15, active: "night", climbs: true, groups: [8, 1, 2, 0],
    build: { len: 0.6, leg: 0.4, body: 0.24, neck: 0.08, head: 0.18, snout: 0.05, ears: "round", tail: "none", tailLen: 0.05, extras: ["mask"] },
    coats: [["javan", ["#b89a78", "#8a6c4e", "#e8d8c0", "#3a2416", "#f4ecdc"]]],
    temper: { hang: 2.4, climb: 2.4, eat: 1.6, sleep: 2.4, look: 1.2, groom: 1.4, wander: 0.2 }, friends: [] }),
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
  // A hunter's creep ends in a pounce (a run or a hop) or a dig at what it heard; it never just stops and sleeps.
  stalk: { dig: 3, sniff: 2, run: 1.6, hop: 1.4, look: 1.4, stalk: 0, sleep: 0, lie: 0.3 },
  rear: { look: 1.6, rear: 0.3, run: 1.3, sleep: 0.1 },
  sing: { fly: 1.4, preen: 1.3, sing: 0.5 },
  dig: { eat: 1.6, sniff: 1.4, dig: 0.5 },
  eat: { groom: 1.6, sit: 1.3, eat: 0.5 },
  // A flight ends looking about, preening or singing where it landed, and seldom straight off again.
  fly: { look: 1.6, preen: 1.4, sing: 1.3, peck: 1.2, fly: 0.25 },
  climb: { eat: 1.6, sit: 1.4, look: 1.4, hang: 1.3 },
};

const SPAN: Readonly<Record<Action, readonly [number, number]>> = {
  stand: [2, 5], look: [2, 4.5], sniff: [1.5, 3.5], graze: [4, 10], groom: [3, 7], scratch: [1.5, 3], sit: [4, 10], lie: [6, 14],
  sleep: [12, 30], stretch: [1.8, 2.6], shake: [0.9, 1.3], yawn: [1.4, 2], rear: [2, 5], dig: [2, 5], roll: [2.5, 4], howl: [3, 5],
  eat: [3, 8], peck: [1.2, 3], preen: [2, 5], flap: [1, 2], sing: [2, 4.5], display: [5, 9], drum: [1.5, 3.5], bask: [6, 14],
  coil: [6, 12], flick: [1, 2], hover: [2, 5], wave: [1.5, 3], hang: [6, 16], nuzzle: [2.5, 4], play: [1.6, 2.6],
  wander: [2, 5], run: [1, 2], hop: [1, 2.5], climb: [3, 6], fly: [2, 4], stalk: [2, 4],
};

/** Actions that only make sense on the ground; an animal up a tree comes down first. */
const GROUNDED: ReadonlySet<Action> = new Set<Action>(["graze", "dig", "roll", "run", "wander", "hop", "display", "wave", "play", "stretch", "stalk"]);

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

/** What the hour and the sky are doing: night, rain or snow, and the half-light of dawn and dusk. */
export interface Mood {
  readonly night?: boolean | undefined;
  readonly weather?: string | undefined;
  readonly twilight?: boolean | undefined;
}

/** Rain sends animals to rest and shelter (a bird sits it out preening, a butterfly folds its wings); snow slows everything and sets the hungry digging. */
const WET: Partial<Record<Action, number>> = { sit: 1.8, lie: 1.6, sleep: 1.5, preen: 2, shake: 3, groom: 1.4, hang: 1.5, coil: 1.5, play: 0.3, display: 0.3, sing: 0.4, bask: 0.1, hover: 0.25 };
const SNOWY: Partial<Record<Action, number>> = { lie: 1.8, sleep: 1.8, sit: 1.4, dig: 1.8, shake: 2, play: 0.6, bask: 0.2, display: 0.4, sing: 0.5, graze: 0.8 };
/** At dawn and dusk the birds sing, the wolves howl and the kookaburras laugh; the deer come out to graze. */
const TWILIGHT: Partial<Record<Action, number>> = { sing: 3, howl: 2.5, graze: 1.4, look: 1.2, drum: 1.5, display: 1.3, sleep: 0.6 };

function columnWeight(spec: SpeciesSpec, action: Action, mood: Mood): number {
  const base = PLAN_ACTIONS[spec.plan][action] ?? 0.6;
  const temper = spec.temper[action] ?? 1;
  const night = mood.night === true;
  const asleepNow = spec.active !== "any" && (spec.active === "day") === night;
  const sky = skyWeight(action, mood);
  const hour = mood.twilight === true ? TWILIGHT[action] ?? 1 : 1;
  if (!asleepNow) return base * temper * sky * hour;
  const drowsy: Partial<Record<Action, number>> = { sleep: 8, lie: 3, sit: 2, hang: 3, coil: 3, hover: 0.1 };
  return base * temper * sky * hour * (drowsy[action] ?? (MOVES.has(action) ? 0.15 : 0.35));
}

/** How the weather weighs an action: rain and snow keep animals still, and fliers out of the air. */
function skyWeight(action: Action, mood: Mood): number {
  const moving = MOVES.has(action);
  if (mood.weather === "rain") return WET[action] ?? (action === "fly" ? 0.3 : moving ? 0.5 : 1);
  if (mood.weather === "snow") return SNOWY[action] ?? (moving ? 0.6 : 1);
  return 1;
}

function matrixOf(spec: SpeciesSpec, mood: Mood): IdleMatrix {
  const actions = actionsOf(spec);
  const columns = actions.map((action) => columnWeight(spec, action, mood));
  const rows = actions.map((from) => {
    const flow = FLOW[from] ?? {};
    const raw = actions.map((to, j) => (columns[j] ?? 0) * (flow[to] ?? (to === from ? 0.25 : 1)));
    const total = raw.reduce((sum, value) => sum + value, 0) || 1;
    return raw.map((value) => value / total);
  });
  return { actions, rows };
}

/**
 * The animal's matrix of idle actions: which action follows which, and how
 * often. A sleeping row leads to waking things, a lying row to sleep or a roll,
 * and at the wrong time of day (an owl at noon, a deer at midnight) every row
 * leans toward rest. Rain and snow lean it toward shelter and rest too, and
 * dawn and dusk toward song.
 */
export function idleMatrix(id: SpeciesId, mood: Mood = {}): IdleMatrix {
  return matrixOf(speciesOf(id), mood);
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
  /** The weather ("rain" and "snow" send animals to shelter and rest; anything else is fair). */
  readonly weather?: string | undefined;
  /** The sun's height above the horizon, in degrees: dawn and dusk bring the birds' chorus and the wolves' howl. */
  readonly sun?: number | undefined;
  /**
   * Toward the viewer, along the ground. Given, an animal choosing a spot
   * leans toward the open side of the tree, where it can be seen, rather
   * than behind the trunk.
   */
  readonly view?: Vec | undefined;
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
  tanuki: "ground", marmot: "ground", badger: "ground", skunk: "ground", possum: "both", mongoose: "ground", dikdik: "ground",
  guineafowl: "ground", loris: "tree",
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

const turnTo = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** A heading to look for a spot along: toward the viewer, when there is one, of three picks the nearest to it, so the far side is rarer, not barred. */
function headingFor(rand: () => number, stage: Stage): number {
  if (!stage.view) return rand() * TAU;
  const view = Math.atan2(stage.view[2], stage.view[0]);
  let best = rand() * TAU;
  for (let i = 0; i < 2; i += 1) {
    const a = rand() * TAU;
    if (turnTo(a, view) < turnTo(best, view)) best = a;
  }
  return best;
}

/** A free spot on the ground, clear of the trunk, the rim and the others. */
function groundSpot(rand: () => number, stage: Stage, size: number, near?: Vec, reach = 0, taken: readonly Spot[] = []): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.2, stage.radius - size * 0.8);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const a = headingFor(rand, stage);
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
 * Out of the trunk's wood at its own height, following its spine, by
 * `margin` past the bark: a flight never passes through the trunk, though
 * at its ends (margin 0) it may come right onto the bark.
 */
function offTrunk(stage: Stage, p: Vec, margin: number): Vec {
  const trunk = stage.trunk;
  if (!trunk || p[1] > trunk.top[1] + margin) return p;
  const axis = trunkAxis(trunk, trunkShare(trunk, p[1]));
  const need = axis.r + margin;
  const dx = p[0] - axis.p[0];
  const dz = p[2] - axis.p[2];
  const d = Math.hypot(dx, dz);
  if (d >= need) return p;
  if (d < 1e-4) return [axis.p[0] + need, p[1], axis.p[2]];
  return [axis.p[0] + (dx / d) * need, p[1], axis.p[2] + (dz / d) * need];
}

/** How far a flier keeps off the bark `g` of the way along its flight: its own size and a little, fading to nothing at the ends. */
const barkRoom = (size: number, g: number): number => (size * 0.3 + 0.04) * smooth(clamp(Math.min(g, 1 - g) / 0.2, 0, 1));

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
  // (Climbing, at most about one up for two across, so even a big bird winds up to a high branch on a wide loop.)
  const needed = Math.abs(rise) * (rise > 0 ? 1.8 : 1.4) + 0.6;
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
  const keys = [a.p, a.p, leave, near, b.p, b.p].map((p) => withinReach(stage, p));
  const legs = keys.length - 3;
  const points: PathPoint[] = [];
  for (let i = 0; i <= legs * 10; i += 1) {
    const leg = Math.min(legs - 1, Math.floor(i / 10));
    const p = catmull(keys[leg] ?? a.p, keys[leg + 1] ?? a.p, keys[leg + 2] ?? b.p, keys[leg + 3] ?? b.p, i / 10 - leg);
    // Never through the ground on the way, only off it and onto it at the ends.
    const g = i / (legs * 10);
    const lift = size * 0.3 * Math.min(1, g / 0.15, (1 - g) / 0.15);
    const q = offTrunk(stage, withinReach(stage, p), barkRoom(size, g));
    points.push({ p: [q[0], Math.max(q[1], bareY(stage, q[0], q[2]) + lift), q[2]], up: UP });
  }
  return points;
}

/** Held within a flier's circle round the tree (the crown's reach and a little), so a long climb to a high branch stays in the picture. */
function withinReach(stage: Stage, p: Vec): Vec {
  const crown = crownOf(stage);
  const cap = crown.reach + 2.6;
  const r = Math.hypot(p[0] - crown.c[0], p[2] - crown.c[2]);
  return r <= cap ? p : [crown.c[0] + ((p[0] - crown.c[0]) * cap) / r, p[1], crown.c[2] + ((p[2] - crown.c[2]) * cap) / r];
}

/**
 * A flight's shape beyond its two ends. A `sortie` is a bird's flight out
 * round the tree: past the crown to a circle of radius `R` about the trunk,
 * at height `h` (rising `climb` over it and coming down again, as a gull
 * rides a thermal), `laps` times round in `dir`, its circle wandering in and
 * out by `wobble`. A `flutter` is a butterfly's (or a firefly's) looping
 * way, kept under `ceiling` and within `reach` of the trunk.
 */
type Loop =
  | { readonly kind: "sortie"; readonly R: number; readonly cap?: number; readonly h: number; readonly climb: number; readonly laps: number; readonly dir: number; readonly wobble: number; readonly seed: number; readonly start?: Vec }
  | { readonly kind: "flutter"; readonly seed: number; readonly loops: number; readonly ceiling: number; readonly reach: number };

/** How far out and how high the tree's crown reaches, about the trunk's foot: where a bird flies to be clear of it. */
function crownOf(stage: Stage): { readonly reach: number; readonly top: number; readonly low: number; readonly c: Vec } {
  const c: Vec = stage.trunk?.base ?? [0, stage.top, 0];
  let reach = trunkR(stage) + 0.6;
  let top = stage.trunk?.top[1] ?? stage.top + 1.5;
  let low = Infinity;
  for (const perch of stage.perches ?? []) {
    reach = Math.max(reach, Math.hypot(perch.p[0] - c[0], perch.p[2] - c[2]));
    top = Math.max(top, perch.p[1]);
    low = Math.min(low, perch.p[1]);
  }
  return { reach, top, low: Number.isFinite(low) ? low : top, c };
}

/** Catmull-Rom through keys, ten points a span, kept off the ground and out of the trunk except where it starts and ends, and inside `out`'s bounds when given. */
function smoothWay(keys: readonly Vec[], stage: Stage, size: number, out?: (p: Vec) => Vec): PathPoint[] {
  const legs = keys.length - 3;
  const points: PathPoint[] = [];
  const first = keys[0] ?? [0, 0, 0];
  const last = keys[keys.length - 1] ?? first;
  for (let i = 0; i <= legs * 10; i += 1) {
    const leg = Math.min(legs - 1, Math.floor(i / 10));
    const p = catmull(keys[leg] ?? first, keys[leg + 1] ?? first, keys[leg + 2] ?? last, keys[leg + 3] ?? last, i / 10 - leg);
    const g = i / (legs * 10);
    const lift = size * 0.3 * Math.min(1, g / 0.08, (1 - g) / 0.08);
    const q = offTrunk(stage, out ? out(p) : p, barkRoom(size, g));
    points.push({ p: [q[0], Math.max(q[1], bareY(stage, q[0], q[2]) + lift), q[2]], up: UP });
  }
  return points;
}

/** Which way round a sortie goes and how far: its own way, its laps and on to where it comes in; going home, the short way. */
function sortieTurn(loop: Extract<Loop, { kind: "sortie" }>, from: number, to: number): { dir: number; sweep: number } {
  const wrap = (v: number): number => Math.atan2(Math.sin(v), Math.cos(v));
  if (loop.start) {
    const short = wrap(to - from);
    return { dir: short < 0 ? -1 : 1, sweep: Math.max(0.3, Math.abs(short)) };
  }
  const base = loop.laps * TAU;
  return { dir: loop.dir, sweep: Math.max(1.2, base + wrap(loop.dir * (to - from) - base)) };
}

/**
 * A sortie: it drops off its branch (or springs up off the ground) and
 * swings out from the tree, widens onto its circle round the crown, goes
 * round it at its own height and back in to land: from a little below a
 * branch to swoop up onto it, or from above the ground to drop onto it. The
 * circle ends where it comes in, so it turns home on its way round.
 */
function sortiePath(a: Anchor, b: Anchor, stage: Stage, size: number, loop: Extract<Loop, { kind: "sortie" }>, fromWood: boolean, onWood: boolean): PathPoint[] {
  const c = stage.trunk?.base ?? [0, stage.top, 0];
  const outward = (p: Vec): Vec => unit([p[0] - c[0], 0, p[2] - c[2]], [1, 0, 0]);
  const clear = trunkClear(stage, size) * 1.4;
  // (Called home mid-flight, it sets off from where it is in the air.)
  const from = loop.start ?? a.p;
  const leave = loop.start ?? roundTrunk(add(madd(a.p, outward(a.p), 1.1 + size), [0, fromWood ? -0.3 : 0.7, 0]), clear);
  const near = roundTrunk(add(madd(b.p, outward(b.p), 1.2 + size), [0, onWood ? -0.3 : 0.6, 0]), clear);
  const angleOf = (p: Vec): number => Math.atan2(p[2] - c[2], p[0] - c[0]);
  const radiusOf = (p: Vec): number => Math.hypot(p[0] - c[0], p[2] - c[2]);
  const t0 = angleOf(leave);
  const { dir, sweep } = sortieTurn(loop, t0, angleOf(near));
  const steps = Math.max(3, Math.ceil(sweep / 0.6));
  const keys: Vec[] = loop.start ? [from, from] : [from, from, leave];
  for (let i = 1; i < steps; i += 1) {
    const s = i / steps;
    const angle = t0 + dir * sweep * s;
    const k = smooth(Math.min(1, (sweep * s) / 1.1, (sweep * (1 - s)) / 1.1));
    const end = s < 0.5 ? leave : near;
    const R = mix(radiusOf(end), Math.min(loop.cap ?? Infinity, loop.R * (1 + loop.wobble * Math.sin(angle * 2 + loop.seed * TAU))), k);
    const h = mix(end[1], loop.h + loop.climb * Math.sin(Math.PI * s) + 0.3 * Math.sin(angle * 3 + loop.seed * 9), k);
    keys.push([c[0] + Math.cos(angle) * R, h, c[2] + Math.sin(angle) * R]);
  }
  keys.push(near, b.p, b.p);
  // (The curve through the keys swings a little wide of them: held to the cap too, so it stays in the picture.)
  const cap = loop.cap;
  const inside = cap === undefined ? undefined : (p: Vec): Vec => {
    const r = radiusOf(p);
    return r <= cap ? p : [c[0] + ((p[0] - c[0]) * cap) / r, p[1], c[2] + ((p[2] - c[2]) * cap) / r];
  };
  return smoothWay(keys, stage, size, inside);
}

/**
 * A butterfly's way: a wandering line of seeded jinks to either side and up
 * and down, with a loop-the-loop now and then, kept low (under its
 * `ceiling`) and near the tree.
 */
function flutterPath(a: Anchor, b: Anchor, stage: Stage, size: number, loop: Extract<Loop, { kind: "flutter" }>): PathPoint[] {
  const rand = createRandom(Math.floor(loop.seed * 4294967295) >>> 0);
  const c = stage.trunk?.base ?? [0, stage.top, 0];
  const way = sub(b.p, a.p);
  const fw = unit([way[0], 0, way[2]], [0, 0, 1]);
  const side = unit(cross(UP, fw), [1, 0, 0]);
  const n = clamp(Math.round(length(way) / 0.7), 1, 4);
  const keep = (p: Vec): Vec => {
    const off = Math.hypot(p[0] - c[0], p[2] - c[2]);
    const k = off > loop.reach ? loop.reach / off : 1;
    const x = c[0] + (p[0] - c[0]) * k;
    const z = c[2] + (p[2] - c[2]) * k;
    return [x, clamp(p[1], bareY(stage, x, z) + 0.05, Math.max(loop.ceiling, a.p[1], b.p[1])), z];
  };
  const keys: Vec[] = [a.p, a.p];
  for (let i = 1; i <= n; i += 1) {
    const u = i / (n + 1);
    const p = keep(madd(add(lerpV(a.p, b.p, u), [0, Math.sin(u * Math.PI) * 0.35 + (rand() - 0.5) * 0.4, 0]), side, (rand() - 0.5) * 1.1));
    keys.push(p);
    if (i === loop.loops) {
      const r = 0.22 + rand() * 0.22;
      const turn = rand() < 0.5 ? -1 : 1;
      for (const q of [0.25, 0.5, 0.75]) {
        const angle = q * TAU;
        keys.push(keep(add(madd(madd(p, side, turn * r * (1 - Math.cos(angle))), fw, r * Math.sin(angle)), [0, r * 0.5 * Math.sin(angle), 0])));
      }
      keys.push(p);
    }
  }
  keys.push(b.p, b.p);
  return smoothWay(keys, stage, size);
}

/** A flier's up as it banks into a turn: tipped toward the turn's middle by how hard it turns at its speed. */
function bankedUp(before: Vec, after: Vec, ds: number, speed: number): Vec {
  const lean = scale(sub(flat(after), flat(before)), (speed * speed) / (4 * Math.max(ds, 1e-3)));
  const l = length(lean);
  return unit(add(UP, l > 1.1 ? scale(lean, 1.1 / l) : lean), UP);
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
  /** A flight's shape beyond its ends: out round the tree, or a flutter. */
  readonly loop?: Loop;
}

interface Actor {
  readonly index: number;
  readonly member: CastMember;
  readonly spec: SpeciesSpec;
  readonly rand: () => number;
  readonly day: IdleMatrix;
  readonly night: IdleMatrix;
  /** Its matrices for the other moods of the sky and the hour (rain, snow, dawn and dusk), made as they come up. */
  readonly moods: Map<string, IdleMatrix>;
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

function pathFor(mode: MoveMode, from: Place, to: Place, scene: Scene, size: number, spring = 0, loop?: Loop): PathPoint[] {
  const a = anchorOf(from, scene.stage, scene.backs);
  const b = anchorOf(to, scene.stage, scene.backs);
  const onWood = to.on === "perch" || to.on === "trunk";
  if (mode === "fly" && loop?.kind === "sortie") return sortiePath(a, b, scene.stage, size, loop, from.on !== "ground", onWood);
  if (mode === "fly" && loop?.kind === "flutter") return flutterPath(a, b, scene.stage, size, loop);
  if (mode === "fly") return flyPath(a, b, scene.stage, size, onWood);
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

const PACE: Partial<Record<Action, number>> = { run: 3.2, hop: 1.4, fly: 4, climb: 0.8, stalk: 0.35 };

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

/** `loop` shapes a flight (a sortie round the tree); `speed` (scene units a second) then sets its pace. */
function leg(actor: Actor, there: Place, act: Action, scene: Scene, hurry: number, loop?: Loop, speed?: number): void {
  const to: Place = there.on === "ground" ? onGround(scene.stage, actor.member.size, there.x, there.z) : there;
  const mode = modeFor(actor, act, actor.place, to);
  // A bug never flies straight: it flutters, on its own seeded jinks and loops.
  const way = loop ?? (mode === "fly" && actor.spec.plan === "bug" ? flutterOf(actor, scene) : undefined);
  const path = pathFor(mode, actor.place, to, scene, actor.member.size, springOf(actor), way);
  const pace = speed !== undefined && mode === "fly" ? speed / actor.member.size : actor.spec.speed * (PACE[act] ?? 1) * hurry * (mode === "fly" ? 2.5 : 1);
  const duration = Math.max(0.5, pathLength(path) / Math.max(0.02, pace * actor.member.size));
  const end = alongPath(path, 1);
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to, yaw: actor.yaw, face: -1, mode, pace, ...(way && mode === "fly" ? { loop: way } : {}) });
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

/** Fliers that never sit in a tree: a crane stands on the ground, and comes and goes from the sky. */
const GROUND_BIRDS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["crane"]);

/**
 * Where a bug goes next: a firefly keeps low over the grass, a butterfly
 * visits the crown's lower blossoms or drops to the flowers on the ground,
 * never the treetop.
 */
function bugSpot(actor: Actor, scene: Scene): Place {
  const stage = scene.stage;
  const firefly = actor.spec.build.extras.includes("glowtail");
  const crown = crownOf(stage);
  const near = placeTop(actor.place, scene);
  if (perchCount(scene) > 0 && actor.rand() < (firefly ? 0.15 : 0.5)) {
    const ceiling = firefly ? stage.top + 2.6 : crown.low + 1.5;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const i = Math.floor(actor.rand() * 9973);
      const perch = perchOf(stage, i);
      if (perch && perch.p[1] <= ceiling) return { on: "perch", i };
    }
  }
  return groundSpot(actor.rand, stage, actor.member.size, near, firefly ? 1.4 : 2.2, takenBy(actor, scene));
}

/** A bug's flutter, seeded: where its loop comes, and how high and far out it may go. */
function flutterOf(actor: Actor, scene: Scene): Loop {
  const crown = crownOf(scene.stage);
  const firefly = actor.spec.build.extras.includes("glowtail");
  return { kind: "flutter", seed: actor.rand(), loops: actor.rand() < (firefly ? 0.3 : 0.6) ? 1 + Math.floor(actor.rand() * 2) : 0, ceiling: firefly ? scene.stage.top + 2.4 : Math.min(crown.top, crown.low + 1.6), reach: crown.reach + 1 };
}

/**
 * How each bird goes out round the tree (see `sortie`): the share of its
 * flights that are sorties, how far past the crown it circles (scene
 * units), how many times round, at what height (a share of the way from the
 * ground to the crown's top), how much it climbs on the way, its speed
 * (units a second) and how much its circle wanders. An owl, now and then,
 * drops onto something on the ground instead and goes straight back up
 * (`pounce`). A crow wheels lazily and wide, a gull soars high, rising on its
 * loops; a songbird darts out a little way and back, a parrot fast; an owl
 * glides low and silent; a crane goes slowly round, well out.
 */
interface SortieStyle {
  readonly odds: number;
  readonly out: readonly [number, number];
  readonly laps: readonly [number, number];
  readonly height: readonly [number, number];
  readonly climb: number;
  readonly speed: number;
  readonly wobble: number;
  readonly pounce?: number;
}
const SORTIES: Partial<Record<SpeciesId, SortieStyle>> = {
  songbird: { odds: 0.6, out: [0.9, 1.8], laps: [0.3, 0.8], height: [0.35, 0.8], climb: 0.3, speed: 4.4, wobble: 0.12 },
  woodpecker: { odds: 0.4, out: [0.8, 1.6], laps: [0.25, 0.6], height: [0.3, 0.6], climb: 0, speed: 3.4, wobble: 0.1 },
  parrot: { odds: 0.65, out: [1, 2.2], laps: [0.6, 1.3], height: [0.5, 1], climb: 0.5, speed: 5, wobble: 0.15 },
  crow: { odds: 0.45, out: [1.2, 2.4], laps: [0.5, 1], height: [0.65, 1.05], climb: 0.6, speed: 3.3, wobble: 0.18 },
  gull: { odds: 0.65, out: [1.5, 2.4], laps: [0.7, 1.4], height: [0.8, 1.1], climb: 1.2, speed: 3.6, wobble: 0.1 },
  owl: { odds: 0.45, out: [0.6, 1.4], laps: [0.3, 0.7], height: [0.12, 0.3], climb: 0, speed: 2.5, wobble: 0.2, pounce: 0.45 },
  crane: { odds: 0.8, out: [1.3, 2.4], laps: [0.6, 1.1], height: [0.45, 0.8], climb: 0.8, speed: 2.5, wobble: 0.08 },
  // (A kookaburra, like a kingfisher, mostly watches from its branch and drops on what moves below.)
  kookaburra: { odds: 0.6, out: [0.8, 1.6], laps: [0.3, 0.7], height: [0.4, 0.7], climb: 0, speed: 3.8, wobble: 0.12, pounce: 0.6 },
};

/**
 * A flight out round the tree instead of to the next branch: off its perch
 * (or up off the ground), out past the crown, round on its own loops at its
 * own height, banking into the turn, and back in to a branch or the ground.
 * An owl may drop onto the ground and go straight back to its branch
 * instead. False when this flight is to be a plain one.
 */
function sortie(actor: Actor, scene: Scene): boolean {
  const style = SORTIES[actor.member.species];
  const stage = scene.stage;
  if (!style || !stage.trunk || actor.rand() >= style.odds) return false;
  const rand = actor.rand;
  const size = actor.member.size;
  const home = actor.place;
  const ground = (): Place => groundSpot(rand, stage, size, undefined, 0, takenBy(actor, scene));
  if (style.pounce !== undefined && home.on === "perch" && rand() < style.pounce) {
    travel(actor, ground(), "fly", scene);
    stay(actor, "peck", between(rand, [0.8, 1.6]));
    travel(actor, home, "fly", scene);
    return true;
  }
  const crown = crownOf(stage);
  const to = GROUND_BIRDS.has(actor.member.species) || perchCount(scene) === 0 || rand() < 0.2 ? ground() : randomPerch(actor, scene);
  // (Never so high it leaves the picture: a little over the treetop at most.)
  const h = clamp(stage.top + between(rand, style.height) * Math.max(1, crown.top - stage.top), stage.top + 0.8, crown.top + 1.2);
  const loop: Loop = {
    kind: "sortie",
    R: Math.min(crown.reach + between(rand, style.out), crown.reach + 2.4),
    cap: crown.reach + 2.6,
    h,
    climb: Math.min(style.climb * between(rand, [0.5, 1]), Math.max(0, crown.top + 1.6 - h)),
    laps: between(rand, style.laps),
    dir: rand() < 0.5 ? -1 : 1,
    wobble: style.wobble,
    seed: rand(),
  };
  leg(actor, to, "fly", scene, 1, loop, style.speed * between(rand, [0.88, 1.12]));
  return true;
}

/** Where a move action takes this animal from where it is. */
function destination(actor: Actor, act: Action, scene: Scene): Place | null {
  const size = actor.member.size;
  const up = actor.place.on !== "ground";
  const perches = perchCount(scene) > 0;
  const perchOr = (odds: number): Place => (perches && actor.rand() < odds ? randomPerch(actor, scene) : groundSpot(actor.rand, scene.stage, size, undefined, 0, takenBy(actor, scene)));
  if (act === "climb") return perches ? perchOr(up ? 0.55 : 1) : null;
  if (actor.spec.plan === "bug") return bugSpot(actor, scene);
  if (act === "fly") return GROUND_BIRDS.has(actor.member.species) ? groundSpot(actor.rand, scene.stage, size, undefined, 0, takenBy(actor, scene)) : perchOr(0.55);
  if (up) return perchOr(actor.spec.climbs ? 0.5 : 0);
  return walkTo(actor, act, scene);
}

/**
 * Where a walk or a run on the ground goes. In rain or snow it keeps in under
 * the tree, near the trunk; a hunter or a grazer roams the lawn (a bold one
 * farther); the rest potter about where they are; a run crosses the ground.
 */
function walkTo(actor: Actor, act: Action, scene: Scene): Place {
  const { stage } = scene;
  const size = actor.member.size;
  if (moodOf(stage).weather !== undefined && stage.trunk && actor.rand() < 0.7) return groundSpot(actor.rand, stage, size, stage.trunk.base, trunkClear(stage, size) + size * 2 + 0.4, takenBy(actor, scene));
  const roam = (ROAMERS.has(actor.member.species) ? 2.2 : 1) * clamp(actor.member.traits.bold, 0.7, 1.4);
  const reach = act === "run" ? stage.radius : Math.max(size * 4, 0.8) * roam;
  return groundSpot(actor.rand, stage, size, placeTop(actor.place, scene), reach, takenBy(actor, scene));
}

/** Ground animals that cover ground: they patrol the lawn's edge rather than shuffle about one spot. */
const ROAMERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["fox", "wolf", "deer", "cat", "bear", "raccoon", "tanuki", "badger", "skunk", "hedgehog", "dikdik", "mongoose", "kangaroo", "crab"]);

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

/** Whether an eater can get at a fruit: off a branch that takes its weight and has room for it, or off the ground, and not already someone's. */
function canReach(actor: Actor, item: Food, scene: Scene, up: boolean): boolean {
  const reach = FRUIT_EATERS[actor.member.species];
  const size = actor.member.size;
  const perch = item.perch;
  if (perch === undefined ? reach === "tree" : !up || (perchOf(scene.stage, perch)?.r ?? 0) < size * 0.12 || !perchRoom(scene.stage, perch, size)) return false;
  return (actor.pantry.get(item.key)?.t ?? -Infinity) <= actor.until;
}

/** The fruit an eater goes for: the nearest it can reach that no one else has claimed, give or take. */
function pickFood(actor: Actor, scene: Scene): Food | null {
  const reach = FRUIT_EATERS[actor.member.species];
  const food = scene.stage.food ?? [];
  if (!reach || food.length === 0) return null;
  const up = reach !== "ground" && (actor.spec.climbs || actor.spec.flies) && perchCount(scene) > 0;
  const here = placeTop(actor.place, scene);
  let best: Food | null = null;
  let nearest = Infinity;
  for (const item of food) {
    if (!canReach(actor, item, scene, up)) continue;
    const d = length(sub(item.p, here)) * (0.75 + actor.rand() * 0.5);
    if (d < nearest) { nearest = d; best = item; }
  }
  return best;
}

/** How far ahead its mouth is, and how low, at its lowest in an eating pose, in units of its size. */
function lowestMouth(id: SpeciesId, act: Action): number {
  let low = Infinity;
  let reach = 0;
  const mouthy = (c: Capsule): boolean => /head|muzzle|snout|beak|jaw|mouth/.test(c.part);
  for (const t of [0.5, 1.5, 2.5, 3.5]) {
    for (const p of poseSpecies(id, act, t).capsules.filter(mouthy).flatMap((c) => [c.a, c.b])) if (p[1] < low) { low = p[1]; reach = p[2]; }
  }
  return reach / memberOf(createRandom(1), id, speciesOf(id).coats[0]?.[0] ?? "", false, {}).size;
}

const MOUTHS = new Map<string, number>();
/** How far ahead of where it stands an animal's mouth comes down when it eats this way, read off its own pose. */
function mouthReach(actor: Actor, act: Action): number {
  const key = `${actor.member.species}.${act}`;
  let reach = MOUTHS.get(key);
  if (reach === undefined) { reach = lowestMouth(actor.member.species, act); MOUTHS.set(key, reach); }
  return reach * actor.member.size;
}

/** Up to the branch a fruit hangs from, or over to where it lies, coming up from its own side to stop with its mouth over it. */
function goToFood(actor: Actor, item: Food, act: Action, scene: Scene): void {
  if (item.perch !== undefined) {
    if (actor.place.on !== "perch" || actor.place.i !== item.perch) travel(actor, { on: "perch", i: item.perch }, actor.spec.flies ? "fly" : "climb", scene);
    return;
  }
  const size = actor.member.size;
  const from = placeTop(actor.place, scene);
  const side = Math.atan2(from[0] - item.p[0], from[2] - item.p[2]);
  const gap = Math.max(size * 0.15, mouthReach(actor, act));
  const spot = onGround(scene.stage, size, item.p[0] + Math.sin(side) * gap, item.p[2] + Math.cos(side) * gap);
  travel(actor, spot, groundMove(actor, spot, scene), scene);
}

/**
 * Go and eat a fruit, now and then, when there is one in reach and it is the
 * animal's waking hours: up to the branch it hangs from, or over to where it
 * lies, then a while eating it facing it. The meal goes in the pantry.
 */
/** Whether it is in a mood to eat: an eater, fruit about, its waking hours, and hungry just now. */
const hungry = (actor: Actor, scene: Scene): boolean =>
  FRUIT_EATERS[actor.member.species] !== undefined && (scene.stage.food?.length ?? 0) > 0
  && actor.spec.active !== (scene.stage.night === true ? "day" : "night") && actor.rand() < APPETITE;
/** How it eats: a bird pecks, a primate (or anything with hands) eats sitting up, the rest graze it off the ground. */
const mealAct = (actor: Actor): Action => (actor.spec.plan === "bird" ? "peck" : actor.spec.plan === "primate" || can(actor, "eat") ? "eat" : "graze");

function forage(actor: Actor, scene: Scene): boolean {
  if (!hungry(actor, scene)) return false;
  const item = pickFood(actor, scene);
  if (!item) return false;
  const act = mealAct(actor);
  goToFood(actor, item, act, scene);
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
  const act = nextAction(moodMatrix(actor, scene), actor.last, actor.rand);
  if (MOVES.has(act)) {
    if (act === "fly" && actor.spec.plan === "bird" && sortie(actor, scene)) return;
    const to = destination(actor, act, scene);
    if (to) { travel(actor, to, to.on === "ground" && actor.place.on === "ground" && actor.spec.plan === "bird" ? groundMove(actor, to, scene) : act, scene); return; }
    stay(actor, "look", between(actor.rand, SPAN.look));
    return;
  }
  if (trunkVisit(actor, act, scene)) return;
  const ready = prepare(actor, act, scene);
  stay(actor, ready, between(actor.rand, SPAN[ready]) * tempo(actor));
}

/** The sky's and the hour's mood on a stage: night, the weather, and whether the sun is near the horizon. */
const moodOf = (stage: Stage): Mood => ({ night: stage.night === true, weather: stage.weather === "rain" || stage.weather === "snow" ? stage.weather : undefined, twilight: stage.sun !== undefined && Math.abs(stage.sun) < 7 });

/** The animal's own idle matrix for this moment's mood. */
function moodMatrix(actor: Actor, scene: Scene): IdleMatrix {
  const mood = moodOf(scene.stage);
  if (mood.weather === undefined && mood.twilight !== true) return mood.night === true ? actor.night : actor.day;
  const key = `${mood.night === true ? "n" : "d"}${mood.weather ?? ""}${mood.twilight === true ? "t" : ""}`;
  let matrix = actor.moods.get(key);
  if (!matrix) { matrix = matrixOf(actor.spec, mood); actor.moods.set(key, matrix); }
  return matrix;
}

/**
 * A ground animal goes over to the tree now and then: to sniff round its
 * foot, or (a bear) to turn its back on the bark and scratch. It is seen
 * crossing the lawn, and it comes out of the roots to do it.
 */
function trunkVisit(actor: Actor, act: Action, scene: Scene): boolean {
  const trunk = scene.stage.trunk;
  if (!trunk || actor.spec.plan !== "quad" || actor.place.on !== "ground" || (act !== "sniff" && act !== "scratch") || actor.rand() > 0.35) return false;
  const size = actor.member.size;
  const here = placeTop(actor.place, scene);
  const side = Math.atan2(here[2] - trunk.base[2], here[0] - trunk.base[0]) + (actor.rand() - 0.5) * 1.2;
  const near = trunkClear(scene.stage, size) + size * 0.05;
  const spot: Place = { on: "ground", x: trunk.base[0] + Math.cos(side) * near, z: trunk.base[2] + Math.sin(side) * near };
  travel(actor, spot, groundMove(actor, spot, scene), scene);
  const toward = yawFrom(placeTop(actor.place, scene), trunk.base);
  stay(actor, act, between(actor.rand, SPAN[act]) * tempo(actor), -1, act === "scratch" && actor.member.species === "bear" ? toward + Math.PI : toward);
  return true;
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

/**
 * One of a group stands up to keep watch (a meerkat's, a marmot's or a
 * mongoose's sentry) while the rest dig and feed round it, never far; then
 * it drops down and another may take over.
 */
function sentryScene(troupe: Troupe, scene: Scene): boolean {
  const band = troupe.actors.filter((actor) => actor.spec.plan === "quad" && (actor.spec.temper.rear ?? 0) >= 2);
  if (band.length < 2) return false;
  begin(band, scene);
  const guard = band[Math.floor(troupe.rand() * band.length)];
  if (!guard) return false;
  const start = guard.until;
  const length = between(troupe.rand, [8, 14]);
  stay(guard, "rear", length);
  const post = placeTop(guard.place, scene);
  for (const actor of band) {
    if (actor === guard) continue;
    const jobs = (["dig", "sniff", "graze", "eat"] as const).filter((act) => can(actor, act));
    for (let guardrail = 0; guardrail < 6 && actor.until < start + length - 1.5; guardrail += 1) {
      if (troupe.rand() < 0.45) travel(actor, groundSpot(actor.rand, scene.stage, actor.member.size, post, actor.member.size * 5 + 0.3, takenBy(actor, scene)), "wander", scene, 0.8);
      stay(actor, jobs[Math.floor(troupe.rand() * jobs.length)] ?? "sniff", between(troupe.rand, [1.8, 3.5]));
    }
    holdAs(actor, "look", start + length, guard, scene);
  }
  return true;
}

/**
 * Something startles the group: one freezes and looks (or stands up to see),
 * the rest look to it, and then they all scatter away from the same side:
 * the runners across the lawn, the climbers up the tree, the birds into the
 * branches. They stop, and look back.
 */
function alarmScene(troupe: Troupe, scene: Scene): boolean {
  const runners = troupe.actors.filter((actor) => actor.spec.plan === "quad" && (can(actor, "run") || can(actor, "hop")));
  if (runners.length < 2 || troupe.actors.some((actor) => actor.place.on === "back")) return false;
  begin(troupe.actors, scene, false);
  const scout = runners[Math.floor(troupe.rand() * runners.length)];
  if (!scout) return false;
  stay(scout, can(scout, "rear") ? "rear" : "look", between(troupe.rand, [1.2, 2.2]));
  const threat = troupe.rand() * TAU;
  const stage = scene.stage;
  const away = threat + Math.PI;
  for (const actor of troupe.actors) {
    if (actor !== scout) holdAs(actor, "look", scout.until - 0.15 + troupe.rand() * 0.4, scout, scene);
    flee(actor, away, scene);
    const here = placeTop(actor.place, scene);
    const back = Math.atan2(Math.cos(threat) * stage.radius - here[0], Math.sin(threat) * stage.radius - here[2]);
    stay(actor, can(actor, "rear") && actor.rand() < 0.5 ? "rear" : "look", between(actor.rand, [2, 3.5]), -1, actor.place.on === "ground" ? back : actor.yaw);
  }
  return true;
}

/** Get away from a fright: a bird into the branches, a climber up the tree (most often), anyone else off across the ground away from it. */
function flee(actor: Actor, away: number, scene: Scene): void {
  const stage = scene.stage;
  const perches = perchCount(scene) > 0;
  if (actor.spec.flies && perches && !GROUND_BIRDS.has(actor.member.species)) { travel(actor, randomPerch(actor, scene), "fly", scene); return; }
  if (actor.spec.climbs && perches && actor.rand() < 0.7) { travel(actor, randomPerch(actor, scene), "climb", scene, 1.4); return; }
  const a = away + (actor.rand() - 0.5) * 1.4;
  const r = stage.radius * between(actor.rand, [0.55, 0.9]);
  travel(actor, onGround(stage, actor.member.size, Math.cos(a) * r, Math.sin(a) * r), can(actor, "run") ? "run" : "hop", scene, 1.15);
}

/**
 * A hunter after something smaller in its company: a cat after a bird, a
 * fox after a mouse. It creeps up low, freezes, pounces, and misses: the
 * bird is away into the tree, the mouse off across the grass. It sits and
 * washes, as if it meant to.
 */
function stalkScene(troupe: Troupe, scene: Scene): boolean {
  const hunter = troupe.actors.find((actor) => can(actor, "stalk"));
  const prey = troupe.actors.find((actor) => hunter && actor !== hunter && actor.member.heft < hunter.member.heft * 0.7 && (actor.spec.plan === "bird" || actor.spec.plan === "quad") && !GROUND_BIRDS.has(actor.member.species));
  if (!hunter || !prey) return false;
  begin([hunter, prey], scene);
  const target = placeTop(prey.place, scene);
  const from = placeTop(hunter.place, scene);
  const dir = unit(sub(target, from), [0, 0, 1]);
  const gap = headReach(hunter) * 2 + prey.member.size + 0.25;
  travel(hunter, { on: "ground", x: target[0] - dir[0] * gap, z: target[2] - dir[2] * gap }, "stalk", scene);
  stay(hunter, "stalk", between(troupe.rand, [0.8, 1.8]), prey.index);
  const leap = hunter.until;
  holdAs(prey, prey.spec.plan === "bird" ? "peck" : "graze", leap + 0.25);
  travel(hunter, { on: "ground", x: target[0] - dir[0] * headReach(hunter), z: target[2] - dir[2] * headReach(hunter) }, can(hunter, "hop") ? "hop" : "run", scene, 1.3);
  if (prey.spec.flies && perchCount(scene) > 0) travel(prey, randomPerch(prey, scene), "fly", scene);
  else {
    const a = Math.atan2(dir[2], dir[0]) + (troupe.rand() - 0.5);
    const r = scene.stage.radius * 0.8;
    travel(prey, onGround(scene.stage, prey.member.size, Math.cos(a) * r, Math.sin(a) * r), can(prey, "run") ? "run" : "hop", scene, 1.3);
  }
  stay(prey, "look", between(troupe.rand, [2, 3]));
  stay(hunter, "look", between(troupe.rand, [1, 2]));
  stay(hunter, can(hunter, "groom") ? "groom" : "sit", between(troupe.rand, [3, 5]));
  return true;
}

/** Crows find an owl at its roost by day and mob it: they come in round it, flapping and calling, until it flies. */
function mobScene(troupe: Troupe, scene: Scene): boolean {
  const owl = troupe.actors.find((actor) => actor.member.species === "owl");
  const mob = troupe.actors.filter((actor) => actor.member.species === "crow");
  if (!owl || mob.length === 0 || perchCount(scene) === 0 || scene.stage.night === true) return false;
  begin([owl, ...mob], scene, false);
  if (owl.place.on !== "perch") travel(owl, randomPerch(owl, scene), "fly", scene);
  const roost = owl.place.on === "perch" ? owl.place.i : 0;
  mob.forEach((crow, k) => { travel(crow, { on: "perch", i: roomyPerch(scene.stage, roost + 1 + k * 2, crow.member.size) }, "fly", scene); });
  const start = Math.max(owl.until, ...mob.map((crow) => crow.until));
  const length = between(troupe.rand, [6, 10]);
  holdAs(owl, "look", start);
  stay(owl, "look", length);
  for (const crow of mob) {
    holdAs(crow, "look", start, owl, scene);
    while (crow.until < start + length - 0.5) stayFacing(crow, troupe.rand() < 0.5 ? "flap" : "sing", between(troupe.rand, [0.9, 1.6]), owl, scene);
  }
  travel(owl, randomPerch(owl, scene), "fly", scene);
  return true;
}

/** A pair of birds in the tree side by side: they fly to neighbouring twigs and preen each other, or sing a duet. */
function perchScene(troupe: Troupe, scene: Scene): boolean {
  const pair = twoOf(troupe.actors.filter((actor) => actor.spec.plan === "bird" && actor.spec.flies && !GROUND_BIRDS.has(actor.member.species)), troupe.rand);
  if (!pair || perchCount(scene) === 0) return false;
  const [a, b] = pair;
  begin(pair, scene, false);
  const i = roomyPerch(scene.stage, Math.floor(troupe.rand() * 9973), a.member.size);
  if (a.place.on !== "perch" || a.place.i !== i) travel(a, { on: "perch", i }, "fly", scene);
  travel(b, { on: "perch", i: roomyPerch(scene.stage, i + 1, b.member.size) }, "fly", scene);
  const start = Math.max(a.until, b.until);
  holdAs(a, "look", start, b, scene);
  const length = between(troupe.rand, [4, 8]);
  const duet = can(a, "sing") && can(b, "sing") && troupe.rand() < 0.5;
  stayFacing(a, duet ? "sing" : "preen", length, b, scene);
  stayFacing(b, duet ? "sing" : "preen", length, a, scene);
  return true;
}

/**
 * A flock goes out round the tree together: the leader sets off on its
 * sortie and the others lift after it a beat apart, on the same loops a
 * little wider or higher, at its pace, and come in to branches near where it lands.
 */
function flockScene(troupe: Troupe, scene: Scene): boolean {
  const flock = troupe.actors.filter((actor) => actor.spec.plan === "bird" && actor.spec.flies);
  const leader = flock[0];
  if (!leader || flock.length < 2 || !scene.stage.trunk) return false;
  begin(flock, scene, false);
  const first = leader.segments.length;
  if (!sortie(leader, scene)) return false;
  const flight = leader.segments.slice(first).find((segment) => segment.loop?.kind === "sortie");
  const loop = flight?.loop;
  if (!flight || loop?.kind !== "sortie") return true;
  const speed = flight.pace * leader.member.size;
  flock.slice(1).forEach((bird, k) => {
    holdAs(bird, "look", flight.t0 + 0.2 + k * 0.25 + troupe.rand() * 0.2, leader, scene);
    const to: Place = flight.to.on === "perch" ? { on: "perch", i: roomyPerch(scene.stage, flight.to.i + 1 + k, bird.member.size) } : groundSpot(bird.rand, scene.stage, bird.member.size, placeTop(flight.to, scene), bird.member.size * 4 + 0.3, takenBy(bird, scene));
    const own = { ...loop, R: loop.R + (troupe.rand() - 0.3) * 0.5, h: loop.h + (troupe.rand() - 0.5) * 0.6 };
    leg(bird, to, "fly", scene, 1, own, speed * between(troupe.rand, [0.96, 1.04]));
    stay(bird, "look", between(troupe.rand, [1, 2.5]));
  });
  return true;
}

type SceneFn = (troupe: Troupe, scene: Scene) => boolean;
const SCENES: readonly (readonly [SceneFn, number])[] = [
  [groomScene, 3], [nuzzleScene, 1.2], [chaseScene, 2], [followScene, 2], [chorusScene, 1.5],
  [huddleScene, 1], [danceScene, 3], [feedScene, 3], [rideScene, 4], [climbScene, 2],
  [sentryScene, 3], [alarmScene, 0.8], [stalkScene, 2.5], [mobScene, 4], [perchScene, 2], [flockScene, 2.5],
];

/** How the sky and the hour weigh the scenes: they huddle in snow and rain and at night, sing at dawn and dusk, and keep play for fair days. */
function sceneWeight(fn: SceneFn, weight: number, stage: Stage): number {
  const mood = moodOf(stage);
  const wet = mood.weather !== undefined;
  if (fn === huddleScene) return weight * (wet ? 4 : 1) * (mood.night === true ? 2 : 1);
  if (fn === chorusScene) return weight * (mood.twilight === true ? 3 : 1);
  if (fn === chaseScene || fn === danceScene || fn === flockScene || fn === stalkScene) return weight * (wet ? 0.25 : 1);
  return weight;
}

/** Try the joint scenes in a seeded order until one fits the troupe. */
function tryScene(troupe: Troupe, scene: Scene): boolean {
  const left = SCENES.map(([fn, weight]) => [fn, sceneWeight(fn, weight, scene.stage)] as const);
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
  /** Radius at b, when the part tapers (a muzzle, a tail, a leg toward the ankle); r at a. */
  readonly r1?: number;
  /** How far it melts into the rest of the body: 0 a crisp seam, 1 the body's own (the default). */
  readonly melt?: number;
  /** Paint only: no surface of its own, it colours the body inside it (a bib, a rump patch, a mask). */
  readonly decal?: boolean;
}

/** A part's taper, melt and decal flag, as `cap` takes them. */
interface Finish { readonly r1?: number; readonly melt?: number; readonly decal?: boolean }

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
  // A hunter creeping up: low, head level and still, ears forward, tail down.
  stalk: (tl) => ({ crouch: 0.6, headPitch: 0.05, headYaw: 0.06 * Math.sin(tl * 0.7), earBack: -0.4, tailUp: -0.25, tailWag: 0.12 * Math.sin(tl * 5) }),
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
  const path = pathFor(mode, segment.from, segment.to, scene, actor.member.size, springOf(actor), segment.loop);
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
  if (mode === "fly") return { frame: flyingFrame(actor, segment, t, path, share, at.p, fw), phase: at.travelled / stride, moving };
  const p = add(at.p, [0, hopLift(actor, segment, mode, at.travelled) * moving, 0]);
  return { frame: frameOf(p, fw, at.up), phase: at.travelled / stride, moving };
}

/**
 * A flier's frame along its way: banked into its turns (its up tipped toward
 * the turn's middle, by how hard it turns at its speed), and, for a bird
 * that bounds, rising on each burst of wingbeats and dipping with its wings
 * shut.
 */
function flyingFrame(actor: Actor, segment: Segment, t: number, path: readonly PathPoint[], share: number, p: Vec, fw: Vec): Frame {
  const total = Math.max(1e-6, pathLength(path));
  const span = Math.max(0.01, segment.t1 - segment.t0);
  const step = Math.min(0.08, 0.5 / total);
  const before = alongPath(path, Math.max(0, share - step));
  const after = alongPath(path, Math.min(1, share + step));
  const up = actor.spec.plan === "bird" ? bankedUp(before.fw, after.fw, after.travelled - before.travelled, total / span) : UP;
  const style = actor.spec.plan === "bird" ? wingStyle(actor) : null;
  if (!style?.bound) return frameOf(p, fw, up);
  const since = clamp(t - segment.t0, 0, span);
  const c = (since / style.bout + ownPhase(actor)) % 1;
  const rise = c < 0.6 ? smooth(c / 0.6) : 1 - smooth((c - 0.6) / 0.4);
  const fade = Math.min(1, since / 1, (span - since) / 1);
  return frameOf(add(p, [0, actor.member.size * 0.5 * (rise - 0.5) * Math.max(0, fade), 0]), fw, up);
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

function cap(kit: Kit, part: string, role: Role, a: Vec, b: Vec, r: number, flatness = 1, up: Vec = UP, finish?: Finish): void {
  if (!(r > 0.0002)) return;
  const upRolled = kit.roll === 0 ? up : rollV(up, kit.roll);
  const capsule: Capsule = { a: toWorld(kit.f, rolled(kit, a)), b: toWorld(kit.f, rolled(kit, b)), r, role, part, flat: flatness, up: unit(dirToWorld(kit.f, upRolled), kit.f.y), fw: kit.f.z };
  if (!finish) { kit.out.push(capsule); return; }
  kit.out.push({
    ...capsule,
    ...(finish.r1 === undefined ? {} : { r1: Math.max(0, finish.r1) }),
    ...(finish.melt === undefined ? {} : { melt: finish.melt }),
    ...(finish.decal === true ? { decal: true } : {}),
  });
}
/** A tapered part: r at a, r1 at b, melting `melt` as far as the rest. */
const cone = (kit: Kit, part: string, role: Role, a: Vec, b: Vec, r: number, r1: number, melt = 1): void => { cap(kit, part, role, a, b, r, 1, UP, { r1, melt }); };
/** A patch of colour on the body (no surface of its own): a bib, a rump, a mask. */
const decal = (kit: Kit, part: string, role: Role, a: Vec, b: Vec, r: number): void => { cap(kit, part, role, a, b, r, 1, UP, { decal: true }); };
const ball = (kit: Kit, part: string, role: Role, p: Vec, r: number, flatness = 1, up: Vec = UP): void => { cap(kit, part, role, p, p, r, flatness, up); };

/** A two-bone limb from `root` to `target`, bending toward `pole`, with a paw (or hand, or foot) at the end. */
function limb(kit: Kit, part: string, role: Role, root: Vec, target: Vec, lengths: readonly [number, number], radius: number, pole: Vec, end: Role = "dark", melt?: number): Vec {
  // A target on the ground (or the bark) is where the sole meets it: the paw's
  // centre sits its own height above, fading out as the foot lifts.
  const sole = radius * 0.8;
  const lifted: Vec = [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]];
  const { mid, end: tip } = solveTwoBone(root, lifted, lengths[0], lengths[1], pole);
  if (melt === undefined) {
    cap(kit, `${part}.upper`, role, root, mid, radius);
    cap(kit, `${part}.lower`, role, mid, tip, radius * 0.78);
    ball(kit, `${part}.paw`, end, tip, radius * 0.95, 0.75);
    return tip;
  }
  // (Tapered, and melting only `melt` as far, so a limb stays a limb against the body.)
  cone(kit, `${part}.upper`, role, root, mid, radius, radius * 0.8, Math.max(melt, 0.6));
  cone(kit, `${part}.lower`, role, mid, tip, radius * 0.78, radius * 0.6, melt);
  cap(kit, `${part}.paw`, end, tip, tip, radius * 0.85, 0.75, UP, { melt });
  return tip;
}

/** A footfall cycle: the foot slides back on the ground for `duty` of the stride, then lifts and swings forward. */
function footCycle(q: number, duty: number, stride: number, lift: number): { z: number; y: number } {
  const u = q - Math.floor(q);
  if (u < duty) return { z: stride * (0.5 - u / duty), y: 0 };
  const s = (u - duty) / (1 - duty);
  return { z: stride * (s - 0.5), y: lift * Math.sin(Math.PI * s) };
}

// ---------------------------------------------------------------- one animal's own build

const BUILDS = new WeakMap<object, Build>();
/**
 * This animal's proportions: its kind's build times its own traits (a fox
 * with longer legs, a rabbit with a bigger head), worked out once for it.
 */
function buildOf(who: Who): Build {
  const t = (who.member as Partial<Pick<CastMember, "traits">>).traits;
  const b = who.spec.build;
  if (!t) return b;
  const known = BUILDS.get(who.member);
  if (known) return known;
  const own: Build = {
    ...b, len: b.len * t.len, leg: b.leg * t.leg, body: b.body * t.body, head: b.head * t.head, snout: b.snout * t.snout,
    neck: b.neck * t.neck, tailLen: b.tailLen * t.tail, earLen: b.earLen * t.ears,
  };
  BUILDS.set(who.member, own);
  return own;
}

// ---------------------------------------------------------------- four legs

/**
 * A four-legged body: its pelvis P and shoulders S, and how far it is into
 * each way of resting. Each rest is its own fold (a dog's sit drops the rump
 * by the heels with the forelegs straight; a deer folds its legs under and
 * lies), never one straight spine tipped up from the hip.
 */
interface QuadBody {
  readonly P: Vec; readonly S: Vec; readonly r: number; readonly w: number; readonly L: number;
  readonly legF: number; readonly legH: number;
  readonly sit: number; readonly loaf: number; readonly lie: number; readonly rump: number; readonly haunch: number; readonly rear: number;
  readonly gait: QuadGait;
  /** 0 standing still, 1 striding (and not resting). */
  readonly free: number;
}

const HOPPERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["rabbit", "mouse", "squirrel", "kangaroo"]);
const LEG = ["FL", "FR", "HL", "HR"] as const;
type LegId = (typeof LEG)[number];
const sideOf = (leg: LegId): number => (leg.endsWith("L") ? -1 : 1);
const foreLeg = (leg: LegId): boolean => leg.startsWith("F");

/**
 * Lateral-sequence walk, diagonal trot, rotary gallop, the hopper's bound
 * (forefeet, then the hind pair landing past them) and the kangaroo's hop
 * (both hind feet at once). `flex` bends the spine through each stride; the
 * airborne gaits leave the ground between footfalls.
 */
const QUAD_GAITS = {
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.64, lift: 0.14, bob: 0.02, flex: 0.01, air: 0 },
  trot: { at: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, duty: 0.45, lift: 0.2, bob: 0.03, flex: 0.02, air: 0 },
  gallop: { at: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.52 }, duty: 0.3, lift: 0.26, bob: 0.03, flex: 0.08, air: 0.12 },
  bound: { at: { HL: 0, HR: 0.04, FL: 0.5, FR: 0.54 }, duty: 0.32, lift: 0.3, bob: 0.04, flex: 0.1, air: 0.3 },
  hop: { at: { HL: 0, HR: 0, FL: 0.5, FR: 0.5 }, duty: 0.32, lift: 0.3, bob: 0.03, flex: 0.04, air: 0.4 },
} as const;
type QuadGait = (typeof QUAD_GAITS)[keyof typeof QUAD_GAITS];

/** Two-legged hoppers (a kangaroo): short forelegs held off the ground. */
const bipedal = (b: Build): boolean => b.fore < 0.6;

function quadGait(actor: Who, m: Moment): QuadGait {
  const b = buildOf(actor);
  if (bipedal(b)) return QUAD_GAITS.hop;
  // (A rabbit hops at any pace; it never walks a lateral sequence.)
  if (HOPPERS.has(actor.member.species) && (m.pace > 1.2 || actor.member.species === "rabbit")) return QUAD_GAITS.bound;
  if (m.pace > 3.6 && b.foot !== "plant" && b.sit !== "tuck") return b.foot === "hoof" ? QUAD_GAITS.bound : QUAD_GAITS.gallop;
  return m.pace > 2.2 ? QUAD_GAITS.trot : QUAD_GAITS.walk;
}

/** Standing heights: the shoulders at the animal's size for a usual leg, lower for short legs, higher for long. */
const shoulderOf = (b: Build, size: number): number => size * 0.92 * Math.pow(clamp(b.leg / 0.6, 0.2, 1.4), 0.8);

/**
 * The body through a stride: walking it bobs twice a stride; the airborne
 * gaits rise off the ground between footfalls, and the spine flexes (the
 * chest up as the pelvis drops) and stretches through each one.
 */
/**
 * How far through a moment with every foot off the ground the stride is (0
 * on the ground, rising to 1 at the top of the leap and back): between one
 * pair's last footfall and the next pair's first.
 */
function airborne(gait: QuadGait, phase: number): number {
  if (gait.air <= 0) return 0;
  const u = phase - Math.floor(phase);
  let last = -Infinity;
  let next = Infinity;
  for (const at of Object.values(gait.at)) {
    for (const k of [-1, 0, 1]) {
      const down = at + k;
      const up = down + gait.duty;
      if (u >= down && u < up) return 0;
      if (up <= u) last = Math.max(last, up);
      if (down > u) next = Math.min(next, down);
    }
  }
  return Math.sin((Math.PI * (u - last)) / Math.max(1e-6, next - last));
}

function strideOf(gait: QuadGait, m: Moment, q: Pose, size: number, r: number, free: number): { lift: number; flex: number; reach: number } {
  const cyc = TAU * m.phase;
  const bob = gait.bob * size * Math.cos(cyc * 2) + gait.air * size * airborne(gait, m.phase);
  const hop = q.hop * 0.3 * size * (gait.air > 0 ? 2 : 1.6);
  const lift = -q.crouch * 0.25 * size + free * bob + q.lift * r + hop;
  return { lift, flex: free * gait.flex * size * Math.sin(cyc), reach: free * gait.flex * size * 0.7 * Math.cos(cyc) };
}

/** How far into each way of resting: an action's sit becomes this animal's own sit (a deer lies, a bear sits back). */
function restsOf(b: Build, q: Pose, m: Moment): { sit: number; loaf: number; rump: number; haunch: number; lie: number; rear: number } {
  const own = (style: SitStyle): number => (b.sit === style ? q.sit : 0);
  const lie = b.sit === "lie" || b.sit === "tuck" ? Math.max(q.lie, q.sit) : q.lie;
  const loaf = own("loaf");
  // (A kangaroo stands tall at rest and pitches forward as it hops.)
  const rear = (bipedal(b) ? Math.max(q.rear, 1 - 0.55 * m.moving) : q.rear) * (1 - lie) * (1 - loaf);
  return { sit: own("dog"), loaf, rump: own("rump"), haunch: own("haunch"), lie, rear };
}

function quadSpine(actor: Who, q: Pose, m: Moment): QuadBody {
  const size = actor.member.size;
  const b = buildOf(actor);
  const L = b.len * size;
  const r = b.body * size;
  // (Shorter forelegs set the shoulders lower: a rabbit's back slopes down to its head.)
  const stand = shoulderOf(b, size);
  const shY = stand * (bipedal(b) ? 1 : b.fore);
  const hipY = stand * b.hip;
  const { sit, loaf, rump, haunch, lie, rear } = restsOf(b, q, m);
  const hu = r * b.haunch;
  let P: Vec = [0, hipY, -L / 2];
  let S: Vec = [0, shY, L / 2];
  // A dog's sit: the rump down by its heels and the back raised steeply, the
  // body drawn up short over straight forelegs (the shoulders stay where
  // they stood, so the forelegs still reach the ground).
  const sitA = 1.0;
  const sitL = clamp((shY * 0.97 - hu * 0.95) / Math.sin(sitA), L * 0.45, L);
  const sitS: Vec = [0, hu * 0.95 + sitL * Math.sin(sitA), L * 0.42];
  P = lerpV(P, madd(sitS, [0, -Math.sin(sitA), -Math.cos(sitA)], sitL), sit);
  S = lerpV(S, sitS, sit);
  // Up on its haunches (forepaws free), or back on its rump like a bear.
  // (Sitting up, the body draws up short: it is upright, not a long ramp.)
  const up = haunch + rump;
  const upP: Vec = [0, hu * 0.9, -L * 0.1];
  const upA = rump > 0 ? 1.2 : 1.3;
  P = lerpV(P, upP, up);
  S = lerpV(S, madd(upP, [0, Math.sin(upA), Math.cos(upA)], L * 0.72), up);
  // Up on its hind legs: upright for the animals that sit up (a meerkat on watch), leaning for the rest.
  const rearP: Vec = [0, hipY * 0.95, -L * 0.12];
  const rearA = bipedal(b) ? 1.28 : b.sit === "haunch" ? 1.42 : 1.25;
  const rearK = rear * (1 - sit) * (1 - up);
  P = lerpV(P, rearP, rearK);
  S = lerpV(S, madd(rearP, [0, Math.sin(rearA), Math.cos(rearA)], L * (bipedal(b) ? 1 : 0.85)), rearK);
  // Lying, or loafed with every foot tucked under and the back hunched.
  const down = Math.max(lie, loaf);
  P = lerpV(P, [0, hu * 1.0, -L / 2], down);
  S = lerpV(S, [0, r * b.chest * (loaf > lie ? 1.25 : 1.05), L * (loaf > lie ? 0.42 : 0.5)], down);
  S = madd(S, UP, -q.bow * Math.max(0, S[1] - r * 1.4) * 0.55);
  const gait = quadGait(actor, m);
  const free = m.moving * (1 - sit) * (1 - down) * (1 - up);
  const { lift, flex, reach } = strideOf(gait, m, q, size, r, free);
  P = add(P, [0, lift - flex, -reach]);
  S = add(S, [0, lift + flex, reach]);
  return { P, S, r, w: r * 0.72, L, legF: (shY - r * 0.45) * (bipedal(b) ? b.fore : 1), legH: hipY - r * 0.2, sit, loaf, lie, rump, haunch, rear, gait, free };
}

/** Each foot's share of its leg: the paw's pastern and hock, a hoof's long cannon, a sole laid flat. */
const LOWER: Readonly<Record<Foot, { fore: number; hind: number; foreTilt: number; hindTilt: number }>> = {
  paw: { fore: 0.2, hind: 0.3, foreTilt: -0.25, hindTilt: 0.22 },
  hoof: { fore: 0.32, hind: 0.38, foreTilt: -0.05, hindTilt: 0.12 },
  plant: { fore: 0.16, hind: 0.24, foreTilt: -1.1, hindTilt: 1.3 },
};

interface FootPlan { readonly foot: Vec; readonly tilt: number }

/**
 * Where a foot rests and how its lowest bone lies: `tilt` turns that bone from
 * upright; on a hind leg a positive tilt sets the hock behind the foot, on a
 * foreleg it sets the wrist ahead of the paw.
 */
function stanceFoot(b: Build, body: QuadBody, leg: LegId, q: Pose): FootPlan {
  const x = sideOf(leg);
  const { P, S, w, L, legF, legH, r } = body;
  const low = LOWER[b.foot];
  if (foreLeg(leg)) {
    let foot: Vec = [x * w, 0, S[2] + 0.05 * L];
    let tilt = low.foreTilt;
    foot = lerpV(foot, [x * w * 0.9, 0, S[2] + 0.04 * L], body.sit);
    // A bear sits back with its forepaws down between its knees; a squirrel holds them to its mouth.
    foot = lerpV(foot, [x * w * 0.75, 0, S[2] + L * 0.12], body.rump);
    tilt = mix(tilt, -0.8, body.rump);
    foot = lerpV(foot, add(S, [x * w * 0.55, -r * 0.05, r * 1.0 + legF * 0.12]), body.haunch);
    tilt = mix(tilt, 2.4, body.haunch);
    // Lying: a dog's forearms flat out in front (a sphinx); a deer's folded back under its chest.
    const hoof = b.foot === "hoof";
    foot = lerpV(foot, hoof ? [x * w * 0.9, 0, S[2] - legF * 0.05] : [x * w * 1.05, 0, S[2] + legF * 0.62], body.lie);
    tilt = mix(tilt, hoof ? 1.5 : -1.5, body.lie);
    foot = lerpV(foot, [x * w * 0.8, 0, S[2] + r * 0.25], body.loaf);
    tilt = mix(tilt, 1.45, body.loaf);
    foot = lerpV(foot, [x * w, 0, S[2] + legF * 0.55], q.bow);
    tilt = mix(tilt, -1.3, q.bow);
    const rear = bipedal(b) ? 1 : body.rear * (1 - body.sit) * (1 - body.lie);
    foot = lerpV(foot, add(S, bipedal(b) ? [x * w * 1.05, -legF * 0.62, legF * 0.62] : [x * w * 0.9, -legF * 0.42, legF * 0.3]), rear);
    tilt = mix(tilt, 1.0, rear);
    return { foot, tilt };
  }
  let foot: Vec = [x * w, 0, P[2]];
  let tilt = low.hindTilt;
  // Every fold lays the hock flat on the ground with the foot out ahead of it.
  const folded = Math.max(body.sit, body.haunch, body.loaf);
  foot = lerpV(foot, [x * w * 1.35, 0, P[2] + L * 0.24], folded);
  tilt = mix(tilt, 1.5, folded);
  foot = lerpV(foot, [x * w * 1.6, 0, P[2] + L * 0.32], body.lie);
  tilt = mix(tilt, 1.5, body.lie);
  // A bear on its rump: legs out in front, soles to the world.
  foot = lerpV(foot, [x * w * 1.5, legH * low.hind * 0.9, P[2] + L * 0.72], body.rump);
  tilt = mix(tilt, 2.9, body.rump);
  return { foot, tilt };
}

function quadFoot(actor: Who, body: QuadBody, leg: LegId, q: Pose, m: Moment, head: Vec): FootPlan {
  const b = buildOf(actor);
  const plan = stanceFoot(b, body, leg, q);
  let { foot, tilt } = plan;
  const gait = body.gait;
  const fore = foreLeg(leg);
  // (A kangaroo's forepaws stay up off the ground while it hops.)
  const grounded = !(fore && (body.rear > 0.5 || bipedal(b)));
  if (body.free > 0 && grounded) {
    const lift = gait.lift * (fore ? body.legF : body.legH);
    const c = footCycle(m.phase - gait.at[leg], gait.duty, gait.duty * bodyStride(actor), lift);
    // (In a leap every foot is off the ground with the body: a rabbit's hop, a deer's bound.)
    const air = gait.air * actor.member.size * airborne(gait, m.phase);
    foot = add(foot, [0, (c.y + air) * body.free, c.z * body.free]);
    // Swinging, the paw flips back under the wrist and the toes trail the hock.
    const swing = (c.y / Math.max(1e-9, lift)) * body.free;
    tilt += swing * (fore ? 1.5 : -0.95);
  }
  return pawWork({ foot, tilt }, body, leg, q, m.t, head);
}

/** A hind paw scratching behind an ear, forepaws digging. */
function pawWork(plan: FootPlan, body: QuadBody, leg: LegId, q: Pose, t: number, head: Vec): FootPlan {
  let { foot, tilt } = plan;
  if (leg === "HR" && q.scratch > 0) foot = add(lerpV(foot, add(head, [body.w * 1.4, -body.r * 0.9, -body.r * 1.2]), q.scratch * 0.85), [0, Math.sin(t * 26) * body.r * 0.3 * q.scratch, 0]);
  if (foreLeg(leg) && q.dig > 0) {
    const s = Math.sin(t * 14 + (sideOf(leg) > 0 ? Math.PI : 0));
    foot = add(foot, [0, Math.max(0, s) * body.legF * 0.25 * q.dig, s * body.legF * 0.3 * q.dig]);
    tilt += Math.max(0, s) * q.dig;
  }
  return { foot, tilt };
}

/**
 * One leg in three bones: the upper bone thick where it leaves the body,
 * the middle one slimmer, and the lowest (pastern, cannon, hock or sole)
 * slimmest, down to a paw, a hoof or a flat foot. A hind leg zigzags (the
 * knee forward, the hock back); a foreleg's elbow sits behind.
 */
/** Each foot's radius as a share of the leg's, and the leg's thickness down its two upper bones (root, knee, knee, joint). */
const SOLE: Readonly<Record<Foot, number>> = { paw: 0.6, hoof: 0.45, plant: 0.55 };
const LEG_TAPER = { fore: [1.45, 0.95, 0.9, 0.68], hind: [1.95, 1.1, 1.0, 0.62] } as const;

/** Which way a leg's middle joint bends: a knee forward, an elbow back, a folded knee out to the side. */
function poleOf(fore: boolean, body: QuadBody, b: Build, x: number): Vec {
  if (fore) return body.lie > 0.5 && b.foot !== "hoof" ? [0, 1, -0.3] : [0, 0, -1];
  return Math.max(body.lie, body.loaf, body.sit, body.haunch) > 0.5 ? [x * 0.7, 0.5, 0.6] : [0, 0, 1];
}

function quadLeg(kit: Kit, actor: Who, body: QuadBody, leg: LegId, plan: FootPlan): void {
  const b = buildOf(actor);
  const x = sideOf(leg);
  const fore = foreLeg(leg);
  const low = LOWER[b.foot];
  const legR = Math.max(0.004, body.r * 0.32 * b.legR);
  const reach = fore ? body.legF : body.legH;
  // (A kangaroo's hind foot is long: it stands on it.)
  const lowLen = reach * (fore ? low.fore : bipedal(b) ? 0.42 : low.hind);
  const root = fore ? add(body.S, [x * body.w * 0.85, -body.r * 0.45, -body.r * 0.1]) : add(body.P, [x * body.w, -body.r * 0.2, 0]);
  const bone = Math.max(1e-4, reach - lowLen * Math.cos(fore ? low.foreTilt : low.hindTilt)) * (fore ? 0.53 : 0.56);
  const dir: Vec = [0, Math.cos(plan.tilt), Math.sin(plan.tilt) * (fore ? 1 : -1)];
  const plantR = legR * SOLE[b.foot];
  const sole: Vec = add(plan.foot, [0, plantR, 0]);
  const { mid, end } = solveTwoBone(root, madd(sole, dir, lowLen), bone, bone, poleOf(fore, body, b, x));
  const name = `leg.${leg}`;
  const [r0, r1, r2, r3] = fore ? LEG_TAPER.fore : LEG_TAPER.hind;
  cone(kit, `${name}.upper`, "coat", root, mid, legR * r0, legR * r1);
  cone(kit, `${name}.lower`, "coat", mid, end, legR * r2, legR * r3, 0.45);
  footParts(kit, b, name, end, sole, legR, plantR);
}

/** The lowest bone and what it stands on: a hoof's cannon and hoof, a flat sole, a pastern and paw. */
function footParts(kit: Kit, b: Build, name: string, end: Vec, sole: Vec, legR: number, plantR: number): void {
  const lowRole: Role = b.extras.includes("socks") ? "dark" : "coat";
  if (b.foot === "hoof") {
    cone(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.55, legR * 0.48, 0.35);
    cap(kit, `${name}.paw`, "dark", sole, add(sole, [0, -plantR * 0.4, plantR * 0.5]), plantR, 1, UP, { melt: 0.25 });
    return;
  }
  const toe = madd(sole, [0, 0, 1], plantR * (b.foot === "plant" ? 0.6 : 0.35));
  // (A sole lies flat, heel to toe, so the foot reads from the side.)
  if (b.foot === "plant") cap(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.75, 0.7, UP, { r1: legR * 0.85, melt: 0.4 });
  else cone(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.62, legR * 0.55, 0.35);
  cap(kit, `${name}.paw`, "dark", toe, toe, plantR * (b.foot === "plant" ? 1.25 : 1.35), b.foot === "plant" ? 0.6 : 0.7, UP, { melt: 0.3 });
}

function headAxes(hd: Vec, roll: number): { s: Vec; u: Vec } {
  const hs = unit(cross(UP, hd), [1, 0, 0]);
  const hu = cross(hd, hs);
  return roll === 0 ? { s: hs, u: hu } : { s: unit(madd(hs, hu, -roll)), u: unit(madd(hu, hs, roll)) };
}

interface Head { readonly c: Vec; readonly d: Vec; readonly s: Vec; readonly u: Vec; readonly r: number }
/** Heads a touch big for the body, as a toy's are: the face is what makes an animal read at a glance. */
const CHARM = 1.18;

function quadNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose, m: Moment): Head {
  const b = buildOf(actor);
  const size = actor.member.size;
  const { P, S, r } = body;
  const chest = r * b.chest;
  const n0 = add(S, [0, r * 0.45, r * 0.45]);
  const bodyPitch = Math.atan2(S[1] - P[1], S[2] - P[2]);
  // A hoofed walker nods with its stride; every head stays steadier than its body.
  const nod = b.foot === "hoof" ? 0.09 * Math.sin(TAU * 2 * m.phase) * body.free : 0;
  const pitch = q.headPitch + nod;
  const down = clamp(-pitch, 0, 1.4) / 1.25;
  const up = clamp(pitch, 0, 1.3) / 1.2;
  let np = b.rise - bodyPitch * 0.6;
  np = mix(mix(np, -0.9, down), 1.35, up);
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  // (A tortoise draws its head in when it tucks down.)
  const tuck = b.sit === "tuck" ? body.lie * 0.7 : 0;
  const n1 = madd(n0, dirOf(yaw, np), Math.max(b.neck * size, r * 0.4) * (1 - tuck));
  const hr = b.head * size * CHARM;
  cone(kit, "neck", "coat", n0, n1, r * 0.62, Math.max(hr * 0.55, r * 0.32));
  if (b.extras.includes("ruff")) cap(kit, "ruff", "coat", lerpV(n0, S, 0.4), lerpV(n0, n1, 0.35), chest * 0.82, 1, UP, { melt: 1.4 });
  if (b.extras.includes("bib")) decal(kit, "bib", "belly", add(S, [0, -chest * 0.35, chest * 0.75]), madd(n1, dirOf(yaw, np - 1.2), hr * 0.4), chest * 0.5);
  const hd = dirOf(yaw * 1.8 + q.curl * 0.8, -0.15 + pitch * 0.55 - down * 0.45 - q.curl * 0.4);
  return { c: madd(n1, hd, hr * 0.55), d: hd, ...headAxes(hd, q.headRoll), r: hr };
}

const at3 = (h: Head, d: number, s: number, u: number): Vec => add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, s * h.r)), scale(h.u, u * h.r)));

function earsOf(kit: Kit, kind: Ears, h: Head, back: number, size = 1, role: Role = "coat"): void {
  for (const x of [-1, 1]) earOf(kit, `ear.${x < 0 ? "L" : "R"}`, kind, h, x, back, size, role);
}

function earOf(kit: Kit, part: string, kind: Ears, h: Head, x: number, back: number, size: number, role: Role): void {
  if (kind === "point" || kind === "tuft") {
    const root = at3(h, -0.05, x * 0.5, 0.6);
    const dir = unit(add(add(scale(h.u, 1), scale(h.d, -(0.25 + back * 0.8))), scale(h.s, x * 0.3)));
    const len = h.r * (kind === "tuft" ? 0.7 : 0.95) * size;
    // (Pointed: broad at the root, narrowing to the tip.)
    cap(kit, part, kind === "tuft" ? "alt" : role, root, madd(root, dir, len), h.r * 0.28 * Math.sqrt(size), 0.6, h.d, { r1: h.r * 0.09, melt: 0.6 });
  } else if (kind === "round" || kind === "fluffy") roundEar(kit, part, kind === "fluffy", h, x, size);
  else if (kind === "long") {
    // (Splayed in a V, so the pair reads from behind as well as from the side.)
    // (Broad and standing up off the head, so they clear the hunched back and still read when the head is a few pixels.)
    const root = at3(h, -0.12, x * 0.36, 0.72);
    const dir = unit(add(add(scale(h.u, 1.15 - back * 0.7), scale(h.d, -(0.08 + back))), scale(h.s, x * 0.3)));
    cap(kit, part, "coat", root, madd(root, dir, h.r * 2.2 * size), h.r * 0.42, 0.75, h.d, { r1: h.r * 0.4, melt: 0.35 });
    decal(kit, `${part}.tip`, "dark", madd(root, dir, h.r * 2.45 * size), madd(root, dir, h.r * 2.45 * size), h.r * 0.45);
  } else if (kind === "flop") {
    const root = at3(h, -0.05, x * 0.7, 0.4);
    cap(kit, part, "alt", root, madd(root, unit(add(scale(h.s, x), scale(h.u, -1.2))), h.r * 0.9 * size), h.r * 0.25, 0.4, h.s);
  }
}

/** A round ear set out on top of the head, so even a mouse's clears its outline; a koala's with a pale fringe of fur. */
function roundEar(kit: Kit, part: string, fluffy: boolean, h: Head, x: number, size: number): void {
  const at = fluffy ? at3(h, -0.1, x * 0.8, 0.85) : at3(h, -0.2, x * 0.6, 0.98);
  const er = h.r * 0.32 * size;
  cap(kit, part, "coat", at, at, er, 0.55, h.d, { melt: 0.35 });
  if (fluffy) decal(kit, `${part}.fluff`, "belly", madd(at, h.s, x * er * 0.35), madd(at, h.s, x * er * 0.35), er * 0.75);
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
  const b = buildOf(actor);
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", h.c, h.r);
  // The muzzle tapers from the face to the nose: to a point on a fox, hardly at all on a capybara.
  const root = at3(h, 0.35, 0, -0.1);
  const tip = madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15);
  const tipR = h.r * 0.5 * b.snoutTip;
  cone(kit, "snout", "coat", root, tip, h.r * 0.5, tipR);
  const jawRoot = at3(h, 0.3, 0, -0.32);
  const jawTip = madd(madd(jawRoot, h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cone(kit, "jaw", "belly", jawRoot, jawTip, h.r * 0.36, Math.max(tipR * 0.7, h.r * 0.12));
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", madd(tip, h.u, h.r * 0.2), madd(tip, h.u, -h.r * 0.12), h.r * 0.3, 0.7, h.d);
  else ball(kit, "nose", "nose", tip, Math.max(tipR * 0.8, h.r * 0.15));
  for (const x of [-1, 1]) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.62, x * 0.5, 0.28), h.r * 0.25, !asleep);
  faceMarks(kit, b, h, tip);
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  earsOf(kit, b.ears, h, q.earBack, b.earLen, b.extras.includes("cheeks") ? "accent" : "coat");
}

/** Face markings, set across the head's surface so they paint it from any side. */
function faceMarks(kit: Kit, b: Build, h: Head, tip: Vec): void {
  const cheeks = b.extras.includes("cheeks");
  const mask = b.extras.includes("mask");
  if (b.extras.includes("muzzle")) decal(kit, "muzzle", cheeks ? "accent" : "belly", at3(h, 0.65, 0, -0.4), tip, h.r * 0.45);
  if (mask) for (const x of [-1, 1]) decal(kit, "mask", "dark", at3(h, 0.78, x * 0.5, 0.36), at3(h, 0.48, x * 0.78, -0.05), h.r * 0.3);
  // (A badger's white blaze runs from its nose over its crown, between dark stripes.)
  if (mask && b.extras.includes("stripes")) decal(kit, "blaze", "accent", tip, at3(h, -0.4, 0, 1.0), h.r * 0.3);
  if (cheeks) for (const x of [-1, 1]) decal(kit, "cheek", "accent", at3(h, 0.4, x * 0.88, -0.15), at3(h, 0.7, x * 0.6, 0.5), h.r * 0.3);
}

/** A buck's antlers: a beam sweeping up, out and forward, with tines off its front. */
function antlersOf(kit: Kit, h: Head, size: number): void {
  for (const x of [-1, 1]) {
    const root = at3(h, -0.1, x * 0.42, 0.85);
    const beam = unit(add(add(scale(h.u, 1), scale(h.d, -0.45)), scale(h.s, x * 0.75)));
    const bend = madd(root, beam, size * 0.18);
    const top = madd(bend, unit(add(add(scale(h.u, 1), scale(h.d, 0.55)), scale(h.s, x * 0.25))), size * 0.16);
    cap(kit, "antler", "horn", root, bend, size * 0.026, 1, UP, { r1: size * 0.02, melt: 0.3 });
    cap(kit, "antler", "horn", bend, top, size * 0.02, 1, UP, { r1: size * 0.012, melt: 0.3 });
    const brow = madd(root, beam, size * 0.05);
    cap(kit, "tine", "horn", brow, madd(brow, unit(add(scale(h.d, 1), scale(h.u, 0.5))), size * 0.08), size * 0.016, 1, UP, { r1: size * 0.008, melt: 0.3 });
    cap(kit, "tine", "horn", bend, madd(bend, unit(add(scale(h.u, 1), scale(h.d, 0.3))), size * 0.11), size * 0.016, 1, UP, { r1: size * 0.008, melt: 0.3 });
  }
}

/** Tails: how each rises and curls, its girth and segments, and its thickness down its length (root to tip). */
const TAILS: Readonly<Record<Tail, { rise: number; curl: number; girth: number; n: number; profile: readonly number[] }>> = {
  bushy: { rise: 0.1, curl: -0.12, girth: 0.6, n: 3, profile: [0.5, 0.95, 0.9, 0.4] },
  curl: { rise: 1.25, curl: 0.5, girth: 0.6, n: 4, profile: [0.55, 0.95, 1, 0.9, 0.55] },
  thin: { rise: 0.55, curl: 0.15, girth: 0.16, n: 3, profile: [1, 0.85, 0.65, 0.45] },
  puff: { rise: 0.6, curl: 0, girth: 0.45, n: 1, profile: [1, 1] },
  ring: { rise: 0.35, curl: 0.05, girth: 0.45, n: 4, profile: [0.75, 1, 0.95, 0.85, 0.55] },
  thick: { rise: -0.55, curl: 0.1, girth: 0.6, n: 3, profile: [1, 0.7, 0.45, 0.22] },
  fan: { rise: 0, curl: 0, girth: 0.4, n: 1, profile: [1, 1] },
  none: { rise: 0, curl: 0, girth: 0, n: 0, profile: [0] },
};

/**
 * Which way each tail segment runs: up or down by its kind, wagging, and
 * laid round the feet when the animal sits or loafs; a cat's thin tail held
 * up hooks over at its tip.
 */
function tailLay(b: Build, body: QuadBody, q: Pose, t: number): (i: number) => Vec {
  const shape = TAILS[b.tail];
  const wrap = (body.sit + body.loaf + body.haunch * 0.5) * (b.tail === "curl" || b.tail === "thick" ? 0 : 1);
  const settled = body.sit + body.lie + body.loaf;
  const hook = b.tail === "thin" && b.tailRise > 0.3 ? 0.9 * (1 - settled) : 0;
  return (i) => {
    const wag = q.tailWag * 0.6 * Math.sin(t * 8 - i * 0.8) + 0.15 * Math.sin(t * 1.3 - i) + q.curl * 0.9 + wrap * (0.55 + i * 0.5);
    const rise = shape.rise + b.tailRise * (1 - settled) + q.tailUp * 0.9 + shape.curl * i + (i === shape.n - 1 ? hook : 0) - q.sit * 0.7 - q.lie * 0.4 - wrap * 0.6;
    return dirOf(Math.PI + wag, rise);
  };
}

function quadTail(kit: Kit, actor: Who, body: QuadBody, q: Pose, t: number): void {
  const b = buildOf(actor);
  const shape = TAILS[b.tail];
  if (shape.n === 0) return;
  const hu = body.r * b.haunch;
  let at = add(body.P, [0, hu * 0.35, -hu * 0.8]);
  if (b.tail === "puff") { ball(kit, "tail", "belly", add(body.P, [0, hu * 0.55, -hu * 0.88]), body.r * shape.girth * b.tailGirth); return; }
  const seg = (b.tailLen * actor.member.size) / shape.n;
  const girth = body.r * shape.girth * b.tailGirth;
  const lay = tailLay(b, body, q, t);
  for (let i = 0; i < shape.n; i += 1) {
    const reach = madd(at, lay(i), seg);
    const r0 = girth * (shape.profile[i] ?? 1);
    const r1 = girth * (shape.profile[i + 1] ?? 1);
    const next: Vec = [reach[0], Math.max(reach[1], r1 * 0.9), reach[2]];
    cap(kit, `tail.${i}`, b.tail === "ring" && i % 2 === 1 ? "dark" : "coat", at, next, r0, 1, UP, { r1, melt: i === 0 ? 1 : 0.7 });
    at = next;
  }
  // (A fox's brush ends in white; a mouse's or a meerkat's tail in dark.)
  if (b.tail === "bushy") decal(kit, "tail.tip", "accent", at, at, girth * 0.75);
}

function quadTrunk(kit: Kit, actor: Who, body: QuadBody): void {
  const { P, S, r } = body;
  const b = buildOf(actor);
  const extras = b.extras;
  const ch = r * b.chest;
  const hu = r * b.haunch;
  // A chest set forward and low, a haunch over the hind legs, a waist between.
  cone(kit, "body", "coat", P, S, hu * 0.85, ch * 0.88);
  ball(kit, "haunch", "coat", add(P, [0, hu * 0.05, -hu * 0.1]), hu);
  ball(kit, "chest", "coat", add(S, [0, -ch * 0.12, ch * 0.08]), ch);
  if (extras.includes("hump")) ball(kit, "hump", "coat", add(S, [0, ch * 0.7, -ch * 0.35]), ch * 0.72);
  if (extras.includes("pouch")) ball(kit, "pouch", "belly", add(lerpV(P, S, 0.45), [0, -r * 0.35, r * 0.25]), r * 0.75);
  if (extras.includes("shell")) shellOf(kit, body);
  if (extras.includes("quills")) quillsOf(kit, body);
  coatMarks(kit, actor, b, body);
}

/** Markings painted on the coat: a pale belly, a dark saddle, a white rump, stripes, a fawn's spots. */
function coatMarks(kit: Kit, actor: Who, b: Build, body: QuadBody): void {
  const { P, S, r } = body;
  const extras = b.extras;
  const ch = r * b.chest;
  const hu = r * b.haunch;
  const spot = (part: string, role: Role, at: Vec, radius: number): void => { decal(kit, part, role, at, at, radius); };
  decal(kit, "belly", "belly", add(P, [0, -hu * 0.8, 0]), add(S, [0, -ch * 0.85, 0]), r * 0.58);
  if (extras.includes("saddle")) decal(kit, "saddle", "alt", add(P, [0, hu * 0.95, 0]), add(S, [0, ch * 0.95, -ch * 0.2]), r * 0.62);
  if (extras.includes("rump")) spot("rump", "belly", add(P, [0, hu * 0.25, -hu * 0.95]), hu * 0.72);
  if (extras.includes("stripes") && !extras.includes("mask")) {
    // A skunk's pale pair down the back where its second colour is the lighter, a mongoose's dark bands across it where it is the darker.
    const tone = (hex: string): number => { const [cr, cg, cb] = hexRgb(hex); return cr * 0.3 + cg * 0.59 + cb * 0.11; };
    if (tone(actor.member.palette.alt) > tone(actor.member.palette.coat)) for (const x of [-1, 1]) decal(kit, "stripe", "alt", add(S, [x * r * 0.42, ch * 0.92, ch * 0.2]), add(P, [x * r * 0.42, hu * 0.92, -hu * 0.3]), r * 0.28);
    else for (const k of [0.15, 0.38, 0.62, 0.85]) { const c = lerpV(P, S, k); decal(kit, "stripe", "alt", add(c, [-r * 1.1, r * 0.55, 0]), add(c, [r * 1.1, r * 0.55, 0]), r * 0.16); }
  }
  if (extras.includes("spots") && actor.member.young) for (let i = 0; i < 5; i += 1) spot("spot", "accent", add(lerpV(P, S, 0.15 + i * 0.17), [((i % 2) * 2 - 1) * r * 0.45, r * 0.8, 0]), r * 0.2);
}

/** A tortoise's high domed carapace over a flat skirt, its plates painted on. */
function shellOf(kit: Kit, body: QuadBody): void {
  const { P, S, r } = body;
  // (Set high, with the skirt above the knees, so the legs and head stand out under it.)
  cap(kit, "shell", "shell", add(P, [0, r * 0.5, 0]), add(S, [0, r * 0.5, 0]), r * 1.25, 0.85, UP, { melt: 0.4 });
  cap(kit, "shell.rim", "alt", add(P, [0, r * 0.3, 0]), add(S, [0, r * 0.3, 0]), r * 1.32, 0.18, UP, { melt: 0.2 });
  const plates: Vec[] = [[0, r * 1.5, 0], [0, r * 1.5, 0.5], [0, r * 1.5, 1], [-r * 0.95, r * 1.1, 0.5], [r * 0.95, r * 1.1, 0.5]];
  for (const [x, y, k] of plates) { const at = add(lerpV(P, S, k), [x, y, 0]); decal(kit, "scute", "accent", at, at, r * (x === 0 ? 0.45 : 0.4)); }
}

/** A hedgehog's dome of spines over its back, bristling out from it, pale and dark. */
function quillsOf(kit: Kit, body: QuadBody): void {
  const { P, S, r } = body;
  // (A round dome, not a log: the spines short and many, lying back, so they read as a bristling coat and not as horns.)
  cap(kit, "quills", "alt", add(P, [0, r * 0.3, 0]), add(S, [0, r * 0.3, -r * 0.35]), r * 1.18, 0.85, UP, { melt: 0.45 });
  for (let i = 0; i < 12; i += 1) {
    const row = Math.floor(i / 4);
    const a = ((i % 4) - 1.5) * 0.62 + (row % 2) * 0.3;
    const out: Vec = [Math.sin(a), Math.cos(a), 0];
    const base = add(lerpV(P, S, 0.1 + row * 0.33), scale(out, r * 1.05));
    cap(kit, "quill", i % 3 === 0 ? "dark" : "belly", base, add(base, add(scale(out, r * 0.42), [0, 0, -r * 0.3])), r * 0.15, 1, UP, { r1: r * 0.02, melt: 0.1 });
  }
}

function poseQuad(kit: Kit, actor: Who, m: Moment): void {
  const q = m.pose;
  const body = quadSpine(actor, q, m);
  const head = quadNeck(kit, actor, body, q, m);
  for (const leg of LEG) quadLeg(kit, actor, body, leg, quadFoot(actor, body, leg, q, m, head.c));
  quadTrunk(kit, actor, body);
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
  // (A monkey stands on all fours, as it walks: upright only to sit, reach, eat or hang.)
  const walking = !climbing && (m.moving > 0.05 || onFours(who, q));
  let { hipY, lean } = primateCarriage(climbing, walking, m.moving > 0.05, leg, r);
  hipY = mix(hipY, r * 0.9, q.sit);
  lean = mix(lean, 0.12, q.sit) + q.reach * 0.25;
  let hips: Vec = [0, hipY + Math.abs(Math.sin(TAU * m.phase)) * r * 0.25 * m.moving, 0];
  let tdir = dirOf(0, Math.PI / 2 - lean);
  if (q.hang > 0) {
    const sloth = b.extras.includes("claws");
    // (A sloth hangs by its long arms from the branch above, its body down below them, head up: hanging, not lying on its back.)
    const hangHips: Vec = sloth ? [0, -arm * 0.85 - b.len * size * 0.95, -b.len * size * 0.15] : [0, -arm * 0.95 - b.len * size, 0];
    hips = lerpV(hips, hangHips, q.hang);
    tdir = unit(lerpV(tdir, sloth ? [0, 1, 0.18] : [0, 1, 0.05], q.hang));
  }
  return { hips, chest: madd(hips, tdir, b.len * size), tdir, r, w: r * 1.05, arm, leg, climbing };
}

/** How high its hips ride and how far its body leans from upright: climbing, on all fours (a little higher at rest than walking) or sitting up. */
function primateCarriage(climbing: boolean, fours: boolean, moving: boolean, leg: number, r: number): { hipY: number; lean: number } {
  if (climbing) return { hipY: r * 1.4, lean: 1.45 };
  if (fours) return { hipY: leg * 0.8, lean: moving ? 1.15 : 1.0 };
  return { hipY: leg * 0.85, lean: 0.2 };
}

/** Standing about on all fours: a monkey (not a sloth or a loris, which only climb and hang) doing nothing with its hands. */
const onFours = (who: Who, q: Pose): boolean => who.spec.build.tail !== "none" && q.sit < 0.3 && q.hang <= 0 && q.reach < 0.3 && q.hand < 0.3 && q.scratch <= 0;

function primateHand(who: Who, body: PrimateBody, x: number, m: Moment, head: Vec): Vec {
  const q = m.pose;
  const { chest, w, arm, r } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step = walking ? footCycle(m.phase - (x < 0 ? 0 : 0.5), 0.6, 0.6 * bodyStride(who), arm * 0.25) : { z: 0, y: 0 };
  let hand: Vec = walking ? [x * w, step.y, chest[2] + arm * 0.25 + step.z] : add(chest, [x * w * 1.2, -arm * 0.85, arm * 0.2]);
  hand = lerpV(hand, [x * w * 1.3, r * 0.4, arm * 0.45], q.sit);
  hand = lerpV(hand, add(chest, [x * w * 0.5, -r * 0.2 + 0.03 * Math.sin(m.t * 5 + x), arm * 0.75]), q.reach * (x > 0 ? 1 : 0.6));
  if (x > 0) hand = lerpV(hand, add(head, [w * 0.25, -r * 0.5, r * 0.55]), q.hand * (1 - q.scratch));
  if (x > 0 && q.scratch > 0) hand = lerpV(hand, add(head, [w * 1.1, r * 0.3 * Math.sin(m.t * 22), -r * 0.3]), q.scratch);
  return q.hang > 0 ? lerpV(hand, gripOf(who, body, x, m.t), q.hang) : hand;
}

/** Where a hanging animal's hands hold the branch: a sloth both hands up, a monkey by one, the other swinging free. */
function gripOf(who: Who, body: PrimateBody, x: number, t: number): Vec {
  const { w, arm } = body;
  if (who.spec.build.extras.includes("claws")) return [x * w * 1.1, 0, w * 0.4];
  return x > 0 ? [0, 0, 0] : [-w, -arm * 0.6 + 0.1 * Math.sin(t), arm * 0.4];
}

function primateFoot(who: Who, body: PrimateBody, x: number, m: Moment): Vec {
  const q = m.pose;
  const { hips, w, leg } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step = walking && m.moving > 0.05 ? footCycle(m.phase - (x < 0 ? 0.5 : 0), 0.6, 0.6 * bodyStride(who), leg * 0.25) : { z: 0, y: 0 };
  let foot: Vec = [x * w * 0.8, step.y, hips[2] - leg * 0.1 + step.z];
  foot = lerpV(foot, [x * w * 1.4, 0, leg * 0.75], q.sit);
  if (q.hang > 0) {
    const sloth = who.spec.build.extras.includes("claws");
    foot = lerpV(foot, add(hips, sloth ? [x * w * 0.9, -leg * 0.6, leg * 0.55] : [x * w * 0.6, -leg * 0.9, leg * 0.25]), q.hang);
  }
  return foot;
}

function primateHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const { hips, chest, tdir, r } = body;
  const hr = b.head * size * CHARM;
  const look = q.hang > 0.5 ? 0 : body.climbing ? 0.9 : m.moving > 0.05 || onFours(who, q) ? 0.35 : 0;
  const hd = dirOf(q.headYaw * 0.8, -0.1 + q.headPitch * 0.6 + look * 0.7);
  const neckTop = madd(chest, tdir, b.neck * size + r * 0.35);
  const head = madd(neckTop, hd, hr * 0.3);
  cap(kit, "torso", "coat", hips, chest, r);
  ball(kit, "chest", "coat", chest, r * 1.05);
  cap(kit, "belly", "belly", madd(hips, [0, 0, 1], r * 0.35), madd(chest, [0, 0, 1], r * 0.35), r * 0.62);
  cap(kit, "neck", "coat", chest, neckTop, r * 0.5);
  const h: Head = { c: head, d: hd, ...headAxes(hd, q.headRoll), r: hr };
  ball(kit, "head", "coat", head, hr);
  // (A flat face set into the fur, not a ball stuck on the front.)
  cap(kit, "face", "accent", at3(h, 0.56, 0, -0.08), at3(h, 0.56, 0, -0.08), hr * 0.68, 0.45, hd, { melt: 0.2 });
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
    limb(kit, `arm.${side}`, "coat", add(chest, [x * w, -r * 0.2, 0]), primateHand(who, body, x, m, head), [body.arm * 0.5, body.arm * 0.5], r * 0.34, [x * 0.3, 0, -1], claws, 0.45);
    limb(kit, `leg.${side}`, "coat", add(hips, [x * w * 0.6, 0, 0]), primateFoot(who, body, x, m), [body.leg * 0.5, body.leg * 0.5], r * 0.4, q.sit > 0.5 ? [x * 0.4, 1, 0.6] : [0, 0, 1], claws);
  }
  primateTail(kit, who, body, m);
}

// ---------------------------------------------------------------- birds

/** Beak colours; the rest of a bird's look is its coat. */
const BEAKS: Partial<Record<SpeciesId, string>> = { songbird: "#3a2a1a", crow: "#3a3a42", owl: "#5a4a30", parrot: "#2a2a2a", gull: "#f0c030", peacock: "#8a8a80", crane: "#c8c0a0", woodpecker: "#2a2a2a", kookaburra: "#2a2622", guineafowl: "#d8c8a0" };

/**
 * A bird's wing and how it uses it. `rate` is its wingbeat (radians a
 * second); `span` one wing's reach and `chord` its breadth, in the bird's
 * lengths; `fingers` the primaries that spread apart at the tip on held wings
 * (a crow's, a gull's, a crane's). The roles colour the wing's top, its
 * trailing edge and its tip, and the folded wing (the arm, then the hand over
 * the tail). Cruising, it holds its wings still for a `glide` share of each
 * `bout` (seconds); a `bound`ing bird shuts them between bursts instead and
 * dips (a finch, a woodpecker). `dihedral` lifts held wings into a shallow V.
 */
interface WingStyle {
  readonly rate: number;
  readonly span: number;
  readonly chord: number;
  readonly fingers: number;
  readonly top: Role;
  readonly trail: Role;
  readonly tip: Role;
  readonly fold: readonly [Role, Role];
  readonly glide: number;
  readonly bout: number;
  readonly bound: boolean;
  readonly dihedral: number;
  /** The tail's colour. */
  readonly tail: Role;
}
const WING: WingStyle = { rate: 14, span: 0.7, chord: 0.2, fingers: 0, top: "alt", trail: "alt", tip: "alt", fold: ["alt", "alt"], glide: 0.25, bout: 2, bound: false, dihedral: 0.06, tail: "alt" };
const WINGS: Partial<Record<SpeciesId, WingStyle>> = {
  songbird: { ...WING, rate: 28, span: 0.62, chord: 0.21, glide: 0, bout: 0.75, bound: true, dihedral: 0.04 },
  woodpecker: { ...WING, rate: 24, span: 0.66, chord: 0.21, top: "coat", trail: "alt", tip: "coat", fold: ["coat", "alt"], glide: 0, bout: 1.1, bound: true, tail: "coat" },
  parrot: { ...WING, rate: 19, span: 0.72, chord: 0.17, trail: "coat", fold: ["coat", "alt"], glide: 0.12, bout: 1.6 },
  crow: { ...WING, rate: 12, span: 0.86, chord: 0.24, fingers: 4, top: "coat", glide: 0.4, bout: 3.2, dihedral: 0.1 },
  owl: { ...WING, rate: 8, span: 0.92, chord: 0.32, top: "coat", fold: ["coat", "alt"], glide: 0.6, bout: 2.6, dihedral: 0.02 },
  gull: { ...WING, rate: 7.5, span: 1.08, chord: 0.17, fingers: 2, trail: "belly", tip: "dark", fold: ["alt", "dark"], glide: 0.75, bout: 4.5, dihedral: 0.14 },
  peacock: { ...WING, rate: 12, span: 0.5, chord: 0.24, glide: 0.35, bout: 1.4 },
  crane: { ...WING, rate: 5, span: 1.1, chord: 0.2, fingers: 4, top: "coat", tip: "coat", fold: ["coat", "alt"], glide: 0.35, bout: 5, dihedral: 0.08 },
  kookaburra: { ...WING, rate: 17, span: 0.66, chord: 0.23, glide: 0.3, bout: 1.6 },
  guineafowl: { ...WING, rate: 20, span: 0.5, chord: 0.27, top: "coat", fold: ["coat", "coat"], glide: 0.45, bout: 1.2 },
};
const wingStyle = (who: Who): WingStyle => WINGS[who.member.species] ?? WING;

/**
 * How a bird holds itself on its feet: its body's tilt standing or perched
 * (0 level, π/2 upright: a robin sits up, an owl stands straight, a gull and
 * a crane keep level), the tilt as it walks or hops, and its body's reach in
 * front of and behind its middle, in its lengths.
 */
interface Stance { readonly pitch: number; readonly walk: number; readonly fore: number; readonly aft: number }
const STANCE: Stance = { pitch: 0.4, walk: 0.3, fore: 0.22, aft: 0.26 };
const STANCES: Partial<Record<SpeciesId, Stance>> = {
  songbird: { pitch: 0.78, walk: 0.5, fore: 0.14, aft: 0.17 },
  woodpecker: { pitch: 0.82, walk: 0.5, fore: 0.16, aft: 0.2 },
  parrot: { pitch: 1, walk: 0.55, fore: 0.16, aft: 0.2 },
  crow: { pitch: 0.48, walk: 0.32, fore: 0.2, aft: 0.24 },
  owl: { pitch: 1.45, walk: 1.0, fore: 0.13, aft: 0.13 },
  gull: { pitch: 0.24, walk: 0.18, fore: 0.22, aft: 0.24 },
  peacock: { pitch: 0.22, walk: 0.18, fore: 0.2, aft: 0.24 },
  crane: { pitch: 0.16, walk: 0.12, fore: 0.2, aft: 0.22 },
  kookaburra: { pitch: 0.72, walk: 0.45, fore: 0.16, aft: 0.2 },
  guineafowl: { pitch: 0.18, walk: 0.14, fore: 0.18, aft: 0.2 },
};

/** A number in [0, 1) that is this bird's own (its size was seeded), so no two keep the same wingbeat. */
function ownPhase(who: Who): number {
  const v = Math.sin(who.member.heft * 12.9898 + who.member.size * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

interface BirdBody { readonly C: Vec; readonly K: Vec; readonly T: Vec; readonly r: number; readonly pitch: number; readonly flying: boolean; readonly flight: Flight }

/**
 * Where a bird is in its flight: beating hard to climb off, cruising on its
 * own rhythm (flaps and held wings, or bursts and shut wings), coming in on
 * spread wings, then flaring, its body tipped up and its feet thrown
 * forward, to kill its speed and land. All by the clock, so a long flight
 * round the tree cruises and a hop to the next branch is nearly all launch
 * and landing.
 */
interface Flight { readonly launch: number; readonly glide: number; readonly flare: number; readonly closed: number }

const ON_FOOT: Flight = { launch: 0, glide: 0, flare: 0, closed: 0 };

function flightOf(who: Who, m: Moment): Flight {
  if (m.mode !== "fly") return ON_FOOT;
  const style = wingStyle(who);
  const span = Math.max(0.01, m.segment.t1 - m.segment.t0);
  const since = clamp(m.t - m.segment.t0, 0, span);
  const left = span - since;
  const flare = smooth(1 - left / Math.min(0.75, span * 0.3));
  const launch = (1 - smooth(since / Math.min(0.9, span * 0.3))) * (1 - flare);
  const cruise = (1 - launch) * (1 - flare);
  const c = (since / style.bout + ownPhase(who)) % 1;
  const held = style.bound ? 0 : smooth((c - (1 - style.glide)) / 0.08) * smooth((1 - c) / 0.04);
  const shut = style.bound ? smooth((c - 0.6) / 0.05) * smooth((0.97 - c) / 0.05) : 0;
  const into = Math.min(2.2, span * 0.45);
  const coming = smooth((into - left) / Math.max(0.05, into * 0.3));
  return { launch, flare, glide: Math.max(held * cruise, coming * (1 - flare)), closed: shut * cruise * (1 - coming) };
}

function birdSpine(who: Who, m: Moment): BirdBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const stance = STANCES[who.member.species] ?? STANCE;
  const r = b.body * size * 0.85;
  const flying = m.mode === "fly";
  const flight = flightOf(who, m);
  const drum = m.segment.act === "drum";
  const standing = mix(stance.pitch, stance.walk, m.mode === "walk" ? m.moving : 0);
  let pitch = flying ? 0.05 + flight.launch * 0.3 + flight.flare * 0.85 : drum ? 1.35 : standing;
  pitch -= q.peck * (drum ? 0.15 : 0.6);
  const legH = b.leg * size;
  const along = dirOf(0, pitch);
  const aft = stance.aft * size;
  // Standing or asleep, the low end of the body (its tail end, as it sits up) stays on top of what it stands on.
  const rest = Math.max(legH + r * 1.06 + q.hop * size * 0.3 - (m.segment.act === "sleep" ? r * 0.35 : 0), r + Math.max(0, along[1]) * aft);
  const C: Vec = flying ? [0, 0, 0] : drum ? [0, 0, -r * 0.4] : [0, rest, 0];
  return { C, K: madd(C, along, stance.fore * size), T: madd(C, along, -aft), r, pitch, flying, flight };
}

function birdHead(kit: Kit, who: Who, body: BirdBody, m: Moment): Head {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const drum = m.segment.act === "drum";
  const tuck = m.segment.act === "sleep" ? 1 : 0;
  // (A bird that sits bolt upright, an owl, carries its head right on top of its body, not out in front.)
  const upright = body.flying ? 0 : clamp((body.pitch - 1.1) / 0.3, 0, 1);
  const neckBase = madd(body.K, UP, body.r * (0.45 + upright * 0.35));
  const neckDir = dirOf(q.headYaw * 0.5 + tuck * 2.6, (drum ? 0.2 : 1.2 + upright * 0.35) - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0));
  const neckTop = madd(neckBase, neckDir, Math.max(b.neck * size, body.r * 0.3) * (1 - tuck * 0.6));
  if (b.neck * size > body.r * 0.6) {
    // A red-crowned crane's neck is black above, white at its base.
    if (who.member.coat === "red-crowned") {
      const mid = lerpV(neckBase, neckTop, 0.4);
      cap(kit, "neck", "coat", neckBase, mid, body.r * 0.38);
      cap(kit, "neck.upper", "dark", mid, neckTop, body.r * 0.34);
    } else {
      cap(kit, "neck", "coat", neckBase, neckTop, body.r * 0.38);
    }
  }
  const hd = dirOf(q.headYaw + tuck * 2.6, -0.1 + q.headPitch * 0.5 - q.peck * (drum ? 0.1 : 1.1) - (drum ? 1.2 : 0) + (body.flying ? 0.05 : 0));
  const hr = b.head * size * CHARM;
  const c = madd(madd(neckTop, hd, hr * 0.4 * (1 - upright * 0.85)), drum ? [0, 0, 1] : UP, drum ? q.peck * size * 0.12 : hr * upright * 0.55);
  return { c, d: hd, ...headAxes(hd, q.headRoll), r: hr };
}

/**
 * The colour of a bird's head, where it is not its coat's: a kookaburra's
 * pale head, a guineafowl's bare blue one.
 */
const HEADS: Partial<Record<SpeciesId, Role>> = { kookaburra: "belly", guineafowl: "accent" };

function birdFace(kit: Kit, who: Who, h: Head, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const id = who.member.species;
  const owl = id === "owl";
  // (An owl's big round head sits on its body with a crease between, not melted into one egg.)
  cap(kit, "head", HEADS[id] ?? "coat", h.c, h.c, h.r, 1, UP, owl ? { melt: 0.35 } : undefined);
  birdBeak(kit, who, h, b.snout * size, m.pose.mouth);
  // An owl looks out of a flat pale face, both eyes forward on it, ringed darker.
  if (owl) {
    cap(kit, "disc", "belly", at3(h, 0.6, 0, -0.02), at3(h, 0.6, 0, -0.02), h.r * 0.86, 0.3, h.d, { melt: 0.1 });
    decal(kit, "disc.rim", "alt", at3(h, 0.55, -0.85, 0), at3(h, 0.55, 0.85, 0), h.r * 0.18);
  }
  // A kookaburra's dark stripe back through the eye.
  if (id === "kookaburra") for (const x of [-1, 1]) decal(kit, "stripe", "alt", at3(h, 0.3, x * 0.7, 0.15), at3(h, -0.75, x * 0.6, 0.05), h.r * 0.2);
  for (const x of [-1, 1]) {
    const eye = owl ? at3(h, 0.86, x * 0.38, 0.12) : at3(h, 0.35, x * 0.62, 0.2);
    eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, eye, h.r * (owl ? 0.27 : 0.2), m.segment.act !== "sleep");
  }
  birdCrest(kit, who, h);
}

/** The bill: a parrot's (and an owl's) hooks down at the tip; open, its lower half drops. */
function birdBeak(kit: Kit, who: Who, h: Head, beak: number, mouth: number): void {
  const owl = who.member.species === "owl";
  const root = at3(h, owl ? 0.82 : 0.65, 0, owl ? -0.1 : 0.05);
  const tip = madd(root, h.d, beak);
  // (Tapered to its point, so a small bird's bill reads as a bill and not a dark bead.)
  const br = h.r * (owl ? 0.2 : 0.27);
  cap(kit, "beak", "horn", root, tip, br, 1, UP, { r1: br * 0.28, melt: 0.5 });
  if (who.member.species === "parrot" || owl) cap(kit, "beak.hook", "horn", tip, madd(madd(tip, h.u, -beak * 0.55), h.d, -beak * 0.15), h.r * (owl ? 0.13 : 0.2));
  if (mouth > 0.05) cap(kit, "beak.lower", "horn", at3(h, 0.6, 0, -0.15), madd(madd(at3(h, 0.6, 0, -0.15), h.d, beak * 0.85), h.u, -beak * 0.5 * mouth), h.r * 0.2);
}

function birdCrest(kit: Kit, who: Who, h: Head): void {
  const b = who.spec.build;
  const id = who.member.species;
  if (b.extras.includes("crest")) {
    if (id === "woodpecker") {
      // A woodpecker's red is a patch on its crown and nape, not a plume.
      ball(kit, "crest", "accent", at3(h, -0.5, 0, 0.55), h.r * 0.32, 0.4, unit(add(h.u, scale(h.d, -0.8))));
    } else if (who.member.coat === "cockatoo") {
      // A cockatoo's crest: a few thin feathers raised up and back.
      for (const [i, s] of [[0, 0], [1, -0.28], [2, 0.28]] as const) {
        const root = at3(h, -0.05 - i * 0.05, s * 0.4, 0.75);
        cap(kit, `crest.${String(i)}`, "accent", root, madd(root, unit(add(add(h.u, scale(h.d, -0.9)), scale(h.s, s))), h.r * (0.95 - i * 0.12)), h.r * 0.12, 0.45, h.s);
      }
    }
  }
  if (b.extras.includes("crown")) {
    if (id === "peacock") for (const x of [-0.4, 0, 0.4]) ball(kit, "crown", "accent", madd(at3(h, -0.1, x, 0.9), h.u, h.r * 0.8), h.r * 0.22);
    else if (id === "guineafowl") {
      // A helmeted guineafowl's bony casque, up and back off its bare blue crown.
      const root = at3(h, -0.1, 0, 0.7);
      cap(kit, "casque", "horn", root, madd(root, unit(add(h.u, scale(h.d, -0.55))), h.r * 1.1), h.r * 0.42, 0.7, h.s, { r1: h.r * 0.12, melt: 0.5 });
    } else ball(kit, "crown", "accent", at3(h, 0.1, 0, 0.78), h.r * 0.5, 0.5);
  }
  // Ear tufts are a horned owl's alone; a barn or snowy owl has a smooth round head.
  if (b.ears === "tuft" && (id !== "owl" || who.member.coat === "great horned")) earsOf(kit, "tuft", h, 0);
}

/**
 * What a wing is doing this moment: how high the arm is raised (`elev`), how
 * far the hand is flexed back (on the upstroke, to slip the air), how far the
 * primaries spread (held wings, a flare), how open the whole wing is (0
 * folded on the back) and how far it sweeps back.
 */
interface Beat { readonly elev: number; readonly flex: number; readonly spread: number; readonly open: number; readonly sweep: number }

function wingBeat(who: Who, body: BirdBody, m: Moment): Beat {
  const q = m.pose;
  if (!body.flying) {
    // A flap on the spot, a display, a stretch: open and beating; otherwise folded.
    const open = clamp(q.wing, 0, 1);
    return { elev: 0.25 + 0.75 * q.flap, flex: 0.25 * (1 - q.flap), spread: open * 0.6, open, sweep: 0 };
  }
  const style = wingStyle(who);
  const f = body.flight;
  const phase = m.t * style.rate * (1 + f.launch * 0.3 + f.flare * 0.5) + ownPhase(who) * TAU;
  const amp = mix(0.75, 1.05, f.launch);
  const s = Math.sin(phase);
  // (The wing is rising while the sine climbs: the upstroke.)
  const rising = Math.max(0, Math.cos(phase));
  const held = f.glide;
  return {
    elev: mix(mix(0.12 + amp * s, style.dihedral + 0.03 * Math.sin(m.t * 1.7), held), 0.5 + 0.5 * s, f.flare),
    flex: mix(rising * 0.75, 0, held) * (1 - f.flare * 0.5),
    spread: Math.max(held, f.flare, 0.3 * (1 - rising)),
    open: 1 - f.closed * 0.85,
    sweep: f.closed * 0.6 - f.flare * 0.35 + held * 0.08,
  };
}

/**
 * One wing. Folded, two flat plates along the body's side, the hand crossing
 * over the tail. Open, a broad arm with its trailing edge in its own colour
 * and a long hand, its tip in the tip colour or splayed into primaries: the
 * arm rises and falls with the beat, the hand further, flexed back on the
 * upstroke and straight out on the downstroke.
 */
function wingOf(kit: Kit, who: Who, body: BirdBody, x: number, m: Moment): void {
  const style = wingStyle(who);
  const beat = wingBeat(who, body, m);
  const size = who.member.size;
  const span = style.span * size;
  const chord = style.chord * size;
  const L = x < 0 ? "L" : "R";
  const side: Vec = [x, 0, 0];
  const forward = dirOf(0, body.pitch);
  const shoulder = add(body.K, [x * body.r * 0.7, body.r * 0.3, -body.r * 0.1]);
  const foldElbow = madd(madd(body.C, side, body.r * 0.92), forward, body.r * 0.1);
  const foldTip = madd(madd(body.T, side, body.r * 0.45), forward, -size * 0.16);
  const open = beat.open;
  const armDir = unit([x * Math.cos(beat.elev), Math.sin(beat.elev), -0.12 - beat.sweep * 0.5]);
  const handElev = beat.elev * 1.35 - beat.flex * 0.35;
  const handDir = unit([x * Math.cos(handElev) * (1 - beat.flex * 0.45), Math.sin(handElev), -0.28 - beat.flex * 0.9 - beat.sweep]);
  const elbow = lerpV(foldElbow, madd(shoulder, armDir, span * 0.44), open);
  const tip = lerpV(foldTip, madd(elbow, handDir, span * 0.56 * (1 - beat.flex * 0.25)), open);
  if (open < 0.45) {
    cap(kit, `wing.${L}`, style.fold[0], shoulder, elbow, body.r * 0.62, 0.3, side, { melt: 0.6 });
    cap(kit, `wingtip.${L}`, style.fold[1], elbow, tip, body.r * 0.48, 0.26, side, { r1: body.r * 0.3, melt: 0.45 });
    return;
  }
  const plane = (dir: Vec): Vec => unit(cross(dir, [0, 0, 1]), UP);
  const armUp = plane(sub(elbow, shoulder));
  const handUp = plane(sub(tip, elbow));
  const behind = (p: Vec, k: number): Vec => madd(p, [0, 0, -1], chord * k);
  // (Thin, and melting only a little into the body, so a wing reads as a wing at any size: the arm broad, the hand tapering to its tip.)
  const wing: Finish = { melt: 0.3 };
  cap(kit, `wing.${L}`, style.top, behind(shoulder, 0.1), behind(elbow, 0.1), chord * 0.46, 0.16, armUp, { ...wing, r1: chord * 0.42 });
  cap(kit, `wing.trail.${L}`, style.trail, behind(shoulder, 0.5), behind(elbow, 0.45), chord * 0.3, 0.14, armUp, { melt: 0.15 });
  const fingers = style.fingers > 0 && beat.spread > 0.35 ? style.fingers : 0;
  const wrist = fingers > 0 ? lerpV(elbow, tip, 0.55) : tip;
  cap(kit, `wing.hand.${L}`, style.top, behind(elbow, 0.12), behind(wrist, 0.05), chord * 0.4, 0.15, handUp, { melt: 0.15, r1: chord * (fingers > 0 ? 0.3 : 0.16) });
  if (fingers === 0) {
    cap(kit, `wingtip.${L}`, style.tip, behind(lerpV(elbow, tip, 0.6), 0.03), tip, chord * 0.26, 0.14, handUp, { melt: 0.1, r1: chord * 0.08 });
    return;
  }
  // The primaries, splayed like fingers: the more it holds its wings, the wider.
  const axis = unit(sub(tip, elbow));
  const across = unit(cross(handUp, axis), [0, 0, -1]);
  const back = across[2] <= 0 ? across : scale(across, -1);
  const reach = length(sub(tip, wrist));
  for (let i = 0; i < fingers; i += 1) {
    const k = i / (fingers - 1 || 1);
    const dir = unit(madd(axis, back, (k * 0.95 - 0.15) * beat.spread));
    const root = madd(wrist, back, chord * (k * 0.5 - 0.1));
    cap(kit, `wing.primary.${L}${String(i)}`, style.tip, root, madd(root, dir, reach * (1 - k * 0.25)), chord * 0.11, 0.35, handUp, { melt: 0.1, r1: chord * 0.06 });
  }
}

function birdTail(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const tilt = -body.pitch * 0.8 - 0.1 + m.pose.tailUp;
  // On the ground a tail (or a train) drags along it, never through it.
  const floor = m.mode !== "fly" && m.segment.to.on === "ground" && m.segment.from.on === "ground";
  const above = (tip: Vec, r: number): Vec => (floor ? [tip[0], Math.max(tip[1], r), tip[2]] : tip);
  if (!b.extras.includes("train")) {
    // A fan of feathers, spread wide as it steers and lands, closed as it sits.
    const spread = clamp(0.1 + body.flight.flare * 0.45 + body.flight.glide * 0.2 + m.pose.fan * 0.4, 0, 0.6);
    for (const k of [-1, 0, 1]) {
      const dir = dirOf(Math.PI + 0.15 * m.pose.tailWag + k * spread, tilt);
      const r = body.r * (k === 0 ? 0.42 : 0.34);
      cap(kit, `tail.${String(k + 1)}`, wingStyle(who).tail, body.T, above(madd(body.T, dir, b.tailLen * size * (k === 0 ? 1 : 0.9)), r * 0.3), r, 0.22, unit(cross(dir, [1, 0, 0]), UP));
    }
    return;
  }
  const fan = m.pose.fan;
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 8 - 0.5) * 2.6;
    const spread = unit(add(scale(UP, Math.cos(a)), scale([1, 0, 0], Math.sin(a))));
    const dir = unit(lerpV(dirOf(Math.PI + (i / 8 - 0.5) * 0.3, -0.25), add(spread, [0, 0, -0.25]), fan));
    const tip = above(madd(body.T, dir, b.tailLen * size * (0.85 + 0.15 * Math.cos(a))), body.r * 0.42);
    cap(kit, `train.${String(i)}`, "alt", body.T, tip, body.r * 0.42, 0.18, unit(cross(dir, [0, 0, 1]), UP));
    if (fan > 0.3) ball(kit, `eyespot.${String(i)}`, "accent", lerpV(body.T, tip, 0.85), body.r * 0.32, 0.3, [0, 0, 1]);
  }
}

/** Plumage painted on: a guineafowl's white pearl spots all over, a kookaburra's brown mantle over its pale body. */
function birdMarks(kit: Kit, who: Who, body: BirdBody): void {
  const id = who.member.species;
  const over: Vec = [0, Math.cos(body.pitch), -Math.sin(body.pitch)];
  if (id === "kookaburra") decal(kit, "mantle", "alt", madd(body.T, over, body.r * 0.75), madd(body.K, over, body.r * 0.6), body.r * 0.62);
  if (id !== "guineafowl" || !who.spec.build.extras.includes("spots")) return;
  for (let i = 0; i < 10; i += 1) {
    const along = lerpV(body.T, body.K, 0.1 + (i % 5) * 0.2);
    const a = (i < 5 ? 0.55 : -0.55) + (i % 2) * 0.35;
    const at = madd(madd(along, over, body.r * 0.95 * Math.cos(a)), [1, 0, 0], body.r * 0.95 * Math.sin(a));
    decal(kit, "spot", "shine", at, at, body.r * 0.24);
  }
}

function poseBird(kit: Kit, who: Who, m: Moment): void {
  const body = birdSpine(who, m);
  const b = who.spec.build;
  const size = who.member.size;
  cap(kit, "body", "coat", body.T, body.K, body.r);
  // The breast on the body's front-and-under side, whichever way it is tipped.
  const under: Vec = [0, -Math.cos(body.pitch), Math.sin(body.pitch)];
  ball(kit, "breast", "belly", madd(lerpV(body.C, body.K, 0.55), under, body.r * 0.32), body.r * 0.86);
  birdMarks(kit, who, body);
  const head = birdHead(kit, who, body, m);
  birdFace(kit, who, head, m);
  for (const x of [-1, 1]) wingOf(kit, who, body, x, m);
  birdTail(kit, who, body, m);
  const legH = b.leg * size;
  // A long-legged bird trails its legs out behind it in the air; others tuck them in.
  const trails = legH > body.r * 2.5;
  for (const x of [-1, 1]) {
    const hip = add(body.C, [x * body.r * 0.35, -body.r * 0.6, 0]);
    if (body.flying) {
      const tucked: Vec = trails ? [x * body.r * 0.15, -body.r * 0.25, -(legH + body.r * 0.9)] : [0, -body.r * 0.2, -body.r * 1.1];
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
    // At rest a snake lies in a loose S, a lizard nearly straight.
    const rest = size * (lizard ? 0.07 : 0.12) * Math.sin(i * (lizard ? 0.55 : 0.62) + 0.2 * Math.sin(m.t * 0.3)) * (1 - m.moving);
    const straight: Vec = [moving + rest, r0, -i * seg * 0.95];
    // Coiled, one loose turn (an open ring at a distance, not a disc), the head reared up in the middle.
    const a = i * 0.55;
    const ring = r0 * (8.5 - i * 0.42);
    const coil: Vec = [Math.cos(a) * ring, r0 + (n - i) * r0 * 0.2, Math.sin(a) * ring - r0 * 8.5];
    const lift = Math.max(0, 3 - i) / 3;
    const rear = lizard ? 0 : q.curl * lift * size * 0.14;
    points.push(add(lerpV(straight, coil, lizard ? 0 : q.curl), [0, rear + lift * (q.headPitch * size * 0.08 + q.mouth * size * 0.02), 0]));
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
    // Slim at the neck, fullest a third of the way down, to a fine tip.
    const girth = (k: number): number => r0 * (k < 0.3 ? 0.78 + (k / 0.3) * 0.22 : 1 - Math.pow((k - 0.3) / 0.7, 1.6) * 0.85);
    const taper = girth(i / n);
    cap(kit, `body.${i}`, banded && i % 2 === 1 ? "alt" : "coat", a, c, taper, 0.8, UP, { r1: girth((i + 1) / n) });
    serpentMark(kit, who, lerpV(a, c, 0.5), r0 * taper, i, n);
  }
  serpentHead(kit, who, points, m);
  if (b.leg > 0) lizardLegs(kit, who, points, m);
}

/** A gecko's spots; down a plain snake's back, saddle marks, so it reads as a snake and not a root. */
function serpentMark(kit: Kit, who: Who, at: Vec, r: number, i: number, n: number): void {
  const b = who.spec.build;
  if (b.extras.includes("spots")) {
    if (i % 2 === 0) ball(kit, "spot", "accent", add(at, [0, r * 0.6, 0]), r * 0.35, 0.5);
    return;
  }
  if (who.member.coat !== "banded" && b.leg === 0 && i % 2 === 1 && i < n - 2) ball(kit, "saddle", "alt", add(at, [0, r * 0.55, 0]), r * 0.78, 0.45);
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
    // Thin, broad wings that never melt into the body or each other: a
    // forewing swept forward and a smaller hindwing, each with a dark edge
    // and a pale spot painted on.
    const fore = add(madd(C, dir, size * 0.5 * reach), scale(fw, size * 0.2));
    const hind = add(madd(C, dir, size * 0.36 * reach), scale(fw, -size * 0.2));
    cap(kit, `wing.${x}`, "coat", madd(C, fw, size * 0.06), fore, size * 0.1 * reach, 0.08, normal, { r1: size * 0.24 * reach, melt: 0 });
    cap(kit, `hindwing.${x}`, "coat", madd(C, fw, -size * 0.04), hind, size * 0.08 * reach, 0.08, normal, { r1: size * 0.18 * reach, melt: 0 });
    if (!firefly) {
      decal(kit, "wingedge", "alt", madd(fore, dir, size * 0.12), madd(hind, dir, size * 0.1), size * 0.12);
      decal(kit, "wingspot", "accent", add(madd(C, dir, size * 0.42), scale(fw, size * 0.16)), add(madd(C, dir, size * 0.42), scale(fw, size * 0.16)), size * 0.06);
    }
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
      limb(kit, `leg.${x}.${i}`, "alt", add(C, [x * r * 0.85, 0, z]), [x * (r + legLen * 0.9) + step.z, step.y, z * 1.3], [legLen * 0.6, legLen * 0.6], r * 0.085, [x, 1, 0], "alt", 0.25);
    }
    // (A fiddler's one claw is huge, and it is the one it waves.)
    const fiddler = who.member.coat === "fiddler" ? (x > 0 ? 2.5 : 0.6) : 1;
    const wave = x > 0 ? q.reach : 0;
    const claw = add(C, [x * r * 0.9, r * 0.3 + wave * r * 1.5, r * 1.5]);
    limb(kit, `claw.${x}`, "coat", add(C, [x * r * 0.7, 0, r * 0.6]), claw, [r * 0.8, r * 0.8], r * 0.13 * Math.sqrt(fiddler), [x, 0, 1], "accent", 0.4);
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
  tanuki: "#2a1a10", possum: "#1a1210", loris: "#5a2a10", mongoose: "#8a5a1a", kookaburra: "#3a2414", guineafowl: "#5a2414",
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

/** Part way to its own grey: a plain coat sits in the scene's tones and leaves the loud colours to the tree. */
const muted = (hex: string, k: number): string => { const [r, g, b] = hexRgb(hex); const y = r * 0.3 + g * 0.59 + b * 0.11; return rgbHex([r, g, b].map((c) => mix(c, y, k))); };

function paletteOf(id: SpeciesId, colors: CoatColors, morph: Morph): Palette {
  const plain = morph === "normal" ? 0.32 : 0;
  const [coat, alt, belly, dark, accent] = colors.map((hex, i) => (i < 3 ? muted(hex, plain) : hex)) as unknown as CoatColors;
  const base: Palette = { coat, alt, belly, dark, accent, eye: IRIS[id] ?? "#4a2a16", pupil: "#070505", shine: "#ffffff", nose: dark, glow: accent, horn: BEAKS[id] ?? "#cbb38c", shell: alt };
  return skinOf(base, morph);
}

// ---------------------------------------------------------------- casting

export interface CastMember {
  readonly species: SpeciesId;
  readonly label: string;
  /** How big it is drawn: its true size, lifted toward a toy scale so small animals read (see `shownSize`). */
  readonly size: number;
  /** Its true size, before that lift: what it weighs on a branch goes by this. */
  readonly heft: number;
  readonly coat: string;
  readonly palette: Palette;
  readonly morph: Morph;
  readonly young: boolean;
  /** Antlered (a stag, not a doe). */
  readonly horned: boolean;
  /** What makes this one itself: its sex, its proportions, its pace and its nerve. */
  readonly traits: Traits;
}

/**
 * One animal's own make and manner, drawn on its own stream so the cast's
 * coat and size rolls never move. The build shares multiply its kind's
 * proportions (a fox with longer legs, a rabbit with a bigger head); tempo
 * scales its gait; bold above 1 watches less and roams farther; lively scales
 * how much it gets up to.
 */
export interface Traits {
  readonly sex: "male" | "female";
  readonly len: number;
  readonly leg: number;
  readonly body: number;
  readonly head: number;
  readonly snout: number;
  readonly neck: number;
  readonly tail: number;
  readonly ears: number;
  readonly tempo: number;
  readonly bold: number;
  readonly lively: number;
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

/**
 * Animals share a scene with a whole tree, so drawn true to life a mouse or a
 * songbird is a pixel or two. Each is drawn at a toy scale instead: small
 * animals grow the most (a square-root curve), a deer hardly at all, and
 * none shrinks. Casting, room and weight on a branch still go by the true
 * size. Birds go by the same curve (a songbird, three and a half times
 * its size at most, so it still reads as a bird at grove scale); insects
 * 1.6 times. A snake is long already and keeps
 * its true size.
 */
const TOY = 1.2;
export function shownSize(id: SpeciesId, size: number): number {
  const plan = speciesOf(id).plan;
  if (plan === "bug") return size * 1.6;
  if (plan === "serpent") return size;
  if (plan === "bird") return Math.max(size, Math.min(size * 3.5, TOY * Math.sqrt(size)));
  return Math.max(size, TOY * Math.sqrt(size));
}

/** A special skin, or none: forced, or rolled on its own stream so the coat and size rolls never move it. */
function morphFor(skin: () => number, input: CastInput): Morph {
  if (Object.hasOwn(MORPHS, input.morph ?? "")) return input.morph as Morph;
  const skins = [...(WORLD_SKINS[contextOf(input).world] ?? []), ...WILD_SKINS];
  const rare = skins.reduce((sum, [, odds]) => sum + odds, 0);
  return pick(skin, [["normal", Math.max(0, 1 - rare)], ...skins]);
}

// ---- local casts: who lives where, what they look like there and what they are called

/**
 * How much likelier (or rarer) a species is in a region than its own weight
 * says, so each place is led by its own animals: mule deer and magpies in the
 * Rockies, grey squirrels and raccoons on the Atlantic coast, marmots in the
 * Alps, tanuki and jungle crows in Tokyo, kangaroos and cockatoos round Sydney,
 * vervets and guineafowl in Nairobi, macaques and tokay geckos in Bali. Left
 * out, a species keeps its weight.
 */
const LOCAL_WEIGHT: Readonly<Record<RegionId, Partial<Record<SpeciesId, number>>>> = {
  rockies: { deer: 1.7, crow: 1.3, rabbit: 1.2, raccoon: 1.1, bear: 1.4, wolf: 0.4, cat: 0.6, mouse: 0.6, squirrel: 0.9, butterfly: 0.8, songbird: 0.9, marmot: 1.2 },
  atlantic: { squirrel: 1.5, raccoon: 1.7, deer: 1.3, rabbit: 1.1, firefly: 1.5, crow: 1.2, gull: 1.2, cat: 0.7, mouse: 0.6, songbird: 0.9, butterfly: 0.8 },
  alps: { deer: 1.4, fox: 1.3, squirrel: 1.1, rabbit: 0.5, crow: 1.3, hedgehog: 1.5, bear: 0.5, wolf: 0.7, cat: 0.6, mouse: 0.7, songbird: 0.9, butterfly: 0.9, marmot: 2.2 },
  tokyo: { macaque: 2.2, deer: 1.3, crow: 2, crane: 1.4, firefly: 1.5, tanuki: 1.6, squirrel: 0.6, rabbit: 0.35, capybara: 0.3, redpanda: 0.5, gull: 0.8, songbird: 0.9, butterfly: 0.8, mouse: 0.6 },
  sydney: { kangaroo: 2.4, koala: 2, parrot: 2.6, crow: 1.6, kookaburra: 1.8, possum: 1.4, cat: 0.5, mouse: 0.5, songbird: 0.8, butterfly: 0.7, gecko: 0.8 },
  nairobi: { monkey: 2.2, crane: 2.4, guineafowl: 1.8, dikdik: 1.6, mongoose: 1.8, songbird: 1, crow: 1, tortoise: 1.2, cat: 0.4, mouse: 0.6, butterfly: 0.8, owl: 0.8 },
  bali: { monkey: 2.6, gecko: 2.2, loris: 1.5, peacock: 1.5, firefly: 1.2, crow: 0.7, gull: 0.3, parrot: 0.35, cat: 0.6, mouse: 0.6, butterfly: 0.9 },
};
/** And in a world: a wild grove keeps its cats and mice few; a city has them everywhere. */
const WORLD_WEIGHT: Partial<Record<WorldKey, Partial<Record<SpeciesId, number>>>> = {
  nature: { cat: 0.45, mouse: 0.8 },
  voxel: { cat: 0.45, mouse: 0.8 },
  city: { cat: 1.6, crow: 1.4, raccoon: 1.3, tanuki: 1.2 },
};

/** A coat a species wears in a region, how often, and the name it goes by there (the species' own when left out). */
type Look = readonly [coat: string, weight: number, label?: string];
/** Each region's own forms of the wide-ranging species. Left out, a species wears its own coats anywhere. */
const LOOKS: Partial<Record<SpeciesId, Partial<Record<RegionId, readonly Look[]>>>> = {
  rabbit: { rockies: [["cottontail", 1, "Cottontail"]], atlantic: [["cottontail", 1, "Cottontail"]], alps: [["wild", 3], ["snowshoe", 1, "Mountain hare"]], tokyo: [["hare", 1, "Japanese hare"]] },
  fox: { rockies: [["red", 5], ["cross", 1, "Cross fox"]], atlantic: [["red", 1]], alps: [["red", 1]], tokyo: [["red", 1]] },
  deer: { rockies: [["mule", 1, "Mule deer"]], atlantic: [["whitetail", 1, "White-tailed deer"]], alps: [["roe", 3, "Roe deer"], ["red", 2, "Red deer"]], tokyo: [["sika", 1, "Sika deer"]] },
  wolf: { rockies: [["grey", 4], ["timber", 1], ["black", 1]], alps: [["grey", 1]] },
  bear: { rockies: [["black", 3, "Black bear"], ["cinnamon", 2, "Black bear"]], alps: [["brown", 1, "Brown bear"]], tokyo: [["moon", 1, "Asian black bear"]] },
  raccoon: { rockies: [["raccoon", 1]], atlantic: [["raccoon", 1]] },
  hedgehog: { alps: [["brown", 1]] },
  mouse: { rockies: [["deer mouse", 1, "Deer mouse"]], atlantic: [["deer mouse", 1, "White-footed mouse"]], alps: [["field", 1, "Wood mouse"]], tokyo: [["field", 1]], sydney: [["grey", 1, "House mouse"]], nairobi: [["striped", 1, "Striped grass mouse"]], bali: [["grey", 1, "House mouse"]] },
  squirrel: {
    rockies: [["abert", 2, "Abert's squirrel"], ["chipmunk", 3, "Chipmunk"], ["red", 1, "Pine squirrel"]],
    atlantic: [["grey", 4, "Grey squirrel"], ["chipmunk", 2, "Chipmunk"], ["black", 1, "Grey squirrel"]],
    alps: [["red", 3, "Red squirrel"], ["black", 2, "Red squirrel"]],
    tokyo: [["japanese", 1, "Japanese squirrel"]],
  },
  macaque: { tokyo: [["snow", 1, "Japanese macaque"]] },
  monkey: { bali: [["macaque", 1]], nairobi: [["vervet", 1, "Vervet monkey"]] },
  songbird: {
    rockies: [["american robin", 3, "American robin"], ["bluebird", 2, "Mountain bluebird"], ["chickadee", 2, "Chickadee"], ["steller's jay", 1, "Steller's jay"]],
    atlantic: [["american robin", 3, "American robin"], ["cardinal", 2, "Cardinal"], ["blue jay", 2, "Blue jay"], ["chickadee", 2, "Chickadee"], ["goldfinch", 1, "Goldfinch"], ["sparrow", 1, "Sparrow"]],
    alps: [["robin", 3, "Robin"], ["blackbird", 2, "Blackbird"], ["great tit", 2, "Great tit"], ["sparrow", 1, "Sparrow"]],
    tokyo: [["white-eye", 3, "Japanese white-eye"], ["sparrow", 2, "Tree sparrow"], ["bulbul", 2, "Brown-eared bulbul"]],
    sydney: [["fairy-wren", 3, "Superb fairy-wren"], ["noisy miner", 2, "Noisy miner"], ["sparrow", 1, "Sparrow"]],
    nairobi: [["superb starling", 3, "Superb starling"], ["sunbird", 2, "Sunbird"], ["sparrow", 1, "Weaver"]],
    bali: [["java sparrow", 2, "Java sparrow"], ["bali myna", 1, "Bali myna"], ["white-eye", 2, "White-eye"]],
  },
  crow: {
    rockies: [["magpie", 3, "Black-billed magpie"], ["crow", 2, "Raven"]], atlantic: [["crow", 1, "American crow"]], alps: [["crow", 3, "Carrion crow"], ["hooded", 1, "Hooded crow"]],
    tokyo: [["crow", 1, "Jungle crow"]], sydney: [["magpie-lark", 3, "Australian magpie"], ["crow", 1, "Raven"]], nairobi: [["pied", 1, "Pied crow"]], bali: [["crow", 1, "Large-billed crow"]],
  },
  owl: { rockies: [["great horned", 1, "Great horned owl"]], atlantic: [["great horned", 2, "Great horned owl"], ["barn", 1, "Barn owl"]], alps: [["tawny", 2, "Tawny owl"], ["great horned", 1, "Eagle owl"]], tokyo: [["ural", 1, "Ural owl"]], nairobi: [["barn", 1, "Barn owl"]] },
  parrot: { sydney: [["cockatoo", 3, "Sulphur-crested cockatoo"], ["lorikeet", 3, "Rainbow lorikeet"], ["galah", 2, "Galah"]], bali: [["lorikeet", 1, "Lorikeet"]] },
  gull: { atlantic: [["herring", 3, "Herring gull"], ["black-backed", 1, "Black-backed gull"]], sydney: [["silver", 1, "Silver gull"]], tokyo: [["herring", 1, "Black-tailed gull"]], bali: [["herring", 1]] },
  peacock: { bali: [["green", 1, "Green peafowl"]] },
  crane: { tokyo: [["red-crowned", 1, "Red-crowned crane"]], nairobi: [["grey crowned", 1, "Grey crowned crane"]] },
  woodpecker: { rockies: [["downy", 1, "Downy woodpecker"]], atlantic: [["downy", 1, "Downy woodpecker"]], alps: [["downy", 2, "Great spotted woodpecker"], ["green", 1, "Green woodpecker"]], tokyo: [["downy", 1, "Pygmy woodpecker"]] },
  snake: { rockies: [["garter", 1, "Garter snake"]], sydney: [["red-bellied", 1, "Red-bellied black snake"]], nairobi: [["green", 2, "Green mamba"], ["banded", 1]], bali: [["green", 1, "Tree snake"]] },
  gecko: { bali: [["tokay", 1, "Tokay gecko"]], sydney: [["leaf", 1, "Velvet gecko"]], nairobi: [["leaf", 1, "Day gecko"]] },
  butterfly: {
    rockies: [["monarch", 2, "Monarch"], ["swallowtail", 2, "Swallowtail"], ["cabbage", 1, "Cabbage white"]], atlantic: [["monarch", 3, "Monarch"], ["swallowtail", 1, "Swallowtail"], ["cabbage", 1, "Cabbage white"]],
    alps: [["peacock", 2, "Peacock butterfly"], ["swallowtail", 1, "Swallowtail"], ["cabbage", 2, "Cabbage white"]], tokyo: [["swallowtail", 2, "Swallowtail"], ["cabbage", 1, "Cabbage white"]],
    sydney: [["monarch", 1, "Wanderer"]], nairobi: [["monarch", 1, "African monarch"], ["swallowtail", 1, "Swallowtail"]], bali: [["birdwing", 2, "Birdwing"], ["swallowtail", 1, "Swallowtail"]],
  },
  crab: { atlantic: [["fiddler", 1, "Fiddler crab"]], sydney: [["ghost", 1, "Ghost crab"]], tokyo: [["red", 1]], nairobi: [["ghost", 1, "Ghost crab"]], bali: [["red", 2], ["fiddler", 1, "Fiddler crab"]] },
  kangaroo: { sydney: [["grey", 3, "Eastern grey kangaroo"], ["red", 1]] },
  tortoise: { nairobi: [["leopard", 1, "Leopard tortoise"]] },
  marmot: { alps: [["alpine", 1, "Alpine marmot"]], rockies: [["yellow-bellied", 1, "Yellow-bellied marmot"]] },
};
/** The colours of the local coats that are not among a species' own (coat, alt, belly, dark, accent). */
const LOCAL_COATS: Partial<Record<SpeciesId, Readonly<Record<string, CoatColors>>>> = {
  rabbit: { cottontail: ["#8e765a", "#6c5842", "#efe6d6", "#3a2c22", "#ffffff"], hare: ["#8a7458", "#6a563e", "#e8dcc8", "#2a2018", "#e8a8a8"] },
  fox: { cross: ["#a8582a", "#3a2a22", "#e8e0d4", "#141010", "#f4efe6"] },
  deer: { mule: ["#8a7866", "#6a5a4a", "#f0e8dc", "#2a2018", "#f8f4ec"], roe: ["#a8643a", "#7e4826", "#efe2cc", "#241812", "#ffffff"], red: ["#8a5236", "#5e3420", "#c8a07a", "#22140c", "#e8d8c0"] },
  bear: { moon: ["#1e1c1c", "#121010", "#2a2626", "#080606", "#f0ece4"] },
  mouse: { "deer mouse": ["#8a6a4a", "#5e4630", "#f4f0e8", "#1a120c", "#f0a8a8"], striped: ["#8a7a5a", "#4a3e2a", "#d8ccb0", "#141008", "#f0a8a8"] },
  squirrel: { abert: ["#5a5a5e", "#2e2e32", "#f0f0f0", "#141416", "#b8582a"], chipmunk: ["#b07a48", "#3a2a1e", "#f0e4d0", "#1a120c", "#f4ece0"], japanese: ["#8a6e58", "#5e4a3a", "#f0e8dc", "#1e160e", "#f4ece0"] },
  songbird: {
    "american robin": ["#5a5450", "#3a3634", "#c8582a", "#141210", "#f0c040"], cardinal: ["#c8201e", "#8a1414", "#d8402a", "#141010", "#f08030"],
    "blue jay": ["#4a7ad0", "#f4f4f0", "#e8eef4", "#141418", "#2a2a2a"], chickadee: ["#9a9a94", "#1a1a1a", "#efe8dc", "#0e0e0e", "#f4f4f0"],
    "steller's jay": ["#1a3a8a", "#141a2a", "#2a4a9a", "#0a0a10", "#3a5ad0"], blackbird: ["#1e1c1c", "#141212", "#2a2828", "#0a0a0a", "#f0a020"],
    "great tit": ["#5a7a3a", "#1a1a1a", "#f0d84a", "#0e0e0e", "#f4f4f0"], "white-eye": ["#8aa83a", "#6a8a2a", "#d8d890", "#1a1a10", "#ffffff"],
    bulbul: ["#7a7a80", "#5a5a60", "#a8a8ae", "#1a1a1e", "#a85a3a"], "fairy-wren": ["#2a6ae0", "#1a1a2a", "#d8d4c8", "#0a0a14", "#4ab8f0"],
    "noisy miner": ["#9a9a96", "#5a5a58", "#e0ded8", "#141414", "#f0d020"], "superb starling": ["#2a7a8a", "#1a4a6a", "#e07a2a", "#0a1418", "#f4f4f0"],
    sunbird: ["#2a9a5a", "#6a2a8a", "#e83a3a", "#0a1410", "#f0d020"], "java sparrow": ["#7a8088", "#1a1a1a", "#e8d0d0", "#0e0e10", "#f0f0f0"],
    "bali myna": ["#f4f4f0", "#e8e8e2", "#ffffff", "#1a1a1a", "#3a6ad0"],
  },
  crow: { magpie: ["#141418", "#f4f4f0", "#f4f4f0", "#08080a", "#2a4ab8"], "magpie-lark": ["#141414", "#f4f4f0", "#f4f4f0", "#08080a", "#e8e4dc"], pied: ["#141416", "#f4f4f0", "#f4f4f0", "#08080a", "#2a2a2e"] },
  owl: { tawny: ["#8a5a34", "#5a3a20", "#c8a07a", "#1e140a", "#2a1a10"], ural: ["#b8b0a0", "#8a8070", "#e8e4dc", "#2a2620", "#2a2a2a"] },
  parrot: { galah: ["#d87a8a", "#a8a8b0", "#e86a80", "#2a2a2a", "#f4d0d8"] },
  gull: { silver: ["#f4f4f2", "#b8c0c8", "#ffffff", "#141414", "#e83030"] },
  peacock: { green: ["#2a8a5a", "#1a6a7a", "#3aa86a", "#0a1a14", "#e8c040"] },
  snake: { garter: ["#3a3a2a", "#e8d84a", "#c8c0a0", "#0e0e0a", "#e83030"], "red-bellied": ["#141414", "#2a2a2a", "#e83a3a", "#0a0a0a", "#e83030"] },
  butterfly: { peacock: ["#a82a2a", "#1a1a1a", "#3a6ad0", "#0a0a0a", "#f0d020"], birdwing: ["#1a1a1a", "#f0d020", "#2ab84a", "#0a0a0a", "#f0d020"] },
};

const GREY: CoatColors = ["#888888", "#666666", "#cccccc", "#222222", "#ffffff"];
const coatColors = (id: SpeciesId, coat: string): CoatColors =>
  speciesOf(id).coats.find(([name]) => name === coat)?.[1] ?? LOCAL_COATS[id]?.[coat] ?? speciesOf(id).coats[0]?.[1] ?? GREY;

/** The coats a species can wear here, weighted: its region's own forms, or its own coats (the first five times the rest). */
function looksFor(id: SpeciesId, region: RegionId | null): readonly Look[] {
  const local = region ? LOOKS[id]?.[region] : undefined;
  // (With no region, the kind's usual coat nearly always: a red fox, a grey wolf, not a pack of arctic ones.)
  return local && local.length > 0 ? local : speciesOf(id).coats.map(([name], i) => [name, i === 0 ? 12 : 1] as const);
}

/** A species' weight in this place and world. */
function localWeight(id: SpeciesId, ctx: CastContext): number {
  return speciesOf(id).weight * (ctx.region ? LOCAL_WEIGHT[ctx.region][id] ?? 1 : 1) * (WORLD_WEIGHT[ctx.world]?.[id] ?? 1);
}

/** One animal's own make and manner (see `Traits`); the young have big heads, short muzzles and legs, and play more. */
function traitsOf(rand: (() => number) | null, young: boolean, sex?: Traits["sex"]): Traits {
  // (With no stream, the kind's own make: a gallery's or a test's animal, a stag rather than a doe.)
  const jit = (spread: number): number => (rand ? 1 + (rand() * 2 - 1) * spread : 1);
  const drawn = !rand || rand() < 0.5 ? "male" : "female";
  const t = { len: jit(0.05), leg: jit(0.06), body: jit(0.07), head: jit(0.05), snout: jit(0.08), neck: jit(0.06), tail: jit(0.12), ears: jit(0.1), tempo: jit(0.1), bold: jit(0.28), lively: jit(0.22) };
  if (!young) return { sex: sex ?? drawn, ...t };
  return { ...t, sex: sex ?? drawn, len: t.len * 0.9, leg: t.leg * 0.88, head: t.head * 1.16, snout: t.snout * 0.72, neck: t.neck * 0.85, tail: t.tail * 0.8, ears: t.ears * 1.1, lively: t.lively * 1.35 };
}

/** The local name of a coat in a region, or the species' own. */
function lookLabel(id: SpeciesId, coat: string, region: RegionId | null): string {
  const look = region ? LOOKS[id]?.[region]?.find(([name]) => name === coat) : undefined;
  return look?.[2] ?? speciesOf(id).label;
}

function memberOf(rand: () => number, id: SpeciesId, coat: string, young: boolean, input: CastInput, skin: () => number = rand, traits: Traits = traitsOf(null, young)): CastMember {
  const spec = speciesOf(id);
  const colors = coatColors(id, coat);
  const morph = morphFor(skin, input);
  const heft = spec.size * between(rand, [0.88, 1.12]) * (young ? 0.55 : 1);
  const size = shownSize(id, heft / (young ? 0.55 : 1)) * (young ? 0.6 : 1);
  rand(); // (the old antler roll: kept so the coat rolls after it stay where they were)
  // Antlers on a grown stag, out of velvet: not on a doe or a fawn, nor in spring, when they are growing back.
  const horned = traits.sex === "male" && !young && contextOf(input).season !== "spring";
  return { species: id, label: lookLabel(id, coat, contextOf(input).region), size, heft, coat, palette: paletteOf(id, varied(colors, rand, young), morph), morph, young, horned, traits };
}

/** Who is which sex in a group: a pair is a male and a female, a parent with young most often the mother. */
function sexOf(kind: GroupKind, i: number, rand: () => number): Traits["sex"] | undefined {
  if (kind === "pair") return i === 0 ? "male" : "female";
  if (kind === "family" && i === 0) return rand() < 0.75 ? "female" : "male";
  return undefined;
}

function groupOf(rand: () => number, id: SpeciesId, kind: GroupKind, input: CastInput): CastGroup {
  const spec = speciesOf(id);
  const seed = numericSeed(input.seed);
  const coats = looksFor(id, contextOf(input).region);
  const coat = pick(rand, coats.map(([name, weight]) => [name, weight] as const));
  const count = kind === "solo" ? 1 : kind === "pair" ? 2 : kind === "family" ? 1 + intBetween(rand, 1, 2) : intBetween(rand, spec.pack[0], spec.pack[1]);
  const skin = streamOf(seed, `fauna.skin.${id}`);
  const members = Array.from({ length: count }, (_, i) => {
    const young = kind === "family" && i > 0;
    const own = streamOf(seed, `fauna.traits.${id}.${i}`);
    // (A mixed-up pack: now and then one wears another of the local coats.)
    const wears = rand() < 0.15 ? pick(rand, coats.map(([name, weight]) => [name, weight] as const)) : coat;
    return memberOf(rand, id, wears, young, input, skin, traitsOf(own, young, sexOf(kind, i, own)));
  });
  return { kind, members };
}

function pickSpecies(rand: () => number, input: CastInput, not: readonly SpeciesId[] = []): SpeciesId | null {
  const ctx = contextOf(input);
  const pool = SPECIES_IDS.filter((id) => fits(id, input) && !not.includes(id));
  if (pool.length === 0) return null;
  return pick(rand, pool.map((id) => [id, localWeight(id, ctx)] as const));
}

/** Options for `poseSpecies`: a morph, a young one, a seeded individual (its coat and proportions), a coat or region's coat, and its sex. */
export interface PoseOptions {
  readonly morph?: Morph | undefined;
  readonly young?: boolean | undefined;
  readonly seed?: number | undefined;
  readonly coat?: string | undefined;
  readonly region?: string | undefined;
  readonly sex?: Traits["sex"] | undefined;
}

/** Unseeded and nowhere, a species' own first coat; seeded or in a region, one of that region's coats, rolled. */
function poseCoat(id: SpeciesId, region: RegionId | null, seed: number | undefined): string {
  const looks = looksFor(id, region);
  if (seed === undefined && region === null) return looks[0]?.[0] ?? "";
  return pick(streamOf(seed ?? 1, "fauna.pose.coat"), looks.map(([name, weight]) => [name, weight] as const));
}

/** Actions a wary animal does more and a bold one less, the restful ones a lively animal does less, and the ones it does more. */
const WARY: ReadonlySet<Action> = new Set<Action>(["look", "rear"]);
const RESTFUL: ReadonlySet<Action> = new Set<Action>(["sit", "lie", "sleep", "bask"]);
const LIVELY: ReadonlySet<Action> = new Set<Action>([...MOVES, "play", "dig", "sniff", "display", "sing"]);

const OWN_SPECS = new WeakMap<CastMember, SpeciesSpec>();
/**
 * An animal's own copy of its species' spec: its kind's, with the build
 * shares, tempo and temperament of its traits (see `Traits`) worked in. The
 * pose code reads proportions and the director reads speed and temper from
 * it, so two foxes of a pack differ in leg and tail, in pace, and in how much
 * they watch, rest and roam. Its menu of actions stays its kind's.
 */
function specOf(member: CastMember): SpeciesSpec {
  const known = OWN_SPECS.get(member);
  if (known) return known;
  const kind = speciesOf(member.species);
  const t = member.traits;
  const b = kind.build;
  const build: Build = { ...b, len: b.len * t.len, leg: b.leg * t.leg, body: b.body * t.body, head: b.head * t.head, snout: b.snout * t.snout, neck: b.neck * t.neck, tailLen: b.tailLen * t.tail, earLen: b.earLen * t.ears };
  const temper: Partial<Record<Action, number>> = { ...kind.temper };
  for (const action of actionsOf(kind)) {
    const k = WARY.has(action) ? 1 / t.bold : RESTFUL.has(action) ? 1 / t.lively : LIVELY.has(action) ? t.lively : 1;
    if (Math.abs(k - 1) > 1e-9) temper[action] = (kind.temper[action] ?? 1) * k;
  }
  const spec: SpeciesSpec = { ...kind, speed: kind.speed * t.tempo, build, temper };
  OWN_SPECS.set(member, spec);
  return spec;
}

const GROUP_KINDS: readonly GroupKind[] = ["solo", "pair", "family", "pack"];

function kindFor(rand: () => number, id: SpeciesId, together: boolean): GroupKind {
  const odds = speciesOf(id).groups;
  return pick(rand, GROUP_KINDS.map((kind, i) => [kind, together && kind === "solo" ? 0 : odds[i] ?? 0] as const).filter(([, w]) => w > 0).concat(together ? [] : [["solo", 0.01]]));
}

/** Two species that are seen together: a deer and a songbird, a capybara and a monkey. */
function mixedGroup(rand: () => number, input: CastInput, forced: SpeciesId | null = null): CastGroup | null {
  // (A forced species hosts its own company; the host is rolled still, so the rolls after it stay put.)
  const rolled = pickSpecies(rand, input);
  const host = forced ?? rolled;
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
  if (tier === "mixed") { const g = mixedGroup(rand, input, isSpecies(input.species) ? input.species : null); return g ? [g] : groupsFor(rand, "solo", input); }
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
/** A name as it reads mid-sentence: lower case, but for the names of places and people in it. */
const PROPER = /^(American|Japanese|Steller's|Abert's|Bali|Java|Javan|Australian|Asian|African|Eastern|Kirk's)$/;
const spoken = (label: string): string => label.split(" ").map((word) => (PROPER.test(word) ? word : word.toLowerCase())).join(" ");
/** More than one: "deer" stays, "mouse" is "mice", a "fox" "foxes", a "butterfly" "butterflies". */
function pluralName(name: string): string {
  if (/(deer|fowl|sheep|fireflies)$/.test(name)) return name;
  if (name.endsWith("mouse")) return `${name.slice(0, -5)}mice`;
  if (name.endsWith("wolf")) return `${name.slice(0, -4)}wolves`;
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}
const plural = (member: CastMember): string => (member.label === speciesOf(member.species).label ? PLURALS[member.species] : undefined) ?? pluralName(spoken(member.label));

function labelOf(groups: readonly CastGroup[]): string {
  if (groups.length === 0) return "no animals";
  return groups.map((group) => {
    const first = group.members[0];
    if (!first) return "";
    const morph = MORPHS[first.morph].label;
    const name = `${morph ? `${morph} ` : ""}${spoken(first.label)}`;
    if (group.kind === "solo") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
    if (group.kind === "pair") return `a pair of ${plural(first)}`;
    if (group.kind === "family") return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name} with ${group.members.length - 1} young`;
    if (group.kind === "pack") return `${group.members.length} ${plural(first)}`;
    const kinds = new Map(group.members.map((m) => [m.species, m] as const));
    return [...kinds.values()].map((m) => plural(m)).join(" and ");
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

const weightOf = (who: Who): number => who.member.heft ** 3 * (who.spec.plan === "bird" || who.spec.plan === "bug" ? 0.3 : 1);

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
export function poseSpecies(id: SpeciesId, action: Action = "stand", t = 0, options: PoseOptions = {}): Body {
  const young = options.young ?? false;
  const region = ALL_REGIONS.find((each) => each === options.region) ?? null;
  const seed = options.seed;
  const coat = options.coat ?? poseCoat(id, region, seed);
  const traits = traitsOf(seed === undefined ? null : streamOf(seed, "fauna.pose.traits"), young, options.sex ?? "male");
  const member = memberOf(createRandom(seed ?? 1), id, coat, young, { morph: options.morph, region: region ?? undefined }, undefined, traits);
  const spec = specOf(member);
  const m = galleryMoment(spec, action, t);
  const who: Who = { member, spec };
  return bodyOf(id, who, m, poseWho(who, m));
}

const GALLERY_MODES: Partial<Record<Action, MoveMode>> = { fly: "fly", climb: "climb", wander: "walk", run: "walk", hop: "walk", stalk: "walk" };

function galleryMoment(spec: SpeciesSpec, action: Action, t: number): Moment {
  const ground: Place = { on: "ground", x: 0, z: 0 };
  const mode = GALLERY_MODES[action] ?? null;
  const pace = mode ? spec.speed * (PACE[action] ?? 1) : 0;
  const segment: Segment = { act: action, t0: 0, t1: Math.max(t, 0) + 4, from: ground, to: ground, yaw: 0, face: -1, mode, pace };
  // (A hanging animal hangs from a branch overhead, not from the ground.)
  // (It hangs at its drawn size, its legs dangling below its arms.)
  const phase = (t * pace) / Math.max(0.5, spec.build.len);
  const hop = action === "hop" && spec.plan === "bird" ? spec.size * 0.5 * Math.abs(Math.sin(Math.PI * phase)) : 0;
  const lift: Vec = action === "fly" ? [0, spec.size * 2, 0] : action === "hang" ? [0, Math.max(spec.size, TOY * Math.sqrt(spec.size)) * 2.4, 0] : [0, hop, 0];
  return { frame: frameOf(lift, [0, 0, 1]), phase, moving: mode ? 1 : 0, pace, mode, segment, pose: paramsOf(segment, t + FADE), t };
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

/** (A cruise with no start or end in sight: no launch, no landing, just its own flaps and glides.) */
const FLY_SEGMENT: Segment = { act: "fly", t0: -1e6, t1: 1e6, from: { on: "ground", x: 0, z: 0 }, to: { on: "ground", x: 0, z: 0 }, yaw: 0, face: -1, mode: "fly", pace: 4 };

function flyingBird(id: string, who: Who, p: Vec, dir: Vec, t: number, up: Vec = UP): Body {
  const m: Moment = { frame: frameOf(p, dir, up), phase: 0, moving: 1, pace: 4, mode: "fly", segment: FLY_SEGMENT, pose: { ...restPose(), wing: 1 }, t };
  return bodyOf(id, who, m, poseWho(who, m));
}

/**
 * A flock crossing the sky on a long seeded curve, banked into it, each bird
 * keeping its place in the loose bunch or the vee and its own wingbeat.
 */
function flockBodies(pass: Pass, who: Who, t: number): Body[] {
  const u = (t - pass.start) / (pass.end - pass.start);
  const line = sub(pass.to, pass.from);
  const span = Math.max(1e-3, length(line));
  const side = unit(cross(UP, line));
  const bow = ((pass.seed % 997) / 997 - 0.5) * 0.3 * span;
  const headingAt = (k: number): Vec => unit(madd(line, side, bow * Math.PI * Math.cos(Math.PI * k)));
  const dir = headingAt(u);
  const up = bankedUp(headingAt(u - 0.02), headingAt(u + 0.02), span * 0.04, span / Math.max(0.01, pass.end - pass.start));
  const middle = madd(lerpV(pass.from, pass.to, u), side, bow * Math.sin(Math.PI * clamp(u, 0, 1)));
  const across = unit(cross(UP, dir));
  const out: Body[] = [];
  for (let i = 0; i < pass.count; i += 1) {
    const rank = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
    const spread = pass.v ? [rank * 0.9, -Math.abs(rank) * 1.1] : [Math.sin(i * 2.4 + pass.seed) * 2.2, Math.cos(i * 1.7 + pass.seed) * 2.4];
    const bobbing = Math.sin(t * 1.3 + i * 1.1) * 0.25;
    const p = add(madd(madd(middle, across, spread[0] ?? 0), dir, spread[1] ?? 0), [0, bobbing + (pass.v ? 0 : Math.sin(i * 3.3) * 0.8), 0]);
    // (Down a vee each bird beats a little after the one ahead, a wave along the line.)
    out.push(flyingBird(`flock.${String(pass.seed)}.${String(i)}`, who, p, dir, t + (pass.v ? Math.abs(rank) * 0.22 : i * 0.37), up));
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

/** Whether an animal starts the scene up in the tree: the hangers, koalas and owls mostly do, other climbers and fliers now and then. */
function startsUp(member: CastMember, stage: Stage, rand: () => number): boolean {
  const kind = speciesOf(member.species);
  if (!(kind.climbs || kind.flies) || kind.plan === "bug" || GROUND_BIRDS.has(member.species) || (stage.perches?.length ?? 0) === 0) return false;
  return rand() < (kind.temper.hang !== undefined || member.species === "koala" || member.species === "owl" || member.species === "loris" ? 0.85 : 0.3);
}

function actorOf(member: CastMember, index: number, seed: number, centre: Place, stage: Stage, taken: readonly Spot[], pantry: Pantry): Actor {
  const rand = streamOf(seed, `fauna.actor.${index}.${member.species}`);
  const spec = specOf(member);
  const near = anchorOf(centre, stage, []).p;
  const place: Place = startsUp(member, stage, rand) ? { on: "perch", i: Math.floor(rand() * 9973) } : groundSpot(rand, stage, member.size, near, member.size * 3 + 0.3, taken);
  const actor: Actor = { index, member, spec, rand, day: matrixOf(spec, {}), night: matrixOf(spec, { night: true }), moods: new Map(), segments: [], until: 0, place, yaw: rand() * TAU, last: "stand", pos: anchorOf(place, stage, []).p, back: null, mates: [], pantry };
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
  // A climb or a flight runs out first (though a bird on a sortie cuts it short).
  if (!stopHere(actor, index, t, scene)) recall(actor, index, t, scene);
  actor.last = segment.act;
}

/** End a rest or a walk at `t`, where the animal is; false when it cannot stop there. */
function stopHere(actor: Actor, index: number, t: number, scene: Scene): boolean {
  const list = actor.segments;
  const segment = list[index];
  if (!segment) return true;
  if (segment.mode === null) {
    const end = Math.max(segment.t0 + 0.05, Math.min(segment.t1, t));
    list[index] = { ...segment, t1: end };
    actor.until = end;
    actor.place = segment.to;
    return true;
  }
  if (segment.mode !== "walk" || t >= segment.t1) return false;
  const here = movingFrame(actor, segment, t, scene).frame.o;
  const to: Place = { on: "ground", x: here[0], z: here[2] };
  const end = Math.max(segment.t0 + 0.05, t);
  list[index] = { ...segment, t1: end, to };
  actor.until = end;
  actor.place = to;
  return true;
}

/**
 * Where a climb or flight under way leaves an animal called away: at its
 * end, once it has run out. A bird out on a sortie is quicker: just off its
 * perch, it never goes; farther out, it cuts its loops short and comes the
 * short way round, from just where it is, to where it was going.
 */
function recall(actor: Actor, index: number, t: number, scene: Scene): void {
  const list = actor.segments;
  const segment = list[index];
  if (!segment) return;
  if (segment.loop?.kind !== "sortie" || t >= segment.t1 - 1.5) {
    actor.until = segment.t1;
    actor.place = segment.to;
    return;
  }
  if (t < segment.t0 + 0.4) {
    list[index] = { act: "look", t0: segment.t0, t1: segment.t0 + 0.05, from: segment.from, to: segment.from, yaw: segment.yaw, face: -1, mode: null, pace: 0 };
    actor.until = segment.t0 + 0.05;
    actor.place = segment.from;
    return;
  }
  const here = movingFrame(actor, segment, t, scene).frame;
  const loop: Loop = { ...segment.loop, laps: 0, start: here.o };
  const speed = pathLength(pathFor("fly", segment.from, segment.to, scene, actor.member.size, 1, segment.loop)) / Math.max(0.01, segment.t1 - segment.t0);
  const duration = Math.max(1.5, pathLength(pathFor("fly", segment.from, segment.to, scene, actor.member.size, 1, loop)) / Math.max(0.5, speed));
  list[index] = { ...segment, t1: t };
  list.push({ ...segment, t0: t, t1: t + duration, yaw: frameYaw(here), loop });
  actor.until = t + duration;
  actor.place = segment.to;
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
  // (By its true size: a toy-scaled crow still flies across the grove.)
  const size = actor.member.heft;
  if (actor.spec.flies && span > Math.max(size * 9, radius * 0.45)) return "fly";
  if (span < size * 2.5 || size > 0.45) return "wander";
  return actor.rand() < 0.7 ? "hop" : "wander";
}

/** Go where told, the animal's own way, then look about. */
function obey(actor: Actor, to: Order["to"], scene: Scene, spot: number): void {
  const size = actor.member.size;
  const { spec } = actor;
  if (to.on === "perch" && perchCount(scene) > 0 && (spec.flies || spec.climbs) && !GROUND_BIRDS.has(actor.member.species)) {
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

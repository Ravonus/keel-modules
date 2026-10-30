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

type Ears = "point" | "round" | "rimmed" | "cup" | "long" | "flop" | "tuft" | "fluffy" | "none";
type Tail = "bushy" | "curl" | "thin" | "puff" | "ring" | "banded" | "thick" | "fan" | "stub" | "none";
/**
 * Extra parts and markings. Markings are paint only (sdf-body decals): a pale
 * `bib` down the throat and chest, a white `rump`, a pale `muzzle`, a dark
 * `saddle` down the back, dark `socks` on the lower legs, pale `mitts` on the paws, a `mask` across the
 * eyes, pale `brows` over it; a `ruff` of fur round the neck, `jowls` on the cheeks, a `hump` over the shoulders; a `button` nose, `fingers` marked on the forepaws.
 */
type Extra = "bignose" | "antlers" | "mask" | "quills" | "shell" | "pouch" | "crest" | "stripes" | "longneck" | "train" | "crown" | "glowtail" | "claws" | "cheeks" | "spots"
  | "bib" | "rump" | "muzzle" | "saddle" | "socks" | "mitts" | "ruff" | "hump" | "brows" | "jowls" | "button" | "fingers" | "wet" | "toes";
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
  /** A pointed ear's breadth at its root, as a share of the usual (a cat's broad triangles). */
  readonly earBase?: number;
  /** The muzzle's tip, as a share of its root: small for a fox's point, near 1 for a capybara's block. */
  readonly snoutTip: number;
  /** A round head's eyes, if they sit other than the usual: a face point (along, out, up). */
  readonly eyeSet?: readonly [number, number, number];
  /** The tail's thickness, as a share of the usual, and how far it rises above (or hangs below) its kind's. */
  readonly tailGirth: number;
  readonly tailRise: number;
  /** The neck's thickness against the usual (a cat's slim). */
  readonly neckGirth: number;
  /** A foreleg's two upper bones, each as a share of its reach: over a half bends it at the elbow, a half stands it straight. */
  readonly foreBone: number;
  /** A tail's own line, a step for each segment: how much it climbs over its kind's, how far it swings aside, its share of the length (a cat's soft S, off to one side). */
  readonly tailLine?: readonly (readonly [rise: number, sway: number, share: number])[];
  /** Where its neck leaves the body, off its shoulders in body radii (up, forward): a tortoise's from under the shell's rim. */
  readonly neckRoot?: readonly [number, number];
  /** The neck's thickness at the head, in body radii. */
  readonly neckEnd?: number;
  /** A leg made to its own plan and not its foot's (see `LegMake`). */
  readonly legMake?: LegMake;
  /** Nose to the ground, how many body radii the shoulders sink, the elbows bending and the neck reaching out low (a cat's sniff, where a dog just drops its head). */
  readonly stoop?: number;
  /** How far out its legs stand, as a share of its body's radius (a hedgehog's in under its skirt). */
  readonly stance?: number;
  /** How far back it draws its head as it curls up, in body radii (a hedgehog's in under its mantle). */
  readonly curlIn?: number;
  /** How far up a blunt snout turns at its end, in head radii. */
  readonly snoutUp?: number;
  /** The furthest its head goes below level, in radians, however low its nose is held (a hedgehog's, all neck hidden under its mantle). */
  readonly dip?: number;
  /**
   * Four legs: the torso's outline from hip (0) to shoulder (1), in body
   * radii (its round ends run on past both). Without one, the torso is a
   * haunch and a chest joined by a waist. A bird's runs from its tail's
   * root (0) to its breast (1).
   */
  readonly torso?: readonly Station[];
  /** The skull's outline in head radii from its middle, back to the stop where the brow drops to the muzzle; without one, the head is round. */
  readonly skull?: readonly Station[];
  /** The muzzle's outline from the stop (0) to the nose (1), in head radii across. */
  readonly muzzle?: readonly Station[];
  /** A leg's radii, top and bottom of each bone, where a kind's differ from the usual. */
  readonly taper?: { readonly fore: readonly [number, number, number, number]; readonly hind: readonly [number, number, number, number] };
  /** A bird's bill: its depth at the root, in head radii (a finch's cone, a crow's heavy wedge). */
  readonly bill?: number;
}

/**
 * A soft stocky leg, two bones right down to its paw: a foreleg that stands
 * as one straight column, and a hind leg of a long rounded thigh tapering to
 * a low hock, hardly bent, with a short foot below. Each taper is a leg's
 * thickness down its bones (root, joint, joint, paw), as shares of the usual
 * leg, and `hindBones` are the hind leg's two bones as shares of its reach.
 */
interface LegMake {
  readonly fore: readonly [number, number, number, number];
  readonly hind: readonly [number, number, number, number];
  readonly hindBones: readonly [number, number];
}

/**
 * One station of an outline: how far along its line, how high the back (or
 * crown) stands above that line, how low the belly (or chin) hangs under it,
 * and its half width.
 */
type Station = readonly [k: number, top: number, bottom: number, half: number];

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
  foot: "paw", fore: 1, legR: 1, chest: 1.1, haunch: 1, sit: "dog", earLen: 1, snoutTip: 0.7, tailGirth: 1, tailRise: 0, neckGirth: 1, foreBone: 0.53,
};
/**
 * Outlines by family, so each animal is drawn from its kind's real shape: a
 * dog's deep chest and tucked waist, a cat's level back and round skull, a
 * deer's narrow barrel and long face, a rabbit's high round haunch. Each is
 * the torso along the spine and the skull and muzzle along the head (see
 * `Station`); an animal's own traits still stretch and scale it.
 */
type Outline = Pick<Build, "torso" | "skull" | "muzzle">;
/** A runner's leg: muscle high up, drawn in to a slim cannon below the knee or hock. */
const RUNNER_TAPER = { fore: [1.65, 0.92, 0.78, 0.42], hind: [2.2, 1.08, 0.9, 0.42] } as const;
const OUTLINE = {
  canid: {
    torso: [[0, 0.8, 0.68, 0.7], [0.38, 0.76, 0.5, 0.64], [0.75, 0.9, 1.02, 0.78], [1.05, 0.86, 0.95, 0.7]],
    skull: [[-0.6, 0.58, 0.55, 0.62], [-0.1, 0.8, 0.62, 0.8], [0.35, 0.6, 0.52, 0.58]],
    muzzle: [[0.5, 0.4, 0.4, 0.36], [1, 0.24, 0.26, 0.2]],
  },
  vulpine: {
    torso: [[0, 0.78, 0.66, 0.66], [0.38, 0.72, 0.5, 0.6], [0.75, 0.84, 0.95, 0.72], [1.05, 0.8, 0.88, 0.64]],
    skull: [[-0.6, 0.55, 0.52, 0.66], [-0.1, 0.78, 0.6, 0.86], [0.35, 0.55, 0.5, 0.56]],
    muzzle: [[0.5, 0.34, 0.36, 0.3], [1, 0.18, 0.2, 0.14]],
  },
  // (A cat is one smooth bean: a gentle arc of spine over a round barrel and a soft low belly.)
  felid: {
    torso: [[-0.02, 0.86, 0.74, 0.86], [0.5, 0.92, 0.84, 0.92], [1.04, 0.84, 0.82, 0.84]],
  },
  cervid: {
    torso: [[-0.05, 0.82, 0.72, 0.62], [0.35, 0.8, 0.86, 0.7], [0.75, 0.86, 0.96, 0.68], [1.05, 1, 0.78, 0.55]],
    skull: [[-0.6, 0.55, 0.5, 0.56], [-0.1, 0.74, 0.6, 0.72], [0.3, 0.6, 0.55, 0.55]],
    muzzle: [[0.5, 0.46, 0.46, 0.4], [1, 0.32, 0.34, 0.28]],
  },
  leporid: {
    torso: [[-0.1, 1.08, 0.98, 1], [0.35, 1.04, 0.95, 0.92], [0.8, 0.8, 0.86, 0.75], [1.05, 0.7, 0.8, 0.65]],
    skull: [[-0.6, 0.66, 0.6, 0.7], [0, 0.86, 0.75, 0.85], [0.4, 0.7, 0.6, 0.66]],
    muzzle: [[1, 0.46, 0.42, 0.46]],
  },
  rodent: {
    torso: [[-0.1, 0.95, 0.9, 0.9], [0.4, 0.98, 0.9, 0.9], [0.85, 0.8, 0.82, 0.74], [1.05, 0.7, 0.75, 0.64]],
    skull: [[-0.6, 0.62, 0.6, 0.68], [0, 0.82, 0.7, 0.82], [0.35, 0.62, 0.56, 0.6]],
    muzzle: [[0.6, 0.42, 0.42, 0.42], [1, 0.3, 0.3, 0.28]],
  },
  murid: {
    torso: [[-0.1, 0.98, 0.95, 0.95], [0.45, 1.02, 0.95, 0.95], [1.05, 0.78, 0.8, 0.72]],
    skull: [[-0.6, 0.66, 0.62, 0.72], [-0.05, 0.84, 0.7, 0.86], [0.3, 0.58, 0.52, 0.56]],
    muzzle: [[1, 0.2, 0.22, 0.18]],
  },
  cavy: {
    torso: [[-0.05, 0.95, 0.9, 0.85], [0.4, 0.95, 1, 0.92], [0.8, 0.9, 0.95, 0.85], [1.05, 0.85, 0.85, 0.74]],
    skull: [[-0.6, 0.7, 0.7, 0.64], [0, 0.8, 0.74, 0.72], [0.3, 0.78, 0.72, 0.66]],
    muzzle: [[1, 0.7, 0.6, 0.58]],
  },
  mustelid: {
    torso: [[-0.05, 0.88, 0.74, 0.84], [0.4, 0.98, 0.78, 0.9], [0.8, 0.88, 0.8, 0.82], [1.05, 0.78, 0.78, 0.7]],
    skull: [[-0.6, 0.6, 0.6, 0.72], [-0.05, 0.8, 0.65, 0.88], [0.35, 0.6, 0.55, 0.62]],
    muzzle: [[1, 0.28, 0.3, 0.24]],
  },
  // (A raccoon is pear-shaped: its back arches over deep wide loins and falls to low narrow shoulders. Its head is a round one: the face marks sit true on it.)
  procyonid: {
    torso: [[-0.12, 1, 1.04, 1.1], [0.4, 1.2, 1.08, 1.08], [1.05, 0.78, 0.84, 0.72]],
  },
  viverrid: {
    torso: [[-0.05, 0.78, 0.68, 0.7], [0.4, 0.82, 0.66, 0.72], [0.8, 0.8, 0.76, 0.7], [1.05, 0.72, 0.74, 0.62]],
    skull: [[-0.6, 0.58, 0.56, 0.66], [-0.05, 0.76, 0.62, 0.78], [0.35, 0.56, 0.52, 0.56]],
    muzzle: [[1, 0.26, 0.28, 0.22]],
  },
  koala: {
    torso: [[0, 1, 1, 0.95], [0.6, 1.02, 1, 0.95], [1.05, 0.9, 0.95, 0.85]],
    skull: [[-0.5, 0.78, 0.74, 0.95], [0, 0.95, 0.8, 1.05], [0.35, 0.8, 0.7, 0.85]],
    muzzle: [[1, 0.62, 0.5, 0.56]],
  },
  macropod: {
    torso: [[-0.1, 1.1, 1, 0.9], [0.4, 0.95, 0.95, 0.8], [0.85, 0.72, 0.76, 0.6], [1.05, 0.62, 0.66, 0.55]],
    skull: [[-0.6, 0.56, 0.52, 0.58], [-0.1, 0.74, 0.6, 0.72], [0.3, 0.6, 0.55, 0.55]],
    muzzle: [[0.5, 0.46, 0.46, 0.4], [1, 0.34, 0.34, 0.3]],
  },
  // Birds: the body from the tail's root to the breast (the back on top, the deep keel under), and
  // the skull back to front, its forehead sloping down into the bill.
  passerine: {
    torso: [[-0.2, 0.42, 0.36, 0.42], [0.25, 0.8, 0.86, 0.8], [0.7, 0.92, 1.12, 0.92], [1.1, 0.7, 0.74, 0.68]],
    skull: [[-0.7, 0.6, 0.55, 0.62], [-0.1, 0.9, 0.74, 0.82], [0.45, 0.66, 0.54, 0.58], [0.75, 0.42, 0.34, 0.36]],
  },
  corvid: {
    torso: [[-0.3, 0.38, 0.3, 0.38], [0.2, 0.8, 0.84, 0.76], [0.7, 0.92, 1.08, 0.86], [1.12, 0.66, 0.68, 0.6]],
    skull: [[-0.8, 0.52, 0.52, 0.58], [-0.15, 0.8, 0.72, 0.76], [0.45, 0.66, 0.56, 0.58], [0.85, 0.48, 0.4, 0.4]],
  },
  larid: {
    torso: [[-0.35, 0.34, 0.28, 0.36], [0.2, 0.76, 0.8, 0.72], [0.68, 0.86, 1.12, 0.86], [1.12, 0.6, 0.66, 0.58]],
    skull: [[-0.8, 0.5, 0.52, 0.56], [-0.15, 0.76, 0.7, 0.72], [0.45, 0.6, 0.54, 0.54], [0.85, 0.4, 0.36, 0.34]],
  },
  // (An owl stands upright: broadest across its chest, under the head, and narrowing down to its base so
  // its feathered legs show beneath, its breast falling back under the face so the face disc shows whole.)
  strigid: {
    torso: [[-0.3, 0.56, 0.54, 0.58], [0.25, 0.92, 0.98, 0.98], [0.8, 0.98, 0.96, 1.04], [1.15, 0.8, 0.74, 0.96]],
  },
  psittacid: {
    torso: [[-0.25, 0.42, 0.36, 0.42], [0.3, 0.84, 0.9, 0.8], [0.75, 0.9, 1.08, 0.88], [1.1, 0.7, 0.72, 0.68]],
    skull: [[-0.7, 0.68, 0.62, 0.7], [-0.05, 0.95, 0.8, 0.86], [0.45, 0.8, 0.62, 0.7], [0.7, 0.62, 0.46, 0.5]],
  },
  galliform: {
    torso: [[-0.2, 0.62, 0.4, 0.5], [0.3, 1.05, 0.85, 0.88], [0.75, 1, 1, 0.9], [1.1, 0.7, 0.75, 0.65]],
    skull: [[-0.6, 0.62, 0.58, 0.62], [0, 0.82, 0.72, 0.75], [0.55, 0.58, 0.5, 0.5]],
  },
  gruid: {
    torso: [[-0.3, 0.5, 0.38, 0.5], [0.3, 0.9, 0.85, 0.8], [0.75, 0.88, 0.98, 0.8], [1.1, 0.6, 0.62, 0.55]],
    skull: [[-0.7, 0.55, 0.5, 0.55], [0, 0.72, 0.62, 0.62], [0.6, 0.48, 0.42, 0.42]],
  },
} as const satisfies Readonly<Record<string, Outline>>;

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
    build: { ...OUTLINE.leporid, len: 0.85, leg: 0.36, body: 0.4, neck: 0.1, rise: 0.9, head: 0.27, snout: 0.08, ears: "long", tail: "puff", tailLen: 0.25, hip: 1.18, fore: 0.78, haunch: 1.3, chest: 0.95, sit: "loaf", snoutTip: 0.8, legR: 1.1 },
    coats: [["wild", ["#9a7e5e", "#7c6248", "#efe6d6", "#3a2c22", "#e8a8a8"]], ["snowshoe", ["#f2efe8", "#d8d2c8", "#ffffff", "#5a4a40", "#f0b0b8"]], ["dutch", ["#3a3230", "#f4f0ea", "#f4f0ea", "#1e1a18", "#e8a8a8"]]],
    temper: { graze: 2.2, groom: 1.6, rear: 1.4, hop: 1.8, sit: 1.3, wander: 0.4, sniff: 1.4 }, friends: ["songbird", "deer"] }),
  fox: define({ label: "Fox", plan: "quad", size: 0.36, rarity: "uncommon", weight: 34, regions: TEMPERATE, speed: 1.6, groups: [7, 2, 2, 0],
    build: { ...OUTLINE.vulpine, taper: RUNNER_TAPER, len: 1.35, leg: 0.62, body: 0.25, neck: 0.3, rise: 0.75, head: 0.18, snout: 0.26, ears: "point", tail: "bushy", tailLen: 1.1, extras: ["socks", "bib", "muzzle"], earLen: 1.1, snoutTip: 0.32, chest: 1.15, haunch: 0.95, tailGirth: 1.15, legR: 0.85 },
    coats: [["red", ["#d2662a", "#a8481c", "#f4efe6", "#2a1a14", "#f4efe6"]], ["silver", ["#5a5a62", "#2e2e34", "#e8e8ec", "#16161a", "#f0f0f4"]], ["arctic", ["#f4f4f0", "#dcdcd6", "#ffffff", "#2a2a2a", "#ffffff"]]],
    temper: { sniff: 2.2, dig: 1.6, play: 1.4, stretch: 1.3, sit: 1, sleep: 1, look: 1.4, wander: 1.4, stalk: 1.2, graze: 0 }, friends: ["crow"] }),
  deer: define({ label: "Deer", plan: "quad", size: 0.95, rarity: "uncommon", weight: 26, regions: TEMPERATE, speed: 1.1, groups: [4, 3, 4, 2], pack: [3, 4],
    build: { ...OUTLINE.cervid, len: 1.1, leg: 0.72, body: 0.22, neck: 0.55, rise: 1.05, head: 0.12, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.18, extras: ["antlers", "spots", "rump"], foot: "hoof", sit: "lie", legR: 0.55, chest: 1.2, earLen: 1.5, snoutTip: 0.5 },
    coats: [["whitetail", ["#a87a4e", "#8a6038", "#f4ece0", "#2a1e16", "#f8f4ec"]], ["sika", ["#9a5e34", "#7a4422", "#f0e4d0", "#241810", "#f6efe2"]], ["fallow", ["#c8925a", "#9e6c3e", "#f6ecd8", "#2e2014", "#ffffff"]]],
    temper: { graze: 2.8, look: 1.8, groom: 1, wander: 0.8, lie: 1.6, run: 0.3, dig: 0, roll: 0, sit: 0 }, friends: ["rabbit", "songbird", "crow"] }),
  wolf: define({ label: "Wolf", plan: "quad", size: 0.72, rarity: "rare", weight: 10, regions: ["rockies", "alps"], speed: 1.3, groups: [3, 2, 1, 5], pack: [3, 5],
    build: { ...OUTLINE.canid, taper: RUNNER_TAPER, len: 1.35, leg: 0.7, body: 0.25, neck: 0.3, rise: 0.55, head: 0.17, snout: 0.24, ears: "point", tail: "bushy", tailLen: 0.75, extras: ["ruff", "bib", "saddle", "muzzle"], earLen: 1.15, snoutTip: 0.45, chest: 1.25, haunch: 0.9, tailRise: -0.5, tailGirth: 0.9, legR: 0.95 },
    coats: [["grey", ["#7c7a74", "#4e4c48", "#e0dcd4", "#1e1c1a", "#d6d0c4"]], ["timber", ["#8a6a4a", "#4a3828", "#dcccb4", "#1c1610", "#cdb898"]], ["white", ["#e8e6e0", "#c8c4bc", "#ffffff", "#2a2826", "#ffffff"]], ["black", ["#2c2a2a", "#1a1818", "#4a4644", "#0c0a0a", "#5a5654"]]],
    temper: { howl: 2.4, sniff: 1.6, lie: 1.6, play: 1.4, look: 1.5, wander: 1.4, run: 0.6, graze: 0 }, friends: ["crow"] }),
  bear: define({ label: "Bear", plan: "quad", size: 0.9, rarity: "rare", weight: 8, regions: ["rockies", "alps", "tokyo"], speed: 0.8, winter: false, groups: [6, 0, 3, 0],
    build: { len: 1.3, leg: 0.58, body: 0.36, neck: 0.42, rise: -0.05, head: 0.25, snout: 0.15, ears: "round", tail: "none", tailLen: 0.1, hip: 0.92, extras: ["hump", "muzzle"], foot: "plant", sit: "rump", legR: 1.5, chest: 1.15, earLen: 1.5, snoutTip: 0.8,
      // A round rump, a deep belly, the back rising to the hump over the shoulders; a broad skull dished down to a short, blunt muzzle.
      torso: [[-0.05, 0.8, 0.62, 0.78], [0.3, 0.78, 0.72, 0.85], [0.68, 0.92, 0.72, 0.88], [0.95, 1.05, 0.68, 0.82], [1.1, 0.75, 0.7, 0.7]],
      skull: [[-0.55, 0.6, 0.6, 0.68], [-0.08, 0.85, 0.72, 0.95], [0.35, 0.62, 0.62, 0.7]],
      muzzle: [[0.5, 0.44, 0.5, 0.46], [1, 0.34, 0.38, 0.34]] },
    coats: [["brown", ["#6a4a30", "#4a3220", "#8a6a4a", "#1a120c", "#a88a68"]], ["black", ["#262220", "#141210", "#3a3430", "#0a0808", "#b89a72"]], ["cinnamon", ["#9a6236", "#764824", "#b8865a", "#22140a", "#c8a07a"]]],
    temper: { rear: 1.6, scratch: 2, sit: 1.8, sniff: 1.4, dig: 1.3, lie: 1.4, roll: 0.8, graze: 0 }, friends: ["songbird"] }),
  raccoon: define({ label: "Raccoon", plan: "quad", size: 0.3, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 1.1, active: "night", climbs: true, groups: [5, 2, 3, 0],
    build: { ...OUTLINE.procyonid, len: 0.9, leg: 0.36, fore: 0.94, body: 0.35, neck: 0.16, rise: 0.15, head: 0.285, snout: 0.17, ears: "rimmed", tail: "banded", tailLen: 1, tailGirth: 0.87, hip: 1.32, extras: ["mask", "brows", "muzzle", "socks", "jowls", "button", "fingers"], foot: "plant", sit: "haunch", haunch: 1.1, chest: 0.95, snoutTip: 0.5, eyeSet: [0.46, 0.66, 0.3], earLen: 1.1, legR: 0.72, legMake: { fore: [1.9, 1.25, 1.05, 0.72], hind: [2.6, 1.3, 1.15, 0.95], hindBones: [0.66, 0.4] } },
    coats: [["raccoon", ["#80858c", "#4e5258", "#c8c8c6", "#181310", "#f4f2ec"]], ["tanuki", ["#8a6c4a", "#4a3828", "#b89a78", "#18110b", "#e6e0d4"]]],
    temper: { dig: 1.8, sniff: 1.8, rear: 1.4, eat: 1.6, climb: 1.2, groom: 1.2, graze: 0 }, friends: ["cat"] }),
  cat: define({ label: "Cat", plan: "quad", size: 0.24, rarity: "uncommon", weight: 22, regions: ALL_REGIONS, worlds: ["city", "synth", "vapor", "nature"], speed: 1, active: "any", climbs: true, groups: [8, 2, 2, 0],
    build: { ...OUTLINE.felid, len: 0.7, leg: 0.4, body: 0.3, neck: 0.19, neckGirth: 0.78, foreBone: 0.503, rise: 0.85, head: 0.25, hip: 1.03, snout: 0.14, ears: "point", tail: "thin", tailLen: 0.95, tailGirth: 1.95, tailLine: [[0.42, 1, 0.3], [0.68, 0.85, 0.3], [0.78, 0.45, 0.26], [0.12, 0.1, 0.14]], extras: ["bib", "mitts"], chest: 1, haunch: 1, snoutTip: 0.8, legR: 0.64, legMake: { fore: [1.95, 1.5, 1.45, 0.92], hind: [2.8, 1.15, 1.12, 0.92], hindBones: [0.74, 0.31] }, stoop: 0.5 },
    coats: [["tabby", ["#e4b48c", "#d09058", "#fff2e0", "#704424", "#e8a098"]], ["black", ["#191716", "#100f0e", "#191716", "#080706", "#54403f"]], ["calico", ["#f6f0e6", "#d8782a", "#ffffff", "#1e1a18", "#eea2a2"]], ["grey", ["#9a9ca4", "#5e6068", "#e4e4e8", "#262830", "#eea8b4"]]],
    temper: { groom: 2.4, sit: 2, sleep: 1.8, stretch: 1.6, look: 1.4, play: 1.1, yawn: 1.4, climb: 0.8, stalk: 1, graze: 0 }, friends: ["raccoon", "crow", "songbird"] }),
  hedgehog: define({ label: "Hedgehog", plan: "quad", size: 0.11, rarity: "uncommon", weight: 14, regions: ["alps"], speed: 0.9, active: "night", winter: false,
    build: { len: 0.6, leg: 0.13, body: 0.33, neck: 0.05, neckGirth: 0.7, rise: -1.15, head: 0.18, snout: 0.185, stance: 0.5, snoutUp: 0.08, dip: 0.5, curlIn: 1.3, ears: "cup", tail: "stub", tailLen: 0.1, hip: 1, extras: ["quills", "wet", "toes"], foot: "paw", sit: "lie", earLen: 0.95, snoutTip: 0.62, legR: 0.42, chest: 0.5, haunch: 0.6, eyeSet: [0.68, 0.45, 0.24], legMake: { fore: [1.5, 1.15, 1.05, 0.85], hind: [1.7, 1.15, 1.05, 0.85], hindBones: [0.6, 0.5] } },
    coats: [["brown", ["#c0a88e", "#5e3a26", "#dcc8a8", "#1c1410", "#5e4432"]], ["blond", ["#dccdb8", "#c4b698", "#f2e6c8", "#907068", "#c8ae98"]]],
    temper: { sniff: 2.6, dig: 1.6, coil: 1.2, wander: 1.4, sleep: 1, run: 0, graze: 0 }, friends: [] }),
  mouse: define({ label: "Field mouse", plan: "quad", size: 0.07, rarity: "common", weight: 30, regions: ALL_REGIONS, speed: 2.4, active: "night", groups: [5, 2, 2, 2], pack: [3, 4],
    build: { ...OUTLINE.murid, len: 1.02, leg: 0.3, body: 0.35, neck: 0.15, rise: 0.35, head: 0.25, snout: 0.24, ears: "round", tail: "thin", tailLen: 1.5, hip: 1.05, haunch: 1.2, chest: 0.85, sit: "haunch", earLen: 1.7, snoutTip: 0.28, tailRise: -0.7, legR: 0.8 },
    coats: [["field", ["#9a7a58", "#6a5038", "#efe2cc", "#1a120c", "#f0a8a8"]], ["grey", ["#7c7a78", "#55524f", "#d8d4cc", "#141210", "#f0a8a8"]]],
    temper: { sniff: 2.4, eat: 2, groom: 1.6, rear: 1.4, run: 1.4, wander: 1.2, graze: 0 }, friends: [] }),
  capybara: define({ label: "Capybara", plan: "quad", size: 0.5, rarity: "rare", weight: 9, regions: ["tokyo"], worlds: ["nature", "beach", "voxel"], speed: 0.6, groups: [3, 3, 3, 2], pack: [3, 4],
    build: { ...OUTLINE.cavy, len: 1.45, leg: 0.36, body: 0.38, neck: 0.2, rise: 0.35, head: 0.28, snout: 0.3, ears: "round", tail: "none", tailLen: 0.05, earLen: 0.55, snoutTip: 0.85, haunch: 1.1, legR: 1.2 },
    coats: [["capybara", ["#9a6c42", "#764e2c", "#a87c52", "#20140c", "#b88c62"]]],
    temper: { lie: 2.6, graze: 2, sit: 1.6, sleep: 1.6, look: 0.6, wander: 0.5, run: 0, roll: 0 }, friends: ["songbird", "parrot", "monkey"] }),
  kangaroo: define({ label: "Kangaroo", plan: "quad", size: 0.9, rarity: "rare", weight: 14, regions: ["sydney"], speed: 1.8, groups: [3, 2, 4, 2], pack: [3, 4],
    build: { ...OUTLINE.macropod, len: 0.95, leg: 0.75, body: 0.25, neck: 0.22, rise: 1.2, head: 0.13, snout: 0.18, ears: "long", tail: "thick", tailLen: 1.15, hip: 0.8, extras: ["pouch"], fore: 0.45, foot: "plant", sit: "haunch", haunch: 1.4, chest: 0.9, earLen: 0.55, snoutTip: 0.55, tailGirth: 1.1 },
    coats: [["red", ["#b06a3e", "#8a4e2a", "#e4cdb0", "#2a1a10", "#d8b898"]], ["grey", ["#8a8278", "#5e564e", "#d8d0c4", "#1e1a16", "#c8bcae"]]],
    temper: { graze: 1.8, rear: 2.6, groom: 1.2, hop: 2, look: 1.4, lie: 1, dig: 0, roll: 0 }, friends: [] }),
  tortoise: define({ label: "Tortoise", plan: "quad", size: 0.16, rarity: "rare", weight: 10, regions: ["nairobi"], worlds: ["nature", "beach", "voxel"], speed: 0.25, winter: false,
    build: { len: 0.8, leg: 0.27, body: 0.5, neck: 0.44, neckGirth: 0.28, neckEnd: 0.14, neckRoot: [-0.1, 0.56], rise: 0.5, head: 0.112, snout: 0.05, ears: "none", tail: "none", tailLen: 0.1, extras: ["shell"], foot: "plant", sit: "tuck", legR: 0.74, snoutTip: 0.9, chest: 0.5, haunch: 0.5, stance: 0.86, stoop: 0.16, foreBone: 0.48, legMake: { fore: [1, 0.92, 0.92, 0.72], hind: [1.02, 0.96, 0.96, 0.76], hindBones: [0.445, 0.445] } },
    coats: [["leopard", ["#b09f7e", "#d8c8a0", "#ece2c8", "#2a2212", "#3a3020"]], ["star", ["#b0a068", "#d8bc70", "#e4d6a0", "#141008", "#d8c47c"]]],
    temper: { graze: 2.4, bask: 2.6, sleep: 1.2, look: 0.6, wander: 0.8, run: 0, roll: 0, shake: 0, rear: 0, scratch: 0, groom: 0, stretch: 0, sit: 0 }, friends: ["songbird", "crab", "guineafowl"] }),
  meerkat: define({ label: "Meerkat", plan: "quad", size: 0.22, rarity: "rare", weight: 12, regions: [], speed: 1.8, groups: [1, 2, 3, 6], pack: [3, 6],
    build: { ...OUTLINE.viverrid, len: 1.05, leg: 0.36, body: 0.24, neck: 0.22, rise: 0.8, head: 0.19, snout: 0.2, ears: "round", tail: "thin", tailLen: 0.85, hip: 1, extras: ["mask"], sit: "haunch", earLen: 0.6, snoutTip: 0.4, tailRise: -0.2 },
    coats: [["meerkat", ["#b8966c", "#8a6c48", "#d8c4a4", "#1a120a", "#e8d8bc"]]],
    temper: { rear: 3.2, look: 2.4, dig: 2, groom: 1.4, bask: 1.2, run: 1, graze: 0 }, friends: [] }),
  squirrel: define({ label: "Squirrel", plan: "quad", size: 0.12, rarity: "common", weight: 60, regions: TEMPERATE, worlds: ["nature", "voxel", "crystal", "city"], speed: 2.2, climbs: true, groups: [6, 3, 1, 1], pack: [3, 3],
    build: { ...OUTLINE.rodent, len: 1, leg: 0.4, body: 0.32, neck: 0.08, rise: 0.8, head: 0.26, snout: 0.12, ears: "tuft", tail: "curl", tailLen: 1.25, hip: 1.18, fore: 0.85, haunch: 1.25, chest: 0.95, sit: "haunch", tailGirth: 1.3 },
    coats: [["red", ["#b8582a", "#8a3e1a", "#f0e4d4", "#24140a", "#f4ece0"]], ["grey", ["#86827c", "#5e5a54", "#e8e4dc", "#1c1a18", "#efe8de"]], ["black", ["#2a2624", "#181614", "#4a4440", "#0a0808", "#4a4440"]]],
    temper: { eat: 2.6, climb: 2.6, rear: 1.6, dig: 1.4, look: 1.4, run: 1.4, play: 1.4, graze: 0 }, friends: ["songbird", "woodpecker"] }),
  redpanda: define({ label: "Red panda", plan: "quad", size: 0.28, rarity: "epic", weight: 5, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [6, 2, 2, 0],
    build: { ...OUTLINE.mustelid, len: 1.12, leg: 0.45, body: 0.3, neck: 0.16, rise: 0.6, head: 0.26, snout: 0.12, ears: "point", tail: "ring", tailLen: 1.1, hip: 1.08, extras: ["cheeks", "muzzle", "socks"], foot: "plant", earLen: 0.85, snoutTip: 0.55, tailGirth: 1.2 },
    coats: [["red panda", ["#b84a1e", "#5a2210", "#1e1210", "#140a06", "#f4ece0"]]],
    temper: { climb: 2.4, eat: 2, sleep: 1.8, groom: 1.4, stretch: 1.2, rear: 1.2, roll: 0, graze: 0 }, friends: [] }),
  koala: define({ label: "Koala", plan: "quad", size: 0.3, rarity: "epic", weight: 7, regions: ["sydney"], speed: 0.4, climbs: true, groups: [7, 1, 3, 0],
    build: { ...OUTLINE.koala, len: 0.75, leg: 0.45, body: 0.4, neck: 0.08, rise: 1, head: 0.33, snout: 0.06, ears: "fluffy", tail: "none", tailLen: 0.05, hip: 1, extras: ["bignose"], foot: "plant", sit: "rump", earLen: 1.8, snoutTip: 0.9, legR: 1.2 },
    coats: [["koala", ["#8a8a8e", "#5e5e62", "#e8e6e2", "#1a1a1c", "#2a2a2c"]]],
    temper: { sleep: 3.4, eat: 2.2, climb: 1.4, look: 0.6, wander: 0.2, scratch: 1.2, run: 0, roll: 0 }, friends: [] }),
  macaque: define({ label: "Snow monkey", plan: "primate", size: 0.5, rarity: "rare", weight: 12, regions: ["tokyo"], speed: 0.9, climbs: true, groups: [3, 3, 4, 3], pack: [3, 5],
    build: { len: 0.42, leg: 0.56, body: 0.2, neck: 0.06, head: 0.168, snout: 0.03, ears: "none", tail: "puff", tailLen: 0.13 },
    coats: [["snow", ["#96a2ae", "#4a4a56", "#e2e6e6", "#2a2018", "#a8565a"]]],
    temper: { groom: 3, sit: 2, eat: 1.6, look: 1.4, climb: 1.4, sleep: 1.2, hang: 0.4 }, friends: ["crow", "deer"] }),
  monkey: define({ label: "Long-tailed macaque", plan: "primate", size: 0.44, rarity: "uncommon", weight: 18, regions: ["bali", "nairobi"], worlds: ["nature", "beach", "voxel"], speed: 1.2, climbs: true, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { len: 0.58, leg: 0.64, body: 0.118, neck: 0.1, head: 0.122, snout: 0.05, ears: "round", tail: "thin", tailLen: 1.5 },
    coats: [["macaque", ["#8a7a5e", "#5e5038", "#c8b898", "#241c12", "#d8a088"]], ["vervet", ["#8a8c78", "#5a5c4a", "#e8e6dc", "#141410", "#2a2a2a"]]],
    temper: { climb: 2.4, hang: 1.6, groom: 2.2, eat: 1.8, play: 1.6, look: 1.2, scratch: 1.4 }, friends: ["parrot", "peacock", "guineafowl"] }),
  sloth: define({ label: "Sloth", plan: "primate", size: 0.45, rarity: "epic", weight: 4, regions: [], worlds: ["nature", "beach", "voxel"], speed: 0.12, climbs: true, groups: [9, 0, 2, 0],
    build: { len: 0.42, leg: 0.38, body: 0.155, neck: 0.1, head: 0.14, snout: 0.03, ears: "none", tail: "none", tailLen: 0.05, extras: ["mask", "claws"] },
    coats: [["sloth", ["#747a74", "#4a4438", "#5c6c48", "#241c14", "#dcd6c4"]]],
    temper: { hang: 4, sleep: 3, eat: 1.2, look: 0.8, climb: 0.6 }, friends: [] }),
  songbird: define({ label: "Songbird", plan: "bird", size: 0.13, rarity: "common", weight: 80, regions: ALL_REGIONS, worlds: ["nature", "voxel", "crystal", "city", "beach"], speed: 1.4, groups: [5, 4, 2, 2], pack: [3, 5],
    build: { ...OUTLINE.passerine, bill: 0.36, len: 1, leg: 0.22, body: 0.27, neck: 0.1, rise: 0.4, head: 0.17, snout: 0.14, ears: "none", tail: "fan", tailLen: 0.38 },
    coats: [["robin", ["#6a5a4a", "#4a3e32", "#e2702e", "#141010", "#e8c048"]], ["bluebird", ["#3a6ad0", "#2a4a9a", "#e8945a", "#0e1220", "#2a2a2a"]], ["goldfinch", ["#f0d020", "#2a2a2a", "#f8e870", "#121212", "#e8a060"]], ["sparrow", ["#9a7a5a", "#5e4a36", "#d8ccb8", "#1a1410", "#3a3028"]]],
    temper: { sing: 2.6, peck: 2.2, hop: 2, preen: 1.6, look: 1.4, fly: 2.2 }, friends: ["deer", "rabbit", "bear", "capybara", "tortoise", "squirrel"] }),
  crow: define({ label: "Crow", plan: "bird", size: 0.24, rarity: "common", weight: 34, regions: ALL_REGIONS, worlds: ["nature", "voxel", "city", "synth", "crystal"], speed: 1.2, active: "day", groups: [5, 3, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.corvid, bill: 0.5, len: 1.15, leg: 0.24, body: 0.2, neck: 0.12, rise: 0.3, head: 0.15, snout: 0.2, ears: "none", tail: "fan", tailLen: 0.5 },
    coats: [["crow", ["#23262e", "#2c3346", "#2e3038", "#08080a", "#4a5068"]], ["hooded", ["#8a8a8e", "#1a1a1e", "#9a9a9e", "#0a0a0c", "#2a2a2e"]]],
    temper: { peck: 2.4, look: 2, hop: 1.6, flap: 1.2, sing: 0.8, fly: 2 }, friends: ["deer", "cat", "wolf"] }),
  owl: define({ label: "Owl", plan: "bird", size: 0.3, rarity: "rare", weight: 10, regions: ["rockies", "atlantic", "alps", "tokyo", "nairobi"], worlds: ["nature", "voxel", "crystal", "city"], speed: 0.8, active: "night", groups: [8, 2, 2, 0],
    build: { ...OUTLINE.strigid, bill: 0.3, len: 0.9, leg: 0.26, body: 0.37, neck: 0.04, rise: 1.2, head: 0.25, snout: 0.06, ears: "tuft", tail: "fan", tailLen: 0.3 },
    coats: [["barn", ["#cab084", "#98938c", "#ffffff", "#4a2e18", "#b4804e"]], ["great horned", ["#8a6a4a", "#5a4430", "#b4703c", "#1e140c", "#fbf8f2"]], ["snowy", ["#e8edf6", "#c8d2e2", "#ebf0f9", "#2a2a2e", "#ffffff"]]],
    temper: { look: 3, preen: 1.6, sleep: 2, flap: 0.8, fly: 1.3, peck: 0, hop: 0, sing: 0 }, friends: ["crow"] }),
  parrot: define({ label: "Parrot", plan: "bird", size: 0.28, rarity: "rare", weight: 14, regions: ["bali", "sydney"], worlds: ["nature", "beach", "voxel", "vapor"], speed: 1, groups: [4, 4, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.psittacid, bill: 0.6, len: 1.2, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.9, head: 0.16, snout: 0.1, ears: "none", tail: "fan", tailLen: 0.9, extras: ["crest"] },
    coats: [["macaw", ["#e2282e", "#2a5ad8", "#f0d020", "#141414", "#3ab84a"]], ["cockatoo", ["#f8f8f4", "#e8e4d8", "#ffffff", "#2a2a2a", "#f8d830"]], ["lorikeet", ["#2ab84a", "#3a4ad8", "#f06a20", "#141414", "#e83030"]]],
    temper: { preen: 2.4, sing: 2, eat: 1.6, flap: 1.6, look: 1.2, hang: 0.8, fly: 1.6 }, friends: ["monkey", "kangaroo", "koala"] }),
  gull: define({ label: "Gull", plan: "bird", size: 0.32, rarity: "common", weight: 36, regions: ["atlantic", "sydney", "bali", "tokyo"], worlds: ["beach", "city", "nature"], speed: 1.2, groups: [4, 3, 1, 3], pack: [3, 5],
    build: { ...OUTLINE.larid, bill: 0.36, len: 1.2, leg: 0.24, body: 0.19, neck: 0.12, rise: 0.4, head: 0.14, snout: 0.18, ears: "none", tail: "fan", tailLen: 0.36 },
    coats: [["herring", ["#f4f4f2", "#9aa4ae", "#ffffff", "#141414", "#f0c030"]], ["black-backed", ["#f4f4f2", "#2a2e34", "#ffffff", "#141414", "#f0c030"]]],
    temper: { look: 2, peck: 1.8, flap: 1.6, sing: 1.4, preen: 1.2, fly: 2.6 }, friends: ["crab"] }),
  peacock: define({ label: "Peacock", plan: "bird", size: 0.55, rarity: "epic", weight: 5, regions: ["bali"], speed: 0.7, groups: [5, 4, 2, 0],
    build: { ...OUTLINE.galliform, bill: 0.32, len: 1, leg: 0.3, body: 0.18, neck: 0.32, neckGirth: 0.5, rise: 1.1, head: 0.08, snout: 0.11, ears: "none", tail: "fan", tailLen: 1.7, extras: ["crown", "train"] },
    coats: [["indian", ["#1a5ad8", "#2a8a5a", "#1a4ab8", "#0a1020", "#e8c040"]], ["white", ["#f8f8f4", "#e8e8e2", "#ffffff", "#2a2a2a", "#f0f0ea"]]],
    temper: { display: 3, peck: 1.8, look: 1.4, preen: 1.2, wander: 1, fly: 0.3, sing: 0 }, friends: [] }),
  crane: define({ label: "Crane", plan: "bird", size: 0.85, rarity: "epic", weight: 6, regions: ["tokyo", "nairobi"], speed: 0.8, groups: [3, 6, 2, 0],
    build: { ...OUTLINE.gruid, bill: 0.3, len: 0.85, leg: 0.55, body: 0.16, neck: 0.55, rise: 1.2, head: 0.07, snout: 0.16, ears: "none", tail: "fan", tailLen: 0.3, extras: ["longneck", "crown"] },
    coats: [["red-crowned", ["#f6f6f2", "#1a1a1a", "#ffffff", "#141414", "#e02828"]], ["grey crowned", ["#8a9098", "#f4f4f0", "#a0a6ae", "#141414", "#e8c040"]]],
    temper: { display: 2.2, peck: 2, preen: 1.6, look: 1.4, flap: 1.2, fly: 1.2, wander: 1.2, hop: 0, sing: 0 }, friends: ["deer", "dikdik"] }),
  woodpecker: define({ label: "Woodpecker", plan: "bird", size: 0.18, rarity: "uncommon", weight: 18, regions: ["rockies", "atlantic", "alps", "tokyo"], speed: 1, groups: [8, 2, 1, 0],
    build: { ...OUTLINE.passerine, bill: 0.34, len: 1.1, leg: 0.2, body: 0.2, neck: 0.1, rise: 0.6, head: 0.15, snout: 0.22, ears: "none", tail: "fan", tailLen: 0.5, extras: ["crest"] },
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
    build: { ...OUTLINE.canid, taper: RUNNER_TAPER, len: 1.25, leg: 0.42, body: 0.36, neck: 0.16, rise: 0.55, head: 0.22, snout: 0.17, ears: "round", tail: "bushy", tailLen: 0.55, hip: 1.02, extras: ["mask"], foot: "paw", sit: "dog", tailGirth: 1.2, tailRise: -0.4 },
    coats: [["tanuki", ["#8a6c4a", "#4a3828", "#c8b08c", "#1a120c", "#e8dcc4"]], ["winter", ["#9a8060", "#5a4430", "#d8c4a4", "#1e140c", "#f0e6d4"]]],
    temper: { sniff: 2.2, dig: 1.6, eat: 1.4, sleep: 1.4, groom: 1.4, wander: 1.3, look: 1.2, graze: 0, run: 0.4 }, friends: ["crow"] }),
  marmot: define({ label: "Marmot", plan: "quad", size: 0.26, rarity: "uncommon", weight: 18, regions: ["alps", "rockies"], speed: 1, winter: false, groups: [3, 3, 3, 3], pack: [3, 5],
    build: { ...OUTLINE.rodent, len: 1.15, leg: 0.36, body: 0.38, neck: 0.2, rise: 0.6, head: 0.23, snout: 0.15, ears: "round", tail: "bushy", tailLen: 0.5, tailGirth: 0.6, hip: 1.05, foot: "plant", sit: "haunch", haunch: 1.15, snoutTip: 0.6, earLen: 0.7, extras: ["muzzle"] },
    coats: [["alpine", ["#8a6e4e", "#5e4a34", "#c8a878", "#1e160e", "#e8dcc8"]], ["yellow-bellied", ["#7a6450", "#4e3e30", "#d8a850", "#1a140e", "#efe4cc"]]],
    temper: { rear: 3, bask: 2, graze: 2, look: 2, groom: 1.2, dig: 1.4, run: 1.2, sleep: 1, wander: 0.8 }, friends: ["crow"] }),
  badger: define({ label: "Badger", plan: "quad", size: 0.3, rarity: "rare", weight: 9, regions: ["alps"], speed: 0.9, active: "night", groups: [5, 3, 3, 0],
    build: { ...OUTLINE.mustelid, len: 1.35, leg: 0.34, body: 0.4, neck: 0.15, rise: 0.35, head: 0.2, snout: 0.24, ears: "round", tail: "puff", tailLen: 0.22, hip: 1, extras: ["mask", "stripes"], foot: "plant", sit: "lie", snoutTip: 0.35, earLen: 0.6 },
    coats: [["badger", ["#9a9a98", "#2a2a2a", "#2a2826", "#121212", "#f4f4f0"]]],
    temper: { dig: 3, sniff: 2.4, groom: 1.2, sleep: 1.2, wander: 1.3, roll: 0.5, graze: 0, sit: 0.4, run: 0.3 }, friends: [] }),
  skunk: define({ label: "Skunk", plan: "quad", size: 0.2, rarity: "uncommon", weight: 12, regions: ["rockies", "atlantic"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", groups: [7, 1, 3, 0],
    build: { ...OUTLINE.mustelid, len: 1.12, leg: 0.4, body: 0.38, neck: 0.12, rise: 0.5, head: 0.22, snout: 0.2, ears: "round", tail: "bushy", tailLen: 1.1, hip: 1.12, extras: ["stripes"], foot: "plant", sit: "haunch", tailGirth: 1.4, tailRise: 0.6, snoutTip: 0.4 },
    coats: [["striped", ["#1a1a1c", "#f4f4f0", "#2a2a2c", "#0a0a0a", "#f4f4f0"]]],
    temper: { dig: 2.4, sniff: 2.4, groom: 1, wander: 1.2, graze: 0, run: 0.2, look: 0.8 }, friends: [] }),
  possum: define({ label: "Brushtail possum", plan: "quad", size: 0.26, rarity: "uncommon", weight: 14, regions: ["sydney"], worlds: ["nature", "voxel", "city"], speed: 0.9, active: "night", climbs: true, groups: [7, 2, 3, 0],
    build: { ...OUTLINE.viverrid, len: 1.3, leg: 0.42, body: 0.32, neck: 0.14, rise: 0.6, head: 0.22, snout: 0.16, ears: "point", tail: "bushy", tailLen: 1.1, hip: 1.05, foot: "plant", sit: "haunch", earLen: 1.2, tailGirth: 0.9, tailRise: -0.3 },
    coats: [["brushtail", ["#8a8a88", "#5a5a58", "#e8e4dc", "#1a1a1a", "#2a2624"]], ["copper", ["#9a6a4a", "#6a4430", "#e8d8c4", "#1e140c", "#2a1a10"]]],
    temper: { climb: 2.8, eat: 2.2, sit: 1.4, look: 1.6, sleep: 1.2, groom: 1.4, graze: 0, run: 0.4 }, friends: ["koala"] }),
  kookaburra: define({ label: "Kookaburra", plan: "bird", size: 0.36, rarity: "uncommon", weight: 16, regions: ["sydney"], worlds: ["nature", "voxel", "city", "beach"], speed: 1, groups: [3, 4, 3, 3], pack: [3, 5],
    build: { ...OUTLINE.passerine, bill: 0.55, len: 1, leg: 0.18, body: 0.24, neck: 0.08, rise: 0.5, head: 0.24, snout: 0.4, ears: "none", tail: "fan", tailLen: 0.55 },
    coats: [["laughing", ["#e2d6c0", "#6a5034", "#f4eee2", "#2a2018", "#4a7ab8"]]],
    temper: { sing: 3, look: 2.6, preen: 1.2, fly: 1.4, peck: 0.6, hop: 0.3 }, friends: ["kangaroo"] }),
  mongoose: define({ label: "Banded mongoose", plan: "quad", size: 0.18, rarity: "uncommon", weight: 16, regions: ["nairobi"], speed: 1.8, groups: [1, 2, 2, 7], pack: [4, 7],
    build: { ...OUTLINE.viverrid, len: 1.3, leg: 0.36, body: 0.26, neck: 0.2, rise: 0.6, head: 0.18, snout: 0.22, ears: "round", tail: "thin", tailLen: 0.9, hip: 1, extras: ["stripes"], foot: "paw", sit: "haunch", snoutTip: 0.35, earLen: 0.6 },
    coats: [["banded", ["#7a6e5e", "#4a4034", "#a89a84", "#1a1610", "#c8bca4"]]],
    temper: { rear: 2.2, dig: 2.4, sniff: 2.4, look: 1.6, groom: 1.6, run: 1.4, play: 1.4, bask: 1, graze: 0 }, friends: ["guineafowl"] }),
  dikdik: define({ label: "Dik-dik", plan: "quad", size: 0.4, rarity: "rare", weight: 12, regions: ["nairobi"], speed: 1.2, groups: [3, 7, 2, 0],
    build: { ...OUTLINE.cervid, len: 1, leg: 0.75, body: 0.2, neck: 0.4, rise: 0.95, head: 0.15, snout: 0.2, ears: "point", tail: "puff", tailLen: 0.12, foot: "hoof", sit: "lie", legR: 0.6, earLen: 1.2, snoutTip: 0.5 },
    coats: [["kirk", ["#a08468", "#7a6048", "#e8dccb", "#241a12", "#f4ece0"]]],
    temper: { graze: 2.4, look: 2.4, groom: 1, lie: 1.4, run: 0.6, sit: 0, dig: 0, roll: 0 }, friends: ["guineafowl", "songbird"] }),
  guineafowl: define({ label: "Guineafowl", plan: "bird", size: 0.5, rarity: "uncommon", weight: 14, regions: ["nairobi"], speed: 1, groups: [1, 2, 1, 8], pack: [4, 7],
    build: { ...OUTLINE.galliform, bill: 0.38, len: 1, leg: 0.3, body: 0.25, neck: 0.24, rise: 0.8, head: 0.1, snout: 0.08, ears: "none", tail: "fan", tailLen: 0.24, extras: ["spots", "crown"] },
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
/** A heading to look for a spot along: toward the viewer, when there is one, of four picks the nearest to it, so the far side (behind the trunk, from the camera) is rare, not barred. */
function headingFor(rand: () => number, stage: Stage): number {
  if (!stage.view) return rand() * TAU;
  const view = Math.atan2(stage.view[2], stage.view[0]);
  let best = rand() * TAU;
  for (let i = 0; i < 3; i += 1) {
    const a = rand() * TAU;
    if (turnTo(a, view) < turnTo(best, view)) best = a;
  }
  return best;
}

/** Whether a spot on the ground is round the back of the tree from the viewer (more than a little past the trunk's side). */
function farSide(stage: Stage, x: number, z: number): boolean {
  if (!stage.view) return false;
  const v = Math.hypot(stage.view[0], stage.view[2]), d = Math.hypot(x, z);
  return v > 0 && d > 0 && (x * stage.view[0] + z * stage.view[2]) / (v * d) < -0.2;
}

/** Whether a spot lies between the trunk's clearance and the rim, with room from the others. */
function spotFree(x: number, z: number, inner: number, outer: number, size: number, taken: readonly Spot[]): boolean {
  const d = Math.hypot(x, z);
  return d >= inner && d <= outer && taken.every((other) => Math.hypot(other.p[0] - x, other.p[2] - z) >= (other.size + size) * 0.8);
}

/**
 * A free spot on the ground, clear of the trunk, the rim and the others.
 * Spots lean out toward the rim, past the root tangle and the canopy's shade,
 * where an animal stands against open ground and not among the roots.
 */
function groundSpot(rand: () => number, stage: Stage, size: number, near?: Vec, reach = 0, taken: readonly Spot[] = []): Place {
  const inner = trunkClear(stage, size);
  const outer = Math.max(inner + 0.2, stage.radius - size * 0.8);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const a = headingFor(rand, stage);
    const r = near ? reach * Math.sqrt(rand()) : mix(inner, outer, rand() ** 0.35);
    const x = (near?.[0] ?? 0) + Math.cos(a) * r;
    const z = (near?.[2] ?? 0) + Math.sin(a) * r;
    // (The first tries keep off the far side, behind the trunk and its roots from the camera; the last take what there is.)
    if (spotFree(x, z, inner, outer, size, taken) && (attempt >= 8 || !farSide(stage, x, z))) return { on: "ground", x, z };
  }
  const a = headingFor(rand, stage);
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

/**
 * The tree's wood as a map: every stretch of branch once, however many perches
 * run along it, known by its two ends, and filed in a grid of the air so a body
 * asks only about the wood around it. Built once for a frame's stage.
 */
export interface WoodMap { readonly edges: readonly WoodEdge[]; readonly cells: ReadonlyMap<number, readonly number[]>; readonly thickest: number }
export interface WoodEdge { readonly a: Wood; readonly b: Wood; readonly keys: readonly [string, string] }

const WOOD_CELL = 0.25;
const woodMaps = new WeakMap<Stage, WoodMap>();
const woodKey = (w: Wood): string => `${Math.round(w.p[0] * 1e3)},${Math.round(w.p[1] * 1e3)},${Math.round(w.p[2] * 1e3)}`;
const cellOf = (v: number): number => Math.floor(v / WOOD_CELL) + 512;
const cellKey = (x: number, y: number, z: number): number => (x * 1024 + y) * 1024 + z;

/** Each grid cell between two corners. */
function cellsBetween(low: Vec, high: Vec, visit: (key: number) => void): void {
  for (let x = cellOf(low[0]); x <= cellOf(high[0]); x += 1) for (let y = cellOf(low[1]); y <= cellOf(high[1]); y += 1) for (let z = cellOf(low[2]); z <= cellOf(high[2]); z += 1) visit(cellKey(x, y, z));
}

const corner = (a: Vec, b: Vec, pick: (x: number, y: number) => number, by: number): Vec => [pick(a[0], b[0]) + by, pick(a[1], b[1]) + by, pick(a[2], b[2]) + by];

function fileEdge(cells: Map<number, number[]>, edge: WoodEdge, i: number): void {
  const pad = Math.max(edge.a.r, edge.b.r);
  cellsBetween(corner(edge.a.p, edge.b.p, Math.min, -pad), corner(edge.a.p, edge.b.p, Math.max, pad), (key) => {
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });
}

export function woodMapOf(stage: Stage): WoodMap {
  const known = woodMaps.get(stage);
  if (known) return known;
  const seen = new Set<string>();
  const edges: WoodEdge[] = [];
  for (const perch of stage.perches ?? []) for (const [k, b] of (perch.path ?? []).entries()) {
    const a = perch.path?.[k - 1];
    if (!a) continue;
    const keys = [woodKey(a), woodKey(b)] as const;
    if (seen.has(`${keys[0]}|${keys[1]}`)) continue;
    seen.add(`${keys[0]}|${keys[1]}`);
    edges.push({ a, b, keys });
  }
  const cells = new Map<number, number[]>();
  edges.forEach((edge, i) => { fileEdge(cells, edge, i); });
  const map = { edges, cells, thickest: edges.reduce((most, e) => Math.max(most, e.a.r, e.b.r), 0) };
  woodMaps.set(stage, map);
  return map;
}

/** The wood filed within `reach` of a point. */
function woodNear(map: WoodMap, p: Vec, reach: number): WoodEdge[] {
  const found = new Set<number>();
  cellsBetween(sub(p, [reach, reach, reach]), add(p, [reach, reach, reach]), (key) => { for (const i of map.cells.get(key) ?? []) found.add(i); });
  return [...found].flatMap((i) => map.edges[i] ?? []);
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
  /** The perches it goes by on a route over the wood (see `searchRoute`). */
  readonly via?: readonly number[];
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
  /** Which share of the tree's limbs is its troupe's, of how many, so troupes keep to their own without watching each other. */
  limbs: readonly [number, number];
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

const HOP_REACH = 1.4;
const HOP_COST = 1.6;
/** Going over wood it wouldn't sit on: thinner will do, for a step. */
const PASS_OVER = 0.05;
const CROWD_COST = 6;
/** Past this many perches a route isn't worth searching for: the way by the trunk is good enough. */
const MOST_ROUTED = 240;

/** A step between two perches: along their limb when they share one, else a hop across the air. */
function routeStep(from: Place, to: Place, stage: Stage): PathPoint[] {
  const [a, b] = [anchorOf(from, stage, []), anchorOf(to, stage, [])];
  const fork = sameLimb(branchWay(from, stage), branchWay(to, stage));
  return [{ p: a.p, up: a.up }, ...(fork ?? []), { p: b.p, up: b.up }];
}

/** A climber's way by the perches of its route. */
function routePath(from: Place, to: Place, via: readonly number[], stage: Stage): PathPoint[] {
  const stops: Place[] = [from, ...via.map((i): Place => ({ on: "perch", i })), to];
  return stops.slice(1).flatMap((stop, k) => routeStep(stops[k] ?? stop, stop, stage));
}

/** What a step between two perches costs a climber: none it can't take. */
function stepCost(a: Perch, b: Perch, size: number): number {
  const d = length(sub(a.p, b.p));
  const key = (perch: Perch): string | null => { const root = perch.path?.[1]; return root ? woodKey(root) : null; };
  if (key(a) !== null && key(a) === key(b)) return d;
  return d <= size * HOP_REACH ? d * HOP_COST : Infinity;
}

/** The cheapest perch not yet settled. */
function nearestOpen(costs: readonly number[], settled: ReadonlySet<number>): number {
  let best = -1;
  costs.forEach((cost, i) => { if (!settled.has(i) && cost < Infinity && (best < 0 || cost < (costs[best] ?? Infinity))) best = i; });
  return best;
}

/**
 * The cheapest way over the perches from one to another (Dijkstra, the wood
 * being a graph), mates' places dear, or null when none joins them. Searched
 * once, when the trip is planned, and kept with it: the trip is the same at any
 * frame rate, and only its own troupe's places bear on it.
 */
export function searchRoute(stage: Stage, start: number, goal: number, size: number, crowd: (i: number) => number): { via: number[]; cost: number } | null {
  const list = stage.perches ?? [];
  const costs = list.map((): number => Infinity);
  const before = list.map((): number => -1);
  const settled = new Set<number>();
  costs[start] = 0;
  for (let at = start; at >= 0 && at !== goal; at = nearestOpen(costs, settled)) {
    settled.add(at);
    const from = list[at];
    const reached = costs[at] ?? 0;
    list.forEach((next, i) => {
      if (!from || settled.has(i) || (i !== goal && next.r < size * PASS_OVER)) return;
      const cost = reached + stepCost(from, next, size) + crowd(i);
      if (cost < (costs[i] ?? Infinity)) { costs[i] = cost; before[i] = at; }
    });
  }
  if ((costs[goal] ?? Infinity) === Infinity) return null;
  const via: number[] = [];
  for (let i = before[goal] ?? -1; i >= 0 && i !== start; i = before[i] ?? -1) via.unshift(i);
  return { via, cost: costs[goal] ?? Infinity };
}

/** Where a climber goes by on its way between two branches, when that beats going round by the trunk. */
function routeVia(actor: Actor, from: Place, to: Place, scene: Scene): readonly number[] | undefined {
  const { stage } = scene;
  const count = stage.perches?.length ?? 0;
  if (from.on !== "perch" || to.on !== "perch" || count === 0 || count > MOST_ROUTED) return undefined;
  const wrap = (i: number): number => ((i % count) + count) % count;
  const size = actor.member.size;
  const crowd = (i: number): number => (perchFree(actor, scene, i) ? 0 : size * CROWD_COST);
  const found = searchRoute(stage, wrap(from.i), wrap(to.i), size, crowd);
  if (!found || found.via.length === 0) return undefined;
  const byTrunk = pathLength(climbPath(from, to, anchorOf(from, stage, []), anchorOf(to, stage, []), stage, size));
  return found.cost < byTrunk ? found.via : undefined;
}

function pathFor(mode: MoveMode, from: Place, to: Place, scene: Scene, size: number, spring = 0, loop?: Loop, via?: readonly number[]): PathPoint[] {
  const a = anchorOf(from, scene.stage, scene.backs);
  const b = anchorOf(to, scene.stage, scene.backs);
  const onWood = to.on === "perch" || to.on === "trunk";
  if (mode === "fly" && loop?.kind === "sortie") return sortiePath(a, b, scene.stage, size, loop, from.on !== "ground", onWood);
  if (mode === "fly" && loop?.kind === "flutter") return flutterPath(a, b, scene.stage, size, loop);
  if (mode === "fly") return flyPath(a, b, scene.stage, size, onWood);
  if (mode === "climb") return via ? routePath(from, to, via, scene.stage) : climbPath(from, to, a, b, scene.stage, size);
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
function travel(actor: Actor, wanted: Place, act: Action, scene: Scene, hurry = 1): void {
  const to = seatFor(actor, wanted, scene);
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
/**
 * Where a trip really ends: every way an animal is sent to a perch comes through
 * here, so birds and snakes never settle on one taken or too tight for them. They
 * take the next that fits, or the ground. (Those that groom sit close on purpose.)
 */
function seatFor(actor: Actor, to: Place, scene: Scene): Place {
  if (to.on !== "perch" || !(liesAlong(actor) || actor.spec.plan === "bird")) return to;
  const count = perchCount(scene);
  for (let k = 0; k < count; k += 1) if (perchFits(actor, scene.stage, to.i + k) && perchFree(actor, scene, to.i + k)) return { on: "perch", i: to.i + k };
  return groundSpot(actor.rand, scene.stage, actor.member.size, undefined, 0, takenBy(actor, scene));
}

function paceOf(actor: Actor, act: Action, mode: MoveMode, hurry: number, speed?: number): number {
  return speed !== undefined && mode === "fly" ? speed / actor.member.size : actor.spec.speed * (PACE[act] ?? 1) * hurry * (mode === "fly" ? 2.5 : 1);
}

function leg(actor: Actor, there: Place, act: Action, scene: Scene, hurry: number, loop?: Loop, speed?: number): void {
  const to: Place = there.on === "ground" ? onGround(scene.stage, actor.member.size, there.x, there.z) : there;
  const mode = modeFor(actor, act, actor.place, to);
  // A bug never flies straight: it flutters, on its own seeded jinks and loops.
  const way = loop ?? (mode === "fly" && actor.spec.plan === "bug" ? flutterOf(actor, scene) : undefined);
  const via = mode === "climb" ? routeVia(actor, actor.place, to, scene) : undefined;
  const path = pathFor(mode, actor.place, to, scene, actor.member.size, springOf(actor), way, via);
  const pace = paceOf(actor, act, mode, hurry, speed);
  const duration = Math.max(0.5, pathLength(path) / Math.max(0.02, pace * actor.member.size));
  const end = alongPath(path, 1);
  const t0 = actor.until;
  actor.segments.push({ act, t0, t1: t0 + duration, from: actor.place, to, yaw: actor.yaw, face: -1, mode, pace, ...(way && mode === "fly" ? { loop: way } : {}), ...(via ? { via } : {}) });
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

/** How near a point lies to a stretch of wood, its surface taken off. */
function offWood(p: Vec, a: Wood, b: Wood): number {
  const ab = sub(b.p, a.p);
  const ee = dot(ab, ab);
  const k = ee < 1e-9 ? 0 : clamp(dot(sub(p, a.p), ab) / ee, 0, 1);
  return length(sub(p, madd(a.p, ab, k))) - mix(a.r, b.r, k);
}

/** Whether a body sat on perch `i` keeps out of every limb but its own. */
function woodClear(stage: Stage, i: number, r: number): boolean {
  const perch = perchOf(stage, i);
  if (!perch) return true;
  const own = new Set((perch.path ?? []).map(woodKey));
  const map = woodMapOf(stage);
  const body = add(perch.p, [0, perch.r + r, 0]);
  const around = [body, madd(body, perch.d, r), madd(body, perch.d, -r)];
  const keep = r * 0.6;
  return around.every((p) => woodNear(map, p, keep + map.thickest).every((edge) => own.has(edge.keys[0]) || own.has(edge.keys[1]) || offWood(p, edge.a, edge.b) >= keep));
}

/** Whether no one in the troupe sits there, or is on the way, within a body's length. */
function perchFree(actor: Actor, scene: Scene, i: number): boolean {
  const at = placeTop({ on: "perch", i }, scene);
  const wooded = (place: Place): boolean => place.on === "perch" || place.on === "trunk";
  const limb = limbOf(scene.stage, i);
  // (A snake takes up its whole limb, lying along it.)
  const shares = (mate: Actor): boolean => (liesAlong(actor) || liesAlong(mate)) && mate.place.on === "perch" && limbOf(scene.stage, mate.place.i) === limb;
  return actor.mates.every((mate) => mate === actor || !wooded(mate.place) || (!shares(mate) && length(sub(placeTop(mate.place, scene), at)) >= (mate.member.size + actor.member.size) * 0.75));
}

/** Which limb a perch is on, as a number that doesn't depend on the order perches are listed. */
function limbOf(stage: Stage, i: number): number {
  const root = perchOf(stage, i)?.path?.[1]?.p ?? perchOf(stage, i)?.p ?? [0, 0, 0];
  return Math.abs(Math.round(Math.atan2(root[2], root[0]) * 3 + root[1] * 7));
}

const bodyRadius = (actor: Actor): number => actor.spec.build.body * actor.member.size;

/** How much limb a perch has behind it. */
function limbLength(stage: Stage, i: number): number {
  const path = perchOf(stage, i)?.path ?? [];
  return path.slice(1).reduce((sum, wood, k) => sum + length(sub(wood.p, path[k]?.p ?? wood.p)), 0);
}

/** Whether a body fits on a perch: wood that will bear it, out from the trunk, clear of other limbs, and long enough for a snake to lie on. */
function perchFits(actor: Actor, stage: Stage, i: number): boolean {
  const size = actor.member.size;
  const r = bodyRadius(actor);
  if ((perchOf(stage, i)?.r ?? 1) < r * 0.2 || !woodClear(stage, i, r)) return false;
  return liesAlong(actor) ? limbLength(stage, i) >= size : perchRoom(stage, i, size);
}

/**
 * A branch to sit on that fits the animal and is free of the others, or a spot
 * on the ground when the tree has no room left: a small tree holds only so many.
 */
function randomPerch(actor: Actor, scene: Scene): Place {
  const { stage } = scene;
  const ours = (i: number): boolean => limbOf(stage, i) % actor.limbs[1] === actor.limbs[0];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const i = Math.floor(actor.rand() * 9973);
    if ((attempt >= 8 || ours(i)) && perchFits(actor, stage, i) && perchFree(actor, scene, i)) return { on: "perch", i };
  }
  return groundSpot(actor.rand, stage, actor.member.size, undefined, 0, takenBy(actor, scene));
}

/** The branch spot nearest `i` in the list that has room for the animal, and keeps `apart` from `beside` when given, or `i` when none does. */
function roomyPerch(stage: Stage, i: number, size: number, beside?: number, apart = 0): number {
  const count = stage.perches?.length ?? 0;
  const near = beside === undefined ? null : perchOf(stage, beside)?.p ?? null;
  const roomy = (j: number): boolean => {
    const at = perchOf(stage, j)?.p;
    return perchRoom(stage, j, size) && woodClear(stage, j, size * 0.25) && (!near || !at || length(sub(at, near)) >= apart);
  };
  for (let k = 0; k < count; k += 1) {
    for (const j of [i + k, i - k]) if (roomy(j)) return j;
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
  return groundSpot(actor.rand, stage, actor.member.size, near, firefly ? 2.8 : 2.2, takenBy(actor, scene));
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
    if (actor.place.on !== "perch" || actor.place.i !== item.perch) {
      // (Fruit is where it is: a bird goes to that very perch, taken or not.)
      if (actor.spec.flies) leg(actor, { on: "perch", i: item.perch }, "fly", scene, 1);
      else travel(actor, { on: "perch", i: item.perch }, "climb", scene);
    }
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
  travel(b, { on: "perch", i: roomyPerch(scene.stage, i + 1, b.member.size, i, (a.member.size + b.member.size) * 0.75) }, "fly", scene);
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
  /** How far, and which way, its middle stands off the straight line from a to b: a curved part, in place of `flat`. */
  readonly bow?: Vec;
  /** A row of this many beads, each `r` round, from `a` to `b`, the way of `bow` at its middle: a foot's nails as one part. */
  readonly row?: number;
  /** On a row: each bead drawn out this far and this way into a digit (a hand's fingers as one part). */
  readonly reach?: Vec;
  readonly sharp?: boolean;
  /** A finishing part's group: see sdf-body's `fitParts`. */
  readonly detail?: number;
  /** On a decal: bare skin, which a pelt thins out toward (see sdf-body's BodyPart). */
  readonly bare?: boolean;
  /** Paint only: no surface of its own, it colours the body inside it (a bib, a rump patch, a mask). */
  readonly decal?: boolean;
  /** A decal painted under the coat's pattern, so the pattern still runs over it (an owl's barred breast). */
  readonly under?: boolean;
  /** A hollow cut into the body, painted in its role (an owl's dished face): no surface of its own. */
  readonly carve?: boolean;
  /** False when it casts no shadow: a small part standing off the body, whose shadow would fall as a speck apart from the rest. */
  readonly shadow?: boolean;
}

/** A part's taper, melt, decal, carve and shadow flags, as `cap` takes them. */
interface Finish { readonly sharp?: boolean; readonly detail?: number; readonly r1?: number; readonly melt?: number; readonly decal?: boolean; readonly under?: boolean; readonly carve?: boolean; readonly shadow?: boolean; readonly bow?: Vec; readonly row?: number; readonly reach?: Vec; readonly bare?: boolean }

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
  /** For a body that lies along its way, a snake: that way in the world, from its head back. */
  readonly trail?: readonly Vec[] | undefined;
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

/** The way back from `share` along a path: where the body is now, then each bend behind it, nearest first. */
function trailBehind(path: readonly PathPoint[], share: number): Vec[] {
  const want = share * pathLength(path);
  const back: Vec[] = [];
  let walked = 0;
  path.forEach((point, i) => {
    const before = path[i - 1];
    if (before) walked += length(sub(point.p, before.p));
    if (walked < want) back.unshift(point.p);
  });
  return [alongPath(path, share).p, ...back];
}

/** The wood behind a perch, from its tip back to the trunk and down it. */
function perchTrail(place: Place, scene: Scene): Vec[] | undefined {
  const way = branchWay(place, scene.stage);
  if (!way) return undefined;
  // (Winding round the trunk at one pitch: two that share it, from different limbs, never cross.)
  const wound = Array.from({ length: TRUNK_WINDS }, (_, i) => {
    const h = way.foot.h * (1 - (i + 1) / TRUNK_WINDS);
    return trunkPoint(scene.stage, h, way.foot.a + (way.foot.h - h) * TRUNK_PITCH).p;
  });
  return [...[...way.points].reverse().map((point) => point.p), ...wound];
}

const TRUNK_WINDS = 10;
const TRUNK_PITCH = 11;
const liesAlong = (actor: Actor): boolean => actor.spec.plan === "serpent" && actor.spec.build.leg === 0;

function movingFrame(actor: Actor, segment: Segment, t: number, scene: Scene, from = segment.yaw): { frame: Frame; phase: number; moving: number; trail?: readonly Vec[] } {
  const mode = segment.mode ?? "walk";
  const path = pathFor(mode, segment.from, segment.to, scene, actor.member.size, springOf(actor), segment.loop, segment.via);
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
  return { frame: frameOf(p, fw, at.up), phase: at.travelled / stride, moving, ...(mode === "climb" && liesAlong(actor) ? { trail: trailBehind(path, share) } : {}) };
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
    const { frame, phase, moving, trail } = movingFrame(actor, segment, t, scene, from);
    return { frame, trail: trail && overLimbs(trail, actor, scene.stage), phase, moving, pace: segment.pace, mode: segment.mode, segment, pose, t };
  }
  const trail = liesAlong(actor) ? perchTrail(segment.to, scene) : undefined;
  const lying = trail && overLimbs(trail, actor, scene.stage);
  return { frame: restingFrame(actor, segment, t, scene, partners, from ?? segment.turn), trail: lying, phase: 0, moving: 0, pace: 0, mode: null, segment, pose, t };
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
  kit.out.push(finish ? { ...capsule, ...finished(kit, finish) } : capsule);
}
/** A row's beads, and how far each reaches. */
function rowOf(kit: Kit, finish: Finish): Partial<Capsule> {
  return { ...(finish.row === undefined ? {} : { row: finish.row }), ...(finish.reach === undefined ? {} : { reach: dirToWorld(kit.f, kit.roll === 0 ? finish.reach : rollV(finish.reach, kit.roll)) }), ...(finish.sharp ? { sharp: true } : {}), ...(finish.detail === undefined ? {} : { detail: finish.detail }) };
}
/** What a finish adds to a capsule. */
function finished(kit: Kit, finish: Finish): Partial<Capsule> {
  return {
    ...(finish.r1 === undefined ? {} : { r1: Math.max(0, finish.r1) }),
    ...(finish.melt === undefined ? {} : { melt: finish.melt }),
    ...(finish.decal === true ? { decal: true } : {}),
    ...(finish.under === true ? { under: true } : {}),
    ...(finish.carve === true ? { carve: true } : {}),
    ...(finish.shadow === false ? { shadow: false } : {}),
    ...(finish.bare === true ? { bare: true } : {}),
    ...rowOf(kit, finish),
    ...(finish.bow === undefined ? {} : { bow: dirToWorld(kit.f, kit.roll === 0 ? finish.bow : rollV(finish.bow, kit.roll)) }),
  };
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

/** How far an animal that stoops has its nose down, 0 to 1, on all fours only. */
function nosing(b: Build, q: Pose): number {
  return b.stoop === undefined ? 0 : clamp(-q.headPitch / 0.55, 0, 1) * (1 - clamp(q.sit + q.lie + q.curl, 0, 1));
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
  S = madd(S, UP, -nosing(b, q) * (b.stoop ?? 0) * r);
  const gait = quadGait(actor, m);
  const free = m.moving * (1 - sit) * (1 - down) * (1 - up);
  const { lift, flex, reach } = strideOf(gait, m, q, size, r, free);
  P = add(P, [0, lift - flex, -reach]);
  S = add(S, [0, lift + flex, reach]);
  return { P, S, r, w: r * (b.stance ?? 0.72), L, legF: (shY - r * 0.45) * (bipedal(b) ? b.fore : 1), legH: hipY - r * 0.2, sit, loaf, lie, rump, haunch, rear, gait, free };
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
    // (A foreleg made as a column stands right under its shoulder.)
    let foot: Vec = [x * w, 0, b.legMake ? S[2] - r * 0.1 : S[2] + 0.05 * L];
    let tilt = b.legMake ? 0 : low.foreTilt;
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
  let foot: Vec = [x * w, 0, b.legMake ? P[2] + r * 0.25 : P[2]];
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
const SOLE: Readonly<Record<Foot, number>> = { paw: 0.6, hoof: 0.78, plant: 0.55 };
const LEG_TAPER = { fore: [1.45, 0.95, 0.9, 0.68], hind: [1.95, 1.1, 1.0, 0.62] } as const;

/** Which way a leg's middle joint bends: a knee forward, an elbow back, a folded knee out to the side. */
function poleOf(fore: boolean, body: QuadBody, b: Build, x: number): Vec {
  // (A tortoise's foreleg bows out from under its shell, the elbow to the side.)
  if (fore && b.extras.includes("shell")) return [x, 0, -0.35];
  if (fore) return body.lie > 0.5 && b.foot !== "hoof" ? [0, 1, -0.3] : [0, 0, -1];
  if (Math.max(body.lie, body.loaf, body.sit, body.haunch) > 0.5) return [x * 0.7, 0.5, 0.6];
  // (Standing, a soft leg's joint is its hock, behind the foot, where another's is a knee ahead of it.)
  return [0, 0, b.legMake ? -1 : 1];
}

/** A leg as it was drawn, for what a body spends on it last: its joints and what its foot stands on. */
interface LegLine { readonly name: string; readonly root: Vec; readonly mid: Vec; readonly sole: Vec; readonly ground: number; readonly legR: number; readonly x: number }

function quadLeg(kit: Kit, actor: Who, body: QuadBody, leg: LegId, plan: FootPlan, lines: LegLine[]): void {
  const b = buildOf(actor);
  const x = sideOf(leg);
  const fore = foreLeg(leg);
  const legR = Math.max(0.004, body.r * 0.32 * b.legR);
  // (A shell hides where a leg starts: from well up inside it, so all of a column shows below the rim.)
  const hidden = b.extras.includes("shell") ? body.r * 0.34 : 0;
  const reach = (fore ? body.legF : body.legH) + hidden;
  const { share, lean, upper, lower } = lowOf(b, fore);
  const lowLen = reach * share;
  const root = fore ? add(body.S, [x * body.w * 0.85, hidden - body.r * 0.45, -body.r * 0.1]) : add(body.P, [x * body.w, hidden - body.r * 0.2, hidden * 0.6]);
  const span = Math.max(1e-4, reach - lowLen * Math.cos(lean));
  const dir: Vec = [0, Math.cos(plan.tilt), Math.sin(plan.tilt) * (fore ? 1 : -1)];
  const plantR = legR * (b.legMake ? 0.72 : SOLE[b.foot]);
  const sole: Vec = add(plan.foot, [0, plantR, 0]);
  const { mid, end } = solveTwoBone(root, madd(sole, dir, lowLen), span * upper, span * lower, poleOf(fore, body, b, x));
  const name = `leg.${leg}`;
  const [r0, r1, r2, r3] = taperOf(b, fore);
  if (b.extras.includes("shell")) { columnLeg(kit, name, [root, mid, end], [r0, r1, r2, r3], legR, fore); stumpFoot(kit, name, sole, legR, fore, x); return; }
  lines.push({ name, root, mid, sole, ground: plan.foot[1], legR, x });
  cone(kit, `${name}.upper`, "coat", root, mid, legR * r0, legR * r1);
  cone(kit, `${name}.lower`, "coat", mid, end, legR * r2, legR * r3, b.legMake ? 0.8 : 0.45);
  if (b.legMake) softPaw(kit, b, name, sole, legR, fore);
  else footParts(kit, b, name, end, sole, legR, plantR);
}

/** A tortoise's leg: a tapered column, the foreleg's front flattened into a shield for its big scales. */
function columnLeg(kit: Kit, name: string, [root, mid, end]: readonly [Vec, Vec, Vec], [r0, r1, r2, r3]: readonly [number, number, number, number], legR: number, fore: boolean): void {
  const flat = fore ? 0.78 : 1;
  cap(kit, `${name}.upper`, "coat", root, mid, legR * r0, flat, [0, 0, 1], { r1: legR * r1, melt: 0.6 });
  cap(kit, `${name}.lower`, "coat", mid, end, legR * r2, flat, [0, 0, 1], { r1: legR * r3, melt: 0.5 });
}

/** A leg's lowest bone: its share of the leg and how it leans at rest; and the two upper bones, as shares of what is left. */
function lowOf(b: Build, fore: boolean): { share: number; lean: number; upper: number; lower: number } {
  const low = LOWER[b.foot];
  if (b.legMake) {
    const [upper, lower] = fore ? [b.foreBone, b.foreBone] : b.legMake.hindBones;
    return { share: 0, lean: 0, upper, lower };
  }
  if (fore) return { share: low.fore, lean: low.foreTilt, upper: b.foreBone, lower: b.foreBone };
  // (A kangaroo's hind foot is long: it stands on it.)
  return { share: bipedal(b) ? 0.42 : low.hind, lean: low.hindTilt, upper: 0.56, lower: 0.56 };
}

const taperOf = (b: Build, fore: boolean): readonly [number, number, number, number] => (fore ? b.legMake?.fore ?? b.taper?.fore ?? LEG_TAPER.fore : b.legMake?.hind ?? b.taper?.hind ?? LEG_TAPER.hind);

const softRole = (b: Build): Role => (b.extras.includes("mitts") ? "belly" : b.extras.includes("socks") ? "dark" : "coat");

/** The foot of a soft leg: a low oval paw the leg flows into with no neck above it, its pale fur running up into the leg. */
function softPaw(kit: Kit, b: Build, name: string, sole: Vec, legR: number, fore: boolean): void {
  if (b.extras.includes("toes")) { toedPaw(kit, name, sole, legR, fore); return; }
  cap(kit, `${name}.paw`, softRole(b), madd(sole, [0, 0, 1], -legR * 0.2), madd(sole, [0, 0, 1], legR * 0.75), legR * 1.18, 0.62, UP, { melt: 0.9 });
  // (A raccoon's forepaw is a hand: two lines over its front part three fingers, each a blade deep enough to follow the paw's curve.)
  if (fore && b.extras.includes("fingers")) for (const x of [-1, 1]) cap(kit, `${name}.finger`, "alt", add(sole, [x * legR * 0.36, legR * 0.3, legR * 0.8]), add(sole, [x * legR * 0.44, legR * 0.05, legR * 1.5]), legR * 0.6, 0.16, [1, 0, 0], { decal: true });
}

/** An elephant's foot on a tortoise: the column's end spread round and flat on the ground, a row of stout blunt nails of pale horn along its toe edge, turned out a little. */
function stumpFoot(kit: Kit, name: string, sole: Vec, legR: number, fore: boolean, x: number): void {
  cap(kit, `${name}.paw`, "coat", sole, sole, legR * 1.06, 0.68, UP, { melt: 0.3 });
  const span = legR * (fore ? 0.92 : 0.74);
  const toe = add(sole, [x * legR * 0.22, -legR * 0.38, legR * 0.68]);
  cap(kit, `${name}.nails`, "horn", add(toe, [-span, 0, -x * legR * 0.2]), add(toe, [span, 0, x * legR * 0.2]), legR * 0.215, 1, UP, { row: fore ? 5 : 4, bow: [0, 0, legR * 0.36], shadow: false });
}

/** A low flat paw of bare skin with its toes as nubs of their own, a hedgehog's: three to a forepaw and two to a hind one, all a body's parts can spare. */
function toedPaw(kit: Kit, name: string, sole: Vec, legR: number, fore: boolean): void {
  for (const x of fore ? [-1, 0, 1] : [-0.6, 0.6]) {
    const nub = add(sole, [x * legR * 0.85, -legR * 0.3, legR * (1.7 - Math.abs(x) * 0.25)]);
    cap(kit, `${name}.toe${String(x)}`, "accent", nub, nub, legR * 0.5, 0.75, UP, { melt: 0.15 });
  }
  cap(kit, `${name}.paw`, "accent", madd(sole, [0, 0, 1], -legR * 0.2), madd(sole, [0, 0, 1], legR * 0.5), legR * 1.18, 0.5, UP, { melt: 0.25 });
}

/** A kind's paw, in leg radii: its toes, how long and stout a claw is and how far it curls under, how wide the toes fan; `sheathed` claws stay in until they are wanted. */
interface Paw { readonly toes: number; readonly long: number; readonly stout: number; readonly curl: number; readonly fan: number; readonly sheathed?: boolean }
const PAW: Paw = { toes: 4, long: 0.36, stout: 0.15, curl: 0.45, fan: 0.6 };
const PAWS: Partial<Readonly<Record<string, Paw>>> = {
  cat: { toes: 4, long: 0.46, stout: 0.13, curl: 0.8, fan: 0.62, sheathed: true },
  bear: { toes: 5, long: 0.8, stout: 0.18, curl: 0.62, fan: 0.8 }, badger: { toes: 5, long: 0.85, stout: 0.15, curl: 0.3, fan: 0.72 }, koala: { toes: 5, long: 0.75, stout: 0.13, curl: 0.9, fan: 0.74 },
  marmot: { toes: 4, long: 0.62, stout: 0.14, curl: 0.4, fan: 0.66 }, squirrel: { toes: 4, long: 0.6, stout: 0.1, curl: 0.95, fan: 0.66 }, mouse: { toes: 4, long: 0.5, stout: 0.09, curl: 0.7, fan: 0.7 },
  rabbit: { toes: 4, long: 0.3, stout: 0.14, curl: 0.3, fan: 0.46 }, wolf: { toes: 4, long: 0.4, stout: 0.17, curl: 0.35, fan: 0.56 },
};
/** The acts a sheathed claw comes out for. */
const CLAW_ACTS: readonly Action[] = ["scratch", "stalk", "climb", "rear", "play", "hang"];
/** How far out its claws are: all the way on most animals; on a sheathed one only through the acts that want them, sliding out and back in at either end. */
function clawsOut(paw: Paw, m: Moment): number {
  if (!paw.sheathed) return 1;
  if (!CLAW_ACTS.includes(m.segment.act)) return 0;
  return clamp(Math.min(m.t - m.segment.t0, m.segment.t1 - m.t) * 3, 0, 1);
}

/**
 * A paw's toes as one part, fanned from the foot's front edge and melting back
 * into it, and its claws as another, rooted inside the toes' tips and drawn
 * out to points. Shaped by its kind, and a little by the animal.
 */
function pawDigits(kit: Kit, b: Build, line: LegLine, paw: Paw, out: number, gene: () => number): void {
  const { name, sole, ground, legR, x } = line;
  const span = legR * paw.fan * mix(0.92, 1.08, gene());
  const long = legR * paw.long * mix(0.85, 1.15, gene());
  const toe = legR * mix(0.54, 0.68, gene());
  const edge: Vec = [sole[0] + x * legR * 0.08, ground + legR * 0.26, sole[2] + legR * 0.72];
  const row = (o: Vec): { a: Vec; b: Vec } => ({ a: add(o, [-span, 0, -legR * 0.06]), b: add(o, [span, 0, -legR * 0.06]) });
  // (Claws a cat has just put out matter more than its toes, so they go last.)
  const toes = row(edge);
  cap(kit, `${name}.toes`, b.legMake ? softRole(b) : "dark", toes.a, toes.b, legR * 0.26, 0.8, UP, { row: paw.toes, reach: [0, -legR * 0.02, toe], melt: 0.32, shadow: false, detail: paw.sheathed && out >= 0.05 ? 2 : 1 });
  if (out < 0.05) return;
  const claws = row(add(edge, [0, -legR * 0.05, toe * 0.86]));
  cap(kit, `${name}.claws`, "horn", claws.a, claws.b, legR * paw.stout, 1, UP, { row: paw.toes, reach: [0, -long * paw.curl * out, long * out], sharp: true, melt: 0.1, shadow: false, detail: paw.sheathed ? 1 : 2 });
}

/** The muscle a leg hangs from, a flat sheet down its outside: a shoulder blade and upper arm, a thigh. */
const legMass = (kit: Kit, { name, root, mid, legR }: LegLine): void => {
  cap(kit, `${name}.mass`, "coat", add(root, [0, legR * 1.1, 0]), lerpV(root, mid, 0.72), legR * 1.5, 0.6, [1, 0, 0], { r1: legR * 0.95, melt: 0.95, shadow: false, detail: 3 });
};

/** A leg's finishing parts, each set one `detail` group, so a device short of parts drops them whole, muscle first. */
function legFinish(kit: Kit, actor: Who, lines: readonly LegLine[], m: Moment): void {
  const b = buildOf(actor);
  const paw = PAWS[actor.member.species] ?? PAW;
  const gene = createRandom(markOf(actor) ^ 0x7ac3119d);
  const shape = [gene(), gene(), gene()];
  if (b.foot !== "hoof" && !b.extras.includes("toes") && !b.extras.includes("fingers")) for (const line of lines) { let i = 0; pawDigits(kit, b, line, paw, clawsOut(paw, m), () => shape[i++] ?? 0.5); }
  for (const line of lines) legMass(kit, line);
  // (A deer's slim leg shows its joints: a knobbed knee or hock, the fetlock over each hoof.)
  if (b.foot === "hoof") for (const { name, mid, legR } of lines) cap(kit, `${name}.knee`, "coat", mid, mid, legR * 0.72, 0.9, [1, 0, 0], { melt: 0.5, shadow: false, detail: 2 });
}

/** The lowest bone and what it stands on: a hoof's cannon and hoof, a flat sole, a pastern and paw. */
function footParts(kit: Kit, b: Build, name: string, end: Vec, sole: Vec, legR: number, plantR: number): void {
  const lowRole: Role = b.extras.includes("socks") ? "dark" : "coat";
  if (b.foot === "hoof") {
    cone(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.55, legR * 0.48, 0.35);
    // (Cloven: two toes of horn, wedged forward from the fetlock.)
    const wide: Vec = [plantR * 0.55, 0, 0];
    cap(kit, `${name}.paw`, "dark", sub(sole, wide), add(sole, wide), plantR * 0.62, 1, UP, { row: 2, reach: [0, -plantR * 0.5, plantR * 1.1], melt: 0.1 });
    return;
  }
  const toe = madd(sole, [0, 0, 1], plantR * (b.foot === "plant" ? 0.6 : 0.35));
  // (A sole lies flat, heel to toe, so the foot reads from the side.)
  if (b.foot === "plant") cap(kit, `${name}.cannon`, lowRole, end, sole, legR * 0.75, 0.7, UP, { r1: legR * 0.85, melt: 0.4 });
  else cone(kit, `${name}.cannon`, lowRole, end, sole, legR * (b.taper ? 0.42 : 0.62), legR * (b.taper ? 0.46 : 0.55), 0.35);
  cap(kit, `${name}.paw`, "dark", toe, toe, plantR * (b.foot === "plant" ? 1.25 : 1.35), b.foot === "plant" ? 0.6 : 0.7, UP, { melt: 0.3 });
}

function headAxes(hd: Vec, roll: number): { s: Vec; u: Vec } {
  const hs = unit(cross(UP, hd), [1, 0, 0]);
  const hu = cross(hd, hs);
  return roll === 0 ? { s: hs, u: hu } : { s: unit(madd(hs, hu, -roll)), u: unit(madd(hu, hs, roll)) };
}

/** The cross-section of an outline at one point along it: its middle off the line, its half height, its half width. */
interface Section { readonly o: number; readonly h: number; readonly w: number }

function sectionAt(st: readonly Station[], k: number): Section {
  let i = 0;
  while (i < st.length - 2 && k > (st[i + 1]?.[0] ?? k)) i += 1;
  const [k0, t0, b0, w0] = st[i] ?? [0, 1, 1, 1];
  const [k1, t1, b1, w1] = st[i + 1] ?? [k0, t0, b0, w0];
  const f = clamp((k - k0) / Math.max(k1 - k0, 1e-6), 0, 1);
  const top = mix(t0, t1, f);
  const bottom = mix(b0, b1, f);
  return { o: (top - bottom) / 2, h: (top + bottom) / 2, w: mix(w0, w1, f) };
}

/**
 * An outline lofted into one smooth body: each pair of stations is one part
 * from one cross-section to the next, tapered and squashed to the sections'
 * height and width, so the silhouette follows the species' own back line,
 * belly line and girth (a bear's hump, a dog's tucked waist) and not a tube's.
 */
function loft(kit: Kit, part: string, role: Role, st: readonly Station[], along: (k: number) => Vec, u: Vec, s: Vec, size: number, melt: number): void {
  for (let i = 0; i + 1 < st.length; i += 1) {
    const [ka, ta, ba, wa] = st[i] ?? [0, 1, 1, 1];
    const [kb, tb, bb, wb] = st[i + 1] ?? [ka, ta, ba, wa];
    const ha = (ta + ba) / 2;
    const hb = (tb + bb) / 2;
    const wide = wa + wb > ha + hb;
    const flat = wide ? (ha + hb) / (wa + wb) : (wa + wb) / (ha + hb);
    const a = madd(along(ka), u, ((ta - ba) / 2) * size);
    const b = madd(along(kb), u, ((tb - bb) / 2) * size);
    cap(kit, `${part}.${String(i)}`, role, a, b, Math.max(ha, wa) * size, flat, wide ? u : s, { r1: Math.max(hb, wb) * size, melt });
  }
}

/**
 * A head. One drawn from an outline carries its sections (`sec`, in head
 * radii along `d`), where its brow drops to the muzzle (`stop`) and where
 * the muzzle ends (`tip`); a round head has none.
 */
interface Head {
  readonly c: Vec; readonly d: Vec; readonly s: Vec; readonly u: Vec; readonly r: number;
  readonly sec?: (k: number) => Section; readonly stations?: readonly Station[]; readonly stop?: number; readonly tip?: number;
  /** How its eyes are made; without one, round. */
  readonly eye?: EyeStyle;
}
/** Heads a touch big for the body, as a toy's are: the face is what makes an animal read at a glance. */
const CHARM = 1.18;

/** A skull's outline and its muzzle's, joined: the muzzle's stations run from the stop (0) to the nose (1), its length the animal's own snout. */
function headStations(b: Build, snout: number, hr: number): { stations: Station[]; stop: number; tip: number } | null {
  if (!b.skull) return null;
  const skull = [...b.skull];
  const stop = skull[skull.length - 1]?.[0] ?? 0.35;
  const tip = stop + snout / hr + 0.15;
  const muzzle = (b.muzzle ?? []).filter(([k]) => k > 0).map(([k, t, bt, w]): Station => [mix(stop, tip, k), t, bt, w]);
  return { stations: [...skull, ...muzzle], stop, tip };
}

/** How far a head's line lies below level for a nod of `nod`, no further than its build lets it. */
const headDrop = (b: Build, nod: number): number => Math.max(-0.15 + nod, -(b.dip ?? Infinity));

/**
 * A neck that draws back into a shell: out from under the rim and forward,
 * then up to a head held level or, grazing, on over and down to the ground, a
 * short S with the skull still upright on the end of it. Its loose skin stands
 * in a collar and a fold at the shell only, the rest of it smooth.
 */
function shellNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose): Head {
  const b = buildOf(actor);
  const size = actor.member.size;
  const { S, r } = body;
  const [neckUp, neckOut] = b.neckRoot ?? [0, 0.5];
  const n0 = add(S, [0, r * neckUp, r * neckOut]);
  const down = clamp(-q.headPitch, 0, 1.4) / 1.25;
  const up = clamp(q.headPitch, 0, 1.3) / 1.2;
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  // (A tortoise draws its head in when it tucks down.)
  const reach = Math.max(b.neck * size, r * 0.4) * (1 - body.lie * 0.7);
  const bend = madd(n0, dirOf(yaw, mix(mix(b.rise, 0.5, down), 1.1, up)), reach * mix(0.56, 0.6, down));
  const n1 = madd(bend, dirOf(yaw * 1.5, mix(mix(b.rise * 1.3, -1.02, down), 1.3, up)), reach * mix(0.52, 0.68, down));
  const hr = b.head * size * CHARM;
  const girth = r * (b.neckEnd ?? 0.15);
  cone(kit, "neck", "coat", n0, bend, r * 0.62 * b.neckGirth, girth * 1.1, 0.5);
  cone(kit, "neck.end", "coat", bend, n1, girth * 1.1, girth * mix(0.86, 0.68, down), 0.5);
  const out = unit(sub(bend, n0), [0, 0, 1]);
  cap(kit, "neck.collar", "coat", madd(n0, out, reach * 0.16), madd(n0, out, reach * 0.16), girth * 1.5, 0.42, out, { melt: 0.3, shadow: false });
  cap(kit, "neck.fold", "coat", madd(n0, out, reach * 0.32), madd(n0, out, reach * 0.32), girth * 1.22, 0.4, out, { melt: 0.3, shadow: false });
  const hd = dirOf(yaw * 1.8, mix(-0.1, -0.54, down) + up * 0.5);
  return { c: madd(madd(n1, hd, hr * 0.5), UP, -hr * 0.2 * down), d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(actor) };
}

function quadNeck(kit: Kit, actor: Who, body: QuadBody, q: Pose, m: Moment): Head {
  const b = buildOf(actor);
  if (b.extras.includes("shell")) return shellNeck(kit, actor, body, q);
  const size = actor.member.size;
  const { P, S, r } = body;
  const chest = r * b.chest;
  const [neckUp, neckOut] = b.neckRoot ?? [0.45, 0.45];
  const n0 = add(S, [0, r * neckUp, r * neckOut]);
  const bodyPitch = Math.atan2(S[1] - P[1], S[2] - P[2]);
  // A hoofed walker nods with its stride; every head stays steadier than its body.
  const nod = b.foot === "hoof" ? 0.09 * Math.sin(TAU * 2 * m.phase) * body.free : 0;
  const pitch = q.headPitch + nod;
  const down = clamp(-pitch, 0, 1.4) / 1.25;
  const up = clamp(pitch, 0, 1.3) / 1.2;
  const nose = nosing(b, q);
  let np = b.rise - bodyPitch * 0.6;
  np = mix(mix(mix(np, -0.9, down), 1.35, up), -0.12, nose);
  const yaw = clamp(q.headYaw, -2.4, 2.4) * 0.45 + q.curl * 1.1;
  const n1 = madd(n0, dirOf(yaw, np), Math.max(b.neck * size, r * 0.4) * (1 + nose * 0.3));
  const hr = b.head * size * CHARM;
  cone(kit, "neck", "coat", n0, n1, r * 0.62 * b.neckGirth, Math.max(hr * 0.55 * b.neckGirth, r * (b.neckEnd ?? 0.32)), b.neckEnd === undefined ? 1 : 0.3);
  if (b.extras.includes("ruff")) cap(kit, "ruff", "coat", lerpV(n0, S, 0.4), lerpV(n0, n1, 0.35), chest * 0.82, 1, UP, { melt: 1.4 });
  if (b.extras.includes("bib")) decal(kit, "bib", "belly", add(S, [0, -chest * 0.35, chest * 0.75]), madd(n1, dirOf(yaw, np - 1.2), hr * 0.4), chest * 0.5);
  const hd = dirOf(yaw * 1.8 + q.curl * 0.8, headDrop(b, (pitch * 0.55 - down * 0.45) * (1 - nose * 0.45)) - q.curl * 0.4);
  const head: Head = { c: madd(madd(n1, hd, hr * 0.55), [0, 0, 1], -(b.curlIn ?? 0) * q.curl * r), d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(actor) };
  const outline = headStations(b, b.snout * size, hr);
  if (!outline) return head;
  const { stations } = outline;
  return { ...head, ...outline, sec: (k: number) => sectionAt(stations, k) };
}

/**
 * A point on (or in) the head, `d` along it and `s`, `u` across it, as on a
 * round head of radius 1. On an outlined head the point sits as far out on
 * that station's own section as it would on the round one, so an ear or an
 * eye set on a round head's surface lands on a bear's broad crown too.
 */
const at3 = (h: Head, d: number, s: number, u: number): Vec => {
  if (!h.sec) return add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, s * h.r)), scale(h.u, u * h.r)));
  const sec = h.sec(d);
  const rho = Math.sqrt(Math.max(1 - d * d, 0.2));
  return add(h.c, add(add(scale(h.d, d * h.r), scale(h.s, (s / rho) * sec.w * h.r)), scale(h.u, (sec.o + (u / rho) * sec.h) * h.r)));
};

function earsOf(kit: Kit, kind: Ears, h: Head, back: number, size = 1, role: Role = "coat", base = 1): void {
  for (const x of [-1, 1]) earOf(kit, `ear.${x < 0 ? "L" : "R"}`, kind, h, x, back, size, role, base);
}

function earOf(kit: Kit, part: string, kind: Ears, h: Head, x: number, back: number, size: number, role: Role, base: number): void {
  if (kind === "point" || kind === "tuft") {
    const root = at3(h, -0.05, x * (0.5 + (base - 1) * 0.15), 0.6);
    const dir = unit(add(add(scale(h.u, 1), scale(h.d, -(0.25 + back * 0.8))), scale(h.s, x * 0.3)));
    const len = h.r * (kind === "tuft" ? 0.7 : 0.95) * size;
    // (Pointed: broad at the root, narrowing to the tip.)
    cap(kit, part, kind === "tuft" ? "alt" : role, root, madd(root, dir, len), h.r * 0.4 * Math.sqrt(size) * base, 0.34, unit(madd(h.d, h.s, -x * 0.4)), { r1: h.r * 0.06, melt: 0.45 });
  } else if (kind === "cup") cupEar(kit, part, h, x, size);
  else if (kind === "round" || kind === "fluffy" || kind === "rimmed") roundEar(kit, part, kind, h, x, size);
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

/** A round ear set out on top of the head, so even a mouse's clears its outline; a koala's with a pale fringe of fur, a raccoon's white round its edge with the dark inside it. */
function roundEar(kit: Kit, part: string, kind: Ears, h: Head, x: number, size: number): void {
  const fluffy = kind === "fluffy";
  const rimmed = kind === "rimmed";
  // (A raccoon's sits wide on the skull's corner, thick and turned well outward, so its white rim shows from every side.)
  const at = rimmed ? at3(h, -0.16, x * 0.7, 0.84) : fluffy ? at3(h, -0.1, x * 0.8, 0.85) : at3(h, -0.2, x * 0.6, 0.98);
  const er = h.r * 0.32 * size;
  cap(kit, part, rimmed ? "accent" : "coat", at, at, er, rimmed ? 0.66 : 0.55, rimmed ? unit(madd(h.d, h.s, x * 0.72)) : h.d, { melt: 0.35 });
  if (fluffy) decal(kit, `${part}.fluff`, "belly", madd(at, h.s, x * er * 0.35), madd(at, h.s, x * er * 0.35), er * 0.75);
  if (rimmed) decal(kit, `${part}.in`, "alt", at, at, er * 0.86);
}

/** A leathery cup set low on the side of the head and turned out and forward, its pale rim round the dark of its hollow (a hedgehog's, just under its spines). */
function cupEar(kit: Kit, part: string, h: Head, x: number, size: number): void {
  const at = at3(h, -0.2, x * 0.86, 0.62);
  const er = h.r * 0.32 * size;
  const face = unit(add(add(scale(h.d, 0.9), scale(h.s, x * 0.6)), scale(h.u, 0.2)));
  cap(kit, part, "coat", at, at, er, 0.5, face, { melt: 0.3 });
  decal(kit, `${part}.in`, "accent", madd(at, face, er * 0.3), madd(at, face, er * 0.3), er * 0.84);
}

/**
 * An eye that reads at a glance: the iris set proud of the head, a dark
 * pupil on it and a spark of light; shut, just a dark lid. It sits on the
 * head's surface where `toward` points from the head's middle.
 */
function eyeOf(kit: Kit, part: string, h: Head, toward: Vec, r: number, open: boolean): void {
  const n = unit(sub(toward, h.c), h.d);
  eyeAt(kit, part, h, madd(h.c, n, h.r * (h.eye?.set ? 0.97 : 0.92)), n, r, open);
}

/**
 * A point on a head's face, as (along, out, up) on its unit sphere (see
 * `at3`): where an eye sits, so the markings round it (a mask, an eye
 * stripe, a rim) are placed from the eye itself and never drift off it.
 */
type FacePoint = readonly [number, number, number];
const FACE = 0.97;

/** The eye's place: `d` along the head, its (out, up) direction pushed out to the surface there. */
function eyeSpot(d: number, s: number, u: number): FacePoint {
  const k = (Math.sqrt(Math.max(1 - d * d, 0.2)) * FACE) / Math.max(Math.hypot(s, u), 1e-6);
  return [d, s * k, u * k];
}

/** Any direction from the head's middle, out to the face's surface. */
function toSkin(p: FacePoint): FacePoint {
  const k = FACE / Math.max(Math.hypot(...p), 1e-6);
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** A point on the face at a given height `u`: out to `s` across it, as far forward as the surface lies there. */
function frontAt(s: number, u: number): FacePoint {
  return [Math.sqrt(Math.max(FACE * FACE - s * s - u * u, 0.02)), s, u];
}

/** A point on the side of the head at `d` along it and height `u`, as far out as the surface lies there. */
function sideAt(x: number, d: number, u: number): FacePoint {
  return [d, x * Math.sqrt(Math.max(FACE * FACE - d * d - u * u, 0.02)), u];
}

/** A face point on the head's surface: through its section on an outlined head, out to the skin of a round one. */
const onFace = (h: Head, p: FacePoint): Vec => {
  const at = at3(h, p[0], p[1], p[2]);
  return h.sec ? at : madd(h.c, unit(sub(at, h.c), h.d), h.r * 0.92);
};

/** An eye on an outlined head: on its section's surface at `spot` (the brow above, the cheek below). */

function outlinedEye(kit: Kit, part: string, h: Head, spot: FacePoint, r: number, open: boolean): void {
  const [d] = spot;
  const at = onFace(h, spot);
  const sec = h.sec?.(d) ?? { o: 0, h: 1, w: 1 };
  const axis = add(h.c, add(scale(h.d, d * h.r), scale(h.u, sec.o * h.r)));
  eyeAt(kit, part, h, at, unit(madd(sub(at, axis), h.d, h.r * 0.35), h.d), r, open);
}

/**
 * An eye as its species has it (see `EYES`): framed by a dark rim on the
 * coat, the iris in its own colour, the pupil its own shape (a cat's slit,
 * a deer's bar, a mouse's eye all pupil) and a catchlight high on it.
 */
function eyeAt(kit: Kit, part: string, h: Head, at: Vec, n: Vec, r0: number, open: boolean): void {
  const style = h.eye ?? EYE;
  const r = r0 * style.size * 0.9;
  if (!open) {
    ball(kit, part, "dark", at, r, 0.3, n);
    return;
  }
  // (Across and up on the eye's own face, whichever way the head is turned.)
  const across = unit(cross(n, h.u), h.s);
  const up = cross(across, n);
  // Set into the head, a shallow lens and not a ball stuck on it; a mammal's drawn out to an almond.
  const lens = style.set ? LOW_LENS : LENS;
  const c = madd(at, n, -r * lens.sink);
  // (Never quite none: which way the lens lies is how the shader finds its lid.)
  const long = r * Math.max(0.3 * style.almond, 0.02);
  // (A bead is all pupil, so it needs none laid on it.)
  cap(kit, part, style.pupil === "bead" ? "pupil" : "eye", madd(c, across, -long), madd(c, across, long), r, lens.flat, n);
  // (The renderer paints a lens's pupil and spark on it; a bead is all pupil, so it carries its own spark.)
  if (style.pupil !== "bead") return;
  ball(kit, `${part}.shine`, "shine", madd(madd(madd(c, n, r * lens.out), up, r * lens.high), across, -r * lens.aside), r * (style.spark ?? (style.set ? 0.12 : 0.24)));
}

/** A lens: how far it sinks into the head, how flat it is, and where its spark sits on it (out along it, up it, and aside). */
const LENS = { sink: 0.15, flat: 0.8, out: 0.82, high: 0.36, aside: 0.2 };
const LOW_LENS = { sink: 0.2, flat: 0.55, out: 0.47, high: 0.3, aside: 0.16 };

/** Where the eyes sit on a round head, as face points; a build can set its own. */
function roundEyes(b: Build): FacePoint[] {
  const [d, s, u] = b.eyeSet ?? [0.62, 0.5, 0.28];
  return [-1, 1].map((x) => [d, x * s, u]);
}

/**
 * A tortoise's face: a short blunt wedge, its crown flat, breaking at the brow
 * to a muzzle that drops to its beak; a beak of pale horn with a small hook at
 * the front of the upper one, its dark gape running back and up toward the eye;
 * a pair of nostrils; and its eye set halfway along the side under a heavy brow.
 */
function shellFace(kit: Kit, h: Head, q: Pose, asleep: boolean): void {
  const from = kit.out.length;
  cap(kit, "head", "coat", at3(h, -0.58, 0, 0.06), at3(h, 0.24, 0, 0.06), h.r * 0.84, 0.68, h.u, { r1: h.r * 0.72, melt: 0.5 });
  cap(kit, "snout", "coat", at3(h, 0.3, 0, -0.1), at3(h, 0.7, 0, -0.2), h.r * 0.62, 0.76, h.u, { r1: h.r * 0.46, melt: 0.2 });
  const gap = h.r * q.mouth * 0.6;
  cone(kit, "jaw", "belly", at3(h, -0.1, 0, -0.44), madd(at3(h, 0.8, 0, -0.56), h.u, -gap), h.r * 0.44, h.r * 0.3, 0.35);
  cap(kit, "beak", "horn", at3(h, 1.02, 0, -0.24), at3(h, 1.15, 0, -0.5), h.r * 0.33, 0.5, h.d, { r1: h.r * 0.14 });
  const chin = madd(at3(h, 1, 0, -0.66), h.u, -gap);
  cap(kit, "beak.low", "horn", madd(chin, h.s, -h.r * 0.14), madd(chin, h.s, h.r * 0.14), h.r * 0.15, 0.7, h.u);
  const mouth = at3(h, 0.5, 0, -0.5);
  cap(kit, "mouth", "dark", mouth, mouth, h.r * 1.3, 0.085, madd(h.u, h.d, 0.34), { decal: true, melt: 0.25 });
  for (const x of [-1, 1]) {
    const nostril = at3(h, 1.06, x * 0.13, 0.06);
    decal(kit, "nostril", "dark", nostril, nostril, h.r * 0.05);
    const eye = at3(h, 0.22, x * 0.71, 0.2);
    eyeAt(kit, `eye.${x < 0 ? "L" : "R"}`, h, eye, unit(add(scale(h.s, x * 0.82), add(scale(h.d, 0.52), scale(h.u, 0.18)))), h.r * 0.22, !asleep);
    cone(kit, "brow", "coat", at3(h, -0.2, x * 0.56, 0.5), at3(h, 0.58, x * 0.42, 0.4), h.r * 0.17, h.r * 0.1, 0.4);
  }
  // (Too small to shade the ground: only the skull casts a shadow.)
  for (let i = from + 1; i < kit.out.length; i += 1) { const part = kit.out[i]; if (part) kit.out[i] = { ...part, shadow: false }; }
}

function faceOf(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  if (actor.member.species === "cat") catFace(kit, actor, h, q, asleep);
  else if (buildOf(actor).extras.includes("shell")) shellFace(kit, h, q, asleep);
  else if (h.stations) outlinedFace(kit, actor, h, q, asleep);
  else roundFace(kit, actor, h, q, asleep);
}

/** A round head: a ball, its muzzle, jaw and nose, its eyes, marks and ears. */
function roundFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = buildOf(actor);
  const snout = b.snout * actor.member.size;
  ball(kit, "head", "coat", h.c, h.r);
  // The muzzle tapers from the face to the nose: to a point on a fox, hardly at all on a capybara.
  const root = at3(h, 0.35, 0, -0.1);
  const tip = madd(madd(at3(h, 0.35, 0, -0.12), h.d, snout + h.r * 0.15), h.u, h.r * (b.snoutUp ?? 0));
  const tipR = h.r * 0.5 * b.snoutTip;
  cone(kit, "snout", "coat", root, tip, h.r * 0.5, tipR);
  const jawRoot = at3(h, 0.3, 0, -0.32);
  const jawTip = madd(madd(jawRoot, h.d, snout * 0.95), h.u, -(snout + h.r) * q.mouth * 0.45);
  cone(kit, "jaw", "belly", jawRoot, jawTip, h.r * 0.36, Math.max(tipR * 0.7, h.r * 0.12));
  noseOf(kit, b, h, tip, tipR);
  const eyes = roundEyes(b);
  eyes.forEach((spot, i) => { eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, onFace(h, spot), h.r * 0.25, !asleep); });
  faceMarks(kit, actor, h, tip, eyes, h.r * 0.25 * (h.eye?.size ?? 1));
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  if (b.extras.includes("jowls")) for (const x of [-1, 1]) jowlOf(kit, h, x);
  earsOf(kit, b.ears, h, q.earBack, b.earLen, b.extras.includes("cheeks") || b.extras.includes("wet") ? "accent" : "coat", b.earBase);
}

/** A round head's nose on the end of its muzzle. */
function noseOf(kit: Kit, b: Build, h: Head, tip: Vec, tipR: number): void {
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", madd(tip, h.u, h.r * 0.2), madd(tip, h.u, -h.r * 0.12), h.r * 0.3, 0.7, h.d);
  else if (b.extras.includes("button")) {
    // (A broad rounded triangle, wide across the top, on the muzzle's blunt end, with a spark of wet light on it.)
    const top = add(tip, add(scale(h.d, tipR * 0.75), scale(h.u, tipR * 0.42)));
    cap(kit, "nose", "nose", top, madd(top, h.u, -h.r * 0.14), h.r * 0.21, 0.72, h.d, { r1: h.r * 0.085 });
    ball(kit, "nose.shine", "shine", add(top, add(scale(h.d, h.r * 0.09), add(scale(h.u, h.r * 0.12), scale(h.s, -h.r * 0.09)))), h.r * 0.024);
  } else if (b.extras.includes("wet")) {
    // (A small ball on the very end of a pointed muzzle, a spark of wet light high on it.)
    const end = madd(tip, h.d, tipR * 0.85);
    ball(kit, "nose", "nose", end, tipR * 0.68);
    ball(kit, "nose.shine", "shine", add(end, add(scale(h.d, tipR * 0.42), add(scale(h.u, tipR * 0.32), scale(h.s, -tipR * 0.22)))), tipR * 0.13);
  // (A pointed muzzle ends in its nose; a blunt one's, a tortoise's, stays in it.)
  } else ball(kit, "nose", "nose", madd(tip, h.d, b.snoutTip < 0.5 ? tipR * 0.8 : 0), Math.max(tipR * 0.6, h.r * 0.12));
}

/** A tuft of pale fur back from the cheek and out past the jaw to a soft point, which makes a broad head of a narrow muzzle from the front and breaks its outline from the side. */
function jowlOf(kit: Kit, h: Head, x: number): void {
  cap(kit, `jowl.${x < 0 ? "L" : "R"}`, "belly", at3(h, 0.4, x * 0.56, -0.36), at3(h, -0.38, x * 0.98, -0.56), h.r * 0.42, 1, UP, { r1: h.r * 0.17, melt: 1 });
}

/**
 * A face drawn from its species' outline: skull and muzzle lofted as one
 * surface, the jaw under the muzzle (it drops as the mouth opens), the nose
 * capping the muzzle's end and the eyes under the brow, just behind the stop.
 */
function outlinedFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const b = buildOf(actor);
  const stop = h.stop ?? 0.35;
  const tip = h.tip ?? 1;
  const sec = h.sec ?? ((): Section => ({ o: 0, h: 1, w: 1 }));
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  loft(kit, "head", "coat", h.stations ?? [], along, h.u, h.s, h.r, 1);
  const root = sec(stop);
  const end = sec(tip);
  const front = madd(along(tip), h.u, (end.o + end.h * 0.25) * h.r);
  const nose = madd(front, h.d, Math.max(end.h, end.w) * h.r * 0.8);
  if (b.extras.includes("bignose")) cap(kit, "nose", "nose", madd(nose, h.u, h.r * 0.2), madd(nose, h.u, -h.r * 0.12), h.r * 0.3, 0.7, h.d);
  else ball(kit, "nose", "nose", nose, Math.max(end.w * 0.45, 0.1) * h.r, 0.75, h.d);
  const jawRoot = madd(along(stop - 0.1), h.u, (root.o - root.h * 0.5) * h.r);
  const jawEnd = madd(along(tip), h.u, (end.o - end.h * 0.5) * h.r - (tip - stop) * h.r * q.mouth * 0.5);
  cone(kit, "jaw", "coat", jawRoot, jawEnd, root.h * 0.5 * h.r, end.h * 0.55 * h.r);
  const [ed, es, eu] = EYE_SET;
  const eyes = [-1, 1].map((x) => eyeSpot(stop + ed, x * es, eu));
  eyes.forEach((spot, i) => { outlinedEye(kit, `eye.${i === 0 ? "L" : "R"}`, h, spot, h.r * 0.22, !asleep); });
  faceMarks(kit, actor, h, nose, eyes, h.r * 0.22 * (h.eye?.size ?? 1));
  if (actor.member.horned && b.extras.includes("antlers")) antlersOf(kit, h, actor.member.size);
  earsOf(kit, b.ears, h, q.earBack, b.earLen, b.extras.includes("cheeks") ? "accent" : "coat", b.earBase);
}

/**
 * A cat's face: a round skull full in the cheek, a short wide muzzle of two
 * whisker pads over a neat chin, a small nose, the slanted eyes painted flat
 * into the skull and set forward, and broad ears on the corners of its head.
 * (Paint: the first decal to cover a point keeps it, so the eyes come before
 * the markings round them.)
 */
function catFace(kit: Kit, actor: Who, h: Head, q: Pose, asleep: boolean): void {
  const along = (k: number): Vec => madd(h.c, h.d, k * h.r);
  // (A point on the face: along the head, then out and up from its axis, in head radii.)
  const on: FaceAt = (d, s, u) => add(along(d), add(scale(h.s, s * h.r), scale(h.u, u * h.r)));
  // (The skull lies across the head, so it is round from the side and broad from the front; this is a point on its skin.)
  const skin: Skin = (s, u) => on(Math.sqrt(Math.max(0.88 ** 2 - Math.max(Math.abs(s) - 0.1, 0) ** 2 - u ** 2, 0.02)), s, u);
  cap(kit, "head.0", "coat", on(0, -0.1, 0), on(0, 0.1, 0), h.r * 0.88);
  // (The muzzle is one short wide pale roll across the face, parted down its middle into two whisker pads.)
  cap(kit, "pad", "belly", on(0.78, -0.2, -0.22), on(0.78, 0.2, -0.22), h.r * 0.42, 0.86, h.u);
  decal(kit, "mouth", "dark", on(1.26, 0, -0.1), on(1.16, 0, -0.4), h.r * 0.03);
  cone(kit, "jaw", "belly", on(0.6, 0, -0.5), on(0.96, 0, -0.5 - q.mouth * 0.3), h.r * 0.24, h.r * 0.2);
  cap(kit, "nose", "nose", on(1.17, 0, -0.05), on(1.15, 0, -0.11), h.r * 0.12, 0.6, h.d, { r1: h.r * 0.05 });
  for (const x of [-1, 1]) catEye(kit, h, skin(x * 0.54, 0.13), x, !asleep);
  const roles = coatFace(kit, actor, h, on, skin);
  for (const x of [-1, 1]) {
    catEar(kit, h, on, x, q.earBack, x < 0 ? roles[0] : roles[1]);
    // (Two fine pale whiskers from each pad, fanned a little and drooping to their tips.)
    cap(kit, "whisker", "shine", on(0.9, x * 0.5, -0.2), on(0.9, x * 0.5, -0.3), h.r * 0.012, 1, UP, { row: 2, reach: sub(on(0.4, x * 1.3, -0.25), on(0.9, x * 0.5, -0.25)), sharp: true, shadow: false });
  }
}

/** A point on the face: along the head, out and up from its axis, in head radii. */
type FaceAt = (d: number, s: number, u: number) => Vec;
/** A point on the skin of the skull, from where it lies across the face. */
type Skin = (s: number, u: number) => Vec;

/** Coats with a tabby's marks on the face as on the body. */
const TABBIES: ReadonlySet<string> = new Set(["tabby", "grey"]);

/** What a coat paints on the face round the eyes; it gives back each ear's colour. */
function coatFace(kit: Kit, actor: Who, h: Head, on: FaceAt, skin: Skin): readonly [Role, Role] {
  if (TABBIES.has(actor.member.coat)) tabbyFace(kit, h, on, skin);
  if (actor.member.coat !== "calico") return ["coat", "coat"];
  // (Whichever side the black falls on is the animal's own.)
  const x = ownPhase(actor) < 0.5 ? -1 : 1;
  const gene = createRandom(markOf(actor) ^ 0x3c6ef372);
  calicoPatch(kit, h, skin, x, "dark", gene);
  calicoPatch(kit, h, skin, -x, "alt", gene);
  return x < 0 ? ["dark", "alt"] : ["alt", "dark"];
}

/** A tabby's face: the dark M on the brow, two peaks over a dip between the eyes, and a line back from each eye's outer corner. */
function tabbyFace(kit: Kit, h: Head, on: FaceAt, skin: Skin): void {
  // (Each a thin blade, flat across its own line and deep into the head, so it meets the curve of the crown from end to end.)
  const line = (a: Vec, b: Vec, wide: number): void => {
    const n = unit(sub(lerpV(a, b, 0.5), h.c), h.d);
    cap(kit, "brow", "alt", a, b, h.r * 0.2, wide / 0.2, unit(cross(sub(b, a), n), h.s), { decal: true });
  };
  for (const x of [-1, 1]) {
    line(skin(x * 0.38, 0.44), skin(x * 0.24, 0.76), 0.06);
    line(skin(x * 0.24, 0.76), skin(0, 0.46), 0.06);
    line(skin(x * 0.8, 0.2), skin(x * 0.93, 0.1), 0.05);
  }
}

/** A calico's patch on one side of its face, from the ear down round the eye: the eye framed in it, the nose and the blaze left white. */
function calicoPatch(kit: Kit, h: Head, skin: Skin, x: number, role: Role, gene: () => number): void {
  decal(kit, "face", role, skin(x * mix(0.6, 0.8, gene()), mix(0.5, 0.72, gene())), skin(x * mix(0.44, 0.64, gene()), mix(-0.02, 0.2, gene())), h.r * mix(0.34, 0.56, gene()));
}

/** A cat's eye, painted flat into the skull: a dark almond tilted up to its outer corner, heavier along its upper lid, the iris in it, the slit tall and narrow down its middle, the one catch of light on the same side of both; shut, a dark line. */
function catEye(kit: Kit, h: Head, at: Vec, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const n = unit(add(h.d, add(scale(h.s, x * 0.8), scale(h.u, 0.2))));
  // (Across and up on the eye's own face, the outer corner lifted.)
  const tilted = madd(h.s, h.u, x * 0.3);
  const across = unit(madd(tilted, n, -dot(tilted, n)));
  if (!open) { cap(kit, part, "dark", madd(at, across, -h.r * 0.27), madd(at, across, h.r * 0.27), h.r * 0.045, 1, UP, { melt: 0.2 }); return; }
  // (The renderer paints the slit, iris, rim and spark on its lens, like any other eye.)
  eyeAt(kit, part, h, at, n, h.r * 0.2, true);
}

/** A cat's ear: a broad low triangle, a little rounded at its tip, on the corner of its head, held up however the head tilts, its pink inside turned forward so both show. */
function catEar(kit: Kit, h: Head, on: FaceAt, x: number, back: number, role: Role): void {
  const part = `ear.${x < 0 ? "L" : "R"}`;
  const root = on(-0.1, x * 0.6, 0.55);
  const dir = unit(add(add(lerpV(h.u, UP, 0.65), scale(h.s, x * 0.34)), scale(h.d, -(0.02 + back * 0.8))));
  const n = unit(madd(h.d, h.s, x * 0.5));
  const r = h.r * 0.5;
  cap(kit, part, role, root, madd(root, dir, h.r * 0.84), r, 0.56, n, { r1: h.r * 0.1, melt: 0.35 });
  const inner = madd(madd(root, n, r * 0.4), dir, h.r * 0.24);
  cap(kit, `${part}.in`, "accent", inner, madd(inner, dir, h.r * 0.5), r * 0.62, 0.46, n, { r1: h.r * 0.1, decal: true });
}

/** Where the eyes sit on an outlined head: just behind the stop, on the sides, under the brow. */
const EYE_SET = [-0.12, 0.62, 0.5] as const;

/**
 * A bandit's mask round one eye, found from the eye itself: one band from
 * near the bridge of the nose (where it meets its pair) back and a little
 * down over the cheek, with the eye at its middle, so the eye always sits in
 * its patch however the head is shaped.
 */
function maskBand(kit: Kit, h: Head, eye: FacePoint, eyeR: number): void {
  const x = Math.sign(eye[1]) || 1;
  const bridge = frontAt(x * 0.06, eye[2] + 0.02);
  // (In from the eye halfway to the bridge, and as far again out past it, a little down:
  // one band with the eye at its middle.)
  const [d, s, u] = eye;
  const inner: FacePoint = [(d + bridge[0]) / 2, (s + bridge[1]) / 2, (u + bridge[2]) / 2];
  const out = [2 * d - inner[0], 2 * s - inner[1], 2 * u - inner[2] - 0.12] as const;
  decal(kit, "mask", "dark", onFace(h, inner), onFace(h, toSkin(out)), eyeR * 1.6);
}

/**
 * A long oval of paint laid on the head at `at` and drawn out along `run` by
 * `reach`, narrowing from `r` to `r1` as it goes: `flat` is its width against
 * its length, and it stays as deep as it is long, so it meets the head's curve
 * from end to end.
 */
function facePatch(kit: Kit, part: string, role: Role, h: Head, at: Vec, run: Vec, reach: number, r: number, r1: number, flat: number, melt: number): void {
  const n = unit(sub(at, h.c), h.d);
  const along = unit(madd(run, n, -dot(run, n)), h.s);
  cap(kit, part, role, at, madd(at, along, reach), r, flat, cross(n, along), { decal: true, r1, melt });
}

/** A raccoon's mask round one eye: an oval from just short of the bridge, where it barely meets its pair, back and down past the eye, narrowing toward the jaw's corner. */
function banditMask(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  const run = sub(onFace(h, toSkin([d - 0.62, x * 0.92, u - 0.5])), onFace(h, frontAt(x * 0.06, u + 0.06)));
  facePatch(kit, "mask", "dark", h, onFace(h, eye), run, h.r * 0.5, band * 2.6, band * 1, 0.52, 1.1);
}

/** A pale brow over one eye's mask, found from the eye too: nearly level along the mask's top, out from over the eye, thin and fading at its outer end. */
function browMark(kit: Kit, h: Head, eye: FacePoint, band: number): void {
  const [d, s, u] = eye;
  const x = Math.sign(s) || 1;
  facePatch(kit, "brow", "accent", h, onFace(h, toSkin([d - 0.04, s * 0.74, u + 0.42])), scale(h.s, x), h.r * 0.24, band * 1.45, band * 0.6, 0.36, 1.1);
}

/**
 * A raccoon's face: the black mask, a white brow over it, a white muzzle
 * under it and a soft dark blaze down the nose between, broad on the forehead
 * and gone before the nose. (The first decal to cover a point keeps it, so the
 * black comes first and the white meets its edge clean.)
 */
function banditMarks(kit: Kit, h: Head, tip: Vec, eyes: readonly FacePoint[], eyeR: number): void {
  // (A small eye in a big patch: the band is sized to the head's mask, not to the eye.)
  const band = eyeR * 1.3;
  for (const eye of eyes) { banditMask(kit, h, eye, band); browMark(kit, h, eye, band); }
  const brow = frontAt(0, (eyes[0]?.[2] ?? 0) + 0.46);
  // (A blade, flat across the face and deep into it, so it meets the curve down the bridge from end to end.)
  cap(kit, "line", "alt", onFace(h, brow), add(tip, add(scale(h.u, h.r * 0.2), scale(h.d, -h.r * 0.14))), h.r * 0.56, 0.32, h.s, { decal: true, r1: h.r * 0.14, melt: 1.4 });
  decal(kit, "muzzle", "accent", at3(h, 0.3, 0, -0.5), tip, h.r * 0.7);
}

/** Face markings, set across the head's surface so they paint it from any side. */
function faceMarks(kit: Kit, actor: Who, h: Head, tip: Vec, eyes: readonly FacePoint[], eyeR: number): void {
  const b = buildOf(actor);
  const cheeks = b.extras.includes("cheeks");
  const mask = b.extras.includes("mask");
  if (b.extras.includes("brows")) { banditMarks(kit, h, tip, eyes, eyeR); return; }
  if (b.extras.includes("muzzle")) decal(kit, "muzzle", cheeks || actor.member.species === "marmot" ? "accent" : "belly", at3(h, 0.65, 0, -0.4), tip, h.r * 0.45);
  if (mask) { const wide = eyeR * mix(0.86, 1.2, createRandom(markOf(actor) ^ 0x6a09e667)()); for (const eye of eyes) maskBand(kit, h, eye, wide); }
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
const TAILS: Readonly<Record<Tail, { rise: number; curl: number; girth: number; n: number; profile: readonly number[]; root?: number }>> = {
  bushy: { rise: 0.1, curl: -0.12, girth: 0.6, n: 3, profile: [0.5, 0.95, 0.9, 0.4] },
  curl: { rise: 1.25, curl: 0.5, girth: 0.6, n: 4, profile: [0.55, 0.95, 1, 0.9, 0.55] },
  // (A thin tail falls from the rump and curves up toward its tip, a J, never a straight stick.)
  thin: { rise: 0.1, curl: 0.25, girth: 0.16, n: 4, profile: [1, 0.85, 0.7, 0.55, 0.4] },
  puff: { rise: 0.6, curl: 0, girth: 0.45, n: 1, profile: [1, 1] },
  ring: { rise: 0.35, curl: 0.05, girth: 0.45, n: 4, profile: [0.75, 1, 0.95, 0.85, 0.55] },
  // (A raccoon's: full and blunt, carried low; its bands are painted along its length, more of them than it has segments.)
  banded: { rise: 0.05, curl: -0.12, girth: 0.62, n: 3, profile: [0.72, 1.04, 1.06, 0.64], root: 1.7 },
  thick: { rise: -0.55, curl: 0.1, girth: 0.6, n: 3, profile: [1, 0.7, 0.45, 0.22] },
  fan: { rise: 0, curl: 0, girth: 0.4, n: 1, profile: [1, 1] },
  stub: { rise: 0, curl: 0, girth: 0.16, n: 0, profile: [0] },
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
  // (Nose down, a cat's tail eases into a low relaxed curve.)
  const held = Math.max(0, 1 - settled) * (1 - nosing(b, q) * 0.8);
  return (i) => {
    const [climb, sway] = b.tailLine?.[i] ?? [0, 0, 0];
    const wag = q.tailWag * 0.6 * Math.sin(t * 8 - i * 0.8) + 0.15 * Math.sin(t * 1.3 - i) + q.curl * 0.9 + wrap * (0.55 + i * 0.5) + sway * held;
    const rise = shape.rise + b.tailRise * (1 - settled) + q.tailUp * 0.9 + shape.curl * i + (i === shape.n - 1 ? hook : 0) - q.sit * 0.7 - q.lie * 0.4 - wrap * 0.6 + climb * held;
    return dirOf(Math.PI + wag, rise);
  };
}

/** Where a banded tail's dark rings lie, as shares of its length; the last is its tip. */
const TAIL_BANDS = [0.36, 0.51, 0.66, 0.81, 0.98] as const;

/** A banded tail's dark rings, each a flat disc a touch wider than the tail where it lies, so it paints an even band right round it; the last is its whole tip. */
function tailBands(kit: Kit, path: readonly Vec[], girth: number, profile: readonly number[], gene: () => number): void {
  TAIL_BANDS.forEach((rest, j) => {
    // (Each animal's rings fall a little differently; the tip stays a tip.)
    const k = j < TAIL_BANDS.length - 1 ? rest + mix(-0.04, 0.04, gene()) : rest;
    const i = Math.min(Math.floor(k * (path.length - 1)), path.length - 2);
    const f = k * (path.length - 1) - i;
    const at = lerpV(path[i] ?? UP, path[i + 1] ?? UP, f);
    const r = girth * mix(profile[i] ?? 1, profile[i + 1] ?? 1, f);
    const along = unit(sub(path[i + 1] ?? UP, path[i] ?? UP));
    cap(kit, `tail.ring.${j}`, "dark", at, at, r * (j < TAIL_BANDS.length - 1 ? 1.35 : 1.14), j < TAIL_BANDS.length - 1 ? 0.25 : 1, along, { decal: true, melt: 0.5 });
  });
}

/** A tail segment's share of the tail: an even one, unless the tail has a line of its own. */
const tailShare = (b: Build, i: number, n: number): number => b.tailLine?.[i]?.[2] ?? 1 / n;
/** How far a tail segment melts into the last: the first, into the rump. */
const tailMelt = (tail: Tail, i: number): number => (i === 0 ? TAILS[tail].root ?? 1 : 0.7);
/** A tabby's tail ends dark. */
const darkTipped = (who: Who): boolean => who.member.species === "cat" && TABBIES.has(who.member.coat);

function quadTail(kit: Kit, actor: Who, body: QuadBody, q: Pose, t: number): void {
  const b = buildOf(actor);
  const shape = TAILS[b.tail];
  // (A hedgehog's is a bare nub low on its rump, under the skirt.)
  if (b.tail === "stub") { const root = add(body.P, [0, -body.r * 0.25, -body.r * 0.5]); cone(kit, "tail", "accent", root, add(root, [0, -body.r * 0.22, -body.r * 0.2]), body.r * shape.girth, body.r * shape.girth * 0.6, 0.5); return; }
  if (shape.n === 0) return;
  const hu = body.r * b.haunch;
  let at = add(body.P, [0, hu * 0.35, -hu * 0.8]);
  if (b.tail === "puff") { ball(kit, "tail", "belly", add(body.P, [0, hu * 0.55, -hu * 0.88]), body.r * shape.girth * b.tailGirth); return; }
  const girth = body.r * shape.girth * b.tailGirth;
  const lay = tailLay(b, body, q, t);
  const path: Vec[] = [at];
  for (let i = 0; i < shape.n; i += 1) {
    const reach = madd(at, lay(i), b.tailLen * actor.member.size * tailShare(b, i, shape.n));
    const r0 = girth * (shape.profile[i] ?? 1);
    const r1 = girth * (shape.profile[i + 1] ?? 1);
    const next: Vec = [reach[0], Math.max(reach[1], r1 * 0.9), reach[2]];
    cap(kit, `tail.${i}`, i === shape.n - 1 && darkTipped(actor) ? "dark" : "coat", at, next, r0, 1, UP, { r1, melt: tailMelt(b.tail, i) });
    // (A ringed tail's dark bands are painted round it, crisp, one between each pair of pale ones.)
    if (b.tail === "ring") decal(kit, `tail.ring.${i}`, "dark", lerpV(at, next, 0.75), lerpV(at, next, 0.75), mix(r0, r1, 0.75) * 1.12);
    at = next;
    path.push(at);
  }
  if (b.tail === "banded") tailBands(kit, path, girth, shape.profile, createRandom(markOf(actor) ^ 0x1f83d9ab));
  // (A fox's brush ends in white; a mouse's or a meerkat's tail in dark.)
  if (b.tail === "bushy") decal(kit, "tail.tip", "accent", at, at, girth * 0.75);
}

function quadTrunk(kit: Kit, actor: Who, body: QuadBody): void {
  const { P, S, r } = body;
  const b = buildOf(actor);
  const extras = b.extras;
  const ch = r * b.chest;
  const hu = r * b.haunch;
  // (A tortoise is all shell: its trunk would only stand out of it.)
  if (extras.includes("shell")) { shellOf(kit, body); return; }
  if (b.torso) {
    // The species' own outline along the spine, however the spine lies (standing, sat up, lying).
    const f = unit(sub(S, P), [0, 0, 1]);
    const side: Vec = [1, 0, 0];
    loft(kit, "body", "coat", b.torso, (k) => lerpV(P, S, k), unit(cross(f, side), UP), side, r, 1);
  } else {
    // A chest set forward and low, a haunch over the hind legs, a waist between.
    cone(kit, "body", "coat", P, S, hu * 0.85, ch * 0.88);
    ball(kit, "haunch", "coat", add(P, [0, hu * 0.05, -hu * 0.1]), hu);
    ball(kit, "chest", "coat", add(S, [0, -ch * 0.12, ch * 0.08]), ch);
    if (extras.includes("hump")) ball(kit, "hump", "coat", add(S, [0, ch * 0.7, -ch * 0.35]), ch * 0.72);
  }
  if (extras.includes("pouch")) ball(kit, "pouch", "belly", add(lerpV(P, S, 0.45), [0, -r * 0.35, r * 0.25]), r * 0.75);
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
  // (A grizzled coat grows paler to its belly by itself.)
  if (!grizzled(actor)) decal(kit, "belly", "belly", add(P, [0, -hu * 0.8, 0]), add(S, [0, -ch * 0.85, 0]), r * 0.58);
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

/**
 * A tortoise's carapace, in body radii along its spine: a high dome, its top
 * just behind the middle of its length and falling more steeply to the tail
 * than to the neck. It is one smooth form: the plates are grown on it (see
 * `plateGrain`), and the shell's own grain stops it flat at its rim, where
 * its sides have come down to a near-upright wall, so it is a dome and never a ball.
 */
const CARAPACE: readonly Station[] = [[-0.03, 0.76, 0.76, 0.84], [0.4, 1.38, 1.38, 1.1], [0.72, 1.12, 1.12, 1], [1.1, 0.6, 0.6, 0.7]];
const shellHeart = (body: QuadBody): Vec => lerpV(body.P, body.S, 0.45);
/** The dome as a shell's grain takes it: half width, height and half length. */
const domeOf = (body: QuadBody): Vec => [body.r * 1.2, body.r * 1.38, body.L / 2 + body.r * 0.8];
function shellOf(kit: Kit, body: QuadBody): void {
  const { P, S, r } = body;
  loft(kit, "shell", "shell", CARAPACE, (k) => lerpV(P, S, k), UP, [1, 0, 0], r, 0.6);
  // (Under it the horn of its belly, up to the rim, the bridge showing as a pale band between the legs.)
  cap(kit, "shell.under", "horn", add(lerpV(P, S, 0.3), [0, -r * 0.22, 0]), add(lerpV(P, S, 0.74), [0, -r * 0.22, 0]), r * 0.84, 0.32);
  // (A short cone of a tail under the rim, tipped with horn.)
  const root = add(P, [0, -r * 0.28, -r * 0.6]);
  const tip = add(root, [0, -r * 0.26, -r * 0.3]);
  cap(kit, "tail", "coat", root, tip, r * 0.14, 1, UP, { r1: r * 0.06, melt: 0.3, shadow: false });
  cap(kit, "tail.tip", "horn", tip, add(tip, [0, -r * 0.03, -r * 0.08]), r * 0.065, 1, UP, { r1: r * 0.02, shadow: false });
}

/**
 * A hedgehog's mantle: a low oval dome of its second colour from the rump to
 * the brow, highest just behind the middle of its back, its edge a skirt that
 * comes down near the ground over its flanks and overhangs the head's rear
 * third, its peak run on down the forehead between the ears. The dome only
 * says where the spines stand; they are grown on it as its grain (see
 * `quillGrain`), so they keep to it and leave the face, the belly and the
 * feet soft.
 */
const MANTLE: readonly Station[] = [[0, 0.96, 0.7, 0.92], [0.37, 1.44, 0.7, 1.12], [1, 1.02, 0.7, 0.76], [1.8, 0.585, -0.185, 0.15]];
function mantleLine(body: QuadBody, k: number): Vec { return add(lerpV(body.P, body.S, k), [0, body.r * 0.12, 0]); }
function quillsOf(kit: Kit, body: QuadBody): void {
  // (Melting only a little, so its brim stands off the face and the flanks.)
  loft(kit, "quills", "alt", MANTLE, (k) => mantleLine(body, k), UP, [1, 0, 0], body.r, 0.2);
}

/** A hedgehog's skull drawn out into a broad blunt wedge down to the muzzle, which a round head alone never is, and the soft dark mask round its eyes and on down the bridge of its nose. */
function wedgeFace(kit: Kit, b: Build, h: Head): void {
  cone(kit, "wedge", "coat", at3(h, 0.1, 0, -0.08), at3(h, 0.95, 0, -0.14), h.r * 0.77, h.r * 0.44);
  const bridge = at3(h, 1.18, 0, 0.2);
  for (const eyeSpot of roundEyes(b)) cap(kit, "mask", "accent", madd(onFace(h, eyeSpot), h.d, -h.r * 0.12), bridge, h.r * 0.33, 1, UP, { decal: true, r1: h.r * 0.17, melt: 1.3 });
  cap(kit, "mask.bridge", "accent", bridge, at3(h, 1.55, 0, 0.08), h.r * 0.17, 1, UP, { decal: true, r1: h.r * 0.2, melt: 1.3 });
}

function poseQuad(kit: Kit, actor: Who, m: Moment): void {
  const q = m.pose;
  const body = quadSpine(actor, q, m);
  const head = quadNeck(kit, actor, body, q, m);
  const lines: LegLine[] = [];
  for (const leg of LEG) quadLeg(kit, actor, body, leg, quadFoot(actor, body, leg, q, m, head.c), lines);
  quadTrunk(kit, actor, body);
  faceOf(kit, actor, head, q, m.segment.act === "sleep");
  if (buildOf(actor).extras.includes("quills")) wedgeFace(kit, buildOf(actor), head);
  quadTail(kit, actor, body, q, m.t);
  legFinish(kit, actor, lines, m);
}

// ---------------------------------------------------------------- primates

interface PrimateBody { readonly hips: Vec; readonly chest: Vec; readonly tdir: Vec; readonly r: number; readonly w: number; readonly arm: number; readonly leg: number; readonly climbing: boolean }

function primateSpine(who: Who, m: Moment): PrimateBody {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const r = b.body * size;
  const leg = b.leg * size;
  const arm = leg * armShare(who);
  const climbing = m.mode === "climb" && Math.abs(m.frame.y[1]) < 0.6;
  // (A monkey stands on all fours, as it walks: upright only to sit, reach, eat or hang.)
  const walking = !climbing && (m.moving > 0.05 || onFours(who, q));
  const stance = primateStance(who, m, climbing, walking);
  const hipY = mix(stance.hipY, r * 0.9, q.sit);
  const lean = mix(stance.lean, stance.sat, q.sit) + q.reach * 0.25;
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

/** How it carries itself before it sits, and how far it leans sitting. */
function primateStance(who: Who, m: Moment, climbing: boolean, walking: boolean): { hipY: number; lean: number; sat: number } {
  const b = who.spec.build;
  const r = b.body * who.member.size;
  const leg = b.leg * who.member.size;
  if (!climbing && macaqueKind(who)) { const own = macaqueCarriage(settled(who, m), leg, r); return { ...own, sat: own.lean }; }
  // (A sloth at rest sits low on its rump, curled a little forward round its middle.)
  if (!climbing && !walking && b.extras.includes("claws")) return { hipY: r * 1.1, lean: 0.26, sat: 0.12 };
  return { ...primateCarriage(climbing, walking, m.moving > 0.05, leg, r), sat: 0.12 };
}

/** The two that go on all fours and sit down to use their hands, a snow monkey and a long-tailed one. */
const macaqueKind = (who: Who): boolean => who.member.species === "macaque" || who.member.species === "monkey" || who.member.species === "loris";

/** An arm's length against the leg: a snow monkey's a little the shorter, a long-tailed one's nearly as long, a sloth's over twice as long. */
function armShare(who: Who): number {
  if (macaqueKind(who)) return who.member.species === "macaque" ? 0.86 : 0.97;
  return who.spec.build.extras.includes("claws") ? 2.2 : 1.15;
}

/** How high its hips ride and how far its body leans from upright: climbing, on all fours (a little higher at rest than walking) or sitting up. */
function primateCarriage(climbing: boolean, fours: boolean, moving: boolean, leg: number, r: number): { hipY: number; lean: number } {
  if (climbing) return { hipY: r * 1.4, lean: 1.45 };
  if (fours) return { hipY: leg * 0.8, lean: moving ? 1.15 : 1.0 };
  return { hipY: leg * 0.85, lean: 0.2 };
}

/** Standing about on all fours: a monkey (not a sloth or a loris, which only climb and hang) doing nothing with its hands. */
const onFours = (who: Who, q: Pose): boolean => (who.spec.build.tail !== "none" || who.member.species === "loris") && q.sit < 0.3 && q.hang <= 0 && q.reach < 0.3 && q.hand < 0.3 && q.scratch <= 0;

/** A hand down on what it walks on: a sloth's reaching wide and far ahead, on arms too long to do otherwise, hooked round the trunk when it climbs. */
function handDown(who: Who, body: PrimateBody, x: number, step: { z: number; y: number }): Vec {
  const { chest, w, arm, r } = body;
  if (!who.spec.build.extras.includes("claws")) return [x * w, step.y, chest[2] + arm * 0.25 + step.z];
  return body.climbing ? [x * w * 1.35, step.y + r * 0.1, chest[2] + arm * 0.62 + step.z] : [x * w * 1.8, step.y + r * 0.7, chest[2] + arm * 0.46 + step.z];
}

/** A sloth's hands at rest: raised in front of its chest and hooked, as if round a branch it has only just let go of. */
const slothRest = (body: PrimateBody, x: number): Vec => add(body.chest, [x * body.w * (x < 0 ? 1.7 : 1.45), body.r * (x < 0 ? -0.55 : -1.3), body.arm * (x < 0 ? 0.56 : 0.5)]);

/** Its hand as it sits: out by its foot, or a macaque's on its raised knee. */
function sitHand(who: Who, body: PrimateBody, x: number): Vec {
  const { w, r, arm } = body;
  return macaqueKind(who) ? [x * w * 1.02, r * 1.42, arm * 0.78] : [x * w * 1.3, r * 0.4, arm * 0.45];
}

/** A macaque grooming: one arm held out across its knee, away from its side, the other hand picking through the hair of it. */
function groomHand(body: PrimateBody, x: number, t: number): Vec {
  const { w, r, arm } = body;
  if (x > 0) return [w * 1.56, r * 1.8, arm * 0.86];
  return [w * 0.9 + r * 0.16 * Math.sin(t * 3), r * 2.24 + r * 0.1 * Math.sin(t * 7), arm * 0.84 + r * 0.14 * Math.sin(t * 2)];
}

/** Where a primate's hand is this moment. */
const primateHand = (who: Who, body: PrimateBody, x: number, m: Moment, head: Vec): Vec => (macaqueKind(who) && m.segment.act === "groom" ? groomHand(body, x, m.t) : handOf(who, body, x, m, head));

function handOf(who: Who, body: PrimateBody, x: number, m: Moment, head: Vec): Vec {
  const q = m.pose;
  const { chest, w, arm, r } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step = walking ? footCycle(m.phase - (x < 0 ? 0 : 0.5), 0.6, 0.6 * bodyStride(who), arm * 0.25) : { z: 0, y: 0 };
  let hand: Vec = walking ? handDown(who, body, x, step) : who.spec.build.extras.includes("claws") ? slothRest(body, x) : add(chest, [x * w * 1.2, -arm * 0.85, arm * 0.2]);
  hand = lerpV(hand, sitHand(who, body, x), q.sit);
  hand = lerpV(hand, add(chest, [x * w * 0.5, -r * 0.2 + 0.03 * Math.sin(m.t * 5 + x), arm * 0.75]), q.reach * (x > 0 ? 1 : 0.6));
  if (x > 0) hand = lerpV(hand, add(head, [w * 0.25, -r * 0.5, r * 0.55]), q.hand * (1 - q.scratch));
  if (x > 0 && q.scratch > 0) hand = lerpV(hand, add(head, [w * 1.1, r * 0.3 * Math.sin(m.t * 22), -r * 0.3]), q.scratch);
  return q.hang > 0 ? lerpV(hand, gripOf(who, body, x, m.t), q.hang) : hand;
}

/** Where a hanging animal's hands hold the branch: a sloth both hands up, a monkey by one, the other swinging free. */
function gripOf(who: Who, body: PrimateBody, x: number, t: number): Vec {
  const { w, arm } = body;
  if (who.spec.build.extras.includes("claws")) return [x * w * 1.1, 0, w * 0.4];
  // (A macaque's short arm goes up past its ear, not through its head.)
  if (x > 0) return macaqueKind(who) ? [w * 1.1, 0, 0] : [0, 0, 0];
  return [-w, -arm * 0.6 + 0.1 * Math.sin(t), arm * 0.4];
}

function primateFoot(who: Who, body: PrimateBody, x: number, m: Moment): Vec {
  const q = m.pose;
  const { hips, w, leg } = body;
  const walking = m.moving > 0.05 || body.climbing || onFours(who, q);
  const step = walking && m.moving > 0.05 ? footCycle(m.phase - (x < 0 ? 0.5 : 0), 0.6, 0.6 * bodyStride(who), leg * 0.25) : { z: 0, y: 0 };
  let foot: Vec = [x * w * 0.8, step.y, hips[2] - leg * 0.1 + step.z];
  foot = macaqueKind(who) ? lerpV(foot, [x * w * 1.2, 0, leg * 0.5], settled(who, m)) : lerpV(foot, [x * w * 1.4, 0, leg * 0.75], q.sit);
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
  const h: Head = { c: head, d: hd, ...headAxes(hd, q.headRoll), r: hr, ...eyeOfSpecies(who) };
  ball(kit, "head", "coat", head, hr);
  // (A flat face set into the fur, not a ball stuck on the front.)
  cap(kit, "face", "accent", at3(h, 0.56, 0, -0.08), at3(h, 0.56, 0, -0.08), hr * 0.68, 0.45, hd, { melt: 0.2 });
  const eyes = [-1, 1].map((x) => onFace(h, [0.95, x * 0.34, 0.14]));
  eyes.forEach((at, i) => { eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, at, hr * 0.17, m.segment.act !== "sleep"); });
  // (Through both eyes, so each sits in its patch.)
  if (b.extras.includes("mask")) decal(kit, "mask", "dark", eyes[0] ?? head, eyes[1] ?? head, hr * 0.17 * (h.eye?.size ?? 1) * 1.7);
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
  if (who.member.species === "sloth") { poseSloth(kit, who, m); return; }
  if (who.member.species === "macaque") { poseMacaque(kit, who, m); return; }
  if (who.member.species === "monkey") { poseMonkey(kit, who, m); return; }
  if (who.member.species === "loris") { poseLoris(kit, who, m); return; }
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

// ---------------------------------------------------------------- sloths

/** The way down a body's back from its spine, whatever it is leaning. */
const spineBack = (tdir: Vec): Vec => unit(cross(tdir, [1, 0, 0]), [0, 0, -1]);

/**
 * A sloth's body: small and lean under its coat, fuller low down, narrowing
 * up into a thin neck, its skirt of fur running on past the hips so its
 * thighs are lost in it.
 */
const SLOTH_BODY: readonly Station[] = [[-0.14, 0.8, 0.9, 0.94], [0.42, 1, 1.2, 1.12], [0.94, 0.86, 0.92, 0.9], [1.2, 0.48, 0.54, 0.54]];

/** Along a sloth's spine, in a soft C: its back rounded out and its chest let in. */
const slothSpine = (body: PrimateBody, k: number): Vec => madd(lerpV(body.hips, body.chest, k), spineBack(body.tdir), Math.sin(Math.PI * clamp(k, 0, 1)) * body.r * 0.3);

function slothTorso(kit: Kit, body: PrimateBody): void {
  const { tdir, r } = body;
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", SLOTH_BODY, (k) => slothSpine(body, k), back, [1, 0, 0], r, 1);
  // (Algae in the hair over the back and shoulders, soft at its edge and mottled over by the coat's pattern; the belly's shade is painted by the melt alone, so it has no edge.)
  cap(kit, "moss", "belly", madd(slothSpine(body, 0.3), back, r * 0.3), madd(slothSpine(body, 1.1), back, r * 0.3), r * 1.05, 1, UP, { decal: true, under: true, melt: 2 });
  cone(kit, "under", "alt", madd(slothSpine(body, -0.1), back, -r * 0.76), madd(slothSpine(body, 0.85), back, -r * 0.56), r * 0.5, r * 0.4);
}

/** A claw's two parts, as the arc from root to tip (in radians turned): horn, then a dark tip, thinning from `thick` to `end` of its root. */
const CLAW: readonly (readonly [from: number, to: number, role: Role, thick: number, end: number])[] = [[0, 1.45, "horn", 1, 0.62], [1.45, 2.05, "dark", 0.62, 0.1]];

/** One part of a claw, along the arc from `root` of radius `bend` out along `along` and round toward `curl`, from turn `from` to turn `to`. */
function sickle(kit: Kit, part: string, role: Role, root: Vec, along: Vec, curl: Vec, bend: number, from: number, to: number, r: number, r1: number): void {
  const on = (a: number): Vec => madd(madd(root, along, Math.sin(a) * bend), curl, (1 - Math.cos(a)) * bend);
  const a = on(from);
  const b = on(to);
  cap(kit, `${part}.claw`, role, a, b, r, 1, UP, { r1, melt: 0, bow: sub(on((from + to) / 2), lerpV(a, b, 0.5)) });
}

/**
 * Three long claws curving off a hand: out along `along` and round toward
 * `palm`, one even sickle each. A sloth does not grip, it hangs on these.
 */
function hookClaws(kit: Kit, part: string, at: Vec, along: Vec, palm: Vec, width: number, len: number, r: number): void {
  const curl = unit(madd(palm, along, -dot(palm, along)), [0, 0, -1]);
  const across = cross(along, curl);
  for (const i of [-1, 0, 1]) {
    for (const [from, to, role, thick, end] of CLAW) sickle(kit, part, role, madd(at, across, i * width), along, curl, len / 2, from, to, r * thick, r * end);
  }
}

/** Which way hair hangs off a limb along `along`: down, or down the trunk when it climbs, square to the limb. */
function hangOff(body: PrimateBody, along: Vec): Vec {
  const fall: Vec = body.climbing ? [0, 0, -1] : [0, -1, 0];
  return unit(madd(fall, along, -dot(fall, along)), [0, -0.5, -0.5]);
}

/** A long thin arm, shaggy to a small fur mitten, with a soft bend at the elbow and hair hanging under the forearm. */
function slothArm(kit: Kit, x: number, body: PrimateBody, target: Vec, m: Moment): void {
  const { chest, tdir, w, r, arm } = body;
  const side = x < 0 ? "L" : "R";
  const root = madd(add(chest, [x * w * 0.86, 0, 0]), tdir, -r * 0.28);
  // (Elbows out and down at rest, and down when a hand comes to its mouth; out from the trunk as it climbs.)
  const pole = lerpV(m.mode === null ? [x * 0.8, -0.8, -0.15] : [x * 0.9, body.climbing ? 0.2 : -0.2, -0.45], [x * 0.7, -1, -0.3], m.pose.hand);
  const { mid, end } = solveTwoBone(root, target, arm * 0.5, arm * 0.5, pole);
  cone(kit, `arm.${side}.upper`, "coat", root, mid, r * 0.4, r * 0.3, 0.6);
  cone(kit, `arm.${side}.lower`, "coat", mid, end, r * 0.34, r * 0.18, 0.5);
  const along = unit(sub(end, mid));
  const off = hangOff(body, along);
  cap(kit, `arm.${side}.fringe`, "coat", madd(mid, off, r * 0.22), madd(lerpV(mid, end, 0.7), off, r * 0.14), r * 0.2, 0.6, cross(along, off), { r1: r * 0.06, melt: 0.5 });
  const heel = madd(end, along, r * 0.26);
  cone(kit, `arm.${side}.mitten`, "coat", end, heel, r * 0.2, r * 0.2, 0.5);
  const down = m.mode === null ? 0 : 1;
  const palm = lerpV(lerpV([-x * 0.9, -0.5, 0], [0, -1, -0.2], down), [0, -0.2, 1], m.pose.hang);
  hookClaws(kit, `arm.${side}`, heel, along, palm, r * 0.16, r * 1.7, r * 0.075);
}

/** Where a sloth's foot goes: out past its skirt as it sits, gripping the trunk below its hips as it climbs. */
function slothFoot(body: PrimateBody, target: Vec, q: Pose): Vec {
  const { r, leg } = body;
  if (body.climbing) return [target[0] * 1.5, r * 0.1, target[2] - leg * 0.1];
  const out = (1 - q.hang) * (1 - q.sit);
  return [target[0] * (1 + 0.8 * out), target[1] + r * 0.3 * (1 - q.hang), target[2] + leg * 0.62 * out];
}

/** A short leg lost in the coat as far as its foot, with two hooks. */
function slothLeg(kit: Kit, x: number, body: PrimateBody, target: Vec, q: Pose): void {
  const { hips, tdir, w, r } = body;
  const side = x < 0 ? "L" : "R";
  const root = madd(add(hips, [x * w * 0.62, 0, 0]), tdir, r * 0.1);
  const foot = slothFoot(body, target, q);
  const along = unit(sub(foot, root));
  cone(kit, `leg.${side}.upper`, "coat", root, foot, r * 0.56, r * 0.26, 1);
  const curl = unit(madd(body.climbing ? [0, -1, 0] : [0, -1, -0.2], along, -dot([0, -1, -0.2], along)), [0, -1, 0]);
  // (Two will do, the same hooks as the hands'.)
  for (const i of [-1, 1]) sickle(kit, `leg.${side}`, "horn", madd(foot, cross(along, curl), i * r * 0.1), along, curl, r * 0.56, 0, 1.8, r * 0.09, r * 0.012);
}

/**
 * A sloth's face: a wide pale mask wrapped round the head to the temples,
 * its edge as broken as the fur it lies in, about a blunt muzzle; each small
 * eye in a dark stripe running back and down across the cheek, a tiny nose
 * and a curved line under it that makes it look as if it is smiling.
 * Everything is found from the eyes, so the stripes never drift off them.
 */
function slothFace(kit: Kit, h: Head, m: Moment): void {
  const eyeR = h.r * 0.15;
  const spots = [-1, 1].map((x) => frontAt(x * 0.5, 0.14));
  spots.forEach((spot, i) => {
    const x = i === 0 ? -1 : 1;
    const run = sub(onFace(h, toSkin([-0.2, x * 0.8, spot[2] - 0.72])), onFace(h, spot));
    facePatch(kit, "mask", "pupil", h, onFace(h, frontAt(x * 0.4, spot[2] + 0.03)), run, h.r * 1.02, eyeR * 1.4, eyeR * 0.4, 0.66, 0.4);
  });
  // (A pale lip laid over a dark bar a little below it, which leaves a crescent: the first paint keeps a point.)
  const open = m.pose.mouth * 0.14;
  for (const [part, role, u] of [["lip", "accent", -0.34], ["smile", "dark", -0.4 - open]] as const) {
    cap(kit, part, role, at3(h, 1.08, -0.16, u), at3(h, 1.08, 0.16, u), h.r * 0.17, 1, UP, { decal: true, melt: 0.2 });
  }
  cap(kit, "face", "accent", at3(h, 0.42, -0.42, -0.06), at3(h, 0.42, 0.42, -0.06), h.r * 0.66, 1, UP, { decal: true, melt: 1.5 });
  cap(kit, "muzzle", "accent", at3(h, 0.76, 0, -0.26), at3(h, 0.76, 0, -0.26), h.r * 0.5, 0.74, h.d, { melt: 0.6 });
  cap(kit, "nose", "nose", at3(h, 1.14, -0.04, -0.2), at3(h, 1.14, 0.04, -0.2), h.r * 0.075, 0.7, h.d);
  spots.forEach((spot, i) => { eyeOf(kit, `eye.${i === 0 ? "L" : "R"}`, h, onFace(h, spot), eyeR, m.segment.act !== "sleep"); });
}

/** Where a sloth's head sits: out ahead of its shoulders on a thin neck, so head and muzzle clear the outline from the side, the throat dark under them. */
const slothPoll = (body: PrimateBody): Vec => madd(madd(body.chest, body.tdir, body.r * 1.3), spineBack(body.tdir), -body.r * (body.climbing ? 0.2 : 1.05));

function slothHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const q = m.pose;
  const size = who.member.size;
  const { chest, tdir, r } = body;
  const hr = who.spec.build.head * size * CHARM;
  const look = q.hang > 0.5 ? 0 : body.climbing ? 0.9 : m.moving > 0.05 ? 0.5 : 0;
  // (It can turn its head right round: on a trunk it looks out over its shoulder.)
  const hd = body.climbing ? unit([0.7, 0.72, 0.1]) : dirOf(q.headYaw * 0.8, -0.05 + q.headPitch * 0.6 + look * 0.7);
  const fore = scale(spineBack(tdir), -1);
  const c = slothPoll(body);
  const hs = unit(cross(tdir, hd), [1, 0, 0]);
  const axes = body.climbing ? { s: hs, u: cross(hd, hs) } : headAxes(hd, q.headRoll);
  const h: Head = { c, d: hd, ...axes, r: hr, ...eyeOfSpecies(who) };
  slothFace(kit, h, m);
  cap(kit, "head", "coat", c, c, hr, 1, UP, { melt: 0.45 });
  // (Out of sight just under the face: the fur lies short round a crisp part, so the mask stays smooth and the crown shaggy.)
  cap(kit, "plate", "accent", at3(h, 0.38, 0, 0), at3(h, 0.38, 0, 0), hr * 0.6, 1, UP, { melt: 0, shadow: false });
  cone(kit, "neck", "alt", madd(madd(chest, tdir, r * 0.5), fore, r * 0.4), madd(c, tdir, -hr * 0.55), r * 0.54, r * 0.5, 0.7);
  return c;
}

/** Where a sloth's coat falls from: a whorl on the crown of its head, so it runs back off the skull and down its flanks and arms. */
function slothCrown(who: Who, m: Moment): Vec {
  const body = primateSpine(who, m);
  const up = who.spec.build.head * who.member.size * CHARM;
  return toWorld(m.frame, madd(madd(slothPoll(body), body.tdir, up * 0.8), spineBack(body.tdir), up * 0.5));
}

function poseSloth(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const head = slothHead(kit, who, body, m);
  slothTorso(kit, body);
  for (const x of [-1, 1]) {
    slothArm(kit, x, body, primateHand(who, body, x, m, head), m);
    slothLeg(kit, x, body, primateFoot(who, body, x, m), m.pose);
  }
}

// ---------------------------------------------------------------- macaques

/**
 * A macaque's trunk under its winter coat: haunches, a waist tucked in under
 * the loin, and the deep chest and shoulders its mantle hangs from, for the
 * coat to make more of them and never to average them out.
 */
const MACAQUE_BODY: readonly Station[] = [[-0.24, 0.84, 0.82, 0.86], [0.2, 1, 0.98, 1.02], [0.56, 0.84, 0.6, 0.78], [0.98, 1.06, 1.02, 1.04], [1.3, 0.6, 0.5, 0.66]];

/** How far it has settled onto its rump: it sits to do anything with its hands, and gets up again only to walk. */
function settled(who: Who, m: Moment): number {
  const q = m.pose;
  if (q.hang > 0 || m.mode === "climb") return 0;
  return clamp(Math.max(q.sit, q.reach, q.hand, q.scratch) / 0.3, 0, 1) * (1 - clamp(m.moving * 5, 0, 1));
}

/** From all fours, its back near level and its rump a little the higher, down onto its haunches with its back bowed over. */
const macaqueCarriage = (down: number, leg: number, r: number): { hipY: number; lean: number } => ({ hipY: mix(leg * 0.8, r * 0.92, down), lean: mix(1.46, 0.5, down) });

/** Along a macaque's spine, bowed out over the shoulders. */
const macaqueSpine = (body: PrimateBody, k: number): Vec => madd(lerpV(body.hips, body.chest, k), spineBack(body.tdir), bump(k * 0.86) * body.r * 0.3);

/** Where its head sits: carried out ahead of its shoulders in line with its back on all fours, down on its chest when it sits. */
const macaquePoll = (body: PrimateBody, hr: number): Vec => madd(madd(body.chest, body.tdir, body.r * 1.25 + hr * 0.75), spineBack(body.tdir), -body.r * mix(-0.7, 0.42, clamp(body.tdir[1], 0, 1)));

/** The radius of its head. */
const macaqueHeadR = (who: Who): number => who.spec.build.head * who.member.size * CHARM;

/** Its head, posed. (On so little neck it turns only part way.) */
function macaqueHeadOf(who: Who, body: PrimateBody, m: Moment): Head {
  const q = m.pose;
  const look = q.hang > 0.5 ? 0 : body.climbing ? 0.9 : m.moving > 0.05 || onFours(who, q) ? 0.2 : 0;
  // (Grooming it looks down to its own arm, not away over its shoulder as a cat looks to its flank.)
  const hd = dirOf(body.climbing ? 0.8 : q.headYaw * (m.segment.act === "groom" ? -0.34 : 0.5), -0.08 + q.headPitch * 0.6 + look * 0.5);
  return { c: macaquePoll(body, macaqueHeadR(who)), d: hd, ...headAxes(hd, q.headRoll), r: macaqueHeadR(who), ...eyeOfSpecies(who) };
}

function macaqueTorso(kit: Kit, body: PrimateBody): void {
  const { hips, tdir, r } = body;
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", MACAQUE_BODY, (k) => macaqueSpine(body, k), back, [1, 0, 0], r, 1);
  // (A small soft callus right under its tail, the coat thinning out to it.)
  const seat = madd(madd(hips, tdir, -r * 1.3), back, -r * 0.16);
  cap(kit, "seat", "accent", add(seat, [-r * 0.17, 0, 0]), add(seat, [r * 0.17, 0, 0]), r * 0.2, 0.6, tdir, { melt: 0.3 });
}

/** A short round stump of a tail, set high on the rump and carried out a little down. */
function macaqueTail(kit: Kit, who: Who, body: PrimateBody): void {
  const { hips, tdir, r } = body;
  const root = madd(madd(hips, tdir, -r * 1.1), spineBack(tdir), r * 0.4);
  const tip = madd(root, unit(add(scale(tdir, -0.9), [0, -0.3, -0.2])), who.spec.build.tailLen * who.member.size);
  cap(kit, "tail", "coat", root, [tip[0], Math.max(tip[1], r * 0.2), tip[2]], r * 0.27, 1, UP, { r1: r * 0.23, melt: 0.5 });
}

/** A bare hand or foot: a short palm or sole along `along`, four long spread fingers or toes off its end and a thumb or big toe set back along its side, standing away. */
function macaquePaw(kit: Kit, part: string, at: Vec, along: Vec, flat: Vec, r: number, long: number, x: number, skin: Role = "alt"): void {
  const tip = madd(at, along, long * 0.62);
  const across = cross(flat, along);
  cap(kit, `${part}.paw`, skin, madd(at, along, -r * 0.4), tip, r * 0.66, 0.5, flat, { r1: r * 0.8, melt: 0.4 });
  cap(kit, `${part}.digits`, skin, madd(tip, across, -r * 0.88), madd(tip, across, r * 0.88), r * 0.17, 1, UP, { row: 4, reach: scale(along, r * 2), melt: 0.22, shadow: false });
  const heel = madd(madd(at, along, long * 0.2), across, -x * r * 0.6);
  cap(kit, `${part}.thumb`, skin, heel, madd(madd(heel, along, r * 1.1), across, -x * r * 1.3), r * 0.22, 1, UP, { r1: r * 0.15, melt: 0.2, shadow: false });
}

/** An arm or a leg, slimmer than its hair makes it, its elbow or heel showing: from `root` to `target`, bending toward `pole`, down to a bare paw. */
function macaqueLimb(kit: Kit, part: string, root: Vec, target: Vec, length: number, r: number, pole: Vec, long: number, x: number): void {
  const sole = r * 0.3;
  const { mid, end } = solveTwoBone(root, [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]], length / 2, length / 2, pole);
  cone(kit, `${part}.upper`, "coat", root, mid, r, r * 0.62, 0.8);
  cone(kit, `${part}.lower`, "coat", mid, end, r * 0.64, r * 0.36, 0.6);
  // (Flat on what it stands on; held out along the limb when it lifts.)
  const up = clamp(Math.abs(target[1]) / (r * 1.5), 0, 1);
  const flat = unit(sub(end, mid));
  const along = unit(lerpV([0, 0, 1], flat, up));
  macaquePaw(kit, part, end, along, unit(lerpV(UP, [0, 0, 1], up)), r * 0.42, r * long, x);
}

/** The skin's raised parts: a brow standing out in an arch over each eye, and a short box of a muzzle, its flat front low on the face, lip over chin. */
function macaqueSkin(kit: Kit, h: Head, gap: number): void {
  const { r } = h;
  for (const x of [-1, 1]) cap(kit, "brow", "accent", at3(h, 0.9, x * 0.03, 0.24), at3(h, 0.74, x * 0.5, 0.12), r * 0.1, 1, UP, { bow: add(scale(h.u, r * 0.1), scale(h.d, r * 0.03)), melt: 0.4 });
  cap(kit, "lip", "accent", at3(h, 0.96, -0.23, -0.2), at3(h, 0.96, 0.23, -0.2), r * 0.22, 0.56, h.d, { melt: 0.5 });
  const chin = madd(at3(h, 0.9, 0, -0.45), h.u, -gap);
  cap(kit, "chin", "accent", madd(chin, h.s, -r * 0.2), madd(chin, h.s, r * 0.2), r * 0.15, 0.62, h.d, { melt: 0.8 });
}

/** Its bare skin, over no more than its eyes and muzzle: the coat thins out to it on every side. */
function macaqueMask(kit: Kit, h: Head): void {
  const { r } = h;
  cap(kit, "mask", "accent", at3(h, 0.74, -0.3, 0.08), at3(h, 0.74, 0.3, 0.08), r * 0.36, 1, UP, { decal: true, bare: true });
  cap(kit, "mask", "accent", at3(h, 0.86, 0, -0.16), at3(h, 0.86, 0, -0.5), r * 0.44, 1, UP, { decal: true, bare: true });
}

/** An eye, or shut, its bare lens alone for the renderer to draw its lid down over. */
function macaqueEye(kit: Kit, h: Head, x: number, open: boolean): void {
  const at = onFace(h, frontAt(x * 0.24, 0.06));
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const n = unit(sub(at, h.c));
  if (open) eyeOf(kit, part, h, at, h.r * 0.105, true);
  else cap(kit, part, "eye", madd(madd(h.c, n, h.r * 0.9), h.s, -h.r * 0.03), madd(madd(h.c, n, h.r * 0.9), h.s, h.r * 0.03), h.r * 0.1, 0.8, n);
}

/** Its face: close-set eyes hooded under the brow, slit nostrils close together on a flat nose, a thin straight mouth. */
function macaqueFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  const open = m.pose.mouth;
  const gap = r * open * 0.36;
  macaqueSkin(kit, h, gap);
  macaqueMask(kit, h);
  // (A thin sheet through the muzzle, so the surface finds it wherever it lies; opening, a dark gape.)
  const u = -0.4 - (open * 0.26);
  cap(kit, "mouth", "dark", at3(h, 1.14, -0.2, u), at3(h, 1.14, 0.2, u), r * 0.2 + r * 0.14 * open, mix(0.09, 0.9, open), h.u, { decal: true, melt: 0.2 });
  // (The fold under the brow.)
  cap(kit, "socket", "accent", at3(h, 0.98, -0.34, 0.1), at3(h, 0.98, 0.34, 0.1), r * 0.12, 0.7, h.u, { carve: true, melt: 0.5 });
  cap(kit, "nostril", "dark", at3(h, 0.7, -0.07, -0.04), at3(h, 0.7, 0.07, -0.04), r * 0.04, 1, UP, { row: 2, reach: scale(h.d, r * 0.7), decal: true, melt: 0.3 });
  for (const x of [-1, 1]) macaqueEye(kit, h, x, m.segment.act !== "sleep");
}

/** A small thin ear, high on the side of its head, half tucked into the hair, its hollow turned forward. */
function macaqueEars(kit: Kit, h: Head, high = 0.42, size = 0.17): void {
  for (const x of [-1, 1]) {
    const part = `ear.${x < 0 ? "L" : "R"}`;
    const at = at3(h, -0.1, x * 0.92, high);
    const face = unit(add(scale(h.s, x), scale(h.d, 0.7)));
    cap(kit, part, "shell", at, at, h.r * size, 0.26, face, { melt: 0.2 });
    const hollow = madd(at, face, h.r * size * 0.6);
    cap(kit, `${part}.in`, "shell", hollow, hollow, h.r * size * 0.65, 0.7, face, { carve: true, melt: 0.3 });
  }
}

function macaqueHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const { chest, tdir, r } = body;
  const h = macaqueHeadOf(who, body, m);
  const { c, r: hr } = h;
  macaqueFace(kit, h, m);
  // (A low skull behind the face, flat on top; its coat makes the ruff of its cheeks.)
  cap(kit, "head", "coat", at3(h, -0.12, 0, 0), at3(h, -0.12, 0, 0), hr * 1.04, 0.84, h.u, { melt: 0.45 });
  macaqueEars(kit, h);
  cone(kit, "neck", "coat", madd(chest, tdir, r * 0.5), madd(c, h.d, -hr * 0.4), r * 0.62, hr * 0.74);
  return c;
}

/** One bone of its pelt, from `a` to `b` in the world. */
const peltBone = (a: Vec, b: Vec, long: readonly [number, number], up: Vec, girth: number, fall = 0): PeltSpec["flow"][number] => ({ a, b, long, up, girth, fall });

/** A limb's two bones, off the parts it is drawn from, its hair `shoulder` long at the top down to `cuff` at the wrist or ankle, longest on its outside. */
function limbFlow(capsules: readonly Capsule[], part: string, out: Vec, [shoulder, elbow, cuff]: readonly [number, number, number]): PeltSpec["flow"] {
  const upper = capsules.find((c) => c.part === `${part}.upper`);
  const lower = capsules.find((c) => c.part === `${part}.lower`);
  if (!upper || !lower) return [];
  return [peltBone(upper.a, upper.b, [shoulder, elbow], out, upper.r * 0.8, 0.12), peltBone(lower.a, lower.b, [elbow, cuff], out, lower.r * 0.8, 0.08)];
}

/** How long a coat's hair runs, in grains, end to end of each bone: over the crown, down the nape, the spine, each arm and leg (shoulder, elbow, cuff) and the tail. */
interface HairLengths { readonly crown: readonly [number, number]; readonly nape: readonly [number, number]; readonly spine: readonly [number, number]; readonly arm: readonly [number, number, number]; readonly leg: readonly [number, number, number]; readonly tail: readonly [number, number] }
/** A snow monkey's winter coat: long over the mantle, the shoulders, the back and the cheeks, short on its forearms and shins and round its face. */
const WINTER_HAIR: HairLengths = { crown: [0.34, 1.05], nape: [1.1, 1.5], spine: [1.6, 1.25], arm: [1.2, 0.66, 0.34], leg: [1.25, 0.72, 0.4], tail: [0.7, 0.55] };
/** A long-tailed monkey's, short and close all over, for the bones and muscle under it to show. */
const SLEEK_HAIR: HairLengths = { crown: [0.3, 0.9], nape: [0.9, 1], spine: [1, 0.85], arm: [0.8, 0.55, 0.3], leg: [0.85, 0.55, 0.3], tail: [0.6, 0.4] };

/** Its coat, off its skeleton: back from the bare face over the crown, down the nape and the spine to the rump, and down each limb. */
function macaqueFlow(who: Who, m: Moment, capsules: readonly Capsule[], hair: HairLengths): PeltSpec["flow"] {
  const body = primateSpine(who, m);
  const h = macaqueHeadOf(who, body, m);
  const world = (v: Vec): Vec => toWorld(m.frame, v);
  const dir = (v: Vec): Vec => dirToWorld(m.frame, v);
  const back = dir(spineBack(body.tdir));
  const r = body.r;
  const poll = world(at3(h, -0.5, 0, 0.1));
  const rump = world(madd(body.hips, body.tdir, -r * 0.74));
  const shoulders = world(macaqueSpine(body, 0.98));
  const tail = tailBone(capsules);
  const side = (x: number): Vec => dir([x, 0, 0]);
  return [
    peltBone(world(at3(h, 0.86, 0, 0.1)), world(at3(h, -1, 0, 0.1)), hair.crown, dir(h.u), h.r * 0.84),
    peltBone(poll, shoulders, hair.nape, back, r * 0.7, 0.2),
    peltBone(shoulders, rump, hair.spine, back, r * 0.92, 0.5),
    ...limbFlow(capsules, "arm.L", side(-1), hair.arm),
    ...limbFlow(capsules, "arm.R", side(1), hair.arm),
    ...limbFlow(capsules, "leg.L", side(-1), hair.leg),
    ...limbFlow(capsules, "leg.R", side(1), hair.leg),
    ...(tail ? [peltBone(tail.a, tail.b, hair.tail, back, tail.r * 0.9)] : []),
  ];
}

/** A tail's whole length as one bone, however many parts it is drawn in. */
function tailBone(capsules: readonly Capsule[]): { a: Vec; b: Vec; r: number } | null {
  const parts = capsules.filter((c) => c.part === "tail" || c.part.startsWith("tail."));
  const first = parts[0];
  const last = parts[parts.length - 1];
  return first && last ? { a: first.a, b: last.b, r: first.r } : null;
}

/** Its winter coat, a dusky grey-brown back over a silver front, each guard hair banded and pale at its end. */
function macaquePelt(who: Who, m: Moment, capsules: readonly Capsule[]): PeltSpec {
  const { coat, alt, belly, dark } = who.member.palette;
  return {
    flow: macaqueFlow(who, m, capsules, WINTER_HAIR), under: 0.3, thin: 0.62, crease: 0.34, tint: 0.09, root: "#b4aaa6",
    band: [mixColor(alt, dark, 0.2), 0.42], tip: [belly, 0.2],
    back: mixColor(coat, alt, 0.8), front: belly, dorsal: 0.78, ventral: 0.6,
  };
}

function poseMacaque(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const head = macaqueHead(kit, who, body, m);
  macaqueTorso(kit, body);
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    macaqueLimb(kit, `arm.${side}`, madd(add(chest, [x * w * 0.84, 0, 0]), tdir, -r * 0.16), primateHand(who, body, x, m, head), arm, r * 0.35, [x * 0.45, -0.4, -1], 0.9, x);
    macaqueLimb(kit, `leg.${side}`, add(hips, [x * w * 0.7, 0, 0]), primateFoot(who, body, x, m), leg, r * 0.56, lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), 1.05, x);
  }
  macaqueTail(kit, who, body);
}

// ---------------------------------------------------------------- monkeys

/**
 * A long-tailed monkey's trunk, built to stay narrow: slim hips, a waist drawn
 * in under the ribs, a deep narrow chest and the shoulders over it, so what
 * stands on those long limbs is a lean animal and no bean.
 */
const MONKEY_BODY: readonly Station[] = [[-0.16, 0.74, 0.74, 0.74], [0.1, 0.98, 0.9, 0.86], [0.46, 0.8, 0.56, 0.64], [0.82, 1.04, 1.12, 0.86], [1.12, 0.74, 0.6, 0.7]];

/** A long lean arm or leg from `root` to `target`, bending toward `pole`: the muscle high on each bone and the joint standing out between, down to a bare hand or foot. */
function monkeyLimb(kit: Kit, part: string, root: Vec, target: Vec, length: number, r: number, pole: Vec, x: number): void {
  const sole = r * 0.5;
  const { mid, end } = solveTwoBone(root, [target[0], target[1] + sole * clamp(1 - target[1] / (sole * 2), 0, 1), target[2]], length / 2, length / 2, pole);
  cone(kit, `${part}.upper`, "coat", root, mid, r, r * 0.6, 0.6);
  cone(kit, `${part}.lower`, "coat", mid, end, r * 0.78, r * 0.44, 0.5);
  const up = clamp(Math.abs(target[1]) / (r * 2.5), 0, 1);
  const along = unit(lerpV([0, 0, 1], unit(sub(end, mid)), up));
  macaquePaw(kit, part, end, along, unit(lerpV(UP, [0, 0, 1], up)), r * 0.62, length * 0.3, x, "dark");
}

/** Its bare face: a muzzle a little forward of the flat of it, the macaque's brow, lip, chin, eyes and nose on that. */
function monkeyFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  cap(kit, "muzzle", "accent", at3(h, 0.62, 0, -0.2), at3(h, 0.94, 0, -0.3), r * 0.34, 0.8, h.u, { r1: r * 0.28, melt: 0.5 });
  macaqueFace(kit, h, m);
}

function monkeyHead(kit: Kit, who: Who, body: PrimateBody, m: Moment): Vec {
  const { chest, tdir, r } = body;
  const h = macaqueHeadOf(who, body, m);
  const { c, r: hr } = h;
  monkeyFace(kit, h, m);
  // (A round skull behind the flat of the face.)
  cap(kit, "head", "coat", at3(h, -0.1, 0, 0.04), at3(h, -0.1, 0, 0.04), hr, 0.94, h.u, { melt: 0.45 });
  macaqueEars(kit, h, 0.14, 0.2);
  cone(kit, "neck", "coat", madd(chest, tdir, r * 0.4), madd(c, h.d, -hr * 0.4), r * 0.66, hr * 0.56);
  return c;
}

/** How its tail is carried: the line of each of its parts along it, out and down in a long arc and up again at the end. */
function monkeyTailLine(k: number, q: Pose, t: number, lift: number): number {
  const held = 0.5 - 1.5 * Math.sin(Math.PI * Math.min(k * 1.2, 1)) + lift * k * k * 2.4;
  const sway = 0.05 * Math.sin(t * 1.1 - k * 4);
  if (q.hang > 0.5) return -1.4 + 0.9 * k * k * k;
  return mix(held, -0.5 + 0.5 * k, q.sit) + sway;
}

/** Its long tail, thin from root to tip: set high on the rump, in a curve this animal carries its own way. */
function monkeyTail(kit: Kit, who: Who, body: PrimateBody, m: Moment): void {
  const { hips, tdir, r } = body;
  const gene = createRandom(markOf(who) ^ 0x2d9c41e3);
  const lift = mix(0.7, 1.15, gene());
  const bend = mix(-0.14, 0.14, gene());
  // (The curve is walked in fine steps and drawn as three bowed bones, so a tail never shows an elbow.)
  const n = 9;
  const step = (who.spec.build.tailLen * who.member.size) / (n - 1);
  const line: Vec[] = [madd(madd(hips, tdir, -r * 0.7), spineBack(tdir), r * 0.5)];
  for (let i = 1; i < n; i += 1) {
    const k = (i - 1) / (n - 2);
    const at = line[i - 1] ?? hips;
    const reach = madd(at, dirOf(Math.PI + bend * Math.sin(k * 3) + 0.14 * Math.sin(m.t * 0.9 - k * 3), monkeyTailLine(k, m.pose, m.t, lift)), step);
    line.push(m.pose.hang > 0.5 ? reach : [reach[0], Math.max(reach[1], r * 0.28), reach[2]]);
  }
  for (let i = 0; i < 3; i += 1) {
    const [from, by, to] = [line[i * 3] ?? hips, line[i * 3 + 1] ?? hips, line[i * 3 + 3] ?? hips];
    const middle = lerpV(line[i * 3 + 1] ?? by, line[i * 3 + 2] ?? by, 0.5);
    cap(kit, `tail.${String(i)}`, "coat", from, to, r * mix(0.36, 0.17, i / 3), 1, UP, { r1: r * mix(0.36, 0.17, (i + 1) / 3), bow: sub(middle, lerpV(from, to, 0.5)), melt: i === 0 ? 0.8 : 0.3 });
  }
}

function monkeyPelt(who: Who, m: Moment, capsules: readonly Capsule[]): PeltSpec {
  const { coat, alt, belly, dark } = who.member.palette;
  return {
    flow: macaqueFlow(who, m, capsules, SLEEK_HAIR), under: 0.5, thin: 0.5, crease: 0.3, tint: 0.07, root: "#c4bab0",
    band: [mixColor(alt, dark, 0.3), 0.4], tip: [mixColor(coat, belly, 0.6), 0.24],
    back: mixColor(coat, alt, 0.7), front: belly, dorsal: 0.7, ventral: 0.8,
  };
}

/** A loris along its spine: long and low, a little deeper at the chest, with no tail to taper into. */
const LORIS_BODY: readonly Station[] = [[-0.2, 0.74, 0.72, 0.74], [0.15, 1, 0.94, 0.98], [0.55, 0.9, 0.8, 0.84], [0.95, 0.98, 0.9, 0.92], [1.25, 0.6, 0.55, 0.6]];

/** Its face: a round skull, a short pale muzzle, a dark ring round each huge eye, the pale stripe between them running up its brow, small ears set low in the fur. */
function lorisFace(kit: Kit, h: Head, m: Moment): void {
  const { r } = h;
  cap(kit, "head", "coat", at3(h, -0.08, 0, 0.03), at3(h, -0.08, 0, 0.03), r, 0.95, h.u, { melt: 0.45 });
  cap(kit, "muzzle", "belly", at3(h, 0.72, 0, -0.26), at3(h, 1, 0, -0.3), r * 0.34, 0.86, h.u, { r1: r * 0.24, melt: 0.6 });
  cap(kit, "nose", "dark", at3(h, 1.24, 0, -0.26), at3(h, 1.24, 0, -0.26), r * 0.1, 0.75, h.d, { melt: 0.2 });
  const eyes = [-1, 1].map((x) => ({ x, at: onFace(h, frontAt(x * 0.42, 0.14)) }));
  for (const { x, at } of eyes) {
    cap(kit, "ring", "dark", at, at3(h, 0.42, x * 0.46, -0.34), r * 0.3, 1, UP, { decal: true, r1: r * 0.14, melt: 1.2 });
    cap(kit, "ring", "dark", at, at3(h, 0.3, x * 0.42, 0.62), r * 0.3, 1, UP, { decal: true, r1: r * 0.12, melt: 1.2 });
  }
  cap(kit, "stripe", "belly", at3(h, 0.96, 0, -0.12), at3(h, 0.3, 0, 0.92), r * 0.13, 1, UP, { decal: true, r1: r * 0.08, melt: 1.1 });
  for (const { x, at } of eyes) eyeOf(kit, `eye.${x < 0 ? "L" : "R"}`, h, at, r * 0.125, m.segment.act !== "sleep");
  macaqueEars(kit, h, 0.32, 0.16);
}

function poseLoris(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const head = macaqueHeadOf(who, body, m);
  lorisFace(kit, head, m);
  cone(kit, "neck", "coat", madd(chest, tdir, r * 0.4), madd(head.c, head.d, -head.r * 0.4), r * 0.62, head.r * 0.6);
  const back = spineBack(tdir);
  loft(kit, "torso", "coat", LORIS_BODY, (k) => macaqueSpine(body, k), back, [1, 0, 0], r, 1);
  // (The dark line down its back, breaking up as it nears the rump.)
  cap(kit, "stripe", "dark", madd(hips, back, r * 0.82), madd(chest, back, r * 0.9), r * 0.12, 1, UP, { decal: true, r1: r * 0.16, melt: 1.4 });
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    monkeyLimb(kit, `arm.${side}`, madd(add(chest, [x * w * 0.8, 0, 0]), tdir, -r * 0.1), primateHand(who, body, x, m, head.c), arm, r * 0.3, [x * 0.35, -0.4, -1], x);
    monkeyLimb(kit, `leg.${side}`, add(hips, [x * w * 0.66, 0, 0]), primateFoot(who, body, x, m), leg, r * 0.38, lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), x);
  }
}

function poseMonkey(kit: Kit, who: Who, m: Moment): void {
  const body = primateSpine(who, m);
  const { hips, chest, tdir, r, w, arm, leg } = body;
  const head = monkeyHead(kit, who, body, m);
  loft(kit, "torso", "coat", MONKEY_BODY, (k) => macaqueSpine(body, k), spineBack(tdir), [1, 0, 0], r, 1);
  const sits = settled(who, m);
  for (const x of [-1, 1]) {
    const side = x < 0 ? "L" : "R";
    monkeyLimb(kit, `arm.${side}`, madd(add(chest, [x * w * 0.76, 0, 0]), tdir, -r * 0.1), primateHand(who, body, x, m, head), arm, r * 0.52, [x * 0.35, -0.4, -1], x);
    monkeyLimb(kit, `leg.${side}`, add(hips, [x * w * 0.62, 0, 0]), primateFoot(who, body, x, m), leg, r * 0.7, lerpV([0, 0, 1], [x * 0.55, 1, 0.3], sits), x);
  }
  monkeyTail(kit, who, body, m);
}


// ---------------------------------------------------------------- birds

/** Beak colours; the rest of a bird's look is its coat. */
const BEAKS: Partial<Record<SpeciesId, string>> = { macaque: "#5e4c3e", monkey: "#5a4a40", tortoise: "#cfc29c", sloth: "#a8a08c", songbird: "#3a2a1a", crow: "#1e1e24", owl: "#e8dcc4", parrot: "#2a2a2a", gull: "#f0c030", peacock: "#8a8a80", crane: "#c8c0a0", woodpecker: "#2a2a2a", kookaburra: "#2a2622", guineafowl: "#d8c8a0" };
/** Beaks by coat where a coat has its own: a barn owl's warm ivory, a great horned owl's dark grey, a snowy owl's black. */
const COAT_BEAKS: Readonly<Record<string, string>> = { barn: "#e0cdbc", "great horned": "#3c3a3a", snowy: "#1c1c20" };
/** A sixth colour where a coat needs one, painted as its shell (no bird has one): a great horned owl's buff breast, between its white bib and its rufous face. */
const COAT_SHELLS: Readonly<Record<string, string>> = { "great horned": "#d4c6aa", leopard: "#bfb9a2", star: "#241c0e", snow: "#a2868c", vervet: "#1e1e1c" };

/**
 * A bird's wing and how it uses it. `rate` is its wingbeat (radians a
 * second); `span` one wing's reach and `chord` its breadth, in the bird's
 * lengths; `fingers` the primaries that spread apart at the tip on held wings
 * (a crow's, a gull's, a crane's). The roles colour the wing's top, its
 * trailing edge and its tip, and the folded wing (the arm, then the hand over
 * the tail). Cruising, it holds its wings still for a `glide` share of each
 * `bout` (seconds); a `bound`ing bird shuts them between bursts instead and
 * dips (a finch, a woodpecker). `dihedral` lifts held wings into a shallow V.
 * `spots` paints a row of pale spots across the open wing (a woodpecker's
 * chequered flight feathers).
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
  readonly spots?: Role;
}
const WING: WingStyle = { rate: 14, span: 0.7, chord: 0.2, fingers: 0, top: "alt", trail: "alt", tip: "alt", fold: ["alt", "alt"], glide: 0.25, bout: 2, bound: false, dihedral: 0.06, tail: "alt" };
const WINGS: Partial<Record<SpeciesId, WingStyle>> = {
  songbird: { ...WING, rate: 28, span: 0.62, chord: 0.21, glide: 0, bout: 0.75, bound: true, dihedral: 0.04 },
  woodpecker: { ...WING, rate: 24, span: 0.66, chord: 0.21, top: "coat", trail: "alt", tip: "coat", fold: ["coat", "alt"], glide: 0, bout: 1.1, bound: true, tail: "coat", spots: "belly" },
  parrot: { ...WING, rate: 19, span: 0.72, chord: 0.17, trail: "coat", fold: ["coat", "alt"], glide: 0.12, bout: 1.6 },
  crow: { ...WING, rate: 12, span: 0.86, chord: 0.24, fingers: 4, top: "alt", trail: "accent", tip: "alt", fold: ["alt", "alt"], glide: 0.4, bout: 3.2, dihedral: 0.1 },
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
  owl: { pitch: 1.38, walk: 1.22, fore: 0.13, aft: 0.13 },
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

interface BirdBody { readonly C: Vec; readonly K: Vec; readonly T: Vec; readonly r: number; readonly pitch: number; readonly flying: boolean; readonly flight: Flight; readonly turn: number }

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

/**
 * An owl's proportions by coat, as shares of its kind's build, and its chest
 * as a share of its shoulders' width: a barn owl slim and long in the leg, a
 * great horned owl bulky and barrel-chested with a wide head, a snowy owl
 * broad, low and stocky with a smaller head for its body.
 */
interface OwlShape { readonly body: number; readonly leg: number; readonly head: number; readonly chest: number }
const OWL_SHAPE: OwlShape = { body: 1, leg: 1, head: 1, chest: 1 };
const OWL_SHAPES: Readonly<Record<string, OwlShape>> = {
  barn: { body: 0.94, leg: 1.12, head: 0.95, chest: 1.02 },
  "great horned": { body: 1.06, leg: 1, head: 1.06, chest: 1.08 },
  snowy: { body: 1.12, leg: 0.86, head: 0.96, chest: 1.02 },
};
const owlShapeOf = (coat: string): OwlShape => OWL_SHAPES[coat] ?? OWL_SHAPE;

/** A bird's build, an owl's by its coat. */
function birdBuild(who: Who): Build {
  const b = who.spec.build;
  if (who.member.species !== "owl") return b;
  const shape = owlShapeOf(who.member.coat);
  return { ...b, body: b.body * shape.body, leg: b.leg * shape.leg, head: b.head * shape.head };
}

function birdSpine(who: Who, m: Moment): BirdBody {
  const q = m.pose;
  const b = birdBuild(who);
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
  return { C, K: madd(C, along, stance.fore * size), T: madd(C, along, -aft), r, pitch, flying, flight, turn: bodyTurn(who, m) };
}

/**
 * How far a bird turns its head and how it cocks it. An owl swivels its
 * whole head where another bird would turn its body: barely as it stands,
 * but looking about, round over its shoulder until its face looks out past
 * its own wing, its face kept level (its shoulders follow it a little, see
 * `bodyTurn`); asleep, it sinks its head facing forward where another bird
 * tucks its bill back over its shoulder.
 */
function headTurn(who: Who, m: Moment): { readonly yaw: number; readonly roll: number; readonly tuck: number } {
  const q = m.pose;
  if (who.member.species !== "owl") return { yaw: q.headYaw, roll: q.headRoll, tuck: m.segment.act === "sleep" ? 1 : 0 };
  // (Cubed, so a glance stays small and a look goes all the way round.)
  const k = q.headYaw / 0.4;
  return { yaw: -1.3 * Math.tanh(k * k * k), roll: q.headRoll, tuck: 0 };
}

/** How far a bird's shoulders turn after its head, on feet that stay put: an owl's only, so a long look is the whole bird's. */
function bodyTurn(who: Who, m: Moment): number {
  return who.member.species === "owl" && m.mode !== "fly" ? headTurn(who, m).yaw * 0.2 : 0;
}

function birdHead(kit: Kit, who: Who, body: BirdBody, m: Moment): Head {
  const q = m.pose;
  const b = birdBuild(who);
  const size = who.member.size;
  const drum = m.segment.act === "drum";
  const { yaw, roll, tuck } = headTurn(who, m);
  const neckRise = (drum ? 0.2 : 1.2) - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0);
  const hd = dirOf(yaw + tuck * 2.6, (who.member.species === "owl" ? 0 : -0.1) + q.headPitch * 0.5 - q.peck * (drum ? 0.1 : 1.1) - (drum ? 1.2 : 0) + (body.flying ? 0.05 : 0));
  const hr = birdSkullR(who, b, body);
  if (who.member.species === "owl") return withSkull({ c: owlSkullAt(who, body, q, yaw, tuck, hd, hr), d: hd, ...headAxes(hd, roll), r: hr, ...eyeOfSpecies(who) }, b.skull);
  const occiput = cervical(kit, who, body, neckRise, yaw * 0.5 + tuck * 2.6, hr);
  // (The skull hangs forward of where the neck meets it: the neck comes in at its back, never under its middle.)
  const c = madd(madd(occiput, hd, hr * 0.72), [0, 0, 1], drum ? q.peck * size * 0.12 : 0);
  return withSkull({ c, d: hd, ...headAxes(hd, roll), r: hr, ...eyeOfSpecies(who) }, b.skull);
}

/** An owl carries its head right on top of its body, a short neck under its ruff. */
function owlSkullAt(who: Who, body: BirdBody, q: Pose, yaw: number, tuck: number, hd: Vec, hr: number): Vec {
  const b = birdBuild(who);
  const upright = body.flying ? 0 : clamp((body.pitch - 1.1) / 0.3, 0, 1);
  const base = madd(body.K, UP, body.r * (0.45 + upright * 0.1));
  const dir = dirOf(yaw * 0.5 + tuck * 2.6, 1.2 + upright * 0.35 - q.peck * 2.2 + q.headPitch * 0.5 - tuck * 0.9 - (body.flying ? 1.0 : 0));
  const top = madd(base, dir, Math.max(b.neck * who.member.size, body.r * 0.3) * (1 - tuck * 0.6));
  return madd(madd(top, hd, hr * 0.4 * (1 - upright * 0.85)), UP, hr * upright * 0.15);
}

/** How long a bird's neck is, in its body's radii: at its least still a real neck, the length of the skull it carries. */
const neckLength = (who: Who, b: Build, body: BirdBody): number => Math.max(b.neck * who.member.size * 1.15, body.r * 0.95);
const longNeck = (who: Who, b: Build, body: BirdBody): boolean => neckLength(who, b, body) > body.r * 1.6;
/** A skull's radius: a short-necked bird's a little smaller, its neck carrying it into its shoulders. */
const birdSkullR = (who: Who, b: Build, body: BirdBody): number => b.head * who.member.size * CHARM * (who.member.species === "owl" || longNeck(who, b, body) ? 1 : 0.88);

/**
 * The neck, as a skeleton: from the shoulders three joints in the S every
 * bird carries it in, forward first, up, then forward again to the back of
 * the skull, and skinned from those joints, broad under the feathers on a
 * short neck and slim on a long one. Returns where it meets the skull.
 */
function cervical(kit: Kit, who: Who, body: BirdBody, rise: number, yaw: number, hr: number): Vec {
  const b = birdBuild(who);
  const L = neckLength(who, b, body);
  const long = longNeck(who, b, body);
  const up: Vec = [0, Math.cos(body.pitch), -Math.sin(body.pitch)];
  const root = madd(body.K, up, body.r * 0.3);
  const low = madd(root, dirOf(yaw * 0.5, rise - 0.55), L * 0.4);
  const mid = madd(low, dirOf(yaw, rise + 0.3), L * 0.35);
  const occiput = madd(mid, dirOf(yaw, rise - 0.3), L * 0.25);
  const [r0, r1, r2] = long ? [body.r * 0.42, body.r * 0.3, hr * 0.5] : [body.r * 0.8, hr * 0.98, hr * 0.84];
  const crowned = who.member.coat === "red-crowned";
  cone(kit, "neck", "coat", root, low, r0, r1, 1);
  cone(kit, "neck.upper", crowned ? "dark" : "coat", low, occiput, r1, r2, 1);
  return occiput;
}

/** A bird's head drawn from its kind's skull, its front (where the bill grows) at the last station. */
function withSkull(head: Head, skull: readonly Station[] | undefined): Head {
  if (!skull) return head;
  return { ...head, stations: skull, stop: skull[skull.length - 1]?.[0] ?? 0.6, sec: (k: number) => sectionAt(skull, k) };
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
  if (id === "owl") { owlHead(kit, who, h, m); return; }
  const role = HEADS[id] ?? "coat";
  if (h.stations) loft(kit, "head", role, h.stations, (k) => madd(h.c, h.d, k * h.r), h.u, h.s, h.r, 1);
  else cap(kit, "head", role, h.c, h.c, h.r, 1, UP);
  birdBeak(kit, who, h, b.snout * size, m.pose.mouth);
  // A kookaburra's dark stripe back through the eye.
  // (Found from the eye, so the stripe runs through it whatever the skull.)
  if (id === "kookaburra") for (const x of [-1, 1]) { const eye = birdEyeSpot(h, x); decal(kit, "stripe", "alt", onFace(h, eye), onFace(h, sideAt(x, eye[0] - 0.55, eye[2] - 0.06)), h.r * 0.2); }
  for (const x of [-1, 1]) birdEye(kit, h, x, m.segment.act !== "sleep");
  birdCrest(kit, who, h);
}

/**
 * An owl's face, by its coat: a barn owl's disc a heart (two lobes meeting
 * in a point under the bill, split by a pale ridge down from its forehead),
 * every other one round in two halves either side of it; the disc's colour
 * and the line round its rim and how wide it is (a great horned owl's dark
 * and only down its outer sides, a barn owl's thin and rust, a snowy owl's a
 * faint grey); how deep the disc is dished, in head radii (only a little: it
 * lies nearly flush with the head, so the crown never wraps it like a hood);
 * its eyes' size and where they sit across and up the face, in head radii,
 * and the ring painted round a round eye, as a share of it (a snowy owl's
 * only a thin lid); how far its crown runs flat between its corners (a snowy
 * owl's head rounder); its bill's length, in head radii, and the hooked tip
 * of it; and whether it sits in a tuft of bristles (a snowy owl's).
 */
interface OwlFace {
  readonly heart: boolean; readonly disc: Role; readonly rim: Role; readonly ring: number; readonly open: boolean; readonly dish: number;
  readonly eye: number; readonly apart: number; readonly high: number; readonly lid: number; readonly crown: number; readonly bill: number; readonly tip: Role; readonly bristle: boolean;
}
const OWL_FACE: OwlFace = { heart: false, disc: "accent", rim: "dark", ring: 0.13, open: false, dish: 0.04, eye: 0.3, apart: 0.46, high: 0.1, lid: 1.28, crown: 0.4, bill: 0.3, tip: "dark", bristle: false };
const OWL_FACES: Readonly<Record<string, OwlFace>> = {
  barn: { ...OWL_FACE, heart: true, disc: "belly", rim: "accent", ring: 0.05, dish: 0.02, eye: 0.17, apart: 0.36, high: 0.1, crown: 0.36, bill: 0.2 },
  "great horned": { ...OWL_FACE, disc: "belly", open: true, lid: 1.2 },
  snowy: { ...OWL_FACE, rim: "alt", ring: 0.06, dish: 0.05, eye: 0.27, apart: 0.4, high: 0.14, lid: 1.12, crown: 0.2, bill: 0.2, tip: "horn", bristle: true },
};
const owlFaceOf = (who: Who): OwlFace => OWL_FACES[who.member.coat] ?? OWL_FACE;

/** An owl's skull: how far back of its middle it sits, its radius across, and how flat its front, in head radii. */
const owlSkull = (face: OwlFace): { readonly back: number; readonly r: number; readonly flat: number } => ({ back: -0.05, r: 1.2 - face.crown * 0.5, flat: 0.76 });

/** A point `s` across and `u` up an owl's face, `out` head radii off the skull's front (as `owlHead` draws it). */
function onOwlFace(h: Head, face: OwlFace, s: number, u: number, out = 0): Vec {
  const skull = owlSkull(face);
  const ds = Math.max(0, Math.abs(s) - face.crown);
  return at3(h, skull.back + skull.flat * Math.sqrt(Math.max(0, skull.r * skull.r - ds * ds - u * u)) + out, s, u);
}

/**
 * An owl's head: broad and flat-crowned, sunk into its shoulders with no
 * neck between them, its face a disc nearly flush with its front, both eyes
 * forward in it and the bill hooked down between them; a great horned owl's
 * ear tufts up from the corners of its crown.
 */
function owlHead(kit: Kit, who: Who, head: Head, m: Moment): void {
  const face = owlFaceOf(who);
  const skull = owlSkull(face);
  // (Carried back, right over its toes.)
  const h: Head = { ...head, c: madd(head.c, [0, 0, 1], -head.r * 0.05) };
  // (Wider than it is tall, so the crown runs flat between its corners, and flattened in front for the face;
  // sunk into the top of its body and melted into it, so no neck or notch shows between them.)
  cap(kit, "head", "coat", at3(h, skull.back, -face.crown, 0), at3(h, skull.back, face.crown, 0), h.r * skull.r, skull.flat, h.d, { melt: 0.9 });
  owlFaceMarks(kit, who, h, face, m.segment.act !== "sleep");
  owlDisc(kit, h, face);
  // (A barn owl's pale ridge, standing out of its heart down from its forehead to the bill.)
  if (face.heart) cap(kit, "ridge", "horn", onOwlFace(h, face, 0, 0.58, -0.05), onOwlFace(h, face, 0, -0.06, -0.03), h.r * 0.075, 1, UP, { r1: h.r * 0.06, melt: 0 });
  for (const x of [-1, 1]) owlEye(kit, h, face, x, m.segment.act !== "sleep");
  owlBeak(kit, h, face, m.pose.mouth);
  if (who.member.coat === "great horned") owlTufts(kit, h);
}

/**
 * One half of the face disc, `grow` head radii past its own edge: a lobe
 * from beside the brow down to the chin (a heart's), or round. Its flat side
 * faces out of the face, turned a little toward its own side. Painted, it
 * lies across the face; carved, it stands off it so it cuts in only `dish`
 * head radii at its deepest.
 */
function discHalf(kit: Kit, part: string, role: Role, h: Head, face: OwlFace, x: number, grow: number, finish: Finish): void {
  // (A heart's lobes overlap down its middle, so it reads as one white face and never as two goggles.)
  const [top, end] = face.heart ? [[0.42, 0.22], [0.04, -0.52]] as const : [[0.52, 0.12], [0.3, -0.24]] as const;
  const [r, r1] = face.heart ? [0.66 + grow, 0.26 + grow] : [0.66 + grow, 0.54 + grow];
  const n = unit(madd(h.d, h.s, x * 0.3));
  // (Painted, nearly round, so it marks the face the same however far the face curves back from it.)
  const thick = finish.carve === true ? 0.12 : r * 0.75;
  // (A tapered part thins with its radius: each end stands off by its own thickness.)
  const off = (k: number): number => (finish.carve === true ? thick * k - face.dish : 0);
  cap(kit, part, role, onOwlFace(h, face, x * top[0], top[1], off(1)), onOwlFace(h, face, x * end[0], end[1], off(r1 / r)), h.r * r, thick / r, n, { ...finish, r1: h.r * r1 });
}

/**
 * The face disc, in two halves: painted on the face, a thin line round its
 * rim in a darker colour, and dished only a little (a carve), so its edge
 * reads as a soft crease and never as a ring of the crown's colour.
 */
function owlDisc(kit: Kit, h: Head, face: OwlFace): void {
  // (Both halves' paint first, so inside either the rims, which are the halves grown a little, give way to it.)
  for (const x of [-1, 1]) discHalf(kit, `disc.${x < 0 ? "L" : "R"}`, face.disc, h, face, x, 0, { decal: true });
  for (const x of [-1, 1]) owlRim(kit, h, face, x);
  if (face.heart) for (const x of [-1, 1]) discHalf(kit, `dish.${x < 0 ? "L" : "R"}`, face.disc, h, face, x, -0.04, { carve: true, melt: 0.6 });
  // (A round disc's dish is one wide cut across both its halves.)
  else cap(kit, "dish", face.disc, onOwlFace(h, face, -0.46, 0.1, 0.1 - face.dish), onOwlFace(h, face, 0.46, 0.1, 0.1 - face.dish), h.r * 0.62, 0.16, h.d, { carve: true, melt: 0.6 });
}

/** The line round a half of the disc: all the way round it, or (an `open` rim) a crescent down its outer side only. */
function owlRim(kit: Kit, h: Head, face: OwlFace, x: number): void {
  const part = `rim.${x < 0 ? "L" : "R"}`;
  if (face.open) cap(kit, part, face.rim, onOwlFace(h, face, x * 0.94, 0.34), onOwlFace(h, face, x * 0.78, -0.24), h.r * 0.25, 1, UP, { r1: h.r * 0.2, decal: true });
  else discHalf(kit, part, face.rim, h, face, x, face.ring, { decal: true });
}

/**
 * Marks on the face, painted before the disc so they lie over it: the dark
 * ring round a round eye; a barn owl's crown dropping in a notch between the
 * lobes of its heart down to the bill; a great horned owl's pale brows in a V over the bill (its white
 * throat is on its body, see `owlBib`).
 */
function owlFaceMarks(kit: Kit, who: Who, h: Head, face: OwlFace, open: boolean): void {
  const on = (s: number, u: number): Vec => onOwlFace(h, face, s, u);
  // (Each stands off the face at its upper end, so it still lies on the face where the face bulges out between its ends.)
  if (who.member.coat === "barn") cap(kit, "notch", "coat", onOwlFace(h, face, 0, 0.92, 0.12), on(0, 0.14), h.r * 0.15, 1, UP, { r1: h.r * 0.03, decal: true });
  // (A round eye's dark ring painted round it on the disc, so it frames the eye however the face curves.)
  if (open && !face.heart) for (const x of [-1, 1]) decal(kit, `eye.${x < 0 ? "L" : "R"}.ring`, "dark", onOwlFace(h, face, x * face.apart, face.high), onOwlFace(h, face, x * face.apart, face.high), h.r * face.eye * face.lid);
  if (who.member.coat === "great horned") for (const x of [-1, 1]) cap(kit, `brow.${x < 0 ? "L" : "R"}`, "accent", onOwlFace(h, face, x * 0.03, -0.04, 0.02), onOwlFace(h, face, x * 0.56, 0.56, 0.05), h.r * 0.12, 1, UP, { r1: h.r * 0.07, decal: true });
}

/**
 * An owl's eye, big and forward in its disc, a little above its middle and
 * set flush into it, a flat lens that never stands out of the head's
 * outline side on: a barn owl's black, a great horned owl's or a
 * snowy owl's big and lemon yellow in a dark ring, only a thin lid on a
 * snowy owl (painted on the disc, see `owlFaceMarks`). Shut, a dark slit across the disc.
 */
function owlEye(kit: Kit, h: Head, face: OwlFace, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  const r = h.r * face.eye;
  const n = unit(madd(h.d, h.s, x * 0.12));
  const surface = onOwlFace(h, face, x * face.apart, face.high, -face.dish);
  if (!open) {
    // (Up out of the dish, its ends drawn back round the face, so the slit lies on it and never stands off it.)
    const lid = madd(madd(surface, h.u, -r * 0.1), n, h.r * face.dish);
    const end = (k: number): Vec => madd(madd(lid, h.s, k * r * 0.6), n, -r * 0.1);
    cap(kit, part, "dark", end(-1), end(1), r * 0.1, 1, UP, { melt: 0 });
    return;
  }
  const across = unit(cross(n, h.u), h.s);
  const up = cross(across, n);
  // (Sunk so only a shallow lens of it stands proud, its pupil and its spark flat on it.)
  const c = madd(surface, n, -r * 0.15);
  ball(kit, part, "eye", c, r, 0.3, n);
  const dark = h.eye?.pupil === "dark";
  ball(kit, `${part}.pupil`, "pupil", madd(c, n, r * 0.2), r * (dark ? 0.76 : 0.42), 0.25, n);
  ball(kit, `${part}.shine`, "shine", madd(madd(madd(c, n, r * 0.28), up, r * 0.32), across, -r * 0.18), r * (dark ? 0.28 : 0.2), 0.4, n);
}

/**
 * An owl's bill: a short fat wedge from just under its eyes, hooked down
 * and just out past its face, its hooked tip darker: a barn owl's ivory, a
 * great horned owl's dark grey, a snowy owl's black, sunk in a tuft of white
 * bristles.
 */
function owlBeak(kit: Kit, h: Head, face: OwlFace, mouth: number): void {
  const wide = face.bill * 0.46;
  const tall = face.bill;
  const sunk = face.bristle ? 0.08 : face.heart ? 0.06 : 0;
  // (A heart's set low, down its ridge between the eyes.)
  const root = onOwlFace(h, face, 0, face.high - face.bill * (face.heart ? 1.1 : 0.75), -sunk);
  const knee = madd(madd(root, h.d, h.r * tall * 0.5), h.u, -h.r * tall * 0.4);
  const tip = madd(madd(knee, h.d, -h.r * tall * 0.16), h.u, -h.r * tall * 0.46);
  if (face.bristle) ball(kit, "beak.bristle", "accent", madd(root, h.u, -h.r * tall * 0.2), h.r * tall * 1.05, 0.62, h.d);
  cap(kit, "beak", "horn", root, knee, h.r * wide, 0.95, h.s, { r1: h.r * wide * 0.72 });
  cap(kit, "beak.tip", face.tip, knee, tip, h.r * wide * 0.72, 0.85, h.s, { r1: h.r * 0.025, melt: 0 });
  if (mouth > 0.05) cap(kit, "beak.lower", "horn", madd(root, h.u, -h.r * tall * 0.5), madd(madd(root, h.d, h.r * tall * 0.4), h.u, -h.r * tall * (0.5 + 0.6 * mouth)), h.r * wide * 0.5);
}

/**
 * A great horned owl's ear tufts: broad feathered plumes, flat and wide at
 * their base, up off its brow over each eye in a V, leaning out and a
 * little back. (They cast no shadow: off the head, theirs would fall as specks.)
 */
function owlTufts(kit: Kit, h: Head): void {
  for (const x of [-1, 1]) {
    const root = at3(h, 0.22, x * 0.42, 0.72);
    const dir = unit(add(add(h.u, scale(h.s, x * 0.42)), scale(h.d, -0.2)));
    cap(kit, `ear.${x < 0 ? "L" : "R"}`, "alt", root, madd(root, dir, h.r * 0.6), h.r * 0.4, 0.46, h.d, { r1: h.r * 0.11, melt: 0.35, shadow: false });
  }
}

/** An eye on a drawn skull, on its side just behind the bill, where a bird's is; on a round head, out on its side. */
/** Where a bird's eye sits: on a drawn skull's side just behind the bill, on a round head a little forward. */
const birdEyeSpot = (h: Head, x: number): FacePoint => (h.stations ? eyeSpot(Math.max(0, (h.stop ?? 0.6) - 0.5), x * 0.75, 0.3) : [0.35, x * 0.62, 0.2]);

function birdEye(kit: Kit, h: Head, x: number, open: boolean): void {
  const part = `eye.${x < 0 ? "L" : "R"}`;
  if (h.stations) outlinedEye(kit, part, h, birdEyeSpot(h, x), h.r * 0.2, open);
  else eyeOf(kit, part, h, onFace(h, birdEyeSpot(h, x)), h.r * 0.2, open);
}

/**
 * Where the bill grows and how deep it is there: on a drawn skull from its
 * front, as deep as the bird's own bill but never deeper than the face; on a
 * round head out of its front. (Tapered to its point from there, so a small
 * bird's bill reads as a bill and not a dark bead.)
 */
function billRoot(who: Who, h: Head): { root: Vec; br: number } {
  const front = h.stop ?? 0;
  const face = h.sec?.(front);
  if (!face) return { root: at3(h, 0.65, 0, 0.05), br: h.r * 0.27 };
  return { root: madd(madd(h.c, h.d, (front - 0.15) * h.r), h.u, face.o * h.r), br: h.r * Math.min(who.spec.build.bill ?? 0.3, face.h * 0.95) };
}

/** How a bill grows, in shares of its length: how far its top line arches, how far its tip droops below its root, and how far along the lower half reaches. */
interface Bill { readonly arch: number; readonly hook: number; readonly low: number }
const BILL: Bill = { arch: 0.08, hook: 0.04, low: 0.88 };
const BILLS: Partial<Readonly<Record<string, Bill>>> = {
  songbird: { arch: 0.06, hook: 0, low: 0.86 }, crow: { arch: 0.13, hook: 0.07, low: 0.86 }, parrot: { arch: 0.42, hook: 0.3, low: 0.5 }, gull: { arch: 0.1, hook: 0.17, low: 0.84 },
  crane: { arch: 0.02, hook: 0, low: 0.96 }, woodpecker: { arch: 0.02, hook: 0, low: 0.95 }, kookaburra: { arch: 0.06, hook: 0.06, low: 0.92 }, guineafowl: { arch: 0.14, hook: 0.1, low: 0.8 }, peacock: { arch: 0.1, hook: 0.08, low: 0.84 },
};

/** The bill, two sheaths of horn meeting along a gape: the upper arched and drawn down to its point, the lower slimmer and shorter under it, dropping as the mouth opens. No two birds' are quite the same. */
function birdBeak(kit: Kit, who: Who, h: Head, beak: number, mouth: number): void {
  const { root, br } = billRoot(who, h);
  const gene = createRandom(markOf(who) ^ 0x51ed270b);
  const bill = BILLS[who.member.species] ?? BILL;
  const long = (beak + (h.sec ? h.r * 0.15 : 0)) * mix(0.93, 1.07, gene());
  const arch = long * bill.arch * mix(0.8, 1.2, gene());
  const top = madd(root, h.u, br * 0.26);
  const tip = madd(madd(top, h.d, long), h.u, -(long * bill.hook + br * 0.26));
  const along = unit(sub(tip, top), h.d);
  cap(kit, "beak", "horn", top, tip, br * 0.76, 1, UP, { r1: br * mix(0.07, 0.17, bill.hook), bow: scale(unit(madd(h.u, along, -dot(h.u, along)), h.u), arch), melt: 0.2 });
  const jaw = madd(root, h.u, -br * 0.46);
  const end = madd(madd(jaw, h.d, long * bill.low), h.u, br * 0.28 - long * 0.5 * mouth);
  cap(kit, "beak.lower", "horn", jaw, end, br * 0.5, 1, UP, { r1: br * 0.05, bow: scale(h.u, -long * 0.03), melt: 0.15, shadow: false });
}

/** A peacock's crest: a fan of bare quills up off its crown, each with a small flag at its tip. */
function peacockCrest(kit: Kit, h: Head): void {
  const [a, b] = [at3(h, -0.1, -0.7, 0.7), at3(h, -0.1, 0.7, 0.7)];
  const reach = add(scale(h.u, h.r * 1.3), scale(h.d, -h.r * 0.25));
  cap(kit, "crown", "dark", a, b, h.r * 0.035, 1, UP, { row: 5, reach, melt: 0.1, shadow: false });
  cap(kit, "crown.tip", "alt", add(a, reach), add(b, reach), h.r * 0.1, 0.7, h.d, { row: 5, melt: 0, shadow: false });
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
    if (id === "peacock") peacockCrest(kit, h);
    else if (id === "guineafowl") {
      // A helmeted guineafowl's bony casque, up and back off its bare blue crown.
      const root = at3(h, -0.1, 0, 0.7);
      cap(kit, "casque", "horn", root, madd(root, unit(add(h.u, scale(h.d, -0.55))), h.r * 1.1), h.r * 0.42, 0.7, h.s, { r1: h.r * 0.12, melt: 0.5 });
    } else ball(kit, "crown", "accent", at3(h, 0.1, 0, 0.78), h.r * 0.5, 0.5);
  }
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
  // (Well back along the flank, so the wing runs long and low, not a disc at the shoulder.)
  const foldElbow = madd(lerpV(body.C, body.T, 0.3), side, body.r * 0.88);
  const foldTip = madd(madd(body.T, side, body.r * 0.45), forward, -size * 0.16);
  const open = beat.open;
  const armDir = unit([x * Math.cos(beat.elev), Math.sin(beat.elev), -0.12 - beat.sweep * 0.5]);
  const handElev = beat.elev * 1.35 - beat.flex * 0.35;
  const handDir = unit([x * Math.cos(handElev) * (1 - beat.flex * 0.45), Math.sin(handElev), -0.28 - beat.flex * 0.9 - beat.sweep]);
  const elbow = lerpV(foldElbow, madd(shoulder, armDir, span * 0.44), open);
  const tip = lerpV(foldTip, madd(elbow, handDir, span * 0.56 * (1 - beat.flex * 0.25)), open);
  if (open < 0.45) { foldedWing(kit, who, body, x, [shoulder, elbow, tip]); return; }
  const plane = (dir: Vec): Vec => unit(cross(dir, [0, 0, 1]), UP);
  const armUp = plane(sub(elbow, shoulder));
  const handUp = plane(sub(tip, elbow));
  const behind = (p: Vec, k: number): Vec => madd(p, [0, 0, -1], chord * k);
  // (Thin, and melting barely into the body, so a wing stands off it as a wing at any size, even
  // a black wing on a black bird: the arm broad, the hand tapering to its tip. The trailing edge
  // shows behind the arm as its own band.)
  const wing: Finish = { melt: 0.12 };
  cap(kit, `wing.${L}`, style.top, behind(shoulder, 0.1), behind(elbow, 0.1), chord * 0.46, 0.16, armUp, { ...wing, r1: chord * 0.42 });
  cap(kit, `wing.trail.${L}`, style.trail, behind(shoulder, 0.62), behind(elbow, 0.55), chord * 0.3, 0.13, armUp, { melt: 0.1 });
  if (style.spots) wingSpots(kit, style.spots, L, behind(shoulder, 0.25), behind(tip, 0.25), chord);
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

/** A folded wing: two plates along the flank, the hand over the tail (an owl's its own, see `owlFold`). */
function foldedWing(kit: Kit, who: Who, body: BirdBody, x: number, [shoulder, elbow, tip]: readonly [Vec, Vec, Vec]): void {
  const style = wingStyle(who);
  if (who.member.species === "owl") { owlFold(kit, style, body, x); return; }
  const L = x < 0 ? "L" : "R";
  const side: Vec = [x, 0, 0];
  // (A blade, not a plate: narrow at the shoulder, broadest over the flank, drawn to a point past the rump, laid close along the body.)
  cap(kit, `wing.${L}`, style.fold[0], madd(shoulder, side, -body.r * 0.12), madd(elbow, side, -body.r * 0.12), body.r * 0.3, 0.22, side, { r1: body.r * 0.46, melt: 0.35 });
  cap(kit, `wingtip.${L}`, style.fold[1], madd(elbow, side, -body.r * 0.12), tip, body.r * 0.44, 0.18, side, { r1: body.r * 0.07, melt: 0.3 });
}

/** A direction on an owl's body, turned with its shoulders (see `bodyTurn`). */
function owlTurned(body: BirdBody, [x, y, z]: Vec): Vec {
  const [c, s] = [Math.cos(body.turn), Math.sin(body.turn)];
  return [x * c + z * s, y, z * c - x * s];
}

/**
 * A point on an owl, `up` its body radii up its middle (its feet nearly two
 * below), `out` to the side `x` and `back` toward its back (negative, its
 * breast). It twists on its hips as its shoulders turn, and leans away from
 * where it looks to balance its head.
 */
function owlAt(body: BirdBody, x: number): (up: number, out: number, back: number) => Vec {
  const along = owlTurned(body, add(dirOf(0, body.pitch), [-body.turn * 0.35, 0, 0]));
  const over = owlTurned(body, [0, Math.cos(body.pitch), -Math.sin(body.pitch)]);
  const side = owlTurned(body, [x, 0, 0]);
  return (up, out, back) => madd(madd(madd(body.C, along, up * body.r), side, out * body.r), over, back * body.r);
}

/**
 * An owl's body (see `owlTorso`), three rings from its shoulders down, each
 * how far `up` its middle, its radius and how far toward its back, in its
 * radii: its shoulders high and broad so its head sinks into them, and a
 * near straight barrel from there to a full low end, a bullet with no waist
 * (kept this near straight because the pixel look steps a turned-under
 * surface a shade darker in one hard line); `OWL_DEEP` how far it runs front
 * to back as a share of across.
 */
const OWL_TRUNK = [[0.6, 1.02, 0.24], [-0.2, 1.07, 0.16], [-0.74, 1, 0.14]] as const;
const OWL_DEEP = 0.84;

/** Where an owl's folded primaries end, as `owlAt` takes them. */
const OWL_PRIMARIES = [[-0.5, 1, 0.34], [-0.82, 0.84, 0.56], [-1.12, 0.52, 0.86]] as const;

/**
 * An owl's folded wing, one long leaf wrapped round its flank from shoulder
 * to tail: a round part buried in the body so only its outer face stands
 * proud, curving with the flank so no edge of it stands off the outline,
 * broad under the shoulder and running to a point over the tail; from under
 * its lower edge the primaries' tips, each a step longer and further back
 * than the one before, so that edge comes down in stairs, in the wing's
 * darker colour.
 */
function owlFold(kit: Kit, style: WingStyle, body: BirdBody, x: number): void {
  const r = body.r;
  const L = x < 0 ? "L" : "R";
  const [panel, tips] = style.fold;
  const at = owlAt(body, x);
  const wrist = at(0.36, 0.48, 0.3);
  const point = at(-1.1, 0.3, 0.78);
  const face = owlTurned(body, unit([x * 0.8, 0, -0.6]));
  cap(kit, `wing.${L}`, panel, wrist, point, r * 0.72, 0.94, face, { r1: r * 0.27, melt: 0.1 });
  // (Fanned from under the wing's middle, each tip a step lower and further back along its edge, the longest last at its point.)
  const root = at(-0.05, 0.93, 0.5);
  OWL_PRIMARIES.forEach(([up, out, back], i) => {
    // (Hardly melted, so each keeps its own edge and still wears the coat's pattern.)
    cap(kit, `wingtip.${L}${String(i)}`, tips, root, at(up, out, back), r * 0.22, 0.4, face, { r1: r * 0.14, melt: 0.08 });
  });
}

/** A row of pale spots across an open wing, from near its root out toward its tip. */
function wingSpots(kit: Kit, role: Role, L: string, root: Vec, tip: Vec, chord: number): void {
  for (let i = 0; i < 4; i += 1) {
    const at = lerpV(root, tip, 0.3 + i * 0.17);
    decal(kit, `wing.spot.${L}${String(i)}`, role, at, at, chord * 0.14);
  }
}

/** An owl's tail, sitting: a short broad wedge fused into its rump and fanning a little, the crossed tips of its wings lying over its root. */
function owlTail(kit: Kit, who: Who, body: BirdBody): void {
  const at = owlAt(body, 1);
  // (Its face turned back, so it hangs on down the line of the back.)
  const fan = unit(sub(at(0.3, 0, 1), at(0, 0, 0)));
  cap(kit, "tail.1", wingStyle(who).fold[1], at(-0.74, 0, 0.78), at(-1.12, 0, 0.92), body.r * 0.46, 0.32, fan, { r1: body.r * 0.52, melt: 0.4 });
}

/** How many separate feathers a spread train shows. */
const TRAIN_SPREAD = 15;

/** A peacock's train: tiers of separate long feathers, spread or closed. */
function trainFeathers(kit: Kit, who: Who, body: BirdBody, m: Moment, above: (tip: Vec, r: number) => Vec): void {
  const b = who.spec.build;
  const size = who.member.size;
  const fan = m.pose.fan;
  // (Spread, tiers of separate long feathers, the shorter set before the longer and showing between them; closed, a tapering train.)
  const count = fan > 0.3 ? TRAIN_SPREAD : 6;
  for (let i = 0; i < count; i += 1) {
    const a = (i / (count - 1) - 0.5) * 2.6;
    const fore = fan > 0.3 && i % 2 === 1;
    const spread = unit(add(scale(UP, Math.cos(a)), scale([1, 0, 0], Math.sin(a))));
    const dir = unit(lerpV(dirOf(Math.PI + (i / (count - 1) - 0.5) * 0.75, -0.25), add(spread, [0, 0, fore ? -0.2 : -0.28]), fan));
    // (Closed, the middle feathers run longest, so the train comes to a point behind; spread, they make an even fan.)
    const tip = above(madd(body.T, dir, b.tailLen * size * mix(0.62 + 0.38 * Math.cos(a * 1.6), (fore ? 0.74 : 1) * (0.88 + 0.12 * Math.cos(a)), fan)), body.r * 0.42);
    // (Each feather a thin shaft at its root and broad toward its end; its shaft, barbs and eye are the renderer's to paint.)
    cap(kit, `train.${String(i)}`, fan > 0.3 ? "shell" : "alt", body.T, tip, body.r * 0.07, 0.14, unit(lerpV(UP, [0, 0, 1], fan), UP), { r1: body.r * mix(0.5, fore ? 0.82 : 0.95, fan), melt: mix(1, 0.08, fan) });
    // Closed, its eyespots show down each feather, a dark heart in each gold eye.
    if (fan <= 0.3) for (const [role, wide, detail] of [["accent", 0.13, undefined], ["dark", 0.06, 1]] as const) cap(kit, `eyespot.${String(i)}`, role, lerpV(body.T, tip, 0.4 + (i % 2) * 0.08), lerpV(body.T, tip, 0.96), body.r * wide, 1, UP, { row: 4, decal: true, ...(detail === undefined ? {} : { detail }) });
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
  trainFeathers(kit, who, body, m, above);
}

/** Plumage painted on: a kookaburra's brown mantle over its pale body. */
function birdMarks(kit: Kit, who: Who, body: BirdBody): void {
  const id = who.member.species;
  const over: Vec = [0, Math.cos(body.pitch), -Math.sin(body.pitch)];
  if (id === "kookaburra") decal(kit, "mantle", "alt", madd(body.T, over, body.r * 0.75), madd(body.K, over, body.r * 0.6), body.r * 0.62);
}

/** The body: a drawn one follows its kind's back and keel, the breast a patch of colour on its front-and-under side (whichever way it is tipped), not a lump. */
function birdTorso(kit: Kit, b: Build, body: BirdBody): void {
  const under: Vec = [0, -Math.cos(body.pitch), Math.sin(body.pitch)];
  if (!b.torso) {
    cap(kit, "body", "coat", body.T, body.K, body.r);
    ball(kit, "breast", "belly", madd(lerpV(body.C, body.K, 0.55), under, body.r * 0.32), body.r * 0.86);
    return;
  }
  loft(kit, "body", "coat", b.torso, (k) => lerpV(body.T, body.K, k), scale(under, -1), [1, 0, 0], body.r, 1);
  ball(kit, "breast", "belly", madd(lerpV(body.C, body.K, 0.55), under, body.r * 0.38), body.r * 0.74);
}

/** An owl's pale underside, breast and feathered legs: a great horned owl's buff (its white kept for its bib), barred. */
const owlUnder = (coat: string): Role => (coat === "great horned" ? "shell" : "belly");

/**
 * An owl's body: a compact upright bullet, its head sunk into broad shoulders
 * and a near straight barrel below them, with a soft ruff of chest feathers
 * under its face; its pale underside painted down its front and round under
 * its wings, so the wing's own edge is where the coat begins, and under the
 * coat's pattern so it is still barred or speckled (a snowy owl's over its
 * bars and short of its belly, its chest plain white and its flanks marked).
 */
function owlTorso(kit: Kit, coat: string, body: BirdBody): void {
  const r = body.r;
  const at = owlAt(body, 1);
  const [top, mid, low] = OWL_TRUNK;
  const ring = (k: readonly [number, number, number]): Vec => at(k[0], 0, k[2]);
  const over = sub(at(0, 0, 1), at(0, 0, 0));
  const snowy = coat === "snowy";
  cap(kit, "body", "coat", ring(mid), ring(top), r * mid[1], OWL_DEEP, over, { r1: r * top[1] * owlShapeOf(coat).chest });
  cap(kit, "belly", "coat", ring(mid), ring(low), r * mid[1], OWL_DEEP, over, { r1: r * low[1] });
  // (Its bars first, so they lie over the plain white of its breast.)
  if (snowy) owlBars(kit, body);
  cap(kit, "breast", owlUnder(coat), at(snowy ? 0.3 : -1.7, 0, -0.75), at(0.55, 0, -0.62), r * (snowy ? 0.7 : 1.4), 1, UP, { r1: r * (snowy ? 0.8 : 1.06), decal: true, under: !snowy });
}

/**
 * A great horned owl's white throat: a broad band under its face and turning
 * with it, painted after the face so the face stays over it and only a
 * crescent shows below the disc, its horns rising to either side.
 */
function owlBib(kit: Kit, h: Head): void {
  cap(kit, "bib", "accent", at3(h, 0.5, -0.5, -0.92), at3(h, 0.5, 0.5, -0.92), h.r * 0.5, 1, UP, { decal: true });
}

/**
 * An owl's legs by coat: the thigh's radius, the shank's, a toe's and a
 * claw's, in body radii, and what colour its toes are: a barn owl's slim and
 * pale, a great horned owl's thick and feathered on big dark talons, a snowy
 * owl's white feather mitts with only the claws' tips showing black.
 */
interface OwlLeg { readonly thigh: number; readonly shank: number; readonly toe: number; readonly claw: number; readonly skin: Role }
const OWL_LEG: OwlLeg = { thigh: 0.46, shank: 0.2, toe: 0.11, claw: 0.075, skin: "belly" };
const OWL_LEGS: Readonly<Record<string, OwlLeg>> = {
  barn: { ...OWL_LEG, thigh: 0.42, shank: 0.13, toe: 0.095, claw: 0.06, skin: "horn" },
  "great horned": { ...OWL_LEG, shank: 0.25, toe: 0.12, claw: 0.095, skin: "shell" },
  snowy: { ...OWL_LEG, thigh: 0.5, shank: 0.28, toe: 0.14, claw: 0.05 },
};

/**
 * An owl's foot, under its belly: a feathered thigh melted into it, standing
 * out a little past its flank as a soft tuft and breaking the shade that
 * gathers there, tapering to its shank on a chunky foot of three toes, each
 * with a dark hooked claw.
 */
function owlFoot(kit: Kit, who: Who, body: BirdBody, x: number, foot: Vec): void {
  const r = body.r;
  const L = x < 0 ? "L" : "R";
  const leg = OWL_LEGS[who.member.coat] ?? OWL_LEG;
  const heel = add(foot, [0, r * 0.13, 0]);
  cap(kit, `leg.${L}`, owlUnder(who.member.coat), owlAt(body, x)(-1.06, 0.56, -0.04), heel, r * leg.thigh, 1, UP, { r1: r * leg.shank, melt: 0.65 });
  for (const [k, yaw, len] of [[0, -0.6, 0.42], [1, 0, 0.5], [2, 0.6, 0.42]] as const) {
    const dir = dirOf(yaw + x * 0.14, -0.1);
    const tip = madd(heel, dir, r * len);
    // (Crisp, so the breast's paint never reaches down onto them.)
    cap(kit, `leg.${L}.toe${String(k)}`, leg.skin, heel, tip, r * leg.toe, 1, UP, { r1: r * leg.toe * 0.82, melt: 0 });
    // (A hooked claw, curling down to grip, crisp so the toe's colour never pales it.)
    cap(kit, `leg.${L}.claw${String(k)}`, "dark", madd(tip, dir, r * leg.toe * 0.3), madd(madd(tip, dir, r * 0.17), UP, -r * 0.1), r * leg.claw, 1, UP, { r1: r * 0.015, melt: 0 });
  }
}

/** Where a snowy owl's two bold chevrons lie on its belly, each tip how far `up` and `out` as `owlAt` takes them: big enough to last at a sprite's size, and breaking the shade that gathers low on its front. */
const OWL_BELLY_MARKS = [[-0.4, -0.5], [-0.74, 0.3]] as const;

/** A snowy owl's chevrons, each a V cupped down the lie (its pattern's own, finer ones leave a front nearly bare). */
function owlBars(kit: Kit, body: BirdBody): void {
  const at = owlAt(body, 1);
  // (Each end on the curve of its belly, so both arms of the V lie on it.)
  const on = (up: number, out: number): Vec => at(up, out, 0.16 - 0.88 * Math.sqrt(Math.max(0, 1 - (out * out) / 1.15)));
  OWL_BELLY_MARKS.forEach(([up, out], i) => {
    for (const x of [-1, 1]) cap(kit, `bar.${String(i)}${x < 0 ? "L" : "R"}`, "dark", on(up, out), on(up + 0.18, out + x * 0.32), body.r * 0.06, 1, UP, { r1: body.r * 0.04, decal: true, melt: 0.7 });
  });
}

/** A barn owl's grey veil, soft and broken over its gold: down its crown and across its back and wings. */
function owlVeil(kit: Kit, body: BirdBody, h: Head): void {
  const at = owlAt(body, 1);
  cap(kit, "veil.crown", "alt", at3(h, -0.5, 0, 0.8), at3(h, -0.95, 0, 0.2), h.r * 0.56, 1, UP, { decal: true, melt: 1.7 });
  cap(kit, "veil.back", "alt", at(0.5, 0, 1.05), at(-0.6, 0, 1.15), body.r * 0.8, 1, UP, { decal: true, melt: 1.7 });
}

function poseBird(kit: Kit, who: Who, m: Moment): void {
  const body = birdSpine(who, m);
  if (who.member.species === "owl") owlTorso(kit, who.member.coat, body);
  else birdTorso(kit, who.spec.build, body);
  birdMarks(kit, who, body);
  const head = birdHead(kit, who, body, m);
  birdFace(kit, who, head, m);
  if (who.member.coat === "great horned") owlBib(kit, head);
  for (const x of [-1, 1]) wingOf(kit, who, body, x, m);
  if (who.member.species === "owl" && !body.flying) owlTail(kit, who, body);
  else birdTail(kit, who, body, m);
  birdLegs(kit, who, body, m);
  if (who.member.coat === "barn") owlVeil(kit, body, head);
}

/** The toes a bird stands on, as angles off its front: three splayed ahead, one behind. */
const BIRD_TOES = [-0.52, 0, 0.52, Math.PI] as const;
/** How much foot a body can afford: what its parts budget leaves, for each foot, at each level of detail. */
const footDetail = (kit: Kit): "claws" | "toes" | "foot" => { const room = 48 - kit.out.length - 4; return room >= 16 ? "claws" : room >= 8 ? "toes" : "foot"; };

/** A foot's toes down from the ankle, each drawn out to its own curved claw; with fewer parts to spend, plain toes, or one foot. */
function birdFoot(kit: Kit, part: string, sole: Vec, r: number, detail: ReturnType<typeof footDetail>): void {
  if (detail === "foot") { cone(kit, `${part}.toes`, "horn", add(sole, [0, 0, -r * 2.4]), add(sole, [0, -r * 0.3, r * 5.2]), r * 0.9, r * 0.5, 0.3); return; }
  const low: Vec = [sole[0], sole[1] - r * 0.5, sole[2]];
  BIRD_TOES.forEach((angle, i) => {
    const way: Vec = [Math.sin(angle), 0, Math.cos(angle)];
    const length = r * (i === 3 ? 3.6 : i === 1 ? 6.2 : 5.2);
    const tip = madd(low, way, length);
    cone(kit, `${part}.toe.${String(i)}`, "horn", low, tip, r * 0.72, r * 0.42, 0.3);
    if (detail !== "claws") return;
    cap(kit, `${part}.claw.${String(i)}`, "dark", tip, add(madd(tip, way, r * 2.1), [0, -r * 0.5, 0]), r * 0.4, 1, UP, { r1: r * 0.06, melt: 0.15, bow: [0, r * 0.4, 0] });
  });
}

/**
 * A bird's leg as its bones lie: the hip back under the body, the feathered
 * thigh down to an ankle that bends backward (what looks like a bird's knee),
 * the bare shank down to the foot, and its toes and claws.
 */
function birdLeg(kit: Kit, part: string, body: BirdBody, x: number, foot: Vec, legH: number, detail: ReturnType<typeof footDetail>): void {
  const hip = add(lerpV(body.C, body.T, 0.2), [x * body.r * 0.4, -body.r * 0.55, 0]);
  const r = Math.max(0.005, body.r * 0.085);
  const sole: Vec = [foot[0], foot[1] + r, foot[2]];
  const { mid } = solveTwoBone(hip, sole, legH * 0.62, legH * 0.62, [0, 0, -1]);
  cone(kit, `${part}.thigh`, "coat", hip, mid, body.r * 0.34, r * 1.4, 0.7);
  cone(kit, `${part}.shank`, "horn", mid, sole, r * 1.2, r, 0.3);
  birdFoot(kit, part, sole, r, detail);
}

/** A bird's legs: tucked in or trailed behind in the air, on the ground walking or standing (an owl's feathered, on talons). */
function birdLegs(kit: Kit, who: Who, body: BirdBody, m: Moment): void {
  const b = birdBuild(who);
  const size = who.member.size;
  const legH = b.leg * size;
  // A long-legged bird trails its legs out behind it in the air; others tuck them in.
  const trails = legH > body.r * 2.5;
  const detail = footDetail(kit);
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
    if (who.member.species === "owl") { owlFoot(kit, who, body, x, foot); continue; }
    birdLeg(kit, `leg.${x < 0 ? "L" : "R"}`, body, x, foot, legH, detail);
  }
}

// ---------------------------------------------------------------- snakes and lizards

/** A point `back` along an animal's trail, in its own frame; past the trail's end, straight on the way it was going. */
function onTrail(m: Moment, back: number): Vec {
  const way = m.trail ?? [];
  let left = back;
  let at: Vec = way[0] ?? m.frame.o;
  let last: Vec = [0, 0, -1];
  for (const next of way.slice(1)) {
    const span = length(sub(next, at));
    if (span < 1e-6) continue;
    last = scale(sub(next, at), 1 / span);
    if (span >= left) break;
    left -= span;
    at = next;
  }
  const { o, x, y, z } = m.frame;
  const from = sub(madd(at, last, left), o);
  return [dot(from, x), dot(from, y), dot(from, z)];
}

function serpentSpine(who: Who, m: Moment): Vec[] {
  const q = m.pose;
  const b = who.spec.build;
  const size = who.member.size;
  const lizard = b.leg > 0;
  const n = lizard ? 8 : 12;
  const r0 = b.body * size;
  const seg = size / n;
  // (A coil wants the ground: on the wood it stays laid along the branch.)
  const flat = lizard || m.trail ? 0 : q.curl;
  const points: Vec[] = [];
  for (let i = 0; i <= n; i += 1) {
    const moving = m.moving * Math.sin(TAU * m.phase * 0.8 - i * 0.7) * size * 0.06 * (lizard ? 0.4 : 1) * Math.min(1, i / 3);
    // At rest a snake lies in a loose S, a lizard nearly straight.
    const rest = size * (lizard ? 0.07 : 0.12) * Math.sin(i * (lizard ? 0.55 : 0.62) + 0.2 * Math.sin(m.t * 0.3)) * (1 - m.moving);
    const straight: Vec = m.trail ? add(onTrail(m, i * seg), [moving * 0.3, r0, 0]) : [moving + rest, r0, -i * seg * 0.95];
    // Coiled, one loose turn (an open ring at a distance, not a disc), the head reared up in the middle.
    const a = i * 0.55;
    const ring = r0 * (8.5 - i * 0.42);
    const coil: Vec = [Math.cos(a) * ring, r0 + (n - i) * r0 * 0.2, Math.sin(a) * ring - r0 * 8.5];
    const lift = Math.max(0, 3 - i) / 3;
    const rear = flat === 0 ? 0 : q.curl * lift * size * 0.14;
    points.push(add(lerpV(straight, coil, flat), [0, rear + lift * (q.headPitch * size * 0.08 + q.mouth * size * 0.02), 0]));
  }
  return points;
}

/** A snake's girth along it, 0 at the neck, 1 at the tip: slim at the neck, fullest a third of the way down, to a fine tip. */
const snakeGirth = (k: number): number => (k < 0.3 ? 0.78 + (k / 0.3) * 0.22 : 1 - Math.pow((k - 0.3) / 0.7, 1.6) * 0.85);

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
    const taper = snakeGirth(i / n);
    cap(kit, `body.${i}`, banded && i % 2 === 1 ? "alt" : "coat", a, c, r0 * taper, 0.8, UP, { r1: r0 * snakeGirth((i + 1) / n) });
    if (b.extras.includes("spots") && i % 2 === 0) ball(kit, "spot", "accent", add(lerpV(a, c, 0.5), [0, r0 * taper * 0.6, 0]), r0 * taper * 0.35, 0.5);
  }
  if (b.leg === 0) snakeMarks(kit, who, points, r0);
  serpentHead(kit, who, points, m);
  if (b.leg > 0) lizardLegs(kit, who, points, m);
}

/** How a snake is marked, by coat: long lines down it or saddles across it. A plain one is its colour, and a banded one its rings. */
const SNAKE_LINES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  garter: [[0, 0.94], [-0.8, 0.5], [0.8, 0.5]],
  "red-bellied": [[-0.86, -0.2], [0.86, -0.2]],
};
const SNAKE_SADDLED: ReadonlySet<string> = new Set(["corn"]);

/** Which way is out to the side of a spine going from `a` to `b`. */
const spineSide = (a: Vec, b: Vec): Vec => unit(cross(UP, sub(b, a)));

/** The long lines down a snake, laid on it every other bone so they follow its bends. */
function snakeLines(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  const lines = SNAKE_LINES[who.member.coat] ?? [];
  const role: Role = who.member.coat === "garter" ? "alt" : "belly";
  const n = points.length - 1;
  for (let i = 0; i + 2 <= n; i += 2) {
    const [a, c] = [points[i], points[i + 2]];
    if (!a || !c) continue;
    const side = spineSide(a, c);
    const [gA, gC] = [r0 * snakeGirth(i / n), r0 * snakeGirth((i + 2) / n)];
    const on = (p: Vec, x: number, y: number, g: number): Vec => add(add(p, scale(side, x * g * 0.8)), [0, y * g * 0.8, 0]);
    // (Sunk well into the body, so the line stays on the skin where the bones bend away from a straight run.)
    lines.forEach(([x, y], line) => { cap(kit, `line.${line}`, role, on(a, x, y, gA), on(c, x, y, gC), gA * 0.24, 1, UP, { decal: true, r1: gC * 0.24 }); });
  }
}

/** Saddles across a snake's back, as many and as far apart as its own mark says. */
function snakeSaddles(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  const gene = createRandom(markOf(who) ^ 0x6c8e9cf5);
  const n = points.length - 1;
  const gap = mix(1.5, 2.3, gene());
  for (let k = 1 + gene(); k < n - 1.5; k += gap) {
    const i = Math.floor(k);
    const [a, c] = [points[i], points[i + 1]];
    if (!a || !c) continue;
    const at = add(lerpV(a, c, k - i), [0, r0 * 0.8, 0]);
    const side = scale(spineSide(a, c), r0 * mix(0.5, 0.8, gene()) * (1 - k / n / 2));
    decal(kit, "saddle", "alt", sub(at, side), add(at, side), r0 * 0.42);
  }
}

function snakeMarks(kit: Kit, who: Who, points: readonly Vec[], r0: number): void {
  snakeLines(kit, who, points, r0);
  if (SNAKE_SADDLED.has(who.member.coat)) snakeSaddles(kit, who, points, r0);
}

function serpentHead(kit: Kit, who: Who, points: readonly Vec[], m: Moment): void {
  const b = who.spec.build;
  const size = who.member.size;
  const r0 = b.body * size;
  const head = points[0] ?? [0, r0, 0];
  const hd = unit(sub(head, points[1] ?? [0, r0, -1]));
  const h: Head = { c: madd(head, hd, b.head * size * 0.4), d: hd, ...headAxes(hd, 0), r: b.head * size, ...eyeOfSpecies(who) };
  // (A wedge, broad behind the jaws and flat, wider than the neck it sits on.)
  cap(kit, "head", "coat", at3(h, -0.35, 0, 0), at3(h, 0.8, 0, -0.08), h.r * 0.92, 0.62, h.u, { r1: h.r * 0.52, melt: 0.8 });
  // (Set into the flat of the head's side, not on the sphere an eye usually sits on.)
  for (const x of [-1, 1]) eyeAt(kit, `eye.${x < 0 ? "L" : "R"}`, h, at3(h, 0.3, x * 0.7, 0.2), unit(add(scale(h.s, x), scale(h.u, 0.5))), h.r * 0.2, true);
  if (m.pose.mouth > 0.2 && m.segment.act === "flick") cap(kit, "tongue", "accent", at3(h, 1, 0, -0.1), madd(at3(h, 1, 0, -0.1), hd, h.r * 1.4 * m.pose.mouth), h.r * 0.08);
}

/** A gecko's foot: five thin toes spread from the wrist, each ending in a round sticky pad. */
function geckoFoot(kit: Kit, part: string, at: Vec, r0: number, x: number, fore: boolean): void {
  const flat: Vec = [at[0], r0 * 0.1, at[2]];
  const lean = fore ? 1 : -0.3;
  const [a, b] = [add(flat, [-r0 * 0.34, 0, r0 * 0.12 * lean]), add(flat, [r0 * 0.34, 0, r0 * 0.12 * lean])];
  const reach: Vec = [x * r0 * 0.3, 0, r0 * 0.62 * lean];
  cap(kit, `${part}.toes`, "coat", a, b, r0 * 0.085, 1, UP, { row: 5, reach, melt: 0.2, shadow: false });
  cap(kit, `${part}.pads`, "coat", add(a, reach), add(b, reach), r0 * 0.15, 0.6, UP, { row: 5, melt: 0.1, shadow: false, detail: 1 });
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
      const wide: Vec = [foot[0] + x * size * 0.1, foot[1], foot[2]];
      limb(kit, `leg.${leg}`, "coat", add(body, [x * r0 * 0.8, r0 * 0.1, 0]), wide, [size * 0.13, size * 0.13], r0 * 0.27, [x, 1, 0], "coat");
      geckoFoot(kit, `leg.${leg}`, wide, r0, x, k === "F");
    }
  }
}

// ---------------------------------------------------------------- insects

/** Where a bug's body is: drifting over its spot, settled on a leaf, or flying between, at the same heights. */
/** A firefly's own spot in the air, off its seed: anywhere round it, near or well out, low or high. */
const fireflySpot = (seed: number): Vec => {
  const out = 0.7 + 1.1 * ((seed * 13) % 1);
  return [Math.cos(seed * TAU) * out, 0.2 + 0.8 * ((seed * 37) % 1), Math.sin(seed * TAU) * out];
};

function bugCentre(who: Who, m: Moment): Vec {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const drift: Vec = [Math.sin(t * 0.6 + phase) * 0.35, Math.sin(t * 0.9 + phase * 2) * 0.18, Math.cos(t * 0.5 + phase) * 0.35];
  // (Fireflies hang well apart over the grass, never in a clump.)
  // (Each keeps a spot of its own in the air, so a pack is spread through the dusk and never a heap on the grass.)
  const wander = firefly ? add(fireflySpot(ownPhase(who)), scale(drift, 1.4)) : scale(drift, 0.3);
  if (m.mode !== "fly") return m.segment.act === "sit" && !firefly ? [0, size * 0.1, 0] : add([0, 0.35 + m.pose.lift * 0.4, 0], wander);
  const airy = (place: Place): number => (place.on === "ground" ? 0.35 + m.pose.lift * 0.4 : size * 0.1);
  const flying = mix(airy(m.segment.from), airy(m.segment.to), smooth(clamp((t - m.segment.t0) / Math.max(0.01, m.segment.t1 - m.segment.t0), 0, 1)));
  const grounded = m.segment.from.on === "ground" || m.segment.to.on === "ground";
  return add([0, flying + Math.sin(t * 9 + phase) * size * 0.6 * m.moving, 0], grounded ? scale(wander, 1 - m.moving) : [0, 0, 0]);
}

/** A butterfly's wing, drawn flat: a dark margin, its colour set inside it, pale spots along the edge. */
function butterflyWing(kit: Kit, part: string, root: Vec, tip: Vec, r: readonly [number, number], normal: Vec, spots: number): void {
  const shape = (name: string, role: Role, to: Vec, k: number, flat: number): void => { cap(kit, `${part}.${name}`, role, root, to, r[0] * k, flat, normal, { r1: r[1] * k, melt: 0 }); };
  shape("edge", "alt", tip, 1, 0.08);
  shape("colour", "coat", lerpV(root, tip, 0.86), 0.8, 0.13);
  const across = unit(cross(normal, sub(tip, root)));
  for (let k = 0; k < spots; k += 1) ball(kit, `${part}.spot`, "accent", madd(tip, across, r[1] * ((k + 0.5) / spots - 0.5) * 1.5), r[1] * 0.12, 0.8, normal);
}

/** A firefly's wings: hard dark cases over its back, parted as it flies. */
function fireflyWing(kit: Kit, part: string, C: Vec, dir: Vec, fw: Vec, normal: Vec, size: number): void {
  cap(kit, part, "coat", madd(C, fw, size * 0.12), add(madd(C, dir, size * 0.32), scale(fw, -size * 0.3)), size * 0.08, 0.14, normal, { r1: size * 0.11, melt: 0 });
}

function poseBug(kit: Kit, who: Who, m: Moment): void {
  const size = who.member.size;
  const t = m.t;
  const phase = size * 977;
  const firefly = who.spec.build.extras.includes("glowtail");
  const perched = m.segment.act === "sit";
  const C = bugCentre(who, m);
  const fw: Vec = [0, 0, 1];
  const gene = createRandom(markOf(who) ^ 0x4b1f6a27);
  const spots = 2 + Math.floor(gene() * 3);
  const sweep = mix(-0.04, 0.08, gene());
  cap(kit, "abdomen", "dark", madd(C, fw, -size * 0.04), madd(C, fw, -size * 0.42), size * 0.055, 1, UP, { r1: size * 0.024 });
  ball(kit, "thorax", "dark", madd(C, fw, size * 0.08), size * 0.085);
  ball(kit, "head", "dark", madd(C, fw, size * 0.24), size * 0.058);
  if (firefly) {
    const blink = pulse(t + phase, 2.4 + (phase % 1.7), 0.9);
    // (The lantern is its tail end; lit, it swells past the bug itself, or a grove's pixels would never catch it.)
    cap(kit, "lantern", "glow", madd(C, fw, -size * 0.28), madd(C, fw, -size * 0.5), size * (0.1 + 0.5 * blink), 1, UP, { r1: size * (0.085 + 0.45 * blink), shadow: false });
  }
  const open = perched ? 1.35 + 0.2 * Math.sin(t * 1.4 + phase) : 0.15 + 1.1 * (0.5 + 0.5 * Math.sin(t * (firefly ? 30 : 19) + phase));
  for (const x of [-1, 1]) {
    const dir = unit(add(scale([x, 0, 0], Math.cos(open)), scale(UP, Math.sin(open))));
    const normal = unit(cross(dir, fw), UP);
    const side = x < 0 ? "L" : "R";
    if (firefly) fireflyWing(kit, `wing.${side}`, C, dir, fw, normal, size);
    else {
      // A forewing swept forward, a rounder hindwing behind it, overlapping as they do.
      butterflyWing(kit, `wing.${side}`, madd(C, fw, size * 0.1), add(madd(C, dir, size * 0.74), scale(fw, size * (0.26 + sweep))), [size * 0.07, size * 0.27], normal, spots);
      butterflyWing(kit, `hindwing.${side}`, madd(C, fw, size * 0.02), add(madd(C, dir, size * 0.46), scale(fw, -size * 0.26)), [size * 0.07, size * 0.25], normal, spots - 1);
    }
    const tip = add(madd(C, fw, size * 0.62), [x * size * 0.2, size * 0.2, 0]);
    cap(kit, "antenna", "dark", madd(C, fw, size * 0.28), tip, size * 0.011, 1, UP, { melt: 0, shadow: false });
    ball(kit, "antenna.club", "dark", tip, size * 0.024);
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
  // (Its shell wider than long, flat over a low belly, its front edge drawn straight across between the eyes.)
  cap(kit, "body", "coat", add(C, [-r * 0.5, 0, -r * 0.08]), add(C, [r * 0.5, 0, -r * 0.08]), r * 0.86, 0.46, UP, { melt: 0.3 });
  cap(kit, "brow", "coat", add(C, [-r * 0.82, r * 0.06, r * 0.5]), add(C, [r * 0.82, r * 0.06, r * 0.5]), r * 0.22, 0.5, UP, { melt: 0.5 });
  cap(kit, "belly", "belly", add(C, [-r * 0.5, -r * 0.2, 0]), add(C, [r * 0.5, -r * 0.2, 0]), r * 0.66, 0.34, UP, { melt: 0.2 });
  for (const x of [-1, 1]) {
    const stalk = add(C, [x * r * 0.26, r * 0.2, r * 0.68]);
    cap(kit, "eyestalk", "coat", stalk, add(stalk, [x * r * 0.04, r * 0.34, r * 0.05]), r * 0.06);
    ball(kit, "eye", "pupil", add(stalk, [x * r * 0.04, r * 0.4, r * 0.05]), r * 0.1);
    ball(kit, "eye.shine", "shine", add(stalk, [x * r * 0.04, r * 0.47, r * 0.1]), r * 0.03);
    crabLegs(kit, C, x, r, legLen, who, m);
    crabClaw(kit, C, x, r, who.member.coat === "fiddler" ? (x > 0 ? 2.2 : 0.6) : 1, x > 0 ? q.reach : 0, q.hand);
  }
}

/** Four walking legs down a side, thin and jointed high, each ending in a sharp point on the sand. */
function crabLegs(kit: Kit, C: Vec, x: number, r: number, legLen: number, who: Who, m: Moment): void {
  for (let i = 0; i < 4; i += 1) {
    const z = (i - 1.6) * r * 0.42;
    const step = footCycle(m.phase - i / 4 - (x > 0 ? 0.5 : 0), 0.5, 0.5 * bodyStride(who) * m.moving, legLen * 0.3);
    const foot: Vec = [x * (r * 1.25 + legLen * 0.8) + step.z, step.y, z * 1.5];
    const root = add(C, [x * r * 1.05, -r * 0.05, z]);
    const { mid, end } = solveTwoBone(root, foot, legLen * 0.62, legLen * 0.62, [x, 1, 0]);
    cone(kit, `leg.${String(x)}.${String(i)}.upper`, "alt", root, mid, r * 0.1, r * 0.075, 0.2);
    cap(kit, `leg.${String(x)}.${String(i)}.lower`, "alt", mid, end, r * 0.075, 1, UP, { r1: r * 0.012, melt: 0.1 });
  }
}

/** A claw: an arm folded in front of the face, a swollen palm, a fixed finger and a moving one that open and close on each other. (A fiddler's one claw is huge, and it is the one it waves.) */
function crabClaw(kit: Kit, C: Vec, x: number, r: number, big: number, wave: number, open: number): void {
  const root = add(C, [x * r * 1.0, 0, r * 0.55]);
  const palm = add(C, [x * r * 0.86, r * 0.1 + wave * r * 1.5, r * 1.3]);
  const { mid } = solveTwoBone(root, palm, r * 0.62, r * 0.62, [x, 0, -0.4]);
  cone(kit, `claw.${String(x)}`, "coat", root, mid, r * 0.14, r * 0.17 * Math.sqrt(big), 0.3);
  cone(kit, `claw.${String(x)}.wrist`, "coat", mid, palm, r * 0.17 * Math.sqrt(big), r * 0.22 * big, 0.3);
  const way: Vec = [-x * 0.3, 0, 1];
  cap(kit, "pincer", "coat", palm, madd(palm, way, r * 0.3 * big), r * 0.25 * big, 0.72, [1, 0, 0], { r1: r * 0.2 * big, melt: 0.3 });
  const base = madd(palm, way, r * 0.3 * big);
  const gape = (0.18 + open * 0.3) * r * big;
  cap(kit, "pincer.tip", "accent", add(base, [0, -r * 0.08 * big, 0]), add(madd(base, way, r * 0.62 * big), [0, -r * 0.05 * big, 0]), r * 0.15 * big, 1, UP, { r1: r * 0.015, bow: [0, -r * 0.05 * big, 0], melt: 0.15 });
  cap(kit, "pincer.tip", "accent", add(base, [0, r * 0.1 * big, 0]), add(madd(base, way, r * 0.56 * big), [0, gape, 0]), r * 0.12 * big, 1, UP, { r1: r * 0.015, bow: [0, r * 0.06 * big, 0], melt: 0.15 });
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
/**
 * Eyes by species: the pupil's shape (a hunter's slit, a grazer's bar, a
 * small mammal's or a songbird's eye nearly all pupil, a raccoon's a plain dark
 * bead with one hard spark on it, round otherwise), the
 * eye's size against the usual (a mouse's and a loris's big, a bear's small)
 * and whether a dark rim frames it (an owl's face disc and a parrot's bare
 * ring frame their own).
 */
interface EyeStyle {
  readonly pupil: "round" | "slit" | "bar" | "dark" | "bead"; readonly size: number; readonly rim: boolean; readonly almond: number;
  /** Set low in the face, a flat dome with its spark on it: past the edge of the head it hides, and no fleck of it shows on the rim. */
  readonly set?: boolean;
  /** Its upper lid's share of the eye, where its pupil's usual one will not do, and its spark's size, a share of the eye (a tortoise's heavy lid and clear catchlight). */
  readonly lid?: number; readonly spark?: number;
  /** Its lid is bare skin, not the coat (a macaque's). */
  readonly skinLid?: boolean;
}
const EYE: EyeStyle = { pupil: "round", size: 1, rim: true, almond: 1 };
const eye = (pupil: EyeStyle["pupil"], size = 1, rim = true, almond = 1): EyeStyle => ({ pupil, size, rim, almond });
/** A bird's, a snake's, a lizard's eye is round, not an almond. */
const roundEye = (pupil: EyeStyle["pupil"], size = 1, rim = true): EyeStyle => eye(pupil, size, rim, 0);
const EYES: Partial<Record<SpeciesId, EyeStyle>> = {
  fox: eye("slit", 1.15), cat: eye("slit"), gecko: roundEye("slit", 1.2), snake: roundEye("slit", 1.05, false),
  deer: eye("bar", 1.15), dikdik: eye("bar", 1.3), mongoose: eye("bar"),
  rabbit: eye("dark", 1.2), mouse: eye("dark", 1.35), hedgehog: { ...roundEye("bead", 0.86, false), set: true }, squirrel: eye("dark", 1.15), marmot: eye("dark"), meerkat: eye("dark", 1.1),
  capybara: eye("dark", 0.9), kangaroo: eye("dark", 1.1), raccoon: roundEye("bead", 0.72, false), redpanda: eye("dark"), tanuki: eye("dark"), badger: eye("dark", 0.8),
  skunk: eye("dark", 0.95), possum: eye("dark", 1.3), sloth: eye("dark", 1, false), loris: eye("dark", 1.7), macaque: { ...eye("round", 1, false, 0.5), lid: 0.56, spark: 0.18, skinLid: true }, monkey: { ...eye("round", 1, false, 0.5), lid: 0.56, spark: 0.18, skinLid: true },
  wolf: eye("round", 1.1), bear: eye("round", 0.8), koala: eye("round", 0.8), tortoise: { ...roundEye("dark", 1.15, false), lid: 0.5, spark: 0.3 },
  songbird: roundEye("dark", 1.1), crow: roundEye("dark"), kookaburra: roundEye("dark", 0.75), woodpecker: roundEye("dark"), peacock: roundEye("dark"), guineafowl: roundEye("dark"),
  owl: roundEye("round", 1, false), parrot: roundEye("round", 1, false), gull: roundEye("round", 0.9, false), crane: roundEye("round", 0.9, false),
};
/** Eyes by coat where a coat has its own: a barn owl's are black, a great horned owl's lemon yellow (orange would make it an eagle-owl). */
const COAT_EYES: Readonly<Record<string, { readonly style: EyeStyle; readonly iris: string }>> = {
  barn: { style: roundEye("dark", 1, false), iris: "#1a120c" }, "great horned": { style: roundEye("round", 1, false), iris: "#f2d21b" },
  snowy: { style: roundEye("round", 1, false), iris: "#f2d030" },
  tawny: { style: roundEye("dark", 1, false), iris: "#1a120c" }, ural: { style: roundEye("dark", 1, false), iris: "#1a120c" },
};
const eyeOfSpecies = (who: Who): Pick<Head, "eye"> => ({ eye: COAT_EYES[who.member.coat]?.style ?? EYES[who.member.species] ?? EYE });

/** A cat's eyes and nose go by its coat: gold on black and orange, green on silver, a red cat's brick nose, a black cat's dark one. */
const CAT_FACES: Readonly<Record<string, { readonly iris: string; readonly nose: string }>> = {
  tabby: { iris: "#d8bc68", nose: "#c07c68" }, black: { iris: "#dcb44c", nose: "#2c2424" },
  grey: { iris: "#a0b078", nose: "#c88c94" }, calico: { iris: "#b8a03c", nose: "#e49c9c" },
};

const IRIS: Partial<Record<SpeciesId, string>> = {
  fox: "#c8861c", wolf: "#d8a22a", cat: "#a8b830", bear: "#5a3418", deer: "#3a2414", tortoise: "#2c1c0e", owl: "#f0a820", gull: "#e8d878", parrot: "#e8d070",
  crow: "#2a2420", snake: "#d8b040", gecko: "#c8a038", raccoon: "#3c2414", crane: "#d84a20", peacock: "#3a2414",
  macaque: "#5e3c20", monkey: "#8a5a2a", koala: "#3a2a1a", kangaroo: "#3a2414", woodpecker: "#4a2c1e", crab: "#1a1410",
  tanuki: "#2a1a10", possum: "#1a1210", loris: "#4a3018", mongoose: "#8a5a1a", kookaburra: "#3a2414", guineafowl: "#5a2414",
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
    case "melanistic": return { ...base, coat: mixColor(coat, "#0c0a0a", 0.75), alt: mixColor(alt, "#0c0a0a", 0.7), belly: mixColor(belly, "#1a1616", 0.65), eye: "#e8c040", shell: mixColor(base.shell, "#0c0a0a", 0.7) };
    case "golden": return { ...base, coat: "#e8b830", alt: "#c08a18", belly: "#f8e088", accent: "#fff0a0", glow: "#ffe060", horn: "#f8d050", shell: "#d8a020" };
    case "spirit": return { ...base, coat: mixColor(coat, "#bff6ff", 0.75), alt: mixColor(alt, "#7fe0ff", 0.7), belly: "#f0ffff", glow: "#9ff4ff", eye: "#ffffff", pupil: "#5ad8ff", accent: mixColor(accent, "#ffffff", 0.5), shell: mixColor(base.shell, "#7fe0ff", 0.7) };
    case "piebald": return { ...base, alt: "#f6f2ea", belly: "#ffffff", shell: "#f6f2ea" };
    case "leucistic": return { ...base, coat: mixColor(coat, "#f4ecdc", 0.72), alt: mixColor(alt, "#e8dcc8", 0.65), belly: mixColor(belly, "#ffffff", 0.6), shell: mixColor(base.shell, "#e8dcc8", 0.65) };
    case "erythristic": return { ...base, coat: mixColor(coat, "#b8482a", 0.55), alt: mixColor(alt, "#8a3018", 0.5), belly: mixColor(belly, "#e8b8a0", 0.4), shell: mixColor(base.shell, "#8a3018", 0.5) };
    case "neon": return { ...base, coat: mixColor(coat, "#16122a", 0.82), alt: mixColor(alt, "#241c44", 0.8), belly: "#2e2650", dark: "#0a0816", accent: "#ff3ad8", glow: "#3af0ff", eye: "#3af0ff", pupil: "#0a0816", horn: "#ff3ad8", shell: mixColor(base.shell, "#241c44", 0.8) };
    case "pastel": return { ...base, coat: mixColor(coat, "#f6c6de", 0.6), alt: mixColor(alt, "#b8d4ff", 0.55), belly: "#fff2f8", accent: "#a8f0dc", horn: mixColor(base.horn, "#f6c6de", 0.5), shell: mixColor(base.shell, "#b8d4ff", 0.55) };
    case "crystal": return { ...base, coat: mixColor(coat, "#d4ecff", 0.65), alt: mixColor(alt, "#9ab4ff", 0.6), belly: "#f4faff", glow: "#e8f4ff", eye: "#9ff4ff", pupil: "#3a6ad8", shell: "#c8dcff" };
    default: return base;
  }
}

/** Part way to its own grey: a plain coat sits in the scene's tones and leaves the loud colours to the tree. */
const muted = (hex: string, k: number): string => { const [r, g, b] = hexRgb(hex); const y = r * 0.3 + g * 0.59 + b * 0.11; return rgbHex([r, g, b].map((c) => mix(c, y, k))); };

/**
 * A black coat painted as pixel art paints one: a cool charcoal at least `floor` light (sRGB luma),
 * so it still has shades to turn in, and only the nose and the ink line are truly black.
 */
const CHARCOAL = "#5a6274";
function charcoal(hex: string, floor: number): string {
  const luma = (h: string): number => { const [r, g, b] = hexRgb(h); return (r * 0.3 + g * 0.59 + b * 0.11) / 255; };
  const y = luma(hex);
  return y >= floor ? hex : mixColor(hex, CHARCOAL, (floor - y) / Math.max(0.01, luma(CHARCOAL) - y));
}

/** Eye and nose: by coat where a coat has its own; a nose is its animal's dark, a cat's pink unless its coat says otherwise. */
function faceColors(id: SpeciesId, coatName: string, accent: string, dark: string): Pick<Palette, "eye" | "nose"> {
  const own = id === "cat" ? CAT_FACES[coatName] : undefined;
  return { eye: COAT_EYES[coatName]?.iris ?? own?.iris ?? IRIS[id] ?? "#3a2a1e", nose: id === "cat" ? own?.nose ?? accent : dark };
}

/** Whether a species' horn is its claws, a darker thing than a deer's antler or a tortoise's nail. */
const clawed = (id: SpeciesId): boolean => { const b = SPECIES[id].build; return SPECIES[id].plan === "quad" && b.foot !== "hoof" && !b.extras.includes("shell"); };

function paletteOf(id: SpeciesId, colors: CoatColors, morph: Morph, coatName = ""): Palette {
  const plain = morph === "normal" ? 0.32 : 0;
  const [coat, alt, belly, dark, accent] = colors.map((hex, i) => (i < 3 ? muted(hex, plain) : hex)) as unknown as CoatColors;
  const base: Palette = { coat, alt, belly, dark, accent, ...faceColors(id, coatName, accent, dark), pupil: id === "raccoon" ? IRIS.raccoon ?? "#070505" : "#070505", shine: "#ffffff", glow: accent, horn: COAT_BEAKS[coatName] ?? BEAKS[id] ?? (clawed(id) ? "#5e5044" : "#cbb38c"), shell: COAT_SHELLS[coatName] ?? alt };
  const skin = skinOf(base, morph);
  // Neon is dark on purpose: its glow carries it.
  if (morph === "neon") return skin;
  const lift = blackLift(id, coatName);
  const lifted = { coat: charcoal(skin.coat, 0.25 * lift), alt: charcoal(skin.alt, 0.19 * lift), belly: charcoal(skin.belly, 0.34 * lift) };
  // (A spread train wears the shell, so a feather's paint stops at the feathers and never lands on the wings.)
  return { ...skin, ...lifted, ...(id === "peacock" ? { shell: lifted.alt } : {}) };
}

/**
 * How far a black coat is lifted toward charcoal: a bird's stays near black (sleek feathers, which
 * sdf-body's sheen and rim already pick out, where a wolf's fur needs lifting to read), and a black
 * cat's nearly all the way, the blackest thing about, its eyes bright in it.
 */
function blackLift(id: SpeciesId, coatName: string): number {
  if (SPECIES[id].plan === "bird") return 0.5;
  return id === "cat" && coatName === "black" ? 0.3 : 1;
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
  /** This animal's own mark: all 32 bits seed how its coat and markings grow, so no two are the same. */
  readonly mark: number;
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
  /** The coat each of those wears: its region's own (a jungle crow over Tokyo, a silver gull over Sydney). */
  readonly coats: { readonly birds: string; readonly vee: string; readonly swarm: string };
  /** Where the sky is, for the flyers' local names. */
  readonly region: RegionId | null;
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
const TOY = 1.4;
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
  owl: { tawny: ["#8a5a34", "#5a3a20", "#c8a07a", "#1e140a", "#c8a07e"], ural: ["#b8b0a0", "#8a8070", "#e8e4dc", "#2a2620", "#ece8e0"] },
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

/** A species' casting weight in a region (and, given one, a world), as `castFor` weighs it; 0 where it does not live. */
export function regionWeight(id: SpeciesId, region: RegionId, world?: WorldKey): number {
  const spec = speciesOf(id);
  if (!spec.regions.includes(region) || (world && !spec.worlds.includes(world))) return 0;
  return spec.weight * (LOCAL_WEIGHT[region][id] ?? 1) * (world ? WORLD_WEIGHT[world]?.[id] ?? 1 : 1);
}

/** One animal's own make and manner (see `Traits`); the young have big heads, short muzzles and legs, and play more. */
function traitsOf(rand: (() => number) | null, young: boolean, sex?: Traits["sex"]): Traits {
  // (With no stream, the kind's own make: a gallery's or a test's animal, a stag rather than a doe.)
  const jit = (spread: number): number => (rand ? 1 + (rand() * 2 - 1) * spread : 1);
  const drawn = !rand || rand() < 0.5 ? "male" : "female";
  const t = { len: jit(0.05), leg: jit(0.06), body: jit(0.07), head: jit(0.05), snout: jit(0.08), neck: jit(0.06), tail: jit(0.12), ears: jit(0.1), tempo: jit(0.1), bold: jit(0.28), lively: jit(0.22), mark: rand ? Math.floor(rand() * 4294967296) : 1 };
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
  return { species: id, label: lookLabel(id, coat, contextOf(input).region), size, heft, coat, palette: paletteOf(id, varied(colors, rand, young), morph, coat), morph, young, horned, traits };
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
  // (Weighed as the ground cast is weighed here: crows over Tokyo, gulls over the Atlantic.)
  const local = (id: SpeciesId): number => (FLOCK_WEIGHTS[id] ?? 1) * (ctx.region ? LOCAL_WEIGHT[ctx.region][id] ?? 1 : 1);
  const birds = flockers.length > 0 ? pick(rand, flockers.map((id) => [id, local(id)] as const)) : null;
  const vee = BIRDS_FOR.vee.find(here) ?? null;
  const swarm = BIRDS_FOR.murmuration.find(here) ?? null;
  const has: Partial<Record<SkyKind, boolean>> = { flock: birds !== null, vee: vee !== null, murmuration: swarm !== null };
  const sky = WORLD_SKY[ctx.world];
  const coat = (id: SpeciesId | null): string => (id ? pick(rand, looksFor(id, ctx.region).map(([name, weight]) => [name, weight] as const)) : "");
  const coats = { birds: coat(birds), vee: coat(vee), swarm: coat(swarm) };
  return { birds, vee, swarm, coats, region: ctx.region, traffic: sky.traffic.filter((each) => has[each.kind] !== false), every: sky.every };
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

/** A coat grown from the skeleton, for sdf-body: see its Pelt and PeltBone. */
export interface PeltSpec {
  readonly flow: readonly { readonly a: Vec; readonly b: Vec; readonly long: readonly [number, number]; readonly up: Vec; readonly girth: number; readonly fall?: number }[];
  readonly under?: number; readonly thin?: number; readonly crease?: number; readonly tint?: number;
  readonly root?: string; readonly band?: readonly [string, number]; readonly tip?: readonly [string, number];
  readonly back?: string; readonly front?: string; readonly dorsal?: number; readonly ventral?: number;
}

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
  /** The coat's grain, for sdf-body: fur in locks, feathers in rows, a snake's scales; none on a bug's or crab's shell. */
  readonly grain?: { readonly kind: "fur" | "feather" | "scale" | "spine" | "plate"; readonly size: number; readonly lie?: Vec; readonly rise?: number; readonly crown?: Vec; readonly on?: Role; readonly dome?: Vec; readonly tilt?: number; readonly teeth?: number; readonly scales?: readonly { readonly at: Vec; readonly reach: number; readonly size: number }[]; readonly pelt?: PeltSpec };
  /** How its coat takes the light beyond its grain's own way (a crow's purple-green gloss). */
  readonly material?: { readonly sheen?: number; readonly fuzz?: number; readonly gloss?: number; readonly iridescence?: number; readonly lift?: number; readonly neutral?: number };
  /** The relief of muscle and bone over it, for a renderer that grows one (see sdf-body's Form). */
  readonly form?: { readonly amount: number; readonly size: number };
  /** A display train's feathers, for sdf-body to paint. */
  readonly vane?: { readonly role: Role; readonly heart: Role; readonly ring: Role; readonly gold: Role };
  /** Its eyes' lids, for a renderer that paints them (see sdf-body's Eye). */
  readonly eye?: { readonly role: Role; readonly lid: number; readonly slant: number; readonly color: string; readonly pupil: "round" | "slit" | "bar" | "dark"; readonly ring: boolean; readonly spark?: number };
  /** Bare skin's own light, for a renderer that holds it (see sdf-body's Skin). */
  readonly skin?: { readonly role: Role; readonly chroma: number; readonly pale?: string; readonly flush?: number; readonly depth?: number };
  /** A pattern grown over its coat, its own (seeded) and in one of its colours: a tabby's stripes, an owl's bars, mottling on a plain coat. */
  readonly pattern?: { readonly kind: "dapple" | "spots" | "stripes" | "streaks" | "bars" | "chevrons" | "mackerel" | "patches" | "grizzle" | "tips" | "scutes"; readonly role: Role; readonly color?: string; readonly second?: string; readonly trunk?: Vec; readonly dorsal?: number; readonly run?: number; readonly scale: number; readonly contrast: number; readonly seed: number; readonly genes?: readonly [number, number, number, number] };
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

/**
 * Nothing in nature is smooth: a coat parts into locks and feathers lie in
 * rows. A lock about a twentieth of the animal, a feather a fourteenth (a hedgehog's spines stand
 * apart, a tortoise's scutes are coarser); a bug's or a crab's shell, and a glowing
 * spirit, stay smooth.
 */
const GRAINS: Readonly<Record<Plan, "fur" | "feather" | "scale" | null>> = { quad: "fur", primate: "fur", bird: "feather", serpent: "scale", bug: null, crab: null };
// (An owl's plumage is soft and fine: its rows lie close, not in ridges; a cat's coat is short and sleek.)
const COARSE: Partial<Record<SpeciesId, readonly ["fur" | "feather" | "scale" | "spine" | "plate", number]>> = { hedgehog: ["spine", 0.115], tortoise: ["plate", 0.12], owl: ["feather", 0.005], cat: ["fur", 0.022], sloth: ["fur", 0.075], macaque: ["fur", 0.05], monkey: ["fur", 0.03] };
// (A sloth's long coat falls away from the top of its back in shaggy locks that break its outline.)
// (A snow macaque's coat is a pelt grown from its skeleton, on its coat role alone: its face, hands and seat stay bare.)
const SHAGS: Partial<Record<SpeciesId, { readonly lie?: Vec; readonly rise?: number; readonly on?: Role }>> = { sloth: { lie: [0, -1, -0.15], rise: 4.4 }, macaque: { on: "coat" }, monkey: { on: "coat" } };
/** A hedgehog's spines: set about the middle of its dome, they lie back along it from its forehead to its rump and a little down its flanks, and grow on its mantle alone. */
function quillGrain(who: Who, m: Moment): { crown: Vec; lie: Vec; rise: number; on: Role } {
  const body = quadSpine(who, m.pose, m);
  const back = unit(sub(body.P, body.S), [0, 0, -1]);
  return { crown: toWorld(m.frame, madd(mantleLine(body, 0.42), UP, body.r * 0.15)), lie: unit(madd(back, UP, -0.18)), rise: 0.8, on: "alt" };
}
/** A hide's larger scales: polygons on the crown of the head, overlapping shields down the front of each foreleg. */
function shellScales(who: Who, capsules: readonly Capsule[]): { at: Vec; reach: number; size: number }[] {
  const { size } = who.member;
  const scales: { at: Vec; reach: number; size: number }[] = [];
  const head = capsules.find((c) => c.part === "head");
  if (head) scales.push({ at: madd(lerpV(head.a, head.b, 0.45), head.up, head.r * 0.8), reach: head.r * 1.05, size: size * 0.05 });
  for (const leg of ["leg.FL.lower", "leg.FR.lower"]) {
    const c = capsules.find((each) => each.part === leg);
    if (c) scales.push({ at: madd(lerpV(c.a, c.b, 0.42), c.fw, c.r * 1.05), reach: c.r * 1.75, size: size * 0.07 });
  }
  return scales;
}
/** A tortoise's plates: laid over its dome wherever the dome lies and however far it has pitched, as high and as toothed as this animal's shell grew. */
function plateGrain(who: Who, m: Moment, capsules: readonly Capsule[]): { crown: Vec; dome: Vec; rise: number; on: Role; tilt: number; teeth: number; scales: { at: Vec; reach: number; size: number }[] } {
  const body = quadSpine(who, m.pose, m);
  const gene = createRandom(markOf(who) ^ 0x3ac5e2f7);
  return { crown: toWorld(m.frame, shellHeart(body)), dome: domeOf(body), rise: mix(0.35, 1, gene()) * (who.member.coat === "star" ? 1.3 : 1), on: "shell", tilt: Math.atan2(body.P[1] - body.S[1], body.S[2] - body.P[2]), teeth: mix(0.012, 0.06, gene()), scales: shellScales(who, capsules) };
}
/** What a coat's grain takes from how the animal lies this moment. */
function grainPose(who: Who, m: Moment, capsules: readonly Capsule[]): Partial<ReturnType<typeof quillGrain>> & Partial<ReturnType<typeof plateGrain>> & { pelt?: PeltSpec } {
  if (who.member.species === "sloth") return { crown: slothCrown(who, m) };
  if (who.member.species === "macaque") return { pelt: macaquePelt(who, m, capsules) };
  if (who.member.species === "monkey" || who.member.species === "loris") return { pelt: monkeyPelt(who, m, capsules) };
  if (who.member.species === "tortoise") return plateGrain(who, m, capsules);
  return who.member.species === "hedgehog" ? quillGrain(who, m) : {};
}
function grainOf(who: Who, m: Moment, capsules: readonly Capsule[]): Pick<Body, "grain"> {
  const [kind, share] = COARSE[who.member.species] ?? [GRAINS[who.spec.plan], who.spec.plan === "serpent" ? 0.022 : who.spec.plan === "bird" ? 0.07 : 0.05];
  // (A shell keeps its plates in any light: they are what stops its dome at the rim.)
  if (!kind || (kind !== "plate" && MORPHS[who.member.morph].glow > 0.5)) return {};
  // (An upright bird's feathers lie down it, not back along it: in rows round an owl, not stripes up it.)
  const pitch = STANCES[who.member.species]?.pitch ?? 0;
  // (A spread train's feathers wear the renderer's barbs: the body's rows stay on the body.)
  const on = m.pose.fan > 0.3 && who.spec.build.extras.includes("train") ? { on: "coat" as const } : {};
  return { grain: { kind, size: who.member.size * share, ...on, ...(pitch > 1.1 ? { lie: scale(dirOf(0, pitch), -1) } : {}), ...SHAGS[who.member.species], ...grainPose(who, m, capsules) } };
}

type CoatPattern = NonNullable<Body["pattern"]>;
/** A pattern: its kind, its colour, its feature size in the animal's sizes, how strongly it shows, a colour of its own in place of its role's, and for scutes how whole their rays run. */
type PatternSpec = readonly [CoatPattern["kind"], Role, number, number, (string | undefined)?, number?];
/**
 * Patterns by species, then by coat where a coat has its own (a tabby's
 * stripes, a sika's spots). Every other furred or feathered coat is softly
 * mottled in its second colour, so no coat is one flat colour.
 */
const PATTERNS: Partial<Record<SpeciesId, PatternSpec>> = {
  macaque: ["dapple", "alt", 0.24, 0.16], monkey: ["dapple", "alt", 0.2, 0.14],
  guineafowl: ["spots", "shine", 0.022, 1],
  hedgehog: ["tips", "belly", 1, 1], sloth: ["dapple", "alt", 0.2, 0.36, "#5e7038"], owl: ["bars", "alt", 0.07, 0.5], snake: ["dapple", "alt", 0.05, 0.16], cat: ["dapple", "alt", 0.3, 0.08], raccoon: ["grizzle", "alt", 0.035, 1],
};
const COAT_PATTERNS: Readonly<Record<string, PatternSpec>> = {
  grey: ["stripes", "dark", 0.14, 0.35],
  sika: ["spots", "belly", 0.06, 0.8], fallow: ["spots", "belly", 0.07, 0.7], sparrow: ["streaks", "dark", 0.09, 0.55],
  snowy: ["chevrons", "dark", 0.1, 1, "#3a2c22"], banded: ["dapple", "alt", 0.3, 0.1],
  // (One algorithm on a tortoise's plates: a leopard's pigment stops and starts in blotches, a star's never rests and runs out in rays.)
  leopard: ["scutes", "dark", 0.021, 1, undefined, 0.15], star: ["scutes", "accent", 0.016, 1, undefined, 1],
  barn: ["chevrons", "dark", 0.085, 0.7], "great horned": ["bars", "dark", 0.055, 0.85], tawny: ["bars", "alt", 0.06, 0.7], ural: ["bars", "alt", 0.07, 0.6],
};
/** A cat's coats: a coat's name is only its own on a cat (a grey wolf is not a tabby). */
const CAT_PATTERNS: Readonly<Record<string, PatternSpec>> = {
  tabby: ["mackerel", "dark", 0.085, 0.8], grey: ["mackerel", "dark", 0.085, 0.68], calico: ["patches", "alt", 0.34, 1],
};
const MOTTLE: PatternSpec = ["dapple", "coat", 0.35, 0.3];
/** Coats that shine in colours as they turn. */
const MATERIALS: Partial<Record<SpeciesId, NonNullable<Body["material"]>>> = {
  crow: { gloss: 0.55, iridescence: 0.6 }, peacock: { gloss: 0.45, iridescence: 0.45 },
  // (A cat's black goes unlifted, so a calico's patches and a tabby's stripes are black.)
  cat: { lift: 0.3 },
  // (The mask, the bands and the paws are the raccoon, so its black stays black too.)
  raccoon: { lift: 0.22, neutral: 1 },
  // (A star tortoise's horn stays near black, for its rays to stand out on, and a shell's dull polish never blows out.)
  tortoise: { lift: 0.3, gloss: 0.12 },
  // (A pale edge along a sloth's back, where the light catches the tips of its coat.)
  sloth: { fuzz: 0.85 },
  // (The same pale edge on a snow macaque, its guard hairs catching the light.)
  macaque: { sheen: 0, fuzz: 0.5, lift: 0.25 }, monkey: { sheen: 0, fuzz: 0.4, lift: 0.25 },
};
/** A black cat is the exception: a quiet sheen and a rim along its back, head and haunch, so it keeps its shape. */
const BLACK_CAT: NonNullable<Body["material"]> = { sheen: 0.6, fuzz: 0.3, lift: 0.42, neutral: 0.85 };
const grizzled = (who: Who): boolean => patternOf(who)?.[0] === "grizzle";
/** The pattern an animal wears, if any: its coat's own, then its species', then a soft mottle. */
function patternOf(who: Who): PatternSpec | null {
  if (!GRAINS[who.spec.plan]) return null;
  const spec = (who.member.species === "cat" ? CAT_PATTERNS[who.member.coat] : undefined) ?? COAT_PATTERNS[who.member.coat] ?? PATTERNS[who.member.species] ?? MOTTLE;
  // (A morph repaints a coat plain, but a shell's plates still grow their marks, in the morph's own colours.)
  return who.member.morph === "normal" || spec[0] === "scutes" ? spec : null;
}

/** How far each pupil's kind of eye has its lid down, and how it slants: a hunter's narrowed and rising to the corner, a grazer's wide and level. */
const LIDS: Readonly<Record<EyeStyle["pupil"], readonly [number, number]>> = { slit: [0.34, 0.32], round: [0.3, 0.18], bar: [0.24, 0.04], dark: [0.2, 0.08], bead: [0, 0] };

/** How far down a lid of skin comes to shut an eye: past its middle, the line of its lashes low on the lens. */
const SHUT_LID = 1.58;

/** Its lids and its own iris: the same kind of eye, a shade and a set of the lid no other has. */
function eyesOf(who: Who, asleep: boolean): Pick<Body, "eye" | "palette"> {
  const { palette } = who.member;
  const gene = createRandom(markOf(who) ^ 0x2f9be6cc);
  const style = eyeOfSpecies(who).eye ?? EYE;
  const { pupil } = style;
  const [lid, slant] = style.lid === undefined ? LIDS[pupil] : [style.lid, LIDS[pupil][1]];
  const masked = who.spec.build.extras.includes("mask");
  const shift = gene();
  const iris = mixColor(palette.eye, shift < 0.5 ? "#1c140e" : "#b89a58", Math.abs(shift - 0.5) * 0.5);
  const color = style.skinLid ? palette.accent : masked ? palette.dark : palette.coat;
  // (Skin lids come right down in sleep, to a dark line along the lashes.)
  const own = lid + (lid > 0 ? mix(-0.07, 0.09, gene()) : 0);
  return { eye: { role: "eye", lid: style.skinLid && asleep ? SHUT_LID : own, slant: slant * mix(0.7, 1.3, gene()), color, pupil: pupil === "bead" ? "dark" : pupil, ring: style.rim, ...(style.skinLid ? { spark: style.spark ?? 0.2 } : {}) }, palette: { ...palette, eye: iris } };
}

/** Bare skin's own light, for the animals whose skin shows: a macaque's face and seat, matte, the red of the blood under it. */
function skinOfBody(who: Who): Pick<Body, "skin"> {
  // (A guineafowl's head is bare skin, so its pearl spots stop at the neck.)
  if (who.member.species === "guineafowl") return { skin: { role: "accent", chroma: 0.9, depth: 0.9 } };
  if (!macaqueKind(who) || who.member.species === "loris") return {};
  const { accent } = who.member.palette;
  // (A vervet's face is black, and only its lids a shade off it.)
  if (who.member.coat === "vervet") return { skin: { role: "accent", chroma: 0.3, pale: mixColor(accent, "#6c5a54", 0.5), flush: 0.05, depth: 0.8 } };
  return { skin: { role: "accent", chroma: 0.8, pale: mixColor(accent, "#f4ccc4", 0.42), flush: 0.34, depth: 0.74 } };
}

/** The relief over this animal's body, its own: strongest on a mammal's frame, slight under a bird's feathers. */
function formOf(who: Who): Pick<Body, "form"> {
  if (!GRAINS[who.spec.plan] || who.spec.plan === "serpent" || MORPHS[who.member.morph].glow > 0.5) return {};
  const gene = createRandom(markOf(who) ^ 0x7c15d3a1);
  const r = who.spec.build.body * who.member.size;
  return { form: { amount: r * (who.spec.plan === "bird" ? 0.07 : who.spec.build.extras.includes("shell") ? 0.012 : macaqueKind(who) ? 0.05 : 0.17) * mix(0.75, 1.3, gene()), size: r * mix(0.85, 1.5, gene()) } };
}

/** A spread train's feathers, for the renderer to paint shaft, barbs and eye on. */
function vaneOf(who: Who, m: Moment): Pick<Body, "vane"> {
  return m.pose.fan > 0.3 && who.spec.build.extras.includes("train") ? { vane: { role: "shell", heart: "dark", ring: "coat", gold: "accent" } } : {};
}

/** The number all of this animal's marks grow from. */
const markOf = (who: Who): number => (who.member as Partial<Pick<CastMember, "traits">>).traits?.mark ?? Math.floor(ownPhase(who) * 4294967296);

/**
 * How this animal's marks grow: not one of a list of looks but continuous
 * genes off its own mark, for the same algorithms to grow a coat no other has.
 */
function genesOf(who: Who, spec: PatternSpec): Pick<CoatPattern, "scale" | "contrast" | "seed" | "genes"> {
  const seed = markOf(who);
  const gene = createRandom(seed ^ 0x51ed270b);
  const genes = [mix(0.5, 1.9, gene()), mix(0.72, 1.45, gene()), mix(-0.07, 0.07, gene()), mix(0.08, 0.34, gene())] as const;
  return { scale: who.member.size * spec[2] * mix(0.78, 1.28, gene()), contrast: Math.min(1, contrastOf(who, spec) * mix(0.82, 1.14, gene())), seed, genes };
}

function coatOf(who: Who, q: Pose): Pick<Body, "pattern" | "material"> {
  const material = who.member.species === "cat" && who.member.coat === "black" ? BLACK_CAT : MATERIALS[who.member.species];
  const spec = patternOf(who);
  // (Mottling is a darker shade of the coat itself, so it breaks a plain coat up without greying a pied one.)
  const color = spec === MOTTLE ? mixColor(who.member.palette.coat, "#000000", 0.22) : spec?.[4];
  const shade = color === undefined ? {} : { color };
  const run = spec?.[5] === undefined ? {} : { run: spec[5] };
  const pattern = spec ? { kind: spec[0], role: spec[1], ...shade, ...run, ...trunkOf(who, spec[0], q), ...genesOf(who, spec), } : undefined;
  return { ...(material ? { material } : {}), ...(pattern ? { pattern } : {}) };
}

/**
 * Where the trunk ends for a pattern that goes by it: its legs begin below it
 * standing, and only just off the ground once it sits or lies, the trunk
 * down there with them. A calico's black patches lie among its orange.
 */
function trunkOf(who: Who, kind: CoatPattern["kind"], q: Pose): Pick<CoatPattern, "trunk" | "second" | "dorsal"> {
  // (A shell's hide goes as pale as its belly where it turns under.)
  if (kind === "scutes") return { second: who.member.palette.belly };
  if (kind !== "mackerel" && kind !== "patches" && kind !== "grizzle") return {};
  const b = buildOf(who);
  const { size } = who.member;
  const r = b.body * size;
  const low = mix(shoulderOf(b, size) - r * 0.85, r * 0.15, Math.max(q.sit, q.lie));
  const trunk: Vec = [low, -(b.len * size) / 2 - r * 0.75, (b.len * size) / 2 + r * 0.7];
  // (The spine's dark line runs on a standing back only; sat up, the midline is its chest.)
  const dorsal = mix(shoulderOf(b, size) + r * (kind === "grizzle" ? 0.1 : 0.5), size * 9, Math.max(q.sit, q.lie, q.curl) > 0.1 ? 1 : 0);
  return { trunk, dorsal, ...(kind === "patches" ? { second: who.member.palette.dark } : kind === "grizzle" ? { second: who.member.palette.belly } : {}) };
}

/** How strongly a pattern shows: as its kind has it, but a snowy owl hen is barred far more heavily than the cock, who is nearly white. */
function contrastOf(who: Who, spec: PatternSpec): number {
  // (A morph's shell keeps its marks, but quieter: the morph's own colour is what shows.)
  if (spec[0] === "scutes" && who.member.morph !== "normal") return spec[3] * 0.62;
  if (who.member.coat !== "snowy") return spec[3];
  const sex = (who.member as Partial<Pick<CastMember, "traits">>).traits?.sex;
  return Math.min(1, spec[3] * (sex === "male" ? 0.85 : 1.5));
}

function bodyOf(id: string, who: Who, m: Moment, capsules: readonly Capsule[], scene?: Scene): Body {
  return {
    id, kind: who.member.species, label: who.member.label, action: m.segment.act, morph: who.member.morph,
    at: m.frame.o, front: m.frame.z, capsules, glow: MORPHS[who.member.morph].glow, lit: MORPHS[who.member.morph].lit ?? [],
    contact: scene ? contactOf(m, scene) : null, weight: weightOf(who), ...grainOf(who, m, capsules), ...coatOf(who, m.pose), ...eyesOf(who, m.segment.act === "sleep"), ...formOf(who), ...skinOfBody(who), ...vaneOf(who, m),
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
  return galleryBody(id, { member, spec }, action, t);
}

/** An animal posed for the gallery. */
function galleryBody(id: SpeciesId, who: Who, action: Action, t: number): Body {
  const climbing = galleryClimb(id, action);
  const m = climbing ? onGalleryTrunk(galleryMoment(who.spec, action, t), who.member.size) : galleryMoment(who.spec, action, t);
  return bodyOf(id, who, m, [...poseWho(who, m), ...(climbing ? [galleryTrunk(who, m)] : [])]);
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

/** The way out from the trunk a macaque climbs in the gallery: its flank to the gallery's camera. */
const GALLERY_BARK: Vec = unit([0.7, 0, 0.7]);
/** A macaque climbing in the gallery goes up real wood, so a climb can be judged there and not in the air. */
const galleryClimb = (id: SpeciesId, action: Action): boolean => (id === "macaque" || id === "monkey") && action === "climb";
const onGalleryTrunk = (m: Moment, size: number): Moment => ({ ...m, frame: frameOf([0, size * 0.5, 0], UP, GALLERY_BARK) });

/** That trunk, behind the animal on it. */
function galleryTrunk(who: Who, m: Moment): Capsule {
  const r = who.spec.build.body * who.member.size * 1.8;
  const at = madd(m.frame.o, m.frame.y, -r);
  return { a: add(at, [0, -who.member.size * 0.5, 0]), b: add(at, [0, who.member.size * 1.1, 0]), r, role: "horn", part: "trunk", flat: 1, up: m.frame.y, fw: m.frame.z };
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
  /** What the last `at` left passing through what, for testing a scene: it reads each animal's own route, so a branch it walks never counts. */
  clipping(): Clipping;
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
  const actor: Actor = { index, member, spec, rand, day: matrixOf(spec, {}), night: matrixOf(spec, { night: true }), moods: new Map(), segments: [], until: 0, place, limbs: [0, 1], yaw: rand() * TAU, last: "stand", pos: anchorOf(place, stage, []).p, back: null, mates: [], pantry };
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
    const scene: Scene = { stage, backs: [] };
    for (const actor of actors) {
      actor.mates = actors;
      actor.limbs = [g, cast.groups.length];
    }
    // (Dropped in at random to begin with: any that landed on another moves along.)
    for (const actor of actors) if (actor.place.on === "perch" && !(perchFree(actor, scene, actor.place.i) && perchFits(actor, stage, actor.place.i))) actor.place = randomPerch(actor, scene);
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

// ---------------------------------------------------------------- collision

/** A circle on the ground, in world x and z. */
export interface Ring { readonly x: number; readonly z: number; readonly r: number }
/** What an animal takes up on the ground: rings along its trunk, and how hard it is to move. */
export interface Footprint { readonly rings: readonly Ring[]; readonly weight: number; readonly team: number; readonly self: number; readonly faces: number }

const SHOVE_PASSES = 4;
const MOST_RINGS = 6;
const ROOTED = 1e9;

/** Animals that have turned to each other (a sniff, a groom, a nose to a nose) may come this much closer, their trunks still apart. */
const SNUG = 0.5;
const TOUCH_ACTS: readonly Action[] = ["groom", "nuzzle", "play", "sniff"];
const greeting = (a: Footprint, b: Footprint): boolean => a.team === b.team && (a.faces === b.self || b.faces === a.self);

/** How far ring `a` lies inside ring `b`, each carried by its animal's shove so far, and the way out of it. */
function overlapOf(a: Ring, at: readonly [number, number], b: Ring, bt: readonly [number, number], tie: number, room: number): { gap: number; x: number; z: number } {
  const dx = a.x + at[0] - b.x - bt[0];
  const dz = a.z + at[1] - b.z - bt[1];
  const d = Math.hypot(dx, dz);
  // (Dead on top of each other, they part by their places in the cast, never by chance.)
  return d > 1e-6 ? { gap: (a.r + b.r) * room - d, x: dx / d, z: dz / d } : { gap: (a.r + b.r) * room, x: Math.cos(tie), z: Math.sin(tie) };
}

/**
 * How far each animal is pushed so that none stands in another: the lighter
 * gives way more. A function of where they stand now and nothing else, so it
 * eases in as they close, and is the same at any frame rate.
 */
export function shoveApart(prints: readonly (Footprint | null)[]): (readonly [number, number])[] {
  const shove = prints.map((): [number, number] => [0, 0]);
  const pushPair = (i: number, j: number): void => {
    const [a, b] = [prints[i], prints[j]];
    const [at, bt] = [shove[i], shove[j]];
    if (!a || !b || !at || !bt) return;
    const room = greeting(a, b) ? SNUG : 1;
    for (const ra of a.rings) for (const rb of b.rings) {
      const { gap, x, z } = overlapOf(ra, at, rb, bt, i + j * 2.4, room);
      if (gap <= 0) continue;
      const share = b.weight / (a.weight + b.weight);
      at[0] += x * gap * share; at[1] += z * gap * share;
      bt[0] -= x * gap * (1 - share); bt[1] -= z * gap * (1 - share);
    }
  };
  for (let pass = 0; pass < SHOVE_PASSES; pass += 1) for (let i = 0; i < prints.length; i += 1) for (let j = i + 1; j < prints.length; j += 1) pushPair(i, j);
  return shove;
}

/** Where a body is thickest, as points along its trunk a ring apart: close enough that another body can't lie across the gap, and through the middle too, for two bodies head to tail would have their ends push equally both ways. */
function trunkOfBody(m: Moment, capsules: readonly Capsule[]): { centres: Vec[]; r: number } | null {
  const thick = capsules.filter((c) => c.decal !== true && c.carve !== true);
  const most = thick.reduce((high, c) => Math.max(high, c.r), 0);
  if (most <= 0) return null;
  const { o, x, y, z } = m.frame;
  const big = thick.filter((c) => c.r >= most * 0.6).flatMap((c) => [c.a, c.b]);
  const along = big.map((p) => dot(sub(p, o), z));
  const mean = (axis: Vec): number => big.reduce((sum, p) => sum + dot(sub(p, o), axis), 0) / big.length;
  // (Beside its own heading too: a body curled up lies off to one side of it.)
  const from = add(add(o, scale(x, mean(x))), scale(y, mean(y)));
  const r = most * 1.25;
  const [low, high] = [Math.min(...along), Math.max(...along)];
  const span = Math.max(0, high - low - r);
  const gaps = Math.min(MOST_RINGS - 1, Math.ceil(span / r));
  return { centres: Array.from({ length: gaps + 1 }, (_, i) => madd(from, z, (low + high) / 2 + (gaps === 0 ? 0 : span * (i / gaps - 0.5)))), r };
}

/** An animal's footprint, from the thick parts of its body as posed; none while it is off the ground. */
function footprintOf(actor: Actor, m: Moment, capsules: readonly Capsule[], team: number): Footprint | null {
  if (m.mode === "fly" || m.mode === "climb" || m.segment.from.on !== "ground" || m.segment.to.on !== "ground") return null;
  const body = trunkOfBody(m, capsules);
  if (!body) return null;
  return { rings: body.centres.map((p) => ({ x: p[0], z: p[2], r: body.r })), weight: actor.member.size * actor.member.size, team, self: actor.index, faces: TOUCH_ACTS.includes(m.segment.act) ? m.segment.face : -1 };
}

/** A trail lifted over each limb that lies across it, so a snake on the trunk drapes over the branches it meets. */
function overLimbs(trail: readonly Vec[], actor: Actor, stage: Stage): Vec[] {
  const limbs = woodMapOf(stage);
  const r = actor.spec.build.body * actor.member.size * 2.4;
  return trail.map((p) => add(p, clearOfLimbs({ balls: [p], r, weight: 1, side: UP }, limbs)));
}

/** A body in the tree: its trunk in the air, how hard it is to move, and which way it steps aside. */
export interface WoodPrint { readonly balls: readonly Vec[]; readonly r: number; readonly weight: number; readonly side: Vec; readonly own?: readonly Wood[] }

const onWood = (place: Place): boolean => place.on === "perch" || place.on === "trunk";

/** The wood a trip goes by, which is no obstacle to it: the limbs at either end, and those of its route. */
function ownWood({ from, to, via = [] }: Segment, stage: Stage): Wood[] {
  const limb = (place: Place): readonly Wood[] => (place.on === "perch" ? perchOf(stage, place.i)?.path ?? [] : []);
  return [...limb(from), ...limb(to), ...via.flatMap((i) => limb({ on: "perch", i }))];
}

/** An animal's place in the tree; none on the ground, in the air, or on another's back. */
function woodPrintOf(actor: Actor, m: Moment, capsules: readonly Capsule[], stage: Stage): WoodPrint | null {
  const { from, to } = m.segment;
  if (!(onWood(from) || onWood(to)) || from.on === "back" || to.on === "back") return null;
  const body = trunkOfBody(m, capsules);
  if (!body) return null;
  // (One sat still is harder to shift: it's the climber going by that swings round it.)
  const weight = actor.member.size * actor.member.size * (m.moving > 0.2 ? 1 : 4);
  // (A snake lies along its way, not its heading.)
  const balls = m.trail ? capsules.filter((c) => c.part.startsWith("body.")).filter((_, i) => i % 2 === 0).map((c) => c.a) : body.centres;
  return { balls, r: body.r * 0.8, weight, side: m.frame.x, own: ownWood(m.segment, stage) };
}

/** How far a body leans to go round the deepest limb in its way that isn't one it is on. A function of where it is now, so it swings round the wood and back. */
export function clearOfLimbs(print: WoodPrint, map: WoodMap): Vec {
  const own = new Set((print.own ?? []).map(woodKey));
  const keep = print.r * 0.85;
  let lean: Vec = [0, 0, 0];
  let deepest = 0;
  for (const ball of print.balls) for (const { a, b, keys } of woodNear(map, ball, keep + map.thickest)) {
    const gap = keep - offWood(ball, a, b);
    // (A branch forking off its own is one it touches: it only goes round the rest.)
    if (gap <= deepest || own.has(keys[0]) || own.has(keys[1])) continue;
    const ab = sub(b.p, a.p);
    const k = clamp(dot(sub(ball, a.p), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
    deepest = gap;
    lean = scale(unit(sub(ball, madd(a.p, ab, k)), print.side), gap);
  }
  return lean;
}

/** What `Herd.clipping` found: bodies through wood not their own, and pairs of bodies through each other. */
export interface Clipping { readonly wood: readonly string[]; readonly bodies: readonly (readonly [string, string])[] }

/** Points down the thick of a body, each with its radius. */
function bodyCores(body: Body): { p: Vec; r: number }[] {
  const thick = body.capsules.filter((c) => c.decal !== true && c.carve !== true);
  const most = thick.reduce((high, c) => Math.max(high, c.r), 0);
  return thick.filter((c) => c.r >= most * 0.6).flatMap((c) => [0, 0.25, 0.5, 0.75, 1].map((k) => ({ p: lerpV(c.a, c.b, k), r: c.r })));
}

function inWood(cores: readonly { p: Vec; r: number }[], own: ReadonlySet<string>, map: WoodMap): boolean {
  return cores.some(({ p, r }) => woodNear(map, p, r * 0.55 + map.thickest).some(({ a, b, keys }) => !own.has(keys[0]) && !own.has(keys[1]) && offWood(p, a, b) + mix(a.r, b.r, 0.5) * 0.7 < r * 0.55));
}

const inOther = (a: readonly { p: Vec; r: number }[], b: readonly { p: Vec; r: number }[]): boolean => a.some((x) => b.some((y) => length(sub(x.p, y.p)) < 0.6 * (x.r + y.r)));

/** Reads a frame for what really passes through what, knowing each animal's own way over the wood. */
function clippingOf(frame: readonly { body: Body; own: readonly Wood[] }[], map: WoodMap): Clipping {
  const cores = frame.map(({ body }) => bodyCores(body));
  const wood = frame.filter(({ own }, i) => inWood(cores[i] ?? [], new Set(own.map(woodKey)), map)).map(({ body }) => body.id);
  const bodies: (readonly [string, string])[] = [];
  frame.forEach(({ body }, i) => { for (let j = i + 1; j < frame.length; j += 1) { const other = frame[j]; if (other && inOther(cores[i] ?? [], cores[j] ?? [])) bodies.push([body.id, other.body.id]); } });
  return { wood, bodies };
}

/**
 * How far each body in the tree leans clear of the others. Two meeting on a
 * limb each keep to their own right, so they swing round each other as they
 * pass and never pop through; a function of where they are now, like `shoveApart`.
 */
export function passOnWood(prints: readonly (WoodPrint | null)[]): Vec[] {
  const lean = prints.map((): Vec => [0, 0, 0]);
  const pair = (i: number, j: number): void => {
    const [a, b] = [prints[i], prints[j]];
    if (!a || !b) return;
    for (const pa of a.balls) for (const pb of b.balls) {
      const d = add(sub(pa, pb), sub(lean[i] ?? [0, 0, 0], lean[j] ?? [0, 0, 0]));
      const gap = a.r + b.r - length(d);
      if (gap <= 0) continue;
      const out = unit(add(unit(d, a.side), scale(sub(a.side, b.side), 0.5)), a.side);
      const share = b.weight / (a.weight + b.weight);
      lean[i] = madd(lean[i] ?? [0, 0, 0], out, gap * share);
      lean[j] = madd(lean[j] ?? [0, 0, 0], out, -gap * (1 - share));
    }
  };
  for (let pass = 0; pass < SHOVE_PASSES; pass += 1) for (let i = 0; i < prints.length; i += 1) for (let j = i + 1; j < prints.length; j += 1) pair(i, j);
  return lean;
}

/** The trunk at the ground, as a footprint nothing can move. */
function treePrint(stage: Stage): Footprint | null {
  const trunk = stage.trunk;
  if (!trunk) return null;
  const { p, r } = trunkAxis(trunk, 0);
  return { rings: [{ x: p[0], z: p[2], r }], weight: ROOTED, team: -1, self: -1, faces: -1 };
}

/** A whole posed body moved along the ground. */
function shoved(m: Moment, capsules: Capsule[], by: Vec): { m: Moment; capsules: Capsule[] } {
  if (by[0] === 0 && by[1] === 0 && by[2] === 0) return { m, capsules };
  return { m: { ...m, frame: { ...m.frame, o: add(m.frame.o, by) } }, capsules: capsules.map((c) => ({ ...c, a: add(c.a, by), b: add(c.b, by) })) };
}

/** A shove along the ground, over its rises and dips. */
function overGround(stage: Stage, { frame: { o } }: Moment, [x, z]: readonly [number, number]): Vec {
  return x === 0 && z === 0 ? [0, 0, 0] : [x, groundY(stage, o[0] + x, o[2] + z) - groundY(stage, o[0], o[2]), z];
}

interface Posed { readonly id: string; readonly actor: Actor; readonly m: Moment; readonly capsules: Capsule[]; readonly scene: Scene }

/** Everyone as posed, pushed clear of each other and made into bodies. */
function settledBodies(posed: readonly Posed[], prints: readonly (Footprint | null)[]): Body[] {
  const shoves = shoveApart([...prints, ...posed.slice(0, 1).map(({ scene }) => treePrint(scene.stage))]);
  const stage = posed[0]?.scene.stage;
  const limbs = stage ? woodMapOf(stage) : { edges: [], cells: new Map<number, number[]>(), thickest: 0 };
  const woodPrints = posed.map(({ actor, m, capsules, scene }) => woodPrintOf(actor, m, capsules, scene.stage));
  const leans = passOnWood(woodPrints);
  return posed.map(({ id, actor, m, capsules, scene }, i) => {
    const print = woodPrints[i];
    const lean = add(leans[i] ?? [0, 0, 0], print ? clearOfLimbs(print, limbs) : [0, 0, 0]);
    const moved = shoved(m, capsules, add(overGround(scene.stage, m, shoves[i] ?? [0, 0]), lean));
    actor.pos = moved.m.frame.o;
    return bodyOf(id, actor, moved.m, moved.capsules, scene);
  });
}

/** The scene's living cast: call `at` every frame with the stage, and `sky` for what flies over. */
export function createHerd(cast: Cast): Herd {
  let troupes: Troupe[] | null = null;
  let read = (): Clipping => ({ wood: [], bodies: [] });
  const pantry: Pantry = new Map();
  const passes: Pass[] = [];
  const clock = { last: 0 };
  const skyRand = streamOf(cast.seed, "fauna.sky.passes");
  clock.last = -between(skyRand, [0.2, 0.8]) * cast.sky.every[0];
  const flyer = (species: SpeciesId | null, coat: string, name: string): Who | null => (species ? { member: memberOf(streamOf(cast.seed, `fauna.sky.${name}`), species, coat || (speciesOf(species).coats[0]?.[0] ?? ""), false, { morph: "normal", region: cast.sky.region ?? undefined }), spec: speciesOf(species) } : null);
  const flyers = { flock: flyer(cast.sky.birds, cast.sky.coats.birds, "bird"), vee: flyer(cast.sky.vee, cast.sky.coats.vee, "vee"), swarm: flyer(cast.sky.swarm, cast.sky.coats.swarm, "swarm") };
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
      const posed: Posed[] = [];
      const prints: (Footprint | null)[] = [];
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
          posed.push({ id: `${g}.${actor.index}`, actor, m, capsules, scene: { stage, backs: troupe.actors.map((a) => a.back) } });
          prints.push(footprintOf(actor, m, capsules, g));
        }
      });
      const bodies = settledBodies(posed, prints);
      read = () => clippingOf(bodies.map((body, i) => ({ body, own: ownWood(posed[i]?.m.segment ?? FLY_SEGMENT, stage) })), woodMapOf(stage));
      return bodies;
    },
    clipping: () => read(),
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

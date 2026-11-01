// The roster: every species, its build, outline, coat, voice and company, and how rare it is.

import type { Who } from "./animals/bodies.js";

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

export type Ears = "point" | "round" | "rimmed" | "cup" | "long" | "flop" | "tuft" | "fluffy" | "none";
export type Tail = "bushy" | "curl" | "thin" | "puff" | "ring" | "banded" | "thick" | "fan" | "stub" | "none";
/**
 * Extra parts and markings. Markings are paint only (sdf-body decals): a pale
 * `bib` down the throat and chest, a white `rump`, a pale `muzzle`, a dark
 * `saddle` down the back, dark `socks` on the lower legs, pale `mitts` on the paws, a `mask` across the
 * eyes, pale `brows` over it; a `ruff` of fur round the neck, `jowls` on the cheeks, a `hump` over the shoulders; a
 * `button` nose, `fingers` marked on the forepaws.
 */
type Extra = "bignose" | "antlers" | "mask" | "quills" | "shell" | "pouch" | "crest" | "stripes" | "longneck" | "train" | "crown" | "glowtail" | "claws" | "cheeks" | "spots"
  | "bib" | "rump" | "muzzle" | "saddle" | "socks" | "mitts" | "ruff" | "hump" | "brows" | "jowls" | "button" | "fingers" | "wet" | "toes";
/** What a leg stands on: a paw on its toes, a hoof on its tips, or a flat sole, heel down (a bear's, a raccoon's). */
export type Foot = "paw" | "hoof" | "plant";
/**
 * How it sits: a dog's sit (rump down, forelegs straight); a rabbit's loaf; a
 * deer folds down to lie instead; a bear sits back on its rump; a squirrel
 * sits up on its haunches, forepaws free; a tortoise tucks in.
 */
export type SitStyle = "dog" | "loaf" | "lie" | "rump" | "haunch" | "tuck";

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
  /**
   * A foreleg's two upper bones, each as a share of its reach: over a half bends it at the elbow, a half stands it
   * straight.
   */
  readonly foreBone: number;
  /**
   * A tail's own line, a step for each segment: how much it climbs over its kind's, how far it swings aside, its share
   * of the length (a cat's soft S, off to one side).
   */
  readonly tailLine?: readonly (readonly [rise: number, sway: number, share: number])[];
  /**
   * Where its neck leaves the body, off its shoulders in body radii (up, forward): a tortoise's from under the shell's
   * rim.
   */
  readonly neckRoot?: readonly [number, number];
  /** The neck's thickness at the head, in body radii. */
  readonly neckEnd?: number;
  /** A leg made to its own plan and not its foot's (see `LegMake`). */
  readonly legMake?: LegMake;
  /**
   * Nose to the ground, how many body radii the shoulders sink, the elbows bending and the neck reaching out low (a
   * cat's sniff, where a dog just drops its head).
   */
  readonly stoop?: number;
  /** How far out its legs stand, as a share of its body's radius (a hedgehog's in under its skirt). */
  readonly stance?: number;
  /** How far back it draws its head as it curls up, in body radii (a hedgehog's in under its mantle). */
  readonly curlIn?: number;
  /** How far up a blunt snout turns at its end, in head radii. */
  readonly snoutUp?: number;
  /**
   * The furthest its head goes below level, in radians, however low its nose is held (a hedgehog's, all neck hidden
   * under its mantle).
   */
  readonly dip?: number;
  /**
   * Four legs: the torso's outline from hip (0) to shoulder (1), in body
   * radii (its round ends run on past both). Without one, the torso is a
   * haunch and a chest joined by a waist. A bird's runs from its tail's
   * root (0) to its breast (1).
   */
  readonly torso?: readonly Station[];
  /**
   * The skull's outline in head radii from its middle, back to the stop where the brow drops to the muzzle; without
   * one, the head is round.
   */
  readonly skull?: readonly Station[];
  /** The muzzle's outline from the stop (0) to the nose (1), in head radii across. */
  readonly muzzle?: readonly Station[];
  /** A leg's radii, top and bottom of each bone, where a kind's differ from the usual. */
  readonly taper?: {
    readonly fore: readonly [number, number, number, number];
    readonly hind: readonly [number, number, number, number];
  };
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
export type Station = readonly [k: number, top: number, bottom: number, half: number];

export type GroupKind = "solo" | "pair" | "family" | "pack";

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

import { ALL_REGIONS, SPECIES, WING, WINGS } from "./species.data.js";
export { ALL_REGIONS, SPECIES };


export type SpeciesId = keyof typeof SPECIES;
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
export const speciesOf = (id: SpeciesId): SpeciesSpec => SPECIES[id];


export const HOPPERS: ReadonlySet<SpeciesId> = new Set<SpeciesId>(["rabbit", "mouse", "squirrel", "kangaroo"]);

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
export interface WingStyle {
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
export const wingStyle = (who: Who): WingStyle => WINGS[who.member.species] ?? WING;

// Species: each kind's form, pace, phenology and ornaments; the table itself is in species.data.ts.

import { SPECIES } from "./species.data.js";

// ---------------------------------------------------------------- species

export type SpeciesId = "cherry" | "oak" | "pine" | "birch" | "willow" | "acacia" | "palm" | "spruce" | "redwood" | "maple" | "jacaranda" | "baobab"
  | "apple" | "pear" | "peach" | "plum" | "orange" | "lemon" | "fig" | "mango";
export type Hemisphere = "north" | "south" | "equatorial";

/**
 * Day windows of one year, counted in a year that starts on day 60 (early
 * March in the north), so every window is a plain [start, end] with no wrap.
 */
export interface PhenologySpec {
  /** Leaves break bud at [0] and are full size at [1]. */
  readonly leaf: readonly [number, number];
  /** Autumn color starts at [0] and is complete at [1]. */
  readonly color: readonly [number, number];
  /** Leaf fall starts at [0] and ends at [1]. */
  readonly drop: readonly [number, number];
  /** Share of leaves that fall each year; evergreens only shed old needles. */
  readonly dropMax: number;
  /** Fresh spring growth is brightest at [0] and has hardened by [1]. */
  readonly flush: readonly [number, number];
  /** Share of dead leaves that hang on through winter until new leaves push them off (oak). */
  readonly marcescent: number;
}

export type OrnamentKind = "blossom" | "catkin" | "candle" | "puff" | "spadix" | "cherry" | "acorn" | "cone" | "pod" | "coconut" | "samara" | "bell" | "gourd"
  | "apple" | "pear" | "peach" | "plum" | "orange" | "lemon" | "fig" | "mango";

/** Flowers or fruit: what they are, where they grow and when. */
export interface OrnamentSpec {
  readonly kind: OrnamentKind;
  /** "spur" on short older wood, "tip" on this year's leafy twigs. */
  readonly on: "spur" | "tip";
  readonly perNode: number;
  /** They appear over days [0, 1] and fall over [2, 3], in the year that starts on day 60. */
  readonly window: readonly [number, number, number, number];
  /** First growth cycle at which the tree is old enough to bear them. */
  readonly from: number;
  /** Only above this share of the grown height (spruce cones hang from the top tiers). */
  readonly above?: number;
}

/**
 * Palms never branch. The trunk grows only from its crown, at one girth all
 * its life, and the crown unfolds a few fronds each cycle while the oldest
 * die and drop.
 */
export interface PalmSpec {
  /** New fronds each cycle. */
  readonly fronds: number;
  /** Frond length, in internode lengths. */
  readonly frond: number;
  /** Cycles a frond lives before it browns and drops. */
  readonly frondLife: number;
  /** Trunk radius, world units. */
  readonly trunk: number;
  /** How far the trunk leans out before it curves back up. */
  readonly lean: number;
}

export interface Species {
  readonly id: SpeciesId;
  /** Growth cycles over a whole lifespan, decline included. */
  readonly cycles: number;
  /** World height of the grown tree. */
  readonly height: number;
  /** Apical control λ: the share of vigor the continuing axis keeps. */
  readonly apical: number;
  /** Vigor per unit of light reaching the base (α). */
  readonly vigor: number;
  /** Most internodes one bud can make in one cycle. */
  readonly maxShoot: number;
  /** Most internodes a side bud can make in one cycle (short in conifers). */
  readonly sideShoot: number;
  /** Side shoots leave their axis at this angle, degrees. */
  readonly angle: number;
  /** Phyllotaxis: each lateral bud turns this far round the axis, degrees. */
  readonly divergence: number;
  /** When above 0, side buds sit only at a shoot's end, in whorls of this many. */
  readonly whorl: number;
  /** Weight of the shoot's own heading. */
  readonly straight: number;
  /** Weight toward the open sky (phototropism). */
  readonly light: number;
  /** Gravitropism on the leader. */
  readonly up: number;
  /** Gravitropism on side shoots. */
  readonly lateralUp: number;
  /** Twigs from the second order on hang down by this much: weeping. */
  readonly weep: number;
  /** Pull of side shoots toward horizontal (plagiotropism). */
  readonly flat: number;
  /** Share of the current height kept clear of side shoots on the trunk. */
  readonly crownAt: number;
  /** Self-pruning: limbs on the trunk below this share of the height die and drop as the tree rises (redwood). */
  readonly lift?: number;
  /** Widest crown radius as a share of the tree's height; light fades past it. */
  readonly spread: number;
  /** How far that reach narrows toward the top: 0 keeps it, 1 closes it to a spire (spruce, redwood). */
  readonly cone?: number;
  /** Height, in internodes, where the leader gives up and the crown spreads flat. */
  readonly ceiling: number;
  /** Average bud light under which a branch starves and dies. */
  readonly shed: number;
  /** Leaves around each leafy node. */
  readonly leafSlots: number;
  /** Radius of a node's leaf cluster, world units. */
  readonly leafSpread: number;
  /** Leaves hang in curtains this long below each twig (weeping), world units. */
  readonly hang: number;
  /** Flowers, or null for none worth drawing. */
  readonly flower: OrnamentSpec | null;
  /** Fruit and seed, or null. */
  readonly fruit: OrnamentSpec | null;
  readonly evergreen: boolean;
  /** Grows as a palm instead of a branching tree, or null. */
  readonly palm: PalmSpec | null;
  /** Radius of a one-year twig, world units. */
  readonly radiusTip: number;
  /** Pipe-model exponent: radius^pipe is the sum of the tips it carries. */
  readonly pipe: number;
  readonly phenology: PhenologySpec;
}

export { SPECIES } from "./species.data.js";

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export function speciesOf(id: string): Species {
  return Object.hasOwn(SPECIES, id) ? SPECIES[id as SpeciesId] : SPECIES.cherry;
}

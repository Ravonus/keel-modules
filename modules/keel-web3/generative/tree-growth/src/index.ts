/**
 * Self-organizing tree growth, yearly phenology and slow decline for voxel
 * trees. Deterministic and renderer-free: a seed and a species become a branch
 * graph that a scene can pose at any moment of the tree's life. MIT.
 *
 * Growth follows Palubicki et al. 2009 ("Self-organizing tree models for image
 * synthesis"): buds compete for light in a shadow grid, light flows down the
 * branches and vigor flows back up with apical control (Borchert–Honda), so
 * the crown fills the space it can reach, shaded limbs die and drop, and the
 * trunk thickens by the pipe model.
 */

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

const DECIDUOUS: PhenologySpec = {
  marcescent: 0,
  leaf: [100, 132],
  color: [258, 294],
  drop: [280, 318],
  dropMax: 1,
  flush: [104, 160],
};

/** Citrus and mango: evergreen, shedding a few old leaves as the new flush comes. */
const BROADLEAF_EVERGREEN: PhenologySpec = { leaf: [60, 61], color: [300, 330], drop: [300, 340], dropMax: 0.08, flush: [110, 160], marcescent: 0 };

export const SPECIES: Readonly<Record<SpeciesId, Species>> = {
  cherry: {
    id: "cherry", cycles: 26, height: 8.6, apical: 0.5, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 44, divergence: 137.5, whorl: 0,
    straight: 1, light: 0.4, up: 0.45, lateralUp: 0.12, weep: 0.03, flat: 0.12, spread: 0.52, crownAt: 0.32, ceiling: Infinity, shed: 0.2,
    leafSlots: 4, leafSpread: 0.34, hang: 0, flower: { kind: "blossom", on: "spur", perNode: 3, window: [86, 97, 101, 116], from: 4 }, fruit: { kind: "cherry", on: "spur", perNode: 2, window: [130, 156, 166, 188], from: 5 },
    evergreen: false, palm: null, radiusTip: 0.025, pipe: 2.75,
    phenology: { ...DECIDUOUS, leaf: [100, 130] },
  },
  oak: {
    id: "oak", cycles: 30, height: 10.2, apical: 0.46, vigor: 2.2, maxShoot: 3, sideShoot: 3, angle: 56, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.45, up: 0.32, lateralUp: 0.02, weep: 0.02, flat: 0.28, spread: 0.5, crownAt: 0.28, ceiling: Infinity, shed: 0.18,
    leafSlots: 4, leafSpread: 0.36, hang: 0, flower: { kind: "catkin", on: "tip", perNode: 2, window: [108, 120, 130, 146], from: 7 }, fruit: { kind: "acorn", on: "tip", perNode: 1, window: [190, 250, 268, 300], from: 9 },
    evergreen: false, palm: null, radiusTip: 0.027, pipe: 2.65,
    phenology: { ...DECIDUOUS, leaf: [112, 146], color: [268, 304], drop: [290, 334], marcescent: 0.22 },
  },
  // Pine: a tall bare trunk that sheds its lower limbs, under an open, uneven crown of upturned boughs.
  pine: {
    id: "pine", cycles: 28, height: 11.2, apical: 0.7, vigor: 2.1, maxShoot: 3, sideShoot: 2, angle: 66, divergence: 137.5, whorl: 4,
    straight: 1, light: 0.3, up: 1.1, lateralUp: 0.06, weep: 0, flat: 0.38, spread: 0.52, crownAt: 0.3, lift: 0.28, ceiling: Infinity, shed: 0.18,
    leafSlots: 3, leafSpread: 0.3, hang: 0, flower: { kind: "candle", on: "tip", perNode: 1, window: [112, 134, 158, 176], from: 2 }, fruit: { kind: "cone", on: "spur", perNode: 1, window: [140, 250, 330, 420], from: 6 },
    evergreen: true, palm: null, radiusTip: 0.023, pipe: 2.85,
    phenology: { leaf: [60, 61], color: [262, 300], drop: [270, 310], dropMax: 0.14, flush: [126, 176], marcescent: 0 },
  },
  birch: {
    id: "birch", cycles: 26, height: 9.6, apical: 0.62, vigor: 2, maxShoot: 3, sideShoot: 3, angle: 40, divergence: 137.5, whorl: 0,
    straight: 1.1, light: 0.32, up: 0.7, lateralUp: 0.02, weep: 0.14, flat: 0.06, spread: 0.4, crownAt: 0.36, ceiling: Infinity, shed: 0.21,
    leafSlots: 4, leafSpread: 0.3, hang: 0.3, flower: { kind: "catkin", on: "tip", perNode: 2, window: [88, 100, 112, 128], from: 5 }, fruit: null,
    evergreen: false, palm: null, radiusTip: 0.022, pipe: 2.85,
    phenology: { ...DECIDUOUS, leaf: [98, 124], color: [246, 280], drop: [266, 302] },
  },
  willow: {
    id: "willow", cycles: 24, height: 8.2, apical: 0.45, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 50, divergence: 137.5, whorl: 0,
    straight: 0.8, light: 0.16, up: 0.5, lateralUp: 0.3, weep: 0.3, flat: 0, spread: 0.5, crownAt: 0.3, ceiling: Infinity, shed: 0.09,
    leafSlots: 9, leafSpread: 0.28, hang: 1.5, flower: { kind: "catkin", on: "tip", perNode: 2, window: [66, 78, 92, 106], from: 3 }, fruit: null,
    evergreen: false, palm: null, radiusTip: 0.023, pipe: 2.65,
    phenology: { ...DECIDUOUS, leaf: [84, 110], color: [272, 302], drop: [290, 326] },
  },
  acacia: {
    id: "acacia", cycles: 22, height: 7.4, apical: 0.4, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 48, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.3, up: 0.6, lateralUp: 0.26, weep: 0, flat: 0.5, spread: 0.66, crownAt: 0.46, ceiling: 15, shed: 0.18,
    leafSlots: 4, leafSpread: 0.34, hang: 0, flower: { kind: "puff", on: "tip", perNode: 2, window: [268, 284, 298, 318], from: 3 }, fruit: { kind: "pod", on: "tip", perNode: 1, window: [300, 334, 380, 420], from: 4 },
    evergreen: false, palm: null, radiusTip: 0.027, pipe: 2.55,
    phenology: { leaf: [60, 61], color: [236, 280], drop: [250, 296], dropMax: 0.42, flush: [300, 340], marcescent: 0 },
  },
  palm: {
    id: "palm", cycles: 30, height: 12.5, apical: 1, vigor: 1, maxShoot: 1, sideShoot: 0, angle: 0, divergence: 137.5, whorl: 0,
    straight: 1, light: 0, up: 1, lateralUp: 0, weep: 0, flat: 0, spread: 0.3, crownAt: 0, ceiling: Infinity, shed: 0,
    leafSlots: 24, leafSpread: 0.62, hang: 0.4, flower: { kind: "spadix", on: "spur", perNode: 2, window: [100, 128, 150, 176], from: 5 }, fruit: { kind: "coconut", on: "spur", perNode: 3, window: [60, 61, 400, 424], from: 6 },
    evergreen: true, palm: { fronds: 4, frond: 17, frondLife: 2.6, trunk: 0.24, lean: 0.45 }, radiusTip: 0.02, pipe: 2.5,
    phenology: { leaf: [60, 61], color: [300, 330], drop: [300, 340], dropMax: 0.08, flush: [120, 170], marcescent: 0 },
  },
  // Blue spruce: a dense spire of flat whorls down to the ground, cones hanging from the top tiers.
  spruce: {
    id: "spruce", cycles: 30, height: 10.4, apical: 0.86, vigor: 2, maxShoot: 3, sideShoot: 2, angle: 78, divergence: 137.5, whorl: 6,
    straight: 1.1, light: 0.18, up: 1.6, lateralUp: -0.08, weep: 0.12, flat: 0.62, spread: 0.34, cone: 0.97, crownAt: 0, ceiling: Infinity, shed: 0.05,
    leafSlots: 3, leafSpread: 0.32, hang: 0, flower: { kind: "candle", on: "tip", perNode: 1, window: [118, 136, 150, 166], from: 3 }, fruit: { kind: "cone", on: "spur", perNode: 1, window: [150, 250, 320, 400], from: 7, above: 0.7 },
    evergreen: true, palm: null, radiusTip: 0.022, pipe: 2.8,
    phenology: { leaf: [60, 61], color: [262, 300], drop: [270, 310], dropMax: 0.1, flush: [130, 178], marcescent: 0 },
  },
  // Redwood: a towering straight column, bare below, short drooping limbs that turn up at the tips.
  redwood: {
    id: "redwood", cycles: 34, height: 15, apical: 0.9, vigor: 2.5, maxShoot: 3, sideShoot: 2, angle: 82, divergence: 137.5, whorl: 0,
    straight: 1.2, light: 0.16, up: 1.7, lateralUp: -0.22, weep: -0.16, flat: 0.3, spread: 0.28, cone: 0.7, crownAt: 0.42, lift: 0.4, ceiling: Infinity, shed: 0.16,
    leafSlots: 6, leafSpread: 0.24, hang: 0, flower: null, fruit: { kind: "cone", on: "tip", perNode: 1, window: [120, 230, 300, 380], from: 8 },
    evergreen: true, palm: null, radiusTip: 0.03, pipe: 1.85,
    phenology: { leaf: [60, 61], color: [262, 300], drop: [270, 310], dropMax: 0.12, flush: [128, 176], marcescent: 0 },
  },
  // Maple: a full round crown on paired buds, gold flowers before the leaves, winged keys that spin down in autumn.
  maple: {
    id: "maple", cycles: 28, height: 9.4, apical: 0.48, vigor: 2.2, maxShoot: 3, sideShoot: 3, angle: 42, divergence: 90, whorl: 0,
    straight: 1, light: 0.4, up: 0.42, lateralUp: 0.14, weep: 0.02, flat: 0.1, spread: 0.52, crownAt: 0.26, ceiling: Infinity, shed: 0.2,
    leafSlots: 5, leafSpread: 0.36, hang: 0, flower: { kind: "puff", on: "tip", perNode: 1, window: [76, 88, 98, 110], from: 5 }, fruit: { kind: "samara", on: "tip", perNode: 2, window: [112, 170, 256, 300], from: 6 },
    evergreen: false, palm: null, radiusTip: 0.025, pipe: 2.7,
    phenology: { ...DECIDUOUS, leaf: [104, 134], color: [250, 282], drop: [272, 308] },
  },
  // Jacaranda: a wide, open vase that thins in late winter and fills with violet bells late in spring.
  jacaranda: {
    id: "jacaranda", cycles: 22, height: 8.4, apical: 0.42, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 46, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.36, up: 0.5, lateralUp: 0.22, weep: 0.06, flat: 0.3, spread: 0.6, crownAt: 0.36, ceiling: 18, shed: 0.18,
    leafSlots: 5, leafSpread: 0.34, hang: 0, flower: { kind: "blossom", on: "tip", perNode: 3, window: [104, 118, 138, 158], from: 4 }, fruit: { kind: "pod", on: "tip", perNode: 1, window: [150, 210, 340, 410], from: 5 },
    evergreen: false, palm: null, radiusTip: 0.024, pipe: 2.6,
    phenology: { leaf: [60, 61], color: [326, 356], drop: [338, 376], dropMax: 0.6, flush: [124, 164], marcescent: 0 },
  },
  // Baobab: a swollen bottle trunk under a flat tangle of stubby limbs, bare for a long dry season.
  baobab: {
    id: "baobab", cycles: 30, height: 8.2, apical: 0.36, vigor: 2.2, maxShoot: 2, sideShoot: 2, angle: 54, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.3, up: 0.6, lateralUp: 0.34, weep: 0, flat: 0.34, spread: 0.46, crownAt: 0.6, ceiling: 13, shed: 0.16,
    leafSlots: 3, leafSpread: 0.32, hang: 0, flower: { kind: "bell", on: "tip", perNode: 1, window: [128, 142, 150, 166], from: 6 }, fruit: { kind: "gourd", on: "tip", perNode: 1, window: [150, 230, 340, 420], from: 8 },
    evergreen: false, palm: null, radiusTip: 0.03, pipe: 2.05,
    phenology: { ...DECIDUOUS, leaf: [122, 150], color: [252, 282], drop: [262, 296] },
  },
  // Apple: a low, spreading crown on fruiting spurs, pink-white blossom after the leaves break, red apples bowing the limbs.
  apple: {
    id: "apple", cycles: 26, height: 7, apical: 0.44, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 52, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.4, up: 0.38, lateralUp: 0.06, weep: 0.06, flat: 0.22, spread: 0.6, crownAt: 0.3, ceiling: Infinity, shed: 0.2,
    leafSlots: 4, leafSpread: 0.34, hang: 0, flower: { kind: "blossom", on: "spur", perNode: 3, window: [112, 122, 128, 142], from: 4 }, fruit: { kind: "apple", on: "spur", perNode: 1, window: [150, 240, 262, 300], from: 5 },
    evergreen: false, palm: null, radiusTip: 0.026, pipe: 2.6,
    phenology: { ...DECIDUOUS, leaf: [108, 136] },
  },
  // Pear: tall and upright, white blossom early, pears hanging from spurs; the leaves go red late.
  pear: {
    id: "pear", cycles: 28, height: 9, apical: 0.5, vigor: 2.2, maxShoot: 3, sideShoot: 3, angle: 38, divergence: 137.5, whorl: 0,
    straight: 1, light: 0.4, up: 0.5, lateralUp: 0.18, weep: 0.02, flat: 0.06, spread: 0.46, crownAt: 0.26, ceiling: Infinity, shed: 0.16,
    leafSlots: 4, leafSpread: 0.32, hang: 0, flower: { kind: "blossom", on: "spur", perNode: 3, window: [88, 96, 104, 118], from: 5 }, fruit: { kind: "pear", on: "spur", perNode: 1, window: [150, 230, 252, 280], from: 6 },
    evergreen: false, palm: null, radiusTip: 0.025, pipe: 2.7,
    phenology: { ...DECIDUOUS, leaf: [104, 132], color: [270, 300], drop: [288, 322] },
  },
  // Peach: small, open and wide, deep pink blossom on bare twigs, fuzzy peaches by midsummer; short-lived.
  peach: {
    id: "peach", cycles: 20, height: 5.8, apical: 0.38, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 50, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.4, up: 0.45, lateralUp: 0.24, weep: 0.02, flat: 0.2, spread: 0.66, crownAt: 0.26, ceiling: 16, shed: 0.2,
    leafSlots: 5, leafSpread: 0.3, hang: 0, flower: { kind: "blossom", on: "spur", perNode: 2, window: [84, 94, 100, 112], from: 3 }, fruit: { kind: "peach", on: "tip", perNode: 1, window: [150, 196, 230, 250], from: 3 },
    evergreen: false, palm: null, radiusTip: 0.024, pipe: 2.6,
    phenology: { ...DECIDUOUS, leaf: [100, 128] },
  },
  // Plum: a cherry's cousin, white blossom first of all, dusky purple plums in late summer.
  plum: {
    id: "plum", cycles: 24, height: 6.8, apical: 0.5, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 42, divergence: 137.5, whorl: 0,
    straight: 1, light: 0.4, up: 0.5, lateralUp: 0.14, weep: 0.04, flat: 0.12, spread: 0.5, crownAt: 0.3, ceiling: Infinity, shed: 0.2,
    leafSlots: 4, leafSpread: 0.32, hang: 0, flower: { kind: "blossom", on: "spur", perNode: 3, window: [80, 90, 95, 108], from: 3 }, fruit: { kind: "plum", on: "spur", perNode: 2, window: [160, 208, 236, 258], from: 4 },
    evergreen: false, palm: null, radiusTip: 0.024, pipe: 2.7,
    phenology: { ...DECIDUOUS, leaf: [98, 128] },
  },
  // Orange: a dense evergreen dome to the ground, white blossom in spring, oranges that hang on into the next year.
  orange: {
    id: "orange", cycles: 26, height: 6.6, apical: 0.42, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 46, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.36, up: 0.4, lateralUp: 0.1, weep: 0.05, flat: 0.1, spread: 0.56, crownAt: 0.14, ceiling: Infinity, shed: 0.08,
    leafSlots: 5, leafSpread: 0.32, hang: 0, flower: { kind: "blossom", on: "tip", perNode: 2, window: [90, 104, 116, 132], from: 4 }, fruit: { kind: "orange", on: "tip", perNode: 1, window: [160, 300, 400, 424], from: 5 },
    evergreen: true, palm: null, radiusTip: 0.024, pipe: 2.6,
    phenology: BROADLEAF_EVERGREEN,
  },
  // Lemon: a smaller, looser citrus that flowers early and holds lemons most of the year.
  lemon: {
    id: "lemon", cycles: 24, height: 5.6, apical: 0.4, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 50, divergence: 137.5, whorl: 0,
    straight: 0.85, light: 0.38, up: 0.42, lateralUp: 0.16, weep: 0.06, flat: 0.12, spread: 0.56, crownAt: 0.18, ceiling: Infinity, shed: 0.12,
    leafSlots: 5, leafSpread: 0.3, hang: 0, flower: { kind: "blossom", on: "tip", perNode: 2, window: [70, 84, 100, 120], from: 3 }, fruit: { kind: "lemon", on: "tip", perNode: 1, window: [140, 240, 380, 422], from: 4 },
    evergreen: true, palm: null, radiusTip: 0.023, pipe: 2.6,
    phenology: BROADLEAF_EVERGREEN,
  },
  // Fig: low and sprawling under few, huge leaves; no flowers to see (they bloom inside the fruit), figs in late summer.
  fig: {
    id: "fig", cycles: 24, height: 6.4, apical: 0.36, vigor: 2.1, maxShoot: 3, sideShoot: 3, angle: 54, divergence: 137.5, whorl: 0,
    straight: 0.85, light: 0.36, up: 0.4, lateralUp: 0.2, weep: 0, flat: 0.3, spread: 0.7, crownAt: 0.2, ceiling: 14, shed: 0.18,
    leafSlots: 3, leafSpread: 0.46, hang: 0, flower: null, fruit: { kind: "fig", on: "tip", perNode: 2, window: [160, 206, 238, 260], from: 3 },
    evergreen: false, palm: null, radiusTip: 0.03, pipe: 2.4,
    phenology: { ...DECIDUOUS, leaf: [110, 140], color: [268, 296], drop: [282, 316] },
  },
  // Mango: a big evergreen dome, cream flower plumes in late winter, mangoes swinging on long stalks.
  mango: {
    id: "mango", cycles: 30, height: 10, apical: 0.45, vigor: 2.2, maxShoot: 3, sideShoot: 3, angle: 48, divergence: 137.5, whorl: 0,
    straight: 0.9, light: 0.38, up: 0.45, lateralUp: 0.08, weep: 0.06, flat: 0.14, spread: 0.6, crownAt: 0.26, ceiling: Infinity, shed: 0.1,
    leafSlots: 5, leafSpread: 0.36, hang: 0.1, flower: { kind: "puff", on: "tip", perNode: 2, window: [64, 80, 92, 108], from: 5 }, fruit: { kind: "mango", on: "tip", perNode: 1, window: [130, 176, 232, 254], from: 6 },
    evergreen: true, palm: null, radiusTip: 0.026, pipe: 2.55,
    phenology: BROADLEAF_EVERGREEN,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export function speciesOf(id: string): Species {
  return Object.hasOwn(SPECIES, id) ? SPECIES[id as SpeciesId] : SPECIES.cherry;
}

// ---------------------------------------------------------------- numbers

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const ramp = (value: number, start: number, end: number): number => clamp01((value - start) / Math.max(end - start, 1e-6));
const smooth = (value: number): number => value * value * (3 - 2 * value);
const at = (values: ArrayLike<number>, index: number): number => values[index] ?? 0;

interface Vec { x: number; y: number; z: number }

const vec = (x: number, y: number, z: number): Vec => ({ x, y, z });
const add = (a: Vec, b: Vec, scale = 1): Vec => vec(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
const lengthOf = (a: Vec): number => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vec, b: Vec): Vec => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

function normalize(a: Vec, fallback: Vec = vec(0, 1, 0)): Vec {
  const length = lengthOf(a);
  return length < 1e-9 ? fallback : vec(a.x / length, a.y / length, a.z / length);
}

/** Rotates `v` about the unit `axis` by `angle` radians (Rodrigues). */
function rotate(v: Vec, axis: Vec, angle: number): Vec {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const k = cross(axis, v);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  return vec(
    v.x * cos + k.x * sin + axis.x * dot * (1 - cos),
    v.y * cos + k.y * sin + axis.y * dot * (1 - cos),
    v.z * cos + k.z * sin + axis.z * dot * (1 - cos),
  );
}

/** Any unit vector perpendicular to `a`. */
function perpendicular(a: Vec): Vec {
  return normalize(Math.abs(a.y) < 0.9 ? cross(a, vec(0, 1, 0)) : cross(a, vec(1, 0, 0)));
}

// ---------------------------------------------------------------- light

const GRID_X = 84;
const GRID_Y = 96;
const SHADOW_DEPTH = 7;
const SHADOW_FALLOFF = 1.75;
const LIGHT_FULL = 4.2;

/** The shadow-propagation light field: each internode darkens a pyramid below it. */
interface LightGrid { readonly shadow: Float32Array }

function cellOf(p: Vec): number {
  const ix = Math.round(p.x) + GRID_X / 2;
  const iy = Math.round(p.y) + 2;
  const iz = Math.round(p.z) + GRID_X / 2;
  if (ix < 0 || iz < 0 || iy < 0 || ix >= GRID_X || iz >= GRID_X || iy >= GRID_Y) return -1;
  return (iy * GRID_X + iz) * GRID_X + ix;
}

function castShadow(grid: LightGrid, p: Vec, sign: number): void {
  const center = cellOf(p);
  if (center < 0) return;
  const ix = center % GRID_X;
  const iz = Math.floor(center / GRID_X) % GRID_X;
  const iy = Math.floor(center / (GRID_X * GRID_X));
  for (let q = 0; q <= SHADOW_DEPTH && iy - q >= 0; q += 1) {
    const amount = sign * SHADOW_FALLOFF ** -q;
    const reach = Math.min(q, 3);
    for (let oz = -reach; oz <= reach; oz += 1) {
      const row = ((iy - q) * GRID_X + Math.min(GRID_X - 1, Math.max(0, iz + oz))) * GRID_X;
      for (let ox = -reach; ox <= reach; ox += 1) {
        const index = row + Math.min(GRID_X - 1, Math.max(0, ix + ox));
        grid.shadow[index] = Math.max(0, at(grid.shadow, index) + amount);
      }
    }
  }
}

function shadowAt(grid: LightGrid, p: Vec): number {
  const index = cellOf(p);
  return index < 0 ? LIGHT_FULL * 2 : at(grid.shadow, index);
}

/** Exposure of a bud in [0, 1]: its own internode's shadow does not count. */
function exposure(grid: LightGrid, p: Vec): number {
  return clamp01((LIGHT_FULL - shadowAt(grid, p) + 1) / LIGHT_FULL);
}

/** The direction of least shadow around `p`, leaning up. */
function lightDirection(grid: LightGrid, p: Vec): Vec {
  const sample = (dx: number, dy: number, dz: number): number => shadowAt(grid, vec(p.x + dx * 2, p.y + dy * 2, p.z + dz * 2));
  const gradient = vec(sample(1, 0, 0) - sample(-1, 0, 0), sample(0, 1, 0) - sample(0, -1, 0), sample(0, 0, 1) - sample(0, 0, -1));
  return normalize(vec(-gradient.x, -gradient.y + 0.35, -gradient.z));
}

// ---------------------------------------------------------------- the simulation

/** Growing tree state, as parallel arrays so the graph stays flat and ordered. */
interface Sim {
  readonly species: Species;
  readonly random: () => number;
  readonly grid: LightGrid;
  readonly maxNodes: number;
  readonly pos: Vec[];
  readonly dir: Vec[];
  readonly parent: number[];
  readonly order: number[];
  readonly birth: number[];
  readonly span: number[];
  readonly main: number[];
  readonly deadAt: number[];
  readonly shedAt: number[];
  readonly weak: number[];
  readonly children: number[][];
  readonly buds: Bud[];
  readonly nodeBuds: number[][];
  height: number;
}

interface Bud {
  readonly node: number;
  readonly dir: Vec;
  readonly terminal: boolean;
  alive: boolean;
  light: number;
  vigor: number;
}

function addNode(sim: Sim, parent: number, pos: Vec, dir: Vec, order: number, birth: number, span: number, main: boolean): number {
  const index = sim.pos.length;
  sim.pos.push(pos);
  sim.dir.push(dir);
  sim.parent.push(parent);
  sim.order.push(order);
  sim.birth.push(birth);
  sim.span.push(span);
  sim.main.push(main ? 1 : 0);
  sim.deadAt.push(Infinity);
  sim.shedAt.push(Infinity);
  sim.weak.push(0);
  sim.children.push([]);
  sim.nodeBuds.push([]);
  sim.children[parent]?.push(index);
  sim.height = Math.max(sim.height, pos.y);
  castShadow(sim.grid, pos, 1);
  return index;
}

function addBud(sim: Sim, node: number, dir: Vec, terminal: boolean): void {
  sim.nodeBuds[node]?.push(sim.buds.length);
  sim.buds.push({ node, dir, terminal, alive: true, light: 0, vigor: 0 });
}

/** Side buds for a fresh internode: one per node by phyllotaxis, or a whorl at a shoot's end. */
function setLateralBuds(sim: Sim, node: number, axis: Vec, turn: number, shootEnd: boolean): void {
  const { species, random } = sim;
  const angle = (species.angle * Math.PI) / 180;
  const side = perpendicular(axis);
  if (species.whorl > 0 && at(sim.order, node) > 0) {
    // Conifer side branches fork flat, one bud each side, so the tiers stay layered.
    if (!shootEnd) return;
    const flatSide = normalize(cross(axis, vec(0, 1, 0)), side);
    for (const sign of [-1, 1]) addBud(sim, node, normalize(add(vec(axis.x * 0.7, axis.y * 0.7, axis.z * 0.7), flatSide, sign * 0.7)), false);
    return;
  }
  if (species.whorl > 0) {
    if (!shootEnd) return;
    for (let index = 0; index < species.whorl; index += 1) {
      const around = turn + (index / species.whorl) * Math.PI * 2 + (random() - 0.5) * 0.4;
      addBud(sim, node, normalize(rotate(rotate(axis, side, angle), axis, around)), false);
    }
    return;
  }
  const around = turn + (random() - 0.5) * 0.3;
  addBud(sim, node, normalize(rotate(rotate(axis, side, angle * (0.85 + random() * 0.3)), axis, around)), false);
}

function tropism(sim: Sim, heading: Vec, order: number, y: number): Vec {
  const { species } = sim;
  const flatten = y > species.ceiling;
  if (order === 0 && !flatten) return vec(0, species.up, 0);
  const level = vec(heading.x, 0, heading.z);
  const horizontal = normalize(level, vec(1, 0, 0));
  const droop = species.lateralUp - (order >= 2 ? species.weep * Math.min(order - 1, 2) : 0);
  const flat = flatten ? Math.max(species.flat, 0.6) : species.flat;
  return vec((horizontal.x - heading.x) * flat, droop + (flatten ? -0.1 : 0) + (horizontal.y - heading.y) * flat, (horizontal.z - heading.z) * flat);
}

/** Grows `count` internodes out of `bud`, each bending toward light and by tropism. */
function growShoot(sim: Sim, bud: Bud, count: number, cycle: number): void {
  const { species } = sim;
  let node = bud.node;
  let heading = bud.dir;
  const order = at(sim.order, node) + (bud.terminal ? 0 : 1);
  let turn = sim.random() * Math.PI * 2;
  for (let step = 0; step < count && sim.pos.length < sim.maxNodes; step += 1) {
    const from = sim.pos[node] ?? vec(0, 0, 0);
    const light = order >= 2 ? species.light / (1 + species.weep * 4) : species.light;
    const pull = add(add(vec(heading.x * species.straight, heading.y * species.straight, heading.z * species.straight), lightDirection(sim.grid, from), light), tropism(sim, heading, order, from.y));
    heading = normalize(pull, heading);
    const to = add(from, heading, 0.88 + sim.random() * 0.24);
    if (to.y < 0.6 || cellOf(to) < 0) return;
    node = addNode(sim, node, to, heading, order, cycle + step / count, 1 / count, bud.terminal || step > 0);
    turn += (species.divergence * Math.PI) / 180;
    setLateralBuds(sim, node, heading, turn, step === count - 1);
  }
  if (node !== bud.node) addBud(sim, node, heading, true);
}

/** The crown's reach at height y. A conifer's narrows up the tree, so the crown closes to a spire. */
function crownReach(sim: Sim, y: number): number {
  const cone = sim.species.cone ?? 0;
  return sim.species.spread * Math.max(sim.height, 6) * (1 - cone * clamp01(y / Math.max(sim.height, 1))) + 0.6 * cone;
}

/** Light seen by every bud, then gathered down the branches (basipetal). */
function gatherLight(sim: Sim, light: number[], budCount: number[]): void {
  for (const bud of sim.buds) {
    const at = sim.pos[bud.node] ?? vec(0, 0, 0);
    const reach = crownReach(sim, at.y);
    // Past the species' crown spread the light fades, so a big crown fills in
    // rather than sprawling sideways.
    const envelope = clamp01(1 - (Math.hypot(at.x, at.z) - reach) / 1.5);
    bud.light = bud.alive ? exposure(sim.grid, at) * envelope : 0;
  }
  for (let node = sim.pos.length - 1; node >= 0; node -= 1) {
    let sum = 0;
    let buds = 0;
    for (const index of sim.nodeBuds[node] ?? []) {
      const bud = sim.buds[index];
      if (bud?.alive === true) { sum += bud.light; buds += 1; }
    }
    for (const child of sim.children[node] ?? []) {
      if (at(sim.deadAt, child) !== Infinity) continue;
      sum += at(light, child);
      buds += at(budCount, child);
    }
    light[node] = sum;
    budCount[node] = buds;
  }
}

/** Splits a node's vigor between the continuing axis and its side shoots (Borchert–Honda). */
function splitVigor(sim: Sim, node: number, vigor: number, light: number[], incoming: number[]): void {
  const lambda = sim.species.apical;
  const mainTargets: [number, number][] = [];
  const sideTargets: [number, number][] = [];
  for (const child of sim.children[node] ?? []) {
    if (at(sim.deadAt, child) !== Infinity) continue;
    (at(sim.main, child) === 1 ? mainTargets : sideTargets).push([child, at(light, child)]);
  }
  for (const index of sim.nodeBuds[node] ?? []) {
    const bud = sim.buds[index];
    if (bud?.alive === true) (bud.terminal ? mainTargets : sideTargets).push([-1 - index, bud.light]);
  }
  const mainLight = mainTargets.reduce((sum, [, value]) => sum + value, 0);
  const sideLight = sideTargets.reduce((sum, [, value]) => sum + value, 0);
  const total = lambda * mainLight + (1 - lambda) * sideLight;
  if (total <= 0) return;
  const give = (targets: [number, number][], share: number, sum: number): void => {
    for (const [target, value] of targets) {
      const amount = sum > 0 ? (share * value) / sum : 0;
      if (target >= 0) incoming[target] = amount;
      else { const bud = sim.buds[-1 - target]; if (bud !== undefined) bud.vigor = amount; }
    }
  };
  give(mainTargets, (vigor * lambda * mainLight) / total, mainLight);
  give(sideTargets, (vigor * (1 - lambda) * sideLight) / total, sideLight);
}

function distributeVigor(sim: Sim, light: number[], vigorScale: number): void {
  const incoming = new Array<number>(sim.pos.length).fill(0);
  for (const bud of sim.buds) bud.vigor = 0;
  incoming[0] = sim.species.vigor * vigorScale * at(light, 0);
  for (let node = 0; node < sim.pos.length; node += 1) {
    if (at(sim.deadAt, node) !== Infinity) continue;
    splitVigor(sim, node, at(incoming, node), light, incoming);
  }
}

/** Kills a subtree: its buds stop, its shadow lifts, and it drops after it has hung dead a while. */
function killBranch(sim: Sim, root: number, cycle: number): void {
  const stack = [root];
  let size = 0;
  while (stack.length > 0) {
    const node = stack.pop() ?? 0;
    if (at(sim.deadAt, node) !== Infinity) continue;
    sim.deadAt[node] = cycle;
    size += 1;
    castShadow(sim.grid, sim.pos[node] ?? vec(0, 0, 0), -1);
    for (const index of sim.nodeBuds[node] ?? []) { const bud = sim.buds[index]; if (bud !== undefined) bud.alive = false; }
    stack.push(...(sim.children[node] ?? []));
  }
  sim.shedAt[root] = cycle + 0.5 + sim.random() * 1.1 + Math.log2(1 + size) * 0.55;
}

/** Self-pruning: a side branch whose buds stay in deep shade starves and dies. */
function prune(sim: Sim, light: number[], budCount: number[], cycle: number, threshold: number): void {
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.main, node) === 1 || at(sim.deadAt, node) !== Infinity) continue;
    const buds = at(budCount, node);
    const efficiency = buds > 0 ? at(light, node) / buds : 0;
    sim.weak[node] = efficiency < threshold ? at(sim.weak, node) + 1 : 0;
    if (at(sim.weak, node) >= 3 && cycle - at(sim.birth, node) > 1.5) killBranch(sim, node, cycle);
  }
}

/** A tall conifer sheds the old limbs low on its trunk as it rises, a few each cycle. */
function liftCrown(sim: Sim, cycle: number): void {
  const below = (sim.species.lift ?? 0) * sim.height;
  if (below <= 0) return;
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.order, node) !== 1 || at(sim.order, at(sim.parent, node)) !== 0 || at(sim.deadAt, node) !== Infinity) continue;
    if ((sim.pos[node]?.y ?? 0) < below && sim.random() < 0.5) killBranch(sim, node, cycle);
  }
}

/** Buds on the bare lower trunk never break: the crown lifts as the tree grows. */
function clearTrunk(sim: Sim): void {
  const clear = sim.species.crownAt * sim.height;
  for (const bud of sim.buds) {
    if (!bud.alive || bud.terminal) continue;
    if (at(sim.order, bud.node) === 0 && (sim.pos[bud.node]?.y ?? 0) < clear) bud.alive = false;
  }
}

/** Internodes each bud would make this cycle, before the growth curve trims them. */
function budShoots(sim: Sim): [Bud, number][] {
  const shoots: [Bud, number][] = [];
  for (const bud of sim.buds) {
    if (!bud.alive) continue;
    const count = Math.min(bud.terminal && at(sim.order, bud.node) === 0 ? sim.species.maxShoot : sim.species.sideShoot, Math.floor(bud.vigor));
    if (count >= 1) shoots.push([bud, count]);
  }
  return shoots;
}

/**
 * One cycle of growth. `allowed` is how many internodes the growth curve
 * grants this cycle; when the buds want more, every shoot is trimmed by the
 * same share (rounded at random), so no part of the crown is favoured.
 */
function growCycle(sim: Sim, cycle: number, vigorScale: number, shed: number, allowed: number): void {
  const light: number[] = [];
  const budCount: number[] = [];
  clearTrunk(sim);
  gatherLight(sim, light, budCount);
  distributeVigor(sim, light, vigorScale);
  const shoots = budShoots(sim);
  const wanted = shoots.reduce((sum, [, count]) => sum + count, 0);
  const share = wanted > allowed ? Math.max(0, allowed) / wanted : 1;
  for (const [bud, count] of shoots) {
    const trimmed = share < 1 ? Math.floor(count * share + sim.random()) : count;
    if (trimmed < 1) continue;
    bud.alive = false;
    growShoot(sim, bud, trimmed, cycle);
  }
  prune(sim, light, budCount, cycle, shed);
  liftCrown(sim, cycle);
}

/** The highest internode on the leader. */
function leaderTop(sim: Sim): number {
  let top = 0;
  let height = 0;
  for (let node = 0; node < sim.pos.length; node += 1) {
    const y = sim.pos[node]?.y ?? 0;
    if (at(sim.order, node) === 0 && y > height) { top = node; height = y; }
  }
  return top;
}

/** The leader's top few internodes: old trees lose their top first and go stag-headed. */
function killLeaderTop(sim: Sim, cycle: number): void {
  let node = leaderTop(sim);
  for (let step = 0; step < 6 && node > 0; step += 1) node = at(sim.parent, node);
  // Only the top of the crown dies back; the trunk itself never falls.
  if (node > 0 && (sim.pos[node]?.y ?? 0) > sim.height * 0.6) killBranch(sim, node, cycle);
}

/** Dieback: the weakest living limbs die, a growing share of the crown each cycle. */
function dieBack(sim: Sim, cycle: number, share: number): void {
  const light: number[] = [];
  const budCount: number[] = [];
  gatherLight(sim, light, budCount);
  const candidates: [number, number][] = [];
  let living = 0;
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.deadAt, node) !== Infinity) continue;
    living += 1;
    const buds = at(budCount, node);
    // Old trees die back from the twigs inward; the big scaffold limbs stay.
    if (at(sim.main, node) === 0 && buds > 0 && buds < 40) candidates.push([node, at(light, node) / buds - sim.random() * 0.15]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  let killed = 0;
  for (const [node] of candidates) {
    if (killed >= living * share) break;
    if (at(sim.deadAt, node) !== Infinity) continue;
    const before = sim.deadAt.filter((value) => value !== Infinity).length;
    killBranch(sim, node, cycle);
    killed += sim.deadAt.filter((value) => value !== Infinity).length - before;
  }
}

/** Old age: vigor fades, the top dies back, then limb after limb, until the tree stands dead. */
function declineCycle(sim: Sim, cycle: number, decline: number): void {
  if (decline > 0.3 && decline <= 0.3 + 1 / (sim.species.cycles * 0.28)) killLeaderTop(sim, cycle);
  dieBack(sim, cycle, 0.03 + decline * decline * 0.3);
  growCycle(sim, cycle, Math.max(0.3, 1 - decline * 0.9), sim.species.shed + decline * 0.2, declineAllowance(sim, decline));
}

// ---------------------------------------------------------------- the model

export interface TreeModel {
  readonly species: Species;
  readonly seed: number;
  /** Cycles of the whole life; the tree is dead at `cycles`. */
  readonly cycles: number;
  /** Last cycle that adds wood; after it the tree declines. */
  readonly matureAt: number;
  readonly count: number;
  readonly parent: Int32Array;
  /** Grown positions, world units, trunk base at the origin. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly order: Uint8Array;
  /** An internode starts growing at `birth` and is full length `span` later. */
  readonly birth: Float32Array;
  readonly span: Float32Array;
  readonly deadAt: Float32Array;
  readonly shedAt: Float32Array;
  /** Wind phase per internode. */
  readonly phase: Float32Array;
  readonly leaves: LeafSlots;
  /** Flower places (blossoms, catkins, candles, puffs); empty when the species has none. */
  readonly blossoms: LeafSlots;
  /** Fruit places (cherries, acorns, cones, pods). */
  readonly fruit: LeafSlots;
  /** Root flare: angle and reach of each surface root. */
  readonly roots: readonly { readonly angle: number; readonly reach: number }[];
}

/** Leaf or blossom places, each tied to a node with a fixed offset and a rank for the year's timing. */
export interface LeafSlots {
  readonly count: number;
  readonly node: Int32Array;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly dz: Float32Array;
  readonly rank: Float32Array;
  readonly size: Float32Array;
  readonly tone: Uint8Array;
}

export interface GrowInput {
  /** A species id; anything else grows a cherry. */
  readonly species: string;
  readonly seed: number;
  readonly maxNodes?: number;
  /**
   * A hybrid: each species' share of the tree's makeup (any positive weights;
   * they are normalised). The tree grows a form between them by share; the
   * largest share decides what cannot be halved (a palm's way of growing,
   * whorls, flowers, fruit, evergreen). `species` is ignored when it is set.
   */
  readonly mix?: Readonly<Record<string, number>>;
}

/** The species' shares in a mix, largest first, unknown ids and non-positive weights dropped, summing to 1. */
export function mixShares(mix: Readonly<Record<string, number>>): [SpeciesId, number][] {
  const known = Object.entries(mix).filter(([id, weight]) => Object.hasOwn(SPECIES, id) && weight > 0) as [SpeciesId, number][];
  const total = known.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return [["cherry", 1]];
  return known.map(([id, weight]) => [id, weight / total] as [SpeciesId, number]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** Past this many internodes a leader's ceiling never comes into play, so an unbounded one blends as this. */
const OPEN_CEILING = 60;

const blendNumber = (shares: readonly [SpeciesId, number][], pick: (species: Species) => number): number => {
  const mean = shares.reduce((sum, [id, share]) => sum + Math.min(pick(SPECIES[id]), OPEN_CEILING) * share, 0);
  return shares.some(([id]) => pick(SPECIES[id]) === Infinity) && mean >= OPEN_CEILING * 0.95 ? Infinity : mean;
};

/**
 * A hybrid species: every measure of form is the shares' weighted mean (an
 * 80/20 cherry-oak is mostly a cherry's crown with an oak's broader reach and
 * flatter limbs); what has no middle comes from the major share.
 */
export function blendSpecies(mix: Readonly<Record<string, number>>): Species {
  const shares = mixShares(mix);
  const major = SPECIES[shares[0]![0]];
  if (shares.length === 1 || major.palm !== null) return major;
  const mean = (pick: (species: Species) => number): number => blendNumber(shares, pick);
  const round = (pick: (species: Species) => number): number => Math.max(1, Math.round(mean(pick)));
  const window = (pick: (species: Species) => readonly [number, number]): [number, number] => [mean((species) => pick(species)[0]), mean((species) => pick(species)[1])];
  // A clean bole has no middle either: the kind that prunes its low limbs hardest keeps the trunk bare (lift).
  // Shoot lengths go with the branching habit: a whorled kind buds only at a shoot's end, so a pine
  // given a willow's long side shoots would grow bare whips. Across habits they come from the major share.
  const sameHabit = shares.every(([id]) => (SPECIES[id].whorl > 0) === (major.whorl > 0));
  const shoot = (pick: (species: Species) => number): number => (sameHabit ? round(pick) : pick(major));
  return {
    ...major,
    cycles: round((species) => species.cycles), height: mean((species) => species.height), apical: mean((species) => species.apical), vigor: mean((species) => species.vigor),
    maxShoot: shoot((species) => species.maxShoot), sideShoot: shoot((species) => species.sideShoot), angle: mean((species) => species.angle),
    straight: mean((species) => species.straight), light: mean((species) => species.light), up: mean((species) => species.up), lateralUp: mean((species) => species.lateralUp),
    weep: mean((species) => species.weep), flat: mean((species) => species.flat), crownAt: mean((species) => species.crownAt), lift: Math.max(...shares.map(([id]) => SPECIES[id].lift ?? 0)),
    spread: mean((species) => species.spread), cone: mean((species) => species.cone ?? 0), ceiling: mean((species) => species.ceiling), shed: mean((species) => species.shed),
    leafSlots: round((species) => species.leafSlots), leafSpread: mean((species) => species.leafSpread), hang: mean((species) => species.hang),
    radiusTip: mean((species) => species.radiusTip), pipe: mean((species) => species.pipe),
    phenology: {
      ...major.phenology,
      marcescent: mean((species) => species.phenology.marcescent), dropMax: mean((species) => species.phenology.dropMax),
      leaf: window((species) => species.phenology.leaf), color: window((species) => species.phenology.color),
      drop: window((species) => species.phenology.drop), flush: window((species) => species.phenology.flush),
    },
  };
}

/**
 * The growth curve: the wood a tree may have made by `cycle` rises fast while
 * young and eases off with age, but never flattens before old age, so a tree
 * keeps getting bigger every cycle until it starts to decline.
 */
function growthAllowance(sim: Sim, cycle: number, matureAt: number): number {
  const life = Math.min(1, cycle / matureAt);
  // The curve is of living wood: twigs that starve in the shade are replaced,
  // so the crown keeps filling out instead of peaking young and thinning.
  let living = 0;
  for (const value of sim.deadAt) if (value === Infinity) living += 1;
  const target = sim.maxNodes * LIVING_AT_PRIME * (0.08 + 0.92 * life);
  // A share of the whole budget, dead wood included, is kept back for old age, which still grows.
  const room = sim.maxNodes * OLD_AGE_KEEP - sim.pos.length;
  return Math.min(room, Math.max(target - living, living * 0.015));
}

const OLD_AGE_KEEP = 0.84;
/** Living internodes at maturity, as a share of the budget; the rest is wood the crown shed on the way. */
const LIVING_AT_PRIME = 0.5;

/**
 * Old trees keep growing while anything of them lives: far less each cycle,
 * tapering on a curve, and more than a real tree would, until the end.
 */
function declineAllowance(sim: Sim, decline: number): number {
  const room = Math.max(0, sim.maxNodes - sim.pos.length);
  return room * 0.13 * (1 - decline) ** 1.1;
}

function newSim(species: Species, seed: number, maxNodes: number): Sim {
  return {
    species, random: createRandom(seed ^ 0x7ee5), grid: { shadow: new Float32Array(GRID_X * GRID_X * GRID_Y) }, maxNodes,
    pos: [], dir: [], parent: [], order: [], birth: [], span: [], main: [], deadAt: [], shedAt: [], weak: [], children: [], buds: [], nodeBuds: [], height: 0,
  };
}

/** Unfolds one frond from the crown: a rachis that leaves steep and arches out and down. */
function growFrond(sim: Sim, top: number, around: number, length: number, cycle: number): void {
  const segments = 8;
  const out = vec(Math.cos(around), 0, Math.sin(around));
  const lift = 1 - sim.random() * 0.5;
  const sag = 1.6 + sim.random() * 0.4;
  let node = top;
  for (let step = 0; step < segments; step += 1) {
    const heading = normalize(vec(out.x, lift - (step / (segments - 1)) * sag, out.z));
    node = addNode(sim, node, add(sim.pos[node] ?? vec(0, 0, 0), heading, length / segments), heading, 1, cycle + step * 0.03, 0.2, false);
  }
}

/** Two trunk internodes a cycle: barely rising while the young palm establishes, curving back toward the sky. */
function climbTrunk(sim: Sim, top: number, heading: Vec, cycle: number, vigor: number): [number, Vec] {
  const rise = (0.2 + 0.85 * ramp(cycle, 2, 6)) * vigor;
  let node = top;
  let dir = heading;
  for (let step = 0; step < 2; step += 1) {
    dir = normalize(add(dir, vec(0, 1, 0), 0.05));
    node = addNode(sim, node, add(sim.pos[node] ?? vec(0, 0, 0), dir, rise), dir, 0, cycle - 1 + step * 0.5, 0.5, true);
  }
  return [node, dir];
}

function simulatePalm(sim: Sim, palm: PalmSpec): void {
  const { species, random } = sim;
  const toward = random() * Math.PI * 2;
  const lean = palm.lean * (0.6 + random() * 0.8);
  let heading = normalize(vec(Math.cos(toward) * lean, 1, Math.sin(toward) * lean));
  let top = addNode(sim, -1, vec(0, 0.2, 0), heading, 0, 0, 1, true);
  const matureAt = Math.round(species.cycles * 0.72);
  let around = random() * Math.PI * 2;
  for (let cycle = 1; cycle < species.cycles; cycle += 1) {
    const life = Math.min(1, cycle / matureAt);
    const decline = cycle > matureAt ? (cycle - matureAt) / (species.cycles - matureAt) : 0;
    [top, heading] = climbTrunk(sim, top, heading, cycle, 1 - decline * 0.75);
    const fronds = Math.max(1, Math.round(palm.fronds * (1 - decline * 0.6)));
    for (let index = 0; index < fronds; index += 1) {
      around += (species.divergence * Math.PI) / 180;
      const first = sim.pos.length;
      growFrond(sim, top, around, palm.frond * (0.15 + 0.85 * life ** 0.8) * (1 - decline * 0.35), cycle - 1 + index / fronds);
      const dies = cycle + palm.frondLife * (0.8 + random() * 0.4);
      for (let node = first; node < sim.pos.length; node += 1) sim.deadAt[node] = dies;
      sim.shedAt[first] = dies + 0.3 + random() * 0.5;
    }
  }
  // The last crown dies with the palm and drops, leaving the bare trunk standing.
  for (let node = 0; node < sim.pos.length; node += 1) {
    sim.deadAt[node] = Math.min(at(sim.deadAt, node), species.cycles - 0.6);
    if (at(sim.shedAt, node) !== Infinity) sim.shedAt[node] = Math.min(at(sim.shedAt, node), species.cycles - 0.2);
  }
}

function simulate(species: Species, seed: number, maxNodes: number): Sim {
  const sim = newSim(species, seed, maxNodes);
  if (species.palm !== null) {
    simulatePalm(sim, species.palm);
    return sim;
  }
  const lean = normalize(vec((sim.random() - 0.5) * 0.12, 1, (sim.random() - 0.5) * 0.12));
  const seedling = addNode(sim, -1, vec(lean.x, 1, lean.z), lean, 0, 0, 1, true);
  addBud(sim, seedling, lean, true);
  const matureAt = Math.round(species.cycles * 0.72);
  for (let cycle = 1; cycle < species.cycles; cycle += 1) {
    if (cycle <= matureAt) growCycle(sim, cycle, 1 + 1.6 / (1 + cycle * 0.4), species.shed, growthAllowance(sim, cycle, matureAt));
    else declineCycle(sim, cycle, (cycle - matureAt) / (species.cycles - matureAt));
  }
  // Whatever still lives dies over the last cycle; the snag then stands frozen.
  for (let node = 0; node < sim.pos.length; node += 1) if (at(sim.deadAt, node) === Infinity) sim.deadAt[node] = species.cycles - 0.6;
  return sim;
}

/** What slots hang from: how many nodes, each one's heading, and whether the tree is a palm. */
interface SlotSource {
  readonly count: number;
  readonly palm: boolean;
  heading(node: number): Vec;
}

const simSource = (sim: Sim): SlotSource => ({ count: sim.pos.length, palm: sim.species.palm !== null, heading: (node) => sim.dir[node] ?? vec(0, 1, 0) });

function leafSlots(source: SlotSource, perNode: number, spread: number, hang: number, seed: number, eligible: (node: number) => boolean): LeafSlots {
  const random = createRandom(seed);
  const nodes: number[] = [];
  for (let node = 0; node < source.count; node += 1) if (eligible(node)) for (let index = 0; index < perNode; index += 1) nodes.push(node);
  const count = nodes.length;
  const slots = { count, node: Int32Array.from(nodes), dx: new Float32Array(count), dy: new Float32Array(count), dz: new Float32Array(count), rank: new Float32Array(count), size: new Float32Array(count), tone: new Uint8Array(count) };
  for (let index = 0; index < count; index += 1) {
    const heading = source.heading(at(slots.node, index));
    if (source.palm && hang > 0) { leaflet(slots, index, heading, spread, hang, random); continue; }
    const theta = random() * Math.PI * 2;
    const lift = random() * 2 - 1;
    const ring = Math.sqrt(1 - lift * lift) * Math.cbrt(random());
    // Weeping trees hang their leaves in strands below the twig.
    const drop = hang > 0 ? hang * ((index % perNode) / perNode) * (0.6 + random() * 0.4) : 0;
    slots.dx[index] = (Math.cos(theta) * ring + heading.x * 0.45) * spread * (drop > 0 ? 0.5 : 1);
    slots.dy[index] = (lift * 0.7 + heading.y * 0.45 + 0.18) * spread - drop;
    slots.dz[index] = (Math.sin(theta) * ring + heading.z * 0.45) * spread * (drop > 0 ? 0.5 : 1);
    slots.rank[index] = random();
    slots.size[index] = 0.82 + random() * 0.36;
    slots.tone[index] = Math.floor(random() * 3);
  }
  return slots;
}

/** A palm frond's first internode, where flowers and coconuts hang. */
const frondBase = (sim: Sim, node: number): boolean => at(sim.order, node) > 0 && at(sim.order, at(sim.parent, node)) === 0;

/** A palm leaflet: one of a pair of rows down each side of the frond's rachis, drooping at its tip. */
function leaflet(slots: LeafSlots & { dx: Float32Array; dy: Float32Array; dz: Float32Array }, index: number, heading: Vec, spread: number, hang: number, random: () => number): void {
  const side = normalize(cross(heading, vec(0, 1, 0)), perpendicular(heading));
  const sign = index % 2 === 0 ? 1 : -1;
  const reach = spread * (0.25 + 0.75 * random());
  const along = (random() - 0.5) * spread * 0.6;
  slots.dx[index] = side.x * sign * reach + heading.x * along;
  slots.dy[index] = side.y * sign * reach + heading.y * along - hang * (reach / spread) ** 2;
  slots.dz[index] = side.z * sign * reach + heading.z * along;
  slots.rank[index] = random();
  slots.size[index] = 0.7 + random() * 0.3;
  slots.tone[index] = Math.floor(random() * 3);
}

function ornamentSlots(sim: Sim, spec: OrnamentSpec | null, spread: number, seed: number): LeafSlots {
  if (spec === null) return leafSlots(simSource(sim), 0, 0, 0, 0, () => false);
  const palm = sim.species.palm !== null;
  const floor = (spec.above ?? 0) * sim.height;
  return leafSlots(simSource(sim), spec.perNode, spread, 0, seed, (node) => (palm ? frondBase(sim, node) : at(sim.order, node) > 0 && (sim.pos[node]?.y ?? 0) >= floor));
}

function leafEligible(sim: Sim, node: number): boolean {
  if (sim.species.palm !== null) return at(sim.order, node) > 0 && !frondBase(sim, node);
  return at(sim.order, node) > 0 || at(sim.birth, node) < 4;
}

/** Grows one tree from its seed. The same species and seed always give the same tree. */
export function growTree(input: GrowInput): TreeModel {
  const species = input.mix ? blendSpecies(input.mix) : speciesOf(input.species);
  const seed = input.seed >>> 0;
  const sim = simulate(species, seed, Math.max(64, Math.min(input.maxNodes ?? 4800, 6000)));
  const count = sim.pos.length;
  const scale = species.height / Math.max(sim.height, 1);
  const random = createRandom(seed ^ 0x51ab);
  const rootCount = 5 + Math.floor(random() * 3);
  const model: TreeModel = {
    species, seed, cycles: species.cycles, matureAt: Math.round(species.cycles * 0.72), count,
    parent: Int32Array.from(sim.parent),
    x: Float32Array.from(sim.pos, (p) => p.x * scale),
    y: Float32Array.from(sim.pos, (p) => p.y * scale),
    z: Float32Array.from(sim.pos, (p) => p.z * scale),
    order: Uint8Array.from(sim.order, (value) => Math.min(value, 255)),
    birth: Float32Array.from(sim.birth),
    span: Float32Array.from(sim.span),
    deadAt: Float32Array.from(sim.deadAt),
    shedAt: Float32Array.from(sim.shedAt, (value) => (value === Infinity ? 1e9 : value)),
    phase: Float32Array.from(sim.pos, () => random() * Math.PI * 2),
    leaves: leafSlots(simSource(sim), species.leafSlots, species.leafSpread, species.hang, seed ^ 0x1eaf, (node) => leafEligible(sim, node)),
    blossoms: ornamentSlots(sim, species.flower, species.leafSpread * 0.8, seed ^ 0xb105),
    fruit: ornamentSlots(sim, species.fruit, species.leafSpread * 0.7, seed ^ 0xf2017),
    roots: Array.from({ length: rootCount }, (_, index) => ({ angle: (index / rootCount) * Math.PI * 2 + random() * 0.6, reach: 0.7 + random() * 0.6 })),
  };
  return model;
}

/**
 * Splits a grown tree into sectors, the way a chimera plant carries whole
 * limbs of different tissue: each main limb (and everything it carries) goes
 * to one strain, so that each strain's share of the crown's leaves is close
 * to its share in `shares`. Strain 0, the first, keeps the trunk. Returns the
 * strain of every internode. A strain with too small a share for any limb
 * still gets the smallest one, so a trace of hidden makeup always shows.
 */
/** Whether `node` grows from `limb` (anywhere out along it). */
function isBelow(model: TreeModel, node: number, limb: number): boolean {
  for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (up === limb) return true;
  return false;
}

export function sectors(model: TreeModel, shares: readonly number[], seed = model.seed): Uint8Array {
  const strain = new Uint8Array(model.count);
  if (shares.length <= 1) return strain;
  const order = model.order;
  // Leaf-years each internode carries, counted up from the twigs (parents come first, so walk backwards):
  // a shoot that is shaded out young counts for little.
  const carried = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    const held = Math.max(0, Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node)) / model.cycles;
    carried[node] = at(carried, node) + held;
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) carried[parent] = at(carried, parent) + at(carried, node);
  }
  // Main limbs that live a good while (a quarter of the life): a limb shaded out young would carry its strain as bare sticks.
  const main: number[] = [];
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (at(order, node) > 0 && (parent < 0 || at(order, parent) === 0) && at(carried, node) > 0) main.push(node);
  }
  const lasting = main.filter((node) => Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node) >= model.cycles * 0.25);
  const limbs = lasting.length >= shares.length ? lasting : main;
  const random = createRandom(seed ^ 0x5ec7);
  // Shuffle first so limbs born together (a whorl) fall to different strains, then walk them in the order
  // they grow: each goes to the strain furthest behind its share, so every age of the tree shows each strain
  // at its share, not only the old tree.
  for (let index = limbs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [limbs[index], limbs[other]] = [limbs[other]!, limbs[index]!];
  }
  limbs.sort((a, b) => Math.round(at(model.birth, a) * 2) - Math.round(at(model.birth, b) * 2));
  const sum = shares.reduce((acc, share) => acc + Math.max(0, share), 0) || 1;
  const want = shares.map((share) => Math.max(0, share) / sum);
  const have = new Float64Array(shares.length);
  const owner = new Map<number, number>();
  let walked = 0;
  for (const limb of limbs) {
    walked += at(carried, limb);
    let pick = 0;
    let behind = -Infinity;
    for (let index = 0; index < shares.length; index += 1) {
      const short = (want[index] ?? 0) * walked - at(have, index);
      if ((want[index] ?? 0) > 0 && short > behind) { behind = short; pick = index; }
    }
    owner.set(limb, pick);
    have[pick] = at(have, pick) + at(carried, limb);
  }
  // Even a tiny share holds a limb: the smallest one, taken from the first strain.
  for (let index = 1; index < shares.length; index += 1) {
    if ((want[index] ?? 0) <= 0 || at(have, index) > 0) continue;
    let small = -1;
    for (const limb of limbs) if (owner.get(limb) === 0 && (small < 0 || at(carried, limb) < at(carried, small))) small = limb;
    if (small >= 0) { owner.set(small, index); have[index] = at(carried, small); }
  }
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    strain[node] = owner.get(node) ?? (parent >= 0 ? at(strain, parent) : 0);
  }
  // Whole limbs come in big lumps, and old low limbs that carried leaves for years may hold few now, so a
  // strain can end well short in the grown crown (the third kind gets what is left). Counting the leaves
  // on the tree through the middle of its life, it takes side branches off the strains over their share, the biggest that
  // still fit first, so a quarter share shows as about a quarter of the grown crown.
  const prime = (node: number): number => [0.35, 0.5, 0.65].filter((t) => at(model.birth, node) <= model.cycles * t && at(model.deadAt, node) > model.cycles * t).length;
  const alive = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    alive[node] = at(alive, node) + prime(node);
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) alive[parent] = at(alive, parent) + at(alive, node);
  }
  const now = new Float64Array(shares.length);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    now[at(strain, node)] = at(now, at(strain, node)) + prime(node);
  }
  const total = now.reduce((acc, count) => acc + count, 0);
  const taken = new Set<number>();
  const takenAbove = (node: number): boolean => {
    for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (taken.has(up)) return true;
    return false;
  };
  // The strain furthest short goes first, the main kind included (an oak limb can outgrow the cherry it is on).
  const needy = shares.map((_, index) => index).sort((a, b) => ((want[b] ?? 0) * total - at(now, b)) - ((want[a] ?? 0) * total - at(now, a)));
  for (const index of needy) {
    let short = (want[index] ?? 0) * total - at(now, index);
    if (short <= total * 0.03) continue;
    const side: number[] = [];
    for (let node = 0; node < model.count; node += 1) {
      const parent = at(model.parent, node);
      if (parent < 0 || at(order, parent) === 0 || at(order, node) <= at(order, parent) || at(strain, node) === index || at(alive, node) <= 0) continue;
      side.push(node);
    }
    side.sort((a, b) => at(alive, b) - at(alive, a));
    for (const node of side) {
      if (short <= total * 0.03) break;
      const from = at(strain, node);
      const load = at(alive, node);
      const spare = at(now, from) - (want[from] ?? 0) * total;
      if (from === index || load > short * 1.25 || load > spare || takenAbove(node)) continue;
      taken.add(node);
      now[from] = at(now, from) - load;
      now[index] = at(now, index) + load;
      short -= load;
      for (let child = node; child < model.count; child += 1) {
        if (child === node || isBelow(model, child, node)) strain[child] = index;
      }
    }
  }
  return strain;
}

/** One kind's flowers or fruit: what they are and where they hang. */
export interface KindOrnament {
  readonly spec: OrnamentSpec;
  readonly slots: LeafSlots;
}

/**
 * A hybrid's minor kind bears its own flowers and fruit on the limbs it holds
 * (`kinds` from `sectors`): cherry limbs on an oak blossom though the oak only
 * hangs catkins. Places follow the kind's own spec; a renderer opens them on
 * that kind's calendar. Null where the kind has none.
 */
export function kindOrnaments(model: TreeModel, species: string, kinds: ArrayLike<number>, kind: number): { readonly flower: KindOrnament | null; readonly fruit: KindOrnament | null } {
  const own = speciesOf(species);
  const top = model.y.reduce((most, y) => Math.max(most, y), 0);
  const source: SlotSource = {
    count: model.count,
    palm: false,
    heading: (node) => {
      const parent = at(model.parent, node);
      return parent < 0 ? vec(0, 1, 0) : normalize(vec(at(model.x, node) - at(model.x, parent), at(model.y, node) - at(model.y, parent), at(model.z, node) - at(model.z, parent)));
    },
  };
  const grow = (spec: OrnamentSpec | null, spread: number, salt: number): KindOrnament | null => {
    if (spec === null) return null;
    const floor = (spec.above ?? 0) * top;
    const slots = leafSlots(source, spec.perNode, spread, 0, (model.seed ^ salt ^ (kind * 0x9e37)) >>> 0, (node) => at(kinds, node) === kind && at(model.order, node) > 0 && at(model.y, node) >= floor);
    return slots.count > 0 ? { spec, slots } : null;
  };
  return { flower: grow(own.flower, own.leafSpread * 0.8, 0xb105), fruit: grow(own.fruit, own.leafSpread * 0.7, 0xf2017) };
}

/**
 * How a species spends its life, as shares of the lifespan: by `prime` it is
 * most of its way grown, getting there fastest while young (`quick`
 * front-loads it); it then keeps growing, more slowly, until `old`, near the
 * very end, when the decline begins.
 */
export interface Pace {
  readonly prime: number;
  readonly quick: number;
  readonly old: number;
}

export const PACE: Readonly<Record<SpeciesId, Pace>> = {
  willow: { prime: 0.22, quick: 4.9, old: 0.875 },
  birch: { prime: 0.28, quick: 4.4, old: 0.875 },
  acacia: { prime: 0.25, quick: 4.4, old: 0.9 },
  jacaranda: { prime: 0.28, quick: 4.4, old: 0.9 },
  cherry: { prime: 0.3, quick: 3.9, old: 0.9 },
  maple: { prime: 0.38, quick: 3.6, old: 0.925 },
  palm: { prime: 0.4, quick: 3.1, old: 0.925 },
  pine: { prime: 0.45, quick: 3.4, old: 0.925 },
  spruce: { prime: 0.5, quick: 3.1, old: 0.93 },
  oak: { prime: 0.55, quick: 2.9, old: 0.94 },
  baobab: { prime: 0.65, quick: 2.1, old: 0.96 },
  redwood: { prime: 0.7, quick: 2.3, old: 0.96 },
  peach: { prime: 0.22, quick: 4.6, old: 0.875 },
  plum: { prime: 0.26, quick: 4.2, old: 0.89 },
  fig: { prime: 0.25, quick: 4.4, old: 0.9 },
  apple: { prime: 0.3, quick: 3.9, old: 0.9 },
  lemon: { prime: 0.3, quick: 3.9, old: 0.9 },
  pear: { prime: 0.35, quick: 3.6, old: 0.92 },
  orange: { prime: 0.35, quick: 3.6, old: 0.92 },
  mango: { prime: 0.45, quick: 3.2, old: 0.93 },
};

const SPROUT = 0.32;

/**
 * The share of its growing done `u` of the way to old age: a Chapman–Richards
 * curve, settling in for a moment, then fast, then slowing as it fills out,
 * with a steady share on top so it never flattens: still growing every year
 * right up to old age.
 */
function grownShare(u: number, quick: number): number {
  const q = quick * YOUTH;
  const curve = ((1 - Math.exp(-q * u)) / (1 - Math.exp(-q))) ** 1.25;
  return curve * (1 - STEADY_GROWTH) + u * STEADY_GROWTH;
}

/**
 * How much faster the early curve runs over a life measured to old age: a young tree puts on most of its
 * crown in its first years (a 6-year cherry stands about 3.5 m, as a nursery tree does), then fills out slowly.
 */
const YOUTH = 2.8;

/** The share of a tree's growing that comes on steadily, year after year, rather than early. */
const STEADY_GROWTH = 0.4;

/**
 * The growth cycle at an age: a fresh sprout at birth, quick when young, then
 * less and less each year on one curve until old age, then the decline to death.
 * By `prime` most of the crown is there; it never stops filling out before `old`.
 */
export function cycleAt(model: TreeModel, ageYears: number, lifespanYears: number): number {
  const life = clamp01(ageYears / Math.max(lifespanYears, 1e-6));
  const pace = PACE[model.species.id];
  if (life < pace.old) return SPROUT + (model.matureAt - SPROUT) * grownShare(life / pace.old, pace.quick);
  // Old age starts slowly: a few limbs a year at first, most of the crown only near the end.
  return model.matureAt + (model.cycles - model.matureAt) * ((life - pace.old) / (1 - pace.old)) ** 1.5;
}

// ---------------------------------------------------------------- posing one moment

export interface TreeFrame {
  readonly cycle: number;
  /** 0 not grown yet, rising to 1 as the internode elongates. */
  readonly grow: Float32Array;
  readonly radius: Float32Array;
  /** 0 living wood, 1 long dead and grey. */
  readonly dead: Float32Array;
  /** 0 attached; rises to 1 while a shed branch falls; it then lies and rots. */
  readonly fall: Float32Array;
  /** 0 sound, 1 rotted away. */
  readonly rot: Float32Array;
  /** Living tips carried, the pipe-model weight. Small values are leafy twigs. */
  readonly tips: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Where each internode starts (its parent's posed end). */
  readonly baseX: Float32Array;
  readonly baseY: Float32Array;
  readonly baseZ: Float32Array;
  /** How many internodes are visible. */
  readonly visible: number;
  readonly height: number;
  /** How much bigger than life a grand tree has grown by now (the mean of taller and wider); 1 for a natural tree. Renderers grow leaf clumps with it. */
  readonly scale: number;
}

export interface FrameOptions {
  /** World y of the ground where shed limbs come to rest. */
  readonly ground?: number;
  /**
   * Grow a grand tree, a world tree: it keeps getting bigger all its life,
   * slowing with age, until it stands GRAND times taller and wider than the
   * natural tree, in its own species' way. `true` uses the species' own
   * measure; a number scales how far past life it goes (1 is that measure).
   */
  readonly grand?: boolean | number;
}

/**
 * How much bigger a grand tree of each kind grows than the natural one, upward
 * and outward. Conifers and redwoods tower; acacias, oaks and willows spread
 * wide; a palm only climbs; a baobab swells.
 */
export const GRAND: Readonly<Record<SpeciesId, { readonly up: number; readonly out: number }>> = {
  cherry: { up: 1.9, out: 2.4 },
  oak: { up: 2.2, out: 3.0 },
  pine: { up: 2.7, out: 1.5 },
  birch: { up: 2.3, out: 1.7 },
  willow: { up: 1.8, out: 2.8 },
  acacia: { up: 1.6, out: 3.2 },
  palm: { up: 2.5, out: 1.1 },
  spruce: { up: 2.6, out: 1.5 },
  redwood: { up: 3.2, out: 1.6 },
  maple: { up: 2.1, out: 2.6 },
  jacaranda: { up: 1.8, out: 2.8 },
  baobab: { up: 1.8, out: 2.5 },
  apple: { up: 1.8, out: 2.6 },
  pear: { up: 2.3, out: 1.8 },
  peach: { up: 1.6, out: 2.6 },
  plum: { up: 1.9, out: 2.3 },
  orange: { up: 1.8, out: 2.4 },
  lemon: { up: 1.7, out: 2.2 },
  fig: { up: 1.7, out: 2.8 },
  mango: { up: 2.3, out: 2.8 },
};

interface Grandeur { readonly up: number; readonly out: number; readonly girth: number }

const naturalSizes = new WeakMap<TreeModel, Float32Array>();

/** How tall and how wide the natural tree's wood has grown by `cycle`, from its grown positions; measured once per whole cycle and blended between. */
function naturalSize(model: TreeModel, cycle: number): [number, number] {
  let sizes = naturalSizes.get(model);
  if (sizes === undefined) {
    sizes = new Float32Array((model.cycles + 1) * 2);
    for (let node = 0; node < model.count; node += 1) {
      const from = Math.max(0, Math.ceil(at(model.birth, node) + at(model.span, node)));
      const tall = at(model.y, node);
      const wide = Math.hypot(at(model.x, node), at(model.z, node));
      for (let whole = from; whole <= model.cycles; whole += 1) {
        sizes[whole * 2] = Math.max(at(sizes, whole * 2), tall);
        sizes[whole * 2 + 1] = Math.max(at(sizes, whole * 2 + 1), wide);
      }
    }
    naturalSizes.set(model, sizes);
  }
  const low = Math.max(0, Math.min(model.cycles, Math.floor(cycle)));
  const high = Math.min(model.cycles, low + 1);
  const blend = clamp01(cycle - low);
  return [0, 1].map((axis) => at(sizes, low * 2 + axis) + (at(sizes, high * 2 + axis) - at(sizes, low * 2 + axis)) * blend) as [number, number];
}

/** The share of its life a tree has lived when it reaches `cycle`: `cycleAt` run backwards. */
function lifeAt(model: TreeModel, cycle: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (cycleAt(model, middle, 1) < cycle) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * A grand tree's size at a cycle: natural while a sapling, then growing by
 * age on a slowing curve for the rest of its life. It never levels off: an
 * old tree still gains a little every year, right up to its death.
 */
export function grandAt(model: TreeModel, cycle: number, grand: boolean | number = true): Grandeur {
  const reach = grand === false ? 0 : grand === true ? 1 : Math.max(0, grand);
  const share = clamp01((lifeAt(model, cycle) - 0.04) / 0.96) ** 0.75;
  const measure = GRAND[model.species.id];
  // The few decline cycles pass in a tree's last years; what the natural tree
  // still gains in them would come as a sudden spurt, so a grand tree grows on
  // from its prime size by age alone.
  const prime = Math.min(cycle, model.matureAt);
  const [tall, wide] = naturalSize(model, cycle);
  const [primeTall, primeWide] = naturalSize(model, prime);
  const up = (1 + (measure.up - 1) * reach * share) * (reach > 0 && tall > 0 ? primeTall / tall : 1);
  const out = (1 + (measure.out - 1) * reach * share) * (reach > 0 && wide > 0 ? primeWide / wide : 1);
  // Old wood thickens with the load it carries: the trunk widens with the crown and the height.
  return { up, out, girth: (up * out) ** 0.6 };
}

const FALL_CYCLES = 0.08;
const LOG_RADIUS = 0.09;
/** Fallen limbs come to rest inside this reach of the trunk. */
const ISLAND = 3.4;

function growthPass(model: TreeModel, cycle: number, frame: TreeFrame): void {
  for (let node = model.count - 1; node >= 0; node -= 1) {
    const grow = clamp01((cycle - at(model.birth, node)) / Math.max(at(model.span, node), 1e-3));
    frame.grow[node] = grow;
    const tips = Math.max(grow, at(frame.tips, node));
    frame.tips[node] = tips;
    const parent = at(model.parent, node);
    if (parent >= 0 && grow > 0) frame.tips[parent] = at(frame.tips, parent) + tips;
  }
  const { radiusTip, pipe, palm } = model.species;
  for (let node = 0; node < model.count; node += 1) {
    const grow = at(frame.grow, node);
    frame.radius[node] = grow <= 0 ? 0 : radiusTip * at(frame.tips, node) ** (1 / pipe) * (0.45 + 0.55 * grow);
  }
  if (palm !== null) palmTrunk(model, cycle, frame, palm.trunk);
}

/** A palm trunk keeps one girth all its life, swelling only at its foot; it reaches it while young. */
function palmTrunk(model: TreeModel, cycle: number, frame: TreeFrame, trunk: number): void {
  const girth = trunk * (0.35 + 0.65 * ramp(cycle, 1, 8));
  for (let node = 0; node < model.count; node += 1) {
    if (at(model.order, node) !== 0 || at(frame.grow, node) <= 0) continue;
    frame.radius[node] = girth * (node < 3 ? 1.35 - node * 0.1 : 1);
  }
}

/** Death and shedding pass down the tree: a child is never more alive than its parent. */
function lifePass(model: TreeModel, cycle: number, frame: TreeFrame, shedRoot: Int32Array): void {
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    const ownDead = clamp01((cycle - at(model.deadAt, node)) / 1.2);
    frame.dead[node] = parent >= 0 ? Math.max(ownDead, at(frame.dead, parent)) : ownDead;
    const inherited = parent >= 0 ? at(shedRoot, parent) : -1;
    shedRoot[node] = inherited >= 0 ? inherited : cycle >= at(model.shedAt, node) ? node : -1;
    const root = at(shedRoot, node);
    const since = root >= 0 ? cycle - at(model.shedAt, root) : -1;
    frame.fall[node] = since < 0 ? 0 : clamp01(since / FALL_CYCLES);
    const small = root >= 0 && at(frame.radius, root) < LOG_RADIUS;
    frame.rot[node] = since < 0 ? 0 : small ? clamp01(since / FALL_CYCLES) : ramp(since, 1.4, 2.8);
  }
}

interface FallPose { readonly pivot: Vec; readonly axis: Vec; readonly angle: number; readonly drop: Vec }

/** A shed limb swings down about its base and comes to rest flat, pointing out from the trunk. */
function fallPose(model: TreeModel, root: number, ground: number, random: () => number, size: Grandeur): FallPose {
  const parent = at(model.parent, root);
  const pivot = restAt(model, parent, size);
  const tip = restAt(model, root, size);
  const heading = normalize(add(tip, pivot, -1));
  const out = normalize(vec(heading.x + pivot.x * 0.3, 0, heading.z + pivot.z * 0.3), normalize(vec(random() - 0.5, 0, random() - 0.5), vec(1, 0, 0)));
  const axis = normalize(cross(heading, out), perpendicular(heading));
  const angle = Math.acos(Math.max(-1, Math.min(1, heading.x * out.x + heading.y * out.y + heading.z * out.z)));
  const rest = vec(pivot.x + out.x * 0.6, ground + 0.06, pivot.z + out.z * 0.6);
  return { pivot, axis, angle, drop: add(rest, pivot, -1) };
}

/** Where a node grows, at a grand tree's size. */
const restAt = (model: TreeModel, node: number, size: Grandeur): Vec => vec(at(model.x, node) * size.out, at(model.y, node) * size.up, at(model.z, node) * size.out);

function poseFor(model: TreeModel, poses: Map<number, FallPose>, root: number, ground: number, size: Grandeur): FallPose {
  let pose = poses.get(root);
  if (pose === undefined) {
    pose = fallPose(model, root, ground, createRandom(model.seed ^ root), size);
    poses.set(root, pose);
  }
  return pose;
}

/** Carries a resting point along a falling limb: swing about the pivot, drop, then settle flat. */
function fallen(point: Vec, pose: FallPose, progress: number, ground: number): Vec {
  const eased = smooth(progress);
  const swung = add(pose.pivot, rotate(add(point, pose.pivot, -1), pose.axis, pose.angle * eased));
  const moved = add(swung, pose.drop, eased * eased);
  const reach = Math.hypot(moved.x, moved.z);
  const keep = reach > ISLAND ? (ISLAND + (reach - ISLAND) * 0.25) / reach : 1;
  const pull = 1 + (keep - 1) * eased;
  // A limb on the ground lies flat: its side twigs settle into the grass
  // instead of standing up out of it.
  return vec(moved.x * pull, ground + 0.04 + Math.max(0, moved.y - ground - 0.04) * (1 - 0.95 * eased), moved.z * pull);
}

function posePass(model: TreeModel, frame: TreeFrame, shedRoot: Int32Array, ground: number, size: Grandeur): void {
  const poses = new Map<number, FallPose>();
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    const restBase = parent >= 0 ? restAt(model, parent, size) : vec(0, 0, 0);
    const restEnd = add(restBase, add(restAt(model, node, size), restBase, -1), at(frame.grow, node));
    const root = at(shedRoot, node);
    let base = parent >= 0 ? vec(at(frame.x, parent), at(frame.y, parent), at(frame.z, parent)) : vec(0, 0, 0);
    let end = restEnd;
    if (root >= 0) {
      const pose = poseFor(model, poses, root, ground, size);
      const progress = at(frame.fall, node);
      end = fallen(restEnd, pose, progress, ground);
      if (root === node) base = fallen(restBase, pose, progress, ground);
    }
    frame.x[node] = end.x; frame.y[node] = end.y; frame.z[node] = end.z;
    frame.baseX[node] = base.x; frame.baseY[node] = base.y; frame.baseZ[node] = base.z;
  }
}

/** Poses the tree at a cycle: what has grown, how thick it is, what is dead and what lies on the ground. */
export function treeFrame(model: TreeModel, cycle: number, options: FrameOptions = {}): TreeFrame {
  const count = model.count;
  const at01 = Math.min(Math.max(cycle, 0), model.cycles);
  const array = (): Float32Array => new Float32Array(count);
  const frame: TreeFrame = {
    cycle: at01, grow: array(), radius: array(), dead: array(), fall: array(), rot: array(), tips: array(),
    x: array(), y: array(), z: array(), baseX: array(), baseY: array(), baseZ: array(), visible: 0, height: 0, scale: 1,
  };
  const shedRoot = new Int32Array(count).fill(-1);
  const size = options.grand === undefined || options.grand === false ? { up: 1, out: 1, girth: 1 } : grandAt(model, at01, options.grand);
  growthPass(model, at01, frame);
  if (size.girth !== 1) for (let node = 0; node < count; node += 1) frame.radius[node] = at(frame.radius, node) * size.girth;
  lifePass(model, at01, frame, shedRoot);
  posePass(model, frame, shedRoot, options.ground ?? 0, size);
  let visible = 0;
  let height = 0;
  for (let node = 0; node < count; node += 1) {
    if (at(frame.grow, node) <= 0 || at(frame.rot, node) >= 1) continue;
    visible += 1;
    if (at(frame.fall, node) === 0) height = Math.max(height, at(frame.y, node));
  }
  return { ...frame, visible, height, scale: Math.sqrt(size.up * size.out) };
}

// ---------------------------------------------------------------- bending

/** Weight resting on a node of the tree (an animal on a branch), pulling it down. A negative weight lifts it, as a limb springs back past rest. */
export interface Load {
  readonly node: number;
  readonly weight: number;
}

/**
 * How readily wood bends: each piece of the limb under a load turns by this
 * × weight × lever × its length ÷ radius⁴, as a beam does. A thin twig dips
 * under a songbird; a thick limb hardly moves under a monkey; the trunk never.
 */
export const WOOD_SAG = 6e-6;
/** The most any one piece turns, in radians, and the most a load sinks, in world units and as a share of the limb's reach. */
const MOST_TURN = 0.3;
/** The girth of a twig, which gives freely; thicker wood gives less again by the square of its girth. */
const TWIG = 0.02;
const MOST_SAG = 0.25;
const MOST_SAG_SHARE = 0.25;

const horizontal = (frame: TreeFrame, ax: number, az: number, node: number): number => Math.hypot(at(frame.x, node) - ax, at(frame.z, node) - az);
const pieceLength = (frame: TreeFrame, node: number): number => Math.hypot(at(frame.x, node) - at(frame.baseX, node), at(frame.y, node) - at(frame.baseY, node), at(frame.z, node) - at(frame.baseZ, node));

/** The limb a load bears on, from where it leaves the trunk out to the load. */
function limbOf(model: TreeModel, node: number): number[] {
  const chain: number[] = [];
  for (let at_ = node; at_ > 0 && at(model.order, at_) > 0; at_ = at(model.parent, at_)) chain.push(at_);
  return chain.reverse();
}

/** How far each node of the limb sinks: every piece turns by the load's moment over its own stiffness, and carries all beyond it down. */
function limbDrops(frame: TreeFrame, chain: readonly number[], load: Load, sag: number): number[] {
  const lx = at(frame.x, load.node);
  const lz = at(frame.z, load.node);
  const turns = chain.map((node) => {
    const lever = Math.hypot(lx - at(frame.baseX, node), lz - at(frame.baseZ, node));
    const radius = Math.max(at(frame.radius, node), 0.006);
    // Thick wood is far stiffer than a beam's law alone says: past a twig's girth it all but stops giving.
    const give = Math.min(1, (TWIG / radius) ** 2);
    return Math.min((sag * Math.abs(load.weight) ** 0.5 * lever * pieceLength(frame, node) * give) / radius ** 4, MOST_TURN);
  });
  return chain.map((node, i) => {
    let sum = 0;
    for (let j = 0; j <= i; j += 1) {
      const base = chain[j] ?? node;
      sum += (turns[j] ?? 0) * horizontal(frame, at(frame.baseX, base), at(frame.baseZ, base), node);
    }
    return sum;
  });
}

/**
 * Every node's drop under one load. The bend gathers in the thin wood near
 * the animal and the stout limbs it grows from barely give; whatever grows
 * from the bent wood rides along.
 */
function loadDrop(model: TreeModel, frame: TreeFrame, load: Load, drop: Float32Array, sag: number): void {
  const chain = limbOf(model, load.node);
  if (chain.length === 0) return;
  const drops = limbDrops(frame, chain, load, sag);
  const reach = chain.reduce((sum, node) => sum + horizontal(frame, at(frame.baseX, node), at(frame.baseZ, node), node), 0);
  const deepest = drops[drops.length - 1] ?? 0;
  const cap = Math.min(MOST_SAG, reach * MOST_SAG_SHARE + 0.02);
  const scale = (deepest > cap ? cap / deepest : 1) * Math.sign(load.weight);
  const own = new Float32Array(model.count).fill(Number.NaN);
  chain.forEach((node, i) => { own[node] = (drops[i] ?? 0) * scale; });
  own[0] = 0;
  for (let node = 1; node < model.count; node += 1) {
    if (Number.isNaN(own[node])) own[node] = own[at(model.parent, node)] ?? 0;
    drop[node] = (drop[node] ?? 0) + (own[node] ?? 0);
  }
}

/**
 * The frame with branches bent under `loads`: a bird's twig dips, a monkey's
 * limb sags, the trunk hardly moves. Pass `out` from the last call to reuse
 * its arrays (the same object comes back, so a renderer can tell it is the
 * same pose); everything but the positions is shared with `frame`.
 */
export function bendFrame(model: TreeModel, frame: TreeFrame, loads: readonly Load[], out?: TreeFrame, sag = WOOD_SAG): TreeFrame {
  const target = out ?? { ...frame, x: new Float32Array(frame.x), y: new Float32Array(frame.y), z: new Float32Array(frame.z), baseX: new Float32Array(frame.baseX), baseY: new Float32Array(frame.baseY), baseZ: new Float32Array(frame.baseZ) };
  target.x.set(frame.x);
  target.z.set(frame.z);
  target.baseX.set(frame.baseX);
  target.baseZ.set(frame.baseZ);
  if (loads.length === 0) {
    target.y.set(frame.y);
    target.baseY.set(frame.baseY);
    return target;
  }
  const drop = new Float32Array(model.count);
  for (const load of loads) if (load.weight !== 0 && load.node > 0 && load.node < model.count) loadDrop(model, frame, load, drop, sag);
  for (let node = 0; node < model.count; node += 1) {
    target.y[node] = at(frame.y, node) - at(drop, node);
    const parent = at(model.parent, node);
    target.baseY[node] = at(frame.baseY, node) - (parent >= 0 ? at(drop, parent) : 0);
  }
  return target;
}

// ---------------------------------------------------------------- the year

export type Climate = "temperate" | "maritime" | "alpine" | "monsoon" | "highland" | "desert";

export interface YearInput {
  /** A species id; anything else grows a cherry. */
  readonly species: string;
  /** Day of the year, 1–366, at the tree. */
  readonly day: number;
  readonly year?: number;
  readonly hemisphere?: Hemisphere;
  readonly climate?: string;
}

/** What the year is doing to the crown, every value in [0, 1]. */
export interface YearState {
  /** Share of flowers open. */
  readonly bloom: number;
  /** Share of flowers that have dropped. */
  readonly petals: number;
  /** Share of fruit set and growing. */
  readonly fruit: number;
  /** Share of fruit that has fallen. */
  readonly fruitDrop: number;
  /** Leaves still on the tree are dead and brown (winter-held oak leaves). */
  readonly withered: boolean;
  /** Leaf size: 0 a closed bud, 1 full grown. */
  readonly leaf: number;
  /** Autumn color mix. */
  readonly color: number;
  /** Share of leaves that have fallen. */
  readonly drop: number;
  /** Share of fallen leaves still lying on the ground. */
  readonly litter: number;
  /** Fresh pale green of new growth. */
  readonly flush: number;
  /** The tree is bare and resting. */
  readonly dormant: boolean;
}

const SPRING_SHIFT: Readonly<Record<string, number>> = { alpine: 14, maritime: -5, monsoon: -6, desert: -10, highland: 0, temperate: 0 };
const AUTUMN_SHIFT: Readonly<Record<string, number>> = { alpine: -14, maritime: 10, monsoon: 6, desert: 4, highland: 0, temperate: 0 };

/** A year's own small shift: no two springs bloom on quite the same day. */
function yearJitter(year: number, seed: number): number {
  return (createRandom((year * 2654435761) ^ seed)() - 0.5) * 8;
}

interface Ornament { readonly open: number; readonly fallen: number }

/** An ornament's window, read in spring days early in the year and autumn days late in it. */
function ornamentYear(spec: OrnamentSpec | null, spring: number, autumn: number): Ornament {
  if (spec === null) return { open: 0, fallen: 0 };
  const t = spec.window[0] < 200 ? spring : autumn;
  return { open: smooth(ramp(t, spec.window[0], spec.window[1])), fallen: ramp(t, spec.window[2], spec.window[3]) };
}

function leafYear(species: Species, spring: number, autumn: number): Omit<YearState, "bloom" | "petals" | "fruit" | "fruitDrop"> {
  const spec = species.phenology;
  const leaf = smooth(ramp(spring, spec.leaf[0], spec.leaf[1]));
  const color = smooth(ramp(autumn, spec.color[0], spec.color[1]));
  const drop = spec.dropMax * ramp(autumn, spec.drop[0], spec.drop[1]);
  const lastYear = (1 - ramp(spring, 60, 104)) * 0.35 * spec.dropMax;
  const flush = 1 - ramp(spring, spec.flush[0], spec.flush[1]);
  const fallen = autumn >= spec.drop[1];
  if (spec.dropMax >= 1 && (fallen || spring < spec.leaf[0])) {
    // Bare and resting in bud while last autumn's litter rots; an oak keeps
    // some dead leaves until the new ones push them off.
    const litter = fallen ? spec.dropMax * (1 - 0.65 * ramp(autumn, spec.drop[1], 425)) : lastYear;
    const held = spec.marcescent;
    return { leaf: held > 0 ? 1 : 0, color: held > 0 ? 1 : 0, drop: held > 0 ? 1 - held : 0, litter, flush: 0, withered: held > 0, dormant: true };
  }
  const litter = autumn >= spec.drop[0] ? drop : lastYear;
  return { leaf, color, drop, litter, flush: spring >= spec.flush[0] - 6 ? flush : 0, withered: false, dormant: leaf <= 0 };
}

/** Where the year stands for a species at a place: bud, blossom, leaf, color and fall. */
export function yearState(input: YearInput): YearState {
  const species = speciesOf(input.species);
  const spec = species.phenology;
  const hemisphere = input.hemisphere ?? "north";
  const day = hemisphere === "south" ? (input.day + 182) % 365 : input.day;
  const t = ((day - 60 + 365) % 365) + 60;
  const climate = input.climate ?? "temperate";
  const jitter = yearJitter(input.year ?? 2026, spec.leaf[0]);
  const spring = t - (SPRING_SHIFT[climate] ?? 0) - jitter;
  const autumn = t - (AUTUMN_SHIFT[climate] ?? 0) - jitter * 0.5;
  const flower = ornamentYear(species.flower, spring, autumn);
  const fruit = ornamentYear(species.fruit, spring, autumn);
  let state: YearState = { ...leafYear(species, spring, autumn), bloom: flower.open, petals: flower.fallen, fruit: fruit.open, fruitDrop: fruit.fallen };
  if (spec.dropMax < 1) state = { ...state, leaf: 1, dormant: false };
  if (hemisphere === "equatorial") {
    state = { ...state, leaf: Math.max(state.leaf, 0.85), color: state.color * 0.35, drop: state.drop * 0.3, litter: state.litter * 0.3, withered: false, dormant: false };
  }
  return state;
}

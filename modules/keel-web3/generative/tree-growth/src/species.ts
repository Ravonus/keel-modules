// Species: each kind's form, pace, phenology and ornaments.

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
  // Apple: a low, spreading crown on fruiting spurs, pink-white blossom after the leaves break, red apples bowing the
  // limbs.
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
  // Fig: low and sprawling under few, huge leaves; no flowers to see (they bloom inside the fruit), figs in late
  // summer.
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

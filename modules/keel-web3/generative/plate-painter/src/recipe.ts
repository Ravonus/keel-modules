// A recipe says what a plate holds and where, in fractions of the plate: x across from the left, y down from the
// top. Colours are hex. A seed then decides every shape inside those bounds (plan.ts).

/** Two numbers: a span on one axis, or a point. */
export type Pair = readonly [number, number];

/** A mountain range, one plane of depth. */
export interface RangeRecipe {
  /** Where it stands across the plate; it tapers away outside. */
  readonly x: Pair;
  /** The y its foot fades out at, into mist or the next plane. */
  readonly base: number;
  /** Peaks as `[x, y of the summit]`; the seed moves each a little and adds smaller ones. */
  readonly peaks: readonly Pair[];
  /** How broken the crest is, 0..1. */
  readonly rough: number;
  /** Depth steps toward the haze: each moves the colour a `hazeStep` of the way. */
  readonly depth: number;
  /** The faces the light falls on, and the faces turned away. */
  readonly lit: string;
  readonly shade: string;
}

/** A row of trees, or a wooded bank of round crowns. */
export interface TreeRecipe {
  readonly kind: "spire" | "crown";
  readonly x: Pair;
  /** The y of their feet: one number for a row, a span for a bank. */
  readonly y: Pair;
  readonly count: number;
  /** Heights as a share of the plate's height. */
  readonly height: Pair;
  readonly color: string;
  readonly lit: string;
  readonly depth: number;
}

/** A small town: flat walls and a few towers on a rise. */
export interface TownRecipe {
  readonly x: Pair;
  /** The y the walls stand on. */
  readonly y: number;
  readonly walls: number;
  readonly towers: number;
  /** Wall heights, then tower heights, as shares of the plate's height. */
  readonly height: Pair;
  readonly tower: Pair;
  readonly lit: string;
  readonly shade: string;
  readonly rock: string;
  readonly depth: number;
}

/** A leafy branch: a curve from `from` through `bend` to `to`, leaves along it. */
export interface BranchRecipe {
  readonly from: Pair;
  readonly bend: Pair;
  readonly to: Pair;
  readonly leaves: number;
  /** Leaf length as a share of the plate's height. */
  readonly size: number;
}

/** A mass of leaves filling a box, darker toward its heart. */
export interface MassRecipe {
  readonly x: Pair;
  readonly y: Pair;
  readonly leaves: number;
  readonly size: number;
}

/** Brush strokes of one region: angle in radians (0 runs right, y down), length and width as shares of the width. */
export interface StrokeRecipe {
  readonly angle: number;
  readonly length: number;
  readonly width: number;
  readonly opacity: number;
}

/** The whole plate. */
export interface PlateRecipe {
  /** Width over height. */
  readonly aspect: number;
  /** The colour of the air, and how far each depth step moves toward it. */
  readonly haze: string;
  readonly hazeStep: number;
  readonly sky: {
    readonly top: string;
    readonly low: string;
    /** The darker, bluer top-left corner. */
    readonly corner: string;
    readonly cloudLit: string;
    readonly cloudShade: string;
    /** The cloud band's top and bottom y, its centre x, and how much sky it covers (0..1). */
    readonly band: Pair;
    readonly centre: number;
    readonly cover: number;
  };
  /** Back to front, at most four. */
  readonly ranges: readonly RangeRecipe[];
  readonly shore: { readonly top: number; readonly y: number; readonly color: string; readonly lit: string };
  readonly water: { readonly near: number; readonly far: string; readonly deep: string; readonly sheen: string };
  readonly ground: { readonly color: string; readonly warm: string; readonly dark: string };
  readonly trees: readonly TreeRecipe[];
  readonly town?: TownRecipe;
  readonly leaves: {
    readonly lit: string;
    readonly mid: string;
    readonly shadow: string;
    readonly deep: string;
    /** No leaf crosses this x. */
    readonly bound: number;
    readonly branches: readonly BranchRecipe[];
    readonly masses: readonly MassRecipe[];
  };
  readonly strokes: {
    readonly sky: StrokeRecipe;
    readonly ridges: StrokeRecipe;
    readonly shore: StrokeRecipe;
    readonly water: StrokeRecipe;
    readonly ground: StrokeRecipe;
  };
  /** The canvas weave's period as a share of the width, and the corners' darkening (0..1). */
  readonly weave: number;
  readonly vignette: number;
}

/**
 * A lake in a valley under an overcast sky: mauve far peaks on the right, a blue-green range left of centre, low
 * hills, a pale far shore with a small town, a row of dark spires, a still lake, and a leafy branch and mass of
 * broad leaves in the near left.
 */
export const LAKE_VALLEY: PlateRecipe = {
  aspect: 1.6,
  haze: "#b5bfbd",
  hazeStep: 0.25,
  sky: {
    top: "#5d8090", low: "#a9b9b6", corner: "#43606e", cloudLit: "#c9cec6", cloudShade: "#8a9fa6",
    band: [0.08, 0.3], centre: 0.78, cover: 0.55,
  },
  ranges: [
    { x: [0.6, 1.08], base: 0.47, peaks: [[0.8, 0.335], [0.93, 0.355], [0.69, 0.39]], rough: 0.5, depth: 2.3,
      lit: "#9a8aa2", shade: "#665c7a" },
    { x: [0.12, 0.7], base: 0.475, peaks: [[0.3, 0.37], [0.45, 0.342], [0.58, 0.385]], rough: 0.6, depth: 1.2,
      lit: "#7fa0ad", shade: "#46677a" },
    { x: [-0.1, 1.1], base: 0.505, peaks: [[0.22, 0.44], [0.6, 0.452], [0.86, 0.448]], rough: 0.4, depth: 0.7,
      lit: "#5b7566", shade: "#34504f" },
  ],
  shore: { top: 0.5, y: 0.52, color: "#95937c", lit: "#bdb8a0" },
  water: { near: 0.72, far: "#7a9a9e", deep: "#3f6469", sheen: "#bfc6bc" },
  ground: { color: "#3b4b40", warm: "#574a37", dark: "#222d28" },
  trees: [
    { kind: "crown", x: [0.27, 0.42], y: [0.505, 0.54], count: 26, height: [0.018, 0.034], color: "#27352f",
      lit: "#46594a", depth: 0.7 },
    { kind: "spire", x: [0.35, 0.5], y: [0.52, 0.522], count: 8, height: [0.035, 0.065], color: "#1f2b26",
      lit: "#3b4d43", depth: 0.6 },
  ],
  town: {
    x: [0.855, 1.0], y: 0.522, walls: 7, towers: 2, height: [0.014, 0.03], tower: [0.045, 0.06],
    lit: "#c9bfa8", shade: "#878372", rock: "#7d7766", depth: 1.2,
  },
  leaves: {
    lit: "#6b7859", mid: "#46553f", shadow: "#2a3a33", deep: "#141b17", bound: 0.3,
    branches: [{ from: [-0.02, 0.02], bend: [0.17, 0.0], to: [0.27, 0.4], leaves: 26, size: 0.14 }],
    masses: [{ x: [0, 0.29], y: [0.42, 1.02], leaves: 96, size: 0.17 }],
  },
  strokes: {
    sky: { angle: -0.17, length: 0.04, width: 0.011, opacity: 0.3 },
    ridges: { angle: -0.5, length: 0.012, width: 0.003, opacity: 0.4 },
    shore: { angle: 0, length: 0.014, width: 0.0025, opacity: 0.5 },
    water: { angle: 0, length: 0.05, width: 0.006, opacity: 0.6 },
    ground: { angle: -0.12, length: 0.026, width: 0.009, opacity: 0.6 },
  },
  weave: 0.001,
  vignette: 0.08,
};

// What a surface holds. Colours are #rrggbb; shares and amounts are 0..1 unless a field says otherwise. A recipe is
// data: the same recipe and seed paint the same surface on every machine.

/** A direction as `[x, y]`, x to the right and y down; it need not be unit length. */
export type Axis = readonly [number, number];

/** Paper: fibre noise, flecks, soft stains and faint laid and chain lines. Tileable. */
export interface PaperRecipe {
  readonly kind: "paper";
  readonly tone: string;
  /** The flecks' colour and how many of the fleck cells hold one. */
  readonly fleck: string;
  readonly flecks: number;
  /** The stains' colour and how much they show. */
  readonly stain: string;
  readonly stains: number;
  /** Fibre cells across the tile (a whole number, 4..512), and how much the fibres show. */
  readonly cells: number;
  readonly fibres: number;
  /** The cloudy unevenness of the sheet: its contrast, and its lattice across the tile (a whole number, 1..64). */
  readonly mottle: number;
  readonly mottleScale: number;
  /** Laid lines across and chain lines down the tile (whole numbers, 0 for none), and how much they show. */
  readonly laid: number;
  readonly chain: number;
  readonly lines: number;
  /** Relief: how tall a height of 1 stands, as a share of the surface's height (0..4), for the normal. */
  readonly depth: number;
}

/** Rib knit: columns of knit stitches with purl between them, plied yarn and fuzz. Tileable. */
export interface KnitRecipe {
  readonly kind: "knit";
  readonly base: string;
  readonly shadow: string;
  readonly light: string;
  /** Ribs across and courses (rows of stitches) down the tile: whole numbers, 1..256. */
  readonly ribs: number;
  readonly courses: number;
  /** The share of a rib the knit column takes (0.3..0.9). */
  readonly knit: number;
  /** Ply turns along one leg of a stitch (0..8). */
  readonly twist: number;
  /** Loose fibres over the yarn, and how uneven the stitches are. */
  readonly fuzz: number;
  readonly jitter: number;
  readonly depth: number;
}

/** One soft painted mass on a painted ground: a petal, a leaf, a bloom, a bud. */
export interface Mass {
  /** Its centre as shares of the width and the height. */
  readonly at: Axis;
  /** Its half-length along `axis` and half-width across it, as shares of the height. */
  readonly size: Axis;
  readonly axis: Axis;
  /** The shadowed and the lit colour. */
  readonly colour: string;
  readonly light: string;
  /** How soft the edge is, how much the edge wanders, and how strong the brush streaks are in it. */
  readonly soft: number;
  readonly warp: number;
  readonly streak: number;
  /** Streaks around the centre (a bloom's ruffled petals) instead of along the axis. */
  readonly ring?: boolean;
  /** How far the ends narrow to points: 0 an oval, 1 a leaf. */
  readonly point?: number;
}

/** Folded cloth under a painted ground: three crossing sets of creased folds with a sheen on their crests. */
export interface Folds {
  readonly axis: Axis;
  /** Folds per height (0.5..16), and how much they wander (0..2). */
  readonly count: number;
  readonly warp: number;
  readonly deep: string;
  readonly mid: string;
  readonly light: string;
  readonly sheen: number;
}

/** A soft painted field: a ground, folds or masses over it, brush texture and a glaze. Any size; not tileable. */
export interface PaintedRecipe {
  readonly kind: "painted";
  readonly ground: string;
  /** How uneven the ground's colour is. */
  readonly variation: number;
  /** A thin transparent colour laid over everything, in broad patches. */
  readonly glaze: string;
  readonly glazeAmount: number;
  /** Brush texture: its direction, stroke cells per height (1..64), and how much it shows. */
  readonly brush: { readonly axis: Axis; readonly length: number; readonly amount: number };
  readonly folds?: Folds;
  /** Up to ten masses, painted in order. */
  readonly masses: readonly Mass[];
  /** How far a seed moves a mass, as a share of the height (0..0.2). */
  readonly jitter: number;
  readonly depth: number;
}

/** Every recipe a painter takes. */
export type SurfaceRecipe = PaperRecipe | KnitRecipe | PaintedRecipe;

// The painters to come, as settings only: `planSurface` names them and throws until they are built.

/** Planned: warped-noise veins through a stone, as marble. Tileable. */
export interface VeinsRecipe {
  readonly kind: "veins";
  readonly base: string;
  readonly vein: string;
  /** Veins across the tile, how far they wander, and how sharp they are. */
  readonly count: number;
  readonly warp: number;
  readonly sharpness: number;
  readonly depth: number;
}

/** Planned: a crackle of cells, as old varnish or dried paint. Tileable. */
export interface CracksRecipe {
  readonly kind: "cracks";
  readonly base: string;
  readonly crack: string;
  /** Cells across the tile, the cracks' width as a share of a cell, and how much they show. */
  readonly cells: number;
  readonly width: number;
  readonly amount: number;
  readonly depth: number;
}

/** Planned: a repeated motif with a gold ramp, as brocade or a printed pattern. Tileable. */
export interface MotifRecipe {
  readonly kind: "motif";
  readonly ground: string;
  /** The ramp the motif is coloured with, dark to light. */
  readonly ramp: readonly string[];
  /** Repeats across and down the tile, and a half-drop between columns. */
  readonly across: number;
  readonly down: number;
  readonly halfDrop: boolean;
  readonly depth: number;
}

/** A recipe for a painter that is planned and not built yet. */
export type PlannedRecipe = VeinsRecipe | CracksRecipe | MotifRecipe;

/** The planned painters' kinds. */
export const PLANNED: readonly PlannedRecipe["kind"][] = ["veins", "cracks", "motif"];

/** A pale grey-green paper with fibres, specks and faint laid lines: a list band's ground. */
export const PAPER: PaperRecipe = {
  kind: "paper", tone: "#dcdcd0", fleck: "#6f6d60", flecks: 0.14, stain: "#cfc8b2", stains: 0.35,
  cells: 72, fibres: 0.5, mottle: 0.06, mottleScale: 6, laid: 0, chain: 0, lines: 0.15, depth: 0.004,
};

/** A hot pink rib knit, eight ribs and eighteen courses a tile: seven tiles go once around a cap of 56 ribs. */
export const KNIT: KnitRecipe = {
  kind: "knit", base: "#ff2f78", shadow: "#d91a5e", light: "#ff85ad",
  ribs: 8, courses: 18, knit: 0.62, twist: 2.5, fuzz: 0.45, jitter: 0.35, depth: 0.025,
};

/** A painted flower close-up: white petals at the left, a plum bloom top right, ochre and crimson below. */
export const PAINTED_FLORAL: PaintedRecipe = {
  kind: "painted", ground: "#3f6b64", variation: 0.09, glaze: "#5a6a3c", glazeAmount: 0.16,
  brush: { axis: [1, -0.35], length: 14, amount: 0.1 }, jitter: 0.015, depth: 0.002,
  masses: [
    { at: [0.1, 0.32], size: [0.52, 0.2], axis: [0.35, 1], colour: "#a9a996", light: "#e8e6da", soft: 0.07, warp: 0.32, streak: 0.35, point: 0.3 },
    { at: [0.2, 0.06], size: [0.34, 0.16], axis: [1, 0.3], colour: "#b4b3a0", light: "#e8e6da", soft: 0.07, warp: 0.28, streak: 0.35, point: 0.3 },
    { at: [0.04, 0.8], size: [0.42, 0.08], axis: [0.2, 1], colour: "#2a4431", light: "#6f7f4a", soft: 0.07, warp: 0.12, streak: 0.3, point: 1 },
    { at: [0.86, 0.1], size: [0.34, 0.3], axis: [1, 0.25], colour: "#4a1d38", light: "#a83d6e", soft: 0.07, warp: 0.24, streak: 0.3, ring: true },
    { at: [0.65, 0.05], size: [0.12, 0.09], axis: [1, 0.5], colour: "#6a2a4e", light: "#a83d6e", soft: 0.07, warp: 0.24, streak: 0.3, ring: true },
    { at: [0.82, 0.8], size: [0.42, 0.12], axis: [1, -0.55], colour: "#2a4431", light: "#7d8a4a", soft: 0.07, warp: 0.12, streak: 0.3, point: 1 },
    { at: [0.42, 0.84], size: [0.34, 0.06], axis: [1, -0.8], colour: "#2a4431", light: "#6f7f4a", soft: 0.07, warp: 0.12, streak: 0.3, point: 1 },
    { at: [0.66, 0.66], size: [0.15, 0.06], axis: [0.7, -1], colour: "#9a7a22", light: "#c9a233", soft: 0.07, warp: 0.24, streak: 0.35, point: 0.8 },
    { at: [0.3, 0.6], size: [0.11, 0.05], axis: [0.7, -1], colour: "#b7b39a", light: "#e8e6da", soft: 0.07, warp: 0.2, streak: 0.3, point: 0.7 },
    { at: [0.47, 0.98], size: [0.11, 0.09], axis: [1, 0.2], colour: "#5e1520", light: "#8b1e2a", soft: 0.07, warp: 0.24, streak: 0.3, ring: true },
  ],
};

/** Dark green cloth in soft diagonal folds with a satin sheen along them. */
export const PAINTED_CLOTH: PaintedRecipe = {
  kind: "painted", ground: "#0e2b1d", variation: 0.06, glaze: "#14301f", glazeAmount: 0.2,
  brush: { axis: [1, 0.6], length: 3, amount: 0.05 }, jitter: 0, depth: 0.003, masses: [],
  folds: { axis: [1, 0.55], count: 2.2, warp: 0.8, deep: "#0e2b1d", mid: "#2f5a3c", light: "#5c8a63", sheen: 0.5 },
};

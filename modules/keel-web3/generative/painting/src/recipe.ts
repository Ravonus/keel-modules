// keel-painting@1: what an agent writes. Sizes are shares of the layer's height unless marked px; points are shares
// of the guide's width and height; colours are hex. Layers paint back to front.

/** Tips and media, as render/brush names them. */
export type Tip = "round" | "flat" | "filbert" | "rake";
export type Medium = "oil" | "glaze" | "scumble";
export type BlendMode =
  "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "colour" | "luminosity" | "add";
/** What a pass's strokes follow: the region's long axis, the form (isophotes of the light), or the line guide. */
export type Follow = "axis" | "form" | "line";

/** Guide ids by name; `*` matches the rest of a name (`eye.*`). `not` takes ids back out. */
export interface Selection {
  readonly id: readonly string[];
  readonly not?: readonly string[];
  /** Soft edge, in layer pixels. */
  readonly feather?: number;
  /** Layer pixels the selection reaches past its ids, under the layers in front: no gaps at their edges. */
  readonly grow?: number;
  /** A spot the selection keeps to: its centre on the guides as shares of their width and height, and its radius as a
   *  share of the height; it moves with the warp. For what the ids do not split: lips, a cheek, an iris. */
  readonly at?: readonly [number, number];
  readonly radius?: number;
}

export interface PassRecipe {
  /** block-in, form, detail, accent, blend or glaze; or a preset: skin, hair.locks, cloth, velvet. */
  readonly pass: string;
  /** A preset's palette, when it is not the preset's own name. */
  readonly palette?: string;
  readonly brush?: Tip;
  readonly medium?: Medium;
  /** The tip's width, smallest and largest, as shares of the layer's height. */
  readonly size?: readonly [number, number];
  /** `#hex`, `palette(name, i)`, `ramp(name, light, steps[, shift])` or `under`. */
  readonly colour?: string;
  readonly opacity?: number;
  readonly wet?: number;
  readonly load?: number;
  readonly height?: number;
  readonly taper?: readonly [number, number];
  /** A stroke's length in tip widths. */
  readonly length?: number;
  /** Cells between strokes, in tip widths: above 1 is sparser. */
  readonly spacing?: number;
  readonly follow?: Follow;
  /** Where a pass looks for its place: detail on line above it, accent on light above it, 0..1. */
  readonly threshold?: number;
  /** Strokes may run over id borders. */
  readonly cross?: boolean;
  /** How far a stroke's colour wanders, in ramp steps. */
  readonly jitter?: number;
  readonly bristles?: number;
  readonly select?: Selection;
}

export interface OpRecipe {
  readonly op: "edge-bleed" | "grade";
  /** Edge bleed: the band's width in frame pixels, and how much of the colour behind runs into it. */
  readonly px?: number;
  readonly amount?: number;
  /** Grade, in linear light: lift, gamma, gain; warmth (+ is warmer); saturation (1 keeps). */
  readonly lift?: number;
  readonly gamma?: number;
  readonly gain?: number;
  readonly warm?: number;
  readonly saturation?: number;
}

export interface LayerRecipe {
  readonly name: string;
  readonly select: Selection;
  /** The layer's canvas in pixels. */
  readonly res: readonly [number, number];
  readonly passes: readonly PassRecipe[];
  readonly blend?: BlendMode;
  readonly opacity?: number;
  readonly ops?: readonly OpRecipe[];
  /** The rig, for render/puppet; the painter carries it and does not read it. */
  readonly rig?: unknown;
}

/** A point: `[x, y]` shares of the guide, or `id:<name>` (its centre) with `.top`, `.bottom`, `.left`, `.right`. */
export type Handle = string | readonly [number, number];

export interface WarpRecipe {
  /** Moves a point, and scales about it, with a falloff `radius` (a share of the guide's height). */
  readonly anchor?: Handle;
  /** Holds a point: no move inside `radius`. */
  readonly pin?: Handle;
  /** Shares of the guide's height. */
  readonly move?: readonly [number, number];
  readonly scale?: readonly [number, number];
  readonly radius: number;
}

export interface PaintingRecipe {
  readonly format: "keel-painting@1";
  readonly seed: number;
  readonly palettes: Readonly<Record<string, readonly string[]>>;
  /** Where the guides come from; the host renders or loads them. The painter does not read it. */
  readonly guides?: unknown;
  readonly warp?: readonly WarpRecipe[];
  readonly layers: readonly LayerRecipe[];
  readonly ops?: readonly OpRecipe[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
const HEX = /^#[0-9a-f]{6}$/iu;

function fail(where: string, what: string): never {
  throw new TypeError(`painting: ${where} ${what}.`);
}

function checkSelection(v: unknown, where: string): void {
  if (!isObject(v) || !Array.isArray(v.id) || !v.id.every((s) => typeof s === "string")) {
    fail(where, "needs a selection { id: [names] }");
  }
  if (v.at !== undefined && (!isPair(v.at) || !(typeof v.radius === "number" && v.radius > 0))) {
    fail(where, "takes a spot as at [x, y] with a radius above 0");
  }
}

function checkLayer(v: unknown, i: number): void {
  const where = `layers[${i}]`;
  if (!isObject(v) || typeof v.name !== "string") fail(where, "needs a name");
  checkSelection(v.select, `${where}.select`);
  if (!isPair(v.res)) fail(where, "needs res [width, height]");
  if (!Array.isArray(v.passes)) fail(where, "needs passes");
  v.passes.forEach((p, k) => {
    if (!isObject(p) || typeof p.pass !== "string") fail(`${where}.passes[${k}]`, "needs a pass name");
    if (p.select !== undefined) checkSelection(p.select, `${where}.passes[${k}].select`);
  });
}

function checkPalettes(v: unknown): void {
  if (!isObject(v)) fail("palettes", "is an object of colour lists");
  for (const [name, list] of Object.entries(v)) {
    if (!Array.isArray(list) || list.length < 1 || !list.every((c) => typeof c === "string" && HEX.test(c))) {
      fail(`palettes.${name}`, "is a list of #rrggbb");
    }
  }
}

/**
 * Checks a keel-painting@1 recipe's shape and returns it typed. Values are read where they are used.
 *
 * @param input Parsed JSON.
 * @returns The same object.
 */
export function readRecipe(input: unknown): PaintingRecipe {
  if (!isObject(input) || input.format !== "keel-painting@1") fail("the recipe", "is keel-painting@1");
  if (typeof input.seed !== "number" || !Number.isInteger(input.seed)) fail("seed", "is an integer");
  checkPalettes(input.palettes);
  if (!Array.isArray(input.layers) || input.layers.length === 0) fail("layers", "is a list of layers");
  input.layers.forEach(checkLayer);
  if (input.warp !== undefined && !Array.isArray(input.warp)) fail("warp", "is a list of handles");
  return input as unknown as PaintingRecipe;
}

// A recipe and its guides into a plan: the warp, and for each layer its box on the guides, its selection and its
// steps (stroke lists and glazes), all in exact arithmetic, with a digest that covers every number.
import { colourRule, type Rgb } from "./colour.js";
import { digestOf, hash32, textHash } from "./exact.js";
import { boxOf, idFlags, idStats, type Guides, type IdStats } from "./guide.js";
import { expandPasses } from "./presets.js";
import { planStrokes, type LayerFrame, type PassContext, type PlannedStroke } from "./passes.js";
import type { BlendMode, LayerRecipe, OpRecipe, PaintingRecipe, PassRecipe, Selection } from "./recipe.js";
import { WARP_CELLS, planWarp, type Warp } from "./warp.js";
import { layerGuides, levelsOf } from "./layer.js";

/** The version of the planner: a plan's digest covers it. */
export const PAINTING_VERSION = 1;
/** Canvas pixels a cell of the guides the planner reads under a layer. */
export const LAYER_STEP = 3;

/** A selection as the GPU takes it: a flag an id, and a feather in layer pixels. */
export interface SelectionPlan {
  readonly flags: Uint8Array;
  readonly feather: number;
  readonly grow: number;
  /** A spot in frame pixels, x, y and radius, or null. */
  readonly spot: readonly [number, number, number] | null;
}

export type Step =
  | { readonly kind: "strokes"; readonly pass: string; readonly strokes: readonly PlannedStroke[] }
  | { readonly kind: "glaze"; readonly tint: Rgb; readonly opacity: number; readonly select: SelectionPlan | null }
  | {
    readonly kind: "under"; readonly palette: readonly Rgb[]; readonly shift: number; readonly levels: readonly [number, number];
    readonly soften: number; readonly opacity: number; readonly select: SelectionPlan;
  };

export interface LayerPlan extends LayerFrame {
  readonly name: string;
  readonly select: SelectionPlan;
  readonly steps: readonly Step[];
  readonly blend: BlendMode;
  readonly opacity: number;
  readonly ops: readonly OpRecipe[];
}

export interface PaintingPlan {
  readonly seed: number;
  readonly warp: Warp;
  readonly layers: readonly LayerPlan[];
  readonly ops: readonly OpRecipe[];
  /** Strokes over all layers. */
  readonly strokes: number;
  readonly digest: string;
}

function selectionOf(guides: Guides, s: Selection): SelectionPlan {
  const { width, height } = guides.id;
  const spot: [number, number, number] | null = s.at ? [s.at[0] * width, s.at[1] * height, (s.radius ?? 0) * height]
    : null;
  return { flags: idFlags(guides.ids, s.id, s.not ?? []), feather: s.feather ?? 1.5, grow: s.grow ?? 0, spot };
}

/** The layer's box: its ids' box, grown by `margin` and then to the canvas's shape. Whole guide pixels. */
export function layerFrame(
  stats: IdStats, flags: Uint8Array, res: readonly [number, number], margin: number,
): LayerFrame {
  const b = boxOf(stats, flags);
  if (!b) throw new TypeError("painting: a layer selects no pixels of the guides.");
  let w = b[2] - b[0] + 1 + 2 * margin;
  let h = b[3] - b[1] + 1 + 2 * margin;
  if (w / h < res[0] / res[1]) w = Math.ceil((h * res[0]) / res[1]);
  else h = Math.ceil((w * res[1]) / res[0]);
  const x = Math.floor((b[0] + b[2] + 1) / 2 - w / 2);
  const y = Math.floor((b[1] + b[3] + 1) / 2 - h / 2);
  return { box: [x, y, w, h], res, scale: res[1] / h };
}

/** An underpainting: the layer's light along a ramp's palette, softened by `size[0]` of the layer's height. */
function underOf(ctx: PassContext, guides: Guides, pass: PassRecipe): Step {
  const rule = colourRule(pass.colour ?? "", ctx.palettes);
  if (rule.kind !== "ramp") throw new TypeError("painting: an underpainting takes a ramp.");
  if (rule.palette.length > 8) throw new TypeError("painting: an underpainting's palette has at most 8 entries.");
  const select = pass.select ? selectionOf(guides, pass.select)
    : { flags: ctx.flags, feather: 0, grow: ctx.grow, spot: ctx.spot };
  return {
    kind: "under", palette: rule.palette, shift: rule.shift / (rule.steps - 1), levels: ctx.levels,
    soften: (pass.size?.[0] ?? 0.01) * ctx.frame.res[1], opacity: pass.opacity ?? 1, select,
  };
}

function stepOf(ctx: PassContext, guides: Guides, pass: PassRecipe, key: number): Step {
  if (pass.pass === "glaze") {
    const rule = colourRule(pass.colour ?? "#ffffff", ctx.palettes);
    if (rule.kind !== "flat") throw new TypeError("painting: a glaze takes a flat colour.");
    return { kind: "glaze", tint: rule.rgb, opacity: pass.opacity ?? 0.2,
      select: pass.select ? selectionOf(guides, pass.select) : null };
  }
  if (pass.pass === "under") return underOf(ctx, guides, pass);
  const own = pass.select ? selectionOf(guides, pass.select) : null;
  const local = own ? { ...ctx, flags: own.flags, grow: own.grow, spot: own.spot } : ctx;
  return { kind: "strokes", pass: pass.pass, strokes: planStrokes(local, pass, key) };
}

interface Shared {
  readonly recipe: PaintingRecipe;
  readonly guides: Guides;
  readonly stats: IdStats;
  readonly warp: Warp;
}

/** How far the warp reaches into a box's neighbourhood: the largest grid offset there, in guide pixels. */
export function warpReach(warp: Warp, box: readonly [number, number, number, number] | null): number {
  if (!box) return 0;
  const n = WARP_CELLS + 1;
  const cw = warp.width / WARP_CELLS;
  const ch = warp.height / WARP_CELLS;
  const i0 = Math.max(Math.floor(box[0] / cw) - 2, 0);
  const i1 = Math.min(Math.ceil(box[2] / cw) + 2, WARP_CELLS);
  const j1 = Math.min(Math.ceil(box[3] / ch) + 2, WARP_CELLS);
  let reach = 0;
  for (let j = Math.max(Math.floor(box[1] / ch) - 2, 0); j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const dx = warp.grid[(j * n + i) * 2] ?? 0;
      const dy = warp.grid[(j * n + i) * 2 + 1] ?? 0;
      reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return Math.ceil(reach);
}

function planLayer(shared: Shared, layer: LayerRecipe): LayerPlan {
  const { recipe, guides } = shared;
  const select = selectionOf(guides, layer.select);
  const margin = warpReach(shared.warp, boxOf(shared.stats, select.flags)) + Math.ceil(2 * select.feather) +
    Math.ceil(select.grow) + 4;
  const frame = layerFrame(shared.stats, select.flags, layer.res, margin);
  const under = layerGuides(guides, shared.warp, frame, LAYER_STEP);
  const ctx: PassContext = {
    guides, stats: shared.stats, warp: shared.warp, frame, flags: select.flags, grow: select.grow, spot: select.spot,
    layer: under,
    levels: levelsOf(under, select.flags), seed: recipe.seed, palettes: recipe.palettes,
  };
  const name = textHash(layer.name);
  const steps = expandPasses(layer.passes).map((pass, i) => stepOf(ctx, guides, pass, hash32(name, i, 7)));
  return {
    ...frame, name: layer.name, select, steps, blend: layer.blend ?? "normal", opacity: layer.opacity ?? 1,
    ops: layer.ops ?? [],
  };
}

const TIPS = ["round", "flat", "filbert", "rake"];
const MEDIA = ["oil", "glaze", "scumble"];

/** Every number of a layer, in a fixed order, for the digest. */
function layerNumbers(layer: LayerPlan): Float32Array {
  const out: number[] = [...layer.box, ...layer.res, layer.opacity, ...layer.select.flags, layer.select.feather,
    layer.select.grow, ...(layer.select.spot ?? []),
    textHash(layer.blend + JSON.stringify(layer.ops))];
  for (const step of layer.steps) {
    if (step.kind === "glaze") out.push(-1, ...step.tint, step.opacity, ...(step.select?.flags ?? []), ...(step.select?.spot ?? []));
    else if (step.kind === "under") {
      out.push(-2, ...step.palette.flat(), step.shift, ...step.levels, step.soften, step.opacity, ...step.select.flags,
        ...(step.select.spot ?? []));
    }
    else {
      for (const s of step.strokes) {
        out.push(s.path.length, ...s.path.flat(), TIPS.indexOf(s.tip), s.size, ...s.colour, s.opacity,
          MEDIA.indexOf(s.medium), s.load, s.wet, s.height, ...s.taper, s.bristles, s.seed);
      }
    }
  }
  return Float32Array.from(out);
}

/**
 * Plans a painting.
 *
 * @param recipe A keel-painting@1 recipe (see `readRecipe`).
 * @param guides Its guides; every pass must be the id guide's size.
 * @returns The plan and its digest.
 */
export function planPainting(recipe: PaintingRecipe, guides: Guides): PaintingPlan {
  const stats = idStats(guides.id);
  const warp = planWarp(recipe.warp ?? [], guides.ids, stats, guides.id);
  const shared: Shared = { recipe, guides, stats, warp };
  const layers = recipe.layers.map((layer) => planLayer(shared, layer));
  const head = Float32Array.from([PAINTING_VERSION, recipe.seed, guides.id.width, guides.id.height,
    textHash(JSON.stringify(recipe.ops ?? []))]);
  const digest = digestOf([head, warp.grid, ...layers.map(layerNumbers)]);
  const count = (l: LayerPlan): number => l.steps.reduce((m, s) => m + (s.kind === "strokes" ? s.strokes.length : 0), 0);
  const strokes = layers.reduce((n, l) => n + count(l), 0);
  return { seed: recipe.seed, warp, layers, ops: recipe.ops ?? [], strokes, digest };
}

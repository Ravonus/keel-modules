/**
 * painting: keel-painting@1, painted layers over guides. MIT.
 *
 * `readRecipe` checks a recipe; `planPainting(recipe, guides)` turns it and its guide passes (id, light, line; RGBA8)
 * into a plan in exact arithmetic with a digest: the anchor and pin warp, each layer's box and selection, and its
 * passes (under, block-in, form, detail, accent, blend, glaze; presets skin, hair.locks, cloth, velvet) as stroke
 * lists.
 * `createPainting(brush, packStrokes)` paints a plan with render/brush and composes the layers: mask, blend mode,
 * edge bleed and grade.
 */
export { readRecipe } from "./recipe.js";
export type {
  BlendMode, Follow, Handle, LayerRecipe, Medium, OpRecipe, PaintingRecipe, PassRecipe, Selection, Tip, WarpRecipe,
} from "./recipe.js";
export { along, colourRule, rampColour, rgb } from "./colour.js";
export type { ColourRule, Rgb } from "./colour.js";
export { axisOf, boxOf, idFlags, idStats, matches, principal, redAt } from "./guide.js";
export type { GuideImage, Guides, IdStats } from "./guide.js";
export { WARP_CELLS, handlePoint, planWarp, warpPoint } from "./warp.js";
export type { Warp } from "./warp.js";
export { PRESETS, expandPasses } from "./presets.js";
export { MAX_CELLS, PASS_DEFAULTS, planStrokes, resolvePass, tensorFlow, toGuide, trace } from "./passes.js";
export type { LayerFrame, PassContext, PlannedStroke } from "./passes.js";
export { LAYER_STEP, PAINTING_VERSION, layerFrame, planPainting, warpReach } from "./plan.js";
export { fieldAt, layerGuides, levelsOf } from "./layer.js";
export type { LayerGuides } from "./layer.js";
export type { LayerPlan, PaintingPlan, SelectionPlan, Step } from "./plan.js";
export { createPainting } from "./gpu.js";
export type { BatchLike, BrushLike, CanvasLike, Pack, PaintOptions, Painted, PaintedLayer, Painting } from "./gpu.js";
export { digestOf, hash32, textHash, unit } from "./exact.js";

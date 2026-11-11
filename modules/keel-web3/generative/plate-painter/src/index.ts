/**
 * plate-painter: a painted landscape plate, generated on the GPU at load from a seeded recipe, and drawn as a
 * screen-locked backdrop. MIT.
 *
 * `planPlate` turns a recipe and a seed into every number the GPU needs, in exact arithmetic, with a digest.
 * `createPlatePainter(gl)` paints a plan into a texture, draws it behind a scene, and reads it back for a still.
 */
export { LAKE_VALLEY } from "./recipe.js";
export type {
  BranchRecipe, MassRecipe, Pair, PlateRecipe, RangeRecipe, StrokeRecipe, TownRecipe, TreeRecipe,
} from "./recipe.js";
export { MAX_RANGES, PAINTER_VERSION, RIDGE_SAMPLES, planPlate } from "./plan.js";
export type { PlanUniform, PlatePlan, PlateSettings } from "./plan.js";
export { KIND, STRIDE } from "./dab.js";
export { LEAF_CODE, MAX_GLAZES, PLATE_REGIONS, checkGlaze, readPlateBasis, withParams } from "./basis.js";
export type { PlateBasis, PlateGlaze, PlateRegion } from "./basis.js";
export { coverCrop, createPlatePainter } from "./gpu.js";
export type { BackdropView, Plate, PlatePainter, PlateSize, PlateStill, PlateView } from "./gpu.js";

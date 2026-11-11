/**
 * surfaces: seeded painters of 2D surfaces (paper, rib knit, a painted ground), each an albedo and a relief (normal
 * and height) at any size, on the GPU or the CPU; and prints, a host's own 2D drawing as a lit texture. MIT.
 *
 * A recipe in, `{ digest, buffers }` out: `planSurface` works out every number in exact arithmetic with a digest, so a
 * host caches a surface by it; `paintSurface` paints on the CPU and `createSurfacePainter(gl).paint` on the GPU.
 */
export { KNIT, PAINTED_CLOTH, PAINTED_FLORAL, PAPER, PLANNED } from "./recipe.js";
export type {
  Axis, CracksRecipe, Folds, KnitRecipe, Mass, MotifRecipe, PaintedRecipe, PaperRecipe, PlannedRecipe, SurfaceRecipe,
  VeinsRecipe,
} from "./recipe.js";
export { KINDS, MAX_MASSES, PAINTER_VERSION, UNIFORMS, planSurface } from "./plan.js";
export type { SurfacePlan, SurfaceSettings } from "./plan.js";
export { paintPlan, paintSurface } from "./paint.js";
export type { Surface } from "./paint.js";
export { createSurfacePainter } from "./gpu.js";
export type { SurfacePainter } from "./gpu.js";
export { createPrinter, pbr, surfaceTextures } from "./print.js";
export type {
  CanvasLike, Context2D, DataTextureLike, DrawPrint, Print, PrintLit, PrintOptions, TextureLike,
} from "./print.js";

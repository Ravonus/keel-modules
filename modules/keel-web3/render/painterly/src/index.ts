/**
 * A lit keel/lit stage painted as an oil painting: the frame smoothed along its structure (an anisotropic
 * Kuwahara filter guided by the structure tensor), strokes stamped along the form (a flow taken from the mesh's
 * own normals and depth, so strokes follow the shape and not the pixels), then canvas grain, edge darkening and a
 * varnish grade. MIT.
 *
 *   renderer.toneMapping = "none";                     // the painter tone maps
 *   const paint = createPainterly(lit, renderer, { stroke: 5, direction: 1 });
 *   paint.setSize(cssWidth, cssHeight, renderer.getPixelRatio());
 *   renderer.setAnimationLoop(() => paint.render(scene, camera));
 *
 * `SMOOTH_SETTINGS` is the smoothed base alone; `STROKED_SETTINGS` (the default) lays strokes along the form over
 * it. Where each stroke lies and how the canvas is woven come from the seed, in arithmetic that gives the same
 * bytes on every engine; the strokes' direction and colour come from the picture, on the GPU.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export {
  DEFAULT_PAINTERLY_SETTINGS, SMOOTH_SETTINGS, STROKED_SETTINGS, STROKE_CELLS, GRAIN_SIZE, GRAIN_PITCH,
  painterlySettings, hash32, unit, strokeTile, grainTile,
} from "./settings.js";
export type { PainterlySettings } from "./settings.js";
export {
  VERTEX_GLSL, PREP_GLSL, TENSOR_GLSL, BLUR_GLSL, KUWAHARA_GLSL, TABLE_GLSL, STROKE_GLSL, GRADE_GLSL,
} from "./painterly.glsl.js";
export type { LitLike } from "./lit.js";
export { createPainterly } from "./pass.js";
export type { Painterly } from "./pass.js";

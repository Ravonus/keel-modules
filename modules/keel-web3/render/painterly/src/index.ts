/**
 * A lit keel/lit stage painted as an oil painting: the frame smoothed along its structure (an anisotropic
 * Kuwahara filter guided by the structure tensor) and blended along it, as paint glazed and blended is, with the
 * features of a face kept crisp; strokes along the form if asked for (a flow taken from the mesh's own depth, so
 * strokes follow the shape and not the pixels), carrying the colour under them; then a warm varnish with a fine
 * craquelure, over canvas showing in the thin, dark passages. MIT.
 *
 *   renderer.toneMapping = "none";                     // the painter tone maps
 *   const paint = createPainterly(lit, renderer, { stroke: 4, crackle: 0.25 });
 *   paint.setSize(cssWidth, cssHeight, renderer.getPixelRatio());
 *   renderer.setAnimationLoop(() => paint.render(scene, camera));
 *
 * `GLAZE_SETTINGS` (the default) is the glazed base and the varnish, no strokes; `STROKED_SETTINGS` lays a few soft
 * strokes along the form over it. Where each stroke lies, how the canvas is woven and where the varnish cracks come
 * from the seed, in arithmetic that gives the same bytes on every engine; the strokes' direction and colour come
 * from the picture, on the GPU.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export {
  DEFAULT_PAINTERLY_SETTINGS, GLAZE_SETTINGS, STROKED_SETTINGS, STROKE_CELLS, GRAIN_SIZE, GRAIN_PITCH, CRACK_SIZE,
  painterlySettings, hash32, unit, strokeTile, grainTile, crackTile,
} from "./settings.js";
export type { PainterlySettings } from "./settings.js";
export {
  VERTEX_GLSL, PREP_GLSL, TENSOR_GLSL, BLUR_GLSL, KUWAHARA_GLSL, GLAZE_GLSL, TABLE_GLSL, STROKE_GLSL, GRADE_GLSL,
} from "./painterly.glsl.js";
export type { LitLike } from "./lit.js";
export { createPainterly } from "./pass.js";
export type { Painterly } from "./pass.js";

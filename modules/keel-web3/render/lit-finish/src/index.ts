/**
 * The finish a lit, full-colour keel/lit stage needs to read as real: ambient
 * occlusion from depth, aerial haze lit toward the sun, sunlight through
 * leaves, colour muted and varied across the world, TAA, bloom, a filmic tone
 * map and a light grade. The realism look's counterpart to voxel-dither. MIT.
 *
 *   renderer.toneMapping = "none";              // the finish tone maps
 *   const finish = createLitFinish(lit, renderer, { tonemap: "agx", ao: 0.8 });
 *   finish.setSize(cssWidth, cssHeight, renderer.getPixelRatio());
 *   finish.setSun([sun.x, sun.y, sun.z], "#fff2dc");
 *   finish.setHaze({ colour: "#a9bfd6", density: 0.015, start: 6 });
 *   renderer.setAnimationLoop(() => finish.render(scene, camera));
 *
 * The scene is drawn once, jittered, into a multisampled linear target with
 * depth. AO is taken from that depth at half size (16 samples, a different
 * spin per pixel) and blurred among pixels at the same depth, so it never
 * bleeds across a silhouette. Haze replaces a stage's fog: give the stage none.
 * TAA reprojects the last frame through the depth and the last camera. Light
 * through leaves and colour variation live in the stage's own materials: the
 * finish chains them onto each material's onCompile every 30 frames, so parts
 * a stage builds later are dressed too. A dithered fade moves its pattern by
 * `ditherOffset()` to resolve under TAA.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export {
  TONEMAPS, DEFAULT_FINISH_SETTINGS, AO_SAMPLES, finishSettings, aoKernel, directionInView, linearColour, multiply4,
  jitterAt, ditherShiftAt,
} from "./settings.js";
export type { Tonemap, FinishSettings } from "./settings.js";
export { VERTEX_GLSL, AO_GLSL, LIGHT_GLSL, TAA_GLSL, BRIGHT_GLSL, BLUR_GLSL, GRADE_GLSL } from "./finish.glsl.js";
export { dressMaterial, dressTree } from "./dress.js";
export type { DressMaterialLike, DressNodeLike } from "./dress.js";
export type { LitLike } from "./lit.js";
export { createLitFinish } from "./pass.js";
export type { Haze, LitFinish } from "./pass.js";

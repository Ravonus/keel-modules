/**
 * Dithered voxel pixel art for any keel/lit stage. MIT.
 *
 * The scene is drawn at a low, integer-scaled resolution and only ever SHOWN
 * through a dither screen: a threshold map plus a few tone steps, or a fixed
 * palette. Each art pixel picks its screen by depth band (near things crisp
 * and structured, far things fine and calm), carries a one-pixel silhouette
 * outline and voxel creases, and can be cel-lit through stepped toon ramps.
 *
 * Every screen is a pure function of the art pixel, never of time or of a
 * neighbour's error, so a pixel whose light does not change never changes
 * colour and the picture does not crawl.
 *
 *   const look = createVoxelDither(lit, renderer, { style: "smart" });
 *   look.setSize(cssWidth, cssHeight, devicePixelRatio);
 *   look.shade(scene);                       // after building or rebuilding the scene
 *   renderer.setAnimationLoop(() => look.render(scene, camera));
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 *
 * Outlines and creases come from the depth buffer, so anything drawn with
 * `depthWrite: false` (rain, sparks, glows) is still dithered but never outlined.
 */

export {
  SCREENS, DITHER_STYLES, STYLE_IDS, DEFAULT_DITHER_SETTINGS, ditherSettings, autoPixel, resolveGrid, bandScreens,
} from "./settings.js";
export type {
  ScreenId, ScreenChoice, Shading, ColorMode, DepthBand, BandScreen, BandScreens, DitherSettings, StyleId, PixelGrid,
} from "./settings.js";
export { thresholdAt, quantizeTone, celRamp, okLab, paletteUniform } from "./screens.js";
export type { ToneStep } from "./screens.js";
export { VOXEL_DITHER_GLSL } from "./dither.glsl.js";
export { screenLight } from "./light.js";
export type { RaySpec, ScreenLight } from "./light.js";
export type { LitLike } from "./lit.js";
export { SIGNAL_FILTERS, SIGNAL_TAG_ALPHA, signalUniform, filterUniform, DETAIL_LAYER } from "./signals.js";
export type { SignalPart, SignalFilter, SignalSpec } from "./signals.js";
export { createVoxelDither } from "./pass.js";
export type { VoxelDither } from "./pass.js";

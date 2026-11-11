/**
 * A hand-over between two keel/lit scenes on one renderer. MIT.
 *
 *   const finish = createLitFinish(lit, renderer);          // lit-finish, shared by both scenes
 *   const blend = createSceneBlend(lit, renderer, finish, { seed: 7 });
 *   blend.setSize(cssWidth, cssHeight, renderer.getPixelRatio());
 *   // each frame of the pair's life, t from the page:
 *   const current = blend.draw({ scene: a, camera: camA }, { scene: b, camera: camB }, t, { mode: "noise" });
 *
 * While 0 < t < 1 each scene is drawn through the one finish into its own half-float target, and one pass blends
 * them onto the host's target. The incoming arrives as white luma-edge line work over the outgoing and fills in
 * through a seeded noise threshold (or out from a point, radially) with a glowing seam at the boundary; the outgoing
 * takes on line work of its own as it goes. `draw` returns which scene is current (the switch is at 0.5); moving the
 * active section is the host's. The noise is a texture worked out from the seed with exact arithmetic, never
 * Math.random, so a capture repeats.
 *
 * keel/lit and the finish are injected: the module never imports them and never touches globals.
 */

export {
  DEFAULT_BLEND_SETTINGS, blendSettings, blendLines, blendFill, currentAt, radialCentre, farthestCorner, displayColour,
} from "./settings.js";
export type { BlendSettings, Point } from "./settings.js";
export { NOISE_SIZE, latticeHash, noiseTexels } from "./noise.js";
export { BLEND_GLSL, BLEND_VERTEX_GLSL } from "./blend.glsl.js";
export type { FinishLike, LitLike } from "./lit.js";
export { createSceneBlend } from "./blend.js";
export type { DrawOptions, SceneBlend, Shot } from "./blend.js";

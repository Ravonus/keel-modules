/**
 * The section pass: one full-screen pass after the finish, for what a scrolled section lays over its scene. MIT.
 *
 *   import * as finishModule from "keel://module/lit-finish.js";
 *   const post = createSectionPost(lit, renderer, finishModule, { colour: "#f7f7ee", tear: 1 });
 *   post.setSize(cssWidth, cssHeight, renderer.getPixelRatio());
 *   // each frame, the values from the host's tracks:
 *   post.render(() => finish.render(scene, camera), { progress, position, darken, blur });
 *
 * A paper panel sweeps up over the frame (`progress` 0 → 1) and on up out of it (1 → 2), its edges moved by
 * `position`, straight or torn, with a thin line of lighter fibres and a soft shadow past them. Under the panel the
 * frame can be darkened and blurred (lit-finish's own blur, passed in); a one-pixel grain lies over everything. A
 * frame that needs none of it is drawn straight to the host's target.
 *
 * keel/lit and lit-finish are injected: the module never imports them and never touches globals.
 */

export {
  DEFAULT_POST_SETTINGS, TEAR_REACH, postSettings, frameOf, panelEdges, panelShows, idle, blurStep, displayColour,
} from "./settings.js";
export type { Frame, PostSettings, PostValues } from "./settings.js";
export { NOISE_SIZE, latticeHash, noiseTexels } from "./noise.js";
export { POST_GLSL, POST_VERTEX_GLSL } from "./post.glsl.js";
export type { LitLike } from "./lit.js";
export { createSectionPost } from "./post.js";
export type { FinishShaders, SectionPost } from "./post.js";

/**
 * portrait: a seeded waist-up bust at hero detail, sculpted from signed distances and meshed when it is generated,
 * with a portrait shading path for keel/lit (soft warm key, cool fill, wrap and under-skin light). MIT.
 */

export { buildBust, digestOf, featuresOf, DETAIL, PARTS, headPose } from "./bust.js";
export type { Bust, BustRecipe, Detail, Nail, Part, Pose } from "./bust.js";
export { createPortrait, LIGHT, PALETTE } from "./render.js";
export type { FaceState, Palette, Portrait, PortraitLight, PortraitLit } from "./render.js";
export { DEFAULT_PORTRAIT_SETTINGS, portraitSettings, sitterOf } from "./settings.js";
export type { PortraitSettings } from "./settings.js";
export { cosine, deg, hash32, sine, turn } from "./exact.js";
export type { Features } from "./head.js";

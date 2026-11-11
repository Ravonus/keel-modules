// The passes a preset name expands to: what a painter does for skin, hair, cloth and velvet, tuned on the bust. They
// save an agent's tokens: a figure is palettes, guides, warps and preset names. Flesh is mostly glaze and soft
// blending, with few strokes (P1-C round 3: glaze beats strokes on flesh).
import type { PassRecipe } from "./recipe.js";

type Preset = (palette: string) => readonly PassRecipe[];

const skin: Preset = (p) => [
  { pass: "under", size: [0.003, 0.003], colour: `ramp(${p}, light, 7)`, opacity: 1 },
  { pass: "block-in", brush: "filbert", size: [0.03, 0.045], colour: `ramp(${p}, light, 6)`, opacity: 0.5, wet: 0.5,
    follow: "form", length: 1.8, height: 0.06 },
  { pass: "form", brush: "filbert", size: [0.014, 0.022], colour: `ramp(${p}, light, 8)`, opacity: 0.5, wet: 0.7,
    length: 2, height: 0.05 },
  { pass: "blend", brush: "filbert", size: [0.02, 0.03], opacity: 0.6, spacing: 0.8 },
  { pass: "form", brush: "round", size: [0.009, 0.014], colour: `ramp(${p}, light, 9)`, opacity: 0.4, wet: 0.7,
    length: 2, spacing: 1.6, height: 0.03, jitter: 0.3 },
];

const hairLocks: Preset = (p) => [
  { pass: "under", size: [0.006, 0.006], colour: `ramp(${p}, light, 6, -1)`, opacity: 1 },
  { pass: "block-in", brush: "filbert", size: [0.03, 0.05], colour: `ramp(${p}, light, 4, -1)`, opacity: 0.7,
    wet: 0.3, length: 4 },
  { pass: "form", brush: "filbert", size: [0.016, 0.026], colour: `ramp(${p}, light, 6)`, opacity: 0.85, wet: 0.5,
    length: 5, height: 0.4 },
  { pass: "blend", brush: "filbert", size: [0.02, 0.03], opacity: 0.4, length: 4 },
  { pass: "form", brush: "round", size: [0.005, 0.009], colour: `ramp(${p}, light, 6)`, opacity: 0.5, wet: 0.4,
    length: 7, spacing: 1.6, height: 0.2, jitter: 0.3, taper: [0.2, 0.1] },
  { pass: "accent", brush: "round", size: [0.003, 0.005], colour: `palette(${p}, 1)`, opacity: 0.4, threshold: 0.88,
    length: 12, taper: [0.1, 0.1] },
];

const cloth: Preset = (p) => [
  { pass: "under", size: [0.008, 0.008], colour: `ramp(${p}, light, 5)`, opacity: 1 },
  { pass: "block-in", brush: "flat", size: [0.06, 0.1], colour: `ramp(${p}, light, 3)`, opacity: 1, wet: 0.2 },
  { pass: "form", brush: "filbert", size: [0.025, 0.045], colour: `ramp(${p}, light, 5)`, opacity: 0.8, wet: 0.55,
    length: 3.5 },
  { pass: "blend", brush: "flat", size: [0.03, 0.05], opacity: 0.4, spacing: 1.2 },
  { pass: "accent", brush: "flat", size: [0.008, 0.016], colour: `palette(${p}, 0)`, opacity: 0.55, threshold: 0.8,
    length: 3 },
];

/** Velvet: a deep ground, soft wide modelling, and broken light only on the rims of its folds. */
const velvet: Preset = (p) => [
  { pass: "under", size: [0.01, 0.01], colour: `ramp(${p}, light, 5, -1)`, opacity: 1 },
  { pass: "block-in", brush: "flat", size: [0.07, 0.11], colour: `ramp(${p}, light, 3, -1)`, opacity: 1, wet: 0.3 },
  { pass: "form", brush: "filbert", size: [0.04, 0.07], colour: `ramp(${p}, light, 5, -1)`, opacity: 0.6, wet: 0.8,
    length: 3 },
  { pass: "blend", brush: "filbert", size: [0.05, 0.08], opacity: 0.5 },
  { pass: "accent", brush: "filbert", size: [0.01, 0.02], colour: `ramp(${p}, light, 5, 1)`, opacity: 0.45,
    threshold: 0.62, length: 4 },
  { pass: "accent", brush: "round", size: [0.004, 0.008], colour: `palette(${p}, 0)`, opacity: 0.5, threshold: 0.82,
    length: 2.5 },
];

/** Preset names to their passes. */
export const PRESETS: Readonly<Record<string, Preset>> = { skin, "hair.locks": hairLocks, cloth, velvet };

/**
 * A layer's passes with presets expanded. A preset's own fields (select, and any field a pass takes) apply to each
 * pass it expands to.
 *
 * @returns Plain passes, in order.
 */
export function expandPasses(passes: readonly PassRecipe[]): PassRecipe[] {
  return passes.flatMap((pass) => {
    const preset = PRESETS[pass.pass];
    if (!preset) return [pass];
    const { pass: name, palette, ...shared } = pass;
    return preset(palette ?? name.split(".")[0] ?? name).map((p) => ({ ...p, ...shared }));
  });
}

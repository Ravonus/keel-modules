// A recipe and a seed become a plan: every number the GPU needs, worked out in exact arithmetic, and a digest of
// them all. The same recipe and seed give the same plan, bit for bit, on every engine; the digest names the plate in
// a cache.
import { packDabs, rgb, type Rgb } from "./dab.js";
import { digestOf, draws, hash, noise1 } from "./exact.js";
import { foliageDabs } from "./foliage.js";
import { MAX_GLAZES, PLATE_REGIONS, checkGlaze, withParams, type PlateBasis, type PlateGlaze } from "./basis.js";
import type { PlateRecipe, RangeRecipe, StrokeRecipe } from "./recipe.js";
import { sceneDabs } from "./scene.js";

/** Bumped whenever the passes paint the same plan differently, so a cached plate of an older painter is not reused. */
export const PAINTER_VERSION = 1;

/** Crest samples across the plate for each range. */
export const RIDGE_SAMPLES = 512;
/** The most ranges a plate holds. */
export const MAX_RANGES = 4;

/** What the host may change when it includes the module (keel.module.json's inputs). */
export interface PlateSettings {
  /** Decides every shape. A whole number from 0. */
  readonly seed?: number;
  /** Scales every depth step toward the haze, 0..2; 1 is the recipe's air. */
  readonly haze?: number;
  /** Moves the clouds' cover, -0.5 (clearer) .. 0.5 (heavier). */
  readonly clouds?: number;
  /** False leaves the near leaves out. */
  readonly foliage?: boolean;
}

/** One uniform: its name, its components (1..4) and its values (several for an array). */
export type PlanUniform = readonly [name: string, size: 1 | 2 | 3 | 4, values: Float32Array];

/** Everything the GPU paints from. */
export interface PlatePlan {
  readonly digest: string;
  /** Width over height of the whole plate. */
  readonly aspect: number;
  readonly uniforms: readonly PlanUniform[];
  /** Crest y of each range, RIDGE_SAMPLES across, one row a range (MAX_RANGES rows). */
  readonly ridges: Float32Array;
  /** The middle distance's dabs, drawn under the brush strokes. */
  readonly scene: Float32Array;
  /** The near leaves, drawn over the brush strokes. */
  readonly foliage: Float32Array;
  /** Glazes from a basis, laid last; none without one. */
  readonly glazes: readonly PlateGlaze[];
}

/** A crest's elevation (plate heights) at `u` from its peaks: the highest peak's slope, then a broken edge. */
function elevation(peaks: readonly (readonly [number, number, number])[], u: number): number {
  let h = 0;
  for (const [x, rise, half] of peaks) {
    const d = Math.abs(u - x) / half;
    const shape = 0.5 / (1 + 3 * d * d) + 0.5 * Math.max(0, 1 - 0.8 * d);
    h = Math.max(h, rise * shape);
  }
  return h;
}

/** A range's peaks, each moved a little by the seed, and smaller ones added between. */
function peaksOf(range: RangeRecipe, seed: number, index: number): [number, number, number][] {
  const draw = draws(seed, 100 + index);
  const out = range.peaks.map(([x, y]): [number, number, number] => {
    const rise = range.base - y + draw.within(-0.008, 0.008);
    return [x + draw.within(-0.02, 0.02), rise, rise * draw.within(1.1, 1.6)];
  });
  const mean = out.reduce((sum, p) => sum + p[1], 0) / Math.max(out.length, 1);
  const extra = 2 + Math.floor(draw() * 3);
  for (let i = 0; i < extra; i += 1) {
    const rise = mean * draw.within(0.25, 0.55);
    out.push([draw.within(range.x[0], range.x[1]), rise, rise * draw.within(1.2, 2)]);
  }
  return out;
}

/** Crest y across the plate for one range. */
function crestOf(range: RangeRecipe, seed: number, index: number): Float32Array {
  const peaks = peaksOf(range, seed, index);
  const out = new Float32Array(RIDGE_SAMPLES);
  const noise = hash(seed, 900 + index);
  for (let i = 0; i < RIDGE_SAMPLES; i += 1) {
    const u = i / (RIDGE_SAMPLES - 1);
    const taper = Math.min(1, Math.max(0, (u - range.x[0]) / 0.08), Math.max(0, (range.x[1] - u) / 0.08));
    let h = elevation(peaks, u) * taper * taper * (3 - 2 * taper);
    const broken = (noise1(noise, u * 26) - 0.5) * 0.014 + (noise1(noise + 1, u * 97) - 0.5) * 0.005;
    h += broken * range.rough * Math.min(1, h * 12);
    out[i] = h > 0.0005 ? range.base - h : range.base + 0.004;
  }
  return out;
}

const flat = (...values: readonly (number | Rgb)[]): Float32Array =>
  new Float32Array(values.flatMap((v) => (typeof v === "number" ? [v] : [...v])));

const strokeOf = (s: StrokeRecipe, aspect: number): number[] =>
  [s.angle, s.length * aspect, s.width * aspect, s.opacity];

/** The ranges' colours and depths as uniform arrays, padded to MAX_RANGES. */
function rangeUniforms(recipe: PlateRecipe, haze: number): PlanUniform[] {
  const lit = new Float32Array(MAX_RANGES * 3);
  const shade = new Float32Array(MAX_RANGES * 3);
  const info = new Float32Array(MAX_RANGES * 4);
  recipe.ranges.forEach((range, i) => {
    lit.set(rgb(range.lit), i * 3);
    shade.set(rgb(range.shade), i * 3);
    const depth = range.depth * haze;
    info.set([depth, range.base, 0.0012 + depth * 0.0011, 0.05], i * 4);
  });
  return [["uRangeLit", 3, lit], ["uRangeShade", 3, shade], ["uRangeInfo", 4, info],
    ["uRanges", 1, flat(recipe.ranges.length)]];
}

/** Every uniform the passes read. */
function uniformsOf(recipe: PlateRecipe, settings: Required<PlateSettings>): PlanUniform[] {
  const { sky, shore, water, ground, strokes } = recipe;
  const s = settings.seed;
  const off = flat((hash(s, 1) % 997) * 0.37, (hash(s, 2) % 991) * 0.41);
  const stroke = [strokes.sky, strokes.ridges, strokes.shore, strokes.water, strokes.ground];
  return [
    ["uAspect", 1, flat(recipe.aspect)], ["uSeedOff", 2, off],
    ["uHaze", 3, flat(rgb(recipe.haze))], ["uHazeStep", 1, flat(recipe.hazeStep)],
    ["uSkyTop", 3, flat(rgb(sky.top))], ["uSkyLow", 3, flat(rgb(sky.low))], ["uSkyCorner", 3, flat(rgb(sky.corner))],
    ["uCloudLit", 3, flat(rgb(sky.cloudLit))], ["uCloudShade", 3, flat(rgb(sky.cloudShade))],
    ["uCloud", 4, flat(sky.band[0], sky.band[1], sky.centre, sky.cover - settings.clouds * 0.4)],
    ...rangeUniforms(recipe, settings.haze),
    ["uShore", 4, flat(shore.top, shore.y, water.near, 0.6 * settings.haze)],
    ["uShoreCol", 3, flat(rgb(shore.color))], ["uShoreLit", 3, flat(rgb(shore.lit))],
    ["uWaterFar", 3, flat(rgb(water.far))], ["uWaterDeep", 3, flat(rgb(water.deep))],
    ["uSheen", 3, flat(rgb(water.sheen))],
    ["uGround", 3, flat(rgb(ground.color))], ["uGroundWarm", 3, flat(rgb(ground.warm))],
    ["uGroundDark", 3, flat(rgb(ground.dark))],
    ["uStroke", 4, new Float32Array(stroke.flatMap((k) => strokeOf(k, recipe.aspect)))],
    ["uFinish", 4, flat(recipe.weave * recipe.aspect, recipe.vignette, settings.haze, 0)],
  ];
}

/** Each glaze's gain, and its regions as a bit set over PLATE_REGIONS (0 for a slot with no glaze). */
export function glazeUniforms(glazes: readonly PlateGlaze[]): PlanUniform[] {
  const gain = new Float32Array(MAX_GLAZES);
  const mask = new Float32Array(MAX_GLAZES);
  glazes.forEach((g, i) => {
    gain[i] = g.gain;
    mask[i] = g.regions.reduce((bits, r) => bits | (1 << PLATE_REGIONS.indexOf(r)), 0);
  });
  return [["uGlazeGain", 4, gain], ["uGlazeMask", 4, mask]];
}

/** Throws on a recipe the painter cannot draw. */
function check(recipe: PlateRecipe, settings: Required<PlateSettings>): void {
  const fail = (why: string): never => {
    throw new RangeError(`plate-painter: ${why}`);
  };
  if (!(recipe.aspect > 0)) fail("aspect must be above 0.");
  if (recipe.ranges.length > MAX_RANGES) fail(`at most ${MAX_RANGES} ranges.`);
  if (!Number.isInteger(settings.seed) || settings.seed < 0) fail("seed must be a whole number from 0.");
  if (!(settings.haze >= 0 && settings.haze <= 2)) fail("haze must be within 0..2.");
  if (!(settings.clouds >= -0.5 && settings.clouds <= 0.5)) fail("clouds must be within -0.5..0.5.");
  if (!(recipe.shore.y < recipe.water.near)) fail("the water's near edge must be below the shore.");
}

/**
 * The plan for a recipe and settings: uniforms, crests and dabs, with their digest.
 *
 * @param base What the plate holds (LAKE_VALLEY, or one of your own).
 * @param settings The seed and the host's settings.
 * @param basis Fitted values for the recipe's fields and glazes, from `readPlateBasis` or built by hand.
 * @returns The plan; `paint` it with a painter from `createPlatePainter`.
 * @throws RangeError on a recipe, setting or glaze out of range.
 */
export function planPlate(base: PlateRecipe, settings: PlateSettings = {}, basis: PlateBasis = {}): PlatePlan {
  const full: Required<PlateSettings> = {
    seed: settings.seed ?? 0, haze: settings.haze ?? 1, clouds: settings.clouds ?? 0, foliage: settings.foliage ?? true,
  };
  const recipe = basis.params === undefined ? base : withParams(base, basis.params);
  check(recipe, full);
  const glazes = basis.glazes ?? [];
  if (glazes.length > MAX_GLAZES) throw new RangeError(`plate-painter: at most ${MAX_GLAZES} glazes.`);
  glazes.forEach(checkGlaze);
  const ridges = new Float32Array(RIDGE_SAMPLES * MAX_RANGES).fill(1);
  recipe.ranges.forEach((range, i) => {
    ridges.set(crestOf(range, full.seed, i), i * RIDGE_SAMPLES);
  });
  const uniforms = uniformsOf(recipe, full);
  const scene = packDabs(sceneDabs(recipe, full.seed));
  const foliage = packDabs(full.foliage ? foliageDabs(recipe, full.seed) : []);
  const names = new Float32Array(uniforms.map(([name]) => name.length));
  // A plan with no glaze keeps the digest it had before glazes existed.
  const layers = glazes.length === 0 ? [] : [...glazeUniforms(glazes).map(([, , v]) => v),
    ...glazes.map((g) => Float32Array.from(g.values))];
  const digest = digestOf([flat(PAINTER_VERSION), names, ...uniforms.map(([, , v]) => v), ridges, scene, foliage,
    ...layers]);
  return { digest, aspect: recipe.aspect, uniforms, ridges, scene, foliage, glazes };
}

/**
 * One look recipe for every keel/lit stage: the dithered pixel look or the lit,
 * full-colour realism look, picked and capped per target. MIT.
 *
 * The recipe is keel-engine core's `keel-look@1`, and `resolveLook` is its twin:
 * both are held to the same shared cases (test/look-cases.json, written by the
 * engine), so a game drawing meshes through keel/bake and a grove drawing a
 * keel/lit stage wear the same recipe the same way.
 *
 *   const look = resolveLook(recipe, LOOK_TARGETS.lit);
 *   const stage = stageOfLook(look);
 *   if (stage.dither) createVoxelDither(lit, renderer, stage.dither);   // the pixel look, or realism's grade
 *   renderer.toneMapping = stage.toneMapping ?? renderer.toneMapping;
 *   createTreeRender(lit, { ...stage.trees, model, frame });
 *   createForest(lit, { variants, places, maxLeaves: 1600 * stage.density });
 *   createPlantField({ detail: detail * stage.density, ... });
 *
 * The pixel look is voxel-dither's own settings (a style id and overrides, by
 * its names), so `stage.dither` goes straight to it, with the target's `limit`
 * beside them for voxel-dither to cap the style's levels and palette.
 *
 * Pure: no renderer, no globals.
 */

export const LOOK_RECIPE_FORMAT = "keel-look@1";

/** voxel-dither's screens, by its ids. */
export const LOOK_SCREENS = ["auto", "bayer2", "bayer4", "bayer8", "halftone", "lines", "diagonal", "hatch", "ign", "stipple", "checker", "none"] as const;
export type LookScreen = (typeof LOOK_SCREENS)[number];

/** The dithered look: a voxel-dither style and overrides, in its own names and ranges. */
export interface PixelLook {
  readonly style?: string;
  readonly screen?: LookScreen;
  readonly pixel?: number;
  readonly levels?: number;
  /** A small target keeps the first entries, so list them most needed first. */
  readonly palette?: readonly string[];
  readonly amount?: number;
  readonly shading?: "smooth" | "cel";
  readonly bands?: number;
  readonly outline?: number;
  readonly crease?: number;
  readonly contrast?: number;
  readonly saturation?: number;
}

/** The lit, full-colour look. */
export interface RealismLook {
  readonly exposure?: number;
  readonly tonemap?: "neutral" | "agx" | "aces";
  /** Ambient occlusion strength, 0 to 1. */
  readonly ao?: number;
  /** How much denser than the pixel look generators build, 1 to 4. */
  readonly density?: number;
  /** A pixel grade over the lit picture, or none. */
  readonly grade?: PixelLook | null;
}

export interface LookRecipe {
  readonly format: typeof LOOK_RECIPE_FORMAT;
  readonly pixel?: PixelLook;
  readonly realism?: RealismLook;
  readonly prefer?: "pixel" | "realism";
}

/** What a target can draw: whether it lights, its most colours (0: no limit) and its largest screen (0: any). */
export interface LookTarget {
  readonly lit: boolean;
  readonly paletteLimit: number;
  readonly screen: 0 | 2 | 4 | 8;
}

/** keel-engine core's targets, as lookTarget gives them (`lit` is native on a GPU that can light). */
export const LOOK_TARGETS: Readonly<Record<"lit" | "native" | "16-bit" | "8-bit" | "game-boy", LookTarget>> = {
  lit: { lit: true, paletteLimit: 0, screen: 0 },
  native: { lit: false, paletteLimit: 0, screen: 0 },
  "16-bit": { lit: false, paletteLimit: 256, screen: 4 },
  "8-bit": { lit: false, paletteLimit: 16, screen: 2 },
  "game-boy": { lit: false, paletteLimit: 4, screen: 2 },
};

export interface ResolvedRealism {
  readonly exposure: number;
  readonly tonemap: "neutral" | "agx" | "aces";
  readonly ao: number;
  readonly density: number;
  readonly grade: PixelLook | null;
}

export type ResolvedLook =
  | { readonly kind: "pixel"; readonly pixel: PixelLook; readonly limit: { readonly levels: number; readonly colours: number } }
  | { readonly kind: "realism"; readonly realism: ResolvedRealism };

export const REALISM_DEFAULTS = { exposure: 1, tonemap: "neutral", ao: 0.7, density: 2 } as const;

type Bag = Readonly<Record<string, unknown>>;
const PIXEL_KEYS = new Set(["style", "screen", "pixel", "levels", "palette", "amount", "shading", "bands", "outline", "crease", "contrast", "saturation"]);
const REALISM_KEYS = new Set(["exposure", "tonemap", "ao", "density", "grade"]);
const RECIPE_KEYS = new Set(["format", "pixel", "realism", "prefer"]);
const HEX = /^#[0-9a-f]{6}$/iu;
const SCREEN_SIZE: Readonly<Partial<Record<LookScreen, 2 | 4 | 8>>> = { bayer2: 2, bayer4: 4, bayer8: 8 };
const BAYER: Readonly<Record<2 | 4 | 8, LookScreen>> = { 2: "bayer2", 4: "bayer4", 8: "bayer8" };

function inRange(path: string, v: unknown, lo: number, hi: number): void {
  if (v === undefined) return;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${path} must be a number in ${String(lo)}..${String(hi)}`);
}
function onlyKeys(path: string, o: object, keys: ReadonlySet<string>): void {
  for (const k of Object.keys(o)) if (!keys.has(k)) throw new TypeError(`${path}.${k} is not a look field`);
}
function isPalette(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 32 && v.every((c) => typeof c === "string" && HEX.test(c));
}
function checkPixel(path: string, p: Bag): void {
  onlyKeys(path, p, PIXEL_KEYS);
  if (p.style !== undefined && typeof p.style !== "string") throw new TypeError(`${path}.style must be a style id`);
  if (p.screen !== undefined && !(LOOK_SCREENS as readonly unknown[]).includes(p.screen)) throw new RangeError(`${path}.screen is not a screen`);
  if (p.shading !== undefined && p.shading !== "smooth" && p.shading !== "cel") throw new RangeError(`${path}.shading must be smooth or cel`);
  if (p.palette !== undefined && !isPalette(p.palette)) throw new RangeError(`${path}.palette must be up to 32 #rrggbb colours`);
  const ranges: readonly (readonly [string, number, number])[] = [
    ["pixel", 0, 12], ["levels", 2, 16], ["amount", 0, 1], ["bands", 2, 8], ["outline", 0, 1], ["crease", 0, 1], ["contrast", 0.5, 2], ["saturation", 0, 2],
  ];
  for (const [key, lo, hi] of ranges) inRange(`${path}.${key}`, p[key], lo, hi);
}

/**
 * Throws on anything that isn't a keel-look@1 recipe.
 *
 * @param recipe Untrusted input.
 * @returns The same recipe.
 */
export function checkLookRecipe(recipe: unknown): LookRecipe {
  if (recipe === null || typeof recipe !== "object" || (recipe as Bag).format !== LOOK_RECIPE_FORMAT) throw new TypeError(`A look recipe is { format: "${LOOK_RECIPE_FORMAT}", ... }`);
  const r = recipe as Bag;
  onlyKeys("look", r, RECIPE_KEYS);
  if (r.prefer !== undefined && r.prefer !== "pixel" && r.prefer !== "realism") throw new RangeError("look.prefer must be pixel or realism");
  if (r.pixel !== undefined) checkPixel("look.pixel", r.pixel as Bag);
  const real = r.realism as Bag | undefined;
  if (real !== undefined) {
    onlyKeys("look.realism", real, REALISM_KEYS);
    inRange("look.realism.exposure", real.exposure, 0, 16);
    inRange("look.realism.ao", real.ao, 0, 1);
    inRange("look.realism.density", real.density, 1, 4);
    if (real.tonemap !== undefined && !["neutral", "agx", "aces"].includes(real.tonemap as string)) throw new RangeError("look.realism.tonemap must be neutral, agx or aces");
    if (real.grade) checkPixel("look.realism.grade", real.grade as Bag);
  }
  return recipe as LookRecipe;
}

/**
 * The most tone steps per channel a target holds: levels cubed colours at most, under its palette limit.
 *
 * @param t The target.
 * @returns Tone steps, or 0 for no limit.
 */
export function maxLevels(t: LookTarget): number {
  return t.paletteLimit ? Math.max(2, Math.floor(Math.cbrt(t.paletteLimit))) : 0;
}

function capPixel(p: PixelLook, t: LookTarget): PixelLook {
  let out: { -readonly [K in keyof PixelLook]: PixelLook[K] } = { ...p };
  if (t.paletteLimit) {
    if (out.palette && out.palette.length > t.paletteLimit) out.palette = out.palette.slice(0, t.paletteLimit);
    if (out.levels !== undefined) out.levels = Math.min(out.levels, maxLevels(t));
  }
  if (t.screen) {
    const size = out.screen ? SCREEN_SIZE[out.screen] : undefined;
    if (size === undefined || size > t.screen) out = { ...out, screen: BAYER[t.screen] };
  }
  return out;
}

/**
 * The look a target draws from a recipe: realism where the target lights and the recipe prefers it (or has nothing
 * else), otherwise the pixel look narrowed to the target.
 *
 * @param recipe A keel-look@1 recipe.
 * @param target What the target can draw.
 * @returns The look, with every realism field settled, or the pixel look and the target's limits.
 */
export function resolveLook(recipe: LookRecipe, target: LookTarget): ResolvedLook {
  checkLookRecipe(recipe);
  const real = recipe.realism;
  if (real !== undefined && (recipe.prefer === "realism" || recipe.pixel === undefined) && target.lit) {
    return {
      kind: "realism",
      realism: {
        exposure: real.exposure ?? REALISM_DEFAULTS.exposure,
        tonemap: real.tonemap ?? REALISM_DEFAULTS.tonemap,
        ao: real.ao ?? REALISM_DEFAULTS.ao,
        density: real.density ?? REALISM_DEFAULTS.density,
        grade: real.grade ?? null,
      },
    };
  }
  const limit = { levels: maxLevels(target), colours: target.paletteLimit };
  return { kind: "pixel", pixel: capPixel(recipe.pixel ?? {}, target), limit };
}

/**
 * tree-render's options for one tree (`createTreeRender`): realism draws real blades and bark, without the looks made
 * for a few pixels per leaf. The pixel look leaves the host's own.
 */
export interface TreeLook {
  readonly form?: "smooth";
  readonly features?: { readonly sprays: false; readonly clumps: false; readonly rootSink: false };
}

/** How a keel/lit stage draws a resolved look. */
export interface LitStageLook {
  readonly kind: "pixel" | "realism";
  /** voxel-dither's input (the pixel look, or realism's grade), or null to draw the lit picture straight. */
  readonly dither: (PixelLook & { readonly limit?: { readonly levels: number; readonly colours: number } }) | null;
  /** keel/lit's tone mapping, or null to keep the host's. */
  readonly toneMapping: "neutral" | "agx" | "aces-filmic" | null;
  readonly exposure: number;
  /** Ambient occlusion strength for a post that draws it (0 off). */
  readonly ao: number;
  /** Multiplies the generators' detail (plant fields, a forest's baked leaves, ground cover). */
  readonly density: number;
  readonly trees: TreeLook;
}

const TONE: Readonly<Record<ResolvedRealism["tonemap"], LitStageLook["toneMapping"]>> = { neutral: "neutral", agx: "agx", aces: "aces-filmic" };

/**
 * What a keel/lit stage sets for a resolved look.
 *
 * @param look From resolveLook.
 * @returns The dither input, tone mapping, exposure, AO, density and tree switches.
 */
export function stageOfLook(look: ResolvedLook): LitStageLook {
  if (look.kind === "pixel") {
    const capped = look.limit.levels || look.limit.colours ? { ...look.pixel, limit: look.limit } : look.pixel;
    return { kind: "pixel", dither: capped, toneMapping: null, exposure: 1, ao: 0, density: 1, trees: {} };
  }
  const r = look.realism;
  return {
    kind: "realism", dither: r.grade, toneMapping: TONE[r.tonemap], exposure: r.exposure, ao: r.ao, density: r.density,
    trees: { form: "smooth", features: { sprays: false, clumps: false, rootSink: false } },
  };
}

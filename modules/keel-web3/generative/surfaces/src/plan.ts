// A recipe and a seed into the numbers both paths paint from: one array of 232 floats, laid out per kind as the
// shaders read it (four to a vec4), and a digest of all of it.
import { digestOf, draws, hash, turn } from "./exact.js";
import {
  PLANNED, type Axis, type KnitRecipe, type Mass, type PaintedRecipe, type PaperRecipe, type PlannedRecipe,
  type SurfaceRecipe,
} from "./recipe.js";

/** Moves whenever the painters would paint the same plan differently, so a stored surface is not reused wrongly. */
export const PAINTER_VERSION = 1;
/** The most masses a painted ground holds. */
export const MAX_MASSES = 10;
/** Floats in a plan's uniforms. */
export const UNIFORMS = 232;
/** Each kind's number, as the digest and the shaders know it. */
export const KINDS = { paper: 0, knit: 1, painted: 2 } as const;

/** The size and seed to paint at. */
export interface SurfaceSettings {
  /** A whole number from 0. Default 0. */
  readonly seed?: number;
  /** Pixels, 1..4096. Default 1024; the height defaults to the width. */
  readonly width?: number;
  readonly height?: number;
}

/** Everything a painter needs, worked out in exact arithmetic. */
export interface SurfacePlan {
  readonly kind: SurfaceRecipe["kind"];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly uniforms: Float32Array;
  /** Covers the uniforms, the kind, the size, the depth and `PAINTER_VERSION`. */
  readonly digest: string;
}

function check(value: unknown, name: string, low: number, high: number): number {
  if (typeof value !== "number" || !(value >= low && value <= high)) {
    throw new RangeError(`surfaces: ${name} must be within ${low}..${high}.`);
  }
  return value;
}

function whole(value: unknown, name: string, low: number, high: number): number {
  if (!Number.isInteger(value)) throw new RangeError(`surfaces: ${name} must be a whole number within ${low}..${high}.`);
  return check(value, name, low, high);
}

function put(out: Float32Array, at: number, values: readonly number[]): void {
  out.set(values, at);
}

function colour(value: unknown): number[] {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new TypeError(`surfaces: ${JSON.stringify(value)} is not #rrggbb.`);
  }
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function axis(value: Axis, name: string, t = 0): [number, number] {
  const [x, y] = [check(value[0], name, -64, 64), check(value[1], name, -64, 64)];
  if (x === 0 && y === 0) throw new RangeError(`surfaces: ${name} must not be [0, 0].`);
  return turn(x, y, t);
}

function paper(r: PaperRecipe, u: Float32Array): void {
  put(u, 0, colour(r.tone));
  put(u, 4, [...colour(r.fleck), check(r.flecks, "flecks", 0, 1)]);
  put(u, 8, [...colour(r.stain), check(r.stains, "stains", 0, 1)]);
  put(u, 12, [whole(r.cells, "cells", 4, 512), check(r.fibres, "fibres", 0, 1),
    check(r.mottle, "mottle", 0, 1), whole(r.mottleScale, "mottleScale", 1, 64)]);
  put(u, 16, [whole(r.laid, "laid", 0, 512), whole(r.chain, "chain", 0, 64), check(r.lines, "lines", 0, 1)]);
}

function knit(r: KnitRecipe, u: Float32Array): void {
  put(u, 0, colour(r.base));
  put(u, 4, [...colour(r.shadow), whole(r.ribs, "ribs", 1, 256)]);
  put(u, 8, [...colour(r.light), whole(r.courses, "courses", 1, 256)]);
  put(u, 12, [check(r.knit, "knit", 0.3, 0.9), check(r.twist, "twist", 0, 8), check(r.fuzz, "fuzz", 0, 1),
    check(r.jitter, "jitter", 0, 1)]);
}

function mass(m: Mass, u: Float32Array, at: number, place: { aspect: number; seed: number; jitter: number }): void {
  const draw = draws(place.seed, 100 + at);
  const [x, y] = [check(m.at[0], "mass at", -0.5, 1.5), check(m.at[1], "mass at", -0.5, 1.5)];
  const j = place.jitter;
  put(u, at, [(x + draw(-j, j)) * place.aspect, y + draw(-j, j), check(m.size[0], "mass size", 0.005, 2),
    check(m.size[1], "mass size", 0.005, 2)]);
  put(u, at + 4, [...axis(m.axis, "mass axis", draw(-j, j) * 4), check(m.soft, "soft", 0.01, 1), m.ring === true ? 1 : 0]);
  put(u, at + 8, [...colour(m.colour), check(m.warp, "warp", 0, 2)]);
  put(u, at + 12, [...colour(m.light), check(m.streak, "streak", 0, 1)]);
  u[at + 16] = check(m.point ?? 0, "point", 0, 1);
}

function painted(r: PaintedRecipe, u: Float32Array, size: { aspect: number; seed: number }): void {
  if (r.masses.length > MAX_MASSES) throw new RangeError(`surfaces: at most ${MAX_MASSES} masses.`);
  put(u, 0, colour(r.ground));
  put(u, 4, [...colour(r.glaze), check(r.glazeAmount, "glazeAmount", 0, 1)]);
  put(u, 8, [...axis(r.brush.axis, "brush axis"), check(r.brush.length, "brush length", 1, 64),
    check(r.brush.amount, "brush amount", 0, 1)]);
  put(u, 12, [size.aspect, r.masses.length, check(r.variation, "variation", 0, 1)]);
  const f = r.folds;
  if (f) {
    put(u, 16, [...colour(f.deep), check(f.count, "fold count", 0.5, 16)]);
    put(u, 20, [...colour(f.mid), check(f.warp, "fold warp", 0, 2)]);
    put(u, 24, [...colour(f.light), check(f.sheen, "sheen", 0, 1)]);
    put(u, 28, axis(f.axis, "fold axis"));
  }
  const place = { ...size, jitter: check(r.jitter, "jitter", 0, 0.2) };
  r.masses.forEach((m, i) => {
    mass(m, u, 32 + i * 20, place);
  });
}

const isBuilt = (recipe: SurfaceRecipe | PlannedRecipe): recipe is SurfaceRecipe => recipe.kind in KINDS;

/**
 * Plans a surface: validates the recipe and settings and works out every number the painters read.
 *
 * @param recipe What the surface holds.
 * @param settings The seed and the size in pixels.
 * @returns The plan, with its digest.
 */
export function planSurface(recipe: SurfaceRecipe | PlannedRecipe, settings: SurfaceSettings = {}): SurfacePlan {
  const kind: string = recipe.kind;
  if ((PLANNED as readonly string[]).includes(kind)) throw new RangeError(`surfaces: ${kind} is planned, not built yet.`);
  if (!isBuilt(recipe)) throw new RangeError(`surfaces: no painter for ${JSON.stringify(kind)}.`);
  const seed = whole(settings.seed ?? 0, "seed", 0, 2147483647);
  const width = whole(settings.width ?? 1024, "width", 1, 4096);
  const height = whole(settings.height ?? width, "height", 1, 4096);
  const depth = check(recipe.depth, "depth", 0, 4);
  const uniforms = new Float32Array(UNIFORMS);
  uniforms[3] = hash(seed, KINDS[recipe.kind]) >>> 12;
  if (recipe.kind === "paper") paper(recipe, uniforms);
  else if (recipe.kind === "knit") knit(recipe, uniforms);
  else painted(recipe, uniforms, { aspect: width / height, seed });
  const head = Float32Array.of(KINDS[recipe.kind], width, height, depth, PAINTER_VERSION);
  return { kind: recipe.kind, width, height, depth, uniforms, digest: digestOf([uniforms, head]) };
}

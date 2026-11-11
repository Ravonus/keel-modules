// The painter's passes as strokes. One stroke per jittered cell, the jitter from the exact hash; a stroke is traced
// along its pass's flow (the region's axis, the isophotes of the light, or the line guide) and stops at an id border
// unless the pass may cross. Colour comes from a ramp of the light, dark masses first.
import { colourRule, rampColour, type ColourRule, type Rgb } from "./colour.js";
import { clamp, hash32, unit } from "./exact.js";
import { axisOf, principal, type Guides, type IdStats } from "./guide.js";
import { fieldAt, type LayerGuides } from "./layer.js";
import type { Follow, Medium, PassRecipe, Tip } from "./recipe.js";
import { warpPoint, type Warp } from "./warp.js";

/** A stroke as render/brush takes it: path in canvas pixels, size half the tip's width. */
export interface PlannedStroke {
  readonly path: readonly (readonly [number, number])[];
  readonly tip: Tip;
  readonly size: number;
  readonly colour: Rgb;
  readonly opacity: number;
  readonly medium: Medium;
  readonly load: number;
  readonly wet: number;
  readonly height: number;
  readonly taper: readonly [number, number];
  readonly bristles: number;
  readonly seed: number;
}

/** Where a layer's canvas sits on the guides: its box in guide pixels, its size, and canvas pixels a guide pixel. */
export interface LayerFrame {
  readonly box: readonly [number, number, number, number];
  readonly res: readonly [number, number];
  readonly scale: number;
}

export interface PassContext {
  readonly guides: Guides;
  readonly stats: IdStats;
  readonly warp: Warp;
  readonly frame: LayerFrame;
  /** The guides under the canvas, through the warp. */
  readonly layer: LayerGuides;
  /** The ids the pass may paint, a flag an index. */
  readonly flags: Uint8Array;
  /** Layer pixels the pass may reach past those ids. */
  readonly grow: number;
  /** A spot the pass keeps to, in guide pixels (x, y, radius), or null. */
  readonly spot: readonly [number, number, number] | null;
  /** The light guide's bytes that map to 0 and 1 for this layer. */
  readonly levels: readonly [number, number];
  readonly seed: number;
  readonly palettes: Readonly<Record<string, readonly string[]>>;
}

interface Resolved {
  readonly kind: string;
  readonly brush: Tip;
  readonly medium: Medium;
  readonly size: readonly [number, number];
  readonly colour: ColourRule;
  readonly opacity: number;
  readonly wet: number;
  readonly load: number;
  readonly height: number;
  readonly taper: readonly [number, number];
  readonly length: number;
  readonly spacing: number;
  readonly follow: Follow;
  readonly threshold: number;
  readonly cross: boolean;
  readonly jitter: number;
  readonly bristles: number;
}

type Defaults = Omit<Resolved, "kind" | "colour" | "cross" | "bristles">;

/** Each pass's defaults; a recipe's fields override them. */
export const PASS_DEFAULTS: Readonly<Record<string, Defaults>> = {
  "block-in": { brush: "flat", medium: "oil", size: [0.05, 0.09], opacity: 0.95, wet: 0.15, load: 1, height: 0.25,
    taper: [0.9, 0.7], length: 2, spacing: 0.9, follow: "axis", threshold: 0, jitter: 0.5 },
  form: { brush: "filbert", medium: "oil", size: [0.012, 0.03], opacity: 0.85, wet: 0.6, load: 0.9, height: 0.35,
    taper: [0.5, 0.3], length: 3, spacing: 1, follow: "form", threshold: 0, jitter: 0.6 },
  detail: { brush: "round", medium: "oil", size: [0.002, 0.005], opacity: 0.9, wet: 0.25, load: 0.8, height: 0.15,
    taper: [0.3, 0.2], length: 4, spacing: 1.4, follow: "line", threshold: 0.35, jitter: 0.4 },
  accent: { brush: "round", medium: "scumble", size: [0.004, 0.01], opacity: 0.8, wet: 0, load: 0.6, height: 0.5,
    taper: [0.4, 0.4], length: 2, spacing: 1.6, follow: "form", threshold: 0.8, jitter: 0.3 },
  blend: { brush: "filbert", medium: "oil", size: [0.02, 0.04], opacity: 0.5, wet: 1, load: 0.5, height: 0,
    taper: [0.6, 0.6], length: 2.5, spacing: 1, follow: "form", threshold: 0, jitter: 0 },
};

/** Passes that lay dark masses before light ones. */
const DARK_FIRST = new Set(["block-in", "form"]);
/** The most cells one pass looks at; a finer pass gets larger cells. */
export const MAX_CELLS = 12000;

/** A pass's fields over its defaults, colour read. */
export function resolvePass(pass: PassRecipe, palettes: PassContext["palettes"]): Resolved {
  const base = PASS_DEFAULTS[pass.pass];
  if (!base) throw new TypeError(`painting: no pass "${pass.pass}".`);
  const colour = pass.colour ?? (pass.pass === "blend" ? "under" : undefined);
  if (colour === undefined) throw new TypeError(`painting: the ${pass.pass} pass needs a colour.`);
  const skip = new Set(["select", "palette", "pass", "colour"]);
  const fields = Object.fromEntries(Object.entries(pass).filter(([k]) => !skip.has(k))) as Partial<Resolved>;
  return {
    ...base, ...fields, kind: pass.pass, colour: colourRule(colour, palettes), cross: pass.cross ?? false,
    bristles: pass.bristles ?? 7,
  };
}

/** Canvas pixels to guide pixels. */
export const toGuide = (f: LayerFrame, q: readonly [number, number]): [number, number] =>
  [f.box[0] + q[0] / f.scale, f.box[1] + q[1] / f.scale];

/**
 * The flow across a field at a canvas point: the leading direction of its structure tensor (gradients at four points
 * `r` canvas pixels apart), turned a quarter so it runs along the isophote. Null where the field is flat.
 */
export function tensorFlow(
  lg: LayerGuides, field: Uint8Array, q: readonly [number, number], r: number,
): [number, number] | null {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const [ox, oy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) {
    const x = q[0] + ox * r;
    const y = q[1] + oy * r;
    const gx = fieldAt(lg, field, x + r, y) - fieldAt(lg, field, x - r, y);
    const gy = fieldAt(lg, field, x, y + r) - fieldAt(lg, field, x, y - r);
    a += gx * gx;
    b += gx * gy;
    c += gy * gy;
  }
  if (a + c < 64) return null;
  const g = principal(a, b, c);
  return [-g[1], g[0]];
}

function flowAt(ctx: PassContext, follow: Follow, q: readonly [number, number], id: number): [number, number] {
  const lg = ctx.layer;
  const r = Math.max(2 * lg.step, 6 * ctx.frame.scale);
  const line = follow === "line" && lg.line ? tensorFlow(lg, lg.line, q, r) : null;
  const form = follow !== "axis" ? tensorFlow(lg, lg.light, q, r * 2) : null;
  return line ?? form ?? axisOf(ctx.stats, id);
}

const AROUND = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Whether a canvas point lies in the pass's spot: on the guides, so the spot moves with the warp as the ids do. */
function inSpot(ctx: PassContext, q: readonly [number, number]): boolean {
  const [x, y, r] = ctx.spot ?? [0, 0, 0];
  const p = toGuide(ctx.frame, q);
  const g = warpPoint(ctx.warp, p[0], p[1]);
  return (g[0] - x) * (g[0] - x) + (g[1] - y) * (g[1] - y) <= r * r;
}

/** Whether a canvas point lies on an id the pass may paint, or within its grow of one. */
function inside(ctx: PassContext, q: readonly [number, number]): boolean {
  if (ctx.spot && !inSpot(ctx, q)) return false;
  const reach = ctx.grow > 0 ? AROUND : AROUND.slice(0, 1);
  const { layer, grow } = ctx;
  return reach.some(([x, y]) => ctx.flags[fieldAt(layer, layer.id, q[0] + x * grow, q[1] + y * grow)] === 1);
}

/** The next direction: the flow, signed to go on, and halved toward the last where it would turn more than ~40°. */
function turn(d: readonly [number, number], flow: readonly [number, number]): [number, number] {
  const dot = flow[0] * d[0] + flow[1] * d[1];
  const f: [number, number] = dot < 0 ? [-flow[0], -flow[1]] : [flow[0], flow[1]];
  if (Math.abs(dot) >= 0.77) return f;
  const m: [number, number] = [d[0] + f[0], d[1] + f[1]];
  const len = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
  return len > 1e-6 ? [m[0] / len, m[1] / len] : [d[0], d[1]];
}

/** A path of up to eight points through `q`, along the flow, stopped at id borders unless the pass crosses. */
export function trace(ctx: PassContext, r: Resolved, q: readonly [number, number], width: number): [number, number][] {
  const n = clamp(Math.round(r.length / 1.5) + 2, 2, 8);
  const step = (r.length * width) / (n - 1);
  const id = fieldAt(ctx.layer, ctx.layer.id, q[0], q[1]);
  const ahead = Math.floor((n - 1) / 2);
  const walk = (sign: number, steps: number): [number, number][] => {
    const out: [number, number][] = [];
    let at: [number, number] = [q[0], q[1]];
    let d = flowAt(ctx, r.follow, at, id);
    d = [d[0] * sign, d[1] * sign];
    for (let k = 0; k < steps; k += 1) {
      const next: [number, number] = [at[0] + d[0] * step, at[1] + d[1] * step];
      if (!r.cross && !inside(ctx, next)) break;
      out.push(next);
      d = turn(d, flowAt(ctx, r.follow, next, id));
      at = next;
    }
    return out;
  };
  const path = [...walk(-1, n - 1 - ahead).reverse(), [q[0], q[1]] as [number, number], ...walk(1, ahead)];
  if (path.length >= 2) return path;
  const d = flowAt(ctx, r.follow, q, id);
  const nudge = Math.max(step * 0.3, 1);
  return [[q[0], q[1]], [q[0] + d[0] * nudge, q[1] + d[1] * nudge]];
}

/**
 * The light at a canvas point as a painter sees it, 0..1 between the layer's levels: the guide holds linear light,
 * and its square root is close to what the eye reads as lightness.
 */
function lightAt(ctx: PassContext, q: readonly [number, number]): number {
  const [lo, hi] = ctx.levels;
  return Math.sqrt(clamp((fieldAt(ctx.layer, ctx.layer.light, q[0], q[1]) - lo) / Math.max(hi - lo, 1), 0, 1));
}

/** Whether a pass lays a stroke at a guide point, by its threshold. */
function placed(ctx: PassContext, r: Resolved, p: readonly [number, number], value: number): boolean {
  if (r.threshold <= 0) return true;
  if (r.kind === "accent") return value >= r.threshold;
  if (r.kind === "detail" && ctx.layer.line) return fieldAt(ctx.layer, ctx.layer.line, p[0], p[1]) >= r.threshold * 255;
  return true;
}

function colourOf(r: Resolved, value: number, h: number): [Rgb, number] {
  if (r.colour.kind === "flat") return [r.colour.rgb, 0];
  if (r.colour.kind === "under") return [[0, 0, 0], 0];
  return rampColour(r.colour, value, (unit(h) - 0.5) * r.jitter);
}

interface Candidate {
  readonly stroke: PlannedStroke;
  readonly bucket: number;
}

function candidate(
  ctx: PassContext, r: Resolved, cell: readonly [number, number, number], key: number,
): Candidate | null {
  const [i, j, size] = cell;
  const h = hash32(ctx.seed, key, j * 65536 + i);
  const q: [number, number] = [(i + 0.15 + 0.7 * unit(h)) * size, (j + 0.15 + 0.7 * unit(hash32(h, 1, 0))) * size];
  if (!inside(ctx, q)) return null;
  const value = lightAt(ctx, q);
  if (!placed(ctx, r, q, value)) return null;
  const res = ctx.frame.res[1];
  const width = (r.size[0] + (r.size[1] - r.size[0]) * unit(hash32(h, 2, 0))) * res;
  const [colour, bucket] = colourOf(r, value, hash32(h, 3, 0));
  const under = r.colour.kind === "under";
  const stroke: PlannedStroke = {
    path: trace(ctx, r, q, width), tip: r.brush, size: width / 2, colour, opacity: r.opacity, medium: r.medium,
    load: r.load, wet: under ? 2 : r.wet, height: r.height, taper: r.taper, bristles: r.bristles, seed: h & 4095,
  };
  return { stroke, bucket };
}

/**
 * A pass's strokes, in painting order.
 *
 * @param key Seeds this pass apart from the others.
 */
export function planStrokes(ctx: PassContext, pass: PassRecipe, key: number): PlannedStroke[] {
  const r = resolvePass(pass, ctx.palettes);
  const [w, h] = ctx.frame.res;
  const mid = ((r.size[0] + r.size[1]) / 2) * h;
  const size = Math.max(mid * r.spacing, Math.sqrt((w * h) / MAX_CELLS), 1);
  const out: Candidate[] = [];
  for (let j = 0; j * size < h; j += 1) {
    for (let i = 0; i * size < w; i += 1) {
      const c = candidate(ctx, r, [i, j, size], key);
      if (c) out.push(c);
    }
  }
  if (DARK_FIRST.has(r.kind)) out.sort((a, b) => a.bucket - b.bucket);
  return out.map((c) => c.stroke);
}

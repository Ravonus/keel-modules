// A figure becomes a plan: for each painted layer, a grid in the figure's plane lifted toward the viewer by its depth
// guide, the cells that hold paint, and what its shape keys and bones do to each vertex. Plus, minus, times, divide and
// the square root only, so the same figure gives the same plan, to the bit, on every engine.

import { clamp, digestOf } from "./exact.js";
import type { Param } from "./params.js";

/** A point in the figure's plane, figure units. */
export type Vec2 = readonly [number, number];

/**
 * An 8-bit image read on the CPU: an alpha matte or a depth guide, top row first, as an image is stored. `stride` is
 * the bytes a pixel (1, or 4 for an RGBA read-back) and `channel` the one read (default 0, or 3 for an RGBA alpha).
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
  readonly stride?: number;
  readonly channel?: number;
}

/** One painted state of a layer: where it has paint, how near each part is (255 nearest), and its named points. */
export interface LayerState {
  readonly alpha: Grid;
  readonly depth?: Grid;
  readonly anchors?: Readonly<Record<string, Vec2>>;
}

/** Moves the vertices within `radius` of `at` by up to `move`, falling off as (1 − (d/r)²)². */
export interface Move {
  readonly at: Vec2;
  readonly move: Vec2;
  readonly radius: number;
}

/** A shape key: moves at full weight, blended in by a parameter. */
export interface ShapeKey {
  readonly param: string;
  readonly moves: readonly Move[];
}

/** A 2D bone: turns what it holds about `at` by its parameter, in degrees, counter-clockwise. */
export interface Bone {
  readonly name: string;
  readonly at: Vec2;
  readonly param: string;
  /** Its parent: the child turns first, then the parent turns the result. */
  readonly parent?: string;
}

/** Where a bone holds a layer: inside a capsule, weight 1, falling to 0 over `feather`. */
export interface Reach {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly radius: number;
  readonly feather: number;
}

/** A layer held by a bone: all of it, or within a reach. `rest` is the bone's angle each state was painted at. */
export interface Bind {
  readonly bone: string;
  readonly reach?: Reach;
  readonly rest?: readonly number[];
}

/** A painted layer: a rectangle of the figure's plane at a depth, with what moves it. */
export interface LayerSpec {
  readonly name: string;
  /** `[left, bottom, width, height]`, figure units. */
  readonly rect: readonly [number, number, number, number];
  /** Its depth toward the viewer, figure units. */
  readonly z: number;
  /** The layer it lies on: it rides that layer's relief, and its `z` stays within `GAP_LIMIT` of that layer's. */
  readonly on?: string;
  /** How far the depth guide lifts it toward the viewer at 255, up to `RELIEF_LIMIT`. */
  readonly relief?: number;
  /** Grid cells across and up. Default 32 × 40. */
  readonly grid?: readonly [number, number];
  /** One painted state, or two crossed by `dissolve`. */
  readonly states: readonly LayerState[];
  readonly dissolve?: { readonly param: string; readonly window?: readonly [number, number] };
  readonly keys?: readonly ShapeKey[];
  readonly bind?: readonly Bind[];
  /** Slides the paint inside its own matte by two parameters, in shares of the layer, up to `max`. */
  readonly slide?: { readonly param: readonly [string, string]; readonly max: readonly [number, number] };
  /**
   * A layer whose matte at rest (its first state's alpha) this one shows only inside: itself, so a shape key cannot
   * carry paint out of where it was painted (a lid into the brow), or an earlier layer.
   */
  readonly clip?: string;
  /** A parameter for its opacity, 0 to 1. */
  readonly opacity?: string;
}

/** A painted, rigged figure: parameters, bones and layers, back to front. */
export interface Figure {
  readonly params: readonly Param[];
  readonly bones?: readonly Bone[];
  readonly layers: readonly LayerSpec[];
}

/** The most a depth guide may lift a layer: deeper relief tears at the silhouette under parallax. */
export const RELIEF_LIMIT = 0.06;
/** The most a layer may stand off the layer it lies on. */
export const GAP_LIMIT = 0.05;
const MAX_CELLS = 128;

/** One state's mesh: rest positions (x, y, z), texture coordinates, the lift over `z`, and the cells with paint. */
export interface Sheet {
  readonly rest: Float32Array;
  readonly uv: Float32Array;
  readonly lift: Float32Array;
  readonly index: Uint16Array;
}

/** A bind with its weights, a vertex at a time, and how deep its bone sits (children deform first). */
export interface BindPlan {
  readonly bone: Bone;
  readonly weight: Float32Array;
  readonly rest: readonly number[];
  readonly reach: Reach | undefined;
  readonly depth: number;
}

/** A layer's plan. Keys and binds are a vertex at a time and the same for every state: they share one grid. */
export interface LayerPlan {
  readonly spec: LayerSpec;
  readonly cols: number;
  readonly rows: number;
  readonly sheets: readonly Sheet[];
  readonly keys: readonly Float32Array[];
  readonly binds: readonly BindPlan[];
}

/** The whole figure's plan, and a digest of every number in it. */
export interface FigurePlan {
  readonly figure: Figure;
  readonly layers: readonly LayerPlan[];
  readonly digest: number;
}

/** A grid's value at `u` across and `v` up, 0 to 1, bilinear. */
export function sampleGrid(g: Grid, u: number, v: number): number {
  const [x, y] = [clamp(u, 0, 1) * (g.width - 1), (1 - clamp(v, 0, 1)) * (g.height - 1)];
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [x1, y1] = [Math.min(x0 + 1, g.width - 1), Math.min(y0 + 1, g.height - 1)];
  const [fx, fy] = [x - x0, y - y0];
  const at = (px: number, py: number): number => g.data[(py * g.width + px) * (g.stride ?? 1) + (g.channel ?? 0)] ?? 0;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return (top + (bottom - top) * fy) / 255;
}

/** Whether any pixel of a matte under a cell (and one pixel round it) has paint. */
function cellHasPaint(g: Grid, box: readonly [number, number, number, number]): boolean {
  const [u0, v0, u1, v1] = box;
  const [w, h] = [g.width - 1, g.height - 1];
  const [x0, x1] = [Math.max(0, Math.floor(u0 * w) - 1), Math.min(w, Math.ceil(u1 * w) + 1)];
  const [y0, y1] = [Math.max(0, Math.floor((1 - v1) * h) - 1), Math.min(h, Math.ceil((1 - v0) * h) + 1)];
  const [stride, channel] = [g.stride ?? 1, g.channel ?? 0];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) if ((g.data[(y * g.width + x) * stride + channel] ?? 0) > 0) return true;
  }
  return false;
}

/** The cells with paint in any of `mattes`, as two triangles each, counter-clockwise seen from the viewer. */
function cellsOf(mattes: readonly Grid[], cols: number, rows: number): Uint16Array {
  const out: number[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const box = [i / cols, j / rows, (i + 1) / cols, (j + 1) / rows] as const;
      if (!mattes.some((g) => cellHasPaint(g, box))) continue;
      const a = j * (cols + 1) + i;
      out.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1);
    }
  }
  return Uint16Array.from(out);
}

/**
 * Each vertex's lift from the depth guide, weighted by the matte so a silhouette takes the depth inside it. Vertices
 * with no paint near take the mean of their neighbours', grown out a ring at a time, so the edge is an alpha edge and
 * not a cliff.
 */
function reliefOf(state: LayerState, cols: number, rows: number, relief: number): Float32Array {
  const n = (cols + 1) * (rows + 1);
  const out = new Float32Array(n);
  const known = new Uint8Array(n);
  const depth = state.depth;
  if (depth === undefined || relief === 0) return out;
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const [u, v] = [i / cols, j / rows];
      const a = sampleGrid(state.alpha, u, v);
      if (a <= 0) continue;
      out[j * (cols + 1) + i] = sampleGrid(depth, u, v) * relief;
      known[j * (cols + 1) + i] = 1;
    }
  }
  for (let ring = 0; ring < 8 && grow(out, known, cols, rows); ring += 1);
  return out;
}

/** One ring of growth: each unknown vertex beside a known one takes their mean. Returns whether any was filled. */
function grow(lift: Float32Array, known: Uint8Array, cols: number, rows: number): boolean {
  const filled: number[] = [];
  for (let k = 0; k < lift.length; k += 1) {
    if (known[k] === 1) continue;
    const [i, j] = [k % (cols + 1), Math.floor(k / (cols + 1))];
    const near = [i > 0 ? k - 1 : -1, i < cols ? k + 1 : -1, j > 0 ? k - cols - 1 : -1, j < rows ? k + cols + 1 : -1]
      .filter((m) => m >= 0 && known[m] === 1);
    if (near.length > 0) filled.push(k, near.reduce((sum, m) => sum + (lift[m] ?? 0), 0) / near.length);
  }
  for (let f = 0; f < filled.length; f += 2) {
    lift[filled[f] ?? 0] = filled[f + 1] ?? 0;
    known[filled[f] ?? 0] = 1;
  }
  return filled.length > 0;
}

/** A plan's lift at a point of the figure's plane, bilinear over its grid, held at its edges. */
export function liftAt(plan: LayerPlan, sheet: Sheet, p: Vec2): number {
  const [left, bottom, width, height] = plan.spec.rect;
  const x = clamp((p[0] - left) / width, 0, 1) * plan.cols;
  const y = clamp((p[1] - bottom) / height, 0, 1) * plan.rows;
  const [i, j] = [Math.min(Math.floor(x), plan.cols - 1), Math.min(Math.floor(y), plan.rows - 1)];
  const [fx, fy] = [x - i, y - j];
  const at = (di: number, dj: number): number => sheet.lift[(j + dj) * (plan.cols + 1) + i + di] ?? 0;
  const low = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
  const high = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
  return low + (high - low) * fy;
}

/** A capsule's weight at a point: 1 within `radius` of the segment, falling smoothly to 0 over `feather`. */
export function reachWeight(r: Reach, p: Vec2): number {
  const [dx, dy] = [r.to[0] - r.from[0], r.to[1] - r.from[1]];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? clamp(((p[0] - r.from[0]) * dx + (p[1] - r.from[1]) * dy) / length2, 0, 1) : 0;
  const [ex, ey] = [p[0] - r.from[0] - t * dx, p[1] - r.from[1] - t * dy];
  const d = Math.sqrt(ex * ex + ey * ey);
  if (d <= r.radius) return 1;
  const s = clamp(1 - (d - r.radius) / Math.max(1e-9, r.feather), 0, 1);
  return s * s * (3 - 2 * s);
}

/** A key's offsets, a vertex at a time: the sum of its moves at full weight. */
function keyOf(key: ShapeKey, rest: Float32Array): Float32Array {
  const out = new Float32Array((rest.length / 3) * 2);
  for (let v = 0; v < rest.length / 3; v += 1) {
    const [x, y] = [rest[v * 3] ?? 0, rest[v * 3 + 1] ?? 0];
    for (const m of key.moves) {
      const [dx, dy] = [x - m.at[0], y - m.at[1]];
      const q = 1 - (dx * dx + dy * dy) / (m.radius * m.radius);
      if (q <= 0) continue;
      out[v * 2] = (out[v * 2] ?? 0) + q * q * m.move[0];
      out[v * 2 + 1] = (out[v * 2 + 1] ?? 0) + q * q * m.move[1];
    }
  }
  return out;
}

function bindsOf(spec: LayerSpec, bones: ReadonlyMap<string, Bone>, rest: Float32Array): BindPlan[] {
  const depthOf = (b: Bone | undefined): number => (b?.parent === undefined ? 0 : 1 + depthOf(bones.get(b.parent)));
  return (spec.bind ?? []).map((bind) => {
    const bone = bones.get(bind.bone);
    if (bone === undefined) throw new RangeError(`Layer ${spec.name} binds an unknown bone ${bind.bone}.`);
    const weight = new Float32Array(rest.length / 3);
    for (let v = 0; v < weight.length; v += 1) {
      weight[v] = bind.reach ? reachWeight(bind.reach, [rest[v * 3] ?? 0, rest[v * 3 + 1] ?? 0]) : 1;
    }
    return { bone, weight, rest: bind.rest ?? [], reach: bind.reach, depth: depthOf(bone) };
  }).sort((a, b) => b.depth - a.depth);
}

function fail(spec: LayerSpec, why: string): never {
  throw new RangeError(`Layer ${spec.name}: ${why}.`);
}

function checkShape(spec: LayerSpec): void {
  const relief = spec.relief ?? 0;
  if (!(relief >= 0 && relief <= RELIEF_LIMIT)) fail(spec, `relief ${relief} is outside 0..${RELIEF_LIMIT}`);
  if (spec.states.length < 1 || spec.states.length > 2) fail(spec, "needs one or two states");
  if (spec.states.length === 2 && spec.dissolve === undefined) fail(spec, "has two states and no dissolve");
  const inRange = (n: number): boolean => n >= 1 && n <= MAX_CELLS;
  const [cols, rows] = spec.grid ?? [32, 40];
  if (!inRange(cols) || !inRange(rows)) fail(spec, `grid ${cols}×${rows} is out of range`);
}

/** Throws when a layer breaks a limit or names what is not there yet. */
function check(spec: LayerSpec, done: ReadonlyMap<string, LayerPlan>): void {
  checkShape(spec);
  const clip = spec.clip;
  if (clip !== undefined && clip !== spec.name && !done.has(clip)) fail(spec, `clips to ${clip}, not itself or earlier`);
  if (spec.on === undefined) return;
  const under = done.get(spec.on);
  if (under === undefined) fail(spec, `lies on ${spec.on}, which is not an earlier layer`);
  const gap = Math.abs(spec.z - under.spec.z);
  if (gap > GAP_LIMIT) fail(spec, `stands ${gap} off ${spec.on}, more than ${GAP_LIMIT}`);
}

function sheetOf(spec: LayerSpec, state: LayerState, under: LayerPlan | undefined): Sheet {
  const [cols, rows] = spec.grid ?? [32, 40];
  const [left, bottom, width, height] = spec.rect;
  const lift = reliefOf(state, cols, rows, spec.relief ?? 0);
  const rest = new Float32Array(lift.length * 3);
  const uv = new Float32Array(lift.length * 2);
  for (let k = 0; k < lift.length; k += 1) {
    const [u, v] = [(k % (cols + 1)) / cols, Math.floor(k / (cols + 1)) / rows];
    const [x, y] = [left + u * width, bottom + v * height];
    const floor = under?.sheets[0];
    const base = under && floor ? liftAt(under, floor, [x, y]) : 0;
    lift[k] = (lift[k] ?? 0) + base;
    rest.set([x, y, spec.z + (lift[k] ?? 0)], k * 3);
    uv.set([u, v], k * 2);
  }
  const mattes = spec.dissolve ? [state.alpha] : spec.states.map((s) => s.alpha);
  return { rest, uv, lift, index: cellsOf(mattes, cols, rows) };
}

/**
 * Plans a figure: each layer's grid, lifted by its depth guide and by the layer it lies on, with the cells that hold
 * paint, its shape keys' offsets and its bones' weights. Exact: the digest is the same on every engine.
 *
 * @param figure The figure.
 * @returns The plan.
 * @throws RangeError when a layer breaks `RELIEF_LIMIT` or `GAP_LIMIT`, or names a layer or bone that is not there.
 */
export function planFigure(figure: Figure): FigurePlan {
  const bones = new Map((figure.bones ?? []).map((b) => [b.name, b] as const));
  const done = new Map<string, LayerPlan>();
  const layers = figure.layers.map((spec) => {
    check(spec, done);
    const under = spec.on === undefined ? undefined : done.get(spec.on);
    const sheets = spec.states.map((state) => sheetOf(spec, state, under));
    const rest = sheets[0]?.rest ?? new Float32Array(0);
    const [cols, rows] = spec.grid ?? [32, 40];
    const plan: LayerPlan = {
      spec, cols, rows, sheets, keys: (spec.keys ?? []).map((k) => keyOf(k, rest)), binds: bindsOf(spec, bones, rest),
    };
    done.set(spec.name, plan);
    return plan;
  });
  const arrays = layers.flatMap((l) => [...l.sheets.flatMap((s) => [s.rest, s.index]), ...l.keys,
    ...l.binds.map((b) => b.weight)]);
  return { figure, layers, digest: digestOf(arrays) };
}

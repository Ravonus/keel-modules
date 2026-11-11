// Proportion fixes in 2D: anchors move a point (and may scale about it) with a smooth falloff, pins hold a point.
// The warp is kept as a 65 × 65 grid of offsets back into the guides, worked out in exact arithmetic, and every
// guide is read through it, so strokes follow the corrected form. The GPU reads the same grid.
import { idBox, type GuideImage, type IdStats } from "./guide.js";
import type { Handle, WarpRecipe } from "./recipe.js";

/** Grid cells across and down; the grid has one more node each way. */
export const WARP_CELLS = 64;

export interface Warp {
  /** The guide's size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Per node, row by row: the offset (x, y) from a painted point back to the guide pixel it shows. */
  readonly grid: Float32Array;
}

interface Resolved {
  readonly x: number;
  readonly y: number;
  readonly r2: number;
  readonly move: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly pin: boolean;
}

const SIDES = ["top", "bottom", "left", "right"];

/** An `id:` handle's id name and side (`centre` when it names none). */
function parseHandle(text: string, ids: readonly string[]): [string, string] {
  if (!text.startsWith("id:")) throw new TypeError(`painting: a handle is [x, y] or id:<name>, not "${text}".`);
  const name = text.slice(3);
  const dot = name.lastIndexOf(".");
  const side = name.slice(dot + 1);
  return SIDES.includes(side) && !ids.includes(name) ? [name.slice(0, dot), side] : [name, "centre"];
}

/** Where a handle is, in guide pixels. */
export function handlePoint(
  handle: Handle, ids: readonly string[], stats: IdStats, size: GuideImage,
): [number, number] {
  if (typeof handle !== "string") return [handle[0] * size.width, handle[1] * size.height];
  const [name, side] = parseHandle(handle, ids);
  const k = ids.indexOf(name);
  const n = k > 0 ? stats.n[k] ?? 0 : 0;
  if (n === 0) throw new TypeError(`painting: no pixels of "${name}" for the handle "${handle}".`);
  const cx = (stats.sx[k] ?? 0) / n;
  const cy = (stats.sy[k] ?? 0) / n;
  const [x0, y0, x1, y1] = idBox(stats, k);
  const at: Record<string, [number, number]> = { top: [cx, y0], bottom: [cx, y1], left: [x0, cy], right: [x1, cy] };
  return at[side] ?? [cx, cy];
}

/** The falloff: 1 at the handle, 0 at its radius and beyond, smooth. */
const falloff = (dx: number, dy: number, r2: number): number => {
  const s = (dx * dx + dy * dy) / r2;
  return s < 1 ? (1 - s) * (1 - s) : 0;
};

/** How far the warp moves a guide point, in pixels. */
function displacement(handles: readonly Resolved[], x: number, y: number): [number, number] {
  let dx = 0;
  let dy = 0;
  let hold = 1;
  for (const h of handles) {
    const w = falloff(x - h.x, y - h.y, h.r2);
    if (h.pin) hold *= 1 - w;
    else {
      dx += w * (h.move[0] + (h.scale[0] - 1) * (x - h.x));
      dy += w * (h.move[1] + (h.scale[1] - 1) * (y - h.y));
    }
  }
  return [dx * hold, dy * hold];
}

/**
 * The warp's grid: at each node, the offset back to where the moved point came from, found by four fixed-point
 * steps of `source = p - displacement(source)`.
 *
 * @param recipe The recipe's warp handles.
 * @param guides The id guide's size and names, and its stats, to place `id:` handles.
 */
export function planWarp(
  recipe: readonly WarpRecipe[], ids: readonly string[], stats: IdStats, size: GuideImage,
): Warp {
  const H = size.height;
  const handles: Resolved[] = recipe.map((w) => {
    const point = handlePoint(w.pin ?? w.anchor ?? [0.5, 0.5], ids, stats, size);
    const move = w.move ?? [0, 0];
    return {
      x: point[0], y: point[1], r2: (w.radius * H) * (w.radius * H), move: [move[0] * H, move[1] * H],
      scale: w.scale ?? [1, 1], pin: w.pin !== undefined,
    };
  });
  const grid = new Float32Array((WARP_CELLS + 1) * (WARP_CELLS + 1) * 2);
  for (let j = 0; j <= WARP_CELLS; j += 1) {
    for (let i = 0; i <= WARP_CELLS; i += 1) {
      const px = (i * size.width) / WARP_CELLS;
      const py = (j * H) / WARP_CELLS;
      let s: [number, number] = [px, py];
      for (let k = 0; k < 4; k += 1) {
        const d = displacement(handles, s[0], s[1]);
        s = [px - d[0], py - d[1]];
      }
      grid.set([s[0] - px, s[1] - py], (j * (WARP_CELLS + 1) + i) * 2);
    }
  }
  return { width: size.width, height: H, grid };
}

/** One channel of two grid rows, at `fx` of the way from node `a` (and `b`, a row down) to the next. */
function across(g: Float32Array, a: number, b: number, fx: number): [number, number] {
  const a0 = g[a] ?? 0;
  const b0 = g[b] ?? 0;
  return [a0 + ((g[a + 2] ?? 0) - a0) * fx, b0 + ((g[b + 2] ?? 0) - b0) * fx];
}

/** The guide point a painted point shows: the point plus the grid's offset there, bilinear between nodes. */
export function warpPoint(warp: Warp, x: number, y: number): [number, number] {
  const gx = Math.min(Math.max((x / warp.width) * WARP_CELLS, 0), WARP_CELLS - 1e-9);
  const gy = Math.min(Math.max((y / warp.height) * WARP_CELLS, 0), WARP_CELLS - 1e-9);
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const a = (j * (WARP_CELLS + 1) + i) * 2;
  const b = a + (WARP_CELLS + 1) * 2;
  const ox = across(warp.grid, a, b, fx);
  const oy = across(warp.grid, a + 1, b + 1, fx);
  return [x + ox[0] + (ox[1] - ox[0]) * fy, y + oy[0] + (oy[1] - oy[0]) * fy];
}

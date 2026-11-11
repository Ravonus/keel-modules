// The brush's two grain tiles, 256² bytes each, made on the CPU in exact arithmetic so a seed is the same tile on
// every engine. The noise grain gates dry brush and scumble; the weave is the canvas the finish shows where paint is
// thin. The weave is painterly's `grainTile`, kept bit for bit so a brushed layer and the painterly post share a
// canvas.
import { hash32, unit } from "./exact.js";

/** The grain tiles' size in texels; they repeat. */
export const GRAIN_SIZE = 256;
/** Texels one thread of the weave takes. */
export const WEAVE_PITCH = 6;

/** A thread's height across itself, 0 at its edges and 1 in the middle, for `t` wrapped into a thread. */
function thread(t: number): number {
  const u = t - Math.floor(t);
  return 4 * u * (1 - u);
}

/**
 * The canvas: a plain weave of warp and weft threads, each shifted a little its own way, under a speckle of fibre.
 *
 * @param seed Which weave.
 * @param size Texels across and down.
 * @returns Heights, `size * size` bytes, 0 in the hollows up to 255 on the threads.
 */
export function weaveTile(seed: number, size = GRAIN_SIZE): Uint8Array {
  const out = new Uint8Array(size * size);
  const shift = (index: number, kind: number): number => (unit(hash32(index, kind, seed)) - 0.5) * 0.3;
  for (let y = 0; y < size; y += 1) {
    const cy = Math.floor(y / WEAVE_PITCH);
    const weft = thread((y + 0.5) / WEAVE_PITCH + shift(cy, 2));
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / WEAVE_PITCH);
      const warp = thread((x + 0.5) / WEAVE_PITCH + shift(cx, 1));
      const over = ((cx + cy) & 1) === 0;
      const height = over ? Math.max(warp, weft * 0.75) : Math.max(weft, warp * 0.75);
      const speckle = unit(hash32(x, y, seed ^ 0x5bd1e995)) * 0.18;
      out[y * size + x] = Math.round(255 * Math.min(1, height * 0.82 + speckle));
    }
  }
  return out;
}

/** The smooth step of 0..1, a polynomial. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** Value noise on a lattice `cells` across that wraps at the tile's edge, 0..1. */
function lattice(seed: number, cells: number, x: number, y: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const at = (i: number, j: number): number => unit(hash32(i % cells, j % cells, seed));
  const u = ease(fx - ix);
  const v = ease(fy - iy);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * u;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * u;
  return top + (bottom - top) * v;
}

/**
 * The tooth of the paint: four octaves of wrapping value noise, stretched a little across so dry paint breaks in
 * short drags.
 *
 * @param seed Which tooth.
 * @param size Texels across and down.
 * @returns `size * size` bytes.
 */
export function noiseTile(seed: number, size = GRAIN_SIZE): Uint8Array {
  const out = new Uint8Array(size * size);
  const octaves = [[8, 0.5], [16, 0.25], [32, 0.15], [64, 0.1]] as const;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0;
      for (const [cells, weight] of octaves) v += weight * lattice(seed + cells, cells, x / size, y / size);
      out[y * size + x] = Math.round(255 * v);
    }
  }
  return out;
}

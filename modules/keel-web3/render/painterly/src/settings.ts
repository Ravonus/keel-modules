// Settings, checked and bounded; and what the seed decides, in arithmetic that gives the same bits on every engine:
// where each stroke lies in its cell, and the weave of the canvas.

/** How a lit picture is painted. */
export interface PainterlySettings {
  /** The brush's radius in painted pixels: how broad the smoothing and the strokes are, 2 to 12. */
  readonly stroke: number;
  /** How far strokes follow the form (the mesh's own normals and depth) rather than the colour, 0 to 1. */
  readonly direction: number;
  /** How much of the picture is stamped strokes over the smoothed base, 0 (none: the base alone) to 1. */
  readonly strokes: number;
  /** The canvas weave showing through, 0 to 1. */
  readonly grain: number;
  /** How strictly a stroke keeps to its own depth, 0 to 1: at 1 none crosses a silhouette. */
  readonly edge: number;
  /** The varnish: a warm glaze, lifted blacks, a little contrast and a vignette, 0 to 1. */
  readonly grade: number;
  /** Multiplies the light before the tone map. */
  readonly exposure: number;
  /** Painted pixels for each frame pixel, 0.25 to 1: the paint is worked at this share of the frame's size. */
  readonly resolution: number;
  /** Which placement of strokes and weave of canvas: any whole number. */
  readonly seed: number;
}

export const DEFAULT_PAINTERLY_SETTINGS: PainterlySettings = {
  stroke: 5,
  direction: 1,
  strokes: 1,
  grain: 0.05,
  edge: 0.5,
  grade: 0.6,
  exposure: 1,
  resolution: 0.5,
  seed: 1,
};

/** The two variants the trial compares: the smoothed base alone, and strokes along the form over it. */
export const SMOOTH_SETTINGS: PainterlySettings = { ...DEFAULT_PAINTERLY_SETTINGS, direction: 0, strokes: 0 };
export const STROKED_SETTINGS: PainterlySettings = DEFAULT_PAINTERLY_SETTINGS;

type Bag = Readonly<Record<string, unknown>>;

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Normalizes untrusted settings into a complete recipe. Anything missing or malformed falls back to the defaults;
 * anything out of range is held to it; the seed is made whole.
 *
 * @param input Plain settings object, or undefined.
 */
export function painterlySettings(input?: unknown): PainterlySettings {
  if (input === null || typeof input !== "object") return DEFAULT_PAINTERLY_SETTINGS;
  const v = input as Bag;
  const d = DEFAULT_PAINTERLY_SETTINGS;
  return {
    stroke: bounded(v.stroke, 2, 12, d.stroke),
    direction: bounded(v.direction, 0, 1, d.direction),
    strokes: bounded(v.strokes, 0, 1, d.strokes),
    grain: bounded(v.grain, 0, 1, d.grain),
    edge: bounded(v.edge, 0, 1, d.edge),
    grade: bounded(v.grade, 0, 1, d.grade),
    exposure: bounded(v.exposure, 0, 16, d.exposure),
    resolution: bounded(v.resolution, 0.25, 1, d.resolution),
    seed: Math.floor(bounded(v.seed, -2147483648, 2147483647, d.seed)),
  };
}

/**
 * Three whole numbers mixed into 32 bits: the same bits on every engine, since only integer arithmetic is used.
 *
 * @returns An unsigned 32-bit number.
 */
export function hash32(a: number, b: number, c: number): number {
  // (A constant first, so three noughts are not a nought.)
  let h = 0x27d4eb2f ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A hash as a number from 0 up to 1: one division by a power of two, which is exact. */
export const unit = (hash: number): number => hash / 4294967296;

/** How many cells across the stroke tile is: it repeats over the frame. */
export const STROKE_CELLS = 64;

/**
 * Where the strokes lie: one stroke a cell, repeated over the frame. Four bytes a cell, rows bottom first as a
 * texture reads them: where in its cell the stroke's centre is (across, up), how long it is, and which lies on top
 * where two meet. Direction and colour are taken from the picture when it is painted, not decided here.
 *
 * @param seed Which placement.
 * @param cells Cells across and down (the tile is square).
 * @returns RGBA bytes, `cells * cells * 4` of them.
 */
export function strokeTile(seed: number, cells = STROKE_CELLS): Uint8Array {
  const out = new Uint8Array(cells * cells * 4);
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const h = hash32(x, y, seed);
      const at = (y * cells + x) * 4;
      out[at] = h & 255;
      out[at + 1] = (h >>> 8) & 255;
      out[at + 2] = (h >>> 16) & 255;
      out[at + 3] = (h >>> 24) & 255;
    }
  }
  return out;
}

/** The grain tile's size in texels and how many texels one thread of the weave takes. */
export const GRAIN_SIZE = 256;
export const GRAIN_PITCH = 6;

/** A thread's height across itself, 0 at its edges and 1 in the middle, for `t` wrapped into a thread. */
function thread(t: number): number {
  const u = t - Math.floor(t);
  return 4 * u * (1 - u);
}

/**
 * The canvas: a plain weave of warp and weft threads, each thread shifted a little its own way, under a speckle of
 * fibre. One byte a texel, 0 in the hollows up to 255 on the threads, rows bottom first.
 *
 * @param seed Which weave.
 * @param size Texels across and down (the tile is square and repeats).
 * @param pitch Texels a thread takes; the tile should hold a whole number of them.
 * @returns Heights, `size * size` bytes.
 */
export function grainTile(seed: number, size = GRAIN_SIZE, pitch = GRAIN_PITCH): Uint8Array {
  const out = new Uint8Array(size * size);
  const shift = (index: number, kind: number): number => (unit(hash32(index, kind, seed)) - 0.5) * 0.3;
  for (let y = 0; y < size; y += 1) {
    const cy = Math.floor(y / pitch);
    const weft = thread((y + 0.5) / pitch + shift(cy, 2));
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / pitch);
      const warp = thread((x + 0.5) / pitch + shift(cx, 1));
      // (Over and under: in every other cell the warp lies on top, elsewhere the weft.)
      const over = ((cx + cy) & 1) === 0;
      const height = over ? Math.max(warp, weft * 0.75) : Math.max(weft, warp * 0.75);
      const speckle = unit(hash32(x, y, seed ^ 0x5bd1e995)) * 0.18;
      out[y * size + x] = Math.round(255 * Math.min(1, height * 0.82 + speckle));
    }
  }
  return out;
}

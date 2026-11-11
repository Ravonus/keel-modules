// Settings, checked and bounded; and what the seed decides, in arithmetic that gives the same bits on every engine:
// where each stroke lies in its cell, the weave of the canvas and the craquelure of the varnish.

/** How a lit picture is painted. */
export interface PainterlySettings {
  /** The brush's radius in painted pixels: how broad the smoothing and the strokes are, 2 to 12. */
  readonly stroke: number;
  /** How far strokes follow the form (the mesh's own normals and depth) rather than the colour, 0 to 1. */
  readonly direction: number;
  /** How much of the picture is strokes over the glazed base, 0 (none, the default) to 1; a low value is meant. */
  readonly strokes: number;
  /** The canvas weave showing through, 0 to 1. */
  readonly grain: number;
  /** How strictly a stroke keeps to its own depth, 0 to 1: at 1 none crosses a silhouette. */
  readonly edge: number;
  /** The varnish: a warm glaze, lifted blacks, a little contrast and a vignette, 0 to 1. */
  readonly grade: number;
  /** The fine craquelure of an old varnish, 0 (none) to 1. */
  readonly crackle: number;
  /** Multiplies the light before the tone map. */
  readonly exposure: number;
  /** Painted pixels for each frame pixel, 0.25 to 1: the paint is worked at this share of the frame's size. */
  readonly resolution: number;
  /** Which placement of strokes and weave of canvas: any whole number. */
  readonly seed: number;
}

export const DEFAULT_PAINTERLY_SETTINGS: PainterlySettings = {
  stroke: 4,
  direction: 1,
  strokes: 0,
  grain: 0.2,
  edge: 0.5,
  grade: 0.6,
  crackle: 0.15,
  exposure: 1,
  resolution: 0.5,
  seed: 1,
};

/** The glaze (the default): the base smoothed and blended along the form, varnished, with no strokes. */
export const GLAZE_SETTINGS: PainterlySettings = DEFAULT_PAINTERLY_SETTINGS;
/** The glaze with a few soft strokes over it, carrying its colour. */
export const STROKED_SETTINGS: PainterlySettings = { ...DEFAULT_PAINTERLY_SETTINGS, strokes: 0.4 };

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
    crackle: bounded(v.crackle, 0, 1, d.crackle),
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

/** The craquelure tile's size in texels; it repeats, a texel to the frame pixel. */
export const CRACK_SIZE = 1024;

interface Net {
  /** Cells across the tile (the net wraps). */
  readonly cells: number;
  /** The tile's size in texels. */
  readonly size: number;
  readonly seed: number;
}

interface Points {
  /** A seed point a cell, at a hash's place within it, in texels. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** A value a cell, 0 up to 1. */
  readonly v: Float64Array;
  /** Whether the cell keeps its point (1) or goes without, so its neighbours' cells grow (0). */
  readonly kept: Uint8Array;
  /** How many cells each way a search for the nearest points looks: 1 when every cell has its point. */
  readonly reach: number;
}

/**
 * A net's points. `thinned`, if given, is a field over the tile, 0 up to 1: where it is low a cell is likelier to go
 * without its point, so the cells there run larger; the search then looks two cells each way.
 */
function pointsOf(net: Net, thinned?: (x: number, y: number) => number): Points {
  const { cells, seed } = net;
  const cell = net.size / cells;
  const x = new Float64Array(cells * cells);
  const y = new Float64Array(cells * cells);
  const v = new Float64Array(cells * cells);
  const kept = new Uint8Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const at = j * cells + i;
      x[at] = (i + unit(hash32(i, j, seed))) * cell;
      y[at] = (j + unit(hash32(i, j, seed ^ 0x9e3779b9))) * cell;
      v[at] = unit(hash32(i, j, seed));
      const drop = thinned ? 0.6 * (1 - thinned((i + 0.5) * cell, (j + 0.5) * cell)) : 0;
      kept[at] = unit(hash32(i, j, seed ^ 0x7f4a7c15)) < drop ? 0 : 1;
    }
  }
  return { x, y, v, kept, reach: thinned ? 2 : 1 };
}

/** Value noise: the net's values, smooth between its cells, wrapping, 0 up to 1; (x, y) within the tile. */
function lattice(x: number, y: number, net: Net, p: Points): number {
  const { cells } = net;
  const cell = net.size / cells;
  const sx = x / cell;
  const sy = y / cell;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const jx = (ix + 1) % cells;
  const jy = (iy + 1) % cells;
  const a = p.v[iy * cells + ix] ?? 0;
  const b = p.v[iy * cells + jx] ?? 0;
  const c = p.v[jy * cells + ix] ?? 0;
  const d = p.v[jy * cells + jx] ?? 0;
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

/** A net of cracks: how near (x, y) lies to the border between its nearest two seed points, and which border. */
function border(x: number, y: number, net: Net, p: Points): { edge: number; id: number } {
  const cell = net.size / net.cells;
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  let d1 = Infinity;
  let d2 = Infinity;
  let i1 = 0;
  let i2 = 0;
  for (let j = -p.reach; j <= p.reach; j += 1) {
    for (let i = -p.reach; i <= p.reach; i += 1) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = ((gx % net.cells) + net.cells) % net.cells;
      const wy = ((gy % net.cells) + net.cells) % net.cells;
      const id = wy * net.cells + wx;
      if (p.kept[id] === 0) continue;
      // (A cell past the tile's edge is the wrapped cell's point, a whole tile over.)
      const dx = (p.x[id] ?? 0) + (gx - wx) * cell - x;
      const dy = (p.y[id] ?? 0) + (gy - wy) * cell - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) [d1, d2, i1, i2] = [d, d1, id, i1];
      else if (d < d2) [d2, i2] = [d, id];
    }
  }
  return { edge: d2 - d1, id: hash32(Math.min(i1, i2), Math.max(i1, i2), net.seed ^ 0x27d4eb2f) };
}

/**
 * The craquelure of an old varnish: a net of fine cracks between islands, with a finer net inside it, both bent so
 * no crack runs straight, the islands running larger here and smaller there by a slow field over the tile, and some
 * of the finer cracks left out. One byte a texel, 0 off a crack up to 255 in one, rows bottom first.
 *
 * @param seed Which net.
 * @param size Texels across and down (the tile is square and repeats).
 * @returns Crack depths, `size * size` bytes.
 */
export function crackTile(seed: number, size = CRACK_SIZE): Uint8Array {
  const out = new Uint8Array(size * size);
  const coarse = Math.max(1, Math.round(size / 36));
  const slow: Net = { cells: Math.max(1, Math.round(size / 128)), size, seed: seed ^ 0x3c6ef372 };
  const bendX: Net = { cells: Math.max(1, Math.round(size / 64)), size, seed: seed ^ 0x165667b1 };
  const bendY: Net = { ...bendX, seed: seed ^ 0xd3a2646c };
  const islands: Net = { cells: coarse, size, seed };
  const finer: Net = { cells: coarse * 2, size, seed: seed ^ 0x5bd1e995 };
  const field = pointsOf(slow);
  const bx = pointsOf(bendX);
  const by = pointsOf(bendY);
  const big = pointsOf(islands, (x, y) => lattice(x, y, slow, field));
  const small = pointsOf(finer);
  const sway = size / 40;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const wx = x + (lattice(x, y, bendX, bx) - 0.5) * sway;
      const wy = y + (lattice(x, y, bendY, by) - 0.5) * sway;
      const island = border(wx, wy, islands, big);
      const inner = border(wx, wy, finer, small);
      let depth = Math.max(0, 1 - island.edge / 1.1) * (unit(island.id) < 0.1 ? 0 : 1);
      depth += 0.55 * Math.max(0, 1 - inner.edge / 0.8) * (unit(inner.id) < 0.35 ? 0 : 1);
      out[y * size + x] = Math.round(255 * Math.min(1, depth));
    }
  }
  return out;
}

// The guides a painting reads: passes rendered from a KEEL stage (render/guides), a 2D construction or a basis, each
// RGBA8 with rows from the top. The id pass holds a part's index in red; `ids` names the indices.

/** One guide pass: RGBA8, rows from the top, as `ImageData` holds them. */
export interface GuideImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface Guides {
  /** Index to name; index 0 is nothing. */
  readonly ids: readonly string[];
  /** The part's index in red. */
  readonly id: GuideImage;
  /** Key-only diffuse light in red, 0 dark to 255 lit. */
  readonly light: GuideImage;
  /** Contour and feature lines in red. */
  readonly line?: GuideImage;
  readonly depth?: GuideImage;
  readonly normal?: GuideImage;
  readonly block?: GuideImage;
}

/** Sums over each id's pixels: count, x, y, x², y², xy; and its box. Integers, so exact. */
export interface IdStats {
  readonly n: Float64Array;
  readonly sx: Float64Array;
  readonly sy: Float64Array;
  readonly sxx: Float64Array;
  readonly syy: Float64Array;
  readonly sxy: Float64Array;
  /** min x, min y, max x, max y, four an id. */
  readonly box: Int32Array;
}

const add = (a: Float64Array, k: number, v: number): void => {
  a[k] = (a[k] ?? 0) + v;
};

/** Sum of the squares 1² + … + m². */
const squares = (m: number): number => (m * (m + 1) * (2 * m + 1)) / 6;

/** Adds a run of one id, x0..x1 on row y: its sums by the series' closed forms, all whole numbers. */
function addRun(s: IdStats, k: number, run: readonly [number, number, number]): void {
  const [x0, x1, y] = run;
  const n = x1 - x0 + 1;
  const sx = ((x0 + x1) * n) / 2;
  add(s.n, k, n);
  add(s.sx, k, sx);
  add(s.sy, k, n * y);
  add(s.sxx, k, squares(x1) - squares(x0 - 1));
  add(s.syy, k, n * y * y);
  add(s.sxy, k, sx * y);
  const b = k * 4;
  s.box[b] = Math.min(s.box[b] ?? x0, x0);
  s.box[b + 1] = Math.min(s.box[b + 1] ?? y, y);
  s.box[b + 2] = Math.max(s.box[b + 2] ?? x1, x1);
  s.box[b + 3] = Math.max(s.box[b + 3] ?? y, y);
}

/** One pass over the id guide, a run of one id at a time. */
export function idStats(id: GuideImage): IdStats {
  const z = (): Float64Array => new Float64Array(256);
  const s: IdStats = { n: z(), sx: z(), sy: z(), sxx: z(), syy: z(), sxy: z(), box: new Int32Array(1024) };
  for (let k = 0; k < 256; k += 1) s.box.set([1 << 30, 1 << 30, -1, -1], k * 4);
  const { width, height, data } = id;
  for (let y = 0; y < height; y += 1) {
    let start = 0;
    let k = data[y * width * 4] ?? 0;
    for (let x = 1; x <= width; x += 1) {
      const next = x < width ? data[(y * width + x) * 4] ?? 0 : -1;
      if (next === k) continue;
      addRun(s, k, [start, x - 1, y]);
      start = x;
      k = next;
    }
  }
  return s;
}

/** An id's box: min x, min y, max x, max y. */
export function idBox(stats: IdStats, k: number): [number, number, number, number] {
  const b = stats.box;
  return [b[k * 4] ?? 0, b[k * 4 + 1] ?? 0, b[k * 4 + 2] ?? 0, b[k * 4 + 3] ?? 0];
}

/** Whether a name matches a pattern: exact, or `prefix*`. */
export function matches(name: string, pattern: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/**
 * The ids a selection takes, as a flag an index (256).
 *
 * @param ids The guide's names.
 * @param take Patterns to take.
 * @param leave Patterns to leave out again.
 */
export function idFlags(ids: readonly string[], take: readonly string[], leave: readonly string[] = []): Uint8Array {
  const flags = new Uint8Array(256);
  ids.forEach((name, i) => {
    if (i === 0 || i > 255) return;
    const on = take.some((p) => matches(name, p)) && !leave.some((p) => matches(name, p));
    flags[i] = on ? 1 : 0;
  });
  return flags;
}

/** The box (min x, min y, max x, max y) over the flagged ids, or null if none has a pixel. */
export function boxOf(stats: IdStats, flags: Uint8Array): [number, number, number, number] | null {
  let out: [number, number, number, number] | null = null;
  for (let k = 1; k < 256; k += 1) {
    if (flags[k] !== 1 || (stats.n[k] ?? 0) === 0) continue;
    const b = idBox(stats, k);
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : b;
  }
  return out;
}

/** A guide's red byte at a pixel, clamped to the image. */
export function redAt(image: GuideImage, x: number, y: number): number {
  const ix = Math.min(Math.max(Math.floor(x), 0), image.width - 1);
  const iy = Math.min(Math.max(Math.floor(y), 0), image.height - 1);
  return image.data[(iy * image.width + ix) * 4] ?? 0;
}

/**
 * The long axis of an id's pixels: the leading eigenvector of their covariance, in exact arithmetic.
 *
 * @returns A unit vector, x right and y down; across if the id is round.
 */
export function axisOf(stats: IdStats, k: number): [number, number] {
  const n = stats.n[k] ?? 0;
  if (n < 2) return [1, 0];
  const mx = (stats.sx[k] ?? 0) / n;
  const my = (stats.sy[k] ?? 0) / n;
  const a = (stats.sxx[k] ?? 0) / n - mx * mx;
  const c = (stats.syy[k] ?? 0) / n - my * my;
  const b = (stats.sxy[k] ?? 0) / n - mx * my;
  return principal(a, b, c);
}

/** The leading eigenvector of [[a, b], [b, c]], unit length. */
export function principal(a: number, b: number, c: number): [number, number] {
  const root = Math.sqrt((a - c) * (a - c) + 4 * b * b);
  const v: [number, number] = a >= c ? [a - c + root, 2 * b] : [2 * b, c - a + root];
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  return l > 0 ? [v[0] / l, v[1] / l] : [1, 0];
}

/** What render/guides' `render` returns: passes as RGBA8 rows from the top, and the table naming each id's colour. */
export interface GuideSet {
  readonly passes: { readonly id?: GuideImage; readonly light?: GuideImage; readonly line?: GuideImage;
    readonly depth?: GuideImage; readonly normal?: GuideImage; readonly block?: GuideImage };
  readonly table: readonly { readonly id: number; readonly name: string; readonly colour: readonly number[] }[];
}

function mapped(image: GuideImage, value: (data: GuideImage["data"], i: number) => number): GuideImage {
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value(image.data, i);
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

/**
 * render/guides' passes as the painter reads them: the id pass's table colours to indices in red, with `ids` from
 * the table, and the line pass's strongest line (its alpha) in red. Light and the rest pass through.
 *
 * @returns Guides for `planPainting` and `paint`.
 */
export function guidesOf(set: GuideSet): Guides {
  const { id, light, line } = set.passes;
  if (!id || !light) throw new TypeError("painting: a guide set needs its id and light passes.");
  const index = new Map<number, number>();
  const ids = ["none"];
  for (const t of set.table) {
    index.set(((t.colour[0] ?? 0) << 16) | ((t.colour[1] ?? 0) << 8) | (t.colour[2] ?? 0), t.id);
    ids[t.id] = t.name;
  }
  const decode = (d: GuideImage["data"], i: number): number =>
    (d[i + 3] ?? 0) === 0 ? 0 : index.get(((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0)) ?? 0;
  return {
    ...set.passes, ids: Array.from(ids, (n) => n || "none"), id: mapped(id, decode), light,
    ...(line ? { line: mapped(line, (d, i) => d[i + 3] ?? 0) } : {}),
  };
}

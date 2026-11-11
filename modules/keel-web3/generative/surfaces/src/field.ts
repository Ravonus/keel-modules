// The painters on the CPU: surface.glsl.ts's arithmetic in the same order, for tests, workers without a GPU and bakes
// at build time. `u(4 * k + j)` reads a plan's uniforms: the shaders' `u[k]` component j.
import { hash } from "./exact.js";

type Rgb = [number, number, number];
/** Reads a plan's uniforms by index. */
export type Uniforms = (index: number) => number;
type Surface = (u: Uniforms, x: number, y: number, c: Rgb) => number;

const fract = (v: number): number => v - Math.floor(v);
const clamp = (v: number, low = 0, high = 1): number => Math.min(Math.max(v, low), high);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function smooth(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const cell = (x: number, y: number, px: number, py: number): number => ((x + px) % px) + (((y + py) % py) << 12);
const rn = (x: number, y: number, p: number, s: number): number => hash(cell(x, y, p, p), s) / 4294967296;

function vn(qx: number, qy: number, p: number, s: number): number {
  const ix = Math.floor(qx);
  const iy = Math.floor(qy);
  const [fx, fy] = [qx - ix, qy - iy];
  const [wx, wy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const a = rn(ix, iy, p, s);
  const b = rn(ix + 1, iy, p, s);
  const c = rn(ix, iy + 1, p, s);
  const d = rn(ix + 1, iy + 1, p, s);
  const top = a + (b - a) * wx;
  return top + (c + (d - c) * wx - top) * wy;
}

function fbm(qx: number, qy: number, period: number, salt: { s: number; n: number }): number {
  let [t, a, w, x, y, p] = [0, 0.5, 0, qx, qy, period];
  for (let k = 0; k < salt.n; k += 1) {
    t += a * vn(x, y, p, salt.s + k);
    w += a;
    [x, y, p, a] = [x * 2, y * 2, p * 2, a * 0.5];
  }
  return t / w;
}

/** The strongest fibre over a point, and that fibre's tone. */
function fib(x: number, y: number, n: number, shape: { s: number; len: number; wid: number }): [number, number] {
  const [gx, gy] = [x * n, y * n];
  const [cx, cy] = [Math.floor(gx), Math.floor(gy)];
  let r: [number, number] = [0, 0];
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const k = cell(cx + i, cy + j, n, n);
      const [h1, h2] = [hash(k, shape.s), hash(k, shape.s + 1)];
      let [dx, dy] = [(h2 >>> 16) / 65536 - 0.5, (h2 & 65535) / 65536 - 0.5];
      const l = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-4);
      [dx, dy] = [dx / l, dy / l];
      const [qx, qy] = [gx - (cx + i + (h1 >>> 16) / 65536), gy - (cy + j + (h1 & 65535) / 65536)];
      const t = clamp(qx * dx + qy * dy, -shape.len, shape.len);
      const e = 1 - smooth(shape.wid * 0.5, shape.wid, Math.hypot(qx - dx * t, qy - dy * t));
      if (e > r[0]) r = [e, (h2 & 255) / 255];
    }
  }
  return r;
}

const band = (t: number, w: number): number => 1 - smooth(0, w, Math.abs(fract(t) - 0.5));

function fleck(x: number, y: number, m: number, at: { s: number; density: number }): number {
  const [gx, gy] = [x * m, y * m];
  const [ix, iy] = [Math.floor(gx), Math.floor(gy)];
  const h = hash(cell(ix, iy, m, m), at.s);
  if ((h & 1023) / 1024 >= at.density) return 0;
  const [ox, oy] = [ix + 0.3 + (0.4 * ((h >>> 22) & 1023)) / 1024, iy + 0.3 + (0.4 * ((h >>> 12) & 1023)) / 1024];
  const r = 0.04 + 0.06 * ((h >>> 10) & 3);
  return 1 - smooth(r * 0.5, r, Math.hypot(gx - ox, gy - oy));
}

const paper: Surface = (u, x, y, c) => {
  const s = u(3);
  const [n, p, fibres, mottle, lines] = [u(12), u(15), u(13), u(14), u(18)];
  const m = fbm(x * p, y * p, p, { s, n: 4 });
  const tooth = vn(x * n * 4, y * n * 4, n * 4, s + 5);
  const a = fib(x, y, n, { s: s + 10, len: 0.9, wid: 0.1 });
  const b = fib(x, y, n * 2, { s: s + 20, len: 0.8, wid: 0.12 });
  const laid = (u(16) > 0 ? 0.6 * band(y * u(16), 0.12) : 0) + (u(17) > 0 ? band(x * u(17), 0.03) : 0);
  const h = 0.5 * m + 0.15 * tooth + fibres * (0.6 * a[0] + 0.4 * b[0]) + lines * laid;
  const shade = (1 + mottle * ((m - 0.5) * 2 + (tooth - 0.5) * 0.6))
    * (1 + fibres * (a[0] * (0.03 - 0.6 * smooth(0.95, 0.99, a[1])) + 0.03 * b[0]))
    * (1 + lines * 0.08 * laid);
  const st = fbm(x * 3, y * 3, 3, { s: s + 30, n: 4 });
  const area = smooth(0.6, 0.66, st);
  const stain = u(11) * (0.35 * area + 0.5 * area * (1 - smooth(0.66, 0.7, st)));
  const dot = fleck(x, y, n * 3, { s: s + 40, density: u(7) });
  for (let i = 0; i < 3; i += 1) c[i] = mix(mix(u(i) * shade, u(8 + i), stain), u(4 + i), dot);
  return h;
};

/** One leg of a stitch: its height at `q`, and where `q` falls in the yarn's ply. */
function leg(q: [number, number], ends: readonly number[], r: number, twist: number): [number, number] {
  const [ax, ay, bx, by] = ends as [number, number, number, number];
  const [abx, aby] = [bx - ax, by - ay];
  const t = clamp(((q[0] - ax) * abx + (q[1] - ay) * aby) / (abx * abx + aby * aby));
  const [ex, ey] = [q[0] - ax - abx * t, q[1] - ay - aby * t];
  const d = Math.hypot(ex, ey) / r;
  const side = (ex * aby - ey * abx) / (Math.hypot(abx, aby) * r);
  const ply = Math.abs(fract(t * twist + side * 0.35) - 0.5) * 2;
  return [Math.sqrt(Math.max(0, 1 - d * d)) * (0.8 + 0.8 * t * (1 - t)), ply];
}

/** The tallest stitch leg over a point: [height, ply, tone]. */
function stitches(u: Uniforms, x: number, y: number): [number, number, number] {
  const [ribs, rows, jitter] = [u(7), u(11), u(15)];
  const a = rows / ribs;
  const hw = u(12) * 0.5 * a;
  const [gx, gy] = [x * ribs, y * rows];
  const col = Math.floor(gx);
  const fx = (gx - col - 0.5) * a;
  let best: [number, number, number] = [0, 0.5, 0.5];
  for (let k = -1; k <= 1; k += 1) {
    const row = Math.floor(gy) + k;
    const hs = hash(cell(col, row, ribs, rows), u(3));
    const j = jitter * ((hs & 255) / 255 - 0.5);
    for (const sd of [-1, 1]) {
      const ends = [sd * hw * 0.72, -0.18, sd * hw * 0.06, 1.08];
      const [e, ply] = leg([fx + j * 0.06 * a, gy - row], ends, hw * 0.46, u(13));
      if (e * (1 + 0.3 * j) > best[0]) best = [e * (1 + 0.3 * j), ply, (hs >>> 24) / 255];
    }
  }
  const gw = Math.max(0.5 * a - hw, 1e-3);
  const [gd, py] = [(0.5 * a - Math.abs(fx)) / gw, (fract(gy) - 0.5) / 0.32];
  const purl = 0.4 * Math.sqrt(Math.max(0, 1 - gd * gd - py * py));
  return [Math.max(best[0], purl) + 0.12 * (best[1] - 0.5) * best[0], best[1], best[2]];
}

const knit: Surface = (u, x, y, c) => {
  const [s, ribs, fuzz] = [u(3), u(7), u(14)];
  const [h0, , tone] = stitches(u, x, y);
  const n = fbm(x * ribs * 16, y * ribs * 16, ribs * 16, { s: s + 30, n: 2 });
  const hair = fib(x, y, ribs * 12, { s: s + 40, len: 0.6, wid: 0.08 })[0];
  const h = h0 * (1 - 0.1 * fuzz) + fuzz * (0.1 * n + 0.2 * hair);
  const k = clamp(h);
  for (let i = 0; i < 3; i += 1) {
    const [base, shadow, light] = [u(i), u(4 + i), u(8 + i)];
    const v = mix(mix(shadow, base, smooth(0.08, 0.6, k)), light, 0.6 * smooth(0.62, 1, k)) * (0.96 + 0.08 * tone);
    c[i] = mix(v, light, fuzz * 0.3 * hair);
  }
  return h;
};

function folds(u: Uniforms, p: [number, number], s: number, c: Rgb): void {
  const [dx, dy] = [u(28), u(29)];
  let [slope, crest] = [0, 0];
  for (let f = 0; f < 3; f += 1) {
    const wt = 1 / (1 + 1.6 * f);
    const [ex, ey] = [dx - dy * (f - 1) * 0.35, dy + dx * (f - 1) * 0.35];
    const l = Math.hypot(ex, ey);
    const warp = u(23) * fbm(p[0] * (1.5 + f), p[1] * (1.5 + f), 1024, { s: s + 10 + f * 4, n: 3 });
    const ph = fract(((p[0] * ex + p[1] * ey) / l) * u(19) * (1 + 0.45 * f) + warp);
    slope += Math.cos(3.1415927 * ph) * wt;
    crest = Math.max(crest, Math.sin(3.1415927 * ph) * wt);
  }
  const sh = clamp(0.5 + 0.3 * slope);
  const gloss = smooth(0.7, 1, sh) * crest;
  for (let i = 0; i < 3; i += 1) {
    const [deep, mid, light] = [u(16 + i), u(20 + i), u(24 + i)];
    c[i] = mix(mix(deep, mid, smooth(0.15, 0.6, sh)), light, smooth(0.6, 0.95, sh)) + u(27) * gloss * gloss * light;
  }
}

/** Paints mass `i` over `c`; returns its streak noise and its coverage (none where its warped edge cannot reach). */
function mass(u: Uniforms, i: number, at: { p: [number, number]; s: number }, c: Rgb): [number, number] {
  const o = 32 + i * 20;
  const v = (k: number): number => u(o + k);
  const [x, y, sx, sy, ax, ay] = [v(0), v(1), v(2), v(3), v(4), v(5)];
  const [dx, dy] = [at.p[0] - x, at.p[1] - y];
  const lx = (dx * ax + dy * ay) / sx;
  const ly = (dy * ax - dx * ay) / sy / Math.max(mix(1, Math.sqrt(Math.max(1 - lx * lx, 0)), v(16)), 0.05);
  if (Math.hypot(lx, ly) > 1 + 0.5 * v(11)) return [0, 0];
  const r = Math.hypot(lx, ly) + v(11) * (fbm(at.p[0] * 9, at.p[1] * 9, 1024, { s: at.s + 60 + i, n: 4 }) - 0.5);
  const cover = 1 - smooth(1 - v(6), 1, r);
  const n = v(7) > 0
    ? fract(r * 2.6 + 1.1 * fbm((Math.atan2(ly, lx) / 6.2831853 + 0.5) * 6, r, 6, { s: at.s + 80 + i, n: 2 }))
    : 0.6 * fbm(lx * 2 + i * 7, ly * 4, 1024, { s: at.s + 80, n: 2 }) + 0.4 * vn(lx * 3, ly * 14, 1024, at.s + 90);
  const lt = clamp(0.5 - 0.4 * ly + v(15) * (n - 0.5) * 2);
  for (let k = 0; k < 3; k += 1) {
    const m = mix(v(8 + k), v(12 + k), smooth(0.2, 0.9, lt)) * (0.85 + 0.15 * (1 - r * r));
    c[k] = mix(c[k] ?? 0, m, cover);
  }
  return [n, cover];
}

const painted: Surface = (u, x, y, c) => {
  const s = u(3);
  const p: [number, number] = [x * u(12), y];
  const [bx, by, len, brush] = [u(8), u(9), u(10), u(11)];
  const b = fbm((p[0] * bx + p[1] * by) * len, (p[1] * bx - p[0] * by) * len * 4, 1024, { s, n: 3 });
  const tooth = vn(p[0] * 240, p[1] * 240, 1024, s + 7) - 0.5;
  const ground = 1 + u(14) * (fbm(p[0] * 3, p[1] * 3, 1024, { s: s + 1, n: 3 }) - 0.5) * 2;
  for (let i = 0; i < 3; i += 1) c[i] = u(i) * ground;
  if (u(19) > 0) folds(u, p, s, c);
  let top = 0;
  for (let i = 0; i < u(13); i += 1) {
    const [n, cover] = mass(u, i, { p, s }, c);
    top = mix(top, n, cover);
  }
  const glaze = u(7) * fbm(p[0] * 1.5, p[1] * 1.5, 1024, { s: s + 3, n: 3 });
  const stroke = 1 + brush * ((b - 0.5) * 1.2 + tooth * 0.5);
  for (let i = 0; i < 3; i += 1) c[i] = mix((c[i] ?? 0) * stroke, u(4 + i), glaze);
  return 0.5 + brush * (b - 0.5) + 0.15 * top;
};

/** Each kind's painter, by its number in `KINDS`. */
export const FIELDS: readonly Surface[] = [paper, knit, painted];

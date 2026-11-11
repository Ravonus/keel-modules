// A shape tree meshed by surface nets over a sparse grid: space is cut into blocks of 8³ cells, only blocks the
// surface passes through are sampled, a vertex sits in every cell the surface crosses and is pulled onto the
// surface, and a quad joins the four cells round every crossed edge. Normals come from the field itself, and how
// open each vertex lies to the light from two steps out along its normal.

import { compile } from "./compile.js";
import { blend } from "./sdf.js";
import type { Ball } from "./compile.js";
import type { Field, Node, V3 } from "./sdf.js";

/** A mesh as flat arrays. */
export interface Surface {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** How open each vertex lies, 0 shut to 1 open. */
  readonly open: Float32Array;
  readonly index: Uint32Array;
}

export interface Grid {
  /** The box to mesh within. */
  readonly lo: V3;
  readonly hi: V3;
  /** A cell's edge in metres. */
  readonly cell: number;
  /** How far out the openness looks, in metres; 0 for none. */
  readonly reach: number;
  /** Other shapes that shade this one but are not meshed with it. */
  readonly shade?: Node;
}

/** Cells along a block's edge, corners along it, and two-cell cubes along it. */
const B = 8;
const C = B + 1;
const S = B / 2;
const ROOT3 = 1.7320508075688772;

interface Block {
  readonly field: Field;
  readonly ball: Ball;
  /** The block's low corner in space, and its place in the grid of blocks. */
  readonly o: V3;
  readonly at: V3;
  readonly values: Float64Array;
  readonly verts: Int32Array;
  wide?: Field;
}

interface Build {
  readonly node: Node;
  readonly grid: Grid;
  readonly nb: readonly [number, number, number];
  readonly blocks: (Block | undefined)[];
  readonly pos: number[];
  readonly owner: number[];
  readonly nor: number[];
  readonly tri: number[];
}

interface Sampling {
  readonly field: Field;
  readonly o: V3;
  readonly h: number;
  readonly values: Float64Array;
}

/** Sample the 3³ corners of the two-cell cube `c` (its index among the block's 4³), those not sampled yet. */
function cube(s: Sampling, c: number): void {
  const a = (c & 3) * 2;
  const b = ((c >> 2) & 3) * 2;
  const d = (c >> 4) * 2;
  for (let n = 0; n < 27; n += 1) {
    const i = a + (n % 3);
    const j = b + (Math.floor(n / 3) % 3);
    const k = d + Math.floor(n / 9);
    const v = (k * C + j) * C + i;
    if (Number.isNaN(s.values[v] ?? 0)) s.values[v] = s.field(s.o[0] + i * s.h, s.o[1] + j * s.h, s.o[2] + k * s.h);
  }
}

/**
 * A block's corner values. The block is taken as 4³ cubes of two cells; a cube whose centre lies further from the
 * surface than its corners reach cannot be crossed, so only its centre is sampled and its corners take that value
 * (right in sign, which is all an uncrossed cell needs). Every corner of a cube that may be crossed is sampled.
 */
function corners8(field: Field, o: V3, h: number): Float64Array {
  const s: Sampling = { field, o, h, values: new Float64Array(C * C * C).fill(Number.NaN) };
  const far = new Float64Array(S * S * S);
  const reach = ROOT3 * h * 1.15 + h * 0.25;
  for (let c = 0; c < S * S * S; c += 1) {
    const d = field(o[0] + ((c & 3) * 2 + 1) * h, o[1] + (((c >> 2) & 3) * 2 + 1) * h, o[2] + ((c >> 4) * 2 + 1) * h);
    far[c] = d;
    if (Math.abs(d) <= reach) cube(s, c);
  }
  for (let v = 0; v < C * C * C; v += 1) {
    if (!Number.isNaN(s.values[v] ?? 0)) continue;
    const [i, j, k] = [v % C, Math.floor(v / C) % C, Math.floor(v / (C * C))];
    s.values[v] = far[(Math.min(S - 1, k >> 1) * S + Math.min(S - 1, j >> 1)) * S + Math.min(S - 1, i >> 1)] ?? 0;
  }
  return s.values;
}

function sampled(build: Build, at: V3): Block | undefined {
  const { cell: h, lo } = build.grid;
  const o: V3 = [lo[0] + at[0] * B * h, lo[1] + at[1] * B * h, lo[2] + at[2] * B * h];
  const ball: Ball = [o[0] + (B * h) / 2, o[1] + (B * h) / 2, o[2] + (B * h) / 2, (B * h * ROOT3) / 2];
  const field = compile(build.node, ball, 2 * h);
  if (!field) return undefined;
  if (Math.abs(field(ball[0], ball[1], ball[2])) > ball[3] + h) return undefined;
  const values = corners8(field, o, h);
  let neg = 0;
  for (const d of values) if (d < 0) neg += 1;
  if (neg === 0 || neg === C * C * C) return undefined;
  return { field, ball, o, at, values, verts: new Int32Array(B * B * B).fill(-1) };
}

/** A cell's twelve edges, as the corners at their two ends. */
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3] as const;
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7] as const;
/** Where a cell's eight corners lie in a block's corner values, from the cell's low corner. */
const CORNER_AT = [0, 1, C, C + 1, C * C, C * C + 1, C * C + C, C * C + C + 1] as const;

/** The corners of the cell whose low corner is `o` (an index into `values`) into `v`: low x first, then y, z. */
function corners(values: Float64Array, o: number, v: Float64Array): void {
  for (let n = 0; n < 8; n += 1) v[n] = values[o + (CORNER_AT[n] ?? 0)] ?? 0;
}

/** Where the surface crosses a cell, as a share of the cell from its low corner, into `out`; false if it does not. */
function crossing(v: Float64Array, out: Float64Array): boolean {
  let [x, y, z, n] = [0, 0, 0, 0];
  for (let e = 0; e < 12; e += 1) {
    const a = EDGE_A[e] ?? 0;
    const b = EDGE_B[e] ?? 0;
    const va = v[a] ?? 0;
    const vb = v[b] ?? 0;
    if (va < 0 === vb < 0) continue;
    const t = va / (va - vb);
    x += (a & 1) + ((b & 1) - (a & 1)) * t;
    y += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
    z += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
    n += 1;
  }
  if (n === 0) return false;
  out[0] = x / n;
  out[1] = y / n;
  out[2] = z / n;
  return true;
}

/** The distance at shares `t` across a cell whose corners are `v`, read between them. */
function between(v: Float64Array, t: Float64Array): number {
  const u = t[0] ?? 0;
  const w = t[1] ?? 0;
  const s = t[2] ?? 0;
  const at = (i: number): number => v[i] ?? 0;
  const a = at(0) + (at(1) - at(0)) * u;
  const b = at(2) + (at(3) - at(2)) * u;
  const c = at(4) + (at(5) - at(4)) * u;
  const d = at(6) + (at(7) - at(6)) * u;
  const near = a + (b - a) * w;
  return near + (c + (d - c) * w - near) * s;
}

/** The field's gradient at `p`, by four samples on a tetrahedron `e` across, normalised. */
export function gradient(f: Field, p: readonly [number, number, number], e: number): [number, number, number] {
  const [x, y, z] = p;
  const a = f(x + e, y - e, z - e);
  const b = f(x - e, y - e, z + e);
  const c = f(x - e, y + e, z - e);
  const d = f(x + e, y + e, z + e);
  const gx = a - b - c + d;
  const gy = -a - b + c + d;
  const gz = -a + b - c + d;
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
  return l > 0 ? [gx / l, gy / l, gz / l] : [0, 1, 0];
}

const CORNERS = new Float64Array(8);
const AT = new Float64Array(3);

/** A vertex in every crossed cell of a block, pulled onto the surface along the field's gradient (by at most half a
 * cell, its distance read from the cell's corners rather than asked of the field again), with the gradient as its
 * normal. */
function vertices(build: Build, block: Block, index: number): void {
  const { cell: h } = build.grid;
  for (let c = 0; c < B * B * B; c += 1) {
    const i = c & 7;
    const j = (c >> 3) & 7;
    const k = c >> 6;
    corners(block.values, (k * C + j) * C + i, CORNERS);
    if (!crossing(CORNERS, AT)) continue;
    const p: [number, number, number] = [
      block.o[0] + (i + (AT[0] ?? 0)) * h, block.o[1] + (j + (AT[1] ?? 0)) * h, block.o[2] + (k + (AT[2] ?? 0)) * h,
    ];
    const g = gradient(block.field, p, h / 4);
    const m = Math.max(-h / 2, Math.min(h / 2, between(CORNERS, AT)));
    block.verts[c] = build.owner.length;
    build.owner.push(index);
    build.pos.push(p[0] - g[0] * m, p[1] - g[1] * m, p[2] - g[2] * m);
    build.nor.push(g[0], g[1], g[2]);
  }
}

function vertexAt(build: Build, g: readonly number[]): number {
  const [nbx, nby] = build.nb;
  const [gi = -1, gj = -1, gk = -1] = g;
  if (gi < 0 || gj < 0 || gk < 0) return -1;
  const block = build.blocks[((gk >> 3) * nby + (gj >> 3)) * nbx + (gi >> 3)];
  return block ? (block.verts[((gk & 7) * B + (gj & 7)) * B + (gi & 7)] ?? -1) : -1;
}

function quad(build: Build, q: readonly number[], flip: boolean): void {
  const [a = -1, b = -1, c = -1, d = -1] = flip ? [q[3], q[2], q[1], q[0]] : q;
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  const p = build.pos;
  const dist = (u: number, v: number): number => {
    const x = (p[u * 3] ?? 0) - (p[v * 3] ?? 0);
    const y = (p[u * 3 + 1] ?? 0) - (p[v * 3 + 1] ?? 0);
    const z = (p[u * 3 + 2] ?? 0) - (p[v * 3 + 2] ?? 0);
    return x * x + y * y + z * z;
  };
  if (dist(a, c) <= dist(b, d)) build.tri.push(a, b, c, a, c, d);
  else build.tri.push(a, b, d, b, c, d);
}

/** The cells round each crossed edge leading back from a cell, for x, y and z. */
const ROUND = [
  [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]],
  [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
  [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]],
] as const;
const STEP = [1, C, C * C] as const;

function faces(build: Build, block: Block): void {
  for (let c = 0; c < B * B * B; c += 1) {
    if (block.verts[c] === -1) continue;
    const [i, j, k] = [c & 7, (c >> 3) & 7, c >> 6];
    const here = (k * C + j) * C + i;
    const v0 = (block.values[here] ?? 0) < 0;
    const g: V3 = [block.at[0] * B + i, block.at[1] * B + j, block.at[2] * B + k];
    ROUND.forEach((round, axis) => {
      if (v0 === (block.values[here + (STEP[axis] ?? 0)] ?? 0) < 0) return;
      quad(build, round.map((r) => vertexAt(build, [g[0] + r[0], g[1] + r[1], g[2] + r[2]])), !v0);
    });
  }
}

/** How open vertex `v` lies: the field sampled two steps out along its normal. */
function openness(f: Field, build: Build, v: number, reach: number): number {
  const { pos, nor } = build;
  let [shut, weight, total] = [0, 1, 0];
  for (let i = 1; i <= 2; i += 1) {
    const s = (reach * i) / 2;
    const at = (a: number): number => (pos[v * 3 + a] ?? 0) + (nor[v * 3 + a] ?? 0) * s;
    shut += (weight * Math.max(0, s - f(at(0), at(1), at(2)))) / s;
    total += weight;
    weight *= 0.7;
  }
  return Math.max(0, 1 - shut / total);
}

function finish(build: Build): Surface {
  const { cell: h, reach, shade } = build.grid;
  const count = build.owner.length;
  const open = new Float32Array(count).fill(1);
  const all = shade ? blend(0, build.node, shade) : build.node;
  for (let v = 0; reach > 0 && v < count; v += 1) {
    const block = build.blocks[build.owner[v] ?? 0];
    if (!block) continue;
    const ball: Ball = [block.ball[0], block.ball[1], block.ball[2], block.ball[3] + reach];
    block.wide ??= compile(all, ball, 2 * h) ?? block.field;
    open[v] = openness(block.wide, build, v, reach);
  }
  const normal = Float32Array.from(build.nor);
  return { position: Float32Array.from(build.pos), normal, open, index: Uint32Array.from(build.tri) };
}

/** Mesh a shape within a box at a cell size. */
export function surface(node: Node, grid: Grid): Surface {
  const { lo, hi, cell } = grid;
  const nb = [0, 1, 2].map((a) => Math.ceil(((hi[a] ?? 0) - (lo[a] ?? 0)) / cell / B)) as [number, number, number];
  const build: Build = { node, grid, nb, blocks: [], pos: [], owner: [], nor: [], tri: [] };
  const count = nb[0] * nb[1] * nb[2];
  for (let i = 0; i < count; i += 1) {
    build.blocks[i] = sampled(build, [i % nb[0], Math.floor(i / nb[0]) % nb[1], Math.floor(i / (nb[0] * nb[1]))]);
  }
  build.blocks.forEach((block, i) => {
    if (block) vertices(build, block, i);
  });
  for (const block of build.blocks) if (block) faces(build, block);
  return finish(build);
}

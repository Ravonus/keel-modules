// The wrap: the head's net shot from a ball of rows and columns, lids, eyeballs and lips in it.

import { FAR, UP, clamp, cross, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Person } from "../body/person.js";
import type { Capsule } from "../mesh/parts.js";
import { bodyOf } from "../motion/pose.js";
import { boneOfPart } from "../body/bones.js";
import {
  cellPoint,
  dented,
  eachCell,
  gridOver,
  inflated,
  lofted,
  meltIn,
  netFaces,
  normalAt,
  ownerOf,
  partDistance,
  roughen,
  skirtWeights,
  unrolled,
  unseen,
  weightsAt,
} from "../body/field.js";
import type { Grid, Layer, Net } from "../body/field.js";
import { NO_EDGE } from "../body/cage.js";
import { FABRICS } from "../clothes/fabric.js";
import { headVertex } from "./lock.js";
import { smooth } from "./paint.js";

/**
 * Where a head's fixed mesh goes: its centre and radius in metres, and each landmark it is laid through, in head radii,
 * as they lie on the finished head.
 */
export interface Wrap {
  readonly c: Vec;
  readonly R: number;
  readonly eyeX: number;
  readonly eye: number;
  readonly pupil: number;
  readonly sn: number;
  readonly sto: number;
  readonly men: number;
  readonly mouth: number;
  /**
   * The neck it runs down into, as `lower` meets it: how far back its middle lies, how wide it is and how deep behind,
   * all in head radii.
   */
  readonly neck: readonly [z: number, wide: number, back: number];
  /** How many times its rows and columns are halved. */
  readonly level: number;
}

/**
 * How far round a landmark `x` lies, and how high a landmark `y`, seen from a head's centre on a face about a radius
 * off.
 */
const bearing = (v: number): number => Math.atan2(v, 0.95);

/**
 * How far an eye opens at `u` eyes outward of its middle, up and down: the same almond the renderer paints, set a
 * little down at its inner end.
 */
function lidsAt(u: number): readonly [number, number] {
  const w = 1.42;
  const k = clamp(1 - (u * u) / (w * w), 0, 1);
  const m = clamp(-u / w, -1.4, 1.4);
  return [0.5 * k ** 0.62 * (1 - 0.2 * m) - 0.1 * m + 0.02, -0.34 * k ** 0.8 * (1 - 0.4 * m) - 0.1 * m + 0.02];
}

/** How near two rows or columns of a head may lie, in radians of it. */
const MESH_GAP = 0.016;

/** A sorted list with anything nearer its neighbour than `gap` left out, then halved `level` times. */
function spaced(list: readonly number[], gap: number, level: number): readonly number[] {
  const kept = [...list]
    .sort((a, b) => a - b)
    .reduce<number[]>((so, v) => (so.length === 0 || v - (so[so.length - 1] ?? v) > gap ? [...so, v] : so), []);
  if (level <= 0) return kept;
  const halved = kept.flatMap((v, i) => (i === 0 ? [v] : [((kept[i - 1] ?? v) + v) / 2, v]));
  return spaced(halved, MESH_GAP, level - 1);
}

/** A head's rows, chin to crown, one along every line of a face. */
function rowsOf(w: Wrap): readonly number[] {
  const { pupil: y, eye: e, sn, sto, men } = w;
  const jaw = [men, men + 0.12, (men + sto) / 2, sto - 0.2, sto - 0.1, sto - 0.03, sto, sto + 0.03, sto + 0.09];
  const eyes = [y - e * 0.36 - 0.12, y - e * 0.36, y - e * 0.1, y + e * 0.22, y + e * 0.54, y + e * 0.8, y + e * 1.6];
  const face = [...jaw, (sto + sn) / 2, sn, sn + 0.1, ...eyes, y + e * 2.6, 0.72, 0.95, 1.2];
  return spaced([-1.5, -1.3, -1.12, ...face.map(bearing), 1.05, 1.22, 1.38, 1.5], 0.012, w.level);
}

/** A head's columns, right round from the back: every landmark across a face, both sides alike. */
function columnsOf(w: Wrap): readonly number[] {
  const { eyeX: x, eye: e, mouth } = w;
  const one = [0.05, 0.1, 0.17, mouth, x - e * 1.42, x - e * 0.7, x, x + e * 0.7, x + e * 1.42, x + e * 1.42 + 0.08];
  const half = [...one.map(bearing), 0.9, 1.1, 1.3, 1.57, 1.85, 2.2, 2.55, 2.85];
  // (Thinned on one side and mirrored, or an eye's corner could land on a column on its left and miss one on its
  // right.)
  const side = spaced([0, ...half, Math.PI], 0.012, w.level).slice(1, -1);
  return [...side.map((a) => -a).reverse(), 0, ...side, Math.PI];
}

/** How deep the field is at a point. */
function fieldAt(grid: Grid, at: Vec): number {
  const { n, field, min, h } = grid;
  const g = [0, 1, 2].map((i) => clamp(((at[i] ?? 0) - (min[i] ?? 0)) / h, 0, (n[i] ?? 2) - 1.001));
  const [x = 0, y = 0, z = 0] = g;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const f = (a: number, b: number, c: number): number =>
    field[x0 + a + (y0 + b) * n[0] + (z0 + c) * n[0] * n[1]] ?? FAR;
  const near = mix(mix(f(0, 0, 0), f(1, 0, 0), fx), mix(f(0, 1, 0), f(1, 1, 0), fx), fy);
  const deep = mix(mix(f(0, 0, 1), f(1, 0, 1), fx), mix(f(0, 1, 1), f(1, 1, 1), fx), fy);
  return mix(near, deep, fz);
}

/** The four weights of a cubic B-spline a share `t` of the way along a cell. */
const splineOf = (t: number): readonly number[] => {
  const u = 1 - t;
  return [
    (u * u * u) / 6,
    (3 * t * t * t - 6 * t * t + 4) / 6,
    (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6,
    (t * t * t) / 6,
  ];
};

/** The field at a point, smoothly: a grid's linear cells would print on a fixed mesh fine enough to show them. */
function smoothAt(grid: Grid, at: Vec): number {
  const { n, field, min, h } = grid;
  const g = [0, 1, 2].map((i) => clamp(((at[i] ?? 0) - (min[i] ?? 0)) / h, 1, (n[i] ?? 4) - 3.001));
  const [gx = 0, gy = 0, gz = 0] = g;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const wx = splineOf(gx - x0);
  const wy = splineOf(gy - y0);
  const wz = splineOf(gz - z0);
  let sum = 0;
  for (let c = 0; c < 4; c += 1) {
    for (let b = 0; b < 4; b += 1) {
      for (let a = 0; a < 4; a += 1) {
        const at3 = field[x0 + a - 1 + (y0 + b - 1) * n[0] + (z0 + c - 1) * n[0] * n[1]] ?? FAR;
        sum += (wx[a] ?? 0) * (wy[b] ?? 0) * (wz[c] ?? 0) * at3;
      }
    }
  }
  return sum;
}

/** How far along a ray from a head's centre its surface lies, coming in from outside. */
function shotAt(grid: Grid, w: Wrap, dir: Vec): number {
  const step = grid.h * 0.75;
  const along = (t: number): Vec => madd(w.c, dir, t);
  let t = w.R * 2.1;
  while (t > 0 && fieldAt(grid, along(t)) > 0) t -= step;
  if (t <= 0) return w.R * 0.8;
  let [low, high] = [t - step, t + step * 2];
  for (let i = 0; i < 9; i += 1) {
    const mid = (low + high) / 2;
    if (smoothAt(grid, along(mid)) > 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/** A head's distances eased along its rows and columns, so a step in the solid does not print through. */
export function smoothedFar(far: Float64Array, rows: number, cols: number, passes: number): void {
  for (let i = 0; i < passes; i += 1) {
    const was = far.slice();
    const prior = (r: number, c: number): number => was[clamp(r, 0, rows - 1) * cols + ((c + cols) % cols)] ?? 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const round = prior(r - 1, c) + prior(r + 1, c) + prior(r, c - 1) + prior(r, c + 1);
        far[r * cols + c] = 0.5 * prior(r, c) + 0.125 * round;
      }
    }
  }
}

/** How far past a corner of an eye its lids have let go of the rows they bend. */
const LID_REACH = 2.4;

/** The row nearest a share of an eye off its pupil. */
const openRow = (rows: readonly number[], w: Wrap, by: number): number => {
  const want = bearing(w.pupil + by * w.eye);
  return rows.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
};

/** One column's lids: its rows through the eye bent onto the almond, letting go past each corner so no row steps. */
function lidRows(rows: readonly number[], w: Wrap, a: number): ((row: number) => number) | null {
  const u = (Math.abs(Math.tan(a) * 0.95) - w.eyeX) / w.eye;
  const free = smooth(1.42, LID_REACH, Math.abs(u));
  if (Math.abs(a) > 1.2 || free >= 1) return null;
  const top = rows.indexOf(openRow(rows, w, 0.54));
  const low = rows.indexOf(openRow(rows, w, -0.36));
  const [up, down] = lidsAt(u);
  const high = bearing(w.pupil + up * w.eye);
  const under = bearing(w.pupil + down * w.eye);
  const lifted = (rows[top] ?? 0) - high;
  const dropped = under - (rows[low] ?? 0);
  const span = bearing(w.eye * 1.7);
  const bent = (row: number, was: number, out: number): number => {
    if (row > top) return was - lifted * (1 - smooth(0, span, out));
    if (row < low) return was + dropped * (1 - smooth(0, span, out));
    return mix(under, high, (row - low) / Math.max(1, top - low));
  };
  return (row) => {
    const was = rows[row] ?? 0;
    const out = row > top ? was - (rows[top] ?? 0) : (rows[low] ?? 0) - was;
    return mix(bent(row, was, out), was, free);
  };
}

/** A head's rows and columns, and the rows its eyes open between. */
interface Eyes {
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  readonly w: Wrap;
  readonly top: number;
  readonly low: number;
}

function eyesOf(rows: readonly number[], cols: readonly number[], w: Wrap): Eyes {
  return { rows, cols, w, top: rows.indexOf(openRow(rows, w, 0.54)), low: rows.indexOf(openRow(rows, w, -0.36)) };
}

/** Whether a quad of a head is the opening of an eye. */
function inEye({ cols, w, top, low }: Eyes, row: number, col: number): boolean {
  const within = (a: number): boolean =>
    Math.abs(a) < 1.2 && Math.abs(Math.abs(Math.tan(a) * 0.95) - w.eyeX) <= w.eye * 1.4201;
  return row >= low && row < top && within(cols[col] ?? 9) && within(cols[(col + 1) % cols.length] ?? 9);
}

/** A ball of an eye: where it lies and how big. */
interface Ball {
  readonly at: Vec;
  readonly r: number;
}

/** What one ball of an eye is: where it lies and how big, sat just behind the lids. */
function ballOf(net: Net, from: number, w: Wrap, side: number): Ball {
  const r = w.R * w.eye * 1.5;
  const x = w.c[0] + side * w.eyeX * w.R;
  const y = w.c[1] + w.pupil * w.R;
  // (A ball rests where the lower lid does: any further forward and it pushes a pouch through the cheek.)
  let [front, seen] = [0, 0];
  for (let v = from; v < net.position.length / 3; v += 1) {
    const dx = Math.abs((net.position[v * 3] ?? 0) - x) / (w.R * w.eye);
    const dy = Math.abs((net.position[v * 3 + 1] ?? 0) - y + w.R * w.eye * 0.5) / (w.R * w.eye);
    if (dx < 0.7 && dy < 0.3 && (net.position[v * 3 + 2] ?? 0) > w.c[2]) {
      front += net.position[v * 3 + 2] ?? 0;
      seen += 1;
    }
  }
  return { at: [x, y, (seen > 0 ? front / seen : w.c[2] + w.R * 0.8) - r + w.R * 0.006], r };
}

/**
 * A ball of an eye, its front half: the renderer paints the white and the iris on it, and a lid over it when it shuts.
 */
function eyeball(net: Net, ball: Ball, skin: number): void {
  const first = net.position.length / 3;
  const rings = 7;
  const around = 16;
  const put1 = (th: number, ph: number): void => {
    const n: Vec = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const at = madd(ball.at, n, ball.r);
    const cloth = [at[0], at[2], at[1], NO_EDGE] as const;
    headVertex(net, { at, normal: n, role: skin, fabric: FABRICS.skin, loose: 0, cloth });
  };
  for (let i = 0; i <= rings; i += 1) {
    for (let j = 0; j < around; j += 1) put1((i / rings) * 1.3 + 1e-3, (j / around) * Math.PI * 2);
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < around; j += 1) {
      const a = first + i * around + j;
      const b = first + i * around + ((j + 1) % around);
      const c = a + around;
      const d = b + around;
      net.index.push(a, c, d, a, d, b);
    }
  }
}

/** How a lid sits on its ball: the vertices on its edge, and how far the skin stands off the ball. */
interface Seated {
  readonly rim: ReadonlySet<number>;
  readonly lift: number;
}

/** One vertex laid over a ball, as a lid lies: on the ball if on a lid's edge, eased down onto it otherwise. */
function overBall(net: Net, v: number, ball: Ball, { rim, lift }: Seated): void {
  const dx = (net.position[v * 3] ?? 0) - ball.at[0];
  const dy = (net.position[v * 3 + 1] ?? 0) - ball.at[1];
  const left = ball.r * ball.r - dx * dx - dy * dy;
  if (left <= 0) return;
  const over = ball.at[2] + Math.sqrt(left) + lift;
  const z = net.position[v * 3 + 2] ?? 0;
  const gap = over - z;
  const ease = ball.r * 0.16;
  if (z < ball.at[2]) return;
  if (rim.has(v)) {
    net.position[v * 3 + 2] = over;
    return;
  }
  const eased = 0.5 * (gap + Math.sqrt(gap * gap + ease * ease)) * smooth(0, 0.8, left / (ball.r * ball.r));
  net.position[v * 3 + 2] = z + eased;
}

/**
 * Lays a head's skin over the balls of its eyes, as a lid lies, and seats the edge of each lid on its ball, so the eye
 * sits in them.
 */
function overBalls(net: Net, from: number, balls: readonly Ball[], seated: Seated): void {
  for (let v = from; v < net.position.length / 3; v += 1) {
    for (const ball of balls) overBall(net, v, ball, seated);
  }
}

/** Normals of a fixed head, from its own rows and columns. */
export function headNormals(net: Net, from: number, rows: number, cols: number): void {
  const at = (r: number, c: number): Vec => {
    const v = from + clamp(r, 0, rows - 1) * cols + ((c + cols) % cols);
    return [net.position[v * 3] ?? 0, net.position[v * 3 + 1] ?? 0, net.position[v * 3 + 2] ?? 0];
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const n = unit(cross(sub(at(r, c + 1), at(r, c - 1)), sub(at(r + 1, c), at(r - 1, c))), UP);
      const v = from + r * cols + c;
      net.normal[v * 3] = n[0];
      net.normal[v * 3 + 1] = n[1];
      net.normal[v * 3 + 2] = n[2];
    }
  }
}

/**
 * How far lips stand off a face at `x`, `y`, in head radii: an upper and a fuller lower, parted by the line between
 * them.
 */
function lipAt(w: Wrap, x: number, y: number): number {
  const k = clamp(1 - (x * x) / (w.mouth * w.mouth * 1.1), 0, 1);
  const up = (y - w.sto - 0.06 * k) / 0.05;
  const down = (y - w.sto + 0.08 * k) / 0.065;
  const lips = k ** 0.5 * (0.026 * Math.exp(-up * up) + 0.034 * Math.exp(-down * down));
  return lips - 0.03 * k ** 0.5 * Math.exp(-(((y - w.sto) / 0.014) ** 2));
}

/**
 * The back of a skull comes in to the neck under it, and the corners of the jaw tuck in with it: nothing behind the
 * face hangs out over the neck like a bowl.
 */
function napeOf(w: Wrap, at: Vec): Vec {
  const q = scale(sub(at, w.c), 1 / w.R);
  const [nz, wide, back] = w.neck;
  const pull = smooth(0.3, -0.8, q[1]) * smooth(0.5, -0.1, q[2]);
  if (pull <= 0) return at;
  const a = Math.atan2(q[0] / wide, (q[2] - nz) / back);
  return madd(w.c, [mix(q[0], Math.sin(a) * wide, pull), q[1], mix(q[2], nz + Math.cos(a) * back, pull)], w.R);
}

/** A head being wrapped: its layer, the solid it is shot onto, where its mesh goes, and the role its skin is. */
interface Head {
  readonly layer: Layer;
  readonly grid: Grid;
  readonly w: Wrap;
  readonly skin: number;
}

/** The rows and columns a head is shot along, with its lids bent into them, from the first vertex it takes. */
interface Shot {
  readonly eyes: Eyes;
  readonly from: number;
  readonly ray: (r: number, c: number) => Vec;
}

function shotOf(net: Net, w: Wrap): Shot {
  const rows = rowsOf(w);
  const cols = columnsOf(w);
  const lids = cols.map((a) => lidRows(rows, w, a));
  const ray = (r: number, c: number): Vec => {
    const a = cols[c] ?? 0;
    const el = lids[c]?.(r) ?? rows[r] ?? 0;
    return [Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)];
  };
  return { eyes: eyesOf(rows, cols, w), from: net.position.length / 3, ray };
}

/** How far the surface lies along every ray, eased so no step of the solid prints through. */
function farOf({ grid, w }: Head, { eyes, ray }: Shot): Float64Array {
  const { rows, cols } = eyes;
  const far = new Float64Array(rows.length * cols.length);
  rows.forEach((_, r) => {
    cols.forEach((__, c) => {
      far[r * cols.length + c] = shotAt(grid, w, ray(r, c));
    });
  });
  smoothedFar(far, rows.length, cols.length, 2);
  return far;
}

/** Whether a vertex is on the edge of a lid: in a row the eye opens between, on a quad of the opening either side. */
function onLid(eyes: Eyes, r: number, c: number): boolean {
  const { cols, top, low } = eyes;
  const row = Math.min(r, top - 1);
  const before = c - 1 < 0 ? cols.length - 1 : c - 1;
  if (!(inEye(eyes, row, c) || inEye(eyes, row, before))) return false;
  return r === top || r === low;
}

/** The vertices of a head, row by row: which lie on a lid's edge, and which are hidden under what is worn over it. */
function headVertices(net: Net, head: Head, shot: Shot, far: Float64Array): { rim: Set<number>; hidden: Set<number> } {
  const { layer, w, skin } = head;
  const { eyes, from, ray } = shot;
  const { rows, cols } = eyes;
  const rim = new Set<number>();
  const hidden = new Set<number>();
  rows.forEach((_, r) => {
    cols.forEach((a, c) => {
      const dir = ray(r, c);
      const el = Math.asin(dir[1]);
      const v = from + r * cols.length + c;
      const out = (far[r * cols.length + c] ?? 0) + w.R * lipAt(w, Math.tan(a) * 0.95, Math.tan(el) * 0.95);
      const at = napeOf(w, madd(w.c, dir, out));
      if (onLid(eyes, r, c)) rim.add(v);
      if (unseen(layer, at)) hidden.add(v);
      const cloth = [at[0], at[2], at[1], NO_EDGE] as const;
      headVertex(net, { at, normal: dir, role: skin, fabric: layer.fabric, loose: 0, cloth });
    });
  });
  return { rim, hidden };
}

/** The faces of a head between its rows, leaving the openings of the eyes and anything wholly hidden. */
function headFaces(net: Net, { eyes, from }: Shot, hidden: ReadonlySet<number>): void {
  const { rows, cols } = eyes;
  for (let r = 0; r + 1 < rows.length; r += 1) {
    for (let c = 0; c < cols.length; c += 1) {
      if (inEye(eyes, r, c)) continue;
      const next = (c + 1) % cols.length;
      const a = from + r * cols.length + c;
      const b = from + r * cols.length + next;
      const d = a + cols.length;
      const e = b + cols.length;
      if (!(hidden.has(a) && hidden.has(b) && hidden.has(d) && hidden.has(e))) net.index.push(a, b, e, a, e, d);
    }
  }
}

/**
 * A head as a fixed mesh: every person the same rows and columns, laid through the same lines of a face, shot onto the
 * solid their head is melted from.
 */
function wrapHead(net: Net, head: Head): void {
  const { layer, w, skin } = head;
  const firstIndex = net.index.length;
  const shot = shotOf(net, w);
  const far = farOf(head, shot);
  const { rim, hidden } = headVertices(net, head, shot, far);
  headFaces(net, shot, hidden);
  relaxed(net, shot.from, firstIndex, layer.relax ?? 0);
  const balls = [-1, 1].map((side) => ballOf(net, shot.from, w, side));
  overBalls(net, shot.from, balls, { rim, lift: w.R * 0.004 });
  headNormals(net, shot.from, shot.eyes.rows.length, shot.eyes.cols.length);
  balls.forEach((ball) => {
    eyeball(net, ball, skin);
  });
}

/** What a shell is skinned with: its paint, the parts its bones are weighed from, and the body's roles and grid. */
export interface Skinned {
  readonly decals: readonly Capsule[];
  readonly weighed: readonly Capsule[];
  readonly roles: readonly string[];
  readonly cell: number;
}

/** A layer's solid: its parts melted into a grid, lofted, dented and roughened as it asks. */
function solidOf(layer: Layer, cell: number): { parts: readonly Capsule[]; grid: Grid } {
  const parts = layer.parts.map((c) => inflated(c, layer.lift));
  const grid = gridOver(parts, cell * layer.fine);
  parts.forEach((c, i) => {
    meltIn(grid, c, i);
    if (layer.loft && c.part === "skull") lofted(grid, layer.loft);
  });
  if (layer.dents) dented(grid, layer.dents);
  if (layer.locks) roughen(grid, layer.locks.head, layer.locks.kind, layer.locks.size);
  return { parts, grid };
}

/** One closed shell of a person, added to `net`, its bones from `weighed`. */
export function netOf(net: Net, layer: Layer, { decals, weighed, roles, cell }: Skinned): void {
  const { parts, grid } = solidOf(layer, cell);
  const bones = weighed.map((c) => boneOfPart(c.part));
  if (layer.wrap) {
    wrapHead(net, { layer, grid, w: layer.wrap, skin: Math.max(0, roles.indexOf("skin")) });
    return;
  }
  const { n } = grid;
  const firstVertex = net.position.length / 3;
  const firstIndex = net.index.length;
  const cells = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  const hidden = new Set<number>();
  eachCell(n, (x, y, z) => {
    const at = cellPoint(grid, x, y, z);
    if (!at) return;
    const i = x + y * n[0] + z * n[0] * n[1];
    cells[i] = net.position.length / 3;
    if (unseen(layer, at)) hidden.add(cells[i] ?? -1);
    net.position.push(...at);
    net.normal.push(...normalAt(grid, x, y, z));
    const painted = decals.find((c) => partDistance(c, at[0], at[1], at[2]) < 0);
    net.role.push(Math.max(0, roles.indexOf((painted ?? ownerOf(grid, parts, i))?.role ?? "skin")));
    const [a, b, w] = ownerOf(grid, parts, i)?.part === "skirt" ? skirtWeights(at) : weightsAt(weighed, bones, at);
    net.bones.push(a, b);
    net.weight.push(w);
    net.fabric.push(layer.fabric);
    net.loose.push(layer.free ? clamp((layer.free[0] - at[1]) / layer.free[1], 0, 1) : 0);
    net.cloth.push(at[0], at[2], at[1], NO_EDGE);
    net.soft.push(0);
  });
  const faces = netFaces(grid, cells);
  for (let i = 0; i < faces.length; i += 3) {
    const [a, b, c] = [faces[i] ?? 0, faces[i + 1] ?? 0, faces[i + 2] ?? 0];
    if (!(hidden.has(a) && hidden.has(b) && hidden.has(c))) net.index.push(a, b, c);
  }
  relaxed(net, firstVertex, firstIndex, layer.relax ?? 0);
}

/** Who each vertex shares a triangle with, from `from` on. */
function neighboursOf(index: readonly number[], from: number): Map<number, Set<number>> {
  const near = new Map<number, Set<number>>();
  for (let i = from; i < index.length; i += 3) {
    const tri = [index[i] ?? 0, index[i + 1] ?? 0, index[i + 2] ?? 0];
    tri.forEach((a, j) => {
      near.set(a, (near.get(a) ?? new Set<number>()).add(tri[(j + 1) % 3] ?? a).add(tri[(j + 2) % 3] ?? a));
    });
  }
  return near;
}

/**
 * A net's newest vertices each drawn toward their neighbours, a few times over: the positions a little, the normals
 * most of the way, for all the way loses a nose's flank.
 */
function relaxed(net: Net, firstVertex: number, firstIndex: number, passes: number): void {
  if (passes === 0) return;
  const near = neighboursOf(net.index, firstIndex);
  const blur = (list: number[], share: number): void => {
    const was = list.slice(firstVertex * 3);
    for (const [v, ns] of near) {
      for (let c = 0; c < 3; c += 1) {
        const mean = [...ns].reduce((sum, n) => sum + (was[(n - firstVertex) * 3 + c] ?? 0), 0) / ns.size;
        list[v * 3 + c] = mix(was[(v - firstVertex) * 3 + c] ?? 0, mean, share);
      }
    }
  };
  for (let pass = 0; pass < passes; pass += 1) {
    blur(net.position, 0.55);
    blur(net.normal, 0.8);
  }
  for (const v of near.keys()) {
    const n: Vec = [net.normal[v * 3] ?? 0, net.normal[v * 3 + 1] ?? 0, net.normal[v * 3 + 2] ?? 0];
    net.normal.splice(v * 3, 3, ...unit(n, UP));
  }
}

/** The parts of a bare body that are skin: nothing drawn on it, carved from it, or grown or worn over it. */
const BARE = /^(skirt|sole|hair|fringe|curl|bob|lock|fall|bun|tail)/;

function isSkin(c: Capsule): boolean {
  if (c.decal === true || c.carve === true || BARE.test(c.part)) return false;
  return c.role !== "eye" && c.role !== "lip" && c.role !== "hair" && c.role !== "beard";
}

/** A person with nothing on: every limb bare, so a body is whole under whatever is worn over it. */
export function bareParts(p: Person): readonly Capsule[] {
  const bare: Person = { ...p, outfit: { ...p.outfit, top: "tank", bottom: "skirt", shoe: "sandal", hat: "none", stripes: 0 } };
  return bodyOf(bare, "rest", 0, { at: [0, 0, 0], yaw: 0, rich: true })
    .capsules.filter(isSkin)
    .flatMap(unrolled)
    .map((c) => ({ ...c, role: c.role === "belly" || c.part === "snout" ? c.role : "skin" }));
}

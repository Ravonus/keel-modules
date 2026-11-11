// Signed distance shapes as a tree. A shape knows a sphere it lies within, so the mesher can leave out of a block
// every shape too far to matter there. Only plus, minus, times, divide, the square root, min, max and abs are used,
// so a shape's distances are the same bits on every engine.

/** A distance at a point. */
export type Field = (x: number, y: number, z: number) => number;

/** A point or a direction. */
export type V3 = readonly [number, number, number];

/** A rotation as three rows. */
export type M3 = readonly [number, number, number, number, number, number, number, number, number];

export interface Prim {
  readonly kind: "prim";
  /** Where it lies within: a centre and a radius (Infinity for a plane). */
  readonly bound: readonly [number, number, number, number];
  readonly f: Field;
}

export interface Op {
  readonly kind: "blend" | "carve" | "cut" | "fan";
  /** How far it melts, in metres. */
  readonly k: number;
  /** For a fan, how far each kid after the first melts into the first. */
  readonly ks?: readonly number[];
  readonly kids: readonly Node[];
  readonly bound: readonly [number, number, number, number];
}

/** A shape moved by a rotation and an offset: inside it, points are taken into the shape's own frame. */
export interface Frame {
  readonly kind: "frame";
  readonly rot: M3;
  readonly at: V3;
  readonly kid: Node;
  readonly bound: readonly [number, number, number, number];
}

/** A shape with a small field added to its distance: folds, ribs, a wave. */
export interface Bumped {
  readonly kind: "bump";
  readonly kid: Node;
  readonly f: Field;
  readonly bound: readonly [number, number, number, number];
}

export type Node = Prim | Op | Frame | Bumped;

export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Smooth minimum (polynomial, quadratic): a and b melt within k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = k - (a > b ? a - b : b - a);
  if (h <= 0) return a < b ? a : b;
  const m = a < b ? a : b;
  return m - (h * h) / (4 * k);
}

/** Smooth maximum. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

const len = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** Apply a rotation's rows to a vector (into the frame) */
export function rotIn(m: M3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Apply a rotation's columns to a vector (out of the frame). */
export function rotOut(m: M3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
}

/** The product of two rotations: `mul(a, b)` takes a point into b's frame, then a's. */
export function mul(a: M3, b: M3): M3 {
  const at = (m: M3, i: number): number => m[i] ?? 0;
  const r = (i: number, j: number): number =>
    at(a, i * 3) * at(b, j) + at(a, i * 3 + 1) * at(b, 3 + j) + at(a, i * 3 + 2) * at(b, 6 + j);
  return [r(0, 0), r(0, 1), r(0, 2), r(1, 0), r(1, 1), r(1, 2), r(2, 0), r(2, 1), r(2, 2)];
}

const prim = (c: V3, r: number, f: Field): Prim => ({ kind: "prim", bound: [c[0], c[1], c[2], r], f });

/** A sphere. */
export function sphere(c: V3, r: number): Prim {
  const [cx, cy, cz] = c;
  return prim(c, r, (x, y, z) => len(x - cx, y - cy, z - cz) - r);
}

/** An ellipsoid with radii along its own axes, turned by `rot` (rows take a point into its frame). */
export function ellipsoid(c: V3, radii: V3, rot: M3 = IDENTITY): Prim {
  const [cx, cy, cz] = c;
  const [ia, ib, id] = radii.map((r) => 1 / r) as [number, number, number];
  const [ia2, ib2, id2] = [ia * ia, ib * ib, id * id];
  const inside = -Math.min(...radii);
  const at = (u: number, v: number, w: number): number => {
    const k0 = Math.sqrt(u * u * ia2 + v * v * ib2 + w * w * id2);
    const k1 = Math.sqrt(u * u * ia2 * ia2 + v * v * ib2 * ib2 + w * w * id2 * id2);
    return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : inside;
  };
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = rot;
  const turned = rot !== IDENTITY;
  return prim(c, Math.max(...radii), (x, y, z) => {
    const u = x - cx;
    const v = y - cy;
    const w = z - cz;
    if (!turned) return at(u, v, w);
    return at(m0 * u + m1 * v + m2 * w, m3 * u + m4 * v + m5 * w, m6 * u + m7 * v + m8 * w);
  });
}

/** A cone with round ends: radius `ra` at `a`, `rb` at `b`. */
export function cone(a: V3, b: V3, ra: number, rb: number): Prim {
  const [ax, ay, az] = a;
  const bx = b[0] - ax;
  const by = b[1] - ay;
  const bz = b[2] - az;
  const l2 = bx * bx + by * by + bz * bz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const c: V3 = [ax + bx / 2, ay + by / 2, az + bz / 2];
  return prim(c, Math.sqrt(l2) / 2 + Math.max(ra, rb), (x, y, z) => {
    const px = x - ax;
    const py = y - ay;
    const pz = z - az;
    const yy = px * bx + py * by + pz * bz;
    const zz = yy - l2;
    const qx = px * l2 - bx * yy;
    const qy = py * l2 - by * yy;
    const qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = (rr > 0 ? 1 : -1) * rr * rr * x2;
    if ((zz > 0 ? 1 : -1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if ((yy > 0 ? 1 : -1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
  });
}

/** A capsule of one radius. */
export function capsule(a: V3, b: V3, r: number): Prim {
  return cone(a, b, r, r);
}

/** A box with rounded edges, half sizes `h`, turned by `rot`. */
export function box(c: V3, h: V3, round: number, rot: M3 = IDENTITY): Prim {
  const [cx, cy, cz] = c;
  return prim(c, len(h[0], h[1], h[2]) + round, (x, y, z) => {
    const px = x - cx;
    const py = y - cy;
    const pz = z - cz;
    const u = rot[0] * px + rot[1] * py + rot[2] * pz;
    const v = rot[3] * px + rot[4] * py + rot[5] * pz;
    const w = rot[6] * px + rot[7] * py + rot[8] * pz;
    const qx = Math.abs(u) - h[0];
    const qy = Math.abs(v) - h[1];
    const qz = Math.abs(w) - h[2];
    const out = len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return out + Math.min(Math.max(qx, qy, qz), 0) - round;
  });
}

/** Everything on the side of a plane its normal points away from: n·p < d. */
export function half(n: V3, d: number): Prim {
  const [nx, ny, nz] = n;
  return { kind: "prim", bound: [0, 0, 0, Infinity], f: (x, y, z) => nx * x + ny * y + nz * z - d };
}

function boundOf(kids: readonly Node[]): [number, number, number, number] {
  const finite = kids.filter((n) => n.bound[3] < Infinity);
  if (finite.length === 0) return [0, 0, 0, Infinity];
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const { bound: b } of finite) {
    lo = lo.map((v, i) => Math.min(v, (b[i] ?? 0) - b[3]));
    hi = hi.map((v, i) => Math.max(v, (b[i] ?? 0) + b[3]));
  }
  const c = lo.map((v, i) => (v + (hi[i] ?? 0)) / 2);
  const r = len((hi[0] ?? 0) - (lo[0] ?? 0), (hi[1] ?? 0) - (lo[1] ?? 0), (hi[2] ?? 0) - (lo[2] ?? 0)) / 2;
  return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, r];
}

/** Shapes melted together within `k`. */
export function blend(k: number, ...kids: Node[]): Op {
  return { kind: "blend", k, kids, bound: boundOf(kids) };
}

/**
 * Each of `kids` melted into `base` by its own `ks`, and the union of those: fingers that melt into the palm but
 * never into each other, with the palm asked once per point.
 */
export function fan(base: Node, kids: readonly Node[], ks: readonly number[]): Op {
  return { kind: "fan", k: Math.max(0, ...ks), ks, kids: [base, ...kids], bound: boundOf([base, ...kids]) };
}

/** The first shape with the rest cut out of it, the cuts' edges melted within `k`. */
export function carve(k: number, base: Node, ...cuts: Node[]): Op {
  return { kind: "carve", k, kids: [base, ...cuts], bound: base.bound };
}

/** Where every shape is: the first shape trimmed by the rest. */
export function cut(k: number, ...kids: Node[]): Op {
  const finite = kids.filter((n) => n.bound[3] < Infinity);
  const smallest = finite.reduce<Node | undefined>((a, n) => (a && a.bound[3] <= n.bound[3] ? a : n), undefined);
  return { kind: "cut", k, kids, bound: smallest ? smallest.bound : [0, 0, 0, Infinity] };
}

/** A shape built in its own frame, placed by `rot` (rows take a point in) and `at`. */
export function frame(rot: M3, at: V3, kid: Node): Frame {
  const [bx, by, bz, r] = kid.bound;
  const [ox, oy, oz] = rotOut(rot, bx, by, bz);
  return { kind: "frame", rot, at, kid, bound: [ox + at[0], oy + at[1], oz + at[2], r] };
}

/** A shape with `f` added to its distance; `amp` is the most `f` moves it. */
export function bump(kid: Node, f: Field, amp: number): Bumped {
  const [x, y, z, r] = kid.bound;
  return { kind: "bump", kid, f, bound: [x, y, z, r + amp] };
}

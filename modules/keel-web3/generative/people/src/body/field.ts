// The field: parts melted into a distance grid, dented, lofted and roughened, and the net pulled off it.

import { FAR, UP, add, clamp, lerpV, mix, scale, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Bone, Look, Person } from "./person.js";
import { limbWide } from "./build.js";
import { restSkeleton } from "../motion/skeleton.js";
import type { Capsule } from "../mesh/parts.js";
import { headFrame } from "../head/head.js";
import { PELVIS, boneIndex } from "./bones.js";
import type { Wrap } from "../head/wrap.js";
import { styleOf } from "../head/hair.js";

/** A row of digits as the capsules it stands for. */
export const unrolled = (c: Capsule): readonly Capsule[] => {
  const { row, reach } = c;
  if (!row || !reach) return [c];
  return Array.from({ length: row }, (_, i) => {
    const at = lerpV(c.a, c.b, i / (row - 1));
    return { part: c.part, role: c.role, a: at, b: add(at, reach), r: c.r, r1: c.r * 0.72, melt: 0.25 };
  });
};

/** A part's distance from a point, as sdf-body draws it. */
export function partDistance(c: Capsule, x: number, y: number, z: number): number {
  const ax = x - c.a[0], ay = y - c.a[1], az = z - c.a[2];
  const bx = c.b[0] - c.a[0], by = c.b[1] - c.a[1], bz = c.b[2] - c.a[2];
  const l2 = Math.max(bx * bx + by * by + bz * bz, 1e-9);
  const h = clamp((ax * bx + ay * by + az * bz) / l2, 0, 1);
  const r1 = c.r1 ?? c.r;
  const r = mix(c.r, r1, h);
  let vx = ax - bx * h, vy = ay - by * h, vz = az - bz * h;
  const f = c.flat ?? 1;
  const u = c.up ?? UP;
  const slope = 1 / Math.sqrt(1 + (c.r - r1) ** 2 / l2);
  if (f >= 0.998) return (Math.hypot(vx, vy, vz) - r) * slope;
  const t = (vx * u[0] + vy * u[1] + vz * u[2]) * (1 / f - 1);
  vx += u[0] * t; vy += u[1] * t; vz += u[2] * t;
  return (Math.hypot(vx, vy, vz) - r) * f * slope;
}



export interface Grid { readonly min: Vec; readonly h: number; readonly n: readonly [number, number, number]; readonly field: Float32Array; readonly owner: Int16Array }

export function gridOver(parts: readonly Capsule[], h: number): Grid {
  const pad = (c: Capsule): number => Math.max(c.r, c.r1 ?? 0);
  const low = (i: number): number => Math.min(...parts.map((c) => Math.min(c.a[i] ?? 0, c.b[i] ?? 0) - pad(c)));
  const high = (i: number): number => Math.max(...parts.map((c) => Math.max(c.a[i] ?? 0, c.b[i] ?? 0) + pad(c)));
  const min: Vec = [low(0) - h * 3, low(1) - h * 3, low(2) - h * 3];
  const n: [number, number, number] = [0, 1, 2].map((i) => Math.ceil((high(i) - low(i)) / h) + 6) as [number, number, number];
  const size = n[0] * n[1] * n[2];
  return { min, h, n, field: new Float32Array(size).fill(FAR), owner: new Int16Array(size).fill(-1) };
}

/** One part melted into the field, over only the cells it can reach. */
export function meltIn(grid: Grid, c: Capsule, index: number): void {
  const { min, h, n, field, owner } = grid;
  const k = Math.max(Math.min(0.03 * (c.melt ?? 1), (c.r + (c.r1 ?? c.r)) * 0.4), 1e-5);
  const pad = Math.max(c.r, c.r1 ?? 0) + k * 2 + h * 2;
  const span = (i: number): readonly [number, number] => [
    Math.max(0, Math.floor((Math.min(c.a[i] ?? 0, c.b[i] ?? 0) - pad - (min[i] ?? 0)) / h)),
    Math.min((n[i] ?? 1) - 1, Math.ceil((Math.max(c.a[i] ?? 0, c.b[i] ?? 0) + pad - (min[i] ?? 0)) / h)),
  ];
  const [x0, x1] = span(0), [y0, y1] = span(1), [z0, z1] = span(2);
  const row = (y: number, z: number): void => {
    for (let x = x0; x <= x1; x += 1) {
      const at = x + y * n[0] + z * n[0] * n[1];
      const d = Math.max(partDistance(c, min[0] + x * h, min[1] + y * h, min[2] + z * h), (c.hem ?? -FAR) - (min[1] + y * h));
      const was = field[at] ?? FAR;
      const w = clamp(0.5 + (0.5 * (was - d)) / k, 0, 1);
      field[at] = mix(was, d, w) - k * w * (1 - w);
      if (w > 0.5) owner[at] = index;
    }
  };
  for (let z = z0; z <= z1; z += 1) for (let y = y0; y <= y1; y += 1) row(y, z);
}

/** A cell's twelve edges: a corner, and the way the edge runs from it. */
const CELL_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [0, 1].flatMap((u) => [0, 1].flatMap((v) => [[0, u, v, 1, 0, 0], [u, 0, v, 0, 1, 0], [u, v, 0, 0, 0, 1]] as const));

/** A cell's surface point, the mean of where its edges cross the surface; null if none do. */
export function cellPoint(grid: Grid, x: number, y: number, z: number): Vec | null {
  const { n, field, min, h } = grid;
  const value = (i: number, j: number, k: number): number => field[x + i + (y + j) * n[0] + (z + k) * n[0] * n[1]] ?? FAR;
  let sum: Vec = [0, 0, 0], hits = 0;
  for (const [i, j, k, ax, ay, az] of CELL_EDGES) {
    const a = value(i, j, k), b = value(i + ax, j + ay, k + az);
    if (a < 0 === b < 0) continue;
    const t = a / (a - b);
    sum = add(sum, [i + ax * t, j + ay * t, k + az * t]);
    hits += 1;
  }
  if (!hits) return null;
  return [min[0] + (x + sum[0] / hits) * h, min[1] + (y + sum[1] / hits) * h, min[2] + (z + sum[2] / hits) * h];
}

/** A vertex's two bones and the first's share: the nearest part's, and the nearest of any other bone's, blended across a joint. */
export function weightsAt(
  parts: readonly Capsule[],
  bones: readonly number[],
  at: Vec,
): readonly [number, number, number] {
  let first = 0, near = FAR, second = 0, next = FAR;
  const best = new Map<number, number>();
  parts.forEach((c, i) => {
    const bone = bones[i] ?? 0;
    const d = partDistance(c, at[0], at[1], at[2]);
    if (d < (best.get(bone) ?? FAR)) best.set(bone, d);
  });
  for (const [bone, d] of best) {
    if (d < near) { second = first; next = near; first = bone; near = d; continue; }
    if (d < next) { second = bone; next = d; }
  }
  return [first, second, clamp(0.5 + (next - near) / 0.14, 0.5, 1)];
}

/** How thick a leg is at the hip, knee, ankle and toe to what hangs over it, a little more than it really is, for the cloth to clear it. */
const LEG_THICK = [0.1, 0.07, 0.055, 0.05] as const;

export function legsOf(p: Person): PersonMesh["legs"] {
  const { left, right } = restSkeleton(p), wide = limbWide(p.build), size = p.build.size;
  const joints = [left, right].flatMap(({ leg }) => [leg.hip, leg.knee, leg.ankle, leg.toe].flatMap((at, i) => [...scale(at, size), (LEG_THICK[i] ?? 0) * wide * size]));
  return { bones: [boneIndex("thigh.L"), boneIndex("shin.L"), boneIndex("thigh.R"), boneIndex("shin.R")], feet: [boneIndex("foot.L"), boneIndex("foot.R")], joints, cloth: boneIndex("skirt.front") };
}

/** A person's mesh, at rest: what `poseMesh` moves. Colours are by `roles`, one per vertex, from `palette`. */
export interface PersonMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Each vertex's index into `roles`. */
  readonly role: Uint8Array;
  readonly roles: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  /** Two bones a vertex, and the first's weight. */
  readonly bones: Uint8Array;
  readonly weight: Float32Array;
  /** What each vertex is: one of `FABRICS`. */
  readonly fabric: Uint8Array;
  /** How free of the body it hangs, 0 to 1. */
  readonly loose: Float32Array;
  /** Four a vertex, how cloth lies on it: where it is round its limb (x, z off the limb's line), how far along it, and how far from the garment's edge in metres. */
  readonly cloth: Float32Array;
  /** How open each vertex lies to the light, 0 down in a crease to 1 in the open, and a little over 1 where a face is lit from within it: nothing clamps it. */
  readonly shade: Float32Array;
  /** How much soft flesh rides on it, 0 to 1: what `jiggleAt` moves. */
  readonly soft: Float32Array;
  readonly index: Uint32Array;
  /** Where each eye sits at rest, and how big, and the mouth: what the face is painted from. */
  /** What cloth may never be inside: its renderer pushes it out, whatever the pose. */
  readonly legs: { readonly bones: readonly [number, number, number, number]; readonly feet: readonly [number, number]; readonly joints: readonly number[]; readonly cloth: number };
  readonly face: { readonly eyes: readonly [Vec, Vec]; readonly eye: number; readonly mouth: Vec; readonly mouthWide: number; readonly head: number; readonly iris: string; readonly lip: string; readonly brow: string; readonly browLine: readonly [number, number, number, number]; readonly look: Partial<Look> & { readonly seed?: number }; readonly lash: string; readonly white: string };
}

export function normalAt(grid: Grid, x: number, y: number, z: number): Vec {
  const { n, field } = grid;
  const at = (i: number, j: number, k: number): number => field[x + i + (y + j) * n[0] + (z + k) * n[0] * n[1]] ?? FAR;
  return unit([at(1, 0, 0) - at(-1, 0, 0) + at(2, 0, 0) - at(0, 0, 0), at(0, 1, 0) - at(0, -1, 0) + at(0, 2, 0) - at(0, 0, 0), at(0, 0, 1) - at(0, 0, -1) + at(0, 0, 2) - at(0, 0, 0)], UP);
}

/** Each cell of a grid, skipping its rim. */
export function eachCell(n: Grid["n"], visit: (x: number, y: number, z: number) => void): void {
  for (let z = 1; z < n[2] - 2; z += 1) for (let y = 1; y < n[1] - 2; y += 1) for (let x = 1; x < n[0] - 2; x += 1) visit(x, y, z);
}

/** Quads between the cells round each grid edge that crosses the surface. */
export function netFaces(grid: Grid, cells: Int32Array): number[] {
  const { n, field } = grid;
  const nx = n[0], nxy = n[0] * n[1];
  const out: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    const [v0, v1, v2, v3] = [cells[a] ?? -1, cells[b] ?? -1, cells[c] ?? -1, cells[d] ?? -1];
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) out.push(v0, v1, v2, v0, v2, v3); else out.push(v0, v2, v1, v0, v3, v2);
  };
  eachCell(n, (x, y, z) => {
    const i = x + y * nx + z * nxy;
    const here = (field[i] ?? FAR) < 0;
    if (here !== (field[i + 1] ?? FAR) < 0) quad(i, i - nxy, i - nxy - nx, i - nx, !here);
    if (here !== (field[i + nx] ?? FAR) < 0) quad(i, i - 1, i - 1 - nxy, i - nxy, !here);
    if (here !== (field[i + nxy] ?? FAR) < 0) quad(i, i - nx, i - nx - 1, i - 1, !here);
  });
  return out;
}



/** What the mesh's renderer paints per pixel, sharper than any vertex. */
export const FACE_PAINT = /^(mouth|brow|shirt|tie)/;

export interface Net { readonly position: number[]; readonly normal: number[]; readonly role: number[]; readonly bones: number[]; readonly weight: number[]; readonly fabric: number[]; readonly loose: number[]; readonly cloth: number[]; readonly soft: number[]; readonly index: number[] }

/** What owns a surface cell: its own part, or a neighbour's on the far side of the surface. */
export function ownerOf(grid: Grid, parts: readonly Capsule[], i: number): Capsule | undefined {
  const [nx, ny] = grid.n;
  return [i, i + 1, i + nx, i + nx * ny].map((c) => parts[grid.owner[c] ?? -1]).find(Boolean);
}

/** What a layer of a person is made of and how it hangs. */
export interface Layer {
  readonly parts: readonly Capsule[];
  /** Grid size, as a share of the body's. */
  readonly fine: number;
  /** What the renderer dresses it in. */
  readonly fabric: number;
  /** How far it stands off the body beneath it. */
  readonly lift: number;
  /** A solid melted in straight after the skull. */
  readonly loft?: Loft;
  /** What is pressed into its surface once it is melted. */
  readonly dents?: readonly Dent[];
  /** Where its fixed mesh goes, for a head near enough to want one. */
  readonly wrap?: Wrap;
  /** Whether it rides the head's bone alone: a jaw sits so near a short neck that it would otherwise go with that. */
  readonly rigid?: boolean;
  /** Locks on its surface, round the head at `head`. */
  readonly locks?: { readonly head: Vec; readonly kind: "strand" | "curl" | "tuft"; readonly size: number };
  /** What is worn over it: a body is not built where none of it can be seen. */
  readonly under?: readonly Capsule[];
  /** How near one of those a vertex of it may come; inside them when under nought. */
  readonly tuck?: number;
  /** How many times its surface is relaxed, so what melted together leaves no crease. */
  readonly relax?: number;
  /** Nothing of it is built above this height: what is under a hat stays under the hat. */
  readonly roof?: number;
  /** Where it starts to hang free, and how far down it is wholly free: nothing above `from` moves on its own. */
  readonly free?: readonly [from: number, span: number];
}

/** A hollow or a rise pressed into a finished surface, a little way round `at`: what is melted in can only add, and bone needs both. */
interface Dent { readonly at: Vec; readonly r: Vec; readonly by: number }

/** Each dent let into the field, over only the cells it can reach. */
export function dented(grid: Grid, dents: readonly Dent[]): void {
  const { n, field, min, h } = grid;
  for (const d of dents) {
    const box = (i: number): readonly [number, number] => [Math.max(1, Math.floor(((d.at[i] ?? 0) - (d.r[i] ?? 0) - (min[i] ?? 0)) / h)), Math.min((n[i] ?? 3) - 2, Math.ceil(((d.at[i] ?? 0) + (d.r[i] ?? 0) - (min[i] ?? 0)) / h))];
    const [x0, x1] = box(0), [y0, y1] = box(1), [z0, z1] = box(2);
    const row = (y: number, z: number): void => {
      const b = (min[1] + y * h - d.at[1]) / d.r[1], c = (min[2] + z * h - d.at[2]) / d.r[2], rest = b * b + c * c;
      for (let x = x0; x <= x1; x += 1) {
        const a = (min[0] + x * h - d.at[0]) / d.r[0], q = a * a + rest, i = x + y * n[0] + z * n[0] * n[1];
        if (q < 1) field[i] = (field[i] ?? FAR) - d.by * (1 - q) * (1 - q);
      }
    };
    for (let z = z0; z <= z1; z += 1) for (let y = y0; y <= y1; y += 1) row(y, z);
  }
}

/** A run through knots, `at` rising, that goes no further than they do between them: an outline with no wobble in it. */
function eased(knots: readonly (readonly [number, number])[]): (at: number) => number {
  const gap = knots.slice(1).map(([x, y], i) => { const [px = 0, py = 0] = knots[i] ?? []; return [x - px, (y - py) / (x - px)] as const; });
  const lean = knots.map((_, i) => {
    const a = gap[i - 1]?.[1] ?? gap[i]?.[1] ?? 0, b = gap[i]?.[1] ?? a;
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return (at) => {
    const next = clamp(knots.findIndex(([x]) => x > at), 1, knots.length - 1), [x0 = 0, y0 = 0] = knots[next - 1] ?? [], [x1 = 1, y1 = 0] = knots[next] ?? [], w = x1 - x0, t = clamp((at - x0) / w, 0, 1);
    return (2 * t ** 3 - 3 * t * t + 1) * y0 + (t ** 3 - 2 * t * t + t) * w * (lean[next - 1] ?? 0) + (3 * t * t - 2 * t ** 3) * y1 + (t ** 3 - t * t) * w * (lean[next] ?? 0);
  };
}

/** One slice of a face, level, in head radii: how wide, where it is widest, how far forward of that and how far back. */
interface Slice { readonly x: number; readonly at: number; readonly front: number; readonly back: number }

/** How wide a face runs at each height, chin to crown. */
function widthOf(b: Bone): (y: number) => number {
  const under = b.men + 0.16, midJaw = (under + b.gonY) / 2;
  return eased([[b.men - 0.02, b.chin * 0.92], [under, b.chin + 0.06], [midJaw, mix(b.gon, b.chin, 0.37)], [b.gonY, b.gon], [(b.gonY + b.cheekY) / 2, b.mid], [b.cheekY, b.zyg], [0.3, b.tem], [0.62, b.tem * 0.86], [0.86, 0.46]]);
}

/** How far forward a face lies at each height, down its middle before a nose: brow, the dip at the eyes, the fullness of the mouth, the fold over the chin. */
function depthOf(b: Bone): (y: number) => number {
  const under = b.men + 0.16, muzzle = mix(0.95, 1, b.m);
  return eased([[b.men - 0.02, b.pogZ - 0.06], [under, b.pogZ], [(under + b.sto) / 2, Math.min(b.pogZ, muzzle) - 0.045], [b.sto, muzzle], [b.sub, muzzle - 0.01], [b.pupil - 0.32, 0.91], [b.pupil, 0.84], [b.pupil + 0.2, 0.9], [0.62, 0.9], [0.86, 0.66]]);
}

/** A face's slices: below its corners the jaw draws forward to the chin, and at the chin all of it rounds off to nothing. */
function slicesOf(b: Bone): (y: number) => Slice {
  const wide = widthOf(b), deep = depthOf(b), low = b.men + 0.17, curl = 2.3 + (b.plane - 2) * 1.2;
  return (y) => {
    const t = clamp((b.gonY - y) / (b.gonY - b.men), 0, 1), end = clamp((low - y) / (low - b.men), 0, 1), round = (1 - end ** curl) ** (1 / curl);
    const at = mix(b.gonZ + 0.04, b.pogZ - 0.3, t ** 1.2), rear = mix(b.gonZ - 0.24, b.pogZ - 0.46, t ** 0.9);
    return { x: Math.max(0.01, wide(y) * round), at, front: Math.max(0.01, (deep(y) - at) * round), back: Math.max(0.01, (at - rear) * round) };
  };
}

/** A face's solid as a distance from it, slice by slice. */
interface Loft { readonly from: number; readonly to: number; readonly slice: (y: number) => (x: number, z: number) => number; readonly melt: number }

export function loftOf(p: Person): Loft {
  const b = p.face.bone, size = p.build.size, c = scale(headFrame(restSkeleton(p), p.build.head, p.face).c, size), R = p.build.head * size, slices = slicesOf(b);
  const slice = (Y: number): ((x: number, z: number) => number) => {
    const local = (Y - c[1]) / R, s = slices(local < 0 ? local / b.L : local), least = Math.max(0.14, Math.min(s.x, s.front));
    return (X, Z) => {
      const z = (Z - c[2]) / R, along = (z < 0 ? z / b.D : z) - s.at, power = along > 0 ? mix(2, b.plane, 0.3) : 2;
      return (((Math.abs(X - c[0]) / (R * b.W * s.x)) ** power + (Math.abs(along) / (along > 0 ? s.front : s.back)) ** power) ** (1 / power) - 1) * least * R;
    };
  };
  return { from: c[1] + (b.men - 0.02) * b.L * R, to: c[1] + 0.86 * R, slice, melt: 0.1 * R };
}

/** A loft melted into the field, as a part is. */
export function lofted(grid: Grid, loft: Loft): void {
  const { min, h, n } = grid, k = loft.melt;
  for (let y = 0; y < n[1]; y += 1) {
    const Y = min[1] + y * h;
    if (Y < loft.from || Y > loft.to) continue;
    const at = loft.slice(Y);
    for (let z = 0; z < n[2]; z += 1) meltRow(grid, y, z, (x) => at(min[0] + x * h, min[2] + z * h), k);
  }
}

function meltRow(grid: Grid, y: number, z: number, distance: (x: number) => number, k: number): void {
  const { n, field } = grid;
  for (let x = 0; x < n[0]; x += 1) {
    const i = x + y * n[0] + z * n[0] * n[1], d = distance(x), was = field[i] ?? FAR, w = clamp(0.5 + (0.5 * (was - d)) / k, 0, 1);
    field[i] = mix(was, d, w) - k * w * (1 - w);
  }
}

/** The bone a face shows, as dents on the rest head: brow, cheekbone, sockets, the hollows under them, the root of the nose, the fold over the chin and the chin itself. */
export function dentsOf(p: Person, eyed = false): readonly Dent[] {
  if (p.outfit.costume === "fursuit") return [];
  const b = p.face.bone, size = p.build.size, g = headFrame(restSkeleton(p), p.build.head, p.face), R = p.build.head * size;
  const dent = (x: number, y: number, z: number, r: Vec, by: number): Dent => ({ at: scale(g.bone(x, y, z), size), r: scale(r, R), by: by * R });
  const pair = (x: number, y: number, z: number, r: Vec, by: number): readonly Dent[] => [dent(-x, y, z, r, by), dent(x, y, z, r, by)];
  return [
    ...pair(0.29, b.pupil + 0.22, 0.96, [0.25, 0.12, 0.3], b.ridge),
    ...pair(0.5, b.cheekY, 0.66, [0.24, 0.17, 0.3], b.cheek),
    ...pair(0.36, b.pupil, 0.86, [0.21, 0.13, 0.3], (-0.045 - b.orbit) * (eyed ? 0.4 : 1)),
    ...pair(0.54, -0.44, 0.56, [0.26, 0.2, 0.34], (-b.hollow - b.old * 0.02) * (eyed ? 0.55 : 1)),
    ...(b.old ? pair(0.63, 0.42, 0.48, [0.2, 0.25, 0.32], -0.05 * b.old) : []),
    dent(0, b.pupil + 0.02, 0.96, [0.14, 0.1, 0.22], -0.05 * mix(0.5, 1, b.m) * (1 - b.old * 0.5)),
    dent(0, b.men + 0.27, b.pogZ - 0.05, [0.24, 0.075, 0.25], -0.04 * mix(0.4, 1, b.m)),
    dent(0, 1.34, -0.1, [0.95, 0.4, 1.05], -(styleOf(p) === "bald" ? 0.13 : 0.05) * b.m),
    dent(0, b.men + 0.14, b.pogZ, [0.2, 0.11, 0.22], 0.03 * mix(0.3, 1, b.m)),
  ];
}

/** Locks on a hair's surface, how it should lie round `at`: `strand` ridges down from the crown, `curl` all over. */
export function roughen(grid: Grid, at: Vec, kind: "strand" | "curl" | "tuft", size: number): void {
  const { n, field, min, h } = grid;
  const f = 170 / size;
  eachCell(n, (x, y, z) => {
    const i = x + y * n[0] + z * n[0] * n[1];
    const was = field[i] ?? FAR;
    if (Math.abs(was) > 0.03) return;
    const px = min[0] + x * h - at[0], py = min[1] + y * h - at[1], pz = min[2] + z * h - at[2];
    const line = Math.sin(Math.atan2(px, pz) * 26 + py * 11 / size + Math.sin(py * 26 / size) * 0.7) * 0.0042 * size;
    // (Each axis pushed about by the others, or the bumps fall in rows and a small head of them is a checkerboard.)
    const wx = px * f + 1.6 * Math.sin(py * f * 0.41 + pz * f * 0.29), wy = py * f + 1.6 * Math.sin(pz * f * 0.37 - px * f * 0.31 + 2), wz = pz * f + 1.6 * Math.sin(px * f * 0.43 + py * f * 0.23 + 4);
    const bump = (Math.sin(wx) * Math.sin(wy * 1.37 + 1.3) * Math.sin(wz * 0.83 + 0.7) + 0.5 * Math.sin((wx + wy) * 1.9) * Math.sin((wz - wy) * 2.3)) * size;
    field[i] = was - (kind === "strand" ? line : bump * (kind === "tuft" ? 0.011 : 0.006));
  });
}


export const inflated = (c: Capsule, by: number): Capsule => ({ ...c, r: c.r + by, ...(c.r1 === undefined ? {} : { r1: c.r1 + by }) });

/** Front to back across a skirt's depth, and how far it takes. */
const PANEL_DEEP = 0.16;
/** How far either side of a panel's end cloth goes over from lying to hanging. */
const KNEE_BLEND = 0.08;

/** A skirt goes with its two panels, front and back meeting at the sides, and below `knee` it hangs from them. Its own folds and sway come from `free`. */
export function skirtWeights(at: Vec, knee = -FAR, hinge = FAR): readonly [number, number, number] {
  if (at[1] > hinge) return [PELVIS, PELVIS, 1];
  const blend = (at[1] - knee + KNEE_BLEND) / (2 * KNEE_BLEND);
  if (blend > 0 && blend < 1) { const panel = at[2] < 0 ? "back" : "front"; return [boneIndex(`skirt.${panel}`), boneIndex(`hang.${panel}`), blend * blend * (3 - 2 * blend)]; }
  const low = at[1] < knee;
  return [boneIndex(low ? "hang.front" : "skirt.front"), boneIndex(low ? "hang.back" : "skirt.back"), clamp(0.5 + at[2] / PANEL_DEEP, 0, 1)];
}

/** Whether something over a layer leaves this point of it out of sight. */
export const unseen = (layer: Layer, at: Vec): boolean => at[1] > (layer.roof ?? FAR) || (layer.under?.some((c) => partDistance(c, at[0], at[1], at[2]) < (layer.tuck ?? 0.012)) ?? false);

// A lock: the line one runs from its root, combed or gathered, and the ribbon, vertex and faces anything on a head is
// laid with.

import { FAR, SIDE, TAU, UP, add, clamp, cross, lerpV, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { HEAD } from "../body/bones.js";
import type { Net } from "../body/field.js";
import { FABRICS } from "../clothes/fabric.js";
import { HAIRLINE, SKULL, SKULL_AT } from "./hair.data.js";
import type { Comb, Tie } from "./hair.data.js";

/** What a head's trimmings go into: the net so far, its roles, and the way from head radii to metres. */
export interface Lay {
  readonly net: Net;
  readonly roles: readonly string[];
  readonly to: (q: Vec) => Vec;
}

/** Behind the hairline: across the brow, in at the temple, down a sideburn, up over the ear and round to the nape. */
export const scalped = (u: Vec): boolean => {
  const next = HAIRLINE.findIndex(([z]) => z <= u[2]);
  const b = HAIRLINE[Math.max(1, next)] ?? [-1, -0.62];
  const a = HAIRLINE[Math.max(0, Math.max(1, next) - 1)] ?? b;
  return u[1] > mix(a[1], b[1], clamp((a[0] - u[2]) / Math.max(0.001, a[0] - b[0]), 0, 1));
};

/** A point laid on the skull, where hair lies until it falls away from it. */
export function onSkull(q: Vec): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]];
  const far = Math.hypot(...e) || 1;
  return add(SKULL_AT, [(SKULL[0] * e[0]) / far, (SKULL[1] * e[1]) / far, (SKULL[2] * e[2]) / far]);
}

/** A point kept out of the skull, and off the face unless it is a fringe. */
export function offHead(q: Vec, front: boolean): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]];
  const far = Math.hypot(...e);
  const out: Vec =
    far < 1
      ? [
          SKULL_AT[0] + (SKULL[0] * e[0]) / far,
          SKULL_AT[1] + (SKULL[1] * e[1]) / far,
          SKULL_AT[2] + (SKULL[2] * e[2]) / far,
        ]
      : q;
  const onFace = !front && out[1] < 0.42 && out[1] > -1.3 && out[2] > 0.3 && Math.abs(out[0]) < 0.92;
  return onFace ? [out[0], out[1], 0.3] : out;
}

/** Past the shoulders hair lies down the back. */
const offShoulders = (q: Vec): Vec => {
  const k = clamp((-1.5 - q[1]) / 0.6, 0, 1);
  return [q[0], q[1], mix(q[2], Math.min(q[2], -1.25), k)];
};

const rootAt = (u: Vec): Vec => add(SKULL_AT, [SKULL[0] * u[0], SKULL[1] * u[1], SKULL[2] * u[2]]);

/** A lock's root: where on the skull it is, whether it is a fringe's, and where its head's hair is parted. */
interface Root {
  readonly u: Vec;
  readonly brow: boolean;
  readonly parted: number;
}

/** Which way a root's hair sets off, `loose` of its own: over the brow, out from the parting, or from the crown. */
function awayFrom(c: Comb, { u, brow, parted }: Root, loose: number): Vec {
  const side = u[0] - parted;
  if (brow) return [side * 0.3 + loose, 0.1, 1];
  if (c.part === undefined) return [u[0] + loose, 0, u[2] + 0.25];
  if (u[2] < 0.3) return [side * 1.6 + loose, 0, u[2] - 0.2];
  return [side * 1.1 + loose, 0.7, -1.5];
}

/**
 * Which way a root's hair leaves it: forward over the brow if it is a fringe, else out from the parting, or from the
 * crown if it has none.
 */
function leaving(c: Comb, root: Root, rand: () => number): Vec {
  const loose = (rand() - 0.5) * (root.brow ? 0.1 : 0.3);
  return unit(add(unit(awayFrom(c, root, loose), SIDE), scale(root.u, c.stand)));
}

/** What draws a lock on from a point: down, harder once it is off the head, and back round the temple. */
function drawnBy(c: Comb, next: Vec, ds: number, brow: boolean): Vec {
  const lies = c.stand < 1;
  // (Off the head, nothing holds it up: it turns straight down.)
  const free = lies && next[1] <= SKULL_AT[1];
  // (And what comes over the temple is drawn back round it, clear of the face.)
  const temple = lies && !brow && next[2] > 0.05 && next[1] < 0.85;
  return [0, -c.fall * ds * (free ? 6 : 1), temple ? -2.2 * ds : 0];
}

/**
 * One step of a lock. Combed hair lies on the head until it has somewhere to fall; only what is stiff stands off it.
 */
function lockStep(c: Comb, [q, d]: readonly [Vec, Vec], ds: number, brow: boolean): readonly [Vec, Vec] {
  const lies = c.stand < 1;
  const leaning = lies && q[1] < SKULL_AT[1] + 0.25;
  const step = madd(q, leaning ? unit(add(d, [0, -2.4, 0])) : d, ds);
  const next = offShoulders(offHead(lies && step[1] > SKULL_AT[1] ? onSkull(step) : step, brow));
  return [next, unit(add(lies ? unit(sub(next, q), d) : d, drawnBy(c, next, ds, brow)))];
}

/** A lock's line, from its root, combed and let fall. */
export function combed(comb: Comb, u: Vec, rand: () => number, parted: number): readonly Vec[] {
  const c = { wave: 0, rate: 0, layers: 0, cut: -FAR, ...comb };
  const brow = c.fringe !== undefined && u[2] > 0.34 && u[1] > 0.4;
  const root: Root = { u, brow, parted };
  const end = c.length * (1 - c.layers * rand()) * (brow ? 0.4 : 1);
  const steps = Math.max(5, Math.ceil(end * 7));
  const ds = end / steps;
  const stop = (brow ? (c.fringe ?? -FAR) : c.cut) + (rand() - 0.5) * (brow ? 0.04 : 0.34);
  const at = rootAt(u);
  const lateral = unit(cross(leaving(c, root, rand), UP), SIDE);
  const beat = rand() * TAU;
  let d = leaving(c, root, rand);
  let q = at;
  const line: Vec[] = [at];
  for (let i = 0; i < steps && q[1] >= stop; i += 1) {
    [q, d] = lockStep(c, [q, d], ds, brow);
    const arc = (i + 1) * ds;
    const sway = c.wave * Math.min(1, arc * 1.2) * (u[2] > 0.25 ? 0.25 : 1);
    const a = arc * c.rate + beat;
    line.push(add(q, add(scale(lateral, sway * Math.sin(a)), [0, 0, sway * Math.cos(a * 0.7)])));
  }
  // (Fine steps to follow the skull; a straight fall needs few points to hold them.)
  return line.filter((_, i) => i < 8 || i % (c.wave > 0 ? 2 : 3) === 0 || i === line.length - 1);
}

/** A lock drawn back to a tie and on along what runs from it. */
export function gathered(tie: Tie, u: Vec, rand: () => number): readonly Vec[] {
  const root = rootAt(u);
  const strand = Math.floor(rand() * 3);
  const points = 14;
  // (A low tie is reached round the back of the head, never across the face.)
  const low = tie.at[1] < 0.6 && u[2] > -0.3;
  const way = onSkull([(tie.at[0] || 1) > 0 ? 0.76 : -0.76, Math.max(tie.at[1], 0.1) + 0.2, -0.56]);
  const up = Array.from({ length: low ? 9 : 6 }, (_, i) => {
    const t = i / (low ? 9 : 6);
    return offHead(low ? lerpV(lerpV(root, way, t), lerpV(way, tie.at, t), t) : lerpV(root, tie.at, t), true);
  });
  const off: Vec = [(rand() - 0.5) * tie.spread * 2, (rand() - 0.5) * tie.spread, (rand() - 0.5) * tie.spread * 2];
  const lag = rand() * 0.12;
  const run = Array.from({ length: points }, (_, i): Vec => {
    const t = (i / (points - 1)) * (1 - lag);
    return add(tie.tail(t, strand), scale(off, clamp(t * 5, 0.22, 1) * (1 - t * 0.5)));
  });
  return tie.plait === true ? up : [...up, ...run];
}

/**
 * How a lock faces at a point round it. A fold of skin is lit as the skin it lies on, or a thin one is all edge and
 * catches the rim light; a rope or a band is round; a clump of hair faces out, for what lights it is the mass, not the
 * ribbon. `b` is across the lock, `n` out of it, `o` out from the head; `c` and `r` are where round it the point is.
 */
function lockNormal(
  [b, n, o]: readonly [Vec, Vec, Vec],
  [c, r]: readonly [number, number],
  round: boolean,
  fabric?: number,
): Vec {
  if (fabric === FABRICS.skin) return unit(add(o, scale(b, c * 0.3)));
  if (fabric !== undefined) return unit(add(scale(b, c * 0.7), scale(n, r)));
  if (round) return unit(add(scale(b, c * 0.6), scale(n, 0.55 + r * 0.45)));
  return unit(add(scale(b, c * 0.45), scale(n, 0.7 + r * 0.3)));
}

/** A lock's width along it: full from near the root, gone to almost nothing at the end. */
const lockTaper = (s: number): number => Math.min(1, 0.8 + s * 3) * Math.min(1, (1 - s) * 3 + 0.12);

/** What a lock is worn as when it is not hair: its role and fabric, its bone, which way is out, and how it tapers. */
export interface Worn {
  readonly up?: Vec;
  readonly bone?: number;
  readonly role: string;
  readonly fabric: number;
  readonly taper?: (s: number) => number;
}

/** The faces between a ring of `sides` vertices at `v` and the next ring, seen from both sides. */
function stitchRing(index: number[], v: number, sides: number): void {
  for (let j = 0; j < sides; j += 1) {
    const k = (j + 1) % sides;
    index.push(v + j, v + k, v + sides + j, v + k, v + sides + k, v + sides + j);
  }
}

/** One lock laid into the net: a flat tapering ribbon, round as a rope if it is as thick as it is wide. */
export function layLock(
  lay: Lay,
  line: readonly Vec[],
  [width, thick, sides]: readonly [number, number, number],
  worn?: Worn,
): number {
  const { net, roles, to } = lay;
  const base = net.position.length / 3;
  const bone = worn?.bone ?? HEAD;
  const role = Math.max(0, roles.indexOf(worn?.role ?? "hair"));
  const last = line.length - 1;
  const taperOf = worn ? (worn.taper ?? (() => 1)) : lockTaper;
  line.forEach((q, i) => {
    const s = i / last;
    const t = unit(sub(line[Math.min(last, i + 1)] ?? q, line[Math.max(0, i - 1)] ?? q), UP);
    const o = worn?.up ?? unit(sub(q, SKULL_AT), UP);
    const b = unit(cross(t, o), SIDE);
    const n = cross(b, t);
    const taper = taperOf(s);
    for (let j = 0; j < sides; j += 1) {
      const a = (j / sides) * TAU;
      const c = Math.cos(a);
      const r = Math.sin(a);
      net.position.push(...to(add(madd(q, b, c * width * taper), scale(n, r * thick * taper))));
      net.normal.push(...lockNormal([b, n, o], [c, r], thick >= width * 0.7, worn?.fabric));
      net.role.push(role);
      net.bones.push(bone, bone);
      net.weight.push(1);
      net.fabric.push(worn?.fabric ?? FABRICS.hair);
      net.loose.push(clamp(s * 1.6 - 0.2, 0, 1) * 0.8);
      net.soft.push(0);
      if (worn) net.cloth.push(j / sides, 0, s * last * 0.08, 1);
      else net.cloth.push(t[0], t[1], t[2], (base % 97) * 0.41 + c * width);
    }
    if (i === last) return;
    stitchRing(net.index, base + i * sides, sides);
  });
  return line.length * sides;
}

/** One vertex on the head's bone, with every attribute the net keeps. */
export interface HeadVertex {
  readonly at: Vec;
  readonly normal: Vec;
  readonly role: number;
  readonly fabric: number;
  readonly loose: number;
  readonly cloth: readonly [number, number, number, number];
}

export function headVertex(net: Net, v: HeadVertex): void {
  net.position.push(...v.at);
  net.normal.push(...v.normal);
  net.role.push(v.role);
  net.bones.push(HEAD, HEAD);
  net.weight.push(1);
  net.fabric.push(v.fabric);
  net.loose.push(v.loose);
  net.soft.push(0);
  net.cloth.push(...v.cloth);
}

/** The faces between `rows` closed rings of `around` vertices each, from `base`, seen from both sides. */
export function ringQuads(index: number[], base: number, rows: number, around: number): void {
  for (let k = 0; k < rows; k += 1) {
    for (let i = 0; i < around; i += 1) {
      const v = base + k * around;
      const n = (i + 1) % around;
      index.push(v + i, v + n, v + around + i, v + n, v + around + n, v + around + i);
      index.push(v + i, v + around + i, v + n, v + n, v + around + i, v + around + n);
    }
  }
}

/** The faces of an open sheet of `rows` by `across` quads, from `base`, seen from both sides. */
export function sheetQuads(index: number[], base: number, rows: number, across: number): void {
  const row = across + 1;
  for (let k = 0; k < rows; k += 1) {
    for (let i = 0; i < across; i += 1) {
      const v = base + k * row + i;
      index.push(v, v + row, v + 1, v + 1, v + row, v + row + 1);
      index.push(v, v + 1, v + row, v + 1, v + row + 1, v + row);
    }
  }
}

/** Hair that stands or hangs in its own ropes, and is not a mass of clumps. */
export const roped = (c: Comb): boolean => c.thick >= 0.1 || c.stand >= 1;

/** Which tie a root's hair goes to: the side it is on, if there are two. */
export const tieOf = (c: Comb, u: Vec): Tie | undefined => c.ties?.[c.ties.length > 1 && u[0] > 0 ? 1 : 0];

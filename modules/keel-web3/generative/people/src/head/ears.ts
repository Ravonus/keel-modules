// The ears, and the boundary of a head that they and whatever is worn on it are seated on.

import { SIDE, TAU, add, clamp, madd, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import { streamOf } from "../roll.js";
import { deepOf } from "../clothes/palette.js";
import { restSkeleton } from "../motion/skeleton.js";
import { headFrame } from "./head.js";
import type { HeadFrame } from "./head.js";
import { HEAD } from "../body/bones.js";
import type { Net, Wearer } from "../body/field.js";
import { FABRICS } from "../clothes/fabric.js";
import { marksOf, vecAt } from "./paint.js";
import { layLock, ringQuads } from "./lock.js";
import type { Lay } from "./lock.js";
import { FAR_HAIR, MID_HAIR } from "./hair.data.js";
import { tuckOf } from "./hair.js";

const SKIN_RIDGE = { role: "skin", fabric: FABRICS.skin };

/**
 * A head's boundary: the true surface of what is already on it, round its centre, in head radii. Whatever goes on a
 * person is seated on this, and never on a guess at where a head is.
 */
export interface Bound {
  /** How far out the surface lies along a direction from the centre. */
  readonly far: (dir: Vec) => number;
  /** The point on it along a direction, `lift` clear of it. */
  readonly on: (dir: Vec, lift?: number) => Vec;
}

const SHELL_AROUND = 96;
const SHELL_UP = 48;

/** A direction from a head's centre: `az` round from the nose, `el` up. */
export const bearingOf = (az: number, el: number): Vec => [
  Math.cos(el) * Math.sin(az),
  Math.sin(el),
  Math.cos(el) * Math.cos(az),
];

/** Fills the cells of a shell no vertex fell in from their neighbours, then eases it. */
function closedShell(cells: Float32Array): void {
  const at = (grid: Float32Array, a: number, e: number): number =>
    grid[clamp(e, 0, SHELL_UP - 1) * SHELL_AROUND + ((a + SHELL_AROUND) % SHELL_AROUND)] ?? 0;
  const pass = (fill: boolean): void => {
    const was = cells.slice();
    for (let e = 0; e < SHELL_UP; e += 1) {
      for (let a = 0; a < SHELL_AROUND; a += 1) {
        const near = [at(was, a - 1, e), at(was, a + 1, e), at(was, a, e - 1), at(was, a, e + 1)].filter((v) => v > 0);
        const mine = at(was, a, e);
        if (near.length === 0 || (fill && mine > 0)) continue;
        const mean = near.reduce((sum, v) => sum + v, 0) / near.length;
        const eased = mine > 0 ? mine * 0.5 + mean * 0.5 : mean;
        cells[e * SHELL_AROUND + a] = fill ? mean : eased;
      }
    }
  };
  for (let i = 0; i < 12; i += 1) pass(true);
  pass(false);
}

/** How far out a closed shell lies along a direction, read between its cells. */
function shellFar(cells: Float32Array, dir: Vec): number {
  const a = ((Math.atan2(dir[0], dir[2]) / TAU + 1) % 1) * SHELL_AROUND - 0.5;
  const e = clamp((Math.asin(clamp(dir[1], -1, 1)) / Math.PI + 0.5) * SHELL_UP - 0.5, 0, SHELL_UP - 1.001);
  const a0 = Math.floor(a);
  const e0 = Math.floor(e);
  const cell = (x: number, y: number): number => cells[y * SHELL_AROUND + ((x + SHELL_AROUND) % SHELL_AROUND)] ?? 1;
  return mix(mix(cell(a0, e0), cell(a0 + 1, e0), a - a0), mix(cell(a0, e0 + 1), cell(a0 + 1, e0 + 1), a - a0), e - e0);
}

/** The boundary of a head, from those of its vertices `keep` takes. */
export function boundOf(net: Net, h: Pick<HeadFrame, "c" | "r">, size: number, keep: (v: number) => boolean): Bound {
  const cells = new Float32Array(SHELL_AROUND * SHELL_UP);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r);
    const far = Math.hypot(...q);
    if (far < 0.2 || far > 3.5) continue;
    const a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * SHELL_AROUND);
    const e = clamp(Math.floor((Math.asin(q[1] / far) / Math.PI + 0.5) * SHELL_UP), 0, SHELL_UP - 1);
    const i = e * SHELL_AROUND + a;
    cells[i] = Math.max(cells[i] ?? 0, far);
  }
  closedShell(cells);
  const far = (dir: Vec): number => shellFar(cells, dir);
  return { far, on: (dir, lift = 0) => scale(dir, far(dir) + lift) };
}

/** Where what is worn holds on to a head: its skin, and each ear's top and lobe once it has them. */
export interface Seat {
  readonly skin: Bound;
  readonly tops: (Vec | null)[];
  readonly lobes: (Vec | null)[];
}

type Fold = readonly (readonly [number, number])[];

/** A line with its corners rounded off. */
function roundedOff(line: Fold, times: number): Fold {
  if (times <= 0) return line;
  const cut = line.slice(1).flatMap((b, i): Fold => {
    const a = line[i] ?? b;
    return [
      [mix(a[0], b[0], 0.25), mix(a[1], b[1], 0.25)],
      [mix(a[0], b[0], 0.75), mix(a[1], b[1], 0.75)],
    ];
  });
  return roundedOff([line[0] ?? [0, 0], ...cut, line[line.length - 1] ?? [0, 0]], times - 1);
}

/**
 * The folds of an ear, forward and up from its middle, in head radii: the rim round the top and back, the ridge inside
 * it, and the flap before it.
 */
const EAR_RIM: Fold = [
  [0.08, 0.1], [0.1, 0.24], [0.02, 0.32], [-0.1, 0.33], [-0.2, 0.24], [-0.24, 0.1], [-0.21, -0.05], [-0.13, -0.17],
  [-0.05, -0.26],
];
const EAR_RIDGE: Fold = [[-0.03, 0.22], [-0.1, 0.18], [-0.13, 0.08], [-0.1, -0.03], [-0.04, -0.11]];
const EAR_FLAP: Fold = [[0.08, 0.04], [0.09, -0.02], [0.06, -0.08]];

/** Where an ear's skin is: `a` forward and `b` up from its middle, `sunk` into the head. */
type EarSkin = (a: number, b: number, sunk?: number) => Vec;

/** The skin of an ear, from its rim in to the hollow, dished: both sides of it, for what shows from behind. */
function pinnaOf(lay: Lay, at: EarSkin, rim: Fold): readonly number[] {
  const { net, roles, to } = lay;
  const rings = 4;
  const base = net.position.length / 3;
  const count = rim.length;
  const role = Math.max(0, roles.indexOf("skin"));
  const mid = rim.reduce<readonly [number, number]>((m, [a, b]) => [m[0] + a / count, m[1] + b / count], [0, 0]);
  const tones: number[] = [];
  // (The last ring runs back from the rim to the head, so an ear is a solid thing and not a sheet held beside it.)
  for (let k = 0; k <= rings + 1; k += 1) {
    rim.forEach(([a, b]) => {
      const s = Math.min(1, k / rings);
      const back = k > rings;
      const q = back
        ? at(mix(mid[0], a, 0.72), mix(mid[1], b, 0.72), 0.34)
        : at(mix(mid[0], a, s), mix(mid[1], b, s), 0.09 * (1 - s));
      net.position.push(...to(q));
      net.normal.push(...unit([q[0], 0, 0.3], SIDE));
      net.role.push(role);
      net.bones.push(HEAD, HEAD);
      net.weight.push(1);
      net.fabric.push(FABRICS.skin);
      net.loose.push(0);
      net.cloth.push(0, 0, 0, 1);
      net.soft.push(0);
      tones.push(mix(0.56, 0.9, s));
    });
  }
  ringQuads(net.index, base, rings + 1, count);
  return tones;
}

/** One person's ears: how big, how far they stand out, how the lobe hangs, where the brow is, and how near they are. */
interface Ears {
  readonly big: number;
  readonly stands: number;
  readonly hangs: number;
  readonly level: number;
  readonly near: boolean;
}

/**
 * Where one ear's skin is. An ear grows from the skin where the skin really is: from the line of the brow to the base
 * of the nose, behind the jaw, leaning back.
 */
function earSkin(ears: Ears, skin: Bound, x: number): EarSkin {
  const out = unit([x, 0.04, -0.24], SIDE);
  return (a, b, sunk = 0) => {
    const lean = b * 0.22;
    const dir = bearingOf(x * (Math.PI / 2 + 0.12 - (a - lean) * ears.big), ears.level + b * ears.big);
    const stand = Math.max(0, (0.12 - a) * ears.big * ears.stands + Math.min(0, b) * 0.34);
    return madd(skin.on(dir), out, 0.03 + stand - sunk);
  };
}

/** One ear laid in: its dish, and the folds over it. Near to, every fold; a little further, the dish and its rim. */
function earOf(lay: Lay, ears: Ears, at: EarSkin): number[] {
  const { near, big, hangs } = ears;
  const lobe = [[-0.03, -0.3 - hangs], [0.03, -0.27 - hangs * 0.5]] as const;
  const line = roundedOff([...EAR_RIM, ...lobe], near ? 2 : 1);
  const flap = roundedOff(EAR_FLAP, near ? 1 : 0);
  const tones = [...pinnaOf(lay, at, [...line, ...flap.slice().reverse()])];
  const ridges: readonly (readonly [Fold, number, number, number])[] = near
    ? [[line, 0.046, 0.032, 0.94], [roundedOff(EAR_RIDGE, 2), 0.026, 0.02, 0.84], [flap, 0.03, 0.024, 0.92]]
    : [[line, 0.05, 0.032, 0.92]];
  for (const [fold, wide, deep, tone] of ridges) {
    const verts = layLock(lay, fold.map(([a, b]) => at(a, b)), [wide * big, deep * big, near ? 5 : 3], SKIN_RIDGE);
    tones.push(...Array.from({ length: verts }, () => tone));
  }
  return tones;
}

/**
 * A pair of ears, each its own: how big, how far they stand out, and how the lobe hangs. Near to, the dish and every
 * fold; a little further, the dish and its rim; far off, only the shape the head already has.
 */
export function earsOf(w: Wearer, seat: Seat): readonly number[] {
  const { net, p, roles, cell } = w;
  const covered = ["hood", "helmet", "beanie", "pompom", "headwrap"].includes(p.outfit.hat);
  if (cell >= FAR_HAIR || p.outfit.costume === "fursuit" || covered) return [];
  const rand = streamOf(p.seed, 0x65617273);
  const h = headFrame(restSkeleton(p), p.build.head, p.face);
  const size = p.build.size;
  const k = marksOf(p);
  const big = (p.face.ears / 0.26) * mix(1, 1.18, rand());
  const stands = mix(0.34, 0.68, rand() ** 1.6);
  const hangs = mix(0, 0.1, rand());
  const lay: Lay = { net, roles, to: (q) => scale(add(h.c, scale(q, h.r)), size) };
  const lit = 1 + 0.2 * deepOf(p.palette.skin ?? "#888888");
  const tucks = tuckOf(p);
  const level = Math.atan2((k.pupil + k.sn) / 2 + 0.06, 0.85);
  const ears: Ears = { big, stands, hangs, level, near: cell < MID_HAIR };
  return [-1, 1].flatMap((x, side) => {
    if (!tucks[side]) return [];
    const at = earSkin(ears, seat.skin, x);
    seat.tops[side] = at(-0.06, 0.33);
    seat.lobes[side] = at(0, -0.3 - hangs);
    // (On deep skin an ear's folds would close up into a hole.)
    return earOf(lay, ears, at).map((t) => t * lit);
  });
}

// Hair: combs, ties and locks laid over the skull, and the ears beside them.

import { FAR, FRONT, SIDE, TAU, UP, add, clamp, cross, lerpV, madd, mix, scale, sub, unit } from "./vec.js";
import type { Vec } from "./vec.js";
import { streamOf } from "./roll.js";
import type { HairStyle, Person } from "./person.js";
import { deepOf } from "./palette.js";
import { restSkeleton } from "./skeleton.js";
import { HATTED, headFrame } from "./head.js";
import type { HeadFrame } from "./head.js";
import { HEAD } from "./bones.js";
import type { Net } from "./field.js";
import { FABRICS } from "./fabric.js";
import { marksOf, vecAt } from "./paint.js";

// ---------------------------------------------------------------- hair

/** Where a style's locks gather, and the line they run on from there: `t` 0 to 1 along it, `strand` of three in a plait. */
interface Tie { readonly at: Vec; readonly tail: (t: number, strand: number) => Vec; readonly spread: number; readonly plait?: boolean }

/** How a head of hair grows, in head radii: as many locks as this, combed from a parting, falling under their own weight and cut where they are cut. */
interface Comb {
  readonly count: number; readonly length: number; readonly width: number; readonly thick: number;
  /** How hard it falls; how much it stands off the scalp at the root. */
  readonly fall: number; readonly stand: number;
  /** A level it is cut to, and a fringe's, if it has them. */
  readonly cut?: number; readonly fringe?: number;
  readonly wave?: number; readonly rate?: number;
  /** How far shorter its shortest lock runs, for layers. */
  readonly layers?: number;
  readonly part?: number;
  readonly keep?: (u: Vec) => boolean;
  readonly ties?: readonly Tie[];
  /** A solid mass under the locks; a scalp clipped to stubble around them. */
  readonly shell?: boolean; readonly shave?: boolean;
  /** A sheet of broad locks under the fine ones, so a fall of hair is a mass and not strings. */
  readonly curtain?: boolean;
}

export const SKULL_AT: Vec = [0, 0.24, -0.1], SKULL: Vec = [0.86, 1.1, 1.08];

/** The round mass of an afro, in head radii. */
export const AFRO_AT: Vec = [0, 0.72, -0.3], AFRO = 1.14;

const ponyTail = (t: number): Vec => [0, 0.72 - 2.9 * t, -1.28 - 0.5 * Math.sin(t * 2.2)];
const bunCoil = (t: number): Vec => { const a = t * 30, up = t * Math.PI * 0.94 + 0.1, r = 0.36; return [Math.cos(a) * Math.sin(up) * r, 1.32 + Math.cos(up) * r * 0.74, -0.74 + Math.sin(a) * Math.sin(up) * r]; };
const pigtail = (x: number) => (t: number): Vec => [x * (1.04 + 0.42 * Math.sin(t * 2)), 0.38 - 2.5 * t, -0.62 - 0.2 * t];

/** One plait: three strands crossing over one another down a line, as a plait is. */
const plaited = (x: number) => (t: number, strand: number): Vec => {
  const a = t * 21 + strand * (TAU / 3), k = 0.19 * (1 - t * 0.5);
  return [x * (0.98 + 0.14 * t) + Math.sin(a) * k, -0.7 - 2.9 * t, 0.2 + 1.2 * clamp(t * 2.2, 0, 1) + Math.sin(a * 2) * k * 0.5];
};

export const COMBS: Readonly<Record<HairStyle, Comb | undefined>> = {
  bald: undefined,
  crop: { fringe: 0.8, count: 240, length: 0.72, cut: 0.1, width: 0.12, thick: 0.045, fall: 0.5, stand: 0.15 },
  side: { curtain: true, count: 210, length: 1.5, width: 0.15, thick: 0.05, fall: 0.8, stand: 0.1, part: 0.42 },
  curly: { fringe: 0.74, count: 190, length: 1.7, cut: -0.7, width: 0.14, thick: 0.1, fall: 1.2, stand: 0.15, wave: 0.12, rate: 8 },
  afro: { count: 0, length: 0.3, width: 0.05, thick: 0.05, fall: 0, stand: 3, shell: true },
  bob: { curtain: true, count: 240, length: 2.8, cut: -0.92, width: 0.2, thick: 0.05, fall: 2, stand: 0.1, part: 0.1 },
  long: { curtain: true, count: 250, length: 4.2, cut: -3.2, width: 0.2, thick: 0.05, fall: 2.2, stand: 0.1, part: 0.06, layers: 0.14 },
  bun: { count: 170, length: 2, width: 0.15, thick: 0.08, fall: 0, stand: 0.1, ties: [{ at: [0, 1.02, -0.72], tail: bunCoil, spread: 0.09 }] },
  pony: { count: 170, length: 2, width: 0.15, thick: 0.08, fall: 0, stand: 0.1, ties: [{ at: [0, 0.72, -1.2], tail: ponyTail, spread: 0.27 }] },
  mohawk: { count: 200, length: 0.78, width: 0.075, thick: 0.065, fall: 0, stand: 3, keep: (u) => Math.abs(u[0]) < 0.2, shave: true },
  shag: { curtain: true, count: 230, length: 2.6, width: 0.18, thick: 0.06, fall: 1.7, stand: 0.2, wave: 0.07, rate: 3, layers: 0.55, fringe: 0.7 },
  bangs: { curtain: true, count: 250, length: 3.4, cut: -2.3, width: 0.19, thick: 0.05, fall: 2.2, stand: 0.1, fringe: 0.66 },
  wavy: { curtain: true, count: 240, length: 3.6, cut: -2.7, width: 0.19, thick: 0.06, fall: 2, stand: 0.15, wave: 0.13, rate: 2.6, part: 0.14, layers: 0.15 },
  braids: { count: 170, length: 2, width: 0.16, thick: 0.05, fall: 0, stand: 0.1, part: 0, ties: [-1, 1].map((x) => ({ at: [x * 0.98, -0.7, 0.2] as Vec, tail: plaited(x), spread: 0, plait: true })) },
  locs: { curtain: true, count: 62, length: 3.3, width: 0.1, thick: 0.1, fall: 2, stand: 0.1, wave: 0.03, rate: 2, layers: 0.2 },
  twintails: { count: 170, length: 2, width: 0.13, thick: 0.09, fall: 0, stand: 0.1, part: 0, ties: [-1, 1].map((x) => ({ at: [x * 0.98, 0.42, -0.56] as Vec, tail: pigtail(x), spread: 0.26 })) },
  undercut: { count: 110, length: 1.6, width: 0.16, thick: 0.06, fall: 0.5, stand: 0.1, part: -0.5, keep: (u) => u[1] > 0.42, shave: true },
};

/** The hairline: well up the brow, down to the ears at the sides, into the nape behind. */
const HAIRLINE: readonly (readonly [number, number])[] = [[1, 0.64], [0.5, 0.6], [0.37, 0.3], [0.26, -0.08], [0.14, -0.08], [0.03, 0.12], [-0.25, 0.02], [-0.55, -0.35], [-0.8, -0.62], [-1, -0.62]];

/** Behind the hairline: across the brow, in at the temple, down a sideburn, up over the ear and round to the nape. */
export const scalped = (u: Vec): boolean => {
  const next = HAIRLINE.findIndex(([z]) => z <= u[2]), b = HAIRLINE[Math.max(1, next)] ?? [-1, -0.62], a = HAIRLINE[Math.max(0, Math.max(1, next) - 1)] ?? b;
  return u[1] > mix(a[1], b[1], clamp((a[0] - u[2]) / Math.max(0.001, a[0] - b[0]), 0, 1));
};

/** A point laid on the skull, where hair lies until it falls away from it. */
function onSkull(q: Vec): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], far = Math.hypot(...e) || 1;
  return add(SKULL_AT, [(SKULL[0] * e[0]) / far, (SKULL[1] * e[1]) / far, (SKULL[2] * e[2]) / far]);
}

/** A point kept out of the skull, and off the face unless it is a fringe. */
function offHead(q: Vec, front: boolean): Vec {
  const e: Vec = [(q[0] - SKULL_AT[0]) / SKULL[0], (q[1] - SKULL_AT[1]) / SKULL[1], (q[2] - SKULL_AT[2]) / SKULL[2]], far = Math.hypot(...e);
  const out: Vec = far < 1 ? [SKULL_AT[0] + (SKULL[0] * e[0]) / far, SKULL_AT[1] + (SKULL[1] * e[1]) / far, SKULL_AT[2] + (SKULL[2] * e[2]) / far] : q;
  const onFace = !front && out[1] < 0.42 && out[1] > -1.3 && out[2] > 0.3 && Math.abs(out[0]) < 0.92;
  return onFace ? [out[0], out[1], 0.3] : out;
}

/** Past the shoulders hair lies down the back. */
const offShoulders = (q: Vec): Vec => {
  const k = clamp((-1.5 - q[1]) / 0.6, 0, 1);
  return [q[0], q[1], mix(q[2], Math.min(q[2], -1.25), k)];
};

const rootAt = (u: Vec): Vec => add(SKULL_AT, [SKULL[0] * u[0], SKULL[1] * u[1], SKULL[2] * u[2]]);

/** Which way a root's hair leaves it: forward over the brow if it is a fringe, else out from the parting, or from the crown if it has none. */
function leaving(c: Comb, u: Vec, brow: boolean, parted: number, rand: () => number): Vec {
  const loose = (rand() - 0.5) * (brow ? 0.1 : 0.3), side = u[0] - parted, away: Vec = brow ? [side * 0.3 + loose, 0.1, 1] : c.part === undefined ? [u[0] + loose, 0, u[2] + 0.25] : u[2] < 0.3 ? [side * 1.6 + loose, 0, u[2] - 0.2] : [side * 1.1 + loose, 0.7, -1.5];
  return unit(add(unit(away, SIDE), scale(u, c.stand)));
}

/** One step of a lock. Combed hair lies on the head until it has somewhere to fall; only what is stiff stands off it. */
function lockStep(c: Comb, q: Vec, d: Vec, ds: number, brow: boolean): readonly [Vec, Vec] {
  const lies = c.stand < 1, leaning = lies && q[1] < SKULL_AT[1] + 0.25, step = madd(q, leaning ? unit(add(d, [0, -2.4, 0])) : d, ds);
  const next = offShoulders(offHead(lies && step[1] > SKULL_AT[1] ? onSkull(step) : step, brow));
  // (Off the head, nothing holds it up: it turns straight down.)
  // (And what comes over the temple is drawn back round it, clear of the face.)
  const free = lies && next[1] <= SKULL_AT[1], temple = lies && !brow && next[2] > 0.05 && next[1] < 0.85;
  return [next, unit(add(lies ? unit(sub(next, q), d) : d, [0, -c.fall * ds * (free ? 6 : 1), temple ? -2.2 * ds : 0]))];
}

/** A lock's line, from its root, combed and let fall. */
function combed(comb: Comb, u: Vec, rand: () => number, parted: number): readonly Vec[] {
  const c = { wave: 0, rate: 0, layers: 0, cut: -FAR, ...comb }, brow = c.fringe !== undefined && u[2] > 0.34 && u[1] > 0.4;
  const end = c.length * (1 - c.layers * rand()) * (brow ? 0.4 : 1), steps = Math.max(5, Math.ceil(end * 7)), ds = end / steps, stop = (brow ? c.fringe ?? -FAR : c.cut) + (rand() - 0.5) * (brow ? 0.04 : 0.34);
  const root = rootAt(u), lateral = unit(cross(leaving(c, u, brow, parted, rand), UP), SIDE), beat = rand() * TAU;
  let d = leaving(c, u, brow, parted, rand), q = root;
  const line: Vec[] = [root];
  for (let i = 0; i < steps && q[1] >= stop; i += 1) {
    [q, d] = lockStep(c, q, d, ds, brow);
    const arc = (i + 1) * ds, sway = c.wave * Math.min(1, arc * 1.2) * (u[2] > 0.25 ? 0.25 : 1), a = arc * c.rate + beat;
    line.push(add(q, add(scale(lateral, sway * Math.sin(a)), [0, 0, sway * Math.cos(a * 0.7)])));
  }
  // (Fine steps to follow the skull; a straight fall needs few points to hold them.)
  return line.filter((_, i) => i < 8 || i % (c.wave > 0 ? 2 : 3) === 0 || i === line.length - 1);
}

/** A lock drawn back to a tie and on along what runs from it. */
function gathered(tie: Tie, u: Vec, rand: () => number): readonly Vec[] {
  const root = rootAt(u), strand = Math.floor(rand() * 3), points = 14;
  // (A low tie is reached round the back of the head, never across the face.)
  const low = tie.at[1] < 0.6 && u[2] > -0.3, way = onSkull([(tie.at[0] || 1) > 0 ? 0.76 : -0.76, Math.max(tie.at[1], 0.1) + 0.2, -0.56]);
  const up = Array.from({ length: low ? 9 : 6 }, (_, i) => { const t = i / (low ? 9 : 6); return offHead(low ? lerpV(lerpV(root, way, t), lerpV(way, tie.at, t), t) : lerpV(root, tie.at, t), true); });
  const off: Vec = [(rand() - 0.5) * tie.spread * 2, (rand() - 0.5) * tie.spread, (rand() - 0.5) * tie.spread * 2], lag = rand() * 0.12;
  const run = Array.from({ length: points }, (_, i): Vec => { const t = (i / (points - 1)) * (1 - lag); return add(tie.tail(t, strand), scale(off, clamp(t * 5, 0.22, 1) * (1 - t * 0.5))); });
  return tie.plait === true ? up : [...up, ...run];
}

/** How a lock faces at a point round it. A fold of skin is lit as the skin it lies on, or a thin one is all edge and catches the rim light; a rope or a band is round; a clump of hair faces out, for what lights it is the mass, not the ribbon. */
function lockNormal(b: Vec, n: Vec, o: Vec, c: number, r: number, round: boolean, fabric?: number): Vec {
  if (fabric === FABRICS.skin) return unit(add(o, scale(b, c * 0.3)));
  if (fabric !== undefined) return unit(add(scale(b, c * 0.7), scale(n, r)));
  return unit(round ? add(scale(b, c * 0.6), scale(n, 0.55 + r * 0.45)) : add(scale(b, c * 0.45), scale(n, 0.7 + r * 0.3)));
}

/** A lock's width along it: full from near the root, gone to almost nothing at the end. */
const lockTaper = (s: number): number => Math.min(1, 0.8 + s * 3) * Math.min(1, (1 - s) * 3 + 0.12);

/** One lock laid into the net: a flat tapering ribbon, round as a rope if it is as thick as it is wide. */
export function layLock(net: Net, roles: readonly string[], to: (q: Vec) => Vec, line: readonly Vec[], [width, thick, sides]: readonly [number, number, number], worn?: { readonly up?: Vec; readonly bone?: number; readonly role: string; readonly fabric: number; readonly taper?: (s: number) => number }): number {
  const base = net.position.length / 3, bone = worn?.bone ?? HEAD, role = Math.max(0, roles.indexOf(worn?.role ?? "hair")), last = line.length - 1, taperOf = worn ? worn.taper ?? (() => 1) : lockTaper;
  line.forEach((q, i) => {
    const s = i / last, t = unit(sub(line[Math.min(last, i + 1)] ?? q, line[Math.max(0, i - 1)] ?? q), UP), o = worn?.up ?? unit(sub(q, SKULL_AT), UP);
    const b = unit(cross(t, o), SIDE), n = cross(b, t), taper = taperOf(s);
    for (let j = 0; j < sides; j += 1) {
      const a = (j / sides) * TAU, c = Math.cos(a), r = Math.sin(a);
      net.position.push(...to(add(madd(q, b, c * width * taper), scale(n, r * thick * taper))));
      net.normal.push(...lockNormal(b, n, o, c, r, thick >= width * 0.7, worn?.fabric));
      net.role.push(role); net.bones.push(bone, bone); net.weight.push(1); net.fabric.push(worn?.fabric ?? FABRICS.hair);
      net.loose.push(clamp(s * 1.6 - 0.2, 0, 1) * 0.8); net.soft.push(0);
      if (worn) net.cloth.push(j / sides, 0, s * last * 0.08, 1); else net.cloth.push(t[0], t[1], t[2], (base % 97) * 0.41 + c * width);
    }
    if (i === last) return;
    for (let j = 0; j < sides; j += 1) { const v = base + i * sides, k = (j + 1) % sides; net.index.push(v + j, v + k, v + sides + j, v + k, v + sides + k, v + sides + j); }
  });
  return line.length * sides;
}

/** Hair that stands or hangs in its own ropes, and is not a mass of clumps. */
const roped = (c: Comb): boolean => c.thick >= 0.1 || c.stand >= 1;

/** The roots of a head of hair, evenly over it, as far as its hairline and its style let them go. */
function rootsOf(c: Comb, far: boolean): readonly Vec[] {
  const all = Math.ceil(c.count * (roped(c) ? 1 : far ? 0.2 : 0.46) * 2.6);
  const every = Array.from({ length: all }, (_, i): Vec => { const y = 1 - (2 * (i + 0.5)) / all, r = Math.sqrt(1 - y * y), a = i * 2.39996 + 0.7; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  return every.filter((u) => scalped(u) && (c.keep?.(u) ?? true));
}

/** What hair grows from is its roots' dark, so nothing between the locks reads as a bald patch: the skin behind the hairline, clipped to stubble or not. */
function paintScalp(net: Net, roles: readonly string[], h: HeadFrame, size: number, shaved: boolean): void {
  const paint = Math.max(0, roles.indexOf(shaved ? "brow" : "hair"));
  net.role.forEach((_, v) => {
    if ((net.bones[v * 2] !== HEAD && net.bones[v * 2 + 1] !== HEAD) || net.fabric[v] !== FABRICS.skin) return;
    const at: Vec = [0, 1, 2].map((c) => ((net.position[v * 3 + c] ?? 0) / size - (h.c[c] ?? 0)) / h.r) as unknown as Vec;
    const e = sub(at, SKULL_AT), u = unit([e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]], UP);
    // (Not an ear, which stands out past the skull; and short of the hairline, which the cap draws.)
    const ear = Math.hypot(e[0] / SKULL[0], e[1] / SKULL[1], e[2] / SKULL[2]) > 1.08;
    if (scalped(unit([u[0], u[1] - 0.09, u[2]], UP)) && e[1] > -0.9 && !ear) net.role[v] = paint;
  });
}

export const styleOf = (p: Person): HairStyle => (p.outfit.hat === "none" ? p.hair : HATTED[p.hair] ?? p.hair);

/** A lock's shade along it: deep at the root, and a band of sheen where hair rounds the crown. */
const lockTone = (s: number, tone: number): number => tone * mix(0.72, 1, clamp(s * 5, 0, 1));

/** How close a mesh has to be, by its grid, for a head of locks; further than this, thinner ones; further still, the solid shape alone. */
export const MID_HAIR = 0.02, FAR_HAIR = 0.03;

const ELASTIC = { role: "trim", fabric: FABRICS.satin };

/** A loop round a line, where it is tied. */
const looped = (at: Vec, along: Vec, r: number): readonly Vec[] => {
  const a = unit(cross(along, SIDE), FRONT), b = cross(along, a);
  return Array.from({ length: 11 }, (_, i) => { const t = (i / 10) * TAU; return add(madd(at, a, Math.cos(t) * r), scale(b, Math.sin(t) * r)); });
};

/** What holds a style up or just dresses it: every tie has its elastic, and now and then a head has a band or a clip. */
function decorOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb): readonly number[] {
  const lay = (line: readonly Vec[], size: readonly [number, number, number]): number[] => Array.from({ length: layLock(net, roles, to, line, size, ELASTIC) }, () => 1);
  const bands = (c.ties ?? []).flatMap((t) => (t.plait === true ? [t.tail(0.98, 0), t.at] : [t.at]).map((at) => {
    const down = t.plait === true ? unit(sub(t.tail(0.99, 0), t.tail(0.9, 0)), UP) : unit(sub(t.tail(0.06, 0), t.at), UP);
    return lay(looped(at, down, t.plait === true ? 0.16 : t.spread * 0.3 + 0.13), [0.06, 0.06, 4]);
  }));
  return bands.flat();
}

const SKIN_RIDGE = { role: "skin", fabric: FABRICS.skin };

const LOOSE: readonly HairStyle[] = ["side", "curly", "bob", "long", "shag", "bangs", "wavy", "locs"];

/** Which ears are bare, left and right. Hair worn loose goes over them, or is tucked back behind one or both; every other head shows them. */
export function tuckOf(p: Person): readonly [boolean, boolean] {
  if (!LOOSE.includes(styleOf(p))) return [true, true];
  const rand = streamOf(p.seed, 0x7475636b), roll = rand(), side = rand() < 0.5;
  if (roll < 0.6) return [false, false];
  return roll < 0.8 ? [true, true] : [side, !side];
}

/** Hair that would come down over the face stops short of it; what falls beside the face stays beside it. */
function offFace(line: readonly Vec[]): readonly Vec[] {
  const on = (q: Vec): boolean => q[2] > 0.12 && q[1] < 0.62 && Math.abs(q[0]) < 0.8, at = line.findIndex(on);
  return at < 0 ? line : line.slice(0, at);
}

/** Ropes of hair lie on the cap, not in it. */
const onCap = (c: Comb, q: Vec): Vec => (roped(c) ? add(SKULL_AT, scale(sub(q, SKULL_AT), 1.05)) : q);

/** Tucked means tucked: what starts ahead of the ear stops above it, and nothing hangs in front. */
function clearOfEar(line: readonly Vec[], tucked: boolean): readonly Vec[] {
  const at = tucked ? line.findIndex((q) => q[1] < 0.3 && q[2] > -0.3) : -1;
  return at < 0 ? line : line.slice(0, at);
}

/** A lock past the ear on its way down: all of it behind the ear if that side is tucked, all of it clear over the ear if not. */
function pastEar(q: Vec, tucked: boolean): Vec {
  const low = clamp((0.42 - q[1]) / 0.25, 0, 1);
  if (tucked) return offHead([q[0], q[1], q[2] > -0.36 ? mix(q[2], -0.36 - (q[2] + 0.36) * 0.2, low) : q[2]], true);
  const round = low * clamp((q[1] + 0.55) / 0.2, 0, 1) * clamp((0.2 - q[2]) / 0.15, 0, 1) * clamp((q[2] + 0.5) / 0.15, 0, 1);
  return [q[0] < 0 ? Math.min(q[0], mix(q[0], -1.08, round)) : Math.max(q[0], mix(q[0], 1.08, round)), q[1], q[2]];
}

/** A head's boundary: the true surface of what is already on it, round its centre, in head radii. Whatever goes on a person is seated on this, and never on a guess at where a head is. */
export interface Bound {
  /** How far out the surface lies along a direction from the centre. */
  readonly far: (dir: Vec) => number;
  /** The point on it along a direction, `lift` clear of it. */
  readonly on: (dir: Vec, lift?: number) => Vec;
}

const SHELL_AROUND = 96, SHELL_UP = 48;

/** A direction from a head's centre: `az` round from the nose, `el` up. */
export const bearingOf = (az: number, el: number): Vec => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

/** Fills the cells of a shell no vertex fell in from their neighbours, then eases it. */
function closedShell(cells: Float32Array): void {
  const at = (grid: Float32Array, a: number, e: number): number => grid[clamp(e, 0, SHELL_UP - 1) * SHELL_AROUND + ((a + SHELL_AROUND) % SHELL_AROUND)] ?? 0;
  const pass = (fill: boolean): void => {
    const was = cells.slice();
    for (let e = 0; e < SHELL_UP; e += 1) for (let a = 0; a < SHELL_AROUND; a += 1) {
      const near = [at(was, a - 1, e), at(was, a + 1, e), at(was, a, e - 1), at(was, a, e + 1)].filter((v) => v > 0), mine = at(was, a, e);
      if (near.length === 0 || (fill && mine > 0)) continue;
      const mean = near.reduce((sum, v) => sum + v, 0) / near.length;
      cells[e * SHELL_AROUND + a] = fill ? mean : mine > 0 ? mine * 0.5 + mean * 0.5 : mean;
    }
  };
  for (let i = 0; i < 12; i += 1) pass(true);
  pass(false);
}

/** The boundary of a head, from those of its vertices `keep` takes. */
export function boundOf(net: Net, h: Pick<HeadFrame, "c" | "r">, size: number, keep: (v: number) => boolean): Bound {
  const cells = new Float32Array(SHELL_AROUND * SHELL_UP);
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (!keep(v)) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r), far = Math.hypot(...q);
    if (far < 0.2 || far > 3.5) continue;
    const a = Math.floor(((Math.atan2(q[0], q[2]) / TAU + 1) % 1) * SHELL_AROUND), e = clamp(Math.floor((Math.asin(q[1] / far) / Math.PI + 0.5) * SHELL_UP), 0, SHELL_UP - 1), i = e * SHELL_AROUND + a;
    cells[i] = Math.max(cells[i] ?? 0, far);
  }
  closedShell(cells);
  const far = (dir: Vec): number => {
    const a = ((Math.atan2(dir[0], dir[2]) / TAU + 1) % 1) * SHELL_AROUND - 0.5, e = clamp((Math.asin(clamp(dir[1], -1, 1)) / Math.PI + 0.5) * SHELL_UP - 0.5, 0, SHELL_UP - 1.001);
    const a0 = Math.floor(a), e0 = Math.floor(e), cell = (x: number, y: number): number => cells[y * SHELL_AROUND + ((x + SHELL_AROUND) % SHELL_AROUND)] ?? 1;
    return mix(mix(cell(a0, e0), cell(a0 + 1, e0), a - a0), mix(cell(a0, e0 + 1), cell(a0 + 1, e0 + 1), a - a0), e - e0);
  };
  return { far, on: (dir, lift = 0) => scale(dir, far(dir) + lift) };
}

/** Where what is worn holds on to a head: its skin, and each ear's top and lobe once it has them. */
export interface Seat { readonly skin: Bound; readonly tops: (Vec | null)[]; readonly lobes: (Vec | null)[] }

/** A line with its corners rounded off. */
function roundedOff(line: readonly (readonly [number, number])[], times: number): readonly (readonly [number, number])[] {
  if (times <= 0) return line;
  const cut = line.slice(1).flatMap((b, i): (readonly [number, number])[] => { const a = line[i] ?? b; return [[mix(a[0], b[0], 0.25), mix(a[1], b[1], 0.25)], [mix(a[0], b[0], 0.75), mix(a[1], b[1], 0.75)]]; });
  return roundedOff([line[0] ?? [0, 0], ...cut, line[line.length - 1] ?? [0, 0]], times - 1);
}

/** The folds of an ear, forward and up from its middle, in head radii: the rim round the top and back, the ridge inside it, and the flap before it. */
const EAR_RIM: readonly (readonly [number, number])[] = [[0.08, 0.1], [0.1, 0.24], [0.02, 0.32], [-0.1, 0.33], [-0.2, 0.24], [-0.24, 0.1], [-0.21, -0.05], [-0.13, -0.17], [-0.05, -0.26]];
const EAR_RIDGE: readonly (readonly [number, number])[] = [[-0.03, 0.22], [-0.1, 0.18], [-0.13, 0.08], [-0.1, -0.03], [-0.04, -0.11]];
const EAR_FLAP: readonly (readonly [number, number])[] = [[0.08, 0.04], [0.09, -0.02], [0.06, -0.08]];

/** The skin of an ear, from its rim in to the hollow, dished: both sides of it, for what shows from behind. */
function pinnaOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, at: (a: number, b: number, sunk: number) => Vec, rim: readonly (readonly [number, number])[]): readonly number[] {
  const rings = 4, base = net.position.length / 3, count = rim.length, role = Math.max(0, roles.indexOf("skin")), mid = rim.reduce<readonly [number, number]>((m, [a, b]) => [m[0] + a / count, m[1] + b / count], [0, 0]);
  const tones: number[] = [];
  // (The last ring runs back from the rim to the head, so an ear is a solid thing and not a sheet held beside it.)
  for (let k = 0; k <= rings + 1; k += 1) rim.forEach(([a, b]) => {
    const s = Math.min(1, k / rings), back = k > rings, q = back ? at(mix(mid[0], a, 0.72), mix(mid[1], b, 0.72), 0.34) : at(mix(mid[0], a, s), mix(mid[1], b, s), 0.09 * (1 - s));
    net.position.push(...to(q)); net.normal.push(...unit([q[0], 0, 0.3], SIDE)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.skin);
    net.loose.push(0); net.cloth.push(0, 0, 0, 1); net.soft.push(0); tones.push(mix(0.56, 0.9, s));
  });
  for (let k = 0; k <= rings; k += 1) for (let i = 0; i < count; i += 1) {
    const v = base + k * count, n = (i + 1) % count, one = v + i, two = v + n, three = v + count + i, four = v + count + n;
    net.index.push(one, two, three, two, four, three, one, three, two, two, three, four);
  }
  return tones;
}

/** A pair of ears, each its own: how big, how far they stand out, and how the lobe hangs. Near to, the dish and every fold; a little further, the dish and its rim; far off, only the shape the head already has. */
export function earsOf(net: Net, p: Person, roles: readonly string[], cell: number, seat: Seat): readonly number[] {
  if (cell >= FAR_HAIR || p.outfit.costume === "fursuit" || ["hood", "helmet", "beanie", "pompom", "headwrap"].includes(p.outfit.hat)) return [];
  const rand = streamOf(p.seed, 0x65617273), h = headFrame(restSkeleton(p), p.build.head, p.face), size = p.build.size, k = marksOf(p);
  const big = (p.face.ears / 0.26) * mix(1, 1.18, rand()), stands = mix(0.34, 0.68, rand() ** 1.6), hangs = mix(0, 0.1, rand());
  const near = cell < MID_HAIR, to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size), lit = 1 + 0.2 * deepOf(p.palette.skin ?? "#888888");
  const tucks = tuckOf(p), level = Math.atan2((k.pupil + k.sn) / 2 + 0.06, 0.85);
  return [-1, 1].flatMap((x, side) => {
    if (!tucks[side]) return [];
    // (An ear grows from the skin where the skin really is: from the line of the brow to the base of the nose, behind the jaw, leaning back.)
    const out = unit([x, 0.04, -0.24], SIDE);
    const at = (a: number, b: number, sunk = 0): Vec => {
      const lean = b * 0.22, dir = bearingOf(x * (Math.PI / 2 + 0.12 - (a - lean) * big), level + b * big);
      return madd(seat.skin.on(dir), out, 0.03 + Math.max(0, (0.12 - a) * big * stands + Math.min(0, b) * 0.34) - sunk);
    };
    const lobe = [[-0.03, -0.3 - hangs], [0.03, -0.27 - hangs * 0.5]] as const, line = roundedOff([...EAR_RIM, ...lobe], near ? 2 : 1), flap = roundedOff(EAR_FLAP, near ? 1 : 0);
    seat.tops[side] = at(-0.06, 0.33);
    seat.lobes[side] = at(0, -0.3 - hangs);
    const tones = [...pinnaOf(net, roles, to, at, [...line, ...flap.slice().reverse()])];
    const ridges: readonly (readonly [readonly (readonly [number, number])[], number, number, number])[] = near ? [[line, 0.046, 0.032, 0.94], [roundedOff(EAR_RIDGE, 2), 0.026, 0.02, 0.84], [flap, 0.03, 0.024, 0.92]] : [[line, 0.05, 0.032, 0.92]];
    for (const [fold, wide, deep, tone] of ridges) {
      const verts = layLock(net, roles, to, fold.map(([a, b]) => at(a, b)), [wide * big, deep * big, near ? 5 : 3], SKIN_RIDGE);
      tones.push(...Array.from({ length: verts }, () => tone));
    }
    // (On deep skin an ear's folds would close up into a hole.)
    return tones.map((t) => t * lit);
  });
}

/** How low hair comes round the head, at a bearing from the brow. */
function edgeAt(a: number, c: Comb): number {
  const held = (y: number): boolean => { const u = unit([Math.sin(a), y, Math.cos(a)], UP); return scalped(u) && (c.keep?.(u) ?? true); };
  let y = 2.4;
  while (y > -2.4 && held(y - 0.04)) y -= 0.04;
  return y;
}

/** The way hair runs over the cap: to its tie, or back and down. */
function flowOf(c: Comb, u: Vec): Vec {
  const tie = tieOf(c, u);
  return tie ? unit(sub(tie.at, add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]])), UP) : unit([u[0] * 0.3, -0.5, -1], UP);
}

/** What hair grows out of: a skin of it over the skull, ending along the hairline itself, a curve and not a mesh's steps, a little ragged. */
function capOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roof: number, far: boolean, rand: () => number): readonly number[] {
  const around = far ? 40 : 96, rows = far ? 6 : 10, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [];
  const rag = Array.from({ length: around }, () => (rand() - 0.5) * 0.05), puff = roped(c) ? 1.08 : 1.03;
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i < around; i += 1) {
    const a = (i / around) * TAU, s = k / rows, low = edgeAt(a, c) + (rag[i] ?? 0) * s, y = mix(2.4, low, s), u = unit([Math.sin(a), y, Math.cos(a)], UP);
    const q = to(add(SKULL_AT, [u[0] * SKULL[0] * puff, u[1] * SKULL[1] * puff, u[2] * SKULL[2] * puff]));
    net.position.push(q[0], Math.min(q[1], roof), q[2]); net.normal.push(...u); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(0); net.soft.push(0); net.cloth.push(...flowOf(c, u), a * 2.2); tones.push(mix(0.94, 0.84, s));
  }
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < around; i += 1) {
    const v = base + k * around, n = (i + 1) % around;
    net.index.push(v + i, v + n, v + around + i, v + n, v + around + n, v + around + i, v + i, v + around + i, v + n, v + n, v + around + i, v + around + n);
  }
  return tones;
}

/** The hair down over an ear: one sheet from the temple to where the hair ends, round the ear and not through it. */
function sideOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, x: number, rand: () => number, far: boolean): readonly number[] {
  const across = far ? 8 : 20, rows = far ? 8 : 16, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [];
  const bottom = Math.max(-1.5, c.cut ?? -FAR, 0.7 - c.length * 0.75), scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.09);
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i <= across; i += 1) {
    const s = k / rows, z = mix(mix(0.14, -0.1, s) + 0.035 * Math.sin(s * 9 + x), -0.72, i / across), y = mix(0.62, bottom + (scallops[i] ?? 0) + (1 - i / across) ** 3 * 0.7, s);
    const round = Math.sqrt(Math.max(0, 1 - ((y - SKULL_AT[1]) / SKULL[1]) ** 2 - ((z - SKULL_AT[2]) / SKULL[2]) ** 2)) * SKULL[0] * 1.045;
    const ear = clamp((y + 0.5) / 0.2, 0, 1) * clamp((0.62 - y) / 0.2, 0, 1) * clamp((0.24 - z) / 0.14, 0, 1) * clamp((z + 0.5) / 0.12, 0, 1), wide = Math.max(round, 0.74, mix(0, 1.02, ear));
    net.position.push(...to([x * wide, y, z])); net.normal.push(...unit([x, 0.1, z * 0.6], UP)); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(clamp(s * 1.4 - 0.4, 0, 1) * 0.5); net.soft.push(0); net.cloth.push(0, -1, -0.1, z * 1.6); tones.push(0.86);
  }
  const row = across + 1;
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < across; i += 1) {
    const v = base + k * row + i;
    net.index.push(v, v + row, v + 1, v + 1, v + row, v + row + 1, v, v + 1, v + row, v + 1, v + row + 1, v + row);
  }
  return tones;
}

/** A fringe: one sheet of hair from under the cap down over the brow, cut in an even line that rises to the temples, a little scalloped. */
function fringeOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, rand: () => number, far: boolean): readonly number[] {
  if (c.fringe === undefined) return [];
  const across = far ? 16 : 40, rows = 6, base = net.position.length / 3, role = Math.max(0, roles.indexOf("hair")), tones: number[] = [], wide = 0.76;
  const scallops = Array.from({ length: across + 1 }, () => (rand() - 0.5) * 0.035), beat = rand() * TAU;
  for (let k = 0; k <= rows; k += 1) for (let i = 0; i <= across; i += 1) {
    const x = ((i / across) * 2 - 1) * wide, s = k / rows, edge = (c.fringe ?? 0) + 0.3 * (x / wide) ** 4 + 0.03 * Math.sin(x * 16 + beat) + (scallops[i] ?? 0) * 1.8;
    const y = mix(1.04, edge, s), ex = x / SKULL[0], ey = (y - SKULL_AT[1]) / SKULL[1], z = Math.sqrt(Math.max(0.02, 1 - ex * ex - ey * ey));
    const out = unit([ex, ey, z], UP), q = add(SKULL_AT, [out[0] * SKULL[0] * 1.045, out[1] * SKULL[1] * 1.045, out[2] * SKULL[2] * 1.045]);
    net.position.push(...to(q)); net.normal.push(...out); net.role.push(role); net.bones.push(HEAD, HEAD); net.weight.push(1); net.fabric.push(FABRICS.hair);
    net.loose.push(0); net.soft.push(0); net.cloth.push(x * 0.12 + 0.3 * Math.sin(x * 23 + beat) + (scallops[i] ?? 0) * 26, -1, 0.15 + 0.3 * Math.sin(x * 31 + beat * 2), x * 1.6); tones.push(mix(0.8, 0.66, s) * (0.92 + 0.5 * (scallops[i] ?? 0) / 0.035 * 0.3));
  }
  const row = across + 1;
  for (let k = 0; k < rows; k += 1) for (let i = 0; i < across; i += 1) {
    const v = base + k * row + i;
    net.index.push(v, v + row, v + 1, v + 1, v + row, v + row + 1, v, v + 1, v + row, v + 1, v + row + 1, v + row);
  }
  return tones;
}

/** Short fine hairs along the hairline, lying back on the skull: where a head of hair really starts is never a line. */
function featherOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, rand: () => number, far: boolean): readonly number[] {
  const tones: number[] = [];
  for (let i = 0; i < (far || c.shell === true ? 0 : 150); i += 1) {
    const a = (i / 150) * TAU + rand() * 0.04, ground: Vec = [Math.sin(a), 0, Math.cos(a)];
    const y = edgeAt(a, c), u = unit([ground[0], y - rand() * 0.08, ground[2]], UP), root = add(SKULL_AT, [u[0] * SKULL[0], u[1] * SKULL[1], u[2] * SKULL[2]]);
    const back = unit([-ground[0] * 0.25, 0.75, -ground[2] * 0.7 + (rand() - 0.5) * 0.3], UP), long = mix(0.1, 0.24, rand());
    const line = [0, 0.33, 0.66, 1].map((s) => { const q = onSkull(madd(root, back, s * long)); return add(SKULL_AT, scale(sub(q, SKULL_AT), 1.012)); });
    const from = net.loose.length, verts = layLock(net, roles, to, line, [c.width * 0.42, c.thick * 0.6, 3]), tone = 0.76 + rand() * 0.24;
    net.loose.fill(0, from);  // (Too short to blow about.)
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone(v / verts * 0.3, tone)));
  }
  return tones;
}

/** Each plait's three strands, round as rope, over and under one another. */
function plaitsOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb): readonly number[] {
  const ties = (c.ties ?? []).filter((t) => t.plait === true);
  return ties.flatMap((tie) => [0, 1, 2].flatMap((strand) => {
    const verts = layLock(net, roles, to, Array.from({ length: 44 }, (_, i) => tie.tail(i / 43, strand)), [0.125, 0.125, 6]);
    return Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.86 + strand * 0.06));
  }));
}

/** The broad locks under a fall of hair, sunk a little in from the fine ones. */
function curtainOf(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roots: readonly Vec[], past: (line: readonly Vec[], u: Vec) => readonly Vec[], rand: () => number, parted: number): readonly number[] {
  const tones: number[] = [];
  for (const u of roots.filter((_, i) => c.curtain === true && i % 3 === 0)) {
    const line = past(combed(c, u, rand, parted), u).slice(0, -2).map((q) => add(SKULL_AT, scale(sub(q, SKULL_AT), 0.95)));
    if (line.length < 3) continue;
    const verts = layLock(net, roles, to, line, [c.width * 2.8, c.thick, 3]);
    tones.push(...Array.from({ length: verts }, (_, v) => lockTone(v / verts, 0.82)));
  }
  return tones;
}

/** Which tie a root's hair goes to: the side it is on, if there are two. */
const tieOf = (c: Comb, u: Vec): Tie | undefined => c.ties?.[(c.ties.length > 1 && u[0] > 0 ? 1 : 0)];

/** A head of hair as locks, on their head's bone. Each vertex's shade comes back, in order: deep at the root, lock from lock a little apart. */
export function hairLocks(
  net: Net,
  p: Person,
  roles: readonly string[],
  cell: number,
  roof: number,
): readonly number[] {
  const comb = COMBS[styleOf(p)];
  if (!comb || p.outfit.costume === "fursuit" || cell >= FAR_HAIR) return [];
  const rand = streamOf(p.seed, 0x68616972), h = headFrame(restSkeleton(p), p.build.head, p.face), size = p.build.size;
  const to = (q: Vec): Vec => scale(h.at(q[0], q[1], q[2]), size), far = cell >= MID_HAIR;
  const c = { ...comb, length: comb.length * mix(0.88, 1.14, rand()) }, parted = (c.part ?? 0) * (rand() < 0.5 ? -1 : 1);
  paintScalp(net, roles, h, size, c.shave === true || c.length < 1);
  const roots = rootsOf(c, far), tucks = tuckOf(p), loose = LOOSE.includes(styleOf(p));
  const past = (line: readonly Vec[], u: Vec): readonly Vec[] => (loose ? offFace(clearOfEar(line, tucks[u[0] > 0 ? 1 : 0]).map((q) => onCap(c, pastEar(q, tucks[u[0] > 0 ? 1 : 0])))) : line);
  const sides = [-1, 1].flatMap((x, side) => (loose && !roped(c) && !tucks[side] ? sideOf(net, roles, to, c, x, rand, far) : []));
  return [...sides, ...capOf(net, roles, to, c, roof, far, rand), ...fringeOf(net, roles, to, c, rand, far), ...curtainOf(net, roles, to, c, roots, past, rand, parted), ...fineLocks(net, roles, to, c, roots, past, rand, parted, roof, far), ...featherOf(net, roles, to, c, rand, far), ...plaitsOf(net, roles, to, c), ...decorOf(net, roles, to, c)];
}

/** The fine locks of a head, each its own width and shade. */
function fineLocks(net: Net, roles: readonly string[], to: (q: Vec) => Vec, c: Comb, roots: readonly Vec[], past: (line: readonly Vec[], u: Vec) => readonly Vec[], rand: () => number, parted: number, roof: number, far: boolean): readonly number[] {
  const tones: number[] = [];
  // (Ropes start back from the brow: hanging from its very edge, they would only be teeth.)
  for (const u of roots.filter((r) => !(roped(c) && c.stand < 1 && r[2] > 0.16))) {
    const tie = tieOf(c, u), line = past(tie ? gathered(tie, u, rand) : combed(c, u, rand, parted), u).filter((q) => to(q)[1] < roof);
    if (line.length < 3) continue;
    const verts = layLock(net, roles, to, line, [c.width * (roped(c) ? 1 : tie ? 1.3 : far ? 3.4 : 2.3) * (0.85 + rand() * 0.3), c.thick * (roped(c) ? 1 : 1.5), far ? 3 : 5]), tone = 0.9 + rand() * 0.1;
    for (let v = 0; v < verts; v += 1) tones.push(lockTone(v / verts, tone));
  }
  return tones;
}

/** A net without the vertices no face uses. */
export function compacted(net: Net): Net {
  const next = new Map<number, number>();
  for (const v of net.index) if (!next.has(v)) next.set(v, next.size);
  const keep = (list: readonly number[], width: number): number[] => [...next.keys()].flatMap((v) => list.slice(v * width, v * width + width));
  return { position: keep(net.position, 3), normal: keep(net.normal, 3), role: keep(net.role, 1), bones: keep(net.bones, 2), weight: keep(net.weight, 1), fabric: keep(net.fabric, 1), loose: keep(net.loose, 1), cloth: keep(net.cloth, 4), soft: keep(net.soft, 1), index: net.index.map((v) => next.get(v) ?? 0) };
}

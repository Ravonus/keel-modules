// Hair styles: each comb, the tails its ties run on, the skull they lie over and the hairline they stop at.

import { TAU, clamp } from "../vec.js";
import type { Vec } from "../vec.js";
import type { HairStyle } from "../body/person.js";

/**
 * Where a style's locks gather, and the line they run on from there: `t` 0 to 1 along it, `strand` of three in a plait.
 */
export interface Tie { readonly at: Vec; readonly tail: (t: number, strand: number) => Vec; readonly spread: number; readonly plait?: boolean }

/**
 * How a head of hair grows, in head radii: as many locks as this, combed from a parting, falling under their own weight
 * and cut where they are cut.
 */
export interface Comb {
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

export const SKULL_AT: Vec = [0, 0.24, -0.1];
export const SKULL: Vec = [0.86, 1.1, 1.08];

/** The round mass of an afro, in head radii. */
export const AFRO_AT: Vec = [0, 0.72, -0.3];
export const AFRO = 1.14;

const ponyTail = (t: number): Vec => [0, 0.72 - 2.9 * t, -1.28 - 0.5 * Math.sin(t * 2.2)];
const bunCoil = (t: number): Vec => {
  const a = t * 30;
  const up = t * Math.PI * 0.94 + 0.1;
  const r = 0.36;
  return [Math.cos(a) * Math.sin(up) * r, 1.32 + Math.cos(up) * r * 0.74, -0.74 + Math.sin(a) * Math.sin(up) * r];
};
const pigtail = (x: number) => (t: number): Vec => [x * (1.04 + 0.42 * Math.sin(t * 2)), 0.38 - 2.5 * t, -0.62 - 0.2 * t];

/** One plait: three strands crossing over one another down a line, as a plait is. */
const plaited = (x: number) => (t: number, strand: number): Vec => {
  const a = t * 21 + strand * (TAU / 3);
  const k = 0.19 * (1 - t * 0.5);
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
export const HAIRLINE: readonly (readonly [number, number])[] = [[1, 0.64], [0.5, 0.6], [0.37, 0.3], [0.26, -0.08], [0.14, -0.08], [0.03, 0.12], [-0.25, 0.02], [-0.55, -0.35], [-0.8, -0.62], [-1, -0.62]];

/**
 * How close a mesh has to be, by its grid, for a head of locks; further than this, thinner ones; further still, the
 * solid shape alone.
 */
export const MID_HAIR = 0.02;
export const FAR_HAIR = 0.03;

/** The styles worn loose, that can go over the ears or be tucked behind them. */
export const LOOSE: readonly HairStyle[] = ["side", "curly", "bob", "long", "shag", "bangs", "wavy", "locs"];

// The near foliage as dabs: dark blots that make the shade between leaves, stems along curves, then leaves in
// clusters, the deep ones first. Every leaf is kept left of the recipe's bound.
import { KIND, mix, rgb, type Dab, type Rgb } from "./dab.js";
import { draws, turn, type Draw } from "./exact.js";
import type { BranchRecipe, MassRecipe, Pair, PlateRecipe } from "./recipe.js";

/** The leaf colours, shade to light, and the bound in plate heights. */
interface LeafKit {
  readonly ramp: readonly Rgb[];
  readonly maxX: number;
  readonly aspect: number;
}

/** Points in plate heights (x scaled by the aspect). */
type Point = readonly [number, number];

const bezier = (p: readonly Point[], t: number): Point => {
  const [a, b, c] = [p[0] ?? [0, 0], p[1] ?? [0, 0], p[2] ?? [0, 0]];
  const s = 1 - t;
  return [s * s * a[0] + 2 * s * t * b[0] + t * t * c[0], s * s * a[1] + 2 * s * t * b[1] + t * t * c[1]];
};
const tangent = (p: readonly Point[], t: number): Point => {
  const [a, b, c] = [p[0] ?? [0, 0], p[1] ?? [0, 0], p[2] ?? [0, 0]];
  return [2 * (1 - t) * (b[0] - a[0]) + 2 * t * (c[0] - b[0]), 2 * (1 - t) * (b[1] - a[1]) + 2 * t * (c[1] - b[1])];
};
const unit = (x: number, y: number): Point => {
  const l = Math.sqrt(x * x + y * y) || 1;
  return [x / l, y / l];
};

/** A colour on the ramp at `t` in 0..1. */
function ramped(ramp: readonly Rgb[], t: number): Rgb {
  const at = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(at), ramp.length - 2);
  return mix(ramp[i] ?? [0, 0, 0], ramp[i + 1] ?? [0, 0, 0], at - i);
}

/** A leaf from its stalk at `base` (plate heights), pointing along `axis`, `length` long. */
function leafOf(kit: LeafKit, draw: Draw, at: { base: Point; axis: Point; length: number; deep: boolean }): Dab {
  const lobes = draw() < 0.6 ? 1 : 3 + 2 * Math.floor(draw() * 2);
  const half = at.length / 2;
  const wid = half * (lobes === 1 ? draw.within(0.42, 0.55) : draw.within(0.8, 0.95));
  const [ax, ay] = at.axis;
  // (The box's reach across x; a leaf over the bound slides back left of it.)
  const reach = Math.abs(ax) * half + Math.abs(ay) * wid;
  const cx = Math.min(at.base[0] + ax * half, kit.maxX - reach);
  const facing = (-ax - ay) * 0.12;
  const light = (at.deep ? draw.within(0.05, 0.4) : draw.within(0.35, 0.95)) + facing;
  return {
    x: cx / kit.aspect, y: at.base[1] + ay * half, len: half, wid, ax, ay, kind: KIND.leaf, seed: draw(),
    color: ramped(kit.ramp, light * 0.92), alpha: 1, light: Math.min(Math.max(light, 0), 0.85), variant: lobes,
    water: 0,
    depth: at.deep ? 0.25 : 0,
  };
}

/** Stem dabs along a curve, thinning from `thick` toward the tip. */
function stemsOf(curve: readonly Point[], aspect: number, thick: number): Dab[] {
  const out: Dab[] = [];
  const n = 14;
  for (let k = 0; k < n; k += 1) {
    const a = bezier(curve, k / n);
    const b = bezier(curve, (k + 1) / n);
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const half = Math.sqrt(dx * dx + dy * dy) * 0.6;
    const [ax, ay] = unit(dx, dy);
    out.push({
      x: (a[0] + b[0]) / 2 / aspect, y: (a[1] + b[1]) / 2, len: half, wid: thick * (1 - (0.7 * k) / n), ax, ay,
      kind: KIND.stem, seed: k / n, color: [0.16, 0.16, 0.12], alpha: 1, light: 0.4, variant: 1, water: 0, depth: 0,
    });
  }
  return out;
}

/** A branch: its stem, and leaves hanging off both sides along it. */
function branchOf(kit: LeafKit, branch: BranchRecipe, draw: Draw): { stems: Dab[]; leaves: Dab[] } {
  const q = (p: Pair): Point => [p[0] * kit.aspect, p[1]];
  const curve = [q(branch.from), q(branch.bend), q(branch.to)];
  const leaves: Dab[] = [];
  for (let i = 0; i < branch.leaves; i += 1) {
    const t = (i + draw.within(0, 0.8)) / branch.leaves;
    const [tx, ty] = unit(...tangent(curve, t));
    const side = i % 2 === 0 ? 1 : -1;
    const [sx, sy] = turn(tx, ty, side * draw.within(0.35, 0.9));
    const axis = unit(sx, sy + draw.within(0.2, 0.9));
    const base = bezier(curve, t);
    const length = branch.size * draw.within(0.6, 1.25) * (1 - 0.35 * t);
    leaves.push(leafOf(kit, draw, { base, axis, length, deep: draw() < 0.35 }));
  }
  return { stems: stemsOf(curve, kit.aspect, 0.006), leaves };
}

/** A mass: dark blots for its heart, stems rising from below, leaves fanning out from its lower left. */
function massOf(kit: LeafKit, mass: MassRecipe, draw: Draw): { blots: Dab[]; stems: Dab[]; leaves: Dab[] } {
  const [x0, x1] = [mass.x[0] * kit.aspect, mass.x[1] * kit.aspect];
  const [y0, y1] = mass.y;
  const blots: Dab[] = [];
  for (let i = 0; i < 30; i += 1) {
    const x = draw.within(x0, x0 + (x1 - x0) * 0.5);
    const r = draw.within(0.06, 0.12);
    blots.push({
      x: x / kit.aspect, y: draw.within(y0 + 0.24, y1), len: r, wid: r * draw.within(0.6, 1), ax: 1, ay: 0,
      kind: KIND.blot, seed: draw(), color: ramped(kit.ramp, draw.within(0, 0.12)), alpha: 0.95, light: 0,
      variant: 1, water: 0, depth: 0,
    });
  }
  const stems: Dab[] = [];
  for (let i = 0; i < 4; i += 1) {
    const from: Point = [draw.within(x0, x0 + (x1 - x0) * 0.4), y1 + 0.02];
    const to: Point = [draw.within(x0 + (x1 - x0) * 0.4, x1 - 0.04), draw.within(y0, y0 + (y1 - y0) * 0.5)];
    stems.push(...stemsOf([from, [from[0] - 0.02, (from[1] + to[1]) / 2], to], kit.aspect, 0.005));
  }
  const leaves: Dab[] = [];
  for (let i = 0; i < mass.leaves; i += 1) leaves.push(massLeaf(kit, mass, draw, [x0, x1, y0, y1]));
  return { blots, stems, leaves };
}

/** One leaf of a mass, denser and larger toward the lower left. */
function massLeaf(kit: LeafKit, mass: MassRecipe, draw: Draw, box: readonly number[]): Dab {
  const [x0 = 0, x1 = 0, y0 = 0, y1 = 0] = box;
  const r = draw();
  const x = x0 + (x1 - x0) * (0.35 * r + 0.65 * r * r) * draw.within(0.85, 1.12);
  const y = draw.within(y0, y1);
  const [ox, oy] = unit(x - (x0 - 0.1), y - (y1 + 0.1));
  const axis = unit(...turn(ox, oy, draw.within(-0.5, 0.5)));
  const down = (y - y0) / (y1 - y0);
  const length = mass.size * draw.within(0.65, 1.2) * (0.75 + 0.45 * down);
  const deep = draw() < 0.3 + 0.35 * (1 - (x - x0) / (x1 - x0));
  return leafOf(kit, draw, { base: [x, y], axis: unit(axis[0], axis[1] + 0.25), length, deep });
}

/** Every dab of the near foliage: blots, stems, deep leaves, then the leaves in the light. */
export function foliageDabs(recipe: PlateRecipe, seed: number): Dab[] {
  const { leaves, aspect } = { leaves: recipe.leaves, aspect: recipe.aspect };
  const kit: LeafKit = {
    ramp: [rgb(leaves.deep), rgb(leaves.shadow), rgb(leaves.mid), rgb(leaves.lit)], maxX: leaves.bound * aspect, aspect,
  };
  const blots: Dab[] = [];
  const stems: Dab[] = [];
  const all: Dab[] = [];
  leaves.masses.forEach((mass, i) => {
    const made = massOf(kit, mass, draws(seed, 400 + i));
    blots.push(...made.blots);
    stems.push(...made.stems);
    all.push(...made.leaves);
  });
  leaves.branches.forEach((branch, i) => {
    const made = branchOf(kit, branch, draws(seed, 500 + i));
    stems.push(...made.stems);
    all.push(...made.leaves);
  });
  const deep = all.filter((d) => d.depth > 0);
  const near = all.filter((d) => d.depth === 0);
  return [...blots, ...stems, ...deep, ...near];
}

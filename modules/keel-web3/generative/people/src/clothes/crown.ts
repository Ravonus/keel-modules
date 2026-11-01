// The crown: a hat built over the head and the hair really under it, its bill, and the hair tucked up under both.

import { FAR, TAU, UP, add, clamp, dot, mix, scale, sub, unit } from "../vec.js";
import type { Vec } from "../vec.js";
import type { Hat, Person } from "../body/person.js";
import { CROWN_RISE } from "../head/head.js";
import type { HeadFrame } from "../head/head.js";
import { HEAD } from "../body/bones.js";
import type { Net, Wearer } from "../body/field.js";
import { headNormals, smoothedFar } from "../head/wrap.js";
import { NO_EDGE } from "../body/cage.js";
import { hatCloth } from "./fabric.js";
import { WRAPPED } from "./cloth.js";
import { bearingOf, boundOf } from "../head/ears.js";
import type { Bound, Seat } from "../head/ears.js";
import { smooth, vecAt } from "../head/paint.js";

/** How far from a head's centre a crown goes to clear its hair, in head radii. */
const CROWN_REACH = 1.6;

/** The hats whose crown is built over what is under it. The rest are their own shape. */
const FITTED_HATS: ReadonlySet<Hat> = new Set<Hat>([
  "cap", "beanie", "pompom", "bucket", "flatcap", "bandana", "hardhat", "helmet", "fedora", "stetson", "bowler",
  "peaked", "sunhat", "headwrap", "visor", "beret",
]);

/** Whether a person's hat is near enough to be built over their head. */
export const fitsHat = (p: Person, cell: number): boolean =>
  cell < WRAPPED && FITTED_HATS.has(p.outfit.hat) && p.outfit.costume !== "fursuit";

/**
 * How far out a boundary reaches anywhere near a direction: what a crown has to clear, for it cannot follow every lock.
 */
function highestNear(bound: Bound, dir: Vec): number {
  const reach = [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14], [0.24, 0], [-0.24, 0], [0, 0.24]] as const;
  return Math.max(...reach.map(([a, b]) => bound.far(unit(add(dir, [a, b, a - b]), UP))));
}

/**
 * Where a crown's hem lies at each bearing: level round the head and only a little lower behind, as a hat sits. A
 * helmet and a tied scarf come down the neck.
 */
const crownHem = (hat: Hat, az: number): number =>
  mix(0.5, hat === "helmet" || hat === "bandana" ? 0.24 : 0.42, (1 - Math.cos(az)) / 2);

const BERET_SLUMP = unit([0.72, 0.66, -0.2], UP);

/** How far a hat's bill reaches past its hem, in head radii. */
export const BILLS: Partial<Record<Hat, number>> = {
  cap: 0.74, peaked: 0.56, flatcap: 0.44, hardhat: 0.46, visor: 0.7,
};

/** The faces between `rows` closed rings of `cols` vertices each, from `from`, seen from outside. */
function ringFaces(index: number[], from: number, rows: number, cols: number): void {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = from + r * cols + c;
      const b = from + r * cols + ((c + 1) % cols);
      const d = a + cols;
      const e = b + cols;
      index.push(a, b, e, a, e, d);
    }
  }
}

/** What a crown is made of: the role and fabric of its cloth, and the way from head radii to metres. */
interface HatCloth {
  readonly role: number;
  readonly fabric: number;
  readonly to: (q: Vec) => Vec;
}

/**
 * A bill: one thin curved sheet out of the crown's hem across the brow, its sides falling away and its edge rounded.
 * Returns how many vertices it took.
 */
function billOn(net: Net, cloth: HatCloth, hat: Hat, hemAt: (az: number) => Vec): number {
  const reach = BILLS[hat] ?? 0;
  const rows = 7;
  const side = 16;
  const cols = (side + 1) * 2;
  const wide = 1.1;
  const from = net.position.length / 3;
  if (reach <= 0) return 0;
  const at = (s: number, u: number, under: boolean): Vec => {
    const [x, y, z] = hemAt(u * wide);
    const long = s * Math.sqrt(1 - u * u);
    const fall = (0.14 + 0.2 * u * u) * long;
    return [x, y - fall - (under ? 0.04 * (1 - s ** 4) : 0), z + reach * long];
  };
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const under = c > side;
      const u = under ? -1 + (2 * (c - side - 1)) / side : 1 - (2 * c) / side;
      const q = cloth.to(at(r / rows, u, under));
      net.position.push(...q);
      net.normal.push(0, under ? -1 : 1, 0);
      net.role.push(cloth.role);
      net.bones.push(HEAD, HEAD);
      net.weight.push(1);
      net.fabric.push(cloth.fabric);
      net.loose.push(0);
      net.soft.push(0);
      net.cloth.push(q[0], q[2], q[1], NO_EDGE);
    }
  }
  ringFaces(net.index, from, rows, cols);
  headNormals(net, from, rows + 1, cols);
  return (rows + 1) * cols;
}

/** Hair that a crown cannot clear goes under it: `over` says how far out the crown lies along a direction. */
function tuckedHair(w: Wearer, h: HeadFrame, over: (d: Vec) => number): void {
  const { net, roles } = w;
  const size = w.p.build.size;
  const hair = roles.indexOf("hair");
  for (let v = 0; v < net.fabric.length; v += 1) {
    if (net.role[v] !== hair || net.bones[v * 2] !== HEAD) continue;
    const q = scale(sub(scale(vecAt(net.position, v), 1 / size), h.c), 1 / h.r);
    const far = Math.hypot(...q);
    const d = unit(q, UP);
    const most = over(d) - 0.03;
    if (far <= most) continue;
    const at = scale(add(h.c, scale(d, most * h.r)), size);
    net.position[v * 3] = at[0];
    net.position[v * 3 + 1] = at[1];
    net.position[v * 3 + 2] = at[2];
  }
}

/**
 * How far out a crown lies along `d`, from what it must clear: under hair the skull has no skin to read, so its reach
 * is held to a head's.
 */
function crownFar(skin: number, hair: number, d: Vec, hat: Hat): number {
  const ridge = hat === "hardhat" ? 0.035 * smooth(0.3, 0.12, Math.abs(d[0])) * smooth(0.4, 0.7, d[1]) : 0;
  // (A beret slumps to one side.)
  const slump = hat === "beret" ? 0.2 * smooth(0.3, 1, dot(d, BERET_SLUMP)) : 0;
  const over = Math.max(skin + 0.05 * smooth(0.5, 1, d[1]), Math.min(hair + 0.05, CROWN_REACH));
  return over + (CROWN_RISE[hat] ?? 0) * smooth(0.3, 1, d[1]) + ridge + slump;
}

/** A crown's grid: `rows` up from the hem to the top, `cols` round, and the direction over the head at each point. */
interface CrownGrid {
  readonly rows: number;
  readonly cols: number;
  readonly hat: Hat;
  readonly dirOf: (r: number, c: number) => Vec;
}

/** The direction over the head at a crown's grid point: `r` rows up from the hem, `c` round from the nose. */
function crownDir(hat: Hat, rows: number, cols: number): CrownGrid["dirOf"] {
  return (r, c) => {
    const az = (c / cols) * TAU;
    const hem = crownHem(hat, az);
    return bearingOf(az, mix(hem, hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02, (r / rows) ** 0.8));
  };
}

/** How far out a crown lies at each point of its grid: clear of the skin, over the hair it cannot clear, eased. */
function crownReach(w: Wearer, h: HeadFrame, seat: Seat, grid: CrownGrid): Float64Array {
  const { net, p, roles } = w;
  const { rows, cols, hat, dirOf } = grid;
  const trim = roles.indexOf("trim");
  const under = boundOf(net, h, p.build.size, (v) => net.role[v] !== trim);
  const clear = hat === "helmet" || hat === "hardhat" ? 0.09 : 0.035;
  const far = new Float64Array((rows + 1) * cols);
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const d = dirOf(r, c);
      const skin = seat.skin.far(d) + clear;
      far[r * cols + c] = crownFar(skin, highestNear(under, d), d, hat);
    }
  }
  smoothedFar(far, rows + 1, cols, 7);
  far.forEach((was, i) => {
    far[i] = Math.max(was, Math.min(under.far(dirOf(Math.floor(i / cols), i % cols)) + 0.02, CROWN_REACH + 0.1));
  });
  smoothedFar(far, rows + 1, cols, 1);
  return far;
}

/** The crown's own sheet: a ring under the hem, then each row of the grid at its reach, seen from outside. */
function crownSheet(net: Net, cloth: HatCloth, grid: CrownGrid, far: Float64Array): void {
  const { rows, cols, dirOf } = grid;
  const from = net.position.length / 3;
  for (let r = -1; r <= rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const d = dirOf(Math.max(0, r), c);
      const at = cloth.to(scale(d, (far[Math.max(0, r) * cols + c] ?? 1) - (r < 0 ? 0.05 : 0)));
      net.position.push(...at);
      net.normal.push(...d);
      net.role.push(cloth.role);
      net.bones.push(HEAD, HEAD);
      net.weight.push(1);
      net.fabric.push(cloth.fabric);
      net.loose.push(0);
      net.soft.push(0);
      net.cloth.push(at[0], at[2], at[1], NO_EDGE);
    }
  }
  ringFaces(net.index, from, rows + 1, cols);
  headNormals(net, from, rows + 2, cols);
}

/** How far out a crown lies along a direction, read from its grid: as far as anything, where it has no cloth. */
function underCrown(grid: CrownGrid, far: Float64Array, d: Vec): number {
  const { rows, cols, hat } = grid;
  const az = (Math.atan2(d[0], d[2]) + TAU) % TAU;
  const el = Math.asin(clamp(d[1], -1, 1));
  const hem = crownHem(hat, az);
  const top = hat === "visor" ? hem + 0.2 : Math.PI / 2 - 0.02;
  const t = (el - hem) / (top - hem);
  if (t < 0 || t > 1) return FAR;
  return far[Math.round(t ** 1.25 * rows) * cols + (Math.round((az / TAU) * cols) % cols)] ?? FAR;
}

/**
 * A crown, built over the head and the hair really under it: the hem level round the brow and lower behind, the top
 * only as much taller as the hat is.
 */
export function crownOver(w: Wearer, h: HeadFrame, seat: Seat): readonly number[] {
  const { net, p, roles } = w;
  if (!fitsHat(p, w.cell)) return [];
  const size = p.build.size;
  const hat = p.outfit.hat;
  const rows = 14;
  const cols = 64;
  const grid: CrownGrid = { rows, cols, hat, dirOf: crownDir(hat, rows, cols) };
  const far = crownReach(w, h, seat, grid);
  const to = (q: Vec): Vec => scale(add(h.c, scale(q, h.r)), size);
  const cloth: HatCloth = { role: Math.max(0, roles.indexOf("trim")), fabric: hatCloth(hat), to };
  crownSheet(net, cloth, grid, far);
  tuckedHair(w, h, (d) => underCrown(grid, far, d));
  const hemAt = (az: number): Vec => {
    const turn = ((az / TAU + 1) % 1) * cols;
    const c = Math.floor(turn);
    const d = bearingOf(az, crownHem(hat, az));
    return scale(d, mix(far[c % cols] ?? 1, far[(c + 1) % cols] ?? 1, turn - c) - 0.04);
  };
  const bill = billOn(net, cloth, hat, hemAt);
  return Array.from({ length: (rows + 2) * cols + bill }, () => 1);
}

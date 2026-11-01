// Sectors: splitting a grown hybrid into whole limbs of each kind, each strain near its share of the crown.

import { at, createRandom } from "./math.js";
import type { TreeModel } from "./model.js";

// ---------------------------------------------------------------- sectors

/** Whether `node` grows from `limb` (anywhere out along it). */
function isBelow(model: TreeModel, node: number, limb: number): boolean {
  for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (up === limb) return true;
  return false;
}

/**
 * Leaf-years each internode carries, counted up from the twigs (parents come first, so walk backwards):
 * a shoot that is shaded out young counts for little.
 */
function carriedLeafYears(model: TreeModel): Float64Array {
  const carried = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    const held = Math.max(0, Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node)) / model.cycles;
    carried[node] = at(carried, node) + held;
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) carried[parent] = at(carried, parent) + at(carried, node);
  }
  return carried;
}

/**
 * Main limbs that live a good while (a quarter of the life): a limb shaded out young would carry its strain as bare
 * sticks. When there are too few of those for `strains`, every main limb counts.
 */
function mainLimbs(model: TreeModel, carried: Float64Array, strains: number): number[] {
  const order = model.order;
  const main: number[] = [];
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (at(order, node) > 0 && (parent < 0 || at(order, parent) === 0) && at(carried, node) > 0) main.push(node);
  }
  const lasting = main.filter(
    (node) => Math.min(at(model.deadAt, node), model.cycles) - at(model.birth, node) >= model.cycles * 0.25,
  );
  return lasting.length >= strains ? lasting : main;
}

/** Each strain's wanted share of the crown, non-negative and summing to 1. */
function wantedShares(shares: readonly number[]): number[] {
  const sum = shares.reduce((acc, share) => acc + Math.max(0, share), 0) || 1;
  return shares.map((share) => Math.max(0, share) / sum);
}

/** Which strain owns each limb, and how much each strain has been given. */
interface Allotment {
  readonly owner: Map<number, number>;
  readonly have: Float64Array;
}

/** The strain furthest behind its share of what has been `walked` so far. */
function furthestBehind(want: readonly number[], have: Float64Array, walked: number): number {
  let pick = 0;
  let behind = -Infinity;
  for (let index = 0; index < want.length; index += 1) {
    const short = (want[index] ?? 0) * walked - at(have, index);
    if ((want[index] ?? 0) > 0 && short > behind) {
      behind = short;
      pick = index;
    }
  }
  return pick;
}

/** Even a tiny share holds a limb: the smallest one, taken from the first strain. */
function holdOneLimb(limbs: readonly number[], carried: Float64Array, want: readonly number[], given: Allotment): void {
  const { owner, have } = given;
  for (let index = 1; index < want.length; index += 1) {
    if ((want[index] ?? 0) <= 0 || at(have, index) > 0) continue;
    let small = -1;
    for (const limb of limbs)
      if (owner.get(limb) === 0 && (small < 0 || at(carried, limb) < at(carried, small))) small = limb;
    if (small >= 0) {
      owner.set(small, index);
      have[index] = at(carried, small);
    }
  }
}

/**
 * Walks the limbs in the order they grow: each goes to the strain furthest behind its share, so every age of
 * the tree shows each strain at its share, not only the old tree.
 */
function assignLimbs(limbs: readonly number[], carried: Float64Array, want: readonly number[]): Map<number, number> {
  const have = new Float64Array(want.length);
  const owner = new Map<number, number>();
  let walked = 0;
  for (const limb of limbs) {
    walked += at(carried, limb);
    const pick = furthestBehind(want, have, walked);
    owner.set(limb, pick);
    have[pick] = at(have, pick) + at(carried, limb);
  }
  holdOneLimb(limbs, carried, want, { owner, have });
  return owner;
}

/** How many of three moments through the middle of the tree's life (0.35, 0.5, 0.65) `node` is alive at. */
const primeOf = (model: TreeModel, node: number): number =>
  [0.35, 0.5, 0.65].filter(
    (t) => at(model.birth, node) <= model.cycles * t && at(model.deadAt, node) > model.cycles * t,
  ).length;

/** Leaves alive through the prime of life, carried by each internode and everything out along it. */
function aliveLeaves(model: TreeModel): Float64Array {
  const alive = new Float64Array(model.count);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    alive[node] = at(alive, node) + primeOf(model, node);
  }
  for (let node = model.count - 1; node > 0; node -= 1) {
    const parent = at(model.parent, node);
    if (parent >= 0) alive[parent] = at(alive, parent) + at(alive, node);
  }
  return alive;
}

/** The crown being rebalanced: what each strain wants and holds, and the side branches already moved. */
interface Balance {
  readonly model: TreeModel;
  readonly strain: Uint8Array;
  readonly want: readonly number[];
  readonly alive: Float64Array;
  readonly now: Float64Array;
  readonly total: number;
  readonly taken: Set<number>;
}

function takenAbove(balance: Balance, node: number): boolean {
  const { model, taken } = balance;
  for (let up = at(model.parent, node); up >= 0; up = at(model.parent, up)) if (taken.has(up)) return true;
  return false;
}

/** Living side branches of another strain, the biggest first. */
function sideBranches(balance: Balance, index: number): number[] {
  const { model, strain, alive } = balance;
  const order = model.order;
  const side: number[] = [];
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    if (
      parent < 0 ||
      at(order, parent) === 0 ||
      at(order, node) <= at(order, parent) ||
      at(strain, node) === index ||
      at(alive, node) <= 0
    )
      continue;
    side.push(node);
  }
  side.sort((a, b) => at(alive, b) - at(alive, a));
  return side;
}

/** Takes side branches off the strains over their share for strain `index`, the biggest that still fit first. */
function takeSideBranches(balance: Balance, index: number): void {
  const { model, strain, want, alive, now, total, taken } = balance;
  let short = (want[index] ?? 0) * total - at(now, index);
  if (short <= total * 0.03) return;
  for (const node of sideBranches(balance, index)) {
    if (short <= total * 0.03) break;
    const from = at(strain, node);
    const load = at(alive, node);
    const spare = at(now, from) - (want[from] ?? 0) * total;
    if (from === index || load > short * 1.25 || load > spare || takenAbove(balance, node)) continue;
    taken.add(node);
    now[from] = at(now, from) - load;
    now[index] = at(now, index) + load;
    short -= load;
    claimBelow(model, strain, node, index);
  }
}

/** Gives `limb` and everything out along it to strain `index`. */
function claimBelow(model: TreeModel, strain: Uint8Array, limb: number, index: number): void {
  for (let child = limb; child < model.count; child += 1) {
    if (child === limb || isBelow(model, child, limb)) strain[child] = index;
  }
}

/**
 * Whole limbs come in big lumps, and old low limbs that carried leaves for years may hold few now, so a
 * strain can end well short in the grown crown (the third kind gets what is left). Counting the leaves
 * on the tree through the middle of its life, it takes side branches off the strains over their share, the biggest
 * that still fit first, so a quarter share shows as about a quarter of the grown crown.
 */
function rebalance(model: TreeModel, strain: Uint8Array, want: readonly number[]): void {
  const alive = aliveLeaves(model);
  const now = new Float64Array(want.length);
  for (let index = 0; index < model.leaves.count; index += 1) {
    const node = at(model.leaves.node, index);
    now[at(strain, node)] = at(now, at(strain, node)) + primeOf(model, node);
  }
  const total = now.reduce((acc, count) => acc + count, 0);
  const balance: Balance = { model, strain, want, alive, now, total, taken: new Set<number>() };
  // The strain furthest short goes first, the main kind included (an oak limb can outgrow the cherry it is on).
  const needy = want
    .map((_, index) => index)
    .sort((a, b) => (want[b] ?? 0) * total - at(now, b) - ((want[a] ?? 0) * total - at(now, a)));
  for (const index of needy) takeSideBranches(balance, index);
}

/**
 * Splits a grown tree into sectors, the way a chimera plant carries whole
 * limbs of different tissue: each main limb (and everything it carries) goes
 * to one strain, so that each strain's share of the crown's leaves is close
 * to its share in `shares`. Strain 0, the first, keeps the trunk. Returns the
 * strain of every internode. A strain with too small a share for any limb
 * still gets the smallest one, so a trace of hidden makeup always shows.
 */
export function sectors(model: TreeModel, shares: readonly number[], seed = model.seed): Uint8Array {
  const strain = new Uint8Array(model.count);
  if (shares.length <= 1) return strain;
  const carried = carriedLeafYears(model);
  const limbs = mainLimbs(model, carried, shares.length);
  const random = createRandom(seed ^ 0x5ec7);
  // Shuffle first so limbs born together (a whorl) fall to different strains, then walk them in the order
  // they grow.
  for (let index = limbs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [limbs[index], limbs[other]] = [at(limbs, other), at(limbs, index)];
  }
  limbs.sort((a, b) => Math.round(at(model.birth, a) * 2) - Math.round(at(model.birth, b) * 2));
  const want = wantedShares(shares);
  const owner = assignLimbs(limbs, carried, want);
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    strain[node] = owner.get(node) ?? (parent >= 0 ? at(strain, parent) : 0);
  }
  rebalance(model, strain, want);
  return strain;
}

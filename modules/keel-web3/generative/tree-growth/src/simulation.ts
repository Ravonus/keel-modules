// The simulation: buds, shoots, vigour, pruning and decline, one cycle at a time.

import type { Species } from "./species.js";
import { add, at, clamp01, cross, normalize, perpendicular, rotate, vec } from "./math.js";
import type { Vec } from "./math.js";
import { castShadow, cellOf, exposure, lightDirection } from "./light.js";
import type { LightGrid } from "./light.js";

// ---------------------------------------------------------------- the simulation

/** Growing tree state, as parallel arrays so the graph stays flat and ordered. */
export interface Sim {
  readonly species: Species;
  readonly random: () => number;
  readonly grid: LightGrid;
  readonly maxNodes: number;
  readonly pos: Vec[];
  readonly dir: Vec[];
  readonly parent: number[];
  readonly order: number[];
  readonly birth: number[];
  readonly span: number[];
  readonly main: number[];
  readonly deadAt: number[];
  readonly shedAt: number[];
  readonly weak: number[];
  readonly children: number[][];
  readonly buds: Bud[];
  readonly nodeBuds: number[][];
  height: number;
}

interface Bud {
  readonly node: number;
  readonly dir: Vec;
  readonly terminal: boolean;
  alive: boolean;
  light: number;
  vigor: number;
}

export function addNode(sim: Sim, parent: number, pos: Vec, dir: Vec, order: number, birth: number, span: number, main: boolean): number {
  const index = sim.pos.length;
  sim.pos.push(pos);
  sim.dir.push(dir);
  sim.parent.push(parent);
  sim.order.push(order);
  sim.birth.push(birth);
  sim.span.push(span);
  sim.main.push(main ? 1 : 0);
  sim.deadAt.push(Infinity);
  sim.shedAt.push(Infinity);
  sim.weak.push(0);
  sim.children.push([]);
  sim.nodeBuds.push([]);
  sim.children[parent]?.push(index);
  sim.height = Math.max(sim.height, pos.y);
  castShadow(sim.grid, pos, 1);
  return index;
}

export function addBud(sim: Sim, node: number, dir: Vec, terminal: boolean): void {
  sim.nodeBuds[node]?.push(sim.buds.length);
  sim.buds.push({ node, dir, terminal, alive: true, light: 0, vigor: 0 });
}

/** Side buds for a fresh internode: one per node by phyllotaxis, or a whorl at a shoot's end. */
function setLateralBuds(sim: Sim, node: number, axis: Vec, turn: number, shootEnd: boolean): void {
  const { species, random } = sim;
  const angle = (species.angle * Math.PI) / 180;
  const side = perpendicular(axis);
  if (species.whorl > 0 && at(sim.order, node) > 0) {
    // Conifer side branches fork flat, one bud each side, so the tiers stay layered.
    if (!shootEnd) return;
    const flatSide = normalize(cross(axis, vec(0, 1, 0)), side);
    for (const sign of [-1, 1]) addBud(sim, node, normalize(add(vec(axis.x * 0.7, axis.y * 0.7, axis.z * 0.7), flatSide, sign * 0.7)), false);
    return;
  }
  if (species.whorl > 0) {
    if (!shootEnd) return;
    for (let index = 0; index < species.whorl; index += 1) {
      const around = turn + (index / species.whorl) * Math.PI * 2 + (random() - 0.5) * 0.4;
      addBud(sim, node, normalize(rotate(rotate(axis, side, angle), axis, around)), false);
    }
    return;
  }
  const around = turn + (random() - 0.5) * 0.3;
  addBud(sim, node, normalize(rotate(rotate(axis, side, angle * (0.85 + random() * 0.3)), axis, around)), false);
}

function tropism(sim: Sim, heading: Vec, order: number, y: number): Vec {
  const { species } = sim;
  const flatten = y > species.ceiling;
  if (order === 0 && !flatten) return vec(0, species.up, 0);
  const level = vec(heading.x, 0, heading.z);
  const horizontal = normalize(level, vec(1, 0, 0));
  const droop = species.lateralUp - (order >= 2 ? species.weep * Math.min(order - 1, 2) : 0);
  const flat = flatten ? Math.max(species.flat, 0.6) : species.flat;
  return vec((horizontal.x - heading.x) * flat, droop + (flatten ? -0.1 : 0) + (horizontal.y - heading.y) * flat, (horizontal.z - heading.z) * flat);
}

/** Grows `count` internodes out of `bud`, each bending toward light and by tropism. */
function growShoot(sim: Sim, bud: Bud, count: number, cycle: number): void {
  const { species } = sim;
  let node = bud.node;
  let heading = bud.dir;
  const order = at(sim.order, node) + (bud.terminal ? 0 : 1);
  let turn = sim.random() * Math.PI * 2;
  for (let step = 0; step < count && sim.pos.length < sim.maxNodes; step += 1) {
    const from = sim.pos[node] ?? vec(0, 0, 0);
    const light = order >= 2 ? species.light / (1 + species.weep * 4) : species.light;
    const pull = add(add(vec(heading.x * species.straight, heading.y * species.straight, heading.z * species.straight), lightDirection(sim.grid, from), light), tropism(sim, heading, order, from.y));
    heading = normalize(pull, heading);
    const to = add(from, heading, 0.88 + sim.random() * 0.24);
    if (to.y < 0.6 || cellOf(to) < 0) return;
    node = addNode(sim, node, to, heading, order, cycle + step / count, 1 / count, bud.terminal || step > 0);
    turn += (species.divergence * Math.PI) / 180;
    setLateralBuds(sim, node, heading, turn, step === count - 1);
  }
  if (node !== bud.node) addBud(sim, node, heading, true);
}

/** The crown's reach at height y. A conifer's narrows up the tree, so the crown closes to a spire. */
function crownReach(sim: Sim, y: number): number {
  const cone = sim.species.cone ?? 0;
  return sim.species.spread * Math.max(sim.height, 6) * (1 - cone * clamp01(y / Math.max(sim.height, 1))) + 0.6 * cone;
}

/** Light seen by every bud, then gathered down the branches (basipetal). */
function gatherLight(sim: Sim, light: number[], budCount: number[]): void {
  for (const bud of sim.buds) {
    const at = sim.pos[bud.node] ?? vec(0, 0, 0);
    const reach = crownReach(sim, at.y);
    // Past the species' crown spread the light fades, so a big crown fills in
    // rather than sprawling sideways.
    const envelope = clamp01(1 - (Math.hypot(at.x, at.z) - reach) / 1.5);
    bud.light = bud.alive ? exposure(sim.grid, at) * envelope : 0;
  }
  for (let node = sim.pos.length - 1; node >= 0; node -= 1) {
    let sum = 0;
    let buds = 0;
    for (const index of sim.nodeBuds[node] ?? []) {
      const bud = sim.buds[index];
      if (bud?.alive === true) { sum += bud.light; buds += 1; }
    }
    for (const child of sim.children[node] ?? []) {
      if (at(sim.deadAt, child) !== Infinity) continue;
      sum += at(light, child);
      buds += at(budCount, child);
    }
    light[node] = sum;
    budCount[node] = buds;
  }
}

/** Splits a node's vigor between the continuing axis and its side shoots (Borchert–Honda). */
function splitVigor(sim: Sim, node: number, vigor: number, light: number[], incoming: number[]): void {
  const lambda = sim.species.apical;
  const mainTargets: [number, number][] = [];
  const sideTargets: [number, number][] = [];
  for (const child of sim.children[node] ?? []) {
    if (at(sim.deadAt, child) !== Infinity) continue;
    (at(sim.main, child) === 1 ? mainTargets : sideTargets).push([child, at(light, child)]);
  }
  for (const index of sim.nodeBuds[node] ?? []) {
    const bud = sim.buds[index];
    if (bud?.alive === true) (bud.terminal ? mainTargets : sideTargets).push([-1 - index, bud.light]);
  }
  const mainLight = mainTargets.reduce((sum, [, value]) => sum + value, 0);
  const sideLight = sideTargets.reduce((sum, [, value]) => sum + value, 0);
  const total = lambda * mainLight + (1 - lambda) * sideLight;
  if (total <= 0) return;
  const give = (targets: [number, number][], share: number, sum: number): void => {
    for (const [target, value] of targets) {
      const amount = sum > 0 ? (share * value) / sum : 0;
      if (target >= 0) incoming[target] = amount;
      else { const bud = sim.buds[-1 - target]; if (bud !== undefined) bud.vigor = amount; }
    }
  };
  give(mainTargets, (vigor * lambda * mainLight) / total, mainLight);
  give(sideTargets, (vigor * (1 - lambda) * sideLight) / total, sideLight);
}

function distributeVigor(sim: Sim, light: number[], vigorScale: number): void {
  const incoming = new Array<number>(sim.pos.length).fill(0);
  for (const bud of sim.buds) bud.vigor = 0;
  incoming[0] = sim.species.vigor * vigorScale * at(light, 0);
  for (let node = 0; node < sim.pos.length; node += 1) {
    if (at(sim.deadAt, node) !== Infinity) continue;
    splitVigor(sim, node, at(incoming, node), light, incoming);
  }
}

/** Kills a subtree: its buds stop, its shadow lifts, and it drops after it has hung dead a while. */
function killBranch(sim: Sim, root: number, cycle: number): void {
  const stack = [root];
  let size = 0;
  while (stack.length > 0) {
    const node = stack.pop() ?? 0;
    if (at(sim.deadAt, node) !== Infinity) continue;
    sim.deadAt[node] = cycle;
    size += 1;
    castShadow(sim.grid, sim.pos[node] ?? vec(0, 0, 0), -1);
    for (const index of sim.nodeBuds[node] ?? []) { const bud = sim.buds[index]; if (bud !== undefined) bud.alive = false; }
    stack.push(...(sim.children[node] ?? []));
  }
  sim.shedAt[root] = cycle + 0.5 + sim.random() * 1.1 + Math.log2(1 + size) * 0.55;
}

/** Self-pruning: a side branch whose buds stay in deep shade starves and dies. */
function prune(sim: Sim, light: number[], budCount: number[], cycle: number, threshold: number): void {
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.main, node) === 1 || at(sim.deadAt, node) !== Infinity) continue;
    const buds = at(budCount, node);
    const efficiency = buds > 0 ? at(light, node) / buds : 0;
    sim.weak[node] = efficiency < threshold ? at(sim.weak, node) + 1 : 0;
    if (at(sim.weak, node) >= 3 && cycle - at(sim.birth, node) > 1.5) killBranch(sim, node, cycle);
  }
}

/** A tall conifer sheds the old limbs low on its trunk as it rises, a few each cycle. */
function liftCrown(sim: Sim, cycle: number): void {
  const below = (sim.species.lift ?? 0) * sim.height;
  if (below <= 0) return;
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.order, node) !== 1 || at(sim.order, at(sim.parent, node)) !== 0 || at(sim.deadAt, node) !== Infinity) continue;
    if ((sim.pos[node]?.y ?? 0) < below && sim.random() < 0.5) killBranch(sim, node, cycle);
  }
}

/** Buds on the bare lower trunk never break: the crown lifts as the tree grows. */
function clearTrunk(sim: Sim): void {
  const clear = sim.species.crownAt * sim.height;
  for (const bud of sim.buds) {
    if (!bud.alive || bud.terminal) continue;
    if (at(sim.order, bud.node) === 0 && (sim.pos[bud.node]?.y ?? 0) < clear) bud.alive = false;
  }
}

/** Internodes each bud would make this cycle, before the growth curve trims them. */
function budShoots(sim: Sim): [Bud, number][] {
  const shoots: [Bud, number][] = [];
  for (const bud of sim.buds) {
    if (!bud.alive) continue;
    const count = Math.min(bud.terminal && at(sim.order, bud.node) === 0 ? sim.species.maxShoot : sim.species.sideShoot, Math.floor(bud.vigor));
    if (count >= 1) shoots.push([bud, count]);
  }
  return shoots;
}

/**
 * One cycle of growth. `allowed` is how many internodes the growth curve
 * grants this cycle; when the buds want more, every shoot is trimmed by the
 * same share (rounded at random), so no part of the crown is favoured.
 */
export function growCycle(sim: Sim, cycle: number, vigorScale: number, shed: number, allowed: number): void {
  const light: number[] = [];
  const budCount: number[] = [];
  clearTrunk(sim);
  gatherLight(sim, light, budCount);
  distributeVigor(sim, light, vigorScale);
  const shoots = budShoots(sim);
  const wanted = shoots.reduce((sum, [, count]) => sum + count, 0);
  const share = wanted > allowed ? Math.max(0, allowed) / wanted : 1;
  for (const [bud, count] of shoots) {
    const trimmed = share < 1 ? Math.floor(count * share + sim.random()) : count;
    if (trimmed < 1) continue;
    bud.alive = false;
    growShoot(sim, bud, trimmed, cycle);
  }
  prune(sim, light, budCount, cycle, shed);
  liftCrown(sim, cycle);
}

/** The highest internode on the leader. */
function leaderTop(sim: Sim): number {
  let top = 0;
  let height = 0;
  for (let node = 0; node < sim.pos.length; node += 1) {
    const y = sim.pos[node]?.y ?? 0;
    if (at(sim.order, node) === 0 && y > height) { top = node; height = y; }
  }
  return top;
}

/** The leader's top few internodes: old trees lose their top first and go stag-headed. */
function killLeaderTop(sim: Sim, cycle: number): void {
  let node = leaderTop(sim);
  for (let step = 0; step < 6 && node > 0; step += 1) node = at(sim.parent, node);
  // Only the top of the crown dies back; the trunk itself never falls.
  if (node > 0 && (sim.pos[node]?.y ?? 0) > sim.height * 0.6) killBranch(sim, node, cycle);
}

/** Dieback: the weakest living limbs die, a growing share of the crown each cycle. */
function dieBack(sim: Sim, cycle: number, share: number): void {
  const light: number[] = [];
  const budCount: number[] = [];
  gatherLight(sim, light, budCount);
  const candidates: [number, number][] = [];
  let living = 0;
  for (let node = 1; node < sim.pos.length; node += 1) {
    if (at(sim.deadAt, node) !== Infinity) continue;
    living += 1;
    const buds = at(budCount, node);
    // Old trees die back from the twigs inward; the big scaffold limbs stay.
    if (at(sim.main, node) === 0 && buds > 0 && buds < 40) candidates.push([node, at(light, node) / buds - sim.random() * 0.15]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  let killed = 0;
  for (const [node] of candidates) {
    if (killed >= living * share) break;
    if (at(sim.deadAt, node) !== Infinity) continue;
    const before = sim.deadAt.filter((value) => value !== Infinity).length;
    killBranch(sim, node, cycle);
    killed += sim.deadAt.filter((value) => value !== Infinity).length - before;
  }
}

/** Old age: vigor fades, the top dies back, then limb after limb, until the tree stands dead. */
export function declineCycle(sim: Sim, cycle: number, decline: number): void {
  if (decline > 0.3 && decline <= 0.3 + 1 / (sim.species.cycles * 0.28)) killLeaderTop(sim, cycle);
  dieBack(sim, cycle, 0.03 + decline * decline * 0.3);
  growCycle(sim, cycle, Math.max(0.3, 1 - decline * 0.9), sim.species.shed + decline * 0.2, declineAllowance(sim, decline));
}


/**
 * Old trees keep growing while anything of them lives: far less each cycle,
 * tapering on a curve, and more than a real tree would, until the end.
 */
function declineAllowance(sim: Sim, decline: number): number {
  const room = Math.max(0, sim.maxNodes - sim.pos.length);
  return room * 0.13 * (1 - decline) ** 1.1;
}

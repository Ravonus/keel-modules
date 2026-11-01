// Bending: loads on the wood sag the limbs they hang from, thinner ones more.

import { at } from "./math.js";
import type { TreeModel } from "./model.js";
import type { TreeFrame } from "./frame.js";

// ---------------------------------------------------------------- bending

/** Weight resting on a node of the tree (an animal on a branch), pulling it down. A negative weight lifts it, as a limb springs back past rest. */
export interface Load {
  readonly node: number;
  readonly weight: number;
}

/**
 * How readily wood bends: each piece of the limb under a load turns by this
 * × weight × lever × its length ÷ radius⁴, as a beam does. A thin twig dips
 * under a songbird; a thick limb hardly moves under a monkey; the trunk never.
 */
export const WOOD_SAG = 6e-6;
/** The most any one piece turns, in radians, and the most a load sinks, in world units and as a share of the limb's reach. */
const MOST_TURN = 0.3;
/** The girth of a twig, which gives freely; thicker wood gives less again by the square of its girth. */
const TWIG = 0.02;
const MOST_SAG = 0.25;
const MOST_SAG_SHARE = 0.25;

const horizontal = (frame: TreeFrame, ax: number, az: number, node: number): number => Math.hypot(at(frame.x, node) - ax, at(frame.z, node) - az);
const pieceLength = (frame: TreeFrame, node: number): number => Math.hypot(at(frame.x, node) - at(frame.baseX, node), at(frame.y, node) - at(frame.baseY, node), at(frame.z, node) - at(frame.baseZ, node));

/** The limb a load bears on, from where it leaves the trunk out to the load. */
function limbOf(model: TreeModel, node: number): number[] {
  const chain: number[] = [];
  for (let at_ = node; at_ > 0 && at(model.order, at_) > 0; at_ = at(model.parent, at_)) chain.push(at_);
  return chain.reverse();
}

/** How far each node of the limb sinks: every piece turns by the load's moment over its own stiffness, and carries all beyond it down. */
function limbDrops(frame: TreeFrame, chain: readonly number[], load: Load, sag: number): number[] {
  const lx = at(frame.x, load.node);
  const lz = at(frame.z, load.node);
  const turns = chain.map((node) => {
    const lever = Math.hypot(lx - at(frame.baseX, node), lz - at(frame.baseZ, node));
    const radius = Math.max(at(frame.radius, node), 0.006);
    // Thick wood is far stiffer than a beam's law alone says: past a twig's girth it all but stops giving.
    const give = Math.min(1, (TWIG / radius) ** 2);
    return Math.min((sag * Math.abs(load.weight) ** 0.5 * lever * pieceLength(frame, node) * give) / radius ** 4, MOST_TURN);
  });
  return chain.map((node, i) => {
    let sum = 0;
    for (let j = 0; j <= i; j += 1) {
      const base = chain[j] ?? node;
      sum += (turns[j] ?? 0) * horizontal(frame, at(frame.baseX, base), at(frame.baseZ, base), node);
    }
    return sum;
  });
}

/**
 * Every node's drop under one load. The bend gathers in the thin wood near
 * the animal and the stout limbs it grows from barely give; whatever grows
 * from the bent wood rides along.
 */
function loadDrop(model: TreeModel, frame: TreeFrame, load: Load, drop: Float32Array, sag: number): void {
  const chain = limbOf(model, load.node);
  if (chain.length === 0) return;
  const drops = limbDrops(frame, chain, load, sag);
  const reach = chain.reduce((sum, node) => sum + horizontal(frame, at(frame.baseX, node), at(frame.baseZ, node), node), 0);
  const deepest = drops[drops.length - 1] ?? 0;
  const cap = Math.min(MOST_SAG, reach * MOST_SAG_SHARE + 0.02);
  const scale = (deepest > cap ? cap / deepest : 1) * Math.sign(load.weight);
  const own = new Float32Array(model.count).fill(Number.NaN);
  chain.forEach((node, i) => { own[node] = (drops[i] ?? 0) * scale; });
  own[0] = 0;
  for (let node = 1; node < model.count; node += 1) {
    if (Number.isNaN(own[node])) own[node] = own[at(model.parent, node)] ?? 0;
    drop[node] = (drop[node] ?? 0) + (own[node] ?? 0);
  }
}

/**
 * The frame with branches bent under `loads`: a bird's twig dips, a monkey's
 * limb sags, the trunk hardly moves. Pass `out` from the last call to reuse
 * its arrays (the same object comes back, so a renderer can tell it is the
 * same pose); everything but the positions is shared with `frame`.
 */
export function bendFrame(model: TreeModel, frame: TreeFrame, loads: readonly Load[], out?: TreeFrame, sag = WOOD_SAG): TreeFrame {
  const target = out ?? { ...frame, x: new Float32Array(frame.x), y: new Float32Array(frame.y), z: new Float32Array(frame.z), baseX: new Float32Array(frame.baseX), baseY: new Float32Array(frame.baseY), baseZ: new Float32Array(frame.baseZ) };
  target.x.set(frame.x);
  target.z.set(frame.z);
  target.baseX.set(frame.baseX);
  target.baseZ.set(frame.baseZ);
  if (loads.length === 0) {
    target.y.set(frame.y);
    target.baseY.set(frame.baseY);
    return target;
  }
  const drop = new Float32Array(model.count);
  for (const load of loads) if (load.weight !== 0 && load.node > 0 && load.node < model.count) loadDrop(model, frame, load, drop, sag);
  for (let node = 0; node < model.count; node += 1) {
    target.y[node] = at(frame.y, node) - at(drop, node);
    const parent = at(model.parent, node);
    target.baseY[node] = at(frame.baseY, node) - (parent >= 0 ? at(drop, parent) : 0);
  }
  return target;
}

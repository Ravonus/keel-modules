// Posing one moment: each node's growth, life, fall and limp at a cycle, grand or natural.

import type { SpeciesId } from "./species.js";
import {
  add, at, clamp01, createRandom, cross, lengthOf, normalize, perpendicular, ramp, rotate, smooth, vec,
} from "./math.js";
import type { Vec } from "./math.js";
import { cycleAt } from "./model.js";
import type { TreeModel } from "./model.js";

// ---------------------------------------------------------------- posing one moment

export interface TreeFrame {
  readonly cycle: number;
  /** 0 not grown yet, rising to 1 as the internode elongates. */
  readonly grow: Float32Array;
  readonly radius: Float32Array;
  /** 0 living wood, 1 long dead and grey. */
  readonly dead: Float32Array;
  /** 0 attached; rises to 1 while a shed branch falls; it then lies and rots. */
  readonly fall: Float32Array;
  /** 0 sound, 1 rotted away. */
  readonly rot: Float32Array;
  /** Living tips carried, the pipe-model weight. Small values are leafy twigs. */
  readonly tips: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Where each internode starts (its parent's posed end). */
  readonly baseX: Float32Array;
  readonly baseY: Float32Array;
  readonly baseZ: Float32Array;
  /** How many internodes are visible. */
  readonly visible: number;
  readonly height: number;
  /** How much bigger than life a grand tree has grown by now (the mean of taller and wider); 1 for a natural tree. Renderers grow leaf clumps with it. */
  readonly scale: number;
}

export interface FrameOptions {
  /** World y of the ground where shed limbs come to rest. */
  readonly ground?: number;
  /**
   * Grow a grand tree, a world tree: it keeps getting bigger all its life,
   * slowing with age, until it stands GRAND times taller and wider than the
   * natural tree, in its own species' way. `true` uses the species' own
   * measure; a number scales how far past life it goes (1 is that measure).
   */
  readonly grand?: boolean | number;
}

/**
 * How much bigger a grand tree of each kind grows than the natural one, upward
 * and outward. Conifers and redwoods tower; acacias, oaks and willows spread
 * wide; a palm only climbs; a baobab swells.
 */
export const GRAND: Readonly<Record<SpeciesId, { readonly up: number; readonly out: number }>> = {
  cherry: { up: 1.9, out: 2.4 },
  oak: { up: 2.2, out: 3.0 },
  pine: { up: 2.7, out: 1.5 },
  birch: { up: 2.3, out: 1.7 },
  willow: { up: 1.8, out: 2.8 },
  acacia: { up: 1.6, out: 3.2 },
  palm: { up: 2.5, out: 1.1 },
  spruce: { up: 2.6, out: 1.5 },
  redwood: { up: 3.2, out: 1.6 },
  maple: { up: 2.1, out: 2.6 },
  jacaranda: { up: 1.8, out: 2.8 },
  baobab: { up: 1.8, out: 2.5 },
  apple: { up: 1.8, out: 2.6 },
  pear: { up: 2.3, out: 1.8 },
  peach: { up: 1.6, out: 2.6 },
  plum: { up: 1.9, out: 2.3 },
  orange: { up: 1.8, out: 2.4 },
  lemon: { up: 1.7, out: 2.2 },
  fig: { up: 1.7, out: 2.8 },
  mango: { up: 2.3, out: 2.8 },
};

interface Grandeur { readonly up: number; readonly out: number; readonly girth: number }

const naturalSizes = new WeakMap<TreeModel, Float32Array>();

/** How tall and how wide the natural tree's wood has grown by `cycle`, from its grown positions; measured once per whole cycle and blended between. */
function naturalSize(model: TreeModel, cycle: number): [number, number] {
  let sizes = naturalSizes.get(model);
  if (sizes === undefined) {
    sizes = new Float32Array((model.cycles + 1) * 2);
    for (let node = 0; node < model.count; node += 1) {
      const from = Math.max(0, Math.ceil(at(model.birth, node) + at(model.span, node)));
      const tall = at(model.y, node);
      const wide = Math.hypot(at(model.x, node), at(model.z, node));
      for (let whole = from; whole <= model.cycles; whole += 1) {
        sizes[whole * 2] = Math.max(at(sizes, whole * 2), tall);
        sizes[whole * 2 + 1] = Math.max(at(sizes, whole * 2 + 1), wide);
      }
    }
    naturalSizes.set(model, sizes);
  }
  const low = Math.max(0, Math.min(model.cycles, Math.floor(cycle)));
  const high = Math.min(model.cycles, low + 1);
  const blend = clamp01(cycle - low);
  return [0, 1].map((axis) => at(sizes, low * 2 + axis) + (at(sizes, high * 2 + axis) - at(sizes, low * 2 + axis)) * blend) as [number, number];
}

/** The share of its life a tree has lived when it reaches `cycle`: `cycleAt` run backwards. */
function lifeAt(model: TreeModel, cycle: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (cycleAt(model, middle, 1) < cycle) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * A grand tree's size at a cycle: natural while a sapling, then growing by
 * age on a slowing curve for the rest of its life. It never levels off: an
 * old tree still gains a little every year, right up to its death.
 */
export function grandAt(model: TreeModel, cycle: number, grand: boolean | number = true): Grandeur {
  const reach = grand === false ? 0 : grand === true ? 1 : Math.max(0, grand);
  const share = clamp01((lifeAt(model, cycle) - 0.04) / 0.96) ** 0.75;
  const measure = GRAND[model.species.id];
  // The few decline cycles pass in a tree's last years; what the natural tree
  // still gains in them would come as a sudden spurt, so a grand tree grows on
  // from its prime size by age alone.
  const prime = Math.min(cycle, model.matureAt);
  const [tall, wide] = naturalSize(model, cycle);
  const [primeTall, primeWide] = naturalSize(model, prime);
  const up = (1 + (measure.up - 1) * reach * share) * (reach > 0 && tall > 0 ? primeTall / tall : 1);
  const out = (1 + (measure.out - 1) * reach * share) * (reach > 0 && wide > 0 ? primeWide / wide : 1);
  // Old wood thickens with the load it carries: the trunk widens with the crown and the height.
  return { up, out, girth: (up * out) ** 0.6 };
}

const FALL_CYCLES = 0.08;
const LOG_RADIUS = 0.09;
/** Fallen limbs come to rest inside this reach of the trunk. */
const ISLAND = 3.4;
/** How far dead wood sinks, as a share of the way to its resting pitch. */
const LIMP = 0.68;
/** Dead wood hangs this far under level, in radians. */
const LIMP_PITCH = -0.22;
/** How far either way each piece strays from that, so a dead limb stays crooked; thin wood hangs lower. */
const LIMP_CROOK = 0.3;
const LIMP_TWIG = 0.05;

function growthPass(model: TreeModel, cycle: number, frame: TreeFrame): void {
  for (let node = model.count - 1; node >= 0; node -= 1) {
    const grow = clamp01((cycle - at(model.birth, node)) / Math.max(at(model.span, node), 1e-3));
    frame.grow[node] = grow;
    const tips = Math.max(grow, at(frame.tips, node));
    frame.tips[node] = tips;
    const parent = at(model.parent, node);
    if (parent >= 0 && grow > 0) frame.tips[parent] = at(frame.tips, parent) + tips;
  }
  const { radiusTip, pipe, palm } = model.species;
  for (let node = 0; node < model.count; node += 1) {
    const grow = at(frame.grow, node);
    frame.radius[node] = grow <= 0 ? 0 : radiusTip * at(frame.tips, node) ** (1 / pipe) * (0.45 + 0.55 * grow);
  }
  if (palm !== null) palmTrunk(model, cycle, frame, palm.trunk);
}

/** A palm trunk keeps one girth all its life, swelling only at its foot; it reaches it while young. */
function palmTrunk(model: TreeModel, cycle: number, frame: TreeFrame, trunk: number): void {
  const girth = trunk * (0.35 + 0.65 * ramp(cycle, 1, 8));
  for (let node = 0; node < model.count; node += 1) {
    if (at(model.order, node) !== 0 || at(frame.grow, node) <= 0) continue;
    frame.radius[node] = girth * (node < 3 ? 1.35 - node * 0.1 : 1);
  }
}

/** Death and shedding pass down the tree: a child is never more alive than its parent. */
function lifePass(model: TreeModel, cycle: number, frame: TreeFrame, shedRoot: Int32Array): void {
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    const ownDead = clamp01((cycle - at(model.deadAt, node)) / 1.2);
    frame.dead[node] = parent >= 0 ? Math.max(ownDead, at(frame.dead, parent)) : ownDead;
    const inherited = parent >= 0 ? at(shedRoot, parent) : -1;
    shedRoot[node] = inherited >= 0 ? inherited : cycle >= at(model.shedAt, node) ? node : -1;
    const root = at(shedRoot, node);
    const since = root >= 0 ? cycle - at(model.shedAt, root) : -1;
    frame.fall[node] = since < 0 ? 0 : clamp01(since / FALL_CYCLES);
    const small = root >= 0 && at(frame.radius, root) < LOG_RADIUS;
    frame.rot[node] = since < 0 ? 0 : small ? clamp01(since / FALL_CYCLES) : ramp(since, 1.4, 2.8);
  }
}

interface FallPose { readonly pivot: Vec; readonly axis: Vec; readonly angle: number; readonly drop: Vec }

/** A shed limb swings down about its base and comes to rest flat, pointing out from the trunk. */
function fallPose(model: TreeModel, root: number, ground: number, random: () => number, size: Grandeur): FallPose {
  const parent = at(model.parent, root);
  const pivot = restAt(model, parent, size);
  const tip = restAt(model, root, size);
  const heading = normalize(add(tip, pivot, -1));
  const out = normalize(vec(heading.x + pivot.x * 0.3, 0, heading.z + pivot.z * 0.3), normalize(vec(random() - 0.5, 0, random() - 0.5), vec(1, 0, 0)));
  const axis = normalize(cross(heading, out), perpendicular(heading));
  const angle = Math.acos(Math.max(-1, Math.min(1, heading.x * out.x + heading.y * out.y + heading.z * out.z)));
  const rest = vec(pivot.x + out.x * 0.6, ground + 0.06, pivot.z + out.z * 0.6);
  return { pivot, axis, angle, drop: add(rest, pivot, -1) };
}

/** Where a node grows, at a grand tree's size. */
const restAt = (model: TreeModel, node: number, size: Grandeur): Vec => vec(at(model.x, node) * size.out, at(model.y, node) * size.up, at(model.z, node) * size.out);

function poseFor(model: TreeModel, poses: Map<number, FallPose>, root: number, ground: number, size: Grandeur): FallPose {
  let pose = poses.get(root);
  if (pose === undefined) {
    pose = fallPose(model, root, ground, createRandom(model.seed ^ root), size);
    poses.set(root, pose);
  }
  return pose;
}

/** Carries a resting point along a falling limb: swing about the pivot, drop, then settle flat. */
function fallen(point: Vec, pose: FallPose, progress: number, ground: number): Vec {
  // Under gravity it speeds up all the way down and stops by hitting the ground.
  const eased = progress * progress;
  const swung = add(pose.pivot, rotate(add(point, pose.pivot, -1), pose.axis, pose.angle * eased));
  const moved = add(swung, pose.drop, eased * eased);
  const reach = Math.hypot(moved.x, moved.z);
  const keep = reach > ISLAND ? (ISLAND + (reach - ISLAND) * 0.25) / reach : 1;
  const pull = 1 + (keep - 1) * eased;
  // A limb on the ground lies flat: its side twigs settle into the grass
  // instead of standing up out of it.
  const high = Math.max(0, moved.y - ground - 0.04);
  return vec(moved.x * pull, ground + 0.04 + high + (Math.min(0.12, high * 0.05) - high) * eased, moved.z * pull);
}

/** Dead wood loses its turgor: each piece sinks from where it grew toward a little under level. */
function limp(piece: Vec, dead: number, outward: Vec, stray: number, order: number): Vec {
  const flat = Math.hypot(piece.x, piece.z);
  const pitch = Math.atan2(piece.y, flat);
  const rest = LIMP_PITCH + (stray - 0.5) * 2 * LIMP_CROOK - order * LIMP_TWIG;
  if (pitch <= rest) return piece;
  const sunk = pitch + (rest - pitch) * LIMP * smooth(dead);
  const heading = flat > 1e-6 ? vec(piece.x / flat, 0, piece.z / flat) : normalize(vec(outward.x, 0, outward.z), vec(1, 0, 0));
  const long = lengthOf(piece);
  return vec(heading.x * Math.cos(sunk) * long, Math.sin(sunk) * long, heading.z * Math.cos(sunk) * long);
}

function posePass(model: TreeModel, frame: TreeFrame, shedRoot: Int32Array, ground: number, size: Grandeur): void {
  const poses = new Map<number, FallPose>();
  const held = new Float64Array(model.count * 3);
  for (let node = 0; node < model.count; node += 1) {
    const parent = at(model.parent, node);
    const restBase = parent >= 0 ? restAt(model, parent, size) : vec(0, 0, 0);
    const restEnd = add(restBase, add(restAt(model, node, size), restBase, -1), at(frame.grow, node));
    const root = at(shedRoot, node);
    let base = parent >= 0 ? vec(at(frame.x, parent), at(frame.y, parent), at(frame.z, parent)) : vec(0, 0, 0);
    const dead = at(model.order, node) > 0 ? at(frame.dead, node) : 0;
    const heldBase = parent >= 0 && dead > 0 ? vec(at(held, parent * 3), at(held, parent * 3 + 1), at(held, parent * 3 + 2)) : restBase;
    let heldEnd = dead > 0 ? add(heldBase, limp(add(restEnd, restBase, -1), dead, restBase, createRandom(model.seed ^ (node * 31 + 7))(), at(model.order, node))) : restEnd;
    if (dead > 0) heldEnd = vec(heldEnd.x, Math.max(heldEnd.y, ground + 0.04), heldEnd.z);
    held[node * 3] = heldEnd.x; held[node * 3 + 1] = heldEnd.y; held[node * 3 + 2] = heldEnd.z;
    let end = heldEnd;
    if (root >= 0) {
      const pose = poseFor(model, poses, root, ground, size);
      const progress = at(frame.fall, node);
      // The sag lets go as the limb does, so it leaves from where it hung and lands where it always lands.
      end = fallen(add(restEnd, add(heldEnd, restEnd, -1), 1 - progress), pose, progress, ground);
      if (root === node) base = fallen(add(restBase, add(heldBase, restBase, -1), 1 - progress), pose, progress, ground);
    }
    frame.x[node] = end.x; frame.y[node] = end.y; frame.z[node] = end.z;
    frame.baseX[node] = base.x; frame.baseY[node] = base.y; frame.baseZ[node] = base.z;
  }
}

/** Poses the tree at a cycle: what has grown, how thick it is, what is dead and what lies on the ground. */
export function treeFrame(model: TreeModel, cycle: number, options: FrameOptions = {}): TreeFrame {
  const count = model.count;
  const at01 = Math.min(Math.max(cycle, 0), model.cycles);
  const array = (): Float32Array => new Float32Array(count);
  const frame: TreeFrame = {
    cycle: at01, grow: array(), radius: array(), dead: array(), fall: array(), rot: array(), tips: array(),
    x: array(), y: array(), z: array(), baseX: array(), baseY: array(), baseZ: array(), visible: 0, height: 0, scale: 1,
  };
  const shedRoot = new Int32Array(count).fill(-1);
  const size = options.grand === undefined || options.grand === false ? { up: 1, out: 1, girth: 1 } : grandAt(model, at01, options.grand);
  growthPass(model, at01, frame);
  if (size.girth !== 1) for (let node = 0; node < count; node += 1) frame.radius[node] = at(frame.radius, node) * size.girth;
  lifePass(model, at01, frame, shedRoot);
  posePass(model, frame, shedRoot, options.ground ?? 0, size);
  let visible = 0;
  let height = 0;
  for (let node = 0; node < count; node += 1) {
    if (at(frame.grow, node) <= 0 || at(frame.rot, node) >= 1) continue;
    visible += 1;
    if (at(frame.fall, node) === 0) height = Math.max(height, at(frame.y, node));
  }
  return { ...frame, visible, height, scale: Math.sqrt(size.up * size.out) };
}

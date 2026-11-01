// Wood: the trunk, limbs, roots and shards posed in place and painted by strain, skin and season.

import type { TreeColors, TreeFrameLike, TreeSkin, TreeStrain, YearLike } from "./inputs.js";
import { at, hash32 } from "./math.js";
import { sway } from "./wind.js";
import type { Offset } from "./wind.js";
import { clearSlot, writeColumns, writeOrigin, writeSegment } from "./instances.js";
import { NEEDLE_KINDS } from "./shapes.js";
import { HOLE_TONE, NO_ROOT_BREAK, ROOT_SEGMENTS, ROOT_SHARDS, rootBreaks, rootPath, rootShards } from "./roots.js";
import type { RootBreak, RootPoint, RootShard } from "./roots.js";
import type { Tree, TreeMotion } from "./tree.js";

// ---------------------------------------------------------------- wood

export function poseWood(tree: Tree, frame: TreeFrameLike, motion: TreeMotion): void {
  const { model, meshes, offset } = tree;
  const array = meshes.wood.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind * (motion.field ?? 1) : 0;
  const swayB: Offset = { x: 0, z: 0 };
  for (let node = 0; node < model.count; node += 1) {
    const fallen = at(frame.fall, node) > 0;
    if (at(frame.grow, node) <= 0 || at(frame.rot, node) >= 1 || (fallen && !tree.features.deadwood)) { clearSlot(array, node); continue; }
    const radius = at(frame.radius, node) * (1 - at(frame.rot, node) * 0.7);
    const a: [number, number, number] = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
    const b: [number, number, number] = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
    if (!fallen && !tree.still) {
      sway(offset, a[0], a[1], a[2], motion.elapsed, wind, height, motion.windDir);
      sway(swayB, b[0], b[1], b[2], motion.elapsed, wind, height, motion.windDir);
      a[0] += offset.x; a[2] += offset.z; b[0] += swayB.x; b[2] += swayB.z;
    }
    writeSegment(array, node, a, b, radius);
  }
  poseRoots(tree, frame, array);
  meshes.wood.instanceMatrix.needsUpdate = true;
}

/** Surface roots flare out from the trunk foot and thicken with it. */
function poseRoots(tree: Tree, frame: TreeFrameLike, array: Float32Array): void {
  const { model, ground } = tree;
  const trunk = at(frame.radius, 0);
  const breaks = treeBreaks(tree, trunk);
  for (const [index, root] of model.roots.entries()) {
    const first = model.count + index * ROOT_SEGMENTS;
    for (let part = 0; part < ROOT_SEGMENTS; part += 1) clearSlot(array, first + part);
    if (!tree.features.roots || trunk < 0.06) continue;
    if (!tree.smooth) {
      const reach = (0.25 + trunk * 2.4) * root.reach;
      const c = Math.cos(root.angle), s = Math.sin(root.angle);
      writeSegment(array, first, [c * trunk * 0.5, ground.y + trunk * 0.9, s * trunk * 0.5], [c * reach, ground.y + 0.02, s * reach], trunk * 0.42);
      continue;
    }
    // A palm's roots are a short fibrous flare at its foot, never long runners.
    const parts = tree.features.rootSink && model.species.palm ? 4 : ROOT_SEGMENTS;
    // Till a tree is old its roots stay within the inner part of the planter; an old one's run to the lip and over it.
    const reach = tree.features.rootSink && trunk < ROOT_OLD ? (ground.rootReach ?? ground.radius) * 0.42 : Infinity;
    const plan = breaks[index] ?? NO_ROOT_BREAK;
    poseRootPath(array, first, rootPath(root, trunk, ground, plan), tree.features.rootSink ? ROOT_SINK : 0, parts, plan.heave > 0 ? Infinity : reach);
  }
}

/** The roots' break plans for this trunk (`rootBreak`), kept while the trunk holds its girth. */
function treeBreaks(tree: Tree, trunk: number): readonly RootBreak[] {
  const { model } = tree;
  const on = tree.features.rootBreak && tree.features.roots && tree.smooth && !model.species.palm;
  if (!on) return [];
  if (tree.breaks.trunk !== trunk) {
    tree.breaks.trunk = trunk;
    tree.breaks.plans = rootBreaks(model.roots, trunk, tree.ground, tree.seed);
    poseShards(tree, trunk);
  }
  return tree.breaks.plans;
}

/** Weathered stone, darkest first: the chunks' colour when the host does not pass its planter's. */
const SHARD_COLORS = ["#5e4a3a", "#7a634f", "#958068"] as const;

/** The planter chunks the roots broke loose, posed only when the trunk grows. */
function poseShards(tree: Tree, trunk: number): void {
  const mesh = tree.meshes.shards;
  if (!mesh) return;
  const array = mesh.instanceMatrix.array;
  const own = tree.ground.planter?.colors;
  const colors = own && own.length > 0 ? own : SHARD_COLORS;
  for (const [index, root] of tree.model.roots.entries()) {
    const shards = rootShards(root, index, trunk, tree.ground, tree.breaks.plans[index] ?? NO_ROOT_BREAK, tree.seed);
    for (let slot = 0; slot < ROOT_SHARDS; slot += 1) {
      const shard = shards[slot];
      const place = index * ROOT_SHARDS + slot;
      if (!shard) { clearSlot(array, place); continue; }
      writeShard(array, place, shard);
      tree.a.set(shard.tone === HOLE_TONE ? (colors[0] ?? SHARD_COLORS[0]) : (colors[Math.min(shard.tone, colors.length - 1)] ?? SHARD_COLORS[0]));
      mesh.setColorAt(place, shard.tone === HOLE_TONE ? tree.a.multiplyScalar(0.28) : tree.a);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** A chunk turned to face out from the planter at its angle, tipped out by `tilt` and rolled about its outward axis. */
export function writeShard(array: Float32Array, index: number, shard: RootShard): void {
  const c = Math.cos(shard.angle), n = Math.sin(shard.angle);
  const ct = Math.cos(shard.tilt), st = Math.sin(shard.tilt), cr = Math.cos(shard.roll), sr = Math.sin(shard.roll);
  // Tangent, up and out; up tips toward out by tilt, then up and tangent turn about out by roll.
  const tangent = [-n, 0, c];
  const up = [c * st, ct, n * st];
  const out = [c * ct, -st, n * ct];
  const x = tangent.map((v, i) => v * cr + (up[i] ?? 0) * sr);
  const y = up.map((v, i) => v * cr - (tangent[i] ?? 0) * sr);
  const [sx, sy, sz] = shard.size;
  writeColumns(array, index, [
    (x[0] ?? 0) * sx, (x[1] ?? 0) * sx, (x[2] ?? 0) * sx, 0,
    (y[0] ?? 0) * sy, (y[1] ?? 0) * sy, (y[2] ?? 0) * sy, 0,
    (out[0] ?? 0) * sz, (out[1] ?? 0) * sz, (out[2] ?? 0) * sz, 0,
  ]);
  writeOrigin(array, index, shard.x, shard.y, shard.z);
}

/**
 * `rootSink`: only roots a pixel and a half thick or more draw. Once a root thins
 * below that, or runs past the inner part of the planter, it dives under the soil
 * for good, so no hairline or spoke runs on across the planter top like a crack;
 * a young tree shows a short flare, an old one's thick roots still run to the lip
 * and roll over it.
 */
const ROOT_SINK = 0.06;
/** The trunk radius past which a tree is old enough for its roots to reach the planter's lip. */
const ROOT_OLD = 0.45;

function poseRootPath(array: Float32Array, first: number, path: readonly RootPoint[], sink: number, parts: number, reach: number): void {
  for (let part = 0; part < parts; part += 1) {
    const p = path[part];
    const q = path[part + 1];
    if (p === undefined || q === undefined || p.gone) continue;
    if (part > 1 && (p.radius < sink || Math.hypot(p.x, p.z) > reach)) break;
    writeSegment(array, first + part, [p.x, p.y, p.z], [q.x, q.y, q.z], (p.radius + q.radius) / 2);
  }
}

/** The colours an internode's strain wears (the tree's own for strain 0, or when there are no strains). */
export function strainColors(tree: Tree, node: number): TreeColors {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  return (strain > 0 ? tree.strains[strain]?.colors : undefined) ?? tree.colors;
}

/** The strain an internode belongs to, if the tree has strains. */
export const strainAt = (tree: Tree, node: number): TreeStrain | undefined => (tree.strainOf && node < tree.model.count ? tree.strains[at(tree.strainOf, node)] : undefined);

/** How far a leaf hangs below its twig on a weeping strain: strands of uneven length. */
export function strainDrop(tree: Tree, node: number, index: number): number {
  const hang = strainAt(tree, node)?.hang ?? 0;
  return hang > 0 ? hang * (0.25 + ((index * 7) % 8) / 8) : 0;
}

/** Does this leaf grow as a needle sprig? The tree's own habit, unless its strain is a broadleaf kind. */
export function needleLeaf(tree: Tree, node: number): boolean {
  if (!tree.needles) return false;
  const kind = strainAt(tree, node)?.species;
  return kind === undefined || NEEDLE_KINDS[kind] !== undefined;
}

/** The skin an internode's strain wears: the tree's own unless its strain sets one or drops it. */
export function strainSkin(tree: Tree, node: number): TreeSkin | null {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  const own = strain > 0 ? tree.strains[strain] : undefined;
  return own && own.skin !== undefined ? own.skin : tree.skin;
}

/**
 * A stable number for the clump a twig belongs to: its parent shoot, so the
 * leaves and flowers of neighbouring twigs share a tone and the crown reads
 * as masses (the `clumps` and `sprays` looks), not a per-leaf speckle.
 */
export function clumpOf(tree: Pick<Tree, "model">, node: number): number {
  const parent = tree.model.parent;
  const shoot = parent && node < tree.model.count ? Math.max(0, at(parent, node)) : node;
  return hash32(Math.imul(shoot + 1, 2654435761) ^ 0x9e3779b9);
}

/** The year an internode's limbs live by: its strain's own, or the tree's. */
export function strainYear(tree: Tree, node: number, year: YearLike): YearLike {
  if (!tree.strainOf || tree.strainYears.length === 0 || node >= tree.model.count) return year;
  return tree.strainYears[at(tree.strainOf, node)] ?? year;
}

function barkTone(tree: Tree, frame: TreeFrameLike, node: number): string {
  const strain = tree.strainOf && node < tree.model.count ? at(tree.strainOf, node) : 0;
  const trunk = (strain > 0 ? tree.strains[strain]?.bark : undefined) ?? strainColors(tree, node).trunk;
  const isRoot = node >= tree.model.count;
  const radius = isRoot ? 1 : at(frame.radius, node);
  const hash = hash32(node * 2654435761) % 100;
  if (tree.model.species.id === "birch") return (hash < 18 && radius > 0.05 ? trunk[2] : radius > 0.05 ? trunk[0] : trunk[1]) ?? "#6b4a33";
  return (radius > 0.2 ? trunk[0] : radius > 0.07 ? trunk[1] : trunk[2]) ?? "#6b4a33";
}

export function paintWood(tree: Tree, frame: TreeFrameLike, dead: boolean): void {
  const { model, meshes, a, b, colors } = tree;
  const total = model.count + model.roots.length * ROOT_SEGMENTS;
  for (let node = 0; node < total; node += 1) {
    a.set(barkTone(tree, frame, node));
    if (node < model.count) {
      const fresh = at(frame.grow, node) < 1 || frame.cycle - at(model.birth, node) < 1;
      if (fresh && !dead) a.lerp(b.set(strainColors(tree, node).leaves[0] ?? colors.leaves[0] ?? "#6c9a54"), 0.45);
      a.lerp(b.set("#8e897f"), at(frame.dead, node) * 0.85);
      if (at(frame.fall, node) > 0) a.lerp(b.set("#4a3b2f"), 0.55 + at(frame.rot, node) * 0.35);
    }
    if (dead) a.lerp(b.set("#8e897f"), 0.7);
    meshes.wood.setColorAt(node, a);
  }
  if (meshes.wood.instanceColor) meshes.wood.instanceColor.needsUpdate = true;
}

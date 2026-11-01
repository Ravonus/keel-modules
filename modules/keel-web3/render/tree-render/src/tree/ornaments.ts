// Flowers and fruit: the sets each kind bears, the fruit to eat and the fruit eaten, posed and coloured by ripeness.

import type { ColorLike, GeometryLike, TreeColors, TreeFrameLike, TreeKindOrnaments, YearLike } from "../inputs.js";
import { TAU, at, clamp, hash32 } from "../math.js";
import { sway } from "../wind.js";
import type { Offset } from "../wind.js";
import { clearSlot, writeBox } from "../instances.js";
import { ornamentLook } from "./bark.js";
import { bearingNode, makeMesh, ornamentState, sprayPlan } from "./tree.js";
import type { OrnamentSet, Tree, TreeFruit, TreeMotion } from "./tree.js";
import { clumpOf, strainColors, strainSkin } from "./wood.js";
import { litterSpot, ornamentsLying, soundBearer } from "./litter.js";

// ---------------------------------------------------------------- flowers and fruit

export function ornamentSet(tree: Pick<Tree, "lit" | "group" | "model" | "features" | "smooth">, name: OrnamentSet["name"], shape: GeometryLike, litterStart: number, litterLimit: number, spray: GeometryLike | null = null): OrnamentSet | null {
  const spec = name === "fruit" ? tree.model.species.fruit : tree.model.species.flower;
  const slots = name === "fruit" ? tree.model.fruit : tree.model.blossoms;
  if (spec === null || slots.count === 0 || !tree.features[name]) return null;
  const plan = sprayPlan(tree, spec, slots, spray !== null);
  return {
    name, spec, slots, litterStart, litterLimit, strain: -1, ...plan,
    look: ornamentLook(spec, tree.model.species.id),
    mesh: makeMesh(tree, slots.count, name === "fruit" ? 0.62 : 0.7, tree.features.shadows, plan.spray && spray ? spray : shape),
    stride: Math.max(1, Math.ceil(slots.count / Math.max(litterLimit, 1))),
  };
}

/** A minor kind's flowers or fruit as a set of their own (no litter: they fall with the tree's own). */
export function kindSet(tree: Pick<Tree, "lit" | "group" | "model" | "features" | "smooth">, kind: TreeKindOrnaments, name: OrnamentSet["name"], shape: GeometryLike, spray: GeometryLike | null = null): OrnamentSet | null {
  const grown = name === "fruit" ? kind.fruit : kind.flower;
  if (!grown || grown.slots.count === 0 || !tree.features[name]) return null;
  const plan = sprayPlan(tree, grown.spec, grown.slots, spray !== null);
  return {
    name, spec: grown.spec, slots: grown.slots, litterStart: 0, litterLimit: 0, strain: kind.strain, stride: 1, ...plan,
    look: ornamentLook(grown.spec, kind.species),
    mesh: makeMesh(tree, grown.slots.count, name === "fruit" ? 0.62 : 0.7, tree.features.shadows, plan.spray && spray ? spray : shape),
  };
}

/** The year a set keeps: a minor kind's own calendar, else the tree's. */
export const kindYear = (tree: Tree, set: OrnamentSet, year: YearLike): YearLike => (set.strain >= 0 ? tree.strainYears[set.strain] ?? year : year);

// Flowers and fruit hang from the nodes that bear them, open or ripen each in
// its own turn, and fall in rank order like the leaves.
/** Hanging fruit swings on its stalk, mostly with the wind; fruit that sits up does not. */
function hangSwing(lift: number, wind: number, motion: TreeMotion, rank: number): Offset {
  const swing = lift < 0 ? wind * 0.04 * (0.6 + Math.sin(motion.elapsed * 2.1 + rank * 30)) : 0;
  const dir = motion.windDir ?? 0;
  return { x: swing * Math.cos(dir), z: swing * Math.sin(dir) };
}

// ---------------------------------------------------------------- fruit to eat

/** The name a fruit set goes by in keys: the tree's own "fruit", or "kind<n>" for a minor kind's. */
const setName = (tree: Tree, set: OrnamentSet): string => (set === tree.fruits ? "fruit" : set === tree.flowers ? "flowers" : `kind${String(tree.kinds.indexOf(set))}`);
export const eatenSlot = (tree: Tree, set: OrnamentSet, index: number): boolean => set.name === "fruit" && tree.eaten.get(setName(tree, set))?.has(index) === true;
const fruitSets = (tree: Tree): OrnamentSet[] => [tree.fruits, ...tree.kinds].filter((set): set is OrnamentSet => set !== null && set.name === "fruit");

/** A new crop starts clean: once a set has no fruit open, last year's eaten slots are forgotten. */
export function forgetEaten(tree: Tree, year: YearLike): void {
  for (const set of fruitSets(tree)) if (ornamentState(set, kindYear(tree, set, year)).open <= 0) tree.eaten.delete(setName(tree, set));
}

/** Where a fruit hangs, still (the wind's sway left out): under its twig, by its own lift. */
function hangingSpot(tree: Tree, set: OrnamentSet, frame: TreeFrameLike, year: YearLike, index: number): { x: number; y: number; z: number; unit: number } {
  const node = at(set.slots.node, index);
  const unit = tree.colors.leafScale * at(set.slots.size, index) * (0.35 + 0.65 * clamp((ornamentState(set, year).open - at(set.slots.rank, index)) * 8, 0, 1));
  return { x: at(frame.x, node) + at(set.slots.dx, index), y: at(frame.y, node) + at(set.slots.dy, index) * 0.5 + set.look.lift * unit, z: at(frame.z, node) + at(set.slots.dz, index), unit };
}

export function ripeFruit(tree: Tree): TreeFruit[] {
  const frame = tree.lastFrame;
  const year0 = tree.lastYear;
  const motion = tree.lastMotion;
  if (!frame || !year0 || !motion || motion.dead === true) return [];
  const out: TreeFruit[] = [];
  for (const set of fruitSets(tree)) {
    const year = kindYear(tree, set, year0);
    const { open, fallen } = ornamentState(set, year);
    if (open <= 0 || frame.cycle < set.spec.from) continue;
    const name = setName(tree, set);
    const kind = set.spec.kind;
    for (let index = 0; index < set.slots.count; index += 1) {
      const rank = at(set.slots.rank, index);
      if (rank >= open || rank < fallen || tree.hiddenSlots[set.name].has(index) || eatenSlot(tree, set, index) || ripeness(set, index, year) < 0.7) continue;
      if (!bearingNode(tree, frame, set.spec, at(set.slots.node, index), set.strain >= 0)) continue;
      const spot = hangingSpot(tree, set, frame, year, index);
      out.push({ key: `${name}:${String(index)}`, kind, x: spot.x, y: spot.y, z: spot.z, size: spot.unit * set.look.size[0], hanging: true });
    }
    // Only the tree's own fruit lies under it (a minor kind's drops with it, unseen).
    if (set !== tree.fruits || !tree.meshes.litter || !ornamentsLying(set, year, motion)) continue;
    for (let slot = 0; slot < set.litterLimit; slot += 1) {
      const index = slot * set.stride;
      if (!soundBearer(set, frame, index) || at(set.slots.rank, index) >= fallen || eatenSlot(tree, set, index)) continue;
      const spot = litterSpot(tree, frame, set.slots, index, 0.45);
      const unit = tree.colors.leafScale * at(set.slots.size, index);
      out.push({ key: `${name}:${String(index)}`, kind, x: spot.x, y: tree.ground.y + 0.02 + unit * set.look.size[2] * 0.5, z: spot.z, size: unit * set.look.size[0], hanging: false });
    }
  }
  return out;
}

export function eatFruit(tree: Tree, key: string): boolean {
  const cut = key.lastIndexOf(":");
  const name = key.slice(0, cut);
  const index = Number(key.slice(cut + 1));
  const set = fruitSets(tree).find((each) => setName(tree, each) === name);
  if (!set || !Number.isInteger(index) || index < 0 || index >= set.slots.count) return false;
  const eaten = tree.eaten.get(name) ?? new Set<number>();
  if (eaten.has(index)) return false;
  eaten.add(index);
  tree.eaten.set(name, eaten);
  return true;
}

/** A set's slots that are falling or eaten right now (looked up by number, once per slot per frame). */
function goneSlots(tree: Tree, set: OrnamentSet): (index: number) => boolean {
  const hidden = tree.hiddenSlots[set.name];
  const eaten = set.name === "fruit" ? tree.eaten.get(setName(tree, set)) : undefined;
  return eaten ? (index) => hidden.has(index) || eaten.has(index) : (index) => hidden.has(index);
}

/** The sway field's offset into `tree.offset`, or none when the host moves the tree itself. */
export function stillOrSway(tree: Tree, x: number, y: number, z: number, motion: TreeMotion, wind: number, height: number): void {
  if (tree.still) { tree.offset.x = 0; tree.offset.z = 0; return; }
  sway(tree.offset, x, y, z, motion.elapsed, wind * (motion.field ?? 1), height, motion.windDir);
}

export function poseOrnaments(
  tree: Tree,
  set: OrnamentSet,
  frame: TreeFrameLike,
  year: YearLike,
  motion: TreeMotion,
): void {
  const { spec, slots, mesh, look } = set;
  const { open, fallen } = ornamentState(set, year);
  mesh.visible = motion.dead !== true && open > 0 && fallen < 1 && frame.cycle >= spec.from;
  if (!mesh.visible) return;
  const array = mesh.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind : 0;
  const gone = goneSlots(tree, set);
  // A young crown's sprays stay near life size, so its twigs read through them.
  const grow = 1 + (set.grow - 1) * clamp(frame.visible / 1500, 0.2, 1);
  // Thinned slots were cleared when the mesh was made and stay cleared.
  for (let index = 0; index < slots.count; index += set.thin) {
    const node = at(slots.node, index);
    const rank = at(slots.rank, index);
    if (rank >= open || rank < fallen || gone(index) || !bearingNode(tree, frame, spec, node, set.strain >= 0)) { clearSlot(array, index); continue; }
    const unit = tree.colors.leafScale * at(slots.size, index) * grow * (0.35 + 0.65 * clamp((open - rank) * 8, 0, 1));
    const x = at(frame.x, node) + at(slots.dx, index);
    const z = at(frame.z, node) + at(slots.dz, index);
    const y = at(frame.y, node) + at(slots.dy, index) * 0.5 + look.lift * unit;
    stillOrSway(tree, x, y, z, motion, wind, height);
    const swing = hangSwing(look.lift, wind, motion, rank);
    writeBox(array, index, x + tree.offset.x + swing.x, y, z + tree.offset.z + swing.z, look.size[0] * unit, look.size[1] * unit, look.size[2] * unit, rank * TAU);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Which colours a blossom opens in: one of the mixed blooms by share, else
 * its strain's spring colours. Colours go by twig cluster, so each spray opens
 * in one colour and a mixed tree reads as sprays of each, not speckle.
 */
function bloomColors(tree: Tree, index: number, colors: TreeColors, node: number): readonly string[] {
  if (tree.blooms.length === 0) return colors.spring;
  const total = tree.blooms.reduce((sum, bloom) => sum + bloom.share, 0);
  // A colour holds for a whole main limb (up to where it leaves the trunk), so each limb opens in one colour.
  let spray = node;
  const { parent, order } = tree.model;
  if (parent && order) {
    for (let up = at(parent, spray); up >= 0 && at(order, up) > 0; up = at(parent, spray)) spray = up;
  }
  let roll = ((hash32(spray * 2246822519 + 7) % 10000) / 10000) * total;
  for (const bloom of tree.blooms) if ((roll -= bloom.share) < 0) return bloom.colors;
  return tree.blooms[tree.blooms.length - 1]?.colors ?? colors.spring;
}

/** How ripe a fruit is, 0 (green) to 1: each sets green and colours at its own pace. A fruit with no green look is ripe as it opens. */
const ripeness = (set: OrnamentSet, index: number, year: YearLike): number =>
  set.look.green === undefined ? 1 : clamp(year.fruit * 1.8 - 0.7 - at(set.slots.rank, index) * 0.3, 0, 1);

export function ornamentColor(tree: Tree, set: OrnamentSet, index: number, year: YearLike): ColorLike {
  const { a, b } = tree;
  const node = at(set.slots.node, index);
  const colors = strainColors(tree, node);
  const skin = strainSkin(tree, node);
  const tone = at(set.slots.tone, index);
  const rank = at(set.slots.rank, index);
  if (set.spec.kind === "blossom") {
    const fade = clamp((year.petals - rank + 0.25) * 3, 0, 1);
    const petals = bloomColors(tree, index, colors, node);
    // A spray takes one tone for its whole twig, a touch richer: its own shape carries the light and shade.
    const own = set.spray ? clumpOf(tree, node) % petals.length : tone % petals.length;
    a.set(petals[own] ?? "#f6bacb");
    if (set.spray) a.offsetHSL(0, 0.16, -0.06);
    a.lerp(b.set("#fff4f6"), fade * 0.6);
  } else {
    const palette = set.look.colors ?? ["#ffffff"];
    a.set(palette[tone % palette.length] ?? "#ffffff");
    // Fruit sets green and ripens to colour, each one at its own pace.
    if (set.look.green !== undefined) a.lerp(b.set(set.look.green), 1 - ripeness(set, index, year));
  }
  // A skinned tree's flowers and fruit take its material: a golden tree bears golden cherries.
  // With `clumps` fruit keeps most of its own colour, so a red apple still reads on a golden crown.
  const worn = set.name === "fruit" && tree.features.clumps ? 0.2 : 0.82;
  if (skin) a.lerp(b.set(skin.leaves[(index + 1) % skin.leaves.length] ?? "#ffffff"), worn);
  return a;
}

export function paintOrnaments(tree: Tree, set: OrnamentSet, year: YearLike): void {
  for (let index = 0; index < set.slots.count; index += set.thin) set.mesh.setColorAt(index, ornamentColor(tree, set, index, year));
  if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
}

// What lies under the tree and what falls to it: leaf and fruit litter, snow on the limbs, and the fallers.

import type { InstancedLike, SlotsLike, TreeFrameLike, YearLike } from "../inputs.js";
import { TAU, at, clamp } from "../math.js";
import { clearSlot, writeBlade, writeBox, writeSlab, writeVoxel } from "../instances.js";
import { bearingNode, leafTipLimit, leafyNode, ornamentState } from "./tree.js";
import type { Faller, OrnamentSet, Tree, TreeMotion } from "./tree.js";
import { eatenSlot, ornamentColor, stillOrSway } from "./ornaments.js";

// ---------------------------------------------------------------- litter

/** Where a fallen leaf from `index` lies: under its twig, scattered by the drop, kept on the ground. */
export function litterSpot(
  tree: Tree,
  frame: TreeFrameLike,
  slots: SlotsLike,
  index: number,
  scatterScale: number,
): { x: number; z: number } {
  const node = at(slots.node, index);
  const scatter = (1.4 + at(slots.size, index) * 1.6) * scatterScale;
  let x = at(frame.x, node) + at(slots.dx, index) * scatter + (at(slots.rank, index) - 0.5) * 0.9 * scatterScale;
  let z = at(frame.z, node) + at(slots.dz, index) * scatter + (at(slots.size, index) - 1) * 1.6 * scatterScale;
  const reach = Math.hypot(x, z);
  const lip = tree.ground.lip?.(Math.atan2(z, x));
  const limit = lip === undefined ? tree.ground.radius : Math.min(tree.ground.radius, lip - 0.3);
  if (reach > limit) {
    x *= limit / reach;
    z *= limit / reach;
  }
  return { x, z };
}

function poseLeafLitter(
  tree: Tree,
  mesh: InstancedLike,
  frame: TreeFrameLike,
  year: YearLike,
  motion: TreeMotion,
): void {
  const { model, leafStride, ground } = tree;
  const array = mesh.instanceMatrix.array;
  // Only twigs that carry leaves this year drop them: a sapling has few, and an
  // old tree's dead or shed limbs have none.
  const tipLimit = leafTipLimit(tree);
  const seedling = frame.visible <= 4;
  for (let slot = 0; slot < tree.limits.litter; slot += 1) {
    const index = slot * leafStride;
    const node = at(model.leaves.node, index);
    const bore =
      index < model.leaves.count &&
      motion.dead !== true &&
      at(frame.grow, node) > 0 &&
      (seedling || leafyNode(frame, node, tipLimit));
    if (!bore || motion.snowed === true || at(model.leaves.rank, index) >= year.litter) {
      clearSlot(array, slot);
      continue;
    }
    const spot = litterSpot(tree, frame, model.leaves, index, 1);
    const lie = at(model.leaves.rank, index) * 31;
    const y = ground.y + 0.015 + (slot % 3) * 0.006;
    const size = tree.colors.leafScale * at(model.leaves.size, index);
    // A fallen blade lies flat along a random heading, a little curled.
    if (tree.blades)
      writeBlade(array, slot, [spot.x, y, spot.z], [Math.cos(lie), 0, Math.sin(lie)], size * 1.9, {
        droop: 0,
        twist: 0.25 * Math.sin(lie * 3),
        nod: 0,
      });
    else writeVoxel(array, slot, spot.x, y, spot.z, size, lie, 0.22);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function ornamentsLying(set: OrnamentSet, year: YearLike, motion: TreeMotion): boolean {
  const { open, fallen } = ornamentState(set, year);
  if (set.look.fall <= 0 || fallen <= 0 || open <= 0 || motion.snowed === true) return false;
  return set.name === "fruit" || fallen < 1 || year.leaf < 0.9;
}

export function soundBearer(set: OrnamentSet, frame: TreeFrameLike, index: number): boolean {
  const node = at(set.slots.node, index);
  return (
    index < set.slots.count && at(frame.grow, node) > 0.25 && at(frame.dead, node) < 0.25 && at(frame.fall, node) === 0
  );
}

/** Dropped flowers and fruit under the tree: petals until the leaves are out, fruit until spring. */
function poseOrnamentLitter(
  tree: Tree,
  set: OrnamentSet,
  frame: TreeFrameLike,
  year: YearLike,
  motion: TreeMotion,
  array: Float32Array,
): void {
  const { fallen } = ornamentState(set, year);
  const look = set.look;
  const lying = ornamentsLying(set, year, motion);
  for (let slot = 0; slot < set.litterLimit; slot += 1) {
    const index = slot * set.stride;
    const target = set.litterStart + slot;
    if (
      !lying ||
      !soundBearer(set, frame, index) ||
      at(set.slots.rank, index) >= fallen ||
      eatenSlot(tree, set, index)
    ) {
      clearSlot(array, target);
      continue;
    }
    const spot = litterSpot(tree, frame, set.slots, index, set.name === "fruit" ? 0.45 : 1);
    const unit = tree.colors.leafScale * at(set.slots.size, index);
    const flat = set.name === "fruit" ? 1 : 0.2;
    writeBox(
      array,
      target,
      spot.x,
      tree.ground.y + 0.02 + unit * look.size[2] * 0.5 * flat,
      spot.z,
      look.size[0] * unit,
      look.size[2] * unit * flat,
      look.size[1] * unit,
      at(set.slots.rank, index) * 17,
    );
  }
}

export function poseLitter(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const { leafLitter, litter } = tree.meshes;
  if (leafLitter) poseLeafLitter(tree, leafLitter, frame, year, motion);
  if (!litter) return;
  const array = litter.instanceMatrix.array;
  for (const set of [tree.flowers, tree.fruits]) if (set) poseOrnamentLitter(tree, set, frame, year, motion, array);
  litter.instanceMatrix.needsUpdate = true;
}

export function paintLitter(tree: Tree, year: YearLike): void {
  const { model, meshes, a, b, colors, leafStride } = tree;
  const leafLitter = meshes.leafLitter;
  if (leafLitter) {
    for (let slot = 0; slot < tree.limits.litter; slot += 1) {
      const index = Math.min(slot * leafStride, Math.max(model.leaves.count - 1, 0));
      const tone = at(model.leaves.tone, index);
      // Old litter browns as it rots into the turf.
      const age = year.drop <= 0 ? 1 : clamp((year.drop - at(model.leaves.rank, index)) * 2, 0, 1);
      if (tree.skin) a.set(tree.skin.leaves[tone % 3] ?? "#ffffff").multiplyScalar(0.85);
      else a.set(colors.autumn[tone] ?? "#cf6b4e").lerp(b.set("#7a5a3c"), 0.25 + age * 0.5);
      leafLitter.setColorAt(slot, a);
    }
    if (leafLitter.instanceColor) leafLitter.instanceColor.needsUpdate = true;
  }
  if (meshes.litter) paintOrnamentLitter(tree, meshes.litter);
}

function paintOrnamentLitter(tree: Tree, mesh: InstancedLike): void {
  const { a, b, colors } = tree;
  for (const set of [tree.flowers, tree.fruits]) {
    if (!set) continue;
    const palette = set.look.colors ?? colors.spring;
    for (let slot = 0; slot < set.litterLimit; slot += 1) {
      if (set.spec.kind === "blossom") a.set(colors.spring[slot % colors.spring.length] ?? "#f6bacb");
      else a.set(palette[slot % palette.length] ?? "#ffffff").lerp(b.set("#6b5038"), set.name === "fruit" ? 0.15 : 0.35);
      if (tree.skin) a.lerp(b.set(tree.skin.leaves[(slot + 1) % tree.skin.leaves.length] ?? "#ffffff"), 0.82).multiplyScalar(0.85);
      mesh.setColorAt(set.litterStart + slot, a);
    }
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- snow on the limbs

/** Snow settles in a thin slab along the top of every limb that is not too steep, sloping as the limb does. */
export function poseSnow(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, motion: TreeMotion): void {
  const cover = motion.snow ?? 0;
  mesh.visible = cover > 0;
  if (!mesh.visible) return;
  const array = mesh.instanceMatrix.array;
  const height = Math.max(frame.height, 0.5);
  const wind = tree.features.sway ? motion.wind : 0;
  for (let node = 0; node < tree.model.count; node += 1) {
    const radius = at(frame.radius, node);
    const dx = at(frame.x, node) - at(frame.baseX, node);
    const dy = at(frame.y, node) - at(frame.baseY, node);
    const dz = at(frame.z, node) - at(frame.baseZ, node);
    const level = Math.hypot(dx, dz);
    if (at(frame.grow, node) < 1 || radius < 0.035 || at(frame.rot, node) > 0.5 || level < Math.abs(dy) * 0.7) { clearSlot(array, node);
    continue; }
    const depth = (0.03 + radius * 0.35) * cover;
    const mx = (at(frame.x, node) + at(frame.baseX, node)) / 2;
    const my = (at(frame.y, node) + at(frame.baseY, node)) / 2;
    const mz = (at(frame.z, node) + at(frame.baseZ, node)) / 2;
    stillOrSway(tree, mx, my, mz, motion, at(frame.fall, node) > 0 ? 0 : wind, height);
    writeSlab(
      array,
      node,
      mx + tree.offset.x,
      my,
      mz + tree.offset.z,
      dx,
      dy,
      dz,
      radius,
      radius * 2.1,
      depth,
      Math.hypot(level, dy) + radius,
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- falling leaves, petals and fruit

interface FallSource {
  readonly slots: SlotsLike;
  readonly front: number;
  readonly ok: (index: number) => boolean;
  readonly key: (index: number) => string;
  readonly shape: (index: number) => readonly [number, number, number];
  readonly color: (index: number) => string;
  readonly fall: number;
}

// Leaves, petals and fruit that fall are the tree's own: the next ones due to
// drop leave their twig, tumble (or plummet) down, and lie where they land.
function fallSource(tree: Tree, frame: TreeFrameLike, year: YearLike, kind: Faller["kind"]): FallSource | null {
  const { model } = tree;
  if (kind === "leaf") {
    const tipLimit = leafTipLimit(tree);
    const leaves = model.leaves;
    return {
      slots: leaves, front: year.drop, fall: 0.8,
      ok: (index) => leafyNode(frame, at(leaves.node, index), tipLimit),
      key: (index) => `leaf:${String(index)}`,
      shape: (index) => [at(leaves.size, index), at(leaves.size, index), at(leaves.size, index)],
      color: (index) => (tree.skin ? tree.skin.leaves[at(leaves.tone, index) % 3] : tree.colors.autumn[at(leaves.tone, index)]) ?? "#cf6b4e",
    };
  }
  const set = kind === "fruit" ? tree.fruits : tree.flowers;
  if (!set) return null;
  const { open, fallen } = ornamentState(set, year);
  return {
    slots: set.slots,
    front: fallen,
    fall: set.look.fall,
    ok: (index) => at(set.slots.rank, index) < open && bearingNode(tree, frame, set.spec, at(set.slots.node, index)),
    key: (index) => `${set.name}:${String(index)}`,
    shape: (index) => [
      set.look.size[0] * at(set.slots.size, index),
      set.look.size[1] * at(set.slots.size, index),
      set.look.size[2] * at(set.slots.size, index),
    ],
    color: (index) => `#${ornamentColor(tree, set, index, year).getHexString()}`,
  };
}

function spawnFaller(tree: Tree, frame: TreeFrameLike, year: YearLike, kind: Faller["kind"]): Faller | null {
  const source = fallSource(tree, frame, year, kind);
  if (!source) return null;
  const { slots } = source;
  const random = tree.random;
  for (let attempt = 0; attempt < 16 && slots.count > 0; attempt += 1) {
    const index = Math.floor(random() * slots.count);
    const rank = at(slots.rank, index);
    const key = source.key(index);
    if (rank < source.front || rank > source.front + 0.08 || tree.hidden.has(key) || !source.ok(index)) continue;
    const node = at(slots.node, index);
    tree.hidden.set(key, { rank, kind, index });
    tree.hiddenSlots[kind].add(index);
    const [sx, sy, sz] = source.shape(index);
    const unit = tree.colors.leafScale;
    return {
      key,
      kind,
      speed: source.fall,
      landed: false,
      color: source.color(index),
      x: at(frame.x, node) + at(slots.dx, index),
      y: at(frame.y, node) + at(slots.dy, index) * 0.5,
      z: at(frame.z, node) + at(slots.dz, index),
      vx: (random() - 0.5) * 0.3,
      vz: (random() - 0.5) * 0.3,
      phase: random() * TAU,
      size: [sx * unit, sy * unit, sz * unit],
    };
  }
  return null;
}

/** How fast each kind is falling right now (spawns per second). */
function fallRates(tree: Tree, year: YearLike, dead: boolean): Record<Faller["kind"], number> {
  if (dead) return { leaf: 0, flowers: 0, fruit: 0 };
  const dropMax = tree.model.species.phenology.dropMax;
  const rate = (set: OrnamentSet | null, per: number): number => {
    if (!set || set.look.fall <= 0) return 0;
    const { open, fallen } = ornamentState(set, year);
    return fallen > 0.005 && fallen < 0.995 && open > 0.5 ? per : 0;
  };
  return {
    leaf: year.drop > 0.005 && year.drop < dropMax - 0.005 && tree.features.leaves ? 3.2 : 0,
    flowers: rate(tree.flowers, 4),
    fruit: rate(tree.fruits, 1.2),
  };
}

function fallFront(tree: Tree, year: YearLike, kind: Faller["kind"]): number {
  if (kind === "leaf") return year.drop;
  const set = kind === "fruit" ? tree.fruits : tree.flowers;
  return set ? ornamentState(set, year).fallen : 1;
}

function moveFaller(tree: Tree, faller: Faller, elapsed: number, delta: number, wind: number, dir = 0): void {
  if (faller.landed) return;
  // Heavy fruit drops nearly straight; leaves and petals flutter and drift downwind.
  const drift = faller.speed > 1.5 ? 0.15 : 1;
  const flutter = Math.sin(elapsed * 2.4 + faller.phase);
  const side = Math.cos(elapsed * 1.7 + faller.phase) * 0.3;
  const push = wind * 1.4 + flutter * 0.2;
  faller.vx += ((push * Math.cos(dir) - side * Math.sin(dir)) * drift - faller.vx) * delta;
  faller.vz += ((push * Math.sin(dir) + side * Math.cos(dir)) * drift - faller.vz) * delta;
  faller.x += faller.vx * delta;
  faller.z += faller.vz * delta;
  faller.y -= delta * faller.speed * (drift < 1 ? 1 : 0.7 + 0.3 * Math.abs(flutter));
  const limit = tree.ground.radius + 1;
  const reach = Math.hypot(faller.x, faller.z);
  if (reach > limit) { faller.x *= limit / reach;
  faller.z *= limit / reach; }
  if (faller.y <= tree.ground.y + 0.02) { faller.y = tree.ground.y + 0.02;
  faller.landed = true; }
}

export function spawnFallers(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const rates = fallRates(tree, year, motion.dead === true);
  const total = rates.leaf + rates.flowers + rates.fruit;
  tree.spawnClock += (motion.delta ?? 0) * total * (1 + motion.wind * 2);
  while (tree.spawnClock >= 1 && total > 0) {
    tree.spawnClock -= 1;
    let pick = tree.random() * total;
    const kind: Faller["kind"] = (pick -= rates.leaf) < 0 ? "leaf" : (pick -= rates.flowers) < 0 ? "flowers" : "fruit";
    const faller = spawnFaller(tree, frame, year, kind);
    if (faller === null) continue;
    if (tree.fallers.length >= tree.limits.falling) tree.fallers.shift();
    tree.fallers.push(faller);
  }
  for (const [key, held] of tree.hidden) {
    if (held.rank >= fallFront(tree, year, held.kind)) continue;
    tree.hidden.delete(key);
    tree.hiddenSlots[held.kind].delete(held.index);
  }
}

function drawFaller(tree: Tree, faller: Faller, slot: number, mesh: InstancedLike, elapsed: number): void {
  const spin = faller.landed ? faller.phase : elapsed * (faller.speed > 1.5 ? 0.6 : 2.2) + faller.phase;
  const [sx, sy, sz] = faller.size;
  const array = mesh.instanceMatrix.array;
  if (tree.blades && faller.kind === "leaf") {
    // A falling blade tumbles end over end and side to side, then lies flat.
    const tumble = faller.landed ? 0 : Math.sin(spin * 0.8) * 0.9;
    writeBlade(array, slot, [faller.x, faller.y, faller.z], [Math.cos(spin), tumble, Math.sin(spin)], sx * 1.9, {
      droop: 0,
      twist: faller.landed ? 0.2 : spin * 1.3,
      nod: 0,
    });
  } else {
    const flat = faller.landed && faller.speed <= 1.5 ? 0.22 : 1;
    writeBox(array, slot, faller.x, faller.y, faller.z, sx, sy * flat, sz, spin);
  }
  mesh.setColorAt(slot, tree.a.set(faller.color));
}

export function drawFallers(
  tree: Tree,
  falling: InstancedLike,
  fallingLeaves: InstancedLike,
  motion: TreeMotion,
): void {
  const array = falling.instanceMatrix.array;
  const leafArray = fallingLeaves.instanceMatrix.array;
  for (let slot = 0; slot < tree.limits.falling; slot += 1) {
    const faller = tree.fallers[slot];
    clearSlot(array, slot);
    clearSlot(leafArray, slot);
    if (faller === undefined) continue;
    moveFaller(tree, faller, motion.elapsed, motion.delta ?? 0, motion.wind, motion.windDir);
    drawFaller(tree, faller, slot, tree.blades && faller.kind === "leaf" ? fallingLeaves : falling, motion.elapsed);
  }
  for (const mesh of [falling, fallingLeaves]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

// Leaves: blades, fronds, sprigs and lumps on their nodes, drifting in the wind, in the season's colours.

import type {
  ColorLike, InstancedLike, SlotsLike, TreeColors, TreeFrameLike, TreeModelLike, TreeSkin, YearLike,
} from "../inputs.js";
import { TAU, at, clamp } from "../math.js";
import { leafFlutter, sway } from "../wind.js";
import { UP, clearSlot, cross3, isZero, norm3, writeBlade, writeVoxel } from "../instances.js";
import type { V3 } from "../instances.js";
import { leafTipLimit, leafyNode } from "./tree.js";
import type { Tree, TreeMotion } from "./tree.js";
import { clumpOf, needleLeaf, strainAt, strainColors, strainDrop, strainSkin, strainYear } from "./wood.js";

// ---------------------------------------------------------------- leaves

interface LeafPass {
  readonly array: Float32Array;
  readonly height: number;
  readonly size: number;
  readonly spread: number;
  readonly bare: boolean;
  readonly wind: number;
  /** The wind the sway field moves leaves by (`wind` × the motion's `field`). */
  readonly field: number;
  readonly dir: number;
  readonly elapsed: number;
}

/**
 * The sway field's offset for a leaf at (x, y, z), into `tree.offset`. A host
 * that moves the tree itself (`field: 0`) gets none at all: the wood is already
 * where keel/tree-mechanics put it, and the field's idle breathing would only
 * float the leaves off their twigs (and cost a sway per leaf per frame).
 */
function drift(tree: Tree, pass: LeafPass, x: number, y: number, z: number): void {
  if (tree.still) { tree.offset.x = 0; tree.offset.z = 0; return; }
  sway(tree.offset, x, y, z, pass.elapsed, pass.field, pass.height, pass.dir);
}

/** How far downwind a point is, so a gust reaches it in turn. */
const downwind = (pass: LeafPass, x: number, z: number): number => x * Math.cos(pass.dir) + z * Math.sin(pass.dir);

/** A blade grows from its twig: the stalk sits on the twig and the blade points out along its slot, so no leaf hangs in the air. */
function poseBlade(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  if (tree.fronds) {
    poseLeaflet(tree, tree.fronds, frame, index, pass, leafSize, swing);
    return;
  }
  if (needleLeaf(tree, at(tree.model.leaves.node, index))) {
    poseSprig(tree, frame, index, pass, leafSize, swing);
    return;
  }
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const dx = at(slots.dx, index), dy = at(slots.dy, index), dz = at(slots.dz, index);
  const reach = Math.hypot(dx, dy, dz) * pass.spread;
  const out = Math.min(reach * 0.3, 0.22);
  const scale = reach / pass.spread || 1;
  // A weeping strain's leaves hang straight down in long strands, so its limbs read as a curtain on any tree.
  const weeps = (strainAt(tree, node)?.hang ?? 0) > 0;
  const n: [number, number, number] = weeps ? [dx / scale * 0.25, -1, dz / scale * 0.25] : [dx / scale, dy / scale, dz / scale];
  // Strands start out past the host's foliage, so a willow limb in a pine hangs clear of the needles.
  const clear = weeps ? 0.55 : 0;
  const x = at(frame.x, node) + n[0] * out + (dx / scale) * clear;
  const y = at(frame.y, node) + n[1] * out - strainDrop(tree, node, index);
  const z = at(frame.z, node) + n[2] * out + (dz / scale) * clear;
  drift(tree, pass, x, y, z);
  // A blade is thinner than a leaf lump, so it is drawn longer to fill the crown as fully.
  const motion = leafFlutter(pass.elapsed, pass.wind, at(slots.rank, index), at(tree.model.phase, node), downwind(pass, x, z));
  writeBlade(pass.array, index, [x + tree.offset.x + swing, y, z + tree.offset.z + swing * 0.4], n, leafSize * (weeps ? 1.5 : 1.9), motion, weeps ? 2.4 : 1);
}

/**
 * A palm frond as its leaflets: two even rows down the rachis, one each side,
 * short at the frond's base, longest a third of the way out and short again at
 * its tip. Per leaflet: how far along its internode it grows, which side, and
 * how far out along the whole frond that is.
 */
export interface FrondLayout { readonly along: Float32Array; readonly side: Float32Array; readonly out: Float32Array; readonly pieces: Float32Array }

/** Each frond internode's place along its frond (counted from the crown), its frond's first internode, and each frond's length in internodes. */
function frondDepths(model: TreeModelLike, parent: ArrayLike<number>, order: ArrayLike<number>): { depth: Float32Array; base: Int32Array; pieces: Float32Array } {
  const depth = new Float32Array(model.count);
  const base = new Int32Array(model.count).fill(-1);
  const pieces = new Float32Array(model.count);
  for (let node = 0; node < model.count; node += 1) {
    const up = at(parent, node);
    if (at(order, node) === 0) continue;
    const fromTrunk = up < 0 || at(order, up) === 0;
    depth[node] = fromTrunk ? 0 : at(depth, up) + 1;
    base[node] = fromTrunk ? node : at(base, up);
    const root = at(base, node);
    pieces[root] = Math.max(at(pieces, root), at(depth, node) + 1);
  }
  return { depth, base, pieces };
}

export function frondLayout(model: TreeModelLike): FrondLayout | null {
  const { parent, order } = model;
  if (!model.species.palm || !parent || !order) return null;
  const { depth, base, pieces } = frondDepths(model, parent, order);
  const slots = model.leaves;
  const layout: FrondLayout = { along: new Float32Array(slots.count), side: new Float32Array(slots.count), out: new Float32Array(slots.count), pieces: new Float32Array(slots.count) };
  let first = 0;
  for (let index = 1; index <= slots.count; index += 1) {
    if (index < slots.count && at(slots.node, index) === at(slots.node, first)) continue;
    const node = at(slots.node, first);
    const length = Math.max(1, at(pieces, Math.max(0, at(base, node))));
    const pairs = Math.ceil((index - first) / 2);
    for (let k = 0; k < index - first; k += 1) {
      const along = (Math.floor(k / 2) + 0.5 + (k % 2) * 0.2) / pairs;
      layout.along[first + k] = along;
      layout.side[first + k] = k % 2 === 0 ? 1 : -1;
      layout.out[first + k] = (at(depth, node) + along) / length;
      layout.pieces[first + k] = length;
    }
    first = index;
  }
  return layout;
}

/** One leaflet off its rachis: angled toward the frond's tip, dropping into a V, the outer ones drooping most, all of them shivering in the wind. */
function poseLeaflet(tree: Tree, fronds: FrondLayout, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const tip: V3 = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
  const base: V3 = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
  const t = at(fronds.along, index);
  const p: V3 = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
  let fw: V3 = norm3(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  if (isZero(fw)) fw = UP;
  let side: V3 = norm3(...cross3(fw, UP));
  if (isZero(side)) side = [1, 0, 0];
  const down: V3 = norm3(...cross3(fw, side));
  const s = at(fronds.out, index);
  const sign = at(fronds.side, index);
  const rank = at(slots.rank, index);
  const shiver = pass.wind * 0.35 * Math.sin(pass.elapsed * (6 + rank * 3) + rank * 40 + downwind(pass, p[0], p[2]) * 0.8);
  const forward = 0.5 + 0.15 * s;
  const vee = 0.3 + 0.45 * s + shiver * 0.5;
  const n: V3 = [
    sign * side[0] * Math.cos(forward) + fw[0] * Math.sin(forward) + down[0] * vee,
    sign * side[1] * Math.cos(forward) + fw[1] * Math.sin(forward) + down[1] * vee,
    sign * side[2] * Math.cos(forward) + fw[2] * Math.sin(forward) + down[2] * vee,
  ];
  // Leaflets reach a third of the frond's length at most, less toward its ends.
  const piece = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  const frond = piece * at(fronds.pieces, index);
  const profile = Math.sin(Math.PI * (0.08 + 0.88 * s)) ** 0.7;
  const grown = clamp(leafSize / Math.max(pass.size, 1e-6), 0, 1.4);
  const length = frond * 0.3 * (0.25 + 0.75 * profile) * grown * (0.85 + 0.3 * at(slots.size, index));
  drift(tree, pass, p[0], p[1], p[2]);
  writeBlade(pass.array, index, [p[0] + tree.offset.x + swing, p[1], p[2] + tree.offset.z + swing * 0.4], norm3(...n), length, { droop: 0.04, twist: sign * 0.35 + shiver * 0.6, nod: 0 });
}

/** Where a conifer sprig sits: somewhere along its twig, pointing the way the twig grows, a little off it. */
export function sprigPlace(frame: TreeFrameLike, slots: TreeModelLike["leaves"], index: number): { p: V3; n: V3 } {
  const node = at(slots.node, index);
  const tip: V3 = [at(frame.x, node), at(frame.y, node), at(frame.z, node)];
  const base: V3 = [at(frame.baseX, node), at(frame.baseY, node), at(frame.baseZ, node)];
  const rank = at(slots.rank, index);
  const along = 0.15 + 0.7 * ((rank * 7.31) % 1);
  const jitter = 0.35;
  let n: V3 = norm3(tip[0] - base[0] + at(slots.dx, index) * jitter, tip[1] - base[1] + at(slots.dy, index) * jitter, tip[2] - base[2] + at(slots.dz, index) * jitter);
  if (isZero(n)) n = UP;
  return { p: [base[0] + (tip[0] - base[0]) * along, base[1] + (tip[1] - base[1]) * along, base[2] + (tip[2] - base[2]) * along], n };
}

/** A sprig is stiff: it only rocks a little in the wind and turns on its twig, it does not droop like a leaf. */
function poseSprig(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const { p, n } = sprigPlace(frame, slots, index);
  drift(tree, pass, p[0], p[1], p[2]);
  const motion = leafFlutter(pass.elapsed, pass.wind, at(slots.rank, index), at(tree.model.phase, node), downwind(pass, p[0], p[2]));
  const stiff = { droop: motion.droop * 0.12, twist: at(slots.rank, index) * TAU + motion.twist * 0.2, nod: motion.nod * 0.3 };
  writeBlade(pass.array, index, [p[0] + tree.offset.x + swing * 0.3, p[1], p[2] + tree.offset.z + swing * 0.12], n, leafSize * 1.9, stiff);
}

function poseLump(tree: Tree, frame: TreeFrameLike, index: number, pass: LeafPass, leafSize: number, swing: number): void {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const rank = at(slots.rank, index);
  const x = at(frame.x, node) + at(slots.dx, index) * pass.spread;
  const y = at(frame.y, node) + at(slots.dy, index) * pass.spread - strainDrop(tree, node, index);
  const z = at(frame.z, node) + at(slots.dz, index) * pass.spread;
  drift(tree, pass, x, y, z);
  const flutter = pass.wind * 0.012 * Math.sin(pass.elapsed * 6.3 + rank * 40);
  const fx = flutter * Math.cos(pass.dir);
  const fz = flutter * Math.sin(pass.dir);
  writeVoxel(pass.array, index, x + tree.offset.x + fx + swing * Math.cos(pass.dir), y + flutter * 0.4, z + tree.offset.z + fz + swing * Math.sin(pass.dir), leafSize, rank * TAU + flutter * 6);
}

function leafShows(tree: Tree, frame: TreeFrameLike, year: YearLike, index: number, leafy: boolean): boolean {
  const slots = tree.model.leaves;
  return leafy && at(frame.grow, at(slots.node, index)) > 0 && at(slots.rank, index) >= year.drop && !tree.hiddenSlots.leaf.has(index);
}

/**
 * How much bigger a young tree's leaves draw. With `clumps` a seedling's first
 * leaves come nearly twice the size, easing back to life size as the crown
 * fills in, so a tree a year or two old reads as a sprout and not a speck.
 */
function youngLeaf(tree: Tree, frame: TreeFrameLike): number {
  if (!tree.features.clumps) return frame.visible <= 4 ? 0.8 : 1;
  return 1 + 0.9 * clamp(1 - (frame.visible - 4) / 90, 0, 1);
}

function leafPass(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): LeafPass {
  const bare = year.leaf <= 0;
  // A grand tree is bigger than life but has the same twigs, so each clump fills more of its crown.
  const grand = Math.max(1, frame.scale ?? 1) ** 0.75;
  return {
    array: mesh.instanceMatrix.array, height: Math.max(frame.height, 0.5), bare,
    size: tree.colors.leafScale * youngLeaf(tree, frame) * (tree.skin?.leafSize ?? 1) * grand,
    spread: (bare ? 0.15 : 0.35 + 0.65 * year.leaf) * grand, wind: tree.features.sway ? motion.wind : 0, dir: motion.windDir ?? 0, elapsed: motion.elapsed,
    field: tree.features.sway ? motion.wind * (motion.field ?? 1) : 0,
  };
}

/**
 * How far into full blossom the tree is (the `sprays` look), 0..1: in full bloom a
 * blossom tree's new leaves stay small, so the crown reads as a pink cloud with
 * green only as an accent, then grow as the petals fall.
 */
const floweringOf = (tree: Tree, year: YearLike): number =>
  tree.features.sprays && tree.flowers?.spray === true ? clamp(year.bloom * 1.6, 0, 1) * (1 - clamp(year.petals * 1.2, 0, 1)) : 0;
const leafHush = (tree: Tree, node: number, flowering: number): number => (flowering > 0 && strainColors(tree, node).blossom === true ? 1 - 0.55 * flowering : 1);

export function poseLeaves(
  tree: Tree,
  mesh: InstancedLike,
  frame: TreeFrameLike,
  year: YearLike,
  motion: TreeMotion,
): void {
  const { model } = tree;
  const slots = model.leaves;
  const seedling = frame.visible <= 4;
  const tipLimit = leafTipLimit(tree);
  const bare = year.leaf <= 0;
  if (motion.dead === true) { for (let index = 0; index < slots.count; index += 1) clearSlot(mesh.instanceMatrix.array, index); mesh.instanceMatrix.needsUpdate = true; return; }
  const pass = leafPass(tree, mesh, frame, year, motion);
  const flowering = floweringOf(tree, year);
  for (let index = 0; index < slots.count; index += 1) {
    const node = at(slots.node, index);
    // In winter only a few closed buds show; the rest of the twig is bare.
    const own = strainYear(tree, node, year);
    const resting = own.leaf <= 0;
    if (!leafShows(tree, frame, own, index, seedling || leafyNode(frame, node, tipLimit)) || (resting && index % 4 !== 0)) { clearSlot(pass.array, index); continue; }
    const leafSize = resting ? pass.size * 0.24 : pass.size * leafHush(tree, node, flowering) * at(slots.size, index) * (0.2 + 0.8 * own.leaf) * (0.45 + 0.55 * at(frame.grow, node));
    // Hanging strands swing from their twig: the lower the leaf, the wider the swing.
    const swing = Math.max(0, -at(slots.dy, index)) * pass.wind * 0.35 * Math.sin(pass.elapsed * 1.4 + at(model.phase, node));
    if (tree.blades) poseBlade(tree, frame, index, pass, leafSize, swing);
    else poseLump(tree, frame, index, pass, leafSize, swing);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * How lit each leaf is by its place in the crown: leaves deep inside and low
 * down sit in the crown's own shade, the outer and upper ones catch the light,
 * and each varies a little on its own. Without it a crown is one flat colour.
 */
export function crownShade(frame: TreeFrameLike, slots: SlotsLike, jitter?: (index: number) => number): Float32Array {
  const shade = new Float32Array(slots.count).fill(1);
  const live: number[] = [];
  for (let index = 0; index < slots.count; index += 1) if (at(frame.grow, at(slots.node, index)) > 0) live.push(index);
  if (live.length === 0) return shade;
  const place = (index: number): [number, number, number] => {
    const node = at(slots.node, index);
    return [at(frame.x, node) + at(slots.dx, index), at(frame.y, node) + at(slots.dy, index), at(frame.z, node) + at(slots.dz, index)];
  };
  const centre = live.reduce<[number, number, number]>((sum, index) => {
    const node = at(slots.node, index);
    return [sum[0] + at(frame.x, node) / live.length, sum[1] + at(frame.y, node) / live.length, sum[2] + at(frame.z, node) / live.length];
  }, [0, 0, 0]);
  const outward = (index: number): number => { const p = place(index); return Math.hypot(p[0] - centre[0], p[2] - centre[2], (p[1] - centre[1]) * 1.3); };
  const heights = live.map((index) => at(frame.y, at(slots.node, index)));
  const low = Math.min(...heights), high = Math.max(...heights);
  const reach = Math.max(0.001, ...live.map(outward));
  for (let index = 0; index < slots.count; index += 1) {
    const up = clamp((at(frame.y, at(slots.node, index)) - low) / Math.max(high - low, 0.5), 0, 1);
    shade[index] = (0.55 + 0.5 * clamp(outward(index) / reach, 0, 1) ** 0.8) * (0.85 + 0.25 * up) * (0.9 + 0.2 * (jitter ? jitter(index) : at(slots.rank, index)));
  }
  return shade;
}

/** A skinned crown: the material's colours, with a little drift per leaf so it still has depth. */
function skinLeafColor(tree: Tree, skin: TreeSkin, frame: TreeFrameLike, index: number): ColorLike {
  const slots = tree.model.leaves;
  const rank = at(slots.rank, index);
  const dead = at(frame.dead, at(slots.node, index));
  tree.a.set(skin.leaves[at(slots.tone, index) % 3] ?? "#ffffff").offsetHSL(((rank * 7.3) % 1 - 0.5) * 0.04, 0, ((rank * 3.1) % 1 - 0.5) * 0.1);
  if (dead > 0.05) tree.a.lerp(tree.b.set("#6e6a66"), clamp(dead * 3, 0, 0.8));
  return tree.a;
}

/** Spring flush and the autumn turn: old needles of an evergreen never turn. */
function seasonLeafColor(tree: Tree, year: YearLike, tone: number, rank: number, colors: TreeColors, turnRank: number): ColorLike {
  const { model, a, b } = tree;
  a.set(colors.leaves[tone] ?? "#6c9a54");
  if (year.flush > 0) a.lerp(b.set((colors.blossom === true ? colors.leaves[2] : colors.spring[tone]) ?? "#a6ce6f"), year.flush * 0.7);
  const oldNeedles = model.species.evergreen ? model.species.phenology.dropMax * 1.4 : 2;
  // `turnRank` is the leaf's own rank, or its clump's: a clump turns together, so autumn comes in patches.
  const turn = rank < oldNeedles ? clamp(year.color * 1.5 - turnRank * 0.5, 0, 1) : 0;
  if (turn > 0) a.lerp(b.set(colors.autumn[(tone + Math.floor(turnRank * 3)) % colors.autumn.length] ?? "#cf6b4e"), turn);
  if (year.withered) a.set(colors.autumn[tone] ?? "#cf6b4e").lerp(b.set("#7d5c3a"), 0.6);
  return a;
}

/** A hybrid's minor kind under the tree's skin keeps a share of its own leaf colour (`clumps`), so an oak limb on an ember cherry still reads as its own section. */
function skinnedLeafColor(tree: Tree, skin: TreeSkin, frame: TreeFrameLike, year: YearLike, index: number, colors: TreeColors): ColorLike {
  const slots = tree.model.leaves;
  const node = at(slots.node, index);
  const kind = tree.features.clumps && year.leaf > 0 ? strainAt(tree, node) : undefined;
  if (kind?.species === undefined || kind.colors === undefined) return skinLeafColor(tree, skin, frame, index);
  const rank = at(slots.rank, index);
  tree.c.copy(seasonLeafColor(tree, year, clumpOf(tree, node) % 3, rank, colors, rank));
  return skinLeafColor(tree, skin, frame, index).lerp(tree.c, 0.45);
}

/** A leaf's season colour: by its own tone and rank, or (`clumps`) its clump's, with the odd leaf catching the light in the palest tone; a clump turns in autumn together. */
function leafSeasonColor(tree: Tree, year: YearLike, index: number, colors: TreeColors): ColorLike {
  const slots = tree.model.leaves;
  const rank = at(slots.rank, index);
  if (!tree.features.clumps) return seasonLeafColor(tree, year, at(slots.tone, index), rank, colors, rank);
  const clump = clumpOf(tree, at(slots.node, index));
  return seasonLeafColor(tree, year, index % 11 === 0 ? 2 : clump % 3, rank, colors, (((clump >>> 8) % 1000) / 1000) * 0.7 + rank * 0.3);
}

/** One leaf's colour for the year: bud, flush, turn, withered, dying, snow on needles. */
function leafColor(tree: Tree, frame: TreeFrameLike, year: YearLike, index: number, snow: number): ColorLike {
  const { model, a, b } = tree;
  const slots = model.leaves;
  const node = at(slots.node, index);
  const skin = strainSkin(tree, node);
  const colors = strainColors(tree, node);
  year = strainYear(tree, node, year);
  if (skin) return skinnedLeafColor(tree, skin, frame, year, index, colors);
  if (year.leaf <= 0) return a.set(colors.trunk[2] ?? "#9a6946").lerp(b.set(colors.leaves[0] ?? "#6c9a54"), 0.25);
  leafSeasonColor(tree, year, index, colors);
  const dead = at(frame.dead, node);
  if (dead > 0.05) a.lerp(b.set("#8a6b45"), clamp(dead * 4, 0, 1));
  // Evergreen needles hold snow on their upper side.
  if (snow > 0 && model.species.evergreen && at(slots.dy, index) > -0.02) a.lerp(b.set("#f2f6fb"), 0.75 * snow);
  return a;
}

export function paintLeaves(tree: Tree, mesh: InstancedLike, frame: TreeFrameLike, year: YearLike, snow: number): void {
  const slots = tree.model.leaves;
  const jitter = tree.features.clumps ? (index: number): number => (clumpOf(tree, at(slots.node, index)) % 1000) / 1000 : undefined;
  const shade = tree.smooth && tree.features.crownShade && (!tree.skin || tree.strains.length > 1) ? crownShade(frame, slots, jitter) : null;
  for (let index = 0; index < slots.count; index += 1) {
    const color = leafColor(tree, frame, year, index, snow);
    if (shade && year.leaf > 0 && !strainSkin(tree, at(slots.node, index))) color.multiplyScalar(at(shade, index));
    mesh.setColorAt(index, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

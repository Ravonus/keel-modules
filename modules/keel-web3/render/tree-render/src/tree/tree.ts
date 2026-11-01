// The tree object: its options, meshes and motion, built from its shapes and updated every frame.

import type {
  ColorLike, GeometryLike, InstancedLike, LitLike, MaterialLike, NodeLike, OrnamentSpecLike, SlotsLike, TreeBloom,
  TreeColors, TreeFrameLike, TreeGround, TreeKindOrnaments, TreeModelLike, TreeSkin, TreeStrain, YearLike,
} from "../inputs.js";
import { treeFeatures } from "../features.js";
import type { TreeFeature, TreeFeatures } from "../features.js";
import { at, seededRandom } from "../math.js";
import type { Offset } from "../wind.js";
import { clearSlot } from "../instances.js";
import { NEEDLE_KINDS, speciesBlade, treeShapes } from "./shapes.js";
import type { TreeShapes } from "./shapes.js";
import { barkMaterial } from "./bark.js";
import type { OrnamentLook } from "./bark.js";
import { ROOT_SEGMENTS, ROOT_SHARDS } from "./roots.js";
import type { RootBreak } from "./roots.js";
import { paintWood, poseWood } from "./wood.js";
import { frondLayout, paintLeaves, poseLeaves } from "./leaves.js";
import type { FrondLayout } from "./leaves.js";
import {
  eatFruit, forgetEaten, kindSet, kindYear, ornamentSet, paintOrnaments, poseOrnaments, ripeFruit,
} from "./ornaments.js";
import { drawFallers, paintLitter, poseLitter, poseSnow, spawnFallers } from "./litter.js";

// ---------------------------------------------------------------- the tree object

export interface TreeLimits {
  readonly litter?: number;
  readonly flowerLitter?: number;
  readonly fruitLitter?: number;
  readonly falling?: number;
}

export interface TreeRenderOptions {
  readonly colors: TreeColors;
  readonly ground?: TreeGround;
  readonly features?: Partial<Record<TreeFeature, boolean>> | string;
  /** "smooth" draws round wood and leaf blades; "voxel" draws everything as blocks. */
  readonly form?: "smooth" | "voxel";
  /** Swap a shape (a skin's crystal leaves, coin leaves). Blades are any shape with vertex colours. */
  readonly shapes?: Partial<Pick<TreeShapes, "wood" | "leaf" | "blade" | "bud">>;
  readonly skin?: TreeSkin | null;
  readonly limits?: TreeLimits;
  readonly seed?: number;
  /** Strains of a hybrid or chimera, by number; strain 0 is the tree's own colours and skin, so `strains[0]` is not read. */
  readonly strains?: readonly TreeStrain[];
  /** Each internode's strain (tree-growth's `sectors`); its leaves, flowers, fruit and bark take that strain's look. */
  readonly strainOf?: ArrayLike<number>;
  /** A mixed bloom: each blossom opens in one of these colours, by share (codominant flower colour). Left out, blossoms take the strain's spring colours. */
  readonly blooms?: readonly TreeBloom[];
  /** Minor kinds' own flowers and fruit: cherry limbs on an oak blossom though the oak only hangs catkins. */
  readonly kinds?: readonly TreeKindOrnaments[];
}

/** What moves the tree this frame. `snow` 0..1 lies along the limbs; `snowed` hides litter under fresh snow. */
export interface TreeMotion {
  readonly elapsed: number;
  readonly delta?: number;
  readonly wind: number;
  /** The way the wind blows toward, in radians from +x toward +z (see `breezeAt`). */
  readonly windDir?: number;
  readonly dead?: boolean;
  readonly snow?: number;
  readonly snowed?: boolean;
  /**
   * How much the built-in sway field moves the wood, leaves and fruit (1, the
   * default). A host that moves the tree itself (keel/tree-mechanics) passes 0:
   * leaves still flutter and hanging fruit still swings on its stalk.
   */
  readonly field?: number;
  /**
   * Each strain's own year (tree-growth `yearState` for its species), so its
   * limbs leaf out, blossom and turn on their own calendar: an oak limb on a
   * cherry is still in bud while the cherry blooms. Strain 0, and any left
   * out, follow the tree's year.
   */
  readonly strainYears?: readonly (YearLike | undefined)[];
}

export interface TreeMeshes {
  readonly wood: InstancedLike;
  readonly leaves: InstancedLike | null;
  readonly flowers: InstancedLike | null;
  readonly fruit: InstancedLike | null;
  readonly leafLitter: InstancedLike | null;
  readonly litter: InstancedLike | null;
  readonly snow: InstancedLike | null;
  readonly falling: InstancedLike | null;
  readonly fallingLeaves: InstancedLike | null;
  /** Chunks of planter an old tree's roots broke loose (`rootBreak`, smooth form, on a planter). */
  readonly shards: InstancedLike | null;
}

export interface TreeRender {
  /** Add this to the scene once. */
  readonly group: unknown;
  readonly features: TreeFeatures;
  /** The instanced meshes, for a host that swaps materials (skins) or adds effects (night glow). Off parts are null. */
  readonly meshes: TreeMeshes;
  /** Minor kinds' own flowers and fruit, one mesh per set (see `TreeRenderOptions.kinds`). */
  readonly kinds: readonly InstancedLike[];
  /** Pose and, when the season or frame changed, repaint. Call every frame. */
  update(frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void;
  /** Leaves, petals and fruit falling or lying where they landed, for a host's own drawing (a canvas fallback). */
  readonly fallers: readonly Readonly<Pick<Faller, "x" | "y" | "z" | "size" | "color" | "landed" | "kind">>[];
  /** The ripe fruit as of the last update, hanging on the tree or lying under it, for animals to eat. */
  fruit(): TreeFruit[];
  /** Take a fruit (by its `TreeFruit.key`) off the tree or the ground until next year's crop. False when there was none. */
  eat(key: string): boolean;
  /** Repaint on the next update (after a material swap, say). */
  repaint(): void;
  dispose(): void;
}

/** A ripe fruit, where it hangs or lies. Its `key` holds while it ripens, falls and lies. */
export interface TreeFruit {
  readonly key: string;
  /** The ornament kind: "apple", "acorn", "cherry" and so on. */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its size across, in scene units. */
  readonly size: number;
  /** On the tree (true) or on the ground under it. */
  readonly hanging: boolean;
}

export interface OrnamentSet {
  readonly name: "flowers" | "fruit";
  /** A minor kind's set opens on this strain's year and ignores the tree's own bearing rules; -1 is the tree's own. */
  readonly strain: number;
  readonly spec: OrnamentSpecLike;
  readonly look: OrnamentLook;
  readonly slots: SlotsLike;
  readonly mesh: InstancedLike;
  readonly litterStart: number;
  readonly litterLimit: number;
  readonly stride: number;
  /** Drawn as sprays (the `sprays` look): every `thin`th slot draws, `grow` times its size, one tone per twig. */
  readonly spray: boolean;
  readonly thin: number;
  readonly grow: number;
}

/** How a blossom set draws as sprays: a big crown keeps every other slot at twice the size (fewer, readable sprays); a small one keeps all. */
export function sprayPlan(tree: Pick<Tree, "features" | "smooth">, spec: OrnamentSpecLike, slots: SlotsLike, own: boolean): { spray: boolean; thin: number; grow: number } {
  const spray = tree.features.sprays && tree.smooth && own && spec.kind === "blossom";
  if (!spray) return { spray, thin: 1, grow: 1 };
  return slots.count > 900 ? { spray, thin: 2, grow: 2 } : { spray, thin: 1, grow: 1.5 };
}

export interface Faller {
  readonly key: string;
  readonly kind: "leaf" | "flowers" | "fruit";
  x: number; y: number; z: number;
  vx: number; vz: number;
  readonly phase: number;
  readonly size: readonly [number, number, number];
  readonly color: string;
  readonly speed: number;
  landed: boolean;
}

export interface Tree {
  readonly lit: LitLike;
  readonly model: TreeModelLike;
  readonly colors: TreeColors;
  readonly ground: TreeGround;
  readonly features: TreeFeatures;
  readonly smooth: boolean;
  readonly blades: boolean;
  /** Conifer needles: each sprig lies along its twig, stiff, instead of hanging off it like a leaf. */
  readonly needles: boolean;
  /** A palm's leaflets, laid out in two rows down each frond. */
  readonly fronds: FrondLayout | null;
  readonly skin: TreeSkin | null;
  readonly strains: readonly TreeStrain[];
  readonly strainOf: ArrayLike<number> | null;
  readonly blooms: readonly TreeBloom[];
  strainYears: readonly (YearLike | undefined)[];
  readonly group: NodeLike;
  readonly meshes: TreeMeshes;
  readonly flowers: OrnamentSet | null;
  readonly fruits: OrnamentSet | null;
  readonly kinds: readonly OrnamentSet[];
  readonly limits: Required<TreeLimits>;
  readonly leafStride: number;
  readonly hidden: Map<string, { readonly rank: number; readonly kind: Faller["kind"]; readonly index: number }>;
  /** The same slots by kind, for the per-slot test in every pose pass (a number lookup, not a string built per slot per frame). */
  readonly hiddenSlots: Readonly<Record<Faller["kind"], Set<number>>>;
  /** Fruit animals have eaten this year, by set ("fruit", or "kind<n>" for a minor kind's) and slot. */
  readonly eaten: Map<string, Set<number>>;
  lastYear: YearLike | null;
  lastMotion: TreeMotion | null;
  readonly fallers: Faller[];
  readonly random: () => number;
  readonly a: ColorLike;
  readonly b: ColorLike;
  readonly c: ColorLike;
  readonly offset: Offset;
  spawnClock: number;
  paintKey: string;
  lastFrame: TreeFrameLike | null;
  /** The host moves the tree itself this frame (`field: 0`): no sway field at all. */
  still: boolean;
  readonly seed: number;
  /** The roots' break plans (`rootBreak`) and the trunk radius they were made for. */
  readonly breaks: { trunk: number; plans: readonly RootBreak[] };
}

const DEFAULT_LIMITS: Required<TreeLimits> = { litter: 1800, flowerLitter: 600, fruitLitter: 320, falling: 64 };

export function makeMesh(tree: Pick<Tree, "lit" | "group">, count: number, roughness: number, shadows: boolean, geometry: GeometryLike, sheet = false): InstancedLike {
  const lit = tree.lit;
  const vertexColors = Boolean(geometry.attributes.color);
  // Blades are single sheets, seen from both sides.
  const side = sheet ? "both" : "front";
  const mesh = new lit.Instances(geometry, new lit.LitMaterial({ color: "#ffffff", roughness, side, vertexColors }), Math.max(1, count));
  mesh.instanceMatrix.setUsage("dynamic");
  mesh.setColorAt(0, new lit.Color("#ffffff"));
  mesh.count = count;
  // Every slot starts hidden: a part only shows once something poses it.
  for (let index = 0; index < Math.max(1, count); index += 1) clearSlot(mesh.instanceMatrix.array, index);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  tree.group.add(mesh);
  return mesh;
}

export const ornamentState = (set: OrnamentSet, year: YearLike): { open: number; fallen: number } =>
  set.name === "fruit" ? { open: year.fruit, fallen: year.fruitDrop } : { open: year.bloom, fallen: year.petals };

// Needles clothe a conifer's limbs most of the way in; other evergreens keep leaves near the tips.
export const leafTipLimit = (tree: Tree): number => (tree.needles ? 40 : tree.model.species.evergreen ? 7 : 2.6);

/** Is node a living, leafy twig right now? Outer twigs carry the foliage. */
export function leafyNode(frame: TreeFrameLike, node: number, tipLimit: number): boolean {
  return at(frame.grow, node) > 0.25 && at(frame.dead, node) < 0.25 && at(frame.fall, node) === 0 && at(frame.tips, node) <= tipLimit;
}

export function bearingNode(
  tree: Tree,
  frame: TreeFrameLike,
  spec: OrnamentSpecLike,
  node: number,
  own = false,
): boolean {
  if (frame.cycle < spec.from || at(frame.fall, node) > 0 || at(frame.dead, node) >= 0.2) return false;
  if (tree.strainOf && tree.strains[at(tree.strainOf, node)]?.bears === false && !own) return false;
  if (spec.on === "tip") return leafyNode(frame, node, tree.model.species.evergreen ? 7 : 2.6);
  // Spurs form on wood a couple of years old (half a growth cycle), so a tree in full bloom reads as a cloud.
  return at(frame.grow, node) >= 1 && at(frame.tips, node) <= 9 && frame.cycle - at(tree.model.birth, node) > 0.5;
}


// ---------------------------------------------------------------- assembly

function paintAll(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  const dead = motion.dead === true;
  paintWood(tree, frame, dead);
  if (tree.meshes.leaves) paintLeaves(tree, tree.meshes.leaves, frame, year, motion.snow ?? 0);
  for (const set of [tree.flowers, tree.fruits]) if (set) paintOrnaments(tree, set, year);
  for (const set of tree.kinds) paintOrnaments(tree, set, kindYear(tree, set, year));
  paintLitter(tree, year);
}

function paintKeyOf(year: YearLike, motion: TreeMotion): string {
  const values = [year.leaf, year.color, year.flush, year.drop, year.petals, year.fruit, motion.snow ?? 0];
  return values.map((value) => Math.round(value * 60)).join(":") + (year.withered ? ":withered" : "") + (motion.dead === true ? ":dead" : "");
}

function update(tree: Tree, frame: TreeFrameLike, year: YearLike, motion: TreeMotion): void {
  tree.strainYears = motion.strainYears ?? [];
  tree.lastYear = year;
  tree.lastMotion = motion;
  tree.still = motion.field === 0;
  forgetEaten(tree, year);
  const key = [year, ...tree.strainYears.filter((own): own is YearLike => own !== undefined)].map((own) => paintKeyOf(own, motion)).join("|");
  if (frame !== tree.lastFrame || key !== tree.paintKey) {
    paintAll(tree, frame, year, motion);
    tree.paintKey = key;
    tree.lastFrame = frame;
  }
  const { meshes } = tree;
  poseWood(tree, frame, motion);
  if (meshes.leaves) poseLeaves(tree, meshes.leaves, frame, year, motion);
  for (const set of [tree.flowers, tree.fruits]) if (set) poseOrnaments(tree, set, frame, year, motion);
  for (const set of tree.kinds) poseOrnaments(tree, set, frame, kindYear(tree, set, year), motion);
  poseLitter(tree, frame, year, motion);
  if (meshes.snow) poseSnow(tree, meshes.snow, frame, motion);
  if (meshes.falling && meshes.fallingLeaves) {
    spawnFallers(tree, frame, year, motion);
    drawFallers(tree, meshes.falling, meshes.fallingLeaves, motion);
  }
}

interface Build {
  readonly lit: LitLike;
  readonly group: NodeLike;
  readonly model: TreeModelLike;
  readonly features: TreeFeatures;
  readonly limits: Required<TreeLimits>;
  readonly smooth: boolean;
}

function shapesFor(build: Build, options: TreeRenderOptions): { wood: GeometryLike; leaf: GeometryLike; blade: GeometryLike; bud: GeometryLike } {
  const base = treeShapes(build.lit);
  const own = options.shapes ?? {};
  if (!build.smooth) {
    const leaf = own.leaf ?? base.box;
    return { wood: base.box, leaf, blade: leaf, bud: base.box };
  }
  const blade = speciesBlade(build.lit, build.model.species.id);
  return { wood: base.wood, leaf: base.leaf, blade: build.features.clumps && blade === base.blade ? base.softBlade : blade, bud: base.bud, ...own };
}

const hasOrnaments = (features: TreeFeatures): boolean => features.flowers || features.fruit;

function woodMesh(build: Build, shape: GeometryLike, groundY: number): InstancedLike {
  const wood = makeMesh(build, build.model.count + build.model.roots.length * ROOT_SEGMENTS, 0.86, build.features.shadows, shape);
  if (build.smooth && build.features.bark) {
    wood.material.dispose();
    wood.material = barkMaterial(build.lit, groundY, build.features.rootSink, build.features.rootBreak);
  }
  return wood;
}

/**
 * Sprays let a little light through their petals: a faint glow in the petal colour,
 * lost in daylight, keeps a blossom crown pink at dusk instead of sinking to the
 * night's blue-black with the leaves.
 */
function glowPetals(mesh: InstancedLike, colors: TreeColors): void {
  const material = mesh.material as MaterialLike & { emissive?: ColorLike; emissiveIntensity?: number };
  if (!material.emissive) return;
  material.emissive.set(colors.spring[0] ?? "#f6bacb");
  material.emissiveIntensity = 0.16;
}

/** A skin's own leaf shape (crystal, coin) stays its flowers' shape too; a natural crown opens in sprays. */
const sprayShape = (build: Build, options: TreeRenderOptions): GeometryLike | null => (build.smooth && !options.shapes?.leaf ? treeShapes(build.lit).spray : null);

function buildMeshes(build: Build, options: TreeRenderOptions): { meshes: TreeMeshes; flowers: OrnamentSet | null; fruits: OrnamentSet | null; kinds: OrnamentSet[] } {
  const { model, features, limits } = build;
  const shapes = shapesFor(build, options);
  const leafShape = shapes.blade;
  const shadows = features.shadows;
  const on = <T>(flag: boolean, make: () => T): T | null => (flag ? make() : null);
  const wood = woodMesh(build, shapes.wood, options.ground?.y ?? 0);
  const meshes: TreeMeshes = {
    wood,
    leaves: on(features.leaves, () => makeMesh(build, model.leaves.count, 0.78, shadows, leafShape, build.smooth)),
    flowers: null,
    fruit: null,
    leafLitter: on(features.litter && features.leaves, () => makeMesh(build, limits.litter, 0.92, false, leafShape, build.smooth)),
    litter: on(features.litter && hasOrnaments(features), () => makeMesh(build, limits.litter + limits.flowerLitter + limits.fruitLitter, 0.92, false, shapes.leaf)),
    snow: on(features.snow, () => makeMesh(build, model.count, 0.55, false, shapes.leaf)),
    falling: on(features.fallers, () => makeMesh(build, limits.falling, 0.78, shadows, shapes.leaf)),
    fallingLeaves: on(features.fallers, () => makeMesh(build, limits.falling, 0.78, shadows, leafShape, build.smooth)),
    shards: on(features.rootBreak && features.roots && build.smooth && options.ground?.lip !== undefined && !model.species.palm, () => makeMesh(build, model.roots.length * ROOT_SHARDS, 0.95, shadows, treeShapes(build.lit).box)),
  };
  meshes.snow?.material.color.set("#f4f8ff");
  const spray = sprayShape(build, options);
  const flowers = ornamentSet(build, "flowers", build.smooth ? shapes.leaf : shapes.wood, limits.litter, limits.flowerLitter, spray);
  if (flowers?.spray === true) glowPetals(flowers.mesh, options.colors);
  const fruits = ornamentSet(build, "fruit", build.smooth ? shapes.bud : shapes.wood, limits.litter + limits.flowerLitter, limits.fruitLitter);
  const kinds = (options.kinds ?? []).flatMap((kind) => [kindSet(build, kind, "flowers", build.smooth ? shapes.leaf : shapes.wood, spray), kindSet(build, kind, "fruit", build.smooth ? shapes.bud : shapes.wood)]).filter((set): set is OrnamentSet => set !== null);
  return { meshes: { ...meshes, flowers: flowers?.mesh ?? null, fruit: fruits?.mesh ?? null }, flowers, fruits, kinds };
}

/** One grown tree as live instanced meshes. Build once per model; call `update` every frame. */
export function createTreeRender(lit: LitLike, model: TreeModelLike, options: TreeRenderOptions): TreeRender {
  const features = treeFeatures(options.features ?? {});
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const smooth = options.form !== "voxel";
  const group = new lit.Group();
  const build: Build = { lit, group, model, features, limits, smooth };
  const { meshes, flowers, fruits, kinds } = buildMeshes(build, options);
  const tree: Tree = {
    lit, model, colors: options.colors, features, smooth, group, meshes, flowers, fruits, kinds, limits,
    ground: options.ground ?? { y: 0, radius: 4.4 },
    blades: smooth,
    needles: smooth && !options.shapes?.blade && NEEDLE_KINDS[model.species.id] !== undefined,
    fronds: smooth && !options.shapes?.blade ? frondLayout(model) : null,
    skin: options.skin ?? null,
    strains: options.strains ?? [], strainOf: options.strainOf ?? null, strainYears: [], blooms: (options.blooms ?? []).filter((bloom) => bloom.share > 0 && bloom.colors.length > 0),
    leafStride: Math.max(1, Math.ceil(model.leaves.count / limits.litter)),
    hidden: new Map(), hiddenSlots: { leaf: new Set(), flowers: new Set(), fruit: new Set() }, eaten: new Map(), lastYear: null, lastMotion: null, fallers: [], random: seededRandom((options.seed ?? 1) ^ 0x51f7),
    a: new lit.Color(), b: new lit.Color(), c: new lit.Color(), offset: { x: 0, z: 0 },
    spawnClock: 0, paintKey: "", lastFrame: null, still: false,
    seed: options.seed ?? 1, breaks: { trunk: -1, plans: [] },
  };
  return {
    group, features, meshes, fallers: tree.fallers, kinds: kinds.map((set) => set.mesh),
    update: (frame, year, motion) => { update(tree, frame, year, motion); },
    fruit: () => ripeFruit(tree),
    eat: (key) => eatFruit(tree, key),
    repaint: () => { tree.paintKey = ""; },
    dispose: () => {
      for (const mesh of [...(Object.values(meshes) as (InstancedLike | null)[]), ...kinds.map((set) => set.mesh)]) {
        if (!mesh) continue;
        mesh.material.dispose();
        mesh.dispose();
      }
    },
  };
}

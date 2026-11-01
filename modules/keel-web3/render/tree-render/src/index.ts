/**
 * Trees as objects. The tree-growth module grows a branch graph; this module
 * draws it with KEEL's lit renderer (keel/lit): wood with surface roots, leaf blades that grow from
 * their twigs and flutter, flowers and fruit that open, ripen and fall, litter
 * under the crown, snow along the limbs, and the leaves and petals falling in
 * between. One wind field bends wood, leaves and fruit together, so nothing
 * comes apart at a joint. MIT.
 *
 * Every part has a switch (`roots`, `leaves`, `flowers`, `fruit`, `deadwood`,
 * `litter`, `snow`, `fallers`, `sway`, `shadows`, `crownShade`, `bark`), set in
 * code or from a plugin string such as "-roots,-litter". Three more switch the
 * pixel-scale looks: `sprays` (blossoms open as a few big two-tone sprays per
 * twig, not a speckle of tiny flowers), `clumps` (a twig's leaves share one
 * tone, so the crown reads as lit and shaded masses) and `rootSink` (roots
 * dive under the soil where they thin out or leave the inner planter). A host decides the
 * ground: open soil, or a planter whose lip and wall the roots climb over.
 * `rootBreak` lets an old tree's big roots heave the soil, crack the rim and
 * now and then burst out through the planter's side.
 *
 * The same pieces draw a whole forest in the background (createForest): each
 * tree variant is cut into levels of detail that keep their season on the GPU,
 * each instanced many times and built only when a tree reaches its distance,
 * ending in impostor cards baked from it (a sprite ladder), with a dither
 * dissolve near the lens.
 *
 *   const tree = createTreeRender(lit, model, { colors, ground: { y: 0, radius: 4.4 } });
 *   scene.add(tree.group);
 *   // every frame:
 *   tree.update(treeFrame(model, cycle), yearState(...), { elapsed, delta, wind });
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export type {
  SlotsLike, OrnamentSpecLike, TreeModelLike, TreeFrameLike, YearLike, TreeColors, TreeGround, TreeSkin, TreeStrain,
  TreeKindOrnaments, TreeBloom, GeometryLike, MaterialLike, InstancedLike, LitLike,
} from "./inputs.js";
export { TREE_FEATURES, treeFeatures } from "./features.js";
export type { TreeFeature, TreeFeatures } from "./features.js";
export { smoothstep, hash32, seededRandom } from "./math.js";
export { breezeAt, sway, leafFlutter } from "./wind.js";
export type { Offset, Breeze, Flutter, Gust, Airflow } from "./wind.js";
export { clearSlot, writeBox, writeSlab, writeVoxel, writeSegment, writeBlade } from "./instances.js";
export type { V3, BoxPlace, VoxelLook, Limb, SlabSize, WoodPiece, Blade } from "./instances.js";
export {
  LEAF_OUTLINE, bladeGeometry, softBladeGeometry, sprayGeometry, lightSprig, needleGeometry, PALM_LEAFLET,
  speciesBlade, treeShapes,
} from "./tree/shapes.js";
export type { TreeShapes, NeedleKind } from "./tree/shapes.js";
export { barkMaterial, ORNAMENTS, ornamentLook } from "./tree/bark.js";
export type { OrnamentLook } from "./tree/bark.js";
export { ROOT_SEGMENTS, NO_ROOT_BREAK, rootBreaks, rootPath, ROOT_SHARDS, rootShards } from "./tree/roots.js";
export type { RootPoint, RootBreak, RootShard, Breakage } from "./tree/roots.js";
export { createTreeRender } from "./tree/tree.js";
export type { TreeLimits, TreeRenderOptions, TreeMotion, TreeMeshes, TreeRender, TreeFruit } from "./tree/tree.js";
export { writeShard } from "./tree/wood.js";
export { crownShade } from "./tree/leaves.js";
export { forestPlaces, createForest } from "./forest/forest.js";
export type {
  ForestVariant, ForestPlace, ForestPlacesInput, ForestOptions, ForestUpdate, Forest, RendererLike, ForestLitLike,
} from "./forest/forest.js";

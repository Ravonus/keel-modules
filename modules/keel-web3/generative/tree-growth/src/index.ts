/**
 * Self-organizing tree growth, yearly phenology and slow decline for voxel
 * trees. Deterministic and renderer-free: a seed and a species become a branch
 * graph that a scene can pose at any moment of the tree's life. MIT.
 *
 * Growth follows Palubicki et al. 2009 ("Self-organizing tree models for image
 * synthesis"): buds compete for light in a shadow grid, light flows down the
 * branches and vigor flows back up with apical control (Borchert–Honda), so
 * the crown fills the space it can reach, shaded limbs die and drop, and the
 * trunk thickens by the pipe model.
 */

export { SPECIES, SPECIES_IDS, speciesOf } from "./species.js";
export type { SpeciesId, Hemisphere, PhenologySpec, OrnamentKind, OrnamentSpec, PalmSpec, Species } from "./species.js";
export { createRandom } from "./math.js";
export { mixShares, blendSpecies, growTree, kindOrnaments, PACE, cycleAt } from "./model.js";
export { sectors } from "./sectors.js";
export type { TreeModel, LeafSlots, GrowInput, KindOrnament, Pace } from "./model.js";
export { GRAND, grandAt, treeFrame } from "./frame.js";
export type { TreeFrame, FrameOptions } from "./frame.js";
export { WOOD_SAG, bendFrame } from "./bend.js";
export type { Load, BendInto } from "./bend.js";
export { yearState } from "./year.js";
export type { Climate, YearInput, YearState } from "./year.js";

/**
 * Living things for a KEEL scene: a roster of animals, how rarely each turns up,
 * the groups they come in, what they do when left alone, what they do together,
 * and the traffic of the sky (flocks passing over, planes far off). Deterministic
 * and renderer-free: a seed casts the scene, and any moment of it poses every
 * animal as a list of capsules a renderer can draw as voxels, spheres or lines.
 * MIT.
 *
 * The body plans grow out of the KEEL pixel engine's entity system
 * (src/entity: a quadruped rig, two-bone IK, gait cycles, capsule skins) and add
 * primates, birds, serpents, insects and crabs. Each animal's idle life is a
 * Markov chain over a matrix of actions (`idleMatrix`), weighted by its temper.
 * A group's director interleaves those solo chains with joint scenes that need
 * two or more animals at once: grooming, nuzzling, chasing, following a leader,
 * a howling chorus, a huddle, a dance, a mother and young, a bird riding a deer.
 *
 *   const cast = castFor({ seed, region: "tokyo", world: "nature", season: "spring", radius: 4 });
 *   const herd = createHerd(cast);
 *   // every frame, with the scene's ground, trunk and branch perches:
 *   for (const body of herd.at(elapsed, stage)) draw(body.capsules);
 *
 * Frame convention (shared with the pixel engine): +y up, an animal's front is
 * its +z, its right hand +x, and a heading yaw turns +z toward +x.
 */

export { frameOf, solveTwoBone } from "./vec.js";
export type { Vec, Frame } from "./vec.js";
export { createRandom, streamOf } from "./roll.js";
export { MOVES, SPECIES, SPECIES_IDS } from "./roster.js";
export type {
  Plan, Rarity, RegionId, WorldKey, Season, EyeRole, Role, Palette, Action, Build, SpeciesSpec, SpeciesId,
} from "./roster.js";
export { idleMatrix } from "./idle.js";
export type { IdleMatrix, Mood } from "./idle.js";
export { FRUIT_EATERS } from "./stage.js";
export type { Place, Wood, Perch, Root, Stage, Food } from "./stage.js";
export { woodMapOf } from "./paths.js";
export type { WoodMap, WoodEdge } from "./paths.js";
export { searchRoute } from "./director.js";
export type { Capsule } from "./moments.js";
export { MORPHS } from "./coats.js";
export type { Morph } from "./coats.js";
export { fits, shownSize, regionWeight, castFor } from "./casting.js";
export type {
  CastMember, Traits, CastGroup, PlaneKind, SkyKind, SkyTraffic, SkyPlan, SkyNow, Cast, CastInput, PoseOptions,
} from "./casting.js";
export { poseSpecies } from "./bodies.js";
export type { PeltSpec, Body } from "./bodies.js";
export { skyFade } from "./sky.js";
export { createHerd, pickBody } from "./herd.js";
export type { Herd, Order } from "./herd.js";
export { shoveApart, clearOfLimbs, passOnWood } from "./collision.js";
export type { Ring, Footprint, WoodPrint, Clipping } from "./collision.js";
export { TREADS, createTracks } from "./tracks.js";
export type { Tread, Print, PrintShape, Tracks } from "./tracks.js";

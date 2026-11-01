/**
 * Seeded generative people. One seed is one whole person: a build, a face, hair
 * and clothes, all stood on one skeleton, so a portrait, a pedestrian and a
 * driver are the same person seen differently. Pure and renderer-free: a pose
 * is a list of capsules, for sdf-body to raymarch or anything else to draw.
 * Front is +z, right +x, up +y, in metres, the feet on y = 0.
 */

export type { Vec } from "./vec.js";
export { personOf } from "./body/person.js";
export type {
  HairStyle, Sex, Genre, FaceHair, Top, Bottom, Weather, Carry, Costume, Shoe, Hat, Gear, Age, Shape, Build, Look,
  Face, Bone, Outfit, Person, Gait,
} from "./body/person.js";
export { faceOf, signaturesOf, faceFor } from "./head/face.js";
export type { Trait, Signature } from "./head/face.js";
export { ACTIONS, skeletonOf } from "./motion/skeleton.js";
export type { Action, Skeleton } from "./motion/skeleton.js";
export type { Capsule } from "./mesh/parts.js";
export { strideOf, posePerson, createHang, velocityAt, jiggleAt, trailAt, faceAt } from "./motion/pose.js";
export type { PersonBody, Placing } from "./motion/pose.js";
export { createDrape, drapeAt } from "./motion/drape.js";
export type { Drape, Going } from "./motion/drape.js";
export { BONE_COUNT } from "./body/bones.js";
export type { PersonMesh } from "./body/field.js";
export { FABRICS } from "./clothes/fabric.js";
export { PERSON_LODS, lodFor, lodsWithin, crowdBudget } from "./mesh/lod.js";
export { tuckOf } from "./head/hair.js";
export { meshOf, poseMesh, limpBones } from "./mesh/mesh.js";
export type { Limp } from "./mesh/mesh.js";

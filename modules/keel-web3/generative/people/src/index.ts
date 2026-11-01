/**
 * Seeded generative people. One seed is one whole person: a build, a face, hair
 * and clothes, all stood on one skeleton, so a portrait, a pedestrian and a
 * driver are the same person seen differently. Pure and renderer-free: a pose
 * is a list of capsules, for sdf-body to raymarch or anything else to draw.
 * Front is +z, right +x, up +y, in metres, the feet on y = 0.
 */

export type { Vec } from "./vec.js";
export { personOf } from "./person.js";
export type {
  HairStyle, Sex, Genre, FaceHair, Top, Bottom, Weather, Carry, Costume, Shoe, Hat, Gear, Age, Shape, Build, Look,
  Face, Bone, Outfit, Person, Gait,
} from "./person.js";
export { faceOf, signaturesOf, faceFor } from "./face.js";
export type { Trait, Signature } from "./face.js";
export { ACTIONS, skeletonOf } from "./skeleton.js";
export type { Action, Skeleton } from "./skeleton.js";
export type { Capsule } from "./parts.js";
export { strideOf, posePerson, createHang, velocityAt, jiggleAt, trailAt, faceAt } from "./pose.js";
export type { PersonBody } from "./pose.js";
export { BONE_COUNT } from "./bones.js";
export type { PersonMesh } from "./field.js";
export { FABRICS } from "./fabric.js";
export { PERSON_LODS, lodFor, lodsWithin, crowdBudget } from "./lod.js";
export { tuckOf } from "./hair.js";
export { meshOf, poseMesh, limpBones } from "./mesh.js";
export type { Limp } from "./mesh.js";

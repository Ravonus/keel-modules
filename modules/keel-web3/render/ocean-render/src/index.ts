/**
 * Draws a sea for keel/lit: the moving surface, the ground under it, and the
 * water itself, seen from above or from inside it. MIT.
 *
 *   const ocean = createOcean(lit, { sea });
 *   scene.add(ocean.group);
 *   // every frame, in place of renderer.render(scene, camera):
 *   ocean.draw(renderer, scene, camera, { t, sun, sunColor });
 *
 * The water is a pass over the finished scene, read from its depth: whatever is
 * in the scene, a seabed, a raymarched shark, a tree on the shore, loses its
 * colours to the water by the metres of water in front of it, and caustics fall
 * on it, so nothing in the scene has to know it is under the sea. The surface
 * shader evaluates the same waves `generative/ocean` answers from, so what
 * floats on them stays on them.
 *
 *   const swarm = createSwarm(lit, { bodies, pose: poseSwimmer });
 *   swarm.draw(swim.at(t), eye, light);
 *
 * A swarm draws any number of animals: the nearest as real bodies through
 * `render/sdf-body`, the rest as instances cut from the same body.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */
export type {
  Vec,
  SeaLike,
  RendererLike,
  CameraLike,
  LitLike,
  OceanOptions,
  OceanSettings,
  OceanPlace,
  QualityLike,
  Caster,
  OceanLight,
  Ocean,
} from "./inputs.js";
export { createOcean } from "./ocean.js";
export { wetLineAfter } from "./uniforms.js";
export { createSwarm } from "./swarm.js";
export type { SwarmBody, SwarmMember, SwarmSpecies, SwarmOptions, SwarmLight, Swarm } from "./swarm.js";

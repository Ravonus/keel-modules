// Bark: the wood's material, mossy up one side, and the looks of each ornament.

import type { LitLike, MaterialLike, OrnamentSpecLike } from "../inputs.js";

// ---------------------------------------------------------------- bark

// Living bark, drawn round each branch rather than painted flat: vertical
// fissures between raised plates, lichen flecks, the odd knot, and moss low on
// the trunk's upper faces. Each branch keeps its own colour; the bark only
// works light and dark into it. Coordinates run round the branch in world
// units, so texture density holds on twig and trunk.
const BARK_VERTEX = /* glsl */ `
varying vec3 vBark;
varying vec3 vBarkWorld;
varying float vBarkUp;
`;
const BARK_FRAGMENT = /* glsl */ `
varying vec3 vBark;
varying vec3 vBarkWorld;
varying float vBarkUp;
float barkHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float barkNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(barkHash(i), barkHash(i + vec3(1, 0, 0)), f.x), mix(barkHash(i + vec3(0, 1, 0)), barkHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(barkHash(i + vec3(0, 0, 1)), barkHash(i + vec3(1, 0, 1)), f.x), mix(barkHash(i + vec3(0, 1, 1)), barkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 barkSurface(vec3 base) {
  vec3 p = vec3(vBark.xy * 3.2, vBark.z * 0.7);
  float ridge = barkNoise(p) * 0.65 + barkNoise(p * 2.1 + 7.0) * 0.35;
  float fissure = 1.0 - smoothstep(0.03, 0.11, abs(ridge - 0.5));
  float plate = barkNoise(vec3(vBark.xy * 1.6, vBark.z * 0.35) + 3.0);
  vec3 c = base * (1.0 + 0.5 * plate) * 1.15;
  c += base * 0.45 * smoothstep(0.62, 0.82, ridge);
  c *= 1.0 - 0.65 * fissure;
  float fleck = step(0.94, barkHash(floor(vec3(vBark.xy * 9.0, vBark.z * 7.0))));
  c = mix(c, mix(base, vec3(0.72, 0.76, 0.62), 0.65), fleck * 0.55);
  float knot = smoothstep(0.88, 0.95, barkNoise(vec3(vBark.xy * 0.9, vBark.z * 0.5) + 11.0));
  c *= 1.0 - 0.45 * knot;
  float moss = smoothstep(1.6, 0.4, vBarkWorld.y - uBarkGround) * smoothstep(0.45, 0.65, barkNoise(vBarkWorld * 2.2));
#ifdef BARK_UPRIGHT_MOSS
  // Moss climbs the upright trunk foot, not the roots lying along the soil (green hairlines on a planter).
  moss *= smoothstep(0.35, 0.75, vBarkUp);
#endif
#ifdef BARK_BARE_WALL
  // Below the soil line the wood is a root on the planter's wall: bare bark, not a green vine.
  moss *= smoothstep(uBarkGround - 0.3, uBarkGround + 0.05, vBarkWorld.y);
#endif
  return mix(c, vec3(0.33, 0.46, 0.2) * (0.8 + 0.4 * plate), moss * 0.85);
}
`;
const BARK_BEGIN = /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  float barkRadius = length(instanceMatrix[0].xyz);
  vec4 barkWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 barkAxis = normalize(instanceMatrix[1].xyz);
#else
  float barkRadius = 1.0;
  vec4 barkWorld = modelMatrix * vec4(position, 1.0);
  vec3 barkAxis = vec3(0.0, 1.0, 0.0);
#endif
  float barkAngle = atan(position.z, position.x);
  vBark = vec3(cos(barkAngle) * barkRadius, sin(barkAngle) * barkRadius, dot(barkWorld.xyz, barkAxis));
  vBarkWorld = barkWorld.xyz;
  vBarkUp = abs(barkAxis.y);`;

/** A standard material whose instances carry living bark. `ground` is the world y where moss gathers; `bareWall` keeps moss off roots below it (on a planter wall). */
export function barkMaterial(lit: LitLike, ground = 0, uprightMoss = false, bareWall = false): MaterialLike {
  const material = new lit.LitMaterial({ color: "#ffffff", roughness: 0.92, metalness: 0 });
  material.userData.voxelDitherKeep = true;
  material.onCompile = (shader) => {
    shader.vertexShader = BARK_VERTEX + shader.vertexShader.replace("#include <begin_vertex>", BARK_BEGIN);
    shader.fragmentShader = `${uprightMoss ? "#define BARK_UPRIGHT_MOSS\n" : ""}${bareWall ? "#define BARK_BARE_WALL\n" : ""}uniform float uBarkGround;\n${BARK_FRAGMENT}${shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb = barkSurface(diffuseColor.rgb);")}`;
    shader.uniforms.uBarkGround = { value: ground };
  };
  material.customProgramCacheKey = () => `living-bark${uprightMoss ? "-upright" : ""}${bareWall ? "-bare" : ""}`;
  return material;
}

// ---------------------------------------------------------------- flowers and fruit

/**
 * Flowers and fruit, per kind. Sizes are in leaf units (width, length, depth);
 * `lift` moves them up from the twig (negative hangs below it). Fruit ripens
 * from `green` to its colours; `fall` is how fast a dropped one falls.
 */
export interface OrnamentLook {
  readonly size: readonly [number, number, number];
  readonly lift: number;
  readonly colors?: readonly string[];
  readonly green?: string;
  readonly fall: number;
}

export const ORNAMENTS: Readonly<Record<string, OrnamentLook>> = {
  blossom: { size: [0.7, 0.7, 0.7], lift: 0, fall: 0.55 },
  catkin: { size: [0.35, 1.5, 0.35], lift: -0.75, colors: ["#c9c27a", "#b8ae64", "#d9d394"], fall: 0.9 },
  candle: { size: [0.4, 1.2, 0.4], lift: 0.65, colors: ["#e2e8b0", "#d0daa0", "#eef0c8"], fall: 0 },
  puff: { size: [0.5, 0.5, 0.5], lift: 0.1, colors: ["#f2d33c", "#f7e26e", "#e6bf27"], fall: 0.6 },
  spadix: { size: [0.4, 1.2, 0.4], lift: -0.55, colors: ["#efe2a6", "#e6d48a", "#f4ecc4"], fall: 0.7 },
  cherry: { size: [0.85, 0.85, 0.85], lift: -0.7, colors: ["#c8102e", "#a8102a", "#e0303e"], green: "#86a24c", fall: 2.4 },
  acorn: { size: [0.5, 0.65, 0.5], lift: -0.45, colors: ["#7a5a2a", "#8c6a32", "#6b4f22"], green: "#7f9a4a", fall: 2.6 },
  cone: { size: [0.5, 0.85, 0.5], lift: -0.6, colors: ["#7b5733", "#6a4a2a", "#8a6640"], green: "#6d8a4c", fall: 2.4 },
  coconut: { size: [1.0, 1.1, 1.0], lift: -0.7, colors: ["#7c9a36", "#6b8a2e", "#6a5230"], green: "#86ab3e", fall: 3.2 },
  pod: { size: [0.35, 1.8, 0.6], lift: -0.9, colors: ["#8a6a3a", "#9a7a46", "#7a5c30"], green: "#8aa058", fall: 1.4 },
  // Maple keys: paired wings that drift down slowly.
  samara: { size: [0.8, 0.95, 0.16], lift: -0.55, colors: ["#b99a5c", "#a8844a", "#c9ab6e"], green: "#a4bf62", fall: 0.45 },
  // Baobab flowers: big white bells hanging on long stalks.
  bell: { size: [0.85, 0.95, 0.85], lift: -1.1, colors: ["#f6f1e2", "#efe6cc", "#fbf8ee"], fall: 0.8 },
  // Baobab fruit: a velvety grey-green gourd on a cord.
  gourd: { size: [0.8, 1.4, 0.8], lift: -1.6, colors: ["#9c9474", "#8c8466", "#aaa282"], green: "#83905c", fall: 3 },
  // Orchard fruit: each sets green and ripens to its own colour, big enough to read from across the plot.
  apple: { size: [1.4, 1.35, 1.4], lift: -0.6, colors: ["#c8202a", "#e0402c", "#a81c26"], green: "#9ab84c", fall: 2.6 },
  // Each fruit keeps its own hue so a grove reads at a glance: green-gold pear, deep orange, pale lemon.
  pear: { size: [1.1, 1.6, 1.1], lift: -0.75, colors: ["#c8d84a", "#d8e060", "#a8b838"], green: "#8fb04a", fall: 2.6 },
  peach: { size: [1.35, 1.35, 1.35], lift: -0.5, colors: ["#f29a5c", "#f8b878", "#e8604a"], green: "#a8b860", fall: 2.4 },
  plum: { size: [1.2, 1.35, 1.2], lift: -0.65, colors: ["#7b3fa0", "#b77ad1", "#5e2c80"], green: "#8aa04a", fall: 2.4 },
  // Oranges hang green all summer: a pale green, so they still read against the leaves.
  orange: { size: [1.4, 1.4, 1.4], lift: -0.5, colors: ["#ff8a00", "#ff9e1a", "#f07000"], green: "#b8d468", fall: 2.6 },
  lemon: { size: [1.15, 1.5, 1.15], lift: -0.55, colors: ["#fff23a", "#fff680", "#f0dc20"], green: "#7aa03e", fall: 2.6 },
  fig: { size: [1.3, 1.5, 1.3], lift: -0.4, colors: ["#5a2a4a", "#7a3c64", "#46203a"], green: "#a8b86a", fall: 2.2 },
  // Mangoes swing on long stalks, blushing from green through gold to red.
  mango: { size: [1.25, 1.8, 1.25], lift: -0.95, colors: ["#f0a020", "#e8602a", "#c8c03a"], green: "#6a9a3a", fall: 3 },
};
// Pussy-willow catkins stand up silver along the twig instead of hanging.
const WILLOW_CATKIN: OrnamentLook = { size: [0.28, 0.85, 0.28], lift: 0.45, colors: ["#e9e6cf", "#f2edb0", "#d8d4b8"], fall: 0.9 };
const NO_LOOK: OrnamentLook = { size: [1, 1, 1], lift: 0, fall: 0 };
/** Blue spruce cones: slim, papery and tan, flushed purple while young, never apple green. */
const SPRUCE_CONE: OrnamentLook = { ...(ORNAMENTS.cone ?? NO_LOOK), size: [0.4, 1.0, 0.4], colors: ["#a58256", "#8f6c46", "#b8966a"], green: "#7a5f55" };

export function ornamentLook(spec: OrnamentSpecLike, speciesId = ""): OrnamentLook {
  if (spec.kind === "catkin" && speciesId === "willow") return WILLOW_CATKIN;
  if (spec.kind === "cone" && speciesId === "spruce") return SPRUCE_CONE;
  return ORNAMENTS[spec.kind] ?? NO_LOOK;
}

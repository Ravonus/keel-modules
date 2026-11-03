// What a finish adds inside a stage's own materials, since a post sees only pixels: sunlight through leaves and
// blades, and the colour of every surface muted and varied in patches across the world. Chained onto each
// material's own onCompile (flora's and tree-render's carry their wind and seasons there), never replacing it.

import type { Uniform } from "./lit.js";

interface ShaderLike {
  readonly uniforms: Record<string, Uniform>;
  vertexShader: string;
  fragmentShader: string;
}
export interface DressMaterialLike {
  onCompile?: ((shader: ShaderLike, renderer: unknown) => void) | undefined;
  customProgramCacheKey?: (() => string) | undefined;
  readonly side?: unknown;
  readonly alphaTest?: number;
  needsUpdate: boolean;
  readonly userData: Record<string, unknown>;
}
export interface DressNodeLike {
  readonly isMesh?: boolean;
  readonly material?: DressMaterialLike | readonly DressMaterialLike[];
  traverse(visit: (node: DressNodeLike) => void): void;
}

const VERTEX_HEAD = /* glsl */ `varying vec3 vFinishWorld;
`;
const VERTEX_WORLD = /* glsl */ `#include <project_vertex>
#ifdef USE_INSTANCING
  vFinishWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vFinishWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;

const FRAGMENT_HEAD = /* glsl */ `varying vec3 vFinishWorld;
uniform float uFinishTranslucency;
uniform float uFinishVariation;
uniform float uFinishMute;
float finishHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float finishNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(finishHash(i), finishHash(i + vec3(1, 0, 0)), f.x), mix(finishHash(i + vec3(0, 1, 0)), finishHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(finishHash(i + vec3(0, 0, 1)), finishHash(i + vec3(1, 0, 1)), f.x), mix(finishHash(i + vec3(0, 1, 1)), finishHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
`;
// Muted, then darker and lighter by the metre, then drier (warm) and damper (cool) by the ten metres.
const FRAGMENT_COLOUR = /* glsl */ `#include <color_fragment>
  {
    vec3 finishC = diffuseColor.rgb;
    finishC = mix(finishC, vec3(dot(finishC, vec3(0.2126, 0.7152, 0.0722))), uFinishMute);
    float finishBig = finishNoise(vFinishWorld * 0.12);
    finishC *= mix(1.0, 0.72 + 0.56 * finishNoise(vFinishWorld * 1.3 + 7.3), uFinishVariation);
    finishC = mix(finishC, finishC * vec3(1.14, 1.06, 0.74), uFinishVariation * smoothstep(0.5, 0.85, finishBig));
    finishC = mix(finishC, finishC * vec3(0.84, 0.96, 1.06), uFinishVariation * smoothstep(0.5, 0.15, finishBig));
    diffuseColor.rgb = finishC;
  }`;
// The first sun's light through a thin leaf: strongest looking into the sun, some on any side turned from it, and
// none where the sun's own shadow map says the leaf is shaded.
const FRAGMENT_THROUGH = /* glsl */ `#if NUM_DIR_LIGHTS > 0
  {
    vec3 finishL = directionalLights[0].direction;
    vec3 finishSun = directionalLights[0].color;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow finishShadow = directionalLightShadows[0];
      finishSun *= receiveShadow ? getShadow(directionalShadowMap[0], finishShadow.shadowMapSize, finishShadow.shadowIntensity, finishShadow.shadowBias, finishShadow.shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
    #endif
    float finishBack = pow(max(dot(-normalize(vViewPosition), finishL), 0.0), 4.0);
    float finishWrap = max(dot(-normal, finishL), 0.0);
    outgoingLight += diffuseColor.rgb * vec3(1.05, 1.1, 0.6) * finishSun * uFinishTranslucency * (0.35 * finishWrap + finishBack) * 0.5;
  }
#endif
#include <opaque_fragment>`;

/** A leaf or blade: drawn from both sides, or cut out of a card. */
function isFoliage(material: DressMaterialLike): boolean {
  return material.side === "both" || material.side === 2 || (material.alphaTest ?? 0) > 0;
}

function patch(shader: ShaderLike, uniforms: Record<string, Uniform>, foliage: boolean): void {
  const v = shader.vertexShader;
  const f = shader.fragmentShader;
  if (!v.includes("#include <project_vertex>") || !f.includes("#include <color_fragment>")) return;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = VERTEX_HEAD + v.replace("#include <project_vertex>", VERTEX_WORLD);
  let out = FRAGMENT_HEAD + f.replace("#include <color_fragment>", FRAGMENT_COLOUR);
  if (foliage && out.includes("#include <lights_fragment_begin>")) out = out.replace("#include <opaque_fragment>", FRAGMENT_THROUGH);
  shader.fragmentShader = out;
}

/**
 * Dresses one material once: its own onCompile runs first, then the finish's; its program key keeps its own.
 *
 * @param material A keel/lit material.
 * @param uniforms The finish's shared uniforms (uFinishTranslucency, uFinishVariation, uFinishMute).
 */
export function dressMaterial(material: DressMaterialLike, uniforms: Record<string, Uniform>): void {
  if (material.userData.litFinishDressed === true) return;
  const own = material.onCompile;
  const ownKey = material.customProgramCacheKey;
  const foliage = isFoliage(material);
  material.onCompile = (shader, renderer) => {
    own?.call(material, shader, renderer);
    patch(shader, uniforms, foliage);
  };
  // (Without its own key a material's program is keyed by its onCompile's text, which is now the finish's for all.)
  const key = ownKey ? ownKey.call(material) : String(own ?? "");
  material.customProgramCacheKey = () => `${key}|lit-finish${foliage ? "-leaf" : ""}`;
  material.userData.litFinishDressed = true;
  material.needsUpdate = true;
}

/**
 * Dresses every mesh's materials under a root; a material already dressed is left alone.
 *
 * @param root A stage or part of one.
 * @param uniforms The finish's shared uniforms.
 */
export function dressTree(root: DressNodeLike, uniforms: Record<string, Uniform>): void {
  root.traverse((node) => {
    if (node.isMesh !== true || node.material === undefined) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list as readonly DressMaterialLike[]) dressMaterial(material, uniforms);
  });
}

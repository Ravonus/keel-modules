// Impostor cards: the sprite ladder's far rungs, each tree a baked card row.

import type { InstancedLike, MaterialLike, NodeLike } from "../inputs.js";
import { TAU } from "../math.js";
import type { CardRow, ForestLitLike, RendererLike, Vector4Like } from "./forest.js";

// ---------------------------------------------------------------- impostor cards (the sprite ladder)

export const MAX_VARIANTS = 8;

const CARD_VERTEX = /* glsl */ `
#define MAXV ${String(MAX_VARIANTS)}
attribute vec2 aCard;
uniform vec3 uBox[MAXV];
uniform float uFrames, uRows;
varying vec2 vCardUv;
varying float vTint, vLodDistance, vViewDepth, vFogDepth;
void main() {
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  vec3 box = uBox[int(aCard.x + 0.5)];
  vec3 toCamera = cameraPosition - origin;
  vec3 dir = normalize(vec3(toCamera.x, 0.0, toCamera.z) + vec3(1e-5, 0.0, 0.0));
  vec3 right = vec3(dir.z, 0.0, -dir.x);
  // Pick the baked view nearest the camera's angle round this tree.
  float view = atan(dir.x, dir.z) - yaw;
  float frame = mod(floor(view / 6.2831853 * uFrames + 0.5), uFrames);
  vec3 world = origin + right * position.x * box.x * 2.0 * scale + vec3(0.0, ((position.y + 0.5) * box.y + box.z) * scale, 0.0);
  vCardUv = vec2((frame + position.x + 0.5) / uFrames, (aCard.x + position.y + 0.5) / uRows);
  vTint = aCard.y;
  vLodDistance = length(toCamera);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vViewDepth = -mv.z;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const CARD_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uLight;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform vec4 uLod;
varying vec2 vCardUv;
varying float vTint, vLodDistance, vViewDepth, vFogDepth;
float forestBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
void main() {
  float t = forestBayer(gl_FragCoord.xy);
  // The card takes over exactly where the geometry dithers away.
  if (smoothstep(uLod.x + uLod.y, uLod.x - uLod.y, vLodDistance) > t) discard;
  if (smoothstep(uLod.z, uLod.w, vViewDepth) < t) discard;
  vec4 texel = texture2D(uAtlas, vCardUv);
  if (texel.a < 0.5) discard;
  vec3 color = texel.rgb * uLight * vTint;
  float fog = uFog.y > uFog.x ? smoothstep(uFog.x, uFog.y, vFogDepth) : 0.0;
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}`;

export interface Cards {
  readonly mesh: InstancedLike;
  readonly material: MaterialLike;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly card: Float32Array;
  readonly target: InstanceType<ForestLitLike["RenderTarget"]>;
  readonly frames: number;
  readonly cell: number;
  /** The tree shapes the atlas is rendered from, kept while cards are drawn: the seasons re-render it. */
  readonly rows: readonly CardRow[];
  readonly capacity: number;
  key: string;
  idle: number;
}

/** How the cards are drawn: views round each tree, the pixel size of one, and the distance they take over at. */
export interface CardSheet {
  readonly frames?: number | undefined;
  readonly cell?: number | undefined;
  readonly lod: Vector4Like;
}

export function createCards(lit: ForestLitLike, baked: readonly CardRow[], count: number, sheet: CardSheet): Cards {
  const { lod } = sheet;
  const frames = sheet.frames ?? 8;
  const cell = sheet.cell ?? 160;
  const target = new lit.RenderTarget(frames * cell, baked.length * cell, { depthBuffer: true });
  const boxes = Array.from({ length: MAX_VARIANTS }, (_, i) => {
    const box = baked[i]?.box;
    return new lit.Vector3(box?.half ?? 1, box?.height ?? 1, box?.base ?? 0);
  });
  const uniforms: Record<string, { value: unknown }> = {
    uAtlas: { value: target.texture },
    uFrames: { value: frames },
    uRows: { value: baked.length },
    uBox: { value: boxes },
    uLight: { value: new lit.Vector3(1, 1, 1) },
    uFogColor: { value: new lit.Vector3(1, 1, 1) },
    uFog: { value: { x: 0, y: 0 } },
    uLod: { value: lod },
  };
  const material = new lit.CustomMaterial({
    uniforms,
    vertexShader: CARD_VERTEX,
    fragmentShader: CARD_FRAGMENT,
    side: "both",
  });
  const card = new Float32Array(Math.max(1, count) * 2);
  const geometry = lit.plane(1, 1);
  geometry.setAttribute("aCard", new lit.InstanceAttribute(card, 2));
  const mesh = new lit.Instances(geometry, material, Math.max(1, count));
  mesh.frustumCulled = false;
  mesh.count = 0;
  return {
    mesh,
    material,
    uniforms,
    card,
    target,
    frames,
    cell,
    rows: baked,
    capacity: Math.max(1, count),
    key: "",
    idle: 0,
  };
}

/** Renders every variant from `frames` angles round it into one atlas row each. */
export function bakeCards(lit: ForestLitLike, renderer: RendererLike, cards: Cards, baked: readonly CardRow[]): void {
  const scene = new lit.Stage();
  const hemi = new lit.SkyLight("#ffffff", "#5a5a50", 1.9);
  const key = new lit.SunLight("#ffffff", 2.4);
  scene.add(hemi, key);
  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new lit.Color());
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(cards.target);
  renderer.setClearColor(new lit.Color("#000000"), 0);
  cards.target.scissorTest = false;
  cards.target.viewport.set(0, 0, cards.frames * cards.cell, baked.length * cards.cell);
  renderer.setRenderTarget(cards.target);
  renderer.clear(true, true, false);
  const stage: BakeStage = { lit, renderer, cards, scene, light: key };
  baked.forEach((variant, row) => {
    bakeRow(stage, variant, row);
  });
  cards.target.scissorTest = false;
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
  renderer.autoClear = autoClear;
}

/** The lit stage every row is baked on: the scene, its key light and the atlas target. */
interface BakeStage {
  readonly lit: ForestLitLike;
  readonly renderer: RendererLike;
  readonly cards: Cards;
  readonly scene: NodeLike;
  readonly light: NodeLike;
}

function bakeRow(stage: BakeStage, variant: CardRow, row: number): void {
  const { lit, renderer, cards, scene, light } = stage;
  const { half, height, base } = variant.box;
  const mesh = new lit.Mesh(variant.geometry, variant.material);
  scene.add(mesh);
  const camera = new lit.OrthoCamera(-half, half, height / 2, -height / 2, 0.01, half * 8);
  const centre = base + height / 2;
  for (let frame = 0; frame < cards.frames; frame += 1) {
    const angle = (frame / cards.frames) * TAU;
    camera.position.set(Math.sin(angle) * half * 4, centre, Math.cos(angle) * half * 4);
    camera.lookAt(0, centre, 0);
    camera.updateProjectionMatrix();
    light.position.set(Math.sin(angle + 0.6) * 4, 6, Math.cos(angle + 0.6) * 4);
    cards.target.viewport.set(frame * cards.cell, row * cards.cell, cards.cell, cards.cell);
    cards.target.scissor.set(frame * cards.cell, row * cards.cell, cards.cell, cards.cell);
    cards.target.scissorTest = true;
    renderer.setRenderTarget(cards.target);
    renderer.clear(false, true, false);
    renderer.render(scene, camera);
  }
  scene.remove(mesh);
}

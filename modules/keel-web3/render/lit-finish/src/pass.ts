// The finish bound to a renderer. Each frame: the scene, jittered, into a multisampled linear target with depth; AO
// from that depth at half size; the light (AO, haze, exposure) in linear HDR; TAA against the last frame; bloom at
// quarter size; and the grade onto the canvas. Every so often the stage's materials are dressed (dress.ts).

import { AO_GLSL, BLUR_GLSL, BRIGHT_GLSL, GRADE_GLSL, LIGHT_GLSL, TAA_GLSL, VERTEX_GLSL } from "./finish.glsl.js";
import { dressTree } from "./dress.js";
import type { DressNodeLike } from "./dress.js";
import type { CameraLike, DisposableLike, LitLike, RendererLike, RenderTargetLike, SceneLike, ShaderMaterialLike, Uniform } from "./lit.js";
import { TONEMAPS, aoKernel, directionInView, ditherShiftAt, finishSettings, jitterAt, linearColour, multiply4 } from "./settings.js";
import type { FinishSettings } from "./settings.js";

/** The air a finish draws in: its colour ("#rrggbb" or linear RGB), how much per metre and where it starts. */
export interface Haze {
  readonly colour?: unknown;
  readonly density?: number;
  readonly start?: number;
}

export interface LitFinish {
  readonly settings: FinishSettings;
  setSettings(input?: unknown): FinishSettings;
  /** The canvas's CSS size and pixel ratio (the renderer's). */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** The sun's direction toward it, in world space, and its colour (linear; only its hue counts). */
  setSun(direction: readonly number[], colour?: unknown): void;
  /** The air's colour, and optionally its density and start, which override the settings'. */
  setHaze(haze: Haze): void;
  /** Dresses a stage's materials now (render does it every 30 frames for the scene it draws). */
  dress(root: unknown): void;
  /** Whole pixels a dithered fade should move by this frame, so TAA resolves it (0, 0 without TAA). */
  ditherOffset(): [number, number];
  render(scene: unknown, camera: CameraLike): void;
  /** What the canvas shows: the finished picture (default), or the AO alone, for tuning. */
  setView(view: "final" | "ao"): void;
  dispose(): void;
}

interface Pass {
  readonly scene: SceneLike;
  readonly material: ShaderMaterialLike;
}

const PASSES = {
  ao: AO_GLSL, light: LIGHT_GLSL, taa: TAA_GLSL, bright: BRIGHT_GLSL, blur: BLUR_GLSL, grade: GRADE_GLSL,
};
type PassName = keyof typeof PASSES;

function createPass(
  lit: LitLike,
  geometry: DisposableLike,
  uniforms: Record<string, Uniform>,
  fragmentShader: string,
): Pass {
  const material = new lit.CustomMaterial({
    uniforms,
    vertexShader: VERTEX_GLSL,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new lit.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new lit.Stage();
  scene.add(quad);
  return { scene, material };
}

function createUniforms(): Record<string, Uniform> {
  const vec2 = (x = 1, y = 1): Uniform => ({ value: [x, y] });
  const vec3 = (x: number, y: number, z: number): Uniform => ({ value: [x, y, z] });
  const number = (value: number): Uniform => ({ value });
  const identity = (): Uniform => ({ value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  return {
    tColor: number(0), tDepth: number(0), tAo: number(0), tCurrent: number(0), tHistory: number(0),
    tResolved: number(0), tBloom: number(0), tBlur: number(0),
    uNear: number(0.1), uFar: number(100), uOrtho: number(0), uProj: vec2(),
    uSize: vec2(), uAoSize: vec2(), uBloomSize: vec2(), uTexel: vec2(),
    uRadius: number(0.6), uKernel: { value: aoKernel() },
    uAo: number(0.8), uExposure: number(1), uTone: number(0),
    uHaze: vec3(0.6, 0.7, 0.85), uHazeDensity: number(0), uHazeStart: number(0), uHazeGlow: number(0),
    uSunDir: vec3(0, 0, -1), uSunColour: vec3(1, 0.95, 0.85),
    uInvView: identity(), uPrevViewProj: identity(), uBlend: number(1), uReset: number(1),
    uThreshold: number(1), uBloom: number(0), uDir: vec2(1, 0),
    uSaturation: number(1), uContrast: number(1), uWarmth: number(0), uVignette: number(0), uView: number(0),
  };
}

function set(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

/** The settings into the shaders and the dressed materials; a haze the host set keeps its own density and start. */
function writeSettings(u: Record<string, Uniform>, d: Record<string, Uniform>, s: FinishSettings, haze: Haze): void {
  const values: readonly (readonly [string, unknown])[] = [
    ["uAo", s.ao], ["uRadius", s.aoRadius], ["uExposure", s.exposure], ["uTone", TONEMAPS.indexOf(s.tonemap)],
    ["uHazeDensity", haze.density ?? s.hazeDensity], ["uHazeStart", haze.start ?? s.hazeStart],
    ["uHazeGlow", s.hazeGlow], ["uSaturation", s.saturation], ["uContrast", s.contrast], ["uWarmth", s.warmth],
    ["uVignette", s.vignette], ["uBloom", s.bloom], ["uThreshold", s.bloomThreshold], ["uBlend", s.taa ? s.taaBlend : 1],
  ];
  for (const [name, value] of values) set(u, name, value);
  set(d, "uFinishTranslucency", s.translucency);
  set(d, "uFinishVariation", s.variation);
  set(d, "uFinishMute", s.mute);
}

interface Targets {
  readonly world: RenderTargetLike;
  readonly ao: RenderTargetLike;
  readonly hdr: RenderTargetLike;
  readonly history: readonly [RenderTargetLike, RenderTargetLike];
  readonly bloom: readonly [RenderTargetLike, RenderTargetLike];
}

function createTargets(lit: LitLike): Targets {
  const linear = { minFilter: "linear", magFilter: "linear", generateMipmaps: false };
  const flat = { ...linear, type: "half", depthBuffer: false };
  const depthTexture = new lit.DepthTexture(1, 1);
  const target = (options: Readonly<Record<string, unknown>>): RenderTargetLike => new lit.RenderTarget(1, 1, options);
  return {
    world: target({ ...linear, type: "half", samples: 4, depthBuffer: true, depthTexture }),
    ao: target({ ...linear, depthBuffer: false }),
    hdr: target(flat),
    history: [target(flat), target(flat)],
    bloom: [target(flat), target(flat)],
  };
}

function sizeTargets(targets: Targets, uniforms: Record<string, Uniform>, width: number, height: number): void {
  const half = [Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2))] as const;
  const quarter = [Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(height / 4))] as const;
  targets.world.setSize(width, height);
  targets.ao.setSize(half[0], half[1]);
  for (const t of [targets.hdr, ...targets.history]) t.setSize(width, height);
  for (const t of targets.bloom) t.setSize(quarter[0], quarter[1]);
  set(uniforms, "uSize", [width, height]);
  set(uniforms, "uAoSize", [half[0], half[1]]);
  set(uniforms, "uBloomSize", [quarter[0], quarter[1]]);
  set(uniforms, "uTexel", [1 / width, 1 / height]);
  set(uniforms, "uReset", 1);
}

/** What one frame keeps for the next: its number, which history is current, the last view-projection, the size. */
interface Frame {
  index: number;
  flip: 0 | 1;
  previous: number[] | null;
  size: readonly [number, number];
}

/** The scene drawn with this frame's subpixel jitter in the projection (clip units), then the projection given back. */
function drawJittered(
  renderer: RendererLike,
  scene: unknown,
  camera: CameraLike,
  jitter: readonly [number, number] | null,
): void {
  const p = camera.projectionMatrix.elements as unknown as number[];
  const [ix, iy] = camera.isOrthographicCamera === true ? [12, 13] : [8, 9];
  const keep = [p[ix] ?? 0, p[iy] ?? 0] as const;
  if (jitter) {
    p[ix] = keep[0] + jitter[0];
    p[iy] = keep[1] + jitter[1];
  }
  renderer.render(scene, camera);
  p[ix] = keep[0];
  p[iy] = keep[1];
}

/** The camera into the shaders; returns its view-projection, for next frame's reprojection. */
function writeCamera(uniforms: Record<string, Uniform>, camera: CameraLike, sun: readonly number[]): number[] {
  const p = camera.projectionMatrix.elements;
  set(uniforms, "uNear", camera.near);
  set(uniforms, "uFar", camera.far);
  set(uniforms, "uOrtho", camera.isOrthographicCamera === true ? 1 : 0);
  set(uniforms, "uProj", [p[0] ?? 1, p[5] ?? 1]);
  set(uniforms, "uSunDir", directionInView(sun, camera.matrixWorldInverse.elements));
  set(uniforms, "uInvView", Array.from(camera.matrixWorld.elements));
  return multiply4(p, camera.matrixWorldInverse.elements);
}

interface Chain {
  readonly renderer: RendererLike;
  readonly passes: Readonly<Record<PassName, Pass>>;
  readonly targets: Targets;
  readonly uniforms: Record<string, Uniform>;
  readonly quad: unknown;
  readonly geometry: DisposableLike;
}

function pass(chain: Chain, name: PassName, target: RenderTargetLike | null): void {
  chain.renderer.setRenderTarget(target);
  chain.renderer.render(chain.passes[name].scene, chain.quad);
}

/** The resolved picture's bloom: bright at quarter size, then blurred across and down. */
function drawBloom(chain: Chain): void {
  const { targets, uniforms } = chain;
  pass(chain, "bright", targets.bloom[0]);
  set(uniforms, "tBlur", targets.bloom[0].texture);
  set(uniforms, "uDir", [1, 0]);
  pass(chain, "blur", targets.bloom[1]);
  set(uniforms, "tBlur", targets.bloom[1].texture);
  set(uniforms, "uDir", [0, 1]);
  pass(chain, "blur", targets.bloom[0]);
}

/** Everything after the scene: AO, light, TAA, bloom and the grade onto `out`. */
function drawChain(chain: Chain, frame: Frame, settings: FinishSettings, out: RenderTargetLike | null): void {
  const { targets, uniforms } = chain;
  pass(chain, "ao", targets.ao);
  pass(chain, "light", targets.hdr);
  let resolved = targets.hdr;
  if (settings.taa) {
    const next = targets.history[frame.flip];
    set(uniforms, "tCurrent", targets.hdr.texture);
    set(uniforms, "tHistory", targets.history[frame.flip === 0 ? 1 : 0].texture);
    pass(chain, "taa", next);
    set(uniforms, "uReset", 0);
    resolved = next;
  } else set(uniforms, "uReset", 1);
  set(uniforms, "tResolved", resolved.texture);
  if (settings.bloom > 0) drawBloom(chain);
  set(uniforms, "tBloom", targets.bloom[0].texture);
  pass(chain, "grade", out);
}

function disposeChain(chain: Chain): void {
  const t = chain.targets;
  t.world.depthTexture?.dispose();
  for (const target of [t.world, t.ao, t.hdr, ...t.history, ...t.bloom]) target.dispose();
  for (const p of Object.values(chain.passes)) p.material.dispose();
  chain.geometry.dispose();
}

function createChain(lit: LitLike, renderer: RendererLike, uniforms: Record<string, Uniform>): Chain {
  const targets = createTargets(lit);
  set(uniforms, "tColor", targets.world.texture);
  set(uniforms, "tDepth", targets.world.depthTexture);
  set(uniforms, "tAo", targets.ao.texture);
  const geometry = lit.plane(2, 2);
  const passes = Object.fromEntries(
    Object.entries(PASSES).map(([name, glsl]) => [name, createPass(lit, geometry, uniforms, glsl)]),
  ) as Record<PassName, Pass>;
  return { renderer, passes, targets, uniforms, quad: new lit.OrthoCamera(-1, 1, 1, -1, 0, 1), geometry };
}

/** One frame: dress now and then, the scene jittered, then the chain onto whatever target the host had. */
interface Shot {
  readonly scene: unknown;
  readonly camera: CameraLike;
  readonly sun: readonly number[];
}

function drawFrame(chain: Chain, frame: Frame, shot: Shot, settings: FinishSettings): void {
  const { renderer, uniforms } = chain;
  const previous = renderer.getRenderTarget();
  const [jx, jy] = jitterAt(frame.index);
  renderer.setRenderTarget(chain.targets.world);
  const jitter = settings.taa ? ([(2 * jx) / frame.size[0], (2 * jy) / frame.size[1]] as const) : null;
  drawJittered(renderer, shot.scene, shot.camera, jitter);
  const viewProj = writeCamera(uniforms, shot.camera, shot.sun);
  set(uniforms, "uPrevViewProj", frame.previous ?? viewProj);
  drawChain(chain, frame, settings, previous);
  frame.previous = viewProj;
  frame.flip = frame.flip === 0 ? 1 : 0;
  frame.index += 1;
}

/**
 * Binds a lit finish to a renderer: AO, aerial haze, light through leaves, colour variation, TAA, bloom, a tone map
 * and a grade over a keel/lit stage. The renderer's own tone mapping should be "none"; the finish does its own.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The renderer that owns the canvas.
 * @param input Settings, normalized through `finishSettings`.
 */
export function createLitFinish(lit: LitLike, renderer: RendererLike, input?: unknown): LitFinish {
  let settings = finishSettings(input);
  let haze: Haze = {};
  let sun: readonly number[] = [0.4, 0.8, 0.3];
  const uniforms = createUniforms();
  const dressing: Record<string, Uniform> = {
    uFinishTranslucency: { value: 0 }, uFinishVariation: { value: 0 }, uFinishMute: { value: 0 },
  };
  const chain = createChain(lit, renderer, uniforms);
  const frame: Frame = { index: 0, flip: 0, previous: null, size: [1, 1] };
  writeSettings(uniforms, dressing, settings, haze);
  return {
    get settings() { return settings; },
    setSettings(next) {
      settings = finishSettings(next);
      writeSettings(uniforms, dressing, settings, haze);
      return settings;
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      const px = (css: number): number => Math.max(1, Math.round(css * devicePixelRatio));
      frame.size = [px(cssWidth), px(cssHeight)];
      sizeTargets(chain.targets, uniforms, frame.size[0], frame.size[1]);
    },
    setSun(direction, colour) {
      sun = direction;
      const c = linearColour(colour, [1, 0.95, 0.85]);
      const top = Math.max(c[0], c[1], c[2], 1e-6);
      set(uniforms, "uSunColour", [c[0] / top, c[1] / top, c[2] / top]);
    },
    setHaze(next) {
      haze = next;
      if (next.colour !== undefined) set(uniforms, "uHaze", linearColour(next.colour, [0.6, 0.7, 0.85]));
      writeSettings(uniforms, dressing, settings, haze);
    },
    dress(root) { dressTree(root as DressNodeLike, dressing); },
    ditherOffset() { return settings.taa ? ditherShiftAt(frame.index) : [0, 0]; },
    render(scene, camera) {
      if (frame.index % 30 === 0) dressTree(scene as DressNodeLike, dressing);
      drawFrame(chain, frame, { scene, camera, sun }, settings);
    },
    setView(view) { set(uniforms, "uView", view === "ao" ? 1 : 0); },
    dispose() { disposeChain(chain); },
  };
}

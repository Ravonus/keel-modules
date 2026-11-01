// The pass: targets, uniforms and the pipeline that draws the scene, its look and its rays.

import { HEX, SCREENS, bandScreens, bounded, depthBandsOf, ditherSettings, resolveGrid } from "./settings.js";
import type { DitherSettings, PixelGrid } from "./settings.js";
import { hexChannels, paletteUniform } from "./screens.js";
import { BLIT_GLSL, FRAGMENT_GLSL, VERTEX_GLSL } from "./dither.glsl.js";
import { createCelShader, screenLight } from "./light.js";
import type { RaySpec } from "./light.js";
import type {
  CameraLike, DisposableLike, LitLike, NodeLike, RenderTargetLike, RendererLike, SceneLike, ShaderMaterialLike,
  Uniform,
} from "./lit.js";
import { DETAIL_MASK, filterUniform, layerDetail, signalUniform, tagTree } from "./signals.js";
import type { SignalPart, SignalSpec } from "./signals.js";

// ---------------------------------------------------------------- the pass

/** A live dithered-voxel look bound to one renderer. */
export interface VoxelDither {
  readonly settings: DitherSettings;
  readonly grid: PixelGrid;
  /** Replaces the look; returns the normalized settings. Call `shade` again if `shading` or `bands` changed. */
  setSettings(input?: unknown): DitherSettings;
  /** Moves the near/mid and mid/far boundaries (view distances) without re-resolving the look; cheap enough per frame. */
  setDepthBands(near: number, far: number): void;
  /** Sizes the grid for a frame of this many CSS pixels. The renderer's canvas must already be that size. */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): PixelGrid;
  /** Swaps every lit mesh material under `root` to the look's shading (cel toon ramps or the scene's own). */
  shade(root: NodeLike): void;
  /** Sets (or clears, with null) the light the god rays stream from; cheap enough per frame. */
  setRays(rays: RaySpec | null): void;
  /** Sets the clock, in seconds, that rolls the scanlines and times glitch bursts; cheap enough per frame. */
  setTime(seconds: number): void;
  /**
   * Tags every opaque mesh material under `root` as one part, so that part can
   * carry its own signal. Call it again after `shade`, which swaps materials.
   */
  tagSignal(root: NodeLike, part: SignalPart): void;
  /** Sets the signal of parts 1 to 3 (null for none), on top of the look's own whole-frame settings. */
  setSignals(parts: readonly (SignalSpec | null | undefined)[]): void;
  /**
   * Draws everything under `root` on the detail grid (see `detail`), over the
   * world by depth. Meshes added under it later are picked up each frame.
   */
  tagDetail(root: NodeLike): void;
  /** Draws `scene` from `camera` through the look into the renderer's current target. */
  render(scene: unknown, camera: CameraLike): void;
  dispose(): void;
}

function createUniforms(): Record<string, Uniform> {
  return {
    tColor: { value: null },
    tDepth: { value: null },
    uGrid: { value: [1, 1] },
    uPixel: { value: 1 },
    uOrigin: { value: [0, 0] },
    uScreen: { value: [2, 3, 8] },
    uScale: { value: [1, 1, 1] },
    uAmount: { value: [1, 1, 1] },
    uBands: { value: [18, 30] },
    uLevels: { value: 6 },
    uSnap: { value: 0 },
    uLift: { value: 0 },
    uClump: { value: 0 },
    uRamp: { value: 0 },
    uLuma: { value: 1 },
    uPaletteSize: { value: 0 },
    uAccentSize: { value: 0 },
    uAccent: { value: new Float32Array(12) },
    uAccentLab: { value: new Float32Array(12) },
    uSkySaturation: { value: 1 },
    uPalette: { value: new Float32Array(96) },
    uPaletteLab: { value: new Float32Array(96) },
    uOutline: { value: 0.9 },
    uOutlineColor: { value: [0, 0, 0, 0] },
    uCrease: { value: 0.35 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uSkyFrom: { value: 100 },
    uRaySource: { value: [0.5, 0.5] },
    uRayColor: { value: [1, 1, 1] },
    uRayStrength: { value: 0 },
    uRayDecay: { value: 0.95 },
    uRayDensity: { value: 0.8 },
    tLook: { value: null },
    uScanlines: { value: 0 },
    uChroma: { value: 0 },
    uGlitch: { value: 0 },
    uTime: { value: 0 },
    uSignal: { value: new Float32Array(9) },
    uFilter: { value: new Float32Array(6) },
    tDetail: { value: null },
    tDetailDepth: { value: null },
    tCoarse: { value: null },
    uFine: { value: 1 },
    uPass: { value: 0 },
  };
}

function writeLook(uniforms: Record<string, Uniform>, settings: DitherSettings, grid: PixelGrid): void {
  const bands = bandScreens(settings, Math.min(grid.width, grid.height));
  const order = [bands.near, bands.mid, bands.far];
  const palette = paletteUniform(settings.palette);
  const set = (name: string, value: unknown): void => { const uniform = uniforms[name]; if (uniform !== undefined) uniform.value = value; };
  set("uScreen", order.map((band) => SCREENS.indexOf(band.screen)));
  set("uScale", order.map((band) => band.scale));
  set("uAmount", order.map((band) => band.amount));
  set("uBands", [...settings.depthBands]);
  set("uLevels", settings.levels);
  set("uSnap", settings.snap);
  set("uLift", settings.lift);
  set("uClump", settings.clump);
  set("uRamp", settings.ramp);
  set("uLuma", settings.color === "luma" ? 1 : 0);
  set("uPalette", palette.data);
  set("uPaletteLab", palette.lab);
  set("uPaletteSize", palette.size);
  const accent = paletteUniform(settings.accent);
  set("uAccent", accent.data.subarray(0, 12));
  set("uAccentLab", accent.lab.subarray(0, 12));
  set("uAccentSize", accent.size);
  set("uSkySaturation", settings.skySaturation);
  set("uOutline", settings.outline);
  set("uOutlineColor", settings.outlineColor === null ? [0, 0, 0, 0] : [...hexChannels(settings.outlineColor), 1]);
  set("uCrease", settings.crease);
  set("uContrast", settings.contrast);
  set("uSaturation", settings.saturation);
  set("uScanlines", settings.scanlines);
  set("uChroma", settings.chroma);
  set("uGlitch", settings.glitch);
  set("uGrid", [grid.width, grid.height]);
  set("uPixel", grid.pixel);
  set("uOrigin", [grid.originX, grid.originY]);
}

/** The scene target (linear light and depth), or the look target (stepped sRGB). */
function createTarget(lit: LitLike, scene: boolean): RenderTargetLike {
  const filters = { minFilter: "nearest", magFilter: "nearest", generateMipmaps: false };
  if (!scene) return new lit.RenderTarget(1, 1, { ...filters, depthBuffer: false });
  return new lit.RenderTarget(1, 1, { ...filters, type: "half", depthBuffer: true, depthTexture: new lit.DepthTexture(1, 1) });
}

interface Pass {
  readonly scene: SceneLike;
  readonly material: ShaderMaterialLike;
}

/** A full-screen quad drawn with one fragment shader. */
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

function writeRays(uniforms: Record<string, Uniform>, rays: RaySpec | null, view: CameraLike, scale: number): void {
  const strength = uniforms.uRayStrength;
  if (strength === undefined) return;
  if (rays === null || view.matrixWorldInverse === undefined || view.projectionMatrix === undefined) {
    strength.value = 0;
    return;
  }
  const light = screenLight(view.matrixWorldInverse.elements, view.projectionMatrix.elements, rays.direction);
  strength.value = Math.max(0, rays.strength) * scale * Math.min(1, light.facing * 2.5);
  Object.assign(uniforms.uRaySource ?? {}, { value: [light.x, light.y] });
  Object.assign(uniforms.uRayColor ?? {}, { value: [...hexChannels(HEX.test(rays.color) ? rays.color : "#ffffff")] });
  Object.assign(uniforms.uRayDecay ?? {}, { value: bounded(rays.decay, 0.85, 0.995, 0.95) });
  Object.assign(uniforms.uRayDensity ?? {}, { value: bounded(rays.density, 0.2, 1, 0.8) });
}

interface Pipeline {
  resize(grid: PixelGrid): void;
  draw(
    renderer: RendererLike,
    scene: unknown,
    view: CameraLike,
    settings: DitherSettings,
    rays: RaySpec | null,
    detail: ReadonlySet<NodeLike>,
  ): void;
  dispose(): void;
}

/** Sets a uniform the passes share; its value is read when a pass draws. */
function setUniform(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

/** Draws the scene from `view` with only the layers in `mask`, then gives the camera its own back. */
function renderLayers(renderer: RendererLike, scene: unknown, view: CameraLike, mask: number): void {
  const layers = view.layers;
  const own = layers?.mask ?? 1;
  if (layers) layers.mask = mask;
  renderer.render(scene, view);
  if (layers) layers.mask = own;
}

interface Targets {
  readonly world: RenderTargetLike;
  readonly look: RenderTargetLike;
  readonly detail: RenderTargetLike;
  readonly detailLook: RenderTargetLike;
}

/** The world into its grid target and, when split, the detail parts alone into theirs. */
function drawScene(renderer: RendererLike, scene: unknown, view: CameraLike, targets: Targets, fine: boolean): void {
  const own = view.layers?.mask ?? 1;
  renderer.setRenderTarget(targets.world);
  renderLayers(renderer, scene, view, fine ? own & ~DETAIL_MASK : own);
  if (!fine) return;
  renderer.setRenderTarget(targets.detail);
  renderLayers(renderer, scene, view, DETAIL_MASK);
}

/** The look at grid size and, when split, the detail parts' look over it; returns the target the blit shows. */
function drawLook(
  renderer: RendererLike,
  post: Pass,
  quad: unknown,
  uniforms: Record<string, Uniform>,
  targets: Targets,
  split: number,
): RenderTargetLike {
  setUniform(uniforms, "uFine", split);
  setUniform(uniforms, "uPass", 0);
  // A pass never samples its own target, so the world's look is bound only to the detail pass.
  setUniform(uniforms, "tCoarse", targets.detailLook.texture);
  renderer.setRenderTarget(targets.look);
  renderer.render(post.scene, quad);
  if (split <= 1) return targets.look;
  setUniform(uniforms, "uPass", 1);
  setUniform(uniforms, "tCoarse", targets.look.texture);
  renderer.setRenderTarget(targets.detailLook);
  renderer.render(post.scene, quad);
  return targets.detailLook;
}

/**
 * The targets and passes: the world -> grid target, the detail parts -> a
 * target uFine times finer, the look at grid size, the detail parts' look over
 * it at their size, and a blit to the frame. With no detail split, only the
 * world pass and the look at grid size run.
 */
function createPipeline(lit: LitLike, uniforms: Record<string, Uniform>): Pipeline {
  const targets: Targets = {
    world: createTarget(lit, true),
    look: createTarget(lit, false),
    detail: createTarget(lit, true),
    detailLook: createTarget(lit, false),
  };
  const { world: target, look: lookTarget, detail: detailTarget, detailLook } = targets;
  let split = 1;
  const camera: Readonly<Record<"near" | "far" | "ortho" | "sky", Uniform>> = { near: { value: 0.1 }, far: { value: 100 }, ortho: { value: 0 }, sky: { value: 100 } };
  Object.assign(uniforms, {
    tColor: { value: target.texture },
    tDepth: { value: target.depthTexture },
    tLook: { value: lookTarget.texture },
    tDetail: { value: detailTarget.texture },
    tDetailDepth: { value: detailTarget.depthTexture },
    tCoarse: { value: detailLook.texture },
    uNear: camera.near,
    uFar: camera.far,
    uOrtho: camera.ortho,
    uSkyFrom: camera.sky,
  });
  const geometry = lit.plane(2, 2);
  const post = createPass(lit, geometry, uniforms, FRAGMENT_GLSL);
  const blit = createPass(lit, geometry, uniforms, BLIT_GLSL);
  const quadCamera = new lit.OrthoCamera(-1, 1, 1, -1, 0, 1);
  return {
    resize(grid) {
      split = grid.detail;
      target.setSize(grid.width, grid.height);
      lookTarget.setSize(grid.width, grid.height);
      const fine = split > 1 ? split : 1;
      detailTarget.setSize(grid.width * fine, grid.height * fine);
      detailLook.setSize(grid.width * fine, grid.height * fine);
    },
    draw(renderer, scene, view, settings, rays, detail) {
      const previous = renderer.getRenderTarget();
      const fine = split > 1 && detail.size > 0;
      layerDetail(detail, fine);
      drawScene(renderer, scene, view, targets, fine);
      camera.near.value = view.near;
      camera.far.value = view.far;
      camera.ortho.value = view.isOrthographicCamera === true ? 1 : 0;
      camera.sky.value = settings.skyDistance > 0 ? Math.min(settings.skyDistance, view.far * 0.999) : view.far * 0.999;
      writeRays(uniforms, rays, view, settings.rays);
      setUniform(uniforms, "tLook", drawLook(renderer, post, quadCamera, uniforms, targets, fine ? split : 1).texture);
      renderer.setRenderTarget(previous);
      renderer.render(blit.scene, quadCamera);
    },
    dispose() {
      target.depthTexture?.dispose();
      target.dispose();
      lookTarget.dispose();
      detailTarget.depthTexture?.dispose();
      detailTarget.dispose();
      detailLook.dispose();
      post.material.dispose();
      blit.material.dispose();
      geometry.dispose();
    },
  };
}

/**
 * Binds a dithered-voxel look to a renderer.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The WebGLRenderer that owns the canvas.
 * @param input Settings, normalized through `ditherSettings`.
 */
export function createVoxelDither(lit: LitLike, renderer: RendererLike, input?: unknown): VoxelDither {
  let settings = ditherSettings(input);
  let grid: PixelGrid = { width: 1, height: 1, pixel: 1, originX: 0, originY: 0, detail: 1 };
  let frame = { width: 1, height: 1, ratio: 1 };
  let rays: RaySpec | null = null;
  const detail = new Set<NodeLike>();
  const uniforms = createUniforms();
  const pipeline = createPipeline(lit, uniforms);
  const cel = createCelShader(lit, settings.bands);
  writeLook(uniforms, settings, grid);

  const look: VoxelDither = {
    get settings() { return settings; },
    get grid() { return grid; },
    setSettings(next) {
      const previous = settings;
      settings = ditherSettings(next);
      if (settings.bands !== previous.bands) cel.setBands(settings.bands);
      look.setSize(frame.width, frame.height, frame.ratio);
      return settings;
    },
    setDepthBands(near, far) {
      const [a, b] = depthBandsOf([near, far], settings.depthBands);
      if (a !== settings.depthBands[0] || b !== settings.depthBands[1]) settings = { ...settings, depthBands: [a, b] };
      Object.assign((uniforms.uBands?.value ?? []) as number[], [a, b]);
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      frame = { width: cssWidth, height: cssHeight, ratio: devicePixelRatio };
      grid = resolveGrid(cssWidth, cssHeight, devicePixelRatio, settings);
      pipeline.resize(grid);
      writeLook(uniforms, settings, grid);
      return grid;
    },
    shade(root) {
      root.traverse((node) => {
        if (node.isMesh !== true || node.material === undefined) return;
        node.material = Array.isArray(node.material)
          ? node.material.map((entry) => cel.swap(entry, settings.shading))
          : cel.swap(node.material, settings.shading);
      });
    },
    setRays(next) {
      rays = next;
    },
    setTime(seconds) { setUniform(uniforms, "uTime", Number.isFinite(seconds) ? seconds % 3600 : 0); },
    tagSignal(root, part) { tagTree(root, part); },
    setSignals(parts) {
      Object.assign(uniforms.uSignal ?? {}, { value: signalUniform(parts) });
      Object.assign(uniforms.uFilter ?? {}, { value: filterUniform(parts) });
    },
    tagDetail(root) { detail.add(root); },
    render(scene, view) {
      pipeline.draw(renderer, scene, view, settings, rays, detail);
    },
    dispose() {
      pipeline.dispose();
      cel.dispose();
    },
  };
  return look;
}

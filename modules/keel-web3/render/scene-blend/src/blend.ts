// The blend bound to a renderer. While 0 < t < 1 each scene goes through the shared finish into its own half-float
// target, then one pass blends the two onto whatever target the host had. Outside the overlap the one scene showing
// is drawn straight to the host's target, so a host can call `draw` every frame of a pair's life.

import { BLEND_GLSL, BLEND_VERTEX_GLSL } from "./blend.glsl.js";
import type {
  FinishLike, LitLike, RendererLike, RenderTargetLike, ShaderMaterialLike, TextureLike, Uniform,
} from "./lit.js";
import { NOISE_SIZE, noiseTexels } from "./noise.js";
import {
  blendFill, blendLines, blendSettings, currentAt, displayColour, farthestCorner, radialCentre,
} from "./settings.js";
import type { BlendSettings, Point } from "./settings.js";

/** A scene to draw: a stage and its camera (through the finish when there is one), or a function that draws it. */
export type Shot = { readonly scene: unknown; readonly camera: unknown } | (() => void);

/** How one frame of a hand-over looks. Every value is a plain number or point a host can feed from tracks. */
export interface DrawOptions {
  /** "noise" (default): a seeded noise threshold. "radial": out from `centre`. "fade": a plain dissolve. */
  readonly mode?: "noise" | "radial" | "fade";
  /** A radial reveal's centre, -1..1 each way with y up (a projected 3D point, say). The frame's centre by default. */
  readonly centre?: Point;
  /** The pointer, -1..1 each way with y up, or null when it is away. Pulls a radial centre toward it. */
  readonly pointer?: Point | null;
  /** Darkens the blended picture, 0..1. */
  readonly darken?: number;
  /** Overrides the line work from `blendLines(t)`: the incoming's and the outgoing's, each 0..1. */
  readonly lines?: { readonly in?: number; readonly out?: number };
}

export interface SceneBlend {
  readonly settings: BlendSettings;
  setSettings(input?: unknown): BlendSettings;
  /** The canvas's CSS size and pixel ratio (the renderer's, and the finish's). */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /**
   * Draws the hand-over from `a` (outgoing) to `b` (incoming) at `t` onto the renderer's current target.
   *
   * @returns The current scene: "a" before the switch at 0.5, "b" from it. Moving the active section is the host's.
   */
  draw(a: Shot, b: Shot, t: number, options?: DrawOptions): "a" | "b";
  dispose(): void;
}

const MODES = { noise: 0, radial: 1, fade: 2 } as const;
/** Blend frames between two dressings of both scenes, as the finish dresses the one it draws. */
const DRESS_EVERY = 30;

function createUniforms(): Record<string, Uniform> {
  const value = (v: unknown): Uniform => ({ value: v });
  return {
    tA: value(null), tB: value(null), tNoise: value(null), uSize: value([1, 1]), uMode: value(0), uFill: value(0),
    uLinesIn: value(0), uLinesOut: value(0), uDarken: value(0), uLine: value([1, 1, 1]), uSeam: value([1, 1, 1]),
    uGlow: value(1), uSeamWidth: value(0.03), uEdge: value(0.1), uNoiseScale: value(1), uCentre: value([0.5, 0.5]),
    uReach: value(1),
  };
}

function set(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

function writeSettings(uniforms: Record<string, Uniform>, s: BlendSettings): void {
  set(uniforms, "uLine", displayColour(s.lineColour));
  set(uniforms, "uSeam", displayColour(s.seamColour));
  set(uniforms, "uGlow", s.glow);
  set(uniforms, "uSeamWidth", s.seam);
  set(uniforms, "uEdge", s.edge);
  set(uniforms, "uNoiseScale", s.noiseScale);
}

/** This frame's values into the pass. */
function writeFrame(uniforms: Record<string, Uniform>, t: number, options: DrawOptions, settings: BlendSettings): void {
  const mode = options.mode ?? "noise";
  const [linesIn, linesOut] = blendLines(t);
  const size = uniforms.uSize?.value as readonly [number, number];
  const centre = radialCentre(options.centre ?? { x: 0, y: 0 }, options.pointer ?? null, settings.pull);
  set(uniforms, "uMode", MODES[mode]);
  set(uniforms, "uFill", mode === "fade" ? t : blendFill(t));
  set(uniforms, "uLinesIn", options.lines?.in ?? linesIn);
  set(uniforms, "uLinesOut", options.lines?.out ?? linesOut);
  set(uniforms, "uDarken", Math.min(1, Math.max(0, options.darken ?? 0)));
  set(uniforms, "uCentre", centre);
  set(uniforms, "uReach", farthestCorner(centre, size[0] / size[1]));
}

interface Parts {
  readonly targets: readonly [RenderTargetLike, RenderTargetLike];
  readonly material: ShaderMaterialLike;
  readonly scene: unknown;
  readonly camera: unknown;
  readonly dispose: () => void;
}

function createParts(lit: LitLike, uniforms: Record<string, Uniform>, depth: boolean, seed: number): Parts {
  const options = { type: "half", minFilter: "linear", magFilter: "linear", generateMipmaps: false, depthBuffer: depth };
  const targets = [new lit.RenderTarget(1, 1, options), new lit.RenderTarget(1, 1, options)] as const;
  set(uniforms, "tA", targets[0].texture);
  set(uniforms, "tB", targets[1].texture);
  set(uniforms, "tNoise", noiseTexture(lit, seed));
  const material = new lit.CustomMaterial({
    uniforms, vertexShader: BLEND_VERTEX_GLSL, fragmentShader: BLEND_GLSL, depthTest: false, depthWrite: false,
  });
  const geometry = lit.plane(2, 2);
  const quad = new lit.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new lit.Stage();
  scene.add(quad);
  const dispose = (): void => {
    for (const target of targets) target.dispose();
    (uniforms.tNoise?.value as TextureLike).dispose();
    material.dispose();
    geometry.dispose();
  };
  return { targets, material, scene, camera: new lit.OrthoCamera(-1, 1, 1, -1, 0, 1), dispose };
}

/** The seeded noise texture: tiling, filtered. */
function noiseTexture(lit: LitLike, seed: number): TextureLike {
  const noise = new lit.DataTexture(noiseTexels(seed), NOISE_SIZE, NOISE_SIZE, "rgba");
  noise.wrapS = "repeat";
  noise.wrapT = "repeat";
  noise.minFilter = "linear";
  noise.magFilter = "linear";
  noise.needsUpdate = true;
  return noise;
}

/** Rebuilds the noise texture for a new seed. */
function reseed(lit: LitLike, uniforms: Record<string, Uniform>, seed: number): void {
  const old = uniforms.tNoise?.value as TextureLike | null;
  set(uniforms, "tNoise", noiseTexture(lit, seed));
  old?.dispose();
}

/**
 * Binds a scene hand-over to a renderer: two scenes, each finished into its own half-float target, blended by a
 * seeded noise threshold or a radial reveal, the incoming arriving as line work and the outgoing leaving as it.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The renderer that owns the canvas.
 * @param finish The shared finish each scene is drawn through (lit-finish's), or null to draw scenes plain.
 * @param input Settings, normalized through `blendSettings`.
 */
export function createSceneBlend(
  lit: LitLike,
  renderer: RendererLike,
  finish: FinishLike | null = null,
  input?: unknown,
): SceneBlend {
  let settings = blendSettings(input);
  const uniforms = createUniforms();
  // (A finish draws a full-screen grade into the target, so it needs no depth; a plain scene does.)
  const parts = createParts(lit, uniforms, finish === null, settings.seed);
  writeSettings(uniforms, settings);
  let pausedTaa = false;
  let frames = 0;
  const shoot = (shot: Shot): void => {
    if (typeof shot === "function") shot();
    else if (finish !== null) finish.render(shot.scene, shot.camera);
    else renderer.render(shot.scene, shot.camera);
  };
  // One finish's TAA history cannot hold two scenes: it pauses for the overlap and resumes, reset, after it.
  const holdTaa = (blending: boolean): void => {
    if (finish?.settings === undefined || finish.setSettings === undefined) return;
    if (blending && finish.settings.taa === true) {
      finish.setSettings({ ...finish.settings, taa: false });
      pausedTaa = true;
    } else if (!blending && pausedTaa) {
      finish.setSettings({ ...finish.settings, taa: true });
      pausedTaa = false;
    }
  };
  const dressBoth = (a: Shot, b: Shot): void => {
    if (frames % DRESS_EVERY === 0 && finish?.dress !== undefined) {
      for (const shot of [a, b]) if (typeof shot !== "function") finish.dress(shot.scene);
    }
    frames += 1;
  };
  return {
    get settings() { return settings; },
    setSettings(next) {
      const before = settings.seed;
      settings = blendSettings(next);
      if (settings.seed !== before) reseed(lit, uniforms, settings.seed);
      writeSettings(uniforms, settings);
      return settings;
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      const px = (css: number): number => Math.max(1, Math.round(css * devicePixelRatio));
      const size = [px(cssWidth), px(cssHeight)] as const;
      for (const target of parts.targets) target.setSize(size[0], size[1]);
      set(uniforms, "uSize", size);
    },
    draw(a, b, t, options = {}) {
      const s = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
      if (s <= 0 || s >= 1) {
        holdTaa(false);
        shoot(s <= 0 ? a : b);
        return currentAt(s);
      }
      holdTaa(true);
      dressBoth(a, b);
      const host = renderer.getRenderTarget();
      renderer.setRenderTarget(parts.targets[0]);
      shoot(a);
      renderer.setRenderTarget(parts.targets[1]);
      shoot(b);
      writeFrame(uniforms, s, options, settings);
      renderer.setRenderTarget(host);
      renderer.render(parts.scene, parts.camera);
      return currentAt(s);
    },
    dispose() {
      holdTaa(false);
      parts.dispose();
    },
  };
}

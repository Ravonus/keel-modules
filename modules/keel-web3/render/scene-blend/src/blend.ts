// The blend bound to a renderer. While 0 < t < 1 the more visible scene goes through the main finish into a whole
// half-float target and the less visible one through the scaled finish (or the main one) into a second, then one pass
// blends the two onto whatever target the host had. Outside the overlap the one scene showing is drawn straight to
// the host's target, so a host can call `draw` every frame of a pair's life.

import { BLEND_GLSL, BLEND_VERTEX_GLSL } from "./blend.glsl.js";
import type {
  FinishLike, LitLike, RendererLike, RenderTargetLike, ShaderMaterialLike, TextureLike, Uniform,
} from "./lit.js";
import { NOISE_SIZE, noiseTexels } from "./noise.js";
import {
  blendFill, blendLines, blendSettings, currentAt, displayColour, farthestCorner, minorAt, radialCentre,
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

/**
 * The finishes a blend draws through: the main one, shared with the page, and optionally a second the blend sizes
 * itself at `scale`, for the less visible scene. A scaled finish may be set lighter (no bloom, say).
 */
export interface Finishes {
  readonly main: FinishLike;
  readonly scaled?: FinishLike;
}

export interface SceneBlend {
  readonly settings: BlendSettings;
  setSettings(input?: unknown): BlendSettings;
  /** The canvas's CSS size and pixel ratio (the renderer's, and the main finish's). Sizes the scaled finish too. */
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
    tA: value(null), tB: value(null), tNoise: value(null), uSize: value([1, 1]), uTexelA: value([1, 1]),
    uTexelB: value([1, 1]), uMode: value(0), uFill: value(0), uLinesIn: value(0), uLinesOut: value(0),
    uDarken: value(0), uLine: value([1, 1, 1]), uLineStrength: value(0.5), uEdge: value(0.05), uSoft: value(0.05),
    uSeam: value([1, 1, 1]), uGlow: value(0), uSeamWidth: value(0.05), uNoiseScale: value(1),
    uCentre: value([0.5, 0.5]), uReach: value(1),
  };
}

function set(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

function writeSettings(uniforms: Record<string, Uniform>, s: BlendSettings): void {
  const values: readonly (readonly [string, unknown])[] = [
    ["uLine", displayColour(s.lineColour)], ["uLineStrength", s.lines], ["uEdge", s.edge], ["uSoft", s.soft],
    ["uSeam", displayColour(s.seamColour)], ["uGlow", s.glow], ["uSeamWidth", s.seam], ["uNoiseScale", s.noiseScale],
  ];
  for (const [name, value] of values) set(uniforms, name, value);
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

/** The blend's two targets: one the frame's size, one at the scale, and the pass that blends them. */
interface Parts {
  readonly whole: RenderTargetLike;
  readonly scaled: RenderTargetLike;
  readonly material: ShaderMaterialLike;
  readonly scene: unknown;
  readonly camera: unknown;
  readonly dispose: () => void;
}

function createParts(lit: LitLike, uniforms: Record<string, Uniform>, depth: boolean, seed: number): Parts {
  const options = { type: "half", minFilter: "linear", magFilter: "linear", generateMipmaps: false, depthBuffer: depth };
  const whole = new lit.RenderTarget(1, 1, options);
  const scaled = new lit.RenderTarget(1, 1, options);
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
    whole.dispose();
    scaled.dispose();
    (uniforms.tNoise?.value as TextureLike).dispose();
    material.dispose();
    geometry.dispose();
  };
  return { whole, scaled, material, scene, camera: new lit.OrthoCamera(-1, 1, 1, -1, 0, 1), dispose };
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

/** The finishes as given: one, a main and a scaled, or none. */
function finishesOf(input: FinishLike | Finishes | null): { main: FinishLike | null; scaled: FinishLike | null } {
  if (input === null) return { main: null, scaled: null };
  if ("main" in input) return { main: input.main, scaled: input.scaled ?? null };
  return { main: input, scaled: null };
}

/** One finish's TAA history cannot hold two scenes: it pauses for the overlap and resumes, reset, after it. */
function createTaaHold(finishes: readonly (FinishLike | null)[]): (blending: boolean) => void {
  const paused = new Set<FinishLike>();
  return (blending) => {
    for (const finish of finishes) {
      if (finish?.settings === undefined || finish.setSettings === undefined) continue;
      if (blending && finish.settings.taa === true) {
        finish.setSettings({ ...finish.settings, taa: false });
        paused.add(finish);
      } else if (!blending && paused.delete(finish)) finish.setSettings({ ...finish.settings, taa: true });
    }
  };
}

/** Draws a shot onto the renderer's current target: itself, through a finish, or plain. */
function shoot(renderer: RendererLike, shot: Shot, through: FinishLike | null): void {
  if (typeof shot === "function") shot();
  else if (through !== null) through.render(shot.scene, shot.camera);
  else renderer.render(shot.scene, shot.camera);
}

/** The frame's size in pixels and the CSS size it came from, kept so a new scale can resize. */
interface Size {
  css: readonly [number, number];
  ratio: number;
  px: readonly [number, number];
  scaledPx: readonly [number, number];
}

/**
 * Binds a scene hand-over to a renderer: two scenes, each finished into its own half-float target, blended by a
 * seeded noise threshold or a radial reveal, the incoming arriving as line work and the outgoing leaving as it.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The renderer that owns the canvas.
 * @param finish The finish each scene is drawn through (lit-finish's), a main and a scaled one, or null to draw plain.
 * @param input Settings, normalized through `blendSettings`.
 */
export function createSceneBlend(
  lit: LitLike,
  renderer: RendererLike,
  finish: FinishLike | Finishes | null = null,
  input?: unknown,
): SceneBlend {
  let settings = blendSettings(input);
  const { main, scaled } = finishesOf(finish);
  const uniforms = createUniforms();
  // (A finish draws a full-screen grade into the target, so it needs no depth; a plain scene does.)
  const parts = createParts(lit, uniforms, main === null, settings.seed);
  writeSettings(uniforms, settings);
  const holdTaa = createTaaHold([main, scaled]);
  const size: Size = { css: [1, 1], ratio: 1, px: [1, 1], scaledPx: [1, 1] };
  let frames = 0;
  // (The less visible scene is drawn small only where something can draw it small: a scaled finish, or no finish.)
  const scaleOf = (): number => (main === null || scaled !== null ? settings.scale : 1);
  const resize = (): void => {
    const ratio = size.ratio * scaleOf();
    size.scaledPx = [Math.max(1, Math.round(size.css[0] * ratio)), Math.max(1, Math.round(size.css[1] * ratio))];
    parts.whole.setSize(size.px[0], size.px[1]);
    parts.scaled.setSize(size.scaledPx[0], size.scaledPx[1]);
    scaled?.setSize?.(size.css[0], size.css[1], ratio);
    set(uniforms, "uSize", size.px);
  };
  const dressBoth = (a: Shot, b: Shot): void => {
    if (frames++ % DRESS_EVERY !== 0 || main?.dress === undefined) return;
    for (const shot of [a, b]) if (typeof shot !== "function") main.dress(shot.scene);
  };
  /** Draws the scene into a target and points the pass at it, with that target's texel. */
  const into = (shot: Shot, target: RenderTargetLike, through: FinishLike | null, slot: "A" | "B"): void => {
    renderer.setRenderTarget(target);
    shoot(renderer, shot, through);
    const texels = target === parts.whole ? size.px : size.scaledPx;
    set(uniforms, `t${slot}`, target.texture);
    set(uniforms, `uTexel${slot}`, [1 / texels[0], 1 / texels[1]]);
  };
  return {
    get settings() { return settings; },
    setSettings(next) {
      const before = settings;
      settings = blendSettings(next);
      if (settings.seed !== before.seed) reseed(lit, uniforms, settings.seed);
      if (settings.scale !== before.scale) resize();
      writeSettings(uniforms, settings);
      return settings;
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      const px = (css: number): number => Math.max(1, Math.round(css * devicePixelRatio));
      size.css = [cssWidth, cssHeight];
      size.ratio = devicePixelRatio;
      size.px = [px(cssWidth), px(cssHeight)];
      resize();
    },
    draw(a, b, t, options = {}) {
      const s = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
      if (s <= 0 || s >= 1) {
        holdTaa(false);
        shoot(renderer, s <= 0 ? a : b, main);
        return currentAt(s);
      }
      holdTaa(true);
      dressBoth(a, b);
      const host = renderer.getRenderTarget();
      const minor = minorAt(s);
      const small = scaled ?? main;
      into(a, minor === "a" ? parts.scaled : parts.whole, minor === "a" ? small : main, "A");
      into(b, minor === "b" ? parts.scaled : parts.whole, minor === "b" ? small : main, "B");
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

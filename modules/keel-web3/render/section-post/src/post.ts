// The section pass bound to a renderer. The host's frame (a finish, or a blend) is drawn into the pass's own target;
// a blur, when asked, takes it down to half size across and back; then one pass lays the frame, darkened, with the
// paper panel and the grain, onto the target the host had. A frame that needs none of it is drawn straight there.

import type { DisposableLike, LitLike, RendererLike, RenderTargetLike, ShaderMaterialLike, TextureLike, Uniform } from "./lit.js";
import { NOISE_SIZE, noiseTexels } from "./noise.js";
import { POST_GLSL, POST_VERTEX_GLSL } from "./post.glsl.js";
import { TEAR_REACH, blurStep, frameOf, idle, postSettings } from "./settings.js";
import type { Frame, PostSettings, PostValues } from "./settings.js";

/** lit-finish's shaders this pass reuses: pass the lit-finish namespace itself. */
export interface FinishShaders {
  /** A separable 9-tap Gaussian: `tBlur` sampled at this target's uv, `uDir` in its pixels, `uBloomSize` its size. */
  readonly BLUR_GLSL: string;
}

export interface SectionPost {
  readonly settings: PostSettings;
  setSettings(input?: unknown): PostSettings;
  /** The canvas's CSS size and pixel ratio (the renderer's). */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /**
   * Draws a frame with the section's overlay onto the renderer's current target.
   *
   * @param draw Draws the frame onto the renderer's current target: `finish.render(...)` or `blend.draw(...)`.
   * @param values This frame's overlay values, from the host's tracks.
   */
  render(draw: () => void, values?: PostValues): void;
  dispose(): void;
}

interface Pass {
  readonly scene: unknown;
  readonly material: ShaderMaterialLike;
}

interface Parts {
  readonly frame: RenderTargetLike;
  readonly blurred: readonly [RenderTargetLike, RenderTargetLike];
  readonly post: Pass;
  readonly blur: Pass;
  readonly camera: unknown;
  readonly geometry: DisposableLike;
}

function set(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

function createPass(lit: LitLike, geometry: DisposableLike, uniforms: Record<string, Uniform>, glsl: string): Pass {
  const material = new lit.CustomMaterial({
    uniforms, vertexShader: POST_VERTEX_GLSL, fragmentShader: glsl, depthTest: false, depthWrite: false,
  });
  const quad = new lit.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new lit.Stage();
  scene.add(quad);
  return { scene, material };
}

function noiseTexture(lit: LitLike, seed: number): TextureLike {
  const noise = new lit.DataTexture(noiseTexels(seed), NOISE_SIZE, NOISE_SIZE, "rgba");
  noise.wrapS = "repeat";
  noise.wrapT = "repeat";
  noise.minFilter = "linear";
  noise.magFilter = "linear";
  noise.needsUpdate = true;
  return noise;
}

function createParts(lit: LitLike, shaders: FinishShaders, settings: PostSettings): Parts {
  const flat = { minFilter: "linear", magFilter: "linear", generateMipmaps: false, depthBuffer: false };
  const frame = new lit.RenderTarget(1, 1, { ...flat, depthBuffer: settings.depth });
  const blurred = [new lit.RenderTarget(1, 1, flat), new lit.RenderTarget(1, 1, flat)] as const;
  const geometry = lit.plane(2, 2);
  const value = (v: unknown): Uniform => ({ value: v });
  const post = createPass(lit, geometry, {
    tColor: value(frame.texture), tBlurred: value(blurred[1].texture), tNoise: value(noiseTexture(lit, settings.seed)),
    uSize: value([1, 1]), uNoiseScale: value(1), uProgress: value(0), uPosition: value(0), uColour: value([1, 1, 1]),
    uTear: value(0), uTearReach: value(TEAR_REACH), uFibre: value(0), uPaper: value(0), uGrain: value(0),
    uDarken: value(0), uBlur: value(0),
  }, POST_GLSL);
  const blurUniforms = { tBlur: value(null), uBloomSize: value([1, 1]), uDir: value([1, 0]) };
  const blur = createPass(lit, geometry, blurUniforms, shaders.BLUR_GLSL);
  return { frame, blurred, post, blur, camera: new lit.OrthoCamera(-1, 1, 1, -1, 0, 1), geometry };
}

/** This frame's values and the settings into the pass. */
function writeFrame(uniforms: Record<string, Uniform>, frame: Frame, settings: PostSettings): void {
  const values: readonly (readonly [string, unknown])[] = [
    ["uProgress", frame.progress], ["uPosition", frame.position], ["uColour", frame.colour], ["uTear", frame.tear],
    ["uFibre", frame.fibre], ["uGrain", frame.grain], ["uDarken", frame.darken], ["uBlur", frame.blur],
    ["uPaper", settings.paper], ["uNoiseScale", settings.noiseScale],
  ];
  for (const [name, value] of values) set(uniforms, name, value);
}

/** The frame, blurred across into the first half-size target and down into the second. */
function drawBlur(renderer: RendererLike, parts: Parts, step: number): void {
  const u = parts.blur.material.uniforms;
  set(u, "tBlur", parts.frame.texture);
  set(u, "uDir", [step, 0]);
  renderer.setRenderTarget(parts.blurred[0]);
  renderer.render(parts.blur.scene, parts.camera);
  set(u, "tBlur", parts.blurred[0].texture);
  set(u, "uDir", [0, step]);
  renderer.setRenderTarget(parts.blurred[1]);
  renderer.render(parts.blur.scene, parts.camera);
}

/**
 * Binds the section pass to a renderer: a paper panel that sweeps in and out with a straight or torn edge and a fibre
 * line, darkening, blur and grain, over a finished frame. Every value is a plain number a host feeds from tracks.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The renderer that owns the canvas.
 * @param shaders lit-finish's namespace, for its blur.
 * @param input Settings, normalized through `postSettings`.
 */
export function createSectionPost(
  lit: LitLike,
  renderer: RendererLike,
  shaders: FinishShaders,
  input?: unknown,
): SectionPost {
  let settings = postSettings(input);
  const parts = createParts(lit, shaders, settings);
  const uniforms = parts.post.material.uniforms;
  let height = 1;
  return {
    get settings() { return settings; },
    setSettings(next) {
      const before = settings.seed;
      settings = postSettings(next);
      if (settings.seed !== before) {
        const old = uniforms.tNoise?.value as TextureLike;
        set(uniforms, "tNoise", noiseTexture(lit, settings.seed));
        old.dispose();
      }
      return settings;
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      const px = (css: number): number => Math.max(1, Math.round(css * devicePixelRatio));
      const size = [px(cssWidth), px(cssHeight)] as const;
      const half = [Math.max(1, Math.ceil(size[0] / 2)), Math.max(1, Math.ceil(size[1] / 2))] as const;
      parts.frame.setSize(size[0], size[1]);
      for (const target of parts.blurred) target.setSize(half[0], half[1]);
      set(uniforms, "uSize", size);
      set(parts.blur.material.uniforms, "uBloomSize", half);
      height = size[1];
    },
    render(draw, values = {}) {
      const frame = frameOf(values, settings);
      if (idle(frame)) {
        draw();
        return;
      }
      const host = renderer.getRenderTarget();
      renderer.setRenderTarget(parts.frame);
      draw();
      if (frame.blur > 0) drawBlur(renderer, parts, blurStep(frame.blur, height));
      writeFrame(uniforms, frame, settings);
      renderer.setRenderTarget(host);
      renderer.render(parts.post.scene, parts.camera);
    },
    dispose() {
      for (const target of [parts.frame, ...parts.blurred]) target.dispose();
      (uniforms.tNoise?.value as TextureLike).dispose();
      parts.post.material.dispose();
      parts.blur.material.dispose();
      parts.geometry.dispose();
    },
  };
}

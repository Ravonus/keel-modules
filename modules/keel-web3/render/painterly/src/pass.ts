// The painter bound to a renderer. Each frame: the scene into a linear target with depth; tone mapped at the paint's
// size; the structure tensor of the colour and the form at the paint's size, blurred; an anisotropic
// Kuwahara smoothing along it; strokes stamped along it (when asked); and the finish onto the host's target.

import {
  BLUR_GLSL, GRADE_GLSL, KUWAHARA_GLSL, PREP_GLSL, STROKE_GLSL, TABLE_GLSL, TENSOR_GLSL, VERTEX_GLSL,
} from "./painterly.glsl.js";
import type {
  CameraLike, DataTextureLike, DisposableLike, LitLike, RendererLike, RenderTargetLike, SceneLike, ShaderMaterialLike,
  Uniform,
} from "./lit.js";
import { GRAIN_SIZE, STROKE_CELLS, grainTile, painterlySettings, strokeTile } from "./settings.js";
import type { PainterlySettings } from "./settings.js";

export interface Painterly {
  readonly settings: PainterlySettings;
  /** New settings, normalized through `painterlySettings`; a new seed lays the strokes and weaves the canvas again. */
  setSettings(input?: unknown): PainterlySettings;
  /** The canvas's CSS size and pixel ratio (the renderer's). */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /**
   * Draws the scene through the camera, painted, onto whatever target the renderer had. `backdrop`, if given, draws
   * into the cleared frame first with the painter's target bound (a plate-painter plate, say), and the scene draws
   * over it; the painter resets the renderer's state after it, so the backdrop may use the raw context.
   */
  render(scene: unknown, camera: CameraLike, backdrop?: () => void): void;
  /**
   * What the canvas shows: the painting (default); the lit frame tone mapped and nothing else, for comparing; or,
   * for checking, the flow as colour (the hue its direction, red across and cyan up, the saturation how oriented),
   * or how fine the picture is (red), the strokes' height (green) and the depth (blue).
   */
  setView(view: "painted" | "raw" | "flow" | "detail" | "depth"): void;
  dispose(): void;
}

interface Pass {
  readonly scene: SceneLike;
  readonly material: ShaderMaterialLike;
}

const PASSES = {
  prep: PREP_GLSL, tensor: TENSOR_GLSL, blur: BLUR_GLSL, kuwahara: KUWAHARA_GLSL, table: TABLE_GLSL,
  stroke: STROKE_GLSL, grade: GRADE_GLSL,
};

/** The broad layer's cell, in brushes; the fine layer's is one brush. */
const COARSE = 3;
/** What the finish draws, as the shader reads it. */
const VIEWS = { painted: 0, raw: 1, flow: 2, detail: 3, depth: 4 } as const;
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
  const vec4 = (): Uniform => ({ value: [1, 1, 1, 0] });
  const number = (value: number): Uniform => ({ value });
  return {
    tColor: number(0), tDepth: number(0), tPrep: number(0), tTensor: number(0), tBlur: number(0), tPaint: number(0),
    tPainted: number(0), tTile: number(0), tGrain: number(0), tCoarse: number(0), tFine: number(0),
    uNear: number(0.1), uFar: number(100), uOrtho: number(0), uProj: vec2(),
    uSize: vec2(), uPaintSize: vec2(), uTexel: vec2(), uDir: vec2(1, 0),
    uExposure: number(1), uDirection: number(1), uRadius: number(5), uLayer: vec4(), uCoarse: vec4(), uFine: vec4(),
    uTileCells: number(STROKE_CELLS), uStrokes: number(1), uGrainSize: number(GRAIN_SIZE),
    uGrain: number(0.05), uEdge: number(0.5), uGrade: number(0.6), uView: number(0),
  };
}

function set(uniforms: Record<string, Uniform>, name: string, value: unknown): void {
  const uniform = uniforms[name];
  if (uniform !== undefined) uniform.value = value;
}

/** The settings into the shaders: the brush in painted pixels. */
function writeSettings(u: Record<string, Uniform>, s: PainterlySettings): void {
  const values: readonly (readonly [string, unknown])[] = [
    ["uExposure", s.exposure], ["uDirection", s.direction], ["uRadius", s.stroke],
    ["uStrokes", s.strokes], ["uGrain", s.grain], ["uEdge", s.edge], ["uGrade", s.grade],
  ];
  for (const [name, value] of values) set(u, name, value);
}

interface Targets {
  readonly world: RenderTargetLike;
  readonly prep: RenderTargetLike;
  readonly tensor: readonly [RenderTargetLike, RenderTargetLike];
  readonly paint: RenderTargetLike;
  /** The broad and the fine layers' strokes, one each a cell: flow on the left half, colour on the right. */
  readonly tables: readonly [RenderTargetLike, RenderTargetLike];
  readonly strokes: RenderTargetLike;
}

function createTargets(lit: LitLike): Targets {
  const linear = { minFilter: "linear", magFilter: "linear", generateMipmaps: false, depthBuffer: false };
  const nearest = { minFilter: "nearest", magFilter: "nearest" };
  const depthTexture = new lit.DepthTexture(1, 1);
  const target = (options: Readonly<Record<string, unknown>>): RenderTargetLike => new lit.RenderTarget(1, 1, options);
  return {
    // (No multisampling: the paint smooths what it draws, and at half size it takes four frame pixels a painted one.
    // Half floats throughout: eight bits a channel would band a sky once the varnish stretches it.)
    world: target({ ...linear, type: "half", depthBuffer: true, depthTexture }),
    prep: target({ ...linear, type: "half" }),
    tensor: [target({ ...linear, type: "half" }), target({ ...linear, type: "half" })],
    paint: target({ ...linear, type: "half" }),
    tables: [target({ ...linear, ...nearest, type: "half" }), target({ ...linear, ...nearest, type: "half" })],
    strokes: target({ ...linear, type: "half" }),
  };
}

/** The seed's tiles as textures: where the strokes lie (nearest, a cell each) and the canvas's weave (smooth). */
interface Tiles {
  readonly strokes: DataTextureLike;
  readonly grain: DataTextureLike;
}

function createTiles(lit: LitLike, seed: number): Tiles {
  const strokes = new lit.DataTexture(strokeTile(seed), STROKE_CELLS, STROKE_CELLS, "rgba", "u8");
  const grain = new lit.DataTexture(grainTile(seed), GRAIN_SIZE, GRAIN_SIZE, "red", "u8");
  for (const tile of [strokes, grain]) {
    tile.wrapS = "repeat";
    tile.wrapT = "repeat";
    tile.needsUpdate = true;
  }
  grain.magFilter = "linear";
  grain.minFilter = "linear";
  return { strokes, grain };
}

type Size = readonly [number, number];

/** The stroke layers' tables: a cell a stroke, a brush wide for the fine layer and `COARSE` brushes for the broad. */
function sizeTables(targets: Targets, uniforms: Record<string, Uniform>, paint: Size, brush: number): void {
  const layers = [["uCoarse", brush * 2 * COARSE, 19], ["uFine", brush * 2, 0]] as const;
  layers.forEach(([name, cell, shift], i) => {
    const across = Math.ceil(paint[0] / cell) + 1;
    const down = Math.ceil(paint[1] / cell) + 1;
    targets.tables[i]?.setSize(across * 2, down);
    set(uniforms, name, [cell, across, down, shift]);
  });
}

function sizeTargets(targets: Targets, uniforms: Record<string, Uniform>, size: Size, s: PainterlySettings): void {
  const px = (frame: number): number => Math.max(1, Math.round(frame * s.resolution));
  const paint = [px(size[0]), px(size[1])] as const;
  targets.world.setSize(size[0], size[1]);
  for (const t of [targets.prep, ...targets.tensor, targets.paint, targets.strokes]) t.setSize(paint[0], paint[1]);
  sizeTables(targets, uniforms, paint, s.stroke);
  set(uniforms, "uSize", [size[0], size[1]]);
  set(uniforms, "uPaintSize", [paint[0], paint[1]]);
  set(uniforms, "uTexel", [1 / paint[0], 1 / paint[1]]);
}

/** The camera into the shaders, for depth back to view space. */
function writeCamera(uniforms: Record<string, Uniform>, camera: CameraLike): void {
  const p = camera.projectionMatrix.elements;
  set(uniforms, "uNear", camera.near);
  set(uniforms, "uFar", camera.far);
  set(uniforms, "uOrtho", camera.isOrthographicCamera === true ? 1 : 0);
  set(uniforms, "uProj", [p[0] ?? 1, p[5] ?? 1]);
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

/** The tensor of the frame, blurred across then down through `tensor[1]`, left in `tensor[0]`. */
function drawTensor(chain: Chain): void {
  const { targets, uniforms } = chain;
  pass(chain, "tensor", targets.tensor[0]);
  set(uniforms, "tBlur", targets.tensor[0].texture);
  set(uniforms, "uDir", [1, 0]);
  pass(chain, "blur", targets.tensor[1]);
  set(uniforms, "tBlur", targets.tensor[1].texture);
  set(uniforms, "uDir", [0, 1]);
  pass(chain, "blur", targets.tensor[0]);
}

/** Everything after the scene: the tone map, the tensor, the smoothing, the strokes, the finish onto `out`. */
function drawChain(chain: Chain, settings: PainterlySettings, raw: boolean, out: RenderTargetLike | null): void {
  const { targets, uniforms } = chain;
  if (!raw) {
    pass(chain, "prep", targets.prep);
    drawTensor(chain);
    pass(chain, "kuwahara", targets.paint);
    let painted = targets.paint;
    if (settings.strokes > 0) {
      for (const [name, i] of [["uCoarse", 0], ["uFine", 1]] as const) {
        set(uniforms, "uLayer", uniforms[name]?.value);
        pass(chain, "table", targets.tables[i]);
      }
      pass(chain, "stroke", targets.strokes);
      painted = targets.strokes;
    }
    set(uniforms, "tPainted", painted.texture);
  }
  pass(chain, "grade", out);
}

function disposeChain(chain: Chain, tiles: Tiles): void {
  const t = chain.targets;
  t.world.depthTexture?.dispose();
  for (const target of [t.world, t.prep, ...t.tensor, t.paint, ...t.tables, t.strokes]) target.dispose();
  for (const p of Object.values(chain.passes)) p.material.dispose();
  for (const tile of [tiles.strokes, tiles.grain]) tile.dispose();
  chain.geometry.dispose();
}

function createChain(lit: LitLike, renderer: RendererLike, uniforms: Record<string, Uniform>): Chain {
  const targets = createTargets(lit);
  set(uniforms, "tColor", targets.world.texture);
  set(uniforms, "tDepth", targets.world.depthTexture);
  set(uniforms, "tPrep", targets.prep.texture);
  set(uniforms, "tTensor", targets.tensor[0].texture);
  set(uniforms, "tPaint", targets.paint.texture);
  set(uniforms, "tCoarse", targets.tables[0].texture);
  set(uniforms, "tFine", targets.tables[1].texture);
  const geometry = lit.plane(2, 2);
  const passes = Object.fromEntries(
    Object.entries(PASSES).map(([name, glsl]) => [name, createPass(lit, geometry, uniforms, glsl)]),
  ) as Record<PassName, Pass>;
  return { renderer, passes, targets, uniforms, quad: new lit.OrthoCamera(-1, 1, 1, -1, 0, 1), geometry };
}

/**
 * Binds a painter to a renderer: a keel/lit stage drawn, tone mapped, smoothed along its structure, stroked along
 * its form and finished as an oil painting on canvas. The renderer's own tone mapping is not used: the painter does
 * its own (ACES) before it paints.
 *
 * @param lit The keel/lit namespace (WebGL2).
 * @param renderer The renderer that owns the canvas.
 * @param input Settings, normalized through `painterlySettings`.
 */
export function createPainterly(lit: LitLike, renderer: RendererLike, input?: unknown): Painterly {
  let settings = painterlySettings(input);
  let raw = false;
  const uniforms = createUniforms();
  const chain = createChain(lit, renderer, uniforms);
  let tiles = createTiles(lit, settings.seed);
  let size: readonly [number, number] = [1, 1];
  const writeTiles = (): void => {
    set(uniforms, "tTile", tiles.strokes);
    set(uniforms, "tGrain", tiles.grain);
  };
  writeSettings(uniforms, settings);
  writeTiles();
  return {
    get settings() { return settings; },
    setSettings(next) {
      const was = settings;
      settings = painterlySettings(next);
      writeSettings(uniforms, settings);
      if (settings.seed !== was.seed) {
        for (const tile of [tiles.strokes, tiles.grain]) tile.dispose();
        tiles = createTiles(lit, settings.seed);
        writeTiles();
      }
      if (settings.resolution !== was.resolution || settings.stroke !== was.stroke) {
        sizeTargets(chain.targets, uniforms, size, settings);
      }
      return settings;
    },
    setSize(cssWidth, cssHeight, devicePixelRatio) {
      const px = (css: number): number => Math.max(1, Math.round(css * devicePixelRatio));
      size = [px(cssWidth), px(cssHeight)];
      sizeTargets(chain.targets, uniforms, size, settings);
    },
    render(scene, camera, backdrop) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(chain.targets.world);
      if (backdrop) {
        // (The reset makes keel/lit forget where it was drawing, so the world target is bound again, by way of the
        // canvas so that it is really bound; the backdrop may have written depth, so the scene's depth starts clean.)
        const was = renderer.autoClear;
        renderer.clear();
        backdrop();
        renderer.resetState();
        renderer.setRenderTarget(null);
        renderer.setRenderTarget(chain.targets.world);
        renderer.clear(false, true, false);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = was;
      } else {
        renderer.render(scene, camera);
      }
      writeCamera(uniforms, camera);
      drawChain(chain, settings, raw, previous);
    },
    setView(view) {
      raw = view === "raw";
      set(uniforms, "uView", VIEWS[view]);
    },
    dispose() { disposeChain(chain, tiles); },
  };
}

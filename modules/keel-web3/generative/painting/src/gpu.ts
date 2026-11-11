// A plan painted on the GPU with an injected render/brush: each layer's steps on its own canvas, the layer finished,
// masked by its feathered selection, then composed onto the frame by blend mode with its edge bled, and graded.
import type { Rgb } from "./colour.js";
import type { Guides } from "./guide.js";
import {
  APPLY_FRAG, BACKDROP_FRAG, BLUR_FRAG, COMPOSE_FRAG, FULL_VERT, GRADE_FRAG, MASK_FRAG, OPAQUE_FRAG, UNDER_FRAG,
} from "./ops.glsl.js";
import type { PlannedStroke } from "./passes.js";
import type { LayerPlan, PaintingPlan, SelectionPlan, Step } from "./plan.js";
import type { BlendMode, OpRecipe } from "./recipe.js";
import { WARP_CELLS } from "./warp.js";

/** What the painter needs of render/brush's `createBrush(gl)`. */
export interface BrushLike {
  readonly gl: WebGL2RenderingContext;
  canvas(width: number, height: number): CanvasLike;
  paint(canvas: CanvasLike, batch: BatchLike, subBatches?: number): void;
  glaze(canvas: CanvasLike, fill: { readonly tint: Rgb; readonly opacity: number; readonly mask?: WebGLTexture }): void;
  fill(canvas: CanvasLike, flat: { readonly texture: WebGLTexture; readonly opacity: number }): void;
  finish(canvas: CanvasLike): WebGLTexture;
  read(texture: WebGLTexture, width: number, height: number): Uint8ClampedArray;
  release(canvas: CanvasLike): void;
}
export interface CanvasLike {
  readonly width: number;
  readonly height: number;
}
export interface BatchLike {
  readonly count: number;
}
/** render/brush's `packStrokes`. */
export type Pack = (strokes: readonly PlannedStroke[]) => BatchLike;

/** A painted layer: its texture (premultiplied linear, row 0 its bottom) and where it sits on the guides. */
export interface PaintedLayer {
  readonly name: string;
  readonly texture: WebGLTexture;
  readonly box: readonly [number, number, number, number];
  readonly res: readonly [number, number];
}

export interface Painted {
  readonly layers: readonly PaintedLayer[];
  /** The composite, the guides' size. */
  readonly frame: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export interface PaintOptions {
  /** An sRGB texture (row 0 its top) the layers compose over; without it the frame is clear. */
  readonly backdrop?: WebGLTexture;
  /** Called after each layer is painted, for timing: the host may `gl.finish()` there. */
  readonly onLayer?: (name: string) => void;
}

export interface Painting {
  paint(plan: PaintingPlan, guides: Guides, options?: PaintOptions): Painted;
  /** Frees what a paint made. */
  release(painted: Painted): void;
  dispose(): void;
}

interface Target {
  readonly texture: WebGLTexture;
  readonly fb: WebGLFramebuffer;
  readonly size: readonly [number, number];
}

interface Kit {
  readonly gl: WebGL2RenderingContext;
  readonly brush: BrushLike;
  readonly pack: Pack;
  readonly vao: WebGLVertexArrayObject;
  readonly programs: Readonly<Record<"mask" | "blur" | "apply" | "backdrop" | "compose" | "grade" | "under" | "opaque", WebGLProgram>>;
}

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, FULL_VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("painting: no shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    const logs = (gl.getAttachedShaders(program) ?? []).map((s) => gl.getShaderInfoLog(s) ?? "").join("\n");
    throw new Error(`painting: a program did not link.\n${gl.getProgramInfoLog(program) ?? ""}\n${logs}`);
  }
  return program;
}

interface Upload {
  readonly internal: number;
  readonly format: number;
  readonly type: number;
  readonly data: ArrayBufferView | null;
  readonly filter: number;
}

function makeTexture(gl: WebGL2RenderingContext, size: readonly [number, number], u: Upload): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, u.internal, size[0], size[1], 0, u.format, u.type, u.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, u.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, u.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl: WebGL2RenderingContext, size: readonly [number, number]): Target {
  const texture = makeTexture(gl, size, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, data: null,
    filter: gl.LINEAR });
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, fb, size };
}

function drop(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.texture);
}

type Value = number | readonly number[] | WebGLTexture;

/** Runs a full-target pass: textures bind to units in the order given. */
function run(kit: Kit, name: keyof Kit["programs"], into: Target, uniforms: Readonly<Record<string, Value>>): void {
  const { gl } = kit;
  const p = kit.programs[name];
  gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
  gl.viewport(0, 0, into.size[0], into.size[1]);
  gl.useProgram(p);
  gl.bindVertexArray(kit.vao);
  gl.uniform2f(gl.getUniformLocation(p, "uCanvas"), into.size[0], into.size[1]);
  let unit = 0;
  for (const [key, v] of Object.entries(uniforms)) {
    const at = gl.getUniformLocation(p, key);
    if (typeof v === "number") gl[/^u(Mode|Have|Count)/u.test(key) ? "uniform1i" : "uniform1f"](at, v);
    else if (Array.isArray(v)) setVector(gl, at, v);
    else {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, v);
      gl.uniform1i(at, unit);
      unit += 1;
    }
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function setVector(gl: WebGL2RenderingContext, at: WebGLUniformLocation | null, v: readonly number[]): void {
  const f = Float32Array.from(v);
  if (v.length === 2) gl.uniform2fv(at, f);
  else if (v.length === 4) gl.uniform4fv(at, f);
  else gl.uniform3fv(at, f);
}

interface Shared {
  readonly id: WebGLTexture;
  readonly warp: WebGLTexture;
  readonly light: WebGLTexture;
  readonly guide: readonly [number, number];
}

function upload(kit: Kit, plan: PaintingPlan, guides: Guides): Shared {
  const { gl } = kit;
  const { id, light } = guides;
  const bytes = (g: typeof id): Uint8Array => new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.byteLength);
  const n = WARP_CELLS + 1;
  return {
    id: makeTexture(gl, [id.width, id.height], { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      data: bytes(id), filter: gl.NEAREST }),
    light: makeTexture(gl, [light.width, light.height], { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      data: bytes(light), filter: gl.LINEAR }),
    warp: makeTexture(gl, [n, n], { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, data: plan.warp.grid,
      filter: gl.NEAREST }),
    guide: [id.width, id.height],
  };
}

const spotOf = (s: SelectionPlan): number[] => (s.spot ? [...s.spot, 1] : [0, 0, 0, 0]);

/** A selection's mask at a layer's size, feathered. The caller drops it. */
function maskOf(kit: Kit, shared: Shared, layer: LayerPlan, select: SelectionPlan): Target {
  const { gl } = kit;
  const flags = flagTexture(gl, select.flags);
  const a = target(gl, layer.res);
  const b = target(gl, layer.res);
  run(kit, "mask", a, { uWarp: shared.warp, uId: shared.id, uFlags: flags, uGuide: shared.guide, uBox: layer.box,
    uSpot: spotOf(select) });
  if (select.grow > 0) {
    run(kit, "blur", b, { uSource: a.texture, uDir: [1, 0], uSigma: select.grow, uLift: 0 });
    run(kit, "blur", a, { uSource: b.texture, uDir: [0, 1], uSigma: select.grow, uLift: 0.3 });
  }
  run(kit, "blur", b, { uSource: a.texture, uDir: [1, 0], uSigma: select.feather, uLift: 0 });
  run(kit, "blur", a, { uSource: b.texture, uDir: [0, 1], uSigma: select.feather, uLift: 0 });
  gl.deleteTexture(flags);
  drop(gl, b);
  return a;
}

function flagTexture(gl: WebGL2RenderingContext, flags: Uint8Array): WebGLTexture {
  return makeTexture(gl, [256, 1], { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE,
    data: flags.map((f) => f * 255), filter: gl.NEAREST });
}

/** An underpainting laid on the canvas, softened. */
function underpaint(kit: Kit, shared: Shared, layer: LayerPlan, step: Step & { kind: "under" }): CanvasStep {
  const { gl } = kit;
  const flags = flagTexture(gl, step.select.flags);
  const a = target(gl, layer.res);
  const b = target(gl, layer.res);
  run(kit, "under", a, {
    uWarp: shared.warp, uId: shared.id, uFlags: flags, uLight: shared.light, uGuide: shared.guide, uBox: layer.box,
    uSpot: spotOf(step.select),
    uPalette: step.palette.flat(), uCount: step.palette.length, uLevels: step.levels, uShift: step.shift,
  });
  run(kit, "blur", b, { uSource: a.texture, uDir: [1, 0], uSigma: step.soften, uLift: 0 });
  run(kit, "blur", a, { uSource: b.texture, uDir: [0, 1], uSigma: step.soften, uLift: 0 });
  run(kit, "opaque", b, { uSource: a.texture });
  gl.deleteTexture(flags);
  drop(gl, a);
  return { texture: b, opacity: step.opacity };
}

interface CanvasStep {
  readonly texture: Target;
  readonly opacity: number;
}

function paintStep(kit: Kit, shared: Shared, on: { layer: LayerPlan; canvas: CanvasLike }, step: Step): void {
  const { brush, gl } = kit;
  const { layer, canvas } = on;
  if (step.kind === "strokes") brush.paint(canvas, kit.pack(step.strokes));
  else if (step.kind === "under") {
    const under = underpaint(kit, shared, layer, step);
    brush.fill(canvas, { texture: under.texture.texture, opacity: under.opacity });
    drop(gl, under.texture);
  } else if (!step.select) brush.glaze(canvas, { tint: step.tint, opacity: step.opacity });
  else {
    const m = maskOf(kit, shared, layer, step.select);
    brush.glaze(canvas, { tint: step.tint, opacity: step.opacity, mask: m.texture });
    drop(gl, m);
  }
}

function paintLayer(kit: Kit, shared: Shared, layer: LayerPlan): PaintedLayer {
  const { brush, gl } = kit;
  const canvas = brush.canvas(layer.res[0], layer.res[1]);
  for (const step of layer.steps) paintStep(kit, shared, { layer, canvas }, step);
  const finished = brush.finish(canvas);
  const mask = maskOf(kit, shared, layer, layer.select);
  const out = target(gl, layer.res);
  run(kit, "apply", out, { uSource: finished, uMask: mask.texture, uOpacity: layer.opacity });
  drop(gl, mask);
  gl.deleteFramebuffer(out.fb);
  brush.release(canvas);
  return { name: layer.name, texture: out.texture, box: layer.box, res: layer.res };
}

const MODES: Readonly<Record<BlendMode, number>> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, "soft-light": 4, colour: 5, luminosity: 6, add: 7,
};

const opOf = (ops: readonly OpRecipe[], name: OpRecipe["op"]): OpRecipe | undefined => ops.find((o) => o.op === name);

function compose(
  kit: Kit, plan: PaintingPlan, layers: readonly PaintedLayer[], frame: readonly [Target, Target],
): Target {
  let [from, to] = frame;
  plan.layers.forEach((layer, i) => {
    const bleed = opOf(layer.ops, "edge-bleed") ?? opOf(plan.ops, "edge-bleed");
    const painted = layers[i];
    if (!painted) return;
    run(kit, "compose", to, {
      uFrame: from.texture, uLayer: painted.texture, uBox: layer.box, uMode: MODES[layer.blend],
      uBleed: [bleed?.px ?? 0, bleed ? bleed.amount ?? 0.6 : 0],
    });
    [from, to] = [to, from];
  });
  const grade = opOf(plan.ops, "grade");
  if (!grade) return from;
  run(kit, "grade", to, {
    uSource: from.texture, uSaturation: grade.saturation ?? 1,
    uGrade: [grade.lift ?? 0, grade.gamma ?? 1, grade.gain ?? 1, grade.warm ?? 0],
  });
  return to;
}

function paint(kit: Kit, plan: PaintingPlan, guides: Guides, options: PaintOptions): Painted {
  const { gl } = kit;
  const shared = upload(kit, plan, guides);
  const layers = plan.layers.map((layer) => {
    const painted = paintLayer(kit, shared, layer);
    options.onLayer?.(layer.name);
    return painted;
  });
  const frame: [Target, Target] = [target(gl, shared.guide), target(gl, shared.guide)];
  const backdrop = options.backdrop;
  run(kit, "backdrop", frame[0], backdrop ? { uSource: backdrop, uHave: 1 } : { uHave: 0 });
  const out = compose(kit, plan, layers, frame);
  for (const t of frame) {
    if (t !== out) drop(gl, t);
  }
  gl.deleteFramebuffer(out.fb);
  gl.deleteTexture(shared.id);
  gl.deleteTexture(shared.warp);
  gl.deleteTexture(shared.light);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { layers, frame: out.texture, width: shared.guide[0], height: shared.guide[1] };
}

/**
 * The painter on render/brush.
 *
 * @param brush `createBrush(gl)` from render/brush.
 * @param pack render/brush's `packStrokes`.
 */
export function createPainting(brush: BrushLike, pack: Pack): Painting {
  const { gl } = brush;
  const kit: Kit = {
    gl, brush, pack, vao: gl.createVertexArray(),
    programs: {
      mask: compile(gl, MASK_FRAG), blur: compile(gl, BLUR_FRAG), apply: compile(gl, APPLY_FRAG),
      backdrop: compile(gl, BACKDROP_FRAG), compose: compile(gl, COMPOSE_FRAG), grade: compile(gl, GRADE_FRAG),
      under: compile(gl, UNDER_FRAG), opaque: compile(gl, OPAQUE_FRAG),
    },
  };
  return {
    paint: (plan, guides, options = {}) => paint(kit, plan, guides, options),
    release: (painted) => {
      for (const l of painted.layers) gl.deleteTexture(l.texture);
      gl.deleteTexture(painted.frame);
    },
    dispose: () => {
      for (const p of Object.values(kit.programs)) gl.deleteProgram(p);
      gl.deleteVertexArray(kit.vao);
    },
  };
}

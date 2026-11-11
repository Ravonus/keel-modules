// The brush on a WebGL2 context the host passes in. A canvas is a colour target (RGBA16F, premultiplied linear) and
// a relief target (RGBA16F: height in red, wetness in alpha). A batch of strokes paints in order, in sub-batches: each
// sub-batch first copies the colour into a snapshot, which wet paint picks up from, so pick-up needs no read-back
// per dab and is the same however the GPU orders its work inside a sub-batch.
import { FILL_FRAG, FINISH_FRAG, FULL_VERT, GLAZE_FRAG, READ_FRAG, STROKE_FRAG, STROKE_VERT } from "./brush.glsl.js";
import { GRAIN_SIZE, noiseTile, weaveTile } from "./grain.js";
import { MAX_DABS, MEDIUM, STROKE_FLOATS, type Rgb, type StrokeBatch } from "./stroke.js";

/** A canvas to paint on. Row 0 of its textures is the canvas's bottom. */
export interface BrushCanvas {
  readonly width: number;
  readonly height: number;
  readonly colour: WebGLTexture;
  readonly relief: WebGLTexture;
}

/** A glaze over the whole canvas: the colour beneath times the tint, `opacity` of the way, under a mask's red. */
export interface GlazeFill {
  readonly tint: Rgb;
  readonly opacity: number;
  /** A texture the canvas's size, row 0 its bottom; 1 glazes, 0 leaves alone. */
  readonly mask?: WebGLTexture;
}

/** Paint laid flat: a premultiplied linear texture the canvas's size (row 0 its bottom), over what is there. */
export interface FlatFill {
  readonly texture: WebGLTexture;
  readonly opacity: number;
}

/** How the finish lights the relief and shows the canvas. */
export interface FinishLook {
  /** A unit vector toward the key, x right, y up, z out of the canvas. */
  readonly key?: readonly [number, number, number];
  /** How steep the relief looks. */
  readonly relief?: number;
  /** How much canvas weave shows where the paint is thin, 0..1. */
  readonly weave?: number;
}

export interface Brush {
  readonly gl: WebGL2RenderingContext;
  /** A clear canvas, `width` by `height` pixels. */
  canvas(width: number, height: number): BrushCanvas;
  /** Clears a canvas to nothing: no colour, no paint, no relief. */
  clear(canvas: BrushCanvas): void;
  /** Paints strokes in order, in `subBatches` (default 4) snapshot steps. */
  paint(canvas: BrushCanvas, batch: StrokeBatch, subBatches?: number): void;
  /** Glazes the whole canvas, or what a mask lets through. */
  glaze(canvas: BrushCanvas, fill: GlazeFill): void;
  /** Lays a texture on as paint: an underpainting, say. */
  fill(canvas: BrushCanvas, fill: FlatFill): void;
  /** The canvas finished: its relief lit and its weave shown. The texture belongs to the canvas. */
  finish(canvas: BrushCanvas, look?: FinishLook): WebGLTexture;
  /** A premultiplied linear texture as straight sRGB bytes, rows from the top. */
  read(texture: WebGLTexture, width: number, height: number): Uint8ClampedArray;
  release(canvas: BrushCanvas): void;
  dispose(): void;
}

interface Targets {
  readonly colourFb: WebGLFramebuffer;
  readonly reliefFb: WebGLFramebuffer;
  readonly snap: WebGLTexture;
  readonly snapFb: WebGLFramebuffer;
  readonly out: WebGLTexture;
  readonly outFb: WebGLFramebuffer;
}

interface Programs {
  readonly stroke: WebGLProgram;
  readonly glaze: WebGLProgram;
  readonly fill: WebGLProgram;
  readonly finish: WebGLProgram;
  readonly read: WebGLProgram;
}

interface TextureKind {
  readonly internal: number;
  readonly format: number;
  readonly type: number;
}

/** Compiles and links a program, or throws with the logs. */
export function compile(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("brush: no shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    const logs = (gl.getAttachedShaders(program) ?? []).map((s) => gl.getShaderInfoLog(s) ?? "").join("\n");
    throw new Error(`brush: a program did not link.\n${gl.getProgramInfoLog(program) ?? ""}\n${logs}`);
  }
  return program;
}

function texture(gl: WebGL2RenderingContext, size: readonly [number, number], kind: TextureKind): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, kind.internal, size[0], size[1], 0, kind.format, kind.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function framebuffer(gl: WebGL2RenderingContext, t: WebGLTexture): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("brush: this context cannot draw into half floats (EXT_color_buffer_float).");
  }
  return fb;
}

function grainTexture(gl: WebGL2RenderingContext, bytes: Uint8Array): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, GRAIN_SIZE, GRAIN_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

function bindUnit(gl: WebGL2RenderingContext, unit: number, t: WebGLTexture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
}

/** Runs of strokes with one medium, as [first, count, medium], inside [start, end). */
export function mediumRuns(data: Float32Array, start: number, end: number): [number, number, number][] {
  const runs: [number, number, number][] = [];
  for (let i = start; i < end; i += 1) {
    const medium = data[i * STROKE_FLOATS + 28] ?? 0;
    const last = runs[runs.length - 1];
    if (last?.[2] === medium) last[1] += 1;
    else runs.push([i, 1, medium]);
  }
  return runs;
}

/** The sub-batches of `count` strokes: `parts` runs as even as whole strokes allow, in order. */
export function subBatches(count: number, parts: number): [number, number][] {
  const n = Math.max(1, Math.min(parts, count));
  const out: [number, number][] = [];
  for (let k = 0; k < n; k += 1) out.push([Math.floor((count * k) / n), Math.floor((count * (k + 1)) / n)]);
  return out;
}

interface State {
  readonly gl: WebGL2RenderingContext;
  readonly programs: Programs;
  readonly vao: WebGLVertexArrayObject;
  readonly noise: WebGLTexture;
  readonly weave: WebGLTexture;
  readonly strokes: WebGLTexture;
  readonly half: TextureKind;
  readonly targets: WeakMap<BrushCanvas, Targets>;
}

function targetsOf(state: State, canvas: BrushCanvas): Targets {
  const t = state.targets.get(canvas);
  if (!t) throw new Error("brush: that canvas is not this brush's, or was released.");
  return t;
}

function setBlend(gl: WebGL2RenderingContext, medium: number, relief: boolean): void {
  gl.enable(gl.BLEND);
  if (relief) {
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
  } else if (medium === MEDIUM.glaze) {
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
  } else {
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

function uploadStrokes(state: State, batch: StrokeBatch): void {
  const { gl } = state;
  gl.bindTexture(gl.TEXTURE_2D, state.strokes);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, STROKE_FLOATS / 4, Math.max(batch.count, 1), 0, gl.RGBA, gl.FLOAT,
    batch.count > 0 ? batch.data : new Float32Array(STROKE_FLOATS));
}

function drawRuns(state: State, canvas: BrushCanvas, runs: readonly [number, number, number][], relief: boolean): void {
  const { gl } = state;
  const p = state.programs.stroke;
  const t = targetsOf(state, canvas);
  gl.bindFramebuffer(gl.FRAMEBUFFER, relief ? t.reliefFb : t.colourFb);
  gl.uniform1i(uniform(gl, p, "uOut"), relief ? 1 : 0);
  // While the relief is the target it may not be read: the grain stands in for it.
  bindUnit(gl, 2, relief ? state.noise : canvas.relief);
  for (const [first, count, medium] of runs) {
    if (relief && medium !== MEDIUM.oil) continue;
    setBlend(gl, medium, relief);
    gl.uniform1i(uniform(gl, p, "uBase"), first);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6 * MAX_DABS, count);
  }
}

function snapshot(state: State, canvas: BrushCanvas): void {
  const { gl } = state;
  const t = targetsOf(state, canvas);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.colourFb);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.snapFb);
  const [w, h] = [canvas.width, canvas.height];
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function paint(state: State, canvas: BrushCanvas, batch: StrokeBatch, parts: number): void {
  if (batch.count === 0) return;
  const { gl } = state;
  const p = state.programs.stroke;
  uploadStrokes(state, batch);
  gl.useProgram(p);
  gl.bindVertexArray(state.vao);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uniform(gl, p, "uCanvas"), canvas.width, canvas.height);
  ["uStrokes", "uSnap", "uRelief", "uGrain"].forEach((name, unit) => {
    gl.uniform1i(uniform(gl, p, name), unit);
  });
  bindUnit(gl, 0, state.strokes);
  bindUnit(gl, 3, state.noise);
  for (const [start, end] of subBatches(batch.count, parts)) {
    snapshot(state, canvas);
    gl.useProgram(p);
    bindUnit(gl, 1, targetsOf(state, canvas).snap);
    const runs = mediumRuns(batch.data, start, end);
    drawRuns(state, canvas, runs, false);
    drawRuns(state, canvas, runs, true);
  }
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function fullPass(state: State, program: WebGLProgram, fb: WebGLFramebuffer, size: readonly [number, number]): void {
  const { gl } = state;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, size[0], size[1]);
  gl.bindVertexArray(state.vao);
  gl.useProgram(program);
  gl.uniform2f(uniform(gl, program, "uCanvas"), size[0], size[1]);
}

function glaze(state: State, canvas: BrushCanvas, fill: GlazeFill): void {
  const { gl } = state;
  const p = state.programs.glaze;
  fullPass(state, p, targetsOf(state, canvas).colourFb, [canvas.width, canvas.height]);
  gl.uniform3f(uniform(gl, p, "uTint"), fill.tint[0], fill.tint[1], fill.tint[2]);
  gl.uniform1f(uniform(gl, p, "uOpacity"), fill.opacity);
  gl.uniform1i(uniform(gl, p, "uMasked"), fill.mask ? 1 : 0);
  gl.uniform1i(uniform(gl, p, "uMask"), 0);
  bindUnit(gl, 0, fill.mask ?? state.noise);
  setBlend(gl, MEDIUM.glaze, false);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function fill(state: State, canvas: BrushCanvas, flat: FlatFill): void {
  const { gl } = state;
  const p = state.programs.fill;
  fullPass(state, p, targetsOf(state, canvas).colourFb, [canvas.width, canvas.height]);
  gl.uniform1f(uniform(gl, p, "uOpacity"), flat.opacity);
  gl.uniform1i(uniform(gl, p, "uSource"), 0);
  bindUnit(gl, 0, flat.texture);
  setBlend(gl, MEDIUM.oil, false);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function finish(state: State, canvas: BrushCanvas, look: FinishLook): WebGLTexture {
  const { gl } = state;
  const p = state.programs.finish;
  const t = targetsOf(state, canvas);
  fullPass(state, p, t.outFb, [canvas.width, canvas.height]);
  const key = look.key ?? [-0.42, 0.55, 0.72];
  gl.uniform3f(uniform(gl, p, "uKey"), key[0], key[1], key[2]);
  gl.uniform2f(uniform(gl, p, "uLook"), look.relief ?? 3, look.weave ?? 0.12);
  ["uColour", "uRelief", "uWeave"].forEach((name, unit) => {
    gl.uniform1i(uniform(gl, p, name), unit);
  });
  bindUnit(gl, 0, canvas.colour);
  bindUnit(gl, 1, canvas.relief);
  bindUnit(gl, 2, state.weave);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t.out;
}

function read(state: State, source: WebGLTexture, width: number, height: number): Uint8ClampedArray {
  const { gl } = state;
  const t = texture(gl, [width, height], { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
  const fb = framebuffer(gl, t);
  fullPass(state, state.programs.read, fb, [width, height]);
  gl.uniform1i(uniform(gl, state.programs.read, "uColour"), 0);
  bindUnit(gl, 0, source);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const rows = new Uint8ClampedArray(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rows);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(t);
  const out = new Uint8ClampedArray(rows.length);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    out.set(rows.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  }
  return out;
}

function makeCanvas(state: State, width: number, height: number): BrushCanvas {
  const { gl, half } = state;
  const size = [width, height] as const;
  const canvas = { width, height, colour: texture(gl, size, half), relief: texture(gl, size, half) };
  const snap = texture(gl, size, half);
  const out = texture(gl, size, half);
  state.targets.set(canvas, {
    colourFb: framebuffer(gl, canvas.colour), reliefFb: framebuffer(gl, canvas.relief),
    snap, snapFb: framebuffer(gl, snap), out, outFb: framebuffer(gl, out),
  });
  clear(state, canvas);
  return canvas;
}

function clear(state: State, canvas: BrushCanvas): void {
  const { gl } = state;
  const t = targetsOf(state, canvas);
  gl.clearColor(0, 0, 0, 0);
  for (const fb of [t.colourFb, t.reliefFb]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function release(state: State, canvas: BrushCanvas): void {
  const t = state.targets.get(canvas);
  if (!t) return;
  const { gl } = state;
  for (const fb of [t.colourFb, t.reliefFb, t.snapFb, t.outFb]) gl.deleteFramebuffer(fb);
  for (const tex of [canvas.colour, canvas.relief, t.snap, t.out]) gl.deleteTexture(tex);
  state.targets.delete(canvas);
}

/**
 * The brush on a WebGL2 context. It needs EXT_color_buffer_float to paint into half floats.
 *
 * @param gl The host's context; the brush leaves no framebuffer bound and blending off after each call.
 * @param seed Which grain and weave.
 */
export function createBrush(gl: WebGL2RenderingContext, seed = 1): Brush {
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("brush: EXT_color_buffer_float is missing.");
  const state: State = {
    gl,
    programs: {
      stroke: compile(gl, STROKE_VERT, STROKE_FRAG), glaze: compile(gl, FULL_VERT, GLAZE_FRAG),
      fill: compile(gl, FULL_VERT, FILL_FRAG),
      finish: compile(gl, FULL_VERT, FINISH_FRAG), read: compile(gl, FULL_VERT, READ_FRAG),
    },
    vao: gl.createVertexArray(), noise: grainTexture(gl, noiseTile(seed)), weave: grainTexture(gl, weaveTile(seed)),
    strokes: gl.createTexture(), half: { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT },
    targets: new WeakMap(),
  };
  gl.bindTexture(gl.TEXTURE_2D, state.strokes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return {
    gl,
    canvas: (width, height) => makeCanvas(state, width, height),
    clear: (canvas) => { clear(state, canvas); },
    paint: (canvas, batch, parts = 4) => { paint(state, canvas, batch, parts); },
    glaze: (canvas, tint) => { glaze(state, canvas, tint); },
    fill: (canvas, flat) => { fill(state, canvas, flat); },
    finish: (canvas, look = {}) => finish(state, canvas, look),
    read: (source, width, height) => read(state, source, width, height),
    release: (canvas) => { release(state, canvas); },
    dispose: () => {
      const { stroke, glaze: tint, fill: flat, finish: lit, read: back } = state.programs;
      for (const p of [stroke, tint, flat, lit, back]) gl.deleteProgram(p);
      for (const t of [state.noise, state.weave, state.strokes]) gl.deleteTexture(t);
      gl.deleteVertexArray(state.vao);
    },
  };
}

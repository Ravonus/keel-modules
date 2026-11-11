// The painter on a WebGL2 context the host passes in: a plan into a texture in five passes (scene, middle-distance
// dabs, brush strokes, near leaves, finish), a texture onto the screen as a backdrop, and a texture back to pixels.
import { STRIDE } from "./dab.js";
import { BACKDROP_FRAG, DAB_FRAG, DAB_VERT, FINISH_FRAG, FULL_VERT, SCENE_FRAG, STROKE_FRAG } from "./paint.glsl.js";
import { MAX_RANGES, RIDGE_SAMPLES, type PlanUniform, type PlatePlan } from "./plan.js";

/** A rectangle of the plate in plate fractions: left, top, width, height. */
export type PlateView = readonly [number, number, number, number];

/** The size of a painted plate in pixels, and the part of the plate it holds (all of it unless said). */
export interface PlateSize {
  readonly width: number;
  readonly height: number;
  readonly view?: PlateView;
}

/** A painted plate: a texture whose row 0 is the plate's top. */
export interface Plate {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly digest: string;
  readonly view: PlateView;
}

/** Where and how the backdrop is drawn. */
export interface BackdropView {
  /** The target rectangle in pixels; x and y from the bottom left as WebGL counts. */
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  /** 1 fits the plate to cover the target; above 1 leaves room to move. */
  readonly zoom?: number;
  /** The point of the plate kept in view, 0..1 each way. */
  readonly focus?: readonly [number, number];
  /** The parallax hook: a move in crop widths and heights (small, ±0.05), held inside the plate. */
  readonly shift?: readonly [number, number];
}

/** Pixels of a plate, rows from the top, RGBA: what `new ImageData(data, width, height)` takes. */
export interface PlateStill {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface PlatePainter {
  /** Paints a plan, or returns the plate already painted for the same digest, size and view. */
  paint(plan: PlatePlan, size: PlateSize): Plate;
  /** Draws a plate over the bound framebuffer as a screen-locked backdrop. */
  draw(plate: Plate, view: BackdropView): void;
  /** Reads a plate back, for a still. */
  read(plate: Plate): PlateStill;
  /** Frees one plate and forgets it. */
  release(plate: Plate): void;
  /** Frees every plate and the programs. */
  dispose(): void;
}

/**
 * The part of a source to show so it covers a target: left, top, width, height in source fractions.
 *
 * @param source The source's width over height.
 * @param target The target's width over height.
 * @param view Zoom, focus and shift, as for `draw`.
 * @returns The crop, always inside the source.
 */
export function coverCrop(source: number, target: number, view: Omit<BackdropView, "width" | "height"> = {}): PlateView {
  const zoom = Math.max(view.zoom ?? 1, 1);
  const w = (target > source ? 1 : target / source) / zoom;
  const h = (target > source ? source / target : 1) / zoom;
  const [fx, fy] = view.focus ?? [0.5, 0.5];
  const [sx, sy] = view.shift ?? [0, 0];
  const clamp = (v: number, room: number): number => Math.min(Math.max(v, 0), room);
  return [clamp(fx - w / 2 + sx * w, 1 - w), clamp(fy - h / 2 + sy * h, 1 - h), w, h];
}

function compile(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("plate-painter: no shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    const shaders = gl.getAttachedShaders(program) ?? [];
    const logs = shaders.map((s) => gl.getShaderInfoLog(s) ?? "").join("\n");
    throw new Error(`plate-painter: a pass did not compile.\n${gl.getProgramInfoLog(program) ?? ""}\n${logs}`);
  }
  return program;
}

function setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, uniforms: readonly PlanUniform[]): void {
  for (const [name, size, values] of uniforms) {
    const at = gl.getUniformLocation(program, name) ?? gl.getUniformLocation(program, `${name}[0]`);
    if (!at) continue;
    if (size === 1) gl.uniform1fv(at, values);
    else if (size === 2) gl.uniform2fv(at, values);
    else if (size === 3) gl.uniform3fv(at, values);
    else gl.uniform4fv(at, values);
  }
}

interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
}

interface Size { readonly width: number; readonly height: number }

function texture(gl: WebGL2RenderingContext, size: Size, data?: Float32Array): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const filter = data ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (data) {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size.width, size.height, 0, gl.RED, gl.FLOAT, data);
  } else {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size.width, size.height);
  }
  return t;
}

function target(gl: WebGL2RenderingContext, size: Size): Target {
  const t = texture(gl, size);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { texture: t, framebuffer };
}

/** Puts back the state a pass changes, as the host had it. */
function saved(gl: WebGL2RenderingContext): () => void {
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
  const unit = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  const flags = [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST].map((f) => [f, gl.isEnabled(f)] as const);
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.activeTexture(gl.TEXTURE0);
  const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  for (const [f] of flags) gl.disable(f);
  return () => {
    gl.bindTexture(gl.TEXTURE_2D, bound);
    gl.activeTexture(unit);
    for (const [f, on] of flags) {
      if (on) gl.enable(f);
      else gl.disable(f);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport[0] ?? 0, viewport[1] ?? 0, viewport[2] ?? 0, viewport[3] ?? 0);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
  };
}

interface Programs {
  readonly scene: WebGLProgram;
  readonly stroke: WebGLProgram;
  readonly finish: WebGLProgram;
  readonly dab: WebGLProgram;
  readonly backdrop: WebGLProgram;
}

/** One instanced draw of dabs, blended over the colour, the target's alpha kept. */
function drawDabs(gl: WebGL2RenderingContext, dabs: Float32Array): void {
  const count = dabs.length / STRIDE;
  if (count === 0) return;
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, dabs, gl.STATIC_DRAW);
  for (let i = 0; i < 4; i += 1) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  gl.deleteBuffer(buffer);
  gl.deleteVertexArray(vao);
}

/** Runs one pass of a program into a target: a full-screen triangle, or the given dabs. */
function pass(
  gl: WebGL2RenderingContext, program: WebGLProgram, uniforms: readonly PlanUniform[], dabs?: Float32Array,
): void {
  gl.useProgram(program);
  setUniforms(gl, program, uniforms);
  const sampler = gl.getUniformLocation(program, "uBase") ?? gl.getUniformLocation(program, "uPaint");
  if (sampler) gl.uniform1i(sampler, 0);
  const ridge = gl.getUniformLocation(program, "uRidge");
  if (ridge) gl.uniform1i(ridge, 1);
  if (dabs) drawDabs(gl, dabs);
  else gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** The five passes. The result is in `out`; `work` is scratch. */
interface Targets {
  readonly out: Target;
  readonly work: Target;
  readonly uniforms: readonly PlanUniform[];
}

function paintInto(gl: WebGL2RenderingContext, programs: Programs, plan: PlatePlan, at: Targets): void {
  const ridges = texture(gl, { width: RIDGE_SAMPLES, height: MAX_RANGES }, plan.ridges);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, ridges);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, at.out.framebuffer);
  pass(gl, programs.scene, at.uniforms);
  pass(gl, programs.dab, at.uniforms, plan.scene);
  gl.bindFramebuffer(gl.FRAMEBUFFER, at.work.framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, at.out.texture);
  pass(gl, programs.stroke, at.uniforms);
  pass(gl, programs.dab, at.uniforms, plan.foliage);
  gl.bindFramebuffer(gl.FRAMEBUFFER, at.out.framebuffer);
  gl.bindTexture(gl.TEXTURE_2D, at.work.texture);
  pass(gl, programs.finish, at.uniforms);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.deleteTexture(ridges);
}

function drawBackdrop(gl: WebGL2RenderingContext, program: WebGLProgram, plate: Plate, view: BackdropView): void {
  const crop = coverCrop(plate.width / plate.height, view.width / view.height, view);
  const [x, y] = [view.x ?? 0, view.y ?? 0];
  gl.viewport(x, y, view.width, view.height);
  gl.useProgram(program);
  gl.uniform4f(gl.getUniformLocation(program, "uCrop"), crop[0], crop[1], crop[2], crop[3]);
  gl.uniform4f(gl.getUniformLocation(program, "uRect"), x, y, view.width, view.height);
  gl.uniform1i(gl.getUniformLocation(program, "uPlate"), 0);
  gl.bindTexture(gl.TEXTURE_2D, plate.texture);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/**
 * A painter on a WebGL2 context. Programs compile here, once; plates are cached by digest, size and view.
 *
 * @param gl The host's context. The painter restores the state it changes.
 * @returns paint, draw, read, release and dispose.
 */
export function createPlatePainter(gl: WebGL2RenderingContext): PlatePainter {
  const programs: Programs = {
    scene: compile(gl, FULL_VERT, SCENE_FRAG), stroke: compile(gl, FULL_VERT, STROKE_FRAG),
    finish: compile(gl, FULL_VERT, FINISH_FRAG), dab: compile(gl, DAB_VERT, DAB_FRAG),
    backdrop: compile(gl, FULL_VERT, BACKDROP_FRAG),
  };
  const plates = new Map<string, Plate & { framebuffer: WebGLFramebuffer }>();
  const keyOf = (digest: string, size: PlateSize): string =>
    [digest, size.width, size.height, ...(size.view ?? [0, 0, 1, 1])].join(",");
  return {
    paint(plan, size) {
      const key = keyOf(plan.digest, size);
      const known = plates.get(key);
      if (known) return known;
      const restore = saved(gl);
      const out = target(gl, size);
      const work = target(gl, size);
      const view = size.view ?? [0, 0, 1, 1];
      const uniforms: PlanUniform[] = [...plan.uniforms, ["uView", 4, new Float32Array(view)],
        ["uSize", 2, new Float32Array([size.width, size.height])]];
      gl.viewport(0, 0, size.width, size.height);
      paintInto(gl, programs, plan, { out, work, uniforms });
      gl.deleteFramebuffer(work.framebuffer);
      gl.deleteTexture(work.texture);
      restore();
      const plate = { texture: out.texture, framebuffer: out.framebuffer, width: size.width, height: size.height,
        digest: plan.digest, view };
      plates.set(key, plate);
      return plate;
    },
    draw(plate, view) {
      const restore = saved(gl);
      drawBackdrop(gl, programs.backdrop, plate, view);
      restore();
    },
    read(plate) {
      const known = [...plates.values()].find((p) => p.texture === plate.texture);
      if (!known) throw new Error("plate-painter: that plate was released or is not this painter's.");
      const data = new Uint8ClampedArray(plate.width * plate.height * 4);
      const restore = saved(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, known.framebuffer);
      gl.readPixels(0, 0, plate.width, plate.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      restore();
      return { width: plate.width, height: plate.height, data };
    },
    release(plate) {
      for (const [key, p] of plates) {
        if (p.texture !== plate.texture) continue;
        gl.deleteFramebuffer(p.framebuffer);
        gl.deleteTexture(p.texture);
        plates.delete(key);
      }
    },
    dispose() {
      for (const p of [...plates.values()]) this.release(p);
      for (const program of Object.values(programs) as WebGLProgram[]) gl.deleteProgram(program);
    },
  };
}

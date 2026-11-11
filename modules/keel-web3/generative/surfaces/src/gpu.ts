// The painters on a WebGL2 context the host passes in: one draw into two RGBA8 targets, read back as the buffers.
import type { Surface } from "./paint.js";
import { KINDS, planSurface, type SurfacePlan, type SurfaceSettings } from "./plan.js";
import type { SurfaceRecipe } from "./recipe.js";
import { FRAGMENTS, VERT } from "./surface.glsl.js";

/** Paints surfaces on one context. */
export interface SurfacePainter {
  /** A recipe in, `{ digest, buffers }` out, as `paintSurface` gives on the CPU. */
  paint(recipe: SurfaceRecipe, settings?: SurfaceSettings): Surface;
  /** The same from a plan already made. */
  paintPlan(plan: SurfacePlan): Surface;
  /** Frees the programs. */
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("surfaces: no shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    const logs = (gl.getAttachedShaders(program) ?? []).map((s) => gl.getShaderInfoLog(s) ?? "").join("\n");
    throw new Error(`surfaces: a painter did not compile.\n${gl.getProgramInfoLog(program) ?? ""}\n${logs}`);
  }
  return program;
}

/** Puts back the state a paint changes, as the host had it. */
function saved(gl: WebGL2RenderingContext): () => void {
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
  const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
  const flags = [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]
    .map((f) => [f, gl.isEnabled(f)] as const);
  for (const [f] of flags) gl.disable(f);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  return () => {
    for (const [f, on] of flags) {
      if (on) gl.enable(f);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport[0] ?? 0, viewport[1] ?? 0, viewport[2] ?? 0, viewport[3] ?? 0);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
  };
}

function target(gl: WebGL2RenderingContext, plan: SurfacePlan): WebGLTexture[] {
  return [0, 1].map((i) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, plan.width, plan.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    return t;
  });
}

function read(gl: WebGL2RenderingContext, plan: SurfacePlan, attachment: number): ArrayBuffer {
  const buffer = new ArrayBuffer(plan.width * plan.height * 4);
  gl.readBuffer(attachment);
  gl.readPixels(0, 0, plan.width, plan.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buffer));
  return buffer;
}

/**
 * A painter on a WebGL2 context. Each kind's program compiles the first time it paints.
 *
 * @param gl The host's context. The painter restores the state it changes.
 * @returns paint, paintPlan and dispose.
 */
export function createSurfacePainter(gl: WebGL2RenderingContext): SurfacePainter {
  const programs = new Map<number, WebGLProgram>();
  const programOf = (kind: number): WebGLProgram => {
    const known = programs.get(kind);
    if (known) return known;
    const made = compile(gl, FRAGMENTS[kind] ?? "");
    programs.set(kind, made);
    return made;
  };
  const paintPlan = (plan: SurfacePlan): Surface => {
    const program = programOf(KINDS[plan.kind]);
    const restore = saved(gl);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const textures = target(gl, plan);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, plan.width, plan.height);
    gl.useProgram(program);
    gl.uniform4fv(gl.getUniformLocation(program, "u"), plan.uniforms);
    gl.uniform3f(gl.getUniformLocation(program, "uView"), plan.width, plan.height, plan.depth);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buffers: [ArrayBuffer, ArrayBuffer] = [
      read(gl, plan, gl.COLOR_ATTACHMENT0), read(gl, plan, gl.COLOR_ATTACHMENT1)];
    gl.deleteFramebuffer(framebuffer);
    for (const t of textures) gl.deleteTexture(t);
    restore();
    return { digest: plan.digest, width: plan.width, height: plan.height, buffers };
  };
  return {
    paint: (recipe, settings) => paintPlan(planSurface(recipe, settings)),
    paintPlan,
    dispose() {
      for (const program of programs.values()) gl.deleteProgram(program);
      programs.clear();
    },
  };
}

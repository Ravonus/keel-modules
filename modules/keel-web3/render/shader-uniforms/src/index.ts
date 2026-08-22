/** WebGL uniform discovery and strict typed updates without eval or hidden globals. MIT. */

/** Either WebGL context flavor works; discovery uses only WebGL1-level calls. */
export type UniformContext = WebGLRenderingContext | WebGL2RenderingContext;

/** Values accepted by {@link UniformWriter}; the required shape depends on the uniform's GLSL type. */
export type UniformValue = number | boolean | Float32Array | number[];

/** Writes one named uniform on the program the writer was created for. */
export type UniformWriter = (name: string, value: UniformValue) => void;

interface UniformEntry {
  readonly info: WebGLActiveInfo;
  readonly location: WebGLUniformLocation | null;
}

function asFloatList(name: string, value: UniformValue): Float32Array | number[] {
  if (typeof value === "number" || typeof value === "boolean") {
    throw new TypeError(`Uniform ${name} expects an array of numbers.`);
  }
  return value;
}

/**
 * Discovers every active uniform on a linked program and returns a writer.
 *
 * Array uniforms are registered under their base name without the trailing
 * "[0]". The writer dispatches on the uniform's reflected GLSL type:
 * float scalars take numbers, vec2/vec3/vec4 and mat4 take number arrays or
 * Float32Arrays, and int/bool/sampler2D take values coerced with Number.
 *
 * @param gl The injected WebGL context that owns the program.
 * @param program A linked program to reflect uniforms from.
 * @returns A writer function; it throws on unknown names and unsupported types.
 */
export function createUniformWriter(gl: UniformContext, program: WebGLProgram): UniformWriter {
  const entries = new Map<string, UniformEntry>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (info !== null) entries.set(info.name.replace(/\[0\]$/u, ""), { info, location: gl.getUniformLocation(program, info.name) });
  }
  return function setUniform(name: string, value: UniformValue): void {
    const entry = entries.get(name);
    if (entry?.location === undefined || entry.location === null) throw new Error(`Unknown uniform ${name}.`);
    const { type } = entry.info;
    if (type === gl.FLOAT) gl.uniform1f(entry.location, Number(value));
    else if (type === gl.FLOAT_VEC2) gl.uniform2fv(entry.location, asFloatList(name, value));
    else if (type === gl.FLOAT_VEC3) gl.uniform3fv(entry.location, asFloatList(name, value));
    else if (type === gl.FLOAT_VEC4) gl.uniform4fv(entry.location, asFloatList(name, value));
    else if (type === gl.INT || type === gl.BOOL || type === gl.SAMPLER_2D) gl.uniform1i(entry.location, Number(value));
    else if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(entry.location, false, asFloatList(name, value));
    else throw new TypeError(`Uniform ${name} uses an unsupported WebGL type ${type}.`);
  };
}

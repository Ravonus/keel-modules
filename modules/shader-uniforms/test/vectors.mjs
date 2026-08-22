/** Deterministic test vectors for shader-uniforms. Run by `keel module test`. */

const GL = {
  ACTIVE_UNIFORMS: 35718,
  FLOAT: 5126,
  FLOAT_VEC2: 35664,
  FLOAT_VEC3: 35665,
  FLOAT_VEC4: 35666,
  FLOAT_MAT4: 35676,
  INT: 5124,
  BOOL: 35670,
  SAMPLER_2D: 35678,
};

/** Minimal WebGL context stand-in reflecting the given uniforms. */
function stubContext(uniforms) {
  const calls = [];
  return {
    calls,
    ...GL,
    getProgramParameter: () => uniforms.length,
    getActiveUniform: (_program, index) => uniforms[index] ?? null,
    getUniformLocation: (_program, name) => ({ name }),
    uniform1f: (location, value) => calls.push(["1f", location.name, value]),
    uniform1i: (location, value) => calls.push(["1i", location.name, value]),
    uniform2fv: (location, value) => calls.push(["2fv", location.name, [...value]]),
    uniform3fv: (location, value) => calls.push(["3fv", location.name, [...value]]),
    uniform4fv: (location, value) => calls.push(["4fv", location.name, [...value]]),
    uniformMatrix4fv: (location, transpose, value) => calls.push(["m4fv", location.name, transpose, value.length]),
  };
}

export default [
  {
    name: "writes scalars, vectors, ints, and matrices by reflected type",
    run: ({ createUniformWriter }) => {
      const gl = stubContext([
        { name: "u_time", type: GL.FLOAT },
        { name: "u_offset", type: GL.FLOAT_VEC2 },
        { name: "u_color", type: GL.FLOAT_VEC3 },
        { name: "u_frame", type: GL.INT },
        { name: "u_matrix", type: GL.FLOAT_MAT4 },
      ]);
      const write = createUniformWriter(gl, {});
      write("u_time", 1.5);
      write("u_offset", [0.25, 0.75]);
      write("u_color", [1, 0, 0.5]);
      write("u_frame", 7);
      write("u_matrix", new Array(16).fill(0));
      return gl.calls;
    },
    expect: [
      ["1f", "u_time", 1.5],
      ["2fv", "u_offset", [0.25, 0.75]],
      ["3fv", "u_color", [1, 0, 0.5]],
      ["1i", "u_frame", 7],
      ["m4fv", "u_matrix", false, 16],
    ],
  },
  {
    name: "array uniforms register under their base name",
    run: ({ createUniformWriter }) => {
      const gl = stubContext([{ name: "u_lights[0]", type: GL.FLOAT_VEC4 }]);
      const write = createUniformWriter(gl, {});
      write("u_lights", [1, 2, 3, 4]);
      return gl.calls;
    },
    expect: [["4fv", "u_lights[0]", [1, 2, 3, 4]]],
  },
  {
    name: "unknown names throw",
    run: ({ createUniformWriter }) => {
      const write = createUniformWriter(stubContext([]), {});
      try {
        write("u_missing", 1);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "Error",
  },
  {
    name: "vector uniforms reject scalar values",
    run: ({ createUniformWriter }) => {
      const gl = stubContext([{ name: "u_offset", type: GL.FLOAT_VEC2 }]);
      const write = createUniformWriter(gl, {});
      try {
        write("u_offset", 3);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
  {
    name: "unsupported reflected types throw",
    run: ({ createUniformWriter }) => {
      const gl = stubContext([{ name: "u_cube", type: 35680 }]);
      const write = createUniformWriter(gl, {});
      try {
        write("u_cube", 0);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
];

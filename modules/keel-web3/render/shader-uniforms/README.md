# shader-uniforms

WebGL uniform discovery and strict typed updates without eval or hidden globals. `createUniformWriter` reflects every active uniform on a linked program once, then returns a writer that dispatches on the uniform's GLSL type and throws loudly on unknown names or unsupported types.

## Injected dependencies

- `gl: WebGLRenderingContext | WebGL2RenderingContext`
- `program: WebGLProgram` (already linked)

## Usage

```ts
import { createUniformWriter } from "./src/index.ts";

const setUniform = createUniformWriter(gl, program);
setUniform("u_time", elapsedSeconds);
setUniform("u_resolution", [canvas.width, canvas.height]);
setUniform("u_projection", projectionMatrix);
```

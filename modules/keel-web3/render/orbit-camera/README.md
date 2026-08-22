# orbit-camera

Framework-free orbit-camera math for lightweight 3D artwork: an eye position orbiting a target with clamped pitch and minimum distance, and a column-major WebGL perspective projection matrix.

## Injected dependencies

None. The module is pure math with no environment access.

## Usage

```ts
import { orbitPosition, perspectiveMatrix } from "./src/index.ts";

const eye = orbitPosition({ yaw: time * 0.3, pitch: 0.4, distance: 6 });
const projection = perspectiveMatrix(Math.PI / 3, canvas.width / canvas.height);
```

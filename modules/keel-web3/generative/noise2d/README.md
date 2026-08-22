# noise2d

Tiny seeded 2D value-noise field. `noise2d` samples smoothly interpolated lattice noise in [0, 1); `fractalNoise2d` layers several octaves with configurable persistence and lacunarity. The same coordinates and seed always produce the same value on every machine.

## Injected dependencies

None. The module is pure math with no environment access.

## Usage

```ts
import { fractalNoise2d, noise2d } from "./src/index.ts";

const height = noise2d(x * 0.05, y * 0.05, 7);
const terrain = fractalNoise2d(x * 0.01, y * 0.01, { seed: 7, octaves: 5 });
```

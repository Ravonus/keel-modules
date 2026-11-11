# surfaces

Seeded painters of 2D surfaces, and prints. A recipe says what a surface holds;
a seed decides every fibre, stitch and stroke inside it; a painter returns an
albedo and a relief at the size asked, on the GPU in one pass or on the CPU with
the same arithmetic. No image crosses the wire.

```ts
import { KNIT, createSurfacePainter, paintSurface, surfaceTextures } from "keel://module/surfaces.js";
import * as lit from "keel://module/lit.js";

const knit = createSurfacePainter(renderer.getContext()).paint(KNIT, { width: 1024, seed: 3 });
// or, in a worker or at build time: paintSurface(KNIT, { width: 1024, seed: 3 })
// knit.digest: the cache key; knit.buffers: [albedo, relief]
const { map, normalMap } = surfaceTextures(lit, knit);
map.repeat.set(7, 3);
const cap = new lit.LitMaterial({ map, normalMap, roughness: 0.85 });
```

## A recipe in, `{ digest, buffers }` out

Every painter returns a `Surface`: `{ digest, width, height, buffers }`.
`buffers` is `[albedo, relief]`, each `width × height × 4` bytes, rows from the
top as `ImageData` holds them:

- **albedo**: sRGB colour, alpha 255.
- **relief**: the normal in RGB (+x to the right, +y toward the top row, 128 is
  flat) and the height in A. The normal is the height's slope at four
  neighbours, scaled by the recipe's `depth`.

`postMessage(surface, surface.buffers)` hands a surface to another thread
without a copy. The digest covers every number the painter reads, the kind,
the size, the depth and `PAINTER_VERSION`, so a host keys a stored surface by
it. `surfaceTextures(lit, surface)` gives two repeating, mipmapped lit textures
(`flipY` set, so the top row is up).

## The painters

| kind | holds | tiles | recipe |
| --- | --- | --- | --- |
| `paper` | fibre noise (two scales of short fibres, a few dark), flecks, a cloudy mottle, soft stains with a tide line, faint laid and chain lines | yes | `PAPER`: a pale grey-green sheet for a page band |
| `knit` | a rib stitch lattice: columns of knit Vs, each leg a plied tube that dives under the next, purl bumps between the columns, fuzz | yes | `KNIT`: hot pink, 8 ribs and 18 courses a tile |
| `painted` | a ground in a palette, cloth folds with a sheen or soft painted masses (petals, leaves, blooms), brush texture, a glaze | no | `PAINTED_FLORAL`, `PAINTED_CLOTH`: two card backgrounds |

Tileable painters read periodic noise only, so a tile meets itself at every
edge at any size. A painted ground is any aspect: masses are placed in shares
of the width and height and sized in shares of the height.

Colours are `#rrggbb`. `depth` is how tall a height of 1 stands as a share of
the surface's height: 0.025 for the knit, a few thousandths for paper and paint.

`veins`, `cracks` and `motif` are planned: their recipes (`VeinsRecipe`,
`CracksRecipe`, `MotifRecipe`) are settings only, and `planSurface` throws for
them until they are built.

## Prints

`createPrinter(lit, canvasOf)` returns `print(size, draw, options)`. The host
draws its own card face, label or screen into a fresh 2D canvas and gets a lit
`CanvasTexture`: sRGB, or with `{ data: true }` no colour space, for maps that
are not colour. `pbr(roughness, metalness)` is the colour that paints both into
one data print (G roughness, B metalness, as lit reads them), so a print's small
metal detail, a chip or a foil, is two prints on one material:

```ts
const print = createPrinter(lit, (w, h) => new OffscreenCanvas(w, h));
const face = print([1024, 646], drawFace);
const finish = print([1024, 646], (ctx, w, h) => {
  ctx.fillStyle = pbr(0.5, 0.15);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = pbr(0.3, 1);                    // the chip: smooth metal
  ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
}, { data: true });
const card = new lit.LitMaterial({ map: face, roughnessMap: finish, metalnessMap: finish, roughness: 1, metalness: 1 });
```

To redraw, draw into `texture.image` again and set `texture.needsUpdate`.

## Determinism

`planSurface` works out what a seed decides (salts, the masses' places and
turns) with integer hashes and plus, minus, times, divide and the square root,
so a seed gives the same plan and digest on every engine. The per-pixel noise
hashes the same lattice on the GPU and the CPU, and the CPU path matches the
GPU's bytes: the same byte almost everywhere, a few isolated pixels up to nine
steps apart where float rounding falls across a threshold, and a painted
ground's relief along its outermost pixels, where the CPU wraps and the GPU
reads past the edge.

## Settings

`planSurface(recipe, { seed, width, height })`: `seed` a whole number from 0
(default 0), `width` and `height` 1..4096 pixels (default 1024, the height
defaulting to the width). Out-of-range values throw.

## Injected dependencies

- `gl`: the host's `WebGL2RenderingContext`, for `createSurfacePainter`. The
  painter restores the state it changes (framebuffer, viewport, program, vertex
  array, texture binding, pixel-pack buffer, and the blend, depth, cull, scissor
  and stencil flags).
- `lit`: the keel/lit namespace, for `createPrinter` and `surfaceTextures`.
- `canvasOf(width, height)`: makes the canvas a print draws into.

## Demo

`node modules/keel-web3/generative/surfaces/tools/serve.mjs` serves a local
page (never published): `?view=card` (a card whose face is a print, under the
generated studio), `sphere` (the knit's relief lit on a sphere), `paper`,
`knit`, `floral`, `cloth` (3 × 3 tiles). It needs a keel-engine checkout whose
keel/lit has the `Environment` (`KEEL_ENGINE`, `KEEL_ESBUILD`).

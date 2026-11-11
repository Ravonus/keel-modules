# brush

A GPU brush engine. A planner hands it strokes, a path of up to eight points
with a tip, a size, a colour, a medium and how loaded and wet the brush is,
and it lays them on a canvas as paint: colour in linear light, and relief for
the finish to light. It plans nothing itself; `generative/painting` is its
planner.

```js
import { createBrush, packStrokes } from "keel://module/brush.js";

const brush = createBrush(gl, 7);                 // the seed picks the grain and the weave
const canvas = brush.canvas(960, 1152);
brush.paint(canvas, packStrokes([
  { path: [[120, 300], [180, 260], [260, 250]], tip: "filbert", size: 14, colour: [0.93, 0.8, 0.69],
    opacity: 0.8, medium: "oil", load: 1, wet: 0.6, height: 0.2, taper: [0.5, 0.3] },
]));
brush.glaze(canvas, { tint: [0.91, 0.63, 0.54], opacity: 0.2 });
const texture = brush.finish(canvas);              // premultiplied linear, row 0 the bottom
const rgba = brush.read(texture, 960, 1152);       // straight sRGB bytes, rows from the top
brush.release(canvas);
```

- **Strokes.** `packStrokes` packs each stroke into 32 floats (eight points,
  the last repeated; colour and opacity; size; taper; load; wet; height; tip;
  bristles; medium; seed; points; dabs) and a digest. The path is a chain of
  quadratic curves through the points' midpoints. The CPU never expands
  dabs: one instance a stroke, and the vertex shader lays its dabs, one every
  0.15 of the tip's width (`dabsOf`, 2 to 128), each oriented along the
  curve, the width tapered from `taper[0]` to `taper[1]` of `size`.
- **Tips.** `round` a soft disc; `flat` a square-ended slab, short along the
  stroke; `filbert` a rounded slab; `rake` a slab of separate hairs
  (`bristles`, default 7). Every tip carries seeded bristle streaks along the
  stroke, and a dab's flow is worked out from the spacing, so a stroke's
  opacity is its own whatever its length.
- **Grain.** A 256² tile of value noise (`noiseTile`, four wrapping octaves)
  breaks dry paint: `load` runs out along the stroke, and as it does the
  paint catches only the grain's peaks. The canvas weave (`weaveTile`) is
  painterly's `grainTile`, byte for byte.
- **Media.** `oil` covers by its coverage. It picks up wet paint: a batch
  paints in sub-batches (`subBatches`, 4 by default), each over a snapshot of
  the canvas as the ones before left it, and an oil dab mixes in what lies a
  little way back along its stroke, by `wet`. `wet: 2` is a clean blender,
  carrying only what it picks up. `glaze` multiplies the canvas by its colour
  in linear light. `scumble` lays light broken over the grain and the relief.
  Oil leaves relief: about `height` along a stroke's middle at full load
  however many dabs lay it, and wetness, kept as the most a pixel took.
- **Glaze and fill.** `glaze` multiplies the canvas by a tint, through a mask
  if given. `fill` lays a texture on as opaque paint at an opacity: an
  underpainting the planner made.
- **The finish.** The relief, compressed so it never cliffs, lit by a key
  from the upper left (`key`, `relief`), and the canvas weave where the paint
  is thin (`weave`). Defaults: relief 3, weave 0.12.

## Exactness

`packStrokes`, `dabsOf`, `noiseTile` and `weaveTile` use integer hashes and
plus, minus, times, divide and the square root, so a stroke list and a seed
give the same floats and digest on every engine; the vectors pin them. The
raster is the GPU's and is checked by tolerance per GPU, not pinned.

## Settings

`createBrush(gl, seed)`: `seed` a whole number (default 1). `paint(canvas,
batch, subBatches)`: 1..16 snapshot steps (default 4). A stroke's path has 2
to 8 points and its size is above 0, or `packStrokes` throws.

## Injected dependencies

- `gl`: a `WebGL2RenderingContext` with `EXT_color_buffer_float`; the brush
  throws without it. Canvases are RGBA16F colour and relief targets, freed by
  `release`; `dispose` frees the programs and tiles.

## Budgets

- Code: 17,433 B min, 6,028 B brotli (E 8–10 KB in the spec).
- Paint: the 06 figure's 15.7 k strokes over eight canvases of 0.07–1.2 Mpx,
  0.9–6 ms a layer and about 24 ms in all on the GPU at four sub-batches
  (M4 Max, Chrome on Metal, median of 7 at load 9; `generative/painting`'s
  trial).
- Memory: two RGBA16F targets and a snapshot a canvas, about 24 bytes a pixel
  while it is painted.

## Where it comes from

The hash, unit and weave are painterly's (`hash32`, `unit`, `grainTile`); the
digest, value noise, bristle streak and one-instance-a-stroke dab expansion
are plate-painter's. They are copied, not imported, as modules are
self-contained; plate-painter, surfaces and painterly keep their own until
they move onto this brush.

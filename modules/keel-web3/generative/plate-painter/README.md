# plate-painter

A painted landscape plate, generated on the GPU when the page loads. A recipe
says what the plate holds and where; a seed decides every shape inside those
bounds; five GPU passes paint it into a texture. The texture is drawn behind a
scene as a screen-space backdrop, locked to the camera, or read back as a still
for a poster or a phone. No image crosses the wire.

```ts
import { LAKE_VALLEY, createPlatePainter, planPlate } from "keel://module/plate-painter.js";

const painter = createPlatePainter(gl);            // compiles the passes once
const plan = planPlate(LAKE_VALLEY, { seed: 6 });  // exact arithmetic, with a digest
const plate = painter.paint(plan, { width: canvas.width, height: canvas.height });
// each frame, before the scene (keel/lit: renderer.autoClear = false):
painter.draw(plate, { width: canvas.width, height: canvas.height });
```

## The recipe

Fractions of the plate, x across from the left and y down from the top; colours
are hex. `LAKE_VALLEY` is the example: an overcast sky, mauve far peaks, a
blue-green range, low hills, a pale far shore with a small town and a row of
spires, a still lake, a dark near bank, and a leafy branch and a mass of broad
leaves at the near left. Write one recipe per scene; the seed then varies it.

| part | what it holds |
|---|---|
| `sky` | top, horizon and corner colours; a cloud band (`band`, `centre`, `cover`) lit from the upper left |
| `ranges` | up to four mountain planes, back to front: span, foot, peaks, roughness, `depth`, lit and shaded faces |
| `shore`, `water` | the far shore's band, the waterline, the near edge, the lake's far and deep colours and its sheen |
| `ground` | the near bank, dark, warm toward the lower right, with soft shrubs |
| `trees`, `town` | rows of spires and banks of crowns; flat walls and towers on a rise; all reflected in the lake |
| `leaves` | branches (a curve with leaves along it) and masses (a box), the leaf ramp, and `bound`, the x no leaf crosses |
| `strokes` | per region (sky, ridges, shore, water, ground): angle, length and width as shares of the width, opacity |
| `haze`, `hazeStep` | the colour of the air; each depth step moves a plane that share of the way to it |
| `weave`, `vignette` | the canvas's period as a share of the width; the corners' darkening |

## The passes

1. **Scene.** Sky with soft clouds, the ranges from their crests (sampled on the
   CPU), shaded by the slope of the crest above each point with spurs running
   down the faces, faded to mist at their feet and toward the haze by depth; the
   far shore; the lake reflecting all of that with ripples and a sheen under the
   shore; the near ground. The alpha channel carries each pixel's region.
2. **Middle distance.** Spires, crowns, walls and towers as dabs, softer the
   farther they are, each one again upside down in the water, broken by ripples.
3. **Strokes.** A short smear along each region's flow, then strokes laid one a
   cell, each the colour under its centre, unless that colour belongs to
   another plane, so strokes do not cross a silhouette. Horizontal in water,
   slightly rising in the sky, down the faces on the ranges.
4. **Leaves.** Lanceolate and lobed serrated leaves: crisp edges, a soft fold
   toward the light, streaks along the blade, broken colour, a midrib; dark blots
   behind them make the shade of the mass.
5. **Finish.** A broad glaze of uneven colour, a canvas weave seen only in the
   lights (and faded where it would alias), the vignette, and a varnish.

`render/painterly` can run over the result as an extra finish; the plate does
not need it.

## Backdrop, parallax and stills

`draw(plate, view)` fits the plate to cover the target rectangle. `focus` keeps
a point in view; `zoom` above 1 leaves room for `shift`, the parallax hook: a
small move in crop widths and heights, held inside the plate. A section that
wants a slow drift passes `shift: [0, scroll * 0.02]`.

`coverCrop(plan.aspect, width / height, { focus })` is the part of the plate a
target shows. Pass it as `view` to `paint` and a portrait still is painted at
full resolution, not cut from a larger plate:

```ts
const view = coverCrop(plan.aspect, 780 / 1688, { focus: [0.3, 0.5] });
const still = painter.read(painter.paint(plan, { width: 780, height: 1688, view }));
const canvas = new OffscreenCanvas(still.width, still.height);
canvas.getContext("2d").putImageData(new ImageData(still.data, still.width, still.height), 0, 0);
const png = await canvas.convertToBlob({ type: "image/png" });
```

## In a keel/lit stage

A keel/lit host binds the plate as its own texture. On each resize it paints
straight into a `RenderTarget` of the new size: no read-back, no copy.

```ts
const target = new lit.RenderTarget(w, h, { depthBuffer: false });
renderer.setRenderTarget(target);
painter.paintBound(plan, { width: w, height: h, view: coverCrop(plan.aspect, w / h) });
renderer.setRenderTarget(null);
material.uniforms.uPlate.value = target.texture; // row 0 is the plate's top
```

Draw it as a full-frame quad with `depthTest` and `depthWrite` off, first in
the stage. The far plane then holds it, and `render/lit-finish` with
`backdrop: true` leaves it alone: the plate keeps the aerial perspective
painted into it, while the finish's haze falls on everything in front.

## Settings

`planPlate(recipe, settings)` takes the module's inputs: `seed` (a whole number,
default 0), `haze` (0..2, scales every depth step), `clouds` (-0.5..0.5) and
`foliage` (false leaves the near leaves out). Out-of-range values throw.

## Cache

`paint` returns the plate it already painted for the same digest, size and
view. `paintBound` keeps nothing: the host's target holds the plate, and the
host can key it by the digest. The digest covers every number in the plan and
`PAINTER_VERSION`, which moves whenever the passes would paint the same plan
differently, so a host can also key a stored still by it. `release(plate)` frees one plate; `dispose()`
frees them all and the programs.

## Determinism

The plan (crests, every dab's place, size, angle and colour, the uniforms) is
worked out with integer hashes and plus, minus, times, divide and the square
root: angles come from rational half-tangents, not `Math.sin`. A seed gives the
same plan and digest on every engine. The GPU passes paint from that plan with
floats and may differ in the last bit between GPUs.

## Injected dependencies

- `gl`: the host's `WebGL2RenderingContext`. The painter restores the state it
  changes (framebuffer, viewport, program, vertex array, texture unit 0, blend,
  depth, cull and scissor flags).

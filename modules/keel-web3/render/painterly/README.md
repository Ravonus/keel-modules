# painterly

A lit keel/lit stage painted as an oil painting. The frame is smoothed along its
structure, strokes are stamped along the form, and the picture is finished with
canvas grain and a varnish grade, with no line along any edge. It is a post pass: it takes the
frame's colour and depth and knows nothing of what was drawn.

```js
import { createPainterly, SMOOTH_SETTINGS } from "keel://module/painterly.js";

renderer.toneMapping = "none"; // the painter tone maps
const paint = createPainterly(lit, renderer, { stroke: 5, grain: 0.2 });
paint.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
renderer.setAnimationLoop(() => paint.render(scene, camera));
paint.render(scene, camera, () => plates.draw(plate, size)); // a backdrop drawn first, the scene over it
paint.setSettings(SMOOTH_SETTINGS); // the smoothed base alone, no strokes
paint.setView("raw");               // the lit frame tone mapped, for comparing
paint.setView("flow");              // for checking: the flow as colour (hue its direction, saturation how oriented)
```

- **The frame.** The scene draws into a linear half-float target with depth,
  without multisampling: the paint smooths what it draws, and at the default
  `resolution` of 0.5 every painted pixel takes four of the frame's. A backdrop
  given to `render` draws first into the cleared frame, a plate-painter plate
  say, and the scene draws over it; having no depth, it is painted as a sky
  is, by its colour's flow. The frame is tone mapped (ACES) and brought to
  sRGB at the paint's size.
- **The structure.** A structure tensor at every painted pixel, blurred: from
  the colour's gradients (a Sobel), and from the form's, which are the
  gradients of the surface normal and of the depth as a share of the distance.
  The normal is rebuilt from depth (as lit-finish's AO does) and then smoothed
  over the mesh's facets, each tap counting only on the same surface: a low
  mesh's normal from depth is flat on each face and turns only at its edges,
  and a flow taken raw from it follows the mesh's rings, not the form.
  `direction` mixes the two tensors: at 0 the flow follows the colour, as a
  photo filter would; at 1 it follows the shape, so strokes wrap a cheek and
  run along an arm whatever is painted on them. The sky, having no depth,
  keeps the colour's flow. With the tensor goes how fine the picture is there:
  where the colour has detail, and where the form is small (a face, a hand: the
  normal turns fast), 0 in the sky and on open ground up to 1.
- **The base.** An anisotropic Kuwahara filter: eight overlapping sectors of an
  ellipse stretched along the flow, radius `stroke` painted pixels; each
  sector's mean weighs in by how flat it is, so edges stay crisp and flat
  passages turn to paint. `SMOOTH_SETTINGS` stops here.
- **The strokes.** Two layers of strokes stamped over the base, one stroke a
  cell: broad strokes (three brushes a cell) where the picture is plain, fine
  ones (one brush) where it is fine. Each stroke lies along the flow at its
  centre, turned a little its own way only where nothing orients it; it is
  large and long where the picture is plain, a sky or water, small and short
  where it is fine, a face or a hand, and each its own length within that. A
  stroke carries the colour under its centre, a shade lighter or darker than
  its neighbours (a value jitter of a few percent, the stroke's own), with a
  soft edge and no rim, so it blends in as colour rather than sitting on the
  picture as a mark; where the picture is fine the strokes sink part way into
  the base. A stroke stays on its own surface and its own colour: the frame's
  depth travels with the paint, so a stroke laid in the sky at the hat's edge
  does not cross onto the hat (`edge` is how strictly a stroke keeps to its
  own depth), and one fades out where the base's colour leaves its own, so a
  bank's stroke does not cross onto the water. `strokes` is how much of this
  layer shows; `STROKED_SETTINGS` (the default) shows it all.
- **The finish.** No line and no darkening along a silhouette; the strokes'
  relief lit faintly from the upper left; the canvas weave showing
  through only where the paint is thin (`grain`): under no stroke, away from
  the fine passages, and in the thin patches the seed lays out; and the
  varnish (`grade`): a warm glaze, blacks lifted toward umber, a little
  contrast and a vignette. The passes work in half floats, so a sky does not
  band when the varnish stretches it.
- **The seed.** `seed` decides where every stroke lies in its cell, how long it
  is and which lies on top (`strokeTile`), and the canvas's plain weave with each
  thread shifted its own way (`grainTile`). Both are worked out in integer and
  exact arithmetic, so a seed gives the same bytes on every engine; the
  strokes' direction and colour come from the picture, on the GPU, and may use
  `Math`.

keel/lit is injected: the module never imports it and never touches globals.

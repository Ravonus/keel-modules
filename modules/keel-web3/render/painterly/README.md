# painterly

A lit keel/lit stage painted as an oil painting under an old varnish. The frame
is smoothed along its structure and blended along it, as paint glazed and
blended is; strokes can be laid along the form over that, but are not by
default; and the picture is finished with a warm varnish, a fine craquelure and
canvas showing in the thin, dark passages. It is a post pass: it takes the
frame's colour and depth and knows nothing of what was drawn.

```js
import { createPainterly, STROKED_SETTINGS } from "keel://module/painterly.js";

renderer.toneMapping = "none"; // the painter tone maps
const paint = createPainterly(lit, renderer, { stroke: 4, crackle: 0.25 });
paint.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
renderer.setAnimationLoop(() => paint.render(scene, camera));
paint.render(scene, camera, () => plates.draw(plate, size)); // a backdrop drawn first, the scene over it
paint.setSettings(STROKED_SETTINGS); // a few soft strokes over the glaze
paint.setView("raw");                // the lit frame tone mapped, for comparing
paint.setView("flow");               // for checking: the flow as colour (hue its direction, saturation how oriented)
```

- **The frame.** The scene draws into a linear half-float target with depth,
  without multisampling: the paint smooths what it draws, and at the default
  `resolution` of 0.5 every painted pixel takes four of the frame's. A backdrop
  given to `render` draws first into the cleared frame, a plate-painter plate
  say, and the scene draws over it; having no depth, it is painted as a sky
  is, by its colour's flow. The frame is tone mapped (ACES) and brought to
  sRGB at the paint's size.
- **The structure.** A structure tensor at every painted pixel, blurred: from
  the colour's gradients (a Sobel), and from the form's, the gradient of the
  depth as a share of the distance, so the flow runs along the lines of equal
  depth, around a cheek and along an arm. `direction` mixes the two: at 0 the
  flow follows the colour, as a photo filter would; at 1 it follows the shape.
  The sky, having no depth, keeps the colour's flow. With the tensor goes how
  fine the picture is there: where the colour has detail, where the form is
  small or turns steeply (a face, a hand, a silhouette), and where it is
  flesh, which a painter keeps smooth; 0 in the sky and on open ground up to 1.
- **The base.** An anisotropic Kuwahara filter: eight overlapping sectors of an
  ellipse stretched along the flow, radius `stroke` painted pixels and half
  that where the picture is fine, so an eye keeps its eye; each sector's mean
  weighs in by how flat it is, so edges stay crisp and flat passages turn to
  paint.
- **The glaze.** The base blended along the flow, so the filter's facets melt
  into soft turns of value. Each tap counts for how close its value is to the
  pixel's own, so an edge between close values is lost and one between far
  values is found, and only on the same surface, so nothing blends across a
  silhouette. The blend reaches a brush or two where the picture is plain and
  hardly at all where it is fine, and there the local contrast is brought back
  a little, so a face stays as crisp as it was drawn. `GLAZE_SETTINGS` (the
  default) stops here.
- **The strokes.** `strokes` lays strokes over the glaze, and is meant low: a
  few, not a surface of them. Two layers, one stroke a cell: broad strokes
  (three brushes a cell) where the picture is plain, fine ones (one brush)
  where it is fine. Each stroke lies along the flow at its centre; it is large
  and long where the picture is plain, a sky or water, small and short where
  it is fine, a face or a hand, and each its own length within that. A stroke
  carries the colour under its centre, a shade lighter or darker than its
  neighbours, with a soft edge and no rim, so it reads as colour and not as a
  mark; it stays on its own surface (`edge` is how strictly it keeps to its
  own depth) and fades out where the base's colour leaves its own.
  `STROKED_SETTINGS` lays a few.
- **The finish.** No line and no darkening along a silhouette. The varnish
  (`grade`): a warm glaze, blacks lifted toward umber, a little contrast and a
  vignette. Its craquelure (`crackle`): a net of fine cracks between islands
  with a finer net inside, bent so no crack runs straight, each a dark thread
  whose upper-left lip catches the light. The canvas (`grain`): its weave
  showing only where the paint is thin and dark: under no stroke, away from
  the fine passages, in the thin patches the seed lays out, and in the dark
  passages where a painter's ground is thinnest. The passes work in half
  floats, so a sky does not band when the varnish stretches it.
- **The seed.** `seed` decides where every stroke lies in its cell, how long it
  is and which lies on top (`strokeTile`), the canvas's plain weave with each
  thread shifted its own way (`grainTile`), and the varnish's cracks
  (`crackTile`). All are worked out in integer and exact arithmetic, so a seed
  gives the same bytes on every engine; the strokes' direction and colour come
  from the picture, on the GPU, and may use `Math`.

keel/lit is injected: the module never imports it and never touches globals.

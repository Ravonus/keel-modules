# scene-blend

A hand-over between two keel/lit scenes on one renderer. While a page scrolls
from one scene to the next it draws both, each through the same finish into its
own half-float target, and blends them in one pass. The incoming scene arrives
as white line work over the outgoing one and fills in through a seeded noise
threshold (or out from a point, radially) with a glowing seam along the
boundary; the outgoing scene takes on line work of its own as it goes.

## Injected dependencies

- `lit`: the keel/lit namespace (`RenderTarget`, `DataTexture`,
  `CustomMaterial`, `plane`, `Mesh`, `Stage`, `OrthoCamera`).
- `renderer`: the keel/lit renderer that owns the canvas.
- `finish` (optional): the finish both scenes are drawn through, lit-finish's
  `createLitFinish` result or anything with `render(scene, camera)` that draws
  onto the renderer's current target. Null draws scenes plain.

## Usage

```ts
import * as lit from "keel://module/lit.js";
import { createLitFinish } from "keel://module/lit-finish.js";
import { createSceneBlend } from "keel://module/scene-blend.js";

const finish = createLitFinish(lit, renderer);
const blend = createSceneBlend(lit, renderer, finish, { seed: 7 });
finish.setSize(width, height, renderer.getPixelRatio());
blend.setSize(width, height, renderer.getPixelRatio());

// each frame of the pair's life, t from the page (0 all outgoing, 1 all incoming):
const current = blend.draw({ scene: a, camera: cameraA }, { scene: b, camera: cameraB }, t, {
  mode: "noise",      // or "radial", or "fade"
  centre, pointer,    // radial only: -1..1 each way, y up
  darken: 0,
});
if (current !== active) switchSection(current); // the switch is the host's
```

`draw` works for any `t`. At 0 or below it draws the outgoing scene alone, at 1
or above the incoming alone, each straight to the renderer's current target, so
the host can call it on every frame either side of the overlap. It returns the
current scene: `"a"` before the switch at 0.5, `"b"` from it.

A shot is `{ scene, camera }`, drawn through the finish when there is one, or a
function that draws a scene onto the renderer's current target itself.

## The look at t

| t | incoming lines | outgoing lines | fill |
|---|---|---|---|
| 0 | 1 | 0 | none |
| 0.25 | 0.75 | 0 | starts |
| 0.5 (switch) | 0.5 | 0 | a third |
| 0.9 | 0 | 0.8 | most |
| 1 | 0 | 1 | all |

`blendLines(t)` and `blendFill(t)` give these; `draw`'s `lines: { in, out }`
overrides the line work from a host's own tracks. Lines are luma edges of the
finished picture (a Sobel one pixel apart) in `lineColour`; the outgoing also
darkens toward black as it takes its lines, so it leaves as a drawing on black.

- `noise`: each pixel fills when the reveal passes its noise value.
- `radial`: the reveal runs out from `centre` (the frame's centre by default),
  pulled toward the pointer by `pull` (0.1), its edge roughened by the noise.
- `fade`: a plain dissolve with no lines, noise or seam, for reduced motion; the
  host drives `t` by time.

## Settings

| key | default | |
|---|---|---|
| `seed` | 1 | the noise texture's seed |
| `lineColour` | `#f7f7ee` | the line work |
| `seamColour` | `#fff1cc` | the seam's glow |
| `glow` | 1.4 | how bright the seam is, 0..4 |
| `seam` | 0.003 | the seam's width as a share of the frame's height, 0..0.05 |
| `edge` | 0.12 | the luma step that makes a line; lower draws more |
| `noiseScale` | 0.6 | noise repeats down the frame's height |
| `pull` | 0.1 | how far the pointer pulls a radial centre |

Colours are display values: the blend works on finished, tone-mapped pictures.

## Determinism

The noise is a 256² RGBA texture worked out from the seed with integer hashes,
plus, times and divide only (`noiseTexels`), never `Math.random`, so the same
seed gives the same bytes on every engine and a capture of a hand-over repeats.

## Cost

Two targets of the canvas's size (half float, no depth with a finish), the
scene drawn twice through the finish, and one pass of 18 texture reads a pixel
(two Sobels). A finish's TAA cannot keep one history for two scenes, so while
0 < t < 1 the blend turns the finish's TAA off and turns it back on, reset, once
the overlap ends; it also dresses both scenes every 30 blend frames, as the
finish does for the one scene it draws.

Not here: drawing the outgoing scene at a lower scale (quality's `blendScale`).
A shared finish has one size, so that needs a finish that can draw into part of
its targets.

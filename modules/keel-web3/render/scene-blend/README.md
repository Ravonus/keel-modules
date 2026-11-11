# scene-blend

A hand-over between two keel/lit scenes on one renderer. While a page scrolls
from one scene to the next it draws both, each through the same finish into its
own half-float target, and blends them in one pass. The incoming scene arrives
as white line work over the outgoing one and fills in through a seeded noise
threshold (or out from a point, radially) behind a soft boundary with at most a
faint glow along it; the outgoing scene takes on thin lines of its own as it goes.

## Injected dependencies

- `lit`: the keel/lit namespace (`RenderTarget`, `DataTexture`,
  `CustomMaterial`, `plane`, `Mesh`, `Stage`, `OrthoCamera`).
- `renderer`: the keel/lit renderer that owns the canvas.
- `finish` (optional): the finish scenes are drawn through, lit-finish's
  `createLitFinish` result or anything with `render(scene, camera)` that draws
  onto the renderer's current target. Null draws scenes plain. Or
  `{ main, scaled }`: a second finish for the less visible scene, drawn at the
  `scale` setting (quality's `blendScale`) into a smaller target.

## Usage

```ts
import * as lit from "keel://module/lit.js";
import { createLitFinish } from "keel://module/lit-finish.js";
import { createSceneBlend } from "keel://module/scene-blend.js";

const finish = createLitFinish(lit, renderer);
// optional: the less visible scene at a lower scale, without AO, bloom or TAA
const scaled = createLitFinish(lit, renderer, { ao: 0, bloom: 0, taa: false });
const blend = createSceneBlend(lit, renderer, { main: finish, scaled }, { seed: 7, scale: levers.blendScale });
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
overrides the line work from a host's own tracks. Lines are thin luma edges of
the finished picture (a Roberts cross one pixel apart) in `lineColour` at
`lines` strength, fading where the fill has come in; the outgoing also darkens
toward black as it takes its lines, so it leaves as a drawing on black. Only the
moving boundary glows, and only by `glow`; island outlines carry no seam.

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
| `lines` | 0.55 | how strong the line work is, 0..1 |
| `edge` | 0.05 | the luma step that makes a line; lower draws more |
| `soft` | 0.06 | how soft the reveal's boundary is, a share of the noise's range, 0..0.3 |
| `seamColour` | `#fff1cc` | the boundary's glow |
| `glow` | 0.25 | how bright the boundary glows, 0 (none)..4 |
| `seam` | 0.05 | the glow's width, a share of the noise's range, 0..0.3 |
| `noiseScale` | 0.6 | noise repeats down the frame's height |
| `pull` | 0.1 | how far the pointer pulls a radial centre |
| `scale` | 1 | the less visible scene's scale, 0.25..1; used with a scaled finish (or none) |

Colours are display values: the blend works on finished, tone-mapped pictures.

## Determinism

The noise is a 256² RGBA texture worked out from the seed with integer hashes,
plus, times and divide only (`noiseTexels`), never `Math.random`, so the same
seed gives the same bytes on every engine and a capture of a hand-over repeats.

## Cost

Two half-float targets (no depth with a finish): one of the canvas's size for
the more visible scene, one at `scale` for the less visible one (the incoming
before the switch, the outgoing after), so at 1440x900 DPR 2 and scale 0.75 they
take 41 MB and 23 MB. Both scenes are drawn, then one pass of 9 texture reads a
pixel. A finish's TAA cannot keep one history for two scenes, so while
0 < t < 1 the blend turns TAA off on its finishes and back on, reset, once the
overlap ends; it also dresses both scenes every 30 blend frames, as the finish
does for the one scene it draws.

A scaled finish keeps its own targets at the lower size; at scale 0.75 that is
roughly 0.56 of the main finish's memory. Without a scaled finish both scenes go
through the main finish whole and `scale` is not used.

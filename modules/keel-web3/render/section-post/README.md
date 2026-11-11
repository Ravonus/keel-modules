# section-post

One full-screen pass after the finish, for what a scrolled section lays over
its scene: a paper panel that sweeps up over the frame and off its top with a
straight or torn edge, a thin band of fibres just past the edge and a soft
shadow under it, darkening and blur of the frame under the panel, and a
one-pixel grain over everything. Every value is a plain number a host feeds
from its tracks each frame.

## Injected dependencies

- `lit`: the keel/lit namespace (`RenderTarget`, `DataTexture`,
  `CustomMaterial`, `plane`, `Mesh`, `Stage`, `OrthoCamera`).
- `renderer`: the keel/lit renderer that owns the canvas.
- `shaders`: lit-finish's namespace, for its `BLUR_GLSL`. The blur is the
  finish's own separable Gaussian, not a copy.

## Usage

```ts
import * as lit from "keel://module/lit.js";
import * as finishModule from "keel://module/lit-finish.js";
import { createSectionPost } from "keel://module/section-post.js";

const finish = finishModule.createLitFinish(lit, renderer);
const post = createSectionPost(lit, renderer, finishModule, { colour: "#f7f7ee", tear: 1 });
post.setSize(width, height, renderer.getPixelRatio());

// each frame, the values from the host's tracks:
post.render(() => finish.render(scene, camera), { progress, position, darken, blur });
// or over a hand-over:
post.render(() => blend.draw(a, b, t, { mode: "noise" }), { progress, position });
```

`render(draw, values)` has `draw` put the frame onto the pass's own target,
then lays the pass onto the target the renderer had. A frame that needs none of
it (no panel on screen, no darkening, blur or grain) is drawn straight to the
host's target, at no cost.

## Values

| value | range | |
|---|---|---|
| `progress` | 0..2 | the sweep: 0 → 1 the panel's top edge rises from the frame's bottom to its top, covering it; 1 → 2 its bottom edge follows, uncovering it; 0 and 2 nothing |
| `position` | -1..1 | moves both edges, in frame heights (y up), for a host whose track places the panel rather than sweeping it |
| `colour` | [r, g, b] | the paper, display values 0..1; the `colour` setting by default |
| `tear` | 0..1 | 0 a straight edge, one clean line; 1 a continuous, finely jagged edge straying up to 1.6 % of the frame's height, with a few loose hairs |
| `fibre` | 0..1 | a thin band of lighter fibres just past the edge, 1.5 px straight to 4 px fully torn |
| `shadow` | 0..1 | a soft shadow the panel casts onto the frame past its edge |
| `grain` | 0..0.2 | one-pixel grain over the whole frame, a share of full luminance |
| `darken` | 0..1 | darkens the frame under the panel |
| `blur` | 0..1 | blurs the frame under the panel: the outer taps reach `blur` × 16 % of the frame's height (0.08 reaches 1.3 %) |

`tear`, `fibre`, `shadow` and `grain` default to the settings; the rest to 0.

## Settings

| key | default | |
|---|---|---|
| `seed` | 1 | the noise texture's seed |
| `colour` | `#f7f7ee` | the paper |
| `tear` | 0 | |
| `fibre` | 0.8 | |
| `shadow` | 0.35 | |
| `paper` | 0.4 | the paper's own mottle |
| `grain` | 0.02 | |
| `noiseScale` | 1 | noise repeats down the frame's height |
| `depth` | false | give the frame's target a depth buffer: needed when `draw` renders a plain scene rather than a finish |

## Determinism

The noise is the same 256² RGBA texture as scene-blend's, worked out from the
seed with integer hashes and plain arithmetic, never `Math.random`: the same
seed gives the same bytes on every engine, so a capture repeats.

## Cost

One target of the canvas's size (8 bits a channel: the finish's output is
already graded and dithered) and one pass of up to eight texture reads a pixel.
A blur adds two half-size passes, only while `blur` > 0.

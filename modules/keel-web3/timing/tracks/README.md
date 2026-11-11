# tracks

Keyed tracks sampled at a position. A scrolled page, a timeline or a clock
hands in one number and gets back every keyed value: camera eye and fov, a
rig's clip progress, a bloom level, an overlay colour. Keys ease into each other
through a cubic-bezier handle pair, like CSS `cubic-bezier()`, so a motion
designer's curves paste in as they are.

The sampler is small on purpose (under 1 KB minified): a track format, a bezier
solver, a mixer and a loop. The same handle pairs drive DOM tracks in weft's
`timeline()`; the two live in different repositories because the engine does
not depend on weft. Keep them in step by hand.

## Injected dependencies

None. Pure arithmetic, no DOM, no renderer.

## The track format

```json
[
  { "target": "camera", "property": "eye",
    "keys": [[-0.49, [-1.06, 1.43, 2.1], [0.21, 0.61, 0.35, 1]], [2.13, [0, -0.52, 4.87]]] },
  { "target": "camera", "property": "roll", "keys": [[-0.49, -0.1], [2.13, 0.22]] },
  { "target": "rig", "property": "progress", "keys": [[-0.62, 0], [1.14, 1]] },
  { "target": "post", "property": "bloom", "keys": [[0.39, 1]] },
  { "target": "post", "property": "tint", "keys": [[0, "#f4f1ea"], [1, "#101828"]] },
  { "target": "motes", "property": "opacity", "keys": [[0, 0], [2, 1]], "drive": "time" }
]
```

- A track keys one `property` of one `target`. Names are the host's.
- A key is `[position, value, handles?]`. Positions are the sequence's own
  units; a scrolled page uses one unit per viewport, and positions may be
  below 0 (an intro) or past the last key (a hand-over).
- `handles` is `[x1, y1, x2, y2]` and eases the segment from this key to the
  next. Left out, it is `EASE`, (.5, 0, .5, 1). The last key's handles do
  nothing. `[0, 0, 1, 1]` is linear.
- Values are numbers, vectors (arrays of numbers, mixed element by element) or
  `#rrggbb` colours (mixed channel by channel, rounded, clamped). One track
  keeps to one kind.
- A clip's progress is a number track from 0 to 1; the host hands it to the
  rig.
- Before the first key the track holds its first value, after the last its
  last. One key is a constant.
- `drive` is `"scrub"` (the default: sampled at the position) or `"time"`
  (sampled at the clock).

## Usage

```ts
import { sampleTracks } from "./src/index.ts";

const values = sampleTracks(tracks, position, time);
values.camera.eye;     // [x, y, z]
values.rig.progress;   // 0..1
values.post.tint;      // "#8a8f9b"
```

`sampleTracks(tracks, position, time?)` returns values by target, then
property. Time tracks are left out when no `time` is given. `sampleTrack(keys,
at)` samples one track; `ease(handles, u)` and `mix(a, b, t)` are the pieces,
exported for hosts that key something themselves.

## Settings

The module has no settings. `EASE` is the default handle pair; a key that
wants another names it.

## Determinism

The bezier is solved by bisection in 32 steps with additions, multiplications
and comparisons only, so every engine lands on the same value for the same
inputs, within 1e-9 of the curve. Colours round with `Math.round`, which is
exact.

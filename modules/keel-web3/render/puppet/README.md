# puppet

Painted layers as relief meshes in a keel/lit stage, moved by a rig. A figure
is a stack of painted layers, back to front, each a rectangle of the figure's
plane at its own depth. Each layer becomes a grid lifted toward the viewer by
its depth guide, with the cells outside its paint dropped. Shape keys, 2D
bones, a gaze slide and a dissolve between two painted states move it.
Parameters drive all of it, worked out each frame from the host's sampled
tracks and its clock.

The layers sit in the same stage as 3D things, so the camera gives depth
parallax with no code of its own: a layer 0.25 nearer shifts more than the
figure plane as the camera moves. They are unlit and premultiplied, drawn back
to front and depth-tested against the stage, so an opaque 3D card sorts
against the hand. After the figure, each layer writes a depth matte, so things
drawn later without depth writes (motes) stay behind it.

## Injected dependencies

- `lit`: the keel/lit namespace. The module calls `Group`, `Mesh`, `Geometry`,
  `Attribute`, `CustomMaterial` and `Vector2`.
- `maps`: each layer's painted textures, one per state, as keel/lit textures
  with premultiplied alpha. They can be image textures or render-target textures
  from a painter.
- Each state's `alpha` matte and optional `depth` guide as 8-bit CPU grids
  (`Grid`): an RGBA read-back works as it is (`stride: 4`, `channel: 3`).

## Usage

```ts
import { createPuppet } from "keel://module/puppet.js";
import { sampleTracks } from "keel://module/tracks.js";

const puppet = createPuppet(lit, figure, { face: [faceTexture], hand: [pointing, pinching] });
stage.add(puppet.group); // place and turn the group: layers face +z
// each frame:
puppet.update({ time: clock.seconds, values: sampleTracks(tracks, position), still: reducedMotion });
const grip = puppet.anchor("card"); // { at: [x, y, z], turn } in the group's frame
```

## The figure

```ts
{
  params: [
    { name: "eyes.blink", sum: [{ blink: { seed: 7, period: [4, 7], close: 0.05, hold: 0.02, open: 0.05, double: 0.1 } }] },
    { name: "eyes.open", sum: [1, { param: "eyes.blink", gain: -1 }] },
    { name: "hand.pinch", sum: [{ track: "rig.hand.pinch" }], range: [0, 1] },
    { name: "hand.index", sum: [{ param: "hand.pinch", gain: 12 }] },
    { name: "hand.wrist", sum: [{ track: "rig.card.lean", gain: -0.3 }, 21] },
    { name: "hair.sway", sum: [{ wiggle: [3, 0.25, 0.12] }] },
  ],
  bones: [
    { name: "wrist", at: [-1.31, -0.18], param: "hand.wrist" },
    { name: "index", at: [-1.11, 0.28], param: "hand.index", parent: "wrist" },
  ],
  layers: [
    { name: "face", rect: [-0.53, 0.06, 1.22, 1.46], z: 0, relief: 0.06, states: [{ alpha, depth }] },
    { name: "eyes", rect, z: 0.005, on: "face", states, slide: { param: ["gaze.x", "gaze.y"], max: [0.02, 0.06] } },
    { name: "lids", rect, z: 0.006, on: "face", states, clip: "lids",
      keys: [{ param: "eyes.open", moves: [{ at: [-0.08, 1.19], move: [0, 0.056], radius: 0.105 }] }] },
    { name: "hand", rect, z: 0.25, relief: 0.06, states: [pointing, pinching], dissolve: { param: "hand.pinch" },
      bind: [{ bone: "wrist" }, { bone: "index", reach: { from, to, radius: 0.03, feather: 0.05 }, rest: [0, 12] }] },
  ],
}
```

Lengths are figure units (the head is about 1.0 tall). `rect` is
`[left, bottom, width, height]`. Angles are degrees, counter-clockwise.

**Parameters** are sums of terms, worked out in the order given. A parameter
reads only the ones before it. The terms:

- a number, a constant;
- `track`: a value the host sampled, by `"target.property"`, times `gain`;
- `param`: an earlier parameter, times `gain`;
- `time`: units a second of the clock;
- `wiggle: [seed, hz, amp]`: two sines at seeded phases, 0 at rest;
- `blink`: a seeded blink, from 0 (open) to 1 (shut).

`range` clamps the sum. Under `still` (reduced motion), the clock, wiggles and
blinks hold at rest. The host keeps tracks frozen, for example at the poster's
position.

**What moves a layer:**

| field | what | how |
| --- | --- | --- |
| `relief` | lifts the grid by the depth guide, up to `RELIEF_LIMIT` (0.06) | each vertex's depth is weighted by the matte, and vertices with no paint near take their neighbours' value, so a silhouette is an alpha edge and not a cliff |
| `on` | lies on an earlier layer and rides its relief | `z` may stand at most `GAP_LIMIT` (0.05) off that layer's `z` |
| `keys` | shape keys: moves of `(1 − (d/r)²)²` falloff at full weight, scaled by a parameter | on the CPU, a vertex at a time |
| `bind` | 2D bones: the whole layer, or a capsule `reach` with a feather; children turn first, then their parents | linear blend in the layer's plane |
| `slide` | the paint slides inside its own matte at rest (gaze), held within `max` shares of the layer | in the fragment shader |
| `clip` | shows the layer only inside a matte at rest: its own, so a key cannot carry a lid into the brow, or an earlier layer's | the matte is sampled where each vertex has moved to |
| `states` + `dissolve` | two painted states crossed over a window of a parameter (default 0.3 to 0.7) | through a fixed grain, so each pixel shows one state or the other, never both at half; a bone's `rest` is the angle each state was painted at |
| `anchors` | named points per state, carried by the bones and crossed by the dissolve | `puppet.anchor(name)` |
| `opacity` | a parameter, 0 to 1 | a uniform |

A layer with keys or bones moves on the CPU only on frames when the values it
reads change. Every other layer is static geometry.

## Limits that hold

`planFigure` throws a `RangeError` when a layer's relief passes 0.06, when a
layer stands more than 0.05 off the layer it lies on, when a layer has two
states and no dissolve, or when a layer names a layer or bone that is not
there. Deeper relief and wider gaps tear at the silhouette under parallax.
Silhouettes come from the paint's alpha: cells with no paint are not meshed,
and the fragment shader drops what is transparent.

## Determinism

The plan is plus, minus, times, divide and the square root. That covers each
vertex's place and lift, the cells kept, key offsets and bone weights. A
digest of it is the same on every engine (`plan.digest`, pinned by the
vectors). Parameters use an exact sine (`exact.ts`), so a blink's times and a
wiggle's values match on every engine too. A blink costs a fixed two
hashes a frame at any time on the clock: the clock is cut into slots of the
mean period, with one blink at a seeded offset in each. The raster belongs to
the GPU.

## Budgets

Measured on 2026-11-11 on an M4 Max (load 9.6–9.7), headless Chrome on Metal,
1440×900 at DPR 2. The figure was eight placeholder layers cut from
`generative/portrait`'s bust: 4.0 M px in all, with a two-state hand.

| | budget (paint-cg spec §9.3) | measured |
| --- | --- | --- |
| code, brotli q11 | 4–6 KB | 5,117 B (12,712 B min) |
| per frame, GPU (puppet only) | ≈ 0.3 ms | median 0.39 ms, p95 0.85 ms (600 frames across a scroll sweep) |
| per frame, GPU (with plate and 3D card) | | median 0.51 ms, p95 1.01 ms |
| per frame, CPU `update` | ≤ 0.2 ms | median 0.2 ms, p95 0.3 ms (Chrome rounds `performance.now` to 0.1 ms) |
| build (`createPuppet`: plan, meshes, materials) | | 14–28 ms |
| GPU memory | ≈ 22 MB at 4.2 M px | 19.6 MB of textures (RGBA8 with mips), 0.23 MB of buffers |

The textures are the painter's output, not this module's. At 0.6 scale for the
hair and the gown, they take about 14 MB.

## Not built yet

These wait for a measured need: breath (a layer scaled on the clock);
`spring`, `follow` and pointer terms; masks that change over time; and a GPU
path for the deformation.

# camera-rail

A camera on keyed tracks. A scrolled page hands in its position each frame and
gets back where the camera stands, what it looks at, its field of view and its
roll, with the pointer's pan and tilt folded in. One long move per scene, keyed
by the motion designer, scrubbed by scroll. A baked flight rides a Catmull-Rom
path instead.

The maths is pure. The `tracks` module samples the keys and is passed in; the
keel/lit camera is passed to `applyView` and is the only thing touched.

## Injected dependencies

- `sample`: the `tracks` module's `sampleTracks`, or anything that returns
  values by target, then property.
- `camera` for `applyView`: a keel/lit `PerspectiveCamera`, or anything with
  `position.set`, `lookAt`, `rotateZ`, `fov` and `updateProjectionMatrix`.

## Usage

```ts
import { sampleTracks } from "keel://module/tracks.js";
import { applyView, createCameraRail } from "keel://module/camera-rail.js";

const rail = createCameraRail(sampleTracks, { tracks, pan: 0.05, tilt: 0.02 });
// each frame:
const view = rail.at(position, { pointer, velocity, time });
applyView(camera, view);
```

The camera's tracks share one target name, `camera` unless `name` says
otherwise, and key any of:

| property | value | default |
|---|---|---|
| `eye` | `[x, y, z]` in world units | `[0, 0, 5]`, or the path |
| `target` | `[x, y, z]` | `[0, 0, 0]`, or the path |
| `fov` | degrees, vertical | the `fov` setting, 30 |
| `roll` | radians round the view axis | 0 |
| `along` | 0..1 along the path | 0 |

`at(position, frame)` returns `{ eye, target, fov, roll }`. Positions may be
below 0 (an intro) or past the last key (a hand-over): the tracks hold. The
`frame` is optional: `pointer` in -1..1 each way with y up (null when away),
`velocity` the scroll velocity (0 at rest) and `time` for tracks driven by the
clock.

## The pointer

The pointer at a side edge turns the view by 0.1 rad times the `pan` scale,
at the top or bottom by 0.1 rad times `tilt`; a scene that wants none leaves
both at 0. The turn is smoothed a step per `at` call: its strength is 1 at
rest and `0.05 + max(0, 0.2 - |velocity| * 10)` while scrolling (`pointerStrength`),
eased by 0.1 a frame; pan and tilt ease toward the pointer by 0.5 times the
strength a frame. `turnView(eye, target, pan, tilt)` is the turn itself:
pan round the up axis, positive to the right, then tilt round the view's right
axis, positive upward, keeping the distance to the target.

Not here: a keyed gaze blend. Scenes that key one can add it once one is
built.

## A baked flight

`path: { eye: Vec3[], target?: Vec3[] }` lays a Catmull-Rom spline through its
points; the keyed `along` (0..1) rides it. A keyed `eye` or `target` wins over
the path. `catmullRom(points, u)` is exported on its own; the ends are held,
one point is a constant and two points are a line.

## Settings

| option | what | default |
|---|---|---|
| `tracks` | the tracks, in the `tracks` module's format | required |
| `name` | the camera's target name in the tracks | `"camera"` |
| `pan`, `tilt` | the pointer scales | 0 |
| `fov` | degrees when no track keys one | 30 |
| `path` | the flight path | none |

## Determinism

Sampling is the `tracks` module's, bit for bit. The turn uses `Math.sin`,
`Math.cos` and `Math.atan2` once a frame on the pointer's offsets; nothing a
seed decides passes through them.

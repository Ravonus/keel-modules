# butterflies

A small flock of glowing butterflies for a keel/lit stage, 2 to 50 of them,
wandering about a point with their wings beating and their edges lit past a
bloom threshold, so the host's bloom haloes them. One instanced mesh draws the
flock in one call, with no model or texture: the wing is a `Shape`.

The time comes from the host's clock; the module never reads a wall clock. A
reduced-motion page passes `still`, which holds the flock where it is at time
0 with its wings open and its edges still lit.

## Injected dependencies

- `lit`: the keel/lit namespace. The module calls `Shape`, `Geometry`,
  `Attribute`, `InstanceAttribute`, `Instances`, `CustomMaterial`, `Color`
  and `Vector3`.

## Usage

```ts
import { createButterflies } from "keel://module/butterflies.js";

const flock = createButterflies(lit, {
  count: 4, scale: 0.06, flapHz: 6, centre: [0, 0.6, -0.3], radius: [1.2, 0.4, 0.5],
  colors: { upper: "#2d5de0", under: "#7ea2ff", body: "#1b2f6e" },
  keepOut: [{ centre: faceCentre, radius: 0.3 }],
});
stage.add(flock.mesh);
// each frame, from the page's clock:
flock.update({ time: clock.seconds, still: reducedMotion });
// a new section's hue:
flock.setColors({ upper: "#d0406a", under: "#ff9ab8" });
```

## The mesh

`wingOutline(shape)` draws one wing on a keel/lit `Shape`: a forewing reaching
forward to its tip, a notch, a rounder hindwing, the span from 0 at the body
to 1 at the tip. `wingMesh(outline)` cuts the right wing from it, mirrors the
left and adds a slim body (a flat diamond and an upright one). A wing is a
fan from its root to an inner ring and a band from that ring to the outline,
so each vertex carries an edge value, 0 at the root and 1 on the outline. The
triangles are wound so the upper side is the front face on both wings,
whichever way the outline runs (`windingOf`).

## The flap

In the vertex shader, on two bones: the inner 0.45 of the span swings about
the body from 30 degrees under level to 70 over, the outer part a third
further, so the wing bends as it beats; the body rises as the wings come
down. Each butterfly beats `flapHz` times a second from its own seeded phase.

## The look

The upper side takes `upper`, the underside `under`, the body `body`, shaded
by how level the wing is (light from above). Past an edge value of 0.55 a
white-ward edge light rises to `glow` on the outline: at the default 1.5 it
crosses a bloom threshold of 1, so a host bloom (lit-finish's, for one)
haloes the edges and nothing else. The material is opaque, drawn from both
sides, and writes depth.

## The wander

Each butterfly's place is a sum of three sines an axis about `centre`, their
shares of `radius` 0.6, 0.28 and 0.12, so a flight never leaves the radius.
The rates run at about 1, 2 and 4 times `speed` (radians a second), each
varied by its seed, with seeded phases. It faces along its velocity, held
near level. A butterfly that would enter a `keepOut` sphere is pushed to its
surface. The flock is placed on the CPU in `update`: 50 butterflies are 450
sines a frame.

`planFlights(settings)` and `flyAt(flight, time, settings)` are the same
maths, exported for a host that wants to know where a butterfly is.

## Settings

| setting | what | default |
|---|---|---|
| `count` | butterflies, 0 to 50 | 4 |
| `seed` | lays the flights | 1 |
| `centre`, `radius` | the point they wander about; how far along x, y and z | `[0, 0, 0]`, `[1.2, 0.6, 0.6]` |
| `scale` | wingspan, world units | 0.06 |
| `speed` | the slowest wander's rate, radians a second | 0.3 |
| `flapHz` | wingbeats a second | 6 |
| `colors` | `{ upper, under, body }`, hex | `#2d5de0`, `#7ea2ff`, `#1b2f6e` |
| `glow` | the edge light at the outline | 1.5 |
| `light` | multiplies the wing and body colours | 1 |
| `keepOut` | spheres `{ centre, radius }` no butterfly enters | none |

`butterflySettings(partial)` fills in and bounds a settings object;
`DEFAULT_BUTTERFLIES` holds the defaults.

## Determinism

Every seeded number (rates, phases, the wingbeat phase) comes from a 32-bit
integer hash of the seed, the butterfly and a channel (`flightHash`), turned
into a number in [0, 1) by an exact division and scaled with plus and times
only: the same seed is the same flock on every engine. The sines of the time
in `flyAt` are `Math.sin`, worked out each frame.

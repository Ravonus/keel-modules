# motes

Dust, light motes and sparkles for a keel/lit stage: tens to thousands of soft
specks drifting through a box, each wandering a little and blinking on its own
period. One instanced quad draws them all in one call.

A mote's whole life is a closed form of the time, worked out in the vertex
shader. The host hands the time in from its own clock; the module never reads
a wall clock. So any frame can be drawn on its own, a paused clock is a still
field, and a reduced-motion page holds the field at time 0 with `still`.

## Injected dependencies

- `lit`: the keel/lit namespace. The module calls `plane`, `Instances`,
  `InstanceAttribute`, `CustomMaterial`, `Color`, `Vector2` and `Vector3`.
- `density` (optional): `(x, y, z) => 0..1`, where motes are welcome. The
  field is thinned by it at placement, so a field can be dense over water and
  sparse over sky.

## Usage

```ts
import { createMotes } from "keel://module/motes.js";

const motes = createMotes(lit, {
  count: 300, colors: ["#ffbe26"], size: 0.07, opacity: 0.88,
  centre: [0, 0, 0.8], box: [3, 3, 4], drift: [0.014, 0.014, 0], blinkPeriod: [2, 5],
}, (x, y) => (y < 0 ? 1 : 0.3));
stage.add(motes.mesh);
motes.resize(canvas.width, canvas.height); // and on every resize
// each frame, from the page's clock:
motes.update({ time: clock.seconds, opacity: keyedOpacity, still: reducedMotion });
```

`mesh` is the instanced quad: move or rotate it to move the whole field (a
keyed group rotation). `update` takes `opacity` 0..1, a multiplier for a keyed
fade. `shown` draws only the first n motes, for a quality lever. `dispose`
frees the geometry and material.

## How a mote moves

- **Drift.** The whole field moves by `drift` world units a second and wraps
  in the box, so it never empties. Motes fade out over the last sixteenth of
  the box toward a wrapping face, so the wrap never pops.
- **Turbulence.** Each mote wanders about its drifting place by two sines an
  axis, with rates fixed and phases from its seed, up to `turbulence` world
  units.
- **Blink.** `opacity * mix(1, w², blink)` with `w = 0.5 + 0.5 sin(2πt / period + phase)`:
  each mote's period is seeded between the two `blinkPeriod` values. At
  `blink` 1 a mote goes out at its trough; the field's mean is 3/8 of
  `opacity`.
- **Size.** With `attenuate` (the default) `size` is a diameter in world units
  and shrinks with distance; without, it is in drawing-buffer pixels. A mote
  smaller than `minPixels` is drawn at `minPixels` and dimmed by the square of
  the ratio, so far motes keep their light instead of flickering.
- **Look.** A dot is a soft round sprite, `(1 - r²)²`, nothing at the quad's
  edge. A sparkle (a `sparkle` share of the field, seeded) is a core and four
  rays on a quad three times as wide. Both blend additively, unlit, and do
  not write depth. `intensity` over 1 lifts them past a bloom threshold.

## Settings

| setting | what | default |
|---|---|---|
| `count` | motes, 0 to 4096 | 300 |
| `seed` | lays the field | 1 |
| `centre`, `box` | the box the field lives in, world units | `[0, 0, 0]`, `[3, 3, 4]` |
| `size`, `sizeSpread` | diameter, and how far each may differ either way, as a share | 0.07, 0.5 |
| `minPixels` | the smallest a mote is drawn, drawing-buffer pixels | 1.5 |
| `colors` | hex colours; each mote takes one, seeded | `["#ffbe26"]` |
| `opacity`, `intensity` | opacity at full blink; a multiplier on the colour | 0.88, 1 |
| `drift` | world units a second | `[0.014, 0.014, 0]` |
| `turbulence` | how far a mote wanders, world units | 0.03 |
| `blinkPeriod`, `blink` | shortest and longest period, seconds; depth 0..1 | `[2, 5]`, 1 |
| `sparkle` | the share drawn as four-pointed sparkles | 0 |
| `attenuate` | size in world units (true) or pixels (false) | true |

`moteSettings(partial)` fills in and bounds a settings object;
`DEFAULT_MOTES` holds the defaults.

## Determinism

`placeMotes(settings, density)` lays the field: each mote's place, blink
phase and period, size, kind and colour come from a 32-bit integer hash of the
seed, the mote and a channel (`moteHash`), turned into a number in [0, 1) by
an exact division, then scaled with plus, minus and times only. The same seed
gives the same field to the bit on every engine; the vectors hold a digest of
it. What moves after that is the GPU's.

## A mesh variant

Coins and confetti (a mesh per instance, tumbling as it falls) are not built
here. They can reuse `placeMotes` for the field and `MOTE_PATH_GLSL` for the
path: it defines `vec3 motePath(vec4 mote, vec4 life, float t)` and
`float moteFade(vec3 p)`, and a mesh variant orients its own geometry about
the result.

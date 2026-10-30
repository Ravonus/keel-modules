# ocean-render

Draws a sea from `generative/ocean` for keel/lit, from above the water or inside
it, and draws any number of animals from `generative/marine`.

```js
import * as lit from "keel://module/lit.js";
import { createSea } from "keel://module/ocean.js";
import { SPECIES, castFor, createSwim, poseSwimmer } from "keel://module/marine.js";
import { createSdfBodies } from "keel://module/sdf-body.js";
import { createOcean, createSwarm } from "keel://module/ocean-render.js";

const sea = createSea({ seed: 7, wind: 7 });
const swim = createSwim(castFor({ seed: 7, sea }), sea);

const ocean = createOcean(lit, { sea });
scene.add(ocean.group);                    // the seabed
const bodies = createSdfBodies(lit, { maxBodies: 18, ink: 0 });
const swarm = createSwarm(lit, { bodies, pose: poseSwimmer, species: SPECIES, near: 18 });
scene.add(swarm.group);

// every frame, in place of renderer.render(scene, camera):
swarm.draw(swim.at(t), eye, bodyLight);
ocean.draw(renderer, scene, camera, t, { sun, sunColor });
```

keel/lit is injected, and the module never imports it.

## How it draws

- **The water is a pass over the scene.** The scene is drawn to a target with
  depth, and each pixel then loses its colour to the metres of water in front
  of it. Anything in the scene goes under the sea without knowing it, including
  raymarched `sdf-body` animals, because they write true depth.
- **Caustics, shafts and snow.** Caustics fall on whatever the depth finds, by
  tracing up toward the sun. Light shafts march the same pattern through the
  water, and marine snow is shells of drifting specks round the eye.
- **The surface.** A disc of rings round the eye, displaced in the vertex shader
  by the same packed waves `sea.surfaceAt` answers from. From above it has
  Fresnel sky, sun glitter and foam; from below, Snell's window and its mirror.
- **The swarm.** The nearest animals are real bodies; the rest are one instanced
  draw per species, cut from the same body at rest with its tail swing in the
  vertex shader. There is no second model and no LOD to set up. Nearness is
  measured against size, so a far shark outranks a near sardine.

- **Ray tracing.** No hardware rays and no WebGPU: the ground is a height map and
  each near animal a few spheres, so a shader can walk real rays through them.
  The surface traces reflections, the underwater mirror and Snell's window, and
  every point traces a shadow ray to the sun. Pass `casters: swarm.casters` to
  `draw` to put animals in the rays. Far-off swarm animals and the sdf bodies'
  exact shapes are not in the rays.
- **Upscaling.** The world is drawn at `renderScale` with a moving sub-pixel
  offset, then rebuilt at full size from past frames, which are reprojected by
  depth and clamped to the colours round each pixel. This is our own temporal
  upscaler, not DLSS, so it runs on any GPU.
- **Shore and tide.** `draw`'s `level` moves the water, and the waterline, breakers
  and wet sand move with it. Use `tideOn` for a clock or `tideAt` for the real moon.
- **Breakers.** Near the eye the mesh is moved by `surfThrow`, so a crest folds over
  its own face and curls. Past 90 m a breaker only lifts.
- **Spray.** Drops are thrown by `surfBurst` from a grid that wraps round the eye.
  Each drop's whole flight is worked out in its vertex shader, so nothing is stored.
- **Wet sand.** The water pushes a wet line up the sand at once, and it falls by
  itself at `dryTime`. This line is the only thing here that remembers past frames.

## Options

`createOcean(lit, options)`: `sea`, `absorption`, `scatter`, `level` (the tide;
`draw`'s light can also move it), `size` (across the seabed), `colorAt` (the
ground's colour: `generative/beach`'s fits), `exposure` and `quality`
(`render/quality`'s `createQuality`, which holds the on and off switches) and
`dryTime` (seconds wet sand takes to dry a metre, default 3600).

The ground under `sea.seabedAt` is baked once into a 256-cell map across `size`,
so waves shoal over any ground, including a `generative/beach` shore.

`createSwarm(lit, options)`: `bodies`, `pose`, `species`, `near` (default 16) and
`most` (the most of a species drawn far, default 512).

## Limits for now

- `ocean.draw` writes straight to the screen with its own tone curve, so it does
  not yet feed `voxel-dither`.
- The sky is a two-colour gradient and a sun, not `world-light`'s sky.
- The ground is one fixed mesh that ends at `size`, with nothing past it.
- `sea.surfaceAt` answers for the water's height at a place, so it does not follow a thrown lip.

## Preview

```bash
node modules/keel-web3/render/ocean-render/tools/serve.mjs
```

It serves `http://localhost:4197`. Add `?view=school|shark|jelly|window|surf|break|shore|beach|above`, `&quality=low|medium|high|ultra`, `&tide=low|mid|high` and
`&t=30` to hold a moment. It needs a sibling `keel-engine` checkout for keel/lit
(or `KEEL_ENGINE`).

Near animals need `render/sdf-body`. In a checkout without it, set
`KEEL_EXTRA_MODULES` to the `modules/keel-web3` folder of one that has it.

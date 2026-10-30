# marine

Life in the water. A seed casts a sea, and any moment of it gives every animal
as plain data, with a body posed as capsule parts on request. It draws nothing:
`render/sdf-body` draws near animals and `render/ocean-render`'s swarm draws the rest.

```js
import { castFor, createSwim, poseSwimmer } from "keel://module/marine.js";

const cast = castFor({ seed: 7, sea });       // sea from generative/ocean
const swim = createSwim(cast, sea);
for (const swimmer of swim.at(t)) draw(poseSwimmer(swimmer));
```

- **Species so far.** Sardine (a school), reef shark (a cruiser), moon jelly
  (a drifter). Each lists the depth zones it lives in, and `castFor` only casts
  what lives in its `zone`.
- **No simulation.** Every animal is a closed-form function of the seed and t,
  so there is no state to keep, moments can be asked for in any order, and a
  school of 200 costs the same at hour one as at second one.
- **The school.** Fish trail one path by their own lag, so the ball bends
  through a turn, and hold their own place in it. Round a shark they open a
  hole and beat faster. Because the shark is also a pure function of t, this
  needs no neighbour search.
- **Shores.** Each species has a `shallowest` depth. `offShallows` walks a path
  back down the seabed to that contour, so animals follow a shore without reaching it.
- **Jellies.** They pulse, rise and sink on a slow swell, and are carried by the
  sea's own waves, fading with depth.

`poseSwimmer(swimmer, { rest: true })` holds the body straight, which is what a
renderer cuts its far copy from, so near and far animals are one shape.

Frame (shared with `fauna`): +y up, a body's front is its +z.

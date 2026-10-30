# boat-render

Draws a `generative/boats` fleet for keel/lit: one instanced hull for each kind, so
any number of boats costs a few draw calls.

```ts
import * as lit from "keel://module/lit.js";
import { createBoats } from "keel://module/boat-render.js";

const boats = createBoats(lit, { hullOf, kinds: ["dinghy", "fishing", "sloop"] });
scene.add(boats.group);

const poses = fleet.at(t, tide);
boats.draw(poses);
ocean.draw(renderer, scene, camera, t, { ...light, wakes: boats.wakes(poses, HULLS), casters: [...swarm.casters, ...boats.casters(poses, HULLS)] });
```

`wakes` gives `render/ocean-render` the white water round each hull and behind a
moving one, and `casters` puts the hulls in its reflections and shadows.

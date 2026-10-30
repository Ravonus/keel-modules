# boats

A seeded fleet on any sea: dinghies, fishing boats and sloops, each one's place a
pure function of seed and time.

```ts
import { createSea } from "keel://module/ocean.js";
import { createFleet } from "keel://module/boats.js";

const sea = createSea({ seed: 7 });
const fleet = createFleet({ seed: 7, sea, center: [0, -60], radius: 140, count: 6, beached: [[12, 118]] });
fleet.at(t, tide); // where each boat is, and its axes
```

- **Sailing** boats go round a circle they have checked is deep enough. **Anchored**
  ones swing on their line. Boats that cannot find room for a circle anchor instead.
- **Afloat.** Each boat asks the sea how high the water stands at its bow, stern and
  sides. A long hull averages short waves away, and a dinghy feels them all.
- **Beached.** A boat listed in `beached` sits on its keel on the ground, leaning a
  little, until the tide reaches it.

`hullOf(kind)` gives a boat as plain coloured triangles, with no renderer involved.
`render/boat-render` draws them.

## Limits for now

- Boats do not meet each other or turn for the shore: circles are chosen clear of it,
  but two circles can cross.

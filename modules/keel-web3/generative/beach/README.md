# beach

A shore as a pure function: the ground from the sea floor to the dunes, what
covers it, and its colour. It draws nothing and works on its own.

```js
import { createBeach } from "keel://module/beach.js";
import { createSea } from "keel://module/ocean.js";

const beach = createBeach({ seed: 7 });
beach.groundAt(x, z);      // height above still water
beach.zoneAt(x, z);        // "seabed" | "surf" | "wet" | "dry" | "dune"
beach.colorAt(x, y, z);    // linear RGB

// Joining a sea is one option. The land carries on under the water, the waves
// shoal as it rises, and the shore is wherever the ground crosses the water.
const sea = createSea({ seed: 7, ground: beach.groundAt });
const ocean = createOcean(lit, { sea, colorAt: beach.colorAt, size: 480 });
```

Neither module imports the other. `generative/ocean` takes any `(x, z) => height`,
so an island, a cliff or a harbour joins the same way.

The profile has a flat floor, a sandbar and trough, a concave rise to the
shoreline, a foreshore, a berm and dunes. +y is up and still water is y = 0.

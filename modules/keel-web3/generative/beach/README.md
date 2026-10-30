# beach

A shore as a pure function: the ground from the sea floor to the dunes, what
covers it, and its colour. It draws nothing and works on its own.

```js
import { createBeach } from "keel://module/beach.js";
import { createSea } from "keel://module/ocean.js";

const beach = createBeach({ seed: 7 });
beach.groundAt(x, z);      // height above still water
beach.zoneAt(x, z);        // "seabed" | "surf" | "wet" | "dry" | "dune" | "cliff" | "rock"
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

## Kinds of coast

`kind` is `dunes`, `bay`, `cove`, `cliffs` or `rocky`, and `sand` is `golden`, `pale`,
`dark`, `shell` or `shingle`. The seed picks both unless told. `cliffs`, `cliffHeight`,
`rocks`, `bays` and `dunes` adjust any kind.

Along the coast, headlands push out to sea. Their cliffs wander in and out, are cut by
gullies, climb in uneven ledges and vary in height. The sand between them is scalloped
into cusps, and carries pebbles and a line of tide wrack.

`beach.rocksWithin(x, z, radius)` lists the boulders and sea stacks. `groundAt` already
holds their bulk, so waves feel them; a renderer draws the rocks themselves
(`render/ocean-render`'s `rocks` option does).

## Footprints

`beach.trails(count, near)` gives the footprints of seeded walks, and `stepsAlong(path,
groundAt)` turns any path into prints. `beach.takesPrints(x, z)` says whether the ground
there would hold one. `render/ocean-render` draws them.

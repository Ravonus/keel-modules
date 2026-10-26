# tree-render

Trees as objects, for keel/lit (KEEL's lit renderer). The `tree-growth` module grows a branch graph
and poses it for any moment in the tree's life. This module draws that pose.
Use it for one hero tree in a display piece, for props in a game level, or for
a whole forest in the background.

## One tree

```js
import * as lit from "keel://module/lit.js";
import { growTree, treeFrame, yearState } from "keel://module/tree-growth.js";
import { createTreeRender } from "keel://module/tree-render.js";

const model = growTree({ species: "oak", seed: 42 });
const tree = createTreeRender(lit, model, {
  colors,                         // bark, leaf, flower and fruit colours
  ground: { y: 0, radius: 4.4 },  // open soil
  features: "-litter",            // see "Switches"
});
scene.add(tree.group);
// each frame:
tree.update(treeFrame(model, cycle), yearState(...), { elapsed, delta, wind });
```

It draws:

- **Wood**, with surface roots. On a planter (`lip`, `wall`, or a carved
  `surface`), an old tree's longest roots roll over the lip and creep down the
  wall.
- **Leaf blades** that grow from their twigs and flutter.
- **Flowers and fruit** that open, ripen and fall.
- **Litter** under the crown and **snow** along the limbs.
- **Fallers**: the leaves and petals in the air.

One wind field (`sway`) bends the wood, leaves and fruit together, so nothing
comes apart at a joint.

There are two forms:

- `form: "smooth"`: real leaf blades and the living-bark shader.
- `form: "voxel"`: cubes, for a pixel-art look.

`shapes` and `skin` swap the geometry and leaf colours for themed skins.

`tree.meshes` exposes each instanced mesh, so a host can restyle them.
`tree.fallers` lists the falling pieces, so a 2D fallback can draw them.

## Switches

Every part is on by default, and any part can be turned off: `roots`,
`leaves`, `flowers`, `fruit`, `deadwood`, `litter`, `snow`, `fallers`,
`sway`, `shadows`, `crownShade` and `bark`. Turn parts off in either of two
ways:

- **In code:** `{ roots: false }`.
- **With a plugin string:** `"-roots,-litter"` or `"roots=off"`. A bare name
  or `name=on` turns a part back on.

`treeFeatures(input)` resolves either form.

## A forest

```js
import { createForest, forestPlaces } from "keel://module/tree-render.js";

const places = forestPlaces({ seed, count: 40, inner: 10, outer: 42, variants: variants.length, height: groundAt });
const forest = createForest(lit, { variants, places, near: 30 });
scene.add(forest.group);
// each frame:
forest.update({ camera, renderer, year, elapsed, wind, light, fog });
```

Each variant (a model, a frame and its colours, up to 8) is baked once into
merged geometry and drawn instanced.

- **Seasons on the GPU.** Leaf rank, tone, stalk and wind weight ride as
  vertex attributes, so changing the season is a uniform change.
- **Impostor cards past `near`.** Trees beyond that distance draw as cards
  from a sprite ladder of 8 views per variant. The cards are rebaked when the
  season turns.
- **Dithered hand-off.** The near and far versions cross-fade through
  complementary Bayer dither, and trees near the lens dissolve the same way.
  There are no alpha sorting problems.
- **Placement.** `forestPlaces` scatters trees by dart throwing, keeping
  `gap` between them, gathering them into groves with `clump`, and skipping
  any spot where `height` returns `null` (water, a road, a slope).

keel/lit is injected, and the module never imports it. The forest also needs
`RenderTarget` and `OrthoCamera` from it, for baking the cards.

## Helpers

These are exported for hosts that draw their own parts:

- `writeSegment`, `writeBlade`, `writeBox`, `writeVoxel` and `clearSlot`
  write instance matrices.
- `rootPath` gives a root's points.
- `sway` and `leafFlutter` give the wind.
- `barkMaterial` makes the bark material.
- `seededRandom` and `hash32` give stable randomness.

MIT.

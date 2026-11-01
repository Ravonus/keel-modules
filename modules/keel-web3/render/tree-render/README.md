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
  wall, and with `rootBreak` the biggest crack the rim or burst out through
  the side (`planter` gives the chunks their colours).
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

`tree.fruit()` lists the ripe fruit as of the last update, both hanging and
lying under the tree. Each entry has a `key`, its `kind`, its position, its
size, and whether it is hanging. `tree.eat(key)` takes one away, on the
branch and on the ground, until the next crop. Pair it with fauna's
`Stage.food` and `herd.eaten(t)` to let animals eat the fruit.

## Switches

Every part is on by default, and any part can be turned off: `roots`,
`leaves`, `flowers`, `fruit`, `deadwood`, `litter`, `snow`, `fallers`,
`sway`, `shadows`, `crownShade` and `bark`. Four more switch the looks
made for a few pixels per leaf:

- `sprays`: a blossom tree opens in sprays, a few round flower heads per
  shape, lit near white on top and a deeper rose underneath, one tone per
  twig. A big crown draws every other blossom slot at twice the size, so it
  reads as a pink cloud and poses half the instances. In full bloom a blossom
  tree's new leaves stay small and grow as the petals fall.
- `clumps`: a twig's leaves share one tone (its parent shoot's), with the odd
  leaf catching the light, and turn in autumn together, so the crown reads as
  lit and shaded masses, not a speckle. Blades get a soft margin, a
  seedling's first leaves draw nearly twice their size, a hybrid's minor kind
  keeps part of its own leaf colour under a skin, and fruit on a skinned tree
  keeps half its own colour.
- `rootSink`: surface roots dive under the soil where they thin below a
  pixel and a half or pass the inner two fifths of the planter (an old tree's
  thick roots still roll over the lip; a palm keeps a short flare), and moss
  climbs only the upright trunk foot, so no hairline or green spoke crosses the
  planter.
- `rootBreak`: an old tree's big roots break its planter, more as the trunk
  thickens (from a trunk radius of 0.45; young trees stay tidy). They heave
  higher arches out of the soil and lever up the rim where they roll over
  it, cracking off a couple of chunks. On a planter whose side can break,
  five old trees in six (seeded) send a root or two out through the wall
  instead: it dives under the soil short of the lip, punches out partway
  down with a swelling, a dark break and a ring of pried-out chunks, a crack
  up to the split rim, then creeps down the outside and dangles below the
  foot. Metal and gem planters are only cracked at the rim. Roots below the
  soil line keep bare bark (no moss on the wall). The chunks are one small
  instanced mesh, `roots × 8` boxes, posed only when the trunk grows. A host
  passes the planter's look as `ground.planter`: `colors` (darkest first;
  left out, a weathered earth brown), `hard` (left out, a wall under half a
  unit deep counts as hard) and `hang` (how far a burst root may dangle).

Turn parts off in either of two
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

Levels of detail need no setup. Every level is cut from the real tree: the
richest near the eye, the plain bake to `near`, then the big wood and the crown's
real masses under a few big leaves, then impostor cards. Each is one instanced
mesh, built the first time a tree comes within its distance and freed after
`keep` updates unused; forests of the same tree frame share shapes. So a forest
seen only from afar never builds a near level. `forest.levels` reports what is
drawn and held.

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

`forest.setPlaces(places)` moves, adds or removes trees of the same variants
without rebuilding any level, so a scene being built by hand updates at once.

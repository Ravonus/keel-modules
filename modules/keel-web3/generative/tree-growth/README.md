# tree-growth

A tree that grows instead of being drawn. One seed and a species become a
branch graph for the tree's whole life; a scene poses that graph at any age
and any day of the year. Deterministic, dependency-free, no renderer.

## How it grows

- **Light decides the shape.** Every internode casts a soft pyramid of shadow
  into a voxel light grid. Each bud reads how much sky it sees. Light is summed
  down the branches and vigor flows back up with apical control
  (Borchert–Honda), so the crown fills the space it can reach and shaded
  buds stay asleep. This is the self-organizing model of Palubicki et al.
  (2009).
- **Shoots bend** toward open light, by gravity (upright leaders, level or
  weeping side shoots) and by their own heading. Phyllotaxis turns each bud
  137.5° round the stem; conifers set whorls on the leader and flat forks on
  their tiers.
- **Self-pruning.** A side branch whose buds stay in deep shade starves, dies,
  hangs dead a while and drops. The bare trunk lifts its crown as it grows.
- **Pipe model.** A limb's radius follows the twigs it carries
  (`radius^pipe ∝ tips`), so the trunk thickens smoothly year on year.
- **Always growing, on a curve.** No species stops growing at a size cap.
  Each cycle may add a share of the internode budget that follows a curve over
  life (fast while young, slower as it matures), so trees end grander than
  their real counterparts, never absurd. A light envelope around the crown
  (`spread × height`) keeps wide species wide and narrow ones narrow.
- **Old age still grows.** Part of the internode budget is kept back for old
  age: a declining tree keeps adding wood each cycle while anything of it
  lives, less every cycle on a tapering curve, until the very end.
- **Old age, only near the end.** Growth never levels off before it: a share
  of each year's growing comes on steadily, so a tree is still taller and
  wider every year into old age. Only in the last few years of its life
  (from 88% for a willow to 96% for a redwood, `PACE.old`) does vigor fade: the leader dies back
  (stag-headed), the weakest limbs die a growing share each cycle, dead limbs
  fall and lie flat on the ground inside the plot (no twig is left standing in
  the air), rot away, and at the end the whole tree stands as a snag.

| Species | Shape | Flowers | Fruit | Notes |
|---|---|---|---|---|
| `cherry` | round | blossom on spurs, before the leaves | cherries, early summer | |
| `oak` | broad | catkins at the tips | acorns, autumn | young oaks hold dead leaves through winter (marcescence) |
| `pine` | excurrent cone | new candles | cones, held a long time | evergreen |
| `birch` | slender | hanging catkins | — | |
| `willow` | leaf curtains | upright catkins, very early | — | |
| `acacia` | flat-topped | yellow puffs | seed pods | semi-evergreen |
| `palm` | coconut palm | cream spadices | coconuts, year round | never branches; see below |
| `spruce` | dense spire to the ground | new candles | cones on the top tiers | blue spruce; evergreen |
| `redwood` | tall column, bare below | — | small cones | evergreen; thick trunk, drooping limbs that turn up |
| `maple` | full round | gold tufts, before the leaves | winged keys, summer to autumn | paired buds |
| `jacaranda` | open vase | violet bells, late spring | seed pods | thins in late winter |
| `baobab` | bottle trunk, flat crown | big white hanging bells | velvet gourds | stubby limbs |

`cone` narrows the crown's reach toward the top, closing it to a spire.

**Palms** (`species.palm`) grow their own way. The trunk rises only from its
crown, keeps one girth all its life (swollen at the foot), leans out and
curves back toward the sky. Each cycle the crown unfolds a few fronds, each an
arching rachis with paired leaflets drooping down both sides, and the oldest
fronds die and drop. A seedling is a tuft of short fronds at the ground; at
death the last crown falls and the bare trunk stands.

Each species' `flower` and `fruit` give the ornament kind, where it grows
(`spur` on older wood or `tip` of a leafy shoot), how many per node, its
four-day window (open, full, fading, gone) and the first cycle it bears.
`tree.blossoms` and `tree.fruit` are the ranked places they hang. Anything else
grows a cherry.

## The year

`yearState({ species, day, year, hemisphere, climate })` gives bloom,
petal-fall, fruit set and fruit drop, withered (dead leaves still held), leaf size, autumn colour, leaf drop, litter on the ground and fresh
spring growth for that day. The southern hemisphere runs half a year apart;
climates shift spring and autumn (alpine late, maritime early); each year's
dates wander a few days. Every leaf and blossom has a rank, so they open,
colour and fall one by one, not all at once.

## Usage

```ts
import { cycleAt, growTree, treeFrame, yearState } from "keel://module/tree-growth.js";

const tree = growTree({ species: "cherry", seed: 1234 });      // once, ~0.1–0.6 s
const frame = treeFrame(tree, cycleAt(tree, ageYears, lifespanYears), { ground: 0 });
const year = yearState({ species: "cherry", day: 105, hemisphere: "north" });

for (let node = 0; node < tree.count; node += 1) {
  if (frame.grow[node] <= 0 || frame.rot[node] >= 1) continue;
  // a segment from (frame.baseX, baseY, baseZ)[node] to (frame.x, y, z)[node],
  // frame.radius[node] thick; frame.dead[node] greys it, frame.fall[node] > 0 lies on the ground
}
for (let index = 0; index < tree.leaves.count; index += 1) {
  const node = tree.leaves.node[index];
  // leafy if the node is alive, grown and an outer twig (frame.tips[node] small),
  // and on the tree this year if tree.leaves.rank[index] >= year.drop
}
```

### Grand trees

Pass `grand: true` to `treeFrame` for a world tree: natural as a sapling, it
keeps growing all its life on a slowing curve that never levels off, by age, until it stands about `GRAND`
times bigger than life, in its species' own way. Redwoods, pines and
spruces tower, acacias, oaks and willows spread wide, a palm only climbs
and a baobab's trunk swells. A number scales how far past life it goes
(`grand: 0.5` is halfway). The frame's `scale` says how much bigger than life
the tree has grown; a renderer grows its leaf clumps with it so the crown
stays full (tree-render does). Without `grand`, frames are the natural tree.

```ts
const frame = treeFrame(tree, cycleAt(tree, ageYears, lifespanYears), { ground: 0, grand: true });
```

The model is flat typed arrays ordered parents first, so one forward pass
can pose it. Re-pose only when the cycle moves; colour only when the year
does.

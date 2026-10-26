# fauna

Rare animal life for a scene. One seed, a region, a world and a season pick
who lives there, if anyone. Each frame, the module poses every animal as a set
of capsule parts that any renderer can draw. It is deterministic,
dependency-free and has no renderer.

## Casting

- **Most scenes are quiet.** About 44% of seeds have no animal. A third have
  one animal on its own. A pack, a pair or a parent with young is rarer.
  Mixed company is the rarest of all.
- **32 species** across six body plans:
  - **quad:** rabbit, fox, deer, wolf, bear, raccoon, cat, hedgehog, mouse,
    capybara, kangaroo, tortoise, meerkat, squirrel, red panda, koala;
  - **primate:** macaque, monkey, sloth;
  - **bird:** songbird, crow, owl, parrot, gull, peacock, crane, woodpecker;
  - **serpent:** snake, gecko;
  - **bug:** butterfly, firefly;
  - **crab.**
- **Each species is placed** by its native regions, the world, the season
  and the walkable radius, so a macaque turns up around Tokyo and big
  animals only appear where they have room. `fits(id, input)` says whether a
  species can appear.
- **Morphs are rarer still.** Albino, melanistic, golden and spirit morphs
  each carry their own rarity, and some glow.
- **The sky has its own plan.** A flock may pass over some scenes. Over some
  worlds, something flies far off: an airliner, a prop plane with a banner, a
  jet with a contrail, a balloon or a saucer.

Force a scene with `species` (or `"none"`) and `group` (`solo`, `pair`,
`family`, `pack`, `mixed`).

## Behaviour

- **Idle matrix.** Each species has a Markov matrix of idle actions, such as
  sit, groom, sniff, graze, howl, roll, preen, display, hang and coil:
  - the body plan sets the base weights;
  - the species' temper multiplies the columns;
  - each row's flow (sleep wakes into a stretch, lying leads to a roll) shapes
    what follows;
  - at the wrong time of day every row leans toward rest.

  `idleMatrix(id, { night })` exposes the matrix.
- **Places and paths.** Animals walk the ground around the trunk, perch on the
  branches you pass in, climb the trunk (primates, squirrels, geckos), and fly
  between perches on curved paths.
- **Together.** A director runs joint scenes for groups: groom, nuzzle,
  chase, follow, chorus, huddle, dance, feed, ride and climb. Poses cross-fade
  between actions.
- **Gaits and reach.** Gaits walk, trot or bound with planted feet. Legs and
  arms use two-bone IK (`solveTwoBone`).

## Use

```js
import { castFor, createHerd } from "keel://module/fauna.js";

const cast = castFor({ seed, region: "tokyo", world: "nature", season: "spring", radius: 3 });
const herd = createHerd(cast);
// each frame:
const bodies = herd.at(t, { radius: 3, top: 0, trunk, perches, night });
const sky = herd.sky(t, { radius: 3 });
```

Each body has an `id`, `kind`, `label`, `action`, `morph`, `at`, `front`, a
`palette` by role and a `glow` value. Its `capsules` are
`{ a, b, r, role, part, flat, up, fw }`, where:

- `role` picks the palette colour;
- `flat` below 1 squashes the part across `up` (a wing, an ear, a fin).

Draw them with [`sdf-body`](../../render/sdf-body) to get one smooth,
continuous surface per animal, or with any renderer of your own.
`poseSpecies(id, action, t)` poses a single animal for galleries and tests.

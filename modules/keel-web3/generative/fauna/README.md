# fauna

Rare animal life for a scene. One seed, a region, a world and a season pick
who lives there, if anyone. Each frame, the module poses every animal as a set
of capsule parts that any renderer can draw. It is deterministic,
dependency-free and has no renderer.

## Casting

- **Most scenes are quiet.** About 44% of seeds have no animal. A third have
  one animal on its own. A pack, a pair or a parent with young is rarer.
  Mixed company is the rarest of all.
- **42 species** across six body plans:
  - **quad:** rabbit, fox, deer, wolf, bear, raccoon, cat, hedgehog, mouse,
    capybara, kangaroo, tortoise, meerkat, squirrel, red panda, koala,
    tanuki, marmot, badger, skunk, brushtail possum, banded mongoose, dik-dik;
  - **primate:** macaque, monkey, sloth, slow loris;
  - **bird:** songbird, crow, owl, parrot, gull, peacock, crane, woodpecker,
    kookaburra, guineafowl;
  - **serpent:** snake, gecko;
  - **bug:** butterfly, firefly;
  - **crab.**
- **Each species is placed** by its native regions, the world, the season
  and the walkable radius, so a macaque turns up around Tokyo and big
  animals only appear where they have room. `regionWeight(id, region, world?)` is a
species' casting weight in a region, as `castFor` weighs it (0 where it does not
live), for anything that rolls a local animal outside a scene. `fits(id, input)` says whether a
  species can appear.
- **Each region has its own cast.** A region weights its own animals up and
  the incomers down, so mule deer, chipmunks and magpies lead in the Rockies,
  grey squirrels, raccoons and fireflies on the Atlantic coast, marmots and red
  squirrels in the Alps, jungle crows, sika deer, tanuki and macaques in Tokyo,
  kangaroos, kookaburras and cockatoos round Sydney, guineafowl, vervets,
  mongooses and dik-diks in Nairobi, and macaques, tokay geckos and Java
  sparrows in Bali. The wide-ranging species wear their region's forms and go
  by their names there: a songbird is an American robin, a cardinal, a
  Japanese white-eye, a superb fairy-wren or a superb starling; a crow is a
  magpie, a jungle crow or a pied crow. A wild world keeps cats and mice few.
  Region and world only change who comes, never whether anyone does: the
  share of seeds with no animal is the same everywhere.
- **No two animals are alike.** Each member draws its own `traits` on its own
  stream: its sex (a pair is a male and a female; only grown males carry
  antlers, and not in spring), its build (leg, body, head, muzzle, neck, tail
  and ears a few per cent off its kind's; the young have big heads, short
  muzzles and legs), its tempo, how bold it is (a wary one watches more, a
  bold one roams farther) and how lively. The director and the pose code read
  the animal's own copy of its species spec, so nothing else changes.
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
  - at the wrong time of day every row leans toward rest;
  - rain and snow lean it toward rest and shelter too (birds sit it out
    preening, butterflies fold their wings, the hungry dig in the snow), and
    dawn and dusk toward song and howling.

  `idleMatrix(id, { night, weather, twilight })` exposes the matrix. Pass the
  weather and the sun's height (degrees) as `stage.weather` and `stage.sun`.
  Each animal's own matrix also carries its traits.
- **Roaming.** Hunters and grazers patrol the lawn rather than shuffle about
  one spot, and ground animals now and then go over to the tree to sniff its
  foot (a bear turns its back to the bark to scratch). In rain or snow they
  keep in under the tree. A fox or a cat stalks (a low, slow creep) before it
  pounces.
- **Places and paths.** Animals walk the ground around the trunk, perch on the
  branches you pass in, climb the trunk (primates, squirrels, geckos), and fly
  between perches on curved paths.
- **Together.** A director runs joint scenes for groups: groom, nuzzle,
  chase, follow, chorus, huddle, dance, feed, ride and climb, and:
  - a sentry: one of a band of meerkats, mongooses or marmots stands up to
    keep watch while the rest dig and feed round it;
  - an alarm: one freezes and looks, and they all scatter away from the same
    side, the runners across the lawn, the climbers and birds into the tree;
  - a stalk: a cat creeps up on the bird it is with, pounces and misses, and
    washes as if it meant to;
  - a mob: crows find an owl at its roost by day and call round it until it
    flies;
  - a perch: a pair of birds side by side, preening or singing a duet;
  - a flock: birds go out round the tree together on their leader's loops.

  Snow, rain and night make a huddle likelier, dawn and dusk a chorus. Poses
  cross-fade between actions.
- **Fruit.** Pass ripe fruit as `stage.food`: `{ key, p, perch? }`, where
  `perch` is the branch it is eaten from and a fruit without one lies on the
  ground. `FRUIT_EATERS` says who eats fruit and where:
  - squirrels, monkeys and songbirds take it off the branch or the ground;
  - deer, bears and rabbits only take what has fallen;
  - wolves and owls leave it alone.

  Now and then an eater goes to a fruit no one else has claimed. It eats with
  its mouth over the fruit, using its own pose's reach. While it eats, its
  body carries `meal`. `herd.eaten(t)` returns each finished meal once, so
  the scene can take that fruit away.
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
`poseSpecies(id, action, t, { seed, region, coat, young, morph, sex })` poses
a single animal for galleries and tests: unseeded, its kind's own make and
first coat; seeded, an individual with its own proportions and a coat of its
region's.

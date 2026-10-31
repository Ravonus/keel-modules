# people

One seed, one person. `personOf(seed)` rolls a build, a face, hair and clothes;
`posePerson(person, action, t)` stands them on their skeleton and gives back
capsules for `sdf-body`, or for anything else that can draw capsules.

There is no avatar to store: the seed is the person, in 3D, from every side.
It imports nothing and knows no renderer, like `fauna`.

Front is +z, right is +x, up is +y, in metres, feet on y = 0.

## Mesh

`meshOf(person, cell)` builds a person once, in a T-pose. The body is one closed
quad cage lofted along the bones: the torso's rings carry the neck, each arm grows
out of an opening in the torso's side, and the legs split the torso's last ring.
Catmull-Clark subdivision smooths it, carrying each point's bone shares with it, so
weights are set ring by ring and never guessed from distance.

Clothes are that same surface, cut by ring and stood off it, so sleeves, hems and
collars are real openings and skin is removed only where it is covered. A skirt or
a long top grows out of the torso's hip ring. Head, hands, hair, hats, hoods and
collars are still melted from capsules and meshed with surface nets. `cell` of
0.03 or more takes one subdivision instead of two.

`poseMesh` gives the bone matrices for any action, `faceAt` the blink, gaze and
mouth, and `trailAt` how far what hangs free trails the body. `render/skin-body`
draws it.

## Weather, costumes and cloth

`personOf(seed, weather, costume)` dresses the same person for a `mild`, `rain`, `cold`, `hot` or `beach` day, or in a `suit`, `firefighter`, `police`, `cowboy`, `fursuit` or `latex` costume. Beachwear cut skimpy is only ever on grown people; a child at the beach wears a tee and swim shorts.

Garments are cut from the body's own surface. Skin under one is pushed in under it, what hangs from the waist is built clear of the widest of the body beneath it, and nothing inside it is built at all, so no figure comes through its clothes. Hair stops at a hat's hem, and the scalp stops under thick hair.

Each vertex's `fabric` is one of `FABRICS`, and `cloth` says where it lies round its limb, along it, and how far from its garment's edge. `render/skin-body` works folds, weave, hems and stitching out from those per pixel, with no texture.

## Motion

`MOTIONS` is one table: an action is a beat and a pose at any point of it, so adding an emote is adding a line. `Person.gait` makes each person's walk and run their own: cadence, stride, arm carry, unevenness between the sides. `poseMesh` can fade from one action to the next.

Actions: stand, idle, walk, power, jog, run, sprint, jump, sit, crouch, wave, clap, laugh, cheer, dance, shrug, bow, nod, fold, hips, think, talk, stretch. Pass the action to `faceAt` so a laugh or a talk reaches the face.

## Hair and ears

A head of hair is built in layers on the head's bone: a cap that ends on a drawn hairline, a fringe sheet, a side sheet over a covered ear, broad under-locks, then clumps on top. Ties gather hair and take an elastic. Styles of separate ropes (locs, mohawk) skip the clumps.

Loose hair goes over the ears or tucks behind them, a side at a time: `tuckOf(p)` says which. Tucked hair clears the ear entirely.

Both have levels by the mesh's grid: near (every lock, every fold of the ear), mid (fewer locks, the ear and its rim), far (the solid shape alone).

A head near enough to read is a fixed mesh: the same rows and columns on everyone, laid through the same lines of a face (brow, lids, nose base, lips, chin) and shot onto the solid the head is melted from, with real eye openings, balls behind them, and lips that stand off the face. From `0.05` out a head stays the melted solid, whose face is paint alone.

`Person.gear` is what a person wears that is not clothes: glasses, earrings, a nose stud or ring, a chain, clips, bows, bands and headphones. It comes from its own stream. A child gets no piercings. `Look` also carries `lines`, `rough`, `scars` and `uneven`, which `render/skin-body` paints as folds, pits, old marks and uneven tone.

`render/skin-body` lights hair along its strands. Hair vertices carry their direction in `cloth.xyz` and a strand coordinate in `cloth.w`.

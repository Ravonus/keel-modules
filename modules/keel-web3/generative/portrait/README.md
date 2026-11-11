# portrait

A seeded waist-up portrait bust, made for a close camera: a head with its brow, sockets, lids, nose, lips, chin and
ears; a neck and shoulders; a raised right hand with jointed fingers pinching a card; a knit cap with a folded cuff
over a head of wavy locks; and layered cloth (a gathered chemise, a dress with a square neckline and an embroidered
band, a velvet over-gown with wide sleeves, a fine chain). `buildBust(recipe)` gives the meshes;
`createPortrait(lit, bust)` draws them with keel/lit.

It imports nothing at run time. keel/lit is handed to `createPortrait`, so the module never bundles a renderer.

## How it is made

Every solid part is a tree of signed distances (`src/sdf.ts`): ellipsoids, round cones, capsules and boxes, melted
together with a smooth minimum, carved, cut by planes, framed, and given small added fields for folds and gathers.
The head is sculpted in its own frame, masses first (an oval whose width and depth change with height, the cranium,
cheekbones, brows), then the nose, then the sockets carved and the lids laid in as shells, then the lips, the mouth's
line, the nostrils and the philtrum.

The trees are meshed when the bust is generated, by surface nets over a sparse grid (`src/mesh.ts`). Space is cut
into blocks of 8³ cells and each block gets its own distance function holding only the shapes near it
(`src/compile.ts`). A block is sampled first as 4³ cubes of two cells, and only cubes the surface can reach have
their corners sampled. Each crossed cell gets one vertex, pulled onto the surface along the field's gradient, with
the gradient as its normal. A vertex's openness, used for ambient light, comes from the field two steps out along
its normal. Hair is not a field. Each lock is a flattened, curled tube along a guide that starts under the cuff,
falls under gravity and is pushed clear of the body. Eyes, the card and the chain are built directly.

What can never be seen is not meshed: the chemise only shows in the neckline, the dress only in the gown's opening
and on the raised arm, and nothing is built below the frame's lower edge.

A seed decides the face's proportions (eye spacing, nose, lips, jaw, chin, cheeks) and every lock of hair, using
only arithmetic that rounds the same way on every engine (`src/exact.ts`: series sine and cosine, an integer hash).
The vectors pin a hash of every vertex, normal and index of six far busts, and it comes out the same on Node 22, 24
and 26.

## Recipe

```ts
const bust = buildBust({ seed: 7, face: "A", hand: "pinch", detail: DETAIL.hero });
const sitter = createPortrait(lit, bust);   // lit: the keel/lit namespace
stage.add(sitter.group);
sitter.face({ lid: 0, at: [camera.position.x, camera.position.y, camera.position.z] });
sitter.shadows(renderer);                     // before a frame, when the bust or the light moved
renderer.render(stage, camera);
```

- `face: "A"` looks to camera, frontal. `"B"` turns the head 24° away and pitches it 20° down, and the cap sits 1 cm
  lower so its cuff shades the eyes. Both share the cap's crown, the hair behind and the bounding box.
- `hand: "pinch"` pinches the card between the index finger's pad and the thumb (the thumb reaches by two-bone
  reach, so the pinch always closes); `"point"` floats it over a raised index finger.
- `DETAIL.hero`, `.mid`, `.far` set the cell sizes, the eye's rings and the hair's locks, segments and sides.
- Busts are cached by `digestOf(recipe)`: the same recipe is built once.
- `portraitSettings(KEEL_INPUTS.portrait)` normalises the settings in `keel.module.json` and `sitterOf(settings)`
  turns them into a recipe and a palette.

The bust's frame is metres, the origin at the pit of the throat, y up, z out of the chest. The head's frame has its
origin between the eyes' centres. `PARTS` names each part's material.

## Shading

One program with a `PART` define for each material, all sharing one set of uniforms (`src/portrait.glsl.ts`):

- Light: one soft warm key from the upper left (azimuth −40°, elevation 35°, `#fff1dc`) with its own shadow map
  (12-tap soft lookups), and a cool fill (`#c9d6d9`) at about half the key from sky and ground. `light()` changes
  both.
- Skin: wrapped diffuse, a reddened band where light crosses under the skin at the terminator, half-tones running
  cool and lights warm. Lips, blush, brows and lash lines are painted from where each point lies on the head at
  rest, so they stay put when the head turns.
- Eyes: iris, pupil and fibres per pixel, turned toward `face({ at })`, with the upper lid's shade and a glint;
  `face({ lid })` closes the lids from 0 to 1.
- Knit ribs, the cuff's fold and its two labels; hair by its grain (two highlights along each lock); velvet sheen;
  the dress's band, sleeve cuff and lace; gold; the card's chip, grain and lettering. Fine relief is bump-mapped from
  screen derivatives, with no textures.

The colours are a `Palette`. The output is linear and unclamped: tone-map it, or pass it through a painterly post.

## Budgets

Measured on an M4 Max in headless Chrome (ANGLE on Metal), 1-minute load average 6 to 12:

- Generation, hero detail: about 290 to 330 ms the first time (≈171k vertices); a cached recipe returns at once.
- Drawing, hero at 1440×900, DPR 2, before any post: see the trial's frame times.

## Credits

The distance functions follow the well-known forms for ellipsoids and round cones (Inigo Quilez's notes); the
surface nets mesher follows S. Gibson's method. The hair's highlights are Kajiya and Kay's. Written for this module
under MIT.

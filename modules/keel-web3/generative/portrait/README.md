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
cheekbones, brows, chin), cut along a plane under the jaw from the chin back to the angle under each ear; then the
nose; then the sockets carved and the lids laid in as shells with the eye's almond opening cut through them; then the
lips, the mouth's line (a thin disc round the teeth's curve, so it dies out at the corners), the nostrils, the
philtrum and the fold over the chin.

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

- `face: "A"` turns the head 14° to her right, tilts it 10° toward that shoulder and pitches it 6° down, so it sits in
  three-quarter view with its eyes free to look back at `face({ at })`. `"B"` turns the head 24° away and pitches it
  20° down, and the cap sits 1 cm lower so its cuff shades the eyes. Both share the cap's crown, the hair behind and
  the bounding box.
- `hand: "pinch"` shows the card by its lower edge: the card square to the palm, the thumb's pad pressing it to the
  index and middle fingers behind it (the thumb reaches by two-bone reach, so the pinch always closes); `"point"`
  floats it over a raised index finger.
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
  both. Flesh takes the key's shadow with an edge six times as wide as everything else, so no hard shadow crosses
  the face.
- Skin: wrapped diffuse, a reddened band where light crosses under the skin at the terminator, half-tones running
  cool and lights warm, a faint mottle. A warm flush on the cheeks, the nose, the chin and the ears; lips, brows,
  the lash lines and the fold of the upper lid are painted from where each point lies on the head at rest, so they
  stay put when the head turns.
- Eyes: iris, pupil and fibres per pixel, turned toward `face({ at })`. The almond opening is painted to the same
  two arcs the lids are cut by: outside it the lid's skin is drawn, under the upper lid the eye lies in its shadow
  and the lashes' line. `face({ lid })` closes the lids from 0 to 1.
- Knit ribs, the cuff's fold and its two labels; hair by its grain (two highlights along each lock); velvet sheen;
  the dress's band, sleeve cuff and lace; gold; the card's chip, grain and lettering. Fine relief is bump-mapped from
  screen derivatives, with no textures.

The colours are a `Palette`. The output is linear and unclamped: tone-map it, or pass it through a painterly post.

## Budgets

Measured on an M4 Max in headless Chrome (ANGLE on Metal) at 1440×900, DPR 2, with a 1-minute load average of 13
to 16 from other work:

- Size: 17.6 KB brotli (51.2 KB minified).
- Generation, hero detail: 370 to 510 ms, median about 400, the first time a recipe is built (about 169k vertices,
  331k triangles). Under that load the earlier build of this module took 360 to 455 ms side by side, and 282 to
  296 ms at a load of 7, so at a quiet load this one is expected near 280 to 300 ms. A cached recipe returns at once.
- Drawing, hero, before any post: a median of 1.3 ms on the GPU (95th percentile 1.5 ms) with the shadow map
  redrawn every frame. The GPU was shared, so runs vary.

## Credits

The distance functions follow the well-known forms for ellipsoids and round cones (Inigo Quilez's notes); the
surface nets mesher follows S. Gibson's method. The hair's highlights are Kajiya and Kay's. Written for this module
under MIT.

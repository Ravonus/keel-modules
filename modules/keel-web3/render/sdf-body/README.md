# sdf-body

Smooth bodies from parts, for keel/lit (KEEL's lit renderer). A generator poses a creature (or a
plane, a balloon or a prop) as capsules. This module draws each body as one
continuous surface, with no seams and no blocks.

## How it draws

- **One distance field per body.** The capsules are joined by a polynomial
  smooth union, so a neck flows into a chest and a leg into a hip. The
  distance functions come from the KEEL pixel engine (`sdCap`, `smin`). A
  flattened capsule makes wings, ears and fins.
- **Colour melts with the shape.** Each part's palette colour blends across a
  join by the same weight as the surface. Eyes, noses, beaks and lanterns
  (`crisp` roles) stay sharp and are never melted.
- **Raymarched in its own box.** Each body is a back-faced box around its
  parts. The ray is taken into the parts' space, marched to the surface and
  shaded. The march writes true depth, so a body sorts against trees,
  planters and other bodies, and works with the camera inside the box.
- **Scene light.** The sun, a fill light (a moon), the hemisphere sky and
  ground, and a rim light are taken as keel/lit light colour × intensity, so
  bodies match `MeshStandardMaterial` brightness. Occlusion where parts meet
  comes straight from the field.
- **Glow.** `emissive` roles, a per-body `lit` list (an owl's eyes at night)
  and `glow` (a spirit animal) light from their own colour.
- **Shadows.** With `shadows: true`, a proxy of plain spheres along every part
  casts shadows. It is never drawn to colour.

## Use

```js
import * as lit from "keel://module/lit.js";
import { createSdfBodies } from "keel://module/sdf-body.js";

const bodies = createSdfBodies(lit, { shadows: true, maxBodies: 24 });
scene.add(bodies.group);
// each frame:
bodies.draw(herd.at(t, stage), {
  sun, sunColor, fill: moonDir, fillColor: moonColor,
  sky: hemiSky, ground: hemiGround, rim, rimColor,
});
```

keel/lit is injected, and the module never imports it. The options are:

- `maxParts`: default 48, up to 64;
- `maxBodies`;
- `blend`: how far parts melt, as a share of their mean thickness (default
  0.6);
- `crisp` and `emissive` role lists;
- `renderOrder`.

Boxes are pooled: a frame with fewer bodies hides the spare ones and builds
nothing.

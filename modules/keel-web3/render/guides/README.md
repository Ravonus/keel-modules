# guides

A lit keel/lit stage at a camera, rendered into the guide passes a painter works
from and an image model is conditioned on: depth, normal, part ID, key light,
line and flat block-in colour. Each pass comes back as RGBA8, top row first,
with the ID table that names its parts. The stage is drawn as it stands: the
module swaps its own materials in for one render and puts everything back.

```js
import { createGuides, bySlot, idMask } from "keel://module/guides.js";

camera.aspect = 2880 / 1800;                 // the camera frames the guides
const guides = createGuides(lit, renderer, { tag: bySlot(PARTS, "PART") });
const set = guides.render(stage, camera, { width: 2880, height: 1800 });
set.passes.depth;                            // { width, height, data: Uint8Array }
set.table;                                   // [{ id, name, colour, block }]
const skin = idMask(set.passes.id, set.table, ["skin*"]);   // 255 inside, 0 out
guides.dispose();
```

## Parts and IDs

A tagger names the part each mesh draws with each of its materials. A mesh, or
a slot, with no name is hidden while the guides draw, and so is everything that
is not a mesh: a backdrop quad, motes, sprites.

- `byName` (the default): the mesh's `userData.guide`, the material's, the
  mesh's name, then the material's name.
- `bySlot(names, define?)`: the material's slot (its index in the mesh's
  material array), or the value of a shader `#define` such as `PART`, looked up
  in an array or a `{ name: slot }` record. `bySlot(PARTS, "PART")` names the
  portrait bust's ten materials.
- Any function `(mesh, material, slot) => name | undefined`.

The ID table is the names in code-point order, IDs from 1 (0 is nothing). Each
ID's colour in the `id` pass comes round the hue wheel by the golden ratio at
one of three values, in integer arithmetic, so it is distinct for every ID up
to 255 and the same bytes on every engine; the vectors pin it. Names are free
text: `skin.face`, `eye.left`. `idsOf` and `idMask` take patterns with `*`.

## The passes

The tagged parts draw once, without multisampling, into two half-float targets
(the view normal and coverage; the depth share, the ID and the key light), and
each pass is packed from those into eight bits a channel. Alpha is coverage
(255 or 0) in every pass but `line`.

| pass | RGB | read with |
| --- | --- | --- |
| `depth` | red and green a 16-bit share of `set.range`, 65535 at `near`, 0 at `far`; blue 0 | `depthIn`; red alone is an 8-bit depth map, near white |
| `normal` | the view normal as n / 2 + 1/2: x right, y up, z toward the camera; turned to face the camera on a back face | |
| `id` | the part's table colour | `idsIn`, `idMask` |
| `light` | grey: the key's diffuse (n · l) times what its shadow map lets through | |
| `line` | red: a part's edge (outline and borders between parts); green: a crease; blue: a step in depth within a part. Alpha is the strongest | |
| `block` | the part's flat colour | |

- **Depth range.** The 16 bits run over the parts' own depth: the view
  distances their bounding balls span, kept past the camera's near.
- **Key light.** `key` (toward the light, world), else the stage's brightest
  `SunLight` (from its target), else from the camera. The shadow map (`shadow`,
  2048 px; 0 for none) is fitted to one ball round the parts, with 3 × 3 soft
  taps and a bias that grows at grazing angles.
- **Lines.** A line belongs to the nearer side: an outline sits on the part's
  own edge, a border on the part in front. Creases are compared on two sides
  only, so they are one line wide. `line: { width, crease, step }` sets the
  width in pixels (1), the angle that starts a crease in degrees (40; graded to
  full over the next 0.25 of cosine) and a depth step as a share of the
  distance (0.02).
- **Block colours.** `blocks: { name or pattern: "#rrggbb" }`, else each part's
  own material colour: a built-in's `color`, or a custom material's `uColor`.
- Meshes are placed by keel/lit's own vertex chunks, so instanced, skinned and
  morphed meshes land where their materials put them. A mesh whose own vertex
  shader moves its vertices beyond those is drawn unmoved.

`passes: [...]` reads back only those (the draw is the same).

## Budgets

| | |
| --- | --- |
| code | 14,023 B minified, 5,349 B brotli (q11) |
| GPU memory at 2880 × 1800 | the two RGBA16F targets and their depth buffer 104 MB, the RGBA8 pack target 21 MB, the shadow map and its depth 34 MB (2048², R32F); held until `dispose` |
| CPU memory | each pass read back is width × height × 4 bytes (20.7 MB at 2880 × 1800) |
| time, the portrait bust (335 k triangles) at 2880 × 1800 | the draw (shadow map and parts) 0.35–0.5 ms on the GPU; each pass packed and read back 9–16 ms, nearly all of it the read-back; all six 52.5 ms (median of 9, load 9.2), 74–92 ms in earlier runs at load 9–12 |
| time at 1440 × 900 | all six 14.6 ms (load 9.2; 22–26 ms in earlier runs); the draw 0.33 ms on the GPU |
| measured on | M4 Max, headless Chrome on Metal (ANGLE), keel/lit `f4e677c9` |

## Not yet

- IDs within a mesh (lips, cheek, iris) need the mesh's own fragment shader to
  write them; v1 names whole meshes and material slots.
- The passes come back to the CPU, and the read-back is nearly all the time. A
  GPU consumer would rather keep the textures; that waits for one.
- The depth range is the parts' bounding balls, wider than the parts: red
  alone uses part of its 256 steps. A consumer wanting a full-range 8-bit map
  stretches it.

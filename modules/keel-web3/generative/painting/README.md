# painting

Painted layers over guides. A recipe names palettes, a few warp handles and
layers, each a selection of parts by ID and a list of passes; the guides are
passes rendered from a stage (`render/guides`) or drawn: which part each
pixel is, how lit it is, and its lines. The planner turns both into stroke
lists in exact arithmetic, with a digest; render/brush paints them; the
painter masks, blends, bleeds and grades the layers into a frame.

```js
import { createBrush, packStrokes } from "keel://module/brush.js";
import { createPainting, planPainting, readRecipe } from "keel://module/painting.js";

const recipe = readRecipe(await (await fetch("figure.paint.json")).json());
const plan = planPainting(recipe, { ids, id, light, line });   // RGBA8 ImageData-like, rows from the top
const painting = createPainting(createBrush(gl, recipe.seed), packStrokes);
const painted = painting.paint(plan, guides, { backdrop: plateTexture });
// painted.layers: one texture a layer with its box on the guides; painted.frame: the composite
painting.release(painted);
```

## The recipe (keel-painting@1)

```json
{ "format": "keel-painting@1", "seed": 7,
  "palettes": { "skin": ["#fbeedd", "#ecd0b2", "#c99c7c", "#7d5544"] },
  "warp": [{ "anchor": "id:skin.face", "scale": [1.16, 1.12], "radius": 0.3 }, { "pin": "id:chain", "radius": 0.14 }],
  "layers": [{ "name": "face", "select": { "id": ["skin.*", "lip"], "feather": 1.5, "grow": 8 }, "res": [960, 1152],
    "passes": [{ "pass": "skin" }, { "pass": "glaze", "colour": "#e7a089", "opacity": 0.3,
      "select": { "id": ["skin.cheek"], "feather": 40 } }] }],
  "ops": [{ "op": "edge-bleed", "px": 2, "amount": 0.25 }, { "op": "grade", "warm": 0.03 }] }
```

- **Selections.** `id` lists part names, a trailing `*` a prefix; `not`
  leaves names out; `grow` reaches past the parts by that many layer pixels
  (so a layer meets its neighbour with no gap), `feather` softens the mask.
  A pass may carry its own selection inside its layer's.
- **Warps.** Handles are `id:name` (the part's centre) or `id:name.top`,
  `.bottom`, `.left`, `.right`, or `[x, y]` shares of the frame. An `anchor`
  moves by `move` and scales about itself by `scale` within `radius`; a `pin`
  holds what is near it. The warp is a 65 × 65 grid of offsets, solved in
  four fixed-point steps; the planner and the masks read the guides through
  it, so a proportion fix is one line.
- **Passes.** `under` lays the light through a ramp's palette, softened, as an
  underpainting; `block-in` lays big masses, dark first; `form` turns the
  form along the light's isophotes; `blend` drags what is there with a clean
  brush; `detail` paints along the line guide where it is strong; `accent`
  lays the lights; `glaze` tints the layer. Each takes `brush` (round, flat,
  filbert, rake), `medium` (oil, glaze, scumble), `size` (shares of the
  layer's height), `opacity`, `wet`, `load`, `height`, `taper`, `length`,
  `spacing`, `follow` (axis, form, line), `threshold`, `cross`, `jitter` and
  `bristles`. Strokes trace their flow, turn no more than about 40° a step and
  stop at a part's border unless they may `cross`.
- **Colour.** `#rrggbb`, `palette(name, i)`, `ramp(name, light, steps,
  shift)` (the light, between the layer's 2nd and 98th percentiles, bucketed
  into palette entries, lightest first; a negative shift darkens) or `under`.
- **Presets.** `skin` (underpainting, filbert block-in and form, a blend and a
  fine round form), `hair.locks` (long filbert locks, a blend, fine round
  strands, a few lights), `cloth` and `velvet` (flat masses, soft form, rim
  lights). A preset's fields apply to each pass it expands to; its palette is
  its name before the first dot unless `palette` says.
- **Ops.** A layer's `blend` (normal, multiply, screen, overlay, soft-light,
  colour, luminosity, add) and `opacity`; `edge-bleed` (`px`, `amount`) mixes
  what is behind into a layer's edge; `grade` (`lift`, `gamma`, `gain`,
  `warm`, `saturation`) finishes the frame.

## Exactness

`planPainting` uses integer hashes and plus, minus, times, divide and the
square root: no transcendental. Ids' sums are integers; the warp, frames,
levels and strokes follow from them in a fixed order, and the digest covers
every number of the plan with the version. A recipe and its guides give the
same plan and digest on every engine; the vectors pin them on a small
synthetic bust. The raster is checked by tolerance per GPU.

## Settings

`readRecipe` throws with where and what: the format, an integer seed, at least
one layer, the warp a list, each layer's name, selection, `res` and passes.
Colours throw on anything but the forms above; a ramp must read the light; an
underpainting's palette has at most 8 entries; a layer that selects nothing
throws when planned.

## Injected dependencies

- `brush`: render/brush's `createBrush(gl)` (the painter's GL is the brush's).
- `pack`: render/brush's `packStrokes`.
- `backdrop` (optional): an sRGB texture the layers compose over.

## Budgets

- Code: 28,841 B min, 9,755 B brotli (E 7–9 KB in the spec).
- The 06 figure (nine layers, 15 k strokes, guides 2880 × 1800): plan about
  95 ms on the CPU and paint about 45 ms on the GPU at load 13 on an M4 Max,
  against E 5–10 ms and 8–20 ms at 512² guides. The plan's time goes to
  reading the guides under each layer and to tracing strokes; smaller guides
  and fewer strokes are the levers.
- A recipe: about 4 KB, 1.1 KB brotli, for the figure.

## Where it comes from

The integer hash and unit are painterly's; the digest is plate-painter's.
Guides follow the spec's interface (id index in red, an `ids` table, light
and line in red), so render/guides' passes plug straight in.

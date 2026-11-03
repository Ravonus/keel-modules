# look

One look recipe for every keel/lit stage: the dithered pixel look or the lit,
full-colour realism look. The scene's generators never change between looks;
only the recipe does.

```js
import { LOOK_TARGETS, resolveLook, stageOfLook } from "keel://module/look.js";

const recipe = { format: "keel-look@1", pixel: { style: "pixel", outline: 1 }, realism: { ao: 0.8 }, prefer: "realism" };
const stage = stageOfLook(resolveLook(recipe, LOOK_TARGETS.lit));
if (stage.dither) look = createVoxelDither(lit, renderer, stage.dither);
if (stage.finish) finish = createLitFinish(lit, renderer, stage.finish); // AO, haze, tone map, grade
else if (stage.toneMapping) renderer.toneMapping = stage.toneMapping;
createTreeRender(lit, { ...stage.trees, model, frame });
createForest(lit, { variants, places, maxLeaves: 1600 * stage.density });
```

- **Recipe.** `keel-look@1` is keel-engine core's. `pixel` is voxel-dither's
  own settings (a style id and overrides, by its names); `realism` is exposure,
  a tone map (`neutral`, `agx`, `aces`), AO, density and an optional pixel
  `grade`; `prefer` picks where a target can draw both.
- **Targets.** A target says whether it lights, its most colours and its
  largest screen. Realism is drawn only where it lights; a small target narrows
  the pixel look (palette, tone steps, screen) and passes its `limit` on, so
  voxel-dither caps a style's own levels and palette too. Never widens.
- **Twin.** `resolveLook` is held to keel-engine core's by the same cases
  (`test/look-cases.json`, written by the engine's `test/look-cases.mjs`), so a
  game drawing meshes through keel/bake (`meshStyleOfLook`) and a grove drawing
  this stage wear one recipe the same way.
- **Stage.** `stageOfLook` says what a stage sets: voxel-dither's input (or
  none), lit-finish's input for realism (exposure, tone map, AO), the tone
  mapping for a host without lit-finish, a density for
  the generators' detail, and one tree's tree-render options (realism draws
  real blades and bark, without sprays, clumps or rootSink).

Pure: no renderer, no globals.

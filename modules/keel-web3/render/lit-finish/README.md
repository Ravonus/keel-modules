# lit-finish

The finish a lit, full-colour keel/lit stage needs to read as real. It is the
realism look's counterpart to voxel-dither.

```js
import { createLitFinish } from "keel://module/lit-finish.js";

renderer.toneMapping = "none"; // the finish tone maps
scene.fog = null;              // the finish's haze replaces fog
const finish = createLitFinish(lit, renderer, { tonemap: "agx", ao: 0.8 });
finish.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
finish.setSun([sun.position.x, sun.position.y, sun.position.z], "#fff2dc");
finish.setHaze({ colour: "#a9bfd6", density: 0.015, start: 6 });
renderer.setAnimationLoop(() => {
  forest.update({ ...frame, dither: finish.ditherOffset() });
  finish.render(scene, camera);
});
```

- **Ambient occlusion.** Taken from the depth buffer at half size: 16
  samples in a hemisphere round each point's normal (rebuilt from depth),
  spun differently per pixel, then blurred among pixels at the same depth so
  it never bleeds across a silhouette. `aoRadius` is in metres.
- **Aerial haze.** The air between the eye and each point, from `hazeStart`
  out at `hazeDensity` per metre, brighter toward the sun (Henyey-Greenstein).
  The sky is all air, so the horizon and the far trees meet in one colour.
- **Leaves and colour.** A post sees only pixels, so these live in the stage's
  own materials. Every 30 frames the finish chains a hook onto each
  material's own `onCompile` (flora's and tree-render's keep their wind and
  seasons), keyed apart so no program is shared by mistake. Foliage (drawn
  from both sides or cut out of a card) lets the first sun through:
  strongest looking into it, and none in its own shadow map. Every surface
  is muted (`mute`) and varied in patches (`variation`): darker and lighter by
  the metre, drier and damper by the ten metres. `dress(root)` does it at once.
- **TAA.** Each frame is jittered (Halton 2, 3) and blended with the last,
  found through the depth and the last camera and held inside this frame's
  neighbourhood. A dithered fade should move its pattern by `ditherOffset()`
  (tree-render's forest takes it as `update({ dither })`), so it averages to
  real cover instead of a stipple.
- **Bloom.** The light above `bloomThreshold`, at quarter size, blurred wide.
- **Tone map.** AgX (default), PBR Neutral or ACES, after `exposure`.
- **Grade.** Saturation, contrast, warm lights over cool shadows, a vignette,
  sRGB, and a half-step of noise against banding.
- **Look recipes.** keel-modules' `look` gives `stageOfLook(look).finish`,
  this module's input for a recipe's realism look.

The scene draws once into a 4x multisampled half-float target, so the canvas's
own antialiasing is not needed. `setView("ao")` shows the AO alone, for tuning.

keel/lit is injected: the module never imports it and never touches globals.

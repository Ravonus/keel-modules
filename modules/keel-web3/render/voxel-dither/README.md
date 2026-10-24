# voxel-dither

Dithered voxel pixel art for any Three.js scene. The scene is drawn at a low,
integer-scaled resolution and shown only through a dither screen: a threshold
map plus a few tone steps, or a fixed palette. It is the look of the Cherry
Blossom grove, packaged so any KEEL artwork can wear it.

What it does, per art pixel:

- **Integer pixel grid.** Every art pixel covers the same whole number of
  device pixels, so rows are never uneven. `pixel: 0` picks a size from the
  frame (about 210 art pixels on the short side).
- **Depth-banded screens.** Near things wear a crisp ordered matrix, the middle
  distance a finer one, far things a softer spread that snaps to calm fills.
  `screen: "auto"` also adapts to the grid: a 2x2 lattice on small grids, an
  8x8 matrix and fine grain on large ones. Any fixed screen can be forced.
- **Screens:** `bayer2`, `bayer4`, `bayer8`, `halftone`, `lines`, `diagonal`,
  `hatch`, `ign`, `stipple`, `checker`, `none`. Each is a pure function of the
  pixel (`thresholdAt` is the CPU mirror), so a still pixel never crawls.
- **Tone steps.** `color: "rgb"` steps each channel; `"luma"` steps lightness
  twice as finely as colour and dithers colour gently, so shading reads as
  ramps and greys stay grey. A `palette` (up to 32 colours) replaces both.
- **Outlines and creases** from depth: a one-pixel silhouette in a darker,
  cooler ink (or a fixed `outlineColor`), drawn as a solid run (never dithered)
  and thinner with distance, plus a softer line on voxel edges.
- **Cel light.** `shade(root)` swaps lit `MeshStandardMaterial`s for
  `MeshToonMaterial` twins on a stepped ramp of `bands` steps, and swaps them
  back for `shading: "smooth"`. Shared materials stay shared; colours carry
  over both ways. Mark a material `userData.voxelDitherKeep = true` to leave it.

Anything drawn with `depthWrite: false` (rain, sparks, glows) is dithered but
never outlined.

## Styles

`smart` (the default), `pixel` (3D pixel art: big art pixels, a hard
Bayer screen on every channel and three cel bands, for smooth low-poly scenes), `bayer`, `soft`, `halftone`, `engraving`, `chunky`,
`grain`, `blossom` (a 16-colour palette), `pocket` (4 greens) and `clean`
(posterized cel, no dither). A setting passed with `style` overrides the
preset's.

## Injected dependencies

The caller passes the THREE namespace (r150 or later, WebGL2), the
`WebGLRenderer`, and the frame size. The module never imports Three.js and
never reads globals.

## Usage

```ts
import * as THREE from "keel://module/three.js";
import { createVoxelDither } from "keel://module/voxel-dither.js";

const look = createVoxelDither(THREE, renderer, { style: "smart", ...globalThis.KEEL_INPUTS?.["voxel-dither"] });
const resize = () => {
  renderer.setSize(width, height, false);
  look.setSize(width, height, renderer.getPixelRatio());
};
look.shade(scene);                     // after building or rebuilding the scene
renderer.setAnimationLoop(() => {
  look.setDepthBands(cameraDistance + 9, cameraDistance + 16); // optional, cheap
  look.render(scene, camera);
});
```

Build the renderer with `antialias: false`: the art-pixel grid resolves every
edge.

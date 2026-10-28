# voxel-dither

Dithered voxel pixel art for any keel/lit stage. The scene is drawn at a low,
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
`grain`, `blossom` (a 16-colour palette), `pocket` (4 greens), `clean`
(posterized cel, no dither) and `crt` (painted 3D pixel art: fine pixels,
smooth light, dark ink outlines, rich colour, scanlines and a colour fringe). A setting passed with `style` overrides the
preset's. `snap` (0 to 0.9) keeps flat in-between tones clean: most of each
step between two tones snaps flat, and only a short seam where one tone meets
the next dithers, the way pixel art is drawn.

Three signal settings sit on top of any style: `scanlines` (0 to 1) dims part
of every art-pixel row like a tube screen, `chroma` (0 to 1) drifts red and
blue apart by whole art pixels, and `glitch` (0 to 1) fires short bursts that
tear bands of rows sideways and drop a block of the frame out of place. Call
`look.setTime(seconds)` each frame to roll the scanlines and time the bursts;
without it the frame never glitches.

Those three apply to the whole frame. To give one part of the scene its own
signal instead, tag it: `look.tagSignal(root, part)` (part 1, 2 or 3) makes
every opaque material under `root` write the part into the scene target's
alpha, and `look.setSignals([platform, tree, background])` gives each part its
`scanlines`, `chroma` and `glitch`. A torn part's rows slide out over its
neighbours and blocks of it show the sky above, while untagged pixels stay
clean. Call `tagSignal` again after `shade`, which swaps materials.

A part's signal can also wear one filter, `filter` with an `amount` (0 to 1):
`snow`, `film`, `mosaic`, `cga`, `negative`, `glow`, `vhs`, `bleed`, `wave`,
`nightvision`, `sparkle`, `thermal`, `neon`, `rainbow`, `slitscan`,
`pixelsort`, `datamosh` or `holo` (`SIGNAL_FILTERS`). Filters that move
pixels move them by whole art pixels; the rest change colour before the tones
are stepped, so a filtered part stays dithered pixel art. Time-driven filters
need `setTime` like the glitch.

## Injected dependencies

The caller passes the keel/lit namespace (WebGL2), the renderer from
`createLitRenderer`, and the frame size. The module never imports keel/lit and
never reads globals.

## Usage

```ts
import * as lit from "keel://module/lit.js";
import { createVoxelDither } from "keel://module/voxel-dither.js";

const look = createVoxelDither(lit, renderer, { style: "smart", ...globalThis.KEEL_INPUTS?.["voxel-dither"] });
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

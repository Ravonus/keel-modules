# world-theme

Themes for a small floating world: the planter a tree grows in and the world
round it. Each theme is a recipe with several palettes and ranges, and a seed
resolves it into one concrete look, so every object wears its own variant.
Pure data and colour maths; the renderer builds the geometry and keeps its
own real light (sun height, night, weather).

## Planters

| Planter | What it is | Variants |
|---|---|---|
| `earth` | turf over soil, follows the seasons | — |
| `gold` | polished gold: bullion bars, slabs or tiles, glints | yellow, rose, white, old gold |
| `goldOre` | rock with glinting gold seams | granite, basalt, red rock |
| `emerald` `ruby` `sapphire` `amethyst` | cut gem body with crystal clusters | two cuts each |
| `marble` `obsidian` `granite` `sandstone` | stone: veined, glassy, speckled, layered | two or three each |
| `cyber` | dark panels, neon traces and trim | ice, magenta, acid, amber |
| `vapor` | pastel grid, chrome or neon trim | sunset, mall, lilac |
| `antigravity` | stone whose underside floats apart and bobs, glowing seams | void, red moon, violet |
| `hologram` | see-through light, flickering | cyan, rose, lime |
| `glitter` | sparkling tiles | party, silver, disco |
| `cosmic` | night-sky stone full of stars | nebula, deep field, supernova |

The seed also picks the surface layout, the underside (cone, spire, floating
chunks, slab, crystals), the trim, the vein and crystal counts, the underside
depth and a small hue drift.

## Worlds

| World | Skyline | Clouds | Sun · moon |
|---|---|---|---|
| `nature` | stepped ridges | voxel | real |
| `city` | towers with lit windows | voxel or none | disc · big moon |
| `synth` | neon grid floor and wire hills | neon or none | striped sun · neon moon |
| `vapor` | pastel grid | pastel | striped pastel sun · big or ringed moon |
| `crystal` | gem spires | voxel or pastel | ringed sun · ringed moon |
| `cosmic` | floating asteroids | nebula | star · ringed planet |

`skyMix` says how far the theme's sky overrides the real sky colours, and
`light.mix` how far the key light takes the theme's tint; the sun and moon
still move with the real clock, and night is still night.

## Usage

```ts
import { themeFor } from "keel://module/world-theme.js";

const theme = themeFor({ planter: "seed", world: "seed", seed: 1234 });
theme.planter.colors.top   // ["#d8264a", "#ff7d95"]
theme.world.sun.style      // "striped"
theme.name                 // "Ruby · pigeon blood · crystal over Synthwave · night drive"
```

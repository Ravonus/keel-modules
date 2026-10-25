# world-theme

Themes for a small floating world: the planter a tree grows in, the world
round it, and the rare skin a tree may wear. Each is a recipe with several
palettes and ranges, and a seed resolves it into one concrete look, so every
object wears its own variant. Pure data and colour maths; the renderer builds
the geometry, animates the effects and keeps its own real light (sun height,
night, weather).

## Planters

| Planter | What it is | Variants |
|---|---|---|
| `earth` | turf over soil, follows the seasons | meadow |
| `gold` | polished gold: ingots, hammered, brushed or coin top; ingot, coin or nugget decor | yellow, rose, 24 karat, white, old gold |
| `goldOre` | rock with glinting gold seams and nuggets | granite, basalt, red rock |
| `emerald` `ruby` `sapphire` `amethyst` | cut gem: facets, shards and geodes | two cuts each |
| `jade` | soft veined jade, pillars and orbs | imperial, lavender, celadon |
| `marble` `obsidian` `granite` `sandstone` | stone: veined, glassy, speckled, layered | three or four each |
| `lava` | crust over glowing flowing magma, vents, drips | basalt, blue fire, magma |
| `ice` | frosted or faceted ice, icicles | glacier, aurora, deep ice |
| `chrome` | liquid mirror metal, orbs and rings | mirror, black chrome, oil slick |
| `cyber` | panels with circuit traces and running pulses, antennas, pylons | ice, magenta, acid, amber |
| `vapor` | checker, grid or tile with rainbow drift, pillars and rings | sunset, mall, lilac |
| `antigravity` | stone whose underside floats apart and bobs | void, red moon, violet |
| `hologram` | see-through scanlines that flicker and glitch | cyan, rose, lime |
| `glitter` | big flakes that flash as they catch the light, disco balls | party, silver, disco, gold dust, mermaid |
| `cosmic` | a swirling starfield, orbs and rings | nebula, deep field, supernova |

The seed also picks the outline (`shape`: square, rounded, octagon, round,
hex, tiered pedestal, organic blob, scalloped, diamond), how the sides
`flare` or taper, the body `height`, the surface `pattern`, its animated
`effect` (sweep, sparkle, pulse, scroll, shimmer, swirl, flicker, flow,
breathe, rainbow), the `decor` and how many, the underside (cone, spire,
floating rocks, thruster slab, hanging crystals, drips), the trim (neon,
chrome, gold, studs, frost), a pattern `grain` and effect `speed`, and a small
hue drift. `surface` and `crystals` name the same look for a block renderer.

Two rolls come last, so a seed keeps every choice above. `size` is the
planter's width as a share of full size: most are small (0.58 to 0.9), about
one in six tiny (0.45 to 0.58, named "tiny") so a tree's roots overrun it, and
a few large (to 1.05, named "grand"). About one in seven planters is
sculpted (`sculpted: true`): `shape` is then a `Sculpt` chosen from `SCULPTS`
for its family (skull, urn, stump, shell or a carved stone head), the
underside is floating rocks and there is no trim. The renderer decides how to
carve each sculpt.

## Worlds

| World | Form | Skyline | Clouds | Sun · moon |
|---|---|---|---|---|
| `nature` | pixel | ridges | puffs | real |
| `beach` | pixel | sand, shallows and open sea to a hard horizon | puffs or pastel | disc or striped · big moon |
| `city` | pixel | towers with lit windows | puffs or none | disc · big moon |
| `synth` | pixel | neon grid floor and hills | neon or none | striped sun · neon moon |
| `vapor` | pixel | pastel grid | pastel | striped pastel sun · big or ringed moon |
| `crystal` | pixel | gem spires | puffs or pastel | ringed sun · ringed moon |
| `cosmic` | pixel | floating asteroids | nebula | star · ringed planet |
| `voxel` | voxel | stepped ridges | voxel | real |

`form` says how the scene is built: smooth low-poly shapes drawn as pixel
art, or (only in the voxel world) whole blocks. `skyMix` says how far the
theme's sky overrides the real sky colours, and `light.mix` how far the key
light takes the theme's tint; the sun and moon still move with the real
clock, and night is still night.

## Tree skins

Most trees are natural. A seed rolls a skin on its own stream (so skins never
move a planter or world), and the finer the skin the rarer it is:

| Skin | Rarity | Draws in 1000 | Bark | Leaves |
|---|---|---|---|---|
| `natural` | common | 870 | the species' own | the species' own |
| `crystal` | uncommon | 40 | facets | gem shards |
| `petrified` | uncommon | 35 | marble | stone chips |
| `frost` | rare | 18 | frost | icicles |
| `gold` | rare | 15 | brushed gold | coins |
| `ember` | epic | 8 | magma | embers, rising sparks |
| `mystic` | epic | 7 | veined | glowing orbs, drifting wisps |
| `hologram` | legendary | 4 | scanlines, see-through | light cubes |
| `cosmic` | legendary | 3 | starfield | stars, orbiting motes |

## Signal glitch

A glitch hits parts of the scene, never the whole frame: the platform
(`planter`), the `tree` and the background (`world`) each roll their own kind,
on a stream of their own so a glitch never moves a planter, world or tree.
`theme.glitch.parts[part]` gives that part's `scanlines`, `chroma` and
`glitch` strengths (0 to 1) for the render look; each varies a little per
seed. A full glitch, all three parts torn at full strength, is a separate and
rarer draw.

| Kind (per part) | Rarity | Draws in 1000 |
| --- | --- | --- |
| Clean | common | 820 |
| Scanlines | uncommon | 90 |
| Colour fringe | uncommon | 50 |
| Flicker | rare | 25 |
| Torn signal | epic | 15 |
| Full glitch (every part) | legendary | 6 |

## Usage

```ts
import { themeFor } from "keel://module/world-theme.js";

const theme = themeFor({ planter: "seed", world: "seed", tree: "seed", seed: 1234 });
theme.planter.pattern      // "facet"
theme.world.form           // "pixel"
theme.tree.rarity          // "common"
theme.name                 // "Ruby · star · facet · shimmer · shards over Synthwave · night drive"
```

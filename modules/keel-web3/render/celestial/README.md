# celestial

The real sky for art that lives onchain. The code holds no numbers: a binary pack does, so the pack can grow or
be replaced without the code changing, and a KEEL revision republishes only what changed.

```js
import { openSky } from "keel://module/celestial.js";
const sky = openSky(keelContent.bytes("sky.pack"));
sky.skyAt(Date.now());                // bodies, retrogrades, phase, eclipses, meteor shower
sky.chartAt(bornAt, lat, lon);        // the same, plus ascendant, midheaven and aspects
```

## The pack

`data/sky.pack` is `K S <version>` and then sections of `<tag> <varint length> <bytes>`. A reader skips a tag it
does not know, so a new section ships without breaking an old reader. Numbers are quantised to the precision the
sky needs, then zigzag varints, so KEEL's own brotli layer still has structure to work with; there is no second
entropy coder in the module.

| Tag | Holds |
|---|---|
| 1 | JPL Keplerian elements, 12 numbers for each of 9 bodies |
| 2 | JPL table 2b giant-planet terms |
| 3 | The moon's mean arguments |
| 4 | Corrections fitted to a reference ephemeris, per body: longitude, latitude, distance |
| 5 | Bright stars by magnitude class, 21 bits each |
| 6 | The twelve zodiac figures, as star indices |
| 7 | Meteor showers: solar longitude, radiant, rate, width |

## Updating it

Change the tables, targets or span in `tools/build-pack.mjs`, bump `VERSION`, and run:

```bash
node tools/build-pack.mjs --sources <dir> --oracle <astronomy-engine/esm/astronomy.js> --scratch <dir>
```

`--sources` holds d3-celestial's `stars.6.json` and `constellations.lines.json`. astronomy-engine is the fit target
only and is never shipped. Then run `scripts/sync-voxel-dither.mjs` in the grove to copy the pack across.

## Sources

JPL approximate planetary elements (Standish and Williams; Pluto from table 1, corrected by the fit), mean lunar
arguments after ELP2000-82, the Yale Bright Star Catalog and zodiac figures through d3-celestial (BSD-3-Clause,
Olaf Frohn), the International Meteor Organization's shower list, and astronomy-engine (MIT, Don Cross) as the
reference the corrections were fitted to.

# ocean

A sea as a pure function. A seed and a wind make the water, and everything
that floats, swims or draws asks the same waves. It draws nothing and touches
no globals; `render/ocean-render` draws it and `generative/marine` swims in it.

```js
import { createSea, tideAt, lightThrough } from "keel://module/ocean.js";

const sea = createSea({ seed: 7, wind: 7 });
sea.surfaceAt(x, z, t);     // { height, normal } of the water at (x, z)
sea.seabedAt(x, z);         // the ground's height
sea.currentAt(x, y, z, t);  // drift plus wave orbit, fading with depth
sea.packed;                 // the waves as floats, for a shader's uniform array
tideAt({ moon: 40, sun: 10, range: 2 }); // metres above mean sea level
lightThrough(12);           // the share of red, green and blue left after 12 m
tideOn(hours, { range: 2 }); // the tide by clock, springs and neaps included
tideTimes(hours);           // the next high and low waters
surfAt(depth, x, z, t, wind); // breakers and swash near a shore
surfThrow(depth, x, z, t, wind); // how far a lip is thrown up the shore
surfBurst(depth, x, z, t); // how hard the surf is crashing, 0 to 1
```

- **Waves.** Gerstner waves on deep water's dispersion (`omega = sqrt(g k)`),
  lengths up to the wind's Pierson-Moskowitz peak, fanned around its heading.
  Their combined steepness is capped so crests never loop over themselves.
- **Height.** Gerstner waves move water sideways, so `surfaceAt` undoes that
  push to answer for the exact (x, z) asked about.
- **Tide.** `tideAt` is the equilibrium tide, so feeding it the real moon from
  `celestial` gives a sea that matches the sky. It takes elevations rather than
  importing `celestial`, so either module works alone.
- **Surf.** `surfAt` needs only depth, place and time, so fronts follow the
  ground's contours and bend into bays by themselves. They steepen, collapse in
  the last metre and run up the sand. `surfaceAt`'s fourth argument is the tide.
- **Light.** `lightThrough` is Beer-Lambert over `CLEAR_WATER` or
  `COASTAL_WATER`. Red goes first, which is why the deep is blue.

Frame: +y up, still water at y = 0, metres and seconds.

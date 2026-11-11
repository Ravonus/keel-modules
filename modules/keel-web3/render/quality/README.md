# quality

One setting for how good a scene looks.

```js
import { createQuality } from "keel://module/quality.js";

const quality = createQuality({ level: "auto", tier: device.tier });
createOcean(lit, { sea, quality });
// each frame, so it can hold the frame rate:
ocean.draw(renderer, scene, camera, t, { sun, sunColor, frameMs });
```

- **Levels.** `low`, `medium`, `high`, `ultra`, or `auto` from `device-profile`'s
  tier. Each sets render scale, upscaling, ray steps and animal shapes in rays.
- **Location.** `settingsAt` spends a level by where the camera is. Above water
  there are no shafts or snow, high above it fewer ray steps, and in the deep
  no ground shadows.
- **Switches.** `createQuality({ tracing: false, upscale: false, spray: false })` starts with
  them off, and `quality.set({ tracing, upscale, spray, level })` changes them while
  running. With tracing off, no ray runs at all.
- **Governor.** `frame(ms)` lowers the render scale when frames run slow and wins
  it back when they run fast. It waits 30 frames between changes.
- **Page levers.** `quality.levers` is what a scrolled page's scenes may spend,
  for each scene's `setQuality`: `{ renderScale, bloom, motes, blendScale, taa,
  density }`. `renderScale` is the governed scale; `bloom` is a share of a scene's
  own bloom (0 is off); `motes` and `density` are the share of particles and of
  detail drawn; `blendScale` is the outgoing scene's scale during a hand-over, as a
  share of `renderScale`; `taa` turns temporal antialiasing on. `leversFor(level,
  scale)` gives the same without a governor. The ocean settings above are unchanged.

| level | bloom | motes | blendScale | taa | density |
|---|---|---|---|---|---|
| low | 0 | 0.25 | 0.5 | off | 0.5 |
| medium | 1 | 0.5 | 0.5 | on | 0.75 |
| high | 1 | 0.8 | 0.75 | on | 1 |
| ultra | 1 | 1 | 1 | on | 1 |

Pure: it takes frame times as input and never reads a clock.

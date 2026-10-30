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
- **Switches.** `createQuality({ tracing: false, upscale: false })` starts with
  them off, and `quality.set({ tracing, upscale, level })` changes them while
  running. With tracing off, no ray runs at all.
- **Governor.** `frame(ms)` lowers the render scale when frames run slow and wins
  it back when they run fast. It waits 30 frames between changes.

Pure: it takes frame times as input and never reads a clock.

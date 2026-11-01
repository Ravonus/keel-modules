# device-profile

Tells a phone, tablet or desktop from what a browser and its GPU report, and names the detail to draw there. What the GPU reports comes first: a user agent can be spoofed or frozen and says nothing of how much a GPU can hold, so it only helps sort the class.

## Usage

```ts
import { profileOf, readSignals } from "keel://module/device-profile.js";
import { createSdfBodies, partsFor } from "keel://module/sdf-body.js";

const device = profileOf(readSignals());
const bodies = createSdfBodies(lit, { maxParts: Math.min(device.parts, partsFor(device.uniforms)) });
```

`profileOf(signals, { force: "phone" })` overrides the class, for testing a phone's detail on a desktop.

`profileOf` is pure: pass it recorded signals and it gives the same answer.

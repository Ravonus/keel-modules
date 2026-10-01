# glow-field

Animated glow rings for backgrounds. Its look (color, background, ring count, speed, motion, pulse, accent colors and a reveal date) is declared as module settings in `keel.module.json`, so Studio and the KEEL editor show matching controls when an artist includes it. Basic settings appear up front; motion, pulse, accents and the reveal date sit under Advanced.

## Injected dependencies

The caller passes the 2D context, size, elapsed time, the settings object and the current day. The module never reads globals.

## Usage

```ts
import { drawGlow, glowSettings } from "./src/index.ts";

// Hosts publish chosen settings before modules run.
const look = glowSettings(globalThis.KEEL_INPUTS?.["glow-field"]);
const today = new Date().toISOString().slice(0, 10);
const frame = (ms: number) => {
  drawGlow(context, canvas.width, canvas.height, ms / 1000, look, today);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

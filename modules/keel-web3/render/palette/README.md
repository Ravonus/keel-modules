# palette

Compact palette utilities: parse `#rrggbb` and `#rrggbbaa` hex colors into channel arrays, format them as CSS `rgba()`, interpolate two colors, and select from a palette with wraparound indexing so any integer (including negatives) lands on a valid entry.

## Injected dependencies

None. The module is pure string and number work with no environment access.

## Usage

```ts
import { mixColors, paletteColor, rgba } from "./src/index.ts";

const palette = ["#0f172a", "#38bdf8", "#f472b6"];
const base = paletteColor(palette, index);
const glow = mixColors(base, [255, 255, 255, 255], 0.25);
context.fillStyle = rgba(glow);
```

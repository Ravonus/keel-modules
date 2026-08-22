# sprite-sheet

Sprite sheet helpers built on source rectangles: split an equal-cell sheet into a row-major grid, read named frames from a JSON atlas (both nested `frame` objects and flat entries, `w`/`h` or `width`/`height`), and draw a frame with image smoothing disabled for crisp pixels.

## Injected dependencies

- `context` for `drawFrame`: any object with `imageSmoothingEnabled` and the nine-argument `drawImage`, so canvas and offscreen 2D contexts both work
- `image: CanvasImageSource`, typically an `ImageBitmap`

## Usage

```ts
import { drawFrame, equalCells } from "./src/index.ts";

const frames = equalCells(sheet.width, sheet.height, { columns: 8, rows: 2 });
const frame = frames[tick % frames.length];
if (frame) drawFrame(context, sheet, frame, { x: 0, y: 0, width: 64, height: 64 });
```

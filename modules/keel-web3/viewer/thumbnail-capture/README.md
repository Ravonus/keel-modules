# thumbnail-capture

Helpers for exact Keel poster and motion capture markers. A thumbnail-aware Keel viewer injects the `__KEEL_THUMBNAIL__` runtime (`keel-thumbnail-capture@1`); these functions signal when the artwork is initializing, ready, or should be captured after a delay. Importing this module is optional for artworks, and every helper throws a clear error outside a capture-aware viewer.

## Injected dependencies

- The viewer-injected `globalThis.__KEEL_THUMBNAIL__` runtime; this is the one module whose environment arrives as an injected global rather than a parameter, matching the viewer protocol

## Usage

```ts
import thumbnail from "./src/index.ts";

thumbnail.snapshot(); // Capture now; typed without accessing runtime globals.

await thumbnail.afterInit(async () => {
  await loadAssets();
  startRenderLoop();
}, { delayMs: 500 });
```

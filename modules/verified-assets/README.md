# verified-assets

Dependency-injected asset loader. The host resolver supplies bytes it has already verified; this module only caches and decodes them as raw bytes, strict UTF-8 text, JSON, or an `ImageBitmap`. Each id is resolved at most once until cleared, because all views share one per-id promise cache.

## Injected dependencies

- `resolveResource: (id: string) => bytes | Promise<bytes>` where bytes is an `ArrayBuffer` or any array-like of numbers; the host performs verification before handing bytes over

## Usage

```ts
import { createVerifiedAssets } from "./src/index.ts";

const assets = createVerifiedAssets((id) => host.readVerified(id));
const settings = await assets.json("config.json");
const sheet = await assets.image("sprites.webp");
```

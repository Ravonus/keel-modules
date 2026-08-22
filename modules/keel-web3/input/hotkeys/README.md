# hotkeys

Scoped, removable keyboard-command map. Bindings use lowercase chord strings built from "mod" (meta or ctrl), "alt", "shift", and the key, joined by "+". Events inside form fields and editable content are ignored by default, and matched events are preventDefault-ed.

## Injected dependencies

- `target` with `addEventListener`/`removeEventListener` for "keydown"; defaults to `window`, and any DOM element also satisfies it

## Usage

```ts
import { createHotkeys } from "./src/index.ts";

const hotkeys = createHotkeys({
  "mod+s": () => save(),
  "escape": () => closeOverlay(),
});
// when the document unmounts:
hotkeys.destroy();
```

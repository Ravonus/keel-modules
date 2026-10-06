# flash-edition

Deterministic edition traits for a Keel-hosted ActionScript 3 artwork. The
same canonical token seed and token id always produce the same palette,
movement, bend, length, and gravity values. The module intentionally receives
the separately committed `seeded-random` module, so the global random stream
is not copied or silently replaced by a local hash implementation.

## Usage

```ts
import { createSeededRandom, randomInt } from "@keel/seeded-random";
import { deriveFlashEdition, deriveTokenSeed } from "./src/index.ts";

const collectionRootSeed = "0x957fae940b0a63c139b65a7c75adc164391dd6a68053c7e37344595f7afc7620";
const tokenSeed = deriveTokenSeed(collectionRootSeed, 7, { createSeededRandom, randomInt });
const traits = deriveFlashEdition(tokenSeed, 7, { createSeededRandom, randomInt });
// traits.seedHex is the canonical seed passed to GhostCircuit.swf.
```

Production viewers should use `derivedTokenSeed` returned by KeelSeedRegistry;
`deriveTokenSeed` is a bounded local-preview fallback only. This module does
not claim future-block or VRF fairness. The mint contract and Keel receipts
remain authoritative.

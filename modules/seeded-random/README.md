# seeded-random

Deterministic xoshiro128** random helpers for replayable browser art. A 64-character hex seed (a token hash, for example) is folded into four state words; the resulting generator produces the same sequence everywhere, and `randomInt` draws uniform integers from an inclusive range.

## Injected dependencies

None. The generator itself is injected into consumers: `randomInt` takes any `() => number` producing values in [0, 1).

## Usage

```ts
import { createSeededRandom, randomInt } from "./src/index.ts";

const random = createSeededRandom(tokenSeedHex);
const shade = randomInt(random, 0, 255);
const jitter = random() * 2 - 1;
```

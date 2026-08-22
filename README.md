# KEEL modules

Community library of small, dependency-injected JavaScript modules that ship on chain with KEEL builds.

## The model in plain words

On-chain bytes are expensive, so what a KEEL artwork actually stores is minified. Minified code is not auditable, so this repository holds the other half of the contract: the VERIFIED readable source.

- Authors write strict, clean, pretty TypeScript here. That is the portion people read and review.
- The platform minifies it into the exact bytes committed on chain. Those bytes do not need to be readable.
- A `keel-source-receipt@1` links the two: it records the digest of the readable source, the digest of the minified output, and the digest of the deterministic build recipe that turns one into the other.
- CI reproduces the build. If a clean rebuild from the readable source does not produce the exact on-chain bytes, the receipt does not verify and the change does not merge.

So trust flows one way: you audit the pretty source, the receipt and the reproducible build guarantee the ugly bytes are that same program.

## Layout

```
modules/<id>/
  src/index.ts        the verified readable source, strict TypeScript
  keel.module.json    manifest (keel.jsmodule@1): id, entry, license, summary
  README.md           what it does, injected dependencies, usage
  tsconfig.json       extends the shared strict base
template/             starter for new modules; copy it to modules/<id>/
catalog/              generated keel-module-resolver-catalog@1 snapshots
tsconfig.base.json    the one strict compiler config every module extends
```

`catalog/` is generated output, not hand-edited: the resolver tooling writes `keel-module-resolver-catalog@1` snapshots there so hosts and viewers can map module ids to their receipts and on-chain locations without walking the tree.

## Adding a module

1. Copy `template/` to `modules/<your-id>/` and follow its README.
2. Keep the dependency-injection style: modules take their environment (audio contexts, event targets, GL contexts, resolvers) as parameters and never touch globals directly.
3. Typecheck locally: `npx tsc -p modules/<your-id>/tsconfig.json`.
4. Run `keel module build` to minify and emit the hash receipt, then open a pull request. CI typechecks every module and reproduces your build before merge.

## The eleven starter modules

| Module | Summary |
| --- | --- |
| audio-envelope | Oscillator and ADSR envelope primitives for Web Audio |
| frame-clock | Fixed-timestep animation clock with bounded catch-up |
| hotkeys | Scoped, removable keyboard-command map |
| noise2d | Seeded 2D value noise with fractal octaves |
| orbit-camera | Orbit-camera position and perspective matrix math |
| palette | Hex palette parsing, mixing, and wraparound selection |
| seeded-random | Deterministic xoshiro128** helpers for replayable art |
| shader-uniforms | WebGL uniform discovery and strict typed updates |
| sprite-sheet | Equal-cell and JSON-atlas sprite helpers |
| thumbnail-capture | Poster and motion capture markers for Keel viewers |
| verified-assets | Cached decoding views over host-verified bytes |

All modules are MIT licensed.

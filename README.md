# KEEL modules

Community library of small, dependency-injected JavaScript modules that ship on chain with KEEL builds.

## The model in plain words

On-chain bytes are expensive, so what a KEEL artwork actually stores is minified. Minified code is not auditable, so this repository holds the other half of the contract: the VERIFIED readable source.

- Authors write strict, clean, pretty TypeScript here. That is the portion people read and review.
- The platform minifies it into the exact bytes committed on chain. Those bytes do not need to be readable.
- A `keel-source-receipt@1` links the two: it records the digest of the readable source, the digest of the minified output, and the digest of the deterministic build recipe that turns one into the other.
- CI reproduces the build. If a clean rebuild from the readable source does not produce the exact on-chain bytes, the receipt does not verify and the change does not merge.

So trust flows one way: you audit the pretty source, the receipt and the reproducible build guarantee the ugly bytes are that same program.

## Open source

This repository is the open, auditable half of every published KEEL module: the verified readable sources live here, and they are exactly what the on-chain hash receipts bind to. Anyone can read this code, reproduce the deterministic build, and confirm that the minified bytes stored on chain are the same program. Everything here is MIT licensed (see LICENSE); each module's `keel.module.json` restates the license per module.

## Layout

```
modules/<publisher>/publisher.json   a person or an org, its people and groups (keel.publisher@1)
modules/<publisher>/<category>/<id>/
  src/index.ts        the verified readable source, strict TypeScript
  keel.module.json    manifest (keel.jsmodule@2): id, entry, license, summary,
                      category, owner (a user, or an org/group/member), repository
  README.md           what it does, injected dependencies, usage
  tsconfig.json       extends the shared strict base
  test/vectors.mjs    deterministic test vectors run against readable and minified builds
  deployments/<chainId>.json   published revisions, if any (keel.jsmodule-deployment@1)
template/             starter for new modules
catalog/catalog.json  generated keel-module-catalog@3: publishers plus every module
scripts/run-vectors.mjs  runs every module's vectors against its readable source
eslint.config.js     one strict, type-aware lint config for every module
tsconfig.base.json    the one strict compiler config every module extends
```

### Two axes, deliberately separate

`category` is what a module IS, and it is the directory the module lives in:
`audio`, `generative`, `input`, `render`, `timing`, `viewer`. Filing a module
somewhere else is a `git mv` plus one manifest field.

`owner` is who is responsible for it, and it is a path into a publisher
manifest. A publisher is a **person** or an **organisation**: nobody has to
invent an org to publish a module, so `{ "user": "handle" }` owns its modules
directly and has no groups. An org additionally supports
`org > group > modules` and `org > group > member > modules`.

A graphics team can own a module filed under `viewer` without either fact being
bent to fit the other.

### Verified is not deployed

A module is VERIFIED the moment its readable source is proven to rebuild into
its exact minified bytes. That happens on a laptop, before any chain is
involved, and it stays true whether the module is ever published or not.

Deployment is a separate fact with a separate record. `deployments/<chainId>.json`
lists every published revision, each pinning the KeelHold instance and the
object id it lives in, plus the `outputDigest` that ties the revision back to
the bytes a receipt verified:

```json
{
  "schema": "keel.jsmodule-deployment@1",
  "module": "noise2d",
  "chainId": 11155111,
  "revisions": [
    {
      "version": "0.1.0",
      "outputDigest": "0x...",
      "receiptDigest": "0x...",
      "hold": { "address": "0x...", "objectId": "0x..." },
      "block": "1234",
      "txHash": "0x...",
      "publishedAt": "2026-01-01T00:00:00.000Z",
      "status": "current"
    }
  ]
}
```

No `deployments/` directory means the module has not been published yet, which
is a normal state for a fully verified module and is exactly how every module
here starts. Nothing infers one axis from the other, in this repo or on the
site.

The catalog is generated from committed files only, with nothing read from a
clock or a file mtime, so re-running `keel module index` on a clean checkout is
a no-op diff and anyone can check the published catalog by regenerating it and
running `diff`.

`catalog/` is generated output, not hand-edited: `keel module index` writes a `keel-module-catalog@3` document there so hosts, viewers, and the site can map module ids to their publishers, receipts, and on-chain locations without walking the tree.

The rules above are house rules for THIS repository. They are not imposed on
anyone registering a module that lives in their own repository: see
[CONTRIBUTING.md](CONTRIBUTING.md), which spells out the very short list of
things a verification can honestly demand of somebody else's code.

## Adding a module

1. Copy `template/` to `modules/<publisher>/<category>/<your-id>/` and follow its README.
2. Keep the dependency-injection style: modules take their environment (audio contexts, event targets, GL contexts, resolvers) as parameters and never touch globals directly.
3. Check locally: `pnpm lint`, `pnpm typecheck`, and `pnpm vectors` must all pass.
4. Add `test/vectors.mjs`: a default-exported array of `{ name, run(moduleExports), expect }` cases. They are dependency-free ESM, run deterministically in plain Node, and `keel module test` executes them against both the readable and the minified build.
5. Run `keel module build` to minify and emit the hash receipt, then open a pull request. CI lints, typechecks, and runs every module's vectors, and reproduces your build before merge.

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

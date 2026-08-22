# Module template

Copy this directory to `modules/<your-module-id>/` and replace the placeholders. This is the strict-TypeScript starter for contributing an on-chain KEEL JavaScript module.

## The contribution flow

1. Write pretty, strict TypeScript in `src/index.ts`. This is the VERIFIED readable portion: precise types, no `any`, dependency-injected environment, TSDoc on every export. Readers audit this file, not the on-chain bytes.
2. Fill in `keel.module.json` with your module id and a one-line summary, and describe the module in `README.md`: what it does, which dependencies are injected, one usage snippet.
3. Run `keel module build`. It minifies your source into the exact bytes that go on chain and emits a `keel-source-receipt@1` that hash-links your readable source, the minified output, and the deterministic build recipe.
4. Open a pull request. CI typechecks your module with the shared strict `tsconfig.base.json` and reproduces your build, so the receipt's digests must match a clean rebuild before merge.

## Rules of the house

- The tsconfig extends the repository base: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, es2022. Do not loosen it.
- Take your environment as parameters. A module never touches globals directly; the caller injects contexts, targets, and resolvers.
- Preserve determinism where it matters: same inputs, same outputs, on every machine.
- MIT license, one entry point at `src/index.ts`.

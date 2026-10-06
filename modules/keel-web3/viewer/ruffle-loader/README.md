# ruffle-loader

Loads the pinned Ruffle self-hosted runtime from verified Keel resources. The
main script, split core chunks, and the extensions-enabled Ruffle WASM are
resolved by the caller's `content.url` function; no CDN, package fallback, or
ambient network is used. The MVP/vanilla WASM is optional: a host can provide a
hash-checked local `fallbackWasmUrl` when the browser lacks Ruffle's five WASM
extensions. The loader maps Ruffle's relative chunk/WASM requests back to
already-verified resource URLs, which lets a small Keel verification shell keep
the large WASM objects outside its JSON envelope.

## Usage

```ts
const loader = createRuffleLoader({
  window,
  document,
  content: { url: (id) => verifiedContent.url(id) },
  assets: {
    main: "ruffle-main",
    modernCore: "ruffle-core-modern",
    legacyCore: "ruffle-core-legacy",
    legacyWasm: "ruffle-wasm-legacy",
  },
});
const ruffle = await loader.load();
```

`publicPath` is a private `keel://` namespace. It is intercepted only for the
committed Ruffle filenames and therefore cannot become a general network
escape hatch. `supportsRuffleWasmExtensions()` uses the same feature probes as
Ruffle's own loader; it never fetches or instantiates unverified bytes.

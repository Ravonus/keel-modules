import assert from "node:assert/strict";

/** Injected DOM fixtures: no browser, RPC, network or Ruffle binary is involved. */
async function withHost(run, { locked = false, appendError } = {}) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "HTMLScriptElement");
  class Script { src = ""; }
  globalThis.HTMLScriptElement = Script;
  const scripts = [], requests = [];
  const api = { newest: () => ({ createPlayer() {} }) };
  const window = { fetch: async (input) => { requests.push(input); return "verified gateway"; } };
  const document = {
    createElement: () => new Script(),
    head: { appendChild(script) { scripts.push(script); if (appendError) throw appendError; return script; } },
  };
  if (locked) {
    Object.defineProperty(window, "fetch", { writable: false });
    Object.defineProperty(document.head, "appendChild", { writable: false });
  }
  const assets = { main: "main", modernCore: "modern", legacyCore: "legacy", legacyWasm: "wasm" };
  const options = { window, document, assets, content: { url: id => `blob:verified-${id}` } };
  try { return await run({ window, document, assets, options, scripts, requests, api }); }
  finally {
    if (saved) Object.defineProperty(globalThis, "HTMLScriptElement", saved);
    else delete globalThis.HTMLScriptElement;
  }
}

export default [
  {
    name: "module exports a loader factory",
    run: ({ createRuffleLoader }) => typeof createRuffleLoader,
    expect: "function",
  },
  {
    name: "module exports Ruffle extension capability detection",
    run: ({ supportsRuffleWasmExtensions }) => typeof supportsRuffleWasmExtensions,
    expect: "function",
  },
  {
    name: "load is one-shot and split requests keep their verified resource bindings",
    run: ({ createRuffleLoader }) => withHost(async ({ options, window, scripts, requests, api }) => {
      const loader = createRuffleLoader({ ...options, autoplay: "on", unmuteOverlay: "hidden", fallbackWasmUrl: "blob:local-fallback" });
      const first = loader.load();
      assert.equal(loader.load(), first);
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].src, "blob:verified-main");
      assert.deepEqual(window.RufflePlayer.config, { publicPath: "keel://ruffle/", autoplay: "on", unmuteOverlay: "hidden" });
      window.RufflePlayer = api;
      scripts[0].onload();
      assert.equal(await first, api);
      await window.fetch("keel://ruffle/core.ruffle.5e30dc5777a75720eae2.js");
      await window.fetch(new URL("keel://ruffle/6ce4f603a1fe7cc88438.wasm"));
      await window.fetch("keel://ruffle/a71cef02d58dcec6f55f.wasm");
      assert.deepEqual(requests, ["blob:verified-modern", "blob:verified-wasm", "blob:local-fallback"]);
      loader.dispose();
      loader.dispose();
      await assert.rejects(loader.load(), /disposed/);
      assert.equal(scripts.length, 1);
      return true;
    }),
    expect: true,
  },
  {
    name: "locked host gateways remain intact while the main verified resource loads",
    run: ({ createRuffleLoader }) => withHost(async ({ options, window, document, scripts, api }) => {
      const originalFetch = window.fetch, originalAppend = document.head.appendChild;
      const loader = createRuffleLoader(options);
      const pending = loader.load();
      window.RufflePlayer = api;
      scripts[0].onload();
      assert.equal(await pending, api);
      loader.dispose();
      assert.equal(window.fetch, originalFetch);
      assert.equal(document.head.appendChild, originalAppend);
      return true;
    }, { locked: true }),
    expect: true,
  },
  {
    name: "invalid API and script errors reject without a duplicate load",
    run: async ({ createRuffleLoader }) => {
      for (const fail of ["api", "script"]) await withHost(async ({ options, window, scripts }) => {
        const loader = createRuffleLoader(options);
        const pending = loader.load();
        if (fail === "api") { window.RufflePlayer = { newest: "invalid" }; scripts[0].onload(); }
        else scripts[0].onerror();
        await assert.rejects(pending, fail === "api" ? /newest/ : /failed to load/);
        assert.equal(loader.load(), pending);
        assert.equal(scripts.length, 1);
        loader.dispose();
      });
      return true;
    },
    expect: true,
  },
  {
    name: "a non-Error host exception becomes an Error without leaving a second request",
    run: ({ createRuffleLoader }) => withHost(async ({ options, scripts }) => {
      const loader = createRuffleLoader(options);
      const pending = loader.load();
      await assert.rejects(pending, error => error instanceof Error && error.message === "host refused");
      assert.equal(loader.load(), pending);
      assert.equal(scripts.length, 1);
      loader.dispose();
      return true;
    }, { appendError: "host refused" }),
    expect: true,
  },
  {
    name: "inline resources retain exact bytes, default MIME and a single owned blob",
    run: ({ createRuffleLoader }) => withHost(async ({ options, scripts, window, api }) => {
      const data = "data:;base64,ZXhwb3J0IGNvbnN0IHggPSAxOw==";
      const loader = createRuffleLoader({ ...options, content: { url: () => data } });
      const pending = loader.load();
      const url = scripts[0].src;
      const response = await fetch(url);
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.equal(await response.text(), "export const x = 1;");
      const core = new globalThis.HTMLScriptElement();
      core.src = "keel://ruffle/core.ruffle.15317142e75ce021ac04.js";
      options.document.head.appendChild(core);
      assert.equal(core.src, url);
      window.RufflePlayer = api;
      scripts[0].onload();
      await pending;
      loader.dispose();
      await assert.rejects(fetch(url));
      return true;
    }),
    expect: true,
  },
  {
    name: "missing verified resources and external fallback URLs stop before loading",
    run: ({ createRuffleLoader }) => withHost(async ({ options, scripts, requests }) => {
      assert.throws(() => createRuffleLoader({ ...options, content: { url: () => null } }), /Missing verified/);
      assert.throws(() => createRuffleLoader({ ...options, fallbackWasmUrl: "https://unapproved.invalid/runtime.wasm" }), /local blob or data/);
      assert.deepEqual(scripts, []);
      assert.deepEqual(requests, []);
      return true;
    }),
    expect: true,
  },
];

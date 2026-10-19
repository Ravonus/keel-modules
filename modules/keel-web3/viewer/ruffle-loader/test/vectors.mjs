/** Static vectors for the resource-name contract; runtime DOM is host-injected. */
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
];

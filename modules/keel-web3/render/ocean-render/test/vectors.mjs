/** Test vectors for ocean-render: it only draws, so these hold what can be checked off a GPU. */
export default [
  {
    name: "the module exposes its two entry points",
    run: ({ createOcean, createSwarm }) => [typeof createOcean, typeof createSwarm],
    expect: ["function", "function"],
  },
];

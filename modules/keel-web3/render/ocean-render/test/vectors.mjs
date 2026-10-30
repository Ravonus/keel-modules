/** Test vectors for ocean-render: it only draws, so these hold what can be checked off a GPU. */
export default [
  {
    name: "the module exposes its two entry points",
    run: ({ createOcean, createSwarm }) => [typeof createOcean, typeof createSwarm],
    expect: ["function", "function"],
  },
  {
    name: "water pushes the wet line up at once",
    run: ({ wetLineAfter }) => wetLineAfter(0.5, 1.2, 0.1, 100),
    expect: 1.2,
  },
  {
    name: "the wet line falls slowly once the water leaves, and no lower than the water",
    run: ({ wetLineAfter }) => [wetLineAfter(2, 0.5, 50, 100), wetLineAfter(2, 0.5, 900, 100)],
    expect: [1.5, 0.5],
  },
  {
    name: "going back in time starts the wet line over",
    run: ({ wetLineAfter }) => wetLineAfter(2, 0.5, -3, 100),
    expect: 0.5,
  },
];

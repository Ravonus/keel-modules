/** Test vectors for ocean-render: it only draws, so these hold what can be checked off a GPU. */
export default [
  {
    name: "the module exposes its two entry points",
    run: ({ createOcean, createSwarm }) => [typeof createOcean, typeof createSwarm],
    expect: ["function", "function"],
  },
  {
    name: "world light by day comes from the sun, in linear colour",
    run: ({ lightFromWorld }) => {
      const body = (direction, color, intensity) => ({ direction, color, intensity });
      const light = lightFromWorld({ sun: body([0, 1, 0], "#ffffff", 3), moon: body([1, 0, 0], "#000000", 1), sky: { top: "#000000", horizon: "#ffffff" }, night: 0 });
      return [light.sun, light.sunColor, light.zenith, light.horizon];
    },
    expect: [[0, 1, 0], [3, 3, 3], [0, 0, 0], [1, 1, 1]],
  },
  {
    name: "world light by night comes from the moon, held above the horizon",
    run: ({ lightFromWorld }) => {
      const body = (direction, color, intensity) => ({ direction, color, intensity });
      const light = lightFromWorld({ sun: body([0, -1, 0], "#ffffff", 3), moon: body([1, -0.5, 0], "#ffffff", 0.5), sky: { top: "#000000", horizon: "#000000" }, night: 1 });
      return [light.sun, light.sunColor];
    },
    expect: [[1, 0.03, 0], [0.5, 0.5, 0.5]],
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

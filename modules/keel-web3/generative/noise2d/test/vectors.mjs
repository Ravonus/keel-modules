/** Deterministic test vectors for noise2d. Run by `keel module test`. */
export default [
  {
    name: "noise2d is deterministic at an off-lattice point",
    run: ({ noise2d }) => noise2d(1.5, 2.5, 7),
    expect: 0.42267227167030796,
  },
  {
    name: "noise2d lands exactly on the lattice hash at integers",
    run: ({ noise2d }) => noise2d(3, 4, 7),
    expect: 0.3507629670202732,
  },
  {
    name: "different seeds select different fields",
    run: ({ noise2d }) => noise2d(1.5, 2.5, 7) !== noise2d(1.5, 2.5, 8),
    expect: true,
  },
  {
    name: "fractalNoise2d sums octaves deterministically",
    run: ({ fractalNoise2d }) => fractalNoise2d(0.3, 0.7, { seed: 11 }),
    expect: 0.6315912031524579,
  },
  {
    name: "fractalNoise2d with zero octaves returns 0",
    run: ({ fractalNoise2d }) => fractalNoise2d(0.3, 0.7, { seed: 11, octaves: 0 }),
    expect: 0,
  },
  {
    name: "every sample stays in [0, 1)",
    run: ({ noise2d }) => {
      for (let index = 0; index < 64; index += 1) {
        const value = noise2d(index * 0.37, index * 0.61, 3);
        if (!(value >= 0 && value < 1)) return `out of range at ${index}`;
      }
      return true;
    },
    expect: true,
  },
];

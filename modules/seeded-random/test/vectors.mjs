/** Deterministic test vectors for seeded-random. Run by `keel module test`. */
export default [
  {
    name: "seedWords folds a short 0x seed into four words",
    run: ({ seedWords }) => seedWords("0xdeadbeef"),
    expect: [3735928559, 0, 0, 0],
  },
  {
    name: "createSeededRandom replays the same stream for the same seed",
    run: ({ createSeededRandom }) => {
      const first = createSeededRandom("0xdeadbeef");
      const second = createSeededRandom("0xdeadbeef");
      const stream = [first(), first(), first()];
      const replay = [second(), second(), second()];
      return stream.map((value, index) => (value === replay[index] ? value : NaN));
    },
    expect: [0, 0.7293700675945729, 0.7293700675945729],
  },
  {
    name: "an all-zero seed still produces a live stream",
    run: ({ createSeededRandom }) => {
      const random = createSeededRandom("0");
      const values = [random(), random(), random(), random()];
      return values.every((value) => value >= 0 && value < 1) && values.some((value) => value !== 0);
    },
    expect: true,
  },
  {
    name: "randomInt draws inside the inclusive bounds deterministically",
    run: ({ createSeededRandom, randomInt }) => {
      const random = createSeededRandom("0xdeadbeef");
      random(); random(); random();
      return [randomInt(random, 1, 6), randomInt(random, 1, 6), randomInt(random, -10, 10)];
    },
    expect: [2, 5, 6],
  },
  {
    name: "randomInt rejects an inverted range",
    run: ({ createSeededRandom, randomInt }) => {
      try {
        randomInt(createSeededRandom("1"), 5, 4);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];

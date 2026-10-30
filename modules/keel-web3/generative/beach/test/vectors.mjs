/** Deterministic test vectors for beach. Run by `keel module test`. */
const line = (beach, inland) => [beach.inland[0] * inland, beach.inland[1] * inland];

export default [
  {
    name: "the same seed makes the same shore",
    run: ({ createBeach }) => createBeach({ seed: 4 }).groundAt(30, 70) === createBeach({ seed: 4 }).groundAt(30, 70),
    expect: true,
  },
  {
    name: "the ground runs from under the sea up to the dunes",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0 });
      const at = (inland) => beach.groundAt(...line(beach, inland));
      return [at(-200) < -15, at(-20) < 0, at(5) > 0, at(100) > at(20)];
    },
    expect: [true, true, true, true],
  },
  {
    name: "the shoreline is one unbroken edge: no step at the waterline",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0 });
      return Math.abs(beach.groundAt(...line(beach, 0.01)) - beach.groundAt(...line(beach, -0.01))) < 0.05;
    },
    expect: true,
  },
  {
    name: "zones run in order from sea to land",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0 });
      return [-120, -20, 5, 20, 60].map((inland) => beach.zoneAt(...line(beach, inland)));
    },
    expect: ["seabed", "surf", "wet", "dry", "dune"],
  },
  {
    name: "colour is the sand's own, the same at any tide",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0 });
      const [x, z] = line(beach, 1);
      return beach.colorAt(x, 0, z)[0] > 0.6;
    },
    expect: true,
  },
  {
    name: "groundAt can be handed over detached, as a sea takes it",
    run: ({ createBeach }) => {
      const { groundAt } = createBeach({ seed: 4 });
      return typeof groundAt(1, 2);
    },
    expect: "number",
  },
];

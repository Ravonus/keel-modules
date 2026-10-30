/** Deterministic test vectors for beach. Run by `keel module test`. */
const line = (beach, inland) => [beach.inland[0] * inland, beach.inland[1] * inland];

export default [
  {
    name: "the same seed makes the same shore",
    run: ({ createBeach }) => createBeach({ seed: 4, kind: "cove" }).groundAt(30, 70) === createBeach({ seed: 4, kind: "cove" }).groundAt(30, 70),
    expect: true,
  },
  {
    name: "the ground runs from under the sea up to the dunes",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0, kind: "dunes", cliffs: 0, rocks: 0 });
      const at = (inland) => beach.groundAt(...line(beach, inland));
      return [at(-200) < -15, at(-20) < 0, at(5) > 0, at(100) > at(20)];
    },
    expect: [true, true, true, true],
  },
  {
    name: "the shoreline is one unbroken edge: no step at the waterline",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0, kind: "dunes", cliffs: 0, rocks: 0 });
      return Math.abs(beach.groundAt(...line(beach, 0.01)) - beach.groundAt(...line(beach, -0.01))) < 0.05;
    },
    expect: true,
  },
  {
    name: "zones run in order from sea to land",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0, kind: "dunes", cliffs: 0, rocks: 0 });
      return [-120, -20, 5, 20, 60].map((inland) => beach.zoneAt(...line(beach, inland)));
    },
    expect: ["seabed", "surf", "wet", "dry", "dune"],
  },
  {
    name: "colour is the sand's own, the same at any tide",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 4, bays: 0, kind: "dunes", cliffs: 0, rocks: 0 });
      const [x, z] = line(beach, 1);
      return beach.colorAt(x, 0, z)[0] > 0.6;
    },
    expect: true,
  },
  {
    name: "seeds pick different coasts, and a chosen kind holds",
    run: ({ createBeach }) => {
      const kinds = new Set(Array.from({ length: 30 }, (_, seed) => createBeach({ seed }).kind));
      const sands = new Set(Array.from({ length: 30 }, (_, seed) => createBeach({ seed }).sand));
      return [kinds.size > 2, sands.size > 2, createBeach({ seed: 1, kind: "cliffs", sand: "dark" }).kind];
    },
    expect: [true, true, "cliffs"],
  },
  {
    name: "a cliff coast stands far taller than a dune coast, and its ground is rock",
    run: ({ createBeach }) => {
      const tallest = (beach) => {
        let found = [0, 0, -Infinity];
        for (let x = -1500; x <= 1500; x += 30) for (const inland of [60, 90]) if (beach.groundAt(x, inland) > found[2]) found = [x, inland, beach.groundAt(x, inland)];
        return found;
      };
      const high = tallest(createBeach({ seed: 3, kind: "cliffs" }));
      const low = tallest(createBeach({ seed: 3, kind: "dunes", cliffs: 0 }));
      return [high[2] > 18, high[2] > low[2] * 1.5, createBeach({ seed: 3, kind: "cliffs" }).zoneAt(high[0], high[1]) === "cliff"];
    },
    expect: [true, true, true],
  },
  {
    name: "rocks stand on the ground, and the ground rises under them so waves feel them",
    run: ({ createBeach }) => {
      const beach = createBeach({ seed: 3, kind: "rocky" });
      const rocks = beach.rocksWithin(0, 0, 600);
      const big = rocks.reduce((a, b) => (b.radius > a.radius ? b : a));
      return [rocks.length > 10, beach.zoneAt(big.at[0], big.at[2]), beach.groundAt(big.at[0], big.at[2]) > big.at[1] + big.height * 0.5];
    },
    expect: [true, "rock", true],
  },
  {
    name: "no rocks asked for, none given",
    run: ({ createBeach }) => createBeach({ seed: 3, rocks: 0 }).rocksWithin(0, 0, 400).length,
    expect: 0,
  },
  {
    name: "steps fall a stride apart on alternate feet, either side of the path",
    run: ({ stepsAlong }) => {
      const prints = stepsAlong([[0, 0], [0, 3]], () => 1);
      return [prints.length, prints[0].foot, prints[1].foot, prints[0].x > 0 === prints[1].x < 0, Math.round(prints[1].z * 100), prints[0].y];
    },
    expect: [5, -1, 1, true, 72, 1],
  },
  {
    name: "trails stay on sand, and the same seed leaves the same steps",
    run: ({ createBeach }) => {
      const make = () => createBeach({ seed: 5, kind: "dunes", rocks: 0.2 });
      const beach = make();
      const prints = beach.trails(4);
      return [prints.length > 100, prints.every((print) => beach.takesPrints(print.x, print.z)), JSON.stringify(make().trails(4)) === JSON.stringify(prints)];
    },
    expect: [true, true, true],
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

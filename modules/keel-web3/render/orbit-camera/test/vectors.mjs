/** Deterministic test vectors for orbit-camera. Run by `keel module test`. */
const round = (value) => Math.round(value * 1e6) / 1e6;

export default [
  {
    name: "orbitPosition with defaults sits on the positive z axis",
    run: ({ orbitPosition }) => orbitPosition({}).map(round),
    expect: [0, 0, 5],
  },
  {
    name: "a quarter-turn yaw moves the eye to the positive x axis",
    run: ({ orbitPosition }) => orbitPosition({ yaw: Math.PI / 2, pitch: 0, distance: 2 }).map(round),
    expect: [2, 0, 0],
  },
  {
    name: "pitch is clamped just inside straight up",
    run: ({ orbitPosition }) => {
      const [, y] = orbitPosition({ pitch: Math.PI, distance: 1 });
      return round(y) === round(Math.sin(Math.PI / 2 - 0.001));
    },
    expect: true,
  },
  {
    name: "distance is clamped to at least 0.001",
    run: ({ orbitPosition }) => orbitPosition({ distance: -3 }).map(round),
    expect: [0, 0, 0.001],
  },
  {
    name: "perspectiveMatrix matches the golden column-major layout",
    run: ({ perspectiveMatrix }) => Array.from(perspectiveMatrix(Math.PI / 2, 1, 0.1, 100)).map(round),
    expect: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002002, -1, 0, 0, -0.2002, 0],
  },
  {
    name: "perspectiveMatrix rejects a non-positive aspect",
    run: ({ perspectiveMatrix }) => {
      try {
        perspectiveMatrix(Math.PI / 2, 0);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];

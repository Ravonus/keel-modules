/** Deterministic test vectors for tracks. Run by `keel module test`. */
const round = (value) => Math.round(value * 1e6) / 1e6;
const roundAll = (values) => values.map(round);

/** Section 06's three camera tracks, in the designer's shape (the `cam-in` pair on the first key). */
const CAMERA = [
  { target: "camera", property: "eye", keys: [[-0.49, [-1.06, 1.43, 2.1], [0.21, 0.61, 0.35, 1]], [2.13, [0, -0.52, 4.87]]] },
  { target: "camera", property: "target", keys: [[-0.49, [-0.43, 0.91, -1], [0.21, 0.61, 0.35, 1]], [2.13, [0, -0.75, 1]]] },
  { target: "camera", property: "roll", keys: [[-0.49, -0.1], [2.13, 0.22]] },
];

export default [
  {
    name: "the default ease is symmetric: half way along is half way up, a quarter is below linear",
    run: ({ ease, EASE }) => [round(ease(EASE, 0.5)), ease(EASE, 0.25) < 0.25, ease(EASE, 0.75) > 0.75],
    expect: [0.5, true, true],
  },
  {
    name: "linear handles are the identity",
    run: ({ ease }) => roundAll([0, 0.1, 0.3, 0.5, 0.9, 1].map((u) => ease([0, 0, 1, 1], u))),
    expect: [0, 0.1, 0.3, 0.5, 0.9, 1],
  },
  {
    name: "ease matches CSS ease-in-out (.42, 0, .58, 1) at a quarter and three quarters",
    run: ({ ease }) => roundAll([ease([0.42, 0, 0.58, 1], 0.25), ease([0.42, 0, 0.58, 1], 0.75)]),
    expect: [0.129162, 0.870838],
  },
  {
    name: "the cam-in pair (.21, .61)/(.35, 1) rises fast: golden values",
    run: ({ ease }) => roundAll([0.1, 0.25, 0.5, 0.75].map((u) => ease([0.21, 0.61, 0.35, 1], u))),
    expect: [0.281013, 0.606328, 0.877247, 0.976416],
  },
  {
    name: "ease clamps outside the segment",
    run: ({ ease, EASE }) => [ease(EASE, -1), ease(EASE, 2)],
    expect: [0, 1],
  },
  {
    name: "an overshooting pair leaves 0..1 and sampling follows it",
    run: ({ ease, sampleTrack }) => [ease([0.34, 1.56, 0.64, 1], 0.5) > 1, round(sampleTrack([[0, 0, [0.34, 1.56, 0.64, 1]], [1, 10]], 0.5)) > 10],
    expect: [true, true],
  },
  {
    name: "mix handles numbers, vectors and colours; differing kinds step at the end",
    run: ({ mix }) => [mix(2, 4, 0.25), roundAll(mix([0, 10, -2], [1, 0, 2], 0.5)), mix("#000000", "#ffffff", 0.5), mix(1, "#ff0000", 0.5), mix(1, "#ff0000", 1)],
    expect: [2.5, [0.5, 5, 0], "#808080", 1, "#ff0000"],
  },
  {
    name: "colour channels round and clamp, and short channels keep their zero",
    run: ({ mix }) => [mix("#102030", "#405060", 1 / 3), mix("#f0f0f0", "#ffffff", 2), mix("#000000", "#ffffff", -1)],
    expect: ["#203040", "#ffffff", "#000000"],
  },
  {
    name: "a track holds before its first key and after its last",
    run: ({ sampleTrack }) => [sampleTrack([[1, 5], [2, 7]], -3), sampleTrack([[1, 5], [2, 7]], 1), sampleTrack([[1, 5], [2, 7]], 2), sampleTrack([[1, 5], [2, 7]], 9)],
    expect: [5, 5, 7, 7],
  },
  {
    name: "one key is a constant everywhere",
    run: ({ sampleTrack }) => [sampleTrack([[0.39, 1]], -1), sampleTrack([[0.39, 1]], 0.39), sampleTrack([[0.39, 1]], 4)],
    expect: [1, 1, 1],
  },
  {
    name: "between keys the default ease applies; linear handles give the straight line",
    run: ({ sampleTrack }) => [sampleTrack([[0, 0], [2, 8]], 1), sampleTrack([[0, 0], [2, 8]], 0.5) < 2, round(sampleTrack([[0, 0, [0, 0, 1, 1]], [2, 8]], 0.5))],
    expect: [4, true, 2],
  },
  {
    name: "each key's handles shape only its own segment",
    run: ({ sampleTrack }) => {
      const keys = [[0, 0, [0, 0, 1, 1]], [1, 1, [1, 0, 1, 0]], [2, 2, [0, 0, 1, 1]]];
      return [round(sampleTrack(keys, 0.25)), sampleTrack(keys, 1.5) < 1.1, sampleTrack(keys, 2)];
    },
    expect: [0.25, true, 2],
  },
  {
    name: "a clip's progress is a number track: 0 before, eased across, 1 after (06's Scene.progress)",
    run: ({ sampleTrack }) => {
      const keys = [[-0.62, 0], [1.14, 1]];
      return [sampleTrack(keys, -1), round(sampleTrack(keys, 0.26)), sampleTrack(keys, 1.14), sampleTrack(keys, 3.44)];
    },
    expect: [0, 0.5, 1, 1],
  },
  {
    name: "a track with no key throws a RangeError",
    run: ({ sampleTrack }) => {
      try {
        sampleTrack([], 0);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
  {
    name: "sampleTracks groups by target and property: 06's camera at its first key, its last and past the end",
    run: ({ sampleTracks }) => [-0.49, 2.13, 3.44].map((position) => {
      const { camera } = sampleTracks(CAMERA, position);
      return [roundAll(camera.eye), roundAll(camera.target), round(camera.roll)];
    }),
    expect: [
      [[-1.06, 1.43, 2.1], [-0.43, 0.91, -1], -0.1],
      [[0, -0.52, 4.87], [0, -0.75, 1], 0.22],
      [[0, -0.52, 4.87], [0, -0.75, 1], 0.22],
    ],
  },
  {
    name: "06's camera half way along its move: golden values from the cam-in pair",
    run: ({ sampleTracks }) => {
      const { camera } = sampleTracks(CAMERA, 0.82);
      return [roundAll(camera.eye), roundAll(camera.target), round(camera.roll)];
    },
    expect: [[-0.130118, -0.280633, 4.529975], [-0.052784, -0.546231, 0.754495], 0.06],
  },
  {
    name: "time tracks sample at the clock and are left out without one",
    run: ({ sampleTracks }) => {
      const tracks = [
        { target: "motes", property: "opacity", keys: [[0, 0, [0, 0, 1, 1]], [2, 1]], drive: "time" },
        { target: "post", property: "bloom", keys: [[0.39, 1]] },
      ];
      return [sampleTracks(tracks, 5, 1), sampleTracks(tracks, 5)];
    },
    expect: [{ motes: { opacity: 0.5 }, post: { bloom: 1 } }, { post: { bloom: 1 } }],
  },
  {
    name: "a time track between its keys eases on the clock, not the position",
    run: ({ sampleTracks }) => {
      const tracks = [{ target: "motes", property: "opacity", keys: [[0, 0], [2, 1]], drive: "time" }];
      return [round(sampleTracks(tracks, 5, 0.5).motes.opacity), sampleTracks(tracks, 5, 1).motes.opacity];
    },
    expect: [0.105893, 0.5],
  },
  {
    name: "sampling is the same bytes on every call",
    run: ({ sampleTracks }) => {
      const a = JSON.stringify(sampleTracks(CAMERA, 1.2345));
      const b = JSON.stringify(sampleTracks(CAMERA, 1.2345));
      return a === b;
    },
    expect: true,
  },
];

/** Deterministic test vectors for brush: the stroke packing, the dab count and the grain, all exact. */
const throws = (fn) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

/** One stroke of each tip, in each medium. */
const STROKES = [
  { path: [[10, 10], [40, 12], [70, 30]], tip: "round", size: 4, colour: [0.8, 0.6, 0.5], opacity: 0.9, medium: "oil",
    load: 1, wet: 0.5, height: 0.3, taper: [0.5, 0.2], seed: 11 },
  { path: [[5, 60], [60, 64]], tip: "flat", size: 9, colour: [0.2, 0.3, 0.25], opacity: 1, medium: "oil", load: 0.4 },
  { path: [[20, 20], [30, 40], [35, 70], [36, 90]], tip: "filbert", size: 6, colour: [0.95, 0.85, 0.8], opacity: 0.4,
    medium: "glaze" },
  { path: [[80, 10], [82, 50]], tip: "rake", size: 7, colour: [1, 1, 1], opacity: 0.6, medium: "scumble", bristles: 5,
    wet: 2, seed: 4097 },
];

/** The mean step across a tile's wrap and between neighbours inside it. */
function wrapSteps(tile, size) {
  let [inside, edge] = [0, 0];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size - 1; x += 1) inside += Math.abs(tile[y * size + x] - tile[y * size + x + 1]);
    edge += Math.abs(tile[y * size + size - 1] - tile[y * size]);
  }
  return [edge / size, inside / (size * (size - 1))];
}

export default [
  {
    name: "a stroke list packs to the same floats on every engine: digest pinned",
    run: ({ packStrokes }) => {
      const batch = packStrokes(STROKES);
      return [batch.count, batch.data.length, batch.digest];
    },
    expect: [4, 128, "0ecf763fd51e4a63"],
  },
  {
    name: "a stroke's 32 floats: points (the last repeated), then colour, size, taper, load, wet, height, tip, medium",
    run: ({ packStrokes }) => [...packStrokes([STROKES[1]]).data].map((v) => +v.toFixed(4)),
    expect: [5, 60, 60, 64, 60, 64, 60, 64, 60, 64, 60, 64, 60, 64, 60, 64, 0.2, 0.3, 0.25, 1, 9, 1, 1, 0.4, 0, 0, 1, 7, 0,
      0, 2, 22],
  },
  {
    name: "dabs: one every 0.15 of the tip's width along the path, at least 2, at most 128",
    run: ({ dabsOf, pathLength }) => [
      pathLength([[0, 0], [3, 4], [3, 10]]),
      dabsOf([[0, 0], [30, 0]], 5),
      dabsOf([[0, 0], [1, 0]], 5),
      dabsOf([[0, 0], [5000, 0]], 2),
    ],
    expect: [11, 21, 2, 128],
  },
  {
    name: "a bad stroke throws: too few points, too many, no size",
    run: ({ packStrokes }) => [
      throws(() => packStrokes([{ ...STROKES[0], path: [[0, 0]] }])),
      throws(() => packStrokes([{ ...STROKES[0], path: Array.from({ length: 9 }, (_, i) => [i, i]) }])),
      throws(() => packStrokes([{ ...STROKES[0], size: 0 }])),
    ],
    expect: [
      "RangeError: brush: a path has 2 to 8 points, not 1.",
      "RangeError: brush: a path has 2 to 8 points, not 9.",
      "RangeError: brush: a stroke's size is above 0.",
    ],
  },
  {
    name: "the grain is exact: weave and noise tiles pinned for two seeds, and a seed changes them",
    run: ({ weaveTile, noiseTile, digestOf }) => {
      const d = (tile) => digestOf([Float32Array.from(tile)]);
      return [d(weaveTile(1)), d(weaveTile(2)), d(noiseTile(1)), d(noiseTile(2)), d(noiseTile(1, 64))];
    },
    expect: ["a4dc1fbb5888cf91", "df969ae1a8674de2", "715b06c34e41a0d7", "cfc6bbb6a149d0d5", "8c363bfa5d7e2f90"],
  },
  {
    name: "the noise grain tiles: the step across its wrap is no bigger than a step inside it, within half again",
    run: ({ noiseTile, GRAIN_SIZE }) => {
      const [edge, inside] = wrapSteps(noiseTile(3), GRAIN_SIZE);
      return edge <= 1.5 * inside;
    },
    expect: true,
  },
  {
    name: "a batch draws in medium runs, and in sub-batches as even as whole strokes allow",
    run: ({ packStrokes, mediumRuns, subBatches }) => [
      mediumRuns(packStrokes([STROKES[0], STROKES[1], STROKES[2], STROKES[3], STROKES[0]]).data, 0, 5),
      subBatches(10, 4),
      subBatches(2, 4),
    ],
    expect: [
      [[0, 2, 0], [2, 1, 1], [3, 1, 2], [4, 1, 0]],
      [[0, 2], [2, 5], [5, 7], [7, 10]],
      [[0, 1], [1, 2]],
    ],
  },
];

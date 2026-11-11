/** Deterministic test vectors for painterly. Run by `keel module test`. */

/** FNV-1a over bytes: a digest a vector can pin, in integer arithmetic only. */
const digest = (bytes) => {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
};

export default [
  {
    name: "unsafe settings fall back to the defaults and stay bounded, and the seed is made whole",
    run: ({ painterlySettings, DEFAULT_PAINTERLY_SETTINGS }) => {
      const wild = painterlySettings({ stroke: 40, direction: -1, strokes: "all", grain: 3, edge: null, grade: 2, exposure: -4, resolution: 0, seed: 7.9 });
      return [wild.stroke, wild.direction, wild.strokes, wild.grain, wild.edge, wild.grade, wild.exposure, wild.resolution, wild.seed,
        painterlySettings() === DEFAULT_PAINTERLY_SETTINGS, painterlySettings("loud") === DEFAULT_PAINTERLY_SETTINGS];
    },
    expect: [12, 0, 1, 1, 0.5, 1, 0, 0.25, 7, true, true],
  },
  {
    name: "a setting given overrides only itself; the two variants differ by strokes and direction alone",
    run: ({ painterlySettings, DEFAULT_PAINTERLY_SETTINGS, SMOOTH_SETTINGS, STROKED_SETTINGS }) => {
      const tuned = painterlySettings({ stroke: 8, grain: 0 });
      const differ = Object.keys(STROKED_SETTINGS).filter((key) => STROKED_SETTINGS[key] !== SMOOTH_SETTINGS[key]).sort();
      return [tuned.stroke, tuned.grain, tuned.grade === DEFAULT_PAINTERLY_SETTINGS.grade, differ, SMOOTH_SETTINGS.strokes, SMOOTH_SETTINGS.direction];
    },
    expect: [8, 0, true, ["direction", "strokes"], 0, 0],
  },
  {
    name: "the hash mixes every input, stays unsigned 32-bit and is the same every run",
    run: ({ hash32, unit }) => [
      hash32(0, 0, 0), hash32(1, 0, 0), hash32(0, 1, 0), hash32(0, 0, 1), hash32(3, 7, 11),
      hash32(-1, 2, 3) >= 0 && hash32(-1, 2, 3) <= 4294967295, hash32(3, 7, 11) === hash32(3, 7, 11),
      unit(0), unit(4294967295) < 1, unit(2147483648),
    ],
    expect: [3749358279, 3327323927, 3201354154, 4081519903, 2521248288, true, true, 0, true, 0.5],
  },
  {
    name: "the stroke tile is one stroke a cell, four bytes each, the same for a seed and different for another",
    run: ({ strokeTile, STROKE_CELLS }) => {
      const a = strokeTile(1);
      const b = strokeTile(1);
      const c = strokeTile(2);
      const small = strokeTile(5, 4);
      let same = 0;
      for (let i = 0; i < a.length; i += 1) if (a[i] === c[i]) same += 1;
      return [a.length, STROKE_CELLS, a.every((v, i) => v === b[i]), same < a.length / 64, small.length, digest(a), digest(c), digest(small)];
    },
    expect: [16384, 64, true, true, 64, 46653867, 1926138039, 1233929259],
  },
  {
    name: "the stroke tile's cells spread over their range: every channel uses low, middle and high values",
    run: ({ strokeTile }) => {
      const tile = strokeTile(9);
      const bins = [0, 0, 0, 0].map(() => [0, 0, 0]);
      for (let i = 0; i < tile.length; i += 1) bins[i % 4][Math.min(2, Math.floor(tile[i] / 86))] += 1;
      return bins.map((bin) => bin.every((count) => count > 1000));
    },
    expect: [true, true, true, true],
  },
  {
    name: "the canvas is a plain weave: periodic by the pitch, highest on the threads, hollow where they cross under",
    run: ({ grainTile, GRAIN_SIZE, GRAIN_PITCH }) => {
      const tile = grainTile(1);
      const at = (x, y) => tile[y * GRAIN_SIZE + x];
      const column = (x) => { let sum = 0; for (let y = 0; y < GRAIN_SIZE; y += 1) sum += at(x, y); return sum / GRAIN_SIZE; };
      // (Thread middles stand higher than the gaps between threads, column by column.)
      const middles = [];
      const gaps = [];
      for (let x = 0; x < GRAIN_SIZE; x += GRAIN_PITCH) { middles.push(column(x + GRAIN_PITCH / 2)); gaps.push(column(x)); }
      const mean = tile.reduce((sum, v) => sum + v, 0) / tile.length;
      let low = 255;
      let high = 0;
      for (const v of tile) { low = Math.min(low, v); high = Math.max(high, v); }
      return [tile.length, GRAIN_SIZE % GRAIN_PITCH, middles.every((m, i) => m > gaps[i]), mean > 140 && mean < 220, low < 40, high > 200,
        grainTile(1).every((v, i) => v === tile[i]), digest(tile), digest(grainTile(2)), digest(grainTile(3, 12, 4))];
    },
    expect: [65536, 4, true, true, true, true, true, 1994373922, 374776876, 1068603219],
  },
  {
    name: "the shaders carry what the pass sets: the tile and grain samplers, the brush, the form's share, the view",
    run: ({ TENSOR_GLSL, KUWAHARA_GLSL, STROKE_GLSL, GRADE_GLSL, PREP_GLSL }) => [
      TENSOR_GLSL.includes("uniform float uDirection") && TENSOR_GLSL.includes("formTensor") && TENSOR_GLSL.includes("curve"),
      KUWAHARA_GLSL.includes("uniform float uRadius") && KUWAHARA_GLSL.includes("float eighth("),
      ["sampler2D tTile", "sampler2D tPrep", "vec4 uCoarse", "vec4 uFine", "float uStrokes"].every((u) => STROKE_GLSL.includes(`uniform ${u}`)),
      GRADE_GLSL.includes("uniform sampler2D tGrain") && ["uGrain", "uEdge", "uGrade", "uView"].every((u) => GRADE_GLSL.includes(`uniform float ${u}`)),
      PREP_GLSL.includes("uniform float uExposure"),
    ],
    expect: [true, true, true, true, true],
  },
];

/** Deterministic test vectors for plate-painter. Run by `keel module test`. */
const round = (value) => Math.round(value * 1e6) / 1e6 + 0;

/** The farthest any leaf's box reaches across, in plate fractions. */
function leafReach(plan) {
  let reach = 0;
  for (let i = 0; i < plan.foliage.length; i += 16) {
    const [x, , len, wid, ax, ay, kind] = plan.foliage.slice(i, i + 7);
    if (kind === 4) reach = Math.max(reach, x * plan.aspect + Math.abs(ax) * len + Math.abs(ay) * wid);
  }
  return round(reach / plan.aspect);
}

/**
 * A WebGL2 context that only records: every constant is its own name, every object a fresh one, and each draw notes
 * the framebuffer bound at the time. The host has `HOST` bound.
 */
function recordingGl() {
  const HOST = { host: true };
  const log = { draws: [], created: 0, deleted: 0, bound: HOST };
  const calls = {
    getParameter: (name) => (name === "FRAMEBUFFER_BINDING" ? HOST : name === "VIEWPORT" ? [0, 0, 8, 8] : null),
    getProgramParameter: () => true,
    isEnabled: () => false,
    bindFramebuffer: (_, framebuffer) => { log.bound = framebuffer; },
    drawArrays: () => log.draws.push(log.bound),
    drawArraysInstanced: () => log.draws.push(log.bound),
    createTexture: () => { log.created += 1; return {}; },
    deleteTexture: () => { log.deleted += 1; },
  };
  const gl = new Proxy({}, {
    get: (_, key) => (typeof key === "string" && /^[A-Z0-9_]+$/u.test(key) ? key : calls[key] ?? (() => ({}))),
  });
  return { gl, log, HOST };
}

/** A keel-basis@1 file: "KMX2", the header's length (u32, big-endian), the header JSON, then the bodies. */
function basisFile(header, bodies) {
  const head = new TextEncoder().encode(JSON.stringify({ basis: "keel-basis@1", ...header }));
  const size = bodies.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(8 + head.length + size);
  out.set([75, 77, 88, 50]);
  new DataView(out.buffer).setUint32(4, head.length);
  out.set(head, 8);
  let at = 8 + head.length;
  for (const body of bodies) { out.set(body, at); at += body.length; }
  return out;
}

/** A 2 x 2 glaze over the given regions: warmer on the left, cooler on the right. */
const glaze = (regions) => ({ regions, width: 2, height: 2, gain: 0.25,
  values: Uint8Array.from([160, 128, 100, 100, 128, 160, 160, 128, 100, 100, 128, 160]) });

/** A basis with a palette (no body), a placed glaze, an unplaced field and some curve points. */
const SAMPLE_BASIS = basisFile({
  kind: "palette:2 residual:2x2 field:2x2 curves:1",
  params: { generator: "plate-painter", values: { "sky.top": "#5a7f90", hazeStep: 0.3 } },
  meta: { regions: { "residual.sky": ["sky"] } },
  layers: [
    { name: "palette", kind: "palette", colors: "102030a0b0c0", shares: [0.4, 0.6] },
    { name: "residual.sky", kind: "signed", width: 2, height: 2, channels: 3, space: "linear", gain: 0.25 },
    { name: "field", kind: "scalar", width: 2, height: 2, channels: 1, space: "linear", bits: 4 },
    { name: "curves", kind: "u16", count: 3 },
  ],
}, [glaze(["sky"]).values, new Uint8Array(2), new Uint8Array(6)]);

const throws = (fn) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

export default [
  {
    name: "a seed gives the same plan on every engine: three digests pinned",
    run: ({ planPlate, LAKE_VALLEY }) => [0, 7, 2026].map((seed) => planPlate(LAKE_VALLEY, { seed }).digest),
    expect: ["c45a214800b48566", "46b633a9c9880a8a", "85932eb40a1fb2e9"],
  },
  {
    name: "the same seed twice is the same plan; another seed is another",
    run: ({ planPlate, LAKE_VALLEY }) => {
      const a = planPlate(LAKE_VALLEY, { seed: 11 });
      const b = planPlate(LAKE_VALLEY, { seed: 11 });
      return [a.digest === b.digest, a.digest === planPlate(LAKE_VALLEY, { seed: 12 }).digest];
    },
    expect: [true, false],
  },
  {
    name: "crests: tapered off outside a range, summits where the recipe puts them",
    run: ({ planPlate, LAKE_VALLEY, RIDGE_SAMPLES }) => {
      const { ridges } = planPlate(LAKE_VALLEY, { seed: 0 });
      return [0, 1, 2].map((i) => [64, 230, 288, 400].map((k) => round(ridges[i * RIDGE_SAMPLES + k])));
    },
    expect: [
      [0.474, 0.474, 0.474, 0.348142],
      [0.479, 0.347793, 0.38878, 0.479],
      [0.485985, 0.50317, 0.481327, 0.485975],
    ],
  },
  {
    name: "the far ridges' summits sit within y 0.33..0.40, the near hills' lower",
    run: ({ planPlate, LAKE_VALLEY, RIDGE_SAMPLES }) => {
      const { ridges } = planPlate(LAKE_VALLEY, { seed: 0 });
      return [0, 1, 2].map((i) => round(Math.min(...ridges.slice(i * RIDGE_SAMPLES, (i + 1) * RIDGE_SAMPLES))));
    },
    expect: [0.338641, 0.346268, 0.433542],
  },
  {
    name: "dab counts: the middle distance with its reflections, and the near leaves",
    run: ({ planPlate, LAKE_VALLEY, STRIDE }) => {
      const plan = planPlate(LAKE_VALLEY, { seed: 0 });
      return [plan.scene.length / STRIDE, plan.foliage.length / STRIDE];
    },
    expect: [84, 222],
  },
  {
    name: "no leaf crosses the recipe's bound, whatever the seed",
    run: ({ planPlate, LAKE_VALLEY }) => [0, 7, 2026, 99999].map((seed) => leafReach(planPlate(LAKE_VALLEY, { seed })) <= 0.3),
    expect: [true, true, true, true],
  },
  {
    name: "settings: foliage off empties the leaves; haze and clouds change the digest",
    run: ({ planPlate, LAKE_VALLEY }) => {
      const base = planPlate(LAKE_VALLEY, { seed: 3 }).digest;
      return [
        planPlate(LAKE_VALLEY, { seed: 3, foliage: false }).foliage.length,
        planPlate(LAKE_VALLEY, { seed: 3, haze: 1.5 }).digest !== base,
        planPlate(LAKE_VALLEY, { seed: 3, clouds: 0.2 }).digest !== base,
      ];
    },
    expect: [0, true, true],
  },
  {
    name: "a recipe or setting out of range throws",
    run: ({ planPlate, LAKE_VALLEY }) => [
      throws(() => planPlate(LAKE_VALLEY, { seed: -1 })),
      throws(() => planPlate(LAKE_VALLEY, { seed: 1.5 })),
      throws(() => planPlate(LAKE_VALLEY, { haze: 3 })),
      throws(() => planPlate({ ...LAKE_VALLEY, ranges: [...LAKE_VALLEY.ranges, ...LAKE_VALLEY.ranges] })),
      throws(() => planPlate({ ...LAKE_VALLEY, haze: "blue" })),
    ],
    expect: [
      "RangeError: plate-painter: seed must be a whole number from 0.",
      "RangeError: plate-painter: seed must be a whole number from 0.",
      "RangeError: plate-painter: haze must be within 0..2.",
      "RangeError: plate-painter: at most 4 ranges.",
      'TypeError: plate-painter: "blue" is not #rrggbb.',
    ],
  },
  {
    name: "cover crops: a tall phone, a wide strip, a zoomed parallax shift held inside the plate",
    run: ({ coverCrop }) => [
      coverCrop(1.6, 780 / 1688, { focus: [0.3, 0.5] }),
      coverCrop(1.6, 2),
      coverCrop(1.6, 1.6, { zoom: 1.25, shift: [0.05, -1] }),
    ].map((crop) => crop.map(round)),
    expect: [[0.155598, 0, 0.288803, 1], [0, 0.1, 1, 0.8], [0.14, 0, 0.8, 0.8]],
  },
  {
    name: "paintBound: the last pass lands in the host's framebuffer, nothing is kept, the host's binding comes back",
    run: ({ createPlatePainter, planPlate, LAKE_VALLEY }) => {
      const { gl, log, HOST } = recordingGl();
      const painter = createPlatePainter(gl);
      painter.paintBound(planPlate(LAKE_VALLEY, { seed: 0 }), { width: 64, height: 40 });
      const bound = { draws: log.draws.length, last: log.draws.at(-1) === HOST, earlier: log.draws.slice(0, -1).some((f) => f === HOST) };
      const kept = log.created - log.deleted;
      painter.paint(planPlate(LAKE_VALLEY, { seed: 0 }), { width: 64, height: 40 });
      return [bound, kept, log.bound === HOST, log.draws.at(-1) === HOST, log.created - log.deleted];
    },
    expect: [{ draws: 5, last: true, earlier: false }, 0, true, false, 1],
  },
  {
    name: "a basis: no basis keeps the digest; glazes and fitted values change it, pinned",
    run: ({ planPlate, LAKE_VALLEY }) => {
      const plain = planPlate(LAKE_VALLEY, { seed: 0 }, {}).digest;
      const glazed = planPlate(LAKE_VALLEY, { seed: 0 }, { glazes: [glaze(["sky"]), glaze(["ground", "leaves"])] });
      const fitted = planPlate(LAKE_VALLEY, { seed: 0 }, { params: { "sky.top": "#5a7f90", "ranges.1.lit": "#80a0ad" } });
      return [plain, glazed.digest, glazed.glazes.length, fitted.digest, planPlate(LAKE_VALLEY, { seed: 0 }).glazes.length];
    },
    expect: ["c45a214800b48566", "2a6be84fcacf4ba2", 2, "72f0a7f238d76fec", 0],
  },
  {
    name: "readPlateBasis: a glaze from each placed signed layer, other layers skipped, the fitted values kept",
    run: ({ readPlateBasis, planPlate, LAKE_VALLEY }) => {
      const basis = readPlateBasis(SAMPLE_BASIS);
      const g = basis.glazes[0];
      return [basis.params, basis.glazes.length, g.regions, [g.width, g.height, g.gain], Array.from(g.values),
        planPlate(LAKE_VALLEY, { seed: 0 }, basis).uniforms.find(([name]) => name === "uHazeStep")[2][0] === Math.fround(0.3)];
    },
    expect: [{ "sky.top": "#5a7f90", hazeStep: 0.3 }, 1, ["sky"], [2, 2, 0.25],
      [160, 128, 100, 100, 128, 160, 160, 128, 100, 100, 128, 160], true],
  },
  {
    name: "bases, glazes and fitted values that cannot be painted throw",
    run: ({ readPlateBasis, planPlate, withParams, LAKE_VALLEY }) => [
      throws(() => readPlateBasis(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))),
      throws(() => readPlateBasis(basisFile({ basis: undefined, families: [] }, []))),
      throws(() => readPlateBasis(SAMPLE_BASIS.subarray(0, SAMPLE_BASIS.length - 1))),
      throws(() => readPlateBasis(Uint8Array.from([...SAMPLE_BASIS, 0]))),
      throws(() => planPlate(LAKE_VALLEY, {}, { glazes: [{ ...glaze(["sky"]), width: 3 }] })),
      throws(() => planPlate(LAKE_VALLEY, {}, { glazes: [glaze(["moon"])] })),
      throws(() => planPlate(LAKE_VALLEY, {}, { glazes: [1, 2, 3, 4, 5].map(() => glaze(["sky"])) })),
      throws(() => withParams(LAKE_VALLEY, { "sky.moon": "#000000" })),
      throws(() => withParams(LAKE_VALLEY, { "sky.top": 3 })),
    ],
    expect: [
      "TypeError: plate-painter: not a basis (KMX2) file.",
      "TypeError: plate-painter: the file is not a keel-basis@1 basis.",
      "RangeError: plate-painter: the basis layer curves runs past its bytes.",
      "RangeError: plate-painter: the basis has bytes past its last layer.",
      "RangeError: plate-painter: a glaze holds width x height x 3 bytes.",
      "RangeError: plate-painter: a glaze names regions of sky, ranges, shore, water, ground, leaves.",
      "RangeError: plate-painter: at most 4 glazes.",
      "RangeError: plate-painter: no recipe field sky.moon of that type.",
      "RangeError: plate-painter: no recipe field sky.top of that type.",
    ],
  },
  {
    name: "glazes: one texture each while the plate paints, all freed after",
    run: ({ createPlatePainter, planPlate, LAKE_VALLEY }) => {
      const { gl, log } = recordingGl();
      const painter = createPlatePainter(gl);
      painter.paintBound(planPlate(LAKE_VALLEY, { seed: 0 }), { width: 64, height: 40 });
      const plain = log.created;
      painter.paintBound(planPlate(LAKE_VALLEY, { seed: 0 }, { glazes: [glaze(["sky"]), glaze(["water"])] }),
        { width: 64, height: 40, regions: true });
      return [log.created - 2 * plain, log.created - log.deleted];
    },
    expect: [2, 0],
  },
];

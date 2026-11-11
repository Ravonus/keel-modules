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
];

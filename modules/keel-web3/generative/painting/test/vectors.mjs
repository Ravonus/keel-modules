/** Deterministic test vectors for painting: the plan (warp, frames, selections, strokes) is exact, so pinned. */
const throws = (fn) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

const W = 96;
const H = 64;
const IDS = ["none", "skin.face", "hair.back", "cloth.gown"];

/** A guide pass from a function of the pixel, its value in red. */
function pass(value) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      data[(y * W + x) * 4] = value(x, y);
      data[(y * W + x) * 4 + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** A small bust: an oval face, hair either side, a gown below; lit from the upper left; the face's outline. */
const face = (x, y) => ((x - 48) / 14) ** 2 + ((y - 24) / 16) ** 2;
const GUIDES = {
  ids: IDS,
  id: pass((x, y) => (y >= 44 ? 3 : face(x, y) <= 1 ? 1 : x >= 28 && x < 68 && y >= 6 ? 2 : 0)),
  light: pass((x, y) => Math.max(0, Math.min(255, 255 - 2 * x - y))),
  line: pass((x, y) => (Math.abs(face(x, y) - 1) < 0.12 ? 255 : 0)),
};

const RECIPE = {
  format: "keel-painting@1",
  seed: 7,
  palettes: { skin: ["#f6e3cc", "#deb491", "#a5735a", "#4d302a"], hair: ["#dc9a55", "#743a1a", "#2a1208"],
    velvet: ["#4a524e", "#1f2523", "#0b0e0d"] },
  warp: [{ anchor: "id:skin.face", scale: [1.1, 1.05], radius: 0.3 }, { pin: "id:cloth.gown", radius: 0.2 }],
  layers: [
    { name: "hair", select: { id: ["hair.*"], feather: 1, grow: 2 }, res: [96, 128], passes: [{ pass: "hair.locks" }] },
    { name: "gown", select: { id: ["cloth.gown"] }, res: [192, 48], passes: [{ pass: "velvet" }] },
    { name: "face", select: { id: ["skin.*"], feather: 1.5 }, res: [96, 112], passes: [
      { pass: "skin" },
      { pass: "glaze", colour: "#e7a089", opacity: 0.2 },
      { pass: "detail", colour: "ramp(skin, light, 4, -2)", threshold: 0.5 },
    ], blend: "normal" },
  ],
  ops: [{ op: "edge-bleed", px: 2, amount: 0.25 }, { op: "grade", lift: 0.01, warm: 0.03 }],
};

export default [
  {
    name: "a recipe and its guides give the same plan on every engine: digest and counts pinned",
    run: ({ planPainting, readRecipe }) => {
      const plan = planPainting(readRecipe(RECIPE), GUIDES);
      return [plan.digest, plan.strokes, plan.layers.map((l) => [l.name, [...l.box], l.steps.length])];
    },
    expect: ["5b15b91bb804ae56", 13933, [["hair", [19, -14, 58, 78], 6], ["gown", [-24, 36, 144, 36], 6],
      ["face", [26, -2, 45, 53], 7]]],
  },
  {
    name: "the digest moves with the seed, a warp, a palette entry and the guides",
    run: ({ planPainting, readRecipe }) => {
      const base = planPainting(readRecipe(RECIPE), GUIDES).digest;
      const moved = (recipe, guides = GUIDES) => planPainting(readRecipe(recipe), guides).digest !== base;
      return [
        planPainting(readRecipe(RECIPE), GUIDES).digest === base,
        moved({ ...RECIPE, seed: 8 }),
        moved({ ...RECIPE, warp: [] }),
        moved({ ...RECIPE, palettes: { ...RECIPE.palettes, skin: ["#f6e3cd", "#deb491", "#a5735a", "#4d302a"] } }),
        moved(RECIPE, { ...GUIDES, light: pass((x, y) => Math.max(0, 250 - 2 * x - y)) }),
      ];
    },
    expect: [true, true, true, true, true],
  },
  {
    name: "a ramp buckets the light into palette entries, lightest first; a shift darkens; flat colours read exactly",
    run: ({ colourRule, rampColour }) => {
      const rule = colourRule("ramp(p, light, 4)", { p: ["#ffffff", "#000000"] });
      const dark = colourRule("ramp(p, light, 4, -1)", { p: ["#ffffff", "#000000"] });
      const grey = (r) => +r[0][0].toFixed(4);
      return [[0, 0.3, 0.6, 1].map((v) => grey(rampColour(rule, v, 0))), grey(rampColour(dark, 1, 0)),
        colourRule("palette(p, 1)", { p: ["#ffffff", "#336699"] }).rgb.map((c) => Math.round(c * 255))];
    },
    expect: [[0, 0.3333, 0.6667, 1], 0.6667, [51, 102, 153]],
  },
  {
    name: "presets expand to plain passes, the layer's own fields on each",
    run: ({ expandPasses, PRESETS }) => [
      Object.keys(PRESETS),
      expandPasses([{ pass: "skin", jitter: 0.2 }]).map((p) => `${p.pass}:${p.brush ?? "-"}:${p.jitter}`),
      expandPasses([{ pass: "cloth", palette: "dress" }])[1].colour,
    ],
    expect: [["skin", "hair.locks", "cloth", "velvet"],
      ["under:-:0.2", "block-in:filbert:0.2", "form:filbert:0.2", "blend:filbert:0.2", "form:round:0.2"],
      "ramp(dress, light, 3)"],
  },
  {
    name: "the warp: a pin holds its handle, an anchor scales about its own, and the grid is pinned",
    run: ({ planWarp, warpPoint, idStats, handlePoint, digestOf }) => {
      const stats = idStats(GUIDES.id);
      const warp = planWarp(RECIPE.warp, IDS, stats, GUIDES.id);
      const pin = handlePoint("id:cloth.gown", IDS, stats, GUIDES.id);
      const held = warpPoint(warp, pin[0], pin[1]);
      return [digestOf([warp.grid]), handlePoint("id:skin.face.top", IDS, stats, GUIDES.id),
        Math.hypot(held[0] - pin[0], held[1] - pin[1]) < 0.05];
    },
    expect: ["4905cf68c478b621", [48, 8], true],
  },
  {
    name: "ID selections: a prefix with a star, and what to leave out",
    run: ({ idFlags }) => [
      [...idFlags(IDS, ["skin.*", "cloth.gown"], [])].slice(0, 4),
      [...idFlags(IDS, ["*"], ["hair.back"])].slice(0, 4),
    ],
    expect: [[0, 1, 0, 1], [0, 1, 0, 1]],
  },
  {
    name: "a spot keeps a pass to a disc of its ids: fewer strokes than the whole, the plan pinned",
    run: ({ planPainting, readRecipe }) => {
      const spot = { id: ["skin.*"], at: [0.5, 0.375], radius: 0.1 };
      const recipe = { ...RECIPE, layers: [{ ...RECIPE.layers[2], passes: [{ pass: "form", colour: "ramp(skin, light, 4)", select: spot }] }] };
      const plan = planPainting(readRecipe(recipe), GUIDES);
      const strokes = plan.layers[0].steps[0].strokes;
      const whole = planPainting(readRecipe({ ...recipe, layers: [{ ...recipe.layers[0],
        passes: [{ pass: "form", colour: "ramp(skin, light, 4)" }] }] }), GUIDES);
      return [strokes.length > 0, strokes.length < whole.layers[0].steps[0].strokes.length, plan.digest];
    },
    expect: [true, true, "7e9c35b8cabca590"],
  },
  {
    name: "render/guides' passes read as guides: table colours to indices, the line's alpha to red",
    run: ({ guidesOf }) => {
      const px = (rgba) => ({ width: 3, height: 1, data: Uint8Array.from(rgba) });
      const g = guidesOf({
        table: [{ id: 1, name: "cap", colour: [50, 94, 200] }, { id: 2, name: "skin", colour: [188, 200, 50] }],
        passes: { id: px([188, 200, 50, 255, 0, 0, 0, 0, 50, 94, 200, 255]), light: px([9, 9, 9, 255, 0, 0, 0, 0, 1, 1, 1, 255]),
          line: px([255, 0, 0, 255, 0, 40, 0, 40, 0, 0, 0, 0]) },
      });
      return [g.ids, [...g.id.data].filter((_, i) => i % 4 === 0), [...g.line.data].filter((_, i) => i % 4 === 0)];
    },
    expect: [["none", "cap", "skin"], [2, 0, 1], [255, 40, 0]],
  },
  {
    name: "a bad recipe throws with where and what",
    run: ({ readRecipe, planPainting, colourRule }) => [
      throws(() => readRecipe({ ...RECIPE, format: "keel-painting@2" })),
      throws(() => readRecipe({ ...RECIPE, seed: 1.5 })),
      throws(() => readRecipe({ ...RECIPE, layers: [] })),
      throws(() => colourRule("ramp(skin, depth, 4)", RECIPE.palettes)),
      throws(() => colourRule("#12345", RECIPE.palettes)),
      throws(() => readRecipe({ ...RECIPE, layers: [{ ...RECIPE.layers[0], select: { id: ["hair"], at: [0.5, 0.5] } }] })),
      throws(() => planPainting(readRecipe({ ...RECIPE, layers: [{ ...RECIPE.layers[0], select: { id: ["lip"] } }] }),
        GUIDES)),
    ],
    expect: [
      "TypeError: painting: the recipe is keel-painting@1.",
      "TypeError: painting: seed is an integer.",
      "TypeError: painting: layers is a list of layers.",
      "TypeError: painting: a ramp reads the light guide, not \"depth\".",
      "TypeError: painting: \"#12345\" is not #rrggbb.",
      "TypeError: painting: layers[0].select takes a spot as at [x, y] with a radius above 0.",
      "TypeError: painting: a layer selects no pixels of the guides.",
    ],
  },
];

/** Deterministic test vectors for quality. Run by `keel module test`. */
const shore = { under: false, depth: 0, height: 2, clearance: 3 };
const deep = { under: true, depth: 30, height: 0, clearance: 60 };

export default [
  {
    name: "spray is on the shore, not under the water, and switches off",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high" });
      const before = quality.at(shore).spray;
      const under = quality.at(deep).spray;
      quality.set({ spray: false });
      return [before, under, quality.at(shore).spray];
    },
    expect: [0.8 * (1 - 2 / 120), 0, 0],
  },
  {
    name: "auto takes its level from the device",
    run: ({ createQuality }) => ["low", "mid", "high"].map((tier) => createQuality({ tier }).level),
    expect: ["low", "medium", "high"],
  },
  {
    name: "a level named outranks the device",
    run: ({ createQuality }) => createQuality({ level: "ultra", tier: "low" }).level,
    expect: "ultra",
  },
  {
    name: "low traces nothing and ultra traces most",
    run: ({ createQuality }) => {
      const steps = (level) => createQuality({ level }).at(shore).reflectSteps;
      return [steps("low"), steps("ultra") > steps("high"), steps("high") > steps("medium")];
    },
    expect: [0, true, true],
  },
  {
    name: "above water spends nothing on shafts or snow",
    run: ({ createQuality }) => {
      const { shafts, snow } = createQuality({ level: "high" }).at(shore);
      return [shafts, snow];
    },
    expect: [0, 0],
  },
  {
    name: "the deep drops ground shadows and keeps its shafts",
    run: ({ createQuality }) => {
      const { shadowSteps, shafts } = createQuality({ level: "high" }).at(deep);
      return [shadowSteps, shafts];
    },
    expect: [0, 16],
  },
  {
    name: "tracing off costs no rays at all",
    run: ({ createQuality }) => {
      const { reflectSteps, shadowSteps, casters, traceNear } = createQuality({ level: "ultra", tracing: false }).at(shore);
      return [reflectSteps, shadowSteps, casters, traceNear];
    },
    expect: [0, 0, 0, 0],
  },
  {
    name: "switches work while running, and come back",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high" });
      quality.set({ tracing: false, upscale: false });
      const off = quality.at(shore);
      quality.set({ tracing: true, upscale: true });
      const on = quality.at(shore);
      return [off.reflectSteps, off.upscale, on.reflectSteps > 0, on.upscale];
    },
    expect: [0, false, true, true],
  },
  {
    name: "changing level takes that level's scale",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high" });
      quality.set({ level: "ultra" });
      return [quality.level, quality.scale];
    },
    expect: ["ultra", 1],
  },
  {
    name: "one slow frame changes nothing",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high" });
      quality.frame(200);
      return quality.scale;
    },
    expect: 0.8,
  },
  {
    name: "steady slow frames lower the scale, but never past its floor",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high", floor: 0.6 });
      for (let i = 0; i < 2000; i += 1) quality.frame(60);
      return Math.round(quality.scale * 100) / 100;
    },
    expect: 0.6,
  },
  {
    name: "fast frames win the scale back, up to the level's own",
    run: ({ createQuality }) => {
      const quality = createQuality({ level: "high" });
      for (let i = 0; i < 600; i += 1) quality.frame(60);
      for (let i = 0; i < 3000; i += 1) quality.frame(4);
      return Math.round(quality.scale * 100) / 100;
    },
    expect: 0.8,
  },
  {
    name: "the settings a level gives are what they were before the page levers came",
    run: ({ createQuality }) => ["low", "medium", "high", "ultra"].map((level) => createQuality({ level }).at({ under: false, depth: 0, height: 0, clearance: 3 })),
    expect: [
      { level: "low", renderScale: 0.85, upscale: false, reflectSteps: 0, shadowSteps: 0, traceFar: 0, traceNear: 0, casters: 0, shafts: 0, snow: 0, spray: 0.25 },
      { level: "medium", renderScale: 0.75, upscale: true, reflectSteps: 14, shadowSteps: 10, traceFar: 70, traceNear: 60, casters: 8, shafts: 0, snow: 0, spray: 0.5 },
      { level: "high", renderScale: 0.8, upscale: true, reflectSteps: 28, shadowSteps: 20, traceFar: 140, traceNear: 140, casters: 16, shafts: 0, snow: 0, spray: 0.8 },
      { level: "ultra", renderScale: 1, upscale: true, reflectSteps: 48, shadowSteps: 32, traceFar: 260, traceNear: 260, casters: 32, shafts: 0, snow: 0, spray: 1 },
    ],
  },
  {
    name: "each level has page levers: low drops bloom and TAA and halves the outgoing scene",
    run: ({ createQuality }) => ["low", "medium", "high", "ultra"].map((level) => createQuality({ level }).levers),
    expect: [
      { renderScale: 0.7, bloom: 0, motes: 0.25, blendScale: 0.5, taa: false, density: 0.5 },
      { renderScale: 0.75, bloom: 1, motes: 0.5, blendScale: 0.5, taa: true, density: 0.75 },
      { renderScale: 0.8, bloom: 1, motes: 0.8, blendScale: 0.75, taa: true, density: 1 },
      { renderScale: 1, bloom: 1, motes: 1, blendScale: 1, taa: true, density: 1 },
    ],
  },
  {
    name: "the levers' render scale follows the governor and the level",
    run: ({ createQuality, leversFor }) => {
      const quality = createQuality({ level: "high", floor: 0.6 });
      for (let i = 0; i < 2000; i += 1) quality.frame(60);
      const slow = Math.round(quality.levers.renderScale * 100) / 100;
      quality.set({ level: "low" });
      return [slow, quality.levers.renderScale, quality.levers.taa, leversFor("ultra", 0.9).renderScale];
    },
    expect: [0.6, 0.7, false, 0.9],
  },
];

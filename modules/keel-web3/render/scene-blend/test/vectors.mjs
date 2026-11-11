/** Deterministic test vectors for scene-blend. Run by `keel module test`. */

/** FNV-1a over bytes, as an unsigned 32-bit number. */
const fnv = (bytes) => {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
};

/** A keel/lit stand-in that records what is drawn where. */
function fakeLit(log) {
  let made = 0;
  const targets = [];
  const materials = [];
  class RenderTarget {
    constructor(w, h, options) { targets.push(this); this.name = `target${made++}`; this.options = options; this.texture = { name: `${this.name}.texture`, dispose() {} }; }
    setSize(w, h) { this.size = [w, h]; }
    dispose() { log.push(`dispose ${this.name}`); }
  }
  class DataTexture {
    constructor(data, w, h, format) { this.data = data; this.size = [w, h, format]; }
    dispose() { log.push("dispose noise"); }
  }
  class CustomMaterial {
    constructor(p) { materials.push(this); this.uniforms = p.uniforms; this.parameters = p; }
    dispose() { log.push("dispose material"); }
  }
  class Mesh { constructor(g, m) { this.material = m; } }
  class Stage { constructor() { this.name = "blend pass"; } add(o) { this.quad = o; } }
  class OrthoCamera {}
  return { targets, materials, RenderTarget, DataTexture, CustomMaterial, Mesh, Stage, OrthoCamera, plane: () => ({ dispose() { log.push("dispose plane"); } }) };
}

function fakeRenderer(log) {
  let target = null;
  return {
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; },
    render: (scene) => log.push(`${scene.name} -> ${target === null ? "canvas" : target.name}`),
  };
}

function fakeFinish(log, renderer) {
  let settings = { taa: true, bloom: 0.1 };
  return {
    get settings() { return settings; },
    setSettings(next) { settings = { ...next }; log.push(`taa ${settings.taa}`); return settings; },
    dress(root) { log.push(`dress ${root.name}`); },
    render(scene) { log.push(`finish ${scene.name} -> ${renderer.getRenderTarget()?.name ?? "canvas"}`); },
  };
}

const sceneA = { scene: { name: "A" }, camera: {} };
const sceneB = { scene: { name: "B" }, camera: {} };

export default [
  {
    name: "unsafe settings fall back to the defaults and stay bounded",
    run: ({ blendSettings, DEFAULT_BLEND_SETTINGS }) => {
      const wild = blendSettings({ seed: -4, lineColour: "white", seamColour: "#FFAA00", glow: 9, seam: -1, edge: 0, noiseScale: "big", pull: 2, lines: 3, soft: -1, scale: 0 });
      return [wild, blendSettings() === DEFAULT_BLEND_SETTINGS, blendSettings({ seed: 12.7 }).seed];
    },
    expect: [
      { seed: 0, lineColour: "#f7f7ee", lines: 1, edge: 0.01, soft: 0, seamColour: "#ffaa00", glow: 4, seam: 0, noiseScale: 0.6, pull: 1, scale: 0.25 },
      true,
      12,
    ],
  },
  {
    name: "the incoming's lines are full at 0, half at the switch, gone by 0.9; the outgoing's rise from 0.5 to 1",
    run: ({ blendLines }) => [0, 0.25, 0.5, 0.7, 0.9, 1, -2, 3].map((t) => blendLines(t).map((v) => Math.round(v * 1e9) / 1e9)),
    expect: [[1, 0], [0.75, 0], [0.5, 0], [0.25, 0.4], [0, 0.8], [0, 1], [1, 0], [0, 1]],
  },
  {
    name: "the fill starts at 0.25 and covers at 1; the switch is at 0.5",
    run: ({ blendFill, currentAt }) => [[0, 0.25, 0.625, 1].map(blendFill), [0.49, 0.5, 1].map(currentAt)],
    expect: [[0, 0, 0.5, 1], ["a", "b", "b"]],
  },
  {
    name: "a radial centre moves toward the pointer by the pull, and reaches the farthest corner",
    run: ({ radialCentre, farthestCorner }) => [
      radialCentre({ x: 0, y: 0 }, null, 0.1),
      radialCentre({ x: 0, y: 0 }, { x: 1, y: -1 }, 0.1).map((v) => Math.round(v * 1e9) / 1e9),
      Math.round(farthestCorner([0.5, 0.5], 1.6) * 1e9) / 1e9,
      farthestCorner([0, 0], 1),
    ],
    expect: [[0.5, 0.5], [0.55, 0.45], 0.943398113, Math.SQRT2],
  },
  {
    name: "the noise is the same bytes for a seed, spans the full range, tiles, and changes with the seed",
    run: ({ noiseTexels, NOISE_SIZE }) => {
      const a = noiseTexels(1);
      const r = (x, y) => a[(y * NOISE_SIZE + x) * 4];
      const channel = (c) => { let lo = 255, hi = 0; for (let i = c; i < a.length; i += 4) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return [lo, hi]; };
      let seamStep = 0;
      for (let y = 0; y < NOISE_SIZE; y += 1) seamStep = Math.max(seamStep, Math.abs(r(NOISE_SIZE - 1, y) - r(0, y)));
      return [a.length, fnv(a), fnv(noiseTexels(1)) === fnv(a), fnv(noiseTexels(2)) !== fnv(a), channel(0), channel(1), channel(3), seamStep < 40];
    },
    expect: [262144, 3446277849, true, true, [0, 255], [0, 255], [255, 255], true],
  },
  {
    name: "outside the overlap one scene goes straight to the host's target; inside, both through the finish (the less visible into the second target), then the pass",
    run: ({ createSceneBlend }) => {
      const log = [];
      const lit = fakeLit(log);
      const renderer = fakeRenderer(log);
      const blend = createSceneBlend(lit, renderer, fakeFinish(log, renderer));
      blend.setSize(720, 450, 2);
      const current = [blend.draw(sceneA, sceneB, 0), blend.draw(sceneA, sceneB, 0.3), blend.draw(sceneA, sceneB, 0.6), blend.draw(sceneA, sceneB, 1)];
      return [current, log];
    },
    expect: [
      ["a", "a", "b", "b"],
      [
        "finish A -> canvas",
        "taa false", "dress A", "dress B", "finish A -> target0", "finish B -> target1", "blend pass -> canvas",
        "finish A -> target1", "finish B -> target0", "blend pass -> canvas",
        "taa true", "finish B -> canvas",
      ],
    ],
  },
  {
    name: "a scaled finish draws the less visible scene into a target at the scale; without one the scale is not used",
    run: ({ createSceneBlend, minorAt }) => {
      const log = [];
      const lit = fakeLit(log);
      const renderer = fakeRenderer(log);
      const main = { render: (s) => log.push(`main ${s.name} -> ${renderer.getRenderTarget().name}`) };
      const sizes = [];
      const scaled = { render: (s) => log.push(`scaled ${s.name} -> ${renderer.getRenderTarget().name}`), setSize: (...a) => sizes.push(a) };
      const blend = createSceneBlend(lit, renderer, { main, scaled }, { scale: 0.5 });
      blend.setSize(1440, 900, 2);
      blend.draw(sceneA, sceneB, 0.2);
      blend.draw(sceneA, sceneB, 0.8);
      const u = lit.materials[0].uniforms;
      const texelA = u.uTexelA.value;
      blend.setSettings({ scale: 0.75 });
      const plainLit = fakeLit([]);
      createSceneBlend(plainLit, fakeRenderer([]), main, { scale: 0.5 }).setSize(1440, 900, 2);
      return [log, lit.targets.map((t) => t.size), sizes, texelA, minorAt(0.49), minorAt(0.5), plainLit.targets.map((t) => t.size)];
    },
    expect: [
      ["main A -> target0", "scaled B -> target1", "blend pass -> canvas", "scaled A -> target1", "main B -> target0", "blend pass -> canvas"],
      [[2880, 1800], [2160, 1350]],
      [[1440, 900, 1], [1440, 900, 1.5]],
      [1 / 1440, 1 / 900],
      "b", "a",
      [[2880, 1800], [2880, 1800]],
    ],
  },
  {
    name: "the pass gets the frame's values: mode, fill, lines, darken and a radial centre pulled to the pointer",
    run: ({ createSceneBlend }) => {
      const log = [];
      const lit = fakeLit(log);
      const blend = createSceneBlend(lit, fakeRenderer(log));
      blend.setSize(800, 400, 1);
      blend.draw(sceneA, sceneB, 0.625, { mode: "radial", centre: { x: 0.5, y: 0 }, pointer: { x: 1, y: 1 }, darken: 2, lines: { out: 0.3 } });
      const u = lit.materials[0].uniforms;
      const radial = ["uMode", "uFill", "uLinesIn", "uLinesOut", "uDarken", "uCentre", "uReach"].map((k) => u[k].value);
      blend.draw(sceneA, sceneB, 0.2, { mode: "fade" });
      const target = lit.targets[0];
      return [radial.flat().map((v) => Math.round(v * 1e9) / 1e9), u.uMode.value, u.uFill.value, target.size, target.options.depthBuffer, target.options.type];
    },
    expect: [[1, 0.5, 0.34375, 0.3, 1, 0.775, 0.55, Math.round(Math.sqrt(2.705) * 1e9) / 1e9], 2, 0.2, [800, 400], true, "half"],
  },
  {
    name: "every uniform the pass is given is declared in its shader, and a new seed swaps the noise",
    run: ({ createSceneBlend, BLEND_GLSL }) => {
      const log = [];
      const lit = fakeLit(log);
      const blend = createSceneBlend(lit, fakeRenderer(log), null, { seed: 3 });
      const names = Object.keys(lit.materials[0].uniforms);
      const first = lit.materials[0].uniforms.tNoise.value;
      blend.setSettings({ seed: 4 });
      const swapped = lit.materials[0].uniforms.tNoise.value !== first && log.includes("dispose noise");
      blend.setSettings({ seed: 4, glow: 2 });
      return [names.filter((n) => !new RegExp(`uniform \\w+ ${n};`, "u").test(BLEND_GLSL)), swapped, log.filter((l) => l === "dispose noise").length];
    },
    expect: [[], true, 1],
  },
];

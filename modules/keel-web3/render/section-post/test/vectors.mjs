/** Deterministic test vectors for section-post. Run by `keel module test`. */

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
    constructor(w, h, options) { targets.push(this); this.name = `target${made++}`; this.options = options; this.texture = { name: `${this.name}.texture` }; }
    setSize(w, h) { this.size = [w, h]; }
    dispose() { log.push(`dispose ${this.name}`); }
  }
  class DataTexture {
    constructor(data) { this.data = data; }
    dispose() { log.push("dispose noise"); }
  }
  class CustomMaterial {
    constructor(p) { materials.push(this); this.uniforms = p.uniforms; this.fragmentShader = p.fragmentShader; }
    dispose() {}
  }
  class Mesh { constructor(g, m) { this.material = m; } }
  class Stage { add(o) { this.name = o.material.fragmentShader === "BLUR" ? "blur" : "post"; } }
  class OrthoCamera {}
  return { targets, materials, RenderTarget, DataTexture, CustomMaterial, Mesh, Stage, OrthoCamera, plane: () => ({ dispose() {} }) };
}

function fakeRenderer(log) {
  let target = null;
  return {
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; },
    render: (scene) => log.push(`${scene.name} -> ${target === null ? "canvas" : target.name}`),
  };
}

const shaders = { BLUR_GLSL: "BLUR" };

export default [
  {
    name: "unsafe settings fall back to the defaults and stay bounded",
    run: ({ postSettings, DEFAULT_POST_SETTINGS }) => [
      postSettings({ seed: -1, colour: "cream", tear: 3, fibre: -1, paper: "x", grain: 1, noiseScale: 99, depth: "yes" }),
      postSettings() === DEFAULT_POST_SETTINGS,
    ],
    expect: [{ seed: 0, colour: "#f7f7ee", tear: 1, fibre: 0, paper: 0.4, grain: 0.2, noiseScale: 8, depth: false }, true],
  },
  {
    name: "a frame's values are bounded, and the settings stand in for the ones left out",
    run: ({ frameOf, postSettings }) => {
      const settings = postSettings({ colour: "#ff0000", tear: 0.5, grain: 0.01 });
      return [frameOf({}, settings), frameOf({ progress: 3, position: -4, colour: [0, 0.5, 1], tear: 1, darken: 0.4, blur: -1 }, settings)];
    },
    expect: [
      { progress: 0, position: 0, colour: [1, 0, 0], tear: 0.5, fibre: 0.5, grain: 0.01, darken: 0, blur: 0 },
      { progress: 2, position: -1, colour: [0, 0.5, 1], tear: 1, fibre: 0.5, grain: 0.01, darken: 0.4, blur: 0 },
    ],
  },
  {
    name: "the panel shows while present and on screen, a torn edge reaching past a straight one",
    run: ({ frameOf, panelShows, postSettings }) => {
      const s = postSettings();
      const shows = (values) => panelShows(frameOf(values, s));
      return [
        shows({ progress: 0, position: 0 }), shows({ progress: 0.5, position: 0 }), shows({ progress: 2, position: 0 }),
        shows({ progress: 1, position: -1 }), shows({ progress: 1, position: -1, tear: 1 }), shows({ progress: 1, position: 0.99 }),
      ];
    },
    expect: [false, true, false, false, true, true],
  },
  {
    name: "the blur's step scales with the frame's height, so its reach is a share of the frame",
    run: ({ blurStep }) => [blurStep(0, 1800), blurStep(0.08, 1800), blurStep(0.08, 900), blurStep(1, 1)],
    expect: [0, 0.08 * 0.05 * 900, 0.08 * 0.05 * 450, 0.05],
  },
  {
    name: "the noise is the same bytes as scene-blend's for a seed",
    run: ({ noiseTexels }) => [fnv(noiseTexels(1)), fnv(noiseTexels(2)) !== fnv(noiseTexels(1))],
    expect: [3446277849, true],
  },
  {
    name: "an idle frame goes straight to the host; a panel goes through the frame target; blur adds two half passes",
    run: ({ createSectionPost }) => {
      const log = [];
      const lit = fakeLit(log);
      const post = createSectionPost(lit, fakeRenderer(log), shaders, { grain: 0 });
      post.setSize(720, 450, 2);
      const draw = (label) => () => log.push(label);
      post.render(draw("idle"), { progress: 0 });
      post.render(draw("panel"), { progress: 1, position: 0.5 });
      post.render(draw("blurred"), { blur: 0.08 });
      const sizes = lit.targets.map((t) => t.size);
      const step = lit.materials[1].uniforms.uDir.value;
      return [log, sizes, step];
    },
    expect: [
      [
        "idle",
        "panel", "post -> canvas",
        "blurred", "blur -> target1", "blur -> target2", "post -> canvas",
      ],
      [[1440, 900], [720, 450], [720, 450]],
      [0, 0.08 * 0.05 * 450],
    ],
  },
  {
    name: "the pass gets every value, and every uniform it is given is declared in its shader",
    run: ({ createSectionPost, POST_GLSL }) => {
      const log = [];
      const lit = fakeLit(log);
      const post = createSectionPost(lit, fakeRenderer(log), shaders, { paper: 0.7, depth: true });
      post.render(() => {}, { progress: 0.4, position: -0.5, tear: 1, fibre: 0.2, darken: 0.3 });
      const u = lit.materials[0].uniforms;
      const names = Object.keys(u);
      return [
        ["uProgress", "uPosition", "uColour", "uTear", "uFibre", "uGrain", "uDarken", "uBlur", "uPaper"].map((k) => u[k].value),
        names.filter((n) => !new RegExp(`uniform \\w+ ${n};`, "u").test(POST_GLSL)),
        lit.targets[0].options.depthBuffer,
      ];
    },
    expect: [[0.4, -0.5, [247 / 255, 247 / 255, 238 / 255], 1, 0.2, 0.02, 0.3, 0, 0.7], [], true],
  },
];

/** Deterministic test vectors for lit-finish. Run by `keel module test`. */
const close = (a, b) => Math.abs(a - b) < 1e-9;

export default [
  {
    name: "unsafe settings fall back to the defaults and stay bounded",
    run: ({ finishSettings, DEFAULT_FINISH_SETTINGS }) => {
      const wild = finishSettings({ exposure: -3, tonemap: "filmic", ao: 4, aoRadius: 0, hazeDensity: "thick", contrast: 9, warmth: -1 });
      const more = finishSettings({ translucency: 9, mute: -1, bloom: "lots", taa: "yes", taaBlend: 0 });
      return [wild.exposure, wild.tonemap, wild.ao, wild.aoRadius, wild.hazeDensity, wild.contrast, wild.warmth, finishSettings() === DEFAULT_FINISH_SETTINGS,
        more.translucency, more.mute, more.bloom, more.taa, more.taaBlend];
    },
    expect: [0, "agx", 1, 0.05, 0.012, 2, 0, true, 2, 0, 0.12, true, 0.02],
  },
  {
    name: "the far plane is sky unless the host says it holds a backdrop; the light and TAA passes both honour it",
    run: ({ finishSettings, LIGHT_GLSL, TAA_GLSL }) => [
      finishSettings().backdrop, finishSettings({ backdrop: true }).backdrop, finishSettings({ backdrop: "yes" }).backdrop,
      LIGHT_GLSL.includes("sky && uBackdrop > 0.5 ? 1.0"), TAA_GLSL.includes("vec2 then = held ? uv"),
    ],
    expect: [false, true, false, true, true],
  },
  {
    name: "a setting given overrides only itself",
    run: ({ finishSettings, DEFAULT_FINISH_SETTINGS }) => {
      const tuned = finishSettings({ tonemap: "neutral", ao: 0.4 });
      return [tuned.tonemap, tuned.ao, tuned.saturation === DEFAULT_FINISH_SETTINGS.saturation];
    },
    expect: ["neutral", 0.4, true],
  },
  {
    name: "the AO kernel stays in the unit hemisphere, gathers toward the centre and is the same every run",
    run: ({ aoKernel, AO_SAMPLES }) => {
      const k = aoKernel();
      const lengths = [];
      for (let i = 0; i < k.length; i += 3) lengths.push(Math.hypot(k[i], k[i + 1], k[i + 2]));
      const up = k.filter((_, i) => i % 3 === 2).every((z) => z > 0);
      return [k.length, lengths.every((l) => l <= 1 + 1e-12), up, lengths[0] < lengths.at(-1), aoKernel().every((v, i) => v === k[i]), AO_SAMPLES];
    },
    expect: [48, true, true, true, true, 16],
  },
  {
    name: "the sun moves into the camera's space by the view matrix's rotation, unit length",
    run: ({ directionInView }) => {
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // (A camera turned a quarter round y: world +x is view +z.)
      const turned = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 5, 6, 7, 1];
      const a = directionInView([0, 2, 0], identity);
      const b = directionInView([1, 0, 0], turned);
      return [a, b.map((v) => Math.round(v * 1e9) / 1e9), directionInView([0, 0, 0], identity)];
    },
    expect: [[0, 1, 0], [0, 0, -1], [0, 0, -1]],
  },
  {
    name: "colours come in as sRGB hex or linear triples",
    run: ({ linearColour }) => {
      const white = linearColour("#ffffff", [0, 0, 0]);
      const mid = linearColour("#808080", [0, 0, 0]);
      return [white, close(mid[0], 0.21586050011389926), linearColour([0.2, -1, 3], [0, 0, 0]), linearColour("blue", [0.1, 0.2, 0.3])];
    },
    expect: [[1, 1, 1], true, [0.2, 0, 3], [0.1, 0.2, 0.3]],
  },
  {
    name: "the grade carries every tone map and the AO pass samples its whole kernel",
    run: ({ GRADE_GLSL, AO_GLSL, TONEMAPS }) => [
      TONEMAPS.every((t) => GRADE_GLSL.includes(`vec3 ${t}(vec3 c)`)),
      AO_GLSL.includes("uniform vec3 uKernel[16]") && AO_GLSL.includes("i < 16"),
    ],
    expect: [true, true],
  },
  {
    name: "matrices multiply column-major, a times b",
    run: ({ multiply4 }) => {
      const scale = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
      const move = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
      // (scale * move: move first, then scale, so the translation doubles.)
      return [multiply4(scale, move).slice(12), multiply4(move, scale).slice(12)];
    },
    expect: [[6, 8, 10, 1], [3, 4, 5, 1]],
  },
  {
    name: "jitter stays inside a pixel and repeats every eight frames; the dither shift visits all sixteen cells",
    run: ({ jitterAt, ditherShiftAt }) => {
      const j = Array.from({ length: 8 }, (_, i) => jitterAt(i));
      const cells = new Set(Array.from({ length: 16 }, (_, i) => ditherShiftAt(i).join(",")));
      return [j.every(([x, y]) => Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5), jitterAt(9).join() === jitterAt(1).join(), new Set(j.map((v) => v.join())).size, cells.size];
    },
    expect: [true, true, 8, 16],
  },
  {
    name: "dressing chains a material's own hook, keeps its own program key, and dresses once",
    run: ({ dressMaterial }) => {
      const calls = [];
      const leaf = { side: "both", needsUpdate: false, userData: {}, onCompile: () => calls.push("own"), customProgramCacheKey: () => "keel-forest" };
      const uniforms = { uFinishTranslucency: { value: 1 } };
      dressMaterial(leaf, uniforms);
      dressMaterial(leaf, uniforms);
      const shader = { uniforms: {}, vertexShader: "#include <project_vertex>", fragmentShader: "#include <color_fragment>\n#include <lights_fragment_begin>\n#include <opaque_fragment>" };
      leaf.onCompile(shader, null);
      const bark = { needsUpdate: false, userData: {} };
      dressMaterial(bark, uniforms);
      const plain = { uniforms: {}, vertexShader: "void main(){}", fragmentShader: "void main(){}" };
      bark.onCompile(plain, null);
      return [calls, leaf.customProgramCacheKey(), leaf.needsUpdate, shader.fragmentShader.includes("finishBack"), shader.vertexShader.includes("vFinishWorld ="),
        "uFinishTranslucency" in shader.uniforms, bark.customProgramCacheKey(), plain.fragmentShader];
    },
    expect: [["own"], "keel-forest|lit-finish-leaf", true, true, true, true, "|lit-finish", "void main(){}"],
  },
];

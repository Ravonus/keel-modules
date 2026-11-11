/** Deterministic test vectors for surfaces, on the CPU path. Run by `keel module test`. */
const throws = (fn) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};

/** Bytes of one pixel of a buffer `width` wide. */
const pixel = (buffer, width, x, y) => [...new Uint8Array(buffer, (y * width + x) * 4, 4)];

/**
 * Whether a surface wraps: the step across its edge (last column to first, last row to first) is no bigger than the
 * mean step between neighbours inside it, within half again.
 */
function wraps({ buffers: [albedo], width, height }) {
  const bytes = new Uint8Array(albedo);
  const at = (x, y, k) => bytes[(((y + height) % height) * width + ((x + width) % width)) * 4 + k];
  const step = (x0, y0, x1, y1) => [0, 1, 2].reduce((sum, k) => sum + Math.abs(at(x0, y0, k) - at(x1, y1, k)), 0);
  let [inside, edge, n] = [0, 0, 0];
  for (let i = 0; i < height; i += 1) {
    for (let x = 0; x < width - 1; x += 1) inside += step(x, i, x + 1, i);
    edge += step(width - 1, i, 0, i);
    n += 1;
  }
  for (let i = 0; i < width; i += 1) edge += step(i, height - 1, i, 0);
  return edge / (n + width) <= 1.5 * (inside / (n * (width - 1)));
}

/** A canvas and lit stand-in that records what a print does. */
const fakeLit = {
  CanvasTexture: class { constructor(canvas) { this.image = canvas; } },
  DataTexture: class { constructor(data, width, height) { this.image = { data, width, height }; } },
};
const fakeCanvas = (width, height) => ({ width, height, getContext: () => ({ drawn: [] }) });

export default [
  {
    name: "a seed gives the same plan on every engine: digests pinned",
    run: ({ planSurface, PAPER, KNIT, PAINTED_FLORAL, PAINTED_CLOTH }) => [
      ...[PAPER, KNIT, PAINTED_FLORAL, PAINTED_CLOTH].map((r) => planSurface(r).digest),
      planSurface(PAINTED_FLORAL, { seed: 7, width: 554, height: 326 }).digest,
    ],
    expect: ["f00000ad0439334d", "1c7d790e80f8f65d", "99bdfa7724bc5b94", "f6f9220746072725", "14a439fae2bdacf7"],
  },
  {
    name: "the digest moves with the seed (where a seed decides something), the size and every number",
    run: ({ planSurface, PAPER, PAINTED_FLORAL }) => {
      const base = planSurface(PAPER, { seed: 3 }).digest;
      return [
        planSurface(PAPER, { seed: 3 }).digest === base,
        planSurface(PAPER, { seed: 4 }).digest === base,
        planSurface(PAPER, { seed: 3, width: 512 }).digest === base,
        planSurface({ ...PAPER, tone: "#dcdcd1" }, { seed: 3 }).digest === base,
        planSurface(PAINTED_FLORAL, { seed: 1 }).uniforms[32] === planSurface(PAINTED_FLORAL, { seed: 2 }).uniforms[32],
      ];
    },
    expect: [true, false, false, false, false],
  },
  {
    name: "CPU pixels pinned: albedo and relief at three points of each surface",
    run: ({ paintSurface, PAPER, KNIT, PAINTED_FLORAL, PAINTED_CLOTH }) => [
      [PAPER, { width: 32 }], [KNIT, { width: 32 }],
      [PAINTED_FLORAL, { width: 48, height: 28 }], [PAINTED_CLOTH, { width: 48, height: 28 }],
    ].map(([recipe, size]) => {
      const s = paintSurface(recipe, size);
      return [[3, 5], [17, 11], [30, 26]].flatMap(([x, y]) => [pixel(s.buffers[0], s.width, x, y),
        pixel(s.buffers[1], s.width, x, y)]);
    }),
    expect: [
      [[162, 162, 153, 255], [128, 126, 255, 220], [224, 224, 212, 255], [130, 129, 255, 104], [221, 221, 209, 255],
        [124, 128, 255, 89]],
      [[217, 26, 94, 255], [165, 124, 249, 3], [255, 98, 152, 255], [95, 129, 251, 251], [250, 66, 130, 255],
        [161, 127, 251, 200]],
      [[182, 183, 163, 255], [127, 128, 255, 150], [66, 109, 99, 255], [128, 128, 255, 128], [91, 106, 60, 255],
        [127, 128, 255, 148]],
      [[41, 81, 54, 255], [127, 128, 255, 126], [50, 92, 62, 255], [128, 128, 255, 126], [49, 92, 62, 255],
        [127, 128, 255, 131]],
    ],
  },
  {
    name: "paper and knit tile: their edges step no more than their insides; a painted ground does not",
    run: ({ paintSurface, PAPER, KNIT, PAINTED_FLORAL }) =>
      [PAPER, KNIT, PAINTED_FLORAL].map((r) => wraps(paintSurface(r, { width: 64, seed: 5 }))),
    expect: [true, true, false],
  },
  {
    name: "the relief's normal leans away from the slope: a knit column's left flank left, its right flank right",
    run: ({ paintSurface, KNIT }) => {
      const s = paintSurface(KNIT, { width: 64 });
      const mean = (x) => {
        let sum = 0;
        for (let y = 0; y < 64; y += 1) sum += pixel(s.buffers[1], 64, x, y)[0];
        return sum / 64;
      };
      return [mean(1) < 128, mean(6) > 128];
    },
    expect: [true, true],
  },
  {
    name: "depth 0 gives a flat relief; the height stays in alpha",
    run: ({ paintSurface, PAPER }) => {
      const s = paintSurface({ ...PAPER, depth: 0 }, { width: 16 });
      const relief = new Uint8Array(s.buffers[1]);
      let flat = true;
      let heights = 0;
      for (let i = 0; i < relief.length; i += 4) {
        flat &&= relief[i] === 128 && relief[i + 1] === 128 && relief[i + 2] === 255;
        heights += relief[i + 3] > 0 ? 1 : 0;
      }
      return [flat, heights === 256];
    },
    expect: [true, true],
  },
  {
    name: "a surface is { digest, width, height, buffers }: two transferable buffers of width × height × 4 bytes",
    run: ({ paintSurface, PAINTED_CLOTH, planSurface }) => {
      const s = paintSurface(PAINTED_CLOTH, { width: 20, height: 10 });
      return [Object.keys(s), s.digest === planSurface(PAINTED_CLOTH, { width: 20, height: 10 }).digest,
        s.buffers.map((b) => b instanceof ArrayBuffer && b.byteLength)];
    },
    expect: [["digest", "width", "height", "buffers"], true, [800, 800]],
  },
  {
    name: "planned painters and bad recipes throw",
    run: ({ planSurface, PAPER, KNIT, PAINTED_FLORAL }) => [
      throws(() => planSurface({ kind: "veins" })),
      throws(() => planSurface({ kind: "brocade" })),
      throws(() => planSurface(PAPER, { seed: -1 })),
      throws(() => planSurface(PAPER, { width: 5000 })),
      throws(() => planSurface({ ...KNIT, ribs: 8.5 })),
      throws(() => planSurface({ ...PAPER, tone: "pink" })),
      throws(() => planSurface({ ...PAINTED_FLORAL, masses: [...PAINTED_FLORAL.masses, PAINTED_FLORAL.masses[0]] })),
      throws(() => planSurface({ ...PAINTED_FLORAL, brush: { ...PAINTED_FLORAL.brush, axis: [0, 0] } })),
    ],
    expect: [
      "RangeError: surfaces: veins is planned, not built yet.",
      'RangeError: surfaces: no painter for "brocade".',
      "RangeError: surfaces: seed must be within 0..2147483647.",
      "RangeError: surfaces: width must be within 1..4096.",
      "RangeError: surfaces: ribs must be a whole number within 1..256.",
      'TypeError: surfaces: "pink" is not #rrggbb.',
      "RangeError: surfaces: at most 10 masses.",
      "RangeError: surfaces: brush axis must not be [0, 0].",
    ],
  },
  {
    name: "print: draw gets a fresh canvas's context and size; colour prints are sRGB, data prints have no colour space",
    run: ({ createPrinter, pbr }) => {
      const calls = [];
      const print = createPrinter(fakeLit, fakeCanvas);
      const colour = print([300, 200], (ctx, w, h) => calls.push([typeof ctx, w, h]));
      const data = print(64, () => undefined, { data: true, repeat: true });
      return [calls, colour.image.width, colour.colorSpace, colour.wrapS, colour.needsUpdate, data.colorSpace,
        data.wrapT, pbr(0.3, 1), pbr(-1, 0.5)];
    },
    expect: [[["object", 300, 200]], 300, "srgb", "clamp", true, "", "repeat", "rgb(255 77 255)", "rgb(255 0 128)"],
  },
  {
    name: "surface textures: a repeating, mipmapped sRGB map and a data normal map, flipped so the top row is up",
    run: ({ surfaceTextures, paintSurface, KNIT }) => {
      const { map, normalMap } = surfaceTextures(fakeLit, paintSurface(KNIT, { width: 8 }));
      return [map.colorSpace, normalMap.colorSpace, map.wrapS, normalMap.minFilter, map.generateMipmaps, map.flipY,
        normalMap.image.data.length];
    },
    expect: ["srgb", "", "repeat", "linear-mipmap-linear", true, true, 256],
  },
];

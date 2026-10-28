export default [
  {
    name: 'unsafe settings fall back to the preset and stay bounded',
    run: ({ ditherSettings }) => {
      const look = ditherSettings({ style: '<script>', screen: 'wobble', levels: 900, pixel: -4, outlineColor: 'red', palette: ['#ABCDEF', 'nope'], depthBands: [40, 10] });
      return [look.style, look.screen, look.levels, look.pixel, look.outlineColor, look.palette, look.depthBands];
    },
    expect: ['smart', 'auto', 16, 0, null, ['#abcdef'], [40, 40]],
  },
  {
    name: 'a style is a preset and a setting beside it overrides it',
    run: ({ ditherSettings }) => {
      const chunky = ditherSettings({ style: 'chunky' });
      const tuned = ditherSettings({ style: 'chunky', pixel: 2, shading: 'smooth' });
      return [chunky.screen, chunky.pixel, chunky.shading, tuned.screen, tuned.pixel, tuned.shading];
    },
    expect: ['bayer2', 6, 'cel', 'bayer2', 2, 'smooth'],
  },
  {
    name: 'art pixels are whole device pixels and the grid covers the frame',
    run: ({ ditherSettings, resolveGrid }) => {
      const grid = resolveGrid(778, 547, 2, ditherSettings());
      const fixed = resolveGrid(100, 50, 1.5, ditherSettings({ pixel: 3 }));
      return [grid.pixel, grid.width, grid.height, grid.originX, grid.originY, fixed.pixel, fixed.width, fixed.height];
    },
    expect: [6, 260, 183, -2, -2, 5, 30, 15],
  },
  {
    name: 'bayer4 visits every one of its sixteen levels once per tile',
    run: ({ thresholdAt }) => {
      const levels = [];
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) levels.push(thresholdAt('bayer4', x, y) * 16);
      return levels.sort((a, b) => a - b);
    },
    expect: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  {
    name: 'every screen is a pure function of the pixel, inside [0, 1)',
    run: ({ SCREENS, thresholdAt }) => SCREENS.every((screen) => {
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const t = thresholdAt(screen, x, y);
          if (!(t >= 0 && t < 1) || t !== thresholdAt(screen, x, y)) return false;
        }
      }
      return true;
    }),
    expect: true,
  },
  {
    name: 'a tone between two steps lands on the screen, never off the ramp',
    run: ({ quantizeTone }) => [quantizeTone(0.5, 3, 0), quantizeTone(0.5, 3, 0.99), quantizeTone(0.6, 3, 0.2), quantizeTone(0.6, 3, 0.9), quantizeTone(0.6, 3, 0.9, 0), quantizeTone(2, 4, 0.5)],
    expect: [0.5, 0.5, 0.5, 1, 0.5, 1],
  },
  {
    name: 'auto screens follow the grid size and soften with distance',
    run: ({ ditherSettings, bandScreens }) => {
      const look = ditherSettings();
      return [100, 200, 400].map((short) => { const bands = bandScreens(look, short); return [bands.near.screen, bands.far.screen, bands.far.amount]; });
    },
    expect: [['bayer2', 'checker', 0.5], ['bayer4', 'bayer8', 0.5], ['bayer8', 'ign', 0.45]],
  },
  {
    name: 'cel ramps step from a lifted shadow to full light',
    run: ({ celRamp }) => [Array.from(celRamp(3)), Array.from(celRamp(99)).length],
    expect: [[77, 154, 255], 8],
  },
  {
    name: 'a palette packs into the shader uniform in order',
    run: ({ paletteUniform }) => {
      const packed = paletteUniform(['#ff0000', '#00ff00']);
      return [packed.size, Array.from(packed.data.slice(0, 6)), packed.data.length];
    },
    expect: [2, [1, 0, 0, 0, 1, 0], 96],
  },
  {
    name: 'snap keeps flat in-between tones clean and dithers only the middle of a step',
    run: ({ quantizeTone }) => {
      const flat = [0, 0.25, 0.5, 0.75].map((threshold) => quantizeTone(0.3, 2, threshold, 1, 0.6));
      const plain = [0, 0.25, 0.5, 0.75].map((threshold) => quantizeTone(0.3, 2, threshold, 1, 0));
      const middle = [0, 0.25, 0.5, 0.75].map((threshold) => quantizeTone(0.5, 2, threshold, 1, 0.6));
      return [flat, plain, middle];
    },
    expect: [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 1]],
  },
  {
    name: 'signal settings default off, clamp to 0..1, and the crt look turns scanlines and fringe on',
    run: ({ ditherSettings }) => {
      const plain = ditherSettings({ style: 'pixel' });
      const wild = ditherSettings({ scanlines: 3, chroma: -1, glitch: 0.4 });
      const crt = ditherSettings({ style: 'crt', glitch: 1 });
      return [[plain.scanlines, plain.chroma, plain.glitch], [wild.scanlines, wild.chroma, wild.glitch], [crt.scanlines > 0, crt.chroma > 0, crt.glitch, crt.shading]];
    },
    expect: [[0, 0, 0], [1, 0, 0.4], [true, true, 1, 'smooth']],
  },
  {
    name: 'part signals pack in part order, clamped, with empty parts left at zero',
    run: ({ signalUniform, SIGNAL_TAG_ALPHA }) => [Array.from(signalUniform([{ scanlines: 0.5 }, null, { chroma: 2, glitch: 0.25 }])), [SIGNAL_TAG_ALPHA[1], SIGNAL_TAG_ALPHA[2], SIGNAL_TAG_ALPHA[3]]],
    expect: [[0.5, 0, 0, 0, 0, 0, 0, 1, 0.25], [0.25, 0.5, 0.75]],
  },
  {
    name: 'part filters pack as their number and amount, and an unknown filter is none',
    run: ({ filterUniform, SIGNAL_FILTERS }) => [Array.from(filterUniform([{ filter: 'vhs', amount: 0.5 }, { filter: 'nope' }, { filter: 'holo', amount: 3 }])), SIGNAL_FILTERS.length],
    expect: [[7, 0.5, 0, 0, 18, 1], 19],
  },
  {
    name: 'lift, clump and ramp default off, clamp, and the canonical pixel look wears them',
    run: ({ ditherSettings }) => {
      const plain = ditherSettings({ style: 'engraving' });
      const wild = ditherSettings({ style: 'engraving', lift: 2, clump: -1, ramp: 'x' });
      const pixel = ditherSettings({ style: 'pixel' });
      return [[plain.lift, plain.clump, plain.ramp], [wild.lift, wild.clump, wild.ramp], [pixel.lift > 0, pixel.clump > 0, pixel.ramp > 0, pixel.snap < 0.6]];
    },
    expect: [[0, 0, 0], [0.3, 0, 0], [true, true, true, true]],
  },
  {
    name: 'a palette also packs as OKLab, so entries are matched by how near they look',
    run: ({ paletteUniform, okLab }) => {
      const round = (values) => Array.from(values, (v) => Math.round(v * 1000) / 1000 + 0);
      const packed = paletteUniform(['#ffffff', '#000000']);
      return [round(packed.lab.slice(0, 6)), packed.lab.length, round(okLab([1, 0, 0]))];
    },
    expect: [[1, 0, 0, 0, 0, 0], 96, [0.628, 0.225, 0.126]],
  },
];

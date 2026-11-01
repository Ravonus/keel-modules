const solid = (wide, paint) => {
  const raw = new Uint8Array(wide * wide * 4);
  for (let y = 0; y < wide; y++) for (let x = 0; x < wide; x++) raw.set(paint(x, y), (y * wide + x) * 4);
  return raw;
};

export default [
  {
    name: 'a mesh is as tall as its highest point',
    run: ({ meshTop }) => meshTop(new Float32Array([9, 1, 9, 9, 3, 9, 9, 2, 9])),
    expect: 3,
  },
  {
    name: 'the frame follows the head, so a small head fills it as a tall one does',
    run: ({ portraitShot }) => {
      const a = portraitShot(1.8, 1.6, 128), b = portraitShot(.9, .8, 128);
      return [Math.round(a.high / b.high), Math.round(a.away / b.away), portraitShot(1.8, 1.6, 32).high < a.high];
    },
    expect: [2, 2, true],
  },
  {
    name: 'coming down keeps the colour of what is there, not the dark of what is not, and turns the rows over',
    run: ({ shrinkPortrait }) => {
      const raw = solid(4, (x, y) => (x < 2 && y >= 2 ? [200, 100, 50, 255] : [0, 0, 0, 0]));

      return [...shrinkPortrait(raw, 4, 2).subarray(0, 8)];
    },
    expect: [200, 100, 50, 255, 0, 0, 0, 0],
  },
  {
    name: 'a half-covered pixel keeps its full colour',
    run: ({ shrinkPortrait }) => [...shrinkPortrait(solid(2, (x) => (x ? [0, 0, 0, 0] : [80, 40, 20, 255])), 2, 1)].map(Math.round),
    expect: [80, 40, 20, 127],
  },
  {
    name: 'a large picture is left soft',
    run: ({ shrinkPortrait }) => {
      const out = shrinkPortrait(solid(64, (x) => [x * 4, 0, 0, 255]), 64, 64);
      return out[4 * 30];
    },
    expect: 120,
  },
];

// A stand-in for keel/lit: records what the module makes, draws nothing.
const lit = () => ({
  Group: class { constructor() { this.children = []; } add(...n) { this.children.push(...n); } },
  Mesh: class { constructor(geometry, material) { Object.assign(this, { geometry, material, visible: true, renderOrder: 0 }); } },
  Geometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } setIndex(i) { this.index = i; } dispose() {} },
  Attribute: class { constructor(array, size) { Object.assign(this, { array, size, needsUpdate: false }); } },
  CustomMaterial: class { constructor(p) { Object.assign(this, p); } dispose() {} },
  Vector2: class { constructor(x = 0, y = 0) { this.set(x, y); } set(x, y) { Object.assign(this, { x, y }); } },
});

// An 8-bit grid from a function of (x, y), top row first.
const grid = (w, h, f) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w))) });
// A disc of paint in a 32 × 32 matte, and a dome for its depth.
const disc = grid(32, 32, (x, y) => ((x - 15.5) ** 2 + (y - 15.5) ** 2 < 100 ? 255 : 0));
const dome = grid(32, 32, (x, y) => Math.max(0, Math.round(255 * (1 - ((x - 15.5) ** 2 + (y - 15.5) ** 2) / 100))));
const full = grid(4, 4, () => 255);

const layer = (over = {}) => ({ name: 'a', rect: [0, 0, 1, 1], z: 0, grid: [8, 8], states: [{ alpha: disc, depth: dome }], ...over });
const BLINK = { seed: 7, period: [4, 7], close: 0.05, hold: 0.02, open: 0.05, double: 0.1 };
const throws = (f) => { try { f(); return 'no'; } catch (e) { return e instanceof RangeError ? 'RangeError' : String(e); } };

export default [
  {
    name: 'the hash is a fixed integer recipe: the same numbers on every engine',
    run: ({ puppetHash }) => [puppetHash(1, 0, 0), puppetHash(7, 299, 3), puppetHash(-3, 12, 4)].map((u) => u * 4294967296),
    expect: [55385322, 421807222, 2162665510],
  },
  {
    name: 'the exact sine and cosine agree with Math to 5e-15 and give fixed bits',
    run: ({ sine, cosine }) => [
      [0.3, 1, 2.5, -4, 100].every((x) => Math.abs(sine(x) - Math.sin(x)) < 5e-15 && Math.abs(cosine(x) - Math.cos(x)) < 5e-15),
      sine(1), cosine(0.5),
    ],
    expect: [true, 0.8414709848078965, 0.8775825618903728],
  },
  {
    name: 'a seeded blink: waits stay between the shortest and longest, some come twice, the same times everywhere',
    run: ({ blinkAt }) => {
      const starts = [];
      for (let t = 0; t < 120; t += 0.001) if (blinkAt(BLINK, t) > 0 && blinkAt(BLINK, t - 0.001) === 0) starts.push(Math.round(t * 1000));
      const waits = starts.slice(1).map((s, i) => s - starts[i]);
      const doubles = waits.filter((w) => w === 200).length;
      return [starts.slice(0, 4), waits.every((w) => w === 200 || (w >= 4000 && w <= 7000)), doubles];
    },
    expect: [[463, 6805, 11678, 11878], true, 1],
  },
  {
    name: 'a blink closes in 50 ms, holds 20 and opens in 50: about half at the middle of the close, shut at the hold',
    run: ({ blinkAt }) => [6.805 + 0.025, 6.805 + 0.06, 6.805 + 0.12, 6.805 + 0.13].map((t) => Math.round(blinkAt(BLINK, t) * 1000) / 1000),
    expect: [0.504, 1, 0, 0],
  },
  {
    name: 'a wiggle starts at 0, stays within its amplitude, and is the same number on every engine',
    run: ({ wiggle }) => {
      let most = 0;
      for (let t = 0; t < 40; t += 0.01) most = Math.max(most, Math.abs(wiggle(3, 0.25, 0.6, t)));
      return [wiggle(3, 0.25, 0.6, 0), most <= 1.2, wiggle(3, 0.25, 0.6, 1.234)];
    },
    expect: [0, true, -0.8599691072357184],
  },
  {
    name: 'parameters sum their terms in order: tracks, earlier parameters, the clock, a range',
    run: ({ evaluateParams }) => evaluateParams([
      { name: 'lean', sum: [{ track: 'rig.card.lean', gain: -0.3 }, 21] },
      { name: 'twice', sum: [{ param: 'lean', gain: 2 }] },
      { name: 'clock', sum: [{ time: 0.5 }], range: [0, 1] },
      { name: 'missing', sum: [{ track: 'rig.nothing' }, { param: 'later' }] },
      { name: 'later', sum: [3] },
    ], { time: 4, values: { rig: { 'card.lean': -5 } } }),
    expect: { lean: 22.5, twice: 45, clock: 1, missing: 0, later: 3 },
  },
  {
    name: 'reduced motion holds the clock, wiggles and blinks at rest and keeps the tracks',
    run: ({ evaluateParams }) => evaluateParams([
      { name: 'b', sum: [{ blink: BLINK }] }, { name: 'w', sum: [{ wiggle: [3, 1, 1] }] }, { name: 't', sum: [{ time: 1 }] },
      { name: 'k', sum: [{ track: 'rig.k' }] },
    ], { time: 6.865, values: { rig: { k: 2 } }, still: true }),
    expect: { b: 0, w: 0, t: 0, k: 2 },
  },
  {
    name: 'a grid samples bilinearly, top row first, through a stride and a channel',
    run: ({ sampleGrid }) => {
      const g = { width: 2, height: 2, data: [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0], stride: 4, channel: 3 };
      return [sampleGrid(g, 0, 1), sampleGrid(g, 1, 1), sampleGrid(g, 0, 0), sampleGrid(g, 0.5, 0.5)];
    },
    expect: [0, 1, 1, 0.5],
  },
  {
    name: 'a relief layer: the same plan to the bit, cells outside the paint dropped, lift up to the relief',
    run: ({ planFigure }) => {
      const p = planFigure({ params: [], layers: [layer({ relief: 0.05 })] });
      const s = p.layers[0].sheets[0];
      return [p.digest, s.index.length / 6, Math.max(...s.lift) <= 0.05 + 1e-9, Math.max(...s.lift) > 0.04];
    },
    expect: [1144170806, 36, true, true],
  },
  {
    name: 'the silhouette takes the depth inside it: vertices with no paint near take their neighbours\' lift',
    run: ({ planFigure }) => {
      const ring = grid(32, 32, (x, y) => ((x - 15.5) ** 2 + (y - 15.5) ** 2 < 100 ? 255 : 0));
      const s = planFigure({ params: [], layers: [layer({ relief: 0.06, states: [{ alpha: ring, depth: full }] })] }).layers[0].sheets[0];
      return [s.lift[0], s.lift[40]];
    },
    expect: [0.05999999865889549, 0.05999999865889549],
  },
  {
    name: 'a layer lying on another rides its relief',
    run: ({ planFigure }) => {
      const p = planFigure({ params: [], layers: [layer({ relief: 0.06, states: [{ alpha: full, depth: full }] }),
        layer({ name: 'b', z: 0.01, on: 'a', states: [{ alpha: full }] })] });
      return [...p.layers[1].sheets[0].rest.subarray(0, 3)];
    },
    expect: [0, 0, 0.07000000029802322],
  },
  {
    name: 'the limits hold: relief past 0.06, a gap past 0.05, two states with no dissolve, unknown names',
    run: ({ planFigure }) => [
      throws(() => planFigure({ params: [], layers: [layer({ relief: 0.07 })] })),
      throws(() => planFigure({ params: [], layers: [layer(), layer({ name: 'b', on: 'a', z: 0.06 })] })),
      throws(() => planFigure({ params: [], layers: [layer({ states: [{ alpha: disc }, { alpha: disc }] })] })),
      throws(() => planFigure({ params: [], layers: [layer({ on: 'nobody' })] })),
      throws(() => planFigure({ params: [], layers: [layer({ bind: [{ bone: 'nobody' }] })] })),
      throws(() => planFigure({ params: [], layers: [layer({ clip: 'later' }), layer({ name: 'later' })] })),
      throws(() => planFigure({ params: [], layers: [layer({ relief: 0.06, clip: 'a' }), layer({ name: 'b', on: 'a', z: 0.05 })] })),
    ],
    expect: ['RangeError', 'RangeError', 'RangeError', 'RangeError', 'RangeError', 'RangeError', 'no'],
  },
  {
    name: 'a reach holds its capsule, fades over its feather, and lets go past it',
    run: ({ reachWeight }) => {
      const r = { from: [0, 0], to: [0, 1], radius: 0.1, feather: 0.2 };
      return [reachWeight(r, [0.05, 0.5]), reachWeight(r, [0.2, 0.5]), reachWeight(r, [0.31, 1])];
    },
    expect: [1, 0.5, 0],
  },
  {
    name: 'a shape key moves its centre by the whole move, times the parameter',
    run: ({ planFigure, deformSheet }) => {
      const p = planFigure({ params: [], layers: [layer({ grid: [2, 2], keys: [{ param: 'k', moves: [{ at: [0.5, 0.5], move: [0, 0.2], radius: 0.4 }] }] })] });
      const position = new Float32Array(27);
      deformSheet(p.layers[0], 0, { k: 0.5 }, { position });
      return [position[13], position[1]];
    },
    expect: [0.6000000238418579, 0],
  },
  {
    name: 'bones: a child turns first about its pivot, then the parent; a state painted bent is unbent at its rest',
    run: ({ planFigure, deformSheet }) => {
      const fig = (rest) => ({
        params: [],
        bones: [{ name: 'root', at: [0, 0], param: 'r' }, { name: 'tip', at: [1, 0], param: 't', parent: 'root' }],
        layers: [layer({ rect: [0, 0, 2, 1], grid: [2, 1], states: [{ alpha: full }, { alpha: full }], dissolve: { param: 'd' },
          bind: [{ bone: 'root' }, { bone: 'tip', reach: { from: [1.5, 0], to: [2, 0], radius: 0.6, feather: 0.1 }, rest }] })],
      });
      const out = (rest, state) => {
        const position = new Float32Array(18);
        deformSheet(planFigure(fig(rest)).layers[0], state, { r: 90, t: 90 }, { position });
        return [...position.subarray(6, 8)].map((v) => Math.round(v * 1e6) / 1e6);
      };
      return [out([0, 0], 0), out([0, 90], 1)];
    },
    expect: [[-1, 1], [0, 2]],
  },
  {
    name: 'the dissolve maps its parameter through the window; an anchor crosses between the states\' points',
    run: ({ planFigure, dissolveOf, anchorOf }) => {
      const p = planFigure({ params: [], layers: [layer({ z: 0.25, states: [{ alpha: full, anchors: { card: [0, 0] } },
        { alpha: full, anchors: { card: [1, 0] } }], dissolve: { param: 'pinch' } })] }).layers[0];
      const r = (x) => Math.round(x * 1e9) / 1e9;
      return [dissolveOf(p, { pinch: 0.2 }), r(dissolveOf(p, { pinch: 0.5 })), dissolveOf(p, { pinch: 0.9 }),
        anchorOf(p, 'card', { pinch: 0.5 }).at.map(r), anchorOf(p, 'none', {})];
    },
    expect: [0, 0.5, 1, [0.5, 0, 0.25], undefined],
  },
  {
    name: 'a puppet draws each state and its depth matte, back to front, the mattes after every layer',
    run: ({ createPuppet }) => {
      const p = createPuppet(lit(), { params: [], layers: [layer(), layer({ name: 'b', states: [{ alpha: full }, { alpha: full }], dissolve: { param: 'd' } })] },
        { a: ['A'], b: ['B0', 'B1'] });
      return p.group.children.map((m) => [m.renderOrder, m.material.uniforms.uMap.value, 'MATTE' in m.material.defines, m.material.depthWrite, m.material.colorWrite]);
    },
    expect: [[0, 'A', false, false, true], [4, 'A', true, true, false], [2, 'B0', false, false, true], [5, 'B0', true, true, false],
      [3, 'B1', false, false, true], [5, 'B1', true, true, false]],
  },
  {
    name: 'update: a dissolve shows one state at its ends and both inside the window; slides are held within their most',
    run: ({ createPuppet }) => {
      const p = createPuppet(lit(), {
        params: [{ name: 'd', sum: [{ track: 'rig.pinch' }] }, { name: 'gx', sum: [0.5] }, { name: 'gy', sum: [-0.01] }],
        layers: [layer({ states: [{ alpha: full }, { alpha: full }], dissolve: { param: 'd' }, slide: { param: ['gx', 'gy'], max: [0.02, 0.05] } })],
      }, { a: ['A0', 'A1'] }, { matte: false });
      const shown = (pinch) => { p.update({ time: 0, values: { rig: { pinch } } }); return p.group.children.map((m) => m.visible); };
      const s = p.group.children[0].material.uniforms.uSlide.value;
      return [shown(0), shown(0.5), shown(1), [s.x, s.y], 'SLIDE' in p.group.children[0].material.defines];
    },
    expect: [[true, false, false, false], [true, false, true, false], [false, false, true, false], [0.02, -0.01], true],
  },
  {
    name: 'a layer with keys or bones is moved only when what it reads changes',
    run: ({ createPuppet }) => {
      const p = createPuppet(lit(), { params: [{ name: 'k', sum: [{ track: 'rig.k' }] }],
        layers: [layer({ grid: [2, 2], keys: [{ param: 'k', moves: [{ at: [0.5, 0.5], move: [0, 0.2], radius: 0.4 }] }] })] }, { a: ['A'] });
      const attr = p.group.children[0].geometry.attributes.position;
      const moved = (k) => { attr.needsUpdate = false; p.update({ time: 1, values: { rig: { k } } }); return [attr.needsUpdate, attr.array[13]]; };
      return [moved(1), moved(1), moved(0)];
    },
    expect: [[true, 0.699999988079071], [false, 0.699999988079071], [true, 0.5]],
  },
  {
    name: 'a missing texture is named',
    run: ({ createPuppet }) => throws(() => createPuppet(lit(), { params: [], layers: [layer()] }, {})),
    expect: 'RangeError',
  },
];

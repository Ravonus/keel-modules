// A stand-in for keel/lit: records what the module makes, draws nothing.
const lit = () => ({
  Instances: class { constructor(geometry, material, count) { Object.assign(this, { geometry, material, count }); } },
  InstanceAttribute: class { constructor(array, size) { Object.assign(this, { array, size }); } },
  CustomMaterial: class { constructor(p) { Object.assign(this, p); } dispose() {} },
  Color: class { constructor(hex) { const n = parseInt(hex.slice(1), 16); this.r = (n >> 16) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255; } },
  Vector2: class { constructor(x, y) { this.set(x, y); } set(x, y) { Object.assign(this, { x, y }); } },
  Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  plane: () => ({ attributes: {}, setAttribute(name, a) { this.attributes[name] = a; }, dispose() {} }),
});

// A digest of every bit of a field: equal digests, equal fields.
const digest = (field) => {
  let h = 2166136261;
  for (const array of [field.mote, field.life, field.color]) {
    for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) h = Math.imul(h ^ byte, 16777619);
  }
  return h >>> 0;
};

export default [
  {
    name: 'the hash is a fixed integer recipe: the same numbers on every engine',
    run: ({ moteHash }) => [moteHash(1, 0, 0), moteHash(7, 299, 45), moteHash(-3, 12, 100)].map((u) => u * 4294967296),
    expect: [55385322, 229326422, 2522429769],
  },
  {
    name: 'a seed lays the same field, to the bit, and another seed another field',
    run: ({ placeMotes }) => [digest(placeMotes({ seed: 7 })), digest(placeMotes({ seed: 7 })) === digest(placeMotes({ seed: 8 }))],
    expect: [2303343398, false],
  },
  {
    name: 'every mote starts inside the box',
    run: ({ placeMotes }) => {
      const f = placeMotes({ count: 500, centre: [1, 2, 3], box: [2, 4, 6] });
      let inside = 0;
      for (let i = 0; i < f.count; i++) {
        const [x, y, z] = f.mote.subarray(i * 4, i * 4 + 3);
        if (Math.abs(x - 1) <= 1 && Math.abs(y - 2) <= 2 && Math.abs(z - 3) <= 3) inside++;
      }
      return inside;
    },
    expect: 500,
  },
  {
    name: 'a density thins the field where it is low',
    run: ({ placeMotes }) => {
      const f = placeMotes({ count: 1000, centre: [0, 0, 0], box: [2, 2, 2] }, (_x, y) => (y < 0 ? 1 : 0.1));
      let low = 0;
      for (let i = 0; i < f.count; i++) if (f.mote[i * 4 + 1] < 0) low++;
      return low > 800 && low < 950;
    },
    expect: true,
  },
  {
    name: 'blink periods, sizes and phases stay in their ranges',
    run: ({ placeMotes }) => {
      const f = placeMotes({ count: 400, size: 0.1, sizeSpread: 0.5, blinkPeriod: [2, 5] });
      let ok = 0;
      for (let i = 0; i < f.count; i++) {
        const [period, size] = f.life.subarray(i * 4, i * 4 + 2);
        const phase = f.mote[i * 4 + 3];
        if (period >= 2 && period <= 5 && size >= 0.05 - 1e-6 && size <= 0.15 + 1e-6 && phase >= 0 && phase < 6.2832) ok++;
      }
      return ok;
    },
    expect: 400,
  },
  {
    name: 'the sparkle share picks none, some or all',
    run: ({ placeMotes }) => [0, 0.25, 1].map((sparkle) => {
      const f = placeMotes({ count: 400, sparkle });
      let n = 0;
      for (let i = 0; i < f.count; i++) n += f.life[i * 4 + 2];
      return sparkle === 0.25 ? n > 70 && n < 130 : n;
    }),
    expect: [0, true, 400],
  },
  {
    name: 'each mote takes one of the colours, and each colour is used',
    run: ({ placeMotes }) => {
      const f = placeMotes({ count: 300, colors: ['#ffbe26', '#ffffff', '#ff8800'] });
      return [...new Set(f.color)].sort();
    },
    expect: [0, 1, 2],
  },
  {
    name: 'settings out of range are put right',
    run: ({ moteSettings }) => {
      const s = moteSettings({ count: 1e6, blinkPeriod: [6, 1], colors: [], opacity: 3, sparkle: -1 });
      return [s.count, s.blinkPeriod, s.colors, s.opacity, s.sparkle];
    },
    expect: [4096, [1, 6], ['#ffbe26'], 1, 0],
  },
  {
    name: 'the field becomes one instanced quad with three instance attributes, drawn additive without depth',
    run: ({ createMotes }) => {
      const m = createMotes(lit(), { count: 12 });
      const g = m.mesh.geometry;
      return [m.mesh.count, Object.keys(g.attributes).sort(), g.attributes.aMote.size, m.mesh.material.blending, m.mesh.material.depthWrite];
    },
    expect: [12, ['aColor', 'aLife', 'aMote'], 4, 'add', false],
  },
  {
    name: 'colours go through keel/lit, a mote at a time',
    run: ({ createMotes }) => [...createMotes(lit(), { count: 2, colors: ['#ff0000'] }).mesh.geometry.attributes.aColor.array],
    expect: [1, 0, 0, 1, 0, 0],
  },
  {
    name: 'the host clock drives the field; reduced motion holds it at 0 with no blink',
    run: ({ createMotes }) => {
      const m = createMotes(lit(), { count: 4, opacity: 0.8 });
      const u = m.mesh.material.uniforms;
      m.update({ time: 12.5, opacity: 0.5 });
      const moving = [u.uTime.value, u.uBlink.value, u.uOpacity.value];
      m.update({ time: 12.5, still: true });
      return [moving, [u.uTime.value, u.uBlink.value, u.uOpacity.value]];
    },
    expect: [[12.5, 1, 0.4], [0, 0, 0.8]],
  },
  {
    name: 'shown is clamped to the field, and resize sets the pixel scale',
    run: ({ createMotes }) => {
      const m = createMotes(lit(), { count: 10 });
      m.shown = 99;
      const most = m.shown;
      m.shown = 3.7;
      m.resize(2000, 1000);
      const p = m.mesh.material.uniforms.uPixel.value;
      return [most, m.shown, p.x, p.y];
    },
    expect: [10, 3, 0.001, 0.002],
  },
  {
    name: 'pixel sizes drop the attenuation define; the path is exported for a mesh variant',
    run: ({ createMotes, MOTE_PATH_GLSL, MOTE_VERTEX }) => [
      'ATTENUATE' in createMotes(lit(), { count: 1 }).mesh.material.defines,
      'ATTENUATE' in createMotes(lit(), { count: 1, attenuate: false }).mesh.material.defines,
      MOTE_PATH_GLSL.includes('vec3 motePath(vec4 mote, vec4 life, float t)'),
      MOTE_VERTEX.includes(MOTE_PATH_GLSL),
    ],
    expect: [true, false, true, true],
  },
];

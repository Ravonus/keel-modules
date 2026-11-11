// A Shape stand-in: each curve gives its end point, so the outline is the curves' ends.
class Shape {
  points = [];
  moveTo(x, y) { this.points.push({ x, y }); }
  bezierCurveTo(_a, _b, _c, _d, x, y) { this.points.push({ x, y }); }
  getPoints() { return this.points; }
}

// A stand-in for keel/lit: records what the module makes, draws nothing.
const lit = () => ({
  Instances: class { constructor(geometry, material, count) { Object.assign(this, { geometry, material, count, instanceMatrix: { array: new Float32Array(count * 16), needsUpdate: false } }); } },
  Geometry: class { attributes = {}; setAttribute(name, a) { this.attributes[name] = a; } setIndex(index) { this.index = index; } dispose() {} },
  Attribute: class { constructor(array, size) { Object.assign(this, { array, size }); } },
  InstanceAttribute: class { constructor(array, size) { Object.assign(this, { array, size, instanced: true }); } },
  CustomMaterial: class { constructor(p) { Object.assign(this, p); } dispose() {} },
  Color: class { constructor(hex) { const n = parseInt(hex.slice(1), 16); this.r = (n >> 16) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255; } },
  Vector3: class { set(x, y, z) { Object.assign(this, { x, y, z }); } },
  Shape,
});

const triangleNormalY = (mesh, t) => {
  const p = (k) => { const i = mesh.index[t * 3 + k]; const side = mesh.wing[i * 2] || 1; return [mesh.position[i * 3] * side, mesh.position[i * 3 + 2]]; };
  const [a, b, c] = [p(0), p(1), p(2)];
  // (y of (b - a) x (c - a) for points (x, 0, z))
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
};

export default [
  {
    name: 'a seed plans the same flights on every engine: integer hashing only',
    run: ({ planFlights, flightHash }) => {
      const [first] = planFlights({ seed: 3, speed: 0.5 });
      return [flightHash(3, 0, 0) * 4294967296, first.rate[0], first.phase[0], first.flap];
    },
    expect: [3193046398, 0.573031714418903, 0.1183285940494734, 4.779600317240935],
  },
  {
    name: 'every flight stays inside its radius about the centre',
    run: ({ planFlights, flyAt }) => {
      const s = { count: 50, centre: [1, 2, 3], radius: [1.5, 0.5, 0.75] };
      let outside = 0;
      for (const flight of planFlights(s)) {
        for (let t = 0; t < 120; t += 0.37) {
          const { at } = flyAt(flight, t, s);
          if (Math.abs(at[0] - 1) > 1.5 + 1e-9 || Math.abs(at[1] - 2) > 0.5 + 1e-9 || Math.abs(at[2] - 3) > 0.75 + 1e-9) outside++;
        }
      }
      return outside;
    },
    expect: 0,
  },
  {
    name: 'no butterfly enters a keep-out, and each faces a unit direction',
    run: ({ planFlights, flyAt }) => {
      const s = { count: 20, radius: [1, 1, 1], keepOut: [{ centre: [0, 0, 0], radius: 0.6 }] };
      let inside = 0;
      let crooked = 0;
      for (const flight of planFlights(s)) {
        for (let t = 0; t < 60; t += 0.5) {
          const { at, front } = flyAt(flight, t, s);
          if (Math.hypot(...at) < 0.6 - 1e-9) inside++;
          if (Math.abs(Math.hypot(...front) - 1) > 1e-9) crooked++;
        }
      }
      return [inside, crooked];
    },
    expect: [0, 0],
  },
  {
    name: 'a flock is 0 to 50, and other settings are put right',
    run: ({ butterflySettings }) => {
      const s = butterflySettings({ count: 99, scale: -1, colors: { upper: '#ff0000' } });
      return [s.count, butterflySettings({ count: -4 }).count, s.scale, s.colors];
    },
    expect: [50, 0, 0, { upper: '#ff0000', under: '#7ea2ff', body: '#1b2f6e' }],
  },
  {
    name: 'the outline is drawn on the Shape it is handed, without a closing repeat',
    run: ({ wingOutline }) => wingOutline(new Shape()).length,
    expect: 5,
  },
  {
    name: 'two mirrored wings and a body: sides, edges from root to outline, both upper sides up',
    run: ({ wingMesh, wingOutline }) => {
      const mesh = wingMesh(wingOutline(new Shape()));
      const sides = new Set();
      const edges = new Set();
      for (let i = 0; i < mesh.wing.length; i += 2) { sides.add(mesh.wing[i]); edges.add(Math.round(mesh.wing[i + 1] * 10) / 10); }
      const perWing = 5 * 3;
      const up = [triangleNormalY(mesh, 0) > 0, triangleNormalY(mesh, perWing) > 0];
      return [mesh.position.length / 3, mesh.index.length / 3, [...sides].sort(), [...edges].sort(), up];
    },
    expect: [28, 34, [-1, 0, 1], [0, 0.2, 1], [true, true]],
  },
  {
    name: 'a flipped outline is wound the other way, so its upper side still faces up',
    run: ({ wingMesh, windingOf }) => {
      const square = [{ x: 0.2, y: -0.5 }, { x: 1, y: -0.5 }, { x: 1, y: 0.5 }, { x: 0.2, y: 0.5 }];
      return [windingOf(square) > 0, windingOf([...square].reverse()) > 0, triangleNormalY(wingMesh(square), 0) > 0, triangleNormalY(wingMesh([...square].reverse()), 0) > 0];
    },
    expect: [true, false, true, true],
  },
  {
    name: 'one instanced mesh: flap phases per instance, matrices at the flight, scaled to the wingspan',
    run: ({ createButterflies, planFlights, flyAt }) => {
      const s = { count: 3, seed: 9, scale: 0.2 };
      const b = createButterflies(lit(), s);
      b.update({ time: 4 });
      const m = b.mesh.instanceMatrix.array;
      const at = flyAt(planFlights(s)[1], 4, s).at;
      const x = Math.hypot(m[16], m[17], m[18]);
      return [b.mesh.count, b.mesh.geometry.attributes.aFlap.instanced, Math.fround(at[0]) === m[28], Math.round(x * 1e6) / 1e6, b.mesh.instanceMatrix.needsUpdate];
    },
    expect: [3, true, true, 0.1, true],
  },
  {
    name: 'the host clock beats the wings; reduced motion holds the flock at 0, wings open',
    run: ({ createButterflies }) => {
      const b = createButterflies(lit(), { count: 2 });
      const u = b.mesh.material.uniforms;
      b.update({ time: 7 });
      const moving = [u.uTime.value, u.uStill.value];
      const at7 = b.mesh.instanceMatrix.array[12];
      b.update({ time: 7, still: true });
      const still = b.mesh.instanceMatrix.array[12];
      const held = [u.uTime.value, u.uStill.value];
      b.update({ time: 0 });
      return [moving, held, at7 !== still, still === b.mesh.instanceMatrix.array[12]];
    },
    expect: [[7, 0], [0, 1], true, true],
  },
  {
    name: 'a section recolours the flock; the edge glow is set over a bloom threshold of 1',
    run: ({ createButterflies }) => {
      const b = createButterflies(lit(), { count: 1 });
      b.setColors({ upper: '#ff0000' });
      const u = b.mesh.material.uniforms;
      return [[u.uUpper.value.x, u.uUpper.value.y], Math.round(u.uUnder.value.y * 255), u.uGlow.value > 1, b.mesh.material.side];
    },
    expect: [[1, 0], 162, true, 'both'],
  },
];

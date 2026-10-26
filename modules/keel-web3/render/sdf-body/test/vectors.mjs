// A stand-in for the parts of keel/lit the module calls: enough to check what it sets.
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class V4 { constructor(x = 0, y = 0, z = 0, w = 0) { this.set(x, y, z, w); } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
class Obj { constructor() { Object.assign(this, { visible: true, frustumCulled: true, castShadow: false, receiveShadow: false, renderOrder: 0, position: new V3(), scale: new V3(1, 1, 1), children: [] }); } add(...o) { this.children.push(...o); } }
class Mesh extends Obj { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Instanced extends Mesh { constructor(g, m, count) { super(g, m); this.count = count; this.instanceMatrix = { needsUpdate: false }; this.at = []; } setMatrixAt(i, m) { this.at[i] = { ...m.p }; } }
class Material { constructor(p) { Object.assign(this, p); this.disposed = false; } dispose() { this.disposed = true; } }
class Color { constructor(v) { this.value = v; } set(v) { this.value = v; return this; } }
class M4 { makeScale(x) { this.p = { s: x }; return this; } setPosition(x, y, z) { Object.assign(this.p, { x, y, z }); return this; } }
const Geo = class { dispose() { this.disposed = true; } };
const lit = { Group: Obj, Mesh, Instances: Instanced, box: () => new Geo(), sphere: () => new Geo(), CustomMaterial: Material, FlatMaterial: Material, Vector3: V3, Vector4: V4, Color, Matrix4: M4 };

const light = { sun: [0, 1, 0], sunColor: [3, 3, 3], sky: [1, 1, 1], ground: [0.2, 0.2, 0.2] };
const body = (x = 0) => ({
  capsules: [
    { a: [x - 0.3, 0.4, 0], b: [x + 0.3, 0.4, 0], r: 0.15, role: 'coat' },
    { a: [x + 0.35, 0.55, 0], b: [x + 0.35, 0.55, 0], r: 0.1, role: 'coat' },
    { a: [x + 0.42, 0.58, 0.05], b: [x + 0.42, 0.58, 0.05], r: 0.02, role: 'eye' },
    { a: [x - 0.3, 0.4, 0], b: [x - 0.2, 0.0, 0], r: 0.04, role: 'alt', flat: 0.3, up: [0, 0, 1] },
  ],
  palette: { coat: '#c08040', eye: '#101010', alt: '#806040' },
});
const slots = (bodies) => bodies.group.children.filter((c) => c.material?.uniforms);

export default [
  {
    name: 'each body gets one marching box that wraps all its parts, centred on them',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit);
      bodies.draw([body(0), body(2)], light);
      const [a, b] = slots(bodies);
      return [slots(bodies).length, a.visible && b.visible, a.scale.x > 0.9 && a.scale.y > 0.6, Math.round(b.position.x - a.position.x)];
    },
    expect: [2, true, true, 2],
  },
  {
    name: 'parts land in the uniforms; eyes are tagged crisp and flat parts carry their thin axis',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit);
      bodies.draw([body()], light);
      const u = slots(bodies)[0].material.uniforms;
      const thin = u.uU.value[3];
      return [u.uCount.value, u.uB.value[2].w >= 64, u.uB.value[0].w < 64, Math.round(thin.z * 100) / 100, thin.w];
    },
    expect: [4, true, true, 1, 0.3],
  },
  {
    name: 'fewer bodies next frame hide the spare boxes; none are rebuilt',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit);
      bodies.draw([body(0), body(1), body(2)], light);
      const before = slots(bodies);
      bodies.draw([body(0)], light);
      const after = slots(bodies);
      return [after.length, before.every((s, i) => s === after[i]), after.map((s) => s.visible)];
    },
    expect: [3, true, [true, false, false]],
  },
  {
    name: 'glow roles and per-body lit roles light themselves',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit);
      const glowing = { ...body(), capsules: [...body().capsules, { a: [0, 1, 0], b: [0, 1, 0], r: 0.03, role: 'glow' }], palette: { ...body().palette, glow: '#fff080' }, lit: ['eye'] };
      bodies.draw([glowing], light);
      const litRoles = slots(bodies)[0].material.uniforms.uLit.value;
      return [litRoles.filter((v) => v === 1).length];
    },
    expect: [2],
  },
  {
    name: 'shadows: a proxy of spheres along every part, three per part',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit, { shadows: true });
      bodies.draw([body(0), body(1)], light);
      const proxy = bodies.group.children.find((c) => c instanceof Instanced);
      return [proxy.castShadow, proxy.count, proxy.instanceMatrix.needsUpdate];
    },
    expect: [true, 24, true],
  },
  {
    name: 'the shader is built for the part budget and marches with true depth',
    run: ({ createSdfBodies }) => {
      const bodies = createSdfBodies(lit, { maxParts: 20 });
      bodies.draw([body()], light);
      const shader = slots(bodies)[0].material.fragmentShader;
      return [shader.includes('#define MAXP 20'), shader.includes('gl_FragDepth'), slots(bodies)[0].material.side === 'back'];
    },
    expect: [true, true, true],
  },
];

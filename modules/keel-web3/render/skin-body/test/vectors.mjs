class Node { position = { set() {} }; rotation = { y: 0 }; children = []; add(n) { this.children.push(n); } remove(n) { this.children = this.children.filter((c) => c !== n); } }
const lit = (made) => ({
  Group: Node,
  Mesh: class extends Node { constructor(geometry) { super(); this.geometry = geometry; } },
  Geometry: class { names = []; setAttribute(name) { this.names.push(name); made.push(name); } setIndex() {} dispose() {} },
  Attribute: class {},
  CustomMaterial: class { constructor(p) { this.uniforms = p.uniforms; } dispose() {} },
  Vector3: class { set() {} },
  Vector4: class { set() {} },
  Color: class { r = 0; g = 0; b = 0; set() { return this; } },
});
const mesh = { position: new Float32Array(9), normal: new Float32Array(9), role: new Uint8Array(3), roles: ['skin'], palette: { skin: '#c89878' }, bones: new Uint8Array(6), weight: new Float32Array(3), fabric: new Uint8Array(3), loose: new Float32Array(3), cloth: new Float32Array(12), shade: new Float32Array(3), soft: new Float32Array(3), index: new Uint32Array([0, 1, 2]) };

export default [
  {
    name: 'a mesh goes in with its skinning attributes, and comes out again when removed',
    run: ({ createSkinBodies }) => {
      const made = [];
      const bodies = createSkinBodies(lit(made));
      const one = bodies.add(mesh);
      one.pose(new Float32Array(24 * 12), [0, 0, 0], 0);
      const added = bodies.group.children.length;
      one.remove();
      return [added, bodies.group.children.length, ['aBones', 'aWeight', 'aFabric', 'aLoose', 'aCloth', 'aColor'].every((n) => made.includes(n))];
    },
    expect: [1, 0, true],
  },
];

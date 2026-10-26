const flat = { y: 0, radius: 4 };
const planter = { y: 0, radius: 4, lip: () => 2, wall: { depth: 1, flare: 0 } };
const valley = () => 0;
const columnLength = (m, i, c) => Math.hypot(m[i * 16 + c * 4], m[i * 16 + c * 4 + 1], m[i * 16 + c * 4 + 2]);

export default [
  {
    name: 'every part is on by default; a plugin string turns parts off and back on',
    run: ({ treeFeatures, TREE_FEATURES }) => {
      const all = treeFeatures();
      const some = treeFeatures('-roots, litter=off, fruit=on, nonsense');
      const object = treeFeatures({ snow: false });
      return [TREE_FEATURES.every((name) => all[name]), some.roots, some.litter, some.fruit, some.leaves, object.snow, object.roots];
    },
    expect: [true, false, false, true, true, false, true],
  },
  {
    name: 'the seeded stream and hash are stable',
    run: ({ seededRandom, hash32 }) => {
      const a = seededRandom(42), b = seededRandom(42);
      const same = [a(), a(), a()].every((value) => value === b());
      return [same, hash32(7) === hash32(7), hash32(7) !== hash32(8), a() < 1];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'a wood segment sits at its midpoint, long along its axis and thick across',
    run: ({ writeSegment }) => {
      const m = new Float32Array(16);
      writeSegment(m, 0, [0, 0, 0], [0, 2, 0], 0.1);
      return [m[12], m[13], m[14], Math.round(columnLength(m, 0, 1) * 100) / 100, Math.round(columnLength(m, 0, 0) * 100) / 100];
    },
    expect: [0, 1, 0, 2.1, 0.2],
  },
  {
    name: 'a zero-length segment and a cleared slot hide below the world',
    run: ({ writeSegment, clearSlot }) => {
      const m = new Float32Array(32);
      writeSegment(m, 0, [1, 1, 1], [1, 1, 1], 0.1);
      clearSlot(m, 1);
      return [m[13], m[29], m[0], m[31]];
    },
    expect: [-50, -50, 0, 1],
  },
  {
    name: 'the wind leaves the trunk foot still and bends the top',
    run: ({ sway }) => {
      const foot = sway({ x: 0, z: 0 }, 0, 0, 0, 3.2, 1, 6);
      const top = sway({ x: 0, z: 0 }, 0, 6, 0, 3.2, 1, 6);
      return [Math.hypot(foot.x, foot.z) < 1e-6, Math.hypot(top.x, top.z) > 0];
    },
    expect: [true, true],
  },
  {
    name: 'roots grow with the trunk; on a planter the long ones roll over the lip and tuck under',
    run: ({ rootPath, ROOT_SEGMENTS }) => {
      const young = rootPath({ angle: 0, reach: 1 }, 0.02, flat);
      const old = rootPath({ angle: 0, reach: 1 }, 0.3, flat);
      const reach = (points) => Math.hypot(points.at(-1).x, points.at(-1).z);
      const over = rootPath({ angle: 0, reach: 1 }, 0.3, planter);
      return [old.length, ROOT_SEGMENTS + 1, reach(old) > reach(young), over.some((p) => p.y < -0.3), over.some((p) => p.gone)];
    },
    expect: [19, 19, true, true, true],
  },
  {
    name: 'forest places keep their gap, stay in the ring and skip ground that refuses them',
    run: ({ forestPlaces }) => {
      const places = forestPlaces({ seed: 9, count: 40, inner: 10, outer: 30, variants: 3, height: valley, gap: 2 });
      const none = forestPlaces({ seed: 9, count: 40, inner: 10, outer: 30, variants: 3, height: () => null });
      const spaced = places.every((a, i) => places.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= 2));
      const ring = places.every((p) => { const r = Math.hypot(p.x, p.z); return r >= 10 - 1e-6 && r <= 30 + 1e-6; });
      return [places.length > 20, spaced, ring, places.every((p) => p.variant >= 0 && p.variant < 3), none.length];
    },
    expect: [true, true, true, true, 0],
  },
  {
    name: 'the same seed places the same forest',
    run: ({ forestPlaces }) => {
      const input = { seed: 5, count: 12, inner: 8, outer: 20, variants: 2, height: valley };
      return JSON.stringify(forestPlaces(input)) === JSON.stringify(forestPlaces(input));
    },
    expect: true,
  },
  {
    name: 'each conifer grows its own needles; broadleaf species keep the leaf blade',
    run: ({ speciesBlade, treeShapes }) => {
      class Geometry { constructor() { this.attributes = {}; } setAttribute(name, value) { this.attributes[name] = value; } computeVertexNormals() {} }
      class Attribute { constructor(array, size) { this.array = array; this.itemSize = size; } }
      const lit = { Geometry, Attribute, cylinder: () => new Geometry(), icosahedron: () => new Geometry(), box: () => new Geometry() };
      const pine = speciesBlade(lit, 'pine'), spruce = speciesBlade(lit, 'spruce'), redwood = speciesBlade(lit, 'redwood');
      const reach = (g) => Math.max(...g.attributes.position.array.filter((_, i) => i % 3 === 1));
      return [pine !== spruce, spruce !== redwood, pine === speciesBlade(lit, 'pine'), speciesBlade(lit, 'cherry') === treeShapes(lit).blade, reach(pine) > reach(spruce) + 0.15];
    },
    expect: [true, true, true, true, true],
  },
  {
    name: 'the breeze rises and falls, wanders slowly in direction, and only rarely dies to a calm',
    run: ({ breezeAt }) => {
      const samples = Array.from({ length: 7200 }, (_, k) => breezeAt(k * 2, 0.4, 7));
      const calm = samples.filter((b) => b.wind < 0.01).length / samples.length;
      const strongest = Math.max(...samples.map((b) => b.wind));
      const weakest = Math.min(...samples.filter((b) => b.wind >= 0.01).map((b) => b.wind));
      const turn = Math.max(...samples.slice(1).map((b, k) => Math.abs(b.dir - samples[k].dir)));
      const again = breezeAt(1234, 0.4, 7);
      return [calm > 0 && calm < 0.1, strongest > weakest * 2, turn < 0.05, again.wind === breezeAt(1234, 0.4, 7).wind];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'a tree leans downwind, whichever way the wind blows, and stands still in a calm but for breathing',
    run: ({ sway }) => {
      const lean = (dir, wind) => {
        let along = 0;
        let across = 0;
        for (let t = 0; t < 60; t += 0.25) {
          const o = sway({ x: 0, z: 0 }, 0.5, 6, 0.3, t, wind, 6, dir);
          along += o.x * Math.cos(dir) + o.z * Math.sin(dir);
          across += Math.abs(-o.x * Math.sin(dir) + o.z * Math.cos(dir));
        }
        return { along, across };
      };
      const east = lean(0, 0.4);
      const north = lean(Math.PI / 2, 0.4);
      const still = lean(0, 0);
      return [east.along > east.across * 2, north.along > north.across * 2, Math.abs(still.along) < east.along * 0.1];
    },
    expect: [true, true, true],
  },
];

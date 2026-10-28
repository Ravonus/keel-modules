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
  {
    name: 'the pixel-scale looks (sprays, clumps, rootSink) are on by default and each can be turned off',
    run: ({ treeFeatures }) => {
      const all = treeFeatures();
      const off = treeFeatures('-sprays,clumps=off,-rootSink');
      return [all.sprays, all.clumps, all.rootSink, off.sprays, off.clumps, off.rootSink, off.leaves];
    },
    expect: [true, true, true, false, false, false, true],
  },
  {
    name: 'a leaf blade is written in place: unit axes scaled by its size, square to each other, at its stalk',
    run: ({ writeBlade }) => {
      // The pre-scalar version, kept here as the reference the in-place one must match.
      const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return l > 1e-6 ? [x / l, y / l, z / l] : [0, 0, 0]; };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const zero = (v) => v[0] === 0 && v[1] === 0 && v[2] === 0;
      const reference = (p, n, size, m, long) => {
        let y = norm(n[0], n[1] - m.droop, n[2]); if (zero(y)) y = [0, 1, 0];
        let x = norm(...cross([0, 1, 0], y)); if (zero(x)) x = [1, 0, 0];
        const z = norm(...cross(x, y));
        const c = Math.cos(m.twist), s = Math.sin(m.twist), w = size * 1.05, l = size * long * (1 + m.nod * 0.15);
        return [(x[0] * c + z[0] * s) * w, (x[1] * c + z[1] * s) * w, (x[2] * c + z[2] * s) * w, 0, y[0] * l, y[1] * l, y[2] * l, 0, (z[0] * c - x[0] * s) * w, (z[1] * c - x[1] * s) * w, (z[2] * c - x[2] * s) * w, 0, p[0], p[1], p[2], 1];
      };
      let worst = 0;
      const m = new Float32Array(16);
      for (let k = 0; k < 200; k += 1) {
        const n = k === 0 ? [0, 0.4, 0] : k === 1 ? [0, -1, 0] : [Math.sin(k * 1.3), Math.cos(k * 0.7), Math.sin(k * 2.9)];
        const motion = { droop: (k % 7) * 0.1, twist: k * 0.37, nod: Math.sin(k) * 0.2 };
        writeBlade(m, 0, [k, -k, 0.5], n, 0.3, motion, 1 + (k % 3));
        const want = reference([k, -k, 0.5], n, 0.3, motion, 1 + (k % 3));
        for (let i = 0; i < 16; i += 1) worst = Math.max(worst, Math.abs(m[i] - want[i]));
      }
      return [worst < 1e-5];
    },
    expect: [true],
  },
  {
    name: 'a blossom spray is a few flower heads, lit near white on top and a deeper rose underneath',
    run: ({ sprayGeometry }) => {
      class Geometry { constructor() { this.attributes = {}; } setAttribute(name, value) { this.attributes[name] = value; } computeVertexNormals() {} dispose() {} }
      class Attribute { constructor(array, size) { this.array = array; this.itemSize = size; } }
      // A unit icosahedron, non-indexed like keel/lit's.
      const g = (1 + Math.sqrt(5)) / 2;
      const c = [-1, g, 0, 1, g, 0, -1, -g, 0, 1, -g, 0, 0, -1, g, 0, 1, g, 0, -1, -g, 0, 1, -g, g, 0, -1, g, 0, 1, -g, 0, -1, -g, 0, 1];
      const f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
      const icosahedron = () => { const geo = new Geometry(); geo.setAttribute('position', new Attribute(Float32Array.from(f.flatMap((k) => { const l = Math.hypot(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]); return [c[k * 3] / l, c[k * 3 + 1] / l, c[k * 3 + 2] / l]; })), 3)); return geo; };
      const spray = sprayGeometry({ Geometry, Attribute, icosahedron });
      const pos = spray.attributes.position.array, col = spray.attributes.color.array;
      let top = -1, bottom = -1;
      for (let i = 0; i < pos.length / 3; i += 1) {
        if (top < 0 || pos[i * 3 + 1] > pos[top * 3 + 1]) top = i;
        if (bottom < 0 || pos[i * 3 + 1] < pos[bottom * 3 + 1]) bottom = i;
      }
      const rose = (i) => col[i * 3] / col[i * 3 + 1];
      return [pos.length / 3, col[top * 3] > col[bottom * 3], rose(bottom) > rose(top), Math.max(...pos) < 1];
    },
    expect: [300, true, true, true],
  },
  {
    name: 'rootBreak is on by default and can be turned off on its own',
    run: ({ treeFeatures }) => {
      const off = treeFeatures('-rootBreak');
      return [treeFeatures().rootBreak, off.rootBreak, off.rootSink, off.roots];
    },
    expect: [true, false, true, true],
  },
  {
    name: 'a young tree breaks nothing: no heave, no burst, no shards; an unbroken plan draws the same root as none',
    run: ({ rootBreaks, rootShards, rootPath, NO_ROOT_BREAK }) => {
      const pot = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 1.1, flare: 0 } };
      const roots = [0, 1.3, 2.6, 3.9, 5.2].map((angle) => ({ angle, reach: 1.1 }));
      const plans = rootBreaks(roots, 0.3, pot, 99);
      const same = JSON.stringify(rootPath(roots[0], 0.3, pot)) === JSON.stringify(rootPath(roots[0], 0.3, pot, NO_ROOT_BREAK));
      return [plans.every((p) => p.heave === 0 && p.burst === 0), rootShards(roots[0], 0, 0.3, pot, plans[0], 99).length, same];
    },
    expect: [true, 0, true],
  },
  {
    name: 'an old tree on a stone pot heaves every root and, seeded, bursts some (not all) out through the side',
    run: ({ rootBreaks }) => {
      const pot = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 1.1, flare: 0 } };
      const roots = [0, 1.3, 2.6, 3.9, 5.2].map((angle) => ({ angle, reach: 1.1 }));
      const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);
      const plans = seeds.map((seed) => rootBreaks(roots, 0.9, pot, seed));
      const again = JSON.stringify(rootBreaks(roots, 0.9, pot, 3)) === JSON.stringify(plans[0]);
      const bursting = plans.map((list) => list.filter((p) => p.burst > 0).length);
      return [again, plans.every((list) => list.every((p) => p.heave === 1)), bursting.some((n) => n === 0), bursting.some((n) => n > 0), bursting.every((n) => n < roots.length)];
    },
    expect: [true, true, true, true, true],
  },
  {
    name: 'a burst root dives short of the lip, comes out of the wall partway down, swells there and dangles below the foot',
    run: ({ rootPath }) => {
      const pot = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 1.1, flare: 0 } };
      const path = rootPath({ angle: 0, reach: 1.1 }, 0.9, pot, { heave: 1, burst: 0.45, hang: 1 });
      const r = (p) => Math.hypot(p.x, p.z);
      const outside = path.filter((p) => r(p) > 4.5);
      const top = outside[0];
      const thickest = Math.max(...outside.slice(0, 3).map((p) => p.radius));
      return [path.some((p) => r(p) > 3.6 && r(p) < 4.5 && p.y < -0.2), top.y < -0.3 && top.y > -0.9, thickest > path[path.length - 4].radius, Math.min(...path.map((p) => p.y)) < -1.1, path.every((p) => r(p) < 5.2 || p.gone)];
    },
    expect: [true, true, true, true, true],
  },
  {
    name: 'a hard planter (metal, gems) is only cracked at the rim: no burst, a couple of small chunks',
    run: ({ rootBreaks, rootShards }) => {
      const roots = [0, 1.3, 2.6, 3.9, 5.2].map((angle) => ({ angle, reach: 1.1 }));
      const metal = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 0.3, flare: 0 } };
      const gem = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 1.1, flare: 0 }, planter: { hard: true } };
      const bursts = [3, 11, 29, 47].flatMap((seed) => [...rootBreaks(roots, 0.9, metal, seed), ...rootBreaks(roots, 0.9, gem, seed)]).filter((p) => p.burst > 0).length;
      const plan = rootBreaks(roots, 0.9, metal, 3)[0];
      const shards = rootShards(roots[0], 0, 0.9, metal, plan, 3);
      return [bursts, shards.length >= 1 && shards.length <= 3, shards.every((s) => s.y > -0.2)];
    },
    expect: [0, true, true],
  },
  {
    name: 'a burst breaks a fixed budget of chunks round its hole, in the planter colours plus the dark of the break',
    run: ({ rootShards, ROOT_SHARDS }) => {
      const pot = { y: 0, radius: 4, rootReach: 4.5, lip: () => 4.5, wall: { depth: 1.1, flare: 0 } };
      // Deep enough below the rim for the crack to run up to it.
      const shards = rootShards({ angle: 0, reach: 1.1 }, 0, 0.9, pot, { heave: 1, burst: 0.6, hang: 1 }, 5);
      const r = (s) => Math.hypot(s.x, s.z);
      return [shards.length, shards.length <= ROOT_SHARDS, shards.every((s) => s.tone >= 0 && s.tone <= 3), shards.some((s) => s.tone === 3), shards.filter((s) => s.y < -0.2).every((s) => r(s) > 4.4)];
    },
    expect: [8, true, true, true, true],
  },
  {
    name: 'a shard is written square: its three axes at right angles, scaled by its size, at its place',
    run: ({ writeShard }) => {
      const m = new Float32Array(16);
      writeShard(m, 0, { x: 1, y: 2, z: 3, size: [0.4, 0.2, 0.3], angle: 0.7, tilt: 0.5, roll: 0.3, tone: 0 });
      const col = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const len = (a) => Math.round(Math.hypot(...a) * 1000) / 1000;
      const square = [dot(col(0), col(1)), dot(col(1), col(2)), dot(col(0), col(2))].every((d) => Math.abs(d) < 1e-6);
      return [square, len(col(0)), len(col(1)), len(col(2)), m[12], m[13], m[14]];
    },
    expect: [true, 0.4, 0.2, 0.3, 1, 2, 3],
  },
];

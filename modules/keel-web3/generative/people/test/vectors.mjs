const finite = (body) => body.capsules.every((c) => [...c.a, ...c.b, c.r].every(Number.isFinite));

export default [
  {
    name: 'one seed is one person, the same every time, and the seeds differ',
    run: ({ personOf }) => [JSON.stringify(personOf(7)) === JSON.stringify(personOf(7)), JSON.stringify(personOf(7)) === JSON.stringify(personOf(8))],
    expect: [true, false],
  },
  {
    name: 'every action of many people is whole, within the part budget, with its feet on the ground',
    run: ({ personOf, posePerson, ACTIONS }) => {
      let most = 0, whole = true, low = 0;
      for (let seed = 0; seed < 300; seed += 1) for (const action of ACTIONS) {
        const body = posePerson(personOf(seed), action, 0.13);
        whole &&= finite(body);
        most = Math.max(most, body.capsules.length);
        if (action !== 'sit') for (const c of body.capsules) if (c.part.startsWith('sole')) low = Math.min(low, c.a[1] - c.r);
      }
      return [whole, most <= 76, low > -0.04];
    },
    expect: [true, true, true],
  },
  {
    name: 'there are small children and grey elders, and a child has a bigger head for their height than an adult',
    run: ({ personOf }) => {
      const all = Array.from({ length: 600 }, (_, seed) => personOf(seed));
      const ratio = (age) => { const of = all.filter((p) => p.build.age === age); return of.reduce((n, p) => n + (p.build.head * p.build.size) / p.build.height, 0) / of.length; };
      return [Math.min(...all.map((p) => p.build.height)) < 1, ratio('child') > ratio('adult') * 1.2, all.filter((p) => p.build.age === 'toddler').every((p) => p.face.hair === 'none')];
    },
    expect: [true, true, true],
  },
  {
    name: 'a mesh is whole: body, clothes and hair are shells on bones that exist, and every pose has a matrix for each bone',
    run: ({ personOf, meshOf, poseMesh, BONE_COUNT }) => {
      const p = personOf(3), m = meshOf(p, 0.04), n = m.position.length / 3;
      return [n > 500, m.normal.length === n * 3, m.bones.length === n * 2, m.weight.length === n, m.fabric.length === n, m.loose.length === n, m.index.every((i) => i < n), m.bones.every((b) => b < BONE_COUNT), new Set(m.fabric).size > 2, poseMesh(p, 'jump', 0.5).length === BONE_COUNT * 12, poseMesh(p, 'run', 0.2).every(Number.isFinite)];
    },
    expect: [true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    name: 'there are many kinds of clothes and hair, and loose cloth lags a move, swings back and settles',
    run: ({ personOf, createHang }) => {
      const all = Array.from({ length: 900 }, (_, seed) => personOf(seed));
      const hang = createHang();
      const first = hang.step(0.016, [0, 0, 1]);
      let last = first;
      for (let i = 0; i < 400; i += 1) last = hang.step(0.016, [0, 0, 0]);
      return [new Set(all.map((p) => p.outfit.genre)).size, new Set(all.map((p) => p.build.sex)).size, new Set(all.map((p) => p.hair)).size > 14, first[2] < 0, Math.abs(last[2]) < 1e-3];
    },
    expect: [8, 2, true, true, true],
  },
  {
    name: 'a person is about as tall as their build says',
    run: ({ personOf, posePerson }) => {
      let worst = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const p = personOf(seed);
        const top = Math.max(...posePerson({ ...p, hair: 'bald', outfit: { ...p.outfit, hat: 'none' } }, 'stand', 0).capsules.map((c) => Math.max(c.a[1], c.b[1]) + c.r));
        worst = Math.max(worst, Math.abs(top / p.build.height - 1));
      }
      return worst < 0.1;
    },
    expect: true,
  },
  {
    name: 'a day dresses people for it, a child stays covered at the beach, and skimpy cuts are for the grown',
    run: ({ personOf }) => {
      const all = (weather, costume) => Array.from({ length: 300 }, (_, i) => personOf(i, weather, costume));
      const beach = all('beach');
      const young = (p) => p.build.age !== 'adult' && p.build.age !== 'elder';
      return [
        beach.filter(young).every((p) => p.outfit.top === 'tee' && p.outfit.bottom === 'swim'),
        beach.some((p) => p.outfit.top === 'string'),
        all('rain').some((p) => p.outfit.carry === 'umbrella'),
        all('cold').some((p) => p.outfit.top === 'puffer'),
        all().filter((p) => p.build.sex === 'female').every((p) => p.hair !== 'bald' || p.outfit.costume === 'fursuit'),
        all(undefined, 'fursuit').some((p) => p.outfit.costume === 'fursuit'),
        all(undefined, 'latex').filter(young).every((p) => p.outfit.costume !== 'latex'),
      ];
    },
    expect: [true, true, true, true, true, true, true],
  },
  {
    name: 'bodies differ in bust, seat and height, and every mesh says how its cloth lies',
    run: ({ personOf, meshOf, FABRICS }) => {
      const men = Array.from({ length: 200 }, (_, i) => personOf(i)).filter((p) => p.build.age === 'adult');
      const spread = (f) => Math.max(...men.map(f)) / Math.min(...men.map(f));
      const m = meshOf(personOf(5, 'cold'), 0.04), n = m.position.length / 3;
      return [spread((p) => p.build.bust) > 2, spread((p) => p.build.rear) > 2, spread((p) => p.build.height) > 1.2, m.cloth.length === n * 4, m.cloth.every(Number.isFinite), m.cloth.some((v, i) => i % 4 === 3 && v === 0), FABRICS.fur === 6, [...m.fabric].every((f) => Object.values(FABRICS).includes(f))];
    },
    expect: [true, true, true, true, true, true, true, true],
  },
  {
    name: 'no hand or wrist goes through the trunk, a foot through the ground, or a bone changes length, whatever the body',
    run: ({ personOf, posePerson, ACTIONS }) => {
      const flat = (v) => v;
      let inside = 0, under = 0, stretched = 0;
      const check = (p, action, t) => {
        const s = posePerson(p, action, t).skeleton;
        for (const side of [s.left, s.right]) {
          const { arm, leg } = side;
          const y = arm.wrist[1];
          if (y > s.pelvis[1] && y < s.chest[1] && Math.hypot(arm.wrist[0] / (p.build.hip * 0.8), (arm.wrist[2] - s.pelvis[2]) / (p.build.hip * 0.6)) < 0.8) inside += 1;
          if (leg.toe[1] < 0.08) under += 1;
          if (Math.abs(Math.hypot(...arm.elbow.map((v, i) => v - arm.shoulder[i])) - 0.186 * (arm.len ?? flat(1.7))) > 0.1) stretched += 1;
        }
      };
      for (let seed = 0; seed < 40; seed += 1) for (const action of ACTIONS) for (const t of [0, 0.2, 0.4, 0.7]) check(personOf(seed), action, t);
      return [inside, under, stretched];
    },
    expect: [0, 0, 0],
  },
  {
    name: 'soft flesh moves on a grown body in motion, and on nobody young or standing still',
    run: ({ personOf, meshOf, jiggleAt }) => {
      const list = Array.from({ length: 60 }, (_, i) => personOf(i));
      const grown = list.find((p) => p.build.age === 'adult'), young = list.find((p) => p.build.age === 'child' || p.build.age === 'teen');
      const size = (v) => Math.hypot(...v);
      return [meshOf(young, 0.04).soft.every((v) => v === 0), meshOf(grown, 0.04).soft.some((v) => v > 0), size(jiggleAt(grown, 'run', 1.1)) > 0.0005, size(jiggleAt(grown, 'run', 1.1)) < 0.01, size(jiggleAt(grown, 'stand', 1.1)) < 0.001, meshOf(grown, 0.04).shade.every((v) => v >= 0 && v <= 1)];
    },
    expect: [true, true, true, true, true, true],
  },
  {
    name: 'nobody moves quite like anybody else: hands differ, sometimes on one body, and a stride stays whole',
    run: ({ personOf, skeletonOf, strideOf }) => {
      const people = Array.from({ length: 80 }, (_, i) => personOf(i * 3 + 1));
      const hands = new Set(people.map((p) => p.gait.running[0].toFixed(1)));
      const uneven = people.filter((p) => Math.abs(p.gait.running[0] - p.gait.running[1]) > 0.2).length;
      const paces = new Set(people.map((p) => strideOf(p, 'run').toFixed(2)));
      const whole = people.every((p) => [0, 1, 2, 3, 4, 5].every((a) => Object.values(skeletonOf(p, 'run', a)).length > 0 && skeletonOf(p, 'walk', a).left.arm.thumb.every(Number.isFinite)));
      return [hands.size >= 4, uneven >= 8, paces.size >= 12, whole];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'hair is locks near to, fewer further off, and the solid shape far away, and a tie has its elastic',
    run: ({ personOf, meshOf }) => {
      const list = Array.from({ length: 400 }, (_, i) => personOf(i)).filter((p) => p.outfit.hat === 'none');
      const pony = list.find((p) => p.hair === 'pony'), points = (cell) => meshOf(pony, cell).position.length / 3;
      const near = points(0.016), mid = points(0.024), far = points(0.04);
      const mesh = meshOf(pony), trim = mesh.roles.indexOf('trim');
      return [near > mid, mid > far, mesh.role.includes(trim), near < 60000];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'ears are built near to, the head alone keeps them far away, and pairs stand differently',
    run: ({ personOf, meshOf }) => {
      const list = Array.from({ length: 400 }, (_, i) => personOf(i)).filter((p) => p.outfit.hat === 'none' && p.outfit.costume !== 'fursuit' && p.hair === 'crop' && p.build.age === 'adult');
      const skin = (mesh) => mesh.roles.indexOf('skin'), tall = (mesh) => Math.max(...mesh.position.filter((_, i) => i % 3 === 1));
      const wide = (mesh) => { let most = 0; const top = tall(mesh); for (let v = 0; v < mesh.role.length; v += 1) if (mesh.role[v] === skin(mesh) && mesh.position[v * 3 + 1] > top * 0.86) most = Math.max(most, Math.abs(mesh.position[v * 3])); return most; };
      const near = list.slice(0, 4).map((p) => wide(meshOf(p, 0.016))), far = list.slice(0, 4).map((p) => wide(meshOf(p, 0.04)));
      return [near.every((n, i) => n > far[i]), new Set(near.map((n) => n.toFixed(4))).size >= 2];
    },
    expect: [true, true],
  },
  {
    name: 'loose hair goes over the ears or tucks behind them',
    run: ({ personOf, tuckOf }) => {
      const seen = new Set(Array.from({ length: 400 }, (_, i) => personOf(i)).filter((p) => p.hair === 'long').map((p) => tuckOf(p).join()));
      return [seen.has('false,false'), seen.has('true,true'), seen.size >= 3];
    },
    expect: [true, true, true],
  },
];

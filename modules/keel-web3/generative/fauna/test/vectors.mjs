const finite = (bodies) => bodies.every((body) => body.capsules.every((c) => [...c.a, ...c.b, c.r].every(Number.isFinite)));
const stage = (night = false) => ({ radius: 3, top: 0, trunk: { base: [0, 0, 0], top: [0, 2.5, 0], r: 0.3 }, perches: [{ p: [0.8, 2.2, 0], d: [1, 0, 0], r: 0.08 }], night });
const casts = (count, extra = {}) => Array.from({ length: count }, (_, seed) => ({ seed, region: 'rockies', world: 'nature', season: 'summer', radius: 3, ...extra }));

export default [
  {
    name: 'the same seed always casts the same animals; casting is deterministic',
    run: ({ castFor }) => {
      const a = castFor({ seed: 41, region: 'tokyo', world: 'nature', season: 'spring', radius: 3 });
      const b = castFor({ seed: 41, region: 'tokyo', world: 'nature', season: 'spring', radius: 3 });
      return [JSON.stringify(a) === JSON.stringify(b), typeof a.label === 'string'];
    },
    expect: [true, true],
  },
  {
    name: 'animals are rare: many scenes have none, groups are rarer than lone animals, mixed company rarest',
    run: ({ castFor }) => {
      const tally = { none: 0, solo: 0, group: 0, mixed: 0 };
      for (const input of casts(2000)) {
        const cast = castFor(input);
        const members = cast.groups.flatMap((group) => group.members).length;
        if (members === 0) tally.none += 1;
        else if (cast.groups.some((group) => group.kind === 'mixed') || cast.groups.length > 1) tally.mixed += 1;
        else if (members === 1) tally.solo += 1;
        else tally.group += 1;
      }
      return [tally.none > 600, tally.solo > tally.group, tally.group > tally.mixed, tally.mixed > 0];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'a forced species and company are honoured, and "none" empties the scene',
    run: ({ castFor }) => {
      const pack = castFor({ seed: 3, region: 'rockies', world: 'nature', radius: 3, species: 'wolf', group: 'pack' });
      const none = castFor({ seed: 3, region: 'rockies', world: 'nature', radius: 3, species: 'none' });
      const members = pack.groups.flatMap((group) => group.members);
      return [members.length > 1, members.every((m) => m.species === 'wolf'), none.groups.length];
    },
    expect: [true, true, 0],
  },
  {
    name: 'every idle matrix row is a probability distribution, and night makes a day animal drowsy',
    run: ({ idleMatrix, SPECIES_IDS }) => {
      const rowsOk = SPECIES_IDS.every((id) => idleMatrix(id).rows.every((row) => Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9 && row.every((p) => p >= 0)));
      const sleepOf = (night) => { const m = idleMatrix('deer', { night }); const i = m.actions.indexOf('sleep'); return m.rows.reduce((sum, row) => sum + (row[i] ?? 0), 0); };
      return [rowsOk, sleepOf(true) > sleepOf(false)];
    },
    expect: [true, true],
  },
  {
    name: 'two-bone IK reaches a target in range and keeps both bone lengths',
    run: ({ solveTwoBone }) => {
      const { mid, end } = solveTwoBone([0, 0, 0], [0.3, 0.8, 0.1], 0.6, 0.6, [0, 0, 1]);
      const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      return [Math.abs(len([0, 0, 0], mid) - 0.6) < 1e-9, Math.abs(len(mid, end) - 0.6) < 1e-9, len(end, [0.3, 0.8, 0.1]) < 1e-9];
    },
    expect: [true, true, true],
  },
  {
    name: 'every species poses with finite parts in every action it can take',
    run: ({ poseSpecies, idleMatrix, SPECIES_IDS }) => SPECIES_IDS.every((id) => idleMatrix(id).actions.every((action) => [0, 0.7, 2.3].every((t) => finite([poseSpecies(id, action, t)])))),
    expect: true,
  },
  {
    name: 'a herd moves over time, stays finite, and stays inside its ground',
    run: ({ castFor, createHerd }) => {
      const herd = createHerd(castFor({ seed: 9, region: 'rockies', world: 'nature', radius: 3, species: 'deer', group: 'family' }));
      const frames = [0, 4, 9, 30].map((t) => herd.at(t, stage()));
      const moved = JSON.stringify(frames[0]?.map((b) => b.at)) !== JSON.stringify(frames[3]?.map((b) => b.at));
      const inside = frames.flat().every((b) => Math.hypot(b.at[0], b.at[2]) <= 3.2);
      return [frames.every(finite), moved, inside, (frames[0]?.length ?? 0) >= 2];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'fireflies only show at night',
    run: ({ castFor, createHerd }) => {
      const herd = createHerd(castFor({ seed: 5, region: 'rockies', world: 'nature', radius: 3, species: 'firefly', group: 'pack' }));
      return [herd.at(10, stage(false)).length, herd.at(10, stage(true)).length > 0];
    },
    expect: [0, true],
  },
  {
    name: 'sky traffic is finite and only flies when the cast has a sky plan',
    run: ({ castFor, createHerd }) => {
      let flown = 0;
      let ok = true;
      for (const input of casts(300)) {
        const cast = castFor(input);
        const bodies = [5, 40, 120].flatMap((t) => createHerd(cast).sky(t, { radius: 3 }));
        if (!cast.sky.flock && !cast.sky.plane && bodies.length > 0) ok = false;
        ok &&= finite(bodies);
        flown += bodies.length > 0 ? 1 : 0;
      }
      return [ok, flown > 0];
    },
    expect: [true, true],
  },
  {
    name: 'a command sends an animal where it is told, its own way, and only the one named',
    run: ({ castFor, createHerd }) => {
      const cast = castFor({ seed: 7, region: 'rockies', world: 'nature', radius: 3, species: 'fox', group: 'pair' });
      const herd = createHerd(cast);
      const at = stage();
      for (let t = 0; t < 4; t += 0.5) herd.at(t, at);
      const sent = herd.command(4, { id: '0.0', to: { on: 'ground', x: 1.6, z: -1.2 } }, at);
      let body = null;
      for (let t = 4; t <= 30; t += 0.5) body = herd.at(t, at).find((each) => each.id === '0.0') ?? body;
      const everyone = herd.command(30, { to: { on: 'ground', x: -1.5, z: 1 } }, at);
      return [sent, Math.hypot(body.at[0] - 1.6, body.at[2] + 1.2) < 0.4, everyone.length];
    },
    expect: [['0.0'], true, 2],
  },
  {
    name: 'a tap picks the animal it passes through, the nearest first, and nothing when it misses',
    run: ({ castFor, createHerd, pickBody }) => {
      const herd = createHerd(castFor({ seed: 7, region: 'rockies', world: 'nature', radius: 3, species: 'deer', group: 'pair' }));
      const bodies = herd.at(5, stage());
      const target = bodies[0];
      const centre = target.capsules.find((c) => c.part === 'body')?.a ?? target.at;
      const from = [centre[0], centre[1] + 10, centre[2]];
      const hit = pickBody(bodies, from, [0, -1, 0]);
      const miss = pickBody(bodies, [centre[0] + 50, 10, centre[2]], [0, -1, 0]);
      return [hit?.id === target.id, miss];
    },
    expect: [true, null],
  },
  {
    name: 'a climber keeps to the wood: up the trunk and out along the branch, bearing on the tree as it goes',
    run: ({ castFor, createHerd }) => {
      const path = [{ p: [0, 1.6, 0], r: 0.2 }, { p: [0.5, 1.9, 0], r: 0.1 }, { p: [1.1, 2.1, 0], r: 0.06 }];
      const tree = { ...stage(), trunk: { base: [0, 0, 0], top: [0, 2.5, 0], r: 0.3 }, perches: [{ p: [1.1, 2.1, 0], d: [1, 0, 0], r: 0.06, path }] };
      const herd = createHerd(castFor({ seed: 7, region: 'rockies', world: 'nature', radius: 3, species: 'monkey', group: 'solo' }));
      herd.at(0, tree);
      herd.command(0, { to: { on: 'perch', i: 0 } }, tree);
      let worst = 0;
      let bearing = 0;
      let arrived = null;
      for (let t = 0; t <= 40; t += 0.1) {
        const body = herd.at(t, tree)[0];
        if (body.action !== 'climb') { if (body.contact) arrived = body; continue; }
        if (body.contact) bearing += 1;
        const p = body.at;
        const trunkGap = p[1] <= 1.6 ? Math.hypot(p[0], p[2]) - 0.3 : Infinity;
        let limbGap = Infinity;
        for (let k = 0; k + 1 < path.length; k += 1) {
          const a = path[k].p;
          const b = path[k + 1].p;
          const ab = b.map((v, j) => v - a[j]);
          const u = Math.max(0, Math.min(1, ab.reduce((sum, v, j) => sum + v * (p[j] - a[j]), 0) / ab.reduce((sum, v) => sum + v * v, 0)));
          limbGap = Math.min(limbGap, Math.hypot(...p.map((v, j) => v - (a[j] + ab[j] * u))) - path[k].r);
        }
        if (p[1] > 0.3) worst = Math.max(worst, Math.min(Math.abs(trunkGap), Math.abs(limbGap)));
      }
      return [worst < 0.25, bearing > 10, arrived !== null && arrived.weight > 0];
    },
    expect: [true, true, true],
  },
];

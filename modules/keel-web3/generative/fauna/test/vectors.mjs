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
        if (cast.sky.traffic.length === 0 && bodies.length > 0) ok = false;
        ok &&= finite(bodies);
        flown += bodies.length > 0 ? 1 : 0;
      }
      return [ok, flown > 0];
    },
    expect: [true, true],
  },
  {
    name: 'the sky fits the hour, the weather and the world: bats and satellites by night, balloons and kites only by fair day, saucers in space',
    run: ({ castFor, createHerd }) => {
      const seen = (world, now, hours = 1) => {
        const kinds = new Set();
        for (const input of casts(12, { world })) {
          const herd = createHerd(castFor(input));
          for (let t = 0; t < hours * 3600; t += 3) for (const body of herd.sky(t, { radius: 3, ...now })) kinds.add(body.kind);
        }
        return kinds;
      };
      const night = seen('nature', { night: true });
      const rain = seen('beach', { weather: 'rain' });
      const beach = seen('beach', {});
      const cosmic = seen('cosmic', {});
      const city = seen('city', {});
      return [
        night.has('bat') || night.has('satellite'), night.has('balloon'), night.has('kite'),
        rain.has('kite') || rain.has('balloon'),
        beach.has('kite') || beach.has('balloon'),
        cosmic.has('ufo'), cosmic.has('airliner') || cosmic.has('songbird'),
        city.has('helicopter') || city.has('blimp') || city.has('airliner'),
      ];
    },
    expect: [true, false, false, false, true, true, false, true],
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
    name: 'roots are in the way: sent across one, a bird hops it and a rabbit clears it, never passing through, and one sent onto it stands on top',
    run: ({ castFor, createHerd }) => {
      // One root lying across the way from (-1.4, 0) to (1.4, 0), at x = 0.
      const root = { a: [0, 0.08, -1.2], b: [0, 0.08, 1.2], r: 0.12 };
      const at = { ...stage(), roots: [root] };
      const top = 0.08 + 0.12;
      const crossing = (species, region) => {
        const herd = createHerd(castFor({ seed: 3, region, world: 'nature', radius: 3, species, group: 'solo' }));
        for (let t = 0; t < 2; t += 0.5) herd.at(t, at);
        herd.command(2, { id: '0.0', to: { on: 'ground', x: -1.4, z: 0.3 } }, at);
        for (let t = 2; t < 20; t += 0.5) herd.at(t, at);
        herd.command(20, { id: '0.0', to: { on: 'ground', x: 1.4, z: 0.3 } }, at);
        let lowest = Infinity;
        for (let t = 20; t < 40; t += 0.02) {
          const body = herd.at(t, at).find((each) => each.id === '0.0');
          if (body && Math.abs(body.at[0]) < 0.05) lowest = Math.min(lowest, body.at[1]);
        }
        herd.command(40, { id: '0.0', to: { on: 'ground', x: 0, z: 0.3 } }, at);
        // Where it settles to look about, once it gets there.
        let stood = null;
        for (let t = 40; t < 60 && !stood; t += 0.25) stood = herd.at(t, at).find((each) => each.id === '0.0' && each.action === 'look') ?? null;
        return [lowest >= top - 0.01, Math.abs((stood?.at[1] ?? 0) - top) < 0.03];
      };
      return [...crossing('parrot', 'bali'), ...crossing('rabbit', 'rockies')];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'a bird flies like one: up to a branch overhead it loops out and swoops in from below, down to the ground it glides in, never straight up or down',
    run: ({ castFor, createHerd }) => {
      const at = stage();
      const herd = createHerd(castFor({ seed: 3, region: 'bali', world: 'nature', radius: 3, species: 'parrot', group: 'solo' }));
      for (let t = 0; t < 2; t += 0.5) herd.at(t, at);
      herd.command(2, { id: '0.0', to: { on: 'ground', x: 0.9, z: 0.3 } }, at);
      for (let t = 2; t < 20; t += 0.5) herd.at(t, at);
      const flight = (t0, to) => {
        for (let t = t0 - 10; t < t0; t += 0.5) herd.at(t, at);
        herd.command(t0, { id: '0.0', to }, at);
        const out = [];
        for (let t = t0; t < t0 + 10; t += 0.02) {
          const body = herd.at(t, at).find((each) => each.id === '0.0');
          if (body?.action === 'fly') out.push(body.at);
        }
        return out;
      };
      const steepest = (way) => Math.max(...way.slice(1).map((p, i) => Math.abs(p[1] - way[i][1]) / Math.max(1e-6, Math.hypot(p[0] - way[i][0], p[2] - way[i][2]))));
      const up = flight(20, { on: 'perch', i: 0 });
      const wide = Math.max(...up.map((p) => Math.hypot(p[0] - 0.9, p[2] - 0.3)));
      const last = up.slice(-Math.ceil(up.length * 0.3));
      const perch = up.at(-1)?.[1] ?? 0;
      const below = last.some((p) => p[1] < perch - 0.05) && perch >= (last[0]?.[1] ?? 0);
      const down = flight(40, { on: 'ground', x: -1.2, z: 0.6 });
      const wider = Math.hypot(...[0, 2].map((i) => (down.at(-1)?.[i] ?? 0) - (down[0]?.[i] ?? 0)));
      return [up.length > 10, wide > 0.8, steepest(up) < 1.8, below, steepest(down) < 1.8, wider > 1];
    },
    expect: [true, true, true, true, true, true],
  },
  {
    name: 'perched birds keep out of the trunk, sitting across the branch, and a bird walks a step, hops a little way and flies farther',
    run: ({ castFor, createHerd }) => {
      const at = { ...stage(), perches: [{ p: [0.36, 2, 0], d: [1, 0, 0], r: 0.06 }, { p: [1, 2, 0.1], d: [1, 0, 0], r: 0.06 }] };
      const herd = createHerd(castFor({ seed: 3, region: 'bali', world: 'nature', radius: 3, species: 'parrot', group: 'solo' }));
      for (let t = 0; t < 2; t += 0.5) herd.at(t, at);
      herd.command(2, { id: '0.0', to: { on: 'perch', i: 0 } }, at);
      let body = null;
      for (let t = 2; t < 8; t += 0.1) body = herd.at(t, at).find((each) => each.id === '0.0');
      const out = (p) => Math.hypot(p[0], p[2]);
      const clear = Math.min(...body.capsules.flatMap((c) => [out(c.a) - c.r, out(c.b) - c.r])) > 0.3;
      const across = Math.abs(body.front[0]) < 0.2;
      const gait = (species, d) => {
        const h = createHerd(castFor({ seed: 5, region: 'tokyo', world: 'nature', radius: 3, species, group: 'solo' }));
        for (let t = 0; t < 2; t += 0.5) h.at(t, at);
        h.command(2, { id: '0.0', to: { on: 'ground', x: 1.5, z: 0 } }, at);
        for (let t = 2; t < 12; t += 0.5) h.at(t, at);
        h.command(12, { id: '0.0', to: { on: 'ground', x: 1.5, z: d } }, at);
        return h.at(12.3, at).find((each) => each.id === '0.0').action;
      };
      return [clear, across, gait('crow', 0.3), gait('crow', 2.6), gait('crane', 1.2)];
    },
    expect: [true, true, 'wander', 'fly', 'wander'],
  },
  {
    name: 'every creature has eyes that read: an iris, a pupil and a spark of light, shut when it sleeps',
    run: ({ SPECIES, poseSpecies }) => {
      const seeing = Object.keys(SPECIES).filter((id) => SPECIES[id].plan !== 'bug');
      const has = (body, role) => body.capsules.some((c) => c.role === role);
      const open = seeing.filter((id) => { const body = poseSpecies(id, 'stand'); return has(body, 'pupil') && has(body, 'shine'); });
      const asleep = poseSpecies('fox', 'sleep');
      const most = Math.max(...Object.keys(SPECIES).flatMap((id) => ['stand', 'wander', 'fly', 'climb'].map((act) => poseSpecies(id, act).capsules.length)));
      return [open.length === seeing.length, has(asleep, 'pupil'), most <= 48];
    },
    expect: [true, false, true],
  },
  {
    name: 'coats: each species mostly wears its own colours, no two animals quite alike, and special skins follow the world without crowding out the usual coats',
    run: ({ castFor }) => {
      const members = (world) => casts(1500, { world }).flatMap((input) => castFor(input).groups.flatMap((group) => group.members));
      const nature = members('nature');
      const wolves = nature.filter((m) => m.species === 'wolf');
      const usual = wolves.filter((m) => m.coat === 'grey').length / Math.max(1, wolves.length);
      const pairs = castFor({ seed: 11, region: 'rockies', world: 'nature', radius: 3, species: 'wolf', group: 'pack' }).groups[0].members;
      const alike = new Set(pairs.map((m) => m.palette.coat)).size === pairs.length;
      const share = (list, morph) => list.filter((m) => m.morph === morph).length / Math.max(1, list.length);
      const synth = members('synth');
      const themed = share(synth, 'neon');
      return [usual > 0.45, alike, themed > 0.06 && themed < 0.2, share(synth, 'normal') > 0.75, share(nature, 'neon'), share(nature, 'normal') > 0.85];
    },
    expect: [true, true, true, true, 0, true],
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
  {
    name: 'fruit eaters go and eat the fruit on the stage, each fruit once, and report every meal once',
    run: ({ castFor, createHerd }) => {
      const food = [
        { key: 'fruit:1', p: [1.6, 0.05, 0.4] },
        { key: 'fruit:2', p: [-1.2, 0.05, -1.1] },
        { key: 'fruit:3', p: [0.8, 2.15, 0], perch: 0 },
      ];
      const eat = (species, foodFor) => {
        const herd = createHerd(castFor({ seed: 4, region: 'rockies', world: 'nature', radius: 3, species, group: 'solo' }));
        const eaten = [];
        let near = Infinity;
        for (let t = 0; t < 600; t += 0.25) {
          const left = foodFor.filter((item) => !eaten.includes(item.key));
          const bodies = herd.at(t, { ...stage(), food: left });
          for (const body of bodies) {
            const item = foodFor.find((each) => each.key === body.meal);
            // How close its mouth comes to the fruit it eats.
            for (const c of item ? body.capsules.filter((each) => /head|muzzle|snout|beak|jaw|mouth/.test(each.part)) : []) {
              for (const q of [c.a, c.b]) near = Math.min(near, Math.hypot(...q.map((v, j) => v - item.p[j])));
            }
          }
          eaten.push(...herd.eaten(t));
        }
        return { eaten, near };
      };
      const squirrel = eat('squirrel', food);
      const deer = eat('deer', food);
      const wolf = eat('wolf', food);
      return [
        squirrel.eaten.length === 3 && new Set(squirrel.eaten).size === 3,
        deer.eaten.length === 2 && !deer.eaten.includes('fruit:3'),
        deer.near < 0.3,
        squirrel.near < 0.3,
        wolf.eaten.length,
      ];
    },
    expect: [true, true, true, true, 0],
  },
];

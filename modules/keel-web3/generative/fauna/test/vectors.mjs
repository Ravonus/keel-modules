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
      // (It gets there and looks about, then goes on with its own life.)
      let nearest = Infinity;
      for (let t = 4; t <= 30; t += 0.5) {
        const body = herd.at(t, at).find((each) => each.id === '0.0');
        if (body) nearest = Math.min(nearest, Math.hypot(body.at[0] - 1.6, body.at[2] + 1.2));
      }
      const everyone = herd.command(30, { to: { on: 'ground', x: -1.5, z: 1 } }, at);
      return [sent, nearest < 0.4, everyone.length];
    },
    expect: [['0.0'], true, 2],
  },
  {
    name: 'roots are in the way: sent across one, a bird hops it and a rabbit clears it, never passing through, and one sent onto it stands on top',
    run: ({ castFor, createHerd }) => {
      // One root lying across the way from (-1.4, 0) to (1.4, 0), at x = 0, reaching past where a toy-sized bird stands clear of the trunk.
      const root = { a: [0, 0.08, -1.8], b: [0, 0.08, 1.8], r: 0.12 };
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
      const gait = (species, x, z) => {
        const h = createHerd(castFor({ seed: 5, region: 'tokyo', world: 'nature', radius: 3, species, group: 'solo' }));
        for (let t = 0; t < 2; t += 0.5) h.at(t, at);
        h.command(2, { id: '0.0', to: { on: 'ground', x: 1.5, z: 0 } }, at);
        // Once it is there and looking about (a bird left alone soon flies off round the tree again), send it on.
        let t = 2.1;
        while (t < 30 && h.at(t, at).find((each) => each.id === '0.0').action !== 'look') t += 0.1;
        h.command(t + 0.1, { id: '0.0', to: { on: 'ground', x, z } }, at);
        return h.at(t + 0.4, at).find((each) => each.id === '0.0').action;
      };
      return [clear, across, gait('crow', 1.5, 0.3), gait('crow', -1.2, 1.8), gait('crane', 1.5, 1.2)];
    },
    expect: [true, true, 'wander', 'fly', 'wander'],
  },
  {
    name: 'every creature has eyes that read: an iris, a pupil and a spark of light, shut when it sleeps',
    run: ({ SPECIES, poseSpecies }) => {
      const seeing = Object.keys(SPECIES).filter((id) => SPECIES[id].plan !== 'bug');
      const has = (body, role) => body.capsules.some((c) => c.role === role);
      const open = seeing.filter((id) => { const body = poseSpecies(id, 'stand'); return body.eye !== undefined || (has(body, 'pupil') && has(body, 'shine')); });
      const asleep = poseSpecies('fox', 'sleep');
      const most = Math.max(...Object.keys(SPECIES).flatMap((id) => ['stand', 'wander', 'fly', 'climb'].map((act) => poseSpecies(id, act).capsules.filter((c) => !c.detail).length)));
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
        // (Animals are drawn at a toy scale, so how near is measured in the animal's own size.)
        return { eaten, near: near / herd.cast.groups[0].members[0].size };
      };
      const squirrel = eat('squirrel', food);
      const deer = eat('deer', food);
      const wolf = eat('wolf', food);
      return [
        squirrel.eaten.length === 3 && new Set(squirrel.eaten).size === 3,
        deer.eaten.length === 2 && !deer.eaten.includes('fruit:3'),
        deer.near < 0.35,
        squirrel.near < 1,
        wolf.eaten.length,
      ];
    },
    expect: [true, true, true, true, 0],
  },
  {
    name: 'toy scale: small animals lift, a snake keeps its true size, insects lift 1.6 times, none shrinks; a plain coat is muted',
    run: ({ shownSize, castFor }) => {
      const snake = castFor({ seed: 3, region: 'rockies', world: 'nature', season: 'summer', radius: 3, species: 'snake', morph: 'normal' }).groups[0].members[0];
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(snake.palette.coat.slice(i, i + 2), 16));
      return [shownSize('snake', 1.1), shownSize('butterfly', 0.1).toFixed(2), shownSize('mouse', 0.1) > 0.3, shownSize('deer', 1.2) >= 1.2, g - Math.min(r, b) < 0x9a - 0x3a];
    },
    expect: [1.1, '0.16', true, true, true],
  },
  {
    name: 'four legs in three bones down to a paw, hoof or sole; the head drawn from its outline tapers to the nose; markings are paint-only decals; a deer folds down to lie where a fox sits; every pose fits the 48-part budget',
    run: ({ poseSpecies, SPECIES_IDS }) => {
      const fox = poseSpecies('fox', 'stand', 1).capsules;
      const bones = fox.filter((c) => c.part.startsWith('leg.FL')).map((c) => c.part.split('.').pop()).filter((n) => !['toes', 'claws', 'mass'].includes(n));
      const bib = fox.find((c) => c.part === 'bib');
      // (The muzzle is the head's outline's last part, tapering to the nose; the chest is the torso outline's front.)
      const snout = fox.filter((c) => c.part.startsWith('head.')).at(-1);
      const height = (body) => body.capsules.filter((c) => c.part.startsWith('body.')).at(-1).b[1];
      const deerSit = height(poseSpecies('deer', 'sit', 1)) < height(poseSpecies('deer', 'stand', 1)) * 0.6;
      const foxSit = height(poseSpecies('fox', 'sit', 1)) > height(poseSpecies('fox', 'stand', 1)) * 0.9;
      const actions = ['stand', 'wander', 'run', 'sit', 'lie', 'sleep', 'rear', 'hang', 'fly', 'hover', 'coil'];
      const most = Math.max(...SPECIES_IDS.flatMap((id) => actions.map((a) => poseSpecies(id, a, 1.3).capsules.filter((c) => !c.detail).length)));
      return [bones, bib?.decal === true, snout.r1 < snout.r, deerSit, foxSit, most <= 48];
    },
    expect: [['upper', 'lower', 'cannon', 'paw'], true, true, true, true, true],
  },
  {
    name: 'regions cast their own animals: the same seeds have company in every region, but each region is led by its locals, wears their coats and calls them by their names',
    run: ({ castFor }) => {
      const REGIONS = ['rockies', 'atlantic', 'alps', 'tokyo', 'sydney', 'nairobi', 'bali'];
      const seeds = Array.from({ length: 600 }, (_, s) => (Math.imul(s + 1, 2654435761) ^ 0x7a17a) >>> 0);
      const casts = Object.fromEntries(REGIONS.map((region) => [region, seeds.map((seed) => castFor({ seed, region, world: 'nature', season: 'summer', radius: 3.3 }))]));
      // Whether there is anyone at all never depends on the region.
      const sameOdds = seeds.every((_, i) => REGIONS.every((region) => (casts[region][i].groups.length > 0) === (casts.rockies[i].groups.length > 0)));
      const species = (region) => new Set(casts[region].flatMap((cast) => cast.groups.flatMap((g) => g.members.map((m) => m.species))));
      const names = (region) => new Set(casts[region].flatMap((cast) => cast.groups.flatMap((g) => g.members.map((m) => m.label))));
      const tokyo = species('tokyo');
      const bali = species('bali');
      const sydney = species('sydney');
      const nairobi = species('nairobi');
      return [
        sameOdds,
        tokyo.has('tanuki') && tokyo.has('macaque') && !tokyo.has('raccoon'),
        bali.has('loris') && !bali.has('sloth') && !bali.has('capybara') && !bali.has('tortoise'),
        sydney.has('kookaburra') && sydney.has('possum') && !sydney.has('tortoise'),
        nairobi.has('mongoose') && nairobi.has('guineafowl') && !nairobi.has('meerkat') && !nairobi.has('peacock'),
        names('tokyo').has('Sika deer') && names('rockies').has('Mule deer') && names('sydney').has('Australian magpie') && names('nairobi').has('Vervet monkey'),
      ];
    },
    expect: [true, true, true, true, true, true],
  },
  {
    name: 'no two animals alike: each has its own seeded make, pace and nerve, a pair is a male and a female, and only grown males carry antlers',
    run: ({ castFor, poseSpecies }) => {
      const pack = castFor({ seed: 21, region: 'rockies', world: 'nature', radius: 5, species: 'wolf', group: 'pack' }).groups[0].members;
      const legs = new Set(pack.map((m) => m.traits.leg.toFixed(4)));
      const pair = castFor({ seed: 4, region: 'alps', world: 'nature', radius: 5, species: 'deer', group: 'pair' }).groups[0].members;
      const herd = Array.from({ length: 60 }, (_, seed) => castFor({ seed, region: 'atlantic', world: 'nature', season: 'autumn', radius: 5, species: 'deer', group: 'family' }).groups[0].members).flat();
      const antlersRight = herd.every((m) => m.horned === (m.traits.sex === 'male' && !m.young));
      const spring = castFor({ seed: 4, region: 'alps', world: 'nature', season: 'spring', radius: 5, species: 'deer', group: 'pair' }).groups[0].members;
      const reach = (seed) => Math.max(...poseSpecies('fox', 'stand', 1, seed === undefined ? {} : { seed }).capsules.map((c) => Math.max(c.a[2], c.b[2])));
      const individuals = new Set([1, 2, 3, 4, 5].map((seed) => reach(seed).toFixed(4)));
      const tame = JSON.stringify(poseSpecies('fox', 'stand', 1)) === JSON.stringify(poseSpecies('fox', 'stand', 1));
      const ranged = pack.every((m) => m.traits.leg > 0.9 && m.traits.leg < 1.1 && m.traits.tempo > 0.85 && m.traits.tempo < 1.15);
      return [legs.size === pack.length, pair.map((m) => m.traits.sex), antlersRight, spring.some((m) => m.horned), individuals.size >= 4, tame, ranged];
    },
    expect: [true, ['male', 'female'], true, false, true, true, true],
  },
  {
    name: 'the sky and the hour move them: rain and snow send animals to rest and keep birds out of the air, dawn and dusk bring song',
    run: ({ idleMatrix }) => {
      const share = (id, mood, acts) => { const m = idleMatrix(id, mood); const cols = acts.map((a) => m.actions.indexOf(a)).filter((j) => j >= 0); return m.rows.reduce((sum, row) => sum + cols.reduce((s, j) => s + (row[j] ?? 0), 0), 0) / m.rows.length; };
      const moves = ['wander', 'run', 'hop', 'fly', 'climb'];
      const rest = ['sit', 'lie', 'sleep'];
      return [
        share('deer', { weather: 'rain' }, moves) < share('deer', {}, moves),
        share('songbird', { weather: 'rain' }, ['fly']) < share('songbird', {}, ['fly']) * 0.5,
        share('fox', { weather: 'snow' }, rest) > share('fox', {}, rest),
        share('songbird', { twilight: true }, ['sing']) > share('songbird', {}, ['sing']) * 1.5,
        share('wolf', { twilight: true, night: true }, ['howl']) > share('wolf', { night: true }, ['howl']),
      ];
    },
    expect: [true, true, true, true, true],
  },
  {
    name: 'company acts together: a mongoose band keeps a sentry while the rest dig, a cat stalks the bird it is with and the bird gets away, crows mob a roosting owl',
    run: ({ castFor, createHerd }) => {
      const at = { ...stage(), radius: 3.3, perches: [0, 1, 2, 3, 4, 5].map((i) => ({ p: [Math.cos(i) * 1.6, 2 + (i % 3) * 0.4, Math.sin(i) * 1.6], d: [Math.cos(i), 0, Math.sin(i)], r: 0.08 })) };
      const watch = (cast, seconds, test) => {
        const herd = createHerd(cast);
        for (let t = 0; t < seconds; t += 0.25) if (test(herd.at(t, at))) return true;
        return false;
      };
      const band = castFor({ seed: 2, region: 'nairobi', world: 'nature', radius: 3.3, species: 'mongoose', group: 'pack' });
      const sentry = watch(band, 240, (bodies) => bodies.some((b) => b.action === 'rear') && bodies.some((b) => b.action === 'dig' || b.action === 'sniff'));
      const mixed = (a, b, seed) => {
        const one = castFor({ seed, region: 'atlantic', world: 'nature', radius: 3.3, species: a, group: 'solo' });
        const two = castFor({ seed: seed + 1, region: 'atlantic', world: 'nature', radius: 3.3, species: b, group: 'pair' });
        return { ...one, groups: [{ kind: 'mixed', members: [...one.groups[0].members, ...two.groups[0].members] }] };
      };
      const stalks = watch(mixed('cat', 'songbird', 5), 240, (bodies) => bodies.some((b) => b.kind === 'cat' && b.action === 'stalk'));
      const mobbing = watch(mixed('owl', 'crow', 8), 240, (bodies) => bodies.filter((b) => b.kind === 'crow' && (b.action === 'flap' || b.action === 'sing') && b.contact).length > 0 && bodies.some((b) => b.kind === 'owl' && b.action === 'look'));
      return [sentry, stalks, mobbing];
    },
    expect: [true, true, true],
  },
  {
    name: 'regionWeight is castFor\'s local weight: kangaroos weigh more in Sydney than their base, and nothing where they do not live',
    run: ({ regionWeight, SPECIES }) => [
      regionWeight('kangaroo', 'sydney') > SPECIES.kangaroo.weight,
      regionWeight('kangaroo', 'rockies'),
      regionWeight('cat', 'rockies', 'city') > regionWeight('cat', 'rockies', 'nature'),
    ],
    expect: [true, 0, true],
  },
  {
    name: 'every species, in every act, grown or young, male or female, fits sdf-body\'s 48 parts a body with its detail groups dropped, 64 with them (past them the face is left out)',
    run: ({ poseSpecies, SPECIES_IDS }) => {
      const acts = ['stand', 'wander', 'run', 'hop', 'fly', 'climb', 'sit', 'lie', 'sleep', 'sniff', 'dig', 'groom', 'look', 'play', 'stretch', 'coil', 'drum', 'peck', 'preen', 'flap', 'sing', 'graze', 'howl', 'rear', 'eat', 'hang', 'roll', 'shake', 'stalk', 'bask'];
      const over = [];
      for (const id of SPECIES_IDS) for (const act of acts) for (const young of [false, true]) for (const sex of ['male', 'female']) for (const t of [0, 0.7, 1.9]) {
        let n = 0;
        try { const parts = poseSpecies(id, act, t, { young, sex }).capsules; n = parts.filter((c) => !c.detail).length; if (parts.length > 64) over.push(`${id} ${act} rich`); } catch { continue; }
        if (n > 48) over.push(`${id} ${act}`);
      }
      return [...new Set(over)];
    },
    expect: [],
  },
  {
    name: 'the sky is local: crows lead the flocks over Tokyo, and a flock over Sydney wears only Sydney\'s coats and names',
    run: ({ castFor, createHerd }) => {
      const tokyo = {};
      for (let seed = 0; seed < 200; seed += 1) { const { birds } = castFor({ seed, region: 'tokyo', world: 'nature' }).sky; tokyo[birds] = (tokyo[birds] ?? 0) + 1; }
      const top = Object.entries(tokyo).sort((a, b) => b[1] - a[1])[0][0];
      const sydney = new Set(), names = new Set();
      for (let seed = 0; seed < 60; seed += 1) {
        const cast = castFor({ seed, region: 'sydney', world: 'nature' });
        if (cast.sky.birds !== 'parrot') continue;
        sydney.add(cast.sky.coats.birds);
        const herd = createHerd(cast);
        for (let t = 0; t < 400; t += 2) for (const body of herd.sky(t, {})) if (body.kind === 'parrot') names.add(body.label);
      }
      return [top, [...sydney].every((coat) => ['lorikeet', 'galah', 'cockatoo'].includes(coat)), names.size > 1 && [...names].every((name) => name !== 'Parrot')];
    },
    expect: ['crow', true, true],
  },
  {
    name: 'animals on the ground never stand in one another: the lighter gives way, a pair greeting may come closer but never through, and the same places always part the same way',
    run: ({ shoveApart }) => {
      const at = (x, weight, self, faces = -1, team = 0) => ({ rings: [{ x, z: 0, r: 1 }], weight, team, self, faces });
      const [a, b] = shoveApart([at(0, 1, 0), at(1, 1, 1)]);
      const [big, small] = shoveApart([at(0, 9, 0), at(1, 1, 1)]);
      const greeting = shoveApart([at(0, 1, 0, 1), at(1, 1, 1)]);
      const strangers = shoveApart([at(0, 1, 0, 1, 0), at(1, 1, 1, -1, 1)]);
      const through = shoveApart([at(0, 1, 0, 1), at(0.2, 1, 1)]);
      const clear = shoveApart([at(0, 1, 0), at(5, 1, 1), null]);
      const stacked = shoveApart([at(0, 1, 0), at(0, 1, 1)]);
      return [Math.round((b[0] - a[0] + 1) * 100) / 100, Math.abs(big[0]) < Math.abs(small[0]), greeting[0][0], through[0][0] !== 0, strangers[0][0] !== 0, clear[1][0], Math.hypot(stacked[0][0] - stacked[1][0], stacked[0][1] - stacked[1][1]) > 1.9];
    },
    expect: [2, true, 0, true, true, 0, true],
  },
  {
    name: 'nothing is pushed into the tree: bodies on the wood swing round each other to their own right, and round any limb that is not theirs, and stay out of their own',
    run: ({ shoveApart, passOnWood, clearOfLimbs, woodMapOf }) => {
      const at = (x, weight, self) => ({ rings: [{ x, z: 0, r: 1 }], weight, team: 0, self, faces: -1 });
      const tree = { rings: [{ x: 0, z: 0, r: 0.5 }], weight: 1e9, team: -1, self: -1, faces: -1 };
      const [pushed, rooted] = shoveApart([at(0.5, 1, 0), tree]);
      const on = (z, side) => ({ balls: [[0, 1, z]], r: 0.2, weight: 1, side });
      const [north, south] = passOnWood([on(0.01, [1, 0, 0]), on(-0.01, [-1, 0, 0])]);
      const limb = [{ p: [-1, 1, 0], r: 0.05 }, { p: [1, 1, 0], r: 0.05 }];
      const map = woodMapOf({ radius: 4, top: 0, perches: [{ p: limb[1].p, d: [1, 0, 0], r: 0.05, path: limb }] });
      const round = clearOfLimbs(on(0.02, [0, 1, 0]), map);
      const mine = clearOfLimbs({ ...on(0.06, [0, 1, 0]), own: limb }, map);
      const inside = clearOfLimbs({ ...on(0.02, [0, 1, 0]), own: limb }, map);
      return [pushed[0] > 0, Math.abs(rooted[0]) < 1e-6, north[0] > 0, south[0] < 0, round[2] > 0, mine[2], inside[2] > 0];
    },
    expect: [true, true, true, true, true, 0, true],
  },
  {
    name: 'sky traffic comes out of the sky and goes back into it, whole between, however short the pass',
    run: ({ skyFade }) => [skyFade(10, 40, 10), skyFade(10, 40, 11.5), skyFade(10, 40, 25), skyFade(10, 40, 40), skyFade(0, 4, 0.5), skyFade(0, 4, 2)],
    expect: [0, 0.5, 1, 0, 0.5, 1],
  },
  {
    name: 'a climber finds its way over the wood: across a gap it can reach, not one it cannot, and round a perch that is crowded',
    run: ({ searchRoute }) => {
      const limb = (x, z) => [{ p: [0, 2, 0], r: 0.2 }, { p: [x * 0.5, 2, z * 0.5], r: 0.1 }, { p: [x, 2, z], r: 0.08 }];
      const perch = (x, z) => ({ p: [x, 2, z], d: [1, 0, 0], r: 0.08, path: limb(x, z) });
      const stage = { radius: 4, top: 0, perches: [perch(1, 0), perch(1, 0.4), perch(1, 0.8), perch(1.25, 0.4)] };
      const across = searchRoute(stage, 0, 2, 0.5, () => 0);
      const tooSmall = searchRoute(stage, 0, 2, 0.05, () => 0);
      const round = searchRoute(stage, 0, 2, 0.5, (i) => (i === 1 ? 3 : 0));
      return [across.via, tooSmall, round.via];
    },
    expect: [[1], null, [3]],
  },
];

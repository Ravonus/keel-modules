const hex = /^#[0-9a-f]{6}$/;

export default [
  {
    name: 'the same seed always resolves the same theme; seeds differ',
    run: ({ themeFor }) => {
      const a = themeFor({ seed: 42 });
      const b = themeFor({ seed: 42 });
      const names = new Set(Array.from({ length: 40 }, (_, seed) => themeFor({ seed }).name));
      return [a.name === b.name, names.size > 30];
    },
    expect: [true, true],
  },
  {
    name: 'a chosen planter and world are kept; unknown ones fall back to the seed',
    run: ({ themeFor }) => {
      const chosen = themeFor({ planter: 'ruby', world: 'synth', seed: 7 });
      const fallback = themeFor({ planter: '<script>', world: 'nope', seed: 7 });
      return [chosen.planter.id, chosen.world.id, fallback.planter.id === themeFor({ seed: 7 }).planter.id];
    },
    expect: ['ruby', 'synth', true],
  },
  {
    name: 'every planter and world resolves to valid colours in every variant',
    run: ({ themeFor, PLANTER_IDS, WORLD_IDS }) => {
      let valid = true;
      for (const planter of PLANTER_IDS) {
        for (const world of WORLD_IDS) {
          for (let seed = 0; seed < 4; seed += 1) {
            const theme = themeFor({ planter, world, seed });
            const { colors } = theme.planter;
            valid &&= ['shape', 'pattern', 'effect', 'decor'].every((key) => typeof theme.planter[key] === 'string') && (theme.world.form === 'voxel') === (world === 'voxel');
            const all = [...colors.top, ...colors.body, colors.rim, colors.accent, ...theme.world.sky, ...theme.world.skylineColors, ...theme.world.cloudColors, ...theme.world.sun.colors, theme.world.moon.color];
            valid &&= all.every((value) => hex.test(value));
          }
        }
      }
      return valid;
    },
    expect: true,
  },
  {
    name: 'planter sizes vary: mostly small, some tiny, a few large, never past full size',
    run: ({ themeFor }) => {
      const sizes = Array.from({ length: 400 }, (_, seed) => themeFor({ planter: 'earth', seed }).planter.size);
      const tiny = sizes.filter((size) => size < 0.58).length;
      const large = sizes.filter((size) => size >= 0.9).length;
      return [sizes.every((size) => size >= 0.45 && size <= 1.05), tiny > 30 && tiny < 120, large > 10 && large < 60, sizes.reduce((sum, size) => sum + size, 0) / sizes.length < 0.8];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'planter shape and size are their own roll: the same for every material, sculpts rare, a forced shape keeps the size',
    run: ({ themeFor, SCULPT_WEIGHTS, PLANTER_IDS }) => {
      const same = Array.from({ length: 40 }, (_, seed) => PLANTER_IDS.map((planter) => themeFor({ planter, seed }).planter)).every((looks) => looks.every((look) => look.shape === looks[0].shape && look.size === looks[0].size));
      const looks = Array.from({ length: 800 }, (_, seed) => themeFor({ seed }).planter);
      const sculpted = looks.filter((look) => look.sculpted);
      const sculptsFloat = sculpted.every((look) => Object.hasOwn(SCULPT_WEIGHTS, look.shape) && look.underside === 'float' && look.trim === 'none');
      const forced = Array.from({ length: 20 }, (_, seed) => [themeFor({ seed }).planter, themeFor({ seed, form: 'skull' }).planter]).every(([plain, skull]) => skull.shape === 'skull' && skull.sculpted && skull.size === plain.size);
      return [same, sculpted.length > 60 && sculpted.length < 160, sculptsFloat, forced];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'the seed picks a world that suits the planter',
    run: ({ themeFor, PLANTERS }) => Array.from({ length: 60 }, (_, seed) => themeFor({ seed })).every((theme) => PLANTERS[theme.planter.id].worlds.includes(theme.world.id)),
    expect: true,
  },
  {
    name: 'only earth follows the seasons; anti-gravity floats; hologram is see-through',
    run: ({ themeFor }) => [themeFor({ planter: 'earth', seed: 1 }).planter.seasonal, themeFor({ planter: 'gold', seed: 1 }).planter.seasonal, themeFor({ planter: 'antigravity', seed: 1 }).planter.bob > 0, themeFor({ planter: 'hologram', seed: 1 }).planter.alpha < 1],
    expect: [true, false, true, true],
  },
  {
    name: 'two planters of one kind differ in shape, pattern, effect or decor across seeds',
    run: ({ themeFor }) => ['gold', 'glitter', 'cyber'].map((planter) => new Set(Array.from({ length: 24 }, (_, seed) => { const look = themeFor({ planter, seed }).planter; return `${look.shape}/${look.pattern}/${look.effect}/${look.decor}`; })).size >= 8),
    expect: [true, true, true],
  },
  {
    name: 'most trees are natural; rarer skins turn up less often, the legendary least',
    run: ({ themeFor }) => {
      const counts = {};
      for (let seed = 0; seed < 20000; seed += 1) { const { rarity } = themeFor({ seed }).tree; counts[rarity] = (counts[rarity] ?? 0) + 1; }
      return [counts.common > 16000, counts.common > counts.uncommon && counts.uncommon > counts.rare && counts.rare > counts.epic && counts.epic > counts.legendary, counts.legendary > 0];
    },
    expect: [true, true, true],
  },
  {
    name: 'a chosen skin is kept and wears its own leaf shape; natural keeps the species',
    run: ({ themeFor }) => [themeFor({ seed: 3, tree: 'gold' }).tree.leaf, themeFor({ seed: 3, tree: 'hologram' }).tree.alpha < 1, themeFor({ seed: 3, tree: 'natural' }).tree.natural],
    expect: ['coin', true, true],
  },
  {
    name: 'colour helpers mix and turn hues',
    run: ({ mixHex, shiftHue }) => [mixHex('#000000', '#ffffff', 0.5), shiftHue('#ff0000', 120), shiftHue('#808080', 90)],
    expect: ['#808080', '#00ff00', '#808080'],
  },
  {
    name: 'glitch hits parts, never the frame: most are clean, each part rolls alone, a full glitch is rarest',
    run: ({ themeFor }) => {
      const counts = { clean: 0, single: 0, full: 0 };
      for (let seed = 0; seed < 20000; seed += 1) {
        const glitch = themeFor({ seed }).glitch;
        const hit = ['planter', 'tree', 'world'].filter((part) => glitch.parts[part].kind !== 'clean').length;
        if (glitch.full) counts.full += 1; else if (hit === 0) counts.clean += 1; else if (hit === 1) counts.single += 1;
      }
      const tree = themeFor({ seed: 9, glitch: 'tree' }).glitch;
      const full = themeFor({ seed: 9, glitch: 'full' }).glitch;
      return [counts.clean > counts.single, counts.single > counts.full, counts.full > 0, tree.id, tree.parts.planter.kind, full.parts.world.glitch, full.rarity];
    },
    expect: [true, true, true, 'tree', 'clean', 1, 'legendary'],
  },
  {
    name: 'given signals set each part, nothing rolled; strength scales them and full tears all three',
    run: ({ themeFor }) => {
      const given = themeFor({ seed: 9, signals: { tree: 'vhs', world: 'thermal' }, signalStrength: 0.5 }).glitch;
      const full = themeFor({ seed: 9, signals: { planter: 'full' } }).glitch;
      return [given.id, given.rarity, given.parts.tree.filter, given.parts.tree.amount, given.parts.tree.scanlines, given.parts.planter.kind, given.parts.world.filter, full.id, full.parts.world.glitch];
    },
    expect: ['tree+world', 'epic', 'vhs', 0.45, 0.23, 'clean', 'thermal', 'full', 1],
  },
];

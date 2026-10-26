const SEED = '0x6f6e6c792d6c6f63616c2d736561736f6e616c2d67726f76652d763100000000';
const base = { seed: SEED, species: 'cherry', season: 'spring', life: 0.5, night: 0, weather: 'clear' };
const bars = (stepEvents, score, from, count) => Array.from({ length: count * 16 }, (_, index) => stepEvents(score, from * 16 + index)).flat();

export default [
  {
    name: 'the same input always gives the same score and the same bars',
    run: ({ lofiScore, stepEvents }) => {
      const a = lofiScore(base);
      const b = lofiScore({ ...base });
      return [JSON.stringify(a) === JSON.stringify(b), JSON.stringify(bars(stepEvents, a, 37, 2)) === JSON.stringify(bars(stepEvents, b, 37, 2))];
    },
    expect: [true, true],
  },
  {
    name: 'tempo, swing and every note stay inside their clamps for any seed and moment',
    run: ({ lofiScore, stepEvents }) => {
      const failures = [];
      for (let seed = 0; seed < 40; seed += 1) {
        for (const [season, life, night, dead] of [['winter', 0.99, 1, false], ['summer', 0.5, 0, false], ['autumn', 0.3, 0.7, false], ['spring', 1, 1, true]]) {
          const score = lofiScore({ seed, species: 'willow', season, life, night, dead });
          if (score.bpm < 64 || score.bpm > 88 || score.swing < 0.12 || score.swing > 0.26) failures.push(['tempo', seed, season]);
          for (const chord of score.chords) if (chord.bass < 36 || chord.bass > 47 || chord.keys.some((note) => note < 52 || note > 76)) failures.push(['chord', seed, season]);
          if (score.scale.some((note) => note < 62 || note > 88)) failures.push(['scale', seed, season]);
        }
      }
      return failures;
    },
    expect: [],
  },
  {
    name: 'the band grows with the tree: chords and a bud for a sprout, a kit for a young tree, a melody when mature, keys alone when dead',
    run: ({ lofiScore, stepEvents }) => [0.02, 0.3, 0.6, 0.6].map((life, index) => {
      const score = lofiScore({ ...base, life, dead: index === 3 });
      return [...new Set(bars(stepEvents, score, 0, 8).map((item) => item.voice))].filter((voice) => voice !== 'bird' && voice !== 'cricket').sort().join(' ');
    }),
    expect: ['bud keys', 'bass bud hat keys kick snare wood', 'bass bud hat keys kick melody snare', 'keys'],
  },
  {
    name: 'spring and summer are major, autumn and winter the relative minor of the same key',
    run: ({ lofiScore }) => {
      const spring = lofiScore(base);
      const autumn = lofiScore({ ...base, season: 'autumn' });
      return [spring.mode, autumn.mode, (spring.tonic + 9) % 12 === autumn.tonic];
    },
    expect: ['major', 'minor', true],
  },
  {
    name: 'night slows the tempo and darkens the tape; rain brings rain and sends the birds away',
    run: ({ lofiScore }) => {
      const day = lofiScore(base);
      const night = lofiScore({ ...base, night: 1 });
      const rain = lofiScore({ ...base, weather: 'rain' });
      return [night.bpm < day.bpm, night.cutoff < day.cutoff, day.layers.birds > 0, night.layers.crickets > 0, rain.layers.rain > 0, rain.layers.birds];
    },
    expect: [true, true, true, true, true, 0],
  },
  {
    name: 'a mix change keeps the structure; a new season or stage changes it',
    run: ({ lofiScore }) => {
      const day = lofiScore(base).structure;
      return [lofiScore({ ...base, night: 0.8, weather: 'rain' }).structure === day, lofiScore({ ...base, season: 'winter' }).structure === day, lofiScore({ ...base, life: 0.95 }).structure === day];
    },
    expect: [true, false, false],
  },
  {
    name: 'each species sings its own phrase; an unknown species sings the cherry',
    run: ({ lofiScore, SPECIES_MOTIFS }) => [Object.keys(SPECIES_MOTIFS).sort().join(' '), lofiScore({ ...base, species: 'sequoia' }).species],
    expect: ['acacia baobab birch cherry jacaranda maple oak palm pine redwood spruce willow', 'cherry'],
  },
  {
    name: 'keys voicings are rootless and voice-led: neighbouring chords move by small steps',
    run: ({ lofiScore }) => {
      const { chords } = lofiScore(base);
      return chords.every((chord, index) => {
        const next = chords[(index + 1) % chords.length];
        const mean = (notes) => notes.reduce((sum, note) => sum + note, 0) / notes.length;
        return Math.abs(mean(chord.keys) - mean(next.keys)) <= 6 && !chord.keys.some((note) => note % 12 === chord.bass % 12 && chord.keys.length > 3);
      });
    },
    expect: true,
  },
  {
    name: 'the budding figure rises in spring and falls in autumn, one note longer each stage',
    run: ({ lofiScore, stepEvents }) => [['spring', 0.02], ['spring', 0.1], ['autumn', 0.6]].map(([season, life]) => {
      const score = lofiScore({ ...base, season, life });
      const bud = stepEvents(score, 6 * 16 + 8).find((item) => item.voice === 'bud');
      return [bud.notes.length, bud.notes[1] > bud.notes[0] ? 'rises' : 'falls'];
    }),
    expect: [[2, 'rises'], [3, 'rises'], [5, 'falls']],
  },
  {
    name: 'a song override replaces the seed picks: a minor progression plays minor in spring, in the chosen key',
    run: ({ lofiScore, LOFI_PARTS }) => {
      const song = lofiScore({ ...base, song: { progression: 'frost', key: 0, groove: 2, comp: 1, bassLine: 0, melody: 'redwood', stage: 'sprout', tempo: 80 } });
      return [song.mode, song.tonic, song.progression, song.groove, song.comp, song.species, song.stage, song.bpm, LOFI_PARTS.progressions.length];
    },
    expect: ['minor', 9, 'frost', 2, 1, 'redwood', 'sprout', 80, 8],
  },
  {
    name: 'every progression in the catalogue can be auditioned and changes the structure',
    run: ({ lofiScore, LOFI_PARTS }) => new Set(LOFI_PARTS.progressions.map(({ id }) => lofiScore({ ...base, song: { progression: id } }).structure)).size,
    expect: 8,
  },
  {
    name: 'every two songs differ in at least three audible parts: tempo, keys sound, lead, groove, rhythm, bass or chord speed',
    run: ({ lofiScore, LOFI_PARTS }) => {
      const parts = LOFI_PARTS.progressions.map(({ id }) => {
        const score = lofiScore({ ...base, song: { progression: id, stage: 'mature' } });
        return [Math.round(score.bpm / 4), score.keysVoice, score.lead, score.groove, score.comp, score.bassLine, score.barsPerChord];
      });
      const close = [];
      parts.forEach((a, i) => parts.slice(i + 1).forEach((b, j) => { if (a.filter((value, k) => value !== b[k]).length < 3) close.push([i, i + 1 + j]); }));
      return close;
    },
    expect: [],
  },
  {
    name: 'a broken-chord song plays single keys notes on the eighths',
    run: ({ lofiScore, stepEvents }) => {
      const score = lofiScore({ ...base, song: { progression: 'roots' } });
      return Array.from({ length: 16 }, (_, step) => stepEvents(score, step).filter((item) => item.voice === 'keys').map((item) => item.notes.length).join('')).join(',');
    },
    expect: '1,,1,,1,,1,,1,,1,,1,,1,',
  },
];

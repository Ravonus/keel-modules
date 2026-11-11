/** Deterministic test vectors for band. Run by `keel module test`. */

/** A recording stand-in for an audio context: every node and every scheduled value is counted, nothing sounds. */
function stubContext() {
  const log = { oscillators: 0, sources: 0, starts: [] };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  const node = (extra = {}) => ({ connect: (to) => to, ...extra });
  const voice = (kind) => {
    log[kind] += 1;
    return node({ frequency: param(), detune: param(), start: (time) => log.starts.push(Math.round(time * 1e4) / 1e4), stop() {} });
  };
  return {
    log,
    sampleRate: 8000,
    currentTime: 0,
    destination: node(),
    createGain: () => node({ gain: param() }),
    createDynamicsCompressor: () => node(),
    createConvolver: () => node(),
    createDelay: () => node({ delayTime: param() }),
    createBiquadFilter: () => node({ frequency: param() }),
    createOscillator: () => voice("oscillators"),
    createBufferSource: () => voice("sources"),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
}

const sketch = (events) => events.map((event) => `${event.part}:${event.note}`).sort().join(" ");

export default [
  {
    name: "a seed fixes the whole piece",
    run: ({ scoreOf }) => {
      const score = scoreOf({ seed: "grove" });
      const again = scoreOf({ seed: "grove" });
      return [score.style, score.tempo, score.key, score.mode, score.kick, JSON.stringify(score) === JSON.stringify(again)];
    },
    expect: ["chiptune", 121, 2, "minor", "x.....x.x...x...", true],
  },
  {
    name: "style, tempo, key and mode can each be pinned",
    run: ({ scoreOf }) => {
      const score = scoreOf({ seed: 1, style: "house", tempo: 999, key: 14, mode: "phrygian" });
      return [score.style, score.tempo, score.key, score.mode, score.chords.length];
    },
    expect: ["house", 200, 2, "phrygian", 4],
  },
  {
    name: "pinning one choice leaves the seed's others as they were",
    run: ({ scoreOf }) => {
      const free = scoreOf({ seed: 77 });
      const pinned = scoreOf({ seed: 77, style: free.style, tempo: 90 });
      return [pinned.key === free.key, pinned.mode === free.mode, pinned.kick === free.kick, pinned.tempo];
    },
    expect: [true, true, true, 90],
  },
  {
    name: "chords sit in the keys' register over a low root, in the key",
    run: ({ MODES, scoreOf }) => {
      const score = scoreOf({ seed: 3, style: "lofi" });
      const scale = MODES[score.mode].map((step) => (step + score.key) % 12);
      return score.chords.every((chord) =>
        chord.root >= 36 && chord.root < 48 && chord.notes.length === 4 &&
        chord.notes.every((note) => note >= 55 && note < 67 && scale.includes(note % 12)));
    },
    expect: true,
  },
  {
    name: "noteOf runs on through the octaves, up and down",
    run: ({ noteOf }) => [noteOf("major", 60, 0), noteOf("major", 60, 7), noteOf("minor", 60, 9), noteOf("major", 60, -1)],
    expect: [60, 72, 75, 59],
  },
  {
    name: "the first step of a house bar is the kick and the whole chord",
    run: ({ eventsAt, scoreOf }) => {
      const score = scoreOf({ seed: 5, style: "house", key: 0, mode: "minor" });
      const parts = eventsAt(score, 0, 0.7).map((event) => event.part);
      return [parts.filter((part) => part === "kick").length, parts.filter((part) => part === "chord").length === score.chords[0].notes.length];
    },
    expect: [1, true],
  },
  {
    name: "events are a pure function of score, step and energy",
    run: ({ eventsAt, scoreOf }) => {
      const score = scoreOf({ seed: 11, style: "synthwave" });
      let same = true;
      for (let step = 0; step < 128; step += 1) same &&= sketch(eventsAt(score, step, 0.7)) === sketch(eventsAt(score, step, 0.7));
      return same;
    },
    expect: true,
  },
  {
    name: "parts join in the style's order as energy rises, and none play at zero",
    run: ({ partsAt, scoreOf }) => {
      const score = scoreOf({ seed: 2, style: "lofi" });
      return [0, 0.2, 0.5, 1].map((energy) => partsAt(score, energy).join(","));
    },
    expect: ["", "chord,hat", "chord,hat,kick,bass", "chord,hat,kick,bass,snare,lead"],
  },
  {
    name: "every style plays every part across its form, in range",
    run: ({ STYLE_NAMES, eventsAt, scoreOf }) =>
      STYLE_NAMES.map((style) => {
        const score = scoreOf({ seed: 21, style });
        const seen = new Set();
        let inRange = true;
        for (let step = 0; step < 16 * 16; step += 1) {
          for (const event of eventsAt(score, step)) {
            seen.add(event.part);
            inRange &&= event.gain > 0 && event.gain <= 1 && event.length > 0 && (event.note === 0 || (event.note >= 36 && event.note <= 96));
          }
        }
        return `${style}:${seen.size}:${inRange}`;
      }),
    expect: ["ambient:4:true", "lofi:6:true", "synthwave:6:true", "chiptune:6:true", "house:6:true", "cinematic:5:true", "folk:5:true", "dream:6:true"],
  },
  {
    name: "schedule writes a bar into a context and returns where it ends",
    run: ({ createBand, scoreOf }) => {
      const ctx = stubContext();
      const band = createBand(ctx);
      const end = band.schedule(scoreOf({ seed: 5, style: "house", tempo: 120 }), { steps: 16 });
      return [end, ctx.log.oscillators > 16, ctx.log.sources > 0, Math.min(...ctx.log.starts), band.playing];
    },
    expect: [2, true, true, 0, false],
  },
  {
    name: "swing lands the off sixteenths late",
    run: ({ createBand, scoreOf }) => {
      const ctx = stubContext();
      const score = { ...scoreOf({ seed: 5, style: "lofi", tempo: 60 }), hat: "xxxxxxxxxxxxxxxx", swing: 0.2 };
      createBand(ctx).schedule(score, { steps: 2, energy: 0.2 });
      return [...new Set(ctx.log.starts)].filter((time) => time > 0 && time < 0.5);
    },
    expect: [0.3],
  },
];

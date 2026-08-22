/** Deterministic test vectors for audio-envelope. Run by `keel module test`. */

/** Minimal AudioParam stand-in that records every scheduling call. */
function stubParameter() {
  const calls = [];
  return {
    calls,
    cancelScheduledValues(time) { calls.push(["cancel", time]); },
    setValueAtTime(value, time) { calls.push(["set", value, time]); },
    linearRampToValueAtTime(value, time) { calls.push(["ramp", value, time]); },
  };
}

export default [
  {
    name: "noteFrequency maps the tuning reference and octaves",
    run: ({ noteFrequency }) => [noteFrequency(69), noteFrequency(81), Math.round(noteFrequency(60) * 1e6) / 1e6],
    expect: [440, 880, 261.625565],
  },
  {
    name: "noteFrequency honors an alternate tuning",
    run: ({ noteFrequency }) => noteFrequency(69, 432),
    expect: 432,
  },
  {
    name: "noteFrequency rejects a non-positive tuning",
    run: ({ noteFrequency }) => {
      try {
        noteFrequency(69, 0);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
  {
    name: "scheduleEnvelope emits the golden ADSR call sequence",
    run: ({ scheduleEnvelope }) => {
      const parameter = stubParameter();
      const end = scheduleEnvelope(parameter, 1, 0.8, { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3, duration: 0.6 });
      return { end: Math.round(end * 1e6) / 1e6, calls: parameter.calls.map((call) => call.map((part) => typeof part === "number" ? Math.round(part * 1e6) / 1e6 : part)) };
    },
    expect: {
      end: 1.9,
      calls: [
        ["cancel", 1],
        ["set", 0, 1],
        ["ramp", 0.8, 1.1],
        ["ramp", 0.4, 1.3],
        ["set", 0.4, 1.6],
        ["ramp", 0, 1.9],
      ],
    },
  },
  {
    name: "scheduleEnvelope holds at least attack plus decay",
    run: ({ scheduleEnvelope }) => {
      const parameter = stubParameter();
      const end = scheduleEnvelope(parameter, 0, 1, { attack: 0.4, decay: 0.4, release: 0.2, duration: 0 });
      return Math.round(end * 1e6) / 1e6;
    },
    expect: 1,
  },
  {
    name: "scheduleEnvelope rejects negative envelope values",
    run: ({ scheduleEnvelope }) => {
      try {
        scheduleEnvelope(stubParameter(), 0, 1, { attack: -0.1 });
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];

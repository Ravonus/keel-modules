/** Deterministic test vectors for frame-clock. Run by `keel module test`. */

/**
 * Runs work with requestAnimationFrame/cancelAnimationFrame stubbed so the
 * vector can drive ticks by hand with explicit timestamps.
 */
function withStubbedRaf(work) {
  const pending = [];
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => pending.push(callback);
  globalThis.cancelAnimationFrame = () => { pending.length = 0; };
  try {
    return work((now) => {
      const callback = pending.shift();
      if (callback) callback(now);
    });
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
}

export default [
  {
    name: "simulates whole fixed steps from accumulated real time",
    run: ({ createFrameClock }) => withStubbedRaf((tick) => {
      const frames = [];
      const clock = createFrameClock({ fps: 10, onFrame: (info) => frames.push([info.frame, info.time, info.delta]) });
      clock.start();
      tick(1000);
      tick(1250);
      clock.stop();
      return frames;
    }),
    expect: [[0, 0, 100], [1, 100, 100]],
  },
  {
    name: "clamps catch-up to maxCatchUpFrames per tick",
    run: ({ createFrameClock }) => withStubbedRaf((tick) => {
      const frames = [];
      const clock = createFrameClock({ fps: 10, maxCatchUpFrames: 2, onFrame: (info) => frames.push(info.frame) });
      clock.start();
      tick(1000);
      tick(11_000);
      clock.stop();
      return frames;
    }),
    expect: [0, 1],
  },
  {
    name: "seek jumps the frame counter",
    run: ({ createFrameClock }) => withStubbedRaf((tick) => {
      const frames = [];
      const clock = createFrameClock({ fps: 10, onFrame: (info) => frames.push(info.frame) });
      clock.seek(41);
      clock.start();
      tick(1000);
      tick(1100);
      clock.stop();
      return [frames, clock.frame];
    }),
    expect: [[41], 42],
  },
  {
    name: "seek rejects a negative frame",
    run: ({ createFrameClock }) => withStubbedRaf(() => {
      const clock = createFrameClock({ fps: 10, onFrame: () => undefined });
      try {
        clock.seek(-1);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    }),
    expect: "RangeError",
  },
  {
    name: "rejects out-of-range limits",
    run: ({ createFrameClock }) => {
      try {
        createFrameClock({ fps: 500, onFrame: () => undefined });
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "RangeError",
  },
];

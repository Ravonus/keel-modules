/** Deterministic test vectors for film-takes. Run by `keel module test`. */
const rounded = (values) => values.map((value) => Math.round(value * 1000) / 1000);
const film = (createFilmTakes, frames, options = {}) => createFilmTakes({ frames, rest: [0, 1], ease: 4, stitch: 4, ...options });

export default [
  {
    name: "a fresh tape holds the rest pose and is not complete",
    run: ({ createFilmTakes }) => { const t = film(createFilmTakes, 4); return [t.at(2), t.complete()]; },
    expect: [[0, 1], false],
  },
  {
    name: "filming writes the hand's value",
    run: ({ createFilmTakes }) => { const t = film(createFilmTakes, 4); return [t.record(1, [2, 3]), t.at(1)]; },
    expect: [{ value: [2, 3], filmed: true }, [2, 3]],
  },
  {
    name: "rewinding plays the take back and keeps it",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 4); t.record(1, [2, 3]); t.jump(3, 1, [9, 9]);
      return [t.record(1, [9, 9]), t.at(1)];
    },
    expect: [{ value: [2, 3], filmed: false }, [2, 3]],
  },
  {
    name: "a retake overwrites filmed frames and raises the revision",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 4); t.record(1, [2, 3]); t.jump(3, 1, [0, 1]); const before = t.revision; t.retake();
      return [t.record(1, [5, 6]).filmed, t.at(1), t.revision > before, t.taking];
    },
    expect: [true, [5, 6], true, true],
  },
  {
    name: "a jump ends a take",
    run: ({ createFilmTakes }) => { const t = film(createFilmTakes, 4); t.retake(); t.jump(2, 1, [0, 1]); return t.taking; },
    expect: false,
  },
  {
    name: "a long skip reaches the rest pose and eases at both ends",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 40); t.record(0, [8, 2]); t.jump(0, 30, [4, 2]);
      const yaw = Array.from({ length: 30 }, (_, frame) => t.at(frame)[0]);
      const steps = yaw.slice(1).map((value, i) => Math.abs(value - yaw[i]));
      return [t.at(15), Math.max(...steps) < 3.1, t.state[15], t.state[0]];
    },
    expect: [[0, 1], true, 2, 1],
  },
  {
    name: "a short skip crosses without visiting the rest pose",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 12); t.record(0, [8, 2]); t.jump(0, 4, [8, 2]);
      return rounded(t.at(2));
    },
    expect: [8, 2],
  },
  {
    name: "skipping over filmed frames leaves them alone",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 20); t.record(5, [7, 7]); t.jump(0, 10, [0, 1]);
      return [t.at(5), t.state[4], t.state[5], t.state[6]];
    },
    expect: [[7, 7], 2, 1, 2],
  },
  {
    name: "new frames meeting an old take lean it over",
    run: ({ createFilmTakes }) => {
      const t = film(createFilmTakes, 12);
      for (let frame = 2; frame < 8; frame += 1) t.record(frame, [0, 1]);
      t.jump(8, 1, [0, 1]); t.state[1] = 0; t.record(1, [8, 1]); t.record(2, [8, 1]);
      return [t.at(2)[0] > 0, t.at(5), t.record(3, [9, 9]).filmed];
    },
    expect: [true, [0, 1], false],
  },
  {
    name: "angles blend the short way round",
    run: ({ createFilmTakes }) => {
      const t = createFilmTakes({ frames: 12, rest: [0], angles: [0], ease: 4 });
      t.record(0, [0.1]); t.jump(0, 4, [Math.PI * 2 - 0.1]);
      return Math.abs(t.at(2)[0]) < 0.11;
    },
    expect: true,
  },
  {
    name: "labels never blend",
    run: ({ createFilmTakes }) => {
      const t = createFilmTakes({ frames: 12, rest: [0], labels: [0], ease: 4 });
      t.record(0, [3]); t.jump(0, 4, [5]);
      return [t.at(1), t.at(3)];
    },
    expect: [[3], [5]],
  },
  {
    name: "skipping to the end completes the tape",
    run: ({ createFilmTakes }) => { const t = film(createFilmTakes, 6); t.record(0, [1, 1]); t.jump(0, 5, [1, 1]); t.record(5, [1, 1]); return t.complete(); },
    expect: true,
  },
  {
    name: "a bad length is refused",
    run: ({ createFilmTakes }) => { try { createFilmTakes({ frames: 0, rest: [0] }); return false; } catch (error) { return error instanceof RangeError; } },
    expect: true,
  },
];

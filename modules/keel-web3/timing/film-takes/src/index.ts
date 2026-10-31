/**
 * Overdub takes for a fixed film.
 *
 * A film has a fixed length and the viewer steers something over it: a camera, a ride,
 * anything that can be a few numbers a frame. Every frame lands on a tape, so a video made
 * later replays what they did. This module decides what happens to that tape when they
 * rewind and jump around:
 *
 *  - Rewinding erases nothing. Frames already filmed play back.
 *  - `retake()`, called when the viewer touches the controls, starts a new take from there.
 *  - Frames jumped over were never seen. They ease to a rest pose and back, or simply cross
 *    between their neighbours when the jump is too short to go anywhere.
 *  - Where new frames run into old ones, the old ones lean over from the last new value,
 *    so the tape never jumps.
 */

/** How a frame came to be on the tape. */
export const FRAME_UNSEEN = 0;
export const FRAME_FILMED = 1;
export const FRAME_SKIPPED = 2;

export interface FilmTakesOptions {
  /** Length of the film in frames. */
  readonly frames: number;
  /** The value of a frame nobody steered, one number per slot. */
  readonly rest: readonly number[];
  /** Slots that are angles in radians: blends take the short way, whole turns apart. */
  readonly angles?: readonly number[];
  /** Slots that are identifiers, never blended: they take the nearer side's value. */
  readonly labels?: readonly number[];
  /** Frames a skip spends easing at each end. Default 45. */
  readonly ease?: number;
  /** Frames an old take spends leaning over from a new one. Default 30. */
  readonly stitch?: number;
}

export interface FilmTakes {
  /** Slots per frame. */
  readonly width: number;
  /** The tape, `width` numbers a frame. */
  readonly data: Float32Array;
  /** How each frame came to be there. */
  readonly state: Uint8Array;
  /** Rises whenever the tape changes after filming, so a finished video knows it is stale. */
  readonly revision: number;
  /** True while a take is being overdubbed over frames already filmed. */
  readonly taking: boolean;
  /** Files one frame of playing film. Returns the value now on the tape, and whether it was the hand's. */
  record(frame: number, value: readonly number[]): { readonly value: readonly number[]; readonly filmed: boolean };
  /** Starts a new take at the next frame. */
  retake(): void;
  /** Moves the playhead. Unfilmed frames between are skipped, easing back to `arrival`. */
  jump(from: number, to: number, arrival: readonly number[]): void;
  /** The tape at a frame. */
  at(frame: number): number[];
  /** Whether every frame has been filmed or skipped, ready to make a video. */
  complete(): boolean;
}

const TURN = Math.PI * 2;
const smooth = (k: number): number => k * k * (3 - 2 * k);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

interface Tape {
  readonly frames: number;
  readonly width: number;
  readonly rest: readonly number[];
  readonly ease: number;
  readonly stitch: number;
  readonly angles: ReadonlySet<number>;
  readonly labels: ReadonlySet<number>;
  readonly data: Float32Array;
  readonly state: Uint8Array;
}

function read(tape: Tape, frame: number): number[] {
  const start = Math.min(tape.frames - 1, Math.max(0, frame)) * tape.width;
  return Array.from(tape.data.subarray(start, start + tape.width));
}

/** Two values of a frame blended: an angle takes the short way, a label never blends. */
function between(tape: Tape, from: readonly number[], to: readonly number[], k: number): number[] {
  return from.map((value, slot) => {
    const target = to[slot] ?? value;
    if (tape.labels.has(slot)) return k < 0.5 ? value : target;
    if (tape.angles.has(slot)) return mix(value, target - Math.round((target - value) / TURN) * TURN, k);
    return mix(value, target, k);
  });
}

/** The old take after `frame` leans over from the new frame before it. */
function leanOver(tape: Tape, frame: number): void {
  if (frame < 1) return;
  const from = read(tape, frame - 1);
  for (let i = 0; i < tape.stitch && frame + i < tape.frames && tape.state[frame + i] === FRAME_FILMED; i += 1) {
    tape.data.set(between(tape, from, read(tape, frame + i), smooth((i + 1) / tape.stitch)), (frame + i) * tape.width);
  }
}

/** One frame of a skipped run, `index` of `length` along it. */
function skippedValue(tape: Tape, before: readonly number[], after: readonly number[], index: number, length: number): number[] {
  const reach = Math.min(tape.ease, length >> 1);
  const fromEnd = length - 1 - index;
  if (length <= tape.ease * 2) return between(tape, before, after, smooth((index + 1) / (length + 1)));
  if (index < reach) return between(tape, before, tape.rest, smooth((index + 1) / (reach + 1)));
  if (fromEnd < reach) return between(tape, tape.rest, after, smooth((reach - fromEnd) / (reach + 1)));
  return [...tape.rest];
}

function skip(tape: Tape, first: number, last: number, after: readonly number[]): void {
  const length = last - first + 1;
  const before = first > 0 ? read(tape, first - 1) : [...tape.rest];
  for (let frame = first; frame <= last; frame += 1) {
    tape.data.set(skippedValue(tape, before, after, frame - first, length), frame * tape.width);
    tape.state[frame] = FRAME_SKIPPED;
  }
}

/** Skips every unfilmed run between two frames. Returns how many runs there were. */
function skipBetween(tape: Tape, from: number, to: number, arrival: readonly number[]): number {
  let run = -1;
  let runs = 0;
  const close = (end: number): void => {
    if (run < 0) return;
    skip(tape, run, end, tape.state[end + 1] === FRAME_FILMED ? read(tape, end + 1) : arrival);
    run = -1;
    runs += 1;
  };
  for (let frame = from + 1; frame < to; frame += 1) {
    if (tape.state[frame] === FRAME_FILMED) close(frame - 1);
    else if (run < 0) run = frame;
  }
  close(to - 1);
  return runs;
}

export function createFilmTakes(options: FilmTakesOptions): FilmTakes {
  const { frames, rest, angles = [], labels = [], ease = 45, stitch = 30 } = options;
  if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError("frames must be a positive integer");
  if (rest.length < 1) throw new RangeError("rest must have at least one slot");
  const width = rest.length;
  const data = new Float32Array(frames * width);
  const state = new Uint8Array(frames);
  for (let frame = 0; frame < frames; frame += 1) data.set(rest, frame * width);
  const tape: Tape = { frames, width, rest, ease, stitch, angles: new Set(angles), labels: new Set(labels), data, state };
  let taking = false;
  let onNewFrames = false;
  let revision = 0;

  return {
    width,
    data,
    state,
    get revision() { return revision; },
    get taking() { return taking; },
    record(frame, value) {
      if (state[frame] === FRAME_FILMED && !taking) {
        if (onNewFrames) { onNewFrames = false; leanOver(tape, frame); }
        return { value: read(tape, frame), filmed: false };
      }
      onNewFrames = true;
      revision += 1;
      state[frame] = FRAME_FILMED;
      data.set(value, frame * width);
      return { value, filmed: true };
    },
    retake() {
      if (taking) return;
      taking = true;
      onNewFrames = true;
      revision += 1;
    },
    jump(from, to, arrival) {
      if (to !== from) taking = false;
      onNewFrames = false;
      revision += skipBetween(tape, from, to, arrival);
    },
    at: (frame) => read(tape, frame),
    complete: () => state.every((value) => value !== FRAME_UNSEEN),
  };
}

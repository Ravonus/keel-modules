/** The band, playing: a mixer, a room, an echo and a clock that schedules a little ahead of the sound. MIT. */
import { eventsAt } from "./events.js";
import type { BandEvent } from "./events.js";
import { clamp, random } from "./roll.js";
import { STEPS_PER_BAR } from "./score.js";
import type { Score } from "./score.js";
import type { Part } from "./styles.data.js";
import { drum, strike } from "./voices.js";

/** Options for `createBand`. */
export interface BandOptions {
  /** Where the band plays. Default: the context's destination. */
  readonly destination?: AudioNode;
  /** Master level, 0 to 1. Default 0.8. */
  readonly gain?: number;
  /** How far ahead of the sound notes are scheduled, in seconds. Default 0.15. */
  readonly lookahead?: number;
}

/** What `schedule` writes: how many steps, from which step, starting when, at what energy. */
export interface ScheduleOptions {
  readonly steps: number;
  readonly from?: number;
  readonly at?: number;
  readonly energy?: number;
}

/** A band bound to one audio context. */
export interface Band {
  /** The master gain node, for a host that wants to meter or route it. */
  readonly output: AudioNode;
  /** The next step to be scheduled, in sixteenths from the start. */
  readonly step: number;
  readonly playing: boolean;
  /** Starts the score from the top. The context must be running (start it from a tap or key). */
  start(score: Score, energy?: number): void;
  /** Changes score at the next bar line, keeping time. */
  setScore(score: Score): void;
  /** How much of the band plays, 0 to 1, from the next step: tie it to a scroll, a level, a mood. */
  setEnergy(energy: number): void;
  /** Fades the master level over `seconds` (default 0.3). */
  setGain(gain: number, seconds?: number): void;
  /** Writes a stretch of the score into the context at once, for an OfflineAudioContext. Returns its end time. */
  schedule(score: Score, options: ScheduleOptions): number;
  stop(): void;
}

const LEVEL: Readonly<Record<Part, number>> = { kick: 0.9, snare: 0.6, hat: 0.28, bass: 0.7, chord: 0.5, lead: 0.55 };
const SPACE: Readonly<Record<Part, number>> = { kick: 0, snare: 0.3, hat: 0.15, bass: 0, chord: 0.8, lead: 1 };
const ECHO: Readonly<Record<Part, number>> = { kick: 0, snare: 0, hat: 0, bass: 0, chord: 0.4, lead: 1 };
const PARTS = Object.keys(LEVEL) as Part[];

interface Channel {
  readonly bus: GainNode;
  readonly space: GainNode;
  readonly echo: GainNode;
}

interface Rig {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  readonly delay: DelayNode;
  readonly channels: Readonly<Record<Part, Channel>>;
}

/** Seeded white noise: the drums' raw material, and (fading) the room's echo. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, fade: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const roll = random(0x5eed + channel);
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (roll() * 2 - 1) * Math.exp((-fade * i) / length);
  }
  return buffer;
}

function createRig(ctx: BaseAudioContext, options: BandOptions): Rig {
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  const room = ctx.createConvolver();
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  master.gain.value = options.gain ?? 0.8;
  room.buffer = noiseBuffer(ctx, 2.4, 6);
  feedback.gain.value = 0.36;
  delay.connect(feedback).connect(delay);
  delay.connect(master);
  room.connect(master);
  master.connect(limiter).connect(options.destination ?? ctx.destination);
  const channel = (part: Part): Channel => {
    const made = { bus: ctx.createGain(), space: ctx.createGain(), echo: ctx.createGain() };
    made.bus.gain.value = LEVEL[part];
    made.bus.connect(master);
    made.bus.connect(made.space).connect(room);
    made.bus.connect(made.echo).connect(delay);
    return made;
  };
  const channels = Object.fromEntries(PARTS.map((part) => [part, channel(part)])) as Record<Part, Channel>;
  return { ctx, master, noise: noiseBuffer(ctx, 1, 0), delay, channels };
}

/** Sets the room, the echo and its time for a score: three eighths of a beat, so repeats fall between the notes. */
function tune(rig: Rig, score: Score): void {
  rig.delay.delayTime.value = clamp((60 / score.tempo) * 0.75, 0.05, 1.5);
  for (const part of PARTS) {
    rig.channels[part].space.gain.value = score.sound.space * SPACE[part] * 0.5;
    rig.channels[part].echo.gain.value = score.sound.echo * ECHO[part] * 0.5;
  }
}

function sound(rig: Rig, score: Score, event: BandEvent, time: number): void {
  const out = rig.channels[event.part].bus;
  if (event.part === "kick" || event.part === "snare" || event.part === "hat") {
    drum({ ctx: rig.ctx, out, noise: rig.noise }, event.part, time, event.gain);
    return;
  }
  const seconds = (event.length * 60) / score.tempo / 4;
  const frequency = 440 * 2 ** ((event.note - 69) / 12);
  strike(rig.ctx, out, score.sound.voices[event.part], { time, frequency, seconds, gain: event.gain });
}

/** Schedules one step, the off sixteenths late by the score's swing. Returns the step's length in seconds. */
function playStep(rig: Rig, score: Score, spot: readonly [number, number, number]): number {
  const [step, time, energy] = spot;
  const seconds = 60 / score.tempo / 4;
  const late = step % 2 === 1 ? score.swing * seconds : 0;
  for (const event of eventsAt(score, step, energy)) sound(rig, score, event, time + late);
  return seconds;
}

interface Live {
  score: Score | undefined;
  pending: Score | undefined;
  energy: number;
  step: number;
  next: number;
  timer: ReturnType<typeof setInterval> | undefined;
}

/** Schedules every step due within the lookahead, catching up in whole steps after a stall (a hidden tab). */
function advance(rig: Rig, live: Live, lookahead: number): void {
  const now = rig.ctx.currentTime;
  while (live.score && live.next < now + lookahead) {
    if (live.pending && live.step % STEPS_PER_BAR === 0) {
      live.score = live.pending;
      live.pending = undefined;
      tune(rig, live.score);
    }
    const late = live.next < now - 0.1;
    live.next += late ? 60 / live.score.tempo / 4 : playStep(rig, live.score, [live.step, live.next, live.energy]);
    live.step += 1;
  }
}

/**
 * Makes a band on an audio context. It makes no sound until `start`.
 *
 * @param ctx An AudioContext, or an OfflineAudioContext for `schedule`.
 * @param options The destination, level and lookahead.
 */
export function createBand(ctx: BaseAudioContext, options: BandOptions = {}): Band {
  const rig = createRig(ctx, options);
  const lookahead = options.lookahead ?? 0.15;
  const live: Live = { score: undefined, pending: undefined, energy: 1, step: 0, next: 0, timer: undefined };
  const stop = (): void => {
    if (live.timer !== undefined) clearInterval(live.timer);
    live.timer = undefined;
    live.score = undefined;
    live.pending = undefined;
  };
  return {
    output: rig.master,
    get step() {
      return live.step;
    },
    get playing() {
      return live.timer !== undefined;
    },
    start(score, energy = live.energy) {
      stop();
      Object.assign(live, { score, energy: clamp(energy, 0, 1), step: 0, next: ctx.currentTime + 0.06 });
      tune(rig, score);
      live.timer = setInterval(() => {
        advance(rig, live, lookahead);
      }, 25);
      advance(rig, live, lookahead);
    },
    setScore(score) {
      if (live.score) live.pending = score;
    },
    setEnergy(energy) {
      live.energy = clamp(energy, 0, 1);
    },
    setGain(gain, seconds = 0.3) {
      rig.master.gain.setTargetAtTime(clamp(gain, 0, 1), ctx.currentTime, Math.max(0.01, seconds / 3));
    },
    schedule(score, { steps, from = 0, at = 0, energy = 1 }) {
      tune(rig, score);
      let time = at;
      for (let step = from; step < from + steps; step += 1) time += playStep(rig, score, [step, time, energy]);
      return time;
    },
    stop,
  };
}

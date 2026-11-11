/** The band's instruments, on plain Web Audio: a few oscillators, a filter and an envelope each. MIT. */
import type { Timbre } from "./styles.data.js";

/** One sounding note: when it starts, its pitch, how long it is held and how loud (0 to 1). */
export interface Hit {
  readonly time: number;
  readonly frequency: number;
  readonly seconds: number;
  readonly gain: number;
}

interface Shape {
  readonly wave: OscillatorType;
  readonly attack: number;
  readonly decay: number;
  /** Level held after the decay, as a share of the peak. */
  readonly sustain: number;
  readonly release: number;
  readonly level: number;
  /** A low-pass filter's cutoff, in hertz. */
  readonly cutoff?: number;
  /** A second oscillator, this many cents either side. */
  readonly spread?: number;
  /** Frequency modulation: the modulator's ratio to the note, and its depth as a share of the note's frequency. */
  readonly fm?: readonly [number, number];
}

const SHAPES: Readonly<Record<Timbre, Shape>> = {
  soft: { wave: "sine", attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.25, level: 0.5 },
  keys: { wave: "triangle", attack: 0.005, decay: 0.5, sustain: 0.2, release: 0.3, level: 0.5, cutoff: 2600 },
  pluck: { wave: "sawtooth", attack: 0.003, decay: 0.22, sustain: 0, release: 0.1, level: 0.45, cutoff: 2000 },
  pad: { wave: "sawtooth", attack: 0.5, decay: 0.6, sustain: 0.7, release: 1.2, level: 0.2, cutoff: 1100, spread: 9 },
  bell: { wave: "sine", attack: 0.004, decay: 1.4, sustain: 0, release: 0.4, level: 0.4, fm: [3.5, 1.6] },
  saw: { wave: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.15, level: 0.24, cutoff: 3000, spread: 6 },
  square: { wave: "square", attack: 0.003, decay: 0.08, sustain: 0.7, release: 0.04, level: 0.16 },
  sub: { wave: "triangle", attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.12, level: 0.7, cutoff: 500 },
};

/** Shapes a gain over a note: up to the peak, down to the sustain, away after the hold. Returns when it is silent. */
function envelope(gain: AudioParam, shape: Shape, hit: Hit): number {
  const peak = hit.gain * shape.level;
  const hold = Math.max(hit.seconds, shape.attack);
  gain.setValueAtTime(0, hit.time);
  gain.linearRampToValueAtTime(peak, hit.time + shape.attack);
  gain.setTargetAtTime(peak * shape.sustain, hit.time + shape.attack, shape.decay / 3);
  gain.setTargetAtTime(0, hit.time + hold, shape.release / 3);
  return hit.time + hold + shape.release * 1.6 + 0.05;
}

/** A bell's shimmer: a second oscillator bends the first one's pitch, fading as the note rings. */
function modulate(ctx: BaseAudioContext, carrier: OscillatorNode, hit: Hit, shape: Shape): void {
  if (!shape.fm) return;
  const [ratio, depth] = shape.fm;
  const modulator = ctx.createOscillator();
  const amount = ctx.createGain();
  modulator.frequency.value = hit.frequency * ratio;
  amount.gain.setValueAtTime(hit.frequency * depth, hit.time);
  amount.gain.setTargetAtTime(0, hit.time, shape.decay / 4);
  modulator.connect(amount).connect(carrier.frequency);
  modulator.start(hit.time);
  modulator.stop(hit.time + shape.decay * 2 + hit.seconds);
}

/**
 * Plays one note of a timbre into `out`.
 *
 * @param ctx The audio context, live or offline.
 * @param out Where the note goes.
 * @param timbre Which instrument.
 * @param hit When, what pitch, how long and how loud.
 */
export function strike(ctx: BaseAudioContext, out: AudioNode, timbre: Timbre, hit: Hit): void {
  const shape = SHAPES[timbre];
  const amp = ctx.createGain();
  const end = envelope(amp.gain, shape, hit);
  let head: AudioNode = amp;
  if (shape.cutoff !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.max(shape.cutoff, hit.frequency * 1.5);
    filter.connect(amp);
    head = filter;
  }
  for (const cents of shape.spread === undefined ? [0] : [-shape.spread, shape.spread]) {
    const oscillator = ctx.createOscillator();
    oscillator.type = shape.wave;
    oscillator.frequency.value = hit.frequency;
    oscillator.detune.value = cents;
    modulate(ctx, oscillator, hit, shape);
    oscillator.connect(head);
    oscillator.start(hit.time);
    oscillator.stop(end);
  }
  amp.connect(out);
}

/** What a drum needs: the context, where it goes and the noise it is cut from. */
export interface DrumRig {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
}

/** A burst of noise through a filter: the body of a snare, the whole of a hat. */
function burst(rig: DrumRig, spec: readonly [BiquadFilterType, number, number, number, number]): void {
  const { ctx, out, noise } = rig;
  const [type, frequency, time, level, seconds] = spec;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  source.buffer = noise;
  filter.type = type;
  filter.frequency.value = frequency;
  amp.gain.setValueAtTime(level, time);
  amp.gain.exponentialRampToValueAtTime(0.001, time + seconds);
  source.connect(filter).connect(amp).connect(out);
  source.start(time, (time * 7.3) % 0.5);
  source.stop(time + seconds + 0.02);
}

/** A sine that falls in pitch as it fades: a kick, or the knock under a snare. */
function thump(ctx: BaseAudioContext, out: AudioNode, spec: readonly [number, number, number, number, number]): void {
  const [from, to, time, level, seconds] = spec;
  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.frequency.setValueAtTime(from, time);
  oscillator.frequency.exponentialRampToValueAtTime(to, time + seconds * 0.4);
  amp.gain.setValueAtTime(level, time);
  amp.gain.exponentialRampToValueAtTime(0.001, time + seconds);
  oscillator.connect(amp).connect(out);
  oscillator.start(time);
  oscillator.stop(time + seconds + 0.02);
}

/**
 * Plays one drum hit.
 *
 * @param rig The context, the output and a buffer of white noise.
 * @param part Which drum.
 * @param time When it lands.
 * @param gain How hard, 0 to 1.
 */
export function drum(rig: DrumRig, part: "kick" | "snare" | "hat", time: number, gain: number): void {
  const { ctx, out } = rig;
  if (part === "kick") {
    thump(ctx, out, [150, 45, time, gain, 0.32]);
    return;
  }
  if (part === "hat") {
    burst(rig, ["highpass", 7500, time, gain * 0.5, gain > 0.6 ? 0.06 : 0.035]);
    return;
  }
  burst(rig, ["bandpass", 1900, time, gain * 0.8, 0.17]);
  thump(ctx, out, [210, 150, time, gain * 0.5, 0.09]);
}

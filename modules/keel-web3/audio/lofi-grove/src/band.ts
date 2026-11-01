// The band, Tone.js injected: the rig, patches, drums, air and nature voicing the events.

import { STEPS_PER_BAR } from "./songbook.js";
import type { KeysVoice, LeadVoice } from "./songbook.js";
import { VOICE_SALT, mixHash, random } from "./roll.js";
import { NO_LAYERS } from "./score.js";
import type { LofiLayers, LofiScore } from "./score.js";
import { stepEvents } from "./events.js";
import type { LofiEvent, LofiVoice } from "./events.js";

// ---------------------------------------------------------------- the band (Tone.js injected)

interface ParamLike {
  value: number;
  rampTo(value: number, rampTime: number): unknown;
}
interface NodeLike {
  connect(destination: unknown): unknown;
  dispose(): unknown;
}
interface InstrumentLike extends NodeLike {
  readonly volume: ParamLike;
  triggerAttackRelease(note: number, duration: number, time?: number, velocity?: number): unknown;
  releaseAll?(time?: number): unknown;
}
interface SourceLike extends NodeLike {
  readonly volume: ParamLike;
  start(time?: number): unknown;
  stop(time?: number): unknown;
}
interface FilterLike extends NodeLike {
  readonly frequency: ParamLike;
}
interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}
interface LfoEffectLike extends NodeLike {
  readonly depth: ParamLike;
  start(time?: number): unknown;
}
interface TransportLike {
  readonly bpm: ParamLike;
  swing: number;
  swingSubdivision: string;
  scheduleRepeat(callback: (time: number) => void, interval: string, startTime?: number): number;
  clear(id: number): unknown;
  start(time?: number): unknown;
  stop(time?: number): unknown;
  cancel(after?: number): unknown;
}
type Options = Readonly<Record<string, unknown>>;

/** The parts of Tone.js 15 this module calls. Pass the Tone namespace itself. */
export interface ToneLike {
  now(): number;
  getTransport(): TransportLike;
  getDestination(): NodeLike;
  readonly PolySynth: new (voice: unknown, options?: Options) => InstrumentLike;
  readonly FMSynth: new (options?: Options) => InstrumentLike;
  readonly Synth: new (options?: Options) => InstrumentLike;
  readonly MonoSynth: new (options?: Options) => InstrumentLike;
  readonly MembraneSynth: new (options?: Options) => InstrumentLike;
  readonly NoiseSynth: new (options?: Options) => InstrumentLike & { triggerAttackRelease(duration: number, time?: number, velocity?: number): unknown };
  readonly Noise: new (options?: Options) => SourceLike;
  readonly Player: new (options?: Options) => SourceLike;
  readonly ToneAudioBuffer: { fromArray(array: Float32Array): unknown };
  readonly Filter: new (options?: Options) => FilterLike;
  readonly Gain: new (gain?: number) => GainLike;
  readonly Reverb: new (options?: Options) => NodeLike;
  readonly FeedbackDelay: new (options?: Options) => NodeLike;
  readonly Distortion: new (options?: Options) => NodeLike;
  readonly Compressor: new (options?: Options) => NodeLike;
  readonly Vibrato: new (options?: Options) => LfoEffectLike & { readonly frequency: ParamLike };
  readonly Tremolo: new (options?: Options) => LfoEffectLike;
  readonly AutoFilter: new (options?: Options) => LfoEffectLike;
}

export interface LofiBand {
  /** Starts the loop from its first bar on Tone's transport. */
  start(score: LofiScore): void;
  /**
   * Mix and tempo follow at once; a new structure waits for the next bar line.
   * `fromTop` starts the new structure from the first bar of its form.
   */
  setScore(score: LofiScore, options?: { readonly fromTop?: boolean }): void;
  stop(): void;
  dispose(): void;
  readonly playing: boolean;
  readonly score: LofiScore | null;
}

export interface LofiOptions {
  /** Where the band plays; defaults to Tone's destination (keel-audio sets its level and mute). */
  readonly destination?: unknown;
  /** Master level in decibels. Defaults to 0. */
  readonly volume?: number;
}

const hz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

function crackleBuffer(tone: ToneLike, seed: number): unknown {
  const rng = random(mixHash(seed, VOICE_SALT.crackle));
  // Seven seconds at the usual rate; a 48 kHz context just loops it a little sooner.
  const length = 44100 * 7;
  const data = new Float32Array(length);
  let tail = 0;
  for (let index = 0; index < length; index += 1) {
    const roll = rng();
    // Rare loud pops, more frequent dust, each a decaying click.
    if (roll < 0.00012) tail = (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.5);
    else if (roll < 0.0028) tail = (rng() - 0.5) * 0.12;
    data[index] = tail;
    tail *= 0.62;
  }
  return tone.ToneAudioBuffer.fromArray(data);
}

interface Rig {
  readonly instruments: Readonly<Record<LofiVoice, InstrumentLike>>;
  readonly keysVoices: Readonly<Record<KeysVoice, InstrumentLike>>;
  readonly leads: Readonly<Record<LeadVoice, InstrumentLike>>;
  readonly gains: Readonly<Record<keyof LofiLayers, GainLike>>;
  readonly sources: readonly SourceLike[];
  readonly lowpass: FilterLike;
  readonly wow: LfoEffectLike;
  readonly send: GainLike;
  readonly nodes: NodeLike[];
}

function buildBus(tone: ToneLike, options: LofiOptions, nodes: NodeLike[]): { input: GainLike; lowpass: FilterLike; send: GainLike; wow: LfoEffectLike } {
  const keep = <T extends NodeLike>(node: T): T => { nodes.push(node); return node; };
  const compressor = keep(new tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.25 }));
  compressor.connect(options.destination ?? tone.getDestination());
  const master = keep(new tone.Gain(10 ** ((options.volume ?? 0) / 20)));
  master.connect(compressor);
  const lowpass = keep(new tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -12, Q: 0.3 }));
  const tape = keep(new tone.Distortion({ distortion: 0.08, oversample: "2x", wet: 0.5 }));
  const wow = keep(new tone.Vibrato({ frequency: 0.45, depth: 0.25, maxDelay: 0.006 }));
  const input = keep(new tone.Gain(1));
  input.connect(wow);
  wow.connect(tape);
  tape.connect(lowpass);
  lowpass.connect(master);
  const reverb = keep(new tone.Reverb({ decay: 3.8, preDelay: 0.02, wet: 1 }));
  reverb.connect(lowpass);
  const send = keep(new tone.Gain(0.3));
  send.connect(reverb);
  return { input, lowpass, send, wow };
}

/** A synth patch: which Tone synth, its options, its level, a tone filter and an optional wobble. */
interface Patch {
  readonly synth: "Synth" | "FMSynth";
  readonly options: Options;
  readonly volume: number;
  readonly cutoff: number;
  readonly tremolo?: readonly [number, number];
  readonly vibrato?: readonly [number, number];
  /** Octaves the voice plays above the written notes. */
  readonly octave?: number;
}

const KEYS_PATCHES: Readonly<Record<KeysVoice, Patch>> = {
  // A soft, felted upright: a quick hammer and a long fade.
  felt: { synth: "Synth", volume: -3, cutoff: 1900, options: { oscillator: { type: "triangle" }, envelope: { attack: 0.004, decay: 1.9, sustain: 0.04, release: 1.1 } } },
  // An electric piano: bell-cored FM with a slow tremolo.
  rhodes: {
    synth: "FMSynth", volume: -4, cutoff: 2400, tremolo: [3.2, 0.3],
    options: { harmonicity: 1, modulationIndex: 1.4, oscillator: { type: "sine" }, modulation: { type: "triangle" }, envelope: { attack: 0.006, decay: 2.4, sustain: 0.14, release: 1.3 }, modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.08, release: 0.6 } },
  },
  // A breathy organ that swells and holds.
  organ: { synth: "Synth", volume: -11, cutoff: 2600, vibrato: [5.6, 0.08], options: { oscillator: { type: "custom", partials: [1, 0.45, 0.25, 0, 0.12] }, envelope: { attack: 0.07, decay: 0.3, sustain: 0.75, release: 0.9 } } },
  // A nylon-string pluck, dark and short.
  nylon: { synth: "Synth", volume: -7, cutoff: 1400, options: { oscillator: { type: "sawtooth" }, envelope: { attack: 0.002, decay: 0.55, sustain: 0, release: 0.35 } } },
};

const LEAD_PATCHES: Readonly<Record<LeadVoice, Patch>> = {
  // Woody FM pluck.
  kalimba: { synth: "FMSynth", volume: -6, cutoff: 5000, options: { harmonicity: 3.01, modulationIndex: 5, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.7 }, modulationEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 } } },
  // A small bell an octave up.
  musicbox: { synth: "FMSynth", volume: -12, cutoff: 6000, octave: 1, options: { harmonicity: 5.07, modulationIndex: 1.6, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.001, decay: 1.6, sustain: 0, release: 1.2 }, modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.3 } } },
  // A soft wooden flute that breathes in and wavers.
  flute: { synth: "Synth", volume: -8, cutoff: 3200, vibrato: [5, 0.12], options: { oscillator: { type: "sine" }, envelope: { attack: 0.07, decay: 0.15, sustain: 0.7, release: 0.45 } } },
  // Mallets on metal bars with the motor on.
  vibes: { synth: "FMSynth", volume: -8, cutoff: 4500, tremolo: [5.5, 0.45], options: { harmonicity: 4, modulationIndex: 1.1, oscillator: { type: "sine" }, modulation: { type: "sine" }, envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 1.6 }, modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 } } },
};

type Keep = <T extends NodeLike>(node: T) => T;

/** Builds a patch as synth → wobble → tone filter → out. */
function buildPatch(tone: ToneLike, keep: Keep, patch: Patch, out: NodeLike): InstrumentLike {
  const synth = keep(new tone.PolySynth(tone[patch.synth], patch.options));
  synth.volume.value = patch.volume;
  const filter = keep(new tone.Filter({ type: "lowpass", frequency: patch.cutoff, Q: 0.4 }));
  let head: NodeLike = synth;
  if (patch.tremolo) {
    const tremolo = keep(new tone.Tremolo({ frequency: patch.tremolo[0], depth: patch.tremolo[1], spread: 60 }));
    tremolo.start();
    head.connect(tremolo);
    head = tremolo;
  }
  if (patch.vibrato) {
    const vibrato = keep(new tone.Vibrato({ frequency: patch.vibrato[0], depth: patch.vibrato[1] }));
    head.connect(vibrato);
    head = vibrato;
  }
  head.connect(filter);
  filter.connect(out);
  return synth;
}

function buildVoices<V extends string>(tone: ToneLike, keep: Keep, patches: Readonly<Record<V, Patch>>, out: NodeLike): Record<V, InstrumentLike> {
  const voices = {} as Record<V, InstrumentLike>;
  for (const voice of Object.keys(patches) as V[]) voices[voice] = buildPatch(tone, keep, patches[voice], out);
  return voices;
}

function buildDrums(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], out: NodeLike): Pick<Rig["instruments"], "kick" | "snare" | "wood" | "hat"> {
  // The kit is dusty: low-passed and a little crushed before the tape.
  const kitTone = keep(new tone.Filter({ type: "lowpass", frequency: 5200, Q: 0.5 }));
  const grit = keep(new tone.Distortion({ distortion: 0.18, wet: 0.35 }));
  kitTone.connect(grit);
  grit.connect(out);
  const kick = keep(new tone.MembraneSynth({ pitchDecay: 0.045, octaves: 4.5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 } }));
  kick.volume.value = -8;
  const snare = keep(new tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 } }));
  snare.volume.value = -10;
  const snareBand = keep(new tone.Filter({ type: "bandpass", frequency: 1900, Q: 0.7 }));
  const wood = keep(new tone.MembraneSynth({ pitchDecay: 0.008, octaves: 1.6, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03 } }));
  wood.volume.value = -10;
  const hat = keep(new tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 } }));
  hat.volume.value = -12;
  const hatBand = keep(new tone.Filter({ type: "highpass", frequency: 7200 }));
  kick.connect(gains.kick);
  snare.connect(snareBand);
  snareBand.connect(gains.snare);
  wood.connect(gains.wood);
  hat.connect(hatBand);
  hatBand.connect(gains.hat);
  for (const key of ["kick", "snare", "wood"] as const) gains[key].connect(kitTone);
  // The hats skip the kit's low-pass, which would take them away entirely.
  gains.hat.connect(out);
  return { kick, snare, wood, hat };
}

function buildAir(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], seed: number, out: NodeLike): SourceLike[] {
  const crackle = keep(new tone.Player({ url: crackleBuffer(tone, seed), loop: true }));
  crackle.volume.value = -20;
  const hiss = keep(new tone.Noise({ type: "brown" }));
  hiss.volume.value = -42;
  const rain = keep(new tone.Noise({ type: "pink" }));
  rain.volume.value = -23;
  const rainTone = keep(new tone.Filter({ type: "bandpass", frequency: 2400, Q: 0.35 }));
  const wind = keep(new tone.Noise({ type: "pink" }));
  wind.volume.value = -20;
  const gust = keep(new tone.AutoFilter({ frequency: 0.07, baseFrequency: 160, octaves: 3.4, filter: { type: "bandpass", Q: 1.4 } }));
  gust.start();
  crackle.connect(gains.crackle);
  hiss.connect(gains.hiss);
  rain.connect(rainTone);
  rainTone.connect(gains.rain);
  wind.connect(gust);
  gust.connect(gains.wind);
  for (const key of ["crackle", "hiss", "rain", "wind"] as const) gains[key].connect(out);
  return [crackle, hiss, rain, wind];
}

function buildNature(tone: ToneLike, keep: <T extends NodeLike>(node: T) => T, gains: Rig["gains"], out: NodeLike): Pick<Rig["instruments"], "bird" | "cricket"> {
  const bird = keep(new tone.Synth({ portamento: 0.028, oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.07, sustain: 0.2, release: 0.05 } }));
  bird.volume.value = -27;
  const cricket = keep(new tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.002, decay: 0.02, sustain: 0, release: 0.01 } }));
  cricket.volume.value = -36;
  bird.connect(gains.birds);
  cricket.connect(gains.crickets);
  gains.birds.connect(out);
  gains.crickets.connect(out);
  return { bird, cricket };
}

function buildRig(tone: ToneLike, seed: number, options: LofiOptions): Rig {
  const nodes: NodeLike[] = [];
  const keep = <T extends NodeLike>(node: T): T => { nodes.push(node); return node; };
  const bus = buildBus(tone, options, nodes);
  const gains = Object.fromEntries(Object.keys(NO_LAYERS).map((key) => [key, keep(new tone.Gain(0))])) as unknown as Rig["gains"];
  const keysVoices = buildVoices(tone, keep, KEYS_PATCHES, gains.keys);
  // The leads share a dotted-eighth echo.
  const echo = keep(new tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.26, wet: 0.24 }));
  echo.connect(gains.melody);
  const leads = buildVoices(tone, keep, LEAD_PATCHES, echo);
  // The budding figure has a kalimba of its own, so a sprout can sing before the tree has a melody.
  const bud = buildPatch(tone, keep, LEAD_PATCHES.kalimba, gains.bud);
  const bass = keep(new tone.MonoSynth({
    oscillator: { type: "triangle" },
    filter: { type: "lowpass", Q: 1 },
    envelope: { attack: 0.012, decay: 0.3, sustain: 0.65, release: 0.35 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.3, baseFrequency: 110, octaves: 2.2 },
  }));
  bass.volume.value = -11;
  bass.connect(gains.bass);
  for (const key of ["keys", "melody", "bud", "bass"] as const) gains[key].connect(bus.input);
  // The melody and keys sit in the room; the kit and bass stay close.
  gains.keys.connect(bus.send);
  gains.melody.connect(bus.send);
  gains.bud.connect(bus.send);
  const drums = buildDrums(tone, keep, gains, bus.input);
  const sources = buildAir(tone, keep, gains, seed, bus.lowpass);
  const nature = buildNature(tone, keep, gains, bus.lowpass);
  gains.birds.connect(bus.send);
  return { instruments: { keys: keysVoices.felt, melody: leads.kalimba, bud, bass, ...drums, ...nature }, keysVoices, leads, gains, sources, lowpass: bus.lowpass, wow: bus.wow, send: bus.send, nodes };
}

function applyMix(rig: Rig, score: LofiScore, ramp: number): void {
  for (const key of Object.keys(score.layers) as (keyof LofiLayers)[]) {
    rig.gains[key].gain.rampTo(score.layers[key], ramp);
  }
  rig.lowpass.frequency.rampTo(score.cutoff, ramp);
  rig.wow.depth.rampTo(score.wow, ramp);
  rig.send.gain.rampTo(score.space, ramp);
}

/** The instrument and octave shift for an event under the current song. */
function voiceFor(rig: Rig, score: LofiScore, voice: LofiVoice): [InstrumentLike, number] {
  if (voice === "keys") return [rig.keysVoices[score.keysVoice], 0];
  if (voice === "melody") return [rig.leads[score.lead], (LEAD_PATCHES[score.lead].octave ?? 0) * 12];
  return [rig.instruments[voice], 0];
}

const lastStart = new WeakMap<InstrumentLike, number>();

/**
 * Tone refuses a note that starts before an instrument's previous one, and a
 * human nudge or two lines landing on one 16th can ask for that; keep each
 * instrument's starts in order instead.
 */
function inOrder(instrument: InstrumentLike, time: number): number {
  const start = Math.max(time, (lastStart.get(instrument) ?? 0) + 0.002);
  lastStart.set(instrument, start);
  return start;
}

function play(rig: Rig, score: LofiScore, item: LofiEvent, time: number, sixteenth: number): void {
  const [instrument, shift] = voiceFor(rig, score, item.voice);
  const duration = Math.max(0.03, item.length * sixteenth);
  if (item.voice === "snare" || item.voice === "hat") {
    (instrument as InstrumentLike & { triggerAttackRelease(duration: number, time?: number, velocity?: number): unknown }).triggerAttackRelease(duration, inOrder(instrument, time + item.nudge), item.velocity);
    return;
  }
  item.notes.forEach((note, index) => {
    instrument.triggerAttackRelease(hz(note + shift), duration, inOrder(instrument, time + item.nudge + index * item.spread), item.velocity);
  });
}

function silence(rig: Rig, now: number): void {
  for (const source of rig.sources) source.stop(now + 0.05);
  for (const instrument of [...Object.values(rig.instruments), ...Object.values(rig.keysVoices), ...Object.values(rig.leads)]) instrument.releaseAll?.(now);
}

/**
 * The band: builds a small Tone.js graph and plays `stepEvents` on Tone's
 * transport. Tone is injected; the module never imports it or reads globals.
 */
export function createLofi(tone: ToneLike, options: LofiOptions = {}): LofiBand {
  let rig: Rig | null = null;
  let current: LofiScore | null = null;
  let pending: LofiScore | null = null;
  let fromTop = false;
  let repeat = -1;
  let step = 0;
  const transport = tone.getTransport();

  const tick = (time: number): void => {
    if (rig === null || current === null) return;
    if (pending !== null && step % STEPS_PER_BAR === 0) {
      [current, pending, step, fromTop] = [pending, null, fromTop ? 0 : step, false];
    }
    const sixteenth = 60 / transport.bpm.value / 4;
    for (const item of stepEvents(current, step)) play(rig, current, item, time, sixteenth);
    step += 1;
  };

  const band: LofiBand = {
    get playing() { return repeat >= 0; },
    get score() { return pending ?? current; },
    start(score) {
      band.stop();
      rig ??= buildRig(tone, score.seed, options);
      current = score;
      pending = null;
      step = 0;
      transport.bpm.value = score.bpm;
      transport.swing = score.swing;
      transport.swingSubdivision = "16n";
      applyMix(rig, score, 1.5);
      const now = tone.now();
      for (const source of rig.sources) source.start(now);
      repeat = transport.scheduleRepeat(tick, "16n", 0);
      transport.start(now + 0.1);
    },
    setScore(score, options) {
      if (rig === null || current === null) { current = score; return; }
      if (JSON.stringify(score) === JSON.stringify(pending ?? current)) return;
      applyMix(rig, score, 2.5);
      transport.bpm.rampTo(score.bpm, options?.fromTop === true ? 0.5 : 4);
      transport.swing = score.swing;
      // A routine update must not cancel a restart already waiting for the bar line.
      if (score.structure !== current.structure) [fromTop, pending] = [options?.fromTop === true || (fromTop && pending?.structure === score.structure), score];
      else { current = score; pending = null; }
    },
    stop() {
      if (repeat >= 0) { transport.clear(repeat); repeat = -1; }
      transport.stop();
      transport.cancel(0);
      if (rig !== null) silence(rig, tone.now());
    },
    dispose() {
      band.stop();
      for (const node of rig?.nodes ?? []) node.dispose();
      rig = null;
      current = null;
      pending = null;
    },
  };
  return band;
}

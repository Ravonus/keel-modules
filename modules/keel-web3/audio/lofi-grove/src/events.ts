// Events: what every voice plays at a step of the score.

import { ARPEGGIO, BASS_LINES, COMPS, FORM_BARS, GROOVES, HAT_ACCENTS, STEPS_PER_BAR, at, clamp } from "./songbook.js";
import type { Groove } from "./songbook.js";
import { VOICE_SALT, barRandom, mixHash, random } from "./roll.js";
import type { LofiChord, LofiScore } from "./score.js";

// ---------------------------------------------------------------- events

export type LofiVoice = "keys" | "bass" | "melody" | "bud" | "kick" | "snare" | "wood" | "hat" | "bird" | "cricket";

/** One note to play at a 16th step. */
export interface LofiEvent {
  readonly voice: LofiVoice;
  /** MIDI notes (drums use one nominal note). */
  readonly notes: readonly number[];
  /** Length in 16ths. */
  readonly length: number;
  readonly velocity: number;
  /** Seconds after the step: a human push or drag. */
  readonly nudge: number;
  /** Seconds between notes of a chord or a figure. */
  readonly spread: number;
}

const event = (voice: LofiVoice, notes: readonly number[], length: number, velocity: number, nudge = 0, spread = 0): LofiEvent => ({
  voice, notes, length, velocity: clamp(velocity, 0.02, 1), nudge, spread,
});
const human = (rng: () => number, amount: number): number => (rng() - 0.5) * 2 * amount;

/** The chord under a bar of the form, and whether the bar is that chord's last. */
function chordAt(score: LofiScore, inForm: number): { chord: LofiChord; next: LofiChord; last: boolean } {
  const index = Math.floor(inForm / score.barsPerChord);
  return { chord: at(score.chords, index), next: at(score.chords, index + 1), last: (inForm + 1) % score.barsPerChord === 0 };
}

/** A broken chord in eighths, up and back down. */
function arpeggioEvents(score: LofiScore, chord: LofiChord, step: number, rng: () => number): LofiEvent[] {
  if (step % 2 !== 0) return [];
  const notes = [...chord.keys, ...chord.keys.slice(1, -1).reverse()];
  const note = at(notes, step / 2);
  return [event("keys", [note], 3, (step % 8 === 0 ? 0.58 : 0.44) + human(rng, 0.06), Math.abs(human(rng, 0.008)))];
}

function keysEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.keys <= 0.01) return [];
  const rng = barRandom(score.seed, bar, "keys");
  const { chord, last } = chordAt(score, bar % FORM_BARS);
  if (score.comp === ARPEGGIO) return arpeggioEvents(score, chord, step, rng);
  // The second bar of a long chord leans back to a held pad half the time.
  const held = score.barsPerChord === 2 && last && rng() < 0.5;
  const pattern = held ? at(COMPS, 0) : at(COMPS, rng() < 0.16 ? score.comp + 1 : score.comp);
  const hits = pattern.filter(([start]) => start === step);
  return hits.map(([, length, velocity]) => event("keys", chord.keys, length, velocity * (held ? 0.75 : 1) + human(rng, 0.06), Math.abs(human(rng, 0.012)), 0.011 + rng() * 0.012));
}

function bassEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.bass <= 0.01) return [];
  const rng = barRandom(score.seed, bar, "bass");
  const { chord, next, last } = chordAt(score, bar % FORM_BARS);
  const events: LofiEvent[] = [];
  for (const [start, tone, length] of at(BASS_LINES, score.bassLine)) {
    if (start !== step) continue;
    const note = tone === "fifth" ? chord.bass + 7 : tone === "octave" ? chord.bass + 12 : chord.bass;
    events.push(event("bass", [note], length, 0.75 + human(rng, 0.08), human(rng, 0.006)));
  }
  // A chromatic step into the next chord, at the end of a chord's last bar.
  if (step === 14 && last && rng() < 0.5) events.push(event("bass", [next.bass + (rng() < 0.5 ? -1 : 1)], 2, 0.55));
  return events;
}

/** The phrase plan of a form: statement, answer, varied statement, then the budding figure. */
function melodyEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.melody <= 0.01 || score.density <= 0) return [];
  const inForm = bar % FORM_BARS;
  const cycle = Math.floor(bar / FORM_BARS);
  // Every fourth pass the melody rests and lets the room breathe.
  if (inForm >= 6 || cycle % 4 === 3) return [];
  const phrase = Math.floor(inForm / 2);
  const offset = (inForm % 2) * STEPS_PER_BAR + step;
  const rng = random(mixHash(score.seed, cycle, phrase, VOICE_SALT.melody));
  const events: LofiEvent[] = [];
  score.motif.forEach(([start, degree, length], index) => {
    const keep = index === 0 || rng() < score.density;
    const moved = phrase === 2 && rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
    // The answer comes home: its last note lands on the tonic.
    const resolved = phrase === 1 && index === score.motif.length - 1 ? 0 : degree + moved;
    if (start !== offset || !keep) return;
    events.push(event("melody", [at(score.scale, clamp(resolved, 0, score.scale.length - 1))], length, 0.62 + human(rng, 0.1), Math.abs(human(rng, 0.01))));
  });
  return events;
}

/** Closes each form with a figure that grows a note with each stage of the tree. */
function budEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  if (score.layers.bud <= 0.01 || score.budNotes <= 0 || bar % FORM_BARS !== 6 || step !== 8) return [];
  const rng = barRandom(score.seed, bar, "melody");
  const start = score.budFalls ? score.budNotes + 1 : Math.floor(rng() * 2);
  const notes = Array.from({ length: score.budNotes }, (_, index) => at(score.scale, clamp(score.budFalls ? start - index : start + index, 0, score.scale.length - 1)));
  return [event("bud", notes, 6, 0.5, 0, 60 / score.bpm / 2)];
}

interface DrumBar {
  readonly score: LofiScore;
  readonly groove: Groove;
  readonly step: number;
  readonly inForm: number;
  readonly rng: () => number;
}

function kickEvent(bar: DrumBar, breakBar: boolean): LofiEvent | null {
  const { score, groove, step, rng } = bar;
  const ghost = step === 7 && rng() < 0.18;
  if (score.layers.kick <= 0.01 || breakBar || !(groove.kick.includes(step) || ghost)) return null;
  return event("kick", [33], 2, (ghost ? 0.45 : 0.9) + human(rng, 0.06), human(rng, 0.005));
}

function snareEvent(bar: DrumBar): LofiEvent | null {
  const { score, groove, step, inForm, rng } = bar;
  const backbeat = groove.snare.includes(step);
  const fill = inForm === 7 && (step === 14 || step === 15) && rng() < 0.6;
  const ghost = step === 15 && rng() < 0.12;
  if (score.layers.snare <= 0.01 || !(backbeat || fill || ghost)) return null;
  return event("snare", [38], 2, (backbeat ? 0.8 : 0.3) + human(rng, 0.06), 0.004 + Math.abs(human(rng, 0.012)));
}

/** Before the tree has a kit, a wooden knock keeps the backbeat. */
function woodEvent(bar: DrumBar): LofiEvent | null {
  const { score, step, rng } = bar;
  const ghost = step === 14 && rng() < 0.25;
  if (score.layers.wood <= 0.01 || !(step === 4 || step === 12 || ghost)) return null;
  return event("wood", [76], 1, (ghost ? 0.35 : 0.7) + human(rng, 0.08), human(rng, 0.006));
}

function hatEvent(bar: DrumBar): LofiEvent | null {
  const { score, groove, step, rng } = bar;
  if (score.layers.hat <= 0.01 || !groove.hat.includes(step) || rng() < 0.08) return null;
  return event("hat", [42], 1, at(HAT_ACCENTS, Math.floor(step / 2)) + human(rng, 0.08), human(rng, 0.007));
}

function drumEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  const inForm = bar % FORM_BARS;
  // The last bar of every fourth pass drops the kick for a breath.
  const breakBar = inForm === 7 && Math.floor(bar / FORM_BARS) % 4 === 3;
  const drums: DrumBar = { score, groove: at(GROOVES, score.groove), step, inForm, rng: barRandom(score.seed, bar * STEPS_PER_BAR + step, "drums") };
  return [kickEvent(drums, breakBar), snareEvent(drums), woodEvent(drums), hatEvent(drums)].filter((item): item is LofiEvent => item !== null);
}

function natureEvents(score: LofiScore, bar: number, step: number): LofiEvent[] {
  const rng = barRandom(score.seed, bar * STEPS_PER_BAR + step, "nature");
  const events: LofiEvent[] = [];
  if (score.layers.birds > 0.01 && rng() < 0.012 * score.layers.birds) {
    const base = 91 + Math.floor(rng() * 8);
    const notes = Array.from({ length: 2 + Math.floor(rng() * 3) }, (_, index) => base + (index % 2 === 0 ? 0 : 3 + Math.floor(rng() * 4)));
    events.push(event("bird", notes, 1, 0.5 + rng() * 0.3, rng() * 0.05, 0.06 + rng() * 0.03));
  }
  if (score.layers.crickets > 0.01 && step % 4 === 0 && rng() < 0.55) {
    events.push(event("cricket", [107, 107, 107], 1, 0.4 + rng() * 0.3, rng() * 0.08, 0.045));
  }
  return events;
}

/**
 * Everything that plays at a 16th step since the band started. Pure: the
 * same score and step always give the same events.
 */
export function stepEvents(score: LofiScore, step: number): LofiEvent[] {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  return [
    ...keysEvents(score, bar, inBar),
    ...bassEvents(score, bar, inBar),
    ...melodyEvents(score, bar, inBar),
    ...budEvents(score, bar, inBar),
    ...drumEvents(score, bar, inBar),
    ...natureEvents(score, bar, inBar),
  ];
}

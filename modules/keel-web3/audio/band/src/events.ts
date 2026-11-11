/** What plays at each sixteenth note. Pure: the same score, step and energy always give the same events. MIT. */
import { at, mixHash, unit } from "./roll.js";
import { STEPS_PER_BAR, noteOf } from "./score.js";
import type { Chord, Score } from "./score.js";
import type { Part } from "./styles.data.js";

/** One note or hit: its part, MIDI note (0 for drums), length in steps and loudness (0 to 1). */
export interface BandEvent {
  readonly part: Part;
  readonly note: number;
  readonly length: number;
  readonly gain: number;
}

interface Moment {
  readonly score: Score;
  readonly bar: number;
  readonly step: number;
  readonly chord: Chord;
}

/** The parts playing at an energy: they join in the style's order, the first from silence up. */
export function partsAt(score: Score, energy: number): Part[] {
  const layers = score.sound.layers;
  return layers.filter((_, index) => energy * layers.length > index * 0.95);
}

const hit = (part: Part, gain: number): BandEvent => ({ part, note: 0, length: 1, gain });

function drums(part: "kick" | "snare" | "hat", { score, bar, step }: Moment): BandEvent[] {
  const mark = score[part].charAt(step);
  const roll = unit(mixHash(score.seed, bar, step, part.length));
  // The last bar of the form closes with a snare fill (where the style has a snare), and now and then a hat sits out.
  const closing = (bar + 1) % score.chords.length === 0 && step >= 13;
  const fill = part === "snare" && closing && score.snare.includes("x") && roll < 0.55;
  if (fill) return [hit(part, 0.45 + roll * 0.4)];
  if (mark === "x") return part === "hat" && roll < 0.08 ? [] : [hit(part, 0.85 + roll * 0.15)];
  return mark === "o" ? [hit(part, 0.4 + roll * 0.15)] : [];
}

function bass({ score, step, chord }: Moment): BandEvent[] {
  const mark = score.bass.charAt(step);
  const lift = { r: 0, "5": 7, o: 12 }[mark];
  if (lift === undefined) return [];
  let length = 1;
  while (step + length < STEPS_PER_BAR && score.bass.charAt(step + length) === "." && length < 8) length += 1;
  return [{ part: "bass", note: chord.root + lift, length, gain: 0.9 }];
}

const STABS = [0, 6, 10];

function chords({ score, bar, step, chord }: Moment): BandEvent[] {
  const all = (length: number, gain: number): BandEvent[] =>
    chord.notes.map((note) => ({ part: "chord", note, length, gain }));
  switch (score.sound.comp) {
    case "pad":
      return step === 0 ? all(STEPS_PER_BAR, 0.6) : [];
    case "stab":
      return STABS.includes(step) ? all(2.5, step === 0 ? 0.75 : 0.55) : [];
    case "pulse":
      return step % 2 === 0 ? all(1.6, step % 8 === 0 ? 0.6 : 0.4) : [];
    case "arp": {
      if (step % 2 === 1) return [];
      const turn = step / 2 + bar * 3;
      const note = at(chord.notes, turn) + (turn % (chord.notes.length * 2) >= chord.notes.length ? 12 : 0);
      return [{ part: "chord", note, length: 1.8, gain: 0.55 }];
    }
  }
}

function lead({ score, bar, step, chord }: Moment): BandEvent[] {
  if (step % 2 === 1) return [];
  // A two-bar phrase, answered, then rested one pass in four so the melody breathes.
  const phrase = Math.floor(bar / 2);
  if (phrase % 4 === 3) return [];
  const eighth = step / 2;
  const roll = unit(mixHash(score.seed, phrase % 2, bar % 2, eighth, 7));
  const strong = step % 8 === 0;
  if (!strong && roll > score.sound.lead * 1.6) return [];
  const degree = strong ? at([0, 2, 4], Math.floor(roll * 3)) : at(score.motif, eighth + (bar % 2) * 3);
  const note = noteOf(score.mode, 60 + score.key, chord.degree + degree);
  return [{ part: "lead", note: note > 84 ? note - 12 : note, length: strong ? 3 : 1.7, gain: strong ? 0.7 : 0.55 }];
}

/**
 * The events that start on a step.
 *
 * @param score From scoreOf.
 * @param step Sixteenth notes since the start, from 0.
 * @param energy 0 to 1: how many of the style's parts play. Default 1, the whole band.
 * @returns The notes and hits, in no particular order.
 */
export function eventsAt(score: Score, step: number, energy = 1): BandEvent[] {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const moment: Moment = { score, bar, step: step % STEPS_PER_BAR, chord: at(score.chords, bar) };
  return partsAt(score, energy).flatMap((part) => {
    if (part === "bass") return bass(moment);
    if (part === "chord") return chords(moment);
    if (part === "lead") return lead(moment);
    return drums(part, moment);
  });
}

// Parameters: named numbers worked out each frame, in a fixed order, from a few terms. A term reads a track the host
// sampled, an earlier parameter, the clock, a seeded wiggle or a seeded blink. Every term is plus, minus, times and
// divide over exact hashes and the exact sine, so a figure moves the same on every engine.

import { clamp, cosine, puppetHash, sine, smooth } from "./exact.js";

/** A seeded blink on the clock: the lids' weight, 0 open to 1 shut. Times in seconds. */
export interface BlinkSettings {
  readonly seed?: number;
  /** The shortest and longest wait from one blink to the next. */
  readonly period: readonly [number, number];
  /** Seconds to close, to hold shut and to open. */
  readonly close: number;
  readonly hold: number;
  readonly open: number;
  /** The share of blinks that come twice. */
  readonly double: number;
}

/**
 * One term of a parameter. A number is a constant. `track` reads `values[target][property]` from the host's sampled
 * tracks, named `"target.property"` (`"rig.card.lean"`), times `gain`. `param` reads an earlier parameter. `time` is
 * that many units a second of the clock. `wiggle` is `[seed, hz, amp]`: two sines at a seeded phase, 0 at rest. `blink`
 * is a seeded blink.
 */
export type Term =
  | number
  | { readonly track: string; readonly gain?: number }
  | { readonly param: string; readonly gain?: number }
  | { readonly time: number }
  | { readonly wiggle: readonly [seed: number, hz: number, amp: number] }
  | { readonly blink: BlinkSettings };

/** A named parameter: the sum of its terms, clamped when `range` is given. */
export interface Param {
  readonly name: string;
  readonly sum: readonly Term[];
  readonly range?: readonly [number, number];
}

/** What the host's tracks sampled this frame, by target then property (the `tracks` module's `Sampled`). */
export type Values = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The clock and the tracks for one evaluation. Under `still` the clock, wiggles and blinks hold at rest. */
export interface ParamInput {
  readonly time: number;
  readonly values?: Values;
  readonly still?: boolean;
}

const TURN = 6.283185307179586;
/** A blink's second close starts this long after the first one opens. */
const DOUBLE_GAP = 0.08;

/** A track's number, or 0 when it is missing or not a number. */
function trackOf(values: Values | undefined, name: string): number {
  const dot = name.indexOf(".");
  const value = values?.[name.slice(0, dot)]?.[name.slice(dot + 1)];
  return typeof value === "number" ? value : 0;
}

/** Two sines at seeded phases, the second at 1.37 times the rate, taken from their value at t = 0. */
export function wiggle(seed: number, hz: number, amp: number, time: number): number {
  const [a, b] = [puppetHash(seed, 0, 1) * TURN, puppetHash(seed, 0, 2) * TURN];
  const [x, y] = [TURN * hz * time, TURN * hz * 1.37 * time];
  // (sin(x + a) − sin(a), so a wiggle starts from 0 and a still figure is the figure at rest.)
  const first = sine(x) * cosine(a) + cosine(x) * sine(a) - sine(a);
  const second = sine(y) * cosine(b) + cosine(y) * sine(b) - sine(b);
  return amp * (0.6 * first + 0.4 * second);
}

/** One blink's lid weight at `x` seconds after it starts. */
function lidAt(s: BlinkSettings, x: number): number {
  if (x <= 0) return 0;
  if (x < s.close) return smooth(x / s.close);
  if (x <= s.close + s.hold) return 1;
  return 1 - smooth((x - s.close - s.hold) / Math.max(1e-6, s.open));
}

/**
 * The lids' weight at `time`. The clock is cut into slots of the mean period; each slot has one blink at a seeded
 * offset within half the period's spread, so waits fall between the shortest and the longest. Two slots are looked at,
 * whatever the time: the cost is fixed.
 */
export function blinkAt(s: BlinkSettings, time: number): number {
  const [lo, hi] = [Math.min(s.period[0], s.period[1]), Math.max(s.period[0], s.period[1])];
  const slot = Math.max(1e-3, (lo + hi) / 2);
  const spread = (hi - lo) / 2;
  const span = s.close + s.hold + s.open;
  const k = Math.floor(time / slot);
  let lid = 0;
  for (const n of [k - 1, k]) {
    const start = n * slot + puppetHash(s.seed ?? 1, n, 3) * spread;
    lid = Math.max(lid, lidAt(s, time - start));
    if (puppetHash(s.seed ?? 1, n, 4) < s.double) lid = Math.max(lid, lidAt(s, time - start - span - DOUBLE_GAP));
  }
  return lid;
}

function termOf(term: Term, input: ParamInput, done: Readonly<Record<string, number>>): number {
  if (typeof term === "number") return term;
  const still = input.still === true;
  if ("track" in term) return trackOf(input.values, term.track) * (term.gain ?? 1);
  if ("param" in term) return (done[term.param] ?? 0) * (term.gain ?? 1);
  if ("time" in term) return still ? 0 : term.time * input.time;
  if ("wiggle" in term) return still ? 0 : wiggle(term.wiggle[0], term.wiggle[1], term.wiggle[2], input.time);
  return still ? 0 : blinkAt(term.blink, input.time);
}

/**
 * Every parameter's value, in the order given: a parameter may read only those before it.
 *
 * @param params The figure's parameters.
 * @param input The clock, the sampled tracks and whether motion is reduced.
 * @returns Values by name.
 */
export function evaluateParams(params: readonly Param[], input: ParamInput): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    let v = 0;
    for (const term of p.sum) v += termOf(term, input, out);
    out[p.name] = p.range ? clamp(v, p.range[0], p.range[1]) : v;
  }
  return out;
}

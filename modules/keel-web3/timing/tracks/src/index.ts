/**
 * tracks: keyed tracks sampled at a position. MIT.
 *
 * A track keys one property of one target. Each key is `[position, value,
 * handles?]`: the position in the sequence's own units (a scrolled page uses
 * one unit per viewport), the value there, and the cubic-bezier handle pair
 * that eases the way from this key to the next, (.5, 0, .5, 1) when left out.
 * Values are numbers, vectors (arrays of numbers) or `#rrggbb` colours. Before
 * the first key and after the last the track holds. A clip's progress is a
 * number track like any other. Pure arithmetic: no DOM, no renderer, nothing
 * injected. The host samples and applies.
 */

/** A cubic-bezier handle pair, `[x1, y1, x2, y2]`, as CSS `cubic-bezier()` takes it. */
export type Handles = readonly [number, number, number, number];
/** What a key holds: a number, a vector or a `#rrggbb` colour. One track keeps to one kind. */
export type Value = number | readonly number[] | string;
/** One key: the position, the value there, and the handles easing the way to the next key. */
export type Key = readonly [position: number, value: Value, handles?: Handles];
/** One property of one target, keyed. `drive` says what samples it: scroll position (the default) or the clock. */
export interface Track {
  readonly target: string;
  readonly property: string;
  readonly keys: readonly Key[];
  readonly drive?: "scrub" | "time";
}
/** Sampled values by target, then property. */
export type Sampled = Record<string, Record<string, Value>>;

/** The handles a key gets when it names none: a symmetric ease in and out. */
export const EASE: Handles = [0.5, 0, 0.5, 1];

/** One axis of the bezier at parameter `t`, with its two handle coordinates `a` and `b`. */
const curve = (a: number, b: number, t: number): number =>
  (((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t + 3 * a) * t;

/**
 * The eased share of a segment: the bezier's y where its x is `u`.
 *
 * @param handles The segment's handle pair; x1 and x2 in 0..1 so the curve is a function of x.
 * @param u How far along the segment, 0..1; clamped.
 * @returns The eased share, 0 at the start and 1 at the end.
 */
export function ease(handles: Handles, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = handles;
  // Bisect x(t) = u. Arithmetic only, so every engine lands on the same t.
  let lo = 0;
  let hi = 1;
  let t = 0.5;
  for (let i = 0; i < 32; i += 1) {
    t = (lo + hi) / 2;
    const x = curve(x1, x2, t);
    if (x === u) break;
    if (x < u) lo = t;
    else hi = t;
  }
  return curve(y1, y2, t);
}

const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

function mixColour(a: string, b: string, t: number): string {
  let out = "#";
  for (let i = 0; i < 3; i += 1) {
    const from = channel(a, i);
    const v = Math.min(255, Math.max(0, Math.round(from + (channel(b, i) - from) * t)));
    out += (v < 16 ? "0" : "") + v.toString(16);
  }
  return out;
}

/**
 * Mixes two values of one kind: numbers, vectors element by element, colours channel by channel.
 * Values of different kinds step from `a` to `b` at t = 1.
 *
 * @param a The value at t = 0.
 * @param b The value at t = 1.
 * @param t The share of `b`; may leave 0..1 when an ease overshoots.
 * @returns The mixed value, of the kind `a` and `b` share.
 */
export function mix(a: Value, b: Value, t: number): Value {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (typeof a === "string" && typeof b === "string") return mixColour(a, b, t);
  if (typeof a === "object" && typeof b === "object") return a.map((v, i) => v + ((b[i] ?? v) - v) * t);
  return t < 1 ? a : b;
}

/**
 * The value of one track at `at`: held before the first key and after the last, eased between.
 *
 * @param keys The track's keys in position order.
 * @param at The position to sample.
 * @returns The value there.
 * @throws RangeError when the track has no key.
 */
export function sampleTrack(keys: readonly Key[], at: number): Value {
  const first = keys[0];
  if (first === undefined) throw new RangeError("A track needs at least one key.");
  let i = 0;
  for (let next = keys[1]; next !== undefined && next[0] <= at; next = keys[i + 1]) i += 1;
  const from = keys[i] ?? first;
  const to = keys[i + 1];
  if (to === undefined || at <= from[0]) return from[1];
  return mix(from[1], to[1], ease(from[2] ?? EASE, (at - from[0]) / (to[0] - from[0])));
}

/**
 * Samples every track: scrub tracks at `position`, time tracks at `time`. Without a `time`, time
 * tracks are left out.
 *
 * @param tracks The tracks, as the motion spec lists them.
 * @param position The scroll position in sequence units; may be below 0 or past the last key.
 * @param time The clock, for tracks with `drive: "time"`.
 * @returns Values by target, then property.
 */
export function sampleTracks(tracks: readonly Track[], position: number, time?: number): Sampled {
  const out: Sampled = {};
  for (const track of tracks) {
    const at = track.drive === "time" ? time : position;
    if (at === undefined) continue;
    (out[track.target] ??= {})[track.property] = sampleTrack(track.keys, at);
  }
  return out;
}

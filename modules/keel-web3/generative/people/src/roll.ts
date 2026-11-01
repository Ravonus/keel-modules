// The roll: a seed's stream of numbers, and the colours it picks from.

import { clamp, mix } from "./vec.js";

// ---------------------------------------------------------------- the roll

/** A seed's stream of numbers, 0 to 1: the same on every machine. */
export function streamOf(seed: number, salt: number): () => number {
  let s = (Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rand: () => number, list: readonly string[]): string => list[Math.floor(rand() * list.length)] ?? "#000000";

/** Bell-shaped: most people near the middle of a range, few at its ends. */
export const bell = (rand: () => number, a: number, b: number): number => mix(a, b, (rand() + rand() + rand()) / 3);

export function weighted<T>(rand: () => number, list: readonly (readonly [T, number])[]): T {
  let left = rand() * list.reduce((sum, [, w]) => sum + w, 0);
  const hit = list.find(([, w]) => { left -= w;
  return left <= 0; });
  const [first] = list;
  if (!first) throw new Error("nothing to pick from");
  return (hit ?? first)[0];
}

const hex = (v: number): string => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");

/** A colour from hue (turns), saturation and lightness. */
export function hsl(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Skin, from deep to fair: lightness rolled freely, its warmth its own. */
const SKIN_RAMP = ["#3f2619", "#5e3a26", "#80533a", "#a67351", "#c49270", "#ddb195", "#efcfb9"] as const;
export const skinTone = (rand: () => number): string => {
  const at = rand() * (SKIN_RAMP.length - 1);
  const i = Math.floor(at);
  const tone = blend(SKIN_RAMP[i] ?? "#a67351", SKIN_RAMP[Math.min(i + 1, SKIN_RAMP.length - 1)] ?? "#a67351", at - i);
  return blend(tone, rand() < 0.5 ? "#d98c80" : "#d9ad66", rand() * 0.14);
};

export const HAIR_TONES = ["#14100e", "#1f1612", "#33221a", "#4e3424", "#6e4a2c", "#8e6a3c", "#b89560", "#8c3a1e", "#d8b878", "#c9a25e", "#a0522a"] as const;
export const LOUD_HAIR = ["#d0408c", "#3a6ad8", "#2ea880", "#8a48d0"] as const;
export const IRIS_TONES = ["#2e1c10", "#46291a", "#5c3a1e", "#3a5a78", "#4e7a5a", "#6a7a84"] as const;
export const DARK_IRIS = ["#1c100a", "#2e1c10", "#46291a", "#6e4a24"] as const;

export type Weighted<T> = readonly (readonly [T, number])[];

/** Two hex colours, `k` of the way from the first to the second. */
export function blend(a: string, b: string, k: number): string {
  const at = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number): string => Math.round(mix(at(a, i), at(b, i), k)).toString(16).padStart(2, "0");
  return `#${part(0)}${part(1)}${part(2)}`;
}

export const hashed = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
return v - Math.floor(v); };

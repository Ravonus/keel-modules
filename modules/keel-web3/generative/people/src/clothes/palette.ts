// The palette: skin, hair, eyes and clothes in colours that go together.

import { raised } from "../exact.js";
import { clamp, mix } from "../vec.js";
import { HAIR_TONES, LOUD_HAIR, blend, hashed, hsl, pick, weighted } from "../roll.js";
import type { Weighted } from "../roll.js";
import type { Age, Genre, HairStyle, Sex } from "../body/person.js";

const GREY_HAIR: readonly string[] = ["#d8d6d2", "#b9b7b4", "#8f8e8c", "#ecebe6"];


const HAIRS: Readonly<Record<Sex, Weighted<HairStyle>>> = {
  female: [["long", 4], ["wavy", 3.4], ["bob", 3], ["bangs", 2.6], ["pony", 2.4], ["bun", 2], ["braids", 2], ["twintails", 1.4], ["curly", 2], ["afro", 1.2], ["locs", 1.2], ["shag", 2], ["side", 0.8], ["undercut", 0.5]],
  male: [["crop", 4], ["side", 3.4], ["undercut", 2.6], ["curly", 2], ["shag", 1.6], ["afro", 1.2], ["locs", 0.6], ["mohawk", 0.5], ["bald", 1.4], ["long", 0.25], ["wavy", 0.25], ["bun", 0.12], ["pony", 0.12]],
};


/** Colours that go together: a main colour, a muted second, and one small loud one. */
function clothesColours(rand: () => number): Record<string, string> {
  const hue = rand();
  const loud = rand() < 0.3;
  const top = hsl(hue, loud ? mix(0.45, 0.7, rand()) : mix(0.08, 0.34, rand()), mix(0.26, 0.66, rand()));
  const blue = rand() < 0.55;
  const bottom = blue
    ? hsl(mix(0.58, 0.62, rand()), mix(0.26, 0.42, rand()), mix(0.2, 0.42, rand()))
    : hsl(hue + 0.5, mix(0.04, 0.18, rand()), mix(0.16, 0.5, rand()));
  return {
    top,
    bottom,
    trim: hsl(hue + mix(0.3, 0.7, rand()), mix(0.4, 0.7, rand()), mix(0.36, 0.76, rand())),
    shoe: hsl(rand(), mix(0, 0.26, rand()), mix(0.14, 0.72, rand())),
    sole: hsl(0.1, 0.1, mix(0.2, 0.86, rand())),
  };
}

const SHADES: Readonly<Record<Genre, (rand: () => number) => Readonly<Record<string, string>>>> = {
  casual: () => ({}),
  street: (rand) => ({ top: hsl(rand(), 0.14, mix(0.2, 0.5, rand())), bottom: hsl(0.1, 0.1, mix(0.22, 0.42, rand())), trim: hsl(rand(), 0.8, 0.55), sole: "#e8e6e0" }),
  formal: (rand) => {
    const suit = hsl(mix(0.58, 0.68, rand()), 0.22, mix(0.12, 0.26, rand()));
    return { top: suit, bottom: suit, trim: "#ece8e0", shoe: "#1c1614", sole: "#141010" };
  },
  sport: (rand) => ({ top: hsl(rand(), 0.72, 0.5), bottom: hsl(0.62, 0.2, 0.16), trim: "#f0f0ee", shoe: "#e8e6e2", sole: "#ffffff" }),
  goth: (rand) => ({ top: "#1a1720", bottom: "#141216", trim: hsl(mix(0.95, 1, rand()) % 1, 0.6, 0.3), shoe: "#121014", sole: "#0c0a0e" }),
  work: (rand) => ({ top: hsl(mix(0.09, 0.26, rand()), 0.3, mix(0.26, 0.42, rand())), bottom: hsl(mix(0.58, 0.62, rand()), 0.3, mix(0.2, 0.3, rand())), trim: "#d8782a", shoe: "#5a3c24", sole: "#241810" }),
  boho: (rand) => ({ top: hsl(mix(0.42, 0.6, rand()), 0.34, mix(0.3, 0.46, rand())), bottom: hsl(mix(0.04, 0.5, rand()), 0.3, mix(0.3, 0.5, rand())), trim: hsl(mix(0.45, 0.55, rand()), 0.4, 0.5), shoe: "#8a5a34" }),
  preppy: (rand) => ({ top: hsl(rand(), 0.42, mix(0.68, 0.82, rand())), bottom: hsl(0.11, 0.3, mix(0.6, 0.72, rand())), trim: "#28386a", shoe: "#6a3c22", sole: "#2a1a10" }),
};

/** How much light a colour gives back, as the eye weighs it, 0 to 1. */
export const glowOf = (hex: string): number => [[1, 0.2126], [3, 0.7152], [5, 0.0722]].reduce((sum, [i = 1, k = 0]) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return sum + k * (c <= 0.04045 ? c / 12.92 : raised((c + 0.055) / 1.055, 2, 2));
}, 0);

/**
 * How deep a skin is, 0 from a mid brown up to 1: a multiply hardly shows on it, so whatever draws a feature must work
 * harder.
 */
export const deepOf = (skin: string): number => clamp((0.2 - glowOf(skin)) / 0.16, 0, 1);

/**
 * Hair the same light as the skin reads as a bald head, so on fair skin it goes darker. On dark skin dark hair is left
 * be: a rim of light parts it from the face.
 */
function apart(hair: string, skin: string): string {
  const light = (hex: string): number => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0) / 765;
  if (Math.abs(light(hair) - light(skin)) > 0.28 || light(skin) <= 0.3) return hair;
  return blend(hair, "#2a1a12", 0.45);
}

/** Trousers the same light as the shirt read as one sack: they go darker, or lighter under a dark top. */
export function parted(bottom: string, top: string): string {
  const light = (hex: string): number => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0) / 765;
  if (Math.abs(light(bottom) - light(top)) > 0.15) return bottom;
  return blend(bottom, light(top) > 0.3 ? "#14141c" : "#a8a49c", 0.5);
}

/**
 * A tone of hair from one roll: the darker it is, the likelier on darker skin, and any of them can be had by anyone.
 */
function hairTone(roll: number, deep: number): string {
  const low = HAIR_TONES.slice(0, 5);
  const high = HAIR_TONES.slice(5);
  const dark = mix(low.length / HAIR_TONES.length, 0.93, deep);
  const [list, at] = roll < dark ? [low, roll / dark] : [high, (roll - dark) / (1 - dark)];
  return list[Math.floor(at * list.length)] ?? "#14100e";
}

/**
 * A brow goes with its hair, as far as it can and still be a brow: never so near the skin that light takes it off the
 * face, nor so far from it that it is a bar.
 */
function browOn(skin: string, hair: string): string {
  const brow = blend(hair, "#2a1a16", 0.3);
  const own = glowOf(brow);
  const most = glowOf(skin) * 0.4;
  const least = glowOf(skin) * 0.2;
  if (own > most) return blend(brow, "#120a07", 1 - Math.sqrt(most / own));
  return own < least ? blend(brow, skin, (1 - Math.sqrt(own / least)) * 0.8) : brow;
}

/** The colours of a brow, a lip and a flush, from what they lie on. */
function faceColours(skin: string, hair: string, wash: string): Record<string, string> {
  const deep = deepOf(skin);
  return {
    brow: browOn(skin, hair),
    beard: blend(hair, "#1a100b", mix(0.25, 0.6, deep)),
    lip: blend(skin, blend(wash, "#8c464c", deep), mix(0.58, 0.54, deep)),
    crease: blend(skin, "#3a1a16", mix(0.3, 0.6, deep)),
    flush: blend(skin, deep > 0.3 ? "#a8402c" : "#e0705c", 0.045),
    stub: blend(skin, hair, 0.22),
  };
}

/** What a palette is drawn for: how old they are, the colour of their eyes, and the genre they dress in. */
interface Wearing {
  readonly age: Age;
  readonly iris: string;
  readonly genre: Genre;
}

export function paletteOf(rand: () => number, skin: string, { age, iris, genre }: Wearing): Record<string, string> {
  const dyed = rand() < 0.04;
  const roll = rand();
  const natural = dyed ? LOUD_HAIR[Math.floor(roll * LOUD_HAIR.length)] ?? "#3a6ad8" : hairTone(roll, deepOf(skin));
  const hair = blend(apart(age === "elder" ? pick(rand, GREY_HAIR) : natural, skin), "#4c4650", 0.16);
  return { skin, hair, ...faceColours(skin, hair, hsl(mix(0.97, 1.02, rand()) % 1, 0.4, 0.42)), dark: "#2a1a16", eye: iris, ...clothesColours(rand), ...SHADES[genre](rand) };
}

const COILED: readonly HairStyle[] = ["curly", "afro", "locs", "braids"];
const FINE: readonly HairStyle[] = ["long", "side", "wavy"];

/**
 * Hair as a sex wears it, on this skin: the same roll for everyone, so a seed keeps its style, and only fine straight
 * hair may turn to coils, likelier the darker the skin. Every style stays open to all.
 */
export function hairOn(seed: number, sex: Sex, deep: number, roll: number): HairStyle {
  const chosen = weighted(() => roll, HAIRS[sex]);
  if (!FINE.includes(chosen) || hashed(seed, 907) >= deep * 0.7) return chosen;
  return weighted(() => hashed(seed, 911), HAIRS[sex].filter(([style]) => COILED.includes(style)));
}

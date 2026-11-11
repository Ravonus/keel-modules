// Colours a pass names: a hex, a palette entry, a ramp (the light guide's value bucketed into palette entries, as a
// painter squints to masses) or `under` (the brush only picks up what is there). All exact: bytes over 255.
import { clamp } from "./exact.js";

/** An sRGB colour, 0..1 a channel. */
export type Rgb = readonly [number, number, number];

export type ColourRule =
  | { readonly kind: "flat"; readonly rgb: Rgb }
  | { readonly kind: "ramp"; readonly palette: readonly Rgb[]; readonly steps: number; readonly shift: number }
  | { readonly kind: "under" };

/** `#rrggbb` to 0..1 channels. */
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new TypeError(`painting: "${hex}" is not #rrggbb.`);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A palette's colour at `t` of the way from its first entry (0) to its last (1). */
export function along(palette: readonly Rgb[], t: number): Rgb {
  const last = palette.length - 1;
  const at = clamp(t, 0, 1) * last;
  const i = Math.min(Math.floor(at), Math.max(last - 1, 0));
  const a = palette[i] ?? [0, 0, 0];
  const b = palette[Math.min(i + 1, last)] ?? a;
  const f = last === 0 ? 0 : at - i;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function paletteOf(palettes: Readonly<Record<string, readonly string[]>>, name: string): readonly Rgb[] {
  const list = palettes[name];
  if (!list) throw new TypeError(`painting: no palette "${name}".`);
  return list.map(rgb);
}

/**
 * Reads a colour expression.
 *
 * @param text `#hex`, `palette(name, i)`, `ramp(name, light, steps[, shift])` or `under`.
 * @param palettes The recipe's palettes, lightest entry first.
 * @returns The rule a pass colours its strokes by.
 */
export function colourRule(text: string, palettes: Readonly<Record<string, readonly string[]>>): ColourRule {
  const s = text.replace(/\s+/gu, "");
  if (s === "under") return { kind: "under" };
  if (s.startsWith("#")) return { kind: "flat", rgb: rgb(s) };
  const call = /^(palette|ramp)\(([^)]*)\)$/u.exec(s);
  if (!call) throw new TypeError(`painting: cannot read the colour "${text}".`);
  const [name = "", a = "", b = "", c = ""] = (call[2] ?? "").split(",");
  const palette = paletteOf(palettes, name);
  if (call[1] === "palette") return { kind: "flat", rgb: along(palette, Number(a) / Math.max(palette.length - 1, 1)) };
  if (a !== "light") throw new TypeError(`painting: a ramp reads the light guide, not "${a}".`);
  return { kind: "ramp", palette, steps: clamp(Math.round(Number(b === "" ? 5 : b)), 2, 16), shift: Math.round(+c) };
}

/**
 * A ramp's colour for a light value: the value falls in one of `steps` buckets (shifted, darker below 0), and the
 * bucket's place picks along the palette from its lightest entry; `wander` moves it within a bucket or so.
 *
 * @param value 0 dark to 1 light.
 * @param wander In buckets, signed.
 * @returns The colour and the bucket, 0 the darkest.
 */
export function rampColour(rule: ColourRule & { kind: "ramp" }, value: number, wander: number): [Rgb, number] {
  const bucket = Math.min(Math.floor(clamp(value, 0, 1) * rule.steps), rule.steps - 1);
  const k = clamp(bucket + rule.shift, 0, rule.steps - 1);
  const t = (rule.steps - 1 - k + wander) / (rule.steps - 1);
  return [along(rule.palette, t), k];
}

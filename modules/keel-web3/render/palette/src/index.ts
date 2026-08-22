/** Compact palette parsing, interpolation, and deterministic selection. MIT. */

/** Color channels as [red, green, blue, alpha], each 0 to 255. Alpha may be omitted. */
export type ColorChannels = readonly number[];

/**
 * Parses a #rrggbb or #rrggbbaa hex color into channel values.
 *
 * @param value Hex color string; case-insensitive.
 * @returns [red, green, blue, alpha], each 0 to 255; alpha defaults to 255.
 * @throws TypeError when the string is not a valid hex color.
 */
export function parseHexColor(value: string): number[] {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/iu.exec(value);
  if (match?.[1] === undefined) throw new TypeError(`Invalid color ${value}.`);
  const hex = match[1];
  const alpha = match[2];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).concat(alpha === undefined ? 255 : Number.parseInt(alpha, 16));
}

/**
 * Formats channel values as a CSS rgba() string.
 *
 * @param color [red, green, blue, alpha] channels; missing channels are treated as 255.
 * @returns The rgba() string with alpha scaled to 0 to 1.
 */
export function rgba(color: ColorChannels): string {
  return `rgba(${color[0] ?? 255}, ${color[1] ?? 255}, ${color[2] ?? 255}, ${Math.round(color[3] ?? 255) / 255})`;
}

/**
 * Linearly interpolates two colors channel by channel.
 *
 * @param left Start color; missing channels are treated as 255.
 * @param right End color; missing channels are treated as 255.
 * @param amount Interpolation factor, clamped to [0, 1].
 * @returns A four-channel color of rounded values.
 */
export function mixColors(left: ColorChannels, right: ColorChannels, amount: number): number[] {
  const t = Math.min(Math.max(amount, 0), 1);
  return Array.from({ length: 4 }, (_, index) => Math.round((left[index] ?? 255) + ((right[index] ?? 255) - (left[index] ?? 255)) * t));
}

/** Throws unless the value is a non-empty array; guards untyped JS callers. */
function assertNonEmptyPalette(palette: unknown): void {
  if (!Array.isArray(palette) || palette.length === 0) throw new RangeError("Palette cannot be empty.");
}

/**
 * Selects a palette entry by index, wrapping negative and overflow indexes.
 *
 * @param palette Non-empty array of hex color strings.
 * @param index Any integer; it wraps modulo the palette length.
 * @returns The parsed [red, green, blue, alpha] channels of the entry.
 * @throws RangeError when the palette is empty or not an array.
 * @throws TypeError when the selected entry is not a valid hex color.
 */
export function paletteColor(palette: readonly string[], index: number): number[] {
  assertNonEmptyPalette(palette);
  const entry = palette[((index % palette.length) + palette.length) % palette.length];
  if (entry === undefined) throw new RangeError("Palette cannot be empty.");
  return parseHexColor(entry);
}

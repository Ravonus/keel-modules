// The settings an artist chooses when including the module, normalised into a recipe and a palette. Anything
// missing or malformed falls back to its default.

import { DETAIL } from "./bust.js";
import { PALETTE } from "./render.js";
import type { BustRecipe } from "./bust.js";
import type { Palette } from "./render.js";

export interface PortraitSettings {
  /** What decides the face and the hair, a whole number. */
  readonly seed: number;
  /** A frontal, eyes to camera; B turned 25° and looking down, the cap pulled lower. */
  readonly face: "A" | "B";
  readonly detail: "hero" | "mid" | "far";
  /** The card pinched between finger and thumb, or floating over a raised finger. */
  readonly hand: "pinch" | "point";
  /** The cap's, the hair's and the card's colours, #rrggbb. */
  readonly cap: string;
  readonly hair: string;
  readonly card: string;
}

export const DEFAULT_PORTRAIT_SETTINGS: PortraitSettings = {
  seed: 7, face: "A", detail: "hero", hand: "pinch", cap: PALETTE.cap, hair: PALETTE.hair, card: PALETTE.card,
};

const HEX = /^#[0-9a-f]{6}$/iu;

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
}

function seedOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PORTRAIT_SETTINGS.seed;
  return Math.min(2 ** 31 - 1, Math.max(0, Math.round(value)));
}

/**
 * Normalises untrusted settings, usually `KEEL_INPUTS.portrait`, into complete `PortraitSettings`.
 *
 * @param input Plain settings object, or undefined for all defaults.
 */
export function portraitSettings(input?: unknown): PortraitSettings {
  if (input === null || typeof input !== "object") return DEFAULT_PORTRAIT_SETTINGS;
  const value = input as Readonly<Record<string, unknown>>;
  const d = DEFAULT_PORTRAIT_SETTINGS;
  return {
    seed: seedOf(value.seed),
    face: value.face === "B" ? "B" : "A",
    detail: value.detail === "mid" || value.detail === "far" ? value.detail : "hero",
    hand: value.hand === "point" ? "point" : "pinch",
    cap: hex(value.cap, d.cap), hair: hex(value.hair, d.hair), card: hex(value.card, d.card),
  };
}

/** The recipe and the palette a sitter's settings give. */
export function sitterOf(settings: PortraitSettings): { recipe: BustRecipe; palette: Palette } {
  const { seed, face, hand, cap, hair, card } = settings;
  return { recipe: { seed, face, hand, detail: DETAIL[settings.detail] }, palette: { ...PALETTE, cap, hair, card } };
}

// Settings, checked and bounded, and the hand-over's look as a function of t: how much line work each scene carries,
// how far the fill has come, which scene is current and where a radial reveal centres.

/** How a hand-over looks. Colours are display (sRGB) values: the blend works on finished pictures. */
export interface BlendSettings {
  /** The noise texture's seed. */
  readonly seed: number;
  /** The line work's colour, "#rrggbb". */
  readonly lineColour: string;
  /** The seam's glow colour, "#rrggbb". */
  readonly seamColour: string;
  /** How bright the seam glows, 0 to 4. */
  readonly glow: number;
  /** The seam's width, as a share of the frame's height, 0 to 0.05. */
  readonly seam: number;
  /** The luma step that makes a line, 0.01 to 1: lower draws more lines. */
  readonly edge: number;
  /** How many times the noise repeats down the frame's height, 0.25 to 8. */
  readonly noiseScale: number;
  /** How far the pointer pulls a radial reveal's centre, 0 to 1. */
  readonly pull: number;
}

export const DEFAULT_BLEND_SETTINGS: BlendSettings = {
  seed: 1,
  lineColour: "#f7f7ee",
  seamColour: "#fff1cc",
  glow: 1.4,
  seam: 0.003,
  edge: 0.12,
  noiseScale: 0.6,
  pull: 0.1,
};

const HEX = /^#[0-9a-f]{6}$/iu;

function bounded(value: unknown, fallback: number, low: number, high: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

const hex = (value: unknown, fallback: string): string =>
  typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;

/**
 * Settings from anything: each one checked and bounded, a missing or broken one falling back to its default.
 *
 * @param input A partial settings object, or nothing for the defaults.
 */
export function blendSettings(input?: unknown): BlendSettings {
  if (input === undefined || input === null || typeof input !== "object") return DEFAULT_BLEND_SETTINGS;
  const v = input as Partial<Record<keyof BlendSettings, unknown>>;
  const d = DEFAULT_BLEND_SETTINGS;
  return {
    seed: Math.trunc(bounded(v.seed, d.seed, 0, 0x7fffffff)),
    lineColour: hex(v.lineColour, d.lineColour),
    seamColour: hex(v.seamColour, d.seamColour),
    glow: bounded(v.glow, d.glow, 0, 4),
    seam: bounded(v.seam, d.seam, 0, 0.05),
    edge: bounded(v.edge, d.edge, 0.01, 1),
    noiseScale: bounded(v.noiseScale, d.noiseScale, 0.25, 8),
    pull: bounded(v.pull, d.pull, 0, 1),
  };
}

/** "#rrggbb" to [r, g, b] in 0..1, unconverted: the blend mixes display values. */
export function displayColour(value: string): [number, number, number] {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The line work each scene carries at `t`. The incoming's lines are full at 0, half at the switch and gone by 0.9;
 * the outgoing's start at the switch and are full at 1.
 *
 * @returns `[incoming, outgoing]`, each 0..1.
 */
export function blendLines(t: number): [number, number] {
  const s = clamp01(t);
  const incoming = s <= 0.5 ? 1 - s : Math.max(0, (0.9 - s) / 0.8);
  return [incoming, Math.max(0, (s - 0.5) * 2)];
}

/** How far the incoming's fill has come at `t`, 0..1: it starts at 0.25 and covers everything at 1. */
export function blendFill(t: number): number {
  return clamp01((t - 0.25) / 0.75);
}

/** The current scene at `t`: the outgoing ("a") before the switch at 0.5, the incoming ("b") from it. */
export function currentAt(t: number): "a" | "b" {
  return t < 0.5 ? "a" : "b";
}

/** A point in -1..1 each way with y up, as both a centre and a pointer are given. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A radial reveal's centre: the host's point (a projected 3D point, say) pulled toward the pointer by `pull`.
 *
 * @returns The centre in 0..1 texture space, y up.
 */
export function radialCentre(centre: Point, pointer: Point | null, pull: number): [number, number] {
  const x = pointer === null ? centre.x : centre.x + (pointer.x - centre.x) * pull;
  const y = pointer === null ? centre.y : centre.y + (pointer.y - centre.y) * pull;
  return [(x + 1) / 2, (y + 1) / 2];
}

/** The distance from a centre (0..1 texture space) to the farthest corner, measured in frame heights. */
export function farthestCorner(centre: readonly [number, number], aspect: number): number {
  const dx = Math.max(centre[0], 1 - centre[0]) * aspect;
  const dy = Math.max(centre[1], 1 - centre[1]);
  return Math.sqrt(dx * dx + dy * dy);
}

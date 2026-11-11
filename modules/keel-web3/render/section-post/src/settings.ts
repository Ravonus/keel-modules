// Settings, checked and bounded; a frame's values with the settings as their defaults; and when a frame needs no pass.

/** How the overlay looks when a frame does not say. Colours are display (sRGB) values: the pass follows the finish. */
export interface PostSettings {
  /** The noise texture's seed. */
  readonly seed: number;
  /** The paper's colour, "#rrggbb". */
  readonly colour: string;
  /** How torn the panel's edges are, 0 (straight) to 1. */
  readonly tear: number;
  /** The fibre line along a torn or straight edge: a lighter band of paper fibres, 0 to 1. */
  readonly fibre: number;
  /** The paper's own mottle, 0 to 1. */
  readonly paper: number;
  /** A soft shadow the panel casts past its edges onto the frame, 0 to 1. */
  readonly shadow: number;
  /** One-pixel grain over the whole frame, as a share of full luminance, 0 to 0.2. */
  readonly grain: number;
  /** How many times the noise repeats down the frame's height, 0.25 to 8. */
  readonly noiseScale: number;
  /** Give the frame's own target a depth buffer: needed when the frame drawn into it is a plain scene, not a finish. */
  readonly depth: boolean;
}

export const DEFAULT_POST_SETTINGS: PostSettings = {
  seed: 1,
  colour: "#f7f7ee",
  tear: 0,
  fibre: 0.8,
  paper: 0.4,
  shadow: 0.35,
  grain: 0.02,
  noiseScale: 1,
  depth: false,
};

/** What a host feeds each frame, from its tracks. Every field is optional; the settings fill the rest. */
export interface PostValues {
  /**
   * The panel's sweep: 0 none; 0 → 1 its top edge rises from the frame's bottom to its top; 1 it covers the frame;
   * 1 → 2 its bottom edge rises after it, so it leaves through the top; 2 gone.
   */
  readonly progress?: number;
  /** Moves the panel's edges up (positive) or down, in frame heights, -1..1: a second track, a mobile one, say. */
  readonly position?: number;
  /** The paper's colour, [r, g, b] each 0..1 (display values). */
  readonly colour?: readonly [number, number, number];
  readonly tear?: number;
  readonly fibre?: number;
  readonly shadow?: number;
  readonly grain?: number;
  /** Darkens the frame under the panel, 0..1. */
  readonly darken?: number;
  /** Blurs the frame under the panel, 0..1: the outer taps reach `blur` × 16 % of the frame's height. */
  readonly blur?: number;
}

/** A frame's values, every one present and bounded. */
export interface Frame {
  readonly progress: number;
  readonly position: number;
  readonly colour: readonly [number, number, number];
  readonly tear: number;
  readonly fibre: number;
  readonly shadow: number;
  readonly grain: number;
  readonly darken: number;
  readonly blur: number;
}

const HEX = /^#[0-9a-f]{6}$/iu;

function bounded(value: unknown, fallback: number, low: number, high: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

/**
 * Settings from anything: each one checked and bounded, a missing or broken one falling back to its default.
 *
 * @param input A partial settings object, or nothing for the defaults.
 */
export function postSettings(input?: unknown): PostSettings {
  if (input === undefined || input === null || typeof input !== "object") return DEFAULT_POST_SETTINGS;
  const v = input as Partial<Record<keyof PostSettings, unknown>>;
  const d = DEFAULT_POST_SETTINGS;
  return {
    seed: Math.trunc(bounded(v.seed, d.seed, 0, 0x7fffffff)),
    colour: typeof v.colour === "string" && HEX.test(v.colour) ? v.colour.toLowerCase() : d.colour,
    tear: bounded(v.tear, d.tear, 0, 1),
    fibre: bounded(v.fibre, d.fibre, 0, 1),
    paper: bounded(v.paper, d.paper, 0, 1),
    shadow: bounded(v.shadow, d.shadow, 0, 1),
    grain: bounded(v.grain, d.grain, 0, 0.2),
    noiseScale: bounded(v.noiseScale, d.noiseScale, 0.25, 8),
    depth: typeof v.depth === "boolean" ? v.depth : d.depth,
  };
}

/** "#rrggbb" to [r, g, b] in 0..1, unconverted: the pass works on display values. */
export function displayColour(value: string): [number, number, number] {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A frame's values, bounded, with the settings standing in for any left out.
 *
 * @param values What the host's tracks give this frame.
 * @param settings The overlay's settings.
 */
export function frameOf(values: PostValues, settings: PostSettings): Frame {
  const colour = values.colour?.length === 3 && values.colour.every(Number.isFinite)
    ? ([...values.colour] as [number, number, number])
    : displayColour(settings.colour);
  return {
    progress: bounded(values.progress, 0, 0, 2),
    position: bounded(values.position, 0, -1, 1),
    colour,
    tear: bounded(values.tear, settings.tear, 0, 1),
    fibre: bounded(values.fibre, settings.fibre, 0, 1),
    shadow: bounded(values.shadow, settings.shadow, 0, 1),
    grain: bounded(values.grain, settings.grain, 0, 0.2),
    darken: bounded(values.darken, 0, 0, 1),
    blur: bounded(values.blur, 0, 0, 1),
  };
}

/** How far a torn edge can stray from its line, in frame heights, at `tear` 1. */
export const TEAR_REACH = 0.016;
/** How far past its edges the panel's shadow and fibres reach, in frame heights. */
const EDGE_REACH = 0.03;
/** An edge beyond the frame, for a panel open at that end. */
const OPEN = 4;

/**
 * Where the panel's edges are this frame, in frame heights from the bottom (y up). Before progress 1 the panel is open
 * below and its top edge is the sweep; after it the panel is open above and its bottom edge is the sweep.
 *
 * @returns `[bottom, top]`.
 */
export function panelEdges(frame: Frame): [number, number] {
  if (frame.progress <= 1) return [-OPEN, frame.progress + frame.position];
  return [frame.progress - 1 + frame.position, OPEN];
}

/** Whether the panel, its shadow or its fibres show any of themselves in the frame. */
export function panelShows(frame: Frame): boolean {
  const [bottom, top] = panelEdges(frame);
  const reach = frame.tear * TEAR_REACH + EDGE_REACH;
  return frame.progress > 0 && frame.progress < 2 && top > -reach && bottom < 1 + reach;
}

/** Whether a frame needs the pass at all: no panel, no darkening, no blur and no grain draw straight to the host. */
export function idle(frame: Frame): boolean {
  return !panelShows(frame) && frame.darken === 0 && frame.blur === 0 && frame.grain === 0;
}

/** The blur's tap step in pixels of the half-size target, for a frame `height` pixels tall (half of it is blurred). */
export function blurStep(blur: number, height: number): number {
  return blur * 0.05 * Math.max(1, Math.ceil(height / 2));
}

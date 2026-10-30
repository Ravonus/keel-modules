/**
 * One setting for how good a scene looks. A level says what to spend; where the
 * camera is says what is worth spending it on, so a view from the shore traces
 * the sand's shadows and a dive spends the same rays on light shafts. MIT.
 *
 *   const quality = createQuality({ level: "auto", tier: device.tier });
 *   quality.at({ under, depth, height, clearance })  -> what to draw this frame
 *   quality.frame(milliseconds)                      -> tell it how the last one went
 *
 * Pure: nothing here reads a clock or a GPU, so the caller hands it frame times
 * and any run can be replayed from them.
 */

export type Level = "low" | "medium" | "high" | "ultra";
export type Tier = "low" | "mid" | "high";

/** What a renderer may spend on one frame. */
export interface Settings {
  readonly level: Level;
  /** Pixels drawn, as a share of the screen's width and height. */
  readonly renderScale: number;
  /** Rebuild the full image from past frames. */
  readonly upscale: boolean;
  /** Steps a reflected ray takes through the ground; 0 reflects only the sky. */
  readonly reflectSteps: number;
  /** Steps a ray toward the sun takes; 0 casts no traced shadows. */
  readonly shadowSteps: number;
  /** How far a reflected ray runs, metres. */
  readonly traceFar: number;
  /** How far from the eye water is traced at all, metres. */
  readonly traceNear: number;
  /** How many simple shapes stand in for animals in the rays. */
  readonly casters: number;
  /** Steps through the water for light shafts. */
  readonly shafts: number;
  /** Shells of marine snow. */
  readonly snow: number;
}

const LEVELS: Readonly<Record<Level, Settings>> = {
  low: { level: "low", renderScale: 0.7, upscale: false, reflectSteps: 0, shadowSteps: 0, traceFar: 0, traceNear: 0, casters: 0, shafts: 4, snow: 2 },
  medium: { level: "medium", renderScale: 0.75, upscale: true, reflectSteps: 14, shadowSteps: 10, traceFar: 70, traceNear: 60, casters: 8, shafts: 8, snow: 4 },
  high: { level: "high", renderScale: 0.8, upscale: true, reflectSteps: 28, shadowSteps: 20, traceFar: 140, traceNear: 140, casters: 16, shafts: 16, snow: 6 },
  ultra: { level: "ultra", renderScale: 1, upscale: true, reflectSteps: 48, shadowSteps: 32, traceFar: 260, traceNear: 260, casters: 32, shafts: 24, snow: 6 },
};

const TIER_LEVELS: Readonly<Record<Tier, Level>> = { low: "low", mid: "medium", high: "high" };

/** Where the camera is. */
export interface Place {
  readonly under: boolean;
  /** Metres under the water; 0 above it. */
  readonly depth: number;
  /** Metres above the water; 0 under it. */
  readonly height: number;
  /** Metres from the camera down to the ground, or to the sea floor. */
  readonly clearance: number;
}

const PLAIN = 40;

/**
 * Spends a level by where the camera is.
 *
 * @param settings What the level allows.
 * @param place Where the camera is.
 * @returns What is worth drawing there.
 */
export function settingsAt(settings: Settings, place: Place): Settings {
  const open = place.clearance > PLAIN;
  if (place.under) {
    // No sand within sight of the deep; down here light is in the water, not on the ground.
    return { ...settings, shadowSteps: open ? 0 : settings.shadowSteps, snow: settings.snow };
  }
  const high = clampShare(place.height / 120);
  return {
    ...settings,
    shafts: 0,
    snow: 0,
    reflectSteps: Math.round(settings.reflectSteps * (1 - high * 0.6)),
    casters: open ? 0 : settings.casters,
  };
}

const clampShare = (value: number): number => Math.min(1, Math.max(0, value));

export interface QualityInput {
  /** A level, or "auto" to take it from the device. */
  readonly level?: Level | "auto";
  /** `device-profile`'s tier, for "auto". */
  readonly tier?: Tier;
  /** The frame time to hold, milliseconds. 1000 / 60 by default. */
  readonly target?: number;
  /** The lowest render scale the governor may reach. */
  readonly floor?: number;
  /** Ray traced reflections and shadows, on by default where the level has them. */
  readonly tracing?: boolean;
  /** Rebuilding the image from past frames, on by default where the level has it. */
  readonly upscale?: boolean;
}

/** What can be switched while running. */
export interface Switches {
  readonly tracing?: boolean;
  readonly upscale?: boolean;
  readonly level?: Level;
}

export interface Quality {
  /** The level in use. */
  readonly level: Level;
  /** What to draw from this place, at the governed render scale. */
  at(place: Place): Settings;
  /** Reports how long the last frame took. */
  frame(milliseconds: number): void;
  /** The render scale the governor has settled on. */
  readonly scale: number;
  /** Whether rays are on. */
  readonly tracing: boolean;
  /** Whether upscaling is on. */
  readonly upscale: boolean;
  /** Turns tracing or upscaling on or off, or changes level, at once. */
  set(switches: Switches): void;
}

/** Everything a ray would cost, gone. */
const withoutRays = (settings: Settings): Settings => ({ ...settings, reflectSteps: 0, shadowSteps: 0, traceFar: 0, traceNear: 0, casters: 0 });

/** Frames between two changes of scale, so one slow frame moves nothing. */
const SETTLE_FRAMES = 30;
const SCALE_STEP = 0.05;
/** Frame times are smoothed by this share of each new one. */
const SMOOTH_TIME = 0.1;

/**
 * Picks a level, and keeps it to the frame rate by lowering the render scale.
 * With upscaling on, scale is the cheapest thing to give up.
 *
 * @param input The level, the device's tier, and the frame time to hold.
 * @returns A quality to ask each frame.
 */
export function createQuality(input: QualityInput = {}): Quality {
  const wanted = input.level ?? "auto";
  let level = wanted === "auto" ? TIER_LEVELS[input.tier ?? "mid"] : wanted;
  let settings = LEVELS[level];
  let tracing = input.tracing ?? true;
  let upscale = input.upscale ?? true;
  const target = input.target ?? 1000 / 60;
  const floorOf = (): number => Math.min(input.floor ?? 0.5, settings.renderScale);
  let scale = settings.renderScale;
  let smoothed = target;
  let wait = SETTLE_FRAMES;
  return {
    get level() { return level; },
    get scale() { return scale; },
    get tracing() { return tracing; },
    get upscale() { return upscale; },
    set(switches) {
      tracing = switches.tracing ?? tracing;
      upscale = switches.upscale ?? upscale;
      if (switches.level === undefined || switches.level === level) return;
      level = switches.level;
      settings = LEVELS[level];
      scale = settings.renderScale;
      wait = SETTLE_FRAMES;
    },
    at(place) {
      const here = settingsAt(settings, place);
      return { ...(tracing ? here : withoutRays(here)), upscale: upscale && settings.upscale, renderScale: upscale && settings.upscale ? scale : Math.max(scale, 1 - (1 - scale) / 2) };
    },
    frame(milliseconds) {
      smoothed += (milliseconds - smoothed) * SMOOTH_TIME;
      wait -= 1;
      if (wait > 0) return;
      const over = smoothed > target * 1.15;
      const under = smoothed < target * 0.8;
      if (!over && !under) return;
      scale = Math.max(floorOf(), Math.min(settings.renderScale, scale + (over ? -SCALE_STEP : SCALE_STEP)));
      wait = SETTLE_FRAMES;
    },
  };
}

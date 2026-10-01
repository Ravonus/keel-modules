/** Animated glow rings for backgrounds, styled by injected settings. MIT. */

/** The look of a glow field. Every member has a safe default. */
export interface GlowSettings {
  /** Main light, #rrggbb. */
  readonly color: string;
  /** Fill behind the rings, #rrggbb. */
  readonly background: string;
  /** Ring count, 1 to 24. */
  readonly rings: number;
  /** Animation speed multiplier, 0 to 3. */
  readonly speed: number;
  readonly mood: "calm" | "lively";
  readonly pulse: boolean;
  /** Colors mixed into alternating rings, #rrggbb. */
  readonly accents: readonly string[];
  /** YYYY-MM-DD; before this day only a dim glow shows. */
  readonly revealOn: string | null;
}

export const DEFAULT_GLOW_SETTINGS: GlowSettings = {
  color: "#7c83ff",
  background: "#0c0d10",
  rings: 8,
  speed: 1,
  mood: "calm",
  pulse: true,
  accents: [],
  revealOn: null,
};

const HEX = /^#[0-9a-f]{6}$/iu;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Normalizes untrusted settings into a complete GlowSettings. Pass the values a
 * host chose for this module, usually `KEEL_INPUTS["glow-field"]`; anything
 * missing or malformed falls back to its default.
 *
 * @param input Plain settings object, or undefined for all defaults.
 */
export function glowSettings(input?: unknown): GlowSettings {
  if (input === null || typeof input !== "object") return DEFAULT_GLOW_SETTINGS;
  const value = input as Readonly<Record<string, unknown>>;
  const accents = Array.isArray(value.accents) ? value.accents.filter((entry): entry is string => typeof entry === "string" && HEX.test(entry)).slice(0, 4) : [];
  return {
    color: hex(value.color, DEFAULT_GLOW_SETTINGS.color),
    background: hex(value.background, DEFAULT_GLOW_SETTINGS.background),
    rings: Math.round(bounded(value.rings, 1, 24, DEFAULT_GLOW_SETTINGS.rings)),
    speed: bounded(value.speed, 0, 3, DEFAULT_GLOW_SETTINGS.speed),
    mood: value.mood === "lively" ? "lively" : "calm",
    pulse: typeof value.pulse === "boolean" ? value.pulse : DEFAULT_GLOW_SETTINGS.pulse,
    accents,
    revealOn: typeof value.revealOn === "string" && DAY.test(value.revealOn) ? value.revealOn : null,
  };
}

/**
 * Whether the field is fully revealed on a given day.
 *
 * @param settings Normalized settings.
 * @param today Local day as YYYY-MM-DD, injected by the caller.
 */
export function glowRevealed(settings: GlowSettings, today: string): boolean {
  return settings.revealOn === null || today >= settings.revealOn;
}

/**
 * Draws one frame. Pure with respect to its inputs: the same settings, size,
 * time and day always draw the same frame.
 *
 * @param context 2D context to draw into.
 * @param width Drawing width in pixels.
 * @param height Drawing height in pixels.
 * @param seconds Elapsed time in seconds.
 * @param settings Normalized settings from glowSettings().
 * @param today Local day as YYYY-MM-DD, for the reveal date.
 */
export function drawGlow(context: CanvasRenderingContext2D, width: number, height: number, seconds: number, settings: GlowSettings = DEFAULT_GLOW_SETTINGS, today = "9999-12-31"): void {
  const revealed = glowRevealed(settings, today);
  const t = seconds * settings.speed * (settings.mood === "lively" ? 1.8 : 0.7);
  const breath = settings.pulse ? 0.78 + 0.22 * Math.sin(t * 1.3) : 1;
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.hypot(width, height) / 2;
  context.fillStyle = settings.background;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(cx, cy, 0, cx, cy, reach * 0.9);
  glow.addColorStop(0, `${settings.color}${revealed ? "66" : "22"}`);
  glow.addColorStop(1, `${settings.color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  if (!revealed) return;
  context.lineWidth = Math.max(1, Math.min(width, height) / 260);
  for (let ring = 0; ring < settings.rings; ring += 1) {
    const phase = (ring / settings.rings + t * 0.08) % 1;
    const radius = phase * reach;
    const accent = settings.accents.length > 0 && ring % 2 === 1 ? settings.accents[(ring >> 1) % settings.accents.length] : undefined;
    const alpha = Math.round(255 * breath * (1 - phase) * 0.85).toString(16).padStart(2, "0");
    context.strokeStyle = `${accent ?? settings.color}${alpha}`;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
  }
}

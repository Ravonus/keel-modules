/**
 * device-profile: what kind of device this is, and how much to draw on it.
 *
 * The signals are read once (`readSignals`) and judged by a pure function
 * (`profileOf`), so any device can be replayed from a record of its signals.
 */

export type DeviceClass = "phone" | "tablet" | "desktop";
export type DeviceTier = "low" | "mid" | "high";

/** What a browser and its GPU say of themselves; any may be missing. */
export interface DeviceSignals {
  readonly userAgent: string;
  /** `navigator.userAgentData.mobile`, where a browser has it. */
  readonly mobile?: boolean;
  readonly touchPoints: number;
  /** The screen's short side, in CSS pixels. */
  readonly shortSide: number;
  readonly pixelRatio: number;
  /** Device memory, in GiB, and logical cores. */
  readonly memory?: number;
  readonly cores?: number;
  /** `MAX_FRAGMENT_UNIFORM_VECTORS`, 0 with no WebGL2. */
  readonly uniforms: number;
  /** The unmasked GPU name, where a browser gives it. */
  readonly gpu?: string;
}

export interface DeviceProfile {
  readonly class: DeviceClass;
  readonly tier: DeviceTier;
  readonly uniforms: number;
  /** The most parts a body should have here: what is worth the pixels, before what the GPU can hold. */
  readonly parts: number;
  /** The pixel ratio to draw at. */
  readonly pixelRatio: number;
}

export interface ProfileOptions { readonly force?: DeviceClass }

/** A short side under this is a phone's. */
const PHONE_SIDE = 600;
const PARTS: Readonly<Record<DeviceTier, number>> = { low: 48, mid: 48, high: 64 };
const RATIO: Readonly<Record<DeviceTier, number>> = { low: 1, mid: 1.5, high: 2 };

const handheld = (s: DeviceSignals): boolean => s.shortSide < PHONE_SIDE;

/** A phone, a tablet or a desktop. (An iPad's Safari calls itself a Mac: only its touch points give it away.) */
export function classOf(s: DeviceSignals): DeviceClass {
  if (/iPhone|iPod|Android.*Mobile/u.test(s.userAgent)) return "phone";
  if (/iPad|Android|Tablet/u.test(s.userAgent) || (s.userAgent.includes("Macintosh") && s.touchPoints > 1)) return "tablet";
  if (s.mobile === true) return handheld(s) ? "phone" : "tablet";
  return "desktop";
}

/** How much it can draw: a software GPU or little memory is low whatever it is, a handheld mid at most, the rest high. */
export function tierOf(s: DeviceSignals, cls: DeviceClass): DeviceTier {
  const software = /SwiftShader|llvmpipe|Software/iu.test(s.gpu ?? "");
  if (software || (s.memory ?? 8) <= 2 || (s.cores ?? 8) <= 2) return "low";
  return cls === "desktop" ? "high" : "mid";
}

/** A device's profile, from its signals. */
export function profileOf(s: DeviceSignals, options: ProfileOptions = {}): DeviceProfile {
  const cls = options.force ?? classOf(s);
  const tier = tierOf(s, cls);
  return { class: cls, tier, uniforms: s.uniforms, parts: PARTS[tier], pixelRatio: Math.min(s.pixelRatio, RATIO[tier]) };
}

interface NavigatorHints { readonly userAgentData?: { readonly mobile?: boolean }; readonly deviceMemory?: number }

/** Asks the GPU through a throwaway context, which it lets go of at once. */
function gpuOf(): { uniforms: number; gpu?: string } {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return { uniforms: 0 };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const uniforms = Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS));
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return gpu === undefined ? { uniforms } : { uniforms, gpu };
}

/** This browser's signals. */
export function readSignals(): DeviceSignals {
  const hints = navigator as Navigator & NavigatorHints;
  const mobile = hints.userAgentData?.mobile;
  const memory = hints.deviceMemory;
  return {
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
    shortSide: Math.min(screen.width, screen.height),
    pixelRatio: window.devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    ...(mobile === undefined ? {} : { mobile }),
    ...(memory === undefined ? {} : { memory }),
    ...gpuOf(),
  };
}

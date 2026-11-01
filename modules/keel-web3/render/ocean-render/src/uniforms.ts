// The uniforms the passes share, and what writes them each frame: light, settings, casters and the wet line.

import { unit } from "./math.js";
import type {
  Caster, LitLike, OceanLight, OceanSettings, Uniform, Uniforms, Vec, Vector3Like, Vector4Like,
} from "./inputs.js";

/** The most spheres a ray can meet. */
export const MAX_CASTERS = 32;

export const DEFAULT_ZENITH: Vec = [0.16, 0.34, 0.68];
export const DEFAULT_HORIZON: Vec = [0.74, 0.84, 0.93];

export function waveUniform(lit: LitLike, packed: Float32Array): Vector4Like[] {
  const at = (index: number): number => packed[index] ?? 0;
  const vectors: Vector4Like[] = [];
  for (let index = 0; index + 7 < packed.length; index += 8) {
    vectors.push(
      new lit.Vector4(at(index), at(index + 1), at(index + 2), at(index + 3)),
      new lit.Vector4(at(index + 4), at(index + 5), at(index + 6), 0),
    );
  }
  return vectors;
}

export function setVec(uniform: Uniform | undefined, value: Vec): void {
  (uniform?.value as Vector3Like | undefined)?.set(value[0], value[1], value[2]);
}

export function lightUniforms(lit: LitLike, absorption: Vec, scatter: Vec): Uniforms {
  const vector = (v: Vec): Uniform => ({ value: new lit.Vector3(v[0], v[1], v[2]) });
  return {
    uAbsorb: vector(absorption),
    uScatter: vector(scatter),
    uSunDir: vector([0, 1, 0]),
    uSunCol: vector([3, 3, 3]),
    uZenith: vector(DEFAULT_ZENITH),
    uHorizon: vector(DEFAULT_HORIZON),
    uLevel: { value: 0 },
    uUnder: { value: 0 },
    uTime: { value: 0 },
    uShore: { value: 0 },
    uWet: { value: 0 },
    uRunUp: { value: 0 },
    uSprayShare: { value: 0 },
    uReflectSteps: { value: 0 },
    uShadowSteps: { value: 0 },
    uCasterCount: { value: 0 },
    uTraceFar: { value: 0 },
    uTraceNear: { value: 0 },
    uShafts: { value: 0 },
    uSnow: { value: 0 },
    uCaster: { value: Array.from({ length: MAX_CASTERS }, () => new lit.Vector4()) },
    uCasterTint: { value: Array.from({ length: MAX_CASTERS }, () => new lit.Vector3()) },
  };
}

/**
 * Where wet sand stops, a moment later: pushed up at once by the water, and
 * falling slowly by itself once the water leaves.
 *
 * @param top The line before, height in metres.
 * @param runUp How high the water reaches now.
 * @param seconds Since the line before; going back in time starts it over.
 * @param dryTime Seconds the line takes to fall a metre.
 * @returns The line now.
 */
export function wetLineAfter(top: number, runUp: number, seconds: number, dryTime: number): number {
  return seconds < 0 ? runUp : Math.max(runUp, top - seconds / dryTime);
}

/** Keeps the wet line from frame to frame: the one thing here with a memory. */
export function wetLineOf(shared: Uniforms, wind: number, dryTime: number): (level: number, t: number) => void {
  let top = -Infinity;
  let last = 0;
  return (level, t) => {
    const runUp = level + 0.07 * wind + 0.2;
    top = wetLineAfter(top, runUp, t - last, dryTime);
    last = t;
    if (shared.uRunUp) shared.uRunUp.value = runUp;
    if (shared.uWet) shared.uWet.value = top;
  };
}

/** The moment a frame is lit at: the tide, whether the eye is under it, and the time. */
export interface Moment {
  readonly level: number;
  readonly under: boolean;
  readonly t: number;
}

export function writeLight(shared: Uniforms, light: OceanLight, moment: Moment): void {
  const { level, under, t } = moment;
  setVec(shared.uSunDir, unit(light.sun));
  setVec(shared.uSunCol, light.sunColor);
  setVec(shared.uZenith, light.zenith ?? DEFAULT_ZENITH);
  setVec(shared.uHorizon, light.horizon ?? DEFAULT_HORIZON);
  if (shared.uLevel) shared.uLevel.value = level;
  if (shared.uShore) shared.uShore.value = level;
  if (shared.uUnder) shared.uUnder.value = under ? 1 : 0;
  if (shared.uTime) shared.uTime.value = t;
}

export function writeSettings(shared: Uniforms, settings: OceanSettings, casters: readonly Caster[]): void {
  const set = (name: string, value: number): void => {
    const uniform = shared[name];
    if (uniform) uniform.value = value;
  };
  const count = Math.min(casters.length, settings.casters, MAX_CASTERS);
  set("uReflectSteps", settings.reflectSteps);
  set("uShadowSteps", settings.shadowSteps);
  set("uTraceFar", settings.traceFar);
  set("uTraceNear", settings.traceNear);
  set("uShafts", settings.shafts);
  set("uSnow", settings.snow);
  set("uSprayShare", settings.spray ?? 0);
  set("uCasterCount", count);
  const spheres = shared.uCaster?.value as Vector4Like[];
  const tints = shared.uCasterTint?.value as Vector3Like[];
  for (let index = 0; index < count; index += 1) {
    const caster = casters[index];
    if (caster) {
      spheres[index]?.set(caster.at[0], caster.at[1], caster.at[2], caster.r);
      tints[index]?.set(caster.tint[0], caster.tint[1], caster.tint[2]);
    }
  }
}

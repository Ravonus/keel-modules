// Light: the sun in screen space, and the cel shader that carries a material's look over.

import type { Shading } from "./settings.js";
import { celRamp } from "./screens.js";
import type { LitLike, MaterialLike, TextureLike } from "./lit.js";

// ---------------------------------------------------------------- rays

/**
 * God rays as a scene describes them: toward which light (a world direction), its colour, and how the shafts fall off.
 */
export interface RaySpec {
  readonly direction: readonly [number, number, number];
  readonly color: string;
  /** 0 to about 1.5. */
  readonly strength: number;
  /** Falloff per step along a shaft, 0.85 to 0.995. */
  readonly decay?: number | undefined;
  /** How much of the way to the light a shaft samples, 0.2 to 1. */
  readonly density?: number | undefined;
}

/** Where a light direction lands on screen: uv (0..1, may fall outside) and how squarely the camera faces it (0..1). */
export interface ScreenLight {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

/**
 * Projects a world direction (a light at infinity) through a camera's view
 * and projection matrices (column-major, as keel/lit keeps them).
 */
export function screenLight(
  view: ArrayLike<number>,
  projection: ArrayLike<number>,
  direction: readonly [number, number, number],
): ScreenLight {
  const at = (m: ArrayLike<number>, index: number): number => m[index] ?? 0;
  const [dx, dy, dz] = direction;
  const vx = at(view, 0) * dx + at(view, 4) * dy + at(view, 8) * dz;
  const vy = at(view, 1) * dx + at(view, 5) * dy + at(view, 9) * dz;
  const vz = at(view, 2) * dx + at(view, 6) * dy + at(view, 10) * dz;
  const cx = at(projection, 0) * vx + at(projection, 4) * vy + at(projection, 8) * vz;
  const cy = at(projection, 1) * vx + at(projection, 5) * vy + at(projection, 9) * vz;
  const cw = at(projection, 3) * vx + at(projection, 7) * vy + at(projection, 11) * vz;
  const length = Math.hypot(vx, vy, vz) || 1;
  const facing = Math.max(0, -vz / length);
  if (cw <= 1e-4) return { x: 0.5, y: 0.5, facing: 0 };
  return {
    x: Math.max(-2, Math.min(3, (cx / cw) * 0.5 + 0.5)),
    y: Math.max(-2, Math.min(3, (cy / cw) * 0.5 + 0.5)),
    facing,
  };
}


// ---------------------------------------------------------------- cel shading

/** Copies the members a lit material and its toon twin share. */
function carryOver(from: MaterialLike, to: MaterialLike): void {
  if (from.color !== undefined && to.color !== undefined) to.color.copy(from.color);
  to.opacity = from.opacity;
  to.transparent = from.transparent;
  to.visible = from.visible;
}

const TOON_KEYS = ["map", "emissive", "emissiveIntensity", "transparent", "opacity", "depthWrite", "depthTest", "side", "alphaTest", "vertexColors", "flatShading", "name"] as const;

function toonParameters(source: MaterialLike, gradientMap: TextureLike): Record<string, unknown> {
  const bag = source as unknown as Readonly<Record<string, unknown>>;
  const parameters: Record<string, unknown> = { gradientMap };
  if (source.color !== undefined) parameters.color = source.color;
  for (const key of TOON_KEYS) if (bag[key] !== undefined && bag[key] !== null) parameters[key] = bag[key];
  return parameters;
}

interface CelShader {
  setBands(bands: number): void;
  swap(material: MaterialLike, mode: Shading): MaterialLike;
  dispose(): void;
}

export function createCelShader(lit: LitLike, bands: number): CelShader {
  const toons = new Map<MaterialLike, MaterialLike>();
  const ramp = (count: number): TextureLike => {
    const values = celRamp(count);
    const texture = new lit.DataTexture(values, values.length, 1, "red");
    texture.minFilter = "nearest";
    texture.magFilter = "nearest";
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };
  let gradient = ramp(bands);
  return {
    setBands(count) {
      gradient.dispose();
      gradient = ramp(count);
      for (const toon of toons.values()) {
        toon.gradientMap = gradient;
        toon.needsUpdate = true;
      }
    },
    swap(material, mode) {
      const source = material.userData.voxelDitherSource as MaterialLike | undefined;
      if (mode === "smooth") {
        if (source === undefined) return material;
        carryOver(material, source);
        return source;
      }
      if (source !== undefined || material.isLitMaterial !== true) return material;
      if (material.userData.voxelDitherKeep === true) return material;
      let toon = toons.get(material);
      if (toon === undefined) {
        toon = new lit.ToonMaterial(toonParameters(material, gradient));
        toon.userData.voxelDitherSource = material;
        toons.set(material, toon);
      }
      carryOver(material, toon);
      return toon;
    },
    dispose() {
      gradient.dispose();
      for (const toon of toons.values()) toon.dispose();
      toons.clear();
    },
  };
}

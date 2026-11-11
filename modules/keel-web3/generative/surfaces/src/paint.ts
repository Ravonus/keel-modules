// The result every painter returns, and the CPU painter.
import { FIELDS } from "./field.js";
import { KINDS, planSurface, type SurfacePlan, type SurfaceSettings } from "./plan.js";
import type { SurfaceRecipe } from "./recipe.js";

/**
 * A painted surface. `buffers` is `[albedo, relief]`, each `width × height × 4` bytes, rows from the top as
 * `ImageData` holds them: the albedo in sRGB with alpha 255; the relief's normal in RGB (+x right, +y toward the top
 * row, 128 flat) and its height in A. Post it to another thread with `postMessage(surface, surface.buffers)`.
 */
export interface Surface {
  readonly digest: string;
  readonly width: number;
  readonly height: number;
  readonly buffers: [ArrayBuffer, ArrayBuffer];
}

const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);

/** The relief from a height field that wraps at its edges, as the shaders take it from four neighbours. */
function relief(heights: Float32Array, plan: SurfacePlan): ArrayBuffer {
  const { width: w, height: h } = plan;
  const buffer = new ArrayBuffer(w * h * 4);
  const out = new Uint8Array(buffer);
  const k = 0.5 * plan.depth * h;
  const at = (x: number, y: number): number => heights[((y + h) % h) * w + ((x + w) % w)] ?? 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * k;
      const ny = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      out.set([byte(nx / l / 2 + 0.5), byte(ny / l / 2 + 0.5), byte(1 / l / 2 + 0.5), byte(at(x, y))], (y * w + x) * 4);
    }
  }
  return buffer;
}

/**
 * Paints a plan on the CPU: the shaders' arithmetic in JavaScript, the same bytes but for float rounding.
 *
 * @param plan From `planSurface`.
 * @returns The surface.
 */
export function paintPlan(plan: SurfacePlan): Surface {
  const field = FIELDS[KINDS[plan.kind]];
  if (!field) throw new RangeError(`surfaces: no painter for ${plan.kind}.`);
  const { width: w, height: h, uniforms } = plan;
  const buffer = new ArrayBuffer(w * h * 4);
  const albedo = new Uint8Array(buffer);
  const heights = new Float32Array(w * h);
  const c: [number, number, number] = [0, 0, 0];
  const u = (index: number): number => uniforms[index] ?? 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      heights[y * w + x] = field(u, (x + 0.5) / w, (y + 0.5) / h, c);
      albedo.set([byte(c[0]), byte(c[1]), byte(c[2]), 255], (y * w + x) * 4);
    }
  }
  return { digest: plan.digest, width: w, height: h, buffers: [buffer, relief(heights, plan)] };
}

/**
 * Paints a surface on the CPU: a recipe in, `{ digest, buffers }` out.
 *
 * @param recipe What the surface holds.
 * @param settings The seed and the size in pixels.
 * @returns The surface.
 */
export function paintSurface(recipe: SurfaceRecipe, settings?: SurfaceSettings): Surface {
  return paintPlan(planSurface(recipe, settings));
}

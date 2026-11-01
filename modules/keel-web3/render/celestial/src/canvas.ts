// An additive picture of the sphere, RA across and Dec up, the size of a small texture.
import { RAD, angleBetween, clamp, entry, wrap } from "./math.js";
import type { Rgb, Vec3 } from "./types.js";

/** A colour and how hard it is laid down. */
export interface Ink {
  light: Rgb;
  strength: number;
}

const norm = (p: Vec3): Vec3 => {
  const r = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / r, p[1] / r, p[2] / r];
};

export class Canvas {
  constructor(readonly pixels: Uint8Array, readonly width: number, readonly height: number) {}
  stamp(v: Vec3, radius: number, light: Rgb, strength: number): void {
    const u = wrap(Math.atan2(v[1], v[0]) / (2 * Math.PI), 1) * this.width;
    const row = (Math.asin(clamp(v[2], -1, 1)) / Math.PI + 0.5) * this.height;
    const stretch = 1 / Math.max(0.2, Math.cos((row / this.height - 0.5) * Math.PI));
    const across = Math.ceil(radius * stretch);
    const down = Math.ceil(radius);
    for (let dy = -down; dy <= down; dy += 1) {
      const y = Math.round(row) + dy;
      if (y < 0 || y >= this.height) continue;
      for (let dx = -across; dx <= across; dx += 1) {
        const x = wrap(Math.round(u) + dx, this.width);
        const fade = 1 - Math.hypot(dx / stretch, dy) / (radius + 0.5);
        if (fade <= 0) continue;
        const at = (y * this.width + x) * 4;
        for (const [c, l] of light.entries()) {
          this.pixels[at + c] = Math.min(255, entry(this.pixels, at + c) + l * strength * fade);
        }
      }
    }
  }
  /** Dots from a to b along the great circle, `gap` degrees apart. */
  dots(a: Vec3, b: Vec3, ink: Ink, gap: number): void {
    const span = Math.max(1, Math.ceil(angleBetween(a, b) / gap));
    for (let step = 0; step <= span; step += 1) {
      const s = step / span;
      const v: Vec3 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      const r = Math.hypot(v[0], v[1], v[2]);
      this.stamp([v[0] / r, v[1] / r, v[2] / r], 0.6, ink.light, ink.strength);
    }
  }
  ring(v: Vec3, radius: number, light: Rgb, strength: number): void {
    const side = Math.abs(v[2]) < 0.9 ? ([0, 0, 1] as Vec3) : ([1, 0, 0] as Vec3);
    const e = norm([v[1] * side[2] - v[2] * side[1], v[2] * side[0] - v[0] * side[2], v[0] * side[1] - v[1] * side[0]]);
    const f: Vec3 = [v[1] * e[2] - v[2] * e[1], v[2] * e[0] - v[0] * e[2], v[0] * e[1] - v[1] * e[0]];
    const size = radius * RAD;
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * 2 * Math.PI;
      const c = Math.cos(angle) * size;
      const s = Math.sin(angle) * size;
      this.stamp(
        norm([v[0] + e[0] * c + f[0] * s, v[1] + e[1] * c + f[1] * s, v[2] + e[2] * c + f[2] * s]),
        0.6,
        light,
        strength,
      );
    }
  }
}

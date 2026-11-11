// A layer's guides read once through the warp onto a grid over its canvas, so the planner's many lookups are array
// reads. Nearest pixels, exact arithmetic: the same plan on every engine.
import { redAt, type Guides } from "./guide.js";
import type { LayerFrame } from "./passes.js";
import { warpPoint, type Warp } from "./warp.js";

export interface LayerGuides {
  /** Grid cells across and down, and canvas pixels a cell. */
  readonly width: number;
  readonly height: number;
  readonly step: number;
  readonly id: Uint8Array;
  readonly light: Uint8Array;
  readonly line: Uint8Array | null;
}

/**
 * The guides under a layer's canvas, warped.
 *
 * @param step Canvas pixels a grid cell: 2 reads every other pixel each way.
 */
export function layerGuides(guides: Guides, warp: Warp, frame: LayerFrame, step: number): LayerGuides {
  const width = Math.ceil(frame.res[0] / step);
  const height = Math.ceil(frame.res[1] / step);
  const out: LayerGuides = {
    width, height, step, id: new Uint8Array(width * height), light: new Uint8Array(width * height),
    line: guides.line ? new Uint8Array(width * height) : null,
  };
  const k = step / frame.scale;
  for (let j = 0; j < height; j += 1) {
    const y = frame.box[1] + (j + 0.5) * k;
    for (let i = 0; i < width; i += 1) {
      const [sx, sy] = warpPoint(warp, frame.box[0] + (i + 0.5) * k, y);
      const at = j * width + i;
      out.id[at] = redAt(guides.id, sx, sy);
      out.light[at] = redAt(guides.light, sx, sy);
      if (out.line && guides.line) out.line[at] = redAt(guides.line, sx, sy);
    }
  }
  return out;
}

/** A field's byte under the canvas point (x, y), clamped to the canvas. */
export function fieldAt(lg: LayerGuides, field: Uint8Array, x: number, y: number): number {
  const i = Math.min(Math.max(Math.floor(x / lg.step), 0), lg.width - 1);
  const j = Math.min(Math.max(Math.floor(y / lg.step), 0), lg.height - 1);
  return field[j * lg.width + i] ?? 0;
}

/**
 * The light bytes at the 2nd and 98th percentile of the selected cells: the layer's black and white.
 *
 * @param flags The ids to count, a flag an index.
 */
export function levelsOf(lg: LayerGuides, flags: Uint8Array): [number, number] {
  const counts = new Float64Array(256);
  let n = 0;
  for (let at = 0; at < lg.id.length; at += 1) {
    if (flags[lg.id[at] ?? 0] !== 1) continue;
    const v = lg.light[at] ?? 0;
    counts[v] = (counts[v] ?? 0) + 1;
    n += 1;
  }
  const find = (share: number): number => {
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += counts[v] ?? 0;
      if (seen >= share * n) return v;
    }
    return 255;
  };
  return n === 0 ? [0, 255] : [find(0.02), Math.max(find(0.98), find(0.02) + 1)];
}

/**
 * brush: a GPU brush engine. MIT.
 *
 * A planner hands it strokes (a path of up to eight points, a tip, a size, a colour, a medium and how wet and loaded
 * the brush is); `packStrokes` turns them into 32 floats each, in exact arithmetic with a digest; the vertex shader
 * lays the dabs. Tips: round, flat, filbert, rake, with seeded bristles and a noise grain. Media: oil (opaque by
 * coverage, picks up wet paint, leaves relief), glaze (multiplies in linear light) and scumble (light broken over the
 * grain and the relief).
 */
export { MAX_DABS, MAX_POINTS, MEDIUM, SPACING, STROKE_FLOATS, TIP, TIP_LENGTH, dabsOf, packStrokes, pathLength } from "./stroke.js";
export type { Medium, Point, Rgb, Stroke, StrokeBatch, Tip } from "./stroke.js";
export { GRAIN_SIZE, WEAVE_PITCH, noiseTile, weaveTile } from "./grain.js";
export { digestOf, hash32, unit } from "./exact.js";
export { compile, createBrush, mediumRuns, subBatches } from "./gpu.js";
export type { Brush, BrushCanvas, FinishLook, FlatFill, GlazeFill } from "./gpu.js";

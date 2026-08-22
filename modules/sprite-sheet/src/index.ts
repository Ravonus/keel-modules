/** Equal-cell and JSON-atlas sprite sheet helpers using ImageBitmap source rectangles. MIT. */

/** A source rectangle in sheet pixels. */
export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A named atlas frame with its source rectangle. */
export interface AtlasFrame extends SpriteRect {
  readonly name: string;
}

/** Grid shape for {@link equalCells}. */
export interface GridOptions {
  /** Number of columns; a positive integer that divides the image width. */
  readonly columns: number;
  /** Number of rows; a positive integer that divides the image height. Defaults to 1. */
  readonly rows?: number;
}

/** The injected 2D drawing surface; canvas and offscreen contexts both satisfy it. */
export interface DrawTarget {
  imageSmoothingEnabled: boolean;
  drawImage(
    image: CanvasImageSource,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
}

/**
 * Splits an image of equal cells into row-major source rectangles.
 *
 * @param imageWidth Sheet width in pixels; must divide evenly by columns.
 * @param imageHeight Sheet height in pixels; must divide evenly by rows.
 * @param options Grid columns and rows.
 * @returns One rectangle per cell, left to right then top to bottom.
 * @throws RangeError when the geometry is not positive integers or does not divide evenly.
 */
export function equalCells(imageWidth: number, imageHeight: number, { columns, rows = 1 }: GridOptions): SpriteRect[] {
  if (![imageWidth, imageHeight, columns, rows].every(Number.isSafeInteger) || columns < 1 || rows < 1) {
    throw new RangeError("Sprite geometry must use positive integers.");
  }
  if (imageWidth % columns !== 0 || imageHeight % rows !== 0) {
    throw new RangeError("Sprite sheet dimensions must divide evenly into the requested grid.");
  }
  const width = imageWidth / columns;
  const height = imageHeight / rows;
  return Array.from({ length: columns * rows }, (_, index) => ({
    x: (index % columns) * width,
    y: Math.floor(index / columns) * height,
    width,
    height,
  }));
}

function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Reads named frames from a JSON atlas with a frames object map.
 *
 * Each entry may be the rectangle itself or nest it under a frame key, and
 * may use w/h or width/height names. Array-style frames lists are rejected.
 *
 * @param atlas Parsed atlas JSON.
 * @returns One named frame per entry with non-negative integer geometry.
 * @throws TypeError when the atlas shape or any frame is invalid.
 */
export function atlasFrames(atlas: unknown): AtlasFrame[] {
  if (atlas === null || typeof atlas !== "object" || Array.isArray(property(atlas, "frames"))) {
    throw new TypeError("Expected a named JSON atlas frame map.");
  }
  const coordinate = (name: string, value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid atlas frame ${name}.`);
    return value;
  };
  return Object.entries((property(atlas, "frames") ?? {}) as Record<string, unknown>).map(([name, value]) => {
    const frame = property(value, "frame") ?? value;
    return {
      name,
      x: coordinate(name, property(frame, "x")),
      y: coordinate(name, property(frame, "y")),
      width: coordinate(name, property(frame, "w") ?? property(frame, "width")),
      height: coordinate(name, property(frame, "h") ?? property(frame, "height")),
    };
  });
}

/**
 * Draws one frame with image smoothing disabled for crisp pixels.
 *
 * @param context The injected 2D context to draw into.
 * @param image The sheet image, for example an ImageBitmap.
 * @param frame Source rectangle in sheet pixels.
 * @param destination Destination rectangle in context pixels.
 */
export function drawFrame(context: DrawTarget, image: CanvasImageSource, frame: SpriteRect, destination: SpriteRect): void {
  context.imageSmoothingEnabled = false;
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height, destination.x, destination.y, destination.width, destination.height);
}

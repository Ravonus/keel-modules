// Prints: a host draws its own card face, label or screen into a 2D canvas and gets a lit texture. And a surface's
// buffers as lit textures. keel/lit is passed in; nothing here reaches for a global.
import type { Surface } from "./paint.js";

/** A 2D context, on the page or off it. */
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** A canvas the host makes at the size asked. */
export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** The fields of a keel/lit texture these helpers set. */
export interface TextureLike {
  colorSpace: string;
  wrapS: string;
  wrapT: string;
  anisotropy: number;
  needsUpdate: boolean;
}
export interface DataTextureLike extends TextureLike {
  magFilter: string;
  minFilter: string;
  generateMipmaps: boolean;
  flipY: boolean;
}

/** The parts of keel/lit these helpers call. Pass the keel/lit namespace itself. */
export interface PrintLit<T extends TextureLike, D extends DataTextureLike> {
  readonly CanvasTexture: new (canvas: CanvasLike) => T;
  readonly DataTexture: new (data: Uint8Array, width: number, height: number) => D;
}

/** How a print is used: colour (sRGB) or data (roughness, metalness, a mask: no colour space). */
export interface PrintOptions {
  readonly data?: boolean;
  /** Repeat across the surface instead of clamping at the edges. */
  readonly repeat?: boolean;
}

/** Draws a print: the context, and the canvas's width and height in pixels. */
export type DrawPrint = (ctx: Context2D, width: number, height: number) => void;

/** `print(size, draw)`: a texture of what `draw` puts into a fresh canvas of that size. */
export type Print<T> = (size: number | readonly [number, number], draw: DrawPrint, options?: PrintOptions) => T;

function setUp(texture: TextureLike, options: PrintOptions): void {
  texture.colorSpace = options.data === true ? "" : "srgb";
  texture.wrapS = options.repeat === true ? "repeat" : "clamp";
  texture.wrapT = texture.wrapS;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
}

/**
 * Makes `print(size, draw)`. Draw again later into `texture.image` and set `texture.needsUpdate` to refresh it.
 *
 * @param lit The keel/lit namespace.
 * @param canvasOf Makes a canvas of a size, e.g. `(w, h) => new OffscreenCanvas(w, h)`.
 * @returns The print function.
 */
export function createPrinter<T extends TextureLike, D extends DataTextureLike>(
  lit: PrintLit<T, D>, canvasOf: (width: number, height: number) => CanvasLike,
): Print<T> {
  return (size, draw, options = {}) => {
    const [w, h] = typeof size === "number" ? [size, size] : size;
    const canvas = canvasOf(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("surfaces: no 2D context for a print.");
    draw(ctx, w, h);
    const texture = new lit.CanvasTexture(canvas);
    setUp(texture, options);
    return texture;
  };
}

/** The colour that paints roughness and metalness into a data print: G roughness, B metalness, as lit reads them. */
export function pbr(roughness: number, metalness: number): string {
  const v = (x: number): number => Math.round(Math.min(Math.max(x, 0), 1) * 255);
  return `rgb(255 ${v(roughness)} ${v(metalness)})`;
}

/**
 * A surface as two repeating, mipmapped lit textures: `map` (sRGB) and `normalMap` (its height in alpha).
 *
 * @param lit The keel/lit namespace.
 * @param surface From a painter.
 * @returns The textures; the image's top row is at the top of UV space.
 */
export function surfaceTextures<T extends TextureLike, D extends DataTextureLike>(
  lit: PrintLit<T, D>, surface: Surface,
): { map: D; normalMap: D } {
  const [map, normalMap] = surface.buffers.map((buffer, i) => {
    const texture = new lit.DataTexture(new Uint8Array(buffer), surface.width, surface.height);
    setUp(texture, { data: i === 1, repeat: true });
    texture.magFilter = "linear";
    texture.minFilter = "linear-mipmap-linear";
    texture.generateMipmaps = true;
    texture.flipY = true;
    return texture;
  }) as [D, D];
  return { map, normalMap };
}

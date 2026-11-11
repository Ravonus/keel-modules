// A basis for the plate: values fitted to a target for the recipe's fields, and glazes, low-resolution signed colour
// laid over named regions in linear light. Read from a `keel-basis@1` file (the KMX2 container: "KMX2", a big-endian
// u32 header length, the header JSON, then each layer's bytes), or built by hand.
import type { PlateRecipe } from "./recipe.js";

/** The regions the plate's passes tell apart, in the order of their codes (0, 16, 32, 48, 64, 80). */
export const PLATE_REGIONS = ["sky", "ranges", "shore", "water", "ground", "leaves"] as const;
export type PlateRegion = (typeof PLATE_REGIONS)[number];

/** The code the near leaves write where they cover (the scene's own codes are 0..64). */
export const LEAF_CODE = 80;

/** The most glazes a plate takes. */
export const MAX_GLAZES = 4;

/**
 * Signed colour over some regions: `width` x `height` cells of RGB, 128 for none, a byte b meaning (b - 128) / 127 x
 * `gain` in linear light, read bilinearly between cell centres and added at the end.
 */
export interface PlateGlaze {
  readonly regions: readonly PlateRegion[];
  readonly width: number;
  readonly height: number;
  readonly gain: number;
  readonly values: Uint8Array;
}

/** What a basis brings to a plate. `params` are recipe fields by path, such as `sky.top` or `ranges.1.lit`. */
export interface PlateBasis {
  readonly params?: Readonly<Record<string, number | string>>;
  readonly glazes?: readonly PlateGlaze[];
}

/** Throws on a glaze the painter cannot draw. */
export function checkGlaze(glaze: PlateGlaze): void {
  const { width, height, gain, values, regions } = glaze;
  const fail = (why: string): never => {
    throw new RangeError(`plate-painter: a glaze ${why}`);
  };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 65536) {
    fail("is 1..65536 cells.");
  }
  if (values.length !== width * height * 3) fail("holds width x height x 3 bytes.");
  if (!(gain > 0 && gain <= 1)) fail("gain is within 0..1.");
  if (regions.length === 0 || regions.some((r) => !PLATE_REGIONS.includes(r))) {
    fail(`names regions of ${PLATE_REGIONS.join(", ")}.`);
  }
}

interface HeaderLayer {
  readonly name: string;
  readonly kind: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
  readonly bits?: number;
  readonly gain?: number;
  readonly count?: number;
  readonly colors?: string;
}

interface Header {
  readonly basis?: string;
  readonly params?: { readonly values?: Readonly<Record<string, number | string>> };
  readonly meta?: { readonly regions?: Readonly<Record<string, readonly PlateRegion[]>> };
  readonly layers?: readonly HeaderLayer[];
}

/** Bytes a palette layer's indices take: none without a size, two to a byte at 16 colours or fewer. */
function paletteSize(layer: HeaderLayer, cells: number): number {
  if (cells === 0) return 0;
  return (layer.colors ?? "").length / 6 <= 16 ? Math.ceil(cells / 2) : cells;
}

/** Bytes a layer's body takes in the file. */
function bodySize(layer: HeaderLayer): number {
  const cells = (layer.width ?? 0) * (layer.height ?? 0);
  if (layer.kind === "u16") return (layer.count ?? 0) * 2;
  if (layer.kind === "palette") return paletteSize(layer, cells);
  const samples = cells * (layer.channels ?? 1);
  return layer.bits === 4 ? Math.ceil(samples / 2) : samples;
}

/** The header of a basis file, and where its first layer starts. */
function headerOf(bytes: Uint8Array): { readonly header: Header; readonly start: number } {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.length < 8 || magic !== "KMX2") throw new TypeError("plate-painter: not a basis (KMX2) file.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (8 + length > bytes.length) throw new RangeError("plate-painter: the basis header runs past its bytes.");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as Header;
  if (header.basis !== "keel-basis@1" || !Array.isArray(header.layers)) {
    throw new TypeError("plate-painter: the file is not a keel-basis@1 basis.");
  }
  return { header, start: 8 + length };
}

/** A glaze from a 3-channel signed layer that the header places on regions, else undefined. */
function glazeOf(
  layer: HeaderLayer, regions: readonly PlateRegion[] | undefined, body: Uint8Array,
): PlateGlaze | undefined {
  if (layer.kind !== "signed" || layer.channels !== 3 || regions === undefined) return undefined;
  const glaze = { regions, width: layer.width ?? 0, height: layer.height ?? 0, gain: layer.gain ?? 0, values: body };
  checkGlaze(glaze);
  return glaze;
}

/**
 * The plate's part of a `keel-basis@1` file: its fitted values, and a glaze for every 3-channel signed layer that
 * `meta.regions` places (layers it does not place are skipped).
 *
 * @throws TypeError or RangeError on bytes that are not a whole basis.
 */
export function readPlateBasis(bytes: Uint8Array): PlateBasis {
  const { header, start } = headerOf(bytes);
  const layers: readonly HeaderLayer[] = header.layers ?? [];
  const glazes: PlateGlaze[] = [];
  let at = start;
  for (const layer of layers) {
    const size = bodySize(layer);
    if (at + size > bytes.length) throw new RangeError(`plate-painter: the basis layer ${layer.name} runs past its bytes.`);
    const glaze = glazeOf(layer, header.meta?.regions?.[layer.name], bytes.slice(at, at + size));
    if (glaze !== undefined) glazes.push(glaze);
    at += size;
  }
  if (at !== bytes.length) throw new RangeError("plate-painter: the basis has bytes past its last layer.");
  const params = header.params?.values;
  return { ...(params === undefined ? {} : { params }), glazes };
}

/** The value at one key of an object or array, or undefined. */
const child = (node: unknown, key: string): unknown =>
  typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined;

/** A copy of a recipe with each `path` (dots between keys and indices) set to its value; a path must exist already. */
export function withParams(recipe: PlateRecipe, params: Readonly<Record<string, number | string>>): PlateRecipe {
  const copy = JSON.parse(JSON.stringify(recipe)) as unknown;
  for (const [path, value] of Object.entries(params)) {
    const keys = path.split(".");
    const last = keys.pop() ?? "";
    const parent = keys.reduce(child, copy);
    if (typeof parent !== "object" || parent === null || typeof child(parent, last) !== typeof value) {
      throw new RangeError(`plate-painter: no recipe field ${path} of that type.`);
    }
    (parent as Record<string, unknown>)[last] = value;
  }
  return copy as PlateRecipe;
}

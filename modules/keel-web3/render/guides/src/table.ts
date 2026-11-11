// The guide set's names: which passes there are, how a mesh gets its ID, the ID table, and reading the passes back
// on the CPU. All integer arithmetic, so a table and its colours are the same bytes on every engine.

/** The passes, in the order a guide set holds them. */
export const PASSES = ["depth", "normal", "id", "light", "line", "block"] as const;
export type GuidePass = (typeof PASSES)[number];

/** IDs run from 1; 0 is nothing drawn. One byte's worth. */
export const MAX_IDS = 255;

export type Rgb = readonly [number, number, number];

/** One named part: its ID, the colour the `id` pass paints it, and the flat colour the `block` pass paints it. */
export interface GuideId {
  readonly id: number;
  readonly name: string;
  readonly colour: Rgb;
  readonly block: Rgb;
}

/** What a tagger may read of a mesh. */
export interface TagMesh {
  readonly name?: string;
  readonly userData?: Readonly<Record<string, unknown>>;
}
/** What a tagger may read of one of its materials. */
export interface TagMaterial {
  readonly name?: string;
  readonly userData?: Readonly<Record<string, unknown>>;
  readonly defines?: Readonly<Record<string, unknown>>;
}
/**
 * Names the part a mesh draws with one of its materials (`slot` is the material's index, 0 for a single material),
 * or nothing, and that slot is left out of every pass.
 */
export type Tagger = (mesh: TagMesh, material: TagMaterial, slot: number) => string | undefined;

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The default: the mesh's `userData.guide`, its material's, the mesh's name, then the material's. */
export const byName: Tagger = (mesh, material) =>
  text(mesh.userData?.guide) ?? text(material.userData?.guide) ?? text(mesh.name) ?? text(material.name);

/**
 * Names by material slot: the slot's index, or the value of the material's `define` (a shader `#define` such as
 * `PART`), looked up in `names`, an array or a `{ name: slot }` record.
 */
export function bySlot(names: readonly string[] | Readonly<Record<string, number>>, define?: string): Tagger {
  const isList = (n: typeof names): n is readonly string[] => Array.isArray(n);
  const list: (string | undefined)[] = isList(names) ? [...names] : [];
  if (!isList(names)) for (const [name, slot] of Object.entries(names)) list[slot] = name;
  return (_mesh, material, slot) => {
    const at = define === undefined ? slot : Number(material.defines?.[define]);
    return Number.isInteger(at) ? list[at] : undefined;
  };
}

/** Code-point order, the same on every engine (localeCompare is not). */
const order = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

/** A hue around the wheel by the golden ratio (40503 / 65536), at one of three values: neighbours never look alike. */
function hueColour(id: number): Rgb {
  const h = (id * 40503) & 0xffff;
  const v = [240, 200, 160][id % 3] ?? 240;
  const p = (v * 64) >> 8;
  const sector = (h * 6) >> 16;
  const f = (h * 6) & 0xffff;
  const up = p + (((v - p) * f) >> 16);
  const down = v - (((v - p) * f) >> 16);
  const rows: readonly Rgb[] = [[v, up, p], [down, v, p], [p, v, up], [p, down, v], [up, p, v], [v, p, down]];
  return rows[sector] ?? [v, p, p];
}

const key = (c: Rgb): number => (c[0] << 16) | (c[1] << 8) | c[2];

/** Each ID's colour in the `id` pass: distinct for every ID up to `MAX_IDS`, never black. */
export function idColours(count: number): readonly Rgb[] {
  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (let id = 1; id <= count; id += 1) {
    let c = hueColour(id);
    // (A clash moves the blue byte down until it is free; with the three values there are none below 256 IDs.)
    while (seen.has(key(c))) c = [c[0], c[1], (c[2] + 255) % 256];
    seen.add(key(c));
    out.push(c);
  }
  return out;
}

const HEX = /^#?([0-9a-f]{6})$/iu;

/** `#rrggbb` as bytes. */
export function hexBytes(hex: string): Rgb {
  const m = HEX.exec(hex);
  if (!m?.[1]) throw new Error(`guides: "${hex}" is not a #rrggbb colour`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Whether `name` matches `pattern`: exact, or `*` for any run of characters (`skin.*`, `*.left`). */
export function matches(pattern: string, name: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === name;
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (!name.startsWith(first) || !name.endsWith(last) || name.length < first.length + last.length) return false;
  let at = first.length;
  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, at);
    if (found < 0 || found + middle.length > name.length - last.length) return false;
    at = found + middle.length;
  }
  return true;
}

/**
 * The ID table for these names: unique, in code-point order, IDs from 1. `blocks` gives the `block` pass's colour
 * by name or pattern (first match wins); a name with none takes `fallback[name]`, then mid grey.
 */
export function idTable(
  names: Iterable<string>,
  blocks: Readonly<Record<string, string>> = {},
  fallback: Readonly<Record<string, Rgb>> = {},
): readonly GuideId[] {
  const sorted = [...new Set(names)].sort(order);
  if (sorted.length > MAX_IDS) throw new Error(`guides: ${sorted.length} names, at most ${MAX_IDS}`);
  const colours = idColours(sorted.length);
  const patterns = Object.entries(blocks);
  return sorted.map((name, i) => {
    const hex = patterns.find(([pattern]) => matches(pattern, name))?.[1];
    const block = hex === undefined ? fallback[name] ?? [128, 128, 128] : hexBytes(hex);
    return { id: i + 1, name, colour: colours[i] ?? [0, 0, 0], block };
  });
}

/** The IDs whose names match any of the patterns. */
export function idsOf(table: readonly GuideId[], patterns: readonly string[]): readonly number[] {
  return table.filter((entry) => patterns.some((p) => matches(p, entry.name))).map((entry) => entry.id);
}

/** A read-back pass: RGBA8, `width` across, top row first. */
export interface GuideImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** The ID under each pixel of an `id` pass (0 where nothing is), from its colours and the table. */
export function idsIn(image: GuideImage, table: readonly GuideId[]): Uint8Array {
  const byColour = new Map(table.map((entry) => [key(entry.colour), entry.id]));
  const out = new Uint8Array(image.width * image.height);
  const d = image.data;
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    if (d[o + 3]) out[i] = byColour.get(((d[o] ?? 0) << 16) | ((d[o + 1] ?? 0) << 8) | (d[o + 2] ?? 0)) ?? 0;
  }
  return out;
}

/** A mask (255 inside, 0 outside) of the parts whose names match any of the patterns. */
export function idMask(image: GuideImage, table: readonly GuideId[], patterns: readonly string[]): Uint8Array {
  const wanted = new Set(idsOf(table, patterns));
  const ids = idsIn(image, table);
  return ids.map((id) => (wanted.has(id) ? 255 : 0));
}

/** The view depth at pixel `i` of a `depth` pass between `near` and `far` (red and green: a 16-bit share). */
export function depthIn(image: GuideImage, i: number, range: { readonly near: number; readonly far: number }): number {
  const d = image.data;
  if (!d[i * 4 + 3]) return Infinity;
  const share = (((d[i * 4] ?? 0) << 8) | (d[i * 4 + 1] ?? 0)) / 65535;
  return range.far - share * (range.far - range.near);
}

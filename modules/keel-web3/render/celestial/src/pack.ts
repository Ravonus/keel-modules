// Reading the data pack: a magic, a version and tagged sections of varints, into the numbers the sky is computed from.
import { fromRaDec } from "./math.js";
import type { BodyId, SkyPack, Star, Term } from "./types.js";

const TAGS = { elements: 1, giants: 2, moon: 3, terms: 4, stars: 5, zodiac: 6, showers: 7 } as const;
export type PlanetId = Exclude<BodyId, "sun" | "moon">;
export type ElementId = PlanetId | "earth";
export const ELEMENT_IDS: readonly ElementId[] = [
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];
export const PLANET_IDS: readonly PlanetId[] = ELEMENT_IDS.filter((id): id is PlanetId => id !== "earth");
const GIANT_IDS: readonly ElementId[] = ["jupiter", "saturn", "uranus", "neptune"];
/** Scales of the integers in a pack. */
const ELEMENT_SCALE = 1e8;

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.at >= this.bytes.length;
  }
  byte(): number {
    const value = this.bytes[this.at];
    if (value === undefined) throw new Error("celestial: the pack ends early");
    this.at += 1;
    return value;
  }
  /** An unsigned LEB128; floats so a value may pass 2^31. */
  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.byte();
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  }
  /** Zigzag, on the unsigned varint. */
  signed(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }
  section(length: number): Reader {
    const part = new Reader(this.bytes.subarray(this.at, this.at + length));
    this.at += length;
    return part;
  }
}

/** A named row of a pack's table; a pack without it cannot place anything. */
export function rowOf(table: Record<string, number[]>, id: string): readonly number[] {
  const row = table[id];
  if (!row) throw new Error(`celestial: the pack has no row for ${id}`);
  return row;
}

function readRows(r: Reader, table: Record<string, number[]>, ids: readonly string[], length: number): void {
  for (const id of ids) table[id] = Array.from({ length }, () => r.signed() / ELEMENT_SCALE);
}

function readTerms(r: Reader): Term[][] {
  const bodies: Term[][] = [];
  while (!r.done) {
    const terms: Term[] = [];
    for (let left = r.varint(); left > 0; left -= 1) {
      const head = r.byte();
      const multiples: [number, number][] = [];
      for (let count = head >> 5; count > 0; count -= 1) multiples.push([r.byte(), r.signed()]);
      terms.push({ channel: head & 3, power: (head >> 2) & 7, multiples, sin: r.signed(), cos: r.signed() });
    }
    bodies.push(terms);
  }
  return bodies;
}

/** Stars come in rising magnitude classes, each a count, then 21 bits of RA and Dec. */
function readStars(r: Reader): Star[] {
  const stars: Star[] = [];
  for (let magnitude = -1; !r.done; magnitude += 1) {
    for (let left = r.varint(); left > 0; left -= 1) {
      const n = (r.byte() << 16) | (r.byte() << 8) | r.byte();
      stars.push({ direction: fromRaDec((n >> 10) / 2047 * 360, (n & 1023) / 1023 * 180 - 90), magnitude });
    }
  }
  return stars;
}

/** Figures in sign order: a varint count of lines, each a count then star indices. */
function readZodiac(r: Reader): number[][][] {
  const figures: number[][][] = [];
  while (!r.done) {
    const lines: number[][] = [];
    for (let left = r.varint(); left > 0; left -= 1) {
      const line: number[] = [];
      for (let count = r.varint(); count > 0; count -= 1) line.push(r.varint());
      lines.push(line);
    }
    figures.push(lines);
  }
  return figures;
}

/** One tagged section into the pack; a tag this code does not know is left alone. */
function readSection(pack: SkyPack, tag: number, part: Reader): void {
  if (tag === TAGS.elements) readRows(part, pack.elements, ELEMENT_IDS, 12);
  else if (tag === TAGS.giants) readRows(part, pack.giants, GIANT_IDS, 4);
  else if (tag === TAGS.moon) while (!part.done) pack.moon.push(part.signed() / 1e6);
  else if (tag === TAGS.terms) pack.terms = readTerms(part);
  else if (tag === TAGS.stars) pack.stars = readStars(part);
  else if (tag === TAGS.zodiac) pack.zodiac = readZodiac(part);
  else if (tag === TAGS.showers) while (!part.done) pack.showers.push(part.signed() / 100);
}

/** Reads a pack. Sections a version of this code does not know are skipped. */
export function readPack(bytes: Uint8Array): SkyPack {
  if (bytes[0] !== 0x4b || bytes[1] !== 0x53) throw new Error("celestial: not a sky pack");
  const r = new Reader(bytes.subarray(2));
  const pack: SkyPack = {
    version: r.byte(),
    elements: {},
    giants: {},
    moon: [],
    terms: [],
    stars: [],
    zodiac: [],
    showers: [],
  };
  while (!r.done) {
    const tag = r.byte();
    const part = r.section(r.varint());
    readSection(pack, tag, part);
  }
  return pack;
}

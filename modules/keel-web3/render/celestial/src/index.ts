/**
 * The real sky, small enough to live onchain: where the sun, moon and planets
 * stand for an instant, their retrogrades, eclipses and meteor showers, and
 * the birth chart of a moment. Nothing is stored per day; every position is
 * computed from orbital elements and fitted corrections held in a data pack,
 * so one pack covers two thousand years and the code never holds the numbers.
 *
 *   const { skyAt, chartAt } = openSky(packBytes);
 *   const now = skyAt(Date.now());
 *   now.bodies.mars.retrograde  -> true
 *   now.lunar                   -> 0..1, how deep the moon is in the earth's shadow
 *   now.shower                  -> { radiant, rate } while a meteor shower runs
 *   const natal = chartAt(bornAt, lat, lon);
 *   natal.aspects               -> [{ a: "sun", b: "moon", kind: "trine", orb }]
 *
 * The pack (`data/sky.pack`, built by `tools/build-pack.mjs`) is a magic, a
 * version and tagged sections; a reader skips tags it does not know, so new
 * data can ship in a new pack without new code. See the module README.
 *
 * Pure and deterministic. Directions are unit vectors in the J2000 equatorial
 * frame (+x equinox, +z north pole); `horizonMatrix` turns them into a scene's
 * +y up, -z north, +x east. MIT.
 */
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J2000_MS = 946_728_000_000;
const CENTURY_DAYS = 36_525;
const OBLIQUITY = 23.4392911 * RAD;
/** Degrees the equinox slides along the ecliptic each century. */
const PRECESSION = 1.396971;
const EARTH_RADII_KM = 6378.14;
const AU_KM = 149_597_870.7;
const SUN_RADIUS = 0.2666;
const SUN_RADIUS_KM = 696_000;
const MOON_RADIUS = 0.2725 * EARTH_RADII_KM;
const wrap = (value: number, period: number) => ((value % period) + period) % period;
const near = (value: number) => wrap(value + 180, 360) - 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type Vec3 = [number, number, number];
export type BodyId = "sun" | "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune" | "pluto";
export interface Body {
  id: BodyId;
  /** Tropical ecliptic longitude: 0 is the start of Aries, on the equinox of the day. */
  longitude: number;
  latitude: number;
  /** Degrees of longitude a day, as seen from the earth. */
  speed: number;
  retrograde: boolean;
  direction: Vec3;
  /** Distance from the earth, km. */
  distance: number;
}
export interface Shower {
  radiant: Vec3;
  /** Meteors an hour at this instant. */
  rate: number;
}
export interface Sky {
  timestamp: number;
  bodies: Record<BodyId, Body>;
  /** The moon's age as a fraction of its month: 0 new, 0.5 full. */
  phase: number;
  /** 0 outside an eclipse, up to 1 at totality, seen from the earth's centre. */
  lunar: number;
  /** The moon's disc over the sun, 0..1, seen from the earth's centre. */
  solar: number;
  shower: Shower | null;
}
export type AspectKind = "conjunction" | "sextile" | "square" | "trine" | "opposition";
export interface Aspect {
  a: BodyId;
  b: BodyId;
  kind: AspectKind;
  orb: number;
}
export interface Chart extends Sky {
  ascendant: number;
  midheaven: number;
  aspects: Aspect[];
}

const TAGS = { elements: 1, giants: 2, moon: 3, terms: 4, stars: 5, zodiac: 6, showers: 7 } as const;
const ELEMENT_IDS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const PLANET_IDS = ELEMENT_IDS.filter((id) => id !== "earth");
/** Scales of the integers in a pack. */
const ELEMENT_SCALE = 1e8;
const ANGLE_UNIT = 1e-4;
const DISTANCE_UNIT = 1e-6;
const MOON_KM = 1e-3;

/** One correction: `amount(tau^power * (sin * sin(angle) + cos * cos(angle)))`, its angle a sum of whole multiples of the arguments. */
export interface Term {
  channel: number;
  power: number;
  multiples: [number, number][];
  sin: number;
  cos: number;
}
export interface SkyPack {
  version: number;
  elements: Record<string, number[]>;
  giants: Record<string, number[]>;
  moon: number[];
  terms: Term[][];
  stars: Star[];
  zodiac: number[][][];
  showers: number[];
}
export interface Star {
  direction: Vec3;
  magnitude: number;
}

class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done() { return this.at >= this.bytes.length; }
  byte() { return this.bytes[this.at++]; }
  /** An unsigned LEB128; floats so a value may pass 2^31. */
  varint() {
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
  signed() {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }
  section(length: number) {
    const part = new Reader(this.bytes.subarray(this.at, this.at + length));
    this.at += length;
    return part;
  }
}

function readTerms(r: Reader) {
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
function readStars(r: Reader) {
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
function readZodiac(r: Reader) {
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

/** Reads a pack. Sections a version of this code does not know are skipped. */
export function readPack(bytes: Uint8Array): SkyPack {
  const r = new Reader(bytes);
  if (r.byte() !== 0x4b || r.byte() !== 0x53) throw new Error("celestial: not a sky pack");
  const pack: SkyPack = { version: r.byte(), elements: {}, giants: {}, moon: [], terms: [], stars: [], zodiac: [], showers: [] };
  while (!r.done) {
    const tag = r.byte();
    const part = r.section(r.varint());
    if (tag === TAGS.elements) for (const id of ELEMENT_IDS) pack.elements[id] = Array.from({ length: 12 }, () => part.signed() / ELEMENT_SCALE);
    else if (tag === TAGS.giants) for (const id of ["jupiter", "saturn", "uranus", "neptune"]) pack.giants[id] = Array.from({ length: 4 }, () => part.signed() / ELEMENT_SCALE);
    else if (tag === TAGS.moon) while (!part.done) pack.moon.push(part.signed() / 1e6);
    else if (tag === TAGS.terms) pack.terms = readTerms(part);
    else if (tag === TAGS.stars) pack.stars = readStars(part);
    else if (tag === TAGS.zodiac) pack.zodiac = readZodiac(part);
    else if (tag === TAGS.showers) while (!part.done) pack.showers.push(part.signed() / 100);
  }
  return pack;
}

const equatorial = (longitude: number, latitude: number): Vec3 => {
  const l = longitude * RAD;
  const b = latitude * RAD;
  const y = Math.cos(b) * Math.sin(l);
  const z = Math.sin(b);
  return [Math.cos(b) * Math.cos(l), y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY), y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)];
};
const fromRaDec = (ra: number, dec: number): Vec3 => [Math.cos(dec * RAD) * Math.cos(ra * RAD), Math.cos(dec * RAD) * Math.sin(ra * RAD), Math.sin(dec * RAD)];
export const angleBetween = (a: Vec3, b: Vec3) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / RAD;

/** Seconds TT runs ahead of UT: Espenak and Meeus's long-term fit, which is what moves an eclipse's hour centuries out. */
export function deltaT(timestamp: number) {
  const days = (timestamp - J2000_MS) / DAY_MS;
  const y = 2000 + (days - 14) / 365.24217;
  const t = y - 2000;
  if (y < 2005) return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))));
  if (y < 2050) return 62.92 + t * (0.32217 + t * 0.005589);
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u - (y < 2150 ? 0.5628 * (2150 - y) : 0);
}
export const centuries = (timestamp: number) => (timestamp + deltaT(timestamp) * 1000 - J2000_MS) / DAY_MS / CENTURY_DAYS;

/** A planet's plain Kepler orbit on the J2000 ecliptic: longitude, latitude (degrees) and distance (au). */
export function keplerPlace(row: readonly number[], giant: readonly number[] | undefined, t: number): Vec3 {
  const at = (index: number) => row[index] + row[index + 6] * t;
  const e = at(1);
  const peri = at(4);
  const node = at(5);
  let anomaly = at(3) - peri;
  if (giant) anomaly += giant[0] * t * t + giant[1] * Math.cos(giant[3] * t * RAD) + giant[2] * Math.sin(giant[3] * t * RAD);
  const mean = near(anomaly) * RAD;
  let eccentric = mean + e * Math.sin(mean);
  for (let step = 0; step < 6; step += 1) eccentric -= (eccentric - e * Math.sin(eccentric) - mean) / (1 - e * Math.cos(eccentric));
  const x = at(0) * (Math.cos(eccentric) - e);
  const y = at(0) * Math.sqrt(1 - e * e) * Math.sin(eccentric);
  const w = (peri - node) * RAD;
  const o = node * RAD;
  const i = at(2) * RAD;
  const px = x * Math.cos(w) - y * Math.sin(w);
  const py = x * Math.sin(w) + y * Math.cos(w);
  const v: Vec3 = [px * Math.cos(o) - py * Math.sin(o) * Math.cos(i), px * Math.sin(o) + py * Math.cos(o) * Math.cos(i), py * Math.sin(i)];
  const r = Math.hypot(v[0], v[1], v[2]);
  return [Math.atan2(v[1], v[0]) / RAD, Math.asin(v[2] / r) / RAD, r];
}

/** Adds a body's terms to a place: channels 0 and 1 are degrees of longitude and latitude, 2 is distance. */
export function applyTerms(place: Vec3, terms: readonly Term[], args: readonly number[], t: number, distanceUnit: number): Vec3 {
  const tau = t / 10;
  const out: Vec3 = [place[0], place[1], place[2]];
  for (const term of terms) {
    let angle = 0;
    for (const [arg, multiple] of term.multiples) angle += args[arg] * multiple;
    const size = tau ** term.power * (term.sin * Math.sin(angle * RAD) + term.cos * Math.cos(angle * RAD));
    out[term.channel] += size * (term.channel === 2 ? distanceUnit : ANGLE_UNIT);
  }
  return out;
}

/** Every argument a planet's corrections may use: the mean longitudes, in element order. */
export const planetArgs = (elements: Record<string, number[]>, t: number) => ELEMENT_IDS.map((id) => (elements[id][3] + elements[id][9] * t) % 360);
/** The moon's: its mean longitude, D, M, M' and F. */
export const moonArgs = (moon: readonly number[], t: number) => [0, 1, 2, 3, 4].map((index) => (moon[index * 2] + moon[index * 2 + 1] * t) % 360);

/** The moon's ecliptic place on the equinox of the day, from a pack's numbers alone. */
export const moonBase = (moon: readonly number[], t: number): Vec3 => [moon[0] + moon[1] * t, 0, 385000.56];

/** Turns a chart's worth of pack into the sky. */
export function openSky(bytes: Uint8Array) {
  const pack = readPack(bytes);
  const { elements, giants, moon: moonRow, terms, showers } = pack;
  const place = (id: string, t: number, args: number[]) => applyTerms(keplerPlace(elements[id], giants[id], t), terms[ELEMENT_IDS.indexOf(id)] ?? [], args, t, DISTANCE_UNIT);
  const xyz = (p: Vec3): Vec3 => [p[2] * Math.cos(p[1] * RAD) * Math.cos(p[0] * RAD), p[2] * Math.cos(p[1] * RAD) * Math.sin(p[0] * RAD), p[2] * Math.sin(p[1] * RAD)];
  const moonPlace = (t: number) => {
    const m = applyTerms(moonBase(moonRow, t), terms[ELEMENT_IDS.length] ?? [], moonArgs(moonRow, t), t, MOON_KM);
    return { longitude: wrap(m[0], 360), latitude: m[1], distance: m[2] };
  };

  /** Longitude, latitude (J2000 ecliptic) and distance of every body. */
  function geocentric(t: number) {
    const moon = moonPlace(t);
    const args = planetArgs(elements, t);
    // The elements follow the earth-moon barycentre; the earth sits 1/82.3 of the moon's distance the other way.
    const lever = moon.distance / AU_KM / 82.3;
    const pull = xyz([moon.longitude - PRECESSION * t, moon.latitude, lever]);
    const bary = xyz(place("earth", t, args));
    const earth: Vec3 = [bary[0] - pull[0], bary[1] - pull[1], bary[2] - pull[2]];
    const places: Record<string, { longitude: number; latitude: number; distance: number }> = {};
    for (const id of PLANET_IDS) {
      // Light time: where the planet was when the light left it.
      const seen = (at: number) => {
        const p = xyz(place(id, at, planetArgs(elements, at)));
        return [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
      };
      const first = seen(t);
      const v = seen(t - Math.hypot(first[0], first[1], first[2]) * 0.0057755 / CENTURY_DAYS);
      const distance = Math.hypot(v[0], v[1], v[2]);
      places[id] = { longitude: Math.atan2(v[1], v[0]) / RAD, latitude: Math.asin(v[2] / distance) / RAD, distance: distance * AU_KM };
    }
    const sunDistance = Math.hypot(earth[0], earth[1], earth[2]);
    // -20.5" of aberration keeps the sun where it is seen, which is what lines up an eclipse.
    places.sun = { longitude: Math.atan2(-earth[1], -earth[0]) / RAD - 0.0057, latitude: Math.asin(-earth[2] / sunDistance) / RAD, distance: sunDistance * AU_KM };
    places.moon = { longitude: moon.longitude - PRECESSION * t, latitude: moon.latitude, distance: moon.distance };
    return places;
  }

  /** Which shower runs at a solar longitude, if any, and how hard. */
  function showerAt(solarLongitude: number): Shower | null {
    let best: Shower | null = null;
    for (let index = 0; index < showers.length; index += 5) {
      const off = near(solarLongitude - showers[index]) / showers[index + 4];
      const rate = showers[index + 3] * Math.exp(-0.5 * off * off);
      if (rate >= 1 && (!best || rate > best.rate)) best = { radiant: fromRaDec(showers[index + 1], showers[index + 2]), rate };
    }
    return best;
  }

  /** The whole sky for an instant, as seen from the earth's centre. */
  function skyAt(timestamp: number): Sky {
    const t = centuries(timestamp);
    const now = geocentric(t);
    const before = geocentric(t - 0.5 / CENTURY_DAYS);
    const after = geocentric(t + 0.5 / CENTURY_DAYS);
    const shift = PRECESSION * t;
    const bodies = {} as Record<BodyId, Body>;
    for (const id of BODY_IDS) {
      const p = now[id];
      const speed = near(after[id].longitude - before[id].longitude);
      bodies[id] = { id, longitude: wrap(p.longitude + shift, 360), latitude: p.latitude, speed, retrograde: speed < 0 && id !== "sun" && id !== "moon", direction: equatorial(p.longitude, p.latitude), distance: p.distance };
    }
    const { sun, moon } = bodies;
    const apart = angleBetween(moon.direction, sun.direction);
    const moonRadius = Math.asin(MOON_RADIUS / moon.distance) / RAD;
    // The earth's shadow at the moon, with the 2% the air adds to it (Danjon's rule).
    const umbra = 1.01 * (Math.asin(EARTH_RADII_KM / moon.distance) + Math.asin(EARTH_RADII_KM / sun.distance) - Math.asin(SUN_RADIUS_KM / sun.distance)) / RAD;
    const shadow = angleBetween(moon.direction, [-sun.direction[0], -sun.direction[1], -sun.direction[2]]);
    return {
      timestamp,
      bodies,
      phase: wrap(moon.longitude - sun.longitude, 360) / 360,
      lunar: clamp((umbra + moonRadius - shadow) / (2 * moonRadius), 0, 1),
      solar: clamp((SUN_RADIUS + moonRadius - apart) / (2 * SUN_RADIUS), 0, 1),
      shower: showerAt(sun.longitude),
    };
  }

  /** The chart of a moment and place: every body, the ascendant and midheaven, and the aspects between bodies. */
  function chartAt(timestamp: number, lat: number, lon: number): Chart {
    const sky = skyAt(timestamp);
    const ramc = siderealDegrees(timestamp, lon) * RAD;
    const e = OBLIQUITY;
    const midheaven = wrap(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(e)) / RAD, 360);
    const ascendant = wrap(Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(e) + Math.tan(clamp(lat, -66, 66) * RAD) * Math.sin(e))) / RAD, 360);
    const aspects: Aspect[] = [];
    for (let i = 0; i < BODY_IDS.length; i += 1) {
      for (let j = i + 1; j < BODY_IDS.length; j += 1) {
        const gap = Math.abs(near(sky.bodies[BODY_IDS[i]].longitude - sky.bodies[BODY_IDS[j]].longitude));
        for (const [kind, angle, allowed] of ASPECTS) if (Math.abs(gap - angle) <= allowed) aspects.push({ a: BODY_IDS[i], b: BODY_IDS[j], kind, orb: Math.abs(gap - angle) });
      }
    }
    return { ...sky, ascendant, midheaven, aspects };
  }

  return { skyAt, chartAt, stars: pack.stars, zodiac: pack.zodiac, version: pack.version };
}

const BODY_IDS: BodyId[] = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
const ASPECTS: readonly [AspectKind, number, number][] = [["conjunction", 0, 8], ["sextile", 60, 4], ["square", 90, 6], ["trine", 120, 6], ["opposition", 180, 8]];
const siderealDegrees = (timestamp: number, lon: number) => wrap(280.46061837 + 360.98564736629 * ((timestamp - J2000_MS) / DAY_MS) + lon, 360);

/** The matrix that turns a J2000 equatorial direction into scene space at a place: +y up, -z north, +x east. Rows first. */
export function horizonMatrix(timestamp: number, lat: number, lon: number): number[] {
  const sidereal = siderealDegrees(timestamp, lon) * RAD;
  const slide = PRECESSION * centuries(timestamp) * RAD;
  const place = (v: Vec3): Vec3 => {
    // To the equator of the day: round the ecliptic pole by the precession.
    const y = v[1] * Math.cos(OBLIQUITY) + v[2] * Math.sin(OBLIQUITY);
    const z = -v[1] * Math.sin(OBLIQUITY) + v[2] * Math.cos(OBLIQUITY);
    const ex = v[0] * Math.cos(slide) - y * Math.sin(slide);
    const ey = v[0] * Math.sin(slide) + y * Math.cos(slide);
    const qy = ey * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY);
    const qz = ey * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
    const meridian = ex * Math.cos(sidereal) + qy * Math.sin(sidereal);
    const east = -ex * Math.sin(sidereal) + qy * Math.cos(sidereal);
    const phi = lat * RAD;
    return [east, qz * Math.sin(phi) + meridian * Math.cos(phi), -(qz * Math.cos(phi) - meridian * Math.sin(phi))];
  };
  const a = place([1, 0, 0]);
  const b = place([0, 1, 0]);
  const c = place([0, 0, 1]);
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

export const toScene = (matrix: readonly number[], v: Vec3): Vec3 => [matrix[0] * v[0] + matrix[1] * v[1] + matrix[2] * v[2], matrix[3] * v[0] + matrix[4] * v[1] + matrix[5] * v[2], matrix[6] * v[0] + matrix[7] * v[1] + matrix[8] * v[2]];

/** The moon seen from a place, not the earth's centre: up to a degree off, and what decides who sees an eclipse. */
export function moonFrom(matrix: readonly number[], moon: Body): Vec3 {
  const v = toScene(matrix, moon.direction);
  const r = moon.distance / EARTH_RADII_KM;
  const x = v[0] * r;
  const y = v[1] * r - 1;
  const z = v[2] * r;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** An ecliptic point (tropical, on the equinox of `timestamp`) as a J2000 direction. */
export const eclipticPoint = (longitude: number, latitude: number, timestamp: number): Vec3 => equatorial(longitude - PRECESSION * centuries(timestamp), latitude);


export type Rgb = readonly [number, number, number];
const STAR_LIGHT: Rgb = [205, 218, 255];
const FIGURE_LIGHT: Rgb = [150, 170, 230];
const HARD_LIGHT: Rgb = [255, 130, 150];
const SOFT_LIGHT: Rgb = [130, 190, 255];
const NATAL_LIGHT: Rgb = [255, 226, 170];
/** Each planet's colour, by eye from the sky, for marks and for a renderer's discs. */
export const BODY_LIGHT: Record<BodyId, Rgb> = {
  sun: [255, 214, 130], moon: [214, 222, 255], mercury: [188, 200, 214], venus: [255, 240, 208], mars: [255, 120, 86],
  jupiter: [255, 216, 168], saturn: [226, 198, 140], uranus: [150, 232, 232], neptune: [120, 150, 255], pluto: [190, 150, 170],
};

/** An additive picture of the sphere, RA across and Dec up, the size of a small texture. */
class Canvas {
  constructor(readonly pixels: Uint8Array, readonly width: number, readonly height: number) {}
  stamp(v: Vec3, radius: number, light: Rgb, strength: number) {
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
        for (let c = 0; c < 3; c += 1) this.pixels[at + c] = Math.min(255, this.pixels[at + c] + light[c] * strength * fade);
      }
    }
  }
  /** Dots from a to b along the great circle, `gap` degrees apart. */
  dots(a: Vec3, b: Vec3, light: Rgb, strength: number, gap: number) {
    const span = Math.max(1, Math.ceil(angleBetween(a, b) / gap));
    for (let step = 0; step <= span; step += 1) {
      const s = step / span;
      const v: Vec3 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      const r = Math.hypot(v[0], v[1], v[2]);
      this.stamp([v[0] / r, v[1] / r, v[2] / r], 0.6, light, strength);
    }
  }
  ring(v: Vec3, radius: number, light: Rgb, strength: number) {
    const side = Math.abs(v[2]) < 0.9 ? ([0, 0, 1] as Vec3) : ([1, 0, 0] as Vec3);
    const norm = (p: Vec3): Vec3 => { const r = Math.hypot(p[0], p[1], p[2]); return [p[0] / r, p[1] / r, p[2] / r]; };
    const e = norm([v[1] * side[2] - v[2] * side[1], v[2] * side[0] - v[0] * side[2], v[0] * side[1] - v[1] * side[0]]);
    const f: Vec3 = [v[1] * e[2] - v[2] * e[1], v[2] * e[0] - v[0] * e[2], v[0] * e[1] - v[1] * e[0]];
    const size = radius * RAD;
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * 2 * Math.PI;
      const c = Math.cos(angle) * size;
      const s = Math.sin(angle) * size;
      this.stamp(norm([v[0] + e[0] * c + f[0] * s, v[1] + e[1] * c + f[1] * s, v[2] + e[2] * c + f[2] * s]), 0.6, light, strength);
    }
  }
}

/** One aspect as a dotted arc: on the ecliptic they would all lie on one line, so hard ones bow north and soft ones south. */
function arc(canvas: Canvas, a: Body, b: Body, aspect: { kind: AspectKind; orb: number }, when: number, level: number) {
  if (aspect.kind === "conjunction") return;
  const sweep = near(b.longitude - a.longitude);
  const hard = aspect.kind === "square" || aspect.kind === "opposition";
  const bow = Math.abs(sweep) * 0.22 * (hard ? 1 : -1);
  const steps = Math.ceil(Math.abs(sweep) / 0.7);
  for (let step = 0; step <= steps; step += 1) {
    const s = step / steps;
    canvas.stamp(eclipticPoint(a.longitude + sweep * s, a.latitude + (b.latitude - a.latitude) * s + bow * Math.sin(Math.PI * s), when), 0.6, hard ? HARD_LIGHT : SOFT_LIGHT, 0.15 * (1 - aspect.orb / 10) * level);
  }
}

/**
 * Paints what never moves against the stars into RGBA pixels: the real stars and zodiac, and the tree's own chart,
 * which reads as one more constellation, with the planets of its birth as its stars.
 */
export function paintChart(sky: { stars: readonly Star[]; zodiac: readonly (readonly (readonly number[])[])[] }, chart: Chart, width: number, height: number, level = 1) {
  const canvas = new Canvas(new Uint8Array(width * height * 4), width, height);
  for (let at = 3; at < canvas.pixels.length; at += 4) canvas.pixels[at] = 255;
  const when = chart.timestamp;
  for (const star of sky.stars) canvas.stamp(star.direction, star.magnitude < 1.5 ? 1.2 : 0.7, STAR_LIGHT, clamp((4.4 - star.magnitude) / 5, 0.12, 1) * level);
  const sign = Math.floor(chart.bodies.sun.longitude / 30);
  sky.zodiac.forEach((figure, index) => {
    for (const line of figure) for (let at = 1; at < line.length; at += 1) canvas.dots(sky.stars[line[at - 1]].direction, sky.stars[line[at]].direction, FIGURE_LIGHT, (index === sign ? 0.2 : 0.1) * level, 0.45);
  });
  for (let degree = 0; degree < 360; degree += 3) canvas.stamp(eclipticPoint(degree, 0, when), degree % 30 === 0 ? 0.9 : 0.5, FIGURE_LIGHT, (degree % 30 === 0 ? 0.26 : 0.07) * level);
  for (const aspect of chart.aspects) arc(canvas, chart.bodies[aspect.a], chart.bodies[aspect.b], aspect, when, level);
  for (const id of BODY_IDS) {
    const body = chart.bodies[id];
    canvas.stamp(body.direction, id === "sun" || id === "moon" ? 1.8 : 1.2, BODY_LIGHT[id], 0.7 * level);
    canvas.ring(body.direction, 1.1, BODY_LIGHT[id], 0.16 * level);
  }
  canvas.dots(eclipticPoint(chart.ascendant, -1.6, when), eclipticPoint(chart.ascendant, 1.6, when), NATAL_LIGHT, 0.32 * level, 0.3);
  canvas.dots(eclipticPoint(chart.midheaven, -1, when), eclipticPoint(chart.midheaven, 1, when), NATAL_LIGHT, 0.2 * level, 0.3);
  // Born under an eclipse or a shower: the sky remembers it.
  if (chart.solar > 0) canvas.ring(chart.bodies.sun.direction, 2.6, NATAL_LIGHT, 0.5 * level);
  if (chart.lunar > 0) canvas.ring(chart.bodies.moon.direction, 2.6, BODY_LIGHT.mars, 0.5 * level);
  if (chart.shower) for (let index = 0; index < 12; index += 1) canvas.ring(chart.shower.radiant, 1.2 + index * 0.7, NATAL_LIGHT, 0.04 * level);
  return canvas.pixels;
}

/**
 * Lays what changes day by day over a painted chart: a retrograde planet's real looping path, and a ring on any
 * birth place a planet is crossing now. `target` receives the chart with those on top; a `web` above 0 adds the
 * planets' live aspects at that strength.
 */
export function paintTransits(base: Uint8Array, target: Uint8Array, width: number, height: number, skyAt: (timestamp: number) => Sky, chart: Chart, now: Sky, level = 1, web = 0) {
  target.set(base);
  const canvas = new Canvas(target, width, height);
  for (const id of BODY_IDS) {
    const body = now.bodies[id];
    if (body.retrograde) for (let day = -36; day <= 36; day += 4) canvas.stamp(skyAt(now.timestamp + day * DAY_MS).bodies[id].direction, 0.6, BODY_LIGHT[id], 0.26 * level);
    if (id === "moon") continue;
    for (const birth of BODY_IDS) {
      const gap = Math.abs(near(body.longitude - chart.bodies[birth].longitude));
      if (gap < 1.5) canvas.ring(chart.bodies[birth].direction, 2, BODY_LIGHT[id], 0.3 * (1 - gap / 1.5) * level);
    }
  }
  if (web > 0) {
    // The planets' aspects to one another now: a web that forms and lets go as they move.
    const ids = BODY_IDS.filter((id) => id !== "moon");
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = now.bodies[ids[i]];
        const b = now.bodies[ids[j]];
        const gap = Math.abs(near(a.longitude - b.longitude));
        for (const [kind, angle, allowed] of ASPECTS) if (Math.abs(gap - angle) <= allowed) arc(canvas, a, b, { kind, orb: Math.abs(gap - angle) }, now.timestamp, web);
      }
    }
  }
  return target;
}

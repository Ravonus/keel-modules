// The ephemeris: Kepler orbits and fitted corrections from a pack into every body's place, the sky and the chart.
import {
  AU_KM,
  CENTURY_DAYS,
  DAY_MS,
  EARTH_RADII_KM,
  J2000_MS,
  MOON_RADIUS,
  OBLIQUITY,
  PRECESSION,
  RAD,
  SUN_RADIUS,
  SUN_RADIUS_KM,
  angleBetween,
  clamp,
  entry,
  equatorial,
  fromRaDec,
  near,
  siderealDegrees,
  wrap,
} from "./math.js";
import { ELEMENT_IDS, PLANET_IDS, readPack, rowOf } from "./pack.js";
import type { ElementId, PlanetId } from "./pack.js";
import type { Aspect, AspectKind, Body, BodyId, Chart, Shower, Sky, SkyPack, Star, Term, Vec3 } from "./types.js";

/** Scales of the integers in a pack. */
const ANGLE_UNIT = 1e-4;
const DISTANCE_UNIT = 1e-6;
const MOON_KM = 1e-3;

export const BODY_IDS: readonly BodyId[] = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];
const ASPECTS: readonly [AspectKind, number, number][] = [
  ["conjunction", 0, 8],
  ["sextile", 60, 4],
  ["square", 90, 6],
  ["trine", 120, 6],
  ["opposition", 180, 8],
];

/**
 * Seconds TT runs ahead of UT: Espenak and Meeus's long-term fit, which is what moves an eclipse's hour centuries out.
 */
export function deltaT(timestamp: number): number {
  const days = (timestamp - J2000_MS) / DAY_MS;
  const y = 2000 + (days - 14) / 365.24217;
  const t = y - 2000;
  if (y < 2005) return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))));
  if (y < 2050) return 62.92 + t * (0.32217 + t * 0.005589);
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u - (y < 2150 ? 0.5628 * (2150 - y) : 0);
}
export const centuries = (timestamp: number): number =>
  (timestamp + deltaT(timestamp) * 1000 - J2000_MS) / DAY_MS / CENTURY_DAYS;

/** A planet's plain Kepler orbit on the J2000 ecliptic: longitude, latitude (degrees) and distance (au). */
export function keplerPlace(row: readonly number[], giant: readonly number[] | undefined, t: number): Vec3 {
  const at = (index: number): number => entry(row, index) + entry(row, index + 6) * t;
  const e = at(1);
  const peri = at(4);
  const node = at(5);
  let anomaly = at(3) - peri;
  if (giant) {
    anomaly +=
      entry(giant, 0) * t * t +
      entry(giant, 1) * Math.cos(entry(giant, 3) * t * RAD) +
      entry(giant, 2) * Math.sin(entry(giant, 3) * t * RAD);
  }
  const mean = near(anomaly) * RAD;
  let eccentric = mean + e * Math.sin(mean);
  for (let step = 0; step < 6; step += 1) {
    eccentric -= (eccentric - e * Math.sin(eccentric) - mean) / (1 - e * Math.cos(eccentric));
  }
  const x = at(0) * (Math.cos(eccentric) - e);
  const y = at(0) * Math.sqrt(1 - e * e) * Math.sin(eccentric);
  const w = (peri - node) * RAD;
  const o = node * RAD;
  const i = at(2) * RAD;
  const px = x * Math.cos(w) - y * Math.sin(w);
  const py = x * Math.sin(w) + y * Math.cos(w);
  const v: Vec3 = [
    px * Math.cos(o) - py * Math.sin(o) * Math.cos(i),
    px * Math.sin(o) + py * Math.cos(o) * Math.cos(i),
    py * Math.sin(i),
  ];
  const r = Math.hypot(v[0], v[1], v[2]);
  return [Math.atan2(v[1], v[0]) / RAD, Math.asin(v[2] / r) / RAD, r];
}

/** Adds a body's terms to a place: channels 0 and 1 are degrees of longitude and latitude, 2 is distance. */
export function applyTerms(
  place: Vec3,
  terms: readonly Term[],
  args: readonly number[],
  t: number,
  distanceUnit: number,
): Vec3 {
  const tau = t / 10;
  const out: Vec3 = [place[0], place[1], place[2]];
  for (const term of terms) {
    let angle = 0;
    for (const [arg, multiple] of term.multiples) angle += entry(args, arg) * multiple;
    const size = tau ** term.power * (term.sin * Math.sin(angle * RAD) + term.cos * Math.cos(angle * RAD));
    out[term.channel] = entry(out, term.channel) + size * (term.channel === 2 ? distanceUnit : ANGLE_UNIT);
  }
  return out;
}

/** Every argument a planet's corrections may use: the mean longitudes, in element order. */
export const planetArgs = (elements: Record<string, number[]>, t: number): number[] =>
  ELEMENT_IDS.map((id) => {
    const row = rowOf(elements, id);
    return (entry(row, 3) + entry(row, 9) * t) % 360;
  });
/** The moon's: its mean longitude, D, M, M' and F. */
export const moonArgs = (moon: readonly number[], t: number): number[] =>
  [0, 1, 2, 3, 4].map((index) => (entry(moon, index * 2) + entry(moon, index * 2 + 1) * t) % 360);

/** The moon's ecliptic place on the equinox of the day, from a pack's numbers alone. */
export const moonBase = (moon: readonly number[], t: number): Vec3 => [
  entry(moon, 0) + entry(moon, 1) * t,
  0,
  385000.56,
];

interface Place {
  longitude: number;
  latitude: number;
  distance: number;
}

/** A body's Kepler place with its corrections laid on. */
function place(pack: SkyPack, id: ElementId, t: number, args: number[]): Vec3 {
  const row = rowOf(pack.elements, id);
  const terms = pack.terms[ELEMENT_IDS.indexOf(id)] ?? [];
  return applyTerms(keplerPlace(row, pack.giants[id], t), terms, args, t, DISTANCE_UNIT);
}
const xyz = (p: Vec3): Vec3 => [
  p[2] * Math.cos(p[1] * RAD) * Math.cos(p[0] * RAD),
  p[2] * Math.cos(p[1] * RAD) * Math.sin(p[0] * RAD),
  p[2] * Math.sin(p[1] * RAD),
];
function moonPlace(pack: SkyPack, t: number): Place {
  const moonRow = pack.moon;
  const terms = pack.terms[ELEMENT_IDS.length] ?? [];
  const m = applyTerms(moonBase(moonRow, t), terms, moonArgs(moonRow, t), t, MOON_KM);
  return { longitude: wrap(m[0], 360), latitude: m[1], distance: m[2] };
}

/** A planet from the earth, allowing for light time: where the planet was when the light left it. */
function seenFrom(pack: SkyPack, id: PlanetId, earth: Vec3, t: number): Place {
  const seen = (at: number): Vec3 => {
    const p = xyz(place(pack, id, at, planetArgs(pack.elements, at)));
    return [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  };
  const first = seen(t);
  const v = seen(t - Math.hypot(first[0], first[1], first[2]) * 0.0057755 / CENTURY_DAYS);
  const distance = Math.hypot(v[0], v[1], v[2]);
  return {
    longitude: Math.atan2(v[1], v[0]) / RAD,
    latitude: Math.asin(v[2] / distance) / RAD,
    distance: distance * AU_KM,
  };
}

/** Longitude, latitude (J2000 ecliptic) and distance of every body. */
function geocentric(pack: SkyPack, t: number): Record<BodyId, Place> {
  const moon = moonPlace(pack, t);
  const args = planetArgs(pack.elements, t);
  // The elements follow the earth-moon barycentre; the earth sits 1/82.3 of the moon's distance the other way.
  const lever = moon.distance / AU_KM / 82.3;
  const pull = xyz([moon.longitude - PRECESSION * t, moon.latitude, lever]);
  const bary = xyz(place(pack, "earth", t, args));
  const earth: Vec3 = [bary[0] - pull[0], bary[1] - pull[1], bary[2] - pull[2]];
  const places = {} as Record<BodyId, Place>;
  for (const id of PLANET_IDS) places[id] = seenFrom(pack, id, earth, t);
  const sunDistance = Math.hypot(earth[0], earth[1], earth[2]);
  // -20.5" of aberration keeps the sun where it is seen, which is what lines up an eclipse.
  places.sun = {
    longitude: Math.atan2(-earth[1], -earth[0]) / RAD - 0.0057,
    latitude: Math.asin(-earth[2] / sunDistance) / RAD,
    distance: sunDistance * AU_KM,
  };
  places.moon = { longitude: moon.longitude - PRECESSION * t, latitude: moon.latitude, distance: moon.distance };
  return places;
}

/** Which shower runs at a solar longitude, if any, and how hard. */
function showerAt(showers: readonly number[], solarLongitude: number): Shower | null {
  let best: Shower | null = null;
  for (let index = 0; index < showers.length; index += 5) {
    const off = near(solarLongitude - entry(showers, index)) / entry(showers, index + 4);
    const rate = entry(showers, index + 3) * Math.exp(-0.5 * off * off);
    if (rate >= 1 && (!best || rate > best.rate)) {
      best = { radiant: fromRaDec(entry(showers, index + 1), entry(showers, index + 2)), rate };
    }
  }
  return best;
}

/** The whole sky for an instant, as seen from the earth's centre. */
function skyAt(pack: SkyPack, timestamp: number): Sky {
  const t = centuries(timestamp);
  const now = geocentric(pack, t);
  const before = geocentric(pack, t - 0.5 / CENTURY_DAYS);
  const after = geocentric(pack, t + 0.5 / CENTURY_DAYS);
  const shift = PRECESSION * t;
  const bodies = {} as Record<BodyId, Body>;
  for (const id of BODY_IDS) {
    const p = now[id];
    const speed = near(after[id].longitude - before[id].longitude);
    bodies[id] = {
      id,
      longitude: wrap(p.longitude + shift, 360),
      latitude: p.latitude,
      speed,
      retrograde: speed < 0 && id !== "sun" && id !== "moon",
      direction: equatorial(p.longitude, p.latitude),
      distance: p.distance,
    };
  }
  const { sun, moon } = bodies;
  const apart = angleBetween(moon.direction, sun.direction);
  const moonRadius = Math.asin(MOON_RADIUS / moon.distance) / RAD;
  // The earth's shadow at the moon, with the 2% the air adds to it (Danjon's rule).
  const umbra =
    (1.01 *
      (Math.asin(EARTH_RADII_KM / moon.distance) +
        Math.asin(EARTH_RADII_KM / sun.distance) -
        Math.asin(SUN_RADIUS_KM / sun.distance))) /
    RAD;
  const shadow = angleBetween(moon.direction, [-sun.direction[0], -sun.direction[1], -sun.direction[2]]);
  return {
    timestamp,
    bodies,
    phase: wrap(moon.longitude - sun.longitude, 360) / 360,
    lunar: clamp((umbra + moonRadius - shadow) / (2 * moonRadius), 0, 1),
    solar: clamp((SUN_RADIUS + moonRadius - apart) / (2 * SUN_RADIUS), 0, 1),
    shower: showerAt(pack.showers, sun.longitude),
  };
}

/** Every aspect a gap in longitude makes, with its orb. */
export function aspectsAt(gap: number): { kind: AspectKind; orb: number }[] {
  const found: { kind: AspectKind; orb: number }[] = [];
  for (const [kind, angle, allowed] of ASPECTS) {
    if (Math.abs(gap - angle) <= allowed) found.push({ kind, orb: Math.abs(gap - angle) });
  }
  return found;
}

/** The aspects between every pair of bodies, in body order. */
function aspectsOf(bodies: Record<BodyId, Body>): Aspect[] {
  const aspects: Aspect[] = [];
  for (const [index, a] of BODY_IDS.entries()) {
    for (const b of BODY_IDS.slice(index + 1)) {
      const gap = Math.abs(near(bodies[a].longitude - bodies[b].longitude));
      for (const { kind, orb } of aspectsAt(gap)) aspects.push({ a, b, kind, orb });
    }
  }
  return aspects;
}

/** The chart of a moment and place: every body, the ascendant and midheaven, and the aspects between bodies. */
function chartAt(pack: SkyPack, timestamp: number, lat: number, lon: number): Chart {
  const sky = skyAt(pack, timestamp);
  const ramc = siderealDegrees(timestamp, lon) * RAD;
  const e = OBLIQUITY;
  const midheaven = wrap(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(e)) / RAD, 360);
  const ascendant = wrap(
    Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(e) + Math.tan(clamp(lat, -66, 66) * RAD) * Math.sin(e))) /
      RAD,
    360,
  );
  return { ...sky, ascendant, midheaven, aspects: aspectsOf(sky.bodies) };
}

/** What `openSky` hands back: the sky and chart of any instant, and the pack's fixed stars and figures. */
export interface SkyModel {
  skyAt: (timestamp: number) => Sky;
  chartAt: (timestamp: number, lat: number, lon: number) => Chart;
  stars: Star[];
  zodiac: number[][][];
  version: number;
}

/** Turns a chart's worth of pack into the sky. */
export function openSky(bytes: Uint8Array): SkyModel {
  const pack = readPack(bytes);
  return {
    skyAt: (timestamp) => skyAt(pack, timestamp),
    chartAt: (timestamp, lat, lon) => chartAt(pack, timestamp, lat, lon),
    stars: pack.stars,
    zodiac: pack.zodiac,
    version: pack.version,
  };
}

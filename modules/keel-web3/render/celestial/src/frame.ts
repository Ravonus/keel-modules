// From the J2000 equatorial frame to a scene at a place: the horizon matrix, and the moon as seen from there.
import { centuries } from "./ephemeris.js";
import { EARTH_RADII_KM, OBLIQUITY, PRECESSION, RAD, entry, equatorial, siderealDegrees } from "./math.js";
import type { Body, Vec3 } from "./types.js";

/**
 * The matrix that turns a J2000 equatorial direction into scene space at a place: +y up, -z north, +x east. Rows first.
 */
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

export const toScene = (matrix: readonly number[], v: Vec3): Vec3 => {
  const m = (index: number): number => entry(matrix, index);
  return [
    m(0) * v[0] + m(1) * v[1] + m(2) * v[2],
    m(3) * v[0] + m(4) * v[1] + m(5) * v[2],
    m(6) * v[0] + m(7) * v[1] + m(8) * v[2],
  ];
};

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
export const eclipticPoint = (longitude: number, latitude: number, timestamp: number): Vec3 =>
  equatorial(longitude - PRECESSION * centuries(timestamp), latitude);

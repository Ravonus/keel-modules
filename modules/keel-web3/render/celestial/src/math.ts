// The constants the sky is measured in, and the small maths of angles and frames every part shares.
import type { Vec3 } from "./types.js";

export const RAD = Math.PI / 180;
export const DAY_MS = 86_400_000;
export const J2000_MS = 946_728_000_000;
export const CENTURY_DAYS = 36_525;
export const OBLIQUITY = 23.4392911 * RAD;
/** Degrees the equinox slides along the ecliptic each century. */
export const PRECESSION = 1.396971;
export const EARTH_RADII_KM = 6378.14;
export const AU_KM = 149_597_870.7;
export const SUN_RADIUS = 0.2666;
export const SUN_RADIUS_KM = 696_000;
export const MOON_RADIUS = 0.2725 * EARTH_RADII_KM;
export const wrap = (value: number, period: number): number => ((value % period) + period) % period;
export const near = (value: number): number => wrap(value + 180, 360) - 180;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** An entry a well-formed row always holds: a row that ends before it is broken data, never a zero. */
export function entry(row: ArrayLike<number>, index: number): number {
  const value = row[index];
  if (value === undefined) throw new Error(`celestial: a row ends before entry ${index}`);
  return value;
}

export const equatorial = (longitude: number, latitude: number): Vec3 => {
  const l = longitude * RAD;
  const b = latitude * RAD;
  const y = Math.cos(b) * Math.sin(l);
  const z = Math.sin(b);
  return [
    Math.cos(b) * Math.cos(l),
    y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY),
    y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY),
  ];
};
export const fromRaDec = (ra: number, dec: number): Vec3 => [
  Math.cos(dec * RAD) * Math.cos(ra * RAD),
  Math.cos(dec * RAD) * Math.sin(ra * RAD),
  Math.sin(dec * RAD),
];
export const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.atan2(
    Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  ) / RAD;

export const siderealDegrees = (timestamp: number, lon: number): number =>
  wrap(280.46061837 + 360.98564736629 * ((timestamp - J2000_MS) / DAY_MS) + lon, 360);

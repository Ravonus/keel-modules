/**
 * A small world model for light: where the sun and moon really are for a
 * place and an instant, and what the sky, the key light, the ambient fill,
 * the fog and the god rays look like there, given the season, the climate
 * and the weather. MIT.
 *
 *   const place = locateTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
 *   const light = worldLight({ timestamp: Date.now(), lat: place.lat, lon: place.lon, season: "autumn", climate: "maritime", weather: "clear" });
 *   light.sun.direction   -> [x, y, z], +y up, -z north
 *   light.sky.horizon     -> "#f4a259"
 *   light.rays            -> { source: "sun", strength, color, decay, density }
 *
 * Pure and deterministic: everything is a function of its input. Colours are
 * sRGB hex, directions unit vectors, so any renderer can use it; nothing here
 * touches a clock, a global or a GPU.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const SYNODIC_MONTH = 29.530588853;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const wrap = (value: number, period: number): number => ((value % period) + period) % period;
const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- sun and moon

/** Where a body sits in the sky, in degrees: elevation above the horizon and azimuth clockwise from north. */
export interface SkyPosition {
  readonly elevation: number;
  readonly azimuth: number;
}

export interface SolarPosition extends SkyPosition {
  readonly declination: number;
  /** Local solar hour angle, degrees (0 at solar noon, negative in the morning). */
  readonly hourAngle: number;
}

/**
 * The sun's position for a place and instant (the low-precision almanac
 * formulae, good to about a degree, plenty for light).
 *
 * @param timestamp Milliseconds since the Unix epoch.
 * @param lat Latitude, degrees north.
 * @param lon Longitude, degrees east.
 */
export function solarPosition(timestamp: number, lat: number, lon: number): SolarPosition {
  const n = timestamp / DAY_MS + 2440587.5 - 2451545.0;
  const meanLongitude = wrap(280.46 + 0.9856474 * n, 360);
  const anomaly = wrap(357.528 + 0.9856003 * n, 360) * RAD;
  const lambda = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
  const siderealHours = wrap(18.697374558 + 24.06570982441908 * n, 24);
  const hourAngle = wrap(siderealHours * 15 + lon - rightAscension / RAD + 180, 360) - 180;
  return { ...horizontal(hourAngle * RAD, declination, clamp(lat, -89.9, 89.9) * RAD), declination: declination / RAD, hourAngle };
}

function horizontal(hourAngle: number, declination: number, lat: number): SkyPosition {
  const elevation = Math.asin(Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(declination) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle));
  return { elevation: elevation / RAD, azimuth: wrap(azimuth / RAD, 360) };
}

export interface MoonState extends SkyPosition {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  readonly phase: number;
  /** Lit fraction of the disc, 0 to 1. */
  readonly illumination: number;
}

/**
 * The moon's phase and an approximate position: it trails the sun by its
 * phase of a day (full moon opposite the sun), on the sun's declination.
 * Accurate enough to light a scene; not an ephemeris.
 */
export function moonState(timestamp: number, lat: number, lon: number): MoonState {
  const days = timestamp / DAY_MS + 2440587.5 - 2451550.1;
  const phase = wrap(days / SYNODIC_MONTH, 1);
  const position = solarPosition(timestamp - phase * DAY_MS, lat, lon);
  return { elevation: position.elevation, azimuth: position.azimuth, phase, illumination: (1 - Math.cos(phase * 2 * Math.PI)) / 2 };
}

/** A unit vector toward a sky position: +y up, -z north, +x east. */
export function skyDirection(position: SkyPosition): readonly [number, number, number] {
  const elevation = position.elevation * RAD;
  const azimuth = position.azimuth * RAD;
  return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)];
}

// ---------------------------------------------------------------- places

/** A place for the sky: coordinates and a name. `exact` is false when only the UTC offset placed it. */
export interface Place {
  readonly lat: number;
  readonly lon: number;
  readonly place: string;
  readonly exact: boolean;
}

/** IANA zone -> [lat, lon, city]. A zone's own city stands for everyone in it. */
const ZONES: Readonly<Record<string, readonly [number, number, string]>> = {
  "America/New_York": [40.71, -74.01, "New York"], "America/Chicago": [41.88, -87.63, "Chicago"], "America/Denver": [39.74, -104.99, "Denver"],
  "America/Phoenix": [33.45, -112.07, "Phoenix"], "America/Los_Angeles": [34.05, -118.24, "Los Angeles"], "America/Anchorage": [61.22, -149.9, "Anchorage"],
  "Pacific/Honolulu": [21.31, -157.86, "Honolulu"], "America/Toronto": [43.65, -79.38, "Toronto"], "America/Vancouver": [49.28, -123.12, "Vancouver"],
  "America/Mexico_City": [19.43, -99.13, "Mexico City"], "America/Bogota": [4.71, -74.07, "Bogotá"], "America/Lima": [-12.05, -77.04, "Lima"],
  "America/Sao_Paulo": [-23.55, -46.63, "São Paulo"], "America/Argentina/Buenos_Aires": [-34.6, -58.38, "Buenos Aires"], "America/Santiago": [-33.45, -70.67, "Santiago"],
  "Atlantic/Reykjavik": [64.15, -21.94, "Reykjavík"], "Europe/London": [51.51, -0.13, "London"], "Europe/Dublin": [53.35, -6.26, "Dublin"],
  "Europe/Lisbon": [38.72, -9.14, "Lisbon"], "Europe/Madrid": [40.42, -3.7, "Madrid"], "Europe/Paris": [48.86, 2.35, "Paris"],
  "Europe/Berlin": [52.52, 13.4, "Berlin"], "Europe/Rome": [41.9, 12.5, "Rome"], "Europe/Amsterdam": [52.37, 4.9, "Amsterdam"],
  "Europe/Stockholm": [59.33, 18.07, "Stockholm"], "Europe/Oslo": [59.91, 10.75, "Oslo"], "Europe/Helsinki": [60.17, 24.94, "Helsinki"],
  "Europe/Athens": [37.98, 23.73, "Athens"], "Europe/Istanbul": [41.01, 28.98, "Istanbul"], "Europe/Moscow": [55.76, 37.62, "Moscow"],
  "Africa/Cairo": [30.04, 31.24, "Cairo"], "Africa/Lagos": [6.52, 3.38, "Lagos"], "Africa/Nairobi": [-1.29, 36.82, "Nairobi"],
  "Africa/Johannesburg": [-26.2, 28.05, "Johannesburg"], "Asia/Dubai": [25.2, 55.27, "Dubai"], "Asia/Tehran": [35.69, 51.39, "Tehran"],
  "Asia/Karachi": [24.86, 67.0, "Karachi"], "Asia/Kolkata": [22.57, 88.36, "Kolkata"], "Asia/Kathmandu": [27.72, 85.32, "Kathmandu"],
  "Asia/Bangkok": [13.76, 100.5, "Bangkok"], "Asia/Jakarta": [-6.21, 106.85, "Jakarta"], "Asia/Singapore": [1.35, 103.82, "Singapore"],
  "Asia/Shanghai": [31.23, 121.47, "Shanghai"], "Asia/Hong_Kong": [22.32, 114.17, "Hong Kong"], "Asia/Taipei": [25.03, 121.57, "Taipei"],
  "Asia/Manila": [14.6, 120.98, "Manila"], "Asia/Seoul": [37.57, 126.98, "Seoul"], "Asia/Tokyo": [35.68, 139.69, "Tokyo"],
  "Australia/Perth": [-31.95, 115.86, "Perth"], "Australia/Adelaide": [-34.93, 138.6, "Adelaide"], "Australia/Brisbane": [-27.47, 153.03, "Brisbane"],
  "Australia/Sydney": [-33.87, 151.21, "Sydney"], "Australia/Melbourne": [-37.81, 144.96, "Melbourne"], "Pacific/Auckland": [-36.85, 174.76, "Auckland"],
  UTC: [51.48, 0, "Greenwich"],
};

/**
 * A place for a time zone: its own city when the zone is known, otherwise a
 * longitude from the UTC offset (15° an hour) at a temperate northern latitude.
 *
 * @param timeZone IANA zone, e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone.
 * @param utcOffsetMinutes The zone's offset from UTC now, used only when the zone is unknown.
 */
export function locateTimeZone(timeZone: string, utcOffsetMinutes = 0): Place {
  const known = ZONES[timeZone];
  if (known !== undefined) return { lat: known[0], lon: known[1], place: known[2], exact: true };
  const city = timeZone.split("/").pop()?.replaceAll("_", " ") ?? "";
  const lon = clamp(Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes / 4 : 0, -180, 180);
  return { lat: 38, lon, place: city.length > 0 ? city : "UTC", exact: false };
}

/** Every zone the table places exactly. */
export const KNOWN_ZONES = Object.keys(ZONES) as readonly string[];

// ---------------------------------------------------------------- colour

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex(color: Rgb): string {
  return `#${color.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes two #rrggbb colours in sRGB. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  const t = clamp(amount, 0, 1);
  return hex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

// ---------------------------------------------------------------- the light

/** One stop of the sky by sun elevation. */
interface SkyStop {
  readonly at: number;
  readonly top: string;
  readonly horizon: string;
  readonly sun: string;
  readonly fill: string;
  readonly ground: string;
  readonly sunIntensity: number;
  readonly fillIntensity: number;
}

const SKY_STOPS: readonly SkyStop[] = [
  { at: -90, top: "#03060f", horizon: "#0a1226", sun: "#000000", fill: "#1d2748", ground: "#06080e", sunIntensity: 0, fillIntensity: 0.42 },
  { at: -14, top: "#08122c", horizon: "#1d2a52", sun: "#000000", fill: "#27325c", ground: "#090c16", sunIntensity: 0, fillIntensity: 0.5 },
  { at: -6, top: "#1a2a5e", horizon: "#5b5a94", sun: "#ff6a4a", fill: "#4a5590", ground: "#151726", sunIntensity: 0, fillIntensity: 0.66 },
  { at: -1, top: "#2d4b8e", horizon: "#e2775c", sun: "#ff6236", fill: "#8a789e", ground: "#2a2230", sunIntensity: 0.35, fillIntensity: 0.84 },
  { at: 3, top: "#4870b4", horizon: "#f2ac72", sun: "#ff9a4c", fill: "#b3aac0", ground: "#3d3a38", sunIntensity: 1.7, fillIntensity: 1.0 },
  { at: 10, top: "#5a8ed0", horizon: "#f5d4a2", sun: "#ffd192", fill: "#cfd5df", ground: "#4a4a40", sunIntensity: 2.5, fillIntensity: 1.24 },
  { at: 25, top: "#4d8edc", horizon: "#bfe0f0", sun: "#fff0d8", fill: "#e4f0fb", ground: "#4f5a48", sunIntensity: 3.3, fillIntensity: 1.44 },
  { at: 90, top: "#3a80dc", horizon: "#cde8f6", sun: "#fffaf0", fill: "#f2f8ff", ground: "#56634e", sunIntensity: 3.8, fillIntensity: 1.6 },
];

function stopAt(index: number): SkyStop {
  const stop = SKY_STOPS[clamp(index, 0, SKY_STOPS.length - 1)];
  if (stop === undefined) throw new RangeError("world-light: no sky stops");
  return stop;
}

function skyAt(elevation: number): SkyStop {
  const index = SKY_STOPS.findIndex((stop) => stop.at > elevation);
  const upper = stopAt(index === -1 ? SKY_STOPS.length - 1 : Math.max(1, index));
  const lower = stopAt(index === -1 ? SKY_STOPS.length - 2 : Math.max(0, index - 1));
  const t = clamp((elevation - lower.at) / (upper.at - lower.at), 0, 1);
  const mix = (key: "top" | "horizon" | "sun" | "fill" | "ground"): string => mixHex(lower[key], upper[key], t);
  return {
    at: elevation, top: mix("top"), horizon: mix("horizon"), sun: mix("sun"), fill: mix("fill"), ground: mix("ground"),
    sunIntensity: lower.sunIntensity + (upper.sunIntensity - lower.sunIntensity) * t,
    fillIntensity: lower.fillIntensity + (upper.fillIntensity - lower.fillIntensity) * t,
  };
}

export type Weather = "clear" | "wind" | "leaves" | "rain" | "snow";
export type Climate = "temperate" | "maritime" | "alpine" | "monsoon" | "highland" | "desert";
export type LightPhase = "night" | "twilight" | "blue hour" | "golden hour" | "day" | "high sun";

/** A tint a season, climate or weather lays over the sky: colours it leans toward, and how hazy it makes the air. */
interface Mood {
  readonly top?: readonly [string, number];
  readonly horizon?: readonly [string, number];
  readonly sun?: readonly [string, number];
  readonly fill?: readonly [string, number];
  readonly haze: number;
  readonly sunScale: number;
  readonly rays: number;
}

const SEASONS: Readonly<Record<string, Mood>> = {
  spring: { horizon: ["#f6d4e0", 0.14], fill: ["#f4dde6", 0.1], haze: 0.15, sunScale: 1, rays: 1 },
  summer: { top: ["#2f72d6", 0.12], sun: ["#fff0c8", 0.1], haze: 0.05, sunScale: 1.06, rays: 0.9 },
  autumn: { horizon: ["#f2ad6a", 0.18], sun: ["#ffbf78", 0.16], fill: ["#f0d2b0", 0.1], haze: 0.3, sunScale: 0.95, rays: 1.25 },
  winter: { top: ["#9db6d8", 0.22], sun: ["#f4f2ff", 0.2], fill: ["#d8e2f4", 0.16], haze: 0.12, sunScale: 0.85, rays: 0.95 },
  "long rains": { horizon: ["#c9d2c4", 0.16], haze: 0.35, sunScale: 0.92, rays: 1.2 },
  "short rains": { horizon: ["#c9d2c4", 0.14], haze: 0.3, sunScale: 0.94, rays: 1.15 },
  "high sun": { top: ["#2f72d6", 0.1], haze: 0.05, sunScale: 1.08, rays: 0.85 },
  "dry season": { horizon: ["#e8c890", 0.2], sun: ["#ffd9a0", 0.1], haze: 0.35, sunScale: 1, rays: 1.3 },
};

const CLIMATES: Readonly<Record<Climate, Mood>> = {
  temperate: { haze: 0, sunScale: 1, rays: 1 },
  maritime: { horizon: ["#c4d0d6", 0.16], haze: 0.22, sunScale: 0.92, rays: 1.15 },
  alpine: { top: ["#2a63c8", 0.14], haze: -0.15, sunScale: 1.1, rays: 0.85 },
  monsoon: { horizon: ["#e6d2c0", 0.14], haze: 0.28, sunScale: 0.95, rays: 1.2 },
  highland: { horizon: ["#ead8b0", 0.12], haze: 0.12, sunScale: 1.05, rays: 1.1 },
  desert: { horizon: ["#efd0a0", 0.2], sun: ["#fff0d0", 0.1], haze: 0.2, sunScale: 1.1, rays: 1.1 },
};

const WEATHER: Readonly<Record<Weather, Mood>> = {
  clear: { haze: 0, sunScale: 1, rays: 1 },
  wind: { haze: 0.05, sunScale: 1, rays: 1.05 },
  leaves: { haze: 0.12, sunScale: 1, rays: 1.15 },
  rain: { top: ["#7d878f", 0.62], horizon: ["#99a2a8", 0.6], sun: ["#c8ccd0", 0.5], fill: ["#a9b0b6", 0.4], haze: 0.45, sunScale: 0.28, rays: 0.12 },
  snow: { top: ["#b8c4d0", 0.5], horizon: ["#dfe5ec", 0.5], sun: ["#eef2f8", 0.4], fill: ["#dfe6f0", 0.3], haze: 0.35, sunScale: 0.5, rays: 0.35 },
};

function applyMood(sky: SkyStop, mood: Mood): SkyStop {
  const lean = (color: string, toward: readonly [string, number] | undefined): string => (toward === undefined ? color : mixHex(color, toward[0], toward[1]));
  return { ...sky, top: lean(sky.top, mood.top), horizon: lean(sky.horizon, mood.horizon), sun: lean(sky.sun, mood.sun), fill: lean(sky.fill, mood.fill), sunIntensity: sky.sunIntensity * mood.sunScale };
}

export interface WorldLightInput {
  readonly timestamp: number;
  readonly lat: number;
  readonly lon: number;
  readonly season?: string | undefined;
  readonly climate?: Climate | undefined;
  readonly weather?: Weather | undefined;
}

export interface LightSource {
  readonly direction: readonly [number, number, number];
  readonly elevation: number;
  readonly azimuth: number;
  readonly color: string;
  readonly intensity: number;
}

/** God rays: which body casts them, how strong, their colour, and how they fall off along the ray. */
export interface Rays {
  readonly source: "sun" | "moon" | "none";
  readonly direction: readonly [number, number, number];
  readonly strength: number;
  readonly color: string;
  /** Per-sample falloff along a ray (0.9 short shafts, 0.98 long ones). */
  readonly decay: number;
  /** How far toward the source a ray reaches, as a fraction of the way (0..1). */
  readonly density: number;
}

export interface WorldLight {
  readonly phase: LightPhase;
  readonly sun: LightSource;
  readonly moon: LightSource & { readonly phase: number; readonly illumination: number };
  readonly sky: { readonly top: string; readonly horizon: string; readonly ground: string };
  readonly fill: { readonly sky: string; readonly ground: string; readonly intensity: number };
  readonly fog: { readonly color: string; readonly near: number; readonly far: number };
  /** 0 clear air to 1 thick haze; morning mist and wet seasons raise it. */
  readonly haze: number;
  /** 0 day to 1 full night (stars). */
  readonly night: number;
  readonly rays: Rays;
}

export function lightPhase(elevation: number): LightPhase {
  if (elevation < -12) return "night";
  if (elevation < -4) return "twilight";
  if (elevation < 0) return "blue hour";
  if (elevation < 10) return "golden hour";
  return elevation < 50 ? "day" : "high sun";
}

/** Morning mist: the first hours after sunrise hold haze in the air. */
function mist(hourAngle: number, elevation: number): number {
  return elevation > -4 && hourAngle < 0 ? (1 - smooth(-6, 30, elevation)) * 0.35 : 0;
}

function sunRays(elevation: number, haze: number, moodRays: number): number {
  const low = smooth(-3, 2, elevation) * (1 - smooth(14, 50, elevation));
  const high = smooth(2, 70, elevation) * 0.3;
  return clamp((low + high) * (0.55 + haze) * moodRays, 0, 1.4);
}

function moonLight(timestamp: number, lat: number, lon: number, night: number): WorldLight["moon"] {
  const moon = moonState(timestamp, lat, lon);
  const up = smooth(-2, 12, moon.elevation);
  return { direction: skyDirection(moon), elevation: moon.elevation, azimuth: moon.azimuth, color: "#a9bcff", intensity: (0.15 + 0.85 * moon.illumination) * up * night * 0.9, phase: moon.phase, illumination: moon.illumination };
}

function chooseRays(sun: LightSource, moon: WorldLight["moon"], haze: number, moodRays: number): Rays {
  const fromSun = sunRays(sun.elevation, haze, moodRays);
  const fromMoon = moon.intensity * smooth(5, 25, moon.elevation) * 0.45 * moodRays;
  if (fromSun <= 0.02 && fromMoon <= 0.02) return { source: "none", direction: sun.direction, strength: 0, color: "#000000", decay: 0.95, density: 0.8 };
  if (fromSun >= fromMoon) {
    const low = 1 - smooth(4, 30, sun.elevation);
    return { source: "sun", direction: sun.direction, strength: fromSun, color: mixHex(sun.color, "#ffffff", 0.15), decay: 0.94 + 0.04 * low + 0.01 * haze, density: 0.75 + 0.2 * low };
  }
  return { source: "moon", direction: moon.direction, strength: fromMoon, color: "#b7c6ff", decay: 0.95, density: 0.8 };
}

/**
 * The light of a place at an instant: the real sun and moon for its
 * latitude, longitude and date (so season and place change the sun's path),
 * bent by the season's, climate's and weather's mood.
 */
export function worldLight(input: WorldLightInput): WorldLight {
  const solar = solarPosition(input.timestamp, input.lat, input.lon);
  const moods = [SEASONS[input.season ?? ""] ?? CLIMATES.temperate, CLIMATES[input.climate ?? "temperate"], WEATHER[input.weather ?? "clear"]];
  const sky = moods.reduce(applyMood, skyAt(solar.elevation));
  const haze = clamp(0.06 + moods.reduce((sum, mood) => sum + mood.haze, 0) + mist(solar.hourAngle, solar.elevation), 0, 1);
  const moodRays = moods.reduce((product, mood) => product * mood.rays, 1);
  const night = 1 - smooth(-14, -2, solar.elevation);
  const sun: LightSource = { direction: skyDirection(solar), elevation: solar.elevation, azimuth: solar.azimuth, color: sky.sun, intensity: sky.sunIntensity * smooth(-3, 1, solar.elevation) };
  const moon = moonLight(input.timestamp, input.lat, input.lon, night);
  return {
    phase: lightPhase(solar.elevation),
    sun,
    moon,
    sky: { top: sky.top, horizon: sky.horizon, ground: mixHex(sky.horizon, sky.ground, 0.55) },
    fill: { sky: sky.fill, ground: sky.ground, intensity: sky.fillIntensity * (1 - haze * 0.15) },
    fog: { color: mixHex(mixHex(sky.horizon, sky.top, 0.35), sky.fill, 0.2), near: 32 - haze * 8, far: 118 - haze * 34 },
    haze,
    night,
    rays: chooseRays(sun, moon, haze, moodRays),
  };
}

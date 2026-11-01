// The shapes the sky is reported in: vectors, bodies, the sky and chart of an instant, and a pack's parts.

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

/**
 * One correction: `amount(tau^power * (sin * sin(angle) + cos * cos(angle)))`, its angle a sum of whole multiples of
 * the arguments.
 */
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

export type Rgb = readonly [number, number, number];

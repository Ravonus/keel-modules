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
 *
 * The parts: `pack` reads the data, `ephemeris` places the bodies and builds the sky and chart, `frame` turns
 * directions into a scene, `canvas` and `paint` draw the chart and its transits.
 */
export type { Vec3, BodyId, Body, Shower, Sky, AspectKind, Aspect, Chart, Term, SkyPack, Star, Rgb } from "./types.js";
export { readPack } from "./pack.js";
export { angleBetween } from "./math.js";
export { deltaT, centuries, keplerPlace, applyTerms, planetArgs, moonArgs, moonBase, openSky } from "./ephemeris.js";
export type { SkyModel } from "./ephemeris.js";
export { horizonMatrix, toScene, moonFrom, eclipticPoint } from "./frame.js";
export { BODY_LIGHT, paintChart, paintTransits } from "./paint.js";
export type { ChartSize, TransitPixels, Crossing, TransitLevels } from "./paint.js";

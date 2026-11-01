// Painting the sky into pixels: the fixed chart of stars, figures and a birth, and the transits that move over it.
import { Canvas } from "./canvas.js";
import { BODY_IDS, aspectsAt } from "./ephemeris.js";
import { eclipticPoint } from "./frame.js";
import { DAY_MS, clamp, near } from "./math.js";
import type { AspectKind, Body, BodyId, Chart, Rgb, Sky, Star } from "./types.js";

const STAR_LIGHT: Rgb = [205, 218, 255];
const FIGURE_LIGHT: Rgb = [150, 170, 230];
const HARD_LIGHT: Rgb = [255, 130, 150];
const SOFT_LIGHT: Rgb = [130, 190, 255];
const NATAL_LIGHT: Rgb = [255, 226, 170];
/** Each planet's colour, by eye from the sky, for marks and for a renderer's discs. */
export const BODY_LIGHT: Record<BodyId, Rgb> = {
  sun: [255, 214, 130],
  moon: [214, 222, 255],
  mercury: [188, 200, 214],
  venus: [255, 240, 208],
  mars: [255, 120, 86],
  jupiter: [255, 216, 168],
  saturn: [226, 198, 140],
  uranus: [150, 232, 232],
  neptune: [120, 150, 255],
  pluto: [190, 150, 170],
};

/** The fixed stars and the figures drawn between them, as `paintChart` needs them. */
interface FixedSky {
  stars: readonly Star[];
  zodiac: readonly (readonly (readonly number[])[])[];
}
/** What every mark of a chart shares: the canvas, the instant whose equinox it is drawn on, and its strength. */
interface Brush {
  canvas: Canvas;
  when: number;
  level: number;
}
/** What the transits share: the canvas, the sky now, how to ask for another instant's, and the strength. */
interface Overlay {
  canvas: Canvas;
  skyAt: (timestamp: number) => Sky;
  now: Sky;
  level: number;
}

/** A star a zodiac line names; a pack whose figures point past its stars is broken. */
function starOf(stars: readonly Star[], index: number | undefined): Star {
  const star = index === undefined ? undefined : stars[index];
  if (!star) throw new Error("celestial: a zodiac line names a star the pack does not hold");
  return star;
}

/**
 * One aspect as a dotted arc: on the ecliptic they would all lie on one line, so hard ones bow north and soft ones
 * south.
 */
function arc(brush: Brush, a: Body, b: Body, aspect: { kind: AspectKind; orb: number }): void {
  if (aspect.kind === "conjunction") return;
  const sweep = near(b.longitude - a.longitude);
  const hard = aspect.kind === "square" || aspect.kind === "opposition";
  const bow = Math.abs(sweep) * 0.22 * (hard ? 1 : -1);
  const steps = Math.ceil(Math.abs(sweep) / 0.7);
  for (let step = 0; step <= steps; step += 1) {
    const s = step / steps;
    brush.canvas.stamp(
      eclipticPoint(
        a.longitude + sweep * s,
        a.latitude + (b.latitude - a.latitude) * s + bow * Math.sin(Math.PI * s),
        brush.when,
      ),
      0.6,
      hard ? HARD_LIGHT : SOFT_LIGHT,
      0.15 * (1 - aspect.orb / 10) * brush.level,
    );
  }
}

function paintStars(brush: Brush, stars: readonly Star[]): void {
  for (const star of stars) {
    brush.canvas.stamp(
      star.direction,
      star.magnitude < 1.5 ? 1.2 : 0.7,
      STAR_LIGHT,
      clamp((4.4 - star.magnitude) / 5, 0.12, 1) * brush.level,
    );
  }
}

/** The zodiac figures, the sun's own sign brighter. */
function paintFigures(brush: Brush, sky: FixedSky, sign: number): void {
  sky.zodiac.forEach((figure, index) => {
    const ink = { light: FIGURE_LIGHT, strength: (index === sign ? 0.2 : 0.1) * brush.level };
    for (const line of figure) {
      for (let at = 1; at < line.length; at += 1) {
        brush.canvas.dots(starOf(sky.stars, line[at - 1]).direction, starOf(sky.stars, line[at]).direction, ink, 0.45);
      }
    }
  });
}

/** The ecliptic as ticks every three degrees, a bigger one at each sign's start. */
function paintEcliptic(brush: Brush): void {
  for (let degree = 0; degree < 360; degree += 3) {
    brush.canvas.stamp(
      eclipticPoint(degree, 0, brush.when),
      degree % 30 === 0 ? 0.9 : 0.5,
      FIGURE_LIGHT,
      (degree % 30 === 0 ? 0.26 : 0.07) * brush.level,
    );
  }
}

/** The planets of the birth as the chart's own stars, each with a ring. */
function paintBodies(brush: Brush, chart: Chart): void {
  for (const id of BODY_IDS) {
    const body = chart.bodies[id];
    brush.canvas.stamp(body.direction, id === "sun" || id === "moon" ? 1.8 : 1.2, BODY_LIGHT[id], 0.7 * brush.level);
    brush.canvas.ring(body.direction, 1.1, BODY_LIGHT[id], 0.16 * brush.level);
  }
}

/** The ascendant and midheaven as short bars across the ecliptic. */
function paintAngles(brush: Brush, chart: Chart): void {
  brush.canvas.dots(
    eclipticPoint(chart.ascendant, -1.6, brush.when),
    eclipticPoint(chart.ascendant, 1.6, brush.when),
    { light: NATAL_LIGHT, strength: 0.32 * brush.level },
    0.3,
  );
  brush.canvas.dots(
    eclipticPoint(chart.midheaven, -1, brush.when),
    eclipticPoint(chart.midheaven, 1, brush.when),
    { light: NATAL_LIGHT, strength: 0.2 * brush.level },
    0.3,
  );
}

/** Born under an eclipse or a shower: the sky remembers it. */
function paintOmens(brush: Brush, chart: Chart): void {
  if (chart.solar > 0) brush.canvas.ring(chart.bodies.sun.direction, 2.6, NATAL_LIGHT, 0.5 * brush.level);
  if (chart.lunar > 0) brush.canvas.ring(chart.bodies.moon.direction, 2.6, BODY_LIGHT.mars, 0.5 * brush.level);
  if (chart.shower) {
    for (let index = 0; index < 12; index += 1) {
      brush.canvas.ring(chart.shower.radiant, 1.2 + index * 0.7, NATAL_LIGHT, 0.04 * brush.level);
    }
  }
}

/**
 * Paints what never moves against the stars into RGBA pixels: the real stars and zodiac, and the tree's own chart,
 * which reads as one more constellation, with the planets of its birth as its stars.
 */
export function paintChart(sky: FixedSky, chart: Chart, width: number, height: number, level = 1): Uint8Array {
  const canvas = new Canvas(new Uint8Array(width * height * 4), width, height);
  for (let at = 3; at < canvas.pixels.length; at += 4) canvas.pixels[at] = 255;
  const brush: Brush = { canvas, when: chart.timestamp, level };
  paintStars(brush, sky.stars);
  paintFigures(brush, sky, Math.floor(chart.bodies.sun.longitude / 30));
  paintEcliptic(brush);
  for (const aspect of chart.aspects) arc(brush, chart.bodies[aspect.a], chart.bodies[aspect.b], aspect);
  paintBodies(brush, chart);
  paintAngles(brush, chart);
  paintOmens(brush, chart);
  return canvas.pixels;
}

/** A retrograde planet's real looping path over the weeks around now. */
function paintLoop(overlay: Overlay, id: BodyId): void {
  for (let day = -36; day <= 36; day += 4) {
    const direction = overlay.skyAt(overlay.now.timestamp + day * DAY_MS).bodies[id].direction;
    overlay.canvas.stamp(direction, 0.6, BODY_LIGHT[id], 0.26 * overlay.level);
  }
}

/** A ring on any birth place a planet is crossing now. */
function paintCrossings(overlay: Overlay, chart: Chart, body: Body): void {
  for (const birth of BODY_IDS) {
    const gap = Math.abs(near(body.longitude - chart.bodies[birth].longitude));
    if (gap < 1.5) {
      overlay.canvas.ring(chart.bodies[birth].direction, 2, BODY_LIGHT[body.id], 0.3 * (1 - gap / 1.5) * overlay.level);
    }
  }
}

/** The planets' aspects to one another now: a web that forms and lets go as they move. */
function paintWeb(brush: Brush, now: Sky): void {
  const ids = BODY_IDS.filter((id) => id !== "moon");
  for (const [index, first] of ids.entries()) {
    for (const second of ids.slice(index + 1)) {
      const a = now.bodies[first];
      const b = now.bodies[second];
      const gap = Math.abs(near(a.longitude - b.longitude));
      for (const aspect of aspectsAt(gap)) arc(brush, a, b, aspect);
    }
  }
}

/**
 * Lays what changes day by day over a painted chart: a retrograde planet's real looping path, and a ring on any
 * birth place a planet is crossing now. `target` receives the chart with those on top; a `web` above 0 adds the
 * planets' live aspects at that strength.
 */
export function paintTransits(
  base: Uint8Array,
  target: Uint8Array,
  width: number,
  height: number,
  skyAt: (timestamp: number) => Sky,
  chart: Chart,
  now: Sky,
  level = 1,
  web = 0,
): Uint8Array {
  target.set(base);
  const canvas = new Canvas(target, width, height);
  const overlay: Overlay = { canvas, skyAt, now, level };
  for (const id of BODY_IDS) {
    const body = now.bodies[id];
    if (body.retrograde) paintLoop(overlay, id);
    if (id === "moon") continue;
    paintCrossings(overlay, chart, body);
  }
  if (web > 0) paintWeb({ canvas, when: now.timestamp, level: web }, now);
  return target;
}

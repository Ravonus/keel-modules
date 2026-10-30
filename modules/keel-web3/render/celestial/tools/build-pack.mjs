#!/usr/bin/env node
// Builds data/sky.pack: orbital elements plus corrections fitted to a reference ephemeris, and the star and
// shower tables. Runtime code never changes for a new pack; bump VERSION when the numbers do.
//
//   node tools/build-pack.mjs --sources <dir with stars.6.json and constellations.lines.json> --oracle <astronomy-engine>
//
// Sources: JPL Keplerian elements tables 2a/2b (Standish and Williams; Pluto table 1), ELP2000-82 mean arguments,
// Yale Bright Star Catalog and zodiac figures via d3-celestial (BSD-3-Clause, Olaf Frohn), the IMO meteor shower
// list. Fit target: astronomy-engine (MIT), used here only, never shipped.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
const sources = flag("--sources");
const A = await import(pathToFileURL(flag("--oracle")).href);
const ts = createRequire(path.join(here, "../../../../../package.json"))("typescript");
const compiled = path.join(flag("--scratch") ?? here, "celestial.compiled.mjs");
writeFileSync(compiled, ts.transpileModule(readFileSync(path.join(here, "../src/index.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const C = await import(pathToFileURL(compiled).href);

const VERSION = 1;
const FROM = Date.UTC(2000, 0, 1);
const TO = Date.UTC(4031, 0, 1);
const RAD = Math.PI / 180;
const OBLIQUITY = 23.4392911 * RAD;
const ANGLE_UNIT = 1e-4;
const PLANET_UNIT = 1e-6;
const MOON_UNIT = 1e-3;

const ELEMENTS = {
  mercury: [0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819, 0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182],
  venus: [0.72332102, 0.00676399, 3.39777545, 181.9797085, 131.76755713, 76.67261496, -0.00000026, -0.00005107, 0.00043494, 58517.8156026, 0.05679648, -0.27274174],
  earth: [1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389, -0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.3179526, -0.24123856],
  mars: [1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984, 0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431],
  jupiter: [5.20248019, 0.0485359, 1.29861416, 34.33479152, 14.27495244, 100.29282654, -0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619],
  saturn: [9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702, -0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002],
  uranus: [19.18797948, 0.0468574, 0.77298127, 314.20276625, 172.43404441, 73.96250215, -0.00020455, -0.0000155, -0.00180155, 428.49512595, 0.09266985, 0.05739699],
  neptune: [30.06952752, 0.00895439, 1.7700552, 304.22289287, 46.68158724, 131.78635853, 0.00006447, 0.00000818, 0.000224, 218.46515314, 0.01009938, -0.00606302],
  pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};
const GIANTS = { jupiter: [-0.00012452, 0.0606406, -0.35635438, 38.35125], saturn: [0.00025899, -0.13434469, 0.87320147, 38.35125], uranus: [0.00058331, -0.97731848, 0.17689245, 7.67025], neptune: [-0.00041348, 0.68346318, -0.10162547, 7.67025] };
/** L', D, M, M', F: value and rate a century (degrees). */
const MOON = [218.3164477, 481267.88123421, 297.8501921, 445267.1114034, 357.5291092, 35999.0502909, 134.9633964, 477198.8675055, 93.272095, 483202.0175233];
const SHOWERS = [283.15, 230, 49, 110, 0.5, 32.32, 271, 34, 18, 1, 45.5, 338, -1, 50, 3, 125, 340, -16, 25, 4, 140, 48, 58, 100, 2.5, 208, 95, 16, 20, 3, 235.27, 152, 22, 15, 1, 262.2, 112, 33, 150, 1, 270.7, 217, 76, 10, 0.7];
const IDS = Object.keys(ELEMENTS);
const ORACLE = { mercury: "Mercury", venus: "Venus", earth: "EMB", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto" };
/** Target rms by channel: degrees of longitude and latitude, and distance in units; and how many terms a channel may spend. */
const near = (v) => ((v + 540) % 360) - 180;
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

const eclipticOf = (v) => {
  const y = v.y * Math.cos(OBLIQUITY) + v.z * Math.sin(OBLIQUITY);
  const z = -v.y * Math.sin(OBLIQUITY) + v.z * Math.cos(OBLIQUITY);
  const r = Math.hypot(v.x, y, z);
  return [Math.atan2(y, v.x) / RAD, Math.asin(z / r) / RAD, r];
};

// A term's candidate angle set for a body: harmonics and two-body beats of the mean longitudes that move it.
function planetCandidates(self) {
  const partners = self < 4 ? [2, 3, 4, 5].filter((p) => p !== self).concat(self === 0 ? [1] : self === 3 ? [2] : []) : [4, 5, 6, 7, 8].filter((p) => p !== self);
  const list = [];
  const seen = new Set();
  const add = (m) => { const key = JSON.stringify(m); if (!seen.has(key)) { seen.add(key); list.push(m); } };
  for (let a = 1; a <= 7; a += 1) add([[self, a]]);
  for (const p of partners) {
    for (let a = -7; a <= 7; a += 1) for (let b = 1; b <= 8; b += 1) if (Math.abs(a) + b <= 10) add(a === 0 ? [[p, b]] : [[self, a], [p, b]]);
    if (self >= 4) for (const q of partners) if (q > p) for (const [a, b, c] of [[1, -2, 1], [1, -1, 1], [2, -5, 2], [1, -3, 2], [2, -4, 1], [1, 2, -3], [1, -2, 2], [2, -2, 1]]) add([[self, a], [p, b], [q, c]]);
  }
  return list;
}
function moonCandidates() {
  const list = [];
  for (let d = 0; d <= 6; d += 1) for (let m = -3; m <= 3; m += 1) for (let mm = -4; mm <= 4; mm += 1) for (let f = -4; f <= 4; f += 1) {
    if (d === 0 && m === 0 && mm === 0 && f === 0) continue;
    if (d === 0 && (m < 0 || (m === 0 && mm < 0) || (m === 0 && mm === 0 && f < 0))) continue;
    if (Math.abs(d) + Math.abs(m) + Math.abs(mm) + Math.abs(f) > 8) continue;
    list.push([[1, d], [2, m], [3, mm], [4, f]].filter(([, k]) => k !== 0));
  }
  return list;
}

function solve(matrix, right) {
  const n = right.length;
  const a = matrix.map((row, i) => [...row, right[i]]);
  for (let c = 0; c < n; c += 1) {
    a[c][c] += 1e-9 * (a[c][c] + 1);
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = c + 1; r < n; r += 1) {
      const scale = a[r][c] / a[c][c];
      if (scale !== 0) for (let k = c; k <= n; k += 1) a[r][k] -= scale * a[c][k];
    }
  }
  const out = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c -= 1) {
    let sum = a[c][n];
    for (let k = c + 1; k < n; k += 1) sum -= a[c][k] * out[k];
    out[c] = sum / a[c][c];
  }
  return out;
}

/** Orthogonal matching pursuit over a shared basis of [sin, cos] columns, polynomial columns included. */
function pursue(residual, basis, target, limit, label) {
  const samples = residual.length;
  const chosen = [];
  const columns = [];
  let left = Float64Array.from(residual);
  const rms = () => Math.sqrt(left.reduce((sum, v) => sum + v * v, 0) / samples);
  const refit = () => {
    const n = columns.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const right = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) { let sum = 0; for (let s = 0; s < samples; s += 1) sum += columns[i][s] * columns[j][s]; matrix[i][j] = matrix[j][i] = sum; }
      let sum = 0; for (let s = 0; s < samples; s += 1) sum += columns[i][s] * residual[s]; right[i] = sum;
    }
    const weights = solve(matrix, right);
    left = Float64Array.from(residual);
    for (let i = 0; i < n; i += 1) for (let s = 0; s < samples; s += 1) left[s] -= weights[i] * columns[i][s];
    return weights;
  };
  let weights = [];
  while (chosen.length < limit && rms() > target) {
    let best = -1; let score = -1;
    for (let c = 0; c < basis.length; c += 1) {
      const { sin, cos } = basis[c];
      let a = 0; let b = 0;
      if (sin) for (let s = 0; s < samples; s += 1) a += sin[s] * left[s];
      for (let s = 0; s < samples; s += 1) b += cos[s] * left[s];
      const gain = (sin ? a * a / basis[c].sinNorm : 0) + b * b / basis[c].cosNorm;
      if (gain > score) { score = gain; best = c; }
    }
    chosen.push(best);
    if (basis[best].sin) columns.push(basis[best].sin);
    columns.push(basis[best].cos);
    weights = refit();
  }
  console.error(`  ${label}: ${chosen.length} terms, rms ${(rms() * 3600).toFixed(2)}" of ${(Math.sqrt(residual.reduce((s, v) => s + v * v, 0) / samples) * 3600).toFixed(1)}"`);
  let w = 0;
  return chosen.map((index) => { const b = basis[index]; const sin = b.sin ? weights[w++] : 0; const cos = weights[w++]; return { multiples: b.multiples, power: b.power, sin, cos }; });
}

function basisFor(candidates, argsAt, times, powers, polynomial) {
  const taus = times.map((t) => t / 10);
  const basis = [];
  const norm = (v) => v.reduce((sum, x) => sum + x * x, 0) + 1e-12;
  for (const power of polynomial) { const cos = Float32Array.from(taus, (tau) => tau ** power); basis.push({ multiples: [], power, cos, cosNorm: norm(cos) }); }
  const argTable = times.map(argsAt);
  for (const multiples of candidates) {
    for (const power of powers) {
      const sin = new Float32Array(times.length); const cos = new Float32Array(times.length);
      times.forEach((t, s) => { let angle = 0; for (const [arg, k] of multiples) angle += argTable[s][arg] * k; const size = taus[s] ** power; sin[s] = size * Math.sin(angle * RAD); cos[s] = size * Math.cos(angle * RAD); });
      basis.push({ multiples, power, sin, cos, sinNorm: norm(sin), cosNorm: norm(cos) });
    }
  }
  return basis;
}

const stamps = (count) => Array.from({ length: count }, () => FROM + random() * (TO - FROM));
const PLANS = { mercury: [30, 20, 1e-5], venus: [30, 20, 1e-5], earth: [20, 12, 1e-5], mars: [40, 30, 2e-5], jupiter: [60, 40, 1e-4], saturn: [60, 40, 3e-4], uranus: [60, 40, 5e-4], neptune: [60, 40, 8e-4], pluto: [60, 30, 1.5e-3] };
const LIMITS = [90, 50, 60];

const pack = { terms: [] };
const planetArgsAt = (t) => C.planetArgs(ELEMENTS, t);
for (const [index, id] of IDS.entries()) {
  console.error(id);
  const when = stamps(4000);
  const times = when.map((ms) => C.centuries(ms));
  const base = times.map((t) => C.keplerPlace(ELEMENTS[id], GIANTS[id], t));
  const truth = when.map((ms, s) => eclipticOf(A.HelioVector(A.Body[ORACLE[id]], A.MakeTime(new Date(ms)))));
  const basis = basisFor(planetCandidates(index), planetArgsAt, times, id === "pluto" ? [0, 1, 2] : [0, 1], [0, 1, 2, 3]);
  const [lonTarget, latTarget, distanceTarget] = PLANS[id];
  const terms = [];
  const channels = [
    [times.map((_, s) => near(truth[s][0] - base[s][0])), lonTarget / 3600, 1 / ANGLE_UNIT],
    [times.map((_, s) => truth[s][1] - base[s][1]), latTarget / 3600, 1 / ANGLE_UNIT],
    [times.map((_, s) => truth[s][2] - base[s][2]), distanceTarget, 1 / PLANET_UNIT],
  ];
  channels.forEach(([residual, target, scale], channel) => {
    for (const term of pursue(residual, basis, target, LIMITS[channel], `channel ${channel}`)) terms.push({ ...term, channel, sin: Math.round(term.sin * scale), cos: Math.round(term.cos * scale) });
  });
  pack.terms.push(terms.filter((term) => term.sin !== 0 || term.cos !== 0));
}
{
  console.error("moon");
  const when = stamps(12000);
  const times = when.map((ms) => C.centuries(ms));
  const moonRow = MOON.map((v) => Math.round(v * 1e6) / 1e6);
  const truth = when.map((ms, s) => {
    const time = A.MakeTime(new Date(ms));
    const v = eclipticOf(A.GeoMoon(time));
    return [v[0] + 1.396971 * times[s], v[1], v[2] * 149597870.7];
  });
  const base = times.map((t) => C.moonBase(moonRow, t));
  const basis = basisFor(moonCandidates(), (t) => C.moonArgs(moonRow, t), times, [0, 1], [0, 1, 2, 3, 4]);
  const terms = [];
  [[times.map((_, s) => near(truth[s][0] - base[s][0])), 12 / 3600, 1 / ANGLE_UNIT, 110], [times.map((_, s) => truth[s][1] - base[s][1]), 8 / 3600, 1 / ANGLE_UNIT, 50], [times.map((_, s) => truth[s][2] - base[s][2]), 20, 1 / MOON_UNIT, 30]].forEach(([residual, target, scale, limit], channel) => {
    for (const term of pursue(residual, basis, target, limit, `channel ${channel}`)) terms.push({ ...term, channel, sin: Math.round(term.sin * scale), cos: Math.round(term.cos * scale) });
  });
  pack.terms.push(terms);
}

// ---------------------------------------------------------------- encode
class Writer {
  bytes = [];
  byte(v) { this.bytes.push(v & 255); }
  varint(v) { while (v >= 128) { this.bytes.push((v % 128) + 128); v = Math.floor(v / 128); } this.bytes.push(v); }
  signed(v) { this.varint(v >= 0 ? v * 2 : -v * 2 - 1); }
  section(tag, part) { this.byte(tag); this.varint(part.bytes.length); this.bytes.push(...part.bytes); }
}
const out = new Writer();
out.byte(0x4b); out.byte(0x53); out.byte(VERSION);
const scaled = (values) => { const w = new Writer(); for (const v of values) w.signed(Math.round(v * 1e8)); return w; };
out.section(1, scaled(IDS.flatMap((id) => ELEMENTS[id])));
out.section(2, scaled(["jupiter", "saturn", "uranus", "neptune"].flatMap((id) => GIANTS[id])));
{ const w = new Writer(); for (const v of MOON) w.signed(Math.round(v * 1e6)); out.section(3, w); }
{
  const w = new Writer();
  for (const terms of pack.terms) {
    w.varint(terms.length);
    for (const term of terms) {
      w.byte((term.multiples.length << 5) | (term.power << 2) | term.channel);
      for (const [arg, k] of term.multiples) { w.byte(arg); w.signed(k); }
      w.signed(term.sin); w.signed(term.cos);
    }
  }
  out.section(4, w);
}
// Stars, by magnitude class, then the zodiac as indices into them.
const stars = JSON.parse(readFileSync(path.join(sources, "stars.6.json"))).features.map((f) => ({ ra: (f.geometry.coordinates[0] + 360) % 360, dec: f.geometry.coordinates[1], mag: f.properties.mag }));
const figures = JSON.parse(readFileSync(path.join(sources, "constellations.lines.json"))).features;
const closest = (ra, dec) => { ra = (ra + 360) % 360; let best = null; let score = 1e9; for (const s of stars) { const d = Math.hypot(near(s.ra - ra) * Math.cos(dec * RAD), s.dec - dec); if (d < score) { score = d; best = s; } } return best; };
const used = new Set();
const polylines = ["Ari", "Tau", "Gem", "Cnc", "Leo", "Vir", "Lib", "Sco", "Sgr", "Cap", "Aqr", "Psc"].map((id) => figures.find((f) => f.id === id).geometry.coordinates.map((line) => line.map(([ra, dec]) => { const s = closest(ra, dec); used.add(s); return s; })));
const classOf = (s) => Math.min(6, Math.max(-1, Math.round(s.mag)));
const list = stars.filter((s) => s.mag <= 3.75 || used.has(s)).sort((a, b) => classOf(a) - classOf(b) || a.ra - b.ra);
const position = new Map(list.map((s, i) => [s, i]));
{
  const w = new Writer();
  for (let magnitude = -1; magnitude <= 6; magnitude += 1) {
    const group = list.filter((s) => classOf(s) === magnitude);
    w.varint(group.length);
    for (const s of group) { const n = (Math.round(s.ra / 360 * 2047) << 10) | Math.round((s.dec + 90) / 180 * 1023); w.byte(n >> 16); w.byte(n >> 8); w.byte(n); }
  }
  out.section(5, w);
}
{
  const w = new Writer();
  for (const lines of polylines) { w.varint(lines.length); for (const line of lines) { w.varint(line.length); for (const s of line) w.varint(position.get(s)); } }
  out.section(6, w);
}
{ const w = new Writer(); for (const v of SHOWERS) w.signed(Math.round(v * 100)); out.section(7, w); }

const bytes = Uint8Array.from(out.bytes);
mkdirSync(path.join(here, "../data"), { recursive: true });
writeFileSync(path.join(here, "../data/sky.pack"), bytes);
console.error(`sky.pack v${VERSION}: ${bytes.length} bytes, ${pack.terms.map((t) => t.length).join("+")} terms, ${list.length} stars`);

/**
 * Skinned meshes for keel/lit (see the README). keel/lit is passed in, as
 * sdf-body takes it, so this module imports nothing.
 */

type Vec = readonly [number, number, number];

/** A mesh at rest, as a generator hands it over. */
export interface SkinMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Each vertex's index into `roles`. */
  readonly role: Uint8Array;
  readonly roles: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  /** Two bones a vertex, and the first's weight. */
  readonly bones: Uint8Array;
  readonly weight: Float32Array;
  /** What each vertex is: 0 skin, 1 cotton, 2 denim, 3 hair, 4 knit, 5 leather, 6 fur, 7 wool, 8 satin, 9 latex, 10 nylon, 11 quilted nylon, 12 tartan, 13 pinstripe, 14 corduroy. */
  readonly fabric: Uint8Array;
  /** How free of the body it hangs, 0 to 1. */
  readonly loose: Float32Array;
  /** Four a vertex: where it lies round its limb (two numbers, off the limb's line), how far along the limb in metres, and how far from its garment's edge, under nought where a cut has taken it away. */
  readonly cloth: Float32Array;
  /** How open each vertex lies to the light, 0 to 1. */
  readonly shade: Float32Array;
  /** How much soft flesh rides on it, 0 to 1. */
  readonly soft: Float32Array;
  readonly index: Uint32Array;
  /** Where the face lies at rest, if it has one. */
  readonly face?: SkinFace;
}

export interface SkinFace {
  readonly eyes: readonly [Vec, Vec];
  readonly eye: number;
  readonly mouth: Vec;
  readonly mouthWide: number;
  readonly head: number;
  readonly iris?: string;
  readonly white?: string;
  readonly lash?: string;
  readonly lip?: string;
  readonly brow?: string;
}

/** What a face is doing this frame. */
export interface FaceState {
  /** How far the upper lid is down, 0 to 1. */
  readonly lid: number;
  /** Where the irises have turned, right and up, shares of the eye. */
  readonly look: readonly [number, number];
  /** How far the mouth is open, 0 to 1. */
  readonly mouth: number;
  /** How far its corners are up, -1 to 1. */
  readonly smile: number;
}

/** How far what hangs free has been left behind, and the time. */
export type Sway = readonly [number, number, number, number];

export interface SkinLight {
  readonly sun: Vec;
  readonly sunColor: Vec;
  readonly fill?: Vec;
  readonly fillColor?: Vec;
  readonly sky: Vec;
  readonly ground: Vec;
  readonly rim?: Vec;
  readonly rimColor?: Vec;
  readonly front?: Vec;
}

export interface SkinOne {
  /** `bones` is three rows of four for each bone. */
  pose(bones: Float32Array, at: Vec, yaw: number, face?: FaceState, sway?: Sway, jiggle?: Vec): void;
  remove(): void;
}

export interface SkinBodies {
  readonly group: unknown;
  add(mesh: SkinMesh): SkinOne;
  light(light: SkinLight): void;
}

const MOST_BONES = 26;

const SKIN = /* glsl */ `
#define ROWS ${String(MOST_BONES * 3)}
uniform vec4 uBones[ROWS];
attribute vec2 aBones;
attribute float aWeight;
attribute float aLoose;
attribute float aSoft;
uniform vec4 uSway;
uniform vec3 uJiggle;  // how far soft flesh has been left behind
vec3 boned(int b, vec4 v) { return vec3(dot(uBones[b * 3], v), dot(uBones[b * 3 + 1], v), dot(uBones[b * 3 + 2], v)); }
vec3 skinned(vec4 v) { return boned(int(aBones.x + 0.5), v) * aWeight + boned(int(aBones.y + 0.5), v) * (1.0 - aWeight); }
// What hangs from the body trails it, more toward its free edge, a ripple running down through it.
vec3 hung(vec3 at) {
  float free = aLoose * aLoose;
  return at + uJiggle * aSoft + (uSway.xyz + vec3(sin(uSway.w * 3.1 + position.y * 7.0 + position.x * 5.0), 0.0, cos(uSway.w * 2.3 + position.y * 6.0)) * 0.012) * free;
}
`;

const VERTEX = /* glsl */ `${SKIN}
attribute vec3 aColor;
attribute float aFabric;
attribute vec4 aCloth;
attribute float aShade;
varying float vShade;
varying vec3 vColor;
varying vec4 vCloth;
varying vec2 vHang;  // how free it hangs, and how crowded a bent joint has left it
varying vec3 vWorld;
varying float vFabric;
varying vec3 vRest;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 at = hung(skinned(vec4(position, 1.0)));
  // (Cloth crowds where its two bones have closed on each other: most between them, none where one has it alone.)
  vec3 up = vec3(0.0, 1.0, 0.0), side = vec3(1.0, 0.0, 0.0);
  float closed = 2.0 - dot(boned(int(aBones.x + 0.5), vec4(up, 0.0)), boned(int(aBones.y + 0.5), vec4(up, 0.0))) - dot(boned(int(aBones.x + 0.5), vec4(side, 0.0)), boned(int(aBones.y + 0.5), vec4(side, 0.0)));
  vHang = vec2(aLoose, clamp(closed * 0.9, 0.0, 1.0) * 4.0 * aWeight * (1.0 - aWeight));
  // (Hair carries the way it runs, turned with its bone like a normal.)
  vCloth = abs(aFabric - 3.0) < 0.5 && dot(aCloth.xyz, aCloth.xyz) > 0.25 ? vec4(mat3(modelMatrix) * skinned(vec4(aCloth.xyz, 0.0)), aCloth.w) : aCloth;
  vShade = aShade;
  vec4 world = modelMatrix * vec4(at, 1.0);
  vNormal = normalize(mat3(modelMatrix) * skinned(vec4(normal, 0.0)));
  vColor = aColor;
  vFabric = aFabric;
  vRest = position;
  vWorld = world.xyz;
  vView = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
#define INV_PI 0.31830989
varying vec3 vColor;
varying float vFabric;
varying vec3 vRest;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
varying vec4 vCloth;
varying vec2 vHang;
varying float vShade;
uniform vec3 uSun, uSunCol, uFill, uFillCol, uSky, uGround, uRim, uRimCol, uFront;
uniform vec4 uEyeL, uEyeR;     // each eye at rest, and its size
uniform vec4 uMouth;           // the mouth at rest, and its half width
uniform vec4 uFace;            // the lid, the look, how open the mouth is
uniform float uSmile, uHead, uHasFace;
uniform vec3 uIris, uWhite, uLash, uLip, uBrow;

// An eye: an almond between two lids, the upper arched and lashed, the lower flatter, the white
// shaded under the lid and pink at its inner corner, the iris dark at its rim round a black pupil.
vec3 eye(vec3 col, vec2 q, float inner) {
  float socket = length(vec2(q.x / 1.75, (q.y - 0.1) / 1.35));
  col *= 1.0 - 0.24 * (1.0 - smoothstep(0.6, 1.5, socket));
  q.x *= 0.82;
  float x = q.x, y = q.y, w = 1.36;
  float m = x * inner / w;
  float k = clamp(1.0 - x * x / (w * w), 0.0, 1.0);
  float top = mix(-0.38, 0.74, 1.0 - uFace.x) * pow(k, 0.5) * (1.0 + 0.2 * m);
  float low = -0.38 * pow(k, 0.6) * (1.0 - 0.26 * m);
  if (y > top + 0.3 && y < top + 0.36 && abs(x) < w) return col * 0.8;
  if (abs(x) > w || y < low) return col;
  if (y > top + 0.13 * sqrt(k)) return col;
  if (y > top) return mix(uLash, col, 0.12);
  vec3 c = uWhite * 0.74 * (1.0 - 0.4 * x * x / (w * w)) * mix(0.55, 1.0, smoothstep(0.0, 0.45, top - y));
  c = mix(c, vec3(0.78, 0.45, 0.42), smoothstep(0.6, 0.98, x * inner / w) * 0.7);
  vec2 g = vec2(x / 0.82, y - 0.14) - uFace.yz;
  float ring = length(g) / 0.62;
  if (ring < 1.0) {
    c = uIris * mix(1.3, 0.62, ring) * mix(0.6, 1.0, smoothstep(0.0, 0.36, top - y));
    c *= 1.0 - 0.75 * smoothstep(0.8, 0.98, ring);
    c = mix(vec3(0.008), c, smoothstep(0.36, 0.44, ring));
    c = mix(c, vec3(1.0), 1.0 - smoothstep(0.1, 0.16, length(g - vec2(-0.2, 0.24))));
  }
  return c;
}

// A brow, a tapered bar over the eye.
vec3 brow(vec3 col, vec2 q, float outer) {
  q.y -= 2.4 + uFace.x * -0.1;
  float x = q.x * outer;
  float h = 0.2 * (1.0 - smoothstep(0.2, 1.4, x)) + 0.1;
  float line = 0.14 * x;
  return abs(q.y + line) < h && x > -1.1 && x < 1.5 ? mix(col, uBrow, 0.88) : col;
}

// A mouth: a line that opens on the dark, its corners lifting with a smile, a full lower lip under it.
vec3 mouth(vec3 col, vec2 q) {
  float x = q.x, k = clamp(1.0 - x * x, 0.0, 1.0);
  if (abs(x) > 1.0) return col;
  float y = q.y - uSmile * 0.34 * x * x;
  float open = uFace.w * 0.5 * pow(k, 0.5);
  float line = 0.07;
  if (y < line * 0.5 && y > -line * 0.5 - open) return mix(vec3(0.09, 0.03, 0.03), col, 0.08);
  float low = y + line * 0.5 + open;
  if (low < 0.0 && low > -0.36 * pow(k, 0.7)) return mix(col, uLip, 0.72) * (0.9 + 0.2 * smoothstep(-0.36, -0.1, low));
  float up = y - line * 0.5;
  if (up > 0.0 && up < 0.22 * pow(k, 0.7) * (1.0 - 0.3 * exp(-x * x * 40.0))) return mix(col, uLip, 0.62) * 0.92;
  return col;
}

vec3 painted(vec3 col) {
  if (uHasFace < 0.5 || (vFabric > 0.5 && abs(vFabric - 6.0) > 0.5) || vRest.y < uMouth.y - uHead * 0.5 || vRest.z < uEyeL.z - uHead * 0.9) return col;
  vec2 l = (vRest.xy - uEyeL.xy) / uEyeL.w, r = (vRest.xy - uEyeR.xy) / uEyeR.w;
  col = brow(eye(col, l, 1.0), l, -1.0);
  col = brow(eye(col, r, -1.0), r, 1.0);
  return mouth(col, (vRest.xy - uMouth.xy) / uMouth.w);
}

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f *= f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 0.0)), b = hash(vec3(i + vec2(1.0, 0.0), 0.0)), c = hash(vec3(i + vec2(0.0, 1.0), 0.0)), d = hash(vec3(i + vec2(1.0, 1.0), 0.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// A train of pulses, each duty of its period 1, averaged over what a pixel covers: past the thread it is its own mean, and never shimmers.
float pulse(float x, float duty, float w) {
  w = max(w, 1e-4);
  float a = x - 0.5 * w, b = x + 0.5 * w;
  return (floor(b) * duty + min(fract(b), duty) - floor(a) * duty - min(fract(a), duty)) / w;
}

// One stuff: how deep it folds, its fuzz and how soft that is, how far light wraps round it; how glossy, how tight the gloss, how plain its hems are.
void stuffOf(float id, out vec4 s, out vec3 g) {
  s = vec4(1.0, 0.35, 0.5, 0.3); g = vec3(0.0, 1.0, 1.0);
  if (id < 2.5 && id > 1.5) { s = vec4(0.7, 0.2, 0.6, 0.2); }
  else if (id < 4.5 && id > 3.5) { s = vec4(0.7, 0.6, 0.75, 0.45); }
  else if (id < 5.5 && id > 4.5) { s = vec4(0.45, 0.14, 0.35, 0.12); g = vec3(0.16, 24.0, 0.4); }
  else if (id < 7.5 && id > 6.5) { s = vec4(0.6, 0.7, 0.8, 0.4); }
  else if (id < 8.5 && id > 7.5) { s = vec4(0.5, 0.3, 0.3, 0.25); g = vec3(0.14, 12.0, 0.8); }
  else if (id < 9.5 && id > 8.5) { s = vec4(0.28, 0.0, 0.3, 0.05); g = vec3(1.0, 130.0, 0.0); }
  else if (id < 11.5 && id > 9.5) { s = vec4(0.7, 0.1, 0.3, 0.15); g = vec3(0.14, 30.0, 0.6); }
  else if (id > 13.5) { s = vec4(0.65, 0.75, 0.7, 0.4); }
  else if (id > 12.5) { s = vec4(0.6, 0.7, 0.8, 0.4); }
}

// A ridge running across the phase ph, turning d its way: its height in z, its slope, round and along, in xy.
void ridge(inout vec3 f, float ph, vec2 d, float amp) { f += vec3(normalize(d) * cos(ph) * amp, sin(ph) * amp); }

// How cloth has fallen here, in slopes worked out by hand, so nothing is sampled. Everything round a limb goes a whole number of times, so it meets itself at the back.
vec3 folds(float a, float v, float depth, float id) {
  vec3 f = vec3(0.0);
  float loose = vHang.x * vHang.x, crush = vHang.y, edge = vCloth.w;
  // (Slow diagonals, that sag between what holds them.)
  float w = sin(2.0 * a - v * 3.0);
  ridge(f, 3.0 * a + v * 7.0 + 1.4 * w, vec2(3.0 + 2.8 * cos(2.0 * a - v * 3.0), 7.0 - 4.2 * cos(2.0 * a - v * 3.0)) / 0.13, 0.17 * depth);
  ridge(f, 5.0 * a - v * 11.0 + 2.0 * sin(3.0 * a), vec2(5.0 + 6.0 * cos(3.0 * a), -11.0 * 0.13), 0.11 * depth);
  // (What hangs falls in pipes, deeper toward its hem.)
  if (loose > 0.01) ridge(f, 9.0 * a + 1.4 * sin(4.0 * a), vec2(9.0 + 5.6 * cos(4.0 * a), 0.0), 0.62 * loose * depth);
  // (A bent joint crowds the cloth into ridges across the limb, that fork as they go round it.)
  if (crush > 0.01) ridge(f, v * 95.0 + 2.2 * sin(2.0 * a) + 1.1 * sin(5.0 * a), vec2((4.4 * cos(2.0 * a) + 5.5 * cos(5.0 * a)) / 0.13, 95.0), 0.16 * crush * (1.0 - loose) * depth);
  // (Slack stacks at a hem.)
  float slack = 1.0 - smoothstep(0.0, 0.07, edge);
  if (slack > 0.01) ridge(f, v * 90.0 + 2.0 * sin(3.0 * a), vec2(6.0 * cos(3.0 * a) / 0.13, 90.0), 0.22 * slack * depth);
  // (Quilting puffs between its stitched channels.)
  if (id > 10.5 && id < 11.5) f += vec3(0.0, cos(v * 42.0) * sign(sin(v * 42.0)) * 0.5, abs(sin(v * 42.0)) - 0.6);
  return f;
}

// The stuff's own face, in metres of cloth: thread where it can be seen, its mean where it cannot.
vec3 woven(vec3 col, float id, float u, float v, float px) {
  if (id < 1.5) return col * (0.95 + 0.1 * noise(vec2(u * 90.0, v * 14.0)));
  if (id < 2.5) { // A twill: blue warp over pale weft, the diagonal rising to the right, and faded where the leg wears it.
    float d = (u + v) / 0.006;
    return mix(mix(vec3(0.72, 0.7, 0.64), col, 0.72), col, pulse(d, 0.75, px * 2.0 / 0.006)) * (0.92 + 0.16 * noise(vec2(u * 26.0, v * 7.0)));
  }
  if (id < 4.5) { // Stitches in rows, a rib of them.
    float r = pulse(u / 0.014, 0.5, px / 0.014), st = pulse(v / 0.006 + 0.5 * abs(2.0 * fract(u / 0.007) - 1.0), 0.5, px / 0.006);
    return col * (0.82 + 0.16 * r + 0.14 * st);
  }
  if (id < 5.5) return col * (0.92 + 0.14 * noise(vec2(u, v) * 240.0));
  if (id < 7.5) return col * (0.86 + 0.26 * noise(vec2(u, v) * 90.0) * (0.6 + 0.8 * noise(vec2(u, v) * 13.0)));
  if (id < 11.5) return col;
  if (id < 12.5) { // A tartan: dark bands across dark bands, and a thin pale line through them.
    float x = u / 0.11, y = v / 0.11, f = px / 0.11;
    float bands = pulse(x, 0.36, f) * 0.5 + pulse(y, 0.36, f) * 0.5;
    vec3 c = mix(col, col * 0.34 + vec3(0.005, 0.008, 0.016), bands);
    return mix(c, mix(col, vec3(0.9, 0.84, 0.66), 0.7), (pulse(x + 0.6, 0.07, f) + pulse(y + 0.6, 0.07, f)) * 0.6);
  }
  if (id < 13.5) { // Wool with a fine pale stripe, and it is the stripe that shows from far off, as a slight lift.
    vec3 c = col * (0.9 + 0.2 * noise(vec2(u, v) * 90.0));
    return mix(c, c * 1.5 + vec3(0.09), pulse(u / 0.024, 0.09, px / 0.024));
  }
  return col * (0.72 + 0.46 * pulse(u / 0.008, 0.55, px / 0.008));  // Wales of corduroy, down the leg.
}

// How a garment is made, at its edges: a turned hem, a line of stitches inside it, a ribbed cuff on a knit.
vec3 made(vec3 col, float id, float strength, float a, float u, float v) {
  float edge = vCloth.w, px = max(fwidth(edge), 1e-4);
  if (edge >= 0.05) return col;
  if (id > 3.5 && id < 4.5) col *= 1.0 - 0.3 * (1.0 - smoothstep(0.032, 0.04, edge)) * (1.0 - pulse(a * 13.0, 0.5, fwidth(u) / 0.02));
  col *= 1.0 - 0.42 * strength * (1.0 - smoothstep(0.0, max(0.005, px * 1.5), edge));
  float line = pulse(edge / 0.05 - 0.32, 0.05, px / 0.05) * pulse((u + v) / 0.007, 0.55, fwidth(v) / 0.007);
  return mix(col, id > 1.5 && id < 2.5 ? vec3(0.62, 0.4, 0.14) : col * 0.66, line * 0.85 * strength);
}

// A fuzz of fibres standing off the cloth: it lights up at grazing angles, where a plain surface goes dark.
float charlie(float nh, float rough) { float inv = 1.0 / rough; return (2.0 + inv) * pow(max(1.0 - nh * nh, 1e-4), inv * 0.5) * 0.15915; }
float neubelt(float nl, float nv) { return 0.25 / max(nl + nv - nl * nv, 1e-3); }

// A cloth under this scene's lights.
vec3 clothLit(vec3 base, vec3 n, vec3 rd, vec4 s, vec3 g) {
  float nl = dot(n, uSun), nv = clamp(dot(n, -rd), 1e-3, 1.0);
  vec3 h = normalize(uSun - rd);
  float nh = max(dot(n, h), 0.0);
  float wrap = max((nl + s.w) / (1.0 + s.w), 0.0);
  vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
  vec3 light = (hemi + uSunCol * wrap + uFillCol * max(dot(n, uFill), 0.0)) * INV_PI + uFront * INV_PI * 0.6 * max(nv * 0.75 + 0.25 * n.y, 0.0);
  light += uRimCol * pow(1.0 - nv, 3.0) * max(dot(n, uRim), 0.0) * INV_PI * 2.0;
  vec3 col = base * light;
  vec3 tint = mix(base, vec3(dot(base, vec3(0.3, 0.6, 0.1)) + 0.2), 0.5);
  col += tint * s.y * (uSunCol * charlie(nh, s.z) * neubelt(max(nl, 0.0), nv) * max(nl, 0.0) * 0.5 + uSky * INV_PI * (0.6 * pow(1.0 - nv, 1.9) + 0.09));
  if (g.x > 0.0) {
    vec3 r = reflect(rd, n);
    float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
    vec3 sky = mix(uGround, uSky, 0.5 + 0.5 * r.y) * INV_PI * (1.0 + 3.0 * g.x * smoothstep(0.25, 0.75, r.y));
    col += g.x * (sky * (fres + 0.05) + uSunCol * pow(nh, g.y) * smoothstep(-0.1, 0.2, nl) * 0.5);
  }
  return col;
}

vec3 cloth(vec3 n, vec3 rd) {
  vec4 s; vec3 g;
  float id = vFabric, v = vCloth.z, a = atan(vCloth.y, vCloth.x);
  // (Wales and ribs run true down a limb; a pattern keeps its size round whatever it is on.)
  float u = a * (id > 13.5 || (id > 3.5 && id < 4.5) ? 0.1 : max(length(vCloth.xy), 0.02));
  float px = max(length(vec2(dFdx(v), dFdy(v))), min(fwidth(u), 0.04));
  stuffOf(id, s, g);
  // (The way along the cloth, from how the surface changes under the pixel: no tangent to store, or to skin.)
  vec3 dx = dFdx(vWorld), dy = dFdy(vWorld), r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 down = (dFdx(v) * r1 + dFdy(v) * r2) * sign(det);
  vec3 t = dot(down, down) > 1e-20 ? normalize(down) : vec3(0.0, 1.0, 0.0), b = cross(n, t);
  vec3 f = folds(a, v, s.x, id);
  vec3 turned = normalize(n - (b * f.x + t * f.y));
  vec3 col = made(woven(max(vColor, vec3(0.018)), id, u, v, px), id, g.z, a, u, v);
  // (Valleys are darker, which is what still reads when a person is small; worn ridges paler.)
  float depth = clamp(f.z, -1.0, 1.0);
  col *= 1.0 - 0.22 * smoothstep(0.08, 0.8, -depth) * (id > 8.5 && id < 9.5 ? 0.3 : 1.0);
  if (id > 1.5 && id < 2.5) col = mix(col, col * 1.5 + vec3(0.05), smoothstep(0.25, 0.8, depth) * (0.25 + 0.5 * vHang.y));
  if (id > 10.5 && id < 11.5) col *= 0.45 + 0.55 * smoothstep(0.0, 0.2, abs(sin(v * 42.0)));
  return clothLit(col, turned, rd, s, g);
}

// What is not cloth has a look of its own, in the colour.
vec3 thread(vec3 col, vec3 p, float fabric) {
  if (fabric > 5.5) return col * (0.84 + 0.26 * sin(p.x * 700.0 + sin(p.y * 90.0) * 3.0) * sin(p.z * 700.0 + p.y * 160.0));
  return col;
}

// Hair: lit along its strands, not across them, so its highlight is a band round the head; strand by strand, each its own shade, and past what a pixel can see, their mean.
vec3 hairLit(vec3 col, vec3 n, vec3 rd, vec3 light) {
  bool run = dot(vCloth.xyz, vCloth.xyz) > 0.25;
  vec3 t = run ? normalize(vCloth.xyz) : vec3(0.0, -1.0, 0.0);
  t = normalize(t - n * dot(t, n) + vec3(0.0, -1e-3, 0.0));
  float w = run ? vCloth.w * 90.0 : (vRest.x + vRest.z) * 600.0 + sin(vRest.y * 30.0) * 3.0;
  float strand = mix(hash(vec3(floor(w), 0.0, 0.0)), 0.5, smoothstep(0.35, 1.0, fwidth(w)));
  vec3 h = normalize(uSun - rd);
  float tilt = (strand - 0.5) * 0.14;
  float one = dot(normalize(t + n * (tilt - 0.08)), h), two = dot(normalize(t + n * (tilt + 0.1)), h);
  float near = pow(max(1.0 - one * one, 0.0), 70.0), far = pow(max(1.0 - two * two, 0.0), 22.0);
  float lit = smoothstep(-0.2, 0.3, dot(n, uSun));
  vec3 base = painted(col) * (0.74 + 0.52 * strand) * light;
  return base + uSunCol * INV_PI * lit * (near * 0.5 + far * 0.3) * (col + vec3(0.03));
}

void main() {
  vec3 n = normalize(vNormal), rd = -normalize(vView);
  bool isCloth = vFabric > 0.5 && abs(vFabric - 3.0) > 0.5 && abs(vFabric - 6.0) > 0.5;
  vec3 col;
  if (isCloth) {
    if (vCloth.w < 0.0) discard;  // (A cut through a garment: its line, drawn sharper than the mesh.)
    col = cloth(dot(n, rd) > 0.0 ? -n : n, rd);
  } else {
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    float facing = max(dot(n, -rd), 0.0);
    float rim = pow(1.0 - facing, 3.0);
    vec3 light = hemi + uSunCol * max(dot(n, uSun) * 0.8 + 0.2, 0.0) + uFillCol * max(dot(n, uFill), 0.0);
    light = light * INV_PI + uRimCol * rim * max(dot(n, uRim), 0.0) * INV_PI * 2.0;
    light += uFront * INV_PI * 0.6 * max(facing * 0.75 + 0.25 * n.y, 0.0);
    light += uSky * INV_PI * 0.6 * rim + uFront * INV_PI * 0.3;
    col = abs(vFabric - 3.0) < 0.5 ? hairLit(vColor, n, rd, light) : painted(thread(vColor, vRest, vFabric)) * light;
  }
  // (Light falls from above: what faces down goes into shade, and creases are shut off from it, whatever lights the front.)
  col *= vShade * mix(vFabric < 0.5 ? 0.82 : 0.58, 1.0, smoothstep(-0.75, 0.4, n.y));
  // (A highlight rolls off as a whole, keeping its hue, and a colour never runs to neon.)
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, vFabric < 0.5 ? 0.9 : 0.86);
  float peak = max(max(col.r, col.g), col.b);
  if (peak > 0.7) col *= (0.7 + 0.3 * (1.0 - exp(-(peak - 0.7) * 3.0))) / peak;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DEPTH_VERTEX = /* glsl */ `${SKIN}
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(hung(skinned(vec4(position, 1.0))), 1.0); }`;
const DEPTH_FRAGMENT = /* glsl */ `
#include <packing>
void main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`;

interface LitV4 { set(x: number, y: number, z: number, w: number): unknown }
interface LitColor { r: number; g: number; b: number; set(value: string): LitColor }
interface LitNode { add(...nodes: unknown[]): void; remove(...nodes: unknown[]): void; position: { set(x: number, y: number, z: number): void }; rotation: { y: number }; frustumCulled: boolean; castShadow: boolean; customDepthMaterial: unknown }
interface Uniform<T = unknown> { value: T }
interface LitGeometry { setAttribute(name: string, attribute: unknown): void; setIndex(attribute: unknown): void; dispose(): void }
interface Disposable { dispose(): void }

/** What this module uses of keel/lit. */
export interface SkinLit {
  readonly Group: new () => LitNode;
  readonly Mesh: new (geometry: LitGeometry, material: unknown) => LitNode;
  readonly Geometry: new () => LitGeometry;
  readonly Attribute: new (array: Float32Array | Uint32Array, size: number) => unknown;
  readonly DoubleSide: number;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => Disposable;
  readonly Vector3: new (x?: number, y?: number, z?: number) => unknown;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => LitV4;
  readonly Color: new (value?: string) => LitColor;
}

const linear = (lit: SkinLit, hex: string): LitColor => new lit.Color(hex);

function colours(lit: SkinLit, mesh: SkinMesh): Float32Array {
  const table = mesh.roles.map((role) => linear(lit, mesh.palette[role] ?? "#808080"));
  const out = new Float32Array(mesh.role.length * 3);
  mesh.role.forEach((role, i) => {
    const c = table[role];
    if (c) out.set([c.r, c.g, c.b], i * 3);
  });
  return out;
}

function geometryOf(lit: SkinLit, mesh: SkinMesh): LitGeometry {
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(mesh.position, 3));
  geometry.setAttribute("normal", new lit.Attribute(mesh.normal, 3));
  geometry.setAttribute("aColor", new lit.Attribute(colours(lit, mesh), 3));
  geometry.setAttribute("aBones", new lit.Attribute(Float32Array.from(mesh.bones), 2));
  geometry.setAttribute("aWeight", new lit.Attribute(mesh.weight, 1));
  geometry.setAttribute("aFabric", new lit.Attribute(Float32Array.from(mesh.fabric), 1));
  geometry.setAttribute("aLoose", new lit.Attribute(mesh.loose, 1));
  geometry.setAttribute("aCloth", new lit.Attribute(mesh.cloth, 4));
  geometry.setAttribute("aShade", new lit.Attribute(mesh.shade, 1));
  geometry.setAttribute("aSoft", new lit.Attribute(mesh.soft, 1));
  geometry.setIndex(new lit.Attribute(mesh.index, 1));
  return geometry;
}

const LIGHTS = ["uSun", "uSunCol", "uFill", "uFillCol", "uSky", "uGround", "uRim", "uRimCol", "uFront"] as const;

const NO_FACE: SkinFace = { eyes: [[0, 0, 0], [0, 0, 0]], eye: 1, mouth: [0, 0, 0], mouthWide: 1, head: 1 };

function faceUniforms(lit: SkinLit, given: SkinFace | undefined): Record<string, Uniform> {
  const face = given ?? NO_FACE;
  const v4 = (at: Vec, w: number): Uniform => ({ value: new lit.Vector4(at[0], at[1], at[2], w) });
  const tone = (hex: string | undefined, fallback: string): Uniform => ({ value: linear(lit, hex ?? fallback) });
  return {
    uEyeL: v4(face.eyes[0], face.eye),
    uEyeR: v4(face.eyes[1], face.eye),
    uMouth: v4(face.mouth, face.mouthWide),
    uFace: { value: new lit.Vector4(0, 0, 0, 0) },
    uSmile: { value: 0 },
    uHead: { value: face.head },
    uHasFace: { value: given ? 1 : 0 },
    uIris: tone(face.iris, "#5a3a22"),
    uWhite: tone(face.white, "#ece6dc"),
    uLash: tone(face.lash, "#2a1a16"),
    uLip: tone(face.lip, "#a85a52"),
    uBrow: tone(face.brow, "#3a2a22"),
  };
}

export function createSkinBodies(lit: SkinLit): SkinBodies {
  const group = new lit.Group();
  const lights: Record<string, Uniform> = Object.fromEntries(LIGHTS.map((name) => [name, { value: new lit.Vector3() }]));
  const bonesUniform = (): Uniform<LitV4[]> => ({ value: Array.from({ length: MOST_BONES * 3 }, () => new lit.Vector4()) });
  const bonesInto = (slot: Uniform<LitV4[]>, bones: Float32Array): void => {
    slot.value.forEach((row, i) => { if (i * 4 < bones.length) row.set(bones[i * 4] ?? 0, bones[i * 4 + 1] ?? 0, bones[i * 4 + 2] ?? 0, bones[i * 4 + 3] ?? 0); });
  };
  return {
    group,
    add(mesh) {
      const geometry = geometryOf(lit, mesh);
      const uBones = bonesUniform();
      const uSway: Uniform = { value: new lit.Vector4() };
      const uJiggle: Uniform = { value: new lit.Vector3() };
      const uniforms: Record<string, Uniform> = { uBones, uSway, uJiggle, ...lights, ...faceUniforms(lit, mesh.face) };
      const material = new lit.CustomMaterial({ side: lit.DoubleSide, uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT });
      const depth = new lit.CustomMaterial({ uniforms: { uBones, uSway, uJiggle }, vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT });
      const node = new lit.Mesh(geometry, material);
      node.frustumCulled = false;
      node.castShadow = true;
      node.customDepthMaterial = depth;
      group.add(node);
      return {
        pose(bones, at, yaw, face, sway = [0, 0, 0, 0], jiggle = [0, 0, 0]) {
          bonesInto(uBones, bones);
          (uSway.value as LitV4).set(...sway);
          (uJiggle.value as { set(x: number, y: number, z: number): void }).set(...jiggle);
          node.position.set(at[0], at[1], at[2]);
          node.rotation.y = yaw;
          if (!face) return;
          (uniforms.uFace?.value as LitV4).set(face.lid, face.look[0], face.look[1], face.mouth);
          if (uniforms.uSmile) uniforms.uSmile.value = face.smile;
        },
        remove() {
          group.remove(node);
          geometry.dispose();
          material.dispose();
          depth.dispose();
        },
      };
    },
    light(light) {
      const set = (name: string, v: Vec | undefined): void => { (lights[name]?.value as { set(x: number, y: number, z: number): void } | undefined)?.set(...(v ?? ([0, 0, 0] as const))); };
      set("uSun", light.sun); set("uSunCol", light.sunColor); set("uFill", light.fill ?? [0, 1, 0]); set("uFillCol", light.fillColor);
      set("uSky", light.sky); set("uGround", light.ground); set("uRim", light.rim ?? [0, 1, 0]); set("uRimCol", light.rimColor); set("uFront", light.front);
    },
  };
}

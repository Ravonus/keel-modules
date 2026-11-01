// The shader: the screens, the dithered fragment pass and the blit.

// ---------------------------------------------------------------- shader

const SCREEN_GLSL = /* glsl */ `
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float tri(float v, float p) { return abs(fract(v / p) * 2.0 - 1.0); }
float halftone(vec2 a) {
  vec2 f = fract(vec2(a.x + a.y + 1.0, a.x - a.y) * 0.1767767) - 0.5;
  return min(0.999, length(f) * 1.41421356);
}
float stipple(vec2 a) {
  uint h = (uint(a.x) * 1973u + uint(a.y) * 9277u) | 1u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h & 0xffffu) / 65536.0;
}
float screenAt(float id, vec2 a) {
  int s = int(id + 0.5);
  if (s == 1) return bayer2(a);
  if (s == 2) return bayer4(a);
  if (s == 3) return bayer8(a);
  if (s == 4) return halftone(a);
  if (s == 5) return tri(a.y + 0.5, 4.0) * 0.7 + bayer4(a) * 0.3;
  if (s == 6) return tri(a.x + a.y + 0.5, 4.0) * 0.7 + bayer4(a) * 0.3;
  if (s == 7) return min(tri(a.x + a.y + 0.5, 4.0), 0.5 + 0.5 * tri(a.x - a.y + 0.5, 4.0)) * 0.75 + bayer4(a) * 0.25;
  if (s == 8) return fract(52.9829189 * fract(0.06711056 * a.x + 0.00583715 * a.y));
  if (s == 9) return stipple(a);
  if (s == 10) return mod(a.x + a.y, 2.0) * 0.5 + 0.25;
  return 0.5;
}
`;

export const VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const FRAGMENT_GLSL = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uGrid;
// The detail parts' own colour and depth, uFine texels to an art pixel's side,
// and (on the detail pass) the world's finished look to fill in around them.
uniform sampler2D tDetail;
uniform sampler2D tDetailDepth;
uniform sampler2D tCoarse;
uniform float uFine;
uniform float uPass;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform vec3 uScreen;
uniform vec3 uScale;
uniform vec3 uAmount;
uniform vec2 uBands;
uniform float uLevels;
uniform float uSnap;
uniform float uLift;
uniform float uClump;
uniform float uRamp;
uniform float uLuma;
uniform int uPaletteSize;
uniform int uAccentSize;
uniform vec3 uAccent[4];
uniform vec3 uAccentLab[4];
uniform float uSkySaturation;
uniform vec3 uPalette[32];
uniform vec3 uPaletteLab[32];
uniform float uOutline;
uniform vec4 uOutlineColor;
uniform float uCrease;
uniform float uContrast;
uniform float uSaturation;
uniform float uSkyFrom;
uniform vec2 uRaySource;
uniform vec3 uRayColor;
uniform float uRayStrength;
uniform float uRayDecay;
uniform float uRayDensity;
uniform float uScanlines;
uniform float uChroma;
uniform float uGlitch;
uniform float uTime;
// Per-part signals: x scanlines, y chroma, z glitch, for the parts tagged 1, 2 and 3.
uniform vec3 uSignal[3];
// Per-part filters: x the filter's number in SIGNAL_FILTERS, y its amount.
uniform vec2 uFilter[3];
${SCREEN_GLSL}
// The pass's cells: art pixels (gF 1), or detail pixels (gF uFine) on the detail pass.
vec2 gGrid;
float gF;
vec2 worldUv(vec2 cell) { return (floor(clamp(cell, vec2(0.0), gGrid - 1.0) / gF) + 0.5) / uGrid; }
vec2 detailUv(vec2 cell) { return (clamp(cell, vec2(0.0), gGrid - 1.0) + 0.5) / gGrid; }
// The world is drawn once per art pixel and the detail parts per detail pixel; a cell shows the nearer.
bool onDetail(vec2 cell) { return gF > 1.5 && texture2D(tDetailDepth, detailUv(cell)).x < texture2D(tDepth, worldUv(cell)).x; }
vec4 colorAt(vec2 cell) { return onDetail(cell) ? texture2D(tDetail, detailUv(cell)) : texture2D(tColor, worldUv(cell)); }
float distanceAt(vec2 cell) {
  float d = texture2D(tDepth, worldUv(cell)).x;
  if (gF > 1.5) d = min(d, texture2D(tDetailDepth, detailUv(cell)).x);
  if (d >= 0.99999) return uFar;
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
// God rays: walk from the pixel toward the light, gathering the open sky the
// walk crosses. Trees and terrain block it, so shafts fall between them. The
// result is added in continuous light and only then stepped, so the shafts
// come out as dithered bands.
vec3 godRays(vec2 cell) {
  if (uRayStrength <= 0.001) return vec3(0.0);
  vec2 uv = (cell + 0.5) / gGrid;
  vec2 step = (uv - uRaySource) * uRayDensity / 40.0;
  vec2 aspect = vec2(gGrid.x / gGrid.y, 1.0);
  vec2 p = uv;
  float weight = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 40; i++) {
    p -= step;
    float open = distanceAt(floor(clamp(p, 0.0, 0.9999) * gGrid)) >= uSkyFrom ? 1.0 : 0.0;
    float near = 0.3 + 0.7 * exp(-3.5 * length((p - uRaySource) * aspect));
    sum += open * near * weight;
    weight *= uRayDecay;
  }
  return uRayColor * (sum / 40.0) * uRayStrength;
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
// One step: the share past the lower tone, squeezed by uSnap so most of it
// snaps flat and only the middle of the step dithers.
float snapStep(float value, float t) {
  float base = floor(value);
  float share = clamp((value - base - 0.5) / max(1.0 - uSnap, 0.001) + 0.5, 0.0, 1.0);
  return base + step(1.0 - t, share);
}
vec3 stepTones(vec3 c, float t) {
  float steps = max(1.0, uLevels - 1.0);
  if (uLuma < 0.5) {
    // Dither between two step colours only, never off-hue confetti.
    vec3 q = floor(c * steps + 0.5);
    vec3 e = c * steps - q;
    vec3 a = abs(e);
    vec3 lean = step(0.5 * max(a.x, max(a.y, a.z)) + 0.001, a);
    float share = dot(a, lean) / max(1.0, dot(lean, vec3(1.0)));
    share = clamp((share - 0.5) / max(1.0 - uSnap, 0.001) + 0.5, 0.0, 1.0);
    return clamp((q + sign(e) * lean * step(1.0 - t, share)) / steps, 0.0, 1.0);
  }
  // YCoCg: lightness gets twice the steps of colour, so shading reads as ramps.
  float y = dot(c, vec3(0.25, 0.5, 0.25));
  float co = 0.5 * (c.r - c.b);
  float cg = -0.25 * c.r + 0.5 * c.g - 0.25 * c.b;
  // Colour dithers gently; warm-cool steps finely, so a pale sky or night navy keeps its hue. Grey stays grey.
  float ys = steps * 2.0;
  float cs = steps * 2.0 + 2.0;
  float tc = 0.5 + (t - 0.5) * 0.35;
  y = snapStep(y * ys, t) / ys;
  co = snapStep(co * cs * 2.0, tc) / (cs * 2.0);
  cg = snapStep(cg * cs, tc) / cs;
  return clamp(vec3(y + co - cg, y + cg, y - co - cg), 0.0, 1.0);
}
// OKLab, so the nearest palette entry is the one that looks nearest.
vec3 okLab(vec3 c) {
  c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  vec3 lms = pow(max(mat3(0.4122, 0.2119, 0.0883, 0.5363, 0.6807, 0.2817, 0.0514, 0.1074, 0.63) * c, 0.0), vec3(1.0 / 3.0));
  return mat3(0.2105, 1.978, 0.0259, 0.7936, -2.4286, 0.7828, -0.0041, 0.4506, -0.8087) * lms;
}
vec3 stepPalette(vec3 c, float t, bool spot, float hueWeight) {
  vec3 best = c; vec3 next = c; vec3 bl = c; vec3 nl = c;
  float bd = 1e9; float nd = 1e9;
  vec3 lab = okLab(c);
  // Spot inks: taken only by a pixel already clearly of the ink's hue, dithering between the inks alone.
  if (spot && uAccentSize > 0 && length(lab.yz) > 0.028) {
    float hue = atan(lab.z, lab.y);
    for (int i = 0; i < 4; i++) {
      if (i >= uAccentSize) break;
      vec3 al = uAccentLab[i];
      if (abs(mod(atan(al.z, al.y) - hue + 3.14159, 6.28318) - 3.14159) > 0.35) continue;
      vec3 e = (al - lab) * vec3(1.0, 1.6, 1.6);
      float d = dot(e, e);
      if (d < bd) { nd = bd; next = best; bd = d; best = uAccent[i]; }
      else if (d < nd) { nd = d; next = uAccent[i]; }
    }
    if (bd < 1e8) return t < sqrt(bd) / max(1e-5, sqrt(bd) + sqrt(nd)) && nd < 1e8 ? next : best;
  }
  for (int i = 0; i < 32; i++) {
    if (i >= uPaletteSize) break;
    // Hue outweighs lightness: a pale sky picks a pale blue, not a grey.
    vec3 e = (uPaletteLab[i] - lab) * vec3(1.0, hueWeight, hueWeight);
    float d = dot(e, e);
    if (d < bd) { nd = bd; next = best; nl = bl; bd = d; best = uPalette[i]; bl = uPaletteLab[i]; }
    else if (d < nd) { nd = d; next = uPalette[i]; nl = uPaletteLab[i]; }
  }
  // Only neighbours on a ramp dither; far-apart entries meet in a clean edge.
  float m = sqrt(bd) / max(1e-5, sqrt(bd) + sqrt(nd)) * clamp(1.6 - 3.0 * length(bl - nl), 0.0, 1.0);
  return t < m ? next : best;
}
float signalHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// The part a pixel belongs to, from the alpha its material wrote (see tagSignal):
// 0 untagged, else 1 to 3.
int partAt(vec2 cell) {
  float a = colorAt(cell).a;
  return a < 0.375 ? 1 : a < 0.625 ? 2 : a < 0.875 ? 3 : 0;
}
vec3 signalOf(int part) {
  vec3 own = part == 1 ? uSignal[0] : part == 2 ? uSignal[1] : part == 3 ? uSignal[2] : vec3(0.0);
  return max(own, vec3(uScanlines, uChroma, uGlitch));
}
// A burst lasts one eighth of a second; each part keeps its own timing, and how
// many of its slots burst grows with its glitch strength.
float burstOf(float strength, float part) {
  if (strength <= 0.0) return 0.0;
  return step(1.0 - strength * 0.16, signalHash(vec2(floor(uTime * 8.0), 1.7 + part * 13.1)));
}
// Where a bursting part reads from: bands of rows slide sideways (carrying the
// part's silhouette out over its neighbours), and one block of the part shows
// what sits above it, so sky tears into it.
vec2 tornCell(vec2 cell, float strength, float part) {
  float slot = floor(uTime * 8.0) + part * 31.0;
  float rows = floor(cell.y / (2.0 + floor(signalHash(vec2(slot, 3.1)) * 6.0)));
  if (signalHash(vec2(rows, slot)) > 1.0 - 0.5 * strength) cell.x += floor((signalHash(vec2(rows, slot + 9.0)) - 0.5) * gGrid.x * 0.12 * strength);
  return clamp(cell, vec2(0.0), gGrid - 1.0);
}
bool inTearBlock(vec2 cell, float part) {
  float slot = floor(uTime * 8.0) + part * 31.0;
  vec2 size = gGrid * vec2(0.12 + 0.2 * signalHash(vec2(slot, 5.0)), 0.02 + 0.035 * signalHash(vec2(slot, 6.0)));
  vec2 origin = vec2(signalHash(vec2(slot, 7.0)), signalHash(vec2(slot, 8.0))) * gGrid;
  return all(greaterThan(cell, origin)) && all(lessThan(cell, origin + size));
}
vec2 glitchCell(vec2 cell, int part) {
  for (int k = 1; k <= 3; k++) {
    float strength = signalOf(k).z;
    if (burstOf(strength, float(k)) < 0.5) continue;
    vec2 source = tornCell(cell, strength, float(k));
    if (part == k && inTearBlock(cell, float(k))) return clamp(source + vec2(0.0, floor(gGrid.y * 0.06)), vec2(0.0), gGrid - 1.0);
    if (part == k || partAt(source) == k) return source;
  }
  return cell;
}
vec2 filterOf(int part) { return part == 1 ? uFilter[0] : part == 2 ? uFilter[1] : part == 3 ? uFilter[2] : vec2(0.0); }
bool isFilter(vec2 f, float id) { return f.y > 0.0 && abs(f.x - id) < 0.5; }
vec3 rgbAt(vec2 cell) { return toSrgb(colorAt(cell).rgb); }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hueOf(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// Filters that move pixels: where a filtered part reads from. Every offset is a
// whole art pixel, so a filter never smears the grid.
vec2 filterCell(vec2 cell, vec2 f, int part) {
  float a = f.y;
  // mosaic: the part is drawn in blocks of 2 to 4 art pixels
  if (isFilter(f, 3.0)) { float k = 2.0 + floor(a * 2.0); cell = floor(cell / k) * k + floor(k * 0.5); }
  // vhs: rows wobble, and a band of tracking noise rolls up the frame
  if (isFilter(f, 7.0)) {
    float band = 1.0 - smoothstep(0.0, 5.0, abs(cell.y - fract(uTime * 0.06) * gGrid.y));
    cell.x += floor(sin(cell.y * 0.37 + uTime * 2.7) * a * 1.4 + band * a * 7.0 * (signalHash(vec2(cell.y, floor(uTime * 12.0))) - 0.5));
  }
  // wave: heat haze, rows sway on a slow sine
  if (isFilter(f, 9.0)) cell.x += floor(sin(cell.y * 0.22 + uTime * 2.1) * (1.0 + 2.5 * a) + 0.5);
  // slitscan: each row shows the part at its own moment, so the part shears and unshears
  if (isFilter(f, 15.0)) cell.x += floor(sin(cell.y * 0.045 - uTime * 0.9) * gGrid.x * 0.035 * a + 0.5);
  // datamosh: blocks of the part jump and stick for half a second
  if (isFilter(f, 17.0)) {
    vec2 block = floor(cell / 6.0);
    float slot = floor(uTime * 2.0);
    if (signalHash(block + slot * 7.31) > 1.0 - 0.32 * a) cell += floor((vec2(signalHash(block + slot), signalHash(block - slot + 3.0)) - 0.5) * 14.0 * a);
  }
  // pixel sort: bright runs of the part drip down over darker pixels below them
  if (isFilter(f, 16.0)) {
    vec2 pick = cell;
    float best = 0.42;
    for (int k = 1; k <= 14; k++) {
      if (float(k) > 14.0 * a) break;
      vec2 p = clamp(cell + vec2(0.0, float(k)), vec2(0.0), gGrid - 1.0);
      if (partAt(p) != part) break;
      float l = lumaOf(rgbAt(p));
      if (l > best + 0.03) { best = l; pick = p; }
    }
    cell = pick;
  }
  return clamp(cell, vec2(0.0), gGrid - 1.0);
}
// Filters that change colour, applied before the tones are stepped, so a
// filtered part is still dithered pixel art.
vec3 filterColor(vec3 c, vec2 cell, vec2 f, float edge) {
  if (f.y <= 0.0) return c;
  float a = clamp(f.y, 0.0, 1.0);
  float l = lumaOf(c);
  float frame = floor(uTime * 12.0);
  vec3 o = c;
  // snow: static speckles
  if (isFilter(f, 1.0)) o = mix(c, vec3(signalHash(cell + frame * 1.37)), step(1.0 - 0.22 * a, signalHash(cell * 1.31 + frame)));
  // film: sepia, a little grain, and the gate's flicker
  if (isFilter(f, 2.0)) o = vec3(l * 1.07 + 0.05, l * 0.9 + 0.03, l * 0.68) * (0.93 + 0.07 * signalHash(vec2(frame, 2.0))) + (signalHash(cell + frame) - 0.5) * 0.08;
  // cga: the four-colour 1981 palette
  if (isFilter(f, 4.0)) o = l < 0.2 ? vec3(0.0) : l < 0.5 ? vec3(0.33, 1.0, 1.0) * (0.55 + l) : l < 0.78 ? vec3(1.0, 0.33, 1.0) : vec3(1.0);
  // negative
  if (isFilter(f, 5.0)) o = 1.0 - c;
  // glow: bright pixels bloom into their neighbours
  if (isFilter(f, 6.0) || isFilter(f, 13.0)) {
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      float t = float(k) * 0.785398;
      vec3 s = rgbAt(cell + floor(vec2(cos(t), sin(t)) * 2.5 + 0.5));
      sum += s * smoothstep(0.45, 0.9, lumaOf(s));
    }
    o = c + sum * 0.22;
    // neon: dark bodies, glowing rims in a cycling hue
    if (isFilter(f, 13.0)) o = edge > 0.5 ? hueOf(fract(cell.y * 0.01 + uTime * 0.12)) * 1.2 : c * 0.22 + sum * 0.12;
  }
  // bleed: colour smears to the right of where it belongs, as on a worn tape
  if (isFilter(f, 8.0)) {
    vec3 smear = (rgbAt(cell - vec2(1.0, 0.0)) + rgbAt(cell - vec2(2.0, 0.0)) + rgbAt(cell - vec2(3.0, 0.0))) / 3.0;
    o = vec3(l) + (smear - vec3(lumaOf(smear))) * 1.3;
  }
  // night vision: green phosphor and noise
  if (isFilter(f, 10.0)) o = vec3(0.12, 1.0, 0.28) * (l * 1.35 + 0.06) + (signalHash(cell + frame) - 0.5) * 0.12;
  // sparkle: bright pixels twinkle white
  if (isFilter(f, 11.0)) o = c + step(0.5, l) * step(1.0 - 0.07 * a, signalHash(cell + floor(uTime * 6.0) * 2.17)) * vec3(0.9);
  // thermal: black, blue, magenta, red, yellow, white by brightness
  if (isFilter(f, 12.0)) {
    float h = clamp(l * 1.15, 0.0, 1.0);
    o = h < 0.25 ? mix(vec3(0.02, 0.0, 0.1), vec3(0.15, 0.1, 0.9), h * 4.0) : h < 0.5 ? mix(vec3(0.15, 0.1, 0.9), vec3(0.9, 0.1, 0.7), h * 4.0 - 1.0) : h < 0.75 ? mix(vec3(0.9, 0.1, 0.7), vec3(1.0, 0.55, 0.0), h * 4.0 - 2.0) : mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 1.0, 0.85), h * 4.0 - 3.0);
  }
  // rainbow: colours cycle through the hues
  if (isFilter(f, 14.0)) o = hueOf(fract(l * 1.4 + cell.y * 0.008 + uTime * 0.18)) * (0.35 + 0.85 * l);
  // holo: iridescent foil that shifts across the part, with a sweeping sheen
  if (isFilter(f, 18.0)) {
    float sheen = smoothstep(0.92, 1.0, fract((cell.x + cell.y) * 0.02 - uTime * 0.35));
    o = mix(c, hueOf(fract(cell.x * 0.018 + cell.y * 0.012 + uTime * 0.2 + l * 0.6)) * (0.55 + 0.6 * l), 0.65) + sheen * 0.5;
  }
  return mix(c, clamp(o, 0.0, 1.0), isFilter(f, 1.0) || isFilter(f, 11.0) ? 1.0 : a);
}
// Clump: a smooth Kuwahara filter gathers speckle into masses; what lies behind never bleeds in.
vec3 clumpAt(vec2 cell, vec3 c, float d0, float gap) {
  vec3 s[9];
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    vec2 at = cell + vec2(float(i) - 1.0, float(j) - 1.0);
    s[j * 3 + i] = (i == 1 && j == 1) || distanceAt(at) - d0 > gap ? c : rgbAt(at);
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int q = 0; q < 4; q++) {
    int ox = q - (q / 2) * 2;
    int oy = q / 2;
    vec3 a = s[oy * 3 + ox]; vec3 b = s[oy * 3 + ox + 1]; vec3 d = s[oy * 3 + ox + 3]; vec3 e = s[oy * 3 + ox + 4];
    vec3 mean = (a + b + d + e) * 0.25;
    vec3 va = a - mean; vec3 vb = b - mean; vec3 vd = d - mean; vec3 ve = e - mean;
    float w = 1.0 / (0.004 + dot(va, va) + dot(vb, vb) + dot(vd, vd) + dot(ve, ve));
    sum += mean * w * w;
    total += w * w;
  }
  return sum / total;
}
void main() {
  gF = 1.0;
  gGrid = uGrid;
  vec2 at = floor(gl_FragCoord.xy);
  // The detail pass redraws only the detail parts' own pixels; the rest is the world's look.
  if (uPass > 0.5) {
    gF = uFine;
    gGrid = uGrid * uFine;
    if (!onDetail(at)) {
      gl_FragColor = texture2D(tCoarse, (floor(at / uFine) + 0.5) / uGrid);
      return;
    }
  }
  // Clump would gather a small animal's eye and muzzle into its coat.
  float clump = gF > 1.5 ? 0.0 : uClump;
  vec2 home = clamp(at, vec2(0.0), gGrid - 1.0);
  int part = partAt(home);
  vec3 signal = signalOf(part);
  vec2 partFilter = filterOf(part);
  vec2 cell = filterCell(glitchCell(home, part), partFilter, part);
  vec3 c = toSrgb(colorAt(cell).rgb);
  // Red and blue drift apart by whole art pixels around a fringed part, and
  // further while it bursts.
  float fringe = max(signal.y, max(signalOf(partAt(home + vec2(2.0, 0.0))).y, signalOf(partAt(home - vec2(2.0, 0.0))).y));
  float split = floor(fringe * 1.6) + burstOf(signal.z, float(part));
  if (split >= 1.0) {
    c.r = toSrgb(colorAt(cell + vec2(split, 0.0)).rgb).r;
    c.b = toSrgb(colorAt(cell - vec2(split, 0.0)).rgb).b;
  }
  float d0 = distanceAt(cell);
  bool sky = d0 >= uSkyFrom;
  float dl = distanceAt(cell - vec2(1.0, 0.0));
  float dr = distanceAt(cell + vec2(1.0, 0.0));
  float dd = distanceAt(cell - vec2(0.0, 1.0));
  float du = distanceAt(cell + vec2(0.0, 1.0));
  float gap = 0.06 * d0 + 0.08;
  float edge = (!sky && max(max(dl, dr), max(du, dd)) - d0 > gap) ? 1.0 : 0.0;
  // Clumped, a leaf among leaves is not a silhouette.
  if (clump > 0.0 && d0 - min(min(dl, dr), min(du, dd)) > gap) edge = 0.0;
  float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
  float crease = (!sky && edge < 0.5 && lap > 0.012 * d0 + 0.02) ? 1.0 : 0.0;
  if (clump > 0.0 && !sky && split < 1.0) c = mix(c, clumpAt(cell, c, d0, gap), clump);
  c = filterColor(c, cell, partFilter, edge);

  float jitter = (bayer8(cell + 3.0) - 0.5) * 0.18;
  float far = d0 * (1.0 + jitter);
  int band = sky || far > uBands.y ? 2 : far > uBands.x ? 1 : 0;
  float screen = band == 0 ? uScreen.x : band == 1 ? uScreen.y : uScreen.z;
  float scale = band == 0 ? uScale.x : band == 1 ? uScale.y : uScale.z;
  float amount = band == 0 ? uAmount.x : band == 1 ? uAmount.y : uAmount.z;

  c += godRays(cell) * (sky ? 0.6 : 1.0);
  // Soft knee into black; lift the darkest toward cool blue; ramps lean lights warm, shadows cool.
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(0.1 * exp(c * 10.0 - 1.0), c, step(0.1, c));
  float lo = 1.0 - clamp(lumaOf(c), 0.0, 1.0);
  c += uLift * lo * lo * lo * vec3(0.8, 0.9, 1.3) + (sky ? 0.0 : uRamp) * 0.09 * (0.55 - lo) * vec3(1.0, 0.3, -0.9);
  // Only a light far band is pushed: a night or blue-hour sky keeps its depth.
  float farPush = band == 2 ? mix(1.0, uSkySaturation, smoothstep(0.3, 0.6, lumaOf(c))) : 1.0;
  c = mix(vec3(lumaOf(c)), c, uSaturation * farPush);
  // Outlines thin out with distance, so a far skyline is a soft edge, not a wire.
  float outline = uOutline * (band == 0 ? 1.0 : band == 1 ? 0.7 : 0.3);
  vec3 ink = uOutlineColor.a > 0.5 ? uOutlineColor.rgb : c * vec3(0.36, 0.33, 0.46);
  c = mix(c, ink, edge * outline);
  c = mix(c, c * vec3(0.74, 0.72, 0.8), crease * uCrease);
  c = clamp(c, 0.0, 1.0);

  // A silhouette is a solid run of tone, never broken speckle.
  // A dark sky bands, never a grid of dots.
  if (sky) amount *= smoothstep(0.03, 0.2, lumaOf(c));
  // On a fixed palette the sky keeps its hue and settles into bands rather than a checker of far-apart inks.
  if (sky && uPaletteSize > 0) amount *= 0.35;
  float t = 0.5 + (screenAt(screen, floor(cell / scale)) - 0.5) * amount * (1.0 - edge * outline);
  // Alpha carries this pixel's scanline strength to the blit.
  gl_FragColor = vec4(uPaletteSize > 0 ? stepPalette(c, t, !sky, 1.6 * farPush) : stepTones(c, t), signal.x);
}
`;

// The look is resolved once per art pixel into a grid-sized target; this pass
// only scales it up by whole device pixels.
export const BLIT_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tLook;
uniform vec2 uGrid;
uniform float uPixel;
uniform vec2 uOrigin;
uniform float uScanlines;
uniform float uTime;
uniform float uFine;
void main() {
  vec2 frame = (gl_FragCoord.xy - uOrigin) / uPixel;
  // The look target holds uFine detail pixels to an art pixel's side.
  vec2 grid = uGrid * uFine;
  vec2 cell = clamp(floor(frame * uFine), vec2(0.0), grid - 1.0);
  vec4 look = texture2D(tLook, (cell + 0.5) / grid);
  vec3 c = look.rgb;
  // Each pixel's scanline strength came from the look pass (whole frame or its part);
  // none show when an art pixel is too few device pixels tall.
  float scan = uPixel >= 2.0 ? look.a : 0.0;
  // Scanlines: the lower part of every art-pixel row is dimmed, and a faint
  // brighter band rolls slowly down the frame, as on a tube screen.
  // Dark gaps between lines, with the lit rows lifted to keep the frame's brightness.
  float line = (1.0 + scan * 0.22) * (1.0 - scan * 0.5 * step(fract(frame.y), 0.4));
  float roll = 1.0 + scan * 0.07 * sin((frame.y / uGrid.y + uTime * 0.12) * 6.2832);
  gl_FragColor = vec4(c * line * roll, 1.0);
}
`;

/** The passes' GLSL, for hosts that run their own pipeline. Uniform names are the contract. */
export const VOXEL_DITHER_GLSL = { vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, blit: BLIT_GLSL } as const;

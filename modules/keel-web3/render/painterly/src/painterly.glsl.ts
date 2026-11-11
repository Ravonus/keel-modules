// The painter's shaders: a full-screen quad; the lit frame tone mapped; the structure tensor of the colour and of
// the form (normals from depth, and the depth); its blur; an anisotropic Kuwahara smoothing along it; strokes
// stamped along it; and the finish (edge darkening, impasto, canvas grain, varnish). GLSL ES 1 as keel/lit's
// CustomMaterial takes it.

export const VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Depth to view space, as lit-finish reads it. */
const VIEW_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform vec2 uProj;
// Distance in front of the eye for a window depth.
float viewDepth(float d) {
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return uNear * uFar / (uFar - (uFar - uNear) * d);
}
vec3 viewAt(vec2 uv) {
  float z = viewDepth(texture2D(tDepth, uv).x);
  vec2 ndc = uv * 2.0 - 1.0;
  return uOrtho > 0.5 ? vec3(ndc / uProj, -z) : vec3(ndc * z / uProj, -z);
}
`;

/** The orientation along which the picture changes least, and how strongly it is oriented, from a tensor. */
const FLOW_GLSL = /* glsl */ `
// Returns the unit direction along the flow; writes how anisotropic the tensor is, 0 to 1.
vec2 flowOf(vec4 J, out float anisotropy) {
  float E = J.x;
  float G = J.y;
  float F = J.z;
  float D = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0));
  float l1 = 0.5 * (E + G + D);
  float l2 = 0.5 * (E + G - D);
  anisotropy = (l1 + l2) > 1e-7 ? (l1 - l2) / (l1 + l2) : 0.0;
  // (The minor eigenvector in its two forms: one shrinks to nothing when the x gradient dominates, the other when
  // the y gradient does; the longer is the well-conditioned one, so a vertical arm reads vertical and not as noise.)
  vec2 ta = vec2(l1 - E, -F);
  vec2 tb = vec2(-F, l1 - G);
  vec2 t = dot(ta, ta) > dot(tb, tb) ? ta : tb;
  return dot(t, t) > 1e-14 ? normalize(t) : vec2(0.0, 1.0);
}
`;

/** Linear light to the display: an ACES fit, then sRGB. */
const TONE_GLSL = /* glsl */ `
uniform sampler2D tColor;
uniform float uExposure;
vec3 aces(vec3 x) {
  x *= 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toned(vec2 uv) { return srgb(aces(texture2D(tColor, uv).rgb * uExposure)); }
`;

export const PREP_GLSL = /* glsl */ `
precision highp float;
${TONE_GLSL}
${VIEW_GLSL}
uniform vec2 uPaintSize;
// (The alpha carries the depth as a share of the far plane, square rooted so near things keep their precision:
// the strokes use it to stay on their own surface.)
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  float share = sqrt(clamp(viewDepth(texture2D(tDepth, uv).x) / uFar, 0.0, 1.0));
  gl_FragColor = vec4(toned(uv), share);
}
`;

export const TENSOR_GLSL = /* glsl */ `
precision highp float;
${VIEW_GLSL}
uniform sampler2D tPrep;
uniform vec2 uPaintSize;
uniform vec2 uTexel;
uniform float uDirection;
vec3 colourAt(vec2 uv) { return texture2D(tPrep, uv).rgb; }
// How much a colour is flesh: red to orange in hue, neither grey nor vivid. (A dark skin and a light one both lie
// here; a red cap or a khaki ground do not.)
float skin(vec3 c) {
  if (c.r <= c.g || c.g <= c.b) return 0.0;
  float mx = c.r;
  float sat = (mx - c.b) / max(mx, 1e-3);
  float hue = (c.g - c.b) / max(c.r - c.b, 1e-3);
  return smoothstep(0.08, 0.2, hue) * (1.0 - smoothstep(0.6, 0.8, hue)) * smoothstep(0.15, 0.3, sat)
    * (1.0 - smoothstep(0.65, 0.8, sat));
}
// Sobel of the colour: how it changes across and up, as a tensor.
vec3 colourTensor(vec2 uv) {
  vec2 x = vec2(uTexel.x, 0.0);
  vec2 y = vec2(0.0, uTexel.y);
  vec3 a = colourAt(uv - x + y);
  vec3 b = colourAt(uv + y);
  vec3 c = colourAt(uv + x + y);
  vec3 d = colourAt(uv - x);
  vec3 f = colourAt(uv + x);
  vec3 g = colourAt(uv - x - y);
  vec3 h = colourAt(uv - y);
  vec3 i = colourAt(uv + x - y);
  vec3 gx = (c - a) + 2.0 * (f - d) + (i - g);
  vec3 gy = (a - g) + 2.0 * (b - h) + (c - i);
  return vec3(dot(gx, gx), dot(gy, gy), dot(gx, gy)) / 64.0;
}
// How the form changes across and up: the depth's gradient, as a tensor, over two painted pixels each way. (The
// flow then runs along the lines of equal depth: around a cheek, along an arm. A normal rebuilt from depth and
// differenced again is too noisy for this at a frame's depth precision, and a mesh's facets step it besides.)
// Writes how curved the surface is: the gradient's change over six pixels, which a hand or a nose has and a torso
// has not.
vec3 formTensor(vec2 uv, vec3 p, out float curve) {
  vec2 x = vec2(uTexel.x * 2.0, 0.0);
  vec2 y = vec2(0.0, uTexel.y * 2.0);
  // (Depth as a share of the distance, so a far slope counts as a near one.)
  float k = 2.0 / max(-p.z, 1e-3);
  float zl = viewDepth(texture2D(tDepth, uv - x).x);
  float zr = viewDepth(texture2D(tDepth, uv + x).x);
  float zd = viewDepth(texture2D(tDepth, uv - y).x);
  float zu = viewDepth(texture2D(tDepth, uv + y).x);
  float zx = (zr - zl) * k;
  float zy = (zu - zd) * k;
  float z = -p.z;
  curve = (abs(zr + zl - 2.0 * z) + abs(zu + zd - 2.0 * z)) * k * 4.0;
  return vec3(zx * zx, zy * zy, zx * zy);
}
// The tensor, and in the alpha how fine the picture is there: where the colour has detail, and where the form is
// small (a face, a hand, a finger: the normal turns fast), 0 in the sky and on open ground up to 1.
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  vec3 tc = colourTensor(uv);
  float trc = tc.x + tc.y;
  // (A cloth's weave is not detail; an edge is: the small gradients fall away here.)
  vec3 J = tc / (trc + 0.03);
  float fine = trc / (trc + 0.01);
  float depth = texture2D(tDepth, uv).x;
  if (depth < 0.99999) {
    vec3 p = viewAt(uv);
    float curve;
    vec3 tf = formTensor(uv, p, curve);
    float trf = tf.x + tf.y;
    vec3 Jf = tf / (trf + 0.02);
    J = mix(J, Jf, uDirection);
    // (Fine where the surface turns away steeply, a silhouette or the side of an arm; where it is curved small, a
    // hand or a nose; and where it is flesh, which a painter keeps smooth.)
    fine = max(fine, max(trf / (trf + 0.012), curve / (curve + 0.012)));
    fine = max(fine, 0.5 * skin(colourAt(uv)));
  }
  gl_FragColor = vec4(J, fine);
}
`;

export const BLUR_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tBlur;
uniform vec2 uPaintSize;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  // (Three painted pixels a step: a form's sides reach their orientation across its flat front.)
  vec2 delta = uDir * 3.0 / uPaintSize;
  vec4 sum = texture2D(tBlur, uv) * 0.2270270270;
  sum += (texture2D(tBlur, uv + delta * 1.3846153846) + texture2D(tBlur, uv - delta * 1.3846153846)) * 0.3162162162;
  sum += (texture2D(tBlur, uv + delta * 3.2307692308) + texture2D(tBlur, uv - delta * 3.2307692308)) * 0.0702702703;
  gl_FragColor = sum;
}
`;

export const KUWAHARA_GLSL = /* glsl */ `
precision highp float;
${FLOW_GLSL}
uniform sampler2D tPrep;
uniform sampler2D tTensor;
uniform vec2 uPaintSize;
uniform vec2 uTexel;
uniform float uRadius;
#define MAXR 12
#define SPAN 25
// (Sectors overlap softly: the eighth power of the cosine to each sector's middle, and the middle tap counts in all.)
float eighth(float d) {
  float k = max(d, 0.0);
  k *= k; k *= k;
  return k * k;
}
// A sector's mean weighs in by how flat the sector is: the flattest wins.
void gather(vec3 m, vec3 s, float w, inout vec3 painted, inout float total) {
  float wk = max(w, 1e-6);
  vec3 mean = m / wk;
  vec3 spread = max(s / wk - mean * mean, 0.0);
  float sigma = sqrt(spread.r + spread.g + spread.b);
  float share = 1.0 / (1.0 + pow(255.0 * sigma, 4.0));
  painted += mean * share;
  total += share;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  float A;
  vec4 J = texture2D(tTensor, uv);
  vec2 t = flowOf(J, A);
  // (An ellipse along the flow: longer along it the more oriented the picture is there; and a smaller brush
  // where the picture is fine, so an eye keeps its eye.)
  float radius = uRadius * mix(1.0, 0.5, J.w);
  float a = radius * clamp(1.0 + A, 0.1, 2.0);
  float b = radius * clamp(1.0 / (1.0 + A), 0.1, 2.0);
  mat2 SR = mat2(t.x / a, -t.y / b, t.y / a, t.x / b);
  float ex = min(ceil(sqrt(a * a * t.x * t.x + b * b * t.y * t.y)), float(MAXR));
  float ey = min(ceil(sqrt(a * a * t.y * t.y + b * b * t.x * t.x)), float(MAXR));
  vec3 m0 = vec3(0.0);\n  vec3 s0 = vec3(0.0);\n  float w0 = 0.0;\n  vec3 m1 = vec3(0.0);\n  vec3 s1 = vec3(0.0);\n  float w1 = 0.0;\n  vec3 m2 = vec3(0.0);\n  vec3 s2 = vec3(0.0);\n  float w2 = 0.0;\n  vec3 m3 = vec3(0.0);\n  vec3 s3 = vec3(0.0);\n  float w3 = 0.0;\n  vec3 m4 = vec3(0.0);\n  vec3 s4 = vec3(0.0);\n  float w4 = 0.0;\n  vec3 m5 = vec3(0.0);\n  vec3 s5 = vec3(0.0);\n  float w5 = 0.0;\n  vec3 m6 = vec3(0.0);\n  vec3 s6 = vec3(0.0);\n  float w6 = 0.0;\n  vec3 m7 = vec3(0.0);\n  vec3 s7 = vec3(0.0);\n  float w7 = 0.0;
  for (int jj = 0; jj < SPAN; jj++) {
    float j = float(jj) - ey;
    if (j > ey) break;
    for (int ii = 0; ii < SPAN; ii++) {
      float i = float(ii) - ex;
      if (i > ex) break;
      vec2 d = vec2(i, j);
      vec2 v = SR * d;
      float r2 = dot(v, v);
      if (r2 > 1.0) continue;
      vec3 c = texture2D(tPrep, uv + d * uTexel).rgb;
      float wt = exp(-r2 * 2.0);
      vec2 n = r2 > 1e-6 ? v * inversesqrt(r2) : vec2(1.0);
      float wk;
      wk = eighth(n.x) * wt;\n      m0 += c * wk;\n      s0 += c * c * wk;\n      w0 += wk;\n      wk = eighth((n.x + n.y) * 0.7071068) * wt;\n      m1 += c * wk;\n      s1 += c * c * wk;\n      w1 += wk;\n      wk = eighth(n.y) * wt;\n      m2 += c * wk;\n      s2 += c * c * wk;\n      w2 += wk;\n      wk = eighth((n.y - n.x) * 0.7071068) * wt;\n      m3 += c * wk;\n      s3 += c * c * wk;\n      w3 += wk;\n      wk = eighth(-n.x) * wt;\n      m4 += c * wk;\n      s4 += c * c * wk;\n      w4 += wk;\n      wk = eighth(-(n.x + n.y) * 0.7071068) * wt;\n      m5 += c * wk;\n      s5 += c * c * wk;\n      w5 += wk;\n      wk = eighth(-n.y) * wt;\n      m6 += c * wk;\n      s6 += c * c * wk;\n      w6 += wk;\n      wk = eighth(-(n.y - n.x) * 0.7071068) * wt;\n      m7 += c * wk;\n      s7 += c * c * wk;\n      w7 += wk;
    }
  }
  vec3 painted = vec3(0.0);
  float total = 0.0;
  gather(m0, s0, w0, painted, total);\n  gather(m1, s1, w1, painted, total);\n  gather(m2, s2, w2, painted, total);\n  gather(m3, s3, w3, painted, total);\n  gather(m4, s4, w4, painted, total);\n  gather(m5, s5, w5, painted, total);\n  gather(m6, s6, w6, painted, total);\n  gather(m7, s7, w7, painted, total);
  gl_FragColor = vec4(painted / total, 0.0);
}
`;

/** Each stroke of a layer, once: a cell's stroke centre, the flow there, and the paint's colour there. */
export const TABLE_GLSL = /* glsl */ `
precision highp float;
${FLOW_GLSL}
uniform sampler2D tPaint;
uniform sampler2D tPrep;
uniform sampler2D tTensor;
uniform sampler2D tTile;
uniform vec2 uPaintSize;
uniform float uTileCells;
// The layer: its cell in painted pixels, cells across and down, and a shift into the tile.
uniform vec4 uLayer;
void main() {
  vec2 at = floor(gl_FragCoord.xy);
  // (The table is two cells wide for each cell: the flow on the left half, the colour and depth on the right.)
  bool colour = at.x >= uLayer.y;
  vec2 q = vec2(colour ? at.x - uLayer.y : at.x, at.y);
  vec4 tile = texture2D(tTile, (q + vec2(0.5 + uLayer.w)) / uTileCells);
  vec2 cuv = (q + tile.xy) * uLayer.x / uPaintSize;
  float share = texture2D(tPrep, cuv).a;
  if (colour) { gl_FragColor = vec4(texture2D(tPaint, cuv).rgb, share); return; }
  vec4 J = texture2D(tTensor, cuv);
  float A;
  vec2 dir = flowOf(J, A);
  // (A sky's faint gradient is oriented but not a structure: the orientation counts by how much is there. Where the
  // picture is flat the stroke takes an angle of its own, more so in the sky than on a surface, whose flow is its
  // neighbours'; where it is oriented it follows the flow.)
  float oriented = A * smoothstep(0.0, 0.1, J.x + J.y);
  float turn = (tile.w - 0.5) * mix(0.3, 0.5, step(0.999, share)) * (1.0 - oriented);
  dir = vec2(dir.x * cos(turn) - dir.y * sin(turn), dir.x * sin(turn) + dir.y * cos(turn));
  gl_FragColor = vec4(dir, oriented, smoothstep(0.15, 0.7, J.w));
}
`;

export const STROKE_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tPaint;
uniform sampler2D tPrep;
uniform sampler2D tTile;
uniform sampler2D tCoarse;
uniform sampler2D tFine;
uniform vec2 uPaintSize;
uniform float uTileCells;
uniform float uStrokes;
uniform float uEdge;
// Each layer: its cell in painted pixels, cells across and down, and a shift into the tile.
uniform vec4 uCoarse;
uniform vec4 uFine;
// One stroke's cover at a point in its own frame: soft along its length and softer across, so a stroke blends in
// as colour rather than sitting on the picture as a mark.
float cover(float u, float v, float reach, float wide) {
  float along = smoothstep(reach, reach - wide * 0.8, abs(u) + abs(v) * 0.2);
  float across = smoothstep(wide, wide * 0.35, abs(v));
  return along * across;
}
// One layer of strokes, a stroke a cell, over what is there: the stroke on top wins. A stroke counts only where
// the picture is as fine as the layer asks at its centre (gate.x up to gate.y), and only on its own surface and
// its own colour: a stroke laid in the sky at the hat's edge does not cross onto the hat, and one on the bank does
// not cross onto the water. The lift (gate.z) puts the whole layer above another.
void layer(vec2 p, vec3 base, float depth, sampler2D table, vec4 how, vec3 gate, inout vec4 best, inout vec3 state) {
  float cell = how.x;
  vec2 cells = floor(p / cell);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 q = cells + vec2(float(i), float(j));
      if (q.x < 0.0 || q.y < 0.0 || q.x >= how.y || q.y >= how.z) continue;
      vec2 slot = (q + 0.5) / vec2(how.y * 2.0, how.z);
      vec4 flow = texture2D(table, slot);
      if (flow.w < gate.x || flow.w > gate.y) continue;
      vec4 tile = texture2D(tTile, (q + vec2(0.5 + how.w)) / uTileCells);
      vec2 d = p - (q + tile.xy) * cell;
      float u = dot(d, flow.xy);
      float v = dot(d, vec2(-flow.y, flow.x));
      // (Large and long where the picture is plain, a sky or water; small and short where it is fine, a face or a
      // hand; and each its own length within that.)
      float scale = mix(1.0, 0.45, flow.w);
      float reach = cell * scale * (0.9 + 1.3 * tile.z) * mix(0.85, 1.0, flow.z);
      float wide = cell * scale * (0.3 + 0.2 * (1.0 - tile.z));
      float c = cover(u, v, reach, wide);
      float order = tile.w + gate.z;
      if (c > 0.15 && order > state.x) {
        vec4 own = texture2D(table, slot + vec2(0.5, 0.0));
        if (abs(own.a - depth) > mix(0.08, 0.01, uEdge)) continue;
        c *= 1.0 - smoothstep(0.1, 0.3, distance(own.rgb, base));
        if (c <= 0.15) continue;
        state = vec3(order, c, flow.w);
        // (The stroke carries the colour under its centre, a shade lighter or darker than its neighbours: a value
        // jitter of a few percent, the stroke's own, and a faint bristle. No rim, no outline.)
        vec3 col = own.rgb * (0.975 + 0.05 * tile.w) * (0.99 + 0.01 * cos(v / wide * 9.0 + tile.w * 40.0));
        // (Paint stands a little thicker where there is something to paint.)
        float height = (1.0 - (v * v) / (wide * wide)) * smoothstep(reach, reach * 0.7, abs(u)) * (0.15 + 0.85 * flow.w);
        best = vec4(col, max(height, 0.0));
      }
    }
  }
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 base = texture2D(tPaint, p / uPaintSize).rgb;
  float depth = texture2D(tPrep, p / uPaintSize).a;
  vec4 best = vec4(base, 0.0);
  // (Which stroke is on top, how far inside it this point is, and how fine the picture is under it.)
  vec3 state = vec3(-1.0, 0.0, 0.0);
  // Broad strokes where the picture is plain, finer ones where it is fine; a face, a hand, an arm take light
  // strokes over the smoothed base, enough to match the rest of the picture's handling.
  layer(p, base, depth, tCoarse, uCoarse, vec3(0.0, 0.7, 0.0), best, state);
  layer(p, base, depth, tFine, uFine, vec3(0.3, 1.0, 1.0), best, state);
  // (The stroke on top fades in softly over its own edge, so it blends in as colour; strokes sink part way into the
  // base where the picture is fine, as thin paint does.)
  float on = uStrokes * smoothstep(0.15, 0.85, state.y) * mix(1.0, 0.6, state.z);
  gl_FragColor = vec4(mix(base, best.rgb, on), best.a * on);
}
`;

export const GRADE_GLSL = /* glsl */ `
precision highp float;
${TONE_GLSL}
${FLOW_GLSL}
${VIEW_GLSL}
uniform sampler2D tPainted;
uniform sampler2D tPrep;
uniform sampler2D tTensor;
uniform sampler2D tGrain;
uniform sampler2D tTile;
uniform float uTileCells;
uniform vec2 uSize;
uniform vec2 uPaintSize;
uniform float uGrainSize;
uniform float uGrain;
uniform float uGrade;
uniform float uView;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Where the paint lies thick and where thin, in patches the size of a few strokes, from the seed's tile.
float patches(vec2 p) {
  vec2 at = p / 96.0;
  vec2 cell = floor(at);
  vec2 f = at - cell;
  f = f * f * (3.0 - 2.0 * f);
  vec2 s = vec2(1.0 / uTileCells);
  float a = texture2D(tTile, (cell + 0.5) * s).w;
  float b = texture2D(tTile, (cell + vec2(1.5, 0.5)) * s).w;
  float c = texture2D(tTile, (cell + vec2(0.5, 1.5)) * s).w;
  float d = texture2D(tTile, (cell + 1.5) * s).w;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// The flow as colour, for checking: the hue is the direction (red across, cyan up), the saturation how oriented.
vec3 flowColour(vec2 uv) {
  float A;
  vec2 t = flowOf(texture2D(tTensor, uv), A);
  float hue = atan(t.y, t.x) / 3.14159265;
  hue = fract(hue + 1.0);
  vec3 rgb = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), rgb, 0.2 + 0.8 * A);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  if (uView > 0.5 && uView < 1.5) { gl_FragColor = vec4(toned(uv), 1.0); return; }
  if (uView > 1.5 && uView < 2.5) { gl_FragColor = vec4(flowColour(uv), 1.0); return; }
  if (uView > 3.5) { float z = viewDepth(texture2D(tDepth, uv).x); gl_FragColor = vec4(fract(z * 100.0), fract(z * 1000.0), texture2D(tDepth, uv).x < 0.99999 ? 0.3 : 1.0, 1.0); return; }
  if (uView > 2.5) { gl_FragColor = vec4(texture2D(tTensor, uv).w, texture2D(tPainted, uv).a, texture2D(tPrep, uv).a, 1.0); return; }
  vec2 px = 1.0 / uPaintSize;
  vec4 here = texture2D(tPainted, uv);
  vec4 r = texture2D(tPainted, uv + vec2(px.x, 0.0));
  vec4 l = texture2D(tPainted, uv - vec2(px.x, 0.0));
  vec4 u = texture2D(tPainted, uv + vec2(0.0, px.y));
  vec4 d = texture2D(tPainted, uv - vec2(0.0, px.y));
  vec3 c = here.rgb;
  // No line and no darkening along a silhouette, and no rim on any stroke: a silhouette is kept by the strokes
  // staying at their own depth. Impasto: the strokes' height lit from the upper left, faintly.
  float relief = (l.a - r.a) * 0.7 + (u.a - d.a) * 0.7;
  c *= 1.0 + relief * 0.04;
  // Canvas: the weave's relief, lit the same way, and its threads showing only where the paint is thin: under no
  // stroke, away from the fine passages the painter worked over, and in the thin patches of the picture.
  // (A thread and a half of canvas to the frame pixel.)
  vec2 g = gl_FragCoord.xy / (uGrainSize * 1.5);
  vec2 gpx = vec2(1.0 / uGrainSize);
  float h = texture2D(tGrain, g).x;
  float weave = (texture2D(tGrain, g - vec2(gpx.x, 0.0)).x - texture2D(tGrain, g + vec2(gpx.x, 0.0)).x)
    + (texture2D(tGrain, g + vec2(0.0, gpx.y)).x - texture2D(tGrain, g - vec2(0.0, gpx.y)).x);
  float thin = (1.0 - min(here.a * 2.0, 1.0)) * (1.0 - texture2D(tTensor, uv).w) * smoothstep(0.35, 0.75, patches(gl_FragCoord.xy));
  c *= 1.0 + uGrain * thin * (weave * 0.2 + (h - 0.5) * 0.05);
  // Varnish: a warm glaze, blacks lifted toward umber, a little contrast, a vignette.
  float lum = luma(c);
  vec3 varnished = c * vec3(1.05, 0.985, 0.88);
  varnished = mix(varnished, vec3(0.12, 0.085, 0.05), (1.0 - lum) * (1.0 - lum) * 0.25);
  varnished = mix(varnished, varnished * varnished * (3.0 - 2.0 * varnished), 0.4);
  vec2 q = uv - 0.5;
  varnished *= 1.0 - 0.45 * dot(q, q) * 1.6;
  c = mix(c, varnished, uGrade);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}
`;

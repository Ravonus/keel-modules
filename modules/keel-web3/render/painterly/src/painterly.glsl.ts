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
  vec2 t = vec2(l1 - E, -F);
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
// The surface's normal from its neighbours' depths, from the nearer side of each pair so edges stay clean.
vec3 normalAt(vec2 uv, vec3 p) {
  vec3 r = viewAt(uv + vec2(uTexel.x, 0.0)) - p;
  vec3 l = p - viewAt(uv - vec2(uTexel.x, 0.0));
  vec3 u = viewAt(uv + vec2(0.0, uTexel.y)) - p;
  vec3 d = p - viewAt(uv - vec2(0.0, uTexel.y));
  return normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d));
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
// How the form changes across and up: the normal's and the depth's gradients, as a tensor; and the silhouette.
vec3 formTensor(vec2 uv, vec3 p, out float edge) {
  vec2 x = vec2(uTexel.x, 0.0);
  vec2 y = vec2(0.0, uTexel.y);
  vec3 pr = viewAt(uv + x);
  vec3 pl = viewAt(uv - x);
  vec3 pu = viewAt(uv + y);
  vec3 pd = viewAt(uv - y);
  vec3 nx = normalAt(uv + x, pr) - normalAt(uv - x, pl);
  vec3 ny = normalAt(uv + y, pu) - normalAt(uv - y, pd);
  // (Depth as a share of the distance, so a far slope counts as a near one.)
  float k = 4.0 / max(-p.z, 1e-3);
  vec3 gx = vec3(nx.xy, (pr.z - pl.z) * k);
  vec3 gy = vec3(ny.xy, (pu.z - pd.z) * k);
  edge = smoothstep(0.3, 1.2, abs(pr.z - pl.z) * k + abs(pu.z - pd.z) * k);
  return vec3(dot(gx, gx), dot(gy, gy), dot(gx, gy));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  vec3 tc = colourTensor(uv);
  // (A cloth's weave is not detail; an edge is: the small gradients fall away here.)
  vec3 J = tc / (tc.x + tc.y + 0.03);
  float edge = 0.0;
  float depth = texture2D(tDepth, uv).x;
  if (uDirection > 0.0 && depth < 0.99999) {
    vec3 p = viewAt(uv);
    vec3 tf = formTensor(uv, p, edge);
    vec3 Jf = tf / (tf.x + tf.y + 0.02);
    J = mix(J, Jf, uDirection);
  }
  gl_FragColor = vec4(J, edge);
}
`;

export const BLUR_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tBlur;
uniform vec2 uPaintSize;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uPaintSize;
  vec2 delta = uDir * 2.0 / uPaintSize;
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
  vec2 t = flowOf(texture2D(tTensor, uv), A);
  // (An ellipse along the flow: longer along it the more oriented the picture is there.)
  float a = uRadius * clamp(1.0 + A, 0.1, 2.0);
  float b = uRadius * clamp(1.0 / (1.0 + A), 0.1, 2.0);
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
  if (colour) { gl_FragColor = vec4(texture2D(tPaint, cuv).rgb, texture2D(tPrep, cuv).a); return; }
  vec4 J = texture2D(tTensor, cuv);
  float A;
  vec2 dir = flowOf(J, A);
  gl_FragColor = vec4(dir, A, J.x + J.y);
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
// Each layer: its cell in painted pixels, cells across and down, and a shift into the tile.
uniform vec4 uCoarse;
uniform vec4 uFine;
// One stroke's cover at a point in its own frame: soft along its length, a brush profile across.
float cover(float u, float v, float reach, float wide) {
  float along = smoothstep(reach, reach - wide * 0.6, abs(u) + abs(v) * 0.2);
  float across = smoothstep(wide, wide * 0.55, abs(v));
  return along * across;
}
// One layer of strokes, a stroke a cell, over what is there: the stroke on top wins. A stroke counts only where
// the picture has the least detail asked at its centre, and only on its own surface (a stroke laid in the sky at
// the hat's edge does not cross onto the hat); the lift puts the whole layer above another.
void layer(vec2 p, vec3 base, float depth, sampler2D table, vec4 how, vec2 gate, inout vec4 best, inout vec3 state) {
  float cell = how.x;
  vec2 cells = floor(p / cell);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 q = cells + vec2(float(i), float(j));
      if (q.x < 0.0 || q.y < 0.0 || q.x >= how.y || q.y >= how.z) continue;
      vec2 slot = (q + 0.5) / vec2(how.y * 2.0, how.z);
      vec4 flow = texture2D(table, slot);
      if (flow.w < gate.x) continue;
      vec4 tile = texture2D(tTile, (q + vec2(0.5 + how.w)) / uTileCells);
      vec2 d = p - (q + tile.xy) * cell;
      float u = dot(d, flow.xy);
      float v = dot(d, vec2(-flow.y, flow.x));
      // (Longer where the picture is oriented, a dab where it is flat.)
      float reach = cell * (0.7 + 1.1 * tile.z) * mix(0.5, 1.0, flow.z);
      float wide = cell * (0.26 + 0.22 * (1.0 - tile.z));
      float c = cover(u, v, reach, wide);
      float order = tile.w + gate.y;
      if (c > 0.4 && order > state.x) {
        vec4 own = texture2D(table, slot + vec2(0.5, 0.0));
        if (abs(own.a - depth) > 0.04) continue;
        state = vec3(order, c, flow.w);
        // (A loaded brush dragged through the picture: the stroke's own colour where the picture is plain, and the
        // picture's own colour showing through where it has detail worth keeping, with the stroke's shape over it.)
        vec3 col = mix(own.rgb, base, 0.3 + 0.5 * flow.w) * (0.97 + 0.06 * tile.w);
        // (Bristles: a few lines along the stroke, their phase the stroke's own.)
        float bristle = 0.95 + 0.05 * cos(v / wide * 9.0 + tile.w * 40.0);
        // (Paint stands thicker where there is something to paint.)
        float height = (1.0 - (v * v) / (wide * wide)) * smoothstep(reach, reach * 0.7, abs(u)) * (0.15 + 0.85 * flow.w);
        best = vec4(col * bristle, max(height, 0.0));
      }
    }
  }
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 base = texture2D(tPaint, p / uPaintSize).rgb;
  float depth = texture2D(tPrep, p / uPaintSize).a;
  vec4 best = vec4(base, 0.0);
  // (Which stroke is on top, how far inside it this point is, and how much detail it was laid over.)
  vec3 state = vec3(-1.0, 0.0, 0.0);
  // Broad strokes everywhere, then finer ones where there is detail to keep.
  layer(p, base, depth, tCoarse, uCoarse, vec2(0.0, 0.0), best, state);
  layer(p, base, depth, tFine, uFine, vec2(0.5, 1.0), best, state);
  // (The stroke on top fades in over its own edge, so no stroke ends in a stair; and strokes over plain passages
  // sink part way into the base, as thin paint does.)
  float on = uStrokes * smoothstep(0.4, 0.6, state.y) * (0.6 + 0.4 * state.z);
  gl_FragColor = vec4(mix(base, best.rgb, on), best.a * on);
}
`;

export const GRADE_GLSL = /* glsl */ `
precision highp float;
${TONE_GLSL}
uniform sampler2D tPainted;
uniform sampler2D tTensor;
uniform sampler2D tGrain;
uniform vec2 uSize;
uniform vec2 uPaintSize;
uniform float uGrainSize;
uniform float uGrain;
uniform float uEdge;
uniform float uGrade;
uniform float uView;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  if (uView > 0.5) { gl_FragColor = vec4(toned(uv), 1.0); return; }
  vec2 px = 1.0 / uPaintSize;
  vec4 here = texture2D(tPainted, uv);
  vec4 r = texture2D(tPainted, uv + vec2(px.x, 0.0));
  vec4 l = texture2D(tPainted, uv - vec2(px.x, 0.0));
  vec4 u = texture2D(tPainted, uv + vec2(0.0, px.y));
  vec4 d = texture2D(tPainted, uv - vec2(0.0, px.y));
  vec3 c = here.rgb;
  // Edges: where the paint changes sharply, and along silhouettes, the paint darkens as strokes meet.
  float contrast = abs(luma(r.rgb) - luma(l.rgb)) + abs(luma(u.rgb) - luma(d.rgb));
  float silhouette = texture2D(tTensor, uv).w;
  c *= 1.0 - uEdge * (0.3 * smoothstep(0.12, 0.5, contrast) + 0.3 * silhouette);
  // Impasto: the strokes' height lit from the upper left.
  float relief = (l.a - r.a) * 0.7 + (u.a - d.a) * 0.7;
  c *= 1.0 + relief * 0.2;
  // Canvas: the weave's relief, lit the same way, and its threads showing where the paint is thin.
  // (A thread and a half of canvas to the frame pixel.)
  vec2 g = gl_FragCoord.xy / (uGrainSize * 1.5);
  vec2 gpx = vec2(1.0 / uGrainSize);
  float h = texture2D(tGrain, g).x;
  float weave = (texture2D(tGrain, g - vec2(gpx.x, 0.0)).x - texture2D(tGrain, g + vec2(gpx.x, 0.0)).x)
    + (texture2D(tGrain, g + vec2(0.0, gpx.y)).x - texture2D(tGrain, g - vec2(0.0, gpx.y)).x);
  float thin = 1.0 - here.a * 0.7;
  c *= 1.0 + uGrain * thin * (weave * 0.25 + (h - 0.5) * 0.08);
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

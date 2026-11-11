// The plate's passes. Every target row 0 is the plate's top; `uView` says which part of the plate a target holds
// (left, top, width, height in plate fractions), so a crop paints at full resolution with the same strokes.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 uView;
uniform vec2 uSize;
uniform float uAspect;
uniform vec2 uSeedOff;
uniform vec3 uHaze;
uniform float uHazeStep;
uint hashU(ivec2 p) {
  uvec2 q = uvec2(p) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  n ^= n >> 16; n *= 2246822519u; n ^= n >> 13;
  return n;
}
float rnd(vec2 c) { return float(hashU(ivec2(floor(c))) >> 8) / 16777216.0; }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(rnd(i), rnd(i + vec2(1, 0)), u.x), mix(rnd(i + vec2(0, 1)), rnd(i + 1.), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.;
  float a = .5;
  float t = 0.;
  for (int k = 0; k < 6; k++) {
    if (k >= oct) break;
    s += a * vnoise(p); t += a;
    p = p * 2.03 + vec2(17.1, 9.3); a *= .5;
  }
  return s / t;
}
float hazeOf(float depth) { return 1. - pow(1. - uHazeStep, depth); }
vec2 plateUv() { return uView.xy + gl_FragCoord.xy / uSize * uView.zw; }
`;

/** A triangle over the whole target, from the vertex id alone. */
export const FULL_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

/** Sky, ranges, far shore, the lake reflecting them, near ground. Alpha carries the region for the strokes. */
export const SCENE_FRAG = `${HEAD}
uniform vec3 uSkyTop, uSkyLow, uSkyCorner, uCloudLit, uCloudShade;
uniform vec4 uCloud;
uniform highp sampler2D uRidge;
uniform float uRanges;
uniform vec3 uRangeLit[4];
uniform vec3 uRangeShade[4];
uniform vec4 uRangeInfo[4];
uniform vec4 uShore;
uniform vec3 uShoreCol, uShoreLit, uWaterFar, uWaterDeep, uSheen, uGround, uGroundWarm, uGroundDark;
out vec4 outColor;
float crest(int i, float u) {
  float x = clamp(u, 0., 1.) * 511.;
  int k = int(x);
  float a = texelFetch(uRidge, ivec2(k, i), 0).r;
  float b = texelFetch(uRidge, ivec2(min(k + 1, 511), i), 0).r;
  return mix(a, b, x - float(k));
}
vec3 sky(vec2 uv, int oct) {
  vec2 p = vec2(uv.x * uAspect, uv.y);
  float t = clamp(uv.y / uShore.x, 0., 1.);
  vec3 c = mix(uSkyTop, uSkyLow, smoothstep(0., 1., t));
  float corner = clamp((1. - uv.x * 1.5) * (1. - t * 1.3), 0., 1.);
  c = mix(c, uSkyCorner, corner * corner);
  c = mix(c, uSkyLow * 1.04, exp(-(uv.x - uCloud.z) * (uv.x - uCloud.z) * 4.84) * smoothstep(.05, .35, uv.y) * .35);
  vec2 cp = p * vec2(1.3, 2.6) + uSeedOff;
  vec2 warp = vec2(fbm(cp * .5, 3), fbm(cp * .5 + 7.3, 3));
  float n = fbm(cp + warp * 1.4, oct);
  float band = smoothstep(uCloud.x - .1, uCloud.x + .05, uv.y) * (1. - smoothstep(uCloud.y - .06, uCloud.y + .14, uv.y));
  float side = exp(-(uv.x - uCloud.z) * (uv.x - uCloud.z) * 3.24);
  float d = smoothstep(uCloud.w, uCloud.w + .3, n * (.55 + .45 * band) + band * side * .22);
  float toward = fbm(cp + warp * 1.4 + vec2(-.05, -.08), oct);
  float lit = clamp((n - toward) * 7. + .5, 0., 1.);
  c = mix(c, mix(uCloudShade, uCloudLit, lit), d * .88);
  float streak = fbm(vec2(p.x * 1.2, p.y * 26.) + uSeedOff * 1.7, 3);
  float low = smoothstep(uShore.x - .24, uShore.x - .14, uv.y) * (1. - smoothstep(uShore.x - .12, uShore.x - .04, uv.y));
  return mix(c, uCloudLit, smoothstep(.55, .75, streak) * low * .3);
}
vec3 ranges(vec2 uv, vec3 c, inout int code) {
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uRanges) break;
    vec4 info = uRangeInfo[i];
    float top = crest(i, uv.x);
    float dry = vnoise(vec2(uv.x * uAspect * 600., uv.y * 200.) + float(i) * 13.);
    float a = smoothstep(-info.z, info.z, uv.y - top + (dry - .5) * info.z * 1.6);
    if (a <= 0.) continue;
    float below = max(uv.y - top, 0.);
    float win = .014 + below * .9;
    float slope = (crest(i, uv.x + win) - crest(i, uv.x - win)) / (2. * win);
    float gx = uv.x + below * clamp(-slope, -1.2, 1.2) * .7;
    float spur = vnoise(vec2(gx * uAspect * 26., below * 5.) + uSeedOff + float(i) * 5.);
    float fine = vnoise(vec2(gx * uAspect * 90., below * 16.) + uSeedOff);
    float face = smoothstep(0., 1., .5 - slope * 1.1 + (spur - .5) * .5 + (fine - .5) * .16);
    face = mix(face, .42, smoothstep(.0, .09, below) * .25);
    vec3 col = mix(uRangeShade[i], uRangeLit[i], smoothstep(.1, .9, face));
    float wood = smoothstep(.45, .8, vnoise(vec2(uv.x * uAspect * 240., uv.y * 330.) + uSeedOff));
    col *= 1. - wood * .22 * (1. - smoothstep(.8, 1.6, info.x));
    col = mix(col, uHaze, hazeOf(info.x));
    float mist = smoothstep(info.y - info.w, info.y, uv.y);
    col = mix(col, mix(uHaze, uSkyLow, .4), mist * .5);
    c = mix(c, col, a);
    if (a > .5) code = 16 + (slope < 0. ? 0 : 1);
  }
  return c;
}
vec3 shore(vec2 uv, vec3 c, inout int code) {
  float top = uShore.x + (fbm(vec2(uv.x * uAspect * 7., 3.1) + uSeedOff, 3) - .5) * .016;
  float a = smoothstep(top - .0012, top + .0012, uv.y);
  if (a <= 0.) return c;
  float s = fbm(vec2(uv.x * uAspect * 26., uv.y * 260.) + uSeedOff, 3);
  float lit = smoothstep(.42, .72, s) * (1. - smoothstep(top, uShore.y, uv.y) * .7);
  vec3 col = mix(mix(uShoreCol, uGround, .25), uShoreLit, lit);
  col = mix(col, uHaze, hazeOf(uShore.w));
  if (a > .5) code = 32;
  return mix(c, col, a);
}
vec3 above(vec2 uv, int oct, inout int code) {
  return shore(uv, ranges(uv, sky(uv, oct), code), code);
}
vec3 water(vec2 uv) {
  float t = clamp((uv.y - uShore.y) / (uShore.z - uShore.y), 0., 1.);
  vec3 w = mix(uWaterFar, uWaterDeep, smoothstep(0., 1., t));
  float rip = vnoise(vec2(uv.x * uAspect * 8., uv.y * 240.) + uSeedOff) - .5;
  vec2 m = vec2(uv.x + rip * .014 * (.3 + t), 2. * uShore.y - uv.y + rip * .004);
  int ignore = 0;
  vec3 refl = (above(m, 2, ignore) + above(m + vec2(0., .008 + .02 * t), 1, ignore)) * .5;
  vec3 c = mix(w, refl * vec3(.88, .94, .95), mix(.72, .3, t));
  float sheen = exp(-(uv.y - uShore.y) / .014) * smoothstep(.3, .7, vnoise(vec2(uv.x * uAspect * 12., uv.y * 420.)));
  c = mix(c, uSheen, sheen * .55);
  float line = smoothstep(.64, .82, vnoise(vec2(uv.x * uAspect * 2.5, uv.y * 520.) + uSeedOff * 2.));
  return mix(c, mix(c, uSheen, .4), line * (1. - t) * .7);
}
vec3 ground(vec2 uv) {
  float t = clamp((uv.y - uShore.z) / (1. - uShore.z), 0., 1.);
  vec3 c = mix(uGround, uGroundDark, smoothstep(0., .6, t));
  c = mix(c, uGroundWarm, smoothstep(.5, 1., uv.x) * smoothstep(.15, .9, t) * .8);
  float grass = fbm(vec2(uv.x * uAspect * 9., uv.y * 70.) + uSeedOff, 4);
  c *= .84 + .3 * grass;
  vec2 bp = vec2(uv.x * uAspect * 6., uv.y * 11.) + uSeedOff * 1.3;
  float shrub = fbm(bp, 5) + t * .12;
  float toward = fbm(bp + vec2(-.12, -.18), 5) + t * .12;
  float m = smoothstep(.46, .6, shrub) * (1. - t * .5);
  float lit = clamp((shrub - toward) * 6. + .4, 0., 1.);
  vec3 bush = mix(uGroundDark * .8, uGround * 1.12, lit) * (.9 + .2 * grass);
  return mix(c, bush, m * .8);
}
void main() {
  vec2 uv = plateUv();
  int code = 0;
  vec3 c = above(uv, 5, code);
  float wa = smoothstep(uShore.y - .0008, uShore.y + .0008, uv.y);
  if (wa > 0.) {
    c = mix(c, water(uv), wa);
    if (wa > .5) code = 48;
    float edge = uShore.z + (fbm(vec2(uv.x * uAspect * 3., 8.7) + uSeedOff, 4) - .5) * .045;
    float ga = smoothstep(edge - .003, edge + .003, uv.y);
    c = mix(c, ground(uv), ga);
    if (ga > .5) code = 64;
  }
  outColor = vec4(c, float(code) / 255.);
}`;

/** Brush strokes over the scene: a short smear along the flow, then strokes laid one a cell, the colour under each. */
export const STROKE_FRAG = `${HEAD}
uniform sampler2D uBase;
uniform vec4 uStroke[5];
out vec4 outColor;
vec2 toSt(vec2 q) { return (vec2(q.x / uAspect, q.y) - uView.xy) / uView.zw; }
void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec4 b = texture(uBase, st);
  int code = int(b.a * 255. + .5);
  int region = min(code / 16, 4);
  vec4 S = uStroke[region];
  float ang = (code == 17) ? -S.x : S.x;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 across = vec2(-dir.y, dir.x);
  vec2 uv = plateUv();
  vec2 q = vec2(uv.x * uAspect, uv.y);
  vec2 r = vec2(dot(q, dir), dot(q, across));
  vec2 cell = S.yz;
  vec3 under = b.rgb;
  float wsum = 1.;
  for (int k = 1; k <= 3; k++) {
    for (int sgn = -1; sgn <= 1; sgn += 2) {
      vec3 s = texture(uBase, toSt(q + dir * float(k * sgn) * cell.x * .09)).rgb;
      float w = exp(-dot(s - b.rgb, s - b.rgb) * 400.);
      under += s * w; wsum += w;
    }
  }
  under /= wsum;
  vec2 c0 = floor(r / cell);
  float best = -1.;
  float cov = 0.;
  vec2 bd = vec2(0);
  vec2 bc = vec2(0);
  float bh = 0.;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = c0 + vec2(i, j);
      uint h = hashU(ivec2(id) + ivec2(code * 7919, code * 104729));
      vec4 hv = vec4(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u), float(h >> 24)) / 255.;
      vec2 ctr = (id + .5 + (hv.xy - .5) * vec2(.9, .7)) * cell;
      vec2 hs = cell * vec2(.6 + .6 * hv.z, .5 + .35 * hv.w);
      vec2 d = (r - ctr) / hs;
      float taper = max(1. - .3 * d.x * d.x, .2);
      float m = 1. - smoothstep(.7, 1., length(vec2(d.x, d.y / taper)));
      float z = fract(hv.x * 7.13 + hv.w * 3.7);
      if (m > 0. && z > best) { best = z; cov = m; bd = d; bc = ctr; bh = hv.z; }
    }
  }
  vec3 col = under;
  if (cov > 0.) {
    vec4 sc = texture(uBase, toSt(bc.x * dir + bc.y * across));
    float own = (1. - smoothstep(.04, .12, length(sc.rgb - b.rgb))) * step(abs(sc.a - b.a), .001);
    vec3 paint = mix(under, sc.rgb, own);
    paint *= 1. + (bh - .5) * .07;
    paint += (fract(bh * 13.7) - .5) * vec3(.022, .004, -.02);
    float bristle = .72 + .28 * vnoise(vec2(bd.x * 1.3, bd.y * 6. + bh * 31.));
    col = mix(under, paint, cov * S.w * bristle);
  }
  outColor = vec4(col, b.a);
}`;

/** Glaze, canvas weave in the lights, vignette and varnish over the finished painting. */
export const FINISH_FRAG = `${HEAD}
uniform sampler2D uPaint;
uniform vec4 uFinish;
out vec4 outColor;
void main() {
  vec3 c = texture(uPaint, gl_FragCoord.xy / uSize).rgb;
  vec2 uv = plateUv();
  vec2 q = vec2(uv.x * uAspect, uv.y);
  float g = fbm(q * 2.5 + uSeedOff * .3, 3) - .5;
  c = c * (1. + g * .07) + g * vec3(.012, 0., -.012);
  vec2 w = q / uFinish.x;
  float perPixel = uView.w / uSize.y / uFinish.x;
  vec2 cellW = floor(w);
  vec2 f = fract(w);
  float over = mod(cellW.x + cellW.y, 2.);
  float thread = mix(4. * f.y * (1. - f.y), 4. * f.x * (1. - f.x), over);
  float slub = rnd(over > .5 ? vec2(cellW.x, floor(cellW.y / 7.)) : vec2(floor(cellW.x / 7.), cellW.y) + 91.);
  float weave = (thread - .6) * (.6 + .8 * slub);
  float lum = dot(c, vec3(.3, .59, .11));
  c *= 1. + weave * .045 * smoothstep(.3, .7, lum) * (1. - smoothstep(.22, .34, perPixel));
  vec2 v = uv - .5;
  c *= 1. - uFinish.y * smoothstep(.12, .5, dot(v, v));
  c = vec3(.043, .055, .051) + c * (1. - vec3(.043, .055, .051));
  c = mix(c, c * vec3(1.025, 1., .965), smoothstep(.45, .9, lum));
  outColor = vec4(c, 1.);
}`;

/** A dab's quad: four corners of a strip, placed by the instance. */
export const DAB_VERT = `#version 300 es
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aAxis;
layout(location = 2) in vec4 aCol;
layout(location = 3) in vec4 aMore;
uniform vec4 uView;
uniform float uAspect;
out vec2 vL;
out vec2 vUv;
flat out vec4 fPos;
flat out vec4 fAxis;
flat out vec4 fCol;
flat out vec4 fMore;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2. - 1.;
  vec2 ax = aAxis.xy;
  vec2 L = corner * 1.1;
  vec2 q = vec2(aPos.x * uAspect, aPos.y) + ax * L.x * aPos.z + vec2(-ax.y, ax.x) * L.y * aPos.w;
  vUv = vec2(q.x / uAspect, q.y);
  vL = L;
  fPos = aPos; fAxis = aAxis; fCol = aCol; fMore = aMore;
  gl_Position = vec4((vUv - uView.xy) / uView.zw * 2. - 1., 0., 1.);
}`;

/** The shapes: blot, spire, crown, wall, leaf, stem. Each gives a distance (inside below 0) and a colour. */
export const DAB_FRAG = `${HEAD}
in vec2 vL;
in vec2 vUv;
flat in vec4 fPos;
flat in vec4 fAxis;
flat in vec4 fCol;
flat in vec4 fMore;
out vec4 outColor;
vec2 leafSide(vec2 p, float seed, out float rib) {
  float x = p.x;
  float hw = fPos.w / fPos.z * .5 * 2.75 * x * (1. - x) * (1.5 - .5 * x) * smoothstep(1.02, .7, x * x);
  hw *= 1. - .035 * fract(x * 24. + seed * 7.);
  rib = abs(p.y);
  float d = max(abs(p.y) - hw, max(-x, x - 1.));
  float vein = abs(fract((x - abs(p.y) * 1.4) * 6. + seed) - .5);
  return vec2(d, smoothstep(.04, 0., vein - .44) * step(.03, abs(p.y)));
}
vec2 leafHand(vec2 p, float seed, float lobes, out float rib) {
  vec2 v = p - vec2(.36, 0.);
  float a = atan(v.y, v.x);
  float r = length(v);
  float R = .22;
  rib = 9.;
  for (int k = 0; k < 5; k++) {
    if (float(k) >= lobes) break;
    float side = (k % 2 == 1) ? 1. : -1.;
    float phi = side * float((k + 1) / 2) * (lobes > 3. ? .8 : .95);
    float len = .64 - .14 * float((k + 1) / 2);
    float t = abs(a - phi) / .74;
    R = max(R, len * pow(max(0., 1. - t), .55));
    rib = min(rib, r * abs(sin(a - phi)) + step(1.2, abs(a - phi)));
  }
  R *= 1. - .035 * fract(a * 13. + seed * 5.);
  return vec2(r - R, 0.);
}
vec4 leaf() {
  vec2 p = vec2((vL.x + 1.) * .5, vL.y * fPos.w / fPos.z * .5);
  float rib;
  vec2 s = fMore.y < 2. ? leafSide(p, fAxis.w, rib) : leafHand(p, fAxis.w, fMore.y, rib);
  float aa = fwidth(s.x) * .8;
  float alpha = 1. - smoothstep(-aa, aa, s.x);
  vec2 lightDir = normalize(vec2(-1., -1.3));
  float L = fMore.x;
  float fold = dot(vec2(-fAxis.y, fAxis.x), lightDir) * sign(p.y) * .5 + .5;
  float inner = clamp(-s.x / .07, 0., 1.);
  vec3 c = fCol.rgb * mix(.74, 1.12, fold * (.45 + .55 * L));
  c *= .86 + .28 * vnoise(vec2(p.x * 3., p.y * 6.) + fAxis.w * 60.);
  float streak = vnoise(vec2(p.x * 5., p.y * 42.) + fAxis.w * 30.);
  c *= .92 + .16 * streak;
  c += (vnoise(vec2(p.x * 2.5, p.y * 14.) + fAxis.w * 17.) - .5) * vec3(.05, .035, -.03);
  c += vec3(.05, .06, .045) * L * fold * inner * (1. - inner) * 4. * smoothstep(.15, .6, p.x);
  float line = (1. - smoothstep(.002, .009, rib)) * smoothstep(0., .06, p.x) * (1. - .7 * p.x);
  vec3 vein = mix(c * .66, c * 1.22 + .02, smoothstep(.2, .6, L));
  c = mix(c, vein, line * (fMore.y < 2. ? .7 : .4) + s.y * .2 * inner);
  c = mix(c, c * .8, (1. - smoothstep(0., .012, -s.x)) * (1. - L) * .6);
  return vec4(c, alpha);
}
vec4 spire() {
  float t = (vL.x + 1.) * .5;
  float w = (1. - t) * (.62 + 1.5 * t) * (.8 + .4 * vnoise(vec2(t * 16., vL.y * 2.) + fAxis.w * 40.));
  float d = max(abs(vL.y) - w, -vL.x - 1.);
  float aa = fwidth(d) * (1. + fMore.w * 2.5);
  float lit = smoothstep(.4, -.7, vL.y / max(w, .05)) * fMore.x;
  vec3 c = fCol.rgb * (.75 + .6 * lit) * (.85 + .3 * vnoise(vL * vec2(9., 3.) + fAxis.w * 30.));
  return vec4(c, 1. - smoothstep(-aa, aa, d));
}
vec4 crown() {
  float n = vnoise(vL * 2.4 + fAxis.w * 40.) * .65 + vnoise(vL * 6. + fAxis.w * 13.) * .35;
  float d = max(length(vL * vec2(1., 1.1)) - (.66 + .38 * n), -vL.x - .8);
  float aa = fwidth(d) * (1. + fMore.w * 2.5);
  float lit = clamp(.5 + .6 * dot(normalize(vL + .001), normalize(vec2(.7, -.7))), 0., 1.) * fMore.x;
  vec3 c = fCol.rgb * (.72 + .6 * lit) * (.85 + .3 * vnoise(vL * 7. + fAxis.w * 20.));
  return vec4(c, 1. - smoothstep(-aa, aa, d));
}
vec4 wall() {
  float d = max(abs(vL.x), abs(vL.y)) - 1.;
  float aa = fwidth(d) * (1. + fMore.w * 1.5);
  float side = smoothstep(1. - 2. * fMore.y - .08, 1. - 2. * fMore.y + .08, vL.y);
  vec3 c = fCol.rgb * mix(.8 + .15 * fMore.x, .72, side);
  c *= 1. - .25 * smoothstep(.7, .85, vL.x);
  c *= .95 + .1 * vnoise(vL * vec2(3., 5.) + fAxis.w * 20.);
  return vec4(c, 1. - smoothstep(-aa, aa, d));
}
vec4 blot() {
  float n = vnoise(vL * 2.2 + fAxis.w * 50.);
  float d = length(vL) + (n - .5) * .45;
  vec3 c = fCol.rgb * (.85 + .3 * vnoise(vL * 5. + fAxis.w * 9.));
  return vec4(c, 1. - smoothstep(.72, .95, d));
}
vec4 stem() {
  float d = abs(vL.y) - 1.;
  float aa = fwidth(d) * .9;
  vec3 c = fCol.rgb * (1. + .4 * smoothstep(.2, -.8, vL.y));
  return vec4(c, (1. - smoothstep(-aa, aa, d)) * smoothstep(1.1, .9, abs(vL.x)));
}
void main() {
  int kind = int(fAxis.z + .5);
  vec4 s = kind == 0 ? blot() : kind == 1 ? spire() : kind == 2 ? crown() : kind == 3 ? wall() : kind == 4 ? leaf() : stem();
  if (fMore.z > 0.) {
    if (vUv.y < fMore.z) discard;
    s.a *= .55 + .45 * smoothstep(.25, .6, vnoise(vec2(vUv.x * uAspect * 60., vUv.y * 900.)));
    s.a *= 1. - .6 * smoothstep(0., fPos.z * 2.4, vUv.y - fMore.z);
  }
  vec3 c = mix(s.rgb, uHaze, hazeOf(fMore.w));
  outColor = vec4(c, s.a * fCol.a);
}`;

/** The plate as a backdrop: cover-fitted into the target rectangle, locked to the screen. */
export const BACKDROP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uPlate;
uniform vec4 uCrop;
uniform vec4 uRect;
out vec4 outColor;
void main() {
  vec2 f = (gl_FragCoord.xy - uRect.xy) / uRect.zw;
  outColor = vec4(texture(uPlate, uCrop.xy + vec2(f.x, 1. - f.y) * uCrop.zw).rgb, 1.);
}`;

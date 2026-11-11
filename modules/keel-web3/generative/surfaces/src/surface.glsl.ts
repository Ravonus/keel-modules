// The painters as fragment shaders. field.ts is the same arithmetic on the CPU, line for line: change both together.
// One pass draws both maps: the albedo, and the relief (the normal from the height's slope at four neighbours in RGB,
// the height in A). Row 0 of the target is the surface's top row, so a read-back is in image order.

/** A triangle that covers the target. */
export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 u[58];
uniform vec3 uView;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oRelief;

uint hh(uint a, uint b) {
  uint h = ((a ^ 0x9e3779b9u) * 0x85ebca6bu) ^ ((b + 0x632be5abu) * 0xc2b2ae35u);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}
uint cell(vec2 i, vec2 p) {
  uvec2 m = uvec2(ivec2(i) + ivec2(p)) % uvec2(p);
  return m.x + (m.y << 12u);
}
float rn(vec2 i, float p, uint s) { return float(hh(cell(i, vec2(p)), s)) / 4294967296.0; }
float vn(vec2 q, float p, uint s) {
  vec2 i = floor(q), f = q - i, w = f * f * (3.0 - 2.0 * f);
  float a = rn(i, p, s), b = rn(i + vec2(1, 0), p, s), c = rn(i + vec2(0, 1), p, s), d = rn(i + 1.0, p, s);
  float top = a + (b - a) * w.x, bottom = c + (d - c) * w.x;
  return top + (bottom - top) * w.y;
}
float fbm(vec2 q, float p, uint s, int n) {
  float t = 0.0, a = 0.5, w = 0.0;
  for (int k = 0; k < n; k++) { t += a * vn(q, p, s + uint(k)); w += a; q *= 2.0; p *= 2.0; a *= 0.5; }
  return t / w;
}
vec2 fib(vec2 uv, float n, uint s, float len, float wid) {
  vec2 g = uv * n, c = floor(g), r = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 i = c + vec2(x, y);
    uint k = cell(i, vec2(n)), h1 = hh(k, s), h2 = hh(k, s + 1u);
    vec2 o = i + vec2(h1 >> 16u, h1 & 65535u) / 65536.0;
    vec2 d = vec2(h2 >> 16u, h2 & 65535u) / 65536.0 - 0.5;
    d /= max(length(d), 1e-4);
    vec2 q = g - o;
    float t = clamp(dot(q, d), -len, len), e = 1.0 - smoothstep(wid * 0.5, wid, length(q - d * t));
    if (e > r.x) r = vec2(e, float(h2 & 255u) / 255.0);
  }
  return r;
}
float band(float t, float w) { return 1.0 - smoothstep(0.0, w, abs(fract(t) - 0.5)); }
`;

const PAPER = `
float fleck(vec2 uv, float m, uint s, float density) {
  vec2 g = uv * m, i = floor(g);
  uint h = hh(cell(i, vec2(m)), s);
  if (float(h & 1023u) / 1024.0 >= density) return 0.0;
  vec2 o = i + 0.3 + 0.4 * vec2((h >> 22u) & 1023u, (h >> 12u) & 1023u) / 1024.0;
  float r = 0.04 + 0.06 * float((h >> 10u) & 3u);
  return 1.0 - smoothstep(r * 0.5, r, length(g - o));
}
void surface(vec2 uv, out float h, out vec3 c) {
  uint s = uint(u[0].w);
  float n = u[3].x, p = u[3].w;
  float m = fbm(uv * p, p, s, 4), tooth = vn(uv * n * 4.0, n * 4.0, s + 5u);
  vec2 a = fib(uv, n, s + 10u, 0.9, 0.1), b = fib(uv, n * 2.0, s + 20u, 0.8, 0.12);
  float lines = (u[4].x > 0.0 ? 0.6 * band(uv.y * u[4].x, 0.12) : 0.0) + (u[4].y > 0.0 ? band(uv.x * u[4].y, 0.03) : 0.0);
  float fibre = 0.6 * a.x + 0.4 * b.x;
  h = 0.5 * m + 0.15 * tooth + u[3].y * fibre + u[4].z * lines;
  c = u[0].rgb * (1.0 + u[3].z * ((m - 0.5) * 2.0 + (tooth - 0.5) * 0.6));
  c *= 1.0 + u[3].y * (a.x * (0.03 - 0.6 * smoothstep(0.95, 0.99, a.y)) + 0.03 * b.x);
  c *= 1.0 + u[4].z * 0.08 * lines;
  float st = fbm(uv * 3.0, 3.0, s + 30u, 4), area = smoothstep(0.6, 0.66, st), rim = area * (1.0 - smoothstep(0.66, 0.7, st));
  c = mix(c, u[2].rgb, u[2].w * (0.35 * area + 0.5 * rim));
  c = mix(c, u[1].rgb, fleck(uv, n * 3.0, s + 40u, u[1].w));
}
`;

const KNIT = `
float leg(vec2 q, vec2 a, vec2 b, float r, out float ply) {
  vec2 ab = b - a;
  float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
  vec2 e = q - a - ab * t;
  float d = length(e) / r, side = (e.x * ab.y - e.y * ab.x) / (length(ab) * r);
  ply = abs(fract(t * u[3].y + side * 0.35) - 0.5) * 2.0;
  return sqrt(max(0.0, 1.0 - d * d)) * (0.8 + 0.8 * t * (1.0 - t));
}
void surface(vec2 uv, out float h, out vec3 c) {
  uint s = uint(u[0].w);
  float ribs = u[1].w, rows = u[2].w, a = rows / ribs, hw = u[3].x * 0.5 * a;
  float x = uv.x * ribs, y = uv.y * rows, col = floor(x), fx = (x - col - 0.5) * a;
  float best = 0.0, ply = 0.5, tone = 0.5;
  for (int k = -1; k <= 1; k++) {
    float row = floor(y) + float(k);
    uint hs = hh(cell(vec2(col, row), vec2(ribs, rows)), s);
    float j = u[3].w * (float(hs & 255u) / 255.0 - 0.5);
    for (int side = -1; side <= 1; side += 2) {
      float sd = float(side), pl;
      float e = leg(vec2(fx + j * 0.06 * a, y - row), vec2(sd * hw * 0.72, -0.18), vec2(sd * hw * 0.06, 1.08), hw * 0.46, pl);
      e *= 1.0 + 0.3 * j;
      if (e > best) { best = e; ply = pl; tone = float(hs >> 24u) / 255.0; }
    }
  }
  float gw = max(0.5 * a - hw, 1e-3), gd = (0.5 * a - abs(fx)) / gw, gy = (fract(y) - 0.5) / 0.32;
  float purl = 0.4 * sqrt(max(0.0, 1.0 - gd * gd - gy * gy));
  float fuzz = u[3].z, n = fbm(uv * ribs * 16.0, ribs * 16.0, s + 30u, 2), hair = fib(uv, ribs * 12.0, s + 40u, 0.6, 0.08).x;
  h = max(best, purl) + 0.12 * (ply - 0.5) * best;
  h = h * (1.0 - 0.1 * fuzz) + fuzz * (0.1 * n + 0.2 * hair);
  float k = clamp(h, 0.0, 1.0);
  c = mix(u[1].rgb, u[0].rgb, smoothstep(0.08, 0.6, k));
  c = mix(c, u[2].rgb, 0.6 * smoothstep(0.62, 1.0, k));
  c *= 0.96 + 0.08 * tone;
  c = mix(c, u[2].rgb, fuzz * 0.3 * hair);
}
`;

const PAINTED = `
vec3 folds(vec2 p, uint s) {
  vec2 d = u[7].xy;
  float slope = 0.0, crest = 0.0;
  for (int k = 0; k < 3; k++) {
    float f = float(k), wt = 1.0 / (1.0 + 1.6 * f);
    vec2 e = normalize(d + vec2(-d.y, d.x) * (f - 1.0) * 0.35);
    float ph = fract(dot(p, e) * u[4].w * (1.0 + 0.45 * f) + u[5].w * fbm(p * (1.5 + f), 1024.0, s + 10u + uint(k) * 4u, 3));
    slope += cos(3.1415927 * ph) * wt;
    crest = max(crest, sin(3.1415927 * ph) * wt);
  }
  float sh = clamp(0.5 + 0.3 * slope, 0.0, 1.0), gloss = smoothstep(0.7, 1.0, sh) * crest;
  vec3 c = mix(u[4].rgb, u[5].rgb, smoothstep(0.15, 0.6, sh));
  return mix(c, u[6].rgb, smoothstep(0.6, 0.95, sh)) + u[6].w * gloss * gloss * u[6].rgb;
}
void surface(vec2 uv, out float h, out vec3 c) {
  uint s = uint(u[0].w);
  vec2 p = vec2(uv.x * u[3].x, uv.y), bd = u[2].xy;
  float len = u[2].z, b = fbm(vec2(dot(p, bd) * len, dot(p, vec2(-bd.y, bd.x)) * len * 4.0), 1024.0, s, 3);
  c = u[0].rgb * (1.0 + u[3].z * (fbm(p * 3.0, 1024.0, s + 1u, 3) - 0.5) * 2.0);
  if (u[4].w > 0.0) c = folds(p, s);
  float top = 0.0;
  int count = int(u[3].y);
  for (int i = 0; i < 10; i++) {
    if (i >= count) break;
    int o = 8 + i * 5;
    vec4 at = u[o], ax = u[o + 1], dark = u[o + 2], lit = u[o + 3];
    vec2 d = p - at.xy, l = vec2(dot(d, ax.xy) / at.z, dot(d, vec2(-ax.y, ax.x)) / at.w);
    l.y /= max(mix(1.0, sqrt(max(1.0 - l.x * l.x, 0.0)), u[o + 4].x), 0.05);
    float r = length(l);
    if (r > 1.0 + 0.5 * dark.w) continue;
    r += dark.w * (fbm(p * 9.0, 1024.0, s + 60u + uint(i), 4) - 0.5);
    float mask = 1.0 - smoothstep(1.0 - ax.z, 1.0, r);
    float n = ax.w > 0.0
      ? fract(r * 2.6 + 1.1 * fbm(vec2((atan(l.y, l.x) / 6.2831853 + 0.5) * 6.0, r), 6.0, s + 80u + uint(i), 2))
      : 0.6 * fbm(vec2(l.x * 2.0 + float(i) * 7.0, l.y * 4.0), 1024.0, s + 80u, 2) + 0.4 * vn(vec2(l.x * 3.0, l.y * 14.0), 1024.0, s + 90u);
    float lt = clamp(0.5 - 0.4 * l.y + lit.w * (n - 0.5) * 2.0, 0.0, 1.0);
    vec3 m = mix(dark.rgb, lit.rgb, smoothstep(0.2, 0.9, lt)) * (0.85 + 0.15 * (1.0 - r * r));
    c = mix(c, m, mask);
    top = mix(top, n, mask);
  }
  c *= 1.0 + u[2].w * ((b - 0.5) * 1.2 + (vn(p * 240.0, 1024.0, s + 7u) - 0.5) * 0.5);
  c = mix(c, u[1].rgb, u[1].w * fbm(p * 1.5, 1024.0, s + 3u, 3));
  h = 0.5 + u[2].w * (b - 0.5) + 0.15 * top;
}
`;

const MAIN = `
void main() {
  vec2 px = 1.0 / uView.xy, uv = gl_FragCoord.xy * px, dx = vec2(px.x, 0.0), dy = vec2(0.0, px.y);
  float h, l, r, t, b;
  vec3 c, z;
  surface(uv, h, c);
  surface(uv - dx, l, z);
  surface(uv + dx, r, z);
  surface(uv - dy, t, z);
  surface(uv + dy, b, z);
  float k = 0.5 * uView.z * uView.y;
  oAlbedo = vec4(clamp(c, 0.0, 1.0), 1.0);
  oRelief = vec4(normalize(vec3((l - r) * k, (b - t) * k, 1.0)) * 0.5 + 0.5, clamp(h, 0.0, 1.0));
}`;

/** Each kind's fragment shader, by its number in `KINDS`. */
export const FRAGMENTS = [PAPER, KNIT, PAINTED].map((body) => PRELUDE + body + MAIN);

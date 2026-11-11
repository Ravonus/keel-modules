// The brush's shaders. Canvas pixels run x across and y down from the top left; a canvas texture's row 0 is the
// canvas's bottom, as WebGL draws. Colour is premultiplied linear light in half floats; relief is height in red and
// wetness in alpha.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

const NOISE = `
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
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
`;

/** One instance a stroke, six vertices a dab: dab i sits at i / (dabs - 1) along the quadratic chain. */
export const STROKE_VERT = `${HEAD}${NOISE}
uniform sampler2D uStrokes;
uniform int uBase;
uniform vec2 uCanvas;
out vec2 vL;
out vec2 vPx;
flat out vec4 fColour;
flat out vec4 fSize;
flat out vec4 fMore;
flat out vec4 fKind;
flat out vec4 fDab;
const float TIP_LEN[4] = float[4](1.0, 0.35, 0.6, 0.5);
vec2 pointAt(int row, int k) {
  vec4 t = texelFetch(uStrokes, ivec2(k >> 1, row), 0);
  return (k & 1) == 0 ? t.xy : t.zw;
}
// The chain's point at t and its rate of change along t.
void curve(int row, int n, float t, out vec2 p, out vec2 d) {
  if (n == 2) {
    vec2 a = pointAt(row, 0);
    vec2 b = pointAt(row, 1);
    p = mix(a, b, t); d = b - a; return;
  }
  int m = n - 2;
  float s = t * float(m);
  int j = min(int(floor(s)), m - 1);
  float u = s - float(j);
  vec2 c = pointAt(row, j + 1);
  vec2 a = j == 0 ? pointAt(row, 0) : .5 * (pointAt(row, j) + c);
  vec2 b = j == m - 1 ? pointAt(row, n - 1) : .5 * (c + pointAt(row, j + 2));
  p = mix(mix(a, c, u), mix(c, b, u), u);
  d = 2. * mix(c - a, b - c, u) * float(m);
}
void main() {
  int row = gl_InstanceID + uBase;
  vec4 kind = texelFetch(uStrokes, ivec2(7, row), 0);
  int dabs = int(kind.w + .5);
  int dab = gl_VertexID / 6;
  if (dab >= dabs) { gl_Position = vec4(2., 2., 2., 1.); return; }
  int corner = gl_VertexID % 6;
  vec2 L = vec2(corner == 1 || corner == 2 || corner == 4 ? 1. : -1., corner == 2 || corner == 4 || corner == 5 ? 1. : -1.);
  float t = float(dab) / float(dabs - 1);
  fSize = texelFetch(uStrokes, ivec2(5, row), 0);
  fMore = texelFetch(uStrokes, ivec2(6, row), 0);
  vec4 colour = texelFetch(uStrokes, ivec2(4, row), 0);
  vec2 p;
  vec2 d;
  curve(row, int(kind.z + .5), t, p, d);
  vec2 along = length(d) > 1e-5 ? normalize(d) : vec2(1., 0.);
  vec2 across = vec2(-along.y, along.x);
  float w = fSize.x * mix(fSize.y, 1., smoothstep(0., .3, t)) * mix(fSize.z, 1., smoothstep(1., .7, t));
  w = max(w, .5);
  float len = TIP_LEN[int(fMore.z + .5)];
  // Each dab's share of the opacity, so the dabs over one point add up to the stroke's.
  float spacing = length(d) / float(dabs - 1);
  float share = min(spacing / (2. * w * len), 1.);
  float flow = 1. - pow(1. - min(colour.a, .995), share);
  vec2 pad = L * 1.15;
  vec2 px = p + along * pad.x * w * len + across * pad.y * w;
  vL = pad;
  vPx = px;
  fColour = vec4(toLinear(colour.rgb), flow);
  fKind = vec4(kind.xy, t, kind.w);
  fDab = vec4(p, along * w);
  fSize.w *= 1. - .6 * t;
  fSize.y = share;
  gl_Position = vec4(px.x / uCanvas.x * 2. - 1., 1. - px.y / uCanvas.y * 2., 0., 1.);
}`;

/** A dab's coverage by tip, bristles and grain; its colour by medium. uOut 0 draws colour, 1 relief. */
export const STROKE_FRAG = `${HEAD}${NOISE}
uniform sampler2D uSnap;
uniform sampler2D uRelief;
uniform sampler2D uGrain;
uniform vec2 uCanvas;
uniform int uOut;
in vec2 vL;
in vec2 vPx;
flat in vec4 fColour;
flat in vec4 fSize;
flat in vec4 fMore;
flat in vec4 fKind;
flat in vec4 fDab;
out vec4 outColor;
float edge(float d, float aa) { return 1. - smoothstep(1. - aa, 1., d); }
float tipCover(int tip, vec2 L, float aa) {
  vec2 a = abs(L);
  if (tip == 0) return edge(length(L), aa);
  if (tip == 1) return edge(pow(pow(a.x, 6.) + pow(a.y, 6.), 1. / 6.), aa * 2.);
  if (tip == 2) return edge(pow(pow(a.x, 2.5) + pow(a.y, 2.5), .4), aa);
  float n = max(fMore.w, 2.);
  float k = fract((L.y * .5 + .5) * n);
  float hair = smoothstep(.1, .3, k) * smoothstep(.9, .7, k);
  return edge(pow(pow(a.x, 4.) + pow(a.y, 4.), .25), aa) * hair;
}
void main() {
  float w = length(fDab.zw);
  int tip = int(fMore.z + .5);
  float cover = tipCover(tip, vL, 1.5 / max(w, 1.));
  if (cover <= 0.) discard;
  float seed = fKind.y * 4096.;
  float hairs = clamp(w * .6, 3., 28.);
  float bristle = .72 + .28 * vnoise(vec2(vL.y * hairs, seed * 31. + vL.x * .15));
  float grain = texture(uGrain, vPx / 256.).r;
  float load = fSize.w;
  float dry = clamp((.45 - load) / .45, 0., 1.);
  cover *= mix(1., smoothstep(dry * .8 - .12, dry * .8 + .12, grain), dry);
  float a = cover * fColour.a * mix(1., bristle, .7);
  int medium = int(fKind.x + .5);
  vec2 uv = vec2(vPx.x / uCanvas.x, 1. - vPx.y / uCanvas.y);
  if (uOut == 1) {
    if (medium != 0) discard;
    // A stroke leaves about its height along its middle, however many dabs lay it.
    outColor = vec4(fMore.y * load * cover * fSize.y * bristle, 0., 0., min(fMore.x, 1.) * cover);
    return;
  }
  if (medium == 1) { outColor = vec4(mix(vec3(1.), fColour.rgb, a), 1.); return; }
  vec3 paint = fColour.rgb * (.96 + .08 * bristle);
  if (medium == 2) {
    float height = texture(uRelief, uv).r;
    a *= smoothstep(.45, .7, grain * .65 + clamp(height, 0., 1.) * .35 + .12 * load);
  } else {
    // Wet paint: the brush drags what was under it a little way back along the stroke. Wet 2 is a clean brush that
    // carries only what it picks up: a blender.
    vec2 back = (vPx - fDab.zw * .8) / uCanvas;
    vec4 under = texture(uSnap, vec2(back.x, 1. - back.y));
    bool clean = fMore.x > 1.5;
    float share = clean ? 1. : fMore.x * under.a * mix(.35, 1., fKind.z);
    if (clean) a *= under.a;
    paint = mix(paint, under.a > .01 ? under.rgb / under.a : paint, clamp(share, 0., 1.));
  }
  outColor = vec4(paint * a, a);
}`;

/** A triangle over the whole target, from the vertex id alone. */
export const FULL_VERT = `${HEAD}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

/** A glaze over the whole canvas, under a mask if given: the colour times the tint, in linear light. */
export const GLAZE_FRAG = `${HEAD}${NOISE}
uniform sampler2D uMask;
uniform int uMasked;
uniform vec3 uTint;
uniform float uOpacity;
uniform vec2 uCanvas;
out vec4 outColor;
void main() {
  float m = uMasked == 1 ? texture(uMask, gl_FragCoord.xy / uCanvas).r : 1.;
  outColor = vec4(mix(vec3(1.), toLinear(uTint), uOpacity * m), 1.);
}`;

/** A premultiplied texture the canvas's size laid over the canvas as opaque paint, at an opacity. */
export const FILL_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform float uOpacity;
uniform vec2 uCanvas;
out vec4 outColor;
void main() {
  outColor = texture(uSource, gl_FragCoord.xy / uCanvas) * uOpacity;
}`;

/** The layer's finish: the relief lit from one fixed key, and the canvas weave where the paint is thin. */
export const FINISH_FRAG = `${HEAD}
uniform sampler2D uColour;
uniform sampler2D uRelief;
uniform sampler2D uWeave;
uniform vec2 uCanvas;
uniform vec3 uKey;
uniform vec2 uLook;
out vec4 outColor;
float height(vec2 uv) {
  float h = max(texture(uRelief, uv).r, 0.);
  return h / (1. + h);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  vec2 tx = 1. / uCanvas;
  vec4 c = texture(uColour, uv);
  // Paint piles up softly: the height seen is h / (1 + h), its slope taken two pixels apart.
  float h = height(uv);
  float dx = height(uv + vec2(2. * tx.x, 0.)) - height(uv - vec2(2. * tx.x, 0.));
  float dy = height(uv + vec2(0., 2. * tx.y)) - height(uv - vec2(0., 2. * tx.y));
  vec3 n = normalize(vec3(-dx * uLook.x, -dy * uLook.x, 1.));
  float shade = 1. + (dot(n, uKey) - uKey.z);
  float thin = 1. - smoothstep(.04, .35, h);
  float weave = texture(uWeave, gl_FragCoord.xy / 256.).r;
  shade *= 1. - uLook.y * thin * (.55 - weave);
  outColor = vec4(c.rgb * max(shade, 0.), c.a);
}`;

/** Premultiplied linear into straight sRGB bytes. */
export const READ_FRAG = `${HEAD}${NOISE}
uniform sampler2D uColour;
uniform vec2 uCanvas;
out vec4 outColor;
void main() {
  vec4 c = texture(uColour, gl_FragCoord.xy / uCanvas);
  vec3 s = c.a > 1e-4 ? toSrgb(clamp(c.rgb / c.a, 0., 1.)) : vec3(0.);
  outColor = vec4(s, clamp(c.a, 0., 1.));
}`;

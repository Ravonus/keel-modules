// The layer ops on the GPU: a selection's mask from the id guide read through the warp, its feather, the mask on a
// finished layer, a layer onto the frame by blend mode with its edge bled into what lies behind, and the grade.
// Layer and frame textures are premultiplied linear half floats, row 0 their bottom; guides are RGBA8, row 0 their top.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** A triangle over the whole target. */
export const FULL_VERT = `${HEAD}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

/** A layer pixel's guide point, through the warp's grid (65 × 65 offsets, bilinear). */
const WARP = `
uniform sampler2D uWarp;
uniform vec2 uGuide;
uniform vec4 uBox;
uniform vec2 uCanvas;
vec2 node(ivec2 i) { return texelFetch(uWarp, clamp(i, ivec2(0), ivec2(64)), 0).rg; }
vec2 warped(vec2 p) {
  vec2 g = clamp(p / uGuide * 64., vec2(0.), vec2(64. - 1e-4));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec2 top = mix(node(i), node(i + ivec2(1, 0)), f.x);
  vec2 bottom = mix(node(i + ivec2(0, 1)), node(i + ivec2(1, 1)), f.x);
  return p + mix(top, bottom, f.y);
}
vec2 guidePoint() {
  vec2 q = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  return uBox.xy + q / uCanvas * uBox.zw;
}
`;

/** 1 where the id under the pixel is selected. */
export const MASK_FRAG = `${HEAD}${WARP}
uniform sampler2D uId;
uniform sampler2D uFlags;
out vec4 outColor;
void main() {
  vec2 s = warped(guidePoint());
  ivec2 at = clamp(ivec2(floor(s)), ivec2(0), ivec2(uGuide) - 1);
  int id = int(texelFetch(uId, at, 0).r * 255. + .5);
  outColor = vec4(texelFetch(uFlags, ivec2(id, 0), 0).r, 0., 0., 1.);
}`;

/**
 * An underpainting: the light guide through the warp, between the layer's levels and lifted as the planner reads it,
 * along a palette (lightest entry first), where the selection lets it. Premultiplied linear.
 */
export const UNDER_FRAG = `${HEAD}${WARP}
uniform sampler2D uId;
uniform sampler2D uFlags;
uniform sampler2D uLight;
uniform vec3 uPalette[8];
uniform int uCount;
uniform vec2 uLevels;
uniform float uShift;
out vec4 outColor;
vec3 linear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
void main() {
  vec2 s = warped(guidePoint());
  ivec2 at = clamp(ivec2(floor(s)), ivec2(0), ivec2(uGuide) - 1);
  int id = int(texelFetch(uId, at, 0).r * 255. + .5);
  float m = texelFetch(uFlags, ivec2(id, 0), 0).r;
  float l = texture(uLight, s / uGuide).r * 255.;
  float v = sqrt(clamp((l - uLevels.x) / max(uLevels.y - uLevels.x, 1.), 0., 1.));
  float t = clamp(1. - v + uShift, 0., 1.) * float(uCount - 1);
  int i = min(int(t), max(uCount - 2, 0));
  vec3 c = mix(uPalette[i], uPalette[min(i + 1, uCount - 1)], t - float(i));
  outColor = vec4(linear(c) * m, m);
}`;

/** A softened underpainting made opaque again: its colour where any of it reached. */
export const OPAQUE_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform vec2 uCanvas;
out vec4 outColor;
void main() {
  vec4 c = texture(uSource, gl_FragCoord.xy / uCanvas);
  outColor = c.a > .002 ? vec4(c.rgb / c.a, 1.) : vec4(0.);
}`;

/** A separable Gaussian along uDir, sigma uSigma pixels. */
export const BLUR_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform vec2 uCanvas;
uniform vec2 uDir;
uniform float uSigma;
uniform float uLift;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  if (uSigma < .3) { outColor = texture(uSource, uv); return; }
  vec4 sum = vec4(0.);
  float total = 0.;
  float step = max(uSigma / 6., 1.);
  for (int k = -18; k <= 18; k++) {
    float x = float(k) * step;
    float w = exp(-.5 * x * x / (uSigma * uSigma));
    sum += texture(uSource, uv + uDir * x / uCanvas) * w;
    total += w;
  }
  outColor = sum / total;
  // A grow: what the blur spread past the edge is lifted back to full.
  if (uLift > 0.) outColor = vec4(smoothstep(0., uLift, outColor.r), 0., 0., 1.);
}`;

/** The finished layer under its mask and opacity. */
export const APPLY_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform sampler2D uMask;
uniform vec2 uCanvas;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  outColor = texture(uSource, uv) * texture(uMask, uv).r * uOpacity;
}`;

/** The frame's start: the backdrop in linear light, or nothing. */
export const BACKDROP_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform int uHave;
uniform vec2 uCanvas;
out vec4 outColor;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  outColor = uHave == 1 ? vec4(toLinear(texture(uSource, vec2(uv.x, 1. - uv.y)).rgb), 1.) : vec4(0.);
}`;

/** One layer over the frame: its blend mode, and its edge bled toward the colour behind it. */
export const COMPOSE_FRAG = `${HEAD}
uniform sampler2D uFrame;
uniform sampler2D uLayer;
uniform vec2 uCanvas;
uniform vec4 uBox;
uniform int uMode;
uniform vec2 uBleed;
out vec4 outColor;
float lum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
vec3 setLum(vec3 c, float l) { return c + (l - lum(c)); }
vec3 blend(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return mix(2. * b * s, 1. - 2. * (1. - b) * (1. - s), step(.5, b));
  if (uMode == 4) return (1. - 2. * s) * b * b + 2. * s * b;
  if (uMode == 5) return setLum(s, lum(b));
  if (uMode == 6) return setLum(b, lum(s));
  if (uMode == 7) return b + s;
  return s;
}
vec4 layerAt(vec2 frame) {
  vec2 u = (frame - uBox.xy) / uBox.zw;
  if (any(lessThan(u, vec2(0.))) || any(greaterThan(u, vec2(1.)))) return vec4(0.);
  return texture(uLayer, vec2(u.x, 1. - u.y));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uCanvas;
  vec2 f = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec4 d = texture(uFrame, uv);
  vec4 s = layerAt(f);
  if (s.a <= 0.) { outColor = d; return; }
  vec3 sc = s.rgb / s.a;
  if (uBleed.y > 0.) {
    float a = 0.;
    vec4 behind = vec4(0.);
    for (int k = 0; k < 12; k++) {
      float t = float(k) * .5236;
      vec2 o = vec2(cos(t), sin(t)) * uBleed.x;
      a += layerAt(f + o).a;
      behind += texture(uFrame, (gl_FragCoord.xy + o * 2.) / uCanvas);
    }
    a /= 12.;
    float band = clamp(4. * a * (1. - a), 0., 1.) * uBleed.y;
    if (behind.a > 0.) sc = mix(sc, behind.rgb / behind.a, band);
  }
  vec3 bc = d.a > 0. ? d.rgb / d.a : sc;
  vec3 c = mix(sc, blend(bc, sc), d.a > 0. ? 1. : 0.);
  float outA = s.a + d.a * (1. - s.a);
  outColor = vec4(c * s.a + d.rgb * (1. - s.a), outA);
}`;

/** Lift, gamma, gain, warmth and saturation, in linear light. */
export const GRADE_FRAG = `${HEAD}
uniform sampler2D uSource;
uniform vec2 uCanvas;
uniform vec4 uGrade;
uniform float uSaturation;
out vec4 outColor;
void main() {
  vec4 c = texture(uSource, gl_FragCoord.xy / uCanvas);
  if (c.a <= 0.) { outColor = c; return; }
  vec3 v = c.rgb / c.a;
  v = pow(max(v * uGrade.z + uGrade.x * (1. - v), 0.), vec3(1. / uGrade.y));
  v *= vec3(1. + uGrade.w, 1. + uGrade.w * .25, 1. - uGrade.w);
  float l = dot(v, vec3(.2126, .7152, .0722));
  v = mix(vec3(l), v, uSaturation);
  outColor = vec4(v * c.a, c.a);
}`;

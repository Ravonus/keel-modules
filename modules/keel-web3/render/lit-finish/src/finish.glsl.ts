// The finish's shaders: a full-screen quad, ambient occlusion from depth, the light (AO, aerial haze), TAA, bloom
// and the grade (tone map, grade, sRGB). GLSL ES 1 as keel/lit's CustomMaterial takes it.

export const VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Depth to view space, shared by both passes. */
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
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export const AO_GLSL = /* glsl */ `
precision highp float;
${VIEW_GLSL}
uniform vec2 uTexel;
uniform vec2 uAoSize;
uniform float uRadius;
uniform vec3 uKernel[16];
// The surface's normal from its neighbours' depths, from the nearer side of each pair so edges stay clean.
vec3 normalAt(vec2 uv, vec3 p) {
  vec3 r = viewAt(uv + vec2(uTexel.x, 0.0)) - p;
  vec3 l = p - viewAt(uv - vec2(uTexel.x, 0.0));
  vec3 u = viewAt(uv + vec2(0.0, uTexel.y)) - p;
  vec3 d = p - viewAt(uv - vec2(0.0, uTexel.y));
  return normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uAoSize;
  if (texture2D(tDepth, uv).x >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewAt(uv);
  vec3 n = normalAt(uv, p);
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 spin = vec3(cos(a), sin(a), 0.0);
  vec3 t = normalize(spin - n * dot(spin, n));
  mat3 tbn = mat3(t, cross(n, t), n);
  float occluded = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 s = p + tbn * uKernel[i] * uRadius;
    vec2 ndc = uOrtho > 0.5 ? s.xy * uProj : s.xy * uProj / -s.z;
    vec2 at = ndc * 0.5 + 0.5;
    if (at.x < 0.0 || at.y < 0.0 || at.x > 1.0 || at.y > 1.0) continue;
    float surface = -viewDepth(texture2D(tDepth, at).x);
    float near = smoothstep(0.0, 1.0, uRadius / max(abs(p.z - surface), 1e-4));
    occluded += step(s.z + 0.03 * uRadius, surface) * near;
  }
  // (Squared: the open share of the hemisphere, as the eye reads contact shade.)
  float open = 1.0 - occluded / 16.0;
  gl_FragColor = vec4(vec3(open * open), 1.0);
}
`;

const TONEMAP_GLSL = /* glsl */ `
// AgX (Troy Sobotka's, in Benjamin Wrensch's fit), back to linear display light.
vec3 agx(vec3 c) {
  const mat3 into = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 back = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  vec3 x = clamp(log2(max(into * c, vec3(1e-10))), -12.47393, 4.026069);
  x = (x + 12.47393) / 16.499999;
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  x = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return pow(max(back * x, vec3(0.0)), vec3(2.2));
}
// Khronos PBR Neutral.
vec3 neutral(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float top = 1.0 - 0.0576 / (peak - 0.52);
  c *= top / peak;
  return mix(c, vec3(top), 1.0 - 1.0 / (0.15 * (peak - top) + 1.0));
}
// ACES, Narkowicz's fit.
vec3 aces(vec3 c) {
  c *= 0.6;
  return clamp(c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}
vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/** Pass 3: the lit picture's own light, in linear HDR: AO, the aerial haze, exposure. */
export const LIGHT_GLSL = /* glsl */ `
precision highp float;
${VIEW_GLSL}
uniform sampler2D tColor;
uniform sampler2D tAo;
uniform vec2 uSize;
uniform vec2 uAoSize;
uniform float uAo;
uniform float uExposure;
uniform vec3 uHaze;
uniform float uHazeDensity;
uniform float uHazeStart;
uniform float uHazeGlow;
uniform float uBackdrop;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform float uView;
// The half-size AO, blurred over 4x4 of its texels among those at the same depth, so its noise is gone and
// nothing bleeds across a silhouette.
float aoAt(vec2 uv, float z) {
  float sum = 0.0;
  float weight = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 at = uv + (vec2(float(x), float(y)) - 1.5) / uAoSize;
      float w = exp(-abs(viewDepth(texture2D(tDepth, at).x) - z) / (0.05 * z + 0.02));
      sum += texture2D(tAo, at).r * w;
      weight += w;
    }
  }
  return weight > 0.0 ? sum / weight : 1.0;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture2D(tColor, uv).rgb;
  bool sky = texture2D(tDepth, uv).x >= 0.99999;
  vec3 p = viewAt(uv);
  float occlusion = sky ? 1.0 : aoAt(uv, -p.z);
  if (uView > 0.5) { gl_FragColor = vec4(vec3(occlusion), 1.0); return; }
  c *= mix(1.0, occlusion, uAo);
  // Aerial haze: the air between the eye and the point, lit brighter toward the sun (Henyey-Greenstein, g 0.6,
  // 4pi-normalized: 10 toward the sun). A backdrop at the far plane has its own air and takes none.
  float dist = sky ? 1e5 : length(p);
  float through = sky && uBackdrop > 0.5 ? 1.0 : exp(-max(dist - uHazeStart, 0.0) * uHazeDensity);
  float mu = dot(normalize(p), uSunDir);
  float lobe = 0.64 / pow(1.36 - 1.2 * mu, 1.5);
  vec3 air = uHaze * (1.0 + uSunColour * uHazeGlow * lobe * 0.15);
  c = mix(air, c, uHazeDensity > 0.0 ? through : 1.0);
  gl_FragColor = vec4(c * uExposure, 1.0);
}
`;

/**
 * Pass 4: TAA. This frame (jittered) against the last, found where it was through the depth and last frame's
 * camera, held inside this frame's 3x3 neighbourhood so nothing that moved trails. A backdrop moves with the camera,
 * so its last frame is at the same place on screen.
 */
export const TAA_GLSL = /* glsl */ `
precision highp float;
${VIEW_GLSL}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform vec2 uSize;
uniform mat4 uInvView;
uniform mat4 uPrevViewProj;
uniform float uBlend;
uniform float uReset;
uniform float uBackdrop;
// Weighted by 1/(1+luma), so one bright pixel does not ring over its neighbours.
vec3 tame(vec3 c) { return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
vec3 untame(vec3 c) { return c / max(1.0 - dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 current = tame(texture2D(tCurrent, uv).rgb);
  vec3 low = current;
  vec3 high = current;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 n = tame(texture2D(tCurrent, uv + vec2(float(x), float(y)) / uSize).rgb);
      low = min(low, n);
      high = max(high, n);
    }
  }
  vec4 before = uPrevViewProj * (uInvView * vec4(viewAt(uv), 1.0));
  bool held = uBackdrop > 0.5 && texture2D(tDepth, uv).x >= 0.99999;
  vec2 then = held ? uv : before.xy / before.w * 0.5 + 0.5;
  bool lost = uReset > 0.5 || then.x < 0.0 || then.y < 0.0 || then.x > 1.0 || then.y > 1.0;
  vec3 history = clamp(tame(texture2D(tHistory, then).rgb), low, high);
  gl_FragColor = vec4(untame(lost ? current : mix(history, current, uBlend)), 1.0);
}
`;

/** Pass 5: what is brighter than the threshold, at quarter size (a 2x2 box of the resolved picture). */
export const BRIGHT_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tResolved;
uniform vec2 uBloomSize;
uniform vec2 uSize;
uniform float uThreshold;
void main() {
  vec2 uv = gl_FragCoord.xy / uBloomSize;
  vec2 t = 1.0 / uSize;
  vec3 c = 0.25 * (texture2D(tResolved, uv + vec2(-t.x, -t.y)).rgb + texture2D(tResolved, uv + vec2(t.x, -t.y)).rgb
    + texture2D(tResolved, uv + vec2(-t.x, t.y)).rgb + texture2D(tResolved, uv + vec2(t.x, t.y)).rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * max(l - uThreshold, 0.0) / max(l, 1e-4), 1.0);
}
`;

/** Pass 6 and 7: a wide Gaussian along uDir (texels), nine taps on linear filtering. */
export const BLUR_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tBlur;
uniform vec2 uBloomSize;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uBloomSize;
  vec2 d = uDir / uBloomSize;
  vec3 c = texture2D(tBlur, uv).rgb * 0.2270270270;
  c += (texture2D(tBlur, uv + d * 1.3846153846).rgb + texture2D(tBlur, uv - d * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tBlur, uv + d * 3.2307692308).rgb + texture2D(tBlur, uv - d * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Pass 8, onto the canvas: bloom, the tone map, the grade, sRGB and a half-step of noise against banding. */
export const GRADE_GLSL = /* glsl */ `
precision highp float;
${TONEMAP_GLSL}
uniform sampler2D tResolved;
uniform sampler2D tBloom;
uniform vec2 uSize;
uniform float uBloom;
uniform float uTone;
uniform float uSaturation;
uniform float uContrast;
uniform float uWarmth;
uniform float uVignette;
uniform float uView;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture2D(tResolved, uv).rgb;
  if (uView > 0.5) { gl_FragColor = vec4(srgb(clamp(c, 0.0, 1.0)), 1.0); return; }
  c += texture2D(tBloom, uv).rgb * uBloom;
  vec3 m = uTone < 0.5 ? agx(c) : (uTone < 1.5 ? neutral(c) : aces(c));
  float l = dot(m, vec3(0.2126, 0.7152, 0.0722));
  m = max(mix(vec3(l), m, uSaturation), 0.0);
  m = mix(m, m * vec3(0.92, 0.98, 1.1), uWarmth * (1.0 - clamp(l * 2.0, 0.0, 1.0)));
  m = mix(m, m * vec3(1.08, 1.0, 0.88), uWarmth * clamp(l * 1.5 - 0.3, 0.0, 1.0));
  vec3 s = srgb(clamp(m, 0.0, 1.0));
  s = clamp((s - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 q = uv - 0.5;
  s *= 1.0 - uVignette * dot(q, q) * 1.6;
  gl_FragColor = vec4(s + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}
`;

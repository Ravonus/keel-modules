// The motes' shaders. A mote's whole life is a closed form of the time the host hands in, so any frame can be drawn
// on its own, in any order, and a paused clock is a still field.

/**
 * `vec3 motePath(vec4 mote, vec4 life, float t)`: where a mote is at time t. The base place drifts with `uDrift` and
 * wraps in the box (`uBoxMin`, `uBox`), then wanders by hashed sines `uTurbulence` world units across. A mesh-instanced
 * variant (coins, confetti) can include this and orient its own geometry about the result.
 * `float moteFade(vec3 p)`: 0 at a wrapping face of the box, 1 a little inside it, so wrapping never pops.
 */
export const MOTE_PATH_GLSL = /* glsl */ `
uniform vec3 uDrift, uBoxMin, uBox;
uniform float uTurbulence;
vec3 motePath(vec4 mote, vec4 life, float t) {
  vec3 p = mote.xyz + uDrift * t - uBoxMin;
  p = uBoxMin + p - uBox * floor(p / uBox);
  float s = life.w * 61.0 + mote.w;
  vec3 a = vec3(0.37, 0.29, 0.23) * t + vec3(s, s * 1.7, s * 2.9);
  vec3 b = vec3(0.83, 0.71, 0.59) * t + vec3(s * 2.3, s * 3.1, s * 1.3);
  return p + uTurbulence * (sin(a) + 0.5 * sin(b)) / 1.5;
}
float moteFade(vec3 p) {
  vec3 f = fract((p - uBoxMin) / uBox);
  vec3 edge = clamp(min(f, 1.0 - f) * 16.0, 0.0, 1.0);
  vec3 moving = step(1e-6, abs(uDrift));
  vec3 fade = mix(vec3(1.0), edge, moving);
  return fade.x * fade.y * fade.z;
}
`;

export const MOTE_VERTEX = /* glsl */ `
attribute vec4 aMote;
attribute vec4 aLife;
attribute vec3 aColor;
uniform float uTime, uBlink, uOpacity, uIntensity, uMinPixels;
uniform vec2 uPixel;
varying vec2 vUv;
varying vec4 vColor;
varying float vSparkle;
${MOTE_PATH_GLSL}
void main() {
  float t = uTime;
  vec3 p = motePath(aMote, aLife, t);
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * view;
  // (A sparkle's rays reach past its core, so its quad is three times as wide.)
  float reach = mix(1.0, 3.0, aLife.z);
#ifdef ATTENUATE
  float pixels = aLife.y * projectionMatrix[1][1] / max(clip.w, 1e-4) / uPixel.y;
#else
  float pixels = aLife.y;
#endif
  float shown = max(pixels, uMinPixels);
  float dim = (pixels * pixels) / max(shown * shown, 1e-8);
  clip.xy += position.xy * reach * shown * uPixel * clip.w;
  gl_Position = clip;
  float wave = 0.5 + 0.5 * sin(6.2831853 * t / aLife.x + aMote.w);
  float alpha = uOpacity * mix(1.0, wave * wave, uBlink) * dim * moteFade(p);
  vUv = position.xy * 2.0;
  vColor = vec4(aColor * uIntensity, alpha);
  vSparkle = aLife.z;
}
`;

export const MOTE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vSparkle;
void main() {
  // (A dot: a soft round sprite, nothing at the quad's edge. A sparkle: a core and four rays, on a quad 3x as wide.)
  float r2 = dot(vUv, vUv);
  float soft = max(0.0, 1.0 - r2);
  float dot2 = soft * soft;
  vec2 a = abs(vUv);
  float rays = max(0.0, 1.0 - a.x) * exp(-a.y * 48.0) + max(0.0, 1.0 - a.y) * exp(-a.x * 48.0);
  float star = exp(-r2 * 24.0) + rays * 0.7;
  float shape = mix(dot2, star, vSparkle);
  if (shape * vColor.a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * shape);
}
`;

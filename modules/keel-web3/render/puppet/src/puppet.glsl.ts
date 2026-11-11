// The painted layers' shaders: unlit, premultiplied alpha. SLIDE moves the paint inside the layer's own matte (gaze),
// CLIP shows the layer only inside another layer's matte (lids in the eye), DISSOLVE crosses two painted states
// through a fixed grain so each pixel is one state or the other, never both at half, and MATTE writes only depth.

export const PUPPET_VERTEX = /* glsl */ `
varying vec2 vUv;
#ifdef CLIP
attribute vec2 aClip;
varying vec2 vClip;
#endif
void main() {
  vUv = uv;
#ifdef CLIP
  vClip = aClip;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PUPPET_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
#ifdef SLIDE
uniform vec2 uSlide;
#endif
#ifdef CLIP
uniform sampler2D uClip;
varying vec2 vClip;
#endif
#ifdef DISSOLVE
uniform float uDissolve, uSide, uCells;
float cellOf(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float grain(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cellOf(i), cellOf(i + vec2(1, 0)), f.x), mix(cellOf(i + vec2(0, 1)), cellOf(i + vec2(1, 1)), f.x), f.y);
}
#endif
void main() {
  vec4 c = texture2D(uMap, vUv);
#ifdef SLIDE
  // (The moved paint over the paint at rest, kept inside the matte at rest.)
  vec4 moved = texture2D(uMap, vUv + uSlide);
  vec4 over = moved + c * (1.0 - moved.a);
  c = over * (c.a / max(over.a, 1e-4));
#endif
  float a = uOpacity;
#ifdef CLIP
  vec2 inside = step(vec2(0.0), vClip) * step(vClip, vec2(1.0));
  a *= inside.x * inside.y * texture2D(uClip, vClip).a;
#endif
#ifdef DISSOLVE
  // (At 0 every pixel is the first state and at 1 the second: the threshold runs a little past the grain's range.)
  float d = smoothstep(-0.04, 0.04, uDissolve * 1.16 - 0.08 - grain(vUv * uCells));
  a *= mix(1.0 - d, d, uSide);
#endif
  c *= a;
#ifdef MATTE
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(0.0);
#else
  if (c.a < 0.002) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;

// The butterflies' shaders. Each wing beats on two bones: the inner part swings about the body, the outer part a
// third further, so the wing bends as it beats. The edge light is white past the colour, for the host's bloom.

export const BUTTERFLY_VERTEX = /* glsl */ `
attribute vec2 aWing;
attribute float aFlap;
uniform float uTime, uFlapHz, uStill;
varying vec2 vWing;
varying float vShade;
void main() {
  float beat = sin(6.2831853 * uFlapHz * uTime + aFlap);
  // (Wings from 30 degrees under level to 70 over; still, open and a little raised.)
  float a = mix(0.35 + 0.87 * beat, 0.15, uStill);
  float b = a * 1.35;
  float span = position.x;
  float inner = min(span, 0.45);
  float outer = max(span - 0.45, 0.0);
  vec2 xy = inner * vec2(cos(a), sin(a)) + outer * vec2(cos(b), sin(b));
  float side = aWing.x;
  vec3 p = side == 0.0 ? position : vec3(xy.x * side, xy.y, position.z);
  // (The body rises as the wings come down.)
  p.y -= 0.06 * beat * (1.0 - uStill);
  vec3 n = side == 0.0 ? vec3(0.0, 1.0, 0.0) : vec3(-sin(a) * side, cos(a), 0.0);
  vec3 world = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vShade = 0.6 + 0.4 * abs(world.y);
  vWing = aWing;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

export const BUTTERFLY_FRAGMENT = /* glsl */ `
uniform vec3 uUpper, uUnder, uBody;
uniform float uGlow, uLight;
varying vec2 vWing;
varying float vShade;
void main() {
  vec3 wing = gl_FrontFacing ? uUpper : uUnder;
  vec3 base = mix(uBody, wing, abs(vWing.x));
  float rim = smoothstep(0.55, 1.0, vWing.y);
  vec3 c = base * uLight * vShade + rim * uGlow * mix(base, vec3(1.0), 0.65);
  gl_FragColor = vec4(c, 1.0);
}
`;

// The hand-over's shaders: a full-screen quad, and one pass that blends two finished pictures. GLSL ES 1 as keel/lit's
// CustomMaterial takes it.

export const BLEND_VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Two finished pictures, A outgoing and B incoming, into one; either may be smaller than the frame. Lines are luma
 * edges by a Roberts cross, one texel of that picture apart, so they stay thin. The fill follows a field that rises
 * from 0 to 1: the noise (mode 0), or the distance from a centre roughened by the noise (mode 1); a pixel shows B
 * once the reveal level passes its field, through a soft boundary that glows faintly. Mode 2 is a plain dissolve.
 */
export const BLEND_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tNoise;
uniform vec2 uSize;
uniform vec2 uTexelA;
uniform vec2 uTexelB;
uniform float uMode;
uniform float uFill;
uniform float uLinesIn;
uniform float uLinesOut;
uniform float uDarken;
uniform vec3 uLine;
uniform float uLineStrength;
uniform float uEdge;
uniform float uSoft;
uniform vec3 uSeam;
uniform float uGlow;
uniform float uSeamWidth;
uniform float uNoiseScale;
uniform vec2 uCentre;
uniform float uReach;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lines(sampler2D t, float here, vec2 uv, vec2 px) {
  float right = luma(texture2D(t, uv + vec2(px.x, 0.0)).rgb);
  float up = luma(texture2D(t, uv + vec2(0.0, px.y)).rgb);
  float across = luma(texture2D(t, uv + px).rgb);
  return smoothstep(uEdge, uEdge * 3.0, length(vec2(here - across, right - up)));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 a = texture2D(tA, uv).rgb;
  vec3 b = texture2D(tB, uv).rgb;
  if (uMode > 1.5) { gl_FragColor = vec4(mix(a, b, uFill) * (1.0 - uDarken), 1.0); return; }
  float aspect = uSize.x / uSize.y;
  float n = texture2D(tNoise, vec2(uv.x * aspect, uv.y) * uNoiseScale).r;
  float field = n;
  if (uMode > 0.5) field = mix(length((uv - uCentre) * vec2(aspect, 1.0)) / uReach, n, 0.18);
  float level = uFill * (1.0 + 2.0 * uSoft) - uSoft;
  float fill = 1.0 - smoothstep(level - uSoft, level + uSoft, field);
  float seam = (1.0 - smoothstep(0.0, uSeamWidth, abs(field - level))) * step(0.0001, uFill) * step(uFill, 0.9999);
  float la = uLinesOut > 0.0 ? lines(tA, luma(a), uv, uTexelA) : 0.0;
  float lb = uLinesIn > 0.0 ? lines(tB, luma(b), uv, uTexelB) : 0.0;
  vec3 outgoing = mix(a, vec3(0.0), uLinesOut * 0.6) + uLine * la * uLinesOut * uLineStrength;
  vec3 c = mix(outgoing, b, fill);
  c += uLine * lb * uLinesIn * uLineStrength * (1.0 - 0.6 * fill);
  c += uSeam * seam * seam * uGlow * 0.25;
  gl_FragColor = vec4(clamp(c * (1.0 - uDarken), 0.0, 1.0), 1.0);
}
`;

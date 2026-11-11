// The hand-over's shaders: a full-screen quad, and one pass that blends two finished pictures. GLSL ES 1 as keel/lit's
// CustomMaterial takes it.

export const BLEND_VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Two finished pictures, A outgoing and B incoming, into one. Lines are luma edges (Sobel, one pixel apart). The fill
 * follows a field that rises from 0 to 1: the noise (mode 0), or the distance from a centre roughened by the noise
 * (mode 1); a pixel shows B once the reveal level passes its field, and the boundary carries the seam, its width
 * in pixels. Mode 2 is a plain dissolve with no lines, noise or seam.
 */
export const BLEND_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tNoise;
uniform vec2 uSize;
uniform float uMode;
uniform float uFill;
uniform float uLinesIn;
uniform float uLinesOut;
uniform float uDarken;
uniform vec3 uLine;
uniform vec3 uSeam;
uniform float uGlow;
uniform float uSeamWidth;
uniform float uEdge;
uniform float uNoiseScale;
uniform vec2 uCentre;
uniform float uReach;
float luma(sampler2D t, vec2 uv) { return dot(texture2D(t, uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }
float lines(sampler2D t, vec2 uv, vec2 px) {
  float tl = luma(t, uv + vec2(-px.x, px.y));
  float tc = luma(t, uv + vec2(0.0, px.y));
  float tr = luma(t, uv + px);
  float ml = luma(t, uv - vec2(px.x, 0.0));
  float mr = luma(t, uv + vec2(px.x, 0.0));
  float bl = luma(t, uv - px);
  float bc = luma(t, uv - vec2(0.0, px.y));
  float br = luma(t, uv + vec2(px.x, -px.y));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  return smoothstep(uEdge, uEdge * 2.5, sqrt(gx * gx + gy * gy));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 a = texture2D(tA, uv).rgb;
  vec3 b = texture2D(tB, uv).rgb;
  if (uMode > 1.5) { gl_FragColor = vec4(mix(a, b, uFill) * (1.0 - uDarken), 1.0); return; }
  vec2 px = 1.0 / uSize;
  float aspect = uSize.x / uSize.y;
  float n = texture2D(tNoise, vec2(uv.x * aspect, uv.y) * uNoiseScale).r;
  float field = n;
  if (uMode > 0.5) field = mix(length((uv - uCentre) * vec2(aspect, 1.0)) / uReach, n, 0.18);
  // (The fill's edge and the seam are measured in pixels across the field, so they stay crisp wherever it is flat.)
  float w = max(fwidth(field), 0.0015);
  float level = uFill * 1.02 - 0.01;
  float fill = 1.0 - smoothstep(level - w, level + w, field);
  float seam = 1.0 - smoothstep(0.0, uSeamWidth * uSize.y, abs(field - level) / w);
  seam *= step(0.0001, uFill) * step(uFill, 0.9999);
  float la = uLinesOut > 0.0 ? lines(tA, uv, px) : 0.0;
  float lb = uLinesIn > 0.0 ? lines(tB, uv, px) : 0.0;
  vec3 outgoing = mix(a, vec3(0.0), uLinesOut * 0.85) + uLine * la * uLinesOut;
  vec3 c = mix(outgoing, b, fill);
  c += uLine * lb * uLinesIn * (1.0 - 0.5 * fill);
  c += uSeam * seam * uGlow * (1.0 - fill * 0.5);
  gl_FragColor = vec4(clamp(c * (1.0 - uDarken), 0.0, 1.0), 1.0);
}
`;

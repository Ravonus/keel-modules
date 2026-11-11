// The section pass: one full-screen fragment over the finished frame. GLSL ES 1 as keel/lit's CustomMaterial takes
// it. The blur's two passes are lit-finish's own BLUR_GLSL, passed in.

export const POST_VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * The finished frame, blurred and darkened under a paper panel. The panel covers frame heights `uPosition` to
 * `uPosition + 1` (y up), each edge strayed along x by the broad noise times the tear; it fills in from inside toward
 * its fraying edges as its presence (`uProgress` folded to 0..1..0) rises; a band of lighter fibres runs inside each
 * edge, with hairs past it; one-pixel grain lies over everything.
 */
export const POST_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tBlurred;
uniform sampler2D tNoise;
uniform vec2 uSize;
uniform float uNoiseScale;
uniform float uProgress;
uniform float uPosition;
uniform vec3 uColour;
uniform float uTear;
uniform float uTearReach;
uniform float uFibre;
uniform float uPaper;
uniform float uGrain;
uniform float uDarken;
uniform float uBlur;
// How far an edge strays from its line at x (frame heights), from the broad noise and a little of the fine.
float stray(float x, float row) {
  float broad = texture2D(tNoise, vec2(x * 0.45, row)).g - 0.5;
  float fine = texture2D(tNoise, vec2(x * 3.1, row + 0.37)).r - 0.5;
  return (broad * 1.6 + fine * 0.4) * uTearReach * uTear;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture2D(tColor, uv).rgb;
  if (uBlur > 0.0) c = mix(c, texture2D(tBlurred, uv).rgb, smoothstep(0.0, 0.02, uBlur));
  c *= 1.0 - uDarken;
  float x = uv.x * uSize.x / uSize.y;
  float px = 1.0 / uSize.y;
  float top = uPosition + 1.0 + stray(x, 0.21);
  float bottom = uPosition + stray(x, 0.68);
  float inside = smoothstep(bottom - px, bottom + px, uv.y) * (1.0 - smoothstep(top - px, top + px, uv.y));
  vec4 n = texture2D(tNoise, vec2(x, uv.y) * uNoiseScale);
  // The panel fills in from its inside toward its edges, which fray through the noise; out, the other way round.
  float depth = min(uv.y - bottom, top - uv.y);
  float field = mix(1.0 - clamp(depth / 0.35, 0.0, 1.0), n.r, 0.45);
  float presence = 1.0 - abs(1.0 - uProgress);
  float w = max(fwidth(field), 0.0015);
  float level = presence * 1.02 - 0.01;
  float shown = presence >= 1.0 ? 1.0 : 1.0 - smoothstep(level - w, level + w, field);
  // Fibres: a lighter band inside each edge, and hairs past it, streaked along y and wider where the edge is torn.
  float band = (2.0 + 5.0 * uTear * texture2D(tNoise, vec2(x * 9.0, 0.5)).r) * px;
  float streak = texture2D(tNoise, vec2(x * 40.0, uv.y * 3.0)).r;
  float rim = (1.0 - smoothstep(0.0, band, depth)) * inside;
  float hair = (1.0 - smoothstep(0.0, band * 4.0, -depth)) * step(depth, 0.0) * step(0.6, streak);
  vec3 paper = uColour * (1.0 - uPaper * 0.06 * (texture2D(tNoise, vec2(x, uv.y) * 6.0).r - 0.5));
  vec3 fibreColour = mix(uColour, vec3(1.0), 0.7);
  c = mix(c, mix(paper, fibreColour, uFibre * rim * (0.55 + 0.45 * n.b)), inside * shown);
  c = mix(c, fibreColour, uFibre * hair * 0.8 * shown);
  float grain = texture2D(tNoise, gl_FragCoord.xy / 256.0).b - 0.5;
  gl_FragColor = vec4(clamp(c + grain * uGrain, 0.0, 1.0), 1.0);
}
`;

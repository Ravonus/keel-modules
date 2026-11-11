// The section pass: one full-screen fragment over the finished frame. GLSL ES 1 as keel/lit's CustomMaterial takes
// it. The blur's two passes are lit-finish's own BLUR_GLSL, passed in.

export const POST_VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * The finished frame, blurred and darkened, under a paper panel between heights `uBottom` and `uTop` (frame heights,
 * y up). A torn edge is a line y = f(x): a gentle wander from the broad noise plus fine jaggedness from the white
 * noise, both times the tear, so it never breaks into islands. Past each edge lie a thin band of lighter fibres, a
 * few hairs where torn, and a soft shadow on the frame. One-pixel grain lies over everything.
 */
export const POST_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tBlurred;
uniform sampler2D tNoise;
uniform vec2 uSize;
uniform float uNoiseScale;
uniform float uBottom;
uniform float uTop;
uniform vec3 uColour;
uniform float uTear;
uniform float uTearReach;
uniform float uFibre;
uniform float uShadow;
uniform float uPaper;
uniform float uGrain;
uniform float uDarken;
uniform float uBlur;
// How far an edge strays from its line at x (frame heights): a slow wander, a ragged middle and fine jags on it.
float stray(float x, float row) {
  float wander = texture2D(tNoise, vec2(x * 0.9, row)).g - 0.5;
  float ragged = texture2D(tNoise, vec2(x * 2.5, row + 0.13)).r - 0.5;
  float jag = texture2D(tNoise, vec2(x * 0.7, row + 0.31)).b - 0.5;
  return (wander + ragged * 0.6 + jag * 0.35) * uTearReach * uTear;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture2D(tColor, uv).rgb;
  if (uBlur > 0.0) c = mix(c, texture2D(tBlurred, uv).rgb, smoothstep(0.0, 0.02, uBlur));
  c *= 1.0 - uDarken;
  float x = uv.x * uSize.x / uSize.y;
  float px = 1.0 / uSize.y;
  float top = uTop + stray(x, 0.21);
  float bottom = uBottom + stray(x, 0.68);
  // Signed distance into the panel from its nearer edge, frame heights: positive inside.
  float depth = min(uv.y - bottom, top - uv.y);
  float inside = smoothstep(-px, px, depth);
  float past = max(-depth, 0.0);
  c *= 1.0 - uShadow * 0.6 * (1.0 - smoothstep(0.0, 0.025, past)) * (1.0 - inside);
  float band = (1.5 + 2.5 * uTear) * px;
  float fibres = (1.0 - smoothstep(band * 0.5, band, past)) * (1.0 - inside);
  float hairs = step(0.985, texture2D(tNoise, vec2(x * 70.0, 0.83)).b) * uTear;
  fibres = max(fibres, hairs * (1.0 - smoothstep(0.0, band * 5.0, past)) * (1.0 - inside));
  vec3 paper = uColour * (1.0 - uPaper * 0.06 * (texture2D(tNoise, vec2(x, uv.y) * 6.0 * uNoiseScale).r - 0.5));
  c = mix(c, paper, inside);
  c = mix(c, mix(uColour, vec3(1.0), 0.6), uFibre * fibres);
  float grain = texture2D(tNoise, gl_FragCoord.xy / 256.0).b - 0.5;
  gl_FragColor = vec4(clamp(c + grain * uGrain, 0.0, 1.0), 1.0);
}
`;

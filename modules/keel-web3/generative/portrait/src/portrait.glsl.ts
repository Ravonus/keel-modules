// The portrait's shading: one soft warm key from the upper left, a cool sky fill, light that wraps past the
// terminator and a warm subsurface tint in flesh, cool half-tones, and each part's own surface painted per pixel.
// Every part draws with this one program, `PART` chosen by a define. Output is linear light.

import { ALMOND, MOUTH, UNDER_JAW, UNDER_JAW_AT } from "./head.js";

export const VERTEX_GLSL = /* glsl */ `
attribute float aOpen;
attribute vec3 aRest;
attribute vec4 aFlow;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vFlow;
varying float vOpen;
varying vec4 vShadowAt;
uniform mat4 uShadowMatrix;  // the world into the key light's view
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vRest = aRest;
  // Left unnormalised, so a mesh without flow (the mass under the locks) keeps a zero one.
  vFlow = vec4(mat3(modelMatrix) * aFlow.xyz, aFlow.w);
  vOpen = aOpen;
  vShadowAt = uShadowMatrix * world;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SHADOW_VERTEX_GLSL = /* glsl */ `
varying float vDepth;
uniform float uShadowFar;
void main() {
  vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
  vDepth = -view.z / uShadowFar;
  gl_Position = projectionMatrix * view;
}
`;

export const SHADOW_FRAGMENT_GLSL = /* glsl */ `
varying float vDepth;
void main() { gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0); }
`;

const LIGHT = /* glsl */ `
uniform vec3 uKey;        // toward the key light
uniform vec3 uKeyColor;
uniform vec3 uSky;        // the fill's sky and ground colours
uniform vec3 uGround;
uniform vec3 uFillDir;
uniform sampler2D uShadowMap;
uniform vec4 uShadow;     // texel, softness in texels, bias, on
uniform vec2 uShadowBox;  // the light view's half width and far plane
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRest;
varying vec4 vFlow;
varying float vOpen;
varying vec4 vShadowAt;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return 0.5 * noise(p) + 0.3 * noise(p * 2.03 + 7.1) + 0.2 * noise(p * 4.1 + 3.3); }

// The key's soft shadow: a ring of samples in the light's depth map, spread times the usual width.
float keyShadow(vec3 n, float spread) {
  if (uShadow.w < 0.5) return 1.0;
  vec2 uv = vShadowAt.xy / uShadowBox.x * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  float depth = -vShadowAt.z / uShadowBox.y;
  float bias = uShadow.z * (1.0 + 3.0 * (1.0 - clamp(dot(n, uKey), 0.0, 1.0))) * (0.6 + 0.4 * spread);
  float lit = 0.0;
  float spin = hash(gl_FragCoord.xy) * 6.2832;
  for (int i = 0; i < 12; i++) {
    float a = spin + float(i) * 2.39996;
    float r = sqrt((float(i) + 0.5) / 12.0) * uShadow.y * spread;
    vec2 o = vec2(cos(a), sin(a)) * r * uShadow.x;
    lit += texture2D(uShadowMap, uv + o).r + bias < depth ? 0.0 : 1.0;
  }
  return lit / 12.0;
}

vec3 fill(vec3 n) { return mix(uGround, uSky, dot(n, uFillDir) * 0.5 + 0.5); }
`;

const SKIN = /* glsl */ `
uniform vec4 uEyeL;      // the eyes' centres in the head's frame, and the eye's radius
uniform vec4 uEyeR;
uniform vec4 uLid;       // how far the lids are down (0 open, 1 shut), tilt's sine and cosine
uniform vec3 uSkinTone;
uniform vec3 uLipTone;
uniform vec3 uBlushTone;
uniform vec3 uBrowTone;

// The eye's almond opening (head.ts, ALMOND).
const vec4 ALMOND = vec4(${ALMOND.up}, ${ALMOND.upR}, ${ALMOND.down}, ${ALMOND.downR});
const float ALMOND_SHIFT = ${ALMOND.shift};
// The mouth's line (head.ts, MOUTH).
const float MOUTH = ${MOUTH};

float ellipse(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return dot(q, q); }

// Where the upper lid's edge is, as a distance past it (+ on the lid), in the eye's own frame.
vec3 eyeFrame(vec3 p, vec4 eye, float side) {
  vec3 q = p - eye.xyz;
  float s = uLid.y * side;
  return vec3(uLid.z * q.x + s * q.y, -s * q.x + uLid.z * q.y, q.z);
}

// How far inside the upper lid's arc (x) and the lower's (y) a point of the eye's frame lies; the upper arc falls
// to the lower as the lid shuts.
vec2 almond(vec3 f, float side) {
  vec2 up = vec2(-side * ALMOND_SHIFT, ALMOND.x - ALMOND.y - uLid.x * (ALMOND.x - ALMOND.z + 0.0004));
  vec2 lo = vec2(side * ALMOND_SHIFT, ALMOND.z + ALMOND.w);
  return vec2(ALMOND.y - length(f.xy - up), ALMOND.w - length(f.xy - lo));
}

// Lips, blush, brows, the line of the lashes: painted from where the skin lies on the head at rest.
vec3 skinAlbedo(vec3 r, out float gloss) {
  vec3 base = uSkinTone;
  gloss = 0.25;
  float front = smoothstep(0.005, 0.02, r.z);
  float ax = abs(r.x);
  // Blush on the cheeks, the nose's tip, the ears and the chin.
  float blush = exp(-ellipse(vec2(ax, r.y), vec2(0.046, -0.034), vec2(0.026, 0.024)));
  blush += 0.55 * exp(-ellipse(r.xy, vec2(0.0, -0.033), vec2(0.009, 0.008)));
  blush += 0.3 * exp(-ellipse(r.xy, vec2(0.0, -0.095), vec2(0.012, 0.01)));
  blush += 0.25 * exp(-ellipse(vec2(ax, r.y), vec2(0.025, 0.014), vec2(0.02, 0.008)));
  blush += 0.7 * smoothstep(0.06, 0.075, ax) * (1.0 - smoothstep(-0.045, -0.06, r.z)) * step(-0.05, r.y);
  // A faint mottle, so the flesh is never one flat colour.
  float mottle = noise(r.xy * 900.0) * 0.6 + noise(r.xy * 260.0 + 3.0) * 0.4;
  base *= 0.97 + 0.06 * mottle;
  base = mix(base, uBlushTone, clamp(blush * 0.7, 0.0, 0.75));
  // Lips.
  float upper = min(ellipse(vec2(ax, r.y), vec2(0.0076, MOUTH + 0.003), vec2(0.0106, 0.0024)),
                    ellipse(r.xy, vec2(0.0, MOUTH + 0.002), vec2(0.0042, 0.0024)));
  float lower = ellipse(r.xy, vec2(0.0, MOUTH - 0.0031), vec2(0.0124, 0.0038));
  float lip = (1.0 - smoothstep(0.45, 1.1, min(upper, lower))) * front;
  // The lips' colour runs out softly toward the corners.
  base = mix(base, uLipTone, lip * (0.85 - 0.35 * smoothstep(0.006, 0.016, ax)));
  gloss = mix(gloss, 0.55, lip);
  // Brows: a soft arch of fine hairs above each eye, thinning to the tail.
  float bx = (ax - 0.029) / 0.021;
  float arch = 0.0155 + 0.003 * (1.0 - bx * bx) - 0.0018 * max(bx, 0.0);
  float thick = 0.0024 * (1.0 - 0.55 * smoothstep(-0.6, 1.0, bx));
  float slant = mix(1.2, 0.25, smoothstep(-1.0, 0.0, bx));
  vec2 hp = vec2(ax * 2600.0 + (r.y - arch) * 2600.0 * slant, (r.y - arch) * 700.0);
  float hairs = 0.45 + 0.55 * noise(hp);
  float brow = (1.0 - smoothstep(0.0, thick, abs(r.y - arch))) * (1.0 - smoothstep(0.8, 1.15, abs(bx)));
  base = mix(base, uBrowTone, brow * hairs * 0.55 * front);
  return base;
}

// The line of the lashes along each upper lid, a lighter one along the lower, and the fold of the upper lid.
vec2 lashes(vec3 r) {
  float side = r.x > 0.0 ? 1.0 : -1.0;
  vec4 eye = side > 0.0 ? uEyeL : uEyeR;
  vec3 q = eyeFrame(r, eye, side);
  if (length(q) > eye.w * 1.6 || q.z < -0.004) return vec2(0.0);
  vec2 a = almond(q, side);
  float outer = smoothstep(-0.2, 0.9, side * q.x / eye.w);
  float span = 1.0 - smoothstep(0.85, 1.0, abs(q.x) / eye.w);
  float top = (1.0 - smoothstep(0.0, 0.0009 + 0.0009 * outer, -a.x)) * step(-0.0003, -a.x);
  float bottom = (1.0 - smoothstep(0.0, 0.0012, -a.y)) * 0.12;
  float fold = exp(-pow((-a.x - 0.0042 + 0.0008 * outer) / 0.0016, 2.0)) * (1.0 - smoothstep(0.75, 1.05, abs(q.x) / eye.w));
  return vec2(max(top, bottom) * span, fold * step(0.0, q.z + 0.002));
}

vec3 shadeSkin(vec3 albedo, float gloss, vec3 n, vec3 v, float shadow, float open) {
  float nl = dot(n, uKey);
  float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0);
  float lit = wrap * mix(0.35, 1.0, shadow);
  // Light crossing under the skin reddens the terminator and the shadow's edge.
  float under = smoothstep(-0.35, 0.15, nl) * (1.0 - smoothstep(0.15, 0.6, nl * shadow));
  vec3 scatter = vec3(0.9, 0.3, 0.18) * under * 0.3;
  // Half-tones run cool, lights warm.
  float halftone = smoothstep(0.0, 0.35, nl) * (1.0 - smoothstep(0.35, 0.8, nl * shadow));
  vec3 tone = mix(vec3(1.0), vec3(0.9, 0.97, 1.02), halftone * 0.6);
  vec3 key = uKeyColor * (lit * tone + scatter);
  vec3 sky = fill(n) * open * (0.55 + 0.45 * open);
  vec3 h = normalize(uKey + v);
  float spec = pow(max(dot(n, h), 0.0), mix(18.0, 60.0, gloss)) * (0.03 + 0.12 * gloss) * shadow;
  return albedo * (key + sky) + uKeyColor * spec;
}
`;

const EYE = /* glsl */ `
uniform vec3 uLookL;     // where each iris faces, in the head's frame
uniform vec3 uLookR;
uniform vec3 uIris;
uniform vec3 uSclera;

vec3 shadeEye(vec3 n, vec3 v, float shadow) {
  float side = vRest.x > 0.0 ? 1.0 : -1.0;
  vec4 eye = side > 0.0 ? uEyeL : uEyeR;
  vec3 q = vRest - eye.xyz;
  vec3 d = normalize(q);
  vec3 look = side > 0.0 ? uLookL : uLookR;
  float c = dot(d, look);
  float r = sqrt(max(0.0, 1.0 - c * c));           // the sine off the look
  vec3 across = normalize(d - look * c + 1e-6);
  float ang = atan(dot(across, normalize(cross(look, vec3(0.0, 1.0, 0.0)))), dot(across, vec3(0.0, 1.0, 0.0)));
  float iris = 1.0 - smoothstep(0.47, 0.5, r);
  float pupil = 1.0 - smoothstep(0.15, 0.175, r);
  float fibres = 0.75 + 0.25 * noise(vec2(ang * 18.0, r * 9.0)) + 0.15 * sin(ang * 60.0);
  vec3 irisCol = uIris * fibres;
  irisCol = mix(irisCol * 1.35 + vec3(0.06, 0.03, 0.0), irisCol, smoothstep(0.17, 0.3, r));
  irisCol = mix(irisCol, irisCol * 0.35, smoothstep(0.36, 0.5, r));
  vec3 sclera = uSclera * mix(1.0, 0.82, smoothstep(0.55, 0.95, r));
  vec3 col = mix(sclera, irisCol, iris);
  col = mix(col, vec3(0.012), pupil);
  // The almond: outside it the lid's skin is drawn; under the upper lid the eye lies in its shadow and lashes.
  vec3 f = eyeFrame(vRest, eye, side);
  vec2 a = almond(f, side);
  float open = min(a.x, a.y);
  float aa = max(fwidth(open), 1e-5);
  float covered = 1.0 - smoothstep(-aa, aa, open);
  float lidShade = 1.0 - smoothstep(0.0, 0.004, a.x);
  col *= mix(0.62, 1.0, smoothstep(0.0, 0.0028, open));
  col = mix(col, uBrowTone * 0.12, (1.0 - smoothstep(0.0, 0.00075, a.x)) * 0.85);
  vec3 wn = n;
  float nl = clamp(dot(wn, uKey), 0.0, 1.0);
  vec3 lit = uKeyColor * (0.25 + 0.75 * nl) * shadow * (1.0 - 0.8 * lidShade) + fill(wn) * 0.55 * (1.0 - 0.5 * lidShade);
  vec3 h = normalize(uKey + v);
  float glint = pow(max(dot(wn, h), 0.0), 900.0) * 9.0 * shadow * (1.0 - lidShade);
  vec3 eyeOut = col * lit + uKeyColor * glint;
  float g;
  vec3 albedo = skinAlbedo(vRest, g);
  vec2 lash = lashes(vRest);
  albedo = mix(albedo, uBrowTone * 0.3, lash.x) * (1.0 - 0.2 * lash.y * vec3(0.8, 1.0, 1.0));
  vec3 lidOut = shadeSkin(albedo, 0.3, n, v, shadow, 0.8);
  return mix(eyeOut, lidOut, covered);
}
`;

const BUMP = /* glsl */ `
// A height painted on a surface, turned into a tilt of its normal from how it changes across the screen.
vec3 bumped(vec3 n, float height) {
  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  float hx = dFdx(height);
  float hy = dFdy(height);
  vec3 r1 = cross(dy, n);
  vec3 r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - grad);
}

// Light from a soft sky and warm ground for shiny things, with the key as a soft box.
vec3 reflected(vec3 n, vec3 v, float sharp) {
  vec3 r = reflect(-v, n);
  vec3 env = mix(uGround * 0.8, uSky * 1.3, smoothstep(-0.4, 0.6, r.y));
  float box = pow(max(dot(r, uKey), 0.0), sharp);
  return env + uKeyColor * box * 1.2;
}

vec3 diffuse(vec3 albedo, vec3 n, float shadow, float open, float wrap) {
  float nl = clamp((dot(n, uKey) + wrap) / (1.0 + wrap), 0.0, 1.0);
  return albedo * (uKeyColor * nl * shadow + fill(n) * open);
}
`;

const CLOTHES = /* glsl */ `
uniform vec4 uCapAxis;    // the cap's axis (its cuff plane's normal) and the cuff edge's height along it
uniform vec4 uCapCentre;  // a point on the axis, and the cuff's height
uniform vec3 uCapTones[3];
uniform vec3 uHairTones[3];
uniform vec3 uWrist;
uniform vec3 uElbow;

vec3 shadeCap(vec3 n, vec3 v, float shadow) {
  vec3 r = vRest;
  vec3 axis = uCapAxis.xyz;
  float h = dot(r, axis) - uCapAxis.w;
  vec3 q = r - uCapCentre.xyz;
  q -= axis * dot(q, axis);
  float around = atan(q.x, q.z);
  float cols = around * 56.0 / 6.2832;
  float rib = pow(abs(sin(cols * 3.14159)), 0.55);
  float row = h / 0.0026 + abs(fract(cols) - 0.5) * 1.4;
  float loop = smoothstep(0.15, 0.5, abs(fract(row) - 0.5));
  float height = rib * 0.0011 + loop * rib * 0.00025 + noise(vec2(cols * 4.0, h * 900.0)) * 0.00012;
  // Two woven labels on the cuff: an oblong one front left, a small square on the right.
  float onCuff = step(0.0, h) * step(h, uCapCentre.w);
  float oblong = step(-0.62, around) * step(around, -0.18) * step(0.013, h) * step(h, 0.034);
  float square = step(0.72, around) * step(around, 0.9) * step(0.016, h) * step(h, 0.031);
  float label = max(oblong, square) * onCuff;
  vec3 nn = label > 0.5 ? n : bumped(n, height);
  vec3 base = mix(uCapTones[1], uCapTones[0], rib) * (0.92 + 0.08 * loop);
  float print = oblong * step(0.5, fract((around + 0.62) * 70.0)) *
    (step(0.018, h) * step(h, 0.021) + step(0.025, h) * step(h, 0.0275) * step(around, -0.3));
  print += square * smoothstep(0.004, 0.003, length(vec2((around - 0.81) * 0.09, h - 0.0235)));
  base = mix(base, vec3(0.012), label);
  base = mix(base, vec3(0.8), clamp(print, 0.0, 1.0) * label);
  vec3 col = diffuse(base, nn, shadow, vOpen, 0.45);
  float rim = pow(1.0 - clamp(dot(nn, v), 0.0, 1.0), 3.0);
  col += uCapTones[2] * rim * 0.18 * (0.4 + 0.6 * shadow) * (1.0 - label);
  return col;
}

vec3 shadeHair(vec3 n, vec3 v, float shadow) {
  if (dot(vFlow.xyz, vFlow.xyz) < 0.5) {
    // The mass under the locks: hair too, streaked down its fall, deep in the locks' shade so it reads as depth.
    float fall = noise(vec2((vWorld.x + vWorld.z) * 260.0, vWorld.y * 22.0)) * 0.6 + noise(vec2((vWorld.x - vWorld.z) * 90.0, vWorld.y * 9.0)) * 0.4;
    vec3 under = uHairTones[0] * (0.4 + 0.45 * fall);
    return diffuse(under, n, shadow * 0.5, 0.25 + 0.2 * fall, 0.3);
  }
  vec3 t = normalize(vFlow.xyz);
  float tone = vRest.z;
  float strands = 0.7 + 0.28 * noise(vec2(vRest.x * 40.0 + tone * 97.0, vRest.y * 6.0 + tone * 13.0))
    + 0.16 * noise(vec2(vRest.x * 110.0 + tone * 31.0, vRest.y * 14.0));
  vec3 base = mix(uHairTones[0], uHairTones[1], tone) * strands;
  base = mix(base, uHairTones[2], smoothstep(0.6, 1.0, vRest.y) * 0.2);
  float tl = dot(t, uKey);
  float diff = mix(0.25, 1.0, sqrt(max(0.0, 1.0 - tl * tl))) * clamp(dot(n, uKey) * 0.6 + 0.4, 0.0, 1.0);
  vec3 h = normalize(uKey + v);
  float th = dot(t + n * 0.12, h);
  float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 80.0) * 0.12;
  float th2 = dot(t - n * 0.1, h);
  float spec2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 24.0) * 0.18;
  vec3 col = base * (uKeyColor * diff * shadow + fill(n) * vOpen * 0.9);
  col += (uKeyColor * spec + base * uKeyColor * spec2 * 1.5) * shadow * vOpen;
  return col;
}

vec3 shadeDress(vec3 n, vec3 v, float shadow) {
  vec3 r = vRest;
  vec3 base = uColor;
  // The embroidered band under the neckline: olive and black diamonds between fine light lines.
  float band = step(-0.142, r.y) * step(r.y, -0.106) * step(0.0, r.z) * step(abs(r.x), 0.15);
  vec2 d = vec2(r.x / 0.0105, (r.y + 0.124) / 0.0105);
  float diamond = abs(fract(d.x) - 0.5) + abs(d.y) ;
  float edge = step(abs(r.y + 0.108), 0.0012) + step(abs(r.y + 0.14), 0.0012);
  vec3 stitch = mix(vec3(0.02, 0.025, 0.018), vec3(0.17, 0.18, 0.09), step(diamond, 0.42));
  stitch = mix(stitch, vec3(0.55, 0.5, 0.36), clamp(edge, 0.0, 1.0));
  base = mix(base, stitch, band);
  // The sleeve's cuff at the wrist, with a pale lace edge.
  vec3 arm = uWrist - uElbow;
  float along = dot(r - uElbow, arm) / dot(arm, arm);
  float cuff = smoothstep(0.78, 0.8, along);
  base = mix(base, vec3(0.16, 0.19, 0.13), cuff);
  float lace = smoothstep(0.93, 0.95, along) * (0.6 + 0.4 * sin(atan(r.x - uWrist.x, r.z - uWrist.z) * 18.0));
  base = mix(base, vec3(0.78, 0.76, 0.68), clamp(lace, 0.0, 1.0));
  vec3 nn = bumped(n, noise(r.xy * 2600.0) * 0.00004);
  vec3 col = diffuse(base, nn, shadow, vOpen, 0.35);
  vec3 h = normalize(uKey + v);
  col += uKeyColor * pow(max(dot(nn, h), 0.0), 26.0) * 0.12 * shadow * (1.0 - band);
  return col;
}

vec3 shadeVelvet(vec3 n, vec3 v, float shadow) {
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float sheen = pow(1.0 - facing, 2.2);
  vec3 base = uColor;
  vec3 col = diffuse(base, n, shadow, vOpen, 0.2);
  col += vec3(0.11, 0.13, 0.135) * sheen * (uKeyColor * 0.35 * (0.3 + 0.7 * shadow) + fill(n) * 0.6) * vOpen;
  return col;
}

vec3 shadeGold(vec3 n, vec3 v, float shadow) {
  float link = 0.65 + 0.35 * step(0.5, fract(vRest.x * 420.0));
  return uColor * reflected(n, v, 60.0) * link * mix(0.55, 1.0, shadow) * vOpen;
}

vec3 shadeCard(vec3 n, vec3 v, float shadow) {
  vec3 r = vRest;
  vec2 c = r.xy;
  // The chip, a bevelled gold plate with contact grooves.
  vec2 chipAt = vec2(0.03, 0.006);
  vec2 cq = abs(c - chipAt) - vec2(0.0084, 0.0072);
  float chip = step(max(cq.x, cq.y), 0.0) * step(0.0, r.z);
  float groove = chip * (step(abs(c.y - chipAt.y), 0.0004) + step(abs(abs(c.x - chipAt.x) - 0.003), 0.0003));
  float grain = noise(c * 2400.0) * 0.6 + noise(c * 5200.0) * 0.4;
  float digits = step(0.0, r.z) * step(abs(c.y + 0.016), 0.0026) * step(abs(c.x + 0.004), 0.046) *
    step(0.35, fract(c.x / 0.0058)) * step(fract(c.x / 0.026), 0.82);
  float mark = step(0.0, r.z) * step(abs(c.y + 0.03), 0.0022) * step(abs(c.x + 0.038), 0.014);
  float height = (1.0 - chip) * (grain * 0.00006 + digits * 0.00012);
  vec3 nn = bumped(n, height);
  vec3 base = mix(uColor, vec3(1.0, 0.27, 0.42), mark * 0.6);
  vec3 col = diffuse(base, nn, shadow, vOpen, 0.25);
  vec3 h = normalize(uKey + v);
  col += uKeyColor * pow(max(dot(nn, h), 0.0), 40.0) * 0.35 * shadow;
  vec3 gold = vec3(0.6, 0.38, 0.06) * reflected(nn, v, 40.0) * mix(0.5, 1.0, shadow);
  gold = mix(gold, vec3(0.1, 0.06, 0.01), clamp(groove, 0.0, 1.0));
  return mix(col, gold, chip);
}
`;

const HAND = /* glsl */ `
uniform vec4 uTips[5];   // each finger's last joint and tip, in the hand's frame; the radius in w
uniform vec4 uTipEnds[5];
uniform vec3 uBacks[5];  // the back of each last bone

vec2 nails(vec3 r) {
  vec2 best = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    vec3 a = uTips[i].xyz;
    vec3 b = uTipEnds[i].xyz;
    vec3 ab = b - a;
    float t = clamp(dot(r - a, ab) / dot(ab, ab), 0.0, 1.0);
    vec3 off = r - (a + ab * t);
    float back = dot(normalize(off), uBacks[i]);
    float on = smoothstep(0.36, 0.46, t) * smoothstep(0.5, 0.68, back) * step(length(off), uTips[i].w * 1.6);
    if (on > best.x) best = vec2(on, t);
  }
  return best;
}
`;

export const FRAGMENT_GLSL = /* glsl */ `
${LIGHT}
${SKIN}
${EYE}
uniform vec3 uColor;
${BUMP}
${CLOTHES}
${HAND}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  if (!gl_FrontFacing) n = -n;
  // Flesh takes the key's shadow with a wide, soft edge, as light spreads under skin; all else a crisp one.
  float shadow = keyShadow(n, PART <= 1 ? 6.0 : 1.0);
  vec3 col;
#if PART == 0
  float gloss;
  vec3 albedo = skinAlbedo(vRest, gloss);
  vec2 lash = lashes(vRest);
  albedo = mix(albedo, uBrowTone * 0.3, lash.x) * (1.0 - 0.2 * lash.y * vec3(0.8, 1.0, 1.0));
  // Just under the jaw the neck lies in its shade, softer and deeper than the key's shadow map draws it.
  float jaw = dot(vRest, vec3(${UNDER_JAW.map((v) => v.toFixed(2)).join(", ")})) - ${UNDER_JAW_AT.toFixed(4)};
  float tuck = smoothstep(-0.003, 0.005, jaw) * (1.0 - smoothstep(0.008, 0.045, jaw));
  col = shadeSkin(albedo, gloss, n, v, shadow * (1.0 - 0.75 * tuck), vOpen * (1.0 - 0.45 * tuck));
#elif PART == 1
  vec2 nail = nails(vRest);
  // The nail's bed pink, its free edge pale, a fine dark line where it meets the skin.
  vec3 bed = mix(uSkinTone * vec3(1.0, 0.8, 0.78), vec3(0.96, 0.92, 0.88), smoothstep(0.9, 1.0, nail.y));
  vec3 albedo = mix(uSkinTone * vec3(1.0, 0.97, 0.95), bed, nail.x);
  albedo *= 1.0 - 0.12 * nail.x * (1.0 - nail.x) * 4.0;
  col = shadeSkin(albedo, 0.25 + nail.x * 0.55, n, v, shadow, vOpen);
#elif PART == 2
  col = shadeEye(n, v, shadow);
#elif PART == 3
  col = shadeCap(n, v, shadow);
#elif PART == 4
  col = shadeHair(n, v, shadow);
#elif PART == 5
  col = shadeDress(n, v, shadow);
#elif PART == 6
  col = diffuse(uColor, bumped(n, noise(vRest.xy * 1800.0) * 0.00003), shadow, vOpen, 0.5);
#elif PART == 7
  col = shadeVelvet(n, v, shadow);
#elif PART == 8
  col = shadeGold(n, v, shadow);
#else
  col = shadeCard(n, v, shadow);
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

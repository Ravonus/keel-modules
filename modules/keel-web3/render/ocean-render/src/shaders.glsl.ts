// The GLSL: the ground and wave maths the passes share, the water pass, the surface, the spray, the resolve and the swarm's instances.

export const GROUND = /* glsl */ `
uniform sampler2D uGround;
uniform float uGroundSize;
// The ground's height, read from the map baked by createOcean.
float groundAt(vec2 p) {
  vec2 cell = clamp(p / uGroundSize + 0.5, 0.0, 1.0) * (GROUND_CELLS - 1.0);
  vec2 low = floor(cell);
  vec2 k = cell - low;
  float texel = 1.0 / GROUND_CELLS;
  vec2 at = (low + 0.5) * texel;
  float near = mix(texture2D(uGround, at).r, texture2D(uGround, at + vec2(texel, 0.0)).r, k.x);
  float far = mix(texture2D(uGround, at + vec2(0.0, texel)).r, texture2D(uGround, at + vec2(texel)).r, k.x);
  return mix(near, far, k.y);
}
`;

export const WAVE_MATHS = /* glsl */ `
${GROUND}
uniform vec4 uWave[WAVES * 2];
uniform float uTime;
float waveFade(float k, float dist) { float far = k * dist * 0.012; return 1.0 / (1.0 + far * far); }
// The mesh's rings part with distance: a wave too short for them must leave the shape to the normals, or it folds.
float waveHold(float k, float dist) { float far = k * dist * 0.06; return 1.0 / (1.0 + far * far); }
uniform float uShore, uWind;
// Water over the ground at this tide: negative where the sand stands clear of it.
float depthAt(vec2 p) { return uShore - groundAt(p); }
// As generative/ocean's surfAt.
float slant(vec2 p) { return sin(p.x * 0.021 + p.y * 0.033) * 0.9 + sin(p.x * 0.0071 - p.y * 0.011 + 1.3) * 1.3; }
float sawAt(float depth, vec2 p, float time) { return fract((0.69813 * time + 9.0 * sqrt(max(depth, 0.0)) + slant(p)) / 6.283185); }
float surfSaw(float depth, vec2 p) { return sawAt(depth, p, uTime); }
float surfBuild(float depth) { return smoothstep(0.0, 1.0, clamp((4.5 - depth) / 3.0, 0.0, 1.0)) * smoothstep(0.0, 1.0, clamp((depth - 0.15) / 0.7, 0.0, 1.0)); }
float setsAt(vec2 p, float time) { return 0.72 + 0.28 * sin(time * 0.09 + slant(p)); }
float surfSets(vec2 p) { return setsAt(p, uTime); }
float surfLift(float depth, vec2 p) {
  float saw = surfSaw(depth, p);
  float front = pow(1.0 - saw, 3.0) * clamp(saw / 0.05, 0.0, 1.0);
  float swash = sin(0.69813 * uTime + slant(p) - 1.1) * 0.5 + 0.5;
  float shore = smoothstep(0.0, 1.0, clamp((1.4 - depth) / 1.1, 0.0, 1.0));
  return (0.18 * uWind * front * surfBuild(depth) + 0.07 * uWind * swash * shore) * surfSets(p);
}
// As generative/ocean's surfThrow.
float surfThrow(float depth, vec2 p) {
  float saw = surfSaw(depth, p);
  float lip = smoothstep(0.0, 0.09, saw) * (1.0 - smoothstep(0.09, 0.3, saw));
  float breaking = smoothstep(3.0, 1.5, depth) * smoothstep(0.35, 0.85, depth);
  return 0.22 * uWind * lip * breaking * surfSets(p);
}
// As generative/ocean's surfBurst.
float surfBurst(float depth, vec2 p, float time) {
  float landing = smoothstep(1.9, 1.0, depth) * smoothstep(0.2, 0.6, depth);
  return landing * (1.0 - smoothstep(0.0, 0.18, sawAt(depth, p, time))) * setsAt(p, time);
}
// Which way is up the shore here.
vec2 shoreward(vec2 p) {
  vec2 slope = vec2(groundAt(p + vec2(1.5, 0.0)) - groundAt(p - vec2(1.5, 0.0)), groundAt(p + vec2(0.0, 1.5)) - groundAt(p - vec2(0.0, 1.5)));
  return slope / max(length(slope), 1e-4);
}
// All a breaker moves water by: up the shore, and up.
vec3 breaker(vec2 p, float depth, vec2 along) {
  float thrown = surfThrow(depth, p);
  return vec3(along.x * thrown, surfLift(depth, p), along.y * thrown);
}
// As generative/ocean's shoalOf.
float shoal(float k, float depth) {
  float share = smoothstep(0.0, 1.0, clamp(depth / min(1.6 / k, 6.0), 0.0, 1.0));
  float kept = min(0.45, 0.06 / k);
  return kept + (1.0 - kept) * share;
}
vec3 displaced(vec2 p, float dist, float depth) {
  vec3 moved = vec3(p.x, 0.0, p.y);
  for (int i = 0; i < WAVES; i++) {
    vec4 a = uWave[i * 2]; vec4 b = uWave[i * 2 + 1];
    float theta = a.z * dot(a.xy, p) - a.w * uTime + b.z;
    float amp = b.x * waveHold(a.z, dist) * shoal(a.z, depth);
    moved.xz += a.xy * b.y * amp * cos(theta);
    moved.y += amp * sin(theta);
  }
  return moved;
}
vec3 waveNormal(vec2 p, float dist, float depth) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < WAVES; i++) {
    vec4 a = uWave[i * 2]; vec4 b = uWave[i * 2 + 1];
    float theta = a.z * dot(a.xy, p) - a.w * uTime + b.z;
    float lift = a.z * b.x * waveFade(a.z, dist) * shoal(a.z, depth);
    n.xz -= a.xy * lift * cos(theta);
    n.y -= b.y * lift * sin(theta);
  }
  return normalize(n);
}
`;

export const WATER_LIGHT = /* glsl */ `
uniform vec3 uAbsorb, uScatter, uSunDir, uSunCol, uZenith, uHorizon;
uniform float uLevel, uUnder;
vec3 skyColor(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
  float toward = max(dot(d, uSunDir), 0.0);
  return sky + uSunCol * (pow(toward, 900.0) * 14.0 + pow(toward, 12.0) * 0.06);
}
// A warped net of bright lines: light gathered by the waves onto what lies under them.
float net(vec2 p, float t) {
  vec2 w = p + 0.8 * vec2(sin(p.y * 1.27 + t), sin(p.x * 1.13 - t * 0.83));
  w += 0.45 * vec2(sin(w.y * 2.71 - t * 1.31), sin(w.x * 2.33 + t * 1.07));
  return 1.0 - abs(sin(w.x) + sin(w.y)) * 0.5;
}
float caustic(vec2 p, float t) {
  return pow(net(p, t), 7.0) + pow(net(p.yx * 1.37 + 4.1, t * 1.21), 7.0) * 0.8;
}
// What the water adds of its own and lets through, over a stretch of it.
vec3 scatterOver(float depth, vec3 through) { return uScatter * uSunCol * exp(-uAbsorb * max(depth, 0.0)) * (vec3(1.0) - through); }
`;

// Real rays through the real scene: the ground is a height map and each animal a
// few spheres, so a ray can walk them in the shader with no acceleration structure.
export const TRACE = /* glsl */ `
uniform sampler2D uGroundColor;
uniform int uReflectSteps, uShadowSteps, uCasterCount;
uniform float uTraceFar, uGroundTop;
uniform vec4 uCaster[MAX_CASTERS];
uniform vec3 uCasterTint[MAX_CASTERS];
float traceGround(vec3 o, vec3 d, float far, int steps) {
  float t = 0.6;
  float last = t;
  for (int i = 0; i < steps; i++) {
    vec3 p = o + d * t;
    if (d.y > 0.0 && p.y > uGroundTop) return -1.0;
    float gap = p.y - groundAt(p.xz);
    if (gap < 0.0) {
      float a = last;
      float b = t;
      for (int j = 0; j < 4; j++) {
        float m = (a + b) * 0.5;
        vec3 q = o + d * m;
        if (q.y < groundAt(q.xz)) b = m; else a = m;
      }
      return b;
    }
    last = t;
    t += max(gap * 0.7, 0.25 + t * 0.03);
    if (t > far) return -1.0;
  }
  return -1.0;
}
vec3 groundShade(vec3 p) {
  const float E = 1.5;
  vec3 n = normalize(vec3(groundAt(p.xz - vec2(E, 0.0)) - groundAt(p.xz + vec2(E, 0.0)), 2.0 * E, groundAt(p.xz - vec2(0.0, E)) - groundAt(p.xz + vec2(0.0, E))));
  vec3 albedo = texture2D(uGroundColor, clamp(p.xz / uGroundSize + 0.5, 0.0, 1.0)).rgb;
  vec3 light = uSunCol * max(dot(n, uSunDir), 0.0) * 0.32 + uZenith * 0.5;
  float depth = uLevel - p.y;
  return albedo * light * (depth > 0.0 ? exp(-uAbsorb * depth) : vec3(1.0));
}
// The nearest thing a ray meets, or what lies beyond it all. Water it crosses takes its share.
vec3 traced(vec3 o, vec3 d, vec3 beyond, bool wet) {
  float best = traceGround(o, d, uTraceFar, uReflectSteps);
  vec3 col = best > 0.0 ? groundShade(o + d * best) : beyond;
  if (best < 0.0) best = 1e9;
  for (int i = 0; i < uCasterCount; i++) {
    vec3 c = o - uCaster[i].xyz;
    float along = dot(c, d);
    float h = along * along - dot(c, c) + uCaster[i].w * uCaster[i].w;
    if (h < 0.0) continue;
    float t = -along - sqrt(h);
    if (t < 0.0 || t > best) continue;
    best = t;
    vec3 n = normalize(c + d * t);
    col = uCasterTint[i] * (uZenith * 0.6 + uSunCol * max(dot(n, uSunDir), 0.0) * 0.3);
  }
  return wet && best < 1e8 ? col * exp(-uAbsorb * best) : col;
}
// How much of the sun reaches a point: walks toward it past the ground and the animals.
float sunlit(vec3 p) {
  if (uShadowSteps == 0) return 1.0;
  float open = 1.0;
  for (int i = 0; i < uCasterCount; i++) {
    vec3 c = uCaster[i].xyz - p;
    float along = dot(c, uSunDir);
    if (along <= 0.0) continue;
    float off = length(c - uSunDir * along);
    open *= smoothstep(uCaster[i].w * 0.7, uCaster[i].w * 1.2 + along * 0.05, off);
  }
  return traceGround(p, uSunDir, 90.0, uShadowSteps) > 0.0 ? 0.0 : open;
}
`;

export const FULLSCREEN = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const MEDIUM = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor, uDepth;
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uEye;
uniform float uTime;
uniform int uShafts, uSnow;
uniform float uWet, uRunUp;
${WATER_LIGHT}
${GROUND}
${TRACE}
const float FAR = 900.0;
vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float jitter() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }
vec2 towardSun(vec3 p, float depth) { return p.xz + uSunDir.xz / max(uSunDir.y, 0.2) * depth; }
// Light shafts: step through the water, and at each step ask how much light the surface sends down to it.
vec3 shafts(vec3 eye, vec3 dir, float a, float b) {
  float reach = min(b, a + 34.0) - a;
  float step = reach / float(max(uShafts, 1));
  float s = a + step * (0.5 + jitter() * 0.35);
  vec3 tint = vec3(0.0);
  for (int i = 0; i < uShafts; i++) {
    vec3 q = eye + dir * s;
    float depth = uLevel - q.y;
    if (depth > 0.0) {
      float beam = caustic(towardSun(q, depth) * 0.24, uTime * 0.7);
      tint += exp(-uAbsorb * (depth + s - a)) * beam;
    }
    s += step;
  }
  return tint * uScatter * uSunCol * 0.42 / float(max(uShafts, 1)) * reach * 0.18;
}
// Marine snow: drifting specks in shells round the eye.
float snow(vec3 eye, vec3 dir, float end) {
  float sum = 0.0;
  float d = 1.3;
  for (int i = 0; i < uSnow; i++) {
    if (d > end) break;
    float cell = 0.5 + d * 0.16;
    vec3 g = (eye + dir * d + vec3(0.0, uTime * 0.03, uTime * 0.012)) / cell;
    vec3 id = floor(g);
    vec3 h = hash3(id + float(i));
    float speck = smoothstep(0.03, 0.006, length(fract(g) - 0.5 - (h - 0.5) * 0.7));
    sum += speck * step(0.62, h.y) * exp(-d * 0.1);
    d *= 1.55;
  }
  return sum;
}
// Sand the water has left: dark up to the highest line it reached, and a mirror where the last swash ran.
vec3 wetSand(vec3 col, vec3 p, vec3 dir) {
  float top = uWet + 0.05 * sin(p.x * 0.37 + sin(p.z * 0.53) * 2.0) + 0.02 * sin(p.x * 1.7 + p.z * 1.3);
  // Past the baked ground the mesh is too coarse to draw a tideline on.
  float near = 1.0 - smoothstep(0.42, 0.5, max(abs(p.x), abs(p.z)) / uGroundSize);
  float wet = smoothstep(top, top - 0.12, p.y) * near;
  float fresh = smoothstep(uRunUp + 0.12, uRunUp - 0.5, p.y) * near;
  float fresnel = 0.02 + 0.98 * pow(1.0 - abs(dir.y), 5.0);
  return mix(col * (1.0 - 0.32 * wet - 0.2 * fresh), skyColor(reflect(dir, vec3(0.0, 1.0, 0.0))) * vec3(0.8, 0.76, 0.7), fresh * fresnel * 0.5);
}
void main() {
  float d = texture2D(uDepth, vUv).r;
  bool far = d >= 1.0;
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, far ? 1.0 : d * 2.0 - 1.0, 1.0);
  vec3 p = (uCamWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  vec3 eye = uEye;
  vec3 ray = p - eye;
  float dist = far ? FAR : length(ray);
  vec3 dir = normalize(ray);
  vec3 col = far ? skyColor(dir) : texture2D(uColor, vUv).rgb;
  if (!far) col = wetSand(col, eye + dir * dist, dir);
  float sun = far ? 1.0 : sunlit(eye + dir * dist + vec3(0.0, 0.15, 0.0));
  if (!far) col *= 0.42 + 0.58 * sun;
  float toPlane = abs(dir.y) > 1e-4 ? (uLevel - eye.y) / dir.y : FAR * 2.0;
  bool under = uUnder > 0.5;
  float a = under ? 0.0 : (dir.y < 0.0 ? toPlane : dist);
  float b = under && dir.y > 0.0 ? min(dist, toPlane) : dist;
  if (b > a) {
    if (far) col = vec3(0.0);
    else {
      vec3 at = eye + dir * dist;
      float depth = max(uLevel - at.y, 0.0);
      float light = 1.0 + caustic(towardSun(at, depth) * 0.62, uTime * 0.9) * 1.7 * exp(-depth * 0.045) * sun;
      col *= exp(-uAbsorb * depth) * light;
    }
    float len = b - a;
    vec3 through = exp(-uAbsorb * len);
    // (Most of what is seen in the water is scattered close to the eye, however far the ray runs.)
    float mid = uLevel - (eye.y + dir.y * (a + min(len * 0.5, 22.0)));
    col = col * through + scatterOver(mid, through);
    if (under) {
      col += shafts(eye, dir, a, b);
      col += snow(eye, dir, b) * uScatter * uSunCol * 1.6;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SURFACE_VERTEX = /* glsl */ `
${WAVE_MATHS}
varying vec2 vRest;
varying vec3 vWorld;
varying float vDepth;
varying vec2 vAlong;
uniform float uLevel;
void main() {
  vec2 rest = position.xz + cameraPosition.xz;
  float dist = length(position.xz);
  vRest = rest;
  vDepth = depthAt(rest);
  // A lip needs the mesh's fine rings, so far off a breaker only lifts.
  vAlong = vDepth < 3.5 ? shoreward(rest) * smoothstep(90.0, 45.0, dist) : vec2(0.0);
  vWorld = displaced(rest, dist, max(vDepth, 0.0)) + breaker(rest, vDepth, vAlong) + vec3(0.0, uLevel, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const SURFACE_FRAGMENT = /* glsl */ `
${WAVE_MATHS}
${WATER_LIGHT}
${TRACE}
varying vec2 vRest;
varying vec3 vWorld;
varying float vDepth;
varying vec2 vAlong;
uniform sampler2D uDepth, uBelow;
uniform vec2 uRes;
uniform float uTraceNear;
vec3 ripple(vec2 p, float dist) {
  vec2 q = p * 3.1;
  vec2 r = vec2(sin(q.x + sin(q.y * 1.7 + uTime * 1.6) + uTime * 1.3), sin(q.y * 1.3 + sin(q.x * 1.9 - uTime * 1.4) - uTime * 1.1));
  return vec3(r.x, 0.0, r.y) * 0.085 / (1.0 + dist * 0.07);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (texture2D(uDepth, uv).r < gl_FragCoord.z) discard;
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 v = toEye / dist;
  vec3 n = waveNormal(vRest, dist, max(vDepth, 0.0)) + ripple(vRest, dist);
  // The breakers' own slope, which the Gerstner normals know nothing of.
  if (vDepth < 6.0 && dist < 240.0) {
    vec2 ex = vRest + vec2(0.35, 0.0);
    vec2 ez = vRest + vec2(0.0, 0.35);
    vec3 here = breaker(vRest, vDepth, vAlong);
    vec3 across = vec3(0.35, 0.0, 0.0) + breaker(ex, depthAt(ex), vAlong) - here;
    vec3 along = vec3(0.0, 0.0, 0.35) + breaker(ez, depthAt(ez), vAlong) - here;
    n += normalize(cross(along, across)) - vec3(0.0, 1.0, 0.0);
  }
  n = normalize(n);
  bool under = uUnder > 0.5;
  // Far off, a pixel covers many small waves: they average toward flat, not to one steep face.
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), dist / (dist + 45.0)));
  if (under) n = -n;
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  if (under) {
    // From below: Snell's window of sky, and past its edge the mirror of the water beneath.
    vec3 bent = refract(-v, n, 1.333);
    bool mirror = dot(bent, bent) < 0.5;
    bool trace = dist < uTraceNear;
    vec3 beyond = mirror ? uScatter * uSunCol * 0.55 : skyColor(bent) * (1.0 - fresnel) * 0.9;
    vec3 col = !trace ? beyond : mirror ? traced(vWorld, reflect(-v, n), beyond, true) : traced(vWorld, bent, beyond, false);
    // Only what survives the water to the eye: the water's own light is already there underneath.
    gl_FragColor = vec4(mix(texture2D(uBelow, uv).rgb, col, exp(-uAbsorb.g * dist)), 1.0);
    return;
  }
  vec3 mirrored = reflect(-v, n);
  mirrored.y = abs(mirrored.y);
  vec3 sky = dist < uTraceNear ? traced(vWorld + n * 0.1, mirrored, skyColor(mirrored), false) : skyColor(mirrored);
  // The sun's glitter, and white water where a crest stands tallest and steepest.
  float glitter = pow(max(dot(mirrored, uSunDir), 0.0), 520.0) * 30.0;
  float foam = smoothstep(0.32, 0.62, 1.0 - n.y + vWorld.y * 0.06) * (0.5 + 0.5 * sin(vRest.x * 5.0 + sin(vRest.y * 4.0 + uTime)));
  // Surf: broken water where the depth runs out, the short waves' energy going into it.
  float lace = 0.5 + 0.5 * sin(vRest.x * 2.3 + sin(vRest.y * 2.9 + uTime * 0.5) * 2.0 + sin(vRest.y * 0.9 - vRest.x * 1.1 - uTime * 0.4) * 3.0);
  float grain = 0.5 + 0.5 * sin(vRest.x * 7.3 + sin(vRest.y * 6.1 + uTime * 1.3) * 2.0) * sin(vRest.y * 8.7 - vRest.x * 2.1 - uTime);
  float saw = surfSaw(vDepth, vRest);
  float build = surfBuild(vDepth) * surfSets(vRest);
  // The face stays glass until it has fallen: white runs along the lip, then fills the bore behind it.
  float crown = smoothstep(0.03, 0.07, saw) * (1.0 - smoothstep(0.07, 0.17, saw));
  float fallen = smoothstep(2.4, 1.2, vDepth);
  float face = mix(smoothstep(0.0, 0.05, saw), 1.0, smoothstep(1.2, 0.7, vDepth));
  float bore = face * (1.0 - smoothstep(0.05, 0.3 + 0.3 * lace, saw)) * fallen;
  float spent = smoothstep(2.2, 0.5, vDepth) * smoothstep(0.55, 0.05, saw) * 0.7;
  float edge = smoothstep(0.2, 0.03, vWorld.y - groundAt(vRest));
  float white = max(max(crown, bore) * build, max(spent, edge));
  foam = max(foam, smoothstep(0.3, 0.62, white + (lace - 0.5) * 0.5 + (grain - 0.5) * 0.4) * step(0.02, white));
  float body = (0.1 + 0.2 * smoothstep(0.0, 5.0, vDepth)) + foam * 0.7;
  // Sun coming through the thin water of the face.
  float glass = smoothstep(0.07, 0.0, saw) * build * (1.0 - foam);
  vec3 lit = uScatter * uSunCol * (0.2 + 0.5 * max(n.x * uSunDir.x + n.z * uSunDir.z + 0.2, 0.0) + 1.3 * glass) + vec3(0.9) * foam;
  // The water bends what lies under it: look it up where the bent ray lands.
  vec3 below = texture2D(uBelow, uv + n.xz * 0.05 / (1.0 + dist * 0.04)).rgb;
  vec3 col = mix(mix(below, lit, clamp(body, 0.0, 1.0)), sky, fresnel) + uSunCol * glitter * max(0.0, 1.0 - foam);
  // Foam is white water on top of it all: bright by day whatever the angle.
  float shade = 0.66 + 0.34 * max(dot(n, uSunDir), 0.0) + (grain - 0.5) * 0.14;
  col = mix(col, (uSunCol * 0.22 + uZenith * 0.5) * shade, foam);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SPRAY_VERTEX = /* glsl */ `
${WAVE_MATHS}
attribute vec2 aCell;
uniform float uLevel, uSprayShare;
varying vec2 vUv;
varying float vLeft;
vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// A cell that has nothing to throw this moment draws nothing.
void skip() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
void main() {
  // The grid of cells wraps round the eye, and each cell keeps its numbers wherever the eye is.
  vec2 cell = aCell + SPRAY_GRID * floor((cameraPosition.xz / SPRAY_CELL - aCell) / SPRAY_GRID + 0.5);
  vec3 own = hash3(vec3(cell, 1.0) + 512.0);
  vUv = position.xy + 0.5;
  vLeft = 0.0;
  if (own.z > uSprayShare) { skip(); return; }
  // Each drop lives again and again, thrown from wherever the surf was crashing when it was born.
  float life = 0.9 + own.x * 0.9;
  float round_ = floor((uTime + own.y * 97.0) / life);
  float born = round_ * life - own.y * 97.0;
  float age = uTime - born;
  vec3 toss = hash3(vec3(cell, round_) + 7.0);
  vec2 from = (cell + toss.xy) * SPRAY_CELL;
  float burst = surfBurst(depthAt(from), from, born);
  if (burst < 0.3) { skip(); return; }
  vec2 along = shoreward(from);
  vec2 drift = along * (1.0 + 3.0 * toss.y) + vec2(toss.z - 0.5, toss.x - 0.5) * 1.5;
  float rise = (0.5 + 0.5 * toss.z) * uWind * 0.8 * burst;
  float height = uLevel + 0.14 * uWind + rise * age - 4.2 * age * age;
  float size = (0.1 + 0.26 * toss.x * toss.x) * (1.0 + age * 3.0) * (0.5 + burst);
  vec4 view = viewMatrix * vec4(from.x + drift.x * age, height, from.y + drift.y * age, 1.0);
  view.xy += position.xy * size;
  vLeft = burst * smoothstep(0.0, 0.08, age) * pow(1.0 - age / life, 1.5);
  gl_Position = projectionMatrix * view;
}
`;

export const SPRAY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vLeft;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform vec3 uSunCol, uZenith;
void main() {
  if (texture2D(uDepth, gl_FragCoord.xy / uRes).r < gl_FragCoord.z) discard;
  vec2 q = vUv * 2.0 - 1.0;
  float soft = 1.0 - smoothstep(0.1, 1.0, length(q));
  gl_FragColor = vec4(uSunCol * 0.26 + uZenith * 0.55, soft * min(vLeft * 1.1, 0.7));
}
`;

export const PRESENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor;
uniform float uExposure;
void main() {
  vec3 col = 1.0 - exp(-texture2D(uColor, vUv).rgb * uExposure);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

export const COPY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor;
void main() { gl_FragColor = texture2D(uColor, vUv); }
`;

// Rebuilds the full image from past frames. Each frame lands on a slightly
// different pixel grid, so old frames carry detail this one did not draw. A
// past pixel is only trusted as far as the colours round it now agree with it.
export const RESOLVE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uNow, uPast, uDepth;
uniform mat4 uProjInv, uCamWorld, uPastViewProj;
uniform vec2 uTexel;
uniform float uFresh;
void main() {
  vec3 now = texture2D(uNow, vUv).rgb;
  vec3 low = now;
  vec3 high = now;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec3 c = texture2D(uNow, vUv + vec2(float(x), float(y)) * uTexel).rgb;
      low = min(low, c);
      high = max(high, c);
    }
  }
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, texture2D(uDepth, vUv).r * 2.0 - 1.0, 1.0);
  vec4 past = uPastViewProj * uCamWorld * vec4(view.xyz / view.w, 1.0);
  vec2 at = past.xy / past.w * 0.5 + 0.5;
  bool seen = at.x > 0.0 && at.x < 1.0 && at.y > 0.0 && at.y < 1.0;
  vec3 kept = clamp(texture2D(uPast, at).rgb, low, high);
  gl_FragColor = vec4(seen ? mix(kept, now, uFresh) : now, 1.0);
}
`;

export const SWARM_VERTEX = /* glsl */ `
attribute vec3 aTint;
attribute float aPhase;
uniform float uSize, uSwing;
varying vec3 vTint, vNormal;
void main() {
  vec3 p = position;
  float back = clamp(0.5 - p.z / uSize, 0.0, 1.2);
  p.x += uSwing * uSize * back * back * sin(aPhase - back * 5.2);
  vTint = aTint;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

export const SWARM_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSky, uGround;
varying vec3 vTint, vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float over = n.y * 0.5 + 0.5;
  vec3 light = mix(uGround, uSky, over) + uSunCol * max(dot(n, uSunDir), 0.0);
  gl_FragColor = vec4(vTint * light / 3.14159, 1.0);
}
`;

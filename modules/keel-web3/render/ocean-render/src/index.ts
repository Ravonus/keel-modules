/**
 * Draws a sea for keel/lit: the moving surface, the ground under it, and the
 * water itself, seen from above or from inside it. MIT.
 *
 *   const ocean = createOcean(lit, { sea });
 *   scene.add(ocean.group);
 *   // every frame, in place of renderer.render(scene, camera):
 *   ocean.draw(renderer, scene, camera, t, { sun, sunColor });
 *
 * The water is a pass over the finished scene, read from its depth: whatever is
 * in the scene, a seabed, a raymarched shark, a tree on the shore, loses its
 * colours to the water by the metres of water in front of it, and caustics fall
 * on it, so nothing in the scene has to know it is under the sea. The surface
 * shader evaluates the same waves `generative/ocean` answers from, so what
 * floats on them stays on them.
 *
 *   const swarm = createSwarm(lit, { bodies, pose: poseSwimmer });
 *   swarm.draw(swim.at(t), eye, light);
 *
 * A swarm draws any number of animals: the nearest as real bodies through
 * `render/sdf-body`, the rest as instances cut from the same body.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export type Vec = readonly [number, number, number];

/** The part of `generative/ocean`'s Sea this module reads. */
export interface SeaLike {
  readonly packed: Float32Array;
  readonly wind: number;
  surfaceAt(x: number, z: number, t: number, level?: number): { readonly height: number };
  seabedAt(x: number, z: number): number;
}

interface Uniform { value: unknown }
type Uniforms = Record<string, Uniform>;
interface DisposableLike { dispose(): void }
interface NodeLike {
  add(...nodes: unknown[]): void;
  frustumCulled: boolean;
  renderOrder: number;
  visible: boolean;
  receiveShadow: boolean;
}
interface AttributeLike {
  readonly array: Float32Array;
  needsUpdate: boolean;
}
interface GeometryLike extends DisposableLike {
  setAttribute(name: string, attribute: unknown): unknown;
  getAttribute(name: string): AttributeLike | undefined;
  setIndex(index: readonly number[]): unknown;
  computeVertexNormals(): void;
}
interface InstancesLike extends NodeLike {
  count: number;
  readonly instanceMatrix: AttributeLike;
}
interface TextureLike { readonly isTexture?: boolean }
interface TargetLike extends DisposableLike {
  readonly width: number;
  readonly height: number;
  readonly texture: TextureLike;
  readonly depthTexture: TextureLike;
  setSize(width: number, height: number): void;
}
interface Size { x: number; y: number }
interface Matrix4Like {
  elements: number[];
  copy(matrix: unknown): Matrix4Like;
  invert(): Matrix4Like;
  multiplyMatrices(a: unknown, b: unknown): Matrix4Like;
}
interface Vector4Like { set(x: number, y: number, z: number, w: number): Vector4Like }
interface Vector3Like { set(x: number, y: number, z: number): Vector3Like }
interface Vector2Like extends Size { set(x: number, y: number): Vector2Like }
interface ColorLike { readonly r: number; readonly g: number; readonly b: number }
interface DataTextureLike extends TextureLike, DisposableLike { needsUpdate: boolean }

/** The renderer calls this module makes. */
export interface RendererLike {
  autoClear: boolean;
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  getDrawingBufferSize(target: Vector2Like): Vector2Like;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: unknown, camera: unknown): void;
}

/** The camera fields this module reads. */
export interface CameraLike {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly matrixWorld: unknown;
  readonly matrixWorldInverse: unknown;
  readonly projectionMatrix: Matrix4Like;
  readonly projectionMatrixInverse: Matrix4Like;
}

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Stage: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancesLike;
  readonly Geometry: new () => GeometryLike;
  readonly Attribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly InstanceAttribute: new (array: Float32Array, size: number) => AttributeLike;
  readonly RenderTarget: new (width: number, height: number, options: Readonly<Record<string, unknown>>) => TargetLike;
  readonly DepthTexture: new (width: number, height: number) => TextureLike;
  readonly DataTexture: new (data: Float32Array, width: number, height: number, format: string, type: string) => DataTextureLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => DisposableLike;
  readonly LitMaterial: new (parameters: Readonly<Record<string, unknown>>) => DisposableLike;
  readonly OrthoCamera: new (left: number, right: number, top: number, bottom: number, near: number, far: number) => unknown;
  readonly Vector2: new (x?: number, y?: number) => Vector2Like;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => Vector4Like;
  readonly Matrix4: new () => Matrix4Like;
  readonly Color: new (value?: string) => ColorLike;
  plane(width: number, height: number, segmentsX?: number, segmentsY?: number): GeometryLike;
}

const unit = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---------------------------------------------------------------- shaders

const GROUND = /* glsl */ `
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

const WAVE_MATHS = /* glsl */ `
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
// As generative/ocean's steepOf, on the same three metres of ground.
float steepAt(vec2 p) {
  vec2 slope = vec2(groundAt(p + vec2(1.5, 0.0)) - groundAt(p - vec2(1.5, 0.0)), groundAt(p + vec2(0.0, 1.5)) - groundAt(p - vec2(0.0, 1.5))) / 3.0;
  return smoothstep(0.5, 1.4, length(slope));
}
// As generative/ocean's crashAt, a part at a time.
float crashReach(float depth) { return smoothstep(-0.6, 0.0, depth) * (1.0 - smoothstep(1.5, 3.5, depth)); }
float crashFront(vec2 p, float time) {
  float saw = sawAt(1.0, p, time);
  return pow(1.0 - saw, 3.0) * clamp(saw / 0.06, 0.0, 1.0) * setsAt(p, time);
}
// How close rock stands round this water: unlike steepAt it reaches out past the thin ring a face's foot is, for white water to fill.
float rockNear(vec2 p) {
  float top = max(max(groundAt(p + vec2(8.0, 0.0)), groundAt(p - vec2(8.0, 0.0))), max(groundAt(p + vec2(0.0, 8.0)), groundAt(p - vec2(0.0, 8.0))));
  return smoothstep(2.0, 4.5, top - groundAt(p)) * smoothstep(-1.0, 0.5, top - uShore);
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

const WATER_LIGHT = /* glsl */ `
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
// What lights the water from within: the sun, or once it is low the whole sky.
vec3 waterLight() { return max(uSunCol, uZenith * 3.0); }
vec3 scatterOver(float depth, vec3 through) { return uScatter * waterLight() * exp(-uAbsorb * max(depth, 0.0)) * (vec3(1.0) - through); }
`;

// Real rays through the real scene: the ground is a height map and each animal a
// few spheres, so a ray can walk them in the shader with no acceleration structure.
const TRACE = /* glsl */ `
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

const FULLSCREEN = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MEDIUM = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor, uDepth;
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uEye;
uniform float uTime;
uniform int uShafts, uSnow;
uniform float uWet, uRunUp, uPrintLife;
uniform sampler2D uPrints;
uniform vec3 uRockColor;
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
  return tint * uScatter * waterLight() * 0.42 / float(max(uShafts, 1)) * reach * 0.18;
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
float lump(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float low = mix(mix(hash3(i).x, hash3(i + vec3(1, 0, 0)).x, f.x), mix(hash3(i + vec3(0, 1, 0)).x, hash3(i + vec3(1, 1, 0)).x, f.x), f.y);
  float high = mix(mix(hash3(i + vec3(0, 0, 1)).x, hash3(i + vec3(1, 0, 1)).x, f.x), mix(hash3(i + vec3(0, 1, 1)).x, hash3(i + vec3(1, 1, 1)).x, f.x), f.y);
  return mix(low, high, f.z);
}
// Rock as it weathers: beds tilted and folded rather than level, of uneven thickness, split by joints, and stained downward by seeps.
vec3 stoneAt(vec3 col, vec3 p, vec3 n) {
  float lit = dot(col, vec3(0.3, 0.6, 0.1)) / max(dot(texture2D(uGroundColor, clamp(p.xz / uGroundSize + 0.5, 0.0, 1.0)).rgb, vec3(0.3, 0.6, 0.1)), 0.04);
  float fold = (lump(vec3(p.xz * 0.012, 2.0)) - 0.5) * 16.0 + (lump(p * vec3(0.05, 0.03, 0.05)) - 0.5) * 5.0;
  float bed = p.y + dot(p.xz, vec2(0.16, -0.09)) + fold;
  float beds = lump(vec3(bed * 0.55, p.xz * 0.02)) * 0.6 + lump(vec3(bed * 1.7, p.xz * 0.05)) * 0.3 + lump(vec3(bed * 5.0, p.xz * 0.2)) * 0.1;
  float joints = smoothstep(0.03, 0.09, abs(lump(vec3(p.xz * 0.16, bed * 0.05)) - 0.5));
  float crag = lump(p * 0.7) * 0.6 + lump(p * 2.1) * 0.3 + lump(p * 6.0) * 0.1;
  float seep = lump(vec3(p.xz * 0.35, p.y * 0.015));
  float tone = lump(vec3(p.xz * 0.018, p.y * 0.04) + 9.0);
  vec3 stone = uRockColor * mix(vec3(0.82, 0.86, 0.95), vec3(1.2, 1.02, 0.8), tone) * min(lit, 2.5);
  stone *= (0.5 + 1.0 * beds) * (0.68 + 0.64 * crag) * (0.62 + 0.38 * joints) * (1.0 - 0.3 * smoothstep(0.55, 0.75, seep));
  return mix(stone, stone * 1.3, smoothstep(0.1, 0.5, n.y) * 0.5);
}
float blob(vec2 q, vec2 at, vec2 size) { return 1.0 - smoothstep(0.72, 1.1, length((q - at) / size)); }
// A bare foot in metres, heel to toe along +y, deepest in the heel and ball, with sand pushed up round it.
float footAt(vec2 q) {
  float foot = max(max(blob(q, vec2(0.0, -0.085), vec2(0.04, 0.052)), blob(q, vec2(0.0, 0.055), vec2(0.05, 0.04))), blob(q, vec2(0.02, -0.01), vec2(0.024, 0.06)) * 0.6);
  for (int i = 0; i < 5; i++) {
    float f = float(i);
    foot = max(foot, blob(q, vec2(-0.036 + f * 0.0185, 0.122 - f * f * 0.0035), vec2(0.0135 - f * 0.0008, 0.016)) * 0.8);
  }
  float rim = blob(q, vec2(0.0, 0.0), vec2(0.1, 0.19));
  return foot - 0.35 * rim * (1.0 - foot);
}
// How deep the prints are here: the map holds at most one to a cell, so four cells cover any point.
float pressAt(vec2 p) {
  vec2 base = floor(p - 0.5);
  float most = 0.0;
  for (int z = 0; z < 2; z++) {
    for (int x = 0; x < 2; x++) {
      vec2 cell = base + vec2(float(x), float(z));
      vec4 print = texture2D(uPrints, (mod(cell, PRINT_GRID) + 0.5) / PRINT_GRID);
      vec2 q = p - cell - print.rg;
      if (print.r < 0.0 || dot(q, q) > 0.09) continue;
      float side = print.b > 7.0 ? 1.0 : -1.0;
      float h = print.b > 7.0 ? print.b - 10.0 : print.b;
      vec2 ahead = vec2(sin(h), cos(h));
      vec2 q2 = vec2((q.x * ahead.y - q.y * ahead.x) * side, dot(q, ahead));
      float left = 1.0 - clamp((uTime - print.a) / uPrintLife, 0.0, 1.0);
      float deep = footAt(q2) * left;
      most = abs(deep) > abs(most) ? deep : most;
    }
  }
  return most;
}
// What the ground's mesh is too coarse to carry: strata and tide marks on rock, and grain, wind ripples, shells and footprints in sand.
vec3 groundDetail(vec3 col, vec3 p, float dist) {
  if (dist > 240.0) return col;
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  float rock = 1.0 - smoothstep(0.62, 0.84, abs(n.y));
  // Rocks stand further off the baked ground than sand does, and a boat further still.
  if (abs(p.y - groundAt(p.xz)) > 3.5 + 3.0 * rock) return col;
  float fade = 1.0 - smoothstep(70.0, 240.0, dist);
  float warp = sin(p.x * 0.31 + p.z * 0.27) * 0.7 + sin(p.x * 0.93 - p.z * 0.71) * 0.25;
  vec3 stone = col;
  if (rock > 0.01) stone = stoneAt(col, p, n);
  stone = mix(stone, stone * vec3(0.42, 0.47, 0.38), smoothstep(uRunUp + 1.4, uRunUp - 0.1, p.y));
  float ripple = sin(p.z * 2.3 + warp * 3.6) * (1.0 - smoothstep(4.0, 60.0, dist));
  float close = 1.0 - smoothstep(1.5, 16.0, dist);
  vec3 cellOf = hash3(vec3(floor(p.xz * 70.0), 3.0));
  vec2 shellAt = p.xz * 9.0;
  vec3 shell = hash3(vec3(floor(shellAt), 8.0));
  float pip = 1.0 - smoothstep(0.08, 0.14, length(fract(shellAt) - 0.2 - shell.yz * 0.6));
  float dry = smoothstep(uWet - 0.1, uWet + 0.25, p.y);
  vec3 sand = col * (1.0 + 0.06 * ripple * dry + (cellOf.x - 0.5) * 0.2 * close);
  sand = mix(sand, sand * 1.22, step(0.96, shell.x) * pip * smoothstep(16.0, 4.0, dist));
  if (dist < 60.0 && rock < 0.5) {
    vec2 toSun = normalize(uSunDir.xz + 1e-4);
    float here = pressAt(p.xz);
    float there = pressAt(p.xz + toSun * 0.022);
    float low = clamp(1.3 - uSunDir.y, 0.35, 1.0);
    sand *= 1.0 - 0.2 * max(here, 0.0) * (1.0 - smoothstep(35.0, 60.0, dist)) + clamp((there - here) * -2.4 * low, -0.45, 0.4);
  }
  return mix(col, mix(sand, stone, rock), fade);
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
  if (!far) col = wetSand(groundDetail(col, eye + dir * dist, dist), eye + dir * dist, dir);
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
      col += snow(eye, dir, b) * uScatter * waterLight() * 1.6;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const SURFACE_VERTEX = /* glsl */ `
${WAVE_MATHS}
varying vec2 vRest;
varying vec3 vWorld;
varying float vDepth;
varying vec2 vAlong;
varying float vSteep;
varying float vNear;
uniform float uLevel;
void main() {
  vec2 rest = position.xz + cameraPosition.xz;
  float dist = length(position.xz);
  vRest = rest;
  vDepth = depthAt(rest);
  // A lip needs the mesh's fine rings, so far off a breaker only lifts.
  vAlong = vDepth < 3.5 ? shoreward(rest) * smoothstep(90.0, 45.0, dist) : vec2(0.0);
  vSteep = vDepth < 3.5 && dist < 320.0 ? steepAt(rest) : 0.0;
  vNear = vDepth < 14.0 && dist < 320.0 ? rockNear(rest) : 0.0;
  vWorld = displaced(rest, dist, max(vDepth, 0.0)) + breaker(rest, vDepth, vAlong) + vec3(0.0, uLevel + 0.16 * uWind * vSteep * crashReach(vDepth) * crashFront(rest, uTime), 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
${WAVE_MATHS}
${WATER_LIGHT}
${TRACE}
varying vec2 vRest;
varying vec3 vWorld;
varying float vDepth;
varying vec2 vAlong;
varying float vSteep;
varying float vNear;
uniform sampler2D uDepth, uBelow;
uniform vec2 uRes;
uniform float uTraceNear;
uniform int uWakeCount;
uniform vec4 uWake[MAX_WAKES];
uniform vec2 uWakeSize[MAX_WAKES];
// White water round a hull and streaming behind it in a Kelvin wake's two arms.
float wakeFoam(vec2 p) {
  float most = 0.0;
  for (int i = 0; i < uWakeCount; i++) {
    vec2 q = p - uWake[i].xy;
    vec2 ahead = uWake[i].zw;
    float speed = uWakeSize[i].x;
    float len = uWakeSize[i].y;
    float along = dot(q, ahead);
    float back = -along - len * 0.5;
    float side = abs(q.x * ahead.y - q.y * ahead.x);
    float hull = 1.0 - smoothstep(0.75, 1.15, length(vec2(along / (len * 0.55), side / (len * 0.2))));
    most = max(most, hull * (0.3 + min(speed * 0.25, 0.6)));
    if (speed < 0.3 || back < 0.0 || back > speed * 16.0) continue;
    float arm = 1.0 - smoothstep(0.0, 0.3 + back * 0.08, abs(side - len * 0.1 - back * 0.34));
    float keel = 1.0 - smoothstep(0.0, len * 0.14 + back * 0.05, side);
    most = max(most, max(arm * 0.7, keel) * exp(-back / (speed * 5.0)));
  }
  return most;
}
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
    vec3 beyond = mirror ? uScatter * waterLight() * 0.55 : skyColor(bent) * (1.0 - fresnel) * 0.9;
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
  float crown = smoothstep(0.03, 0.07, saw) * (1.0 - smoothstep(0.07, 0.17, saw)) * smoothstep(3.6, 2.6, vDepth);
  float fallen = smoothstep(2.4, 1.2, vDepth);
  float face = mix(smoothstep(0.0, 0.05, saw), 1.0, smoothstep(1.2, 0.7, vDepth));
  float bore = face * (1.0 - smoothstep(0.05, 0.3 + 0.3 * lace, saw)) * fallen;
  float spent = smoothstep(2.2, 0.5, vDepth) * smoothstep(0.55, 0.05, saw) * 0.7;
  float edge = smoothstep(0.2, 0.03, vWorld.y - groundAt(vRest));
  // A wave that hits rock goes white all at once, and the water round the rock stays broken between hits.
  float crash = vNear * smoothstep(-0.6, 0.0, vDepth) * (0.5 + 1.6 * crashFront(vRest, uTime));
  float white = max(max(max(crown, bore) * build, max(spent, edge)), max(crash, uWakeCount > 0 ? wakeFoam(vRest) : 0.0));
  foam = max(foam, smoothstep(0.3, 0.62, white + (lace - 0.5) * 0.5 + (grain - 0.5) * 0.4) * step(0.02, white));
  float body = (0.1 + 0.2 * smoothstep(0.0, 5.0, vDepth)) + foam * 0.7;
  // Sun coming through the thin water of the face.
  float glass = smoothstep(0.07, 0.0, saw) * build * (1.0 - foam);
  vec3 lit = uScatter * waterLight() * (0.2 + 0.5 * max(n.x * uSunDir.x + n.z * uSunDir.z + 0.2, 0.0) + 1.3 * glass) + vec3(0.9) * foam;
  // The water bends what lies under it: look it up where the bent ray lands.
  vec3 below = texture2D(uBelow, uv + n.xz * 0.05 / (1.0 + dist * 0.04)).rgb;
  vec3 col = mix(mix(below, lit, clamp(body, 0.0, 1.0)), sky, fresnel) + uSunCol * glitter * max(0.0, 1.0 - foam);
  // Foam is white water on top of it all: bright by day whatever the angle.
  float shade = 0.66 + 0.34 * max(dot(n, uSunDir), 0.0) + (grain - 0.5) * 0.14;
  col = mix(col, (uSunCol * 0.22 + uZenith * 0.5) * shade, foam);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPRAY_VERTEX = /* glsl */ `
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
  float depth = depthAt(from);
  float burst = surfBurst(depth, from, born);
  // A wave on a rock face throws its water straight up and back out to sea, far higher than one on sand.
  float hit = depth > -0.6 && depth < 14.0 ? rockNear(from) * crashFront(from, born) * 1.3 : 0.0;
  float blast = step(burst, hit);
  burst = max(burst, hit);
  if (burst < 0.3) { skip(); return; }
  vec2 along = shoreward(from);
  vec2 drift = along * (1.0 + 3.0 * toss.y) * (1.0 - 2.0 * blast) + vec2(toss.z - 0.5, toss.x - 0.5) * (1.5 + blast);
  float rise = (0.5 + 0.5 * toss.z) * uWind * 0.8 * burst * (1.0 + 1.5 * blast);
  float height = uLevel + 0.14 * uWind + rise * age - 4.2 * age * age;
  float size = (0.1 + 0.26 * toss.x * toss.x) * (1.0 + age * 3.0) * (0.5 + burst) * (1.0 + blast);
  vec4 view = viewMatrix * vec4(from.x + drift.x * age, height, from.y + drift.y * age, 1.0);
  view.xy += position.xy * size;
  vLeft = burst * smoothstep(0.0, 0.08, age) * pow(1.0 - age / life, 1.5);
  gl_Position = projectionMatrix * view;
}
`;

const SPRAY_FRAGMENT = /* glsl */ `
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

const PRESENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor, uSceneDepth, uSurfaceDepth;
uniform float uExposure;
void main() {
  vec3 col = 1.0 - exp(-texture2D(uColor, vUv).rgb * uExposure);
#ifdef INTO_TARGET
  // Whoever reads this target sets its own look, and needs to know how far each pixel is.
  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = min(texture2D(uSceneDepth, vUv).r, texture2D(uSurfaceDepth, vUv).r);
#else
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
#endif
}
`;

const COPY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uColor;
void main() { gl_FragColor = texture2D(uColor, vUv); }
`;

// Rebuilds the full image from past frames. Each frame lands on a slightly
// different pixel grid, so old frames carry detail this one did not draw. A
// past pixel is only trusted as far as the colours round it now agree with it.
const RESOLVE = /* glsl */ `
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

const SWARM_VERTEX = /* glsl */ `
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

const SWARM_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSky, uGround;
varying vec3 vTint, vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float over = n.y * 0.5 + 0.5;
  vec3 light = mix(uGround, uSky, over) + uSunCol * max(dot(n, uSunDir), 0.0);
  gl_FragColor = vec4(vTint * light / 3.14159, 1.0);
}
`;

// ---------------------------------------------------------------- the surface

/** A disc of rings round the eye, fine underfoot and coarse at the horizon. */
function surfaceGeometry(lit: LitLike, rings: number, spokes: number, radius: number): GeometryLike {
  const positions = new Float32Array((rings + 1) * spokes * 3);
  const index: number[] = [];
  const growth = Math.pow(radius, 1 / rings);
  for (let ring = 0; ring <= rings; ring += 1) {
    const r = ring === 0 ? 0 : Math.pow(growth, ring) * 0.35;
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = (spoke / spokes) * Math.PI * 2;
      positions.set([Math.cos(angle) * r, 0, Math.sin(angle) * r], (ring * spokes + spoke) * 3);
      if (ring === rings) continue;
      const a = ring * spokes + spoke;
      const b = ring * spokes + ((spoke + 1) % spokes);
      index.push(a, a + spokes, b, b, a + spokes, b + spokes);
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

function paintBed(lit: LitLike, geometry: GeometryLike, positions: Float32Array, colorAt: (x: number, y: number, z: number) => Vec): void {
  const colors = new Float32Array(positions.length);
  for (let at = 0; at + 2 < positions.length; at += 3) {
    colors.set(colorAt(positions[at] ?? 0, positions[at + 1] ?? 0, positions[at + 2] ?? 0), at);
  }
  geometry.setAttribute("color", new lit.Attribute(colors, 3));
}

interface BakedGround {
  readonly height: DataTextureLike;
  readonly color: DataTextureLike;
  readonly top: number;
}

/** The ground as the shaders read it: its height, and its colour for the rays that land on it. */
function bakeGround(lit: LitLike, sea: SeaLike, size: number, colorAt: OceanOptions["colorAt"]): BakedGround {
  const heights = new Float32Array(GROUND_CELLS * GROUND_CELLS);
  const colors = new Float32Array(GROUND_CELLS * GROUND_CELLS * 4);
  const share = (cell: number): number => (cell / (GROUND_CELLS - 1) - 0.5) * size;
  let top = 0;
  for (let cell = 0; cell < heights.length; cell += 1) {
    const x = share(cell % GROUND_CELLS);
    const z = share(Math.floor(cell / GROUND_CELLS));
    const y = sea.seabedAt(x, z);
    heights[cell] = y;
    top = Math.max(top, y);
    const tint = colorAt?.(x, y, z) ?? [0.27, 0.23, 0.14];
    colors.set([tint[0], tint[1], tint[2], 1], cell * 4);
  }
  const height = new lit.DataTexture(heights, GROUND_CELLS, GROUND_CELLS, "red", "float");
  const color = new lit.DataTexture(colors, GROUND_CELLS, GROUND_CELLS, "rgba", "float");
  height.needsUpdate = true;
  color.needsUpdate = true;
  return { height, color, top };
}

/** How far the far ground runs, as a share of the fine ground, and its cells a side across the fine ground. */
const FAR_SPAN = 5;
const FAR_CELLS = 40;

/**
 * The ground past the fine mesh, coarse and from the same answers. It reaches a
 * cell in under the fine mesh and sinks there, so the two never leave a crack.
 */
function farGroundOf(lit: LitLike, sea: SeaLike, size: number, colorAt: OceanOptions["colorAt"]): GeometryLike {
  const half = (FAR_SPAN * FAR_CELLS) / 2;
  const inner = FAR_CELLS / 2;
  const side = half * 2 + 1;
  const step = size / FAR_CELLS;
  const positions = new Float32Array(side * side * 3);
  const index: number[] = [];
  for (let row = -half; row <= half; row += 1) {
    for (let column = -half; column <= half; column += 1) {
      const [x, z] = [column * step, row * step];
      const under = Math.abs(column) < inner && Math.abs(row) < inner;
      const at = (row + half) * side + column + half;
      positions.set([x, sea.seabedAt(x, z) - (under ? 3 : 0), z], at * 3);
      const cut = Math.abs(column + 0.5) < inner - 1 && Math.abs(row + 0.5) < inner - 1;
      if (column < half && row < half && !cut) index.push(at, at + side, at + 1, at + 1, at + side, at + side + 1);
    }
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  if (colorAt) paintBed(lit, geometry, positions, colorAt);
  return geometry;
}

function seabedOf(lit: LitLike, sea: SeaLike, size: number, cells: number, colorAt: OceanOptions["colorAt"]): { mesh: NodeLike; geometry: GeometryLike; far: GeometryLike; material: DisposableLike } {
  const geometry = lit.plane(size, size, cells, cells);
  const position = geometry.getAttribute("position");
  if (position) {
    for (let at = 0; at + 2 < position.array.length; at += 3) {
      const x = position.array[at] ?? 0;
      const z = -(position.array[at + 1] ?? 0);
      position.array.set([x, sea.seabedAt(x, z), z], at);
    }
    position.needsUpdate = true;
  }
  geometry.computeVertexNormals();
  if (position && colorAt) paintBed(lit, geometry, position.array, colorAt);
  const material = new lit.LitMaterial({ color: colorAt ? "#ffffff" : "#8f8468", vertexColors: colorAt !== undefined, roughness: 0.95, metalness: 0 });
  const near = new lit.Mesh(geometry, material);
  near.receiveShadow = true;
  const far = farGroundOf(lit, sea, size, colorAt);
  const mesh = new lit.Group();
  mesh.add(near, new lit.Mesh(far, material));
  return { mesh, geometry, far, material };
}

/** A rock to stand on the ground: `generative/beach`'s `rocksWithin` fits. */
export interface RockLike {
  readonly at: Vec;
  readonly radius: number;
  readonly height: number;
  readonly yaw: number;
}

/** A wobbly lump, its foot at y = 0 and top at y = 1: a ball's facets, knocked in and out and left unsmoothed. */
function lumpPositions(rounds: number): number[] {
  const corners: Vec[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const at = (index: number): Vec => corners[index] ?? [0, 1, 0];
  let faces: Vec[][] = [[0, 1, 2], [2, 1, 3], [3, 1, 5], [5, 1, 0], [2, 4, 0], [3, 4, 2], [5, 4, 3], [0, 4, 5]].map((face) => [at(face[0] ?? 0), at(face[1] ?? 0), at(face[2] ?? 0)]);
  const middle = (a: Vec, b: Vec): Vec => unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  for (let round = 0; round < rounds; round += 1) {
    faces = faces.flatMap(([a = at(0), b = at(0), c = at(0)]) => {
      const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
      return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    });
  }
  const knocked = ([x, y, z]: Vec): Vec => {
    const push = 1 + 0.17 * Math.sin(x * 5.1 + y * 3.3) * Math.sin(z * 4.7 - y * 2.9) + 0.08 * Math.sin(x * 11 + z * 13 + y * 9) + 0.035 * Math.sin(x * 29 - z * 23 + y * 31);
    const up = Math.max(y, -0.2);
    return [x * push, (0.08 + up * 0.92) * (1 + 0.12 * Math.sin(x * 4 + z * 3)), z * push];
  };
  return faces.flatMap((face) => face.flatMap((corner) => [...knocked(corner)]));
}

/** Every rock as an instance of one lump, turned and stretched by its own numbers. */
function rocksOf(lit: LitLike, rocks: readonly RockLike[], color: Vec): { group: NodeLike; geometry: GeometryLike; material: DisposableLike } {
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(lumpPositions(4)), 3));
  geometry.computeVertexNormals();
  const hex = `#${color.map((channel) => Math.round(Math.pow(Math.min(channel, 1), 1 / 2.2) * 255).toString(16).padStart(2, "0")).join("")}`;
  const material = new lit.LitMaterial({ color: hex, roughness: 0.96, metalness: 0 });
  const group = new lit.Instances(geometry, material, Math.max(rocks.length, 1));
  group.count = rocks.length;
  group.frustumCulled = false;
  rocks.forEach((rock, index) => {
    const [c, s] = [Math.cos(rock.yaw), Math.sin(rock.yaw)];
    const stretch = 0.8 + 0.4 * ((rock.yaw * 7) % 1);
    group.instanceMatrix.array.set([c * rock.radius, 0, -s * rock.radius, 0, 0, rock.height, 0, 0, s * rock.radius * stretch, 0, c * rock.radius * stretch, 0, rock.at[0], rock.at[1], rock.at[2], 1], index * 16);
  });
  group.instanceMatrix.needsUpdate = true;
  return { group, geometry, material };
}

/** One foot in the sand: `generative/beach`'s `Print` fits. */
export interface PrintLike {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly heading: number;
  readonly foot: number;
}

/** Cells a side of the wrapping map of footprints, a metre each. */
const PRINT_GRID = 256;

/** Prints that are there from the start and fade for nobody: only the water takes them. */
const FOREVER = 1e9;

/** The footprints: a map the sand reads, and which of them the water or the wind has yet to take. */
function printsOf(lit: LitLike, life: number): { texture: DataTextureLike; press(print: PrintLike, born: number): void; sweep(runUp: number, t: number): void } {
  const data = new Float32Array(PRINT_GRID * PRINT_GRID * 4).fill(-1);
  const texture = new lit.DataTexture(data, PRINT_GRID, PRINT_GRID, "rgba", "float");
  const held = new Map<number, { readonly y: number; readonly born: number }>();
  const wrap = (value: number): number => ((value % PRINT_GRID) + PRINT_GRID) % PRINT_GRID;
  texture.needsUpdate = true;
  return {
    texture,
    press(print, born) {
      const [cx, cz] = [Math.floor(print.x), Math.floor(print.z)];
      const cell = wrap(cz) * PRINT_GRID + wrap(cx);
      const heading = ((print.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      data.set([print.x - cx, print.z - cz, heading + (print.foot > 0 ? 10 : 0), born], cell * 4);
      held.set(cell, { y: print.y, born });
      texture.needsUpdate = true;
    },
    sweep(runUp, t) {
      for (const [cell, print] of held) {
        if (print.y >= runUp && t - print.born < life) continue;
        data.fill(-1, cell * 4, cell * 4 + 4);
        held.delete(cell);
        texture.needsUpdate = true;
      }
    },
  };
}

/** The footprints, with those already on the sand pressed in. */
function laidPrints(lit: LitLike, laid: readonly PrintLike[], life: number): ReturnType<typeof printsOf> {
  const prints = printsOf(lit, life);
  for (const print of laid) prints.press(print, FOREVER);
  return prints;
}

export interface OceanOptions {
  readonly sea: SeaLike;
  /** Per-metre absorption of red, green and blue: a little murkier than `generative/ocean`'s `CLEAR_WATER` by default, so a scene ends in blue. */
  readonly absorption?: Vec;
  /** The colour the water scatters back, as shares of the sun. */
  readonly scatter?: Vec;
  /** The tide: the still water's height. */
  readonly level?: number;
  /** Across the seabed, metres. */
  readonly size?: number;
  /** The ground's colour, linear RGB, at a place on it: `generative/beach`'s `colorAt` fits. */
  readonly colorAt?: (x: number, y: number, z: number) => Vec;
  readonly exposure?: number;
  /** Seconds wet sand takes to dry a metre down from the highest line the water reached. */
  readonly dryTime?: number;
  /** Rocks to stand on the ground, drawn whole: `generative/beach`'s `rocksWithin` fits. */
  readonly rocks?: readonly RockLike[];
  /** The rocks' colour, linear RGB. */
  readonly rockColor?: Vec;
  /** Footprints already on the sand: `generative/beach`'s `trails` fits. They last until the water reaches them. */
  readonly prints?: readonly PrintLike[];
  /** Seconds the wind takes to fill a new footprint. */
  readonly printLife?: number;
  /** `render/quality`'s createQuality, or anything answering the same. The default is steady high settings. */
  readonly quality?: QualityLike;
}

/** What one frame may spend: `render/quality`'s Settings. */
export interface OceanSettings {
  readonly renderScale: number;
  readonly upscale: boolean;
  readonly reflectSteps: number;
  readonly shadowSteps: number;
  readonly traceFar: number;
  readonly traceNear: number;
  readonly casters: number;
  readonly shafts: number;
  readonly snow: number;
  /** The share of the surf's spray drawn, from 0 to 1. */
  readonly spray?: number;
}

/** Where the camera is, for a quality to judge. */
export interface OceanPlace {
  readonly under: boolean;
  readonly depth: number;
  readonly height: number;
  readonly clearance: number;
}

export interface QualityLike {
  at(place: OceanPlace): OceanSettings;
  frame(milliseconds: number): void;
}

const STEADY: OceanSettings = { renderScale: 0.8, upscale: true, reflectSteps: 28, shadowSteps: 20, traceFar: 140, traceNear: 140, casters: 16, shafts: 16, snow: 6, spray: 0.8 };

/** A sphere standing in for part of an animal in the rays. */
export interface Caster {
  readonly at: Vec;
  readonly r: number;
  /** Linear RGB. */
  readonly tint: Vec;
}

/** The part of `render/world-light`'s WorldLight this module reads. */
export interface WorldLightLike {
  readonly sun: WorldBody;
  readonly moon: WorldBody;
  readonly sky: { readonly top: string; readonly horizon: string };
  /** 0 day to 1 full night. */
  readonly night: number;
}

interface WorldBody {
  readonly direction: Vec;
  readonly color: string;
  readonly intensity: number;
}

/** A hex colour as linear RGB. */
function linearOf(hex: string): Vec {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return [channel(1), channel(3), channel(5)];
}

/**
 * Turns `render/world-light`'s light into the light `draw` takes: the sun by
 * day and the moon by night, with the sky's own colours.
 *
 * @param world What `worldLight` answered.
 * @returns The sun, sky and their colours; add the tide and casters to it.
 */
export function lightFromWorld(world: WorldLightLike): Pick<OceanLight, "sun" | "sunColor" | "zenith" | "horizon"> {
  const body = world.night > 0.5 ? world.moon : world.sun;
  const color = linearOf(body.color);
  return {
    // (A body on the horizon still lights the water, and the shaders divide by its height.)
    sun: [body.direction[0], Math.max(body.direction[1], 0.03), body.direction[2]],
    sunColor: [color[0] * body.intensity, color[1] * body.intensity, color[2] * body.intensity],
    zenith: linearOf(world.sky.top),
    horizon: linearOf(world.sky.horizon),
  };
}

/** A hull moving through the water. */
export interface Wake {
  readonly x: number;
  readonly z: number;
  /** Unit direction of travel, x then z. */
  readonly ahead: readonly [number, number];
  /** Metres per second. */
  readonly speed: number;
  /** The hull's length, metres. */
  readonly length: number;
}

export interface OceanLight {
  /** Toward the sun. */
  readonly sun: Vec;
  /** Linear RGB times intensity. */
  readonly sunColor: Vec;
  readonly zenith?: Vec;
  readonly horizon?: Vec;
  /** The tide, if it has moved since `createOcean`. */
  readonly level?: number;
  /** The animals, for the rays: `swarm.casters`. */
  readonly casters?: readonly Caster[];
  /** Boats, for the white water round and behind them. */
  readonly wakes?: readonly Wake[];
  /** How long the last frame took, milliseconds, for the quality to hold the frame rate. */
  readonly frameMs?: number;
}

export interface Ocean {
  /** The seabed: add it to the scene. */
  readonly group: NodeLike;
  /** Whether a point is below the water at t. */
  isUnder(x: number, y: number, z: number, t: number): boolean;
  /** Presses a foot into the sand at t: the wind fills it in `printLife`, and the water takes it sooner. */
  press(print: PrintLike, t: number): void;
  /** Draws the scene with the water over it, to the screen. */
  draw(renderer: RendererLike, scene: unknown, camera: CameraLike, t: number, light: OceanLight): void;
  dispose(): void;
}

/** The most spheres a ray can meet. */
const MAX_CASTERS = 32;

/** The most hulls that leave a wake. */
const MAX_WAKES = 8;

/** Cells a side of the wrapping grid spray is thrown from, and their size in metres. */
const SPRAY_GRID = 130;
const SPRAY_CELL = 0.9;

/** Cells a side of the ground baked for the surface to read its depth from. */
const GROUND_CELLS = 256;

const DEFAULT_ZENITH: Vec = [0.16, 0.34, 0.68];
const DEFAULT_HORIZON: Vec = [0.74, 0.84, 0.93];

interface Pass { readonly stage: NodeLike; readonly material: DisposableLike }

function passOf(lit: LitLike, quad: GeometryLike, uniforms: Uniforms, fragmentShader: string, defines: Readonly<Record<string, unknown>> = {}, depth: Readonly<Record<string, unknown>> = { depthTest: false, depthWrite: false }): Pass {
  const material = new lit.CustomMaterial({ defines, uniforms, vertexShader: FULLSCREEN, fragmentShader, ...depth });
  const mesh = new lit.Mesh(quad, material);
  mesh.frustumCulled = false;
  const stage = new lit.Stage();
  stage.add(mesh);
  return { stage, material };
}

function sceneTarget(lit: LitLike): TargetLike {
  return new lit.RenderTarget(1, 1, { minFilter: "nearest", magFilter: "nearest", generateMipmaps: false, type: "half", depthBuffer: true, depthTexture: new lit.DepthTexture(1, 1) });
}

function colorTarget(lit: LitLike): TargetLike {
  return new lit.RenderTarget(1, 1, { minFilter: "linear", magFilter: "linear", generateMipmaps: false, type: "half", depthBuffer: false });
}

function waveUniform(lit: LitLike, packed: Float32Array): Vector4Like[] {
  const at = (index: number): number => packed[index] ?? 0;
  const vectors: Vector4Like[] = [];
  for (let index = 0; index + 7 < packed.length; index += 8) {
    vectors.push(new lit.Vector4(at(index), at(index + 1), at(index + 2), at(index + 3)), new lit.Vector4(at(index + 4), at(index + 5), at(index + 6), 0));
  }
  return vectors;
}

/** The last pass, as it goes to the screen or into a target someone else reads. */
function presenterOf(lit: LitLike, quad: GeometryLike, scene: TargetLike, final: TargetLike, exposure: number): { screen: Pass; target: Pass; uniforms: Uniforms } {
  const uniforms: Uniforms = { uColor: { value: final.texture }, uExposure: { value: exposure }, uSceneDepth: { value: scene.depthTexture }, uSurfaceDepth: { value: final.depthTexture } };
  return {
    uniforms,
    screen: passOf(lit, quad, uniforms, PRESENT),
    target: passOf(lit, quad, uniforms, PRESENT, { INTO_TARGET: 1 }, { depthTest: true, depthWrite: true, depthFunc: "always" }),
  };
}

function setVec(uniform: Uniform | undefined, value: Vec): void {
  (uniform?.value as Vector3Like | undefined)?.set(value[0], value[1], value[2]);
}

function lightUniforms(lit: LitLike, absorption: Vec, scatter: Vec): Uniforms {
  const vector = (v: Vec): Uniform => ({ value: new lit.Vector3(v[0], v[1], v[2]) });
  return {
    uAbsorb: vector(absorption), uScatter: vector(scatter), uSunDir: vector([0, 1, 0]), uSunCol: vector([3, 3, 3]),
    uZenith: vector(DEFAULT_ZENITH), uHorizon: vector(DEFAULT_HORIZON), uLevel: { value: 0 }, uUnder: { value: 0 }, uTime: { value: 0 },
    uShore: { value: 0 }, uWet: { value: 0 }, uRunUp: { value: 0 }, uSprayShare: { value: 0 }, uReflectSteps: { value: 0 }, uShadowSteps: { value: 0 }, uCasterCount: { value: 0 }, uTraceFar: { value: 0 }, uTraceNear: { value: 0 }, uShafts: { value: 0 }, uSnow: { value: 0 },
    uCaster: { value: Array.from({ length: MAX_CASTERS }, () => new lit.Vector4()) },
    uCasterTint: { value: Array.from({ length: MAX_CASTERS }, () => new lit.Vector3()) },
    uWakeCount: { value: 0 },
    uWake: { value: Array.from({ length: MAX_WAKES }, () => new lit.Vector4()) },
    uWakeSize: { value: Array.from({ length: MAX_WAKES }, () => new lit.Vector2()) },
  };
}

/**
 * Where wet sand stops, a moment later: pushed up at once by the water, and
 * falling slowly by itself once the water leaves.
 *
 * @param top The line before, height in metres.
 * @param runUp How high the water reaches now.
 * @param seconds Since the line before; going back in time starts it over.
 * @param dryTime Seconds the line takes to fall a metre.
 * @returns The line now.
 */
export function wetLineAfter(top: number, runUp: number, seconds: number, dryTime: number): number {
  return seconds < 0 ? runUp : Math.max(runUp, top - seconds / dryTime);
}

/** Keeps the wet line from frame to frame: the one thing here with a memory. */
function wetLineOf(shared: Uniforms, wind: number, dryTime: number): (level: number, t: number) => void {
  let top = -Infinity;
  let last = 0;
  return (level, t) => {
    const runUp = level + 0.07 * wind + 0.2;
    top = wetLineAfter(top, runUp, t - last, dryTime);
    last = t;
    if (shared.uRunUp) shared.uRunUp.value = runUp;
    if (shared.uWet) shared.uWet.value = top;
  };
}

function writeLight(shared: Uniforms, light: OceanLight, level: number, under: boolean, t: number): void {
  setVec(shared.uSunDir, unit(light.sun));
  setVec(shared.uSunCol, light.sunColor);
  setVec(shared.uZenith, light.zenith ?? DEFAULT_ZENITH);
  setVec(shared.uHorizon, light.horizon ?? DEFAULT_HORIZON);
  if (shared.uLevel) shared.uLevel.value = level;
  if (shared.uShore) shared.uShore.value = level;
  if (shared.uUnder) shared.uUnder.value = under ? 1 : 0;
  if (shared.uTime) shared.uTime.value = t;
}

function writeWakes(shared: Uniforms, wakes: readonly Wake[]): void {
  const [spots, sizes] = [shared.uWake?.value as Vector4Like[], shared.uWakeSize?.value as Vector2Like[]];
  const count = Math.min(wakes.length, MAX_WAKES);
  for (let index = 0; index < count; index += 1) {
    const wake = wakes[index];
    if (wake) {
      spots[index]?.set(wake.x, wake.z, wake.ahead[0], wake.ahead[1]);
      sizes[index]?.set(wake.speed, wake.length);
    }
  }
  if (shared.uWakeCount) shared.uWakeCount.value = count;
}

function writeMovers(shared: Uniforms, light: OceanLight, settings: OceanSettings): void {
  writeWakes(shared, light.wakes ?? []);
  writeSettings(shared, settings, light.casters ?? []);
}

function writeSettings(shared: Uniforms, settings: OceanSettings, casters: readonly Caster[]): void {
  const set = (name: string, value: number): void => { const uniform = shared[name]; if (uniform) uniform.value = value; };
  const count = Math.min(casters.length, settings.casters, MAX_CASTERS);
  set("uReflectSteps", settings.reflectSteps);
  set("uShadowSteps", settings.shadowSteps);
  set("uTraceFar", settings.traceFar);
  set("uTraceNear", settings.traceNear);
  set("uShafts", settings.shafts);
  set("uSnow", settings.snow);
  set("uSprayShare", settings.spray ?? 0);
  set("uCasterCount", count);
  const spheres = shared.uCaster?.value as Vector4Like[];
  const tints = shared.uCasterTint?.value as Vector3Like[];
  for (let index = 0; index < count; index += 1) {
    const caster = casters[index];
    if (caster) {
      spheres[index]?.set(caster.at[0], caster.at[1], caster.at[2], caster.r);
      tints[index]?.set(caster.tint[0], caster.tint[1], caster.tint[2]);
    }
  }
}

/** Halton points: an even spread of offsets, so eight frames sample eight spots in a pixel. */
const halton = (index: number, base: number): number => {
  let result = 0;
  let share = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += share * (i % base);
    share /= base;
  }
  return result;
};
const JITTERS = 8;

interface Resolver {
  readonly pass: Pass;
  readonly uniforms: Uniforms;
  readonly targets: readonly [TargetLike, TargetLike];
  readonly past: Matrix4Like;
  frame: number;
  /** Draws fresh pixels over the history at this size, and returns what now holds the image. */
  resolve(renderer: RendererLike, quadCamera: unknown, now: TargetLike, depth: TargetLike, width: number, height: number, camera: CameraLike): TargetLike;
}

function resolverOf(lit: LitLike, quad: GeometryLike): Resolver {
  const uniforms: Uniforms = { uNow: { value: null }, uPast: { value: null }, uDepth: { value: null }, uProjInv: { value: new lit.Matrix4() }, uCamWorld: { value: new lit.Matrix4() }, uPastViewProj: { value: new lit.Matrix4() }, uTexel: { value: new lit.Vector2() }, uFresh: { value: 0.12 } };
  const targets: readonly [TargetLike, TargetLike] = [colorTarget(lit), colorTarget(lit)];
  const pass = passOf(lit, quad, uniforms, RESOLVE);
  const past = new lit.Matrix4();
  let filled = false;
  const resolver: Resolver = {
    pass, uniforms, targets, past, frame: 0,
    resolve(renderer, quadCamera, now, depth, width, height, camera) {
      const into = targets[resolver.frame % 2 === 0 ? 0 : 1];
      const from = targets[resolver.frame % 2 === 0 ? 1 : 0];
      into.setSize(width, height);
      from.setSize(width, height);
      const set = (name: string, value: unknown): void => { const uniform = uniforms[name]; if (uniform) uniform.value = value; };
      set("uNow", now.texture);
      set("uPast", from.texture);
      set("uDepth", depth.depthTexture);
      set("uFresh", filled ? 0.12 : 1);
      (uniforms.uProjInv?.value as Matrix4Like).copy(camera.projectionMatrixInverse);
      (uniforms.uCamWorld?.value as Matrix4Like).copy(camera.matrixWorld);
      (uniforms.uPastViewProj?.value as Matrix4Like).copy(past);
      renderer.setRenderTarget(into);
      renderer.render(pass.stage, quadCamera);
      filled = true;
      resolver.frame += 1;
      return into;
    },
  };
  return resolver;
}

/** Moves the camera's projection by part of a pixel, and hands back how to undo it. */
function jitter(camera: CameraLike, frame: number, width: number, height: number): () => void {
  const index = frame % JITTERS + 1;
  const projection = camera.projectionMatrix;
  const x = ((halton(index, 2) - 0.5) * 2) / width;
  const y = ((halton(index, 3) - 0.5) * 2) / height;
  const inverse = camera.projectionMatrixInverse;
  const [ex, ey] = [projection.elements[8] ?? 0, projection.elements[9] ?? 0];
  projection.elements[8] = ex + x;
  projection.elements[9] = ey + y;
  inverse.copy(projection).invert();
  return () => {
    projection.elements[8] = ex;
    projection.elements[9] = ey;
    inverse.copy(projection).invert();
  };
}

/** Whatever passes share. */
interface Rig {
  readonly scene: TargetLike;
  readonly water: TargetLike;
  readonly final: TargetLike;
  readonly mediumUniforms: Uniforms;
  readonly medium: Pass;
  readonly copy: Pass;
  readonly surface: NodeLike;
  readonly surfaceUniforms: Uniforms;
  readonly spray: NodeLike;
  readonly quadCamera: unknown;
}

/** The world's passes, at one render size: scene, water over it, surface over that. */
function drawWorld(rig: Rig, renderer: RendererLike, stage: unknown, camera: CameraLike, width: number, height: number): void {
  const eye = camera.position;
  for (const target of [rig.scene, rig.water, rig.final]) target.setSize(width, height);
  (rig.surfaceUniforms.uRes?.value as Vector2Like).set(width, height);
  renderer.autoClear = true;
  renderer.setRenderTarget(rig.scene);
  renderer.render(stage, camera);
  (rig.mediumUniforms.uProjInv?.value as Matrix4Like).copy(camera.projectionMatrixInverse);
  (rig.mediumUniforms.uCamWorld?.value as Matrix4Like).copy(camera.matrixWorld);
  (rig.mediumUniforms.uEye?.value as Vector3Like).set(eye.x, eye.y, eye.z);
  renderer.setRenderTarget(rig.water);
  renderer.render(rig.medium.stage, rig.quadCamera);
  renderer.setRenderTarget(rig.final);
  renderer.render(rig.copy.stage, rig.quadCamera);
  renderer.autoClear = false;
  renderer.clear(false, true, false);
  rig.spray.visible = (rig.surfaceUniforms.uSprayShare?.value as number) > 0;
  renderer.render(rig.surface, camera);
}

function surfaceOf(lit: LitLike, uniforms: Uniforms, defines: Readonly<Record<string, unknown>>): { stage: NodeLike; disc: GeometryLike; material: DisposableLike } {
  const material = new lit.CustomMaterial({ defines, uniforms, vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT, side: "both", depthWrite: true, depthTest: true });
  const disc = surfaceGeometry(lit, 150, 220, 1400);
  const mesh = new lit.Mesh(disc, material);
  mesh.frustumCulled = false;
  const stage = new lit.Stage();
  stage.add(mesh);
  return { stage, disc, material };
}

/** One quad a drop, thrown and aged in its vertex shader. */
function sprayOf(lit: LitLike, stage: NodeLike, uniforms: Uniforms, defines: Readonly<Record<string, unknown>>): { mesh: NodeLike; quad: GeometryLike; material: DisposableLike } {
  const quad = lit.plane(1, 1);
  const cells = new Float32Array(SPRAY_GRID * SPRAY_GRID * 2);
  for (let index = 0; index < SPRAY_GRID * SPRAY_GRID; index += 1) cells.set([index % SPRAY_GRID, Math.floor(index / SPRAY_GRID)], index * 2);
  quad.setAttribute("aCell", new lit.InstanceAttribute(cells, 2));
  const material = new lit.CustomMaterial({ defines: { ...defines, SPRAY_GRID: `${SPRAY_GRID}.0`, SPRAY_CELL: SPRAY_CELL.toFixed(2) }, uniforms, vertexShader: SPRAY_VERTEX, fragmentShader: SPRAY_FRAGMENT, side: "both", transparent: true, depthWrite: false, depthTest: true });
  const mesh = new lit.Instances(quad, material, SPRAY_GRID * SPRAY_GRID);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  stage.add(mesh);
  return { mesh, quad, material };
}

/** The full-size picture rebuilt from this frame and past ones. */
function upscaled(resolver: Resolver, renderer: RendererLike, quadCamera: unknown, final: TargetLike, size: Size, width: number, height: number, camera: CameraLike): TargetLike {
  (resolver.uniforms.uTexel?.value as Vector2Like).set(1 / width, 1 / height);
  const shown = resolver.resolve(renderer, quadCamera, final, final, size.x, size.y, camera);
  resolver.past.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return shown;
}

/** What this frame spends, and its size. A target's owner picks its size and rebuilds the picture itself. */
function frameFor(renderer: RendererLike, into: TargetLike | null, spent: OceanSettings, size: Vector2Like): { settings: OceanSettings; width: number; height: number } {
  if (into) size.set(into.width, into.height);
  else renderer.getDrawingBufferSize(size);
  const settings = into ? { ...spent, upscale: false, renderScale: 1 } : spent;
  return { settings, width: Math.max(1, Math.floor(size.x * settings.renderScale)), height: Math.max(1, Math.floor(size.y * settings.renderScale)) };
}

function placeOf(sea: SeaLike, eye: CameraLike["position"], level: number, t: number): OceanPlace {
  const top = sea.surfaceAt(eye.x, eye.z, t, level).height;
  return { under: eye.y < top, depth: Math.max(0, top - eye.y), height: Math.max(0, eye.y - top), clearance: eye.y - sea.seabedAt(eye.x, eye.z) };
}

/**
 * Makes an ocean to draw.
 *
 * @param lit The keel/lit namespace.
 * @param options The sea, the water's colour, the tide, and the quality.
 * @returns The seabed for the scene, and a `draw` to use in place of `renderer.render`.
 */
export function createOcean(lit: LitLike, options: OceanOptions): Ocean {
  const { sea } = options;
  const baseLevel = options.level ?? 0;
  const seabedSize = options.size ?? 320;
  const baked = bakeGround(lit, sea, seabedSize, options.colorAt);
  const printLife = options.printLife ?? 900;
  const prints = laidPrints(lit, options.prints ?? [], printLife);
  const shared: Uniforms = { ...lightUniforms(lit, options.absorption ?? [0.38, 0.085, 0.05], options.scatter ?? [0.012, 0.13, 0.2]), uWind: { value: sea.wind }, uGround: { value: baked.height }, uGroundColor: { value: baked.color }, uGroundSize: { value: seabedSize }, uGroundTop: { value: baked.top }, uPrints: { value: prints.texture }, uPrintLife: { value: printLife }, uRockColor: { value: new lit.Vector3(...(options.rockColor ?? [0.3, 0.25, 0.2])) } };
  const defines = { WAVES: sea.packed.length / 8, GROUND_CELLS: `${GROUND_CELLS}.0`, MAX_CASTERS, MAX_WAKES, PRINT_GRID: `${PRINT_GRID}.0` };
  const quad = lit.plane(2, 2);
  const quadCamera = new lit.OrthoCamera(-1, 1, 1, -1, 0, 1);
  const [scene, water, final] = [sceneTarget(lit), colorTarget(lit), sceneTarget(lit)];
  const size = new lit.Vector2();
  const mediumUniforms: Uniforms = { ...shared, uColor: { value: scene.texture }, uDepth: { value: scene.depthTexture }, uProjInv: { value: new lit.Matrix4() }, uCamWorld: { value: new lit.Matrix4() }, uEye: { value: new lit.Vector3() } };
  const medium = passOf(lit, quad, mediumUniforms, MEDIUM, defines);
  const copy = passOf(lit, quad, { uColor: { value: water.texture } }, COPY);
  const present = presenterOf(lit, quad, scene, final, options.exposure ?? 1.5);
  const surfaceUniforms: Uniforms = { ...shared, uWave: { value: waveUniform(lit, sea.packed) }, uDepth: { value: scene.depthTexture }, uBelow: { value: water.texture }, uRes: { value: new lit.Vector2(1, 1) } };
  const surface = surfaceOf(lit, surfaceUniforms, defines);
  const spray = sprayOf(lit, surface.stage, surfaceUniforms, defines);
  const resolver = resolverOf(lit, quad);
  const rig: Rig = { scene, water, final, mediumUniforms, medium, copy, surface: surface.stage, surfaceUniforms, spray: spray.mesh, quadCamera };
  const group = new lit.Group();
  const bed = seabedOf(lit, sea, seabedSize, Math.round(seabedSize / 1.8), options.colorAt);
  group.add(bed.mesh);
  const rocks = rocksOf(lit, options.rocks ?? [], options.rockColor ?? [0.3, 0.25, 0.2]);
  group.add(rocks.group);
  const wetLine = wetLineOf(shared, sea.wind, options.dryTime ?? 3600);
  return {
    group,
    isUnder: (x, y, z, t) => y < sea.surfaceAt(x, z, t, baseLevel).height,
    press: (print, t) => { prints.press(print, t); },
    draw(renderer, stage, camera, t, light) {
      const level = light.level ?? baseLevel;
      if (light.frameMs !== undefined) options.quality?.frame(light.frameMs);
      const place = placeOf(sea, camera.position, level, t);
      const into = renderer.getRenderTarget() as TargetLike | null;
      const { settings, width, height } = frameFor(renderer, into, options.quality?.at(place) ?? STEADY, size);
      writeLight(shared, light, level, place.under, t);
      wetLine(level, t);
      prints.sweep(shared.uRunUp?.value as number, t);
      writeMovers(shared, light, settings);
      const clears = renderer.autoClear;
      const undo = settings.upscale ? jitter(camera, resolver.frame, width, height) : null;
      drawWorld(rig, renderer, stage, camera, width, height);
      undo?.();
      renderer.autoClear = true;
      const shown = settings.upscale ? upscaled(resolver, renderer, quadCamera, final, size, width, height, camera) : final;
      if (present.uniforms.uColor) present.uniforms.uColor.value = shown.texture;
      renderer.autoClear = clears;
      renderer.setRenderTarget(into);
      renderer.render(present[into ? "target" : "screen"].stage, quadCamera);
    },
    dispose() {
      for (const item of [baked.height, baked.color, prints.texture, rocks.geometry, rocks.material, scene, water, final, ...resolver.targets, quad, medium.material, copy.material, present.screen.material, present.target.material, resolver.pass.material, surface.material, surface.disc, spray.quad, spray.material, bed.geometry, bed.far, bed.material]) item.dispose();
    },
  };
}

// ---------------------------------------------------------------- the swarm

/** One capsule of a body, as `render/sdf-body` takes it. */
interface PartLike {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: string;
  readonly r1?: number;
  readonly flat?: number;
  readonly up?: Vec;
  readonly decal?: boolean;
  readonly carve?: boolean;
}

/** A posed body: whatever `render/sdf-body` draws, of which this reads the parts and palette. */
export interface SwarmBody {
  readonly capsules: readonly PartLike[];
  readonly palette: Readonly<Record<string, string>>;
}

/** One animal, as `generative/marine` gives it. */
export interface SwarmMember {
  readonly id: string;
  readonly at: Vec;
  readonly front: Vec;
  readonly phase: number;
  readonly build: number;
  readonly index: number;
  readonly seed: number;
}

/** The species facts a swarm needs. */
export interface SwarmSpecies {
  readonly size: number;
  readonly swing: number;
}

export interface SwarmOptions<Body extends SwarmBody, Light> {
  /** `render/sdf-body`'s bodies, for the near animals. */
  readonly bodies: { readonly group: unknown; draw(bodies: readonly Body[], light: Light): void };
  /** `generative/marine`'s poseSwimmer. */
  readonly pose: (swimmer: SwarmMember, options?: { readonly rest?: boolean }) => Body;
  /** `generative/marine`'s SPECIES. */
  readonly species: Readonly<Record<string, SwarmSpecies>>;
  /** How many animals are drawn as real bodies. */
  readonly near?: number;
  /** The most of any one species drawn far. */
  readonly most?: number;
}

export interface SwarmLight {
  readonly sun: Vec;
  readonly sunColor: Vec;
  readonly sky: Vec;
  readonly ground: Vec;
}

export interface Swarm<Light> {
  readonly group: NodeLike;
  /** The near animals as spheres, for `ocean.draw`'s rays. */
  readonly casters: readonly Caster[];
  draw(swimmers: readonly SwarmMember[], eye: Vec, light: Light & SwarmLight): void;
  dispose(): void;
}

const SIDES = 6;

interface Mesh2 { positions: number[]; normals: number[]; tints: number[]; index: number[] }

function perpendicular(axis: Vec, hint: Vec | undefined): Vec {
  const seed = hint ?? (Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const along = axis[0] * seed[0] + axis[1] * seed[1] + axis[2] * seed[2];
  return unit([seed[0] - axis[0] * along, seed[1] - axis[1] * along, seed[2] - axis[2] * along]);
}

/** One capsule as a six-sided tapered tube, flattened as the part is, closed to a point at each end. */
function addTube(mesh: Mesh2, part: PartLike, tint: ColorLike): void {
  const gap: Vec = [part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]];
  const round = Math.hypot(gap[0], gap[1], gap[2]) < 1e-6;
  const axis = round ? ([0, 1, 0] as Vec) : unit(gap);
  const u = perpendicular(axis, part.up);
  const v: Vec = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  const flat = part.flat ?? 1;
  const base = mesh.positions.length / 3;
  const ends: readonly (readonly [Vec, number])[] = round
    ? [[[part.a[0], part.a[1] - part.r * 0.7, part.a[2]], part.r * 0.7], [[part.a[0], part.a[1] + part.r * 0.7, part.a[2]], part.r * 0.7]]
    : [[part.a, part.r], [part.b, part.r1 ?? part.r]];
  for (const [center, r] of ends) {
    for (let side = 0; side < SIDES; side += 1) {
      const angle = (side / SIDES) * Math.PI * 2;
      const c = Math.cos(angle) * r * flat;
      const s = Math.sin(angle) * r;
      mesh.positions.push(center[0] + u[0] * c + v[0] * s, center[1] + u[1] * c + v[1] * s, center[2] + u[2] * c + v[2] * s);
      const n = unit([u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s]);
      mesh.normals.push(n[0], n[1], n[2]);
      mesh.tints.push(tint.r, tint.g, tint.b);
    }
  }
  for (let side = 0; side < SIDES; side += 1) {
    const next = (side + 1) % SIDES;
    mesh.index.push(base + side, base + next, base + side + SIDES, base + next, base + next + SIDES, base + side + SIDES);
    // (The ends, as a fan from each ring's first corner.)
    if (side > 0 && next > 0) mesh.index.push(base, base + next, base + side, base + SIDES, base + SIDES + side, base + SIDES + next);
  }
}

function cutFrom(lit: LitLike, body: SwarmBody, phases: AttributeLike): GeometryLike {
  const mesh: Mesh2 = { positions: [], normals: [], tints: [], index: [] };
  for (const part of body.capsules) {
    if (part.decal === true || part.carve === true) continue;
    addTube(mesh, part, new lit.Color(body.palette[part.role] ?? "#808080"));
  }
  const geometry = new lit.Geometry();
  geometry.setAttribute("position", new lit.Attribute(new Float32Array(mesh.positions), 3));
  geometry.setAttribute("normal", new lit.Attribute(new Float32Array(mesh.normals), 3));
  geometry.setAttribute("aTint", new lit.Attribute(new Float32Array(mesh.tints), 3));
  geometry.setAttribute("aPhase", phases);
  geometry.setIndex(mesh.index);
  return geometry;
}

interface Herd {
  readonly mesh: InstancesLike;
  readonly geometry: GeometryLike;
  readonly material: DisposableLike;
  readonly phases: AttributeLike;
  readonly uniforms: Uniforms;
}

function writeMember(herd: Herd, slot: number, member: SwarmMember): void {
  const z = member.front;
  const side: Vec = [z[2], 0, -z[0]];
  const x = Math.hypot(side[0], side[2]) > 1e-4 ? unit(side) : ([1, 0, 0] as Vec);
  const y: Vec = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const s = member.build;
  herd.mesh.instanceMatrix.array.set([x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, member.at[0], member.at[1], member.at[2], 1], slot * 16);
  herd.phases.array[slot] = member.phase;
}

function herdOf(lit: LitLike, id: string, facts: SwarmSpecies, pose: (swimmer: SwarmMember, options?: { readonly rest?: boolean }) => SwarmBody, most: number): Herd {
  const phases = new lit.InstanceAttribute(new Float32Array(most), 1);
  const body = pose({ id, index: 0, at: [0, 0, 0], front: [0, 0, 1], phase: 0, build: 1, seed: 1 }, { rest: true });
  const geometry = cutFrom(lit, body, phases);
  const uniforms: Uniforms = { uSize: { value: facts.size }, uSwing: { value: facts.swing }, uSunDir: { value: new lit.Vector3(0, 1, 0) }, uSunCol: { value: new lit.Vector3(1, 1, 1) }, uSky: { value: new lit.Vector3(1, 1, 1) }, uGround: { value: new lit.Vector3(0, 0, 0) } };
  const material = new lit.CustomMaterial({ uniforms, vertexShader: SWARM_VERTEX, fragmentShader: SWARM_FRAGMENT });
  const mesh = new lit.Instances(geometry, material, most);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, geometry, material, phases, uniforms };
}

function lightHerd(herd: Herd, light: SwarmLight): void {
  setVec(herd.uniforms.uSunDir, unit(light.sun));
  setVec(herd.uniforms.uSunCol, light.sunColor);
  setVec(herd.uniforms.uSky, light.sky);
  setVec(herd.uniforms.uGround, light.ground);
}

/** A body's largest parts, as spheres. */
function castersOf(lit: LitLike, body: SwarmBody, most: number): Caster[] {
  const solid = body.capsules.filter((part) => part.decal !== true && part.carve !== true).sort((a, b) => b.r - a.r).slice(0, most);
  return solid.map((part) => {
    const tint = new lit.Color(body.palette[part.role] ?? "#808080");
    const reach = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]) * 0.5;
    return { at: [(part.a[0] + part.b[0]) / 2, (part.a[1] + part.b[1]) / 2, (part.a[2] + part.b[2]) / 2], r: Math.max(part.r, reach * 0.75), tint: [tint.r, tint.g, tint.b] };
  });
}

/**
 * Makes a swarm: any number of animals for the price of a few. The nearest are
 * real bodies; the rest are instances cut from those same bodies at rest, so
 * nothing has to be modelled twice, and they share one draw call a species.
 * Nearness is measured against the animal's size, so a far shark outranks a
 * near sardine.
 *
 * @param lit The keel/lit namespace.
 * @param options The sdf bodies, the posing function and the species table.
 * @returns A swarm to add to the scene.
 */
export function createSwarm<Body extends SwarmBody, Light>(lit: LitLike, options: SwarmOptions<Body, Light>): Swarm<Light> {
  const near = options.near ?? 16;
  const most = options.most ?? 512;
  const group = new lit.Group();
  group.add(options.bodies.group);
  const herds = new Map<string, Herd>();
  const herd = (id: string): Herd | undefined => {
    const existing = herds.get(id);
    if (existing) return existing;
    const facts = options.species[id];
    if (!facts) return undefined;
    const made = herdOf(lit, id, facts, options.pose, most);
    herds.set(id, made);
    group.add(made.mesh);
    return made;
  };
  const rank = (member: SwarmMember, eye: Vec): number => Math.hypot(member.at[0] - eye[0], member.at[1] - eye[1], member.at[2] - eye[2]) / (options.species[member.id]?.size ?? 1);
  let casters: Caster[] = [];
  return {
    group,
    get casters() { return casters; },
    draw(swimmers, eye, light) {
      const ranked = swimmers.map((member) => ({ member, rank: rank(member, eye) })).sort((a, b) => a.rank - b.rank);
      const posed = ranked.slice(0, near).map((entry) => options.pose(entry.member));
      options.bodies.draw(posed, light);
      // (Bigger animals first: a shark in the mirror matters more than a sardine.)
      casters = posed.flatMap((body) => castersOf(lit, body, 4)).sort((a, b) => b.r - a.r);
      for (const each of herds.values()) each.mesh.count = 0;
      for (const { member } of ranked.slice(near)) {
        const each = herd(member.id);
        if (!each || each.mesh.count >= most) continue;
        writeMember(each, each.mesh.count, member);
        each.mesh.count += 1;
      }
      for (const each of herds.values()) {
        each.mesh.instanceMatrix.needsUpdate = true;
        each.phases.needsUpdate = true;
        lightHerd(each, light);
      }
    },
    dispose() {
      for (const each of herds.values()) {
        each.geometry.dispose();
        each.material.dispose();
      }
    },
  };
}

// The guide shaders. The parts are drawn once into two half-float targets (form: view normal and coverage; data:
// depth share, ID and key light); each pass is then packed from those into eight bits a channel, rows turned over
// so a read-back comes out top row first.

/**
 * The parts' vertices as keel/lit places them, through its own chunks, so instanced, skinned and morphed meshes land
 * where their own materials put them. Hands the fragment the view position and view normal.
 */
export const PART_VERTEX_GLSL = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vView;
varying vec3 vNormal;
void main() {
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vView = mvPosition.xyz;
  vNormal = transformedNormal;
}
`;

/**
 * One part into both targets. Form: the view normal (facing the camera on either side) and coverage. Data: how far
 * into the parts' depth range, the part's ID, and the key light (diffuse, times what the shadow map lets through).
 */
export const PART_FRAGMENT_GLSL = /* glsl */ `
layout(location = 0) out highp vec4 oForm;
layout(location = 1) out highp vec4 oData;
uniform float uId;
uniform vec3 uKey;          // toward the key, view space
uniform vec2 uRange;        // the view distances the depth share runs between
uniform sampler2D tShadow;  // the key's depth (0 near, 1 far), nearest
uniform mat4 uShadowMatrix; // view space into the key's clip space
uniform vec4 uShadow;       // texel, spread in texels, bias, on
varying vec3 vView;
varying vec3 vNormal;

float seen(vec3 view, float facing) {
  if (uShadow.w < 0.5) return 1.0;
  vec4 s = uShadowMatrix * vec4(view, 1.0);
  vec3 p = s.xyz / s.w * 0.5 + 0.5;
  if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) return 1.0;
  // (Grazing faces take a larger bias: their depth changes fastest across a texel.)
  float bias = uShadow.z * (1.0 + 3.0 * (1.0 - facing));
  float lit = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float z = texture(tShadow, p.xy + vec2(float(i), float(j)) * uShadow.x * uShadow.y).r;
    lit += p.z - bias > z ? 0.0 : 1.0;
  }
  return lit / 9.0;
}

void main() {
  if (uId < 0.5) discard;
  // The normal turned to the side of the triangle the camera sees, from the triangle itself and not its winding:
  // a mesh wound against its normals still faces the camera.
  vec3 n = normalize(vNormal);
  if (dot(n, cross(dFdx(vView), dFdy(vView))) < 0.0) n = -n;
  float facing = max(dot(n, uKey), 0.0);
  float depth = (-vView.z - uRange.x) / (uRange.y - uRange.x);
  oForm = vec4(n, 1.0);
  oData = vec4(depth, uId, facing * seen(vView, facing), 1.0);
}
`;

/** The key's shadow map: depth as the fragment's own (an orthographic camera's is linear). */
export const SHADOW_FRAGMENT_GLSL = /* glsl */ `
void main() { gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
`;

/** A full-frame triangle pair. */
export const PACK_VERTEX_GLSL = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * One pass in eight bits a channel, alpha the coverage. 0 depth: red and green a 16-bit share, near 65535.
 * 1 normal: view normal, x right, y up, z toward the camera, as n / 2 + 1/2. 2 id: the ID's colour from the table.
 * 3 light: grey. 4 line: red a part's edge (outline and borders), green a crease, blue a step in depth within a
 * part, alpha the strongest. 5 block: the ID's flat colour.
 */
export const PACK_FRAGMENT_GLSL = /* glsl */ `
uniform sampler2D tForm;
uniform sampler2D tData;
uniform sampler2D tTable;  // 256 x 2, bytes: row 0 the ID colours, row 1 the block colours
uniform int uPass;
uniform vec2 uRange;
uniform vec3 uLine;        // width in pixels, the crease's cosine, a depth step as a share of the distance

ivec2 size;

float distanceAt(float share) { return uRange.x + share * (uRange.y - uRange.x); }

vec3 lines(ivec2 at, vec4 form, vec4 data) {
  vec3 l = vec3(0.0);
  int id = int(data.y + 0.5);
  float here = distanceAt(data.x);
  int w = max(1, int(uLine.x + 0.5));
  ivec2 steps[4] = ivec2[4](ivec2(w, 0), ivec2(0, w), ivec2(-w, 0), ivec2(0, -w));
  for (int k = 0; k < 4; k++) {
    ivec2 q = clamp(at + steps[k], ivec2(0), size - 1);
    vec4 f = texelFetch(tForm, q, 0);
    vec4 d = texelFetch(tData, q, 0);
    float there = distanceAt(d.x);
    // A line belongs to the nearer side: an edge to what lies behind it or to nothing.
    bool behind = f.w < 0.5 || there > here;
    if (int(d.y + 0.5) != id) { if (behind) l.r = 1.0; continue; }
    if (there - here > uLine.z * here) l.b = 1.0;
    // (Creases from two sides only, so each is one line wide.)
    if (k < 2) l.g = max(l.g, 1.0 - smoothstep(uLine.y - 0.25, uLine.y, dot(form.xyz, f.xyz)));
  }
  return l;
}

void main() {
  size = textureSize(tForm, 0);
  ivec2 at = ivec2(int(gl_FragCoord.x), size.y - 1 - int(gl_FragCoord.y));
  vec4 form = texelFetch(tForm, at, 0);
  vec4 data = texelFetch(tData, at, 0);
  float cover = step(0.5, form.w);
  int id = int(data.y + 0.5);
  vec4 o = vec4(0.0);
  if (uPass == 0) {
    float q = floor(clamp(1.0 - data.x, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(q / 256.0);
    o = vec4(hi / 255.0, (q - hi * 256.0) / 255.0, 0.0, cover);
  } else if (uPass == 1) {
    o = vec4(form.xyz * 0.5 + 0.5, cover);
  } else if (uPass == 2) {
    o = vec4(texelFetch(tTable, ivec2(id, 0), 0).rgb, cover);
  } else if (uPass == 3) {
    o = vec4(vec3(data.z), cover);
  } else if (uPass == 4) {
    vec3 l = cover > 0.5 ? lines(at, form, data) : vec3(0.0);
    o = vec4(l, max(l.r, max(l.g, l.b)));
  } else {
    o = vec4(texelFetch(tTable, ivec2(id, 1), 0).rgb, cover);
  }
  gl_FragColor = o * cover;
}
`;

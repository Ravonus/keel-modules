/**
 * Smooth bodies from parts. Any generator that poses a creature (or a plane, a
 * balloon, a prop) as capsules hands them here, and each body is drawn as ONE
 * continuous surface: the capsules are joined by a smooth union in a signed
 * distance field and raymarched on the GPU inside the body's bounding box, so
 * a neck flows into a chest and a leg into a hip with no seams and no blocks.
 * Small parts (eyes, noses, a lantern) stay crisp. Colour blends across a join
 * the same way the surface does. MIT.
 *
 * The distance functions are the KEEL pixel engine's (src/gpu/shaders.js
 * sdCap, core/sdf.js smin), with a flattened capsule for wings, ears and fins.
 * The march writes true depth, so bodies sort against the rest of the scene,
 * and a shadow proxy of plain spheres lets them cast shadows on it.
 *
 *   const bodies = createSdfBodies(lit, { shadows: true });
 *   scene.add(bodies.group);
 *   // every frame:
 *   bodies.draw(herd.at(t, stage), { sun, sunColor, sky, ground });
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export type Vec = readonly [number, number, number];

/**
 * One part: a capsule from a to b, r thick; `flat` < 1 squashes it across `up` (a wing, an ear).
 * `r1` tapers it: r at a, r1 at b (a muzzle to its nose, a tail to its tip, a leg to its ankle).
 * `melt` scales how far it melts into the rest (0 a crisp seam, 1 the body's own, up to 2).
 * A `decal` is paint only: it changes no surface, and colours the body where it lies inside it
 * (a fox's white bib, a deer's rump, a mask round the eyes); one `under` the pattern takes the
 * coat's pattern over it, as its ground (an owl's pale breast, still barred). A `carve` cuts
 * into the rest instead (its edge as soft as its melt) and paints the cut in its own colour,
 * what lies beneath showing through toward the cut's rim (an owl's dished face, darker at its edge).
 * On a decal `melt` is its edge: under 1 crisper, over 1 softer and broken like fur (a raccoon's mask).
 * `shadow: false` keeps a part out of the shadow (a small part standing off the body, whose shadow
 * would fall as a speck apart from the rest). `bow` curves a round part: how far, and which way, its
 * middle stands off the straight line from a to b (a claw's sickle, in one smooth part); it takes
 * the place of `flat`.
 */
export interface BodyPart {
  readonly a: Vec;
  readonly b: Vec;
  readonly r: number;
  readonly role: string;
  readonly flat?: number;
  readonly up?: Vec;
  readonly r1?: number;
  readonly melt?: number;
  readonly decal?: boolean;
  readonly under?: boolean;
  readonly carve?: boolean;
  readonly shadow?: boolean;
  readonly bow?: Vec;
}

export interface BodyInput {
  readonly capsules: readonly BodyPart[];
  /** Colour per role (hex). */
  readonly palette: Readonly<Record<string, string>>;
  /** 0 lit as usual; 1 glows from its own colour. */
  readonly glow?: number;
  /** Roles that light themselves on this body only (an owl's eyes at night). */
  readonly lit?: readonly string[];
  /** The coat's grain; without one the surface is smooth. */
  readonly grain?: Grain;
  /** Which way the body faces: fur and feathers lie back from it. */
  readonly front?: Vec;
  /** Where the body stands: its grain and pattern ride on it, so they never slide over it as it moves. */
  readonly at?: Vec;
  /** How the coat takes the light; by default as its grain's kind does. */
  readonly material?: Material;
  /** A pattern painted over the coat (under its decals). */
  readonly pattern?: Pattern;
}

/**
 * How a coat takes the light, each 0 to about 1: `sheen` the soft highlight
 * running along the hair, `fuzz` the light caught in the fur round its
 * edge, `gloss` a feather's or a scale's sharper highlight, `iridescence`
 * the colours that sheen shifts through as it turns (a crow's purple-green).
 */
export interface Material {
  readonly sheen?: number;
  readonly fuzz?: number;
  readonly gloss?: number;
  readonly iridescence?: number;
  /** How far a near-black coat's own sheen lifts it off black so its shape shows: 1 by default, 0 true black. */
  readonly lift?: number;
  /** How far a near-black coat's colour is drawn to neutral, 0 by default: a black cat's, free of the sky's blue in its shadows. */
  readonly neutral?: number;
}

/**
 * A pattern grown over the coat in the body's own frame: `dapple` soft
 * blotches that break up a plain coat, `spots`, `stripes` in bands across
 * the body, `streaks` running along it (a thrush's breast), `bars` fine
 * across it (a hawk's), `chevrons` one apart from the next, each a
 * feather's dark tip cupped down the lie (a snowy owl's), `mackerel` a
 * tabby's broken bands down the flanks and round the legs and tail,
 * `patches` a calico's soft blotches in two colours, its legs left clear,
 * `grizzle` fine flecks drawn out tailward, darkening softly to the
 * spine and giving way to the `second` colour on the belly and inside the legs,
 * and `tips` the raised tips of a coat's grain alone (a spine's pale end).
 * `role` is the colour it is painted in, `scale` its
 * feature size in the parts' units, `contrast` how strongly it shows, and
 * `seed` makes each animal's its own.
 */
export interface Pattern {
  readonly kind: "dapple" | "spots" | "stripes" | "streaks" | "bars" | "chevrons" | "mackerel" | "patches" | "grizzle" | "tips";
  readonly role: string;
  /** A colour of its own (hex) in place of its role's: a shade of the coat. */
  readonly color?: string;
  /** `patches`: the second colour (hex), its blotches lying among the first's; `grizzle`: the pale of the belly. */
  readonly second?: string;
  /** `mackerel`, `patches`, `grizzle`: where the trunk ends in the body's frame, as (below, behind, ahead of): the legs start below it, the tail behind it, the neck ahead of it. */
  readonly trunk?: Vec;
  /** `mackerel`, `grizzle`: the height on the body's frame above which its midline is painted, the dark line down a spine. */
  readonly dorsal?: number;
  readonly scale: number;
  readonly contrast: number;
  readonly seed: number;
}

/**
 * A coat's grain, raised off the melted surface (never the crisp parts: an
 * eye, a nose, a bill stay smooth): `fur` parts into locks drawn out back
 * along the body, `feather` lies in overlapping rows whose trailing edges
 * stand up, `scale` in finer rows. `size` is one lock's or row's width, in
 * the parts' units. It only ever raises the surface, so a thin wing or ear
 * never wears through, and fades out where it would be finer than a pixel.
 * `lie` is the way it lies, in the body's frame (x to its side, y up, z
 * forward): back along the body and a little down by default, straight down
 * an upright bird (an owl's breast feathers). `rise` is how far it stands
 * off the surface, as a share of its usual height: over 1 a shaggy coat that
 * breaks the outline, on the limbs as well. `crown`, on fur, is a point in the
 * world the hair falls away from on every side, long locks that shingle down
 * each limb and flank with their tips standing off (a sloth's coat), in place
 * of a single `lie`. `spine` is a stand of sharp spikes set by direction from
 * `crown` (a hedgehog's), so they stay whole as the surface moves, each lying
 * well back along the coat the way of `lie`, with `size` their height off it.
 * `on`, a role, grows the grain on that role's parts alone and leaves the
 * rest smooth.
 */
export interface Grain {
  readonly kind: "fur" | "feather" | "scale" | "spine";
  readonly size: number;
  readonly lie?: Vec;
  readonly rise?: number;
  readonly crown?: Vec;
  readonly on?: string;
}

/** The scene's light, as the bodies see it. Directions point toward the light. */
export interface BodyLight {
  readonly sun: Vec;
  /** Linear RGB times intensity, as a keel/lit light's colour × intensity. */
  readonly sunColor: Vec;
  /** A second, softer light (a moon, a bounce). */
  readonly fill?: Vec;
  readonly fillColor?: Vec;
  /** Hemisphere light: colour times intensity above and below. */
  readonly sky: Vec;
  readonly ground: Vec;
  readonly rim?: Vec;
  readonly rimColor?: Vec;
  /**
   * A soft light from the viewer's side (colour × intensity), a character
   * light: it reaches only what faces the camera, so a small animal standing
   * in shade or against the sun still shows its coat and shape. None by default.
   */
  readonly front?: Vec;
  /**
   * How saturated the bodies' muted colours are drawn (1 as painted; vivid
   * ones are left as they are). A look that snaps to a small fixed palette
   * asks for more, so a brown coat finds the palette's own browns and
   * oranges instead of its greys and navies.
   */
  readonly saturation?: number;
}

export interface SdfBodiesOptions {
  /** Most parts in one body (the shader's array). */
  readonly maxParts?: number;
  /** Most bodies drawn at once. */
  readonly maxBodies?: number;
  /** Cast shadows through a proxy of plain spheres. */
  readonly shadows?: boolean;
  /** How far parts melt into each other, as a share of the thinner one's radius. */
  readonly blend?: number;
  /** Roles drawn crisp, never melted into their neighbours. */
  readonly crisp?: readonly string[];
  /** Roles that light themselves. */
  readonly emissive?: readonly string[];
  readonly renderOrder?: number;
  /**
   * The ink line round each body, in screen pixels (0 for none). It keeps a
   * small animal's silhouette against busy ground at any pixel size.
   */
  readonly ink?: number;
  /** The least margin left round a body for its ink, in the parts' units. */
  readonly inkPad?: number;
}

// ---------------------------------------------------------------- the parts of keel/lit used

interface ColorLike { r: number; g: number; b: number; set(value: string): ColorLike }
interface Vector3Like { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector3Like }
interface UniformLike<T> { value: T }
interface MaterialLike { dispose(): void; uniforms?: Record<string, UniformLike<unknown>> }
interface NodeLike {
  visible: boolean;
  frustumCulled: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  position: Vector3Like;
  scale: Vector3Like;
  add(...objects: unknown[]): void;
}
interface InstancedLike extends NodeLike {
  count: number;
  readonly instanceMatrix: { needsUpdate: boolean };
  setMatrixAt(index: number, matrix: unknown): void;
}
interface Matrix4Like { makeScale(x: number, y: number, z: number): Matrix4Like; setPosition(x: number, y: number, z: number): Matrix4Like }
interface DisposableLike { dispose(): void }

/** The parts of keel/lit this module calls. Pass the keel/lit namespace itself. */
export interface LitLike {
  readonly Group: new () => NodeLike;
  readonly Mesh: new (geometry: unknown, material: unknown) => NodeLike;
  readonly Instances: new (geometry: unknown, material: unknown, count: number) => InstancedLike;
  box(x: number, y: number, z: number): DisposableLike;
  sphere(r: number, w: number, h: number): DisposableLike;
  readonly CustomMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly FlatMaterial: new (parameters: Readonly<Record<string, unknown>>) => MaterialLike;
  readonly Vector3: new (x?: number, y?: number, z?: number) => Vector3Like;
  readonly Vector4: new (x?: number, y?: number, z?: number, w?: number) => unknown;
  readonly Color: new (value?: string) => ColorLike;
  readonly Matrix4: new () => Matrix4Like;
}

// ---------------------------------------------------------------- the shader

// The box is drawn from its back faces so the march still starts when the
// camera is inside it. The ray is taken into the parts' own space (the box's
// parent), so a body under a moved or scaled group is still found.
const VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vEye;
void main() {
  vLocal = position;
  vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FIELD = /* glsl */ `
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform vec4 uA[MAXP];     // a, r at a
uniform vec4 uB[MAXP];     // b, tag: role + 16 x melt (16ths; 0 crisp) + 1024 when a decal (+ 2048 under the pattern), 2048 alone a carve
uniform vec4 uU[MAXP];     // thin axis x flatness, r at b
uniform int uCount;
uniform vec3 uPal[ROLES];
uniform float uLit[ROLES];
uniform vec3 uMin, uMax;
uniform float uK, uGlow, uInk, uSat;
uniform vec3 uCenter, uSize;
uniform vec3 uSun, uSunCol, uFill, uFillCol, uSky, uGround, uRim, uRimCol, uFront;
uniform float uGrain, uGrainKind, uGrainRise;
uniform float uGrainOn;    // the one role grain grows on; -1 for all
uniform vec4 uCrown;       // the point a coat falls from; w 0 for none
uniform vec3 uAft, uOrigin, uSide, uUp, uFwd;
uniform vec4 uMat;      // sheen, fuzz, gloss, iridescence
uniform float uLift;    // how far a near-black coat's sheen lifts it
uniform float uNeutral; // how far a near-black coat's colour is drawn to neutral
uniform vec4 uPattern;  // kind (0 none), scale, contrast, seed
uniform vec3 uPatCol, uPatTwo, uTrunk;
uniform float uDorsal;
varying vec3 vLocal;
varying vec3 vEye;
// How much grain this pixel shows: none where a lock would be finer than a pixel.
float gFade = 0.0;
// How much of the surface here wears the grain (see grows), and how far off it this point stands.
float gCover = 1.0;
float gLift = 0.0;
float gReach = 1.0;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1) * 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// The grain's height at p, 0 to about 1: fur in ridged locks drawn out along
// the lie of the coat; feathers and scales in rows that rise to a lip at each
// one's trailing edge, the rows wandering so they never line up like tiles.
// A point in the body's own frame (x to its side, y up, z forward), so what is grown on it moves with it.
vec3 bodyAt(vec3 p) {
  vec3 v = p - uOrigin;
  return vec3(dot(v, uSide), dot(v, uUp), dot(v, uFwd));
}
// A coat falling away from its crown: rows of locks, each a shingle that stands off at its tip
// over the root of the next, staggered so the rows never line up, the same width however far out.
float locks(vec3 p) {
  vec3 v = p - uCrown.xyz;
  vec3 q = vec3(dot(v, uSide), dot(v, uUp), dot(v, uFwd)) / uGrain;
  float along = length(q);
  // (Short at the crown, so the fan never shows as a star.)
  float grow = smoothstep(0.5, 3.5, along);
  vec3 way = q / max(along, 1e-3);
  // (Staggered across the hair only, in bands: noise along it too would close its rows up into
  // rings, and a limb far out from the crown would see too little of the fan to break them.)
  vec3 fan = way * (floor(along * 0.12) + 1.0) * 7.0;
  float s = along * 0.3 + noise3(fan) * 2.2 + noise3(fan * 2.9) * 1.0;
  float row = floor(s), f = s - row;
  vec3 across = way * (row + 1.0) * 3.3;
  float clump = noise3(across * 1.1 + row * 2.37);
  float strand = 1.0 - abs(2.0 * noise3(across * 2.4) - 1.0);
  return grow * (0.3 + 0.7 * (f - smoothstep(0.84, 1.0, f))) * (0.3 + 0.7 * clump) * (0.62 + 0.38 * strand);
}
// Spines: a cone at each of a scatter of directions from the crown, so many to the radian. Set
// by direction alone, each stays whole at any height, and the nearest one is all a point sees.
// (Each lies back along the coat as it rises, lift being how far off the surface: away from the
// pole uAft leaves, round the dome and down its flanks, each with a small sway of its own.)
const float SPINES = 10.0, SPINE_LEAN = 1.35, SPINE_SWAY = 0.5, SPINE_OVAL = 0.62;
vec3 crownAt(vec3 p) {
  vec3 v = p - uCrown.xyz;
  return vec3(dot(v, uSide), dot(v, uUp), dot(v, uFwd));
}
float spines(vec3 p, float lift) {
  vec3 v = crownAt(p), n = normalize(v);
  // (Short and slim at the brow, the rump and along the skirt, longest on the crest.)
  gReach = (1.0 - 0.35 * smoothstep(0.86, 0.99, abs(dot(n, uAft)))) * (0.5 + 0.6 * smoothstep(-0.35, 0.25, n.y));
  // (Never quite along the surface at the dome's two ends, so no spine stands up there out of the lie.)
  vec3 flow = normalize(uAft * 1.4 - n * dot(uAft, n));
  // (Set about a round dome drawn out to the coat's own length, so they fall no thicker on its flanks than at its ends.)
  vec3 root = v - flow * lift * SPINE_LEAN;
  vec3 q = normalize(root + uAft * dot(root, uAft) * (SPINE_OVAL - 1.0)) * SPINES;
  vec3 i = floor(q);
  float best = 0.0, sway = lift / uGrain * SPINE_SWAY, slim = 1.45 / gReach;
  for (int c = 0; c < 8; c++) {
    vec3 cell = i + vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
    float h = hash3(cell + 3.1);
    vec3 at = normalize(cell + vec3(h, fract(h * 7.3), fract(h * 13.7))) * SPINES;
    at += (vec3(fract(h * 53.1), fract(h * 71.9), fract(h * 97.3)) - 0.5) * sway;
    best = max(best, (1.0 - distance(q, at) * slim) * (0.88 + 0.12 * fract(h * 31.7)));
  }
  return max(best, 0.0);
}
// The coat lies back along the body and a little down (uAft, the grain's lie).
float grain(vec3 p) {
  if (uGrainKind > 2.5) return spines(p, gLift);
  if (uCrown.w > 0.5 && uGrainKind < 0.5) return locks(p);
  vec3 q = bodyAt(p) / uGrain;
  float along = dot(q, uAft);
  vec3 across = q - uAft * along;
  if (uGrainKind < 0.5) {
    // (Drawn out five times along the lie, so locks streak back like hair, not pebbles.)
    float n = noise3(across * 1.3 + uAft * along * 0.2);
    float fine = noise3(across * 3.4 + uAft * along * 0.5);
    return (1.0 - abs(2.0 * n - 1.0)) * 0.65 + 0.35 * fine;
  }
  // Each row broken across into scallops, every other row offset half a feather, as feathers overlap.
  float s = along * (uGrainKind < 1.5 ? 1.0 : 1.6) + noise3(across * 0.6) * 0.6;
  float row = floor(s);
  vec3 side = across * 1.4 + vec3(0.0, 0.5, 0.0) * mod(row, 2.0);
  float cell = 1.0 - abs(2.0 * noise3(side + row * 7.31) - 1.0);
  float f = fract(s + 0.45 * cell);
  return (f - smoothstep(0.82, 1.0, f)) * (0.6 + 0.4 * cell);
}

// The pixel engine's capsule, tapered from r at a to r1 at b (its radius
// follows the axis, the distance scaled by the slope so the march never
// overshoots), and squashed across its thin axis when flat < 1.
float part(vec3 p, int i) {
  vec3 a = uA[i].xyz, b = uB[i].xyz;
  vec3 pa = p - a, ba = b - a;
  float l2 = max(dot(ba, ba), 1e-9);
  float h = clamp(dot(pa, ba) / l2, 0.0, 1.0);
  vec3 v = pa - ba * h;
  float r0 = uA[i].w, dr = r0 - uU[i].w;
  float r = r0 - dr * h, slope = inversesqrt(1.0 + dr * dr / l2);
  vec3 u = uU[i].xyz;
  float f2 = dot(u, u);
  // (A bow is stored past 2 long, so it can never be taken for a thin axis.)
  if (f2 > 1.5) { float f = sqrt(f2); return (length(v - u / f * (f - 2.0) * 4.0 * h * (1.0 - h)) - r) * slope; }
  if (f2 < 0.998) { float f = sqrt(f2); u /= f; float t = dot(v, u); v += u * t * (1.0 / f - 1.0); return (length(v) - r) * f * slope; }
  return (length(v) - r) * slope;
}

// Chevrons: a grid laid along the lie, every other row offset half a cell, and in each cell
// one feather's dark tip, a V cupped down the lie. Some cells are bare, more of them toward
// the body's front, so a breast is plainer than a back.
float chevron(vec3 q, vec3 b) {
  vec3 helper = abs(uAft.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 e1 = normalize(cross(uAft, helper)), e2 = cross(uAft, e1);
  vec3 g = vec3(dot(q, uAft) * 1.2, dot(q, e1), dot(q, e2));
  g.yz += 0.5 * mod(floor(g.x), 2.0);
  vec3 cell = floor(g), f = g - cell - 0.5;
  float across = length(f.yz);
  float v = abs(f.x - 0.12 + 0.75 * across);
  float mark = (1.0 - smoothstep(0.08, 0.13, v)) * (1.0 - smoothstep(0.3, 0.38, across));
  float bare = mix(0.15, 0.65, smoothstep(-0.2, 0.5, b.z / max(length(uSize) * 0.25, 1e-4)));
  return mark * step(bare, hash3(cell * 1.7 + 0.3));
}

float fbm(vec3 q) { return noise3(q) * 0.62 + noise3(q * 2.1 + 3.7) * 0.38; }
// A tabby's bands: down the flanks, crowding and spreading along the body, each its own width,
// drawn to a point and broken up toward the belly; a dark line down the spine; two or three bars
// across the outside of each leg and rings down the tail, stopping at the neck (its face has
// marks of its own). The whole wanders, and breaks up here and there into a line of dashes.
float mackerel(vec3 q, vec3 b) {
  float s = uPattern.y;
  float leg = 1.0 - smoothstep(uTrunk.x - s * 0.3, uTrunk.x + s * 0.3, b.y);
  float tail = 1.0 - smoothstep(uTrunk.y - s * 0.3, uTrunk.y + s * 0.3, b.z);
  float wander = fbm(q * 0.45) * 3.2;
  float up = clamp((b.y - uTrunk.x) / (s * 5.5), 0.0, 1.0);
  float z = q.z * 0.8 + 1.1 * sin(q.z * 0.55 + uPattern.w);
  float edge = mix(0.98, 0.5 - 0.6 * noise3(vec3(z * 0.5, 5.0, uPattern.w)), sqrt(up));
  float dash = smoothstep(mix(0.42, 0.1, up), mix(0.56, 0.24, up), noise3(vec3(q.x * 0.35, q.y * 0.5, q.z * 1.3) + 7.0));
  float flank = smoothstep(edge, edge + 0.16, sin(z * 3.14159 + wander * 0.8 + up * 1.3)) * dash;
  float bar = smoothstep(0.25, 0.5, sin(q.y * 3.4 + wander * 0.5)) * smoothstep(s * 1.6, s * 2.5, abs(b.x)) * smoothstep(s * 1.6, s * 2.2, b.y);
  float ring = smoothstep(0.05, 0.35, sin((q.y - q.z * 0.6) * 2.6 + wander * 0.6));
  float band = mix(mix(flank, bar, leg), ring, tail);
  float spine = (1.0 - smoothstep(s * 0.4, s * 0.75, abs(b.x + (noise3(q * 0.5) - 0.5) * s))) * smoothstep(uDorsal - s * 0.3, uDorsal + s * 0.3, b.y) * (1.0 - tail);
  return max(band, spine) * smoothstep(s, s * 1.5, b.y) * (1.0 - smoothstep(uTrunk.z - s, uTrunk.z + s, b.z));
}
// Where a calico's patches fall, warped so their edges wander and interlock.
vec3 calicoWarp(vec3 q) {
  return q + (vec3(noise3(q * 1.3 + 9.0), noise3(q * 1.3 + 17.0), noise3(q * 1.3 + 23.0)) - 0.5) * 1.1;
}
// A calico's blotches, big and soft-edged over the back and flanks, the white holding the belly,
// chest and legs, one or two long ones down the tail.
float patches(vec3 q, vec3 b) {
  float s = uPattern.y;
  float tail = 1.0 - smoothstep(uTrunk.y - s * 0.2, uTrunk.y + s * 0.2, b.z);
  float up = clamp((b.y - uTrunk.x) / (s * 1.4), 0.0, 1.0);
  float n = mix(noise3(calicoWarp(q)), noise3(calicoWarp(q * 0.4) + 41.0), tail);
  float t = mix(0.66, 0.4, up) + 0.25 * smoothstep(uTrunk.z - s * 1.0, uTrunk.z, b.z);
  return smoothstep(t, t + 0.03, n) * smoothstep(uTrunk.x * 0.8, uTrunk.x, b.y) * (1.0 - smoothstep(uTrunk.z, uTrunk.z + s * 0.2, b.z));
}
// How far a grizzled coat has gone over to its pale at b: under the trunk, fading up the flanks,
// and up the inside of the legs but never their outside, the paws or the head and neck.
float grizzlePale(vec3 b) {
  float s = uPattern.y, x = abs(b.x);
  float under = 1.0 - smoothstep(s, s * 12.0, b.y - uTrunk.x + x * 0.5);
  float legOut = smoothstep(s * 3.0, s * 4.5, x) * (1.0 - smoothstep(uTrunk.x - s * 2.0, uTrunk.x, b.y));
  return under * (1.0 - legOut) * smoothstep(s * 3.0, s * 7.0, b.y) * (1.0 - smoothstep(uTrunk.z - s, uTrunk.z + s * 3.0, b.z));
}
// A grizzled coat: fine flecks drawn out tailward, heavier toward a soft dark line down the spine,
// the tail left clear for its own marks and the pale coming through below.
float grizzle(vec3 q, vec3 b) {
  float s = uPattern.y;
  float fleck = smoothstep(0.46, 0.66, fbm(vec3(q.x * 1.5, q.y * 1.5, q.z * 0.45)));
  float spine = (1.0 - smoothstep(s * 1.5, s * 7.0, abs(b.x + (noise3(q * 0.4) - 0.5) * s * 2.0))) * smoothstep(uDorsal - s * 2.0, uDorsal + s * 2.0, b.y);
  float back = spine * (1.0 - smoothstep(uTrunk.z - s, uTrunk.z + s * 3.0, b.z));
  float body = smoothstep(uTrunk.y - s * 2.0, uTrunk.y, b.z) * smoothstep(s * 3.0, s * 7.0, b.y);
  return max(max(fleck * mix(0.42, 0.62, back) * body, back * 0.62), grizzlePale(b) * 0.92);
}
// The pattern's share at p, 0 to 1, grown in the body's frame (see Pattern).
// A spine's pale end: all but the last of a short one (the fringe at its skirt and hairline), brightest on
// the lit top and front of the dome, so the dome reads as one form. (Far off, too small for the grain to
// stand, its tips are flecks.)
float spineTip(vec3 p, vec3 b) {
  float g = grain(p);
  float start = mix(0.55, 0.8, smoothstep(0.5, 0.8, gReach));
  float lit = mix(0.55, 1.0, smoothstep(0.35, 1.0, (b.y + b.z * 0.25) / uPattern.y));
  return mix(smoothstep(0.72, 0.84, g), smoothstep(start, start + 0.1, g) * lit, gFade);
}
float pattern(vec3 p) {
  float kind = uPattern.x;
  if (kind < 0.5) return 0.0;
  vec3 b = bodyAt(p);
  vec3 q = b / uPattern.y + uPattern.w;
  if (kind < 1.5) return smoothstep(0.5, 0.7, fbm(q));
  if (kind < 2.5) return smoothstep(0.64, 0.72, noise3(q * 1.6));
  // (Stripes and bars wander with the noise and thin out down the flanks, as a tiger's or an owl's do.)
  float wander = fbm(q * 0.7) * 1.6;
  if (kind < 3.5) return smoothstep(0.35, 0.75, sin(q.z * 3.14159 + wander * 2.0)) * smoothstep(-0.6, 0.4, b.y / uPattern.y);
  if (kind < 4.5) return smoothstep(0.62, 0.78, noise3(vec3(q.x * 2.6, q.y * 2.6, q.z * 0.35)));
  // (Bars run across the lie of the coat, down a level body and round an upright one, each
  // broken into short marks across, as an owl's are: rows of chevrons, never whole rings.)
  float along = dot(q, uAft);
  if (kind < 5.5) {
    float dash = smoothstep(0.38, 0.62, noise3((q - uAft * along) * 1.3 + floor(along) * 3.17));
    return smoothstep(0.55, 0.85, sin(along * 6.2832 + wander)) * dash;
  }
  if (kind < 6.5) return chevron(q, b);
  if (kind < 7.5) return mackerel(q, b);
  if (kind > 9.5) return spineTip(p, b) * gCover;
  return kind < 8.5 ? patches(q, b) : grizzle(q, b);
}
// The pattern's colour at p: one, but for patches, whose second lies among the first.
vec3 patternColor(vec3 p) {
  if (uPattern.x < 7.5 || uPattern.x > 9.5) return uPatCol;
  if (uPattern.x > 8.5) return mix(uPatCol, uPatTwo, smoothstep(0.03, 0.3, grizzlePale(bodyAt(p))));
  return mix(uPatCol, uPatTwo, smoothstep(0.47, 0.5, fbm(calicoWarp(bodyAt(p).zxy / uPattern.y + uPattern.w) + 31.0)));
}
// How thick part i is at its thinnest: its smaller radius, squashed by its flatness.
float partThickness(int i) {
  return min(uA[i].w, uU[i].w) * min(length(uU[i].xyz), 1.0);
}
// Whether grain grows on a part of this role.
float grows(float role) { return uGrainOn < -0.5 || abs(role - uGrainOn) < 0.5 ? 1.0 : 0.0; }
// Part i melted into the surface so far by its own share of the melt; h is its share.
float melt(int i, float m, float d, float di, out float h) {
  float k = max(min(uK * m, (uA[i].w + uU[i].w) * 0.4), 1e-6);
  h = clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0);
  return mix(d, di, h) - k * h * (1.0 - h);
}
// The surface alone, for the march, the normal and the occlusion. Crisp
// parts join it after the melt, so nothing melts into an eye.
float dist(vec3 p) {
  float d = 1e9, c = 1e9, h, thick = 0.0, cover = 0.0, cut = 1e9, ck = 1e-6;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float tag = uB[i].w;
    bool carve = tag >= 2047.5 && tag < 3071.5;
    if (tag >= 1023.5 && !carve) continue;
    float m = floor(mod(tag, 1024.0) * 0.0625);
    float di = part(p, i);
    if (carve) { if (di < cut) { cut = di; ck = max(uK * m * 0.0625, 1e-6); } continue; }
    if (m < 0.5) { c = min(c, di); continue; }
    d = melt(i, m * 0.0625, d, di, h);
    thick = mix(thick, partThickness(i), h);
    cover = mix(cover, grows(mod(tag, 16.0)), h);
  }
  // The carves cut in after the melt, their rims as soft as their own melt.
  if (cut < 1e8) { h = clamp(0.5 - 0.5 * (d + cut) / ck, 0.0, 1.0); d = mix(d, -cut, h) + ck * h * (1.0 - h); }
  // (Spines stand their full height, up to a sharp point, so they stop only well clear of it.)
  if (uGrainKind > 2.5) {
    float tall = uGrain * uGrainRise;
    gLift = max(d, 0.0);
    if (gFade > 0.0 && cover > 0.0 && d < tall * 2.0) { float s = spines(p, gLift); d -= tall * gReach * gFade * smoothstep(0.45, 0.8, cover) * smoothstep(0.0, uGrain * 1.2, c) * s * smoothstep(2.0, 1.2, d / tall); }
    return min(d, c);
  }
  // (Near the surface only: the grain costs noise, and far off it changes nothing. A thin
  // part, a wing, an ear, a tail feather, a leg, takes less of it, so its edge stays clean.)
  if (gFade > 0.0 && d < uGrain * 1.5) {
    // (And none right round a crisp part: fur lies short about an eye, a nose, a bill.)
    // (A coat with a crown is long all over, thin limbs too.)
    float limb = max(smoothstep(0.6, 2.5, thick * uGrainRise / uGrain), uCrown.w * 0.85);
    float amount = (uGrainKind < 0.5 ? 0.18 : 0.14) * gFade * limb * cover * smoothstep(0.0, uGrain * 1.2, c);
    d -= uGrain * uGrainRise * amount * grain(p) * smoothstep(1.5, 0.5, d / uGrain);
  }
  return min(d, c);
}
// The colour, melted by the same weights, then the decals under the pattern,
// the pattern, a carve's cut, the decals on it, then crisp parts over all: once a pixel.
vec3 paint(vec3 p, out float lit, out float soft) {
  float d = 1e9, c = 1e9, h, w = 0.0, cl = 0.0, dl = 0.0, wu = 0.0, ul = 0.0, cut = 1e9, vl = 0.0, deep = 1e-6, ck = 1e-6, cover = 0.0;
  vec3 col = vec3(0.0), cc = vec3(0.0), dc = vec3(0.0), uc = vec3(0.0), vc = vec3(0.0); lit = 0.0;
  bool furred = false;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float tag = uB[i].w, di = part(p, i);
    float under = step(2047.5, tag);
    tag -= under * 2048.0;
    float decal = step(1023.5, tag);
    tag -= decal * 1024.0;
    float m = floor(tag * 0.0625);
    int role = int(tag - m * 16.0 + 0.5);
    if (under > 0.5 && decal < 0.5) {
      if (di < cut) { cut = di; vc = uPal[role]; vl = uLit[role]; deep = max(partThickness(i) * 0.6, 1e-5); ck = max(uK * m * 0.0625, 1e-6); }
      continue;
    }
    if (decal > 0.5) {
      // (Its edge goes by its melt, and one melted past 1 breaks up like the fur it lies in.)
      float edge = uA[i].w * 0.12 * (m < 0.5 ? 1.0 : pow(m * 0.0625, 2.6));
      if (m > 16.5) { di += (noise3(bodyAt(p) / (uA[i].w * 0.3)) - 0.5) * edge; furred = true; }
      float s = clamp(0.5 - di / max(edge, 1e-5), 0.0, 1.0);
      if (under > 0.5) { if (s > wu) { wu = s; uc = uPal[role]; ul = uLit[role]; } }
      // (Once there is a furred edge the decals lay over one another, the first on top, so it shows what the next paints under it.)
      else if (furred) { float over = s * (1.0 - w); float all = max(w + over, 1e-5); dc = (dc * w + uPal[role] * over) / all; dl = (dl * w + uLit[role] * over) / all; w = all; }
      else if (s > w) { w = s; dc = uPal[role]; dl = uLit[role]; }
      continue;
    }
    if (m < 0.5) { if (di < c) { c = di; cc = uPal[role]; cl = uLit[role]; } continue; }
    d = melt(i, m * 0.0625, d, di, h);
    col = mix(col, uPal[role], h); lit = mix(lit, uLit[role], h);
    cover = mix(cover, grows(float(role)), h);
  }
  gCover = cover; gLift = max(d, 0.0);
  col = mix(col, uc, wu); lit = mix(lit, ul, wu);
  col = mix(col, patternColor(p), pattern(p) * uPattern.z);
  // (The cut shows its own colour as deep as it goes, what lies beneath toward its rim.)
  float cv = cut < 1e8 ? smoothstep(0.0, deep, -d) : 0.0;
  col = mix(col, vc, cv); lit = mix(lit, vl, cv);
  col = mix(col, dc, w); lit = mix(lit, dl, w);
  // (A crisp part set in a cut, an eye in a dished face, shows over the cut surface, not the one it cut.)
  if (cut < 1e8) { h = clamp(0.5 - 0.5 * (d + cut) / ck, 0.0, 1.0); d = mix(d, -cut, h) + ck * h * (1.0 - h); }
  soft = 1.0;
  if (c < d) { col = cc; lit = cl; soft = 0.0; }
  return col;
}
vec3 normalAt(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * dist(p + k.xyy * e) + k.yyx * dist(p + k.yyx * e) + k.yxy * dist(p + k.yxy * e) + k.xxx * dist(p + k.xxx * e));
}`;

// The march. A ray that misses the body by under uInk pixels
// (their width from the screen derivative) draws its ink line, a deep shade
// of the nearest part, so a small animal keeps its outline on grass or bark.
const MARCH = /* glsl */ `
// What a coat's grain does to its colour: each lock or feather darker at its root and lighter at its
// tip; a spine, warm at its root, with a dark band below its pale end.
float grainShade(vec3 p, vec3 base) {
  float g = grain(p);
  if (uGrainKind < 2.5) return 0.8 + 0.3 * g;
  // (A pale coat's bands are faint, a dark one's deep.)
  return 1.0 - mix(0.38, 0.15, smoothstep(0.1, 0.5, dot(base, vec3(0.2126, 0.7152, 0.0722)))) * smoothstep(0.3, 0.55, g) * (1.0 - smoothstep(0.62, 0.74, g));
}
const float INV_PI = 0.3183098862;
// (The least light a spine takes above the skirt: its dark is the dome's underside, never its middle.)
const float SPINE_FLOOR = 0.5;
// The coat's own light (see Material): a sheen along the hair (its strands
// lie along the body, so the highlight runs across them), the fuzz of light
// caught round a furred edge, a feather's or scale's gloss, and the colours
// a glossy black shifts through as it turns.
vec3 coatLight(vec3 n, vec3 rd, vec3 halfway, float rim) {
  vec3 hair = normalize(uSide * uAft.x + uUp * uAft.y + uFwd * uAft.z);
  float th = dot(hair, halfway);
  vec3 sun = uSunCol * INV_PI;
  vec3 light = sun * uMat.x * 0.35 * pow(sqrt(max(1.0 - th * th, 0.0)), 24.0) * max(dot(n, uSun), 0.0);
  light += (uSky + uSunCol * 0.3) * INV_PI * uMat.y * 0.5 * rim;
  float spec = pow(max(dot(n, halfway), 0.0), 28.0);
  light += sun * uMat.z * 0.5 * spec;
  float turn = max(dot(n, -rd), 0.0);
  vec3 iri = 0.5 + 0.5 * cos(6.2832 * (turn * 1.3 + vec3(0.55, 0.75, 0.95)));
  light += iri * (sun * 0.6 + uSky * INV_PI * 0.8) * uMat.w * (0.35 * pow(max(dot(n, halfway), 0.0), 6.0) + 0.5 * rim);
  return light;
}
void main() {
  vec3 ro = uCenter + vEye * uSize;
  vec3 rd = normalize((vLocal - vEye) * uSize);
  float px = length(fwidth(rd));
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uMin - ro) * inv, t1 = (uMax - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float tn = max(max(max(lo.x, lo.y), lo.z), 0.0);
  float tf = min(min(hi.x, hi.y), hi.z);
  if (tn >= tf) discard;
  float scale = length(uSize);
  float eps = scale * 0.0006;
  float t = tn, d = 1e9, near = 1e9, nearT = tn;
  gFade = uGrain > 0.0 ? smoothstep(0.7, 2.2, uGrain / max(px * max(tn, eps), 1e-7)) : 0.0;
  // (A grained surface is steeper than its distance says: shorter steps keep the march on it, shortest and most on a stand of spines.)
  bool spiny = uGrainKind > 2.5 && gFade > 0.0;
  float stride = gFade > 0.0 ? (spiny ? 0.5 : 0.72) : 1.0;
  int steps = spiny ? 120 : 68;
  bool hit = false;
  // (Plain steps: over-relaxed ones jump a flat ear edge-on.)
  for (int s = 0; s < 120; s++) {
    if (s >= steps) break;
    d = dist(ro + rd * t);
    if (d < max(eps, px * t * 0.35)) { hit = true; break; }
    float gap = d / max(t, eps);
    if (gap < near) { near = gap; nearT = t; }
    t += d * stride;
    if (t > tf) break;
  }
  // (Steps run out grazing a thin part: within a pixel of it is on it.)
  // (Among spines, they are all round it: it never stops in the dark between them.)
  if (!hit && t < tf && d < (spiny ? uGrain * 0.5 : max(eps * 12.0, px * t))) hit = true;
  vec3 p;
  if (!hit) {
    if (near > px * uInk || uGlow > 0.5) discard;
    p = ro + rd * nearT;
    float litInk, softInk;
    vec3 ink = paint(p, litInk, softInk);
    // (Spines' points are finer than the ink: they draw their own outline.)
    if (spiny && gCover * gFade > 0.5) discard;
    gl_FragColor = vec4(ink * 0.22 + vec3(0.004, 0.0035, 0.006), 1.0);
  } else {
    p = ro + rd * t;
    float lit, soft;
    vec3 base = paint(p, lit, soft);
    // Each lock or feather darker at its root and lighter at its tip, so the grain reads in colour too.
    if (gFade > 0.0) base *= mix(1.0, grainShade(p, base), gFade * soft * gCover);
    vec3 n = normalAt(p, eps * 1.5);
    // A little occlusion where parts meet (a leg against a belly), straight from the field.
    float reach = scale * 0.05;
    float ao = clamp(0.5 + 0.5 * dist(p + n * reach) / reach, 0.4, 1.0);
    // (A stand of spines takes the light as the dome under it, one form and no pits, with only part of each spine's own facets.)
    float shade = 0.0;
    if (spiny) { float dome = gCover * soft; vec3 v = normalize(crownAt(p)); n = normalize(mix(n, uSide * v.x + uUp * v.y + uFwd * v.z, dome * 0.4)); ao = mix(ao, 1.0, dome * 0.6); shade = dome * SPINE_FLOOR * smoothstep(-0.45, 0.1, v.y); }
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    float facing = max(dot(n, -rd), 0.0);
    float rim = pow(1.0 - facing, 3.0);
    // Light as keel/lit's LitMaterial takes it (colour x intensity, Lambert over pi), the sun wrapped a little.
    vec3 light = hemi * ao + uSunCol * max(dot(n, uSun) * 0.8 + 0.2, 0.0) + uFillCol * max(dot(n, uFill), 0.0);
    light = max(light * INV_PI, vec3(shade)) + uRimCol * rim * max(dot(n, uRim), 0.0) * INV_PI * 2.0;
    // The character light from the camera, wrapped so it rounds the body instead of flattening it.
    light += uFront * INV_PI * max(facing * 0.75 + 0.25 * n.y, 0.0);
    // A soft sheen along the sun, so fur and feathers turn with the light.
    vec3 halfway = normalize(uSun - rd);
    light += uSunCol * INV_PI * 0.12 * pow(max(dot(n, halfway), 0.0), 18.0);
    // A sky-lit edge lifts the body off the ground behind it.
    light += uSky * INV_PI * 0.6 * rim;
    light += coatLight(n, rd, halfway, rim) * soft;
    float glow = max(uGlow, lit);
    vec3 col = mix(base * light, base * (1.0 + 0.5 * rim), glow);
    // Dark fur still shines: its sheen and sky rim are light of their own, not a share of
    // its colour, so a black wolf shows its shape instead of a flat silhouette.
    // (The coat's only: an eye's pupil stays black and glossy.)
    float dark = (1.0 - smoothstep(0.03, 0.2, dot(base, vec3(0.2126, 0.7152, 0.0722)))) * (1.0 - glow) * soft;
    col += dark * uLift * INV_PI * (uSunCol * 0.13 * pow(max(dot(n, halfway), 0.0), 2.5) + uSky * 0.3 * rim);
    // (A shade warm of grey: the grade after this cools the darks, and true grey comes out slate.)
    col = mix(col, vec3(1.13, 1.0, 0.88) * dot(col, vec3(0.2126, 0.7152, 0.0722)), dark * uNeutral);
    // (Muted colours only: a brown coat leaves the greys, a vivid fox is left as it is.)
    float hi = max(max(col.r, col.g), col.b);
    float vivid = smoothstep(0.35, 0.7, (hi - min(min(col.r, col.g), col.b)) / max(hi, 1e-4));
    col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, mix(uSat, 1.0, vivid)), 0.0);
    // Bright sun would clip a coat channel by channel and turn a brown deer
    // orange; instead the highlight rolls off as a whole, keeping its hue.
    float peak = max(max(col.r, col.g), col.b);
    if (peak > 0.75) col *= (0.75 + 0.25 * (1.0 - exp(-(peak - 0.75) * 4.0))) / peak;
    gl_FragColor = vec4(col, 1.0);
  }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4((p - uCenter) / uSize, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const fragment = (maxParts: number, roles: number): string => `#define MAXP ${String(maxParts)}\n#define ROLES ${String(roles)}\n${FIELD}\n${MARCH}`;

// ---------------------------------------------------------------- bodies

const DEFAULT_CRISP = ["eye", "pupil", "shine", "nose", "glow", "horn"];
const DEFAULT_EMISSIVE = ["glow", "shine"];

export interface SdfBodies {
  /** Add this to the scene once. */
  readonly group: unknown;
  /** Draw these bodies this frame (the rest are hidden). */
  draw(bodies: readonly BodyInput[], light: BodyLight): void;
  dispose(): void;
}

interface Slot {
  readonly mesh: NodeLike;
  readonly material: MaterialLike;
  readonly u: Record<string, UniformLike<unknown>>;
}

function makeSlot(lit: LitLike, geometry: DisposableLike, shader: string, maxParts: number, roles: number, order: number): Slot {
  const u: Record<string, UniformLike<unknown>> = {
    uA: { value: Array.from({ length: maxParts }, () => new lit.Vector4()) },
    uB: { value: Array.from({ length: maxParts }, () => new lit.Vector4()) },
    uU: { value: Array.from({ length: maxParts }, () => new lit.Vector4(0, 1, 0, 1)) },
    uCount: { value: 0 },
    uPal: { value: Array.from({ length: roles }, () => new lit.Color("#ffffff")) },
    uLit: { value: new Array<number>(roles).fill(0) },
    uMin: { value: new lit.Vector3() }, uMax: { value: new lit.Vector3() },
    uCenter: { value: new lit.Vector3() }, uSize: { value: new lit.Vector3(1, 1, 1) },
    uFill: { value: new lit.Vector3(0, 1, 0) }, uFillCol: { value: new lit.Vector3(0, 0, 0) },
    uK: { value: 0.02 }, uGlow: { value: 0 }, uInk: { value: 0.85 }, uSat: { value: 1 },
    uSun: { value: new lit.Vector3(0, 1, 0) }, uSunCol: { value: new lit.Vector3(1, 1, 1) },
    uSky: { value: new lit.Vector3(0.6, 0.6, 0.7) }, uGround: { value: new lit.Vector3(0.2, 0.2, 0.2) },
    uRim: { value: new lit.Vector3(0, 0, 1) }, uRimCol: { value: new lit.Vector3(0, 0, 0) },
    uFront: { value: new lit.Vector3(0, 0, 0) },
    uGrain: { value: 0 }, uGrainKind: { value: 0 }, uGrainRise: { value: 1 }, uGrainOn: { value: -1 }, uCrown: { value: new lit.Vector4(0, 0, 0, 0) }, uAft: { value: new lit.Vector3(0, 0, -1) },
    uOrigin: { value: new lit.Vector3(0, 0, 0) }, uSide: { value: new lit.Vector3(1, 0, 0) }, uUp: { value: new lit.Vector3(0, 1, 0) }, uFwd: { value: new lit.Vector3(0, 0, 1) },
    uMat: { value: new lit.Vector4(0, 0, 0, 0) }, uLift: { value: 1 }, uNeutral: { value: 0 }, uPattern: { value: new lit.Vector4(0, 1, 0, 0) }, uPatCol: { value: new lit.Color("#000000") }, uPatTwo: { value: new lit.Color("#000000") }, uTrunk: { value: new lit.Vector3(0, 0, 0) }, uDorsal: { value: 1e6 },
  };
  const material = new lit.CustomMaterial({ uniforms: u, vertexShader: VERTEX, fragmentShader: shader, side: "back", depthTest: true, depthWrite: true });
  const mesh = new lit.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = order;
  return { mesh, material, u };
}

interface Bounds { readonly min: Vec; readonly max: Vec; readonly k: number }

const UP: Vec = [0, 1, 0];
interface Ink { readonly width: number; readonly pad: number }
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitOr = (v: Vec, fallback: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : fallback;
};

/**
 * The box the body is marched in. Its margin leaves room for the ink line:
 * a twelfth of the body's length, never less than `inkPad`. (Every pixel of
 * margin is marched, so it is kept to that.)
 */
function boundsOf(parts: readonly BodyPart[], count: number, blend: number, inkPad: number): Bounds {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (let i = 0; i < count; i += 1) {
    const part = parts[i];
    // (A decal has no surface and a carve only takes one away: neither widens the box.)
    if (!part || surfaceless(part)) continue;
    for (let axis = 0; axis < 3; axis += 1) span(lo, hi, axis, part);
    radius += meanRadius(part);
  }
  const [lx = 0, ly = 0, lz = 0] = lo;
  const [hx = 0, hy = 0, hz = 0] = hi;
  const mean = radius / Math.max(1, count);
  const pad = Math.max(mean * 0.5, inkPad > 0 ? Math.max(inkPad, Math.max(hx - lx, hy - ly, hz - lz) / 12) : 0);
  return { min: [lx - pad, ly - pad, lz - pad], max: [hx + pad, hy + pad, hz + pad], k: mean * blend };
}

/** A part that adds no surface of its own: a decal (paint only) or a carve (it cuts one away). */
const surfaceless = (part: BodyPart): boolean => part.decal === true || part.carve === true;
/** A part that casts a shadow: one with a surface, not kept out of it. */
const casts = (part: BodyPart): boolean => !surfaceless(part) && part.shadow !== false;

/** A part's mean thickness, along a taper. */
const meanRadius = (part: BodyPart): number => (part.r + (part.r1 ?? part.r)) / 2;

/** Widen the box along one axis to take in a part. */
function span(lo: number[], hi: number[], axis: number, part: BodyPart): void {
  const a = part.a[axis] ?? 0;
  const b = part.b[axis] ?? 0;
  const r1 = part.r1 ?? part.r;
  lo[axis] = Math.min(lo[axis] ?? Infinity, a - part.r, b - r1);
  hi[axis] = Math.max(hi[axis] ?? -Infinity, a + part.r, b + r1);
}

/** The part's thin direction: its `up`, made square to its length. */
function thinAxis(part: BodyPart): Vec {
  const up = part.up ?? [0, 1, 0];
  const ax = sub(part.b, part.a);
  const l2 = dot(ax, ax);
  if (l2 < 1e-18) return up;
  const t = sub(up, times(ax, dot(ax, up) / l2));
  const tl = Math.hypot(t[0], t[1], t[2]);
  return tl > 1e-9 ? times(t, 1 / tl) : [0, 1, 0];
}

interface Vector4Like { set(x: number, y: number, z: number, w: number): void }
interface ShaderState {
  readonly roles: Map<string, number>;
  readonly crisp: ReadonlySet<string>;
  readonly emissive: ReadonlySet<string>;
}

function roleIndex(state: ShaderState, role: string, limit: number): number {
  let index = state.roles.get(role);
  if (index === undefined) { index = Math.min(state.roles.size, limit - 1); state.roles.set(role, index); }
  return index;
}

function paint(slot: Slot, body: BodyInput, state: ShaderState): void {
  const pal = slot.u.uPal?.value as ColorLike[];
  const lit = slot.u.uLit?.value as number[];
  for (const [role, index] of state.roles) {
    pal[index]?.set(body.palette[role] ?? "#ff00ff");
    lit[index] = state.emissive.has(role) || body.lit?.includes(role) === true ? 1 : 0;
  }
}

/** The tag a part carries to the shader: its role, its melt in 16ths (0 crisp), 1024 for a decal and 2048 more for one under the pattern, 2048 alone for a carve. */
export function tagOf(role: number, crisp: boolean, part: Pick<BodyPart, "melt" | "decal" | "under" | "carve">): number {
  // (A carve is never crisp: its melt is how soft its rim is.)
  const melt = crisp && part.carve !== true ? 0 : Math.round(Math.max(0, Math.min(2, part.melt ?? 1)) * 16);
  if (part.carve === true) return role + 16 * Math.max(1, melt) + 2048;
  return role + 16 * melt + (part.decal === true ? (part.under === true ? 3072 : 1024) : 0);
}

function writePart(part: BodyPart, a: Vector4Like, b: Vector4Like, u: Vector4Like, tag: number): void {
  const flat = Math.max(0.05, Math.min(1, part.flat ?? 1));
  // (A round part has no thin axis to find. The axis is stored scaled by the flatness.)
  const thin = flat < 0.999 ? thinAxis(part) : UP;
  const f = flat < 0.999 ? flat : 1;
  const bow = bowOf(part);
  a.set(part.a[0], part.a[1], part.a[2], part.r);
  b.set(part.b[0], part.b[1], part.b[2], tag);
  u.set(bow ? bow[0] : thin[0] * f, bow ? bow[1] : thin[1] * f, bow ? bow[2] : thin[2] * f, Math.max(0, part.r1 ?? part.r));
}

/** A part's bow as the shader takes it: its way, 2 plus its size long. */
function bowOf(part: BodyPart): Vec | null {
  const size = part.bow ? Math.hypot(part.bow[0], part.bow[1], part.bow[2]) : 0;
  return part.bow && size > 1e-9 ? times(part.bow, (2 + size) / size) : null;
}

function fill(slot: Slot, body: BodyInput, state: ShaderState, maxParts: number, roles: number, blend: number, ink: Ink): void {
  const parts = body.capsules;
  const count = Math.min(parts.length, maxParts);
  // (The grain stands off the surface: the box leaves it room.)
  const { min, max, k } = boundsOf(parts, count, blend, ink.pad + grainReach(grainOf(body)));
  const A = slot.u.uA?.value as Vector4Like[];
  const B = slot.u.uB?.value as Vector4Like[];
  const U = slot.u.uU?.value as Vector4Like[];
  for (let i = 0; i < count; i += 1) {
    const part = parts[i];
    const a = A[i];
    const b = B[i];
    const u = U[i];
    if (part && a && b && u) writePart(part, a, b, u, tagOf(roleIndex(state, part.role, roles), state.crisp.has(part.role) || part.melt === 0, part));
  }
  paint(slot, body, state);
  (slot.u.uInk as UniformLike<number>).value = ink.width;
  (slot.u.uCount as UniformLike<number>).value = count;
  (slot.u.uK as UniformLike<number>).value = k;
  (slot.u.uGlow as UniformLike<number>).value = Math.min(1, body.glow ?? 0);
  grainSlot(slot, body, state, roles);
  place(slot, min, max);
  slot.mesh.visible = count > 0;
}

const SMOOTH: Grain = { kind: "fur", size: 0 };
/** The way a coat lies when its grain names none: back along the body and a little down. */
const AFT: Vec = [0, -0.33, -0.944];
const GRAIN_KINDS: Readonly<Record<Grain["kind"], number>> = { fur: 0, feather: 1, scale: 2, spine: 3 };
const grainOf = (body: BodyInput): Grain => (body.grain && body.grain.size > 0 ? body.grain : SMOOTH);
/** How far a grain stands off the surface: a spine its whole height. */
const grainReach = (grain: Grain): number => grain.size * (grain.kind === "spine" ? 1.1 : 0.4) * (grain.rise ?? 1);

/** How each grain takes the light when the body names no material of its own: fur soft and fuzzy, feathers and scales glossy. */
const MATERIALS: Readonly<Record<Grain["kind"], Required<Material>>> = {
  fur: { sheen: 0.6, fuzz: 0.45, gloss: 0, iridescence: 0, lift: 1, neutral: 0 },
  feather: { sheen: 0.15, fuzz: 0.1, gloss: 0.35, iridescence: 0, lift: 1, neutral: 0 },
  scale: { sheen: 0, fuzz: 0, gloss: 0.7, iridescence: 0, lift: 1, neutral: 0 },
  spine: { sheen: 0, fuzz: 0.1, gloss: 0.3, iridescence: 0, lift: 1, neutral: 0.3 },
};
const PATTERN_KINDS: Readonly<Record<Pattern["kind"], number>> = { dapple: 1, spots: 2, stripes: 3, streaks: 4, bars: 5, chevrons: 6, mackerel: 7, patches: 8, grizzle: 9, tips: 10 };

interface Vector4Set { set(x: number, y: number, z: number, w: number): unknown }

/** The body's frame (its grain and pattern ride on it), its grain, its material and its pattern. */
function grainSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const grain = grainOf(body);
  (slot.u.uGrain as UniformLike<number>).value = grain.size;
  (slot.u.uGrainKind as UniformLike<number>).value = GRAIN_KINDS[grain.kind];
  (slot.u.uGrainRise as UniformLike<number>).value = grain.rise ?? 1;
  (slot.u.uGrainOn as UniformLike<number>).value = grain.on === undefined ? -1 : roleIndex(state, grain.on, roles);
  (slot.u.uCrown?.value as Vector4Set).set(...(grain.crown ?? [0, 0, 0]), grain.crown ? 1 : 0);
  const fwd = unitOr(body.front ?? [0, 0, 1], [0, 0, 1]);
  const side = unitOr(cross(UP, fwd), [1, 0, 0]);
  const up = cross(fwd, side);
  const set = (name: string, v: Vec): void => { (slot.u[name]?.value as Vector3Like).set(v[0], v[1], v[2]); };
  set("uOrigin", body.at ?? [0, 0, 0]);
  set("uSide", side);
  set("uUp", up);
  set("uFwd", fwd);
  set("uAft", unitOr(grain.lie ?? AFT, AFT));
  const m = { ...(grain.size > 0 ? MATERIALS[grain.kind] : MATERIALS.scale), ...(grain.size > 0 ? {} : { gloss: 0 }), ...body.material };
  (slot.u.uMat?.value as Vector4Set).set(m.sheen, m.fuzz, m.gloss, m.iridescence);
  (slot.u.uLift as UniformLike<number>).value = m.lift;
  (slot.u.uNeutral as UniformLike<number>).value = m.neutral;
  patternSlot(slot, body, state, roles);
}

/** The pattern over the coat, in its own colour or its role's; none when it has no contrast. */
function patternSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const pattern = body.pattern;
  if (!pattern || pattern.contrast <= 0) { (slot.u.uPattern?.value as Vector4Set).set(0, 1, 0, 0); return; }
  roleIndex(state, pattern.role, roles);
  (slot.u.uPattern?.value as Vector4Set).set(PATTERN_KINDS[pattern.kind], Math.max(pattern.scale, 1e-4), Math.min(1, pattern.contrast), (pattern.seed % 97) * 1.37);
  (slot.u.uPatCol?.value as ColorLike).set(pattern.color ?? body.palette[pattern.role] ?? "#000000");
  (slot.u.uPatTwo?.value as ColorLike).set(pattern.second ?? "#000000");
  trunkSlot(slot, pattern);
}

/** Where a pattern that goes by the trunk finds it, and how high its spine line starts. */
function trunkSlot(slot: Slot, pattern: Pattern): void {
  const [low, back, front] = pattern.trunk ?? [0, 0, 0];
  (slot.u.uTrunk?.value as Vector3Like).set(low, back, front);
  (slot.u.uDorsal as UniformLike<number>).value = pattern.dorsal ?? 1e6;
}

/** Set the marching box: its bounds for the ray, and the mesh that draws it. */
function place(slot: Slot, min: Vec, max: Vec): void {
  const center = times(add(min, max), 0.5);
  const size = sub(max, min);
  (slot.u.uMin?.value as Vector3Like).set(min[0], min[1], min[2]);
  (slot.u.uMax?.value as Vector3Like).set(max[0], max[1], max[2]);
  (slot.u.uCenter?.value as Vector3Like).set(center[0], center[1], center[2]);
  (slot.u.uSize?.value as Vector3Like).set(size[0], size[1], size[2]);
  slot.mesh.position.set(center[0], center[1], center[2]);
  slot.mesh.scale.set(size[0], size[1], size[2]);
}

function lightSlot(slot: Slot, light: BodyLight): void {
  const set = (name: string, v: Vec | undefined): void => { if (v) (slot.u[name]?.value as Vector3Like).set(v[0], v[1], v[2]); };
  set("uSun", light.sun);
  set("uSunCol", light.sunColor);
  set("uFill", light.fill);
  set("uFillCol", light.fillColor ?? [0, 0, 0]);
  set("uSky", light.sky);
  set("uGround", light.ground);
  set("uRim", light.rim);
  set("uRimCol", light.rimColor ?? [0, 0, 0]);
  set("uFront", light.front ?? [0, 0, 0]);
  (slot.u.uSat as UniformLike<number>).value = light.saturation ?? 1;
}

/** Shadows: each part as a few plain spheres that only the shadow pass sees. */
function shadowProxy(lit: LitLike, limit: number): { mesh: InstancedLike; matrix: Matrix4Like; geometry: DisposableLike; material: MaterialLike } {
  const geometry = lit.sphere(1, 8, 6);
  const material = new lit.FlatMaterial({ colorWrite: false, depthWrite: false });
  const mesh = new lit.Instances(geometry, material, limit);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, matrix: new lit.Matrix4(), geometry, material };
}

function castShadows(proxy: ReturnType<typeof shadowProxy>, bodies: readonly BodyInput[], limit: number): void {
  let n = 0;
  for (const body of bodies) {
    for (const part of body.capsules) {
      if (!casts(part)) continue;
      const r = meanRadius(part) * ((part.flat ?? 1) < 1 ? 0.6 : 1);
      // A round part is one sphere; a long one three along its length.
      const steps = part.a[0] === part.b[0] && part.a[1] === part.b[1] && part.a[2] === part.b[2] ? 1 : 3;
      for (let s = 0; s < steps && n < limit; s += 1) {
        const k = steps === 1 ? 0 : s * 0.5;
        proxy.matrix.makeScale(r, r, r).setPosition(part.a[0] + (part.b[0] - part.a[0]) * k, part.a[1] + (part.b[1] - part.a[1]) * k, part.a[2] + (part.b[2] - part.a[2]) * k);
        proxy.mesh.setMatrixAt(n, proxy.matrix);
        n += 1;
      }
    }
  }
  proxy.mesh.count = n;
  proxy.mesh.instanceMatrix.needsUpdate = true;
}

/** A pool of smooth raymarched bodies, drawn from capsule parts each frame. */
export function createSdfBodies(lit: LitLike, options: SdfBodiesOptions = {}): SdfBodies {
  const maxParts = Math.max(4, Math.min(64, options.maxParts ?? 48));
  const maxBodies = Math.max(1, options.maxBodies ?? 48);
  const roles = 16;
  const blend = options.blend ?? 0.6;
  const width = Math.max(0, options.ink ?? 0.85);
  const ink: Ink = { width, pad: width > 0 ? Math.max(0, options.inkPad ?? 0.08) : 0 };
  const shader = fragment(maxParts, roles);
  const geometry = lit.box(1, 1, 1);
  const group = new lit.Group();
  const state: ShaderState = { roles: new Map(), crisp: new Set(options.crisp ?? DEFAULT_CRISP), emissive: new Set(options.emissive ?? DEFAULT_EMISSIVE) };
  const slots: Slot[] = [];
  const proxy = options.shadows === true ? shadowProxy(lit, maxBodies * maxParts) : null;
  if (proxy) group.add(proxy.mesh);
  return {
    group,
    draw(bodies, light) {
      while (slots.length < Math.min(bodies.length, maxBodies)) {
        const slot = makeSlot(lit, geometry, shader, maxParts, roles, options.renderOrder ?? 0);
        slots.push(slot);
        group.add(slot.mesh);
      }
      slots.forEach((slot, i) => {
        const body = bodies[i];
        if (!body) { slot.mesh.visible = false; return; }
        fill(slot, body, state, maxParts, roles, blend, ink);
        lightSlot(slot, light);
      });
      if (proxy) castShadows(proxy, bodies.slice(0, maxBodies), maxBodies * maxParts);
    },
    dispose() {
      for (const slot of slots) slot.material.dispose();
      geometry.dispose();
      proxy?.geometry.dispose();
      proxy?.material.dispose();
    },
  };
}


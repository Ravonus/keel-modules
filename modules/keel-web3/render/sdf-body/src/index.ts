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
  /** A row of this many beads, each `r` round, from `a` to `b` (and out along `bow`, if it has one, at its middle): a foot's nails as one part. */
  readonly row?: number;
  /** On a row: each bead drawn out this far and this way into a digit, thinning as it goes: a hand's fingers as one part. */
  readonly reach?: Vec;
  /** On a row with `reach`: each digit thins right down to a point: claws. */
  readonly sharp?: boolean;
  /** A finishing part the body can go without, in groups: where a renderer has too few parts, the highest group goes first, whole (see `fitParts`). */
  readonly detail?: number;
  /**
   * On a decal: bare skin, not paint. A pelt thins out toward it, its locks shorter and fewer until
   * none grow, so its edge is the coat's own (a macaque's face, a callus), and what shows between
   * the last hairs is this part's colour. `melt` scales how wide that edge runs.
   */
  readonly bare?: boolean;
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
  /** A relief over the whole body; without one it is as smooth as its parts. */
  readonly form?: Form;
  /** The eyes' lids: without them an eye is the open lens it is drawn as. */
  readonly eye?: Eye;
  /** How this body's bare skin takes the light; without it skin is lit as the coat is. */
  readonly skin?: Skin;
}

/**
 * Living skin, on `role` and under every `bare` part, whatever its hex. Skin
 * is matte and its colour comes from the blood under it, so its chroma is
 * held on a soft knee (`chroma`, a share of its luminance it can never quite
 * pass) however strong the role's colour and however hard a look's grade
 * pushes it, and small changes of hex stay small. `pale` is the thin skin
 * round an eye, `flush` how far the blood wanders over the rest, `depth` how
 * much of the light comes back out of it.
 */
export interface Skin {
  readonly role: string;
  readonly chroma: number;
  readonly pale?: string;
  readonly flush?: number;
  /** How much of the light it gives back, as a share of a painted surface's: under 1 the depth of living skin, which light goes into. */
  readonly depth?: number;
}

/**
 * The relief of muscle, bone and fat over a body, grown from its pattern's
 * seed: `amount` how far it stands off the surface, `size` how broad it runs.
 */
export interface Form {
  readonly amount: number;
  readonly size: number;
}

/**
 * How an eye's `role` lens is painted, its iris shaded from where it lies:
 * `lid` how far the upper lid has come down it (0 not at all, 1 shut),
 * `slant` how far that lid rises to the outer corner, `color` the skin of it,
 * `pupil` the pupil's shape. It is painted on whatever surface lies over the
 * lens, so the head's shape can neither bury the eye nor leave it standing proud.
 */
export interface Eye {
  readonly role: string;
  readonly lid: number;
  readonly slant: number;
  readonly color: string;
  readonly pupil: "round" | "slit" | "bar" | "dark";
  /** A thin black line round the eye. */
  readonly ring: boolean;
  /** How big its spark of light is, a share of the eye. */
  readonly spark?: number;
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
 * `tips` the raised tips of a coat's grain alone (a spine's pale end), and
 * `scutes` the pigment a `plate` grain's plates lay down as they grow, on those
 * plates alone (see `run`).
 * `role` is the colour it is painted in, `scale` its
 * feature size in the parts' units, `contrast` how strongly it shows, and
 * `seed` makes each animal's its own: any whole number, each a different
 * place in the noise. `genes` are how this animal's marks grow, continuous
 * rather than a list of looks: `warp` how far they wander, `stretch` how
 * drawn out along the body, `density` how much less of the coat they cover
 * (negative for more), `drift` how far its shade wanders over the body.
 */
export interface Pattern {
  readonly kind: "dapple" | "spots" | "stripes" | "streaks" | "bars" | "chevrons" | "mackerel" | "patches" | "grizzle" | "tips" | "scutes";
  readonly role: string;
  /** A colour of its own (hex) in place of its role's: a shade of the coat. */
  readonly color?: string;
  /** `patches`: the second colour (hex), its blotches lying among the first's; `grizzle`: the pale of the belly. */
  readonly second?: string;
  /** `mackerel`, `patches`, `grizzle`: where the trunk ends in the body's frame, as (below, behind, ahead of): the legs start below it, the tail behind it, the neck ahead of it. */
  readonly trunk?: Vec;
  /** `mackerel`, `grizzle`: the height on the body's frame above which its midline is painted, the dark line down a spine. */
  readonly dorsal?: number;
  /**
   * `scutes`: how long the pigment cells along a plate's growing edge keep
   * on working, 0 to 1. Those that stop and start leave broken blotches, those
   * that never stop leave whole rays out from its first speck, and every
   * plate in between. `scale` is how far apart they stand along that edge.
   */
  readonly run?: number;
  readonly scale: number;
  readonly contrast: number;
  readonly seed: number;
  readonly genes?: readonly [warp: number, stretch: number, density: number, drift: number];
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
 * `plate` is a shell's horn: a shell's own layout of plates laid over the dome
 * about `crown` (see `dome`), each a low flat-topped plate stepped down in the
 * growth rings it laid down to a narrow sunk seam, its dome stopped flat at the
 * rim; `on` names the shell, and every other part wears hide in scales grown by
 * the same cells (see `scales`).
 * `on`, a role, grows the grain on that role's parts alone and leaves the
 * rest smooth.
 */
export interface Grain {
  readonly kind: "fur" | "feather" | "scale" | "spine" | "plate";
  readonly size: number;
  readonly lie?: Vec;
  readonly rise?: number;
  readonly crown?: Vec;
  readonly on?: string;
  /** `plate`: the dome, as its half width, height and half length off `crown`, which lies at the middle of its rim. */
  readonly dome?: Vec;
  /** `plate`: how far the dome has pitched forward, in radians (it dips as the animal's forelegs bend). */
  readonly tilt?: number;
  /** `plate`: how deep the teeth along the dome's back rim are cut, as a share of its height, one to each rim plate. */
  readonly teeth?: number;
  /** `plate`: where the hide's scales grow larger than its own fine ones. */
  readonly scales?: readonly ScalePatch[];
  /** `fur`: a coat grown from the skeleton (see Pelt), in place of `lie` and `crown`. */
  readonly pelt?: Pelt;
}

/**
 * One stretch of the skeleton a pelt grows from: its hair runs from `a` to
 * `b`, `long` of it at each end (in `size`s). `up` is the side its coat is
 * longest and darkest on (a spine's back, a limb's outside), `girth` how thick
 * the body lies about it, `fall` how far the hair slants away from that side
 * as it runs, 0 straight along the bone (a flank's hair falling off the spine).
 */
export interface PeltBone {
  readonly a: Vec;
  readonly b: Vec;
  readonly long: readonly [number, number];
  readonly up: Vec;
  readonly girth: number;
  readonly fall?: number;
}

/**
 * Hair grown the way hair grows, by general rules, for any animal. Its way is
 * a flow field off the skeleton (`flow`, at most twelve bones), so it runs
 * crown to nape to spine to rump and down each limb and crosses itself
 * nowhere; its length is a map over the same bones. It clumps at three scales,
 * big locks that break the outline, smaller ones drawn together into them and
 * sparse fine strands, each narrowing to a point, over `under`, a soft dense
 * undercoat, that share of the hair's length, which leaves no dark between
 * them. `thin` is how much shorter it grows on the underside of each bone
 * (a belly, the inside of a limb). Its colour is pigment along each hair, not
 * light on it: `root` the shade laid over its base, as strongly as `crease`,
 * `band` the dark ring below its tip and how strongly, `tip` the pale end of
 * it and how much of the hair that is, each lock warmer or cooler by up to
 * `tint`. Over the whole animal it goes to `back` toward the coat's `up` sides
 * and to `front` away from them, as strongly as `dorsal` and `ventral`.
 */
export interface Pelt {
  readonly flow: readonly PeltBone[];
  readonly under?: number;
  readonly thin?: number;
  readonly crease?: number;
  readonly root?: string;
  readonly band?: readonly [color: string, depth: number];
  readonly tip?: readonly [color: string, share: number];
  readonly tint?: number;
  readonly back?: string;
  readonly front?: string;
  readonly dorsal?: number;
  readonly ventral?: number;
}

/** A patch of a plated animal's hide wearing scales of its own: within `reach` of `at`, `size` across. */
export interface ScalePatch {
  readonly at: Vec;
  readonly reach: number;
  readonly size: number;
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
uniform vec3 uDome;        // a plated dome's half width, height and half length off the crown
uniform vec3 uDomeGene;    // the cosine and sine of how far it has pitched forward, how deep its back rim's teeth
uniform vec4 uScale[3];    // where a hide's scales grow larger, and how far round there; w 0 for none
uniform vec3 uScaleSize;   // how large, each
uniform vec3 uAft, uOrigin, uSide, uUp, uFwd;
uniform vec4 uMat;      // sheen, fuzz, gloss, iridescence
uniform float uLift;    // how far a near-black coat's sheen lifts it
uniform float uNeutral; // how far a near-black coat's colour is drawn to neutral
uniform vec4 uPattern;  // kind (0 none), scale, contrast
uniform vec3 uPatSeed;  // where in the noise this animal's coat grew
uniform vec4 uPatGene;  // warp, stretch along the body, density, drift (see Pattern)
uniform vec3 uPatCol, uPatTwo, uTrunk;
uniform float uDorsal;
uniform vec3 uForm;      // how far the body's own relief stands, and how broad it runs
uniform float uEyeRole;  // the role an eye's lens wears; -1 for none
uniform vec4 uEyeLid;    // how far the upper lid is down, how it slants up to the outer corner, the pupil's kind, its black ring
uniform vec3 uEyeLidCol;
uniform float uEyeSpark;  // how big its spark of light is
uniform int uFlowN;        // how many bones a pelt grows from; 0 for none
uniform vec4 uFlowA[FLOWS]; // a, how long its hair is there
uniform vec4 uFlowB[FLOWS]; // b, how long its hair is there
uniform vec4 uFlowU[FLOWS]; // the side it is longest on, its girth
uniform float uFlowFall[FLOWS];
uniform vec4 uPelt;       // undercoat's share, how thin on the underside, how deep the crease, how far a lock's tint wanders
uniform vec3 uPeltCast;   // how strong the dorsal and the ventral are
uniform vec3 uPeltLine;   // how deep the band, how much of the hair is tip
uniform vec3 uPeltRoot, uPeltBand, uPeltTip, uPeltBack, uPeltFront;
uniform float uSkinRole;  // the role living skin wears; -1 for none
uniform vec3 uSkin;       // how much chroma it can hold, how far its blood wanders, how much of the light it gives back
uniform vec3 uSkinPale;
varying vec3 vLocal;
varying vec3 vEye;
// How much grain this pixel shows: none where a lock would be finer than a pixel.
float gFade = 0.0;
// How much of the surface here wears the grain (see grows), and how far off it this point stands.
float gCover = 1.0;
float gLift = 0.0;
float gReach = 1.0;
// How much of the surface here is bare skin, and that skin's colour; how much of it is skin at all;
// how near the nearest eye lies.
float gBare = 0.0, gSkin = 0.0, gEyeD = 1e9, gMark = 0.0;
vec3 gBareCol = vec3(0.0);
// 0 while the field is asked for the body under the locks alone (the light on a coat goes by that).
float gLocks = 1.0;

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
// Whether grain grows on a part of this role.
float grows(float role) { return uGrainOn < -0.5 || abs(role - uGrainOn) < 0.5 ? 1.0 : 0.0; }
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
  v = vec3(dot(v, uSide), dot(v, uUp), dot(v, uFwd));
  return vec3(v.x, v.y * uDomeGene.x + v.z * uDomeGene.y, v.z * uDomeGene.x - v.y * uDomeGene.y);
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
// A shell's plates, as a shell lays them: five down its keel, four up each side and a ring of wide
// ones round its rim, on the dome unrolled flat from its top (0 there, 1 at the rim). Each plate grows
// out from its own first speck, keeping its shape as it does, so what it knows of a point is which
// way from there it lies (gWay), how far out from there to its seam (gRing, 0 at the speck, 1 at the
// seam: its rings run true to its edges) and how far off the seam is (gSeam). This animal's seed
// moves the seams, as a shell's are never quite true, a little more on one side than on the other.
const float PLATE_KEEL = 0.33, PLATE_SIDE = 0.51, PLATE_COSTAL = 0.36, PLATE_RIM = 0.82, PLATE_FOOT = 1.08, PLATE_MARGINS = 18.0, PLATE_PI = 3.14159265;
float gSeam = 1.0, gRing = 0.0, gPlate = 0.0, gFan = 0.0;
vec2 gWay = vec2(0.0);
void plateCell(vec2 rel, float ring, float seam, float id) {
  gWay = rel; gRing = ring; gSeam = seam; gPlate = id;
}
// Where a rim plate lies round the shell: its place, its plates turned a little from true, each side its own way.
float plateRound(vec2 g) {
  float a = abs(atan(g.x, g.y)) / PLATE_PI * PLATE_MARGINS * 0.5;
  return a + 0.5 + 0.2 * sin(a * 1.7 + uPatSeed.x + sign(g.x) * 1.3) * smoothstep(0.0, 1.5, a);
}
// (A rim plate grows upward from the shell's edge, its speck on its lower edge, and fans out from there.)
void plateMargin(vec2 g, float rho, float rim) {
  float a = plateRound(g), c = floor(a), f = a - c, wide = 2.0 * PLATE_PI / PLATE_MARGINS * rho;
  plateCell(vec2((f - 0.5) * wide, rho - PLATE_FOOT), max(abs(2.0 * f - 1.0), (PLATE_FOOT - rho) / (PLATE_FOOT - rim)), min((rho - rim) * 2.4, min(f, 1.0 - f) * wide), hash3(vec3(c, sign(g.x), 7.0) + uPatSeed));
  gFan = 1.0;
}
// One plate's first speck, in the shell's plan: (a row, a place along it).
vec2 plateSite(float row, float col, inout float id) {
  vec3 h = vec3(row * 1.7, col, 0.0) + uPatSeed;
  float seed = hash3(h), wander = 1.0 - 0.4 * step(0.5, -row), a = fract(seed * 7.3) - 0.5, b = fract(seed * 13.7) - 0.5;
  id = seed;
  if (abs(row) < 0.5) return vec2(a * 0.05, col * PLATE_KEEL + b * 0.08);
  float z = (col + 0.5) * PLATE_COSTAL;
  return vec2(row * (PLATE_SIDE - 0.09 * z * z + a * 0.1 * wander), z + b * 0.08 * wander);
}
void plateAt(vec3 p) {
  vec3 n = normalize(crownAt(p) / uDome);
  float rho = acos(clamp(n.y, -1.0, 1.0)) / (PLATE_PI * 0.5);
  vec2 g = normalize(n.xz + vec2(0.0, 1e-5)) * rho;
  float rim = PLATE_RIM + (noise3(vec3(g * 2.3, 1.0) + uPatSeed) - 0.5) * 0.06;
  gFan = 0.0;
  if (rho > rim) { plateMargin(g, rho, rim); return; }
  vec2 sites[13], near = vec2(0.0);
  float best = 99.0, id = 0.0, seed = 0.0;
  int at = 0;
  for (int row = -1; row <= 1; row++) {
    for (int col = -2; col <= (row == 0 ? 2 : 1); col++) {
      vec2 s = plateSite(float(row), float(col), seed);
      sites[at] = s; at++;
      float f = dot(g - s, g - s);
      if (f < best) { best = f; near = s; id = seed; }
    }
  }
  // (Whichever edge it has reached first is how far it has grown: the shape it keeps is its own.)
  vec2 rel = g - near;
  float ring = (rho - length(near)) / max(rim - length(near), 1e-3), seam = rim - rho;
  for (int i = 0; i < at; i++) {
    vec2 v = sites[i] - near;
    float k = dot(v, v);
    if (k < 1e-5) continue;
    float far = 2.0 * dot(rel, v) / k;
    if (far > ring) { ring = far; seam = (1.0 - far) * sqrt(k) * 0.5; }
  }
  plateCell(rel, ring, min(seam, (rim - rho) * 2.4), id);
}
// A plate's height: low, flat over the patch it started as, stepped down in each year's growth to
// the narrow seam it is sunk in. (uGrainRise is how far above its seam it stands, its shape the same.)
const float PLATE_YEARS = 6.0;
float plateRelief(vec3 p) {
  plateAt(p);
  float year = min(gRing, 1.0) * PLATE_YEARS, stair = (floor(year) + smoothstep(0.72, 1.0, fract(year))) / PLATE_YEARS;
  return smoothstep(0.0, 0.03, gSeam) * (0.32 + 0.24 * uGrainRise * (1.0 - smoothstep(0.24, 1.0, stair)));
}
// Hide, by the plan of a shell: cells each round their own first speck, kept apart by their seams,
// only in the round and as fine as this part of the animal wears them.
void scaleCells(vec3 q) {
  vec3 i = floor(q - 0.5), near = vec3(0.0), sites[8];
  float best = 99.0, id = 0.0;
  for (int c = 0; c < 8; c++) {
    vec3 cell = i + vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
    float h = hash3(cell + 1.7);
    sites[c] = cell + 0.2 + 0.6 * vec3(h, fract(h * 7.3), fract(h * 13.7));
    float f = dot(q - sites[c], q - sites[c]);
    if (f < best) { best = f; near = sites[c]; id = h; }
  }
  vec3 rel = q - near;
  float ring = 0.0, seam = 1.0;
  for (int c = 0; c < 8; c++) {
    vec3 v = sites[c] - near;
    float k = dot(v, v);
    if (k < 1e-5) continue;
    float far = 2.0 * dot(rel, v) / k;
    if (far > ring) { ring = far; seam = (1.0 - far) * sqrt(k) * 0.5; }
  }
  plateCell(vec2(rel.x + rel.z, rel.y), ring, seam, id);
}
// How large this part of the hide's scales are: the fine ones of a neck, or a patch's own.
float scaleSize(vec3 p) {
  float size = uGrain * 0.24;
  if (uScale[0].w > 0.0 && distance(p, uScale[0].xyz) < uScale[0].w) size = uScaleSize.x;
  if (uScale[1].w > 0.0 && distance(p, uScale[1].xyz) < uScale[1].w) size = uScaleSize.y;
  if (uScale[2].w > 0.0 && distance(p, uScale[2].xyz) < uScale[2].w) size = uScaleSize.z;
  return size;
}
float gScale = 1.0;
// Hide's height at p: each scale domed and sunk in its seam, a large one shingled, its lower edge lying over the next.
float hide(vec3 p) {
  gScale = scaleSize(p);
  scaleCells(bodyAt(p) / gScale);
  float shingle = smoothstep(uGrain * 0.24, uGrain * 0.4, gScale);
  return gScale * (0.06 + 0.08 * shingle + 0.12 * shingle * clamp(0.5 - gWay.y, 0.0, 1.0)) * smoothstep(0.0, 0.14, gSeam);
}
// How far a shell's rim rides up from its middle: a wide low arch over the neck with a shallow notch
// cut in it, a lower one over the tail, and teeth along its back edge, a seam between each two.
float rimRise(vec3 v) {
  float z = v.z / uDome.z, x = abs(v.x) / uDome.x, open = 1.0 - smoothstep(0.1, 0.8, x);
  float rise = open * (0.14 * smoothstep(0.5, 1.0, z) + 0.07 * smoothstep(0.65, 1.0, -z)) + (1.0 - smoothstep(0.08, 0.34, x)) * 0.16 * smoothstep(0.7, 1.0, z);
  if (z < -0.45) rise += uDomeGene.z * abs(2.0 * fract(plateRound(vec2(x, z))) - 1.0) * smoothstep(0.45, 0.8, -z);
  return uDome.y * rise;
}
// A shell's flare: its rim turned out a little at the very foot of the dome over the tail, and less over the neck.
float brim(vec3 p) {
  vec3 v = crownAt(p);
  float y = clamp(1.0 - (v.y - rimRise(v)) / (uDome.y * 0.42), 0.0, 1.0), z = v.z / uDome.z;
  return uDome.y * 0.035 * y * y * (smoothstep(0.15, 0.9, -z) + 0.45 * smoothstep(0.6, 1.0, z));
}
// (A plated dome stops flat just under its rim: a shell is a dome over a floor, never a ball.)
float hull(vec3 p, float di, float role) {
  if (uGrainKind < 3.5 || grows(role) < 0.5) return di;
  vec3 v = crownAt(p);
  float k = uDome.y * 0.05, cut = rimRise(v) - v.y - uDome.y * 0.1;
  float h = clamp(0.5 + 0.5 * (cut - di) / k, 0.0, 1.0);
  return mix(di, cut, h) + k * h * (1.0 - h);
}
// The coat lies back along the body and a little down (uAft, the grain's lie).
float grain(vec3 p) {
  if (uGrainKind > 3.5) return plateRelief(p);
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

// A pelt (see Pelt). The two bones nearest p, each by how far off its own girth p lies: all its
// coat comes off them, so nothing grown on it can ever cross what grows beside it, and where one
// hands over to the other their locks simply overlap, as a mantle's lie over an arm's.
int gFlowI = 0, gFlowJ = 0;
float gFlowW = 1.0, gLong = 0.0, gSide = 0.0;
// (The share of the way along bone i, its hair's length there, and how far p lies toward its long side.)
float flowLong(vec3 p, int i, float k, out float side) {
  vec3 a = uFlowA[i].xyz, ba = uFlowB[i].xyz - a;
  side = dot(normalize(p - a - ba * k + 1e-6), uFlowU[i].xyz);
  return mix(uFlowA[i].w, uFlowB[i].w, k) * mix(1.0 - uPelt.y, 1.0, smoothstep(-0.75, 0.3, side));
}
void flowAt(vec3 p) {
  float best = 1e9, next = 1e9, kb = 0.0, kn = 0.0;
  for (int i = 0; i < uFlowN; i++) {
    vec3 a = uFlowA[i].xyz, ba = uFlowB[i].xyz - a;
    float k = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    float off = length(p - a - ba * k) - uFlowU[i].w;
    if (off < best) { next = best; kn = kb; gFlowJ = gFlowI; best = off; kb = k; gFlowI = i; }
    else if (off < next) { next = off; kn = k; gFlowJ = i; }
  }
  gFlowW = smoothstep(0.0, uGrain * 1.2, next - best);
  float near, far;
  float a = flowLong(p, gFlowI, kb, near), b = flowLong(p, gFlowJ, kn, far);
  // (Halfway between two bones it is the mean of them, and the nearer's alone from there out, so the map has no step in it.)
  float w = 0.5 + 0.5 * gFlowW;
  gLong = mix(b, a, w);
  gSide = mix(far, near, w);
}
// How far along its hair's run a point t along a bone lies, with hair la long at its start and
// lb at its end: locks keep their shape however fast the hair lengthens, as the sum of their own
// lengths never bunches up the way a share of the local length would.
float hairRun(float t, float span, float la, float lb) {
  if (t < 0.0) return t / la;
  float grow = (lb - la) / span, t1 = min(t, span);
  float run = abs(grow) < 1e-4 ? t1 / la : log(1.0 + grow * t1 / la) / grow;
  return run + max(t - span, 0.0) / lb;
}
// Bone i's skin unrolled: x along the hair, y across it, in grain sizes, mirrored about its long
// side, as a parting runs. Its hair's slant is a turn of this sheet, so it stays one straight lie.
vec2 sheetAt(vec3 p, int i) {
  vec3 a = uFlowA[i].xyz, e = uFlowB[i].xyz - a, up = uFlowU[i].xyz, r = p - a;
  float span = max(length(e), 1e-5);
  e /= span;
  float arc = atan(dot(r, cross(e, up)), dot(r, up)) * max(uFlowU[i].w, uGrain);
  // (The parting wanders, as nothing about an animal runs straight.)
  arc += (noise3(p / (uGrain * 4.5) + uPatSeed) - 0.5) * uGrain * 2.4;
  float way = abs(arc), run = hairRun(dot(r, e), span, max(uFlowA[i].w, 0.2), max(uFlowB[i].w, 0.2)), f = uFlowFall[i];
  return vec2(run + way * f, way - run * f) / uGrain;
}
// Where on its lock the last field found lies: 0 root to 1 tip, across it (-1 to 1, narrowing to its
// point), how far off its middle in the field's own units, and a number of its own.
float gS = 0.0, gX = 0.0, gDrift = 0.0, gId = 0.0;
// Rows of locks over a sheet, q in grain sizes, wide by span a cell: each roots in its cell, runs
// two rows on and narrows to its point, the tallest over any point is the one seen. gap is the
// share of them that never grow.
float lockField(vec2 q, float wide, float span, float seed, float gap) {
  float v = q.x / span, row0 = floor(v), top = 0.0;
  for (int dr = 0; dr < 3; dr++) {
    float row = row0 - float(dr), slip = hash3(vec3(row, seed, 1.7)) * 5.0, u = q.y / wide + slip, col0 = floor(u);
    for (int dc = -1; dc <= 1; dc++) {
      float col = col0 + float(dc), h = hash3(vec3(row, col, seed));
      if (h < gap) continue;
      float s = (v - row - fract(h * 3.7) * 0.7) / mix(1.2, 1.7, fract(h * 11.3));
      if (s < 0.0 || s > 1.0) continue;
      float drift = u - col - 0.5 - (fract(h * 7.3) - 0.5) * 0.6 - (fract(h * 5.1) - 0.5) * s * 0.8;
      float x = drift / (0.86 * smoothstep(0.0, 0.2, s) * pow(1.0 - s, 0.62) + 1e-3);
      if (abs(x) >= 1.0) continue;
      float tall = (1.0 - x * x) * (0.3 + 0.7 * s);
      if (tall > top) { top = tall; gS = s; gX = x; gId = h; gDrift = drift * wide; }
    }
  }
  return top;
}
const float PELT_BIG = 2.2, PELT_BIG_LONG = 4.2, PELT_MID = 0.62, PELT_MID_LONG = 2.3, PELT_FINE = 0.24, PELT_FINE_LONG = 2.6, PELT_DRAW = 1.5;
// The height of bone i's coat at p, 0 to about 1: a big lock, the lesser ones in it drawn together
// toward its point, the sparse fine strands over them, and each one's tiny ridges, which run
// together with it to its tip.
float boneCoat(vec3 p, int i, float gap) {
  vec2 q = sheetAt(p, i);
  float seed = float(i) * 3.1;
  float big = lockField(q, PELT_BIG, PELT_BIG_LONG, seed, 0.3 + gap * 0.7);
  float sb = gS;
  // (Spread wider the further along the big lock, so what lies in it comes together at its point.)
  vec2 drawn = vec2(q.x, q.y + gDrift * PELT_DRAW * sb * step(1e-4, big));
  float mid = lockField(drawn, PELT_MID, PELT_MID_LONG, seed + 7.0, gap);
  float sm = gS, xm = gX, idm = gId;
  float ridge = 0.5 + 0.5 * cos(xm * 7.0 + idm * 40.0);
  float fine = lockField(drawn, PELT_FINE, PELT_FINE_LONG, seed + 13.0, 0.74 + gap * 0.26);
  gS = sm; gX = xm; gId = idm;
  return max(big * 0.62 + mid * (0.34 + 0.08 * ridge), fine * 1.06 * step(1e-4, mid));
}
// The coat's height at p (see flowAt, called first), the nearer bone's or, where it hands over, the other's.
float coatAt(vec3 p, float gap) {
  float h = boneCoat(p, gFlowI, gap);
  if (gFlowW > 0.999) return h;
  float s = gS, x = gX, id = gId, other = boneCoat(p, gFlowJ, gap) * (1.0 - gFlowW);
  if (other > h) return other;
  gS = s; gX = x; gId = id;
  return h;
}
// How bare the skin is at p, d off the nearest bare part: its edge broken by the noise the locks grow in.
float bareAt(vec3 p, float d) {
  // (With no grain to go by, a glowing morph's, it is a plain soft patch.)
  float g = uGrain > 0.0 ? uGrain : uK;
  if (d > g * 3.0) return 0.0;
  return 1.0 - smoothstep(-g * 0.42, g * 0.42, d + (noise3(p / (g * 0.8) + uPatSeed) - 0.5) * g * 0.9);
}
// How far a coat raises the surface at p, off the bones' map: its undercoat, whole at any distance,
// and the locks over that, a lock's mean far off where they are too fine to tell apart.
float peltRise(vec3 p, float bare, float cover) {
  flowAt(p);
  float under = uPelt.x, keep = sqrt(cover) * (1.0 - bare), mean = 0.55;
  // (Toward any edge of the coat its locks grow fewer, so it stops in a fringe over a wrist, not a line.)
  float locks = gFade > 0.0 && gLocks > 0.5 ? coatAt(p, max(bare, 1.0 - cover)) : mean;
  return uGrain * uGrainRise * gLong * keep * (under + (1.0 - under) * mix(mean, locks, gFade));
}

// The pixel engine's capsule, tapered from r at a to r1 at b (its radius
// follows the axis, the distance scaled by the slope so the march never
// overshoots), and squashed across its thin axis when flat < 1.
float part(vec3 p, int i) {
  vec3 a = uA[i].xyz, b = uB[i].xyz;
  vec3 pa = p - a, ba = b - a;
  float l2 = max(dot(ba, ba), 1e-9);
  float h = clamp(dot(pa, ba) / l2, 0.0, 1.0);
  // (A row's bead count is stored as its far radius, under nought, and its bow as it stands.)
  // (A row of digits has a quarter on its count, and its bow is how far each one reaches; a half, and they come to points.)
  if (uU[i].w < 0.0) {
    float n = floor(-uU[i].w) - 1.0, s = floor(h * n + 0.5) / n;
    if (fract(-uU[i].w) < 0.1) return length(pa - ba * s - uU[i].xyz * 4.0 * s * (1.0 - s)) - uA[i].w;
    vec3 v = pa - ba * s, reach = uU[i].xyz;
    float k = clamp(dot(v, reach) / max(dot(reach, reach), 1e-9), 0.0, 1.0);
    return length(v - reach * k) - uA[i].w * (1.0 - (fract(-uU[i].w) > 0.4 ? 0.94 : 0.28) * k);
  }
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
  float z = q.z * 0.8 + 1.1 * sin(q.z * 0.55 + uPatSeed.x);
  float edge = mix(0.98, 0.5 - 0.6 * noise3(vec3(z * 0.5, 5.0, uPatSeed.y)), sqrt(up));
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
  float t = mix(0.66, 0.4, up) + 0.25 * smoothstep(uTrunk.z - s * 1.0, uTrunk.z, b.z) + uPatGene.z;
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
// The pigment on a plate, as a plate lays it down: cells along its growing edge paint what grows
// under them, each working for a run of years, then resting, so a mark is written outward from the
// first speck, the way round the plate being which cell and the way out being when. Those that never
// rest (keep 1) write whole rays that thin as they go and stop short of the seam; those that do write
// blocks along its growth rings. The speck itself is painted whole. A rim plate's rays fan up from its
// lower edge. Each plate its own cells, each animal its own plates.
float plateMarks(float keep) {
  vec2 way = normalize(gWay + vec2(1e-5, 0.0));
  vec3 own = uPatSeed + gPlate * 41.0;
  float wobble = noise3(vec3(way * 1.1, gRing * 1.5) + own) - 0.5, loose = 1.0 - keep;
  // (Each run its own ring of cells, more of them as the edge grows longer, so no mark lines up with the last.)
  float hold = keep * keep * keep, run = gRing / mix(0.25, 9.0, hold), band = floor(run), year = run - band;
  float cells = (gFan > 0.5 ? 8.0 : clamp(floor(uGrain / uPattern.y + gPlate * 2.5), 3.0, 14.0)) * (1.0 + band * 0.75);
  float a = atan(way.x, way.y) / (PLATE_PI * 2.0) * cells + 0.5 + (gFan > 0.5 ? 0.0 : gPlate * 19.0 + band * 3.7) + wobble * uPatGene.x * loose * 0.7;
  float c = floor(a), off = abs(a - c - 0.5) * 2.0;
  float works = step(hash3(vec3(c, band, 5.0) + own), mix(0.6 - uPatGene.z * 3.0, 1.0, hold));
  float block = 1.0 - smoothstep(0.78, 0.92, length(vec2(off * 0.9, (year - 0.5) * 2.2)) + wobble * 0.7);
  float stop = 0.84 - 0.2 * hash3(vec3(c, 3.0, 1.0) + own), wide = mix(0.075, 0.012, clamp(gRing / stop, 0.0, 1.0));
  float ray = (1.0 - smoothstep(wide - 0.012, wide + 0.012, sin(off * PLATE_PI / cells) * gRing)) * (1.0 - smoothstep(stop - 0.05, stop, gRing));
  float speck = 1.0 - smoothstep(0.14, 0.22, gRing * (gFan > 0.5 ? 2.2 : 1.0) + wobble * 0.3 * loose);
  return max(mix(block, ray, hold) * works * smoothstep(0.1, 0.16, gRing), speck);
}
float scuteMarks(vec3 p) {
  plateAt(p);
  return plateMarks(uPattern.w);
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
// The space a coat's marks grow in: this animal's own stretch of the noise, drawn out along its
// body and warped by its own genes, so no two grow the same marks from the same algorithm.
vec3 coatSpace(vec3 b) {
  vec3 q = b / uPattern.y;
  q.z /= uPatGene.y;
  q += uPatSeed;
  return q + (vec3(noise3(q * 0.6 + 11.0), noise3(q * 0.6 + 29.0), noise3(q * 0.6 + 47.0)) - 0.5) * uPatGene.x;
}
float pattern(vec3 p) {
  float kind = uPattern.x;
  if (kind < 0.5) return 0.0;
  if (kind > 10.5) return scuteMarks(p) * gCover;
  vec3 b = bodyAt(p);
  vec3 q = coatSpace(b);
  float g = uPatGene.z;
  if (kind < 1.5) return smoothstep(0.5 + g, 0.7 + g, fbm(q));
  if (kind < 2.5) return smoothstep(0.64 + g, 0.72 + g, noise3(q * 1.6));
  // (Stripes and bars wander with the noise and thin out down the flanks, as a tiger's or an owl's do.)
  float wander = fbm(q * 0.7) * 1.6;
  if (kind < 3.5) return smoothstep(0.35, 0.75, sin(q.z * 3.14159 + wander * 2.0)) * smoothstep(-0.6, 0.4, b.y / uPattern.y);
  if (kind < 4.5) return smoothstep(0.62 + g, 0.78 + g, noise3(vec3(q.x * 2.6, q.y * 2.6, q.z * 0.35)));
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
  return mix(uPatCol, uPatTwo, smoothstep(0.47, 0.5, fbm(calicoWarp(coatSpace(bodyAt(p)).zxy) + 31.0)));
}
// How thick part i is at its thinnest: its smaller radius, squashed by its flatness.
float partThickness(int i) {
  return min(uA[i].w, uU[i].w) * min(length(uU[i].xyz), 1.0);
}
// Part i melted into the surface so far by its own share of the melt; h is its share.
float melt(int i, float m, float d, float di, out float h) {
  float k = max(min(uK * m, (uA[i].w + uU[i].w) * 0.4), 1e-6);
  h = clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0);
  return mix(d, di, h) - k * h * (1.0 - h);
}
// The surface alone, for the march, the normal and the occlusion. Crisp
// parts join it after the melt, so nothing melts into an eye.
float dist(vec3 p) {
  float d = 1e9, c = 1e9, h, thick = 0.0, cover = 0.0, cut = 1e9, ck = 1e-6, bare = 1e9;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float tag = uB[i].w;
    if (tag >= 4095.5) { if (uFlowN > 0) bare = min(bare, part(p, i)); continue; }
    bool carve = tag >= 2047.5 && tag < 3071.5;
    if (tag >= 1023.5 && !carve) continue;
    float m = floor(mod(tag, 1024.0) * 0.0625);
    float di = part(p, i);
    if (carve) { if (di < cut) { cut = di; ck = max(uK * m * 0.0625, 1e-6); } continue; }
    if (m < 0.5) { c = min(c, di); continue; }
    di = hull(p, di, mod(tag, 16.0));
    d = melt(i, m * 0.0625, d, di, h);
    thick = mix(thick, partThickness(i), h);
    cover = mix(cover, grows(mod(tag, 16.0)), h);
  }
  // The carves cut in after the melt, their rims as soft as their own melt.
  if (cut < 1e8) { h = clamp(0.5 - 0.5 * (d + cut) / ck, 0.0, 1.0); d = mix(d, -cut, h) + ck * h * (1.0 - h); }
  // A body is never a smooth balloon: muscle, bone and fat lift and crease it, each animal its own
  // way. (Lighter on a thin part, and none about an eye or a nose.)
  // (Horn has no muscle under it: a shell wears its plates instead.)
  float plated = uGrainKind > 3.5 ? smoothstep(0.35, 0.65, cover) : 0.0;
  if (uForm.x > 0.0 && d < uForm.x * 3.0 && plated < 1.0) {
    vec3 q = bodyAt(p) / uForm.y + uPatSeed;
    float crease = 1.0 - abs(noise3(q * 1.7 + 9.0) * 2.0 - 1.0);
    d -= uForm.x * (noise3(q) * 1.5 - 0.75 + crease * crease * 0.7 - 0.2) * mix(0.25, 1.0, smoothstep(0.3, 0.8, thick / uForm.y)) * smoothstep(0.0, uForm.x * 2.0, c) * (1.0 - plated);
  }
  if (uGrainKind > 3.5) {
    if (plated > 0.0) d -= plated * brim(p);
    if (gFade > 0.0 && d < uGrain) d -= gFade * smoothstep(1.0, 0.4, d / uGrain) * smoothstep(0.0, uGrain * 0.3, c) * (plated > 0.0 ? mix(hide(p), plateRelief(p) * 0.5 * uGrain, plated) : hide(p));
    return min(d, c);
  }
  // (Spines stand their full height, up to a sharp point, so they stop only well clear of it.)
  if (uGrainKind > 2.5) {
    float tall = uGrain * uGrainRise;
    gLift = max(d, 0.0);
    if (gFade > 0.0 && cover > 0.0 && d < tall * 2.0) { float s = spines(p, gLift); d -= tall * gReach * gFade * smoothstep(0.45, 0.8, cover) * smoothstep(0.0, uGrain * 1.2, c) * s * smoothstep(2.0, 1.2, d / tall); }
    return min(d, c);
  }
  // (A pelt, as far off the surface as its longest hair, none of it about a crisp part.)
  if (uFlowN > 0) {
    if (d < uGrain * uGrainRise * 3.2) d -= peltRise(p, bareAt(p, bare), cover) * smoothstep(0.0, uGrain * 0.8, c);
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
// An eye, painted onto whatever surface lies over its lens, so no head's shape can bury it or leave
// it standing proud: a black line round it, the iris lit from below, where light pooled through the
// cornea comes out, with fibres to the pupil and a dark ring at its edge, the upper lid's shadow over
// it, the pupil and its spark, then the lid cutting across the top. Alpha 0 is off the eye.
vec4 eyePaint(vec3 p, vec4 a, vec4 b, vec4 u, vec3 col) {
  vec3 centre = (a.xyz + b.xyz) * 0.5, axis = b.xyz - a.xyz;
  float along = length(axis);
  vec3 n = normalize(u.xyz);
  // (A lens drawn as a ball lies no way of its own: it lies level with the body.)
  axis = along > 1e-6 ? axis / along : normalize(cross(n, uUp) + uSide * 1e-3);
  vec3 up = cross(axis, n), v = p - centre;
  float r = a.w, x = dot(v, axis) / r, y = dot(v, up) / r;
  float rr = length(vec2(max(abs(x) - along * 0.5 / r, 0.0), y));
  if (rr > 1.0 + 0.1 * uEyeLid.w || abs(dot(v, n)) > r * 1.6 + uForm.x * 2.0) return vec4(0.0);
  vec3 e = bodyAt(centre);
  float outer = sign(dot(axis, uSide * (e.x < 0.0 ? -1.0 : 1.0) - uFwd * 0.8));
  float lid = mix(1.15, 0.15, uEyeLid.x) + uEyeLid.y * x * outer;
  if (y > lid + 0.2) return rr > 1.0 ? vec4(0.0) : vec4(uEyeLidCol, 1.0);
  if (y > lid || rr > 1.0) return vec4(uEyeLidCol * 0.05, 1.0);
  col *= (1.0 + 0.16 * sin(atan(y, x) * 17.0) * smoothstep(0.2, 0.5, rr)) * mix(1.3, 0.8, smoothstep(0.0, 0.9, rr)) * (1.0 + 0.9 * smoothstep(0.1, -0.75, y));
  col *= (1.0 - 0.8 * smoothstep(0.68, 0.98, rr)) * (1.0 - 0.6 * smoothstep(lid - 0.75, lid, y));
  float kind = uEyeLid.z;
  float pupil = kind < 0.5 ? length(vec2(x, y)) / 0.5 : kind < 1.5 ? length(vec2(x / 0.16, y / 0.66)) : kind < 2.5 ? length(vec2(x / 0.58, y / 0.2)) : length(vec2(x, y)) / 0.68;
  col = mix(vec3(0.008), col, smoothstep(0.92, 1.05, pupil));
  return vec4(mix(col, vec3(1.0), 1.0 - smoothstep(uEyeSpark - 0.03, uEyeSpark + 0.02, length(vec2(x + 0.22, y - 0.36)))), 1.0);
}
// The colour, melted by the same weights, then the decals under the pattern,
// the pattern, a carve's cut, the decals on it, then crisp parts over all: once a pixel.
vec3 paint(vec3 p, out float lit, out float soft) {
  float d = 1e9, c = 1e9, h, w = 0.0, cl = 0.0, dl = 0.0, wu = 0.0, ul = 0.0, cut = 1e9, vl = 0.0, deep = 1e-6, ck = 1e-6, cover = 0.0;
  vec3 col = vec3(0.0), cc = vec3(0.0), dc = vec3(0.0), uc = vec3(0.0), vc = vec3(0.0); lit = 0.0;
  bool furred = false;
  float eyeD = 1e9, eyeL = 0.0, bare = 1e9, skin = 0.0;
  vec3 iris = vec3(0.0);
  vec4 eyeA = vec4(0.0), eyeB = vec4(0.0), eyeU = vec4(0.0);
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    float tag = uB[i].w, di = part(p, i);
    if (tag >= 4095.5) { if (di < bare) { bare = di; gBareCol = uPal[int(mod(tag, 16.0) + 0.5)]; } continue; }
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
    if (m < 0.5) {
      if (abs(float(role) - uEyeRole) < 0.5 && di < eyeD) { eyeD = di; eyeA = uA[i]; eyeB = uB[i]; eyeU = uU[i]; iris = uPal[role]; eyeL = uLit[role]; }
      if (di < c) { c = di; cc = uPal[role]; cl = uLit[role]; }
      continue;
    }
    di = hull(p, di, float(role));
    d = melt(i, m * 0.0625, d, di, h);
    col = mix(col, uPal[role], h); lit = mix(lit, uLit[role], h);
    cover = mix(cover, grows(float(role)), h);
    skin = mix(skin, abs(float(role) - uSkinRole) < 0.5 ? 1.0 : 0.0, h);
  }
  gCover = cover; gLift = max(d, 0.0); gSkin = skin; gBare = bareAt(p, bare); gEyeD = eyeD; gMark = w;
  col = mix(col, uc, wu); lit = mix(lit, ul, wu);
  // (Bare skin is not coat: no pattern lands on it.)
  col = mix(col, patternColor(p), pattern(p) * uPattern.z * (1.0 - skin));
  // (A coat is never one shade: it drifts paler and darker over the body, each animal's its own way.)
  if (uPattern.x > 0.5) col *= 1.0 + (fbm(bodyAt(p) / (uPattern.y * 7.0) + uPatSeed) - 0.5) * uPatGene.w;
  // (The cut shows its own colour as deep as it goes, what lies beneath toward its rim.)
  float cv = cut < 1e8 ? smoothstep(0.0, deep, -d) : 0.0;
  col = mix(col, vc, cv); lit = mix(lit, vl, cv);
  col = mix(col, dc, w); lit = mix(lit, dl, w);
  // (A crisp part set in a cut, an eye in a dished face, shows over the cut surface, not the one it cut.)
  if (cut < 1e8) { h = clamp(0.5 - 0.5 * (d + cut) / ck, 0.0, 1.0); d = mix(d, -cut, h) + ck * h * (1.0 - h); }
  soft = 1.0;
  if (c < d) { col = cc; lit = cl; soft = 0.0; }
  if (eyeD < eyeA.w * 2.0 + uForm.x * 2.0) {
    vec4 eye = eyePaint(p, eyeA, eyeB, eyeU, iris);
    if (eye.a > 0.5) { col = eye.rgb; lit = eyeL; soft = 0.0; gSkin = 1.0; }
  }
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
  // (A plate dark in its narrow seam and faintly along each growth ring, hide dark down its creases, each scale a shade its own.)
  if (uGrainKind > 3.5) {
    plateAt(p);
    float plate = mix(0.14, 1.0, smoothstep(0.004, 0.026, gSeam)) * (1.0 - 0.06 * smoothstep(0.72, 1.0, abs(2.0 * fract(min(gRing, 1.0) * PLATE_YEARS) - 1.0)));
    hide(p);
    float scale = smoothstep(uGrain * 0.24, uGrain * 0.4, gScale);
    return mix(mix(mix(0.84, 0.5, scale), 1.0, smoothstep(0.0, 0.16, gSeam)) * (0.96 + 0.08 * gPlate), plate, gCover);
  }
  float g = grain(p);
  if (uGrainKind < 2.5) return 0.8 + 0.3 * g;
  // (A pale coat's bands are faint, a dark one's deep.)
  return 1.0 - mix(0.38, 0.15, smoothstep(0.1, 0.5, dot(base, vec3(0.2126, 0.7152, 0.0722)))) * smoothstep(0.3, 0.55, g) * (1.0 - smoothstep(0.62, 0.74, g));
}
// Hide's three values: its own, its pale where it turns under, dark in the shade of a shell's rim;
// and over them the marks its plates wear, the same cells grown large, as far as they run on this animal.
vec3 hideTone(vec3 p, vec3 base, vec3 n, float soft) {
  if (uPattern.x > 10.5 && soft > 0.5) {
    base = mix(base, uPatTwo, smoothstep(0.12, -0.5, dot(n, uUp)));
    scaleCells(bodyAt(p) / (uGrain * 1.6) + uPatSeed);
    base *= 1.0 - 0.56 * uPattern.w * plateMarks(0.0) * step(0.52, gPlate);
  }
  vec3 v = crownAt(p);
  float under = rimRise(v) - uDome.y * 0.1 - v.y;
  return base * mix(1.0, 0.2, (1.0 - smoothstep(0.0, uDome.y * 0.17, under)) * (1.0 - smoothstep(0.86, 1.06, length(v.xz / uDome.xz))));
}
// A pelt's colour at p: each hair's pigment along it, root to tip, each lock a shade its own and
// warmer or cooler, darker toward the coat's long side and paler away from it, with the skin showing
// where the hair has thinned to nothing. (A rule of colour alone, so it needs no light to read.)
vec3 peltTone(vec3 p, vec3 base) {
  flowAt(p);
  float locks = 0.0;
  gS = 0.55; gX = 0.0; gId = 0.5;
  if (gFade > 0.0) locks = coatAt(p, max(gBare, 1.0 - gCover));
  float side = smoothstep(-0.1, 0.8, gSide), under = smoothstep(0.0, -0.75, gSide);
  vec3 hair = mix(mix(base, uPeltBack, side * uPeltCast.x), uPeltFront, under * uPeltCast.y);
  // (Each strand in a lock ends a little before or after the next, so its tips make a fringe, not a line.)
  float strand = floor(gX * 3.0 + 3.0), hairId = fract(gId * 17.0 + strand * 0.37);
  float s = mix(0.5, gS + (hairId - 0.5) * 0.34, gFade), lock = gId * 2.0 - 1.0;
  // (Banded along the hair, as an agouti's is: a dusky root, the hair's own colour, the band, then its tip.)
  vec3 tone = mix(hair, hair * uPeltRoot, (1.0 - smoothstep(0.0, 0.42, s)) * uPelt.z);
  float tipFrom = 1.0 - uPeltLine.y, band = smoothstep(tipFrom - 0.26, tipFrom - 0.1, s) * (1.0 - smoothstep(tipFrom - 0.02, tipFrom + 0.08, s));
  tone = mix(tone, uPeltBand, band * uPeltLine.x * (0.55 + 0.45 * fract(gId * 9.7)) * gFade);
  tone = mix(tone, mix(hair, uPeltTip, 0.66), smoothstep(tipFrom, tipFrom + 0.18, s) * (0.55 + 0.45 * fract(gId * 5.3)) * gFade);
  tone *= 1.0 + (lock * uPelt.w * 0.5 + (hairId - 0.5) * uPelt.w * 1.4) * gFade;
  tone = mix(tone, tone * vec3(1.06, 1.0, 0.92), max(lock, 0.0) * uPelt.w * 2.0 * gFade);
  tone = mix(tone, tone * vec3(0.93, 0.98, 1.08), max(-lock, 0.0) * uPelt.w * 2.0 * gFade);
  // (Between the locks is undercoat, soft and a shade duller, never a dark gap.)
  tone = mix(mix(hair, hair * uPeltRoot, 0.5 * uPelt.z), tone, mix(1.0, smoothstep(0.02, 0.2, locks), gFade));
  // (Where the skin goes bare only the hairs still grown cover it, and over a part that wears no coat there are none.)
  // (A mark painted on it, a mouth or a nostril, stays over all of that.)
  float hairs = smoothstep(0.02, 0.16, locks) * gFade, naked = gBare * (1.0 - hairs) * (1.0 - gMark);
  gSkin = max(gSkin, naked);
  return mix(mix(base, tone, mix(hairs, 1.0, gCover * gCover) * (1.0 - gMark)), gBareCol, naked);
}
// Skin under its own colour: paler and thinner round an eye, the blood wandering through the rest.
vec3 skinTone(vec3 p, vec3 base) {
  float blood = (fbm(p / (uGrain * 1.4) + uPatSeed) - 0.5) * uSkin.y;
  return mix(base, mix(base, uSkinPale, 1.0 - smoothstep(uGrain * 0.3, uGrain * 1.3, gEyeD)) * (uSkin.z + blood), gSkin);
}
// Skin's chroma held on a soft knee, so no light and no later grade can push it to neon: a colour
// well inside the knee stays as it is, and a stronger one comes out little stronger.
// (Its hue is its own in any light, so a blue shadow on red skin never turns it magenta.)
// (And a shade warmer than it was painted: what comes back out of skin has lost its blue to the blood.)
vec3 skinGrade(vec3 col, vec3 base) {
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 warm = base * vec3(1.0, 1.0, 0.72);
  vec3 own = warm * luma / max(dot(warm, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  vec3 c = mix(col, own, 0.8) - luma;
  float m = length(c) / max(luma, 1e-4);
  return mix(col, luma + c * (uSkin.x * (1.0 - exp(-m / uSkin.x))) / max(m, 1e-4), gSkin);
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
  bool spiny = uGrainKind > 2.5 && uGrainKind < 3.5 && gFade > 0.0;
  bool plated = uGrainKind > 3.5 && gFade > 0.0;
  // (A pelt's locks are steeper still than its grain, at their edges.)
  bool pelted = uFlowN > 0 && gFade > 0.0;
  float stride = gFade > 0.0 ? (spiny || plated ? 0.5 : pelted ? 0.6 : 0.72) : 1.0;
  int steps = spiny || plated || pelted ? 120 : 68;
  bool hit = false;
  // (Plain steps: over-relaxed ones jump a flat ear edge-on.)
  for (int s = 0; s < 120; s++) {
    if (s >= steps) break;
    d = dist(ro + rd * t);
    if (d < max(eps, px * t * 0.35)) { hit = true; break; }
    float gap = d / max(t, eps);
    if (gap < near) { near = gap; nearT = t; }
    // (Never under half a pixel: a ray grazing one part must still reach what lies behind it, not spend its steps there.)
    t += max(d * stride, px * t * 0.5);
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
    // (Hide has a grain of its own, under a plate's: it shows where the plates stop.)
    bool coated = uFlowN > 0 && soft > 0.5;
    if (coated) base = peltTone(p, base);
    else {
      base = mix(base, gBareCol, gBare * soft);
      if (gFade > 0.0) base *= mix(1.0, grainShade(p, base), gFade * soft * (plated ? 1.0 : gCover));
    }
    if (uSkinRole > -0.5 && soft > 0.5) base = skinTone(p, base);
    vec3 n = normalAt(p, eps * 1.5), form = n;
    // (A coat takes the light as the form under it, with only some of each lock's own relief: a
    // lock's steep edge turned to the sky is what would show as a bright sliver.)
    if (coated) { gLocks = 0.0; form = normalAt(p, eps * 4.0); n = normalize(mix(form, n, 0.3 * gCover + 1.0 - gCover)); }
    if (uGrainKind > 3.5 && (gCover < 0.5 || soft < 0.5)) base = hideTone(p, base, n, soft);
    // A little occlusion where parts meet (a leg against a belly), straight from the field.
    float reach = scale * 0.05;
    float ao = clamp(0.5 + 0.5 * dist(p + n * reach) / reach, 0.4, 1.0);
    // (Skin is creased: the fold under a brow, round a lip, shadowed by what stands over it.)
    if (gSkin > 0.0) { float fold = uGrain * 0.5; ao *= mix(1.0, clamp(0.45 + 0.55 * dist(p + form * fold) / fold, 0.55, 1.0), gSkin); }
    gLocks = 1.0;
    // (A stand of spines takes the light as the dome under it, one form and no pits, with only part of each spine's own facets.)
    float shade = 0.0;
    if (spiny) { float dome = gCover * soft; vec3 v = normalize(crownAt(p)); n = normalize(mix(n, uSide * v.x + uUp * v.y + uFwd * v.z, dome * 0.4)); ao = mix(ao, 1.0, dome * 0.6); shade = dome * SPINE_FLOOR * smoothstep(-0.45, 0.1, v.y); }
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    float facing = max(dot(n, -rd), 0.0);
    float rim = pow(1.0 - max(dot(form, -rd), 0.0), 3.0) * (1.0 - 0.85 * gSkin);
    // Light as keel/lit's LitMaterial takes it (colour x intensity, Lambert over pi), the sun wrapped a little.
    vec3 light = hemi * ao + uSunCol * max(dot(n, uSun) * 0.8 + 0.2, 0.0) + uFillCol * max(dot(n, uFill), 0.0);
    light = max(light * INV_PI, vec3(shade)) + uRimCol * rim * max(dot(n, uRim), 0.0) * INV_PI * 2.0;
    // The character light from the camera, wrapped so it rounds the body instead of flattening it.
    light += uFront * INV_PI * max(facing * 0.75 + 0.25 * n.y, 0.0);
    // (Light that has wandered through skin comes back out where the sun is not, so its shadows stay shallow.)
    light += gSkin * (uSky + uSunCol * 0.25) * INV_PI * 0.3;
    // A soft sheen along the sun, so fur and feathers turn with the light.
    vec3 halfway = normalize(uSun - rd);
    light += uSunCol * INV_PI * 0.12 * pow(max(dot(n, halfway), 0.0), 18.0) * (1.0 - gSkin);
    // A sky-lit edge lifts the body off the ground behind it.
    light += uSky * INV_PI * 0.6 * rim;
    light += coatLight(n, rd, halfway, rim) * soft * (1.0 - gSkin);
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
    if (uSkinRole > -0.5) col = skinGrade(col, base);
    float peak = max(max(col.r, col.g), col.b);
    if (peak > 0.75) col *= (0.75 + 0.25 * (1.0 - exp(-(peak - 0.75) * 4.0))) / peak;
    gl_FragColor = vec4(col, 1.0);
  }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4((p - uCenter) / uSize, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Most bones a pelt grows from (the shader's array). */
const FLOWS = 12;
const fragment = (maxParts: number, roles: number): string => `#define MAXP ${String(maxParts)}\n#define ROLES ${String(roles)}\n#define FLOWS ${String(FLOWS)}\n${FIELD}\n${MARCH}`;

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
    uGrain: { value: 0 }, uGrainKind: { value: 0 }, uGrainRise: { value: 1 }, uGrainOn: { value: -1 }, uCrown: { value: new lit.Vector4(0, 0, 0, 0) }, uDome: { value: new lit.Vector3(1, 1, 1) }, uDomeGene: { value: new lit.Vector3(1, 0, 0) }, uScale: { value: Array.from({ length: 3 }, () => new lit.Vector4()) }, uScaleSize: { value: new lit.Vector3(1, 1, 1) }, uAft: { value: new lit.Vector3(0, 0, -1) },
    uOrigin: { value: new lit.Vector3(0, 0, 0) }, uSide: { value: new lit.Vector3(1, 0, 0) }, uUp: { value: new lit.Vector3(0, 1, 0) }, uFwd: { value: new lit.Vector3(0, 0, 1) },
    uMat: { value: new lit.Vector4(0, 0, 0, 0) }, uLift: { value: 1 }, uNeutral: { value: 0 }, uPattern: { value: new lit.Vector4(0, 1, 0, 0) }, uForm: { value: new lit.Vector3(0, 1, 0) }, uEyeRole: { value: -1 }, uEyeLid: { value: new lit.Vector4(0, 0, 0, 1) }, uEyeLidCol: { value: new lit.Color("#000000") }, uEyeSpark: { value: 0.2 }, uPatSeed: { value: new lit.Vector3(0, 0, 0) }, uPatGene: { value: new lit.Vector4(1, 1, 0, 0) }, uPatCol: { value: new lit.Color("#000000") }, uPatTwo: { value: new lit.Color("#000000") }, uTrunk: { value: new lit.Vector3(0, 0, 0) }, uDorsal: { value: 1e6 },
    uFlowN: { value: 0 }, uFlowA: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowB: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowU: { value: Array.from({ length: FLOWS }, () => new lit.Vector4()) }, uFlowFall: { value: new Array<number>(FLOWS).fill(0) },
    uPelt: { value: new lit.Vector4(0.4, 0, 0, 0) }, uPeltCast: { value: new lit.Vector3(0, 0, 0) }, uPeltLine: { value: new lit.Vector3(0, 0, 0) },
    uPeltRoot: { value: new lit.Color("#000000") }, uPeltBand: { value: new lit.Color("#000000") }, uPeltTip: { value: new lit.Color("#000000") }, uPeltBack: { value: new lit.Color("#000000") }, uPeltFront: { value: new lit.Color("#000000") },
    uSkinRole: { value: -1 }, uSkin: { value: new lit.Vector3(1, 0, 0) }, uSkinPale: { value: new lit.Color("#000000") },
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

/** The tag a part carries to the shader: its role, its melt in 16ths (0 crisp), 1024 for a decal and 2048 more for one under the pattern, or 4096 more for one that is bare skin, 2048 alone for a carve. */
export function tagOf(role: number, crisp: boolean, part: Pick<BodyPart, "melt" | "decal" | "under" | "carve" | "bare">): number {
  // (A carve is never crisp: its melt is how soft its rim is.)
  const melt = crisp && part.carve !== true ? 0 : Math.round(Math.max(0, Math.min(2, part.melt ?? 1)) * 16);
  if (part.carve === true) return role + 16 * Math.max(1, melt) + 2048;
  return role + 16 * melt + (part.decal === true ? (part.bare === true ? 5120 : part.under === true ? 3072 : 1024) : 0);
}

function writePart(part: BodyPart, a: Vector4Like, b: Vector4Like, u: Vector4Like, tag: number): void {
  const flat = Math.max(0.05, Math.min(1, part.flat ?? 1));
  // (A round part has no thin axis to find. The axis is stored scaled by the flatness.)
  const thin = flat < 0.999 ? thinAxis(part) : UP;
  const f = flat < 0.999 ? flat : 1;
  const bow = bowOf(part);
  a.set(part.a[0], part.a[1], part.a[2], part.r);
  b.set(part.b[0], part.b[1], part.b[2], tag);
  if (part.row !== undefined) { u.set(...(part.reach ?? part.bow ?? [0, 0, 0]), rowTag(part)); return; }
  u.set(bow ? bow[0] : thin[0] * f, bow ? bow[1] : thin[1] * f, bow ? bow[2] : thin[2] * f, Math.max(0, part.r1 ?? part.r));
}

/** A row's count as the shader takes it, under nought, its fraction saying what kind of row. */
const rowTag = (part: BodyPart): number => -Math.max(2, part.row ?? 2) - (part.sharp ? 0.5 : part.reach ? 0.25 : 0);

/** A part's bow as the shader takes it: its way, 2 plus its size long. */
function bowOf(part: BodyPart): Vec | null {
  const size = part.bow ? Math.hypot(part.bow[0], part.bow[1], part.bow[2]) : 0;
  return part.bow && size > 1e-9 ? times(part.bow, (2 + size) / size) : null;
}

function fill(slot: Slot, body: BodyInput, state: ShaderState, maxParts: number, roles: number, blend: number, ink: Ink): void {
  const parts = fitParts(body.capsules, maxParts);
  const count = Math.min(parts.length, maxParts);
  // (The grain stands off the surface: the box leaves it room.)
  const { min, max, k } = boundsOf(parts, count, blend, ink.pad + standOff(body));
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
const GRAIN_KINDS: Readonly<Record<Grain["kind"], number>> = { fur: 0, feather: 1, scale: 2, spine: 3, plate: 4 };
const grainOf = (body: BodyInput): Grain => (body.grain && body.grain.size > 0 ? body.grain : SMOOTH);
/** How far the surface stands off its parts: its grain and its relief. */
const standOff = (body: BodyInput): number => grainReach(grainOf(body)) + (body.form?.amount ?? 0);
/** How far a grain stands off the surface: a spine its whole height, a shell's plates and its brim. */
const grainReach = (grain: Grain): number => grain.size * (grain.kind === "spine" ? 1.1 : 0.4) * (grain.rise ?? 1) + (grain.dome?.[1] ?? 0) * 0.12 + grain.size * (grain.rise ?? 1) * peltLong(grain);
/** A pelt's longest hair, in grain sizes. */
const peltLong = (grain: Grain): number => (grain.pelt?.flow ?? []).reduce((most, bone) => Math.max(most, ...bone.long), 0);

/** How each grain takes the light when the body names no material of its own: fur soft and fuzzy, feathers and scales glossy. */
const MATERIALS: Readonly<Record<Grain["kind"], Required<Material>>> = {
  fur: { sheen: 0.6, fuzz: 0.45, gloss: 0, iridescence: 0, lift: 1, neutral: 0 },
  feather: { sheen: 0.15, fuzz: 0.1, gloss: 0.35, iridescence: 0, lift: 1, neutral: 0 },
  scale: { sheen: 0, fuzz: 0, gloss: 0.7, iridescence: 0, lift: 1, neutral: 0 },
  spine: { sheen: 0, fuzz: 0.1, gloss: 0.3, iridescence: 0, lift: 1, neutral: 0.3 },
  plate: { sheen: 0, fuzz: 0, gloss: 0.3, iridescence: 0, lift: 1, neutral: 0 },
};
const PATTERN_KINDS: Readonly<Record<Pattern["kind"], number>> = { dapple: 1, spots: 2, stripes: 3, streaks: 4, bars: 5, chevrons: 6, mackerel: 7, patches: 8, grizzle: 9, tips: 10, scutes: 11 };

interface Vector4Set { set(x: number, y: number, z: number, w: number): unknown }

/** The point a grain is set about, and the dome a plated one lies on. */
function crownSlot(slot: Slot, grain: Grain): void {
  (slot.u.uCrown?.value as Vector4Set).set(...(grain.crown ?? [0, 0, 0]), grain.crown ? 1 : 0);
  (slot.u.uDome?.value as Vector3Like).set(...(grain.dome ?? [1, 1, 1]));
  const tilt = grain.tilt ?? 0;
  (slot.u.uDomeGene?.value as Vector3Like).set(Math.cos(tilt), Math.sin(tilt), grain.teeth ?? 0);
  scaleSlot(slot, grain.scales ?? []);
}

/** Where a plated animal's hide wears scales of their own. */
function scaleSlot(slot: Slot, scales: readonly ScalePatch[]): void {
  const at = slot.u.uScale?.value as Vector4Set[];
  at.forEach((each, i) => { const patch = scales[i]; each.set(...(patch?.at ?? [0, 0, 0]), patch?.reach ?? 0); });
  (slot.u.uScaleSize?.value as Vector3Like).set(scales[0]?.size ?? 1, scales[1]?.size ?? 1, scales[2]?.size ?? 1);
}

/** The body's frame (its grain and pattern ride on it), its grain, its material and its pattern. */
function grainSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const grain = grainOf(body);
  (slot.u.uGrain as UniformLike<number>).value = grain.size;
  (slot.u.uGrainKind as UniformLike<number>).value = GRAIN_KINDS[grain.kind];
  (slot.u.uGrainRise as UniformLike<number>).value = grain.rise ?? 1;
  (slot.u.uGrainOn as UniformLike<number>).value = grain.on === undefined ? -1 : roleIndex(state, grain.on, roles);
  crownSlot(slot, grain);
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
  skinSlot(slot, body, state, roles);
}

/** What lies over the coat's own light: the eyes' lids and the body's relief. */
function skinSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  eyeSlot(slot, body, state, roles);
  (slot.u.uForm?.value as Vector3Like).set(body.form?.amount ?? 0, Math.max(body.form?.size ?? 1, 1e-4), 0);
  peltSlot(slot, grainOf(body).pelt);
  bareSlot(slot, body, state, roles);
}

/** How this body's bare skin takes the light. */
function bareSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const { skin } = body;
  (slot.u.uSkinRole as UniformLike<number>).value = skin ? roleIndex(state, skin.role, roles) : -1;
  if (!skin) return;
  (slot.u.uSkin?.value as Vector3Like).set(skin.chroma, skin.flush ?? 0, skin.depth ?? 1);
  (slot.u.uSkinPale?.value as ColorLike).set(skin.pale ?? body.palette[skin.role] ?? "#000000");
}

/** The bones a pelt grows from, each square to its own long side. */
function flowSlot(slot: Slot, flow: readonly PeltBone[]): void {
  const A = slot.u.uFlowA?.value as Vector4Like[];
  const B = slot.u.uFlowB?.value as Vector4Like[];
  const U = slot.u.uFlowU?.value as Vector4Like[];
  const fall = slot.u.uFlowFall?.value as number[];
  const count = Math.min(flow.length, FLOWS);
  for (let i = 0; i < count; i += 1) {
    const bone = flow[i];
    if (!bone) continue;
    const along = unitOr(sub(bone.b, bone.a), [0, 0, 1]);
    const up = unitOr(sub(bone.up, times(along, dot(along, bone.up))), [0, 1, 0]);
    A[i]?.set(...bone.a, bone.long[0]);
    B[i]?.set(...bone.b, bone.long[1]);
    U[i]?.set(...up, bone.girth);
    fall[i] = bone.fall ?? 0;
  }
  (slot.u.uFlowN as UniformLike<number>).value = count;
}

/** A pelt's plain defaults: a soft undercoat, its hair one colour root to tip. */
const PELT: Required<Omit<Pelt, "flow">> = { under: 0.45, thin: 0, crease: 0.2, tint: 0, root: "#000000", band: ["#000000", 0], tip: ["#ffffff", 0], back: "#000000", front: "#ffffff", dorsal: 0, ventral: 0 };

/** What a pelt grows from and the colours along its hair. */
function peltSlot(slot: Slot, pelt: Pelt | undefined): void {
  if (!pelt) { (slot.u.uFlowN as UniformLike<number>).value = 0; return; }
  flowSlot(slot, pelt.flow);
  const { under, thin, crease, tint, root, band, tip, back, front, dorsal, ventral } = { ...PELT, ...pelt };
  const color = (name: string, hex: string): void => { (slot.u[name]?.value as ColorLike).set(hex); };
  (slot.u.uPelt?.value as Vector4Set).set(under, thin, crease, tint);
  (slot.u.uPeltCast?.value as Vector3Like).set(dorsal, ventral, 0);
  (slot.u.uPeltLine?.value as Vector3Like).set(band[1], tip[1], 0);
  color("uPeltRoot", root);
  color("uPeltBand", band[0]);
  color("uPeltTip", tip[0]);
  color("uPeltBack", back);
  color("uPeltFront", front);
}

const EYE_PUPILS: Readonly<Record<Eye["pupil"], number>> = { round: 0, slit: 1, bar: 2, dark: 3 };

/** The eyes' lids, and the role whose lens they are painted on. */
function eyeSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const eye = body.eye;
  (slot.u.uEyeRole as UniformLike<number>).value = eye ? roleIndex(state, eye.role, roles) : -1;
  if (!eye) return;
  (slot.u.uEyeLid?.value as Vector4Set).set(eye.lid, eye.slant, EYE_PUPILS[eye.pupil], eye.ring ? 1 : 0);
  (slot.u.uEyeLidCol?.value as ColorLike).set(eye.color);
  (slot.u.uEyeSpark as UniformLike<number>).value = eye.spark ?? 0.2;
}

/** The pattern over the coat, in its own colour or its role's; none when it has no contrast. */
function patternSlot(slot: Slot, body: BodyInput, state: ShaderState, roles: number): void {
  const pattern = body.pattern;
  if (!pattern || pattern.contrast <= 0) { (slot.u.uPattern?.value as Vector4Set).set(0, 1, 0, 0); return; }
  roleIndex(state, pattern.role, roles);
  (slot.u.uPattern?.value as Vector4Set).set(PATTERN_KINDS[pattern.kind], Math.max(pattern.scale, 1e-4), Math.min(1, pattern.contrast), pattern.run ?? 0);
  geneSlot(slot, pattern);
  (slot.u.uPatCol?.value as ColorLike).set(pattern.color ?? body.palette[pattern.role] ?? "#000000");
  (slot.u.uPatTwo?.value as ColorLike).set(pattern.second ?? "#000000");
  trunkSlot(slot, pattern);
}

/** Where in the noise this animal's coat grew, and how its marks grow there. */
function geneSlot(slot: Slot, pattern: Pattern): void {
  const at = (k: number): number => ((Math.imul(pattern.seed >>> 0, k) >>> 0) % 4093) * 0.0731;
  (slot.u.uPatSeed?.value as Vector3Like).set(at(2654435761), at(1597334677), at(3812015801));
  const [warp, stretch, density, drift] = pattern.genes ?? [1, 1, 0, 0];
  (slot.u.uPatGene?.value as Vector4Set).set(warp, Math.max(stretch, 0.05), density, drift);
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

/** How far apart a part's shadow spheres sit, in its radii; the most a part takes; and the smallest part that casts, against the body's largest. */
const SHADOW_STEP = 1.25;
const SHADOW_MOST = 12;
const SHADOW_LEAST = 0.05;
/** The pool's spheres a part, on average, so a full scene's last bodies keep their shadows. */
const SHADOW_POOL = 5;

/** Shadows: each part as a few plain spheres that only the shadow pass sees. */
function shadowProxy(lit: LitLike, limit: number): { mesh: InstancedLike; matrix: Matrix4Like; geometry: DisposableLike; material: MaterialLike } {
  const geometry = lit.sphere(1, 12, 8);
  const material = new lit.FlatMaterial({ colorWrite: false, depthWrite: false });
  const mesh = new lit.Instances(geometry, material, limit);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, matrix: new lit.Matrix4(), geometry, material };
}

/** The spheres a part casts its shadow with: enough to run its length without gaps, each its own width along a taper. */
function castsAlong(part: BodyPart): number {
  const length = Math.hypot(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]);
  return Math.min(Math.ceil(length / (Math.max(meanRadius(part), 1e-5) * SHADOW_STEP)) + 1, SHADOW_MOST);
}

function castShadows(proxy: ReturnType<typeof shadowProxy>, bodies: readonly BodyInput[], limit: number): void {
  let n = 0;
  for (const body of bodies) {
    // (Parts too small to show in a shadow, an eye, a claw, are left out of it: most of the cost and none of the look.)
    const least = Math.max(...body.capsules.map(meanRadius), 0) * SHADOW_LEAST;
    for (const part of body.capsules) {
      if (!casts(part) || meanRadius(part) < least) continue;
      const squash = (part.flat ?? 1) < 1 ? 0.6 : 1;
      const steps = castsAlong(part);
      for (let s = 0; s < steps && n < limit; s += 1) {
        const k = steps === 1 ? 0 : s / (steps - 1);
        const r = (part.r + ((part.r1 ?? part.r) - part.r) * k) * squash;
        proxy.matrix.makeScale(r, r, r).setPosition(part.a[0] + (part.b[0] - part.a[0]) * k, part.a[1] + (part.b[1] - part.a[1]) * k, part.a[2] + (part.b[2] - part.a[2]) * k);
        proxy.mesh.setMatrixAt(n, proxy.matrix);
        n += 1;
      }
    }
  }
  proxy.mesh.count = n;
  proxy.mesh.instanceMatrix.needsUpdate = true;
}

/** The most parts a body can have, and the uniform vectors the shader spends on all else (measured from a linked program). */
export const MOST_PARTS = 64;
export const OTHER_UNIFORMS = 154;

/** The parts a device's fragment uniform vectors can hold: each costs three. */
export const partsFor = (uniforms: number): number => Math.min(MOST_PARTS, Math.floor((uniforms - OTHER_UNIFORMS) / 3));

/** A body's parts cut to `most`, dropping whole `detail` groups from the highest down, so a left paw never keeps claws a right one lost. */
export function fitParts<T extends { readonly detail?: number }>(parts: readonly T[], most: number): readonly T[] {
  let kept = parts;
  while (kept.length > most) {
    const top = kept.reduce((high, part) => Math.max(high, part.detail ?? 0), 0);
    if (top === 0) break;
    kept = kept.filter((part) => (part.detail ?? 0) !== top);
  }
  return kept;
}

/** A pool of smooth raymarched bodies, drawn from capsule parts each frame. */
export function createSdfBodies(lit: LitLike, options: SdfBodiesOptions = {}): SdfBodies {
  const maxParts = Math.max(4, Math.min(MOST_PARTS, options.maxParts ?? 48));
  const maxBodies = Math.max(1, options.maxBodies ?? 48);
  const roles = 16;
  const blend = options.blend ?? 0.46;
  const width = Math.max(0, options.ink ?? 0.85);
  const ink: Ink = { width, pad: width > 0 ? Math.max(0, options.inkPad ?? 0.08) : 0 };
  const shader = fragment(maxParts, roles);
  const geometry = lit.box(1, 1, 1);
  const group = new lit.Group();
  const state: ShaderState = { roles: new Map(), crisp: new Set(options.crisp ?? DEFAULT_CRISP), emissive: new Set(options.emissive ?? DEFAULT_EMISSIVE) };
  const slots: Slot[] = [];
  const proxy = options.shadows === true ? shadowProxy(lit, maxBodies * maxParts * SHADOW_POOL) : null;
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
      if (proxy) castShadows(proxy, bodies.slice(0, maxBodies), maxBodies * maxParts * SHADOW_POOL);
    },
    dispose() {
      for (const slot of slots) slot.material.dispose();
      geometry.dispose();
      proxy?.geometry.dispose();
      proxy?.material.dispose();
    },
  };
}


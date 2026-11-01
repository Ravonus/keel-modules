// What a body is, as given: its parts, skin, form, eyes, materials, patterns, grain, pelt and light.

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
  /** How much of it is there, 0 to 1: under 1 it dissolves through an ordered dither, a pixel at a time, never see-through. */
  readonly fade?: number;
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
  /** Long display feathers, each painted from its own part; without it they are their role's plain colour. */
  readonly vane?: Vane;
}

/**
 * A display feather, painted on each part of `role` from that part's own
 * length and width: a pale shaft down it, barbs slanting off the shaft either
 * side, the edges darkening where the next feather shows past it, and near
 * its end an eye: a `heart` in a `ring`, a band of `gold`, fading into the vane.
 */
export interface Vane {
  readonly role: string;
  readonly heart: string;
  readonly ring: string;
  readonly gold: string;
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
  /**
   * A person's eye and not an animal's: an almond of this white, its iris
   * round and small in it, a pupil, a lash line along the upper lid. Draw its
   * lens drawn out across the face, sunk just under the skin.
   */
  readonly white?: string;
  /** Where a white eye's iris has turned, right and up, a share of the lens's radius. */
  readonly look?: readonly [number, number];
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

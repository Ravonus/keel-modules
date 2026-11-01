// A portrait of a skinned body: framed from its own height, studio lit, drawn large and brought down. keel/lit and the
// bodies are passed in, so this imports nothing; any recipe skin-body can draw can sit for one.

type Vec = readonly [number, number, number];

export interface PortraitLight {
  readonly sun: Vec; readonly sunColor: Vec;
  readonly fill: Vec; readonly fillColor: Vec;
  readonly sky: Vec; readonly ground: Vec;
  readonly rim: Vec; readonly rimColor: Vec;
  readonly front: Vec;
}

interface Pictured {
  setSize(width: number, height: number, css: boolean): void;
  setClearColor(colour: number, alpha: number): void;
  clear(): void;
  render(stage: unknown, camera: unknown): void;
  getContext(): WebGL2RenderingContext;
}
interface Lens {
  position: { set(x: number, y: number, z: number): void };
  lookAt(x: number, y: number, z: number): void;
}
export interface PortraitLit {
  createLitRenderer(options: { canvas: unknown; alpha: boolean; preserveDrawingBuffer: boolean }): Pictured;
  Stage: new () => { add(node: unknown): void };
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => Lens;
}
export interface PortraitBodies { readonly group: unknown; light(light: PortraitLight): void }
export interface PortraitOne<F> {
  pose(bones: Float32Array, at: Vec, yaw: number, face: F): void;
  show(on: boolean): void;
}

export interface Sitting<F> {
  readonly one: PortraitOne<F>;
  readonly bones: Float32Array;
  /** Height of the highest point of the mesh (meshTop), and of the head's centre. */
  readonly top: number;
  readonly head: number;
  readonly face: F;
  readonly size: number;
  /** How far it turns, radians. */
  readonly yaw?: number;
}
export interface PortraitStudio { shoot<F>(sitting: Sitting<F>): Uint8Array }

/**
 * How much taller the frame is than the top of the head to the head's centre, and where in it that centre sits: closer
 * when small.
 */
const FILL = 2.8;
const SMALL_FILL = 2.2;
const CENTRE = 0.42;
const SMALL = 48;
/** How far above the frame's middle the lens sits, a share of the frame. */
const LIFT = .04;
/** Pixels drawn for each one kept, and the most drawn across. */
const OVER = 4;
const MOST = 640;
const FOV = 16;
const YAW = 0.24;
const FOCUS = 0.1;
const FAR = 20;
/** How hard a small face's edges are stood back up. */
const CRISP = .7;
// (A key from up and to one side, a cooler fill across, a rim behind: a shape, where a flat wash gives only a colour.)
export const STUDIO: PortraitLight = {
  sun: [0.62, 0.62, 0.55],
  sunColor: [3.1, 2.9, 2.6],
  fill: [-0.8, 0.1, 0.6],
  fillColor: [0.55, 0.62, 0.8],
  sky: [0.62, 0.68, 0.82],
  ground: [0.3, 0.26, 0.24],
  rim: [-0.3, 0.4, -0.85],
  rimColor: [1.5, 1.6, 2],
  front: [0.16, 0.16, 0.16],
};

/** The highest point of a mesh: every third number, from the second. */
export function meshTop(position: Float32Array): number {
  let top = -Infinity;
  for (let i = 1; i < position.length; i += 3) top = Math.max(top, position[i] ?? top);
  return top;
}

/**
 * Where a head of these heights goes in a frame of `size`: the height the frame looks at, how tall it is, how far back
 * the lens stands.
 */
export function portraitShot(
  top: number,
  head: number,
  size: number,
): { readonly middle: number; readonly high: number; readonly away: number } {
  const high = (top - head) * (size <= SMALL ? SMALL_FILL : FILL);
  return { middle: top - high * CENTRE, high, away: high / (2 * Math.tan((FOV * Math.PI) / 360)) };
}

/** Red, green, blue and coverage of a block of `over` pixels from `(x, y)`, bottom row first as GL reads it. */
function block(
  raw: Uint8Array,
  wide: number,
  x: number,
  y: number,
  over: number,
): readonly [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let v = 0; v < over; v += 1)
    for (let u = 0; u < over; u += 1) {
      const o = ((wide - 1 - (y + v)) * wide + x + u) * 4;
      const k = raw[o + 3] ?? 0;
      r += (raw[o] ?? 0) * k;
      g += (raw[o + 1] ?? 0) * k;
      b += (raw[o + 2] ?? 0) * k;
      a += k;
    }
  return [r, g, b, a];
}

/** A channel pushed from the mean of its neighbours that are there. */
function stoodUp(rgba: Uint8Array, o: number, channel: number, near: readonly number[]): number {
  let sum = 0;
  let n = 0;
  for (const d of near) if (rgba[o + d + 3]) { sum += rgba[o + d + channel] ?? 0;
  n += 1; }
  const own = rgba[o + channel] ?? 0;
  return n ? Math.max(0, Math.min(255, own + (own - sum / n) * CRISP)) : own;
}
function crisp(rgba: Uint8Array, size: number): Uint8Array {
  const out = rgba.slice();
  const near = [-4, 4, -size * 4, size * 4];
  for (let o = size * 4; o < rgba.length - size * 4; o += 4) {
    if (!rgba[o + 3]) continue;
    for (let c = 0; c < 3; c += 1) out[o + c] = stoodUp(rgba, o, c, near);
  }
  return out;
}

/** GL's rows, `wide` across, as `size` across, top row first: colour weighed by coverage, so edges don't go dark. */
export function shrinkPortrait(raw: Uint8Array, wide: number, size: number): Uint8Array {
  const over = wide / size;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const [r, g, b, a] = block(raw, wide, x * over, y * over, over);
    const o = (y * size + x) * 4;
    if (!a) continue;
    out.set([r / a, g / a, b / a, a / (over * over)], o);
  }
  return size <= SMALL ? crisp(out, size) : out;
}

export function createPortraitStudio(
  lit: PortraitLit,
  canvas: unknown,
  bodies: PortraitBodies,
  light: PortraitLight = STUDIO,
): PortraitStudio {
  const render = lit.createLitRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
  const stage = new lit.Stage();
  const lens = new lit.PerspectiveCamera(FOV, 1, FOCUS, FAR);
  render.setClearColor(0, 0);
  stage.add(bodies.group);
  bodies.light(light);
  return {
    shoot({ one, bones, top, head, face, size, yaw = YAW }) {
      const shot = portraitShot(top, head, size);
      const wide = size * Math.max(1, Math.min(OVER, Math.floor(MOST / size)));
      render.setSize(wide, wide, false);
      one.pose(bones, [0, 0, 0], yaw, face);
      one.show(true);
      lens.position.set(0, shot.middle + shot.high * LIFT, shot.away);
      lens.lookAt(0, shot.middle, 0);
      render.clear();
      render.render(stage, lens);
      one.show(false);
      const gl = render.getContext();
      const raw = new Uint8Array(wide * wide * 4);
      gl.readPixels(0, 0, wide, wide, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      return shrinkPortrait(raw, wide, size);
    },
  };
}

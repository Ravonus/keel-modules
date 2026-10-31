/**
 * A keel/lit stage drawn into a frame another renderer owns (see the README).
 * keel/lit is passed in, as sdf-body takes it, so this module imports nothing.
 */

/** The host's frame: its camera, and where it is drawing. */
export interface HostFrame {
  /** World to clip, column-major. */
  readonly clip: ArrayLike<number>;
  /** The eye, for what lights by the view. */
  readonly origin: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  /** The framebuffer being drawn to; null is the canvas. */
  readonly target: WebGLFramebuffer | null;
}

interface PassMatrix { fromArray(values: ArrayLike<number>): PassMatrix; makeTranslation(x: number, y: number, z: number): PassMatrix; multiply(other: PassMatrix): PassMatrix }
interface PassCamera { position: { set(x: number, y: number, z: number): void }; projectionMatrix: PassMatrix; projectionMatrixInverse: { copy(m: PassMatrix): { invert(): unknown } } }
interface PassRenderer { autoClear: boolean; setViewport(x: number, y: number, width: number, height: number): void; render(stage: unknown, camera: PassCamera): void; resetState(): void; dispose(): void }

/** What this module uses of keel/lit. */
export interface PassLit {
  readonly createLitRenderer: (options: { canvas: unknown; context: WebGL2RenderingContext }) => PassRenderer;
  readonly PerspectiveCamera: new () => PassCamera;
  readonly Matrix4: new () => PassMatrix;
}

export interface LitPass {
  draw(stage: unknown, frame: HostFrame): void;
  dispose(): void;
}

export function createLitPass(lit: PassLit, gl: WebGL2RenderingContext): LitPass {
  const renderer = lit.createLitRenderer({ canvas: gl.canvas, context: gl });
  renderer.autoClear = false;
  const camera = new lit.PerspectiveCamera();
  const shift = new lit.Matrix4();
  // keel/lit binds null for "the canvas"; here that means the host's framebuffer.
  const bind = gl.bindFramebuffer.bind(gl);
  return {
    draw(stage, { clip, origin, width, height, target }) {
      camera.position.set(origin[0], origin[1], origin[2]);
      // (The camera stands at the eye unturned, so its view is a shift: the projection takes the rest of `clip`.)
      camera.projectionMatrix.fromArray(clip).multiply(shift.makeTranslation(origin[0], origin[1], origin[2]));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      gl.bindFramebuffer = (kind, buffer) => { bind(kind, buffer ?? target); };
      try {
        renderer.resetState();
        renderer.setViewport(0, 0, width, height);
        renderer.render(stage, camera);
      } finally {
        renderer.resetState();
        gl.bindFramebuffer = bind;
        bind(gl.FRAMEBUFFER, target);
      }
    },
    dispose() { renderer.dispose(); },
  };
}

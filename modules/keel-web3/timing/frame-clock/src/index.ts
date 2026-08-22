/** Fixed-timestep animation clock with explicit FPS and bounded catch-up. MIT. */

/** Information passed to the frame callback for every simulated frame. */
export interface FrameInfo {
  /** Zero-based frame index. */
  readonly frame: number;
  /** Simulated time in milliseconds, always frame * step. */
  readonly time: number;
  /** Fixed step length in milliseconds. */
  readonly delta: number;
}

/** Options for {@link createFrameClock}. */
export interface FrameClockOptions {
  /** Frames per second; must be greater than 0 and at most 240. Defaults to 12. */
  readonly fps?: number;
  /** Maximum simulated frames per animation tick; must be a safe integer of at least 1. Defaults to 4. */
  readonly maxCatchUpFrames?: number;
  /** Called once per simulated frame. */
  readonly onFrame: (info: FrameInfo) => void;
}

/** Handle returned by {@link createFrameClock}. */
export interface FrameClock {
  /** Starts the clock. Calling it while running does nothing. */
  start(): void;
  /** Stops the clock and resets the accumulated real time. The frame counter is kept. */
  stop(): void;
  /** Jumps the frame counter to the given non-negative safe integer. */
  seek(nextFrame: number): void;
  /** The next frame index that will be simulated. */
  readonly frame: number;
}

/**
 * Creates a fixed-timestep clock driven by requestAnimationFrame.
 *
 * The clock accumulates real elapsed time, clamped to at most
 * maxCatchUpFrames steps per tick, and calls onFrame once per whole step.
 *
 * @param options FPS, catch-up bound, and the per-frame callback.
 * @returns A start/stop/seek handle exposing the current frame index.
 * @throws RangeError when fps or maxCatchUpFrames is out of range.
 */
export function createFrameClock({ fps = 12, maxCatchUpFrames = 4, onFrame }: FrameClockOptions): FrameClock {
  if (!(fps > 0 && fps <= 240) || !Number.isSafeInteger(maxCatchUpFrames) || maxCatchUpFrames < 1) {
    throw new RangeError("Invalid frame-clock limits.");
  }
  const step = 1_000 / fps;
  let running = false;
  let request = 0;
  let previous = 0;
  let accumulator = 0;
  let frame = 0;
  const tick = (now: number): void => {
    if (!running) return;
    if (previous === 0) previous = now;
    accumulator += Math.min(now - previous, step * maxCatchUpFrames);
    previous = now;
    let iterations = 0;
    while (accumulator >= step && iterations < maxCatchUpFrames) {
      onFrame({ frame, time: frame * step, delta: step });
      frame += 1;
      iterations += 1;
      accumulator -= step;
    }
    request = requestAnimationFrame(tick);
  };
  return {
    start() { if (!running) { running = true; request = requestAnimationFrame(tick); } },
    stop() { running = false; cancelAnimationFrame(request); previous = 0; accumulator = 0; },
    seek(nextFrame: number) { if (!Number.isSafeInteger(nextFrame) || nextFrame < 0) throw new RangeError("Invalid frame."); frame = nextFrame; },
    get frame() { return frame; },
  };
}

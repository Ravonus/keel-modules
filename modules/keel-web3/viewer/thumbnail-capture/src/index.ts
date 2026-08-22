/**
 * AI-friendly helpers for exact Keel poster and motion capture markers.
 * The viewer injects __OCA_THUMBNAIL__; importing this file is optional.
 * MIT.
 */

/** The capture API a thumbnail-aware Keel viewer injects on globalThis. */
export interface ThumbnailRuntime {
  readonly protocol: "oca-thumbnail-capture@1";
  init(label: string): void;
  ready(label: string): void;
  stop(label: string): void;
  after(delayMs: number, label: string): void;
}

/** Options for {@link thumbnailAfterInit}. */
export interface ThumbnailAfterInitOptions {
  /** Capture label. Defaults to "hero". */
  readonly label?: string;
  /** Delay in milliseconds after initialization before capture. Defaults to 0. */
  readonly delayMs?: number;
}

function runtime(): ThumbnailRuntime {
  const api = (globalThis as { __OCA_THUMBNAIL__?: ThumbnailRuntime }).__OCA_THUMBNAIL__;
  if (api?.protocol !== "oca-thumbnail-capture@1") {
    throw new Error("This artwork is not running in a thumbnail-aware Keel viewer.");
  }
  return api;
}

/**
 * Marks the labeled capture as initializing.
 *
 * @param label Capture label. Defaults to "hero".
 * @throws Error when no thumbnail-aware viewer runtime is present.
 */
export function thumbnailInit(label = "hero"): void {
  runtime().init(label);
}

/**
 * Marks the labeled capture as ready to shoot now.
 *
 * @param label Capture label. Defaults to "hero".
 * @throws Error when no thumbnail-aware viewer runtime is present.
 */
export function thumbnailReady(label = "hero"): void {
  runtime().ready(label);
}

/**
 * Stops the labeled capture.
 *
 * @param label Capture label. Defaults to "hero".
 * @throws Error when no thumbnail-aware viewer runtime is present.
 */
export function thumbnailStop(label = "hero"): void {
  runtime().stop(label);
}

/**
 * Schedules the labeled capture after a delay.
 *
 * @param delayMs Delay in milliseconds before the capture fires.
 * @param label Capture label. Defaults to "hero".
 * @throws Error when no thumbnail-aware viewer runtime is present.
 */
export function thumbnailAfter(delayMs: number, label = "hero"): void {
  runtime().after(delayMs, label);
}

/**
 * Runs an initializer between init and a delayed capture marker.
 *
 * @param initializer Awaited setup work; its resolved value is returned.
 * @param options Capture label and post-initialization delay.
 * @returns The initializer's resolved value.
 * @throws Error when no thumbnail-aware viewer runtime is present.
 */
export async function thumbnailAfterInit<T>(initializer: () => T | PromiseLike<T>, options: ThumbnailAfterInitOptions = {}): Promise<T> {
  thumbnailInit(options.label);
  const value = await initializer();
  thumbnailAfter(options.delayMs ?? 0, options.label);
  return value;
}

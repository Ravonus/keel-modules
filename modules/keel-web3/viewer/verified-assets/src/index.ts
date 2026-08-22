/** Dependency-injected asset loader. The host resolver supplies already verified bytes. MIT. */

/** Byte sources the resolver may return, directly or wrapped in a promise. */
export type ResolvedBytes = ArrayBuffer | ArrayLike<number>;

/** The injected host resolver. It maps an asset id to already verified bytes. */
export type ResolveResource = (id: string) => ResolvedBytes | PromiseLike<ResolvedBytes>;

/** Cached asset views over the injected resolver. */
export interface VerifiedAssets {
  /** Resolves the raw bytes for an id, caching the promise per id. */
  bytes(id: string): Promise<Uint8Array>;
  /** Decodes the bytes as strict UTF-8 text; invalid sequences reject. */
  text(id: string): Promise<string>;
  /** Parses the UTF-8 text as JSON. */
  json(id: string): Promise<unknown>;
  /** Decodes the bytes as an image. The media type defaults to "image/webp". */
  image(id: string, mediaType?: string): Promise<ImageBitmap>;
  /** Drops one cached id, or the whole cache when no id is given. */
  clear(id?: string): void;
}

/**
 * Creates a caching asset loader over an injected verified-byte resolver.
 *
 * Every accessor funnels through one per-id promise cache, so each asset is
 * resolved at most once until it is cleared.
 *
 * @param resolveResource The host resolver supplying verified bytes per id.
 * @returns Byte, text, JSON, and image views over the resolver.
 * @throws TypeError when the resolver is not a function.
 */
export function createVerifiedAssets(resolveResource: ResolveResource): VerifiedAssets {
  if (typeof resolveResource !== "function") throw new TypeError("A verified host resolver is required.");
  const cache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const bytes = async (id: string): Promise<Uint8Array<ArrayBuffer>> => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const loaded = Promise.resolve(resolveResource(id)).then((value) => new Uint8Array(value));
    cache.set(id, loaded);
    return loaded;
  };
  const text = async (id: string): Promise<string> => new TextDecoder("utf-8", { fatal: true }).decode(await bytes(id));
  return {
    bytes,
    text,
    async json(id: string): Promise<unknown> { return JSON.parse(await text(id)) as unknown; },
    async image(id: string, mediaType = "image/webp"): Promise<ImageBitmap> { return createImageBitmap(new Blob([await bytes(id)], { type: mediaType })); },
    clear(id?: string): void { if (id === undefined) cache.clear(); else cache.delete(id); },
  };
}

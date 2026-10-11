/** Ruffle resource loader for Keel verification shells. MIT. */

export interface VerifiedContent {
  /** Return a verified data/blob URL for a committed resource, or null. */
  readonly url: (id: string) => string | null;
}

export interface RuffleAssetIds {
  readonly main: string;
  readonly modernCore: string;
  readonly legacyCore: string;
  /** Optional MVP/vanilla WASM. Unsupported browsers can supply it locally. */
  readonly modernWasm?: string;
  readonly legacyWasm: string;
}

export interface RuffleLoaderOptions {
  readonly window: Window;
  readonly document: Document;
  readonly content: VerifiedContent;
  readonly assets: RuffleAssetIds;
  /** A locally selected MVP/vanilla WASM blob for browsers without extensions. */
  readonly fallbackWasmUrl?: string;
  readonly publicPath?: string;
  /** Start visual SWF playback without requiring a second click. */
  readonly autoplay?: "on" | "off" | "auto";
  /** Hide Ruffle's audio-unmute affordance for visual-only SWFs. */
  readonly unmuteOverlay?: "visible" | "hidden";
}

export interface RufflePlayerApi {
  readonly newest: () => {
    readonly createPlayer: () => HTMLElement & { load(source: string | { url: string; parameters?: Record<string, string> }): Promise<void> };
  };
}

interface RuffleWindow extends Window {
  RufflePlayer?: Partial<RufflePlayerApi> & { config?: Record<string, unknown> };
}

export interface RuffleLoader {
  readonly load: () => Promise<RufflePlayerApi>;
  readonly dispose: () => void;
}

function fileName(value: string): string {
  try {
    return new URL(value, "https://keel.invalid/").pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

// Keep this probe set byte-for-byte aligned with Ruffle's wasm-feature-detect
// checks in `core/dist/load-ruffle.js`. Ruffle selects its extensions build only
// when every probe succeeds; the same decision lets Keel request the optional
// local MVP upload before the first player is created.
const RUFFLE_EXTENSION_PROBES: readonly Uint8Array[] = [
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 10, 14, 1, 12, 0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11]),
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 12, 1, 10, 0, 67, 0, 0, 0, 0, 252, 0, 26, 11]),
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 0, 192, 26, 11]),
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 7, 1, 5, 0, 208, 112, 26, 11]),
];

/** Return whether the host supports the WASM extensions used by Ruffle's
 * extensions-enabled build. This is a capability check only; it performs no
 * network or resource loading. */
export function supportsRuffleWasmExtensions(): boolean {
  const validate = (globalThis as { readonly WebAssembly?: typeof WebAssembly }).WebAssembly?.validate;
  if (typeof validate !== "function") return false;
  try {
    return RUFFLE_EXTENSION_PROBES.every((probe) => validate(probe as unknown as BufferSource));
  } catch {
    return false;
  }
}

function executableResourceUrl(objectUrls: string[]): (value: string) => string {
  const cache = new Map<string, string>();
  return (value: string): string => {
    if (!value.startsWith("data:")) return value;
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    const comma = value.indexOf(",");
    if (comma < 0) return value;
    const metadata = value.slice(5, comma);
    const encoded = value.slice(comma + 1);
    try {
      const bytes = /;base64(?:;|$)/iu.test(metadata)
        ? Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(encoded));
      const declaredType = metadata.split(";", 1)[0];
      const mediaType = declaredType === "" ? "application/octet-stream" : declaredType ?? "application/octet-stream";
      const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
      cache.set(value, url);
      objectUrls.push(url);
      return url;
    } catch {
      // Retain the verified URL for normal browser error reporting. Never
      // substitute an unverified network URL when local decoding fails.
      return value;
    }
  };
}

function bindResources(options: RuffleLoaderOptions, objectUrls: string[]): Map<string, string> {
  const resources = new Map<string, string>();
  const executableUrl = executableResourceUrl(objectUrls);
  const bind = (name: string, id: string): void => {
    const url = options.content.url(id);
    if (url === null || url.length === 0) throw new Error(`Missing verified Ruffle resource: ${id}`);
    resources.set(name, executableUrl(url));
  };
  bind("ruffle.js", options.assets.main);
  bind("core.ruffle.5e30dc5777a75720eae2.js", options.assets.modernCore);
  bind("core.ruffle.15317142e75ce021ac04.js", options.assets.legacyCore);
  if (options.assets.modernWasm !== undefined) {
    bind("a71cef02d58dcec6f55f.wasm", options.assets.modernWasm);
  } else if (options.fallbackWasmUrl !== undefined) {
    if (!/^(?:blob|data):/u.test(options.fallbackWasmUrl)) {
      throw new TypeError("Ruffle fallback WASM must be a local blob or data URL.");
    }
    resources.set("a71cef02d58dcec6f55f.wasm", options.fallbackWasmUrl);
  }
  bind("6ce4f603a1fe7cc88438.wasm", options.assets.legacyWasm);
  return resources;
}

function installResourceHooks(hostWindow: RuffleWindow, document: Document, resources: ReadonlyMap<string, string>): () => void {
  const originalFetch = hostWindow.fetch.bind(hostWindow);
  const originalAppend = document.head.appendChild.bind(document.head);
  // A locked sandbox fetch already resolves verified keel://ruffle aliases.
  // Keep that gateway and the host's URL-property guard intact.
  try {
    hostWindow.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return originalFetch(resources.get(fileName(raw)) ?? input, init);
    };
  } catch { /* The host gateway continues to enforce the same aliases. */ }
  try {
    document.head.appendChild = ((node: Node): Node => {
      if (node instanceof HTMLScriptElement) {
        const mapped = resources.get(fileName(node.src));
        if (mapped !== undefined) node.src = mapped;
      }
      return originalAppend(node);
    }) as typeof document.head.appendChild;
  } catch { /* The host URL-property guard still rewrites declared aliases. */ }
  return () => {
    try { hostWindow.fetch = originalFetch; } catch {}
    try { document.head.appendChild = originalAppend; } catch {}
  };
}

function loadPlayer(hostWindow: RuffleWindow, document: Document, main: string | undefined): Promise<RufflePlayerApi> {
  return new Promise<RufflePlayerApi>((resolve, reject) => {
    try {
      if (main === undefined) throw new Error("Ruffle main resource is not bound.");
      const script = document.createElement("script");
      script.src = main;
      script.async = true;
      script.onload = () => {
        const api = hostWindow.RufflePlayer;
        if (typeof api?.newest !== "function") reject(new Error("Ruffle did not expose RufflePlayer.newest()."));
        else resolve(api as RufflePlayerApi);
      };
      script.onerror = () => { reject(new Error("Verified Ruffle main resource failed to load.")); };
      document.head.appendChild(script);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Create a loader that maps Ruffle's split runtime requests to verified Keel
 * resources. The hooks remain installed until `dispose`, because Ruffle loads
 * its WASM lazily when the first player is created.
 *
 * @param options Injected DOM, resource resolver, and committed resource ids.
 * @returns A one-shot loader and a cleanup function.
 */
export function createRuffleLoader(options: RuffleLoaderOptions): RuffleLoader {
  const { document, window } = options;
  const hostWindow = window as RuffleWindow;
  const objectUrls: string[] = [];
  const resources = bindResources(options, objectUrls);
  const restoreHooks = installResourceHooks(hostWindow, document, resources);
  const playerHost = hostWindow.RufflePlayer ?? { config: {} };
  hostWindow.RufflePlayer = playerHost;
  playerHost.config = {
    ...playerHost.config,
    publicPath: options.publicPath ?? "keel://ruffle/",
    ...(options.autoplay === undefined ? {} : { autoplay: options.autoplay }),
    ...(options.unmuteOverlay === undefined ? {} : { unmuteOverlay: options.unmuteOverlay }),
  };
  let disposed = false;
  let loaded: Promise<RufflePlayerApi> | undefined;
  const load = (): Promise<RufflePlayerApi> => {
    if (disposed) return Promise.reject(new Error("Ruffle loader has been disposed."));
    loaded ??= loadPlayer(hostWindow, document, resources.get("ruffle.js"));
    return loaded;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    restoreHooks();
    for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
  };
  return Object.freeze({ load, dispose });
}

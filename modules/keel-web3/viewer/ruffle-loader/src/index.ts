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
  RufflePlayer?: RufflePlayerApi & { config?: Record<string, unknown> };
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
  const validate = globalThis.WebAssembly?.validate;
  if (typeof validate !== "function") return false;
  try {
    return RUFFLE_EXTENSION_PROBES.every((probe) => validate(probe as unknown as BufferSource));
  } catch {
    return false;
  }
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
  const publicPath = options.publicPath ?? "keel://ruffle/";
  const resources = new Map<string, string>();
  const objectUrls: string[] = [];
  const executableUrlCache = new Map<string, string>();
  const executableUrl = (value: string): string => {
    if (!value.startsWith("data:")) return value;
    const cached = executableUrlCache.get(value);
    if (cached !== undefined) return cached;
    const comma = value.indexOf(",");
    if (comma < 0) return value;
    const metadata = value.slice(5, comma);
    const encoded = value.slice(comma + 1);
    try {
      const bytes = /;base64(?:;|$)/iu.test(metadata)
        ? Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(encoded));
      const mediaType = metadata.split(";", 1)[0] || "application/octet-stream";
      const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
      executableUrlCache.set(value, url);
      objectUrls.push(url);
      return url;
    } catch {
      // Keep the original data URL; the browser will report a normal load
      // error if it cannot execute it. No unverified network URL is opened.
      return value;
    }
  };
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

  const originalFetch = hostWindow.fetch.bind(hostWindow);
  const originalAppend = document.head.appendChild.bind(document.head);
  let disposed = false;
  let loaded: Promise<RufflePlayerApi> | undefined;

  const mapRequest = (value: RequestInfo | URL): string | undefined => {
    const raw = typeof value === "string" ? value : value instanceof URL ? value.href : value.url;
    return resources.get(fileName(raw));
  };
  // Keel's strict sandbox deliberately makes fetch non-writable after it has
  // installed the verified-only gateway. In that case the gateway itself
  // resolves the manifest-declared `keel://ruffle/*` aliases; keep using it
  // rather than weakening the boundary or failing before Ruffle can start.
  try {
    hostWindow.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const mapped = mapRequest(input);
      return originalFetch(mapped ?? input, init);
    }) as typeof hostWindow.fetch;
  } catch {
    // A locked fetch is expected in a Keel sandbox. The mapped aliases are
    // still enforced by the host gateway and the URL-property guard below.
  }

  try {
    document.head.appendChild = ((node: Node): Node => {
      if (node instanceof HTMLScriptElement) {
        const mapped = resources.get(fileName(node.src));
        if (mapped !== undefined) node.src = mapped;
      }
      return originalAppend(node);
    }) as typeof document.head.appendChild;
  } catch {
    // The sandbox's URL-property guard still rewrites the declared aliases.
  }

  const playerHost: RufflePlayerApi & { config?: Record<string, unknown> } =
    hostWindow.RufflePlayer ?? { config: {} } as RufflePlayerApi & { config?: Record<string, unknown> };
  hostWindow.RufflePlayer = playerHost;
  playerHost.config = {
    ...playerHost.config,
    publicPath,
    ...(options.autoplay === undefined ? {} : { autoplay: options.autoplay }),
    ...(options.unmuteOverlay === undefined ? {} : { unmuteOverlay: options.unmuteOverlay }),
  };

  const load = (): Promise<RufflePlayerApi> => {
    if (disposed) return Promise.reject(new Error("Ruffle loader has been disposed."));
    loaded ??= new Promise<RufflePlayerApi>((resolve, reject) => {
      const start = async (): Promise<void> => {
        try {
          const script = document.createElement("script");
          const main = resources.get("ruffle.js");
          if (main === undefined) throw new Error("Ruffle main resource is not bound.");
          script.src = main;
          script.async = true;
          script.onload = () => {
            const api = hostWindow.RufflePlayer;
            if (api?.newest === undefined) reject(new Error("Ruffle did not expose RufflePlayer.newest()."));
            else resolve(api);
          };
          script.onerror = () => reject(new Error("Verified Ruffle main resource failed to load."));
          document.head.appendChild(script);
        } catch (error) {
          reject(error);
        }
      };
      void start();
    });
    return loaded;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try { hostWindow.fetch = originalFetch; } catch {}
    try { document.head.appendChild = originalAppend; } catch {}
    for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
  };
  return Object.freeze({ load, dispose });
}

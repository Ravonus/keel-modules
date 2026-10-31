/**
 * Several full scenes in one page.
 *
 * A scene written for a page of its own expects a document, a window, an address and events.
 * Some pages can't give it that: a verification shell, for one, forbids iframes. A plate world
 * is that page without the frame. The scene runs as a function taking this scope in place of its
 * globals, so anything it reads for the page or the address is its own, and module code stays
 * shared between plates. Ending a world gives back its GL contexts, which browsers ration.
 */

export interface PlateBox {
  readonly left?: string;
  readonly top?: string;
  readonly width?: string;
  readonly height?: string;
}

export interface PlateWorldOptions {
  /** What the scene sees as its address, e.g. `plate:one?look=2`. */
  readonly address: string;
  /** The body of the scene's page. */
  readonly html: string;
  /** Where the plate sits. Plates usually sit unseen and their canvases are drawn elsewhere. */
  readonly box?: PlateBox;
  /** Class given to the plate's root, for the host page's styles. */
  readonly className?: string;
  /** Extra globals only this scene sees. */
  readonly globals?: Readonly<Record<string, unknown>>;
}

export interface PlateWorld {
  /** The element holding the scene's page. */
  readonly root: HTMLElement;
  /** Pass this to the scene in place of `globalThis`. */
  readonly scope: Record<string, unknown>;
  /** Tells the scene its size changed. */
  resize(): void;
  /** Stops the scene's animation frames, gives back its GL contexts and removes it. */
  end(): void;
}

/** Scenes navigate; a plate has nowhere to go. */
const ignore = (): void => undefined;

interface GlContext { getExtension(name: string): { loseContext(): void } | null }

/** `createElement` that remembers every GL context the scene opens. */
function contextKeeper(contexts: GlContext[]) {
  return (tag: string, elementOptions?: ElementCreationOptions): HTMLElement => {
    const element = document.createElement(tag, elementOptions);
    if (tag !== "canvas") return element;
    const canvas = element as HTMLCanvasElement;
    const getContext = canvas.getContext.bind(canvas) as (kind: string, ...rest: unknown[]) => unknown;
    (canvas as unknown as { getContext: typeof getContext }).getContext = (kind, ...rest) => {
      const context = getContext(kind, ...rest);
      if (context && kind.startsWith("webgl")) contexts.push(context as GlContext);
      return context;
    };
    return canvas;
  };
}

/** The document as the scene sees it: its own body and events, the real one for the rest. */
function plateDocument(root: HTMLElement, top: HTMLElement, events: EventTarget, makeElement: ReturnType<typeof contextKeeper>): Document {
  return new Proxy(document, {
    get(real, key) {
      switch (key) {
        case "documentElement": return top;
        case "body":
        case "head": return root;
        case "getElementById": return (id: string) => root.querySelector(`#${CSS.escape(id)}`);
        case "querySelector": return (selector: string) => root.querySelector(selector);
        case "querySelectorAll": return (selector: string) => root.querySelectorAll(selector);
        case "createElement": return makeElement;
        case "addEventListener": return events.addEventListener.bind(events);
        case "removeEventListener": return events.removeEventListener.bind(events);
        default: {
          const value = Reflect.get(real, key) as unknown;
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
        }
      }
    },
  });
}

/**
 * The scope stands on the plate's own object, not the real global: a shell may seal globals,
 * and a proxy of a sealed property must report its true value.
 */
function plateScope(own: Record<string, unknown>): Record<string, unknown> {
  const real = globalThis as unknown as Record<PropertyKey, unknown>;
  return new Proxy(own, {
    get(_, key) {
      if (key in own) return own[key as string];
      const value = real[key];
      return typeof value === "function" && /^[a-z]/.test(String(key)) ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
    has: (_, key) => key in own || key in real,
  });
}

export function createPlateWorld(options: PlateWorldOptions): PlateWorld {
  const { address, html, box = {}, className = "plate-world", globals = {} } = options;
  const root = document.createElement("div");
  const top = document.createElement("div");
  const events = new EventTarget();
  const contexts: GlContext[] = [];
  let alive = true;
  root.className = className;
  root.innerHTML = html;
  Object.assign(root.style, box);
  document.body.append(root);

  const page = plateDocument(root, top, events, contextKeeper(contexts));

  const own: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, {
    document: page,
    location: { href: address, assign: ignore },
    history: { replaceState: ignore, pushState: ignore },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    requestAnimationFrame: (run: FrameRequestCallback) => requestAnimationFrame((time) => { if (alive) run(time); }),
    cancelAnimationFrame: (id: number) => { cancelAnimationFrame(id); },
    ...globals,
  });

  const scope = plateScope(own);
  own.globalThis = own.window = own.self = scope;

  return {
    root,
    scope,
    resize() { events.dispatchEvent(new Event("resize")); },
    end() {
      alive = false;
      for (const context of contexts) context.getExtension("WEBGL_lose_context")?.loseContext();
      contexts.length = 0;
      root.remove();
    },
  };
}

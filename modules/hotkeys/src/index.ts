/** Scoped, removable keyboard-command map for opaque artwork documents. MIT. */

/** A handler invoked when its bound chord matches a keydown event. */
export type HotkeyHandler = (event: KeyboardEvent) => void;

/** Chord-to-handler bindings, for example { "mod+s": save, "escape": close }. */
export type HotkeyBindings = Readonly<Record<string, HotkeyHandler>>;

/** The injected event target; window and any DOM element both satisfy it. */
export interface HotkeyTarget {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

/** Options for {@link createHotkeys}. */
export interface HotkeyOptions {
  /** Where the keydown listener is attached. Defaults to window. */
  readonly target?: HotkeyTarget;
  /** When true, events originating inside form fields or editable content are ignored. Defaults to true. */
  readonly ignoreInputs?: boolean;
}

/** Handle returned by {@link createHotkeys}. */
export interface Hotkeys {
  /** Removes the keydown listener from the target. */
  destroy(): void;
}

/**
 * Attaches a keydown listener that dispatches to chord-mapped handlers.
 *
 * Chords are lowercase and combine "mod" (meta or ctrl), "alt", "shift",
 * and the event key joined by "+". A binding on the bare key alone also
 * matches. Matched events are preventDefault-ed before the handler runs.
 *
 * @param bindings Map from chord string to handler.
 * @param options Target and input-field filtering overrides.
 * @returns A handle whose destroy method removes the listener.
 */
export function createHotkeys(bindings: HotkeyBindings, { target = window, ignoreInputs = true }: HotkeyOptions = {}): Hotkeys {
  const normalized = new Map(Object.entries(bindings).map(([key, handler]) => [key.toLowerCase(), handler]));
  const listener = (event: KeyboardEvent): void => {
    if (ignoreInputs && event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    const chord = [event.metaKey || event.ctrlKey ? "mod" : "", event.altKey ? "alt" : "", event.shiftKey ? "shift" : "", event.key.toLowerCase()].filter(Boolean).join("+");
    const handler = normalized.get(chord) ?? normalized.get(event.key.toLowerCase());
    if (handler === undefined) return;
    event.preventDefault();
    handler(event);
  };
  target.addEventListener("keydown", listener);
  return { destroy() { target.removeEventListener("keydown", listener); } };
}

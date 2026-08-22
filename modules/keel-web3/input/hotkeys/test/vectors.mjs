/** Deterministic test vectors for hotkeys. Run by `keel module test`. */

/** Minimal event target stand-in recording its keydown listeners. */
function stubTarget() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    dispatch(event) { for (const listener of listeners) listener(event); },
  };
}

/** A synthetic keydown event; target stays undefined to bypass DOM checks. */
function keyEvent(key, modifiers = {}) {
  let prevented = false;
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
    preventDefault() { prevented = true; },
    get defaultPrevented() { return prevented; },
  };
}

export default [
  {
    name: "dispatches a mod chord and prevents the default",
    run: ({ createHotkeys }) => {
      const target = stubTarget();
      const hits = [];
      createHotkeys({ "mod+s": () => hits.push("save") }, { target, ignoreInputs: false });
      const event = keyEvent("S", { ctrlKey: true });
      target.dispatch(event);
      return [hits, event.defaultPrevented];
    },
    expect: [["save"], true],
  },
  {
    name: "meta counts as mod too",
    run: ({ createHotkeys }) => {
      const target = stubTarget();
      const hits = [];
      createHotkeys({ "mod+k": () => hits.push("palette") }, { target, ignoreInputs: false });
      target.dispatch(keyEvent("k", { metaKey: true }));
      return hits;
    },
    expect: ["palette"],
  },
  {
    name: "a bare-key binding matches even with modifiers held",
    run: ({ createHotkeys }) => {
      const target = stubTarget();
      const hits = [];
      createHotkeys({ escape: () => hits.push("close") }, { target, ignoreInputs: false });
      target.dispatch(keyEvent("Escape", { shiftKey: true }));
      return hits;
    },
    expect: ["close"],
  },
  {
    name: "unbound chords are left alone",
    run: ({ createHotkeys }) => {
      const target = stubTarget();
      createHotkeys({ "mod+s": () => undefined }, { target, ignoreInputs: false });
      const event = keyEvent("s", { altKey: true });
      target.dispatch(event);
      return event.defaultPrevented;
    },
    expect: false,
  },
  {
    name: "destroy removes the listener",
    run: ({ createHotkeys }) => {
      const target = stubTarget();
      const hits = [];
      const hotkeys = createHotkeys({ x: () => hits.push("x") }, { target, ignoreInputs: false });
      hotkeys.destroy();
      target.dispatch(keyEvent("x"));
      return [hits, target.listeners.size];
    },
    expect: [[], 0],
  },
];

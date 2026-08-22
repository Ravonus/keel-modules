/** Deterministic test vectors for thumbnail-capture. Run by `keel module test`. */

/** Installs a recording viewer runtime, runs work, and always restores the global. */
async function withRuntime(work) {
  const calls = [];
  const previous = globalThis.__OCA_THUMBNAIL__;
  globalThis.__OCA_THUMBNAIL__ = {
    protocol: "oca-thumbnail-capture@1",
    init: (label) => calls.push(["init", label]),
    ready: (label) => calls.push(["ready", label]),
    stop: (label) => calls.push(["stop", label]),
    after: (delayMs, label) => calls.push(["after", delayMs, label]),
  };
  try {
    return await work(calls);
  } finally {
    if (previous === undefined) delete globalThis.__OCA_THUMBNAIL__;
    else globalThis.__OCA_THUMBNAIL__ = previous;
  }
}

export default [
  {
    name: "markers forward to the injected runtime with the default label",
    run: ({ thumbnailInit, thumbnailReady, thumbnailStop, thumbnailAfter }) => withRuntime((calls) => {
      thumbnailInit();
      thumbnailReady();
      thumbnailStop();
      thumbnailAfter(250);
      return calls;
    }),
    expect: [["init", "hero"], ["ready", "hero"], ["stop", "hero"], ["after", 250, "hero"]],
  },
  {
    name: "custom labels pass through",
    run: ({ thumbnailReady }) => withRuntime((calls) => {
      thumbnailReady("detail");
      return calls;
    }),
    expect: [["ready", "detail"]],
  },
  {
    name: "thumbnailAfterInit wraps the initializer between init and after",
    run: ({ thumbnailAfterInit }) => withRuntime(async (calls) => {
      const value = await thumbnailAfterInit(() => {
        calls.push(["work"]);
        return 42;
      }, { label: "poster", delayMs: 100 });
      return [value, calls];
    }),
    expect: [42, [["init", "poster"], ["work"], ["after", 100, "poster"]]],
  },
  {
    name: "a wrong protocol is rejected",
    run: ({ thumbnailInit }) => {
      const previous = globalThis.__OCA_THUMBNAIL__;
      globalThis.__OCA_THUMBNAIL__ = { protocol: "other@9" };
      try {
        thumbnailInit();
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      } finally {
        if (previous === undefined) delete globalThis.__OCA_THUMBNAIL__;
        else globalThis.__OCA_THUMBNAIL__ = previous;
      }
    },
    expect: "Error",
  },
  {
    name: "a missing runtime is rejected",
    run: ({ thumbnailReady }) => {
      try {
        thumbnailReady();
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "Error",
  },
];

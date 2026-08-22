/** Deterministic test vectors for verified-assets. Run by `keel module test`. */

/** A resolver over an in-memory byte table that counts its calls. */
function stubResolver(table) {
  const counts = {};
  const resolve = (id) => {
    counts[id] = (counts[id] ?? 0) + 1;
    const bytes = table[id];
    if (bytes === undefined) throw new Error(`unknown asset ${id}`);
    return bytes;
  };
  return { resolve, counts };
}

const utf8 = (text) => Array.from(new TextEncoder().encode(text));

export default [
  {
    name: "bytes resolves through the injected resolver",
    run: async ({ createVerifiedAssets }) => {
      const { resolve } = stubResolver({ blob: [1, 2, 3] });
      const assets = createVerifiedAssets(resolve);
      return Array.from(await assets.bytes("blob"));
    },
    expect: [1, 2, 3],
  },
  {
    name: "each id resolves at most once until cleared",
    run: async ({ createVerifiedAssets }) => {
      const { resolve, counts } = stubResolver({ blob: [7] });
      const assets = createVerifiedAssets(resolve);
      await assets.bytes("blob");
      await assets.text("blob");
      const before = counts.blob;
      assets.clear("blob");
      await assets.bytes("blob");
      return [before, counts.blob];
    },
    expect: [1, 2],
  },
  {
    name: "text decodes strict utf-8",
    run: async ({ createVerifiedAssets }) => {
      const assets = createVerifiedAssets(() => utf8("keel ✓"));
      return assets.text("note");
    },
    expect: "keel ✓",
  },
  {
    name: "invalid utf-8 rejects",
    run: async ({ createVerifiedAssets }) => {
      const assets = createVerifiedAssets(() => [0xff, 0xfe, 0xfd]);
      try {
        await assets.text("junk");
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
  {
    name: "json parses the decoded text",
    run: async ({ createVerifiedAssets }) => {
      const assets = createVerifiedAssets(() => utf8('{"width":16,"tags":["a","b"]}'));
      return assets.json("meta");
    },
    expect: { width: 16, tags: ["a", "b"] },
  },
  {
    name: "clear() without an id drops the whole cache",
    run: async ({ createVerifiedAssets }) => {
      const { resolve, counts } = stubResolver({ one: [1], two: [2] });
      const assets = createVerifiedAssets(resolve);
      await assets.bytes("one");
      await assets.bytes("two");
      assets.clear();
      await assets.bytes("one");
      await assets.bytes("two");
      return [counts.one, counts.two];
    },
    expect: [2, 2],
  },
  {
    name: "a non-function resolver is rejected",
    run: ({ createVerifiedAssets }) => {
      try {
        createVerifiedAssets(null);
        return "no throw";
      } catch (error) {
        return error.constructor.name;
      }
    },
    expect: "TypeError",
  },
];

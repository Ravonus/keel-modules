/** Deterministic test vectors for plate-worlds, against a page small enough to read. */
function withPage(work) {
  const added = [];
  const make = () => {
    const element = { style: {}, innerHTML: "", className: "", removed: false, remove() { this.removed = true; }, querySelector: (s) => `found ${s}`, querySelectorAll: () => [] };
    return element;
  };
  const page = { title: "real", body: { append: (e) => added.push(e) }, createElement: () => make() };
  const was = { document: globalThis.document, CSS: globalThis.CSS, raf: globalThis.requestAnimationFrame };
  globalThis.document = page;
  globalThis.CSS = { escape: (s) => s };
  const frames = [];
  globalThis.requestAnimationFrame = (run) => frames.push(run);
  try { return work({ added, frames }); }
  finally { globalThis.document = was.document; globalThis.CSS = was.CSS; globalThis.requestAnimationFrame = was.raf; }
}

export default [
  {
    name: "a scene reads its own address and its own document",
    run: ({ createPlateWorld }) => withPage(() => {
      const { scope, root } = createPlateWorld({ address: "plate:one?look=2", html: "<main></main>" });
      return [scope.location.href, scope.document.body === root, scope.document.title, scope.window === scope];
    }),
    expect: ["plate:one?look=2", true, "real", true],
  },
  {
    name: "two worlds hold separate state",
    run: ({ createPlateWorld }) => withPage(() => {
      const a = createPlateWorld({ address: "a", html: "" }), b = createPlateWorld({ address: "b", html: "" });
      a.scope.window.mark = 1;
      return [a.scope.location.href, b.scope.location.href, b.scope.document.getElementById("x")];
    }),
    expect: ["a", "b", "found #x"],
  },
  {
    name: "globals are the scene's alone, and resize reaches its listeners",
    run: ({ createPlateWorld }) => withPage(() => {
      const world = createPlateWorld({ address: "a", html: "", globals: { seed: 7 } });
      let heard = 0;
      world.scope.addEventListener("resize", () => { heard += 1; });
      world.resize();
      return [world.scope.seed, "seed" in globalThis, heard];
    }),
    expect: [7, false, 1],
  },
  {
    name: "ending a world stops its frames and removes it",
    run: ({ createPlateWorld }) => withPage(({ frames }) => {
      const world = createPlateWorld({ address: "a", html: "" });
      let ran = 0;
      world.scope.requestAnimationFrame(() => { ran += 1; });
      world.end();
      frames[0](0);
      return [ran, world.root.removed];
    }),
    expect: [0, true],
  },
];

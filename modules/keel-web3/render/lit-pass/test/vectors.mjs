const lit = (log) => ({
  createLitRenderer: () => ({ autoClear: true, setViewport: (...v) => log.push(['viewport', ...v]), render: () => log.push(['render']), resetState: () => log.push(['reset']), dispose() {} }),
  PerspectiveCamera: class {
    position = { set() {} };
    projectionMatrix = { fromArray() { return this; }, multiply() { return this; } };
    projectionMatrixInverse = { copy() { return { invert() {} }; } };
  },
  Matrix4: class { makeTranslation() { return this; } },
});
const context = (log) => ({ canvas: {}, FRAMEBUFFER: 36160, bindFramebuffer(kind, buffer) { log.push(['bind', buffer]); } });
const frame = { clip: new Float32Array(16), origin: [0, 1, 2], width: 8, height: 4, target: 'host' };

export default [
  {
    name: 'draws between two resets, in the host\'s framebuffer when keel/lit asks for the canvas',
    run: ({ createLitPass }) => {
      const log = [], gl = context(log);
      const pass = createLitPass(lit(log), gl);
      const bind = gl.bindFramebuffer;
      pass.draw({}, frame);
      const inDraw = gl.bindFramebuffer !== bind;
      return [log.map((l) => l[0]), log.at(-1)[1], inDraw];
    },
    expect: [['reset', 'viewport', 'render', 'reset', 'bind'], 'host', true],
  },
];

# lit-pass

Draws a keel/lit stage inside a frame some other renderer owns. Any generator that
draws with keel/lit can then go into any host: people in a keel/render city, a lit
prop in a pixel scene, one recipe in another. The host stays the owner of the
context, the canvas and the framebuffer, and knows nothing of what was drawn.

    const pass = createLitPass(lit, gl);
    // inside the host's frame, after its opaque pass:
    pass.draw(stage, { clip, origin, width, height, target });

`clip` is the host's world-to-clip matrix, column-major, and `origin` its eye.
`target` is the framebuffer the host is drawing to, null for the canvas. Nothing is
cleared. GL state is reset afterwards, so a host binds what it needs as it always
does. `keel/lit` is passed in, so this module imports nothing.

A host that keeps its own depth values (keel/render writes a linear depth) needs
what it draws to write the same: `render/skin-body` takes that as `hostDepth`.

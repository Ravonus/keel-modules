# lit-portrait

A portrait of anything `skin-body` can draw, as RGBA for a UI: head and shoulders,
framed by the body's own height so a child and a mohawk sit the same in the frame,
lit by a key, a fill and a rim, drawn larger than asked and brought down. Small
sizes crop closer and have their edges stood back up, so a face reads at 32 pixels.

    const bodies = createSkinBodies(lit);
    const studio = createPortraitStudio(lit, new OffscreenCanvas(32, 32), bodies);
    const one = bodies.add(mesh);
    const rgba = studio.shoot({ one, bones, top: meshTop(mesh.position), head, face, size: 64 });

`bones` is the pose, `head` the height of the head's centre, `top` the highest point
of the mesh. `one` is left hidden, so one studio can hold many sitters. Rows come top
first. `portraitShot` and `shrinkPortrait` are there for anyone drawing their own.
`keel/lit` is passed in, so this module imports nothing.

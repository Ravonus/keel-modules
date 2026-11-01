# skin-body

Skinned meshes for keel/lit, without changing keel/lit: a `CustomMaterial` moves
each vertex by two bones of a palette in the vertex shader, and a matching depth
material carries the pose into the shadow map.

A mesh is plain arrays (`position`, `normal`, a linear colour per vertex, two
bones and a weight), so any generator can feed it; `generative/people` does.
The face is painted per pixel from where it lies at rest, so eyes, blinks,
gaze, brows and a moving mouth stay sharp whatever the mesh's resolution.

    const bodies = createSkinBodies(lit);
    scene.add(bodies.group);
    const one = bodies.add(mesh);
    one.pose(bones, at, yaw, { face: { lid, look, mouth } });
    bodies.light(light);

A face can also carry `browLine` (a brow's height, arch, tilt and half width, in eyes) and `look` (eye shadow, blush, a line along the lashes, freckles, spots, tired eyes and up to two moles). All of it is painted per pixel, so it stays clean on a coarse mesh; leave it out and a face has none.

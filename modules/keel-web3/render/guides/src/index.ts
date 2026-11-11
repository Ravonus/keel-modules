/**
 * guides: a lit keel/lit stage at a camera rendered into guide passes for painters and for image conditioning:
 * depth, normal, part ID, key light, line and flat block-in, each read back as RGBA8, top row first. MIT.
 *
 *   const guides = createGuides(lit, renderer, { tag: bySlot(PARTS, "PART") });
 *   const set = guides.render(stage, camera, { width: 2048, height: 1280 });
 *   const face = idMask(set.passes.id, set.table, ["skin*"]);
 *
 * A part's ID comes from a tagger: by default a mesh's `userData.guide` or its name (`byName`); `bySlot` names a
 * material slot or a shader define. The ID table is the names in code-point order from 1, each with a colour that
 * is distinct, in integer arithmetic, so the same names give the same bytes on every engine.
 *
 * keel/lit is injected: the module never imports it and never touches globals.
 */

export { PASSES, MAX_IDS, byName, bySlot, idColours, idTable, idsOf, idsIn, idMask, depthIn, hexBytes, matches }
  from "./table.js";
export type { GuideId, GuideImage, GuidePass, Rgb, TagMaterial, TagMesh, Tagger } from "./table.js";
export { depthRange, enclose, shadowFrame } from "./frame.js";
export type { Sphere, Vec3 } from "./frame.js";
export {
  PART_VERTEX_GLSL, PART_FRAGMENT_GLSL, SHADOW_FRAGMENT_GLSL, PACK_VERTEX_GLSL, PACK_FRAGMENT_GLSL,
} from "./guides.glsl.js";
export type { GuidesLit } from "./lit.js";
export { createGuides } from "./guides.js";
export type { GuideOptions, GuideSet, Guides } from "./guides.js";

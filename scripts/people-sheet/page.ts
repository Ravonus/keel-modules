// What people-sheet renders, in the browser: people in their clothes, each from three sides, nothing in the way of the cloth.
import * as lit from "keel-lit";
import { createSkinBodies } from "../../modules/keel-web3/render/skin-body/src/index.ts";
import { createPortraitStudio, meshTop } from "../../modules/keel-web3/render/lit-portrait/src/index.ts";
import { meshOf, personOf, poseMesh, skeletonOf } from "../../modules/keel-web3/generative/people/src/index.ts";
import type { Action, Person, PersonMesh, Weather } from "../../modules/keel-web3/generative/people/src/index.ts";

interface Sheet { seeds: number[]; poses: string[]; yaws: number[]; size: number; cell: number; weather: Weather; time: number }
type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];
type Numbers = Float32Array | Uint16Array | Uint32Array | Uint8Array;

const FACE = { lid: 0, look: [0, 0] as const, mouth: 0, smile: 0.2 };
const SEAT = 0.09, WIDE = 0.26, FRONT = 0.2, BACK = 0.28, REST_ON = 0.07, HIGH = 0.5;

/** The chair someone sits on: a solid seat just under their hips and a back behind them, in metres. It is what cloth is judged against: it stops what falls behind and beneath a sitter. */
function chairOf(p: Person): readonly Box[] {
  const hips = skeletonOf(p, "seated", 0).pelvis, k = p.build.size, top = (hips[1] - SEAT) * k, z = hips[2] * k;
  return [[-WIDE, WIDE, 0, top, z - BACK, z + FRONT], [-WIDE, WIDE, top, top + HIGH, z - BACK, z - BACK + REST_ON]];
}

const facesOf = ([x0, x1, y0, y1, z0, z1]: Box): readonly (readonly [readonly number[], readonly (readonly number[])[]])[] => [
  [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
  [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
  [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
  [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
  [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
];

/** A person's mesh with a chair in it, tied to the pelvis so it stays where the pose puts them. The studio draws only skinned bodies, so the chair has to be one. */
function chaired(mesh: PersonMesh, p: Person): PersonMesh {
  const b = poseMesh(p, "seated", 0), row = (r: number, c: number): number => b[r * 4 + c] ?? 0;
  const turned = (v: readonly number[]): number[] => [0, 1, 2].map((c) => row(0, c) * (v[0] ?? 0) + row(1, c) * (v[1] ?? 0) + row(2, c) * (v[2] ?? 0));
  const back = (v: readonly number[]): number[] => turned(v.map((x, r) => x - row(r, 3)));
  const n = mesh.position.length / 3, points: number[] = [], normals: number[] = [], index: number[] = [];
  for (const [normal, corners] of chairOf(p).flatMap(facesOf)) {
    const at = n + points.length / 3;
    for (const corner of corners) { points.push(...back(corner)); normals.push(...turned(normal)); }
    index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  let low = 0;
  for (let i = 0; i < n; i += 1) if ((mesh.position[i * 3 + 1] ?? 0) < (mesh.position[low * 3 + 1] ?? 0)) low = i;
  const more = points.length / 3, out: Record<string, unknown> = { ...mesh };
  for (const [key, value] of Object.entries(mesh)) {
    if (!ArrayBuffer.isView(value) || key === "index") continue;
    const a = value as unknown as Numbers, wide = a.length / n;
    if (!Number.isInteger(wide)) continue;
    const grown = new (a.constructor as new (size: number) => Numbers)(a.length + more * wide);
    grown.set(a);
    for (let i = 0; i < more; i += 1) for (let c = 0; c < wide; c += 1) grown[(n + i) * wide + c] = a[low * wide + c] ?? 0;
    out[key] = grown;
  }
  const grownOf = (key: string): Numbers => out[key] as Numbers;
  grownOf("position").set(points, n * 3);
  grownOf("normal").set(normals, n * 3);
  grownOf("bones").fill(0, n * 2);
  grownOf("weight").fill(1, n);
  const joined = new (mesh.index.constructor as new (size: number) => Numbers)(mesh.index.length + index.length);
  joined.set(mesh.index);
  joined.set(index, mesh.index.length);
  out.index = joined;
  return out as unknown as PersonMesh;
}

/** A sheet name of a pose: `seated` on the chair, `rest` the T-pose, or any action. */
function render(sheet: Sheet): HTMLCanvasElement {
  const { seeds, poses, yaws, size, cell, weather, time } = sheet;
  const bodies = createSkinBodies(lit as never), studio = createPortraitStudio(lit as never, new OffscreenCanvas(32, 32), bodies as never);
  const shots = seeds.flatMap((seed) => poses.flatMap((pose) => yaws.map((yaw) => ({ seed, pose, yaw }))));
  const per = yaws.length * poses.length, canvas = document.createElement("canvas");
  canvas.width = size * per;
  canvas.height = size * seeds.length;
  const page = canvas.getContext("2d");
  if (!page) throw new Error("no 2d canvas");
  page.fillStyle = "#3a3f4a";
  page.fillRect(0, 0, canvas.width, canvas.height);
  shots.forEach(({ seed, pose, yaw }, i) => {
    const p = personOf(seed, weather), action = pose as Action, seated = pose === "seated", plain = meshOf(p, cell), mesh = seated ? chaired(plain, p) : plain;
    const one = bodies.add(mesh as never), top = meshTop(plain.position), x = (i % per) * size, y = Math.floor(i / per) * size;
    one.show(false);
    const frame = studio.shoot({ one, bones: poseMesh(p, action, time), top, head: top * 0.62, face: FACE, size, yaw } as never);
    const tile = new OffscreenCanvas(size, size), inTile = tile.getContext("2d");
    inTile?.putImageData(new ImageData(new Uint8ClampedArray(frame), size, size), 0, 0);
    page.drawImage(tile, x, y);
    page.fillStyle = "#fff";
    page.font = "12px monospace";
    page.fillText(`${String(seed)} ${p.outfit.top}/${p.outfit.bottom} ${pose}`, x + 4, y + 14);
    one.remove();
  });
  return canvas;
}

(globalThis as unknown as { sheet: (s: Sheet) => string }).sheet = (s) => render(s).toDataURL("image/png");

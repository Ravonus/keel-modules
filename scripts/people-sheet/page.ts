// What people-sheet renders, in the browser: people in their clothes, each from three sides, nothing in the way of the cloth.
import * as lit from "keel-lit";
import { createSkinBodies } from "../../modules/keel-web3/render/skin-body/src/index.ts";
import { createPortraitStudio, meshTop } from "../../modules/keel-web3/render/lit-portrait/src/index.ts";
import { createDrape, drapeAt, meshOf, personOf, poseMesh, skeletonOf, velocityAt } from "../../modules/keel-web3/generative/people/src/index.ts";
import type { Action, Person, PersonMesh, Weather } from "../../modules/keel-web3/generative/people/src/index.ts";
import type { Drape } from "../../modules/keel-web3/generative/people/src/index.ts";
import type { SkinMotion } from "../../modules/keel-web3/render/skin-body/src/index.ts";
import { coveredSkin, tinted } from "./cover.ts";

type Vec = readonly [number, number, number];

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
  const bodies = createSkinBodies(lit), studio = createPortraitStudio(lit, new OffscreenCanvas(32, 32), bodies);
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
    const one = bodies.add(mesh), top = meshTop(plain.position), x = (i % per) * size, y = Math.floor(i / per) * size;
    one.show(false);
    const frame = studio.shoot({ one, bones: poseMesh(p, action, time), top, head: top * 0.62, motion: { face: FACE }, size, yaw });
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

/** What one shot of the score shows: how many of the body's pixels are skin its clothes should be over. */
interface Shot { seed: number; pose: string; yaw: number; time: number; top: string; bottom: string; through: number; body: number; frame?: Uint8ClampedArray }

/** How far a channel has to move for a pixel to be the tint and not the renderer's noise. */
const TINTED = 48;

/** The frame with whatever came through in red, and how many pixels that is and how many the body covers. */
function compared(plain: Uint8Array, marked: Uint8Array): { through: number; body: number; frame: Uint8ClampedArray } {
  const frame = new Uint8ClampedArray(plain);
  let through = 0, body = 0;
  for (let i = 0; i < plain.length; i += 4) {
    if ((plain[i + 3] ?? 0) > 0) body += 1;
    if (![0, 1, 2].some((c) => Math.abs((plain[i + c] ?? 0) - (marked[i + c] ?? 0)) > TINTED)) continue;
    through += 1;
    frame.set([255, 0, 0, 255], i);
  }
  return { through, body, frame };
}

/** What a posed body is given of its cloth's state. */
const motionOf = ({ trail, twist, wave, phase }: Drape, time: number): SkinMotion => (
  { face: FACE, sway: [...trail, time], drape: sheetDrape ? [twist, wave, phase] : [0, 0, 0] });
let sheetDrape = true;

/** A run of frames through a stop and a turn, side on, stepped as a host would: what cloth does after the body. */
function film({ seeds, cell, size }: Sheet): HTMLCanvasElement {
  const bodies = createSkinBodies(lit), studio = createPortraitStudio(lit, new OffscreenCanvas(32, 32), bodies);
  const beats = [["walk", 1.4, 0], ["stand", 1, 0], ["stand", 0.7, 3.2], ["stand", 1, 0]] as const;
  const frames = 30, canvas = document.createElement("canvas");
  canvas.width = size * frames;
  canvas.height = size * seeds.length;
  const page = canvas.getContext("2d");
  seeds.forEach((seed, row) => {
    const p = personOf(seed), mesh = meshOf(p, cell), top = meshTop(mesh.position), one = bodies.add(mesh), drape = createDrape(p);
    one.show(false);
    let time = 0, yaw = 1.5, shot = 0, next = 0, was: Action = "walk";
    for (const [action, long, turn] of beats) {
      for (let at = 0; at < long; at += 1 / 60) {
        time += 1 / 60;
        yaw += turn / 60;
        const fade = Math.min(1, at / 0.25), from = was === action ? undefined : { action: was, t: time, k: 1 - fade };
        const own = velocityAt(p, action, time), left = velocityAt(p, was, time);
        const now = drape.step(1 / 60, { velocity: own.map((v, i) => v * fade + (left[i] ?? 0) * (1 - fade)) as unknown as Vec, turn });
        if (time < next) continue;
        next += 0.12;
        const frame = studio.shoot({ one, bones: poseMesh(p, action, time, from), top, head: top * 0.62, motion: motionOf(now, time), size, yaw });
        page?.putImageData(new ImageData(new Uint8ClampedArray(frame), size, size), shot * size, row * size);
        shot += 1;
      }
      was = action;
    }
    one.remove();
  });
  return canvas;
}

/** Every shot of a sheet scored, each rendered twice, plain and with its covered skin tinted. */
function score(sheet: Sheet & { times: number[]; worst: number; drape?: boolean }): { shots: Shot[]; png: string } {
  const { seeds, poses, yaws, size, cell, weather, times, worst } = sheet;
  sheetDrape = sheet.drape !== false;
  const bodies = createSkinBodies(lit), studio = createPortraitStudio(lit, new OffscreenCanvas(32, 32), bodies);
  const shots: Shot[] = [];
  for (const seed of seeds) for (const pose of poses) {
    const p = personOf(seed, weather), plain = meshOf(p, cell), covered = coveredSkin(plain);
    const mesh = pose === "seated" ? chaired(plain, p) : plain, top = meshTop(plain.position);
    const ones = [bodies.add(mesh), bodies.add(tinted(mesh, covered))];
    for (const one of ones) one.show(false);
    for (const yaw of yaws) for (const time of times) {
      const bones = poseMesh(p, pose as Action, time), motion = motionOf(drapeAt(p, pose as Action, time), time);
      const [a, b] = ones.map((one) => studio.shoot({ one, bones, top, head: top * 0.62, motion, size, yaw }));
      if (!a || !b) continue;
      shots.push({ seed, pose, yaw, time, top: p.outfit.top, bottom: p.outfit.bottom, ...compared(a, b) });
    }
    for (const one of ones) one.remove();
  }
  const canvas = document.createElement("canvas"), hits = [...shots].sort((a, b) => b.through / b.body - a.through / a.body).slice(0, worst);
  canvas.width = size * Math.min(6, hits.length || 1);
  canvas.height = size * Math.ceil(hits.length / 6 || 1);
  const page = canvas.getContext("2d");
  hits.forEach((shot, i) => {
    if (shot.frame) page?.putImageData(new ImageData(new Uint8ClampedArray(shot.frame), size, size), (i % 6) * size, Math.floor(i / 6) * size);
  });
  return { shots: shots.map(({ frame: _, ...rest }) => rest), png: canvas.toDataURL("image/png") };
}

const pageApi = globalThis as unknown as { sheet: (s: Sheet) => string; score: typeof score; film: (s: Sheet) => string };
pageApi.film = (s) => film(s).toDataURL("image/png");
pageApi.sheet = (s) => render(s).toDataURL("image/png");
pageApi.score = score;

// Part signals: filters tagged onto parts of the scene, and the detail layer.

import { bounded } from "./settings.js";
import type { MaterialLike, NodeLike } from "./lit.js";

// ---------------------------------------------------------------- part signals

/** One of three scene parts a host can tag (say platform, tree, background) to give it its own signal. */
export type SignalPart = 1 | 2 | 3;
/**
 * The filters a part can wear on top of its signal, in the shader's numbering. Some move pixels
 * (mosaic, vhs, wave, slitscan, pixelsort, datamosh), the rest change colour before the tones are
 * stepped, so a filtered part is still dithered pixel art.
 */
export const SIGNAL_FILTERS = ["none", "snow", "film", "mosaic", "cga", "negative", "glow", "vhs", "bleed", "wave", "nightvision", "sparkle", "thermal", "neon", "rainbow", "slitscan", "pixelsort", "datamosh", "holo"] as const;
export type SignalFilter = (typeof SIGNAL_FILTERS)[number];

/**
 * A part's own scanlines, colour fringe and glitch, each 0 to 1, and an optional filter at `amount` (0 to 1, default
 * 1).
 */
export interface SignalSpec {
  readonly scanlines?: number;
  readonly chroma?: number;
  readonly glitch?: number;
  readonly filter?: SignalFilter;
  readonly amount?: number;
}

/** The alpha a tagged material writes into the scene target; untagged pixels keep 1. */
export const SIGNAL_TAG_ALPHA: Readonly<Record<SignalPart, number>> = { 1: 0.25, 2: 0.5, 3: 0.75 };

/** Packs up to three part signals into the shader's uniform, in part order. */
export function signalUniform(parts: readonly (SignalSpec | null | undefined)[]): Float32Array {
  const data = new Float32Array(9);
  for (let index = 0; index < 3; index += 1) {
    const part = parts[index];
    if (part === null || part === undefined) continue;
    data[index * 3] = bounded(part.scanlines, 0, 1, 0);
    data[index * 3 + 1] = bounded(part.chroma, 0, 1, 0);
    data[index * 3 + 2] = bounded(part.glitch, 0, 1, 0);
  }
  return data;
}

/** Packs up to three part filters into the shader's uniform: each filter's number and amount, in part order. */
export function filterUniform(parts: readonly (SignalSpec | null | undefined)[]): Float32Array {
  const data = new Float32Array(6);
  for (let index = 0; index < 3; index += 1) {
    const part = parts[index];
    const filter = part?.filter === undefined ? -1 : SIGNAL_FILTERS.indexOf(part.filter);
    if (part === null || part === undefined || filter <= 0) continue;
    data[index * 2] = filter;
    data[index * 2 + 1] = bounded(part.amount, 0, 1, 1);
  }
  return data;
}

interface SignalBase {
  readonly compile: MaterialLike["onCompile"];
  readonly key: MaterialLike["customProgramCacheKey"];
}

/**
 * Makes an opaque material write its part's tag into alpha after its own
 * shading. Transparent materials blend alpha, so they stay untagged.
 */
function tagMaterial(material: MaterialLike, part: SignalPart): void {
  if (material.transparent || material.userData.voxelDitherSignal === part) return;
  const base = (material.userData.voxelDitherSignalBase as SignalBase | undefined) ?? {
    compile: material.onCompile,
    key: material.customProgramCacheKey,
  };
  material.userData.voxelDitherSignalBase = base;
  material.userData.voxelDitherSignal = part;
  const alpha = SIGNAL_TAG_ALPHA[part].toFixed(2);
  material.onCompile = (shader, renderer) => {
    base.compile?.call(material, shader, renderer);
    const end = shader.fragmentShader.lastIndexOf("}");
    shader.fragmentShader = `${shader.fragmentShader.slice(0, end)}  gl_FragColor.a = ${alpha};\n}\n`;
  };
  material.customProgramCacheKey = () => `${base.key?.call(material) ?? ""}|voxel-dither-signal-${String(part)}`;
  material.needsUpdate = true;
}

export function tagTree(root: NodeLike, part: SignalPart): void {
  root.traverse((node) => {
    if (node.isMesh !== true || node.material === undefined) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) tagMaterial(material, part);
  });
}

/**
 * The layer detail parts are drawn on. The world pass leaves it out and the
 * detail pass sees nothing else; a host's camera should not use it.
 */
export const DETAIL_LAYER = 30;
export const DETAIL_MASK = (1 << DETAIL_LAYER) >>> 0;

/**
 * Puts the meshes under each root that draw colour on the detail layer (only
 * there). A mesh that draws no colour, such as a shadow proxy, stays with the
 * world, so the parts still cast their shadows on it.
 */
export function layerDetail(roots: ReadonlySet<NodeLike>, split: boolean): void {
  for (const root of roots) {
    root.traverse((node) => {
      if (node.isMesh !== true || node.layers === undefined) return;
      const materials =
        node.material === undefined ? [] : Array.isArray(node.material) ? node.material : [node.material];
      if (materials.every((material) => material.colorWrite === false)) return;
      node.layers.mask = split ? DETAIL_MASK : 1;
    });
  }
}

// The middle distance as dabs: rows of spires, banks of round crowns, a town of walls and towers on a rise, and each
// of them again upside down in the water.
import { KIND, mix, rgb, type Dab } from "./dab.js";
import { draws, type Draw } from "./exact.js";
import type { PlateRecipe, TownRecipe, TreeRecipe } from "./recipe.js";

const UP = { ax: 0, ay: -1 } as const;

/** One tree: its foot, then the dab. */
function treeOf(row: TreeRecipe, draw: Draw): { foot: number; dab: Dab } {
  const x = draw.within(row.x[0], row.x[1]);
  const foot = draw.within(row.y[0], row.y[1]);
  const h = draw.within(row.height[0], row.height[1]);
  const spire = row.kind === "spire";
  const len = spire ? h / 2 : h * 0.55;
  const wid = spire ? h * draw.within(0.1, 0.15) : h * draw.within(0.42, 0.62);
  const dab: Dab = {
    x, y: foot - len * 0.92, len, wid, ...UP, kind: spire ? KIND.spire : KIND.crown, seed: draw(),
    color: mix(rgb(row.color), rgb(row.lit), draw.within(0, 0.25)), alpha: 1, light: draw.within(0.35, 0.7),
    variant: 1, water: 0, depth: row.depth,
  };
  return { foot, dab };
}

/** A wall or a tower standing on `foot`, its left edge at `left`. */
function wallOf(town: TownRecipe, draw: Draw, at: { left: number; foot: number; tower: boolean }): Dab {
  const span = at.tower ? town.tower : town.height;
  const h = draw.within(span[0], span[1]);
  const w = at.tower ? draw.within(0.006, 0.01) : draw.within(0.012, 0.026);
  return {
    x: at.left + w / 2, y: at.foot - h / 2, len: h / 2, wid: w * 0.8, ...UP, kind: KIND.wall, seed: draw(),
    color: mix(rgb(town.lit), rgb(town.shade), draw.within(0, 0.3)), alpha: 1, light: draw.within(0.55, 0.9),
    variant: draw.within(0.2, 0.45), water: 0, depth: town.depth,
  };
}

/** The town: a low rise of rock, walls across it, towers among them. */
function townOf(town: TownRecipe, draw: Draw): { foot: number; dab: Dab }[] {
  const width = town.x[1] - town.x[0];
  const rock: Dab = {
    x: town.x[0] + width / 2, y: town.y - 0.004, len: width * 0.62, wid: 0.011, ax: 1, ay: 0, kind: KIND.blot,
    seed: draw(), color: rgb(town.rock), alpha: 1, light: 0.6, variant: 1, water: 0, depth: town.depth,
  };
  const out = [{ foot: town.y - 0.001, dab: rock }];
  const towers = new Set<number>();
  while (towers.size < Math.min(town.towers, town.walls)) towers.add(Math.floor(draw() * town.walls));
  for (let i = 0; i < town.walls; i += 1) {
    const left = town.x[0] + (width * (i + draw.within(-0.2, 0.2))) / town.walls;
    const foot = town.y - 0.008 + draw.within(-0.002, 0.003);
    out.push({ foot, dab: wallOf(town, draw, { left, foot, tower: towers.has(i) }) });
  }
  return out;
}

/** A dab upside down about its foot, darker, clipped to the water below the foot. */
function reflected(dab: Dab, foot: number, deep: string): Dab {
  return {
    ...dab, y: 2 * foot - dab.y, len: dab.len * 1.08, ay: -dab.ay,
    color: mix(dab.color, rgb(deep), 0.3), alpha: 0.62, water: foot,
  };
}

/** Every dab of the middle distance, reflections first, then far to near. */
export function sceneDabs(recipe: PlateRecipe, seed: number): Dab[] {
  const standing: { foot: number; dab: Dab }[] = [];
  recipe.trees.forEach((row, i) => {
    const draw = draws(seed, 200 + i);
    for (let k = 0; k < row.count; k += 1) standing.push(treeOf(row, draw));
  });
  if (recipe.town) standing.push(...townOf(recipe.town, draws(seed, 300)));
  // (Far to near is foot y up to down; a tie keeps the recipe's order.)
  standing.sort((a, b) => a.foot - b.foot);
  const mirror = standing
    .filter(({ foot }) => foot < recipe.water.near - 0.02)
    .map(({ foot, dab }) => reflected(dab, Math.max(foot, recipe.shore.y), recipe.water.deep));
  return [...mirror, ...standing.map(({ dab }) => dab)];
}

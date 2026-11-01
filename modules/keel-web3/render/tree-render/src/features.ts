// Switches: the parts of a tree a plugin string can turn off and back on.

// ---------------------------------------------------------------- switches

export const TREE_FEATURES = ["roots", "leaves", "flowers", "fruit", "deadwood", "litter", "snow", "fallers", "sway", "shadows", "crownShade", "bark", "sprays", "clumps", "rootSink", "rootBreak"] as const;
export type TreeFeature = (typeof TREE_FEATURES)[number];
export type TreeFeatures = Readonly<Record<TreeFeature, boolean>>;

const isFeature = (name: string): name is TreeFeature => (TREE_FEATURES as readonly string[]).includes(name);

/**
 * Feature switches, all on by default. Pass an object ({ roots: false }) or a
 * plugin string: "-roots,-fruit" turns those off, "roots=off" too, and a bare
 * name or "name=on" turns one back on. Unknown names are ignored.
 */
export function treeFeatures(input: Partial<Record<TreeFeature, boolean>> | string = {}): TreeFeatures {
  const out = Object.fromEntries(TREE_FEATURES.map((name) => [name, true])) as Record<TreeFeature, boolean>;
  if (typeof input !== "string") {
    for (const name of TREE_FEATURES) out[name] = input[name] ?? true;
    return out;
  }
  for (const raw of input.split(/[,\s]+/)) {
    const [word = "", value] = raw.trim().split("=");
    const off = word.startsWith("-") || value === "off" || value === "0" || value === "false";
    const name = word.replace(/^[-+]/, "");
    if (isFeature(name)) out[name] = !off;
  }
  return out;
}

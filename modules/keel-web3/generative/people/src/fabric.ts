// Fabric: what each garment, hat and body is cut from, as the mesh numbers them.

import { hashed } from "./roll.js";
import type { Bottom, Costume, Hat, Person, Top } from "./person.js";

/** Each stuff a person can be made of or dressed in, as `fabric` numbers them. */
export const FABRICS = { skin: 0, cotton: 1, denim: 2, hair: 3, knit: 4, leather: 5, fur: 6, wool: 7, satin: 8, latex: 9, nylon: 10, quilted: 11, tartan: 12, pinstripe: 13, corduroy: 14 } as const;
type Fabric = keyof typeof FABRICS;

/** What each garment may be cut from, a seed choosing. */
const TOP_CLOTH: Readonly<Record<Top, readonly Fabric[]>> = {
  tee: ["cotton"], polo: ["cotton"], tank: ["cotton"], long: ["cotton", "cotton", "tartan", "knit"], hoodie: ["knit"], jacket: ["leather", "denim", "wool"], blazer: ["wool", "wool", "pinstripe"],
  coat: ["wool"], robe: ["satin"], dress: ["cotton", "satin", "tartan"], raincoat: ["nylon", "nylon", "latex"], puffer: ["quilted"], swimsuit: ["cotton", "satin", "nylon"], bikini: ["cotton", "nylon"], string: ["cotton", "satin"], bare: ["cotton"],
};
const BOTTOM_CLOTH: Readonly<Record<Bottom, readonly Fabric[]>> = { jeans: ["denim"], trousers: ["wool", "corduroy", "pinstripe"], shorts: ["cotton", "denim"], skirt: ["cotton", "tartan", "satin", "wool"], leggings: ["knit"], cargo: ["cotton", "corduroy"], swim: ["cotton", "nylon"], briefs: ["cotton", "satin"] };
/** A uniform is cut from one thing, whatever its seed. */
const COSTUME_CLOTH: Partial<Readonly<Record<Costume, Fabric>>> = { suit: "wool", firefighter: "nylon", police: "cotton", latex: "latex" };

const chosenCloth = (p: Person, list: readonly Fabric[], salt: number): number => FABRICS[COSTUME_CLOTH[p.outfit.costume] ?? list[Math.floor(hashed(p.seed, salt) * list.length)] ?? "cotton"];
export const topCloth = (p: Person): number => chosenCloth(p, TOP_CLOTH[p.outfit.top], 311);
export const lowerCloth = (p: Person): number => chosenCloth(p, BOTTOM_CLOTH[p.outfit.bottom], 523);
/** What a hat is made of. */
const HAT_CLOTH: Partial<Record<Hat, keyof typeof FABRICS>> = { helmet: "latex", hardhat: "latex", beanie: "knit", pompom: "knit", cap: "cotton", hood: "cotton", bucket: "cotton", visor: "cotton", bandana: "cotton", headwrap: "cotton" };
export const hatCloth = (hat: Hat): number => FABRICS[HAT_CLOTH[hat] ?? "wool"];

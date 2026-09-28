/**
 * The numbers the About page quotes, read from the same data files the map and the forge run on,
 * so the text cannot drift from the tools: how many recipes each catalogue holds, what each anvil
 * action does, and where kaolin clay can form. `en-site.ts` names them `{likeThis}`.
 *
 * Nothing here is new game logic. The one derivation, `discVeinBand`, restates what the disc-vein
 * port (`src/worldgen/tfc-1.20/features/disc-vein.ts`) already does, and
 * tests/unit/site-facts.test.ts holds the two together.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import tfcRecipes from '../../data/tfc-1.20/anvil-recipes.json';
import tfgRecipes from '../../data/tfg/anvil-recipes.json';
import tfcAnvil from '../../data/tfc-1.20/anvil.json';
import tfcVeins from '../../data/tfc-1.20/veins.json';
import tfcBiomeTags from '../../data/tfc-1.20/biome-tags.json';
import tfgKaolin from '../../data/tfg/kaolin.json';
import tfgBiomes from '../../data/tfg/biomes.json';
import { en } from '../../ui/i18n/en';
import { formatList } from './markup';

export interface SiteFacts {
  readonly tfcRecipes: number;
  readonly tfgRecipes: number;
  /** Every anvil action in the order a player reads them (hits, then draw, then the rest). */
  readonly actions: readonly { readonly label: string; readonly delta: number }[];
  readonly kaolin: {
    /** One chunk in `rarity` rolls a patch (`VeinFeature#getVeinsAtChunk`). */
    readonly rarity: number;
    /** The Y band every block of a patch lies in. */
    readonly minY: number;
    readonly maxY: number;
    /** The widest a patch can be, in blocks: its bounding box. */
    readonly across: number;
    /** `ClimatePlacement`: both are inclusive minimums. */
    readonly minTemperature: number;
    readonly minRainfall: number;
    /** Biome names, as the map's legend shows them. */
    readonly tfcBiomes: readonly string[];
    readonly tfgBiomes: readonly string[];
  };
}

/** Keys of `src/data/<profile>/anvil.json`'s `actions`, with the names the forge shows. */
const ACTIONS: readonly (readonly [keyof typeof tfcAnvil.actions, string])[] = [
  ['hit_light', en.forge.hitStrengthNames.LIGHT],
  ['hit_medium', en.forge.hitStrengthNames.MEDIUM],
  ['hit_hard', en.forge.hitStrengthNames.HARD],
  ['draw', en.forge.actionNames.DRAW],
  ['punch', en.forge.actionNames.PUNCH],
  ['bend', en.forge.actionNames.BEND],
  ['upset', en.forge.actionNames.UPSET],
  ['shrink', en.forge.actionNames.SHRINK],
];

/**
 * The Y band a disc vein's blocks can occupy. `DiscVeinFeature#defaultPosRespectingHeight` picks the
 * centre with `VeinFeature#defaultYPos(config.size(), ...)`: somewhere in `[minY + size, maxY - size)`
 * when that range is positive, otherwise always `(minY + maxY) / 2` (Java int division). The disc
 * then reaches `height` blocks either side of it (`DiscVeinFeature#getChanceToGenerate`,
 * `|y| <= height`). Kaolin is the second case: 110 - 75 - 2 * 18 < 0, so every patch is centred
 * on Y 92 and spans Y 86 to 98.
 */
export function discVeinBand(vein: {
  readonly minY: number;
  readonly maxY: number;
  readonly size: number;
  readonly height: number;
}): { readonly minY: number; readonly maxY: number } {
  const range = vein.maxY - vein.minY - 2 * vein.size;
  const lowest = range > 0 ? vein.minY + vein.size : Math.trunc((vein.minY + vein.maxY) / 2);
  const highest = range > 0 ? vein.minY + vein.size + range - 1 : lowest;
  return { minY: lowest - vein.height, maxY: highest + vein.height };
}

/** The one climate gate on TerraFirmaCraft's kaolin placed feature, as the installed pack ships it. */
function kaolinClimate(): { readonly minTemperature: number; readonly minRainfall: number } {
  const gate = tfgKaolin.placedFeature.placement.find((entry) => entry.type === 'tfc:climate');
  if (gate === undefined) throw new Error('src/data/tfg/kaolin.json: no tfc:climate placement');
  return { minTemperature: gate.min_temperature, minRainfall: gate.min_rainfall };
}

export function siteFacts(): SiteFacts {
  const disc = tfcVeins.veins.kaolin_disc;
  const band = discVeinBand({
    minY: disc.min_y,
    maxY: disc.max_y,
    size: disc.size,
    height: disc.height,
  });
  const tfcTag = tfcBiomeTags.tags['tfc:kaolin_clay_spawns_in'];
  const biomeNames: Readonly<Record<string, string>> = en.biomeNames;
  const tfgNames: Readonly<Record<string, string>> = tfgBiomes.names;
  return {
    tfcRecipes: Object.keys(tfcRecipes.recipes).length,
    tfgRecipes: Object.keys(tfgRecipes.recipes).length,
    actions: ACTIONS.map(([key, label]) => ({ label, delta: tfcAnvil.actions[key] })),
    kaolin: {
      rarity: disc.rarity,
      minY: band.minY,
      maxY: band.maxY,
      across: 2 * disc.size + 1,
      ...kaolinClimate(),
      tfcBiomes: tfcTag.map((id) => biomeNames[id] ?? id),
      // The tag also names tfc: biomes TerraFirmaGreg's overworld never generates; its own list is
      // the tfg: ones, which are the ones with a name in its biome table.
      tfgBiomes: tfgKaolin.biomes.flatMap((id) => {
        const name = tfgNames[id];
        return name === undefined ? [] : [name];
      }),
    },
  };
}

/** A signed step as the forge's docs write it: `−15`, `+2` (a real minus sign, not a hyphen). */
export function formatDelta(delta: number): string {
  return delta < 0 ? `\u2212${-delta}` : `+${delta}`;
}

/** The text each `{placeholder}` in `en-site.ts` stands for. */
export function factPlaceholders(facts: SiteFacts): Readonly<Record<string, string>> {
  const count = (n: number): string => n.toLocaleString('en-US');
  return {
    tfcRecipes: count(facts.tfcRecipes),
    tfgRecipes: count(facts.tfgRecipes),
    actions: formatList(
      facts.actions.map((action) => `${action.label} ${formatDelta(action.delta)}`),
    ),
    kaolinRarity: String(facts.kaolin.rarity),
    kaolinMinY: String(facts.kaolin.minY),
    kaolinMaxY: String(facts.kaolin.maxY),
    kaolinAcross: String(facts.kaolin.across),
    kaolinMinTemperature: String(facts.kaolin.minTemperature),
    kaolinMinRainfall: String(facts.kaolin.minRainfall),
    tfcKaolinBiomes: formatList(facts.kaolin.tfcBiomes),
    tfgKaolinBiomes: formatList(facts.kaolin.tfgBiomes),
  };
}

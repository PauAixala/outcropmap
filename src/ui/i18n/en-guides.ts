/**
 * The words of the guides: guides.html and every page it lists (src/app/site/site.ts, `GUIDE_IDS`),
 * and the short anvil section at the end of the forge page. `src/app/site/guides.ts` writes them
 * into the HTML at build time, around tables built from game data (`guide-tables.ts`), so a crawler
 * that runs no JavaScript reads exactly what a visitor does.
 *
 * The rules of `en-site.ts` hold here too (AGENTS.md section 2): everything must be true of the game
 * data and of the tools as built, never claim more accuracy than the tests back, and no number from
 * game data is typed here. `{likeThis}` is filled in from the data at build time
 * (`src/app/site/guides.ts`, `guidePlaceholders`); an unknown one fails the build.
 *
 * Sources for the statements that are not data, in the order they appear:
 * - grades, deposits and panning: TerraFirmaCraft 1.20's `data/tfc/recipes/heating/ore/*.json`
 *   (poor, normal and rich ore melt into rising amounts of metal) and `data/tfc/tfc/panning/deposits`;
 * - indicators: `VeinFeature#place`, `Math.abs(indicatorY - maxVeinY) < indicator.depth()`;
 * - surface-relative veins: `VeinFeature#place`, `projectToSurface`;
 * - the anvil: `ForgeStep`, `AnvilBlockEntity` (work below 0 or above `ForgeStep.LIMIT` destroys the
 *   item), `AnvilRecipe#computeTarget`, `Metal.Tier`, `Metal.BlockType.ANVIL` and `RockAnvilBlock`;
 * - rock categories: `ChooseRocks#findClosestType` (TFC) and src/worldgen/tfg/region/tasks.ts (TFG);
 * - structures: `RandomSpreadStructurePlacement`, src/worldgen/tfg/structures.ts.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import { en } from './en';
import type { Block } from './en-site';
import type { GuideId } from '../../app/site/site';

const tfg = en.profileNames.tfg;
const tfc = en.profileNames['tfc-1.20'];

/** The tables a guide can place. `src/app/site/guide-tables.ts` builds each from game data. */
export const GUIDE_TABLE_IDS = [
  'tfgVeins',
  'tfgMaterials',
  'tfgBiomeGroups',
  'tfcVeins',
  'tfcMaterials',
  'rocks',
  'rockLayers',
  'rockStarts',
  'anvilActions',
  'anvilExample',
  'anvilTiers',
  'anvilRecipes',
  'structuresOverworld',
  'structuresAvoid',
  'structuresElsewhere',
  'dimensions',
  'beneathVeins',
  'moonVeins',
  'marsVeins',
  'venusVeins',
] as const;
export type GuideTableId = (typeof GUIDE_TABLE_IDS)[number];

/** A paragraph or list, or one of the data tables. */
export type GuideBlock = Block | { readonly table: GuideTableId };

export interface GuideSection {
  /** The fragment id, e.g. `materials` for tfg-ore-veins.html#materials. */
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly GuideBlock[];
}

export interface GuideCopy {
  /** The page's heading. */
  readonly title: string;
  /** Its name in the guides list, the breadcrumb and "related guides". */
  readonly short: string;
  /** The meta description: 50 to 160 characters once its placeholders are filled. */
  readonly description: string;
  /** One sentence for the guides list and llms.txt. */
  readonly summary: string;
  readonly lead: readonly Block[];
  readonly sections: readonly GuideSection[];
  /** Other guides worth reading next. */
  readonly related: readonly GuideId[];
}

export interface GuideTableCopy {
  readonly caption: string;
  readonly columns: readonly string[];
}

/** Item kinds whose id does not read as a name ("propick head"). Everything else is the id. */
export const enGuideKindNames: Readonly<Record<string, string>> = {
  propick_head: 'Prospector’s pick head',
  unfinished_lamp: 'Unfinished lamp',
  iron_door: 'Iron door',
  steel_pipe: 'Steel pipe',
};

export const enGuides = {
  /** Labels shared by every guide. */
  common: {
    breadcrumbLabel: 'You are here',
    contentsLabel: 'On this page',
    relatedHeading: 'Related guides',
    sourceNote:
      'Values on this page are read at build time from the same game data the map and the forge calculator use. Found a mistake? ',
    sourceLink: 'Open an issue',
  },

  /** How table cells read. `{name}` here is filled by guide-tables.ts, not by the page text. */
  formats: {
    yAbsolute: '{min} to {max}',
    yBelowSurface: '{top} to {bottom} blocks down',
    yFromSurface: 'surface to {bottom} blocks down',
    rarity: '1 in {n}',
    cluster: 'Cluster, size {size}',
    disc: 'Disc, {across} across, {thick} thick',
    pipe: 'Pipe, radius {radius}',
    grades: 'poor {poor}, normal {normal}, rich {rich}',
    deposit: '{name} deposit',
    indicatorDepth: 'if under {depth} blocks deep',
    indicatorNamed: '{names}, if under {depth} blocks deep',
    indicatorNone: 'None',
    measured: '{percent}',
    measuredHidden: '{percent}, hidden on the map',
    measuredNone: 'Not enough data',
    onlyIn: 'Only in {biomes}',
    onlyInMany: 'Only in {count} biomes, listed under Veins that need a biome',
    nearLava: 'Only next to lava; not drawn on the map',
    kaolinNote: 'Climate-limited too: see the kaolin guide',
    noHosts: '—',
    tier: 'Tier {tier}',
    anyTier: 'Any anvil',
    metalTier: '{metal} ({tier})',
    climateTemperature: '{min} to {max} °C',
    climateTemperatureMin: 'at least {min} °C',
    climateTemperatureMax: 'at most {max} °C',
    climateRainfall: '{min} to {max} mm',
    climateRainfallMin: 'at least {min} mm',
    climateRainfallMax: 'at most {max} mm',
    climateForestMin: 'forest at least {forest}',
    climateForestMax: 'forest at most {forest}',
    climateAny: 'Any climate',
    spacing: 'One per {spacing} × {spacing} chunks',
    separation: '{separation} chunks',
    separationOne: '1 chunk',
    groundHeight: 'Ground at Y {min} to {max}',
    groundAny: '—',
    keepsClear: 'At least {chunks} chunks from: {set}',
    avoidRadius: '{radius} blocks: {structures}',
    variantWeight: '{name} ({weight})',
    biomeCount: '{count} biomes',
    work: '{work}',
    yRange: 'Y {min} to {max}',
    none: 'None',
  },

  /** Display names for TerraFirmaCraft's `ForestType`, as the climate column reads them. */
  forests: {
    none: 'none',
    sparse: 'sparse',
    edge: 'forest edge',
    normal: 'normal',
    old_growth: 'old growth',
  } as Record<string, string>,

  tables: {
    tfgVeins: {
      caption: `Every ore vein in the ${tfg} overworld`,
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Host rock', 'Surface indicators', 'Measured hit rate'],
    },
    tfgMaterials: {
      caption: `Which ${tfg} veins yield each material`,
      columns: ['Material', 'Veins, richest first'],
    },
    tfgBiomeGroups: {
      caption: `${tfg} veins that only form in some biomes`,
      columns: ['Biome group', 'Biomes', 'Veins'],
    },
    tfcVeins: {
      caption: 'Every ore vein in the TerraFirmaCraft 1.20 overworld',
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Host rock', 'Surface indicators'],
    },
    tfcMaterials: {
      caption: 'Which TerraFirmaCraft 1.20 veins yield each mineral',
      columns: ['Mineral', 'Veins, richest first'],
    },
    rocks: {
      caption: 'The twenty rocks, and the ore veins that can form in each',
      columns: ['Rock', 'Category', 'TerraFirmaCraft 1.20 veins', `${tfg} veins`],
    },
    rockLayers: {
      caption: 'Each layer, the rocks it can hold, and the layer under each rock',
      columns: ['Layer', 'Rock', 'Next layer down'],
    },
    rockStarts: {
      caption: 'Where each kind of area starts its stack',
      columns: ['Area', 'Where it is', 'Top layer, one of'],
    },
    anvilActions: {
      caption: 'The eight anvil actions',
      columns: ['Action', 'Moves the work by'],
    },
    anvilExample: {
      caption: 'A copper pickaxe head with a target of {exampleTarget}, as the forge calculator solves it',
      columns: ['Strike', 'Action', 'Moves the work by', 'Work after the strike'],
    },
    anvilTiers: {
      caption: 'How many recipes need each anvil tier',
      columns: ['Tier', 'TerraFirmaCraft 1.20 recipes', `${tfg} recipes`],
    },
    anvilRecipes: {
      caption: 'The finishing rules of every TerraFirmaCraft 1.20 anvil recipe, by item',
      columns: ['Item', 'Finishing rules, in the order you strike them', 'Made from', 'Metals and anvil tier'],
    },
    structuresOverworld: {
      caption: `Structures in the ${tfg} overworld`,
      columns: ['Structure', 'Variants (weight)', 'Spacing', 'Never closer than', 'Climate', 'Ground', 'Biomes'],
    },
    structuresAvoid: {
      caption: 'Biomes the overworld structures keep away from',
      columns: ['Keeps away from', 'How far, by structure'],
    },
    structuresElsewhere: {
      caption: 'Structures in the Beneath and on the Moon',
      columns: ['Structure', 'Where', 'Spacing', 'Never closer than', 'Keeps clear of', 'Biomes'],
    },
    dimensions: {
      caption: `${tfg}’s dimensions beyond the overworld`,
      columns: ['Dimension', 'Ore veins', 'Structures', 'Biomes'],
    },
    beneathVeins: {
      caption: 'Every ore vein in the Beneath',
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Biome', 'Measured hit rate'],
    },
    moonVeins: {
      caption: 'Every ore vein on the Moon',
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Host rock', 'Measured hit rate'],
    },
    marsVeins: {
      caption: 'Every ore vein on Mars',
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Host rock', 'Measured hit rate'],
    },
    venusVeins: {
      caption: 'Every ore vein on Venus',
      columns: ['Vein', 'Yields', 'Y range', 'Chunks per vein', 'Shape and size', 'Host rock', 'Measured hit rate'],
    },
  } satisfies Record<GuideTableId, GuideTableCopy>,

  /** Rock-layer areas: what `ChooseRocks` calls OCEAN, VOLCANIC, LAND and UPLIFT. */
  rockStarts: {
    oceanFloor: {
      name: 'Ocean floor',
      where: 'Under the sea.',
    },
    volcanic: {
      name: 'Volcanic',
      where: 'Near volcanic islands; in TerraFirmaGreg, also near its volcanic hot spots.',
    },
    uplift: {
      name: 'Uplift',
      where: 'Near mountains, inland and on the coast.',
    },
    land: {
      name: 'Land',
      where: 'Everywhere else on land.',
    },
  },

  /** Layer ids in `rock_layer_settings`, as the table names them. */
  layerNames: {
    bottom: 'Bottom',
    felsic: 'Felsic',
    intermediate: 'Intermediate',
    mafic: 'Mafic',
    igneous_extrusive: 'Igneous extrusive',
    igneous_extrusive_x2: 'Igneous extrusive, doubled',
    marble: 'Marble',
    phyllite: 'Phyllite',
    quartzite: 'Quartzite',
    sedimentary: 'Sedimentary',
    slate: 'Slate',
    uplift: 'Uplift',
  } as Record<string, string>,

  index: {
    title: 'Guides to TerraFirmaCraft and TerraFirmaGreg',
    description:
      'Reference guides for TerraFirmaCraft 1.20 and TerraFirmaGreg: every ore vein, the rock layers, kaolin clay, the anvil’s rules, structures and the planets.',
    lead: [
      {
        p: [
          'Reference pages for planning a TerraFirmaCraft or TerraFirmaGreg world: where each ore forms and in which rock, how deep to dig, where kaolin clay hides, how the anvil’s finishing rules work, and what TerraFirmaGreg’s structures, Beneath and planets hold.',
        ],
      },
      {
        p: [
          `Every number on these pages is read from the same game data the `,
          { link: 'map', text: 'seed map' },
          ' and the ',
          { link: 'forge', text: 'forging calculator' },
          ` run on: extracted from TerraFirmaCraft’s source code for TerraFirmaCraft 1.20, and from the modpack itself for ${tfg}. When the data changes, the guides change with it.`,
        ],
      },
    ],
    listHeading: 'The guides',
    readLink: 'Read the guide',
    aboutHeading: 'How these guides are made',
    about: [
      {
        p: [
          'OutCrop’s tools extract the world-generation and recipe data from TerraFirmaCraft’s source code and from an installed TerraFirmaGreg modpack. The map and the forge run on that data, and the build writes these pages from it, so a table here shows exactly what the tools use.',
        ],
      },
      {
        p: [
          'Where a value has been checked against a real world it says so: the TerraFirmaGreg vein tables give each vein’s measured hit rate, the share of the map’s markers for it that held ore in a real TerraFirmaGreg world. Things OutCrop does not know, such as whether a vein is exposed in a cave, are left out rather than guessed. The ',
          { link: 'about', text: 'About page' },
          ' explains what is exact and what is approximate.',
        ],
      },
    ],
  },

  forgeSection: {
    heading: 'How the anvil works',
    blocks: [
      {
        p: [
          'Every anvil recipe has a target between {targetMin} and {targetMax} on the work bar, picked from the world seed. Each action moves the work by a fixed amount, and the item is finished by the strike that lands exactly on the target while the last three strikes follow the recipe’s finishing rules.',
        ],
      },
      { p: ['The actions: {actions}.'] },
      {
        p: [
          'Going below {workMin} or above {workMaxDestroy} destroys the item, so the finishing strikes have to be planned before the first one. That is what the calculator above does. The ',
          { link: 'anvil-guide', text: 'anvil guide' },
          ' explains the rules with a worked example and lists the rules of every TerraFirmaCraft item; more ',
          { link: 'guides', text: 'guides' },
          ' cover ores, rocks and structures.',
        ],
      },
    ],
  },

  pages: {
    'tfg-ore-veins': {
      title: 'Ore veins in TerraFirmaGreg',
      short: 'TerraFirmaGreg ore veins',
      description:
        'All {tfgVeinCount} TerraFirmaGreg overworld ore veins: what each yields, its Y range, rarity, host rock and surface indicators, and which veins hold each material.',
      summary:
        'Every overworld ore vein in TerraFirmaGreg: what it yields, how deep it forms, how rare it is, which rocks it needs, and how often the map’s markers for it held ore in a real world.',
      lead: [
        {
          p: [
            `${tfg} has its own table of {tfgVeinCount} overworld ore veins, most of them carrying several GregTech ores at once. A vein only forms between certain heights and only replaces certain rocks, so its Y range and its host rocks tell you where to dig before you find a single nugget.`,
          ],
        },
        {
          p: [
            'The first table lists every vein with what it yields, its depth, how rare it is, its shape, its host rocks and its surface indicators. The second turns it around and lists, for each of the {tfgMaterialCount} materials, the veins that contain it: that is how you find out that silver comes from galena. The values are read from the modpack’s own world-generation data, the same data the ',
            { link: 'map', text: 'seed map' },
            ' draws its markers from.',
          ],
        },
      ],
      sections: [
        {
          id: 'read',
          heading: 'How to read a vein',
          blocks: [
            {
              list: [
                [
                  'Y range: the heights the vein’s blocks can occupy. Most veins use absolute heights. {tfgProjectedCount} are measured from the ground instead, shown as “blocks down”: “5 to 20 blocks down” means just that, wherever the ground is.',
                ],
                [
                  'Chunks per vein: the chance that a chunk rolls the vein. “1 in 22” means about one chunk in 22. A roll does not guarantee ore: the vein still has to land in a rock it can replace, and a band that sits above the ground places nothing.',
                ],
                [
                  'Host rock: the vein replaces only these rocks. A vein whose list holds only igneous rocks never appears where the ground is sedimentary, however long you dig. The ',
                  { link: 'rock-layers', text: 'rock guide' },
                  ' shows which rocks lie where.',
                ],
                [
                  'Shape and size: a cluster is a rounded body, a disc a flat lens and a pipe a narrow, roughly vertical column. Size is the game’s own setting for the vein; a bigger number is a bigger body.',
                ],
                [
                  'Surface indicators: the small indicator blocks on the ground that let you find a vein by walking instead of digging. The game only places them when the ore lies less than the listed depth below the surface, so a deep vein shows none at all.',
                ],
                [
                  'Measured hit rate: how often the map’s markers for the vein held its ore when they were checked against a real TerraFirmaGreg world. A vein whose markers almost never held ore is hidden on the map.',
                ],
              ],
            },
          ],
        },
        {
          id: 'map',
          heading: 'Finding a vein on the map',
          blocks: [
            {
              steps: [
                ['Open the ', { link: 'map', text: 'seed map' }, `, choose ${tfg} and type your world’s seed.`],
                [
                  'Turn on Minerals and type what you need into the ore filter’s search. It searches what each vein yields as well as its name, so searching silver finds the galena veins.',
                ],
                [
                  'Click a marker for its position, Y range and rarity, and turn on the Rock layer to check the rock under it.',
                ],
              ],
            },
            {
              p: [
                'Markers are predictions from the seed, not guarantees. The map hides markers it is less sure of than the threshold in the ore filter (90% by default), so some real veins do not show.',
              ],
            },
          ],
        },
        { id: 'veins', heading: 'Every overworld vein', blocks: [{ table: 'tfgVeins' }] },
        {
          id: 'materials',
          heading: 'Where to find each material',
          blocks: [
            {
              p: [
                'Each material with every vein that yields it, richest first. The percentage is that material’s share of the vein’s ore blocks, so a vein that is 25% silver gives one silver ore block in four.',
              ],
            },
            { table: 'tfgMaterials' },
          ],
        },
        {
          id: 'biomes',
          heading: 'Veins that need a biome',
          blocks: [
            {
              p: [
                'Most veins form in any biome. These only form in the biomes of one group, so in the rest of the world you will not find them at all.',
              ],
            },
            { table: 'tfgBiomeGroups' },
          ],
        },
        {
          id: 'left-out',
          heading: 'What the tables leave out',
          blocks: [
            {
              list: [
                [
                  '{tfgRockOnlyVeins}: they replace rock with other rock or gravel and carry no ore, so they are not listed. The dikes are columns of granite, diorite or gabbro through the other rocks.',
                ],
                [
                  '{tfgLavaVeins}: these only form in columns with lava nearby. They are in the table, but the map cannot see lava and does not draw them.',
                ],
                [
                  'Whether a vein is exposed in a cave or at the surface: that needs the cave carvers and the soil, which OutCrop does not model, so nothing here claims it.',
                ],
                [
                  'The Beneath and the planets have veins of their own, in the ',
                  { link: 'tfg-dimensions', text: 'Beneath and planets guide' },
                  '.',
                ],
              ],
            },
          ],
        },
      ],
      related: ['tfg-dimensions', 'rock-layers', 'kaolin-clay', 'tfc-ore-veins'],
    },

    'tfc-ore-veins': {
      title: 'Ore veins in TerraFirmaCraft 1.20',
      short: 'TerraFirmaCraft ore veins',
      description:
        'All {tfcVeinCount} TerraFirmaCraft 1.20 ore veins: Y range, rarity, host rocks, the split of poor, normal and rich ore, and the surface indicators to look for.',
      summary:
        'Every ore vein in TerraFirmaCraft 1.20: Y range, rarity, host rocks, ore grades and surface indicators, plus which veins hold each mineral.',
      lead: [
        {
          p: [
            'TerraFirmaCraft 1.20 places {tfcVeinCount} kinds of ore vein in the overworld, from the native copper and cassiterite near the surface to diamond and emerald pipes. Each forms only between certain heights and only replaces certain rocks, and its metal ores come in poor, normal and rich grades.',
          ],
        },
        {
          p: [
            'The tables below list every vein with its yield, depth, rarity, shape, host rocks and surface indicators, and every mineral with the veins that hold it. The values come from TerraFirmaCraft’s own world-generation data, extracted from its source code, the same data the ',
            { link: 'map', text: 'seed map' },
            ' draws its markers from.',
          ],
        },
      ],
      sections: [
        {
          id: 'read',
          heading: 'How to read a vein',
          blocks: [
            {
              list: [
                [
                  'Y range: the heights the vein’s blocks can occupy. {tfcProjectedVeins} are measured from the ground instead of in absolute heights, so “12 to 35 blocks down” means just that, wherever the ground is.',
                ],
                [
                  'Chunks per vein: the chance that a chunk rolls the vein. “1 in 24” means about one chunk in 24. The vein still has to land in a rock it can replace.',
                ],
                [
                  'Grades: TerraFirmaCraft’s metal ores come as poor, normal and rich ore, and a richer grade melts into more metal. The split shown is the share of each grade among that ore’s blocks.',
                ],
                [
                  'Deposits: {tfcDepositVeins} also place ore deposits, blocks you dig up and pan for ore rather than smelt.',
                ],
                [
                  'Surface indicators: small pieces of the ore lying on the ground, which the game only places when the ore lies less than the listed depth below the surface. Veins without them have to be found by digging or prospecting.',
                ],
                [
                  'Host rock: the vein replaces only these rocks, so the ',
                  { link: 'rock-layers', text: 'rock under you' },
                  ' decides what you can find.',
                ],
              ],
            },
          ],
        },
        {
          id: 'map',
          heading: 'Finding a vein on the map',
          blocks: [
            {
              steps: [
                ['Open the ', { link: 'map', text: 'seed map' }, `, choose ${tfc} and type your world’s seed.`],
                ['Turn on Minerals and search the ore filter for the mineral you need.'],
                [
                  'Click a marker for its position, Y range and rarity, and turn on the Rock layer to check that the rock there can host it.',
                ],
              ],
            },
            {
              p: [
                'Markers are predictions from the seed, not guarantees. The TerraFirmaCraft 1.20 profile is checked against TerraFirmaCraft’s Java code; unlike TerraFirmaGreg, it has not been measured against a real world, so this page gives no hit rate.',
              ],
            },
          ],
        },
        { id: 'veins', heading: 'Every vein', blocks: [{ table: 'tfcVeins' }] },
        {
          id: 'materials',
          heading: 'Where to find each mineral',
          blocks: [
            {
              p: [
                'Each mineral with every vein that yields it, richest first. The percentage is that mineral’s share of the vein’s blocks.',
              ],
            },
            { table: 'tfcMaterials' },
          ],
        },
        {
          id: 'left-out',
          heading: 'What the tables leave out',
          blocks: [
            {
              list: [
                [
                  '{tfcRockOnlyVeins}: they replace rock with other rock or gravel and carry no ore, so they are not listed.',
                ],
                [
                  '{tfcLavaVeins}: only forms in columns with lava nearby. It is in the table, but the map cannot see lava and does not draw it.',
                ],
                [
                  '{tfcRiverVeins} only form in river biomes, and kaolin clay only in its own biomes and climate: see the ',
                  { link: 'kaolin-clay', text: 'kaolin guide' },
                  '.',
                ],
                [
                  'Whether a vein is exposed in a cave or at the surface: OutCrop does not model the cave carvers or the soil, so nothing here claims it.',
                ],
              ],
            },
          ],
        },
      ],
      related: ['rock-layers', 'kaolin-clay', 'tfg-ore-veins', 'anvil-guide'],
    },

    'kaolin-clay': {
      title: 'Where to find kaolin clay in TerraFirmaCraft and TerraFirmaGreg',
      short: 'Finding kaolin clay',
      description:
        'Kaolin clay needs at least {kaolinMinTemperature} °C and {kaolinMinRainfall} mm of rain, the right biome and Y {kaolinMinY} to {kaolinMaxY}. How to find it in TFC 1.20 and TerraFirmaGreg.',
      summary:
        'Why kaolin clay is so hard to find, the climate, biomes and heights it needs, and how to find a patch with the map.',
      lead: [
        {
          p: [
            'Kaolin clay is where TerraFirmaCraft’s high-temperature work starts. Heating it gives kaolinite powder, one of the ingredients of fire clay, and fire clay makes the crucible, fire ingot molds and the fire bricks the blast furnace needs. It is also one of the hardest materials to find, because three conditions have to hold at once, and most of the world fails at least one.',
          ],
        },
      ],
      sections: [
        {
          id: 'conditions',
          heading: 'The three conditions',
          blocks: [
            {
              list: [
                [
                  'Climate: an average annual temperature of at least {kaolinMinTemperature} °C and an annual rainfall of at least {kaolinMinRainfall} mm, both at once.',
                ],
                [
                  'Biome: in TerraFirmaCraft only {tfcKaolinBiomes}. TerraFirmaGreg allows {tfgKaolinBiomeCount} biomes, listed below.',
                ],
                [
                  'Height: every patch lies between Y {kaolinMinY} and {kaolinMaxY}, well above sea level, so it only reaches the surface where the ground is that high.',
                ],
              ],
            },
            {
              p: [
                'Where all three hold, one chunk in {kaolinRarity} rolls a patch, up to {kaolinAcross} blocks across.',
              ],
            },
          ],
        },
        {
          id: 'height',
          heading: 'Why only between Y {kaolinMinY} and {kaolinMaxY}',
          blocks: [
            {
              p: [
                'Kaolin forms as a flat disc. The game looks for the disc’s centre between Y {kaolinConfigMinY} and {kaolinConfigMaxY}, but first keeps the disc’s own size, {kaolinSize}, clear of both ends of that range. Nothing is left, so it falls back to the middle: every disc is centred on Y {kaolinCentre}, and reaches {kaolinHeight} blocks above and below it.',
              ],
            },
            {
              p: [
                'Inside a patch, grass becomes kaolin clay grass, and dirt, gravel and raw rock become kaolin clay; TerraFirmaGreg adds mud. So a patch shows at the surface where the ground lies between Y {kaolinMinY} and {kaolinMaxY}, and is buried under higher ground: dig down on a hillside that rises above Y {kaolinMaxY}.',
              ],
            },
          ],
        },
        {
          id: 'blood-lily',
          heading: 'The Blood Lily',
          blocks: [
            {
              p: [
                'A patch’s surface indicator is the Blood Lily: TerraFirmaCraft’s field guide notes that the flower grows on kaolin clay. The game places these indicators near a patch, and only when the patch lies less than {kaolinIndicatorDepth} blocks below the ground, so in one of the right biomes and climates a Blood Lily is worth digging under.',
              ],
            },
          ],
        },
        {
          id: 'tfg',
          heading: 'Kaolin in TerraFirmaGreg',
          blocks: [
            {
              p: [
                'TerraFirmaGreg keeps TerraFirmaCraft’s kaolin feature, with the same size, height and rarity, and the same climate gate, but its own list of biomes: {tfgKaolinBiomes}.',
              ],
            },
          ],
        },
        {
          id: 'map',
          heading: 'Finding kaolin with the map',
          blocks: [
            {
              steps: [
                ['Open the ', { link: 'map', text: 'seed map' }, ', choose your profile and type your world’s seed.'],
                ['Turn on Minerals and search the ore filter for kaolin.'],
                [
                  'In the filter, set a minimum temperature of {kaolinMinTemperature} °C and a minimum rainfall of {kaolinMinRainfall} mm: everything too cold or too dry for kaolin dims.',
                ],
                [
                  'Turn on Terrain to see, approximately, where the ground lies near Y {kaolinMinY} to {kaolinMaxY}, then walk to a marker and look for Blood Lilies.',
                ],
              ],
            },
            {
              p: [
                'Markers are predictions from the seed, not guarantees: the map hides those whose measured hit rate is below the threshold in the ore filter (90% by default), so some real patches do not show.',
              ],
            },
          ],
        },
      ],
      related: ['tfc-ore-veins', 'tfg-ore-veins', 'rock-layers'],
    },

    'rock-layers': {
      title: 'Rock layers in TerraFirmaCraft, and the ores each rock holds',
      short: 'Rock layers and ores',
      description:
        'TerraFirmaCraft’s twenty rocks by category, how they stack from the surface down, and which ore veins can form in each one, in TFC 1.20 and TerraFirmaGreg.',
      summary:
        'The twenty rocks of TerraFirmaCraft and TerraFirmaGreg, how they stack into layers, and which ore veins can form in each one.',
      lead: [
        {
          p: [
            'Every ore vein in TerraFirmaCraft replaces only certain rocks, so the rock under your feet decides which ores you can find there. TerraFirmaCraft has twenty rocks, and TerraFirmaGreg’s overworld keeps the same twenty and the same layers.',
          ],
        },
        {
          p: [
            'This guide lists the rocks with the veins each can hold, in both packs, then explains how the game stacks them, so you can tell from the ground you stand on what lies further down.',
          ],
        },
      ],
      sections: [
        {
          id: 'rocks',
          heading: 'The twenty rocks and their veins',
          blocks: [
            {
              p: [
                'The category is the one TerraFirmaCraft gives each rock. A vein forms in a rock only if the rock is in the vein’s host list; the ore vein guides for ',
                { link: 'tfc-ore-veins', text: 'TerraFirmaCraft' },
                ' and ',
                { link: 'tfg-ore-veins', text: 'TerraFirmaGreg' },
                ' give each vein’s depth and rarity.',
              ],
            },
            { table: 'rocks' },
            {
              p: [
                'Some TerraFirmaGreg veins also list vanilla tuff and basalt among their hosts. Those rocks are not part of TerraFirmaCraft’s layers, so they are not in this table.',
              ],
            },
          ],
        },
        {
          id: 'layers',
          heading: 'How the layers stack',
          blocks: [
            {
              p: [
                'Underground, the rock comes in layers, and the game decides an area’s layers in two steps. First the area gets one of four kinds, from what is around it:',
              ],
            },
            { table: 'rockStarts' },
            {
              p: [
                'Then the game picks the top layer from that kind’s list, and a rock from the layer. Each rock names the layer that lies under it, and the stack continues down until it reaches the bottom layer: {bottomRocks}. The probe on the ',
                { link: 'map', text: 'seed map' },
                ' shows the top, middle and bottom rock for any spot.',
              ],
            },
            { table: 'rockLayers' },
          ],
        },
        {
          id: 'reading',
          heading: 'Reading the ground',
          blocks: [
            {
              list: [
                [
                  'Sedimentary rock at the top sits over metamorphic rock: shale, claystone and conglomerate over slate, limestone, dolomite and chalk over marble, and chert over quartzite.',
                ],
                [
                  'Extrusive igneous rock at the top sits over its intrusive partner: rhyolite over granite, andesite and dacite over diorite, and basalt over gabbro.',
                ],
                [
                  'Near mountains the order can turn over: in an uplift area, granite, diorite and gabbro can sit on top of sedimentary rock.',
                ],
                [
                  'The bottom layer is the same everywhere: {bottomRocks}.',
                ],
              ],
            },
          ],
        },
      ],
      related: ['tfc-ore-veins', 'tfg-ore-veins', 'kaolin-clay'],
    },

    'anvil-guide': {
      title: 'How the TerraFirmaCraft anvil works',
      short: 'The anvil, step by step',
      description:
        'How the TerraFirmaCraft anvil works: the eight actions, where the target comes from, how the finishing rules read, a worked example, and every item’s rules.',
      summary:
        'The eight anvil actions, the target number and the finishing rules, a worked example, and the rules of every item TerraFirmaCraft smiths.',
      lead: [
        {
          p: [
            'Smithing in TerraFirmaCraft is a small puzzle. Every recipe hides a target on the anvil’s work bar, each action moves the work by a fixed amount, and the item is finished by the strike that lands exactly on the target, provided the last three strikes follow the recipe’s finishing rules. This guide explains each part, works through one example and lists the rules of all {tfcRecipes} TerraFirmaCraft recipes.',
          ],
        },
      ],
      sections: [
        {
          id: 'actions',
          heading: 'The eight actions',
          blocks: [
            { table: 'anvilActions' },
            {
              p: [
                'Hits come in three strengths; a recipe that asks for a hit accepts any of them. The work starts at {workStart}. Taking it below {workMin} or above {workMaxDestroy} destroys the item, so an overshoot can cost you the metal.',
              ],
            },
          ],
        },
        {
          id: 'target',
          heading: 'Where the target comes from',
          blocks: [
            {
              p: [
                'The target is not written in the recipe. The game works it out from the world seed and the recipe’s id, so it is the same every time in one world and different in another, and it always lies between {targetMin} and {targetMax}. The anvil screen shows it; the ',
                { link: 'forge', text: 'forging calculator' },
                ' also works it out from your seed, the way the game does.',
              ],
            },
          ],
        },
        {
          id: 'rules',
          heading: 'Reading the finishing rules',
          blocks: [
            {
              p: [
                'A recipe has up to three finishing rules. Each names an action and a position among the last three strikes:',
              ],
            },
            {
              list: [
                ['Last, second last and third last each name one strike.'],
                ['Not last means the second or third last strike.'],
                ['Any means one of the last three strikes.'],
                ['A rule that asks for a hit is met by a light, medium or hard hit.'],
              ],
            },
            {
              p: [
                'The game checks after every strike, and the item is done the moment the work reaches the target with the rules met. So the finishing strikes have to be planned before the first one: work out where you must be three strikes before the end, get there, then finish. The recipe files store the rules last first; this guide and the calculator list them in the order you strike them.',
              ],
            },
          ],
        },
        {
          id: 'example',
          heading: 'A worked example',
          blocks: [
            {
              p: [
                'Say the anvil shows a target of {exampleTarget} for a copper pickaxe head, whose rules are {exampleRules}. The forge calculator’s solver finds this sequence, the shortest one that satisfies them:',
              ],
            },
            { table: 'anvilExample' },
            {
              p: [
                'The work lands on {exampleTarget} with the last strike, and the last three strikes, {exampleTail}, meet every rule. Another world gives the same pickaxe head a different target, and so a different sequence.',
              ],
            },
          ],
        },
        {
          id: 'tiers',
          heading: 'Anvil tiers',
          blocks: [
            {
              p: [
                'Every recipe needs an anvil of at least a given tier, and in TerraFirmaCraft an anvil’s tier is its metal’s: Tier I is copper; Tier II bronze, bismuth bronze or black bronze; Tier III wrought iron; Tier IV steel; Tier V black steel; and Tier VI red or blue steel. A rock anvil, made from raw igneous rock, is Tier 0.',
              ],
            },
            { table: 'anvilTiers' },
          ],
        },
        {
          id: 'recipes',
          heading: 'The rules of every TerraFirmaCraft item',
          blocks: [
            {
              p: [
                'Every metal’s version of an item shares one set of rules: a copper and a steel pickaxe head finish the same way, and only the anvil tier differs.',
              ],
            },
            { table: 'anvilRecipes' },
            {
              p: [
                'TerraFirmaGreg replaces the rules of {tfgChangedRules} of these recipes and adds its own, {tfgRecipes} in all: choose TerraFirmaGreg in the ',
                { link: 'forge', text: 'forging calculator' },
                ' to search them.',
              ],
            },
          ],
        },
      ],
      related: ['tfc-ore-veins', 'tfg-ore-veins', 'rock-layers'],
    },

    'tfg-structures': {
      title: 'Structures in TerraFirmaGreg: villages, camps, mineshafts and ruins',
      short: 'TerraFirmaGreg structures',
      description:
        'Where TerraFirmaGreg’s villages, illager camps, mineshafts, ruins and towers spawn: the spacing, climate, biomes and ground height each one needs.',
      summary:
        'Every structure TerraFirmaGreg places in the overworld, the Beneath and on the Moon: how far apart they are, and the climate, biomes and ground each one needs.',
      lead: [
        {
          p: [
            'TerraFirmaGreg has no vanilla villages, temples or strongholds in its overworld. It places its own structures instead: villages built for different climates, illager camps, mineshafts, an aqueduct, plains houses and moai, and the ruins, ancient monuments, ruined churches, towers and castles of two ruin mods the pack includes. The Beneath and the Moon have structures of their own.',
          ],
        },
        {
          p: [
            'This guide lists every one with how far apart they are and the climate, biomes and ground each needs, read from the modpack’s data, the same data the ',
            { link: 'map', text: 'seed map' },
            ' places its structure markers from.',
          ],
        },
      ],
      sections: [
        {
          id: 'placement',
          heading: 'How structures are placed',
          blocks: [
            {
              p: [
                'Each kind of structure divides the world into squares, its spacing, measured in chunks. Every square gets exactly one candidate chunk, picked from the seed, and two candidates of the same kind are never closer than the separation. Whether a structure appears at a candidate depends on what is there: the climate, the biome and, for some, the ground height and the biomes around it.',
              ],
            },
            {
              p: [
                'So a structure with a spacing of 35 chunks appears at most once in each 560 × 560-block square of its grid, and only where the conditions hold. The climate is the chunk’s average annual temperature and annual rainfall, and the forest is how wooded it is, from none through sparse, forest edge and normal to old growth.',
              ],
            },
          ],
        },
        { id: 'overworld', heading: 'Overworld structures', blocks: [{ table: 'structuresOverworld' }] },
        {
          id: 'avoid',
          heading: 'Biomes they keep away from',
          blocks: [
            {
              p: [
                'Most overworld structures also check the biomes around their chunk, and do not start if one of these lies within the given distance. The first list is mostly sea, shore, lake and river biomes, which keeps those structures away from water. The stilt village’s list holds almost every other biome, so it only starts well inside its own.',
              ],
            },
            { table: 'structuresAvoid' },
          ],
        },
        {
          id: 'elsewhere',
          heading: 'The Beneath and the Moon',
          blocks: [
            {
              p: [
                'Some structures keep clear of another kind: they do not start within the given number of chunks of that kind’s candidate chunks.',
              ],
            },
            { table: 'structuresElsewhere' },
          ],
        },
        {
          id: 'map',
          heading: 'Finding structures on the map',
          blocks: [
            {
              steps: [
                ['Open the ', { link: 'map', text: 'seed map' }, `, choose ${tfg} and type your world’s seed.`],
                ['Turn on Structures, and pick the kinds you want in the structure filter.'],
                ['Click a marker for its kind, variant and position, and mark it completed once you have been there.'],
              ],
            },
            {
              p: [
                'The positions the map draws match the game’s candidate chunks exactly. Whether a structure really generated at one is an approximation, because the biome and ground height it checks are themselves approximate, so treat a marker as very likely, not certain.',
              ],
            },
          ],
        },
      ],
      related: ['tfg-dimensions', 'tfg-ore-veins', 'kaolin-clay'],
    },

    'tfg-dimensions': {
      title: 'The Beneath and the planets in TerraFirmaGreg',
      short: 'The Beneath and the planets',
      description:
        'TerraFirmaGreg’s Beneath, Moon, Mars, Venus and Glacio: every ore vein’s depth, rarity and yield, the biomes of each, and the structures you can find there.',
      summary:
        'The ore veins, biomes and structures of TerraFirmaGreg’s Beneath, Moon, Mars, Venus and Glacio, with every vein’s depth, rarity and yield.',
      lead: [
        {
          p: [
            'Past the overworld, TerraFirmaGreg has five more places to mine: the Beneath, its rebuilt Nether, and four planets, the Moon, Mars, Venus and Glacio. Each has its own rocks, its own biomes and, except Glacio, its own ore veins, all listed here from the modpack’s data.',
          ],
        },
        {
          p: [
            'Every Beneath vein is tied to one biome, so in the Beneath the biome tells you what you can find. On the planets the veins form wherever their host stone is.',
          ],
        },
      ],
      sections: [
        {
          id: 'overview',
          heading: 'At a glance',
          blocks: [{ table: 'dimensions' }],
        },
        {
          id: 'beneath',
          heading: 'The Beneath',
          blocks: [
            {
              p: [
                'The Beneath has {beneathVeinCount} ore veins. Each lists the one biome it forms in; turn on the Biome layer on the ',
                { link: 'map', text: 'seed map' },
                ' to see where those biomes are. Its structure is the Beneath tower.',
              ],
            },
            { table: 'beneathVeins' },
          ],
        },
        {
          id: 'moon',
          heading: 'The Moon',
          blocks: [
            {
              p: [
                'The Moon has {moonVeinCount} ore veins in its stone, and four kinds of structure: moonbases, meteor craters, cheese deposits and moon rabbit burrows.',
              ],
            },
            { table: 'moonVeins' },
          ],
        },
        {
          id: 'mars',
          heading: 'Mars',
          blocks: [
            { p: ['Mars has {marsVeinCount} ore veins.'] },
            { table: 'marsVeins' },
          ],
        },
        {
          id: 'venus',
          heading: 'Venus',
          blocks: [
            { p: ['Venus has {venusVeinCount} ore veins.'] },
            { table: 'venusVeins' },
          ],
        },
        {
          id: 'glacio',
          heading: 'Glacio',
          blocks: [
            {
              p: [
                'OutCrop has no ore veins for Glacio, so this guide lists none and the map draws none there. The pack’s data gives Glacio a single biome, still named as a placeholder.',
              ],
            },
          ],
        },
        {
          id: 'accuracy',
          heading: 'How far to trust the markers',
          blocks: [
            {
              p: [
                'The measured hit rate is how often the map’s markers for a vein held its ore in a real TerraFirmaGreg world. On the planets the map has no rock layers and no terrain height, so it cannot rule out a marker that falls in the wrong stone or in the air, and the rates are lower than in the Beneath.',
              ],
            },
          ],
        },
      ],
      related: ['tfg-ore-veins', 'tfg-structures', 'rock-layers'],
    },
  } satisfies Record<GuideId, GuideCopy>,
} as const;

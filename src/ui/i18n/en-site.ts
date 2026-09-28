/**
 * The words of the site's static text: the About page and its questions, each page's description
 * and social card, the summary a visitor without JavaScript reads on the map and the forge, the
 * structured data, and llms.txt. `src/app/site/pages.ts` writes all of it into the HTML at build
 * time, so a crawler that runs no JavaScript reads the same text a visitor does. None of it ships
 * in a page's script, which is why it lives apart from `en.ts`; a Spanish locale would add a
 * sibling of this file.
 *
 * Everything here has to be true of the tools as built (AGENTS.md section 2). In particular it never
 * claims more accuracy than the tests back: exposure is not known, surface height is approximate,
 * and a marker is a prediction from the seed. Numbers that come from game data are not written
 * here: `{likeThis}` is filled in from `src/app/site/facts.ts`, which reads the same files the map
 * and the forge run on.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import { en } from './en';

/** Where a link in the site text points. `src/app/site/pages.ts` turns it into a URL: one of this
 *  site's pages becomes a relative link in the HTML and an absolute one in llms.txt. */
export type SiteLink = 'map' | 'forge' | 'about' | 'privacy' | 'source' | 'issues' | 'llmsFull';

/** A run of text, or a link. */
export type Inline = string | { readonly link: SiteLink; readonly text: string };
export type Paragraph = readonly Inline[];

/**
 * A paragraph, a bulleted list or a numbered list. `when` keeps a paragraph to the builds that
 * show ads, or to those that do not (`ads.config.json`, decided at build time like the pages).
 */
export type Block =
  | { readonly p: Paragraph; readonly when?: 'ads' | 'noAds' }
  | { readonly list: readonly Paragraph[] }
  | { readonly steps: readonly Paragraph[] };

export interface SiteSection {
  /** The fragment id, e.g. `accuracy` for about.html#accuracy. */
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export interface SiteQuestion {
  readonly id: string;
  readonly question: string;
  readonly answer: readonly Block[];
}

interface SiteText {
  /** What each tool is, in one paragraph: the About page's words, repeated on the tool's page. */
  readonly summaries: { readonly map: Paragraph; readonly forge: Paragraph };
  readonly pages: {
    readonly map: { readonly description: string };
    readonly forge: { readonly description: string };
    readonly about: { readonly description: string };
    readonly privacy: { readonly description: string; readonly descriptionNoAds: string };
  };
  readonly socialImageAlt: string;
  readonly structuredData: {
    readonly operatingSystem: string;
    readonly browserRequirements: string;
    readonly subCategory: string;
    readonly map: {
      readonly name: string;
      readonly features: readonly string[];
      readonly keywords: readonly string[];
    };
    readonly forge: {
      readonly name: string;
      readonly features: readonly string[];
      readonly keywords: readonly string[];
    };
  };
  readonly noScript: {
    readonly map: { readonly heading: string; readonly needsScript: string };
    readonly forge: { readonly heading: string; readonly needsScript: string };
    readonly more: string;
    readonly links: { readonly [K in 'map' | 'forge' | 'about' | 'privacy' | 'source']: string };
  };
  readonly about: {
    readonly title: string;
    readonly lead: readonly Block[];
    readonly contentsLabel: string;
    readonly sections: readonly SiteSection[];
    readonly faqHeading: string;
    readonly faq: readonly SiteQuestion[];
  };
  readonly llms: {
    readonly summary: string;
    readonly details: readonly string[];
    readonly toolsHeading: string;
    readonly aboutHeading: string;
    readonly optionalHeading: string;
    readonly links: {
      readonly [K in 'map' | 'forge' | 'about' | 'privacy' | 'source' | 'llmsFull']: string;
    };
    readonly notes: { readonly [K in 'about' | 'privacy' | 'source' | 'llmsFull']: string };
    readonly fullSource: string;
  };
}

/**
 * What each tool is, in one paragraph. The About page opens its section with it and the page
 * itself shows it to a visitor without JavaScript, word for word: the fallback says what the page
 * does, nothing written for search engines alone.
 */
const MAP_SUMMARY: Paragraph = [
  'The seed map shows a TerraFirmaCraft or TerraFirmaGreg world from its seed alone: biomes, rock layers, temperature, rainfall, terrain, ore veins and kaolin clay, and TerraFirmaGreg’s structures, on a map you can pan and zoom. Hover over any point to read its coordinates, biome, climate and rock layers.',
];
const FORGE_SUMMARY: Paragraph = [
  'The forging calculator solves TerraFirmaCraft’s anvil. Pick a recipe and it finds the shortest sequence of hits, draws, punches, bends, upsets and shrinks that lands the work exactly on the target and ends with the strikes the recipe’s rules ask for.',
];

const tfg = en.profileNames.tfg;
const tfc = en.profileNames['tfc-1.20'];

export const enSite = {
  summaries: { map: MAP_SUMMARY, forge: FORGE_SUMMARY },
  pages: {
    map: {
      description:
        'Free seed map for TerraFirmaCraft and TerraFirmaGreg: enter your seed to see biomes, rock layers, climate, terrain, ore veins, kaolin clay and TFG structures.',
    },
    forge: {
      description:
        'Anvil calculator for TerraFirmaCraft and TerraFirmaGreg: pick a recipe, get the shortest sequence of strikes that finishes it, last three steps included.',
    },
    about: {
      description:
        'What OutCrop is: a free seed map and anvil calculator for TerraFirmaCraft and TerraFirmaGreg. How to use it, how accurate it is, and how to find kaolin clay.',
    },
    privacy: {
      description:
        'How OutCrop handles your data: what stays in your browser, what it never sends, and what the Google AdSense ads and their cookies do.',
      descriptionNoAds:
        'How OutCrop handles your data: what stays in your browser and what it never sends. This copy shows no ads and sets no cookies.',
    },
  },
  // Describes public/og-image.jpg; change it with the image.
  socialImageAlt:
    'OutCrop: seed maps and anvil sequences for TerraFirmaCraft and TerraFirmaGreg. A biome map with shaded relief, rivers and two waypoints, and the probe readout for a Plateau with a Kaolin Clay deposit between Y 86 and 98.',
  structuredData: {
    operatingSystem: 'Any; runs in a web browser',
    browserRequirements: 'Requires JavaScript.',
    subCategory: 'Minecraft mod companion',
    map: {
      name: 'OutCrop seed map',
      features: [
        `Seed map for ${tfg} and TerraFirmaCraft 1.20, on Minecraft 1.20.1`,
        'Biome, rock layer, temperature and rainfall layers',
        'Terrain, shaded relief and contour lines from an approximate surface height',
        'Ore veins and mineral deposits, including kaolin clay, with their Y ranges',
        'Structures for TerraFirmaGreg',
        'Chunk and region grid',
        'Probe readout with coordinates, climate, rock layers and a copyable /tp command',
        'Filters by rock, biome, temperature, rainfall and ore',
        'Waypoints with export and import',
        'Distance measuring with walking and sprinting estimates',
        'TerraFirmaGreg’s Beneath, Moon, Mars, Venus and Glacio',
      ],
      keywords: [
        'TerraFirmaCraft',
        'TerraFirmaGreg',
        'TFC',
        'TFG',
        'seed map',
        'ore finder',
        'kaolin clay',
        'Minecraft 1.20.1',
      ],
    },
    forge: {
      name: 'OutCrop forging calculator',
      features: [
        'Shortest anvil sequence for a recipe and its target',
        'Honours the recipe’s rules for the last three steps',
        'TerraFirmaGreg and TerraFirmaCraft recipe catalogues',
        'Target work computed from the world seed, the way the game does',
        'Custom recipes saved in the browser, with JSON export and import',
      ],
      keywords: [
        'TerraFirmaCraft',
        'TerraFirmaGreg',
        'TFC',
        'TFG',
        'anvil calculator',
        'forging calculator',
        'anvil sequence',
      ],
    },
  },
  noScript: {
    map: {
      heading: 'OutCrop: seed map for TerraFirmaCraft and TerraFirmaGreg',
      needsScript: 'The map runs in your browser and needs JavaScript to draw.',
    },
    forge: {
      heading: 'Anvil calculator for TerraFirmaCraft and TerraFirmaGreg',
      needsScript: 'The calculator runs in your browser and needs JavaScript.',
    },
    more: 'More:',
    links: {
      map: 'Seed map',
      forge: 'Forging calculator',
      about: 'About OutCrop, how accurate it is, and common questions',
      privacy: 'Privacy',
      source: 'Source code (EUPL-1.2)',
    },
  },
  about: {
    title: 'About OutCrop',
    lead: [
      {
        p: [
          'OutCrop is a free seed map and anvil calculator for TerraFirmaCraft, the Minecraft mod, and for the TerraFirmaGreg modpack. Type your world’s seed and the map shows that world before you walk it; pick an anvil recipe and the calculator finds the strikes that finish it.',
        ],
      },
      {
        p: [
          'It is for TerraFirmaCraft (TFC) and TerraFirmaGreg (TFG) players, whose worlds spread the ores, clays and rocks they need far apart and make travel slow, so it pays to know where to go before setting out.',
        ],
      },
      {
        p: [
          'Everything runs in your web browser. There is nothing to install and no account, and nothing is read from your game or your saves: the map is computed from the seed alone.',
        ],
      },
    ],
    contentsLabel: 'On this page',
    sections: [
      {
        id: 'versions',
        heading: 'Supported versions',
        blocks: [
          { p: ['Choose the profile that matches your pack, on the map and in the forge:'] },
          {
            list: [
              [
                `${tfg}: TerraFirmaGreg Modern, for Minecraft 1.20.1. The overworld with TerraFirmaGreg’s own biomes, climate, rock layers and structures, plus the Beneath, the Moon, Mars, Venus and Glacio.`,
              ],
              [`${tfc}: TerraFirmaCraft for Minecraft 1.20.1. The overworld.`],
            ],
          },
          {
            p: [
              'TerraFirmaCraft 1.18 and vanilla Minecraft are planned but not built yet. The map matches a world only when the seed, the profile and the dimension all match it.',
            ],
          },
        ],
      },
      {
        id: 'map',
        heading: 'The seed map',
        blocks: [
          { p: MAP_SUMMARY },
          { p: ['Layers you can turn on:'] },
          {
            list: [
              ['Biome: which biome covers each spot.'],
              [
                'Rock: the rock layers underground, top, middle and bottom, and the rock at the surface.',
              ],
              [
                'Temperature and Rainfall: the average annual temperature and the annual rainfall, which decide what grows and what forms there.',
              ],
              [
                'Terrain, Shaded relief and Contours: the height of the ground, approximate, drawn as colour, as relief or as contour lines.',
              ],
              [
                'Minerals: ore veins and deposits, from copper, tin and iron ores to coal, gems and kaolin clay. The ore filter lists each with its Y range, what it yields, a typical block count where one can be worked out and, for TerraFirmaGreg, its measured accuracy; click a marker for its position, Y range and rarity.',
              ],
              [
                'Structures, in TerraFirmaGreg: villages, camps, mineshafts, ruins and towers, which you can mark as completed.',
              ],
              ['Grid: chunk and region lines.'],
            ],
          },
          { p: ['And around the map:'] },
          {
            list: [
              [
                'Probe: hover over any point for its block and chunk, its temperature, rainfall and seasonal temperature range, its biome, and the rock layers under it. Click to pin it and copy a /tp command or its X and Z.',
              ],
              [
                'Filters: dim everything but the rock, biomes, temperature or rainfall you are after, and search ores by what they yield: searching silver finds the veins that carry it.',
              ],
              [
                'Waypoints: mark places with a name, an icon and a colour, and export or import them as a file.',
              ],
              [
                'Measure: the distance between two points or waypoints, in blocks and chunks, with rough walking and sprinting times.',
              ],
              [
                'Links: the address bar keeps the seed, profile, dimension, position and layers, so a copied link opens the same view.',
              ],
            ],
          },
          {
            p: [
              'In TerraFirmaGreg the map also covers the Beneath, with its rock, biomes, ore veins and towers, and the four planets: biomes on all of them, ore veins on the Moon, Mars and Venus, and the Moon’s structures. Rock layers and terrain height are not modelled on the planets.',
            ],
          },
        ],
      },
      {
        id: 'forge',
        heading: 'The forging calculator',
        blocks: [
          { p: FORGE_SUMMARY },
          {
            list: [
              [
                'Recipes: the TerraFirmaGreg catalogue ({tfgRecipes} recipes) and TerraFirmaCraft’s own ({tfcRecipes}), searchable by item, input or output.',
              ],
              [
                'The target: the game picks each recipe’s target from the world seed, so the same recipe has a different number in another world. Enter your seed and the calculator works it out the way the game does; if your anvil shows a different number, type that one.',
              ],
              ['Actions: {actions}.'],
              [
                'Your own recipes: give one a name, a target and up to three finishing rules. They are saved in your browser and can be exported and imported as JSON.',
              ],
            ],
          },
        ],
      },
      {
        id: 'how-to',
        heading: 'How to use it',
        blocks: [
          {
            steps: [
              [
                'Find your world’s seed: type /seed in the game’s chat. It always works in single player; on a server it needs operator permission, so ask an admin.',
              ],
              [
                'Open the ',
                { link: 'map', text: 'map' },
                ' and type the seed into the Seed box. Text seeds work too, exactly as the game reads them, capital letters included.',
              ],
              [
                'Choose the profile that matches your pack and its version, and the dimension you are in.',
              ],
              [
                'Pan and zoom, turn layers on, and hover over a spot to read it; click to pin it. For ores, turn on Minerals and use the ore filter.',
              ],
              [
                'At the anvil, open the ',
                { link: 'forge', text: 'forging calculator' },
                ', pick the recipe and follow the sequence it gives.',
              ],
            ],
          },
        ],
      },
      {
        id: 'accuracy',
        heading: 'How accurate it is',
        blocks: [
          {
            p: [
              'A map that looks right but is wrong sends you on a long walk for nothing, so OutCrop is checked rather than trusted. Each layer is a port of the mod’s own world-generation code, and automated tests hold the ports to values captured from that Java code. The TerraFirmaGreg profile is also tested against a real generated world; TerraFirmaCraft 1.20 is checked against the Java only.',
            ],
          },
          { p: ['What is approximate, or not known:'] },
          {
            list: [
              [
                'Surface height is approximate. Terrain, shaded relief and contours are drawn from it, and the /tp command the probe copies uses it for Y, two blocks up, so that a small error does not land you inside the ground.',
              ],
              [
                'Whether a deposit is exposed at the surface or in a cave is not known yet. That depends on the soil and on the cave carvers, which OutCrop does not model, so the map makes no claim about it.',
              ],
              [
                `Ore and mineral markers are predictions from the seed, not guarantees. For TerraFirmaGreg, the map hides markers whose hit rate, measured in a real world, is below the threshold under “${en.filter.oreAccuracyLabel}” (90% by default), so some real deposits do not show; lowering it shows more candidates, with more misses.`,
              ],
              [
                'Structures: the position matches the game; whether a structure actually generated there is approximate.',
              ],
              [
                'The forge computes a recipe’s target the way the game does, from the seed and the recipe; the number on your anvil is the authority.',
              ],
            ],
          },
        ],
      },
      {
        id: 'privacy',
        heading: 'Privacy',
        blocks: [
          {
            p: [
              'OutCrop runs in your browser. Your seed, settings, waypoints and custom recipes stay in this browser’s storage, and OutCrop never sends them anywhere.',
            ],
          },
          {
            when: 'ads',
            p: [
              'The site shows ads from Google AdSense, which uses cookies. Visitors in the European Economic Area, the United Kingdom and Switzerland are asked for consent first.',
            ],
          },
          { when: 'noAds', p: ['This copy of OutCrop shows no ads and sets no cookies.'] },
          { p: ['The ', { link: 'privacy', text: 'privacy page' }, ' has the details.'] },
        ],
      },
      {
        id: 'unofficial',
        heading: 'Not an official product',
        blocks: [
          {
            p: [
              'OutCrop is an unofficial, fan-made tool. Minecraft is a trademark of Mojang Synergies AB. OutCrop is not affiliated with, endorsed by or associated with Mojang, Microsoft, the TerraFirmaCraft team or the TerraFirmaGreg team, and it contains no game or mod assets.',
            ],
          },
        ],
      },
      {
        id: 'source',
        heading: 'Source code and licence',
        blocks: [
          {
            p: [
              'OutCrop is open source under the EUPL-1.2, the licence TerraFirmaCraft uses, because its world generation is derived from TerraFirmaCraft’s. The ',
              { link: 'source', text: 'source code' },
              ' is on GitHub, with a notice of what it uses from TerraFirmaCraft, TerraFirmaGreg and others. Found something wrong? ',
              { link: 'issues', text: 'Open an issue' },
              '.',
            ],
          },
        ],
      },
    ],
    faqHeading: 'Questions',
    faq: [
      {
        id: 'tfc-seed-map',
        question: 'Is there a seed map for TerraFirmaCraft?',
        answer: [
          {
            p: [
              'Yes. OutCrop’s ',
              { link: 'map', text: 'seed map' },
              ` is built for TerraFirmaCraft 1.20 on Minecraft 1.20.1: choose the ${tfc} profile and type your seed to see biomes, rock layers, climate, terrain and ore veins. TerraFirmaCraft 1.18 is not supported yet.`,
            ],
          },
        ],
      },
      {
        id: 'tfg-seed-map',
        question: 'Is there a seed map for TerraFirmaGreg?',
        answer: [
          {
            p: [
              `Yes. Choose the ${tfg} profile on the `,
              { link: 'map', text: 'seed map' },
              '. It shows the overworld with TerraFirmaGreg’s own biomes, climate, rock layers and structures, and also the Beneath, the Moon, Mars, Venus and Glacio.',
            ],
          },
        ],
      },
      {
        id: 'kaolin',
        question: 'How do I find kaolin clay in TerraFirmaCraft?',
        answer: [
          {
            p: [
              'Kaolin clay forms in patches up to {kaolinAcross} blocks across, always between Y {kaolinMinY} and {kaolinMaxY}, where the average annual temperature is at least {kaolinMinTemperature} °C and the annual rainfall at least {kaolinMinRainfall} mm. In TerraFirmaCraft the patches are limited to the {tfcKaolinBiomes} biomes; TerraFirmaGreg allows them in {tfgKaolinBiomes}. One chunk in {kaolinRarity} rolls a patch.',
            ],
          },
          {
            p: [
              'Inside a patch, grass becomes kaolin clay grass, and dirt, gravel and raw rock become kaolin clay; TerraFirmaGreg adds mud. So a patch shows at the surface where the ground lies between Y {kaolinMinY} and {kaolinMaxY}, and is buried under higher ground. Its indicator is the Blood Lily: TerraFirmaCraft’s field guide notes that the flower grows on kaolin clay.',
            ],
          },
          {
            p: [
              'In TerraFirmaCraft, heating kaolin clay gives kaolinite powder, one of the ingredients of fire clay, and fire clay makes the crucible, fire ingot molds and the fire bricks the blast furnace needs.',
            ],
          },
          {
            p: [
              'On the ',
              { link: 'map', text: 'seed map' },
              `: choose your profile, type your seed, turn on Minerals and search the ore filter for kaolin. In the filter, a minimum temperature of {kaolinMinTemperature} °C and a minimum rainfall of {kaolinMinRainfall} mm dim everywhere too cold or too dry for it. Markers are predictions from the seed, not guarantees: the map hides those whose measured hit rate is below “${en.filter.oreAccuracyLabel}” (90% by default), so some real patches do not show.`,
            ],
          },
        ],
      },
      {
        id: 'find-ore',
        question: 'How do I find a specific ore, like copper or silver?',
        answer: [
          {
            p: [
              'Turn on Minerals on the ',
              { link: 'map', text: 'seed map' },
              ' and type what you want into the ore filter’s search. It searches what each vein yields, not just its name, so searching silver also finds the veins that carry it. The list shows each vein’s Y range, and a click on a marker shows its position, Y range and rarity. Markers are predictions from the seed, not guarantees.',
            ],
          },
        ],
      },
      {
        id: 'anvil-rules',
        question: 'How do the anvil’s last three steps work?',
        answer: [
          {
            p: [
              'Every anvil recipe has up to three rules for how the work must finish, such as “hit last”, “draw second last” or “bend not last”. The game checks after every strike, and the item is done at the strike that brings the work exactly onto the target while the last three actions satisfy every rule.',
            ],
          },
          {
            p: [
              '“Last”, “second last” and “third last” each name one position. “Not last” means second or third last, and “any” means one of the last three. A hit rule is met by a light, medium or hard hit.',
            ],
          },
          {
            p: [
              'So the finishing strikes have to be planned before the first one. The ',
              { link: 'forge', text: 'forging calculator' },
              ' starts from the rules and finds the shortest sequence that reaches the target and ends with them in order.',
            ],
          },
        ],
      },
      {
        id: 'server',
        question: 'Does it work on my server?',
        answer: [
          {
            p: [
              'Yes, if you know the server’s seed and it runs a version OutCrop supports. The map works from the seed alone: it needs no mod, no access to the server and no upload of your world. On a server /seed needs operator permission, so ask an admin. A server whose world was created with changed world-generation settings may not match.',
            ],
          },
        ],
      },
      {
        id: 'mismatch',
        question: 'Why doesn’t the map match my world?',
        answer: [
          {
            p: [
              `Check the seed first: a text seed has to be typed exactly, capital letters included, because the game turns the text into a number. Then check the profile and its version, and the dimension. A world made with another version of the mod or pack generates differently, and so does one made with changed world-generation settings; the map takes TerraFirmaCraft’s temperature, rainfall and continentalness settings under ${en.worldSettings.heading}. Surface heights are approximate everywhere.`,
            ],
          },
        ],
      },
      {
        id: 'free',
        question: 'Is OutCrop free?',
        answer: [
          {
            p: [
              'Yes. There is no account and nothing to install, and the source code is open under the EUPL-1.2.',
            ],
          },
          { when: 'ads', p: ['The site shows ads from Google AdSense.'] },
        ],
      },
    ],
  },
  llms: {
    summary:
      'OutCrop is a free seed map and anvil calculator for TerraFirmaCraft (TFC), the Minecraft mod, and the TerraFirmaGreg (TFG) modpack. It runs in the web browser and works from the world seed alone.',
    details: [
      `Supported: ${tfg} and TerraFirmaCraft 1.20, both on Minecraft 1.20.1. TerraFirmaCraft 1.18 and vanilla Minecraft are not supported yet.`,
      'Accuracy: each map layer is a port of the mod’s own world-generation code, tested against values from that Java code and, for TerraFirmaGreg, against a real generated world. Surface height is approximate, whether a deposit is exposed is not known, and ore markers are predictions from the seed, not guarantees.',
    ],
    toolsHeading: 'Tools',
    aboutHeading: 'About',
    optionalHeading: 'Optional',
    links: {
      map: 'Seed map',
      forge: 'Forging calculator',
      about: 'About and FAQ',
      privacy: 'Privacy',
      source: 'Source code',
      llmsFull: 'Full text',
    },
    notes: {
      about:
        'what OutCrop is, how to use it, how accurate it is, and common questions, such as how to find kaolin clay',
      privacy: 'what OutCrop keeps in your browser and what it never sends',
      source: 'EUPL-1.2, on GitHub',
      llmsFull: 'the About page and its questions as one Markdown file',
    },
    fullSource: 'The text of {url}, as Markdown.',
  },
} satisfies SiteText;

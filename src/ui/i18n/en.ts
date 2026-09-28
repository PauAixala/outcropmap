// Relative, not `@data/…`: vite.config.ts imports this file, and Vite's config loader does not resolve the aliases the config defines (tests/unit/site-imports.test.ts).
import tfgBiomes from '../../data/tfg/biomes.json';
// All display strings live here — never hardcode UI text elsewhere. Spanish locale is backlog.
// The static pages' longer text (the About page, meta descriptions, llms.txt) is in ./en-site.ts.
export const en = {
  appTitle: 'OutCrop',
  /** Each page's document title. The build writes it into the page's <title> (src/app/site/pages.ts),
   *  and the map and the forge also set it at runtime, so both must stay the same string. */
  pageTitles: {
    map: 'OutCrop · Seed map for TerraFirmaCraft and TerraFirmaGreg',
    forge: 'OutCrop · Anvil calculator for TerraFirmaCraft and TerraFirmaGreg',
    about: 'OutCrop · About and FAQ',
    privacy: 'OutCrop · Privacy',
  },
  forgeTitle: 'OutCrop',
  nav: {
    licence: 'EUPL-1.2 · Source',
    map: 'Map',
    forge: 'Forge',
    about: 'About',
    privacy: 'Privacy',
  },
  // Minecraft Usage Guidelines: fan sites carry this, prominently, in these words.
  disclaimer: 'NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.',
  ads: {
    label: 'Advertisement',
    // Google's wording for the consent revocation link, which its CMP program requires.
    cookieSettings: 'Privacy and cookie settings',
  },
  privacy: {
    title: 'Privacy',
    intro: 'What OutCrop keeps, what it sends, and what the ads do.',
    keptHeading: 'What OutCrop keeps',
    kept:
      'Your seed, settings, waypoints and custom recipes stay in this browser, in its local storage on this device. OutCrop never sends them anywhere. Clearing this site’s data in your browser deletes them.',
    noAdsHeading: 'No ads, no tracking',
    noAds: 'This copy of OutCrop shows no ads and sets no cookies.',
    adsHeading: 'Ads',
    ads:
      'This site shows ads served by Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google’s use of advertising cookies enables it and its partners to serve ads based on your visits to this and other sites on the Internet.',
    adsConsent:
      'Visitors in the European Economic Area, the United Kingdom and Switzerland are asked for consent before personalised ads are shown. You can change that choice at any time with “Privacy and cookie settings”, at the top of the Map, Forge and About pages.',
    adsOptOut: 'Turn off personalised ads in Google’s ad settings',
    adsPartners: 'How Google uses information from sites that use its services',
    hostingHeading: 'Hosting',
    hosting:
      'The site is hosted on GitHub Pages. GitHub may record technical data, such as your IP address, when it delivers the files; see GitHub’s privacy statement. OutCrop has no analytics and no accounts.',
    hostingLink: 'GitHub’s privacy statement',
    contactHeading: 'Questions',
    contact: 'Open an issue on the project’s repository:',
  },
  theme: {
    toggleLabel: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },
  seed: {
    label: 'Seed',
    placeholder: 'Enter a seed…',
  },
  profile: {
    label: 'Profile',
  },
  dimension: {
    label: 'Dimension',
  },
  layers: {
    heading: 'Layers',
    developer: 'Developer overlays',
    opacity: 'Opacity',
  },
  scale: {
    unit: 'blocks',
  },
  waypoints: {
    exportLabel: 'Export',
    importLabel: 'Import',
    // Merged, not replaced: an imported file is usually somebody else's finds.
    imported: 'Added {count} waypoints.',
    importFailed: 'That file is not a waypoint export.',
    heading: 'Waypoints',
    name: 'Name',
    namePlaceholder: 'Home, mine, portal…',
    rename: 'Click to name',
    unnamed: 'Unnamed',
    icon: 'Icon',
    colour: 'Colour',
    clickMap: 'Click the map to place it. Click the icon again to cancel.',
    empty: 'No waypoints in this world yet.',
    centre: 'Centre map here',
    delete: 'Delete',
    iconNames: {
      house: 'Home',
      mine: 'Mine',
      portal: 'Portal',
      flag: 'Flag',
      star: 'Star',
      question: 'Unknown place',
    },
    colourNames: {
      'wp-red': 'Red',
      'wp-orange': 'Orange',
      'wp-green': 'Green',
      'wp-blue': 'Blue',
      'wp-purple': 'Purple',
      'wp-pink': 'Pink',
    },
  },
  measure: {
    heading: 'Measure',
    start: 'Measure a distance',
    stop: 'Stop measuring',
    idle: 'Measure between any two points, or between waypoints.',
    clickStart: 'Click the first point. It snaps to a nearby waypoint.',
    clickEnd: 'Click the second point. The distance updates as you move.',
    done: 'Click again to start a new measurement.',
    distance: 'Distance',
    blocks: 'blocks',
    perAxis: 'ΔX / ΔZ',
    chunks: 'Chunks',
    walk: 'Walking',
    sprint: 'Sprinting',
    estimateNote:
      'Travel times are estimates from flat-ground speeds (4.317 and 5.612 blocks per second). They ignore terrain, water, gear and mods.',
  },
  readout: {
    unpin: 'Close',
    copyTp: 'Copy /tp',
    copyCoords: 'Copy X Z',
    copied: 'Copied',
    copyFailed: 'Could not copy',
    // Y comes from the approximate surface height, raised a little so a slight error does not put
    // the player inside the ground. Stated, because it is an estimate.
    copyTpTitle: 'Teleport command. Y is the estimated surface plus 2 blocks; ~ keeps your height where it is not known.',
    groups: {
      position: 'Position',
      climate: 'Climate',
      geology: 'Geology',
      growth: 'What grows here',
      deposits: 'Deposits',
      structure: 'Structure',
    },
    block: 'Block',
    chunk: 'Chunk',
    region: 'Region',
    regionCenter: 'Region centre',
    distanceToEdge: 'Distance to region edge (grid cells, 128 blocks each)',
    biome: 'Biome',
    temperature: 'Temperature',
    rainfall: 'Rainfall',
    seasonalRange: 'Seasonal range (sea level)',
    hydration: 'Hydration',
    hydrationFromRain: 'from rainfall',
    needsWater: '· needs water nearby',
    // TFC's own `KoppenClimateClassification` is explicitly decorative and simplified -- it is the
    // label the game would show, not a real Koppen code, so the row says "climate type".
    koppen: 'Climate type',
    koppenClasses: {
      arctic: 'Arctic',
      tundra: 'Tundra',
      subarctic: 'Subarctic',
      'cold-desert': 'Cold desert',
      'hot-desert': 'Hot desert',
      temperate: 'Temperate',
      subtropical: 'Subtropical',
      'humid-subtropical': 'Humid subtropical',
      'humid-oceanic': 'Humid oceanic',
      'humid-subarctic': 'Humid subarctic',
      'tropical-savanna': 'Tropical savanna',
      'tropical-rainforest': 'Tropical rainforest',
    },
    growthEmpty: 'Nothing grows at this temperature.',
    growthStatus: {
      'year-round': 'Year round',
      seasonal: 'In season',
      marginal: 'Survives only',
      never: '—',
    },
    landOrOcean: 'Land / ocean',
    land: 'Land',
    ocean: 'Ocean',
    island: 'Island',
    mountain: 'Mountain',
    coastalMountain: 'Coastal mountain',
    distanceToOcean: 'Distance to ocean (grid cells, 128 blocks each)',
    baseLandHeight: 'Base land height (region index, not blocks)',
    biomeAltitude: 'Biome altitude (region index, not blocks)',
    rock: 'Rock',
    rockTop: 'Top',
    rockMiddle: 'Middle',
    rockBottom: 'Bottom',
    rockSurface: 'At surface',
    surfaceY: 'Approx. surface Y',
    yes: 'Yes',
    no: 'No',
    depositsEmpty: 'Click a marker on the minerals layer to see it here.',
    depositOre: 'Ore / mineral',
    depositKind: 'Kind',
    depositYRange: 'Y range',
    depositDepth: 'Depth below surface',
    // A vein whose shape reaches above ground is not ore in the air: TFC only places a block where
    // raw rock already is, so the vein is simply cut off by the terrain. Roughly a third of TFC's
    // deposits are in this state, almost all of them the shallow `surface_*` veins.
    depositDepthAbove: 'blocks above ground — the vein is cut off by the terrain',
    // Surface height gives the depth but not the exposure: the soil cap and the carvers are both
    // unported, so "can I see it?" stays unanswered rather than guessed. See
    // `src/worldgen/api/depth.ts`.
    depositExposure: 'Reachable without digging',
    exposureNames: {
      surface: 'Yes, exposed at the surface',
      cave: 'Yes, exposed in a cave',
      buried: 'No, fully buried',
      unknown: 'Not known yet — needs the cave carvers',
    },
    depositRarity: 'Rarity (1 in N chunks)',
    depositSize: 'Vein size',
    depositProduces: 'Yields',
    depositFootprint: 'Patch footprint',
    depositThickness: 'Patch thickness',
    depositCountNeedsSurface: 'Needs surface height; only the soil layer becomes clay',
    depositOreBlocks: 'Ore blocks, typical',
    approx: '≈ ',
    // "Has an indicator" on its own is misleading for a vein 100 blocks down -- the indicator only
    // spawns when the surface is within `Indicator.depth` of the topmost ore. See
    // `indicatorReachFor`.
    depositIndicator: 'Findable by walking',
    indicatorReachNames: {
      possible: 'Maybe — surface chunks can spawn over it',
      'too-deep': 'No — buried too deep for surface chunks',
      none: 'No — this vein leaves nothing on the surface',
      unknown: 'Not known — needs surface height for this profile',
    },
  },
  profileNames: {
    'tfc-1.20': 'TFC 1.20',
    // Short enough for the map's one-row seed/profile/dimension header without being cut off.
    tfg: 'TerraFirmaGreg 0.13.8',
    'tfc-1.18': 'TFC 1.18',
    vanilla: 'Vanilla',
  },
  dimensionNames: {
    overworld: 'Overworld',
    // TerraFirmaGreg rebuilds the Nether and every player calls it The Beneath, after the addon
    // that fills it. `minecraft:the_nether` is still the id underneath.
    nether: 'The Beneath',
    end: 'End',
    moon: 'The Moon',
    mars: 'Mars',
    venus: 'Venus',
    glacio: 'Glacio',
  },
  hud: {
    terrainOn: 'Terrain: on',
    terrainOff: 'Terrain: off',
    terrainTitle: 'Shaded relief over the map. Off gives the flat view.',
    // What the compass reports while it spins. Named after what the player asked to see, not after
    // the worker request that is actually running.
    features: 'Deposits',
    andMore: '+{count}',
  },
  structures: {
    heading: 'Structures',
    kind: 'Kind',
    variant: 'Variant',
    block: 'Block',
    // The position is exact; whether the structure is really there is a close approximation
    // (docs/PARITY.md, "Structures for tfg").
    approximate: 'Placement matches the game; whether it generated is approximate.',
    markCompleted: 'Mark as completed',
    completed: 'Completed',
  },
  /** One name per structure set (`src/data/tfg/structures.json`), keyed by set id. */
  structureKinds: {
    'tfg:aqueduct/aqueduct': 'Aqueduct',
    'tfg:illagers/arabic_village': 'Desert village',
    'tfg:illagers/illager_camps': 'Illager camp',
    'tfg:illagers/illager_forest_roaming': 'Forest patrol camp',
    'tfg:illagers/malay_village': 'Stilt village',
    'tfg:illagers/norse_village': 'Norse village',
    'tfg:illagers/yurts_village': 'Yurt village',
    'tfg:mineshaft/mineshaft': 'Mineshaft',
    'tfg:beneath/tower': 'Beneath tower',
    'tfg:moon/moonbase': 'Moonbase',
    'tfg:moon/meteors': 'Meteor crater',
    'tfg:moon/cheese_ores': 'Cheese deposit',
    'tfg:moon/moon_rabbit_houses': 'Moon rabbit burrow',
    'tfg:ocean/ocean_moai': 'Moai',
    'tfg:temperate/plains_temperate_house': 'Plains house',
    'tfc_ruins:ruins': 'Ruins',
    'tfc_ruined_world:ancient_monument_1': 'Ancient monument',
    'tfc_ruined_world:limestone_church': 'Ruined church',
    'tfc_ruined_world:tower_1': 'Ruined tower',
    'tfc_ruined_world:towerhouse_1': 'Towerhouse or castle',
  } as Record<string, string>,
  layerNames: {
    biome: 'Biome',
    rock: 'Rock',
    temperature: 'Temperature',
    rainfall: 'Rainfall',
    terrain: 'Terrain',
    hillshade: 'Shaded relief',
    contours: 'Contours',
    ores: 'Ores',
    minerals: 'Minerals',
    structures: 'Structures',
    grid: 'Grid',
    'region-debug': 'Region boundaries',
    filter: 'Filter',
  },
  biomeNames: {
    ...tfgBiomes.names,
    'tfc:ocean': 'Ocean',
    'tfc:ocean_reef': 'Ocean Reef',
    'tfc:deep_ocean': 'Deep Ocean',
    'tfc:deep_ocean_trench': 'Deep Ocean Trench',
    'tfc:plains': 'Plains',
    'tfc:hills': 'Hills',
    'tfc:lowlands': 'Lowlands',
    'tfc:salt_marsh': 'Salt Marsh',
    'tfc:low_canyons': 'Low Canyons',
    'tfc:rolling_hills': 'Rolling Hills',
    'tfc:highlands': 'Highlands',
    'tfc:badlands': 'Badlands',
    'tfc:inverted_badlands': 'Inverted Badlands',
    'tfc:plateau': 'Plateau',
    'tfc:old_mountains': 'Old Mountains',
    'tfc:mountains': 'Mountains',
    'tfc:volcanic_mountains': 'Volcanic Mountains',
    'tfc:oceanic_mountains': 'Oceanic Mountains',
    'tfc:volcanic_oceanic_mountains': 'Volcanic Oceanic Mountains',
    'tfc:canyons': 'Canyons',
    'tfc:shore': 'Shore',
    'tfc:tidal_flats': 'Tidal Flats',
    'tfc:lake': 'Lake',
    'tfc:river': 'River',
    'tfc:mountain_lake': 'Mountain Lake',
    'tfc:volcanic_mountain_lake': 'Volcanic Mountain Lake',
    'tfc:old_mountain_lake': 'Old Mountain Lake',
    'tfc:oceanic_mountain_lake': 'Oceanic Mountain Lake',
    'tfc:volcanic_oceanic_mountain_lake': 'Volcanic Oceanic Mountain Lake',
    'tfc:plateau_lake': 'Plateau Lake',
  } as Record<string, string>,
  rockNames: {
    andesite: 'Andesite',
    basalt: 'Basalt',
    chalk: 'Chalk',
    chert: 'Chert',
    claystone: 'Claystone',
    conglomerate: 'Conglomerate',
    dacite: 'Dacite',
    diorite: 'Diorite',
    dolomite: 'Dolomite',
    gabbro: 'Gabbro',
    gneiss: 'Gneiss',
    granite: 'Granite',
    limestone: 'Limestone',
    marble: 'Marble',
    phyllite: 'Phyllite',
    quartzite: 'Quartzite',
    rhyolite: 'Rhyolite',
    schist: 'Schist',
    shale: 'Shale',
    slate: 'Slate',
  } as Record<string, string>,
  // Disc-vein ids this phase can place (src/worldgen/tfc-1.20/features/disc-vein.ts's
  // SUPPORTED_DISC_VEINS) -- bare `random_name`, matching `DepositFeature.ore`'s 'tfc:' prefix
  // stripped. bituminous_coal/halite/lignite are surface-relative and excluded (not guessed).
  oreNames: {
    amethyst: 'Amethyst',
    borax: 'Borax',
    gravel: 'Gravel',
    gypsum: 'Gypsum',
    kaolin: 'Kaolin Clay',
    opal: 'Opal',
    saltpeter: 'Saltpeter',
    sulfur: 'Sulfur',
    sylvite: 'Sylvite',
    // Mixed veins: the id joins the two materials with an underscore, which `titleCase` turns into
    // "Copper Iron" -- a material that does not exist. Named for what the vein actually holds.
    copper_iron: 'Copper & Iron',
    copper_tin: 'Copper & Tin',
    copper_gypsum: 'Copper & Gypsum',
    quartz_borax: 'Quartz & Borax',
    magnetite_olivine: 'Magnetite & Olivine',
    lazurite_calcite: 'Lazurite & Calcite',
    banded_iron: 'Banded Iron',
    // Qualifiers the id puts after the material rather than before it.
    asbestos_dry: 'Dry Asbestos',
    graphite_volcanic: 'Volcanic Graphite',
    big_redstone: 'Redstone (large vein)',
    // TFC's own oddities, both checked against what the vein actually places in veins.json:
    // `fake_native_gold` places pyrite, and `gabbro_garnierite` is garnierite hosted in gabbro
    // rather than a mineral of that name.
    fake_native_gold: "Pyrite (fool's gold)",
    gabbro_garnierite: 'Garnierite (in gabbro)',
    rich_native_gold: 'Native Gold (rich)',
    sulfide: 'Sulfides',
  } as Record<string, string>,
  // Labels, units, defaults and one-line effects for the TFC 1.20 world-preset settings
  // (`net.dries007.tfc.world.settings.Settings`) exposed as sliders. Confirmed against
  // `$HOME/reference/tfc` -- see docs/WORLDGEN-NOTES.md's "World preset settings" section for the
  // exact class/method citations behind each description; none of this is guessed from the id.
  worldSettings: { heading: 'Advanced world settings', defaultLabel: 'Default' },
  worldSettingNames: {
    temperatureScale: 'Temperature scale',
    temperatureConstant: 'Temperature constant',
    rainfallScale: 'Rainfall scale',
    rainfallConstant: 'Rainfall constant',
    continentalness: 'Continentalness',
  } as Record<string, string>,
  worldSettingUnits: {
    temperatureScale: 'blocks',
    temperatureConstant: 'fraction, -1 to 1',
    rainfallScale: 'blocks',
    rainfallConstant: 'fraction, -1 to 1',
    continentalness: 'fraction, 0 to 1',
  } as Record<string, string>,
  worldSettingDescriptions: {
    temperatureScale:
      'Distance north to south between the hottest and coldest points before the pattern repeats. ' +
      'a bigger scale spreads temperature into broad, gradual bands; a smaller one cycles hot and ' +
      'cold more often as you travel. Set to 0 to use Temperature constant instead everywhere.',
    temperatureConstant:
      'Only takes effect when Temperature scale is 0: a fixed value (-1 cold to 1 hot) that gives ' +
      'one uniform temperature across the whole map instead of bands. Ignored otherwise.',
    rainfallScale:
      'Distance east to west between the wettest and driest points before the pattern repeats. A ' +
      'bigger scale spreads rainfall into broad, gradual bands; a smaller one cycles wet and dry ' +
      'more often as you travel. Set to 0 to use Rainfall constant instead everywhere.',
    rainfallConstant:
      'Only takes effect when Rainfall scale is 0: a fixed value (-1 dry to 1 wet) that gives one ' +
      'uniform rainfall level across the whole map instead of bands. Ignored otherwise.',
    continentalness:
      'How much of the map is land versus ocean. Higher values grow more and bigger continents; ' +
      'lower values shrink land and expand ocean.',
  } as Record<string, string>,
  // "Filter" panel (docs/FEEDBACK.md, Pau's rock/temperature/rainfall request): highlights
  // matching terrain by dimming everything else rather than hiding layers -- see the `filter`
  // raster layer (src/layers/raster-layers.ts) and docs/adr/0007-layer-compositing.md.
  filter: {
    heading: 'Filter',
    intro: 'Dims everything that does not match. Leave a field empty to ignore it.',
    oreDepthAbsolute: 'Y {range}',
    // A projected vein's range is measured from the surface, so showing it as an absolute Y would
    // send someone digging at the wrong depth.
    oreDepthFromSurface: '{range} from surface',
    rockHeading: 'Rock',
    rockMatchTop: 'Top layer only',
    rockMatchAny: 'Any layer (bottom, middle or top)',
    biomeHeading: 'Biome',
    selectAll: 'Select all',
    selectNone: 'Select none',
    temperatureHeading: 'Temperature (°C)',
    temperatureMinPlaceholder: 'Min',
    temperatureMaxPlaceholder: 'Max',
    rainfallHeading: 'Rainfall (mm)',
    rainfallMinPlaceholder: 'Min',
    rainfallMaxPlaceholder: 'Max',
    oreHeading: 'Ore / mineral',
    oreSearchPlaceholder: 'Search ores — try "silver"',
    // Blocks, not percentages, on the row itself: "57% gold" cannot tell you whether the trip is
    // worth it, "gold ~1,350" can.
    oreBlocks: '~{n} blocks',
    oreSearchHit: '{material} ~{n}',
    oreMixRow: '{material} ~{n} ({pct}%)',
    oreMixRowShare: '{material} {pct}%',
    oreMixNote: 'Upper bound: raw rock only.',
    // Measured against a real generated world, not guessed -- see tools/verify-veins.py.
    oreConfirmed: 'accuracy {n}%',
    oreUnverified: 'not found in a real world — hidden',
    // Accuracy is per marker and mostly a matter of depth -- see `markerConfidence`.
    oreAccuracyLabel: 'Only markers at least',
    oreAccuracyOff: 'show all',
    oreAccuracyNote: 'Deep veins are the sure ones: measured against a real world.',
    oreSearchEmpty: 'No ore matches “{query}”.',
    clear: 'Clear filter',
  },
  // Forging calculator panels (docs/PLAN.md section 14): custom recipe editor + saved list.
  forge: {
    heroTitle: 'Shape every strike before you swing.',
    heroBody:
      'Build exact finishing rules, save your recipes, and keep light, medium, and hard hits distinct.',
    catalogHeading: 'Default recipes',
    catalogProfileLabel: 'Profile',
    catalogSearchLabel: 'Search recipes',
    catalogSearchPlaceholder: 'Search by item, input, or output…',
    catalogCount: 'recipes',
    catalogNoResults: 'No recipes match this search.',
    catalogTier: 'Anvil tier',
    // TFC's tier -1: the recipe names no tier, and any anvil will do (AnvilRecipe, default -1).
    catalogAnyTier: 'Any anvil',
    catalogInput: 'Input',
    catalogOutput: 'Output',
    catalogRuleUnreadable: 'Unreadable finishing rule',
    solveButton: 'Solve',
    solveTargetLabel: 'Target work',
    solveTargetPlaceholder: '40 to 113',
    solveTargetHint:
      'Read this off the anvil screen. TerraFirmaCraft picks a target per world, so the same recipe is a different number in a different save.',
    solveTargetFromSeed:
      'Derived from your seed and this recipe, the way the game picks it. If the anvil shows a different number, type that one.',
    solveStepsHeading: 'Shortest sequence',
    solveErrorTarget: 'Enter the target work value shown on the anvil.',
    solveErrorTargetRange: 'The target must be between 0 and 149.',
    // Two different failures, and the fix is different for each: relax the rules, or check the
    // target. Saying only "no solution" leaves the player guessing which.
    solveNoSolutionRules:
      'The target is reachable, but not while satisfying these finishing rules. Check the rules against the anvil.',
    solveNoSolutionTarget:
      'No sequence reaches that target at all without running off the work bar. Check the number on the anvil.',
    editorHeading: 'Custom recipe',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. Warped sword, my variant',
    targetLabel: 'Target value',
    rulesHeading: 'Rules',
    rulesHint: 'Up to three rules constraining the final steps; leave a row empty for no rule.',
    rulesExtraNote:
      'This saved recipe also has rules the rows above cannot show. They are kept, and used when solving:',
    actionNames: {
      HIT: 'Hit',
      DRAW: 'Draw',
      PUNCH: 'Punch',
      BEND: 'Bend',
      UPSET: 'Upset',
      SHRINK: 'Shrink',
    },
    anyHitName: 'Any hit',
    hitStrengthNames: {
      LIGHT: 'Light hit',
      MEDIUM: 'Medium hit',
      HARD: 'Hard hit',
    },
    positionNames: {
      LAST: 'last step',
      SECOND_LAST: 'second last step',
      THIRD_LAST: 'third last step',
      ANY: 'any step',
      NOT_LAST: 'not the last step',
    },
    saveButton: 'Save recipe',
    updateButton: 'Update recipe',
    newButton: 'New recipe',
    formErrorName: 'Give the recipe a name.',
    formErrorTarget: 'The target value must be a whole number.',
    formErrorRule: 'Each rule needs both an action and a position.',
    statusSaved: 'Recipe saved.',
    statusUpdated: 'Recipe updated.',
    statusStoreFailed: 'Could not persist the recipe (storage full or unavailable).',
    unreadableKept:
      'saved recipe(s) could not be read. They are kept in storage exactly as they were, and are not shown.',
    listHeading: 'Saved recipes',
    listEmpty: 'No saved recipes yet.',
    openButton: 'Open',
    editButton: 'Edit',
    deleteButton: 'Delete',
    exportButton: 'Export JSON',
    importButton: 'Import JSON',
    importNote:
      'Importing replaces all saved recipes with the file contents. Export first to keep a backup.',
    importReadFailed: 'Could not read the selected file.',
    statusDeleted: 'Recipe deleted.',
    statusExported: 'All saved recipes exported as a JSON file.',
    statusImported: 'Import succeeded. The previous list has been replaced.',
    metaTargetLabel: 'target',
    noRulesText: 'no rules',
    importInvalidJson: 'The file is not valid JSON.',
    importWrongShape:
      'Not a recipe export: expected the JSON produced by Export, or a plain array of recipe objects.',
    importBadPrefix: 'Import rejected at recipe position',
    importFieldEntry: 'the entry is not a recipe object.',
    importFieldId: 'the id is missing or not a non-empty string.',
    importFieldName: 'the name is missing or empty.',
    importFieldTarget: 'the target value is missing or not a whole number.',
    importFieldRules: 'the rules are malformed (expected up to three action/position pairs).',
    importFieldNotes: 'the notes field is present but not text.',
    importFieldProfile: 'the profile field is present but not text.',
  },
} as const;

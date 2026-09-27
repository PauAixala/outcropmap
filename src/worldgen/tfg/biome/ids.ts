/** Port of TFG Core Modern 0.9.21 (2cf74e6), derived from TFC. EUPL-1.2. */
export const B = {
  DEEP_OCEAN_TRENCH: 0,
  DEEP_OCEAN: 1,
  OCEAN: 2,
  OCEAN_REEF: 3,
  PLAINS: 4,
  HILLS: 5,
  LOWLANDS: 6,
  SALT_MARSH: 7,
  LOW_CANYONS: 8,
  ROLLING_HILLS: 9,
  HIGHLANDS: 10,
  BADLANDS: 11,
  PLATEAU: 12,
  PLATEAU_WIDE: 13,
  CANYONS: 14,
  MOUNTAINS: 15,
  OLD_MOUNTAINS: 16,
  OCEANIC_MOUNTAINS: 17,
  VOLCANIC_MOUNTAINS: 18,
  VOLCANIC_OCEANIC_MOUNTAINS: 19,
  GUANO_ISLAND: 20,
  SHORE: 21,
  TIDAL_FLATS: 22,
  SEA_STACKS: 23,
  TERRACE_UPPER: 24,
  TERRACE_LOWER: 25,
  SETBACK_CLIFFS: 26,
  COASTAL_DUNES: 27,
  ROCKY_SHORES: 28,
  EMBAYMENTS: 29,
  LAKE: 30,
  RIVER: 31,
  MOUNTAIN_LAKE: 32,
  OLD_MOUNTAIN_LAKE: 33,
  OCEANIC_MOUNTAIN_LAKE: 34,
  VOLCANIC_MOUNTAIN_LAKE: 35,
  VOLCANIC_OCEANIC_MOUNTAIN_LAKE: 36,
  PLATEAU_LAKE: 37,
  MUD_FLATS: 38,
  SALT_FLATS: 39,
  DUNE_SEA: 40,
  GRASSY_DUNES: 41,
  WHORLED_CANYONS: 42,
  STAIR_STEP_CANYONS: 43,
  MESAS: 44,
  BUTTES: 45,
  HOODOOS: 46,
  ROCKY_PLATEAU: 47,
  TOWER_KARST_PLAINS: 48,
  TOWER_KARST_CANYONS: 49,
  TOWER_KARST_HILLS: 50,
  TOWER_KARST_HIGHLANDS: 51,
  TOWER_KARST_LAKE: 52,
  TOWER_KARST_BAY: 53,
  BURREN_PLATEAU: 54,
  BURREN_BADLANDS: 55,
  BURREN_BADLANDS_TALL: 56,
  BURREN_PLAINS: 57,
  BURREN_ROCHE_MOUTONEE: 58,
  SHILIN_PLAINS: 59,
  SHILIN_CANYONS: 60,
  SHILIN_HILLS: 61,
  SHILIN_HIGHLANDS: 62,
  SHILIN_PLATEAU: 63,
  DOLINE_PLAINS: 64,
  DOLINE_HILLS: 65,
  DOLINE_ROLLING_HILLS: 66,
  DOLINE_HIGHLANDS: 67,
  DOLINE_PLATEAU: 68,
  DOLINE_CANYONS: 69,
  CENOTE_PLAINS: 70,
  CENOTE_HILLS: 71,
  CENOTE_ROLLING_HILLS: 72,
  CENOTE_CANYONS: 73,
  CENOTE_HIGHLANDS: 74,
  CENOTE_PLATEAU: 75,
  EXTREME_DOLINE_PLATEAU: 76,
  EXTREME_DOLINE_MOUNTAINS: 77,
  ACTIVE_SHIELD_VOLCANO: 78,
  DORMANT_SHIELD_VOLCANO: 79,
  EXTINCT_SHIELD_VOLCANO: 80,
  ANCIENT_SHIELD_VOLCANO: 81,
  SUNKEN_SHIELD_VOLCANO: 82,
  SHIELD_VOLCANO_SHORE: 83,
  OLD_SHIELD_VOLCANO_SHORE: 84,
  ICE_SHEET: 85,
  ICE_SHEET_MOUNTAINS: 86,
  ICE_SHEET_OCEANIC_MOUNTAINS: 87,
  ICE_SHEET_SHIELD_VOLCANO: 88,
  ICE_SHEET_TUYAS: 89,
  SUBGLACIAL_LAKE: 90,
  ICE_SHEET_EDGE: 91,
  ICE_SHEET_TUYAS_EDGE: 92,
  ICE_SHEET_MOUNTAINS_EDGE: 93,
  ICE_SHEET_OCEANIC_MOUNTAINS_EDGE: 94,
  MELTWATER_LAKE: 95,
  ICE_SHEET_OCEANIC: 96,
  ICE_SHEET_SHORE: 97,
  GLACIATED_MOUNTAINS: 98,
  GLACIATED_OCEANIC_MOUNTAINS: 99,
  GLACIATED_SHIELD_VOLCANO: 100,
  GLACIALLY_CARVED_MOUNTAINS: 101,
  GLACIALLY_CARVED_OCEANIC_MOUNTAINS: 102,
  DRUMLINS: 103,
  TUYAS: 104,
  KNOB_AND_KETTLE: 105,
  PATTERNED_GROUND: 106,
  INVERTED_PATTERNED_GROUND: 107,
  STONE_CIRCLES: 108,
} as const;

export const BIOME_IDS = [
  'tfg:earth/deep_ocean_trench',
  'tfg:earth/deep_ocean',
  'tfg:earth/ocean',
  'tfg:earth/ocean_reef',
  'tfg:earth/plains',
  'tfg:earth/hills',
  'tfg:earth/lowlands',
  'tfg:earth/salt_marsh',
  'tfg:earth/low_canyons',
  'tfg:earth/rolling_hills',
  'tfg:earth/highlands',
  'tfg:earth/badlands',
  'tfg:earth/plateau',
  'tfg:earth/plateau_wide',
  'tfg:earth/canyons',
  'tfg:earth/mountains',
  'tfg:earth/old_mountains',
  'tfg:earth/oceanic_mountains',
  'tfg:earth/volcanic_mountains',
  'tfg:earth/volcanic_oceanic_mountains',
  'tfg:earth/guano_island',
  'tfg:earth/shore',
  'tfg:earth/tidal_flats',
  'tfg:earth/sea_stacks',
  'tfg:earth/terrace_upper',
  'tfg:earth/terrace_lower',
  'tfg:earth/setback_cliffs',
  'tfg:earth/coastal_dunes',
  'tfg:earth/rocky_shores',
  'tfg:earth/embayments',
  'tfg:earth/lake',
  'tfg:earth/river',
  'tfg:earth/mountain_lake',
  'tfg:earth/old_mountain_lake',
  'tfg:earth/oceanic_mountain_lake',
  'tfg:earth/volcanic_mountain_lake',
  'tfg:earth/volcanic_oceanic_mountain_lake',
  'tfg:earth/plateau_lake',
  'tfg:earth/mud_flats',
  'tfg:earth/salt_flats',
  'tfg:earth/dune_sea',
  'tfg:earth/grassy_dunes',
  'tfg:earth/whorled_canyons',
  'tfg:earth/stair_step_canyons',
  'tfg:earth/mesas',
  'tfg:earth/buttes',
  'tfg:earth/hoodoos',
  'tfg:earth/rocky_plateau',
  'tfg:earth/tower_karst_plains',
  'tfg:earth/tower_karst_canyons',
  'tfg:earth/tower_karst_hills',
  'tfg:earth/tower_karst_highlands',
  'tfg:earth/tower_karst_lake',
  'tfg:earth/tower_karst_bay',
  'tfg:earth/burren_plateau',
  'tfg:earth/burren_badlands',
  'tfg:earth/burren_badlands_tall',
  'tfg:earth/burren_plains',
  'tfg:earth/burren_roche_moutonee',
  'tfg:earth/shilin_plains',
  'tfg:earth/shilin_canyons',
  'tfg:earth/shilin_hills',
  'tfg:earth/shilin_highlands',
  'tfg:earth/shilin_plateau',
  'tfg:earth/doline_plains',
  'tfg:earth/doline_hills',
  'tfg:earth/doline_rolling_hills',
  'tfg:earth/doline_highlands',
  'tfg:earth/doline_plateau',
  'tfg:earth/doline_canyons',
  'tfg:earth/cenote_plains',
  'tfg:earth/cenote_hills',
  'tfg:earth/cenote_rolling_hills',
  'tfg:earth/cenote_canyons',
  'tfg:earth/cenote_highlands',
  'tfg:earth/cenote_plateau',
  'tfg:earth/extreme_doline_plateau',
  'tfg:earth/extreme_doline_mountains',
  'tfg:earth/active_shield_volcano',
  'tfg:earth/dormant_shield_volcano',
  'tfg:earth/extinct_shield_volcano',
  'tfg:earth/ancient_shield_volcano',
  'tfg:earth/sunken_shield_volcano',
  'tfg:earth/shield_volcano_shore',
  'tfg:earth/old_shield_volcano_shore',
  'tfg:earth/ice_sheet',
  'tfg:earth/ice_sheet_mountains',
  'tfg:earth/ice_sheet_oceanic_mountains',
  'tfg:earth/ice_sheet_shield_volcano',
  'tfg:earth/ice_sheet_tuyas',
  'tfg:earth/subglacial_lake',
  'tfg:earth/ice_sheet_edge',
  'tfg:earth/ice_sheet_tuyas_edge',
  'tfg:earth/ice_sheet_mountains_edge',
  'tfg:earth/ice_sheet_oceanic_mountains_edge',
  'tfg:earth/meltwater_lake',
  'tfg:earth/ice_sheet_oceanic',
  'tfg:earth/ice_sheet_shore',
  'tfg:earth/glaciated_mountains',
  'tfg:earth/glaciated_oceanic_mountains',
  'tfg:earth/glaciated_shield_volcano',
  'tfg:earth/glacially_carved_mountains',
  'tfg:earth/glacially_carved_oceanic_mountains',
  'tfg:earth/drumlins',
  'tfg:earth/tuyas',
  'tfg:earth/knob_and_kettle',
  'tfg:earth/patterned_ground',
  'tfg:earth/inverted_patterned_ground',
  'tfg:earth/stone_circles',
];

export function isOcean(value: number): boolean {
  return (
    value == B.OCEAN ||
    value == B.DEEP_OCEAN ||
    value == B.DEEP_OCEAN_TRENCH ||
    value == B.OCEAN_REEF
  );
}

export function isFlats(value: number): boolean {
  return value == B.MUD_FLATS || value == B.SALT_FLATS;
}

export function isFlatIceSheet(value: number): boolean {
  return value == B.ICE_SHEET || value == B.ICE_SHEET_TUYAS || value == B.SUBGLACIAL_LAKE;
}

export function isMountains(value: number): boolean {
  return (
    value == B.MOUNTAINS ||
    value == B.OCEANIC_MOUNTAINS ||
    value == B.OLD_MOUNTAINS ||
    value == B.VOLCANIC_MOUNTAINS ||
    value == B.VOLCANIC_OCEANIC_MOUNTAINS
  );
}

export function isLow(value: number): boolean {
  return (
    value == B.PLAINS ||
    value == B.HILLS ||
    value == B.LOW_CANYONS ||
    value == B.LOWLANDS ||
    value == B.SALT_MARSH ||
    value == B.MUD_FLATS ||
    value == B.SALT_FLATS ||
    value == B.DUNE_SEA
  );
}

export function hasShore(value: number): boolean {
  return (
    value != B.LOW_CANYONS &&
    value != B.CANYONS &&
    value != B.OCEANIC_MOUNTAINS &&
    value != B.VOLCANIC_OCEANIC_MOUNTAINS &&
    value != B.TOWER_KARST_BAY &&
    value != B.SUNKEN_SHIELD_VOLCANO &&
    value != B.GLACIALLY_CARVED_OCEANIC_MOUNTAINS &&
    value != B.GLACIATED_OCEANIC_MOUNTAINS &&
    value != B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE &&
    value != B.ICE_SHEET_SHIELD_VOLCANO &&
    value != B.GLACIATED_SHIELD_VOLCANO &&
    value != B.GUANO_ISLAND
  );
}

export function shoreFor(value: number): number {
  if (value == B.LOWLANDS || value == B.SALT_MARSH) {
    return B.SALT_MARSH;
  }
  if (value == B.MOUNTAINS) {
    return B.OCEANIC_MOUNTAINS;
  }
  if (value == B.VOLCANIC_MOUNTAINS) {
    return B.VOLCANIC_OCEANIC_MOUNTAINS;
  }
  if (value == B.TOWER_KARST_LAKE) {
    return B.TOWER_KARST_BAY;
  }
  if (value == B.ACTIVE_SHIELD_VOLCANO) {
    return B.SHIELD_VOLCANO_SHORE;
  }
  if (
    value == B.DORMANT_SHIELD_VOLCANO ||
    value == B.EXTINCT_SHIELD_VOLCANO ||
    value == B.ANCIENT_SHIELD_VOLCANO
  ) {
    return B.OLD_SHIELD_VOLCANO_SHORE;
  }
  if (isFlatIceSheet(value) || value == B.ICE_SHEET_EDGE || value == B.ICE_SHEET_OCEANIC) {
    return B.ICE_SHEET_SHORE;
  }
  if (value == B.ICE_SHEET_OCEANIC_MOUNTAINS) {
    return B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE;
  }
  if (value == B.GLACIALLY_CARVED_OCEANIC_MOUNTAINS || value == B.GLACIALLY_CARVED_MOUNTAINS) {
    return B.GLACIATED_OCEANIC_MOUNTAINS;
  }
  if (value == B.OLD_MOUNTAINS || value == B.EXTREME_DOLINE_MOUNTAINS) {
    return B.TERRACE_LOWER;
  }
  if (
    value == B.PLATEAU ||
    value == B.EXTREME_DOLINE_PLATEAU ||
    value == B.BURREN_PLATEAU ||
    value == B.SHILIN_PLATEAU
  ) {
    return B.SEA_STACKS;
  }
  if (value == B.PLATEAU_WIDE || value == B.ROCKY_PLATEAU || value == B.DOLINE_PLATEAU) {
    return B.SETBACK_CLIFFS;
  }
  if (
    value == B.HIGHLANDS ||
    value == B.CENOTE_HIGHLANDS ||
    value == B.DOLINE_HIGHLANDS ||
    value == B.SHILIN_HIGHLANDS ||
    value == B.TOWER_KARST_HIGHLANDS
  ) {
    return B.ROCKY_SHORES;
  }
  if (
    value == B.ROLLING_HILLS ||
    value == B.DOLINE_ROLLING_HILLS ||
    value == B.CENOTE_ROLLING_HILLS
  ) {
    return B.EMBAYMENTS;
  }
  if (
    value == B.HILLS ||
    value == B.CENOTE_HILLS ||
    value == B.DOLINE_HILLS ||
    value == B.SHILIN_HILLS ||
    value == B.TOWER_KARST_HILLS ||
    value == B.GRASSY_DUNES ||
    value == B.DUNE_SEA
  ) {
    return B.COASTAL_DUNES;
  }
  return B.TIDAL_FLATS;
}

export function hasLake(value: number): boolean {
  return (
    !isOcean(value) &&
    value != B.BADLANDS &&
    value != B.ACTIVE_SHIELD_VOLCANO &&
    value != B.DORMANT_SHIELD_VOLCANO &&
    value != B.EXTINCT_SHIELD_VOLCANO &&
    value != B.ANCIENT_SHIELD_VOLCANO &&
    value != B.ICE_SHEET_MOUNTAINS &&
    value != B.ICE_SHEET_MOUNTAINS_EDGE &&
    value != B.ICE_SHEET_OCEANIC_MOUNTAINS &&
    value != B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE &&
    value != B.ICE_SHEET_SHIELD_VOLCANO &&
    value != B.ICE_SHEET_SHORE &&
    value != B.GLACIATED_SHIELD_VOLCANO &&
    value != B.GLACIATED_MOUNTAINS &&
    value != B.GLACIATED_OCEANIC_MOUNTAINS &&
    value != B.GLACIALLY_CARVED_MOUNTAINS &&
    value != B.GLACIALLY_CARVED_OCEANIC_MOUNTAINS
  );
}

export function lakeFor(value: number): number {
  if (value == B.MOUNTAINS) {
    return B.MOUNTAIN_LAKE;
  }
  if (value == B.VOLCANIC_MOUNTAINS) {
    return B.VOLCANIC_MOUNTAIN_LAKE;
  }
  if (value == B.OLD_MOUNTAINS) {
    return B.OLD_MOUNTAIN_LAKE;
  }
  if (value == B.OCEANIC_MOUNTAINS) {
    return B.OCEANIC_MOUNTAIN_LAKE;
  }
  if (value == B.VOLCANIC_OCEANIC_MOUNTAINS) {
    return B.VOLCANIC_OCEANIC_MOUNTAIN_LAKE;
  }
  if (value == B.PLATEAU) {
    return B.PLATEAU_LAKE;
  }
  if (isFlatIceSheet(value)) {
    return B.SUBGLACIAL_LAKE;
  }
  if (value == B.ICE_SHEET_EDGE) {
    return B.MELTWATER_LAKE;
  }
  return B.LAKE;
}

/** BiomeBuilder defaults to rivers unless noRivers() is called. */
export const NO_RIVERS: ReadonlySet<number> = new Set([
  B.OCEAN,
  B.OCEAN_REEF,
  B.DEEP_OCEAN,
  B.DEEP_OCEAN_TRENCH,
  B.SHORE,
  B.TIDAL_FLATS,
  B.SEA_STACKS,
  B.TERRACE_UPPER,
  B.TERRACE_LOWER,
  B.SETBACK_CLIFFS,
  B.COASTAL_DUNES,
  B.ROCKY_SHORES,
  B.EMBAYMENTS,
  B.LAKE,
  B.MOUNTAIN_LAKE,
  B.OLD_MOUNTAIN_LAKE,
  B.OCEANIC_MOUNTAIN_LAKE,
  B.VOLCANIC_MOUNTAIN_LAKE,
  B.VOLCANIC_OCEANIC_MOUNTAIN_LAKE,
  B.PLATEAU_LAKE,
  B.SUBGLACIAL_LAKE,
  B.MELTWATER_LAKE,
]);

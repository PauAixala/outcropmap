/** Port of TFG Core Modern 0.9.21 (2cf74e6), derived from TFC. EUPL-1.2. */
import { XoroshiroRandomSource } from '@core/random';
import type { Area } from '../../tfc-1.20/biome/area';
import type { TFGRegion } from '../region/initialization';
import { B, isFlatIceSheet } from './ids';
const f = Math.fround;
function floorMod(value: bigint, divisor: number): number {
  const d = BigInt(divisor);
  return Number(((value % d) + d) % d);
}
const MOUNTAIN_ALTITUDE_BIOMES = [
  B.MOUNTAINS,
  B.MOUNTAINS,
  B.MOUNTAINS,
  B.OLD_MOUNTAINS,
  B.OLD_MOUNTAINS,
  B.PLATEAU,
  B.HIGHLANDS,
];
const OCEANIC_MOUNTAIN_ALTITUDE_BIOMES = [
  B.VOLCANIC_MOUNTAINS,
  B.VOLCANIC_OCEANIC_MOUNTAINS,
  B.VOLCANIC_OCEANIC_MOUNTAINS,
  B.OCEANIC_MOUNTAINS,
  B.OCEANIC_MOUNTAINS,
  B.ROLLING_HILLS,
];
const ALTITUDE_BIOMES = [
  [B.PLAINS, B.PLAINS, B.HILLS, B.HILLS, B.ROLLING_HILLS, B.LOW_CANYONS, B.LOWLANDS, B.LOWLANDS], // Low
  [
    B.PLAINS,
    B.HILLS,
    B.ROLLING_HILLS,
    B.ROLLING_HILLS,
    B.ROLLING_HILLS,
    B.HIGHLANDS,
    B.BUTTES,
    B.MESAS,
    B.BADLANDS,
    B.PLATEAU_WIDE,
    B.CANYONS,
    B.CANYONS,
    B.LOW_CANYONS,
  ], // Mid
  [
    B.HIGHLANDS,
    B.HIGHLANDS,
    B.HIGHLANDS,
    B.HIGHLANDS,
    B.ROLLING_HILLS,
    B.ROLLING_HILLS,
    B.BADLANDS,
    B.BADLANDS,
    B.STAIR_STEP_CANYONS,
    B.PLATEAU,
    B.PLATEAU,
    B.PLATEAU,
    B.PLATEAU_WIDE,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
  ], // High
];
const ICE_SHEET_ALTITUDE_BIOMES = [
  [B.ICE_SHEET, B.ICE_SHEET, B.ICE_SHEET, B.ICE_SHEET, B.ICE_SHEET, B.ICE_SHEET_TUYAS], // Low
  [
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET_TUYAS,
    B.ICE_SHEET,
    B.ICE_SHEET_TUYAS,
  ], // Mid
  [
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET,
    B.ICE_SHEET_TUYAS,
    B.ICE_SHEET_TUYAS,
    B.ICE_SHEET_MOUNTAINS,
    B.ICE_SHEET_MOUNTAINS,
  ], // High
];
const PALEO_ICE_SHEET_ALTITUDE_BIOMES = [
  [
    B.PATTERNED_GROUND,
    B.INVERTED_PATTERNED_GROUND,
    B.KNOB_AND_KETTLE,
    B.KNOB_AND_KETTLE,
    B.KNOB_AND_KETTLE,
    B.DRUMLINS,
    B.TUYAS,
    B.LOWLANDS,
    B.LOWLANDS,
  ], // Low
  [
    B.PATTERNED_GROUND,
    B.KNOB_AND_KETTLE,
    B.DRUMLINS,
    B.DRUMLINS,
    B.DRUMLINS,
    B.DRUMLINS,
    B.TUYAS,
    B.TUYAS,
  ], // Mid
  [
    B.DRUMLINS,
    B.DRUMLINS,
    B.DRUMLINS,
    B.BADLANDS,
    B.BADLANDS,
    B.PLATEAU,
    B.PLATEAU,
    B.PLATEAU,
    B.PLATEAU_WIDE,
    B.ICE_SHEET_MOUNTAINS,
  ], // High
];
const DESERT_ALTITUDE_BIOMES = [
  [B.BUTTES, B.GRASSY_DUNES, B.DUNE_SEA, B.DUNE_SEA, B.DUNE_SEA, B.SALT_FLATS, B.SALT_FLATS], // Low
  [
    B.DUNE_SEA,
    B.BUTTES,
    B.BUTTES,
    B.HOODOOS,
    B.MESAS,
    B.MESAS,
    B.STAIR_STEP_CANYONS,
    B.BADLANDS,
    B.PLATEAU,
    B.CANYONS,
    B.WHORLED_CANYONS,
  ], // Mid
  [
    B.HOODOOS,
    B.MESAS,
    B.STAIR_STEP_CANYONS,
    B.STAIR_STEP_CANYONS,
    B.ROCKY_PLATEAU,
    B.ROCKY_PLATEAU,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
    B.WHORLED_CANYONS,
  ], // High
];
const SEMI_ARID_ALTITUDE_BIOMES = [
  [
    B.PLAINS,
    B.HILLS,
    B.HILLS,
    B.GRASSY_DUNES,
    B.GRASSY_DUNES,
    B.GRASSY_DUNES,
    B.GRASSY_DUNES,
    B.LOW_CANYONS,
    B.LOWLANDS,
    B.LOWLANDS,
    B.MUD_FLATS,
  ], // Low
  [
    B.PLAINS,
    B.HILLS,
    B.ROLLING_HILLS,
    B.ROLLING_HILLS,
    B.HIGHLANDS,
    B.HIGHLANDS,
    B.BADLANDS,
    B.BADLANDS,
    B.PLATEAU_WIDE,
    B.CANYONS,
    B.LOW_CANYONS,
    B.WHORLED_CANYONS,
    B.BUTTES,
    B.MESAS,
    B.MESAS,
    B.HOODOOS,
  ], // Mid
  [
    B.HIGHLANDS,
    B.HIGHLANDS,
    B.MESAS,
    B.HOODOOS,
    B.ROLLING_HILLS,
    B.ROLLING_HILLS,
    B.BADLANDS,
    B.BADLANDS,
    B.PLATEAU_WIDE,
    B.ROCKY_PLATEAU,
    B.STAIR_STEP_CANYONS,
    B.STAIR_STEP_CANYONS,
    B.OLD_MOUNTAINS,
    B.OLD_MOUNTAINS,
    B.WHORLED_CANYONS,
  ], // High
];
const KNOB_AND_KETTLE_BIOMES = [B.KNOB_AND_KETTLE, B.PATTERNED_GROUND, B.INVERTED_PATTERNED_GROUND];
const ISLAND_BIOMES = [
  B.PLAINS,
  B.HILLS,
  B.ROLLING_HILLS,
  B.VOLCANIC_OCEANIC_MOUNTAINS,
  B.VOLCANIC_OCEANIC_MOUNTAINS,
  B.GUANO_ISLAND,
];
const MID_DEPTH_OCEAN_BIOMES = [
  B.DEEP_OCEAN,
  B.OCEAN,
  B.OCEAN,
  B.OCEAN_REEF,
  B.OCEAN_REEF,
  B.OCEAN_REEF,
];

export function chooseBiomes(
  region: TFGRegion,
  random: XoroshiroRandomSource,
  blobArea: Area,
): void {
  const rngSeed = random.nextLong();
  const climateSeed = random.nextLong();

  for (const point of region.data) {
    if (!point) continue;

    const areaSeed = blobArea(point.x, point.z);
    if (point.island()) {
      point.biome = randomSeededFrom(rngSeed, areaSeed, ISLAND_BIOMES);
    } else if (point.mountain()) {
      const temp = point.temperature;
      if (point.coastalMountain()) {
        // Different temperature limits used because biomes at different elevations
        const maxIceSheetTemp = f(-16 + f(f(0.006) * point.rainfall));
        if (temp < f(maxIceSheetTemp + 2)) {
          point.biome = B.ICE_SHEET_OCEANIC_MOUNTAINS;
        } else if (temp < f(maxIceSheetTemp + 6)) {
          point.biome = B.GLACIATED_OCEANIC_MOUNTAINS;
        } else if (temp < f(maxIceSheetTemp + 10)) {
          point.biome = B.GLACIALLY_CARVED_OCEANIC_MOUNTAINS;
        } else {
          point.biome = randomSeededFrom(rngSeed, areaSeed, OCEANIC_MOUNTAIN_ALTITUDE_BIOMES);
        }
      } else {
        const maxIceSheetTemp = f(-14 + f(f(0.006) * point.rainfall));
        if (temp < maxIceSheetTemp) {
          point.biome = B.ICE_SHEET_MOUNTAINS;
        } else if (temp < f(maxIceSheetTemp + 4)) {
          point.biome = B.GLACIATED_MOUNTAINS;
        } else if (temp < f(maxIceSheetTemp + 10)) {
          point.biome = B.GLACIALLY_CARVED_MOUNTAINS;
        } else {
          point.biome = randomSeededFrom(rngSeed, areaSeed, MOUNTAIN_ALTITUDE_BIOMES);
        }
      }
    } else if (point.land()) {
      const rain = point.rainfall;
      const maxIceSheetTemp = f(-17 + f(f(0.006) * rain));
      const temp = point.temperature;
      if (temp < maxIceSheetTemp) {
        let biome = randomSeededFrom(
          rngSeed,
          areaSeed,
          ICE_SHEET_ALTITUDE_BIOMES[point.discreteBiomeAltitude()]!,
        );

        if (point.distanceToOcean < 3 && isFlatIceSheet(biome)) {
          biome = B.ICE_SHEET_OCEANIC;
        }
        point.biome = biome;
      } else if (temp < f(maxIceSheetTemp + 1)) {
        point.biome = B.ICE_SHEET_EDGE;
      } else if (temp < maxIceSheetTemp + 2.5) {
        point.biome = randomSeededFrom(rngSeed, areaSeed, KNOB_AND_KETTLE_BIOMES);
      } else if (temp < f(maxIceSheetTemp + 6)) {
        point.biome = randomSeededFrom(
          rngSeed,
          areaSeed,
          PALEO_ICE_SHEET_ALTITUDE_BIOMES[point.discreteBiomeAltitude()]!,
        );
      } else if (rain < 60) {
        point.biome = randomSeededFrom(
          rngSeed,
          areaSeed,
          DESERT_ALTITUDE_BIOMES[point.discreteBiomeAltitude()]!,
        );
      } else if (rain < 155) {
        point.biome = randomSeededFrom(
          rngSeed,
          areaSeed,
          SEMI_ARID_ALTITUDE_BIOMES[point.discreteBiomeAltitude()]!,
        );
      } else {
        point.biome = randomSeededFrom(
          rngSeed,
          areaSeed,
          ALTITUDE_BIOMES[point.discreteBiomeAltitude()]!,
        );
      }
    } else if (point.baseOceanDepth < 3) {
      point.biome = B.OCEAN;
    } else if (point.baseOceanDepth > 9) {
      point.biome = B.DEEP_OCEAN_TRENCH;
    } else if (point.baseOceanDepth >= 5 || point.distanceToEdge < 2) {
      point.biome = B.DEEP_OCEAN;
    } else {
      point.biome = randomSeededFrom(rngSeed, areaSeed, MID_DEPTH_OCEAN_BIOMES);
    }

    // Add hot spot biomes
    const age = point.hotSpotAge;
    if (age > 0) {
      // TO CHECK: the biome parentheses are missing in 1.21 TFC
      if (
        age == 4 &&
        (point.biome == B.OCEAN ||
          point.biome == B.DEEP_OCEAN ||
          point.biome == B.OCEAN_REEF ||
          point.biome == B.DEEP_OCEAN_TRENCH)
      ) {
        point.biome = B.SUNKEN_SHIELD_VOLCANO;
      } else {
        point.biome = getHotSpotBiome(point.hotSpotAge);
      }
    }

    // Adjust certain biome placements by climate. Low, freshwater biomes don't make much sense appearing in
    // Replacements for very low rainfall areas
    const minRainForLowFreshWaterBiomes = 90 + floorMod(BigInt(areaSeed) ^ climateSeed, 40);
    const rainfall = point.rainfall;
    const temperature = point.temperature;
    if (rainfall < minRainForLowFreshWaterBiomes) {
      if (rainfall <= 55) {
        if (point.biome == B.LOWLANDS || point.biome == B.LOW_CANYONS) point.biome = B.SALT_FLATS;
        else if (
          point.biome == B.HILLS ||
          point.biome == B.ROLLING_HILLS ||
          point.biome == B.PLATEAU
        )
          point.biome = B.DUNE_SEA;
      }
    }
    if (
      rainfall < 145 &&
      (point.biome == B.PATTERNED_GROUND || point.biome == B.INVERTED_PATTERNED_GROUND)
    )
      point.biome = B.STONE_CIRCLES;

    // Prevent badlands from appearing in very high rainfall environments
    const maxRainfallForBadlands = 420 + floorMod(BigInt(areaSeed) ^ climateSeed, 40);
    if (rainfall > maxRainfallForBadlands) {
      if (point.biome == B.BADLANDS) point.biome = B.HIGHLANDS;
    }

    // Special Biome Glaciation
    const maxIceSheetTemp = f(-14 + f(f(0.006) * rainfall));
    if (point.land() && temperature < maxIceSheetTemp) {
      const biome = point.biome;
      if (
        biome == B.ACTIVE_SHIELD_VOLCANO ||
        biome == B.DORMANT_SHIELD_VOLCANO ||
        biome == B.EXTINCT_SHIELD_VOLCANO
      )
        point.biome = B.ICE_SHEET_SHIELD_VOLCANO;
    } else if (temperature < f(maxIceSheetTemp + 4)) {
      const biome = point.biome;
      if (
        biome == B.ACTIVE_SHIELD_VOLCANO ||
        biome == B.DORMANT_SHIELD_VOLCANO ||
        biome == B.EXTINCT_SHIELD_VOLCANO
      )
        point.biome = B.GLACIATED_SHIELD_VOLCANO;
    }

    // Karst Biomes
    if (point.isSurfaceRockKarst) {
      // High rainfall karst biomes
      if (rainfall > 375) {
        // Check for hot, wet climates to place tower karsts
        if (rainfall > 425 && f(rainfall + f(10 * temperature)) > 500) {
          point.biome = getTowerKarstBiome(point.biome);
        }
        //Tropical/Subtropical wet areas not filled in by towers are Shilin
        else if (temperature > 9) {
          point.biome = getShilinBiome(point.biome);
        }
        // Colder wet biomes are Burren
        else if (temperature < 0) {
          point.biome = getBurrenBiome(point.biome);
        } else {
          point.biome = getDolineBiome(point.biome);
        }
      } else if (rainfall > 250) {
        if (temperature > 5) {
          point.biome = getCenoteBiome(point.biome);
        } else {
          point.biome = getDolineBiome(point.biome);
        }
      }
    }

    // Increase prevalence/size of salt marshes in climates where mangroves can generate
    if (
      point.distanceToOcean <= 2 &&
      point.biome == B.LOWLANDS &&
      point.rainfall > 220 &&
      point.temperature > 18
    ) {
      point.biome = B.SALT_MARSH;
    }
  }
}

function getHotSpotBiome(age: number): number {
  if (age == 4) return B.ANCIENT_SHIELD_VOLCANO;
  if (age == 3) return B.EXTINCT_SHIELD_VOLCANO;
  if (age == 2) return B.DORMANT_SHIELD_VOLCANO;
  if (age == 1) return B.ACTIVE_SHIELD_VOLCANO;
  return B.PLAINS;
}

function getTowerKarstBiome(biome: number): number {
  if (biome == B.SALT_MARSH) return B.TOWER_KARST_BAY;
  else if (biome == B.LOWLANDS) return B.TOWER_KARST_LAKE;
  else if (biome == B.PLAINS || biome == B.LOW_CANYONS) return B.TOWER_KARST_PLAINS;
  else if (biome == B.CANYONS) return B.TOWER_KARST_CANYONS;
  else if (biome == B.HILLS || biome == B.ROLLING_HILLS || biome == B.BADLANDS)
    return B.TOWER_KARST_HILLS;
  else if (biome == B.HIGHLANDS) return B.TOWER_KARST_HIGHLANDS;
  else if (biome == B.PLATEAU || biome == B.PLATEAU_WIDE) return B.EXTREME_DOLINE_PLATEAU;
  else if (biome == B.OLD_MOUNTAINS || biome == B.MOUNTAINS || biome == B.OCEANIC_MOUNTAINS)
    return B.EXTREME_DOLINE_MOUNTAINS;
  else return biome;
}

function getShilinBiome(biome: number): number {
  if (biome == B.PLAINS) return B.SHILIN_PLAINS;
  if (biome == B.CANYONS) return B.SHILIN_CANYONS;
  if (biome == B.ROLLING_HILLS || biome == B.BADLANDS) return B.SHILIN_HILLS;
  if (biome == B.PLATEAU || biome == B.PLATEAU_WIDE) return B.SHILIN_PLATEAU;
  if (biome == B.HIGHLANDS) return B.SHILIN_HIGHLANDS;
  return biome;
}

function getBurrenBiome(biome: number): number {
  if (biome == B.PLAINS || biome == B.CANYONS) return B.BURREN_PLAINS;
  if (biome == B.BADLANDS || biome == B.HILLS || biome == B.ROLLING_HILLS) return B.BURREN_BADLANDS;
  if (biome == B.DRUMLINS) return B.BURREN_ROCHE_MOUTONEE;
  if (biome == B.HIGHLANDS) return B.BURREN_BADLANDS_TALL;
  if (biome == B.PLATEAU || biome == B.PLATEAU_WIDE) return B.BURREN_PLATEAU;
  else return biome;
}

function getDolineBiome(biome: number): number {
  if (biome == B.CANYONS) return B.DOLINE_CANYONS;
  else if (biome == B.PLAINS || biome == B.LOW_CANYONS) return B.DOLINE_PLAINS;
  else if (biome == B.HILLS) return B.DOLINE_HILLS;
  else if (biome == B.ROLLING_HILLS) return B.DOLINE_ROLLING_HILLS;
  else if (biome == B.HIGHLANDS) return B.DOLINE_HIGHLANDS;
  else if (biome == B.PLATEAU || biome == B.PLATEAU_WIDE) return B.DOLINE_PLATEAU;
  else return biome;
}

function getCenoteBiome(biome: number): number {
  if (biome == B.CANYONS) return B.CENOTE_CANYONS;
  else if (biome == B.PLAINS || biome == B.LOW_CANYONS) return B.CENOTE_PLAINS;
  else if (biome == B.HILLS) return B.CENOTE_HILLS;
  else if (biome == B.ROLLING_HILLS) return B.CENOTE_ROLLING_HILLS;
  else if (biome == B.HIGHLANDS) return B.CENOTE_HIGHLANDS;
  else if (biome == B.PLATEAU || biome == B.PLATEAU_WIDE) return B.CENOTE_PLATEAU;
  else return biome;
}

function randomSeededFrom(rngSeed: bigint, areaSeed: number, choices: readonly number[]): number {
  return choices[floorMod(rngSeed ^ BigInt(areaSeed), choices.length)]!;
}

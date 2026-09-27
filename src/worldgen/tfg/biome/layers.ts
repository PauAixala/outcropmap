/** Port of TFG Core Modern 0.9.21 (2cf74e6), derived from TFC. EUPL-1.2. */
import { XoroshiroRandomSource } from '@core/random';
import { cachedArea, zoomArea, smoothArea, type Area } from '../../tfc-1.20/biome/area';
import { B, isOcean, isFlats, isFlatIceSheet, isMountains, isLow, hasShore, shoreFor } from './ids';
export function edgeBiome(
  north: number,
  east: number,
  south: number,
  west: number,
  center: number,
): number {
  const matcher = (p: (value: number) => boolean): boolean =>
    p(north) || p(east) || p(south) || p(west);

  // >= 2 Adjacent border conditions
  if (isLow(center)) {
    if (matcher(isOcean) && matcher(isMountains)) {
      return B.OCEANIC_MOUNTAINS;
    } else if (matcher(isOcean) && matcher((i) => i == B.LOWLANDS)) {
      return B.SALT_MARSH;
    }
  }

  // No mud/salt flats near oceans
  if (isFlats(center)) {
    if (matcher(isOcean) && matcher(isFlats)) {
      return B.CANYONS;
    }
  }

  if (center == B.PLATEAU || center == B.BADLANDS) {
    if (matcher((i) => i == B.LOW_CANYONS || i == B.LOWLANDS)) {
      return B.HILLS;
    } else if (matcher((i) => i == B.PLAINS || i == B.HILLS)) {
      return B.ROLLING_HILLS;
    }
  } else if (isMountains(center)) {
    if (matcher(isLow)) {
      return B.ROLLING_HILLS;
    }
  }
  // Inverses of above conditions
  else if (center == B.LOWLANDS || center == B.LOW_CANYONS) {
    if (matcher((i) => i == B.PLATEAU || i == B.BADLANDS)) {
      return B.HILLS;
    } else if (matcher(isMountains)) {
      return B.ROLLING_HILLS;
    }
  } else if (center == B.PLAINS || center == B.HILLS) {
    if (matcher((i) => i == B.PLATEAU || i == B.BADLANDS)) {
      return B.HILLS;
    } else if (matcher(isMountains)) {
      return B.ROLLING_HILLS;
    }
  } else if (center == B.DEEP_OCEAN_TRENCH) {
    if (matcher((i) => !isOcean(i))) {
      return B.OCEAN;
    }
  }
  return center;
}

export function shoreBiome(
  north: number,
  east: number,
  south: number,
  west: number,
  center: number,
): number {
  const matcher = (p: (value: number) => boolean): boolean =>
    p(north) || p(east) || p(south) || p(west);
  if (!isOcean(center) && hasShore(center)) {
    if (matcher(isOcean)) {
      return shoreFor(center);
    }
  }
  return center;
}

export function moreShoresBiome(
  north: number,
  east: number,
  south: number,
  west: number,
  center: number,
): number {
  if (center != B.OCEAN) {
    const matcher = (p: (value: number) => boolean): boolean =>
      p(north) || p(east) || p(south) || p(west);
    if (matcher((layer) => layer == B.TERRACE_LOWER)) {
      return B.TERRACE_UPPER;
    }
    if (matcher((layer) => layer == B.SEA_STACKS)) {
      return B.SEA_STACKS;
    }
    if (matcher((layer) => layer == B.TIDAL_FLATS || layer == B.SHORE)) {
      return B.SHORE;
    }
    if (matcher((layer) => layer == B.COASTAL_DUNES)) {
      return B.COASTAL_DUNES;
    }
    if (matcher((layer) => layer == B.SETBACK_CLIFFS)) {
      return B.SETBACK_CLIFFS;
    }
    if (matcher((layer) => layer == B.ROCKY_SHORES)) {
      return B.ROCKY_SHORES;
    }
    if (matcher((layer) => layer == B.EMBAYMENTS)) {
      return B.EMBAYMENTS;
    }
  }
  return center;
}

export function iceSheetEdgeBiome(
  north: number,
  east: number,
  south: number,
  west: number,
  center: number,
): number {
  const matcher = (p: (value: number) => boolean): boolean =>
    p(north) || p(east) || p(south) || p(west);

  if (
    center == B.KNOB_AND_KETTLE ||
    center == B.PATTERNED_GROUND ||
    center == B.INVERTED_PATTERNED_GROUND ||
    center == B.STONE_CIRCLES
  ) {
    if (matcher((i) => i == B.ICE_SHEET_TUYAS)) {
      return B.ICE_SHEET_TUYAS_EDGE;
    } else if (matcher(isFlatIceSheet)) {
      return B.ICE_SHEET_EDGE;
    }
  }

  // Ice sheet mountain edges
  if (center == B.ICE_SHEET_OCEANIC_MOUNTAINS) {
    if (matcher(isNotIceSheet)) {
      return B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE;
    }
  }
  if (center == B.ICE_SHEET_MOUNTAINS) {
    if (matcher(isNotIceSheet)) {
      return B.ICE_SHEET_MOUNTAINS_EDGE;
    }
  }

  if (
    center == B.ICE_SHEET_EDGE &&
    matcher(
      (i) =>
        i == B.ICE_SHEET_MOUNTAINS ||
        i == B.ICE_SHEET_MOUNTAINS_EDGE ||
        i == B.ICE_SHEET_OCEANIC_MOUNTAINS ||
        i == B.ICE_SHEET_OCEANIC,
    )
  ) {
    return B.KNOB_AND_KETTLE;
  }

  // Lakes near edges of ice sheets
  if (
    center == B.LAKE &&
    matcher(isFlatIceSheet) &&
    !matcher(
      (i) =>
        i == B.ICE_SHEET_MOUNTAINS ||
        i == B.ICE_SHEET_MOUNTAINS_EDGE ||
        i == B.ICE_SHEET_OCEANIC_MOUNTAINS ||
        i == B.ICE_SHEET_OCEANIC,
    )
  ) {
    return B.SUBGLACIAL_LAKE;
  }
  if (isFlatIceSheet(center) && matcher((i) => i == B.MELTWATER_LAKE)) {
    if (matcher(isNotIceSheet)) {
      return B.SUBGLACIAL_LAKE;
    }
  }

  if (
    isFlatIceSheet(center) &&
    matcher(
      (i) =>
        i == B.OCEAN ||
        i == B.OCEAN_REEF ||
        i == B.DEEP_OCEAN ||
        i == B.DEEP_OCEAN_TRENCH ||
        i == B.ICE_SHEET_SHORE,
    )
  ) {
    return B.ICE_SHEET_OCEANIC;
  }

  // Glaciated mountains should have glacially carved edges to avoid cirque glaciers turning to stone near borders with lower biomes
  if (isNotIceSheetOrGlaciated(center)) {
    if (matcher((i) => i == B.GLACIATED_MOUNTAINS)) {
      return B.GLACIALLY_CARVED_MOUNTAINS;
    } else if (matcher((i) => i == B.GLACIATED_OCEANIC_MOUNTAINS)) {
      return B.GLACIALLY_CARVED_OCEANIC_MOUNTAINS;
    }
  }

  // Prevent borders between ice sheet oceanic mountain edges that could cause icy-cliffs
  if (
    center == B.PLATEAU ||
    center == B.BADLANDS ||
    center == B.BURREN_BADLANDS ||
    center == B.BURREN_BADLANDS_TALL /*|| center == B.GLACIATED_SHIELD_VOLCANO*/
  ) {
    if (matcher((i) => i == B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE)) {
      return B.GLACIATED_OCEANIC_MOUNTAINS;
    }
  }

  // Similar to above, tall ice sheets can create icy cliffs at edges of moraines
  if (
    center == B.ICE_SHEET ||
    center == B.ICE_SHEET_TUYAS /* || center == B.ICE_SHEET_SHIELD_VOLCANO*/
  ) {
    if (matcher((i) => i == B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE)) {
      return B.ICE_SHEET_OCEANIC;
    }
  }

  // See above
  if (center == B.ICE_SHEET_MOUNTAINS) {
    if (matcher((i) => i == B.ICE_SHEET_OCEANIC_MOUNTAINS_EDGE)) {
      return B.ICE_SHEET_OCEANIC_MOUNTAINS;
    }
  }

  return center;
}

export function isNotIceSheet(value: number): boolean {
  return (
    value != B.ICE_SHEET &&
    value != B.ICE_SHEET_TUYAS &&
    value != B.SUBGLACIAL_LAKE &&
    value != B.ICE_SHEET_MOUNTAINS &&
    value != B.ICE_SHEET_OCEANIC_MOUNTAINS
  ); /*&&
                                                     value != B.ICE_SHEET_SHIELD_VOLCANO*/
}

export function isNotIceSheetOrGlaciated(value: number): boolean {
  return (
    isNotIceSheet(value) && value != B.GLACIATED_MOUNTAINS && value != B.GLACIATED_OCEANIC_MOUNTAINS
  ); /*&& value != B.GLACIATED_SHIELD_VOLCANO*/
}

function adjacent(
  parent: Area,
  transform: (n: number, e: number, s: number, w: number, c: number) => number,
): Area {
  return cachedArea((x, z) =>
    transform(parent(x, z - 1), parent(x + 1, z), parent(x, z + 1), parent(x - 1, z), parent(x, z)),
  );
}
export function regionBiomeLayer(seed: bigint, regionBiome: Area): Area {
  const random = XoroshiroRandomSource.fromSeed(seed);
  random.nextLong();
  let area = cachedArea(regionBiome);
  random.nextLong();
  area = adjacent(area, edgeBiome);
  area = zoomArea(random.nextLong(), area);
  random.nextLong();
  area = adjacent(area, shoreBiome);
  random.nextLong();
  area = adjacent(area, moreShoresBiome);
  random.nextLong();
  area = adjacent(area, iceSheetEdgeBiome);
  for (let i = 0; i < 4; i++) area = zoomArea(random.nextLong(), area);
  return smoothArea(random.nextLong(), area);
}

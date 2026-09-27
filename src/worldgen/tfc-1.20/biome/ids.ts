/** TFCLayers registration order and predicates, TFC 1.20.x b158c9c.
 * These are internal algorithm IDs, not datapack biome definitions or a colour palette.
 * Registration order (and therefore each id's integer value) fixture-verified against real
 * compiled TFC source (tests/parity/tfc-1.20-biomes.parity.test.ts, tests/fixtures/tfc-1.20/biomes.json,
 * whose own biomeIds list is captured from the real TFCLayers registration and matches this file's
 * order exactly). biomeId's string ids are cross-checked against src/data/tfc-1.20/biomes.json by
 * tests/unit/tfc-1.20-biome.test.ts. `isOcean`/`isMountains`/`isLow`/`hasShore`/`shoreFor` are
 * exercised transitively via `./layers.ts`'s parity coverage; `hasLake`/`lakeFor` are ported but not
 * yet called by this port (Phase 4 doesn't run AddRiversAndLakes — see docs/WORLDGEN-NOTES.md) so
 * they remain @unverified pending that phase. */
export const enum Biome {
  OCEAN, OCEAN_REEF, DEEP_OCEAN, DEEP_OCEAN_TRENCH, PLAINS, HILLS, LOWLANDS,
  SALT_MARSH, LOW_CANYONS, ROLLING_HILLS, HIGHLANDS, BADLANDS, INVERTED_BADLANDS,
  PLATEAU, OLD_MOUNTAINS, MOUNTAINS, VOLCANIC_MOUNTAINS, OCEANIC_MOUNTAINS,
  VOLCANIC_OCEANIC_MOUNTAINS, CANYONS, SHORE, TIDAL_FLATS, LAKE, RIVER,
  MOUNTAIN_LAKE, VOLCANIC_MOUNTAIN_LAKE, OLD_MOUNTAIN_LAKE, OCEANIC_MOUNTAIN_LAKE,
  VOLCANIC_OCEANIC_MOUNTAIN_LAKE, PLATEAU_LAKE,
}
const NAMES = ['ocean', 'ocean_reef', 'deep_ocean', 'deep_ocean_trench', 'plains', 'hills',
  'lowlands', 'salt_marsh', 'low_canyons', 'rolling_hills', 'highlands', 'badlands',
  'inverted_badlands', 'plateau', 'old_mountains', 'mountains', 'volcanic_mountains',
  'oceanic_mountains', 'volcanic_oceanic_mountains', 'canyons', 'shore', 'tidal_flats',
  'lake', 'river', 'mountain_lake', 'volcanic_mountain_lake', 'old_mountain_lake',
  'oceanic_mountain_lake', 'volcanic_oceanic_mountain_lake', 'plateau_lake'] as const;

export function biomeId(id: number): string {
  const name = NAMES[id];
  if (name === undefined) throw new Error(`Unknown TFC biome layer ID: ${id}`);
  return `tfc:${name}`;
}
export function isOcean(id: number): boolean { return id >= Biome.OCEAN && id <= Biome.DEEP_OCEAN_TRENCH; }
export function isMountains(id: number): boolean { return id >= Biome.OLD_MOUNTAINS && id <= Biome.VOLCANIC_OCEANIC_MOUNTAINS; }
export function isLow(id: number): boolean { return [Biome.PLAINS, Biome.HILLS, Biome.LOW_CANYONS, Biome.LOWLANDS, Biome.SALT_MARSH].includes(id); }
export function hasShore(id: number): boolean { return ![Biome.LOWLANDS, Biome.SALT_MARSH, Biome.LOW_CANYONS, Biome.CANYONS, Biome.OCEANIC_MOUNTAINS, Biome.VOLCANIC_OCEANIC_MOUNTAINS].includes(id); }
export function shoreFor(id: number): number {
  return id === Biome.MOUNTAINS ? Biome.OCEANIC_MOUNTAINS : id === Biome.VOLCANIC_MOUNTAINS ? Biome.VOLCANIC_OCEANIC_MOUNTAINS : Biome.SHORE;
}
/** `BiomeExtension.hasRivers()` — every biome not built with `BiomeBuilder.noRivers()`: the four
 * oceans, the two shores and every lake variant. A river is never carved through those. */
/**
 * `BiomeExtension.riverBlendType()` — which river carving shape each biome uses, from
 * `TFCBiomes`'s registrations. Index into `RiverBlend` (0 NONE, 1 WIDE, 2 CANYON, 3 TALL_CANYON,
 * 4 CAVE); a biome that declares none stays NONE, which is the "river does not carve here" case.
 */
export function riverBlendFor(id: number): number {
  switch (id) {
    case Biome.PLAINS:
    case Biome.HILLS:
    case Biome.LOWLANDS:
    case Biome.SALT_MARSH:
    case Biome.LOW_CANYONS:
    case Biome.SHORE:
    case Biome.TIDAL_FLATS:
    case Biome.LAKE:
      return 1; // WIDE
    case Biome.ROLLING_HILLS:
    case Biome.HIGHLANDS:
    case Biome.BADLANDS:
    case Biome.INVERTED_BADLANDS:
    case Biome.CANYONS:
      return 2; // CANYON
    case Biome.PLATEAU:
      return 3; // TALL_CANYON
    case Biome.MOUNTAINS:
    case Biome.OLD_MOUNTAINS:
    case Biome.OCEANIC_MOUNTAINS:
    case Biome.VOLCANIC_MOUNTAINS:
    case Biome.VOLCANIC_OCEANIC_MOUNTAINS:
      return 4; // CAVE
    default:
      return 0; // NONE — the oceans, the river itself, and every mountain lake variant
  }
}

export function hasRivers(id: number): boolean {
  return !isOcean(id) && id !== Biome.SHORE && id !== Biome.TIDAL_FLATS && !isLakeBiome(id);
}
function isLakeBiome(id: number): boolean {
  return id === Biome.LAKE || (id >= Biome.MOUNTAIN_LAKE && id <= Biome.PLATEAU_LAKE);
}
export function hasLake(id: number): boolean { return !isOcean(id) && id !== Biome.BADLANDS; }
export function lakeFor(id: number): number {
  switch (id) {
    case Biome.MOUNTAINS: return Biome.MOUNTAIN_LAKE;
    case Biome.VOLCANIC_MOUNTAINS: return Biome.VOLCANIC_MOUNTAIN_LAKE;
    case Biome.OLD_MOUNTAINS: return Biome.OLD_MOUNTAIN_LAKE;
    case Biome.OCEANIC_MOUNTAINS: return Biome.OCEANIC_MOUNTAIN_LAKE;
    case Biome.VOLCANIC_OCEANIC_MOUNTAINS: return Biome.VOLCANIC_OCEANIC_MOUNTAIN_LAKE;
    case Biome.PLATEAU: return Biome.PLATEAU_LAKE;
    default: return Biome.LAKE;
  }
}

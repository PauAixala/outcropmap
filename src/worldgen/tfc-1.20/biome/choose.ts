/** TFC 1.20.x b158c9c ChooseBiomes.apply and ChooseRocks.apply.
 * `chooseBiomes` is fixture-verified bit-exact against real compiled TFC source
 * (tests/parity/tfc-1.20-biomes.parity.test.ts, tests/fixtures/tfc-1.20/biomes.json), modulo the
 * documented AddRiversAndLakes lake-overwrite gap the parity test explicitly accounts for — see
 * docs/PARITY.md and docs/WORLDGEN-NOTES.md's "Biome assignment" section.
 * `chooseRocks` is fixture-verified bit-exact against real compiled TFC source too — the same
 * fixture's `Region.Point.rock` field, asserted in tests/parity/tfc-1.20-biomes.parity.test.ts's
 * grid-scale check. What is NOT fixture-verified is the rock *layer tree* built on top of this
 * packed value (`RockLayerSettings.sampleAtLayer`, `../rock/layer-settings.ts`) or its horizontal
 * block-scale zoom (`TFCLayers.createOverworldRockLayer`, `../rock/layer.ts`) — see docs/PARITY.md
 * for why. */
import type { RegionBuildContext } from '../region/tasks';
import type { Area } from './area';
import { Biome as B } from './ids';

const MOUNTAIN = [B.MOUNTAINS, B.MOUNTAINS, B.MOUNTAINS, B.OLD_MOUNTAINS, B.OLD_MOUNTAINS, B.PLATEAU, B.HIGHLANDS];
const COASTAL = [B.VOLCANIC_MOUNTAINS, B.VOLCANIC_OCEANIC_MOUNTAINS, B.VOLCANIC_OCEANIC_MOUNTAINS, B.OCEANIC_MOUNTAINS, B.OCEANIC_MOUNTAINS, B.ROLLING_HILLS];
const ALTITUDE = [
  [B.PLAINS, B.PLAINS, B.HILLS, B.HILLS, B.ROLLING_HILLS, B.LOW_CANYONS, B.LOWLANDS, B.LOWLANDS],
  [B.PLAINS, B.HILLS, B.ROLLING_HILLS, B.HIGHLANDS, B.INVERTED_BADLANDS, B.BADLANDS, B.PLATEAU, B.CANYONS, B.LOW_CANYONS],
  [B.HIGHLANDS, B.HIGHLANDS, B.HIGHLANDS, B.ROLLING_HILLS, B.BADLANDS, B.PLATEAU, B.PLATEAU, B.OLD_MOUNTAINS, B.OLD_MOUNTAINS],
];
const ISLAND = [B.PLAINS, B.HILLS, B.ROLLING_HILLS, B.VOLCANIC_OCEANIC_MOUNTAINS, B.VOLCANIC_OCEANIC_MOUNTAINS];
const MID_OCEAN = [B.DEEP_OCEAN, B.OCEAN, B.OCEAN, B.OCEAN_REEF, B.OCEAN_REEF, B.OCEAN_REEF];

function floorMod(x: bigint, bound: number): number { const n = BigInt(bound); return Number(((x % n) + n) % n); }
function choose(seed: bigint, area: number, choices: readonly number[]): number { return choices[floorMod(seed ^ BigInt(area), choices.length)]!; }

export function chooseBiomes({ region, random }: RegionBuildContext, area: Area): void {
  const seed = random.nextLong(), climateSeed = random.nextLong();
  for (let x = region.minX; x <= region.maxX; x++) for (let z = region.minZ; z <= region.maxZ; z++) {
    const p = region.maybeAt(x, z);
    if (!p) continue;
    const areaSeed = area(x, z);
    if (p.island()) p.biome = choose(seed, areaSeed, ISLAND);
    else if (p.mountain()) p.biome = choose(seed, areaSeed, p.coastalMountain() ? COASTAL : MOUNTAIN);
    else if (p.land()) p.biome = choose(seed, areaSeed, ALTITUDE[p.discreteBiomeAltitude()]!);
    else if (p.baseOceanDepth < 3) p.biome = B.OCEAN;
    else if (p.baseOceanDepth > 9) p.biome = B.DEEP_OCEAN_TRENCH;
    else if (p.baseOceanDepth >= 5 || p.distanceToEdge < 2) p.biome = B.DEEP_OCEAN;
    else p.biome = choose(seed, areaSeed, MID_OCEAN);
    const climateOffset = floorMod(BigInt(areaSeed) ^ climateSeed, 40);
    if (p.rainfall < 90 + climateOffset) {
      if (p.biome === B.LOWLANDS) p.biome = B.PLAINS;
      else if (p.biome === B.LOW_CANYONS) p.biome = B.CANYONS;
    }
    if (p.rainfall > 420 + climateOffset) {
      if (p.biome === B.BADLANDS) p.biome = B.HIGHLANDS;
      else if (p.biome === B.INVERTED_BADLANDS) p.biome = B.ROLLING_HILLS;
    }
  }
}

/** Region rock category/seed only, not the final bottom/middle/top rock stack — see
 * `../rock/layer-settings.ts`'s `sampleAtLayer` for that. Fixture-verified, see this file's
 * header. */
export function chooseRocks({ region }: RegionBuildContext, area: Area): void {
  for (let x = 0; x < region.sizeX; x++) for (let z = 0; z < region.sizeZ; z++) {
    const index = x + region.sizeX * z, p = region.data[index];
    if (!p) continue;
    let type = p.land() ? 2 : 0, minDist = 2147483647;
    for (let dx = -2; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) {
      const offset = region.offset(index, dx, dz), dist = Math.abs(dx) + Math.abs(dz);
      if (offset !== -1 && dist < minDist) {
        const q = region.data[offset];
        if (q?.island() && dist < 4) { type = 1; minDist = dist; }
        else if (q && (q.mountain() || q.coastalMountain()) && dist < 3) { type = 3; minDist = dist; }
      }
    }
    p.rock = (area(region.minX + x, region.minZ + z) << 2) | type;
  }
}

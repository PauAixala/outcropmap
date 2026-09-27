/** TFC 1.20.x b158c9c: TFCLayers.createRegionBiomeLayer and its edge/shore passes.
 * Fixture-verified bit-exact end-to-end (including the RandomSource draw order that derives this
 * function's own seed argument, not just the layer stack in isolation) against real compiled TFC
 * source (tests/parity/tfc-1.20-biomes.parity.test.ts, tests/fixtures/tfc-1.20/biomes.json),
 * modulo the documented AddRiversAndLakes gap the parity test explicitly accounts for — see
 * docs/PARITY.md and docs/WORLDGEN-NOTES.md's "Biome assignment" section. */
import { JavaRandom } from '@core/random';
import { cachedArea, smoothArea, zoomArea, type Area } from './area';
import { Biome as B, hasShore, isLow, isMountains, isOcean, shoreFor } from './ids';

function adjacent(parent: Area, transform: (n: number, e: number, s: number, w: number, c: number) => number): Area {
  return cachedArea((x, z) => transform(parent(x, z - 1), parent(x + 1, z), parent(x, z + 1), parent(x - 1, z), parent(x, z)));
}

/** RegionEdgeBiomeLayer.apply. */
export function edgeBiome(n: number, e: number, s: number, w: number, c: number): number {
  const some = (test: (v: number) => boolean): boolean => test(n) || test(e) || test(s) || test(w);
  const raised = (v: number): boolean => v === B.PLATEAU || v === B.BADLANDS || v === B.INVERTED_BADLANDS;
  if (isLow(c)) {
    if (some(isOcean) && some(isMountains)) return B.OCEANIC_MOUNTAINS;
    if (some(isOcean) && some(v => v === B.LOWLANDS)) return B.SALT_MARSH;
  }
  if (raised(c)) {
    if (some(v => v === B.LOW_CANYONS || v === B.LOWLANDS)) return B.HILLS;
    if (some(v => v === B.PLAINS || v === B.HILLS)) return B.ROLLING_HILLS;
  } else if (isMountains(c)) {
    if (some(isLow)) return B.ROLLING_HILLS;
  } else if (c === B.LOWLANDS || c === B.LOW_CANYONS) {
    if (some(raised)) return B.HILLS;
    if (some(isMountains)) return B.ROLLING_HILLS;
  } else if (c === B.PLAINS || c === B.HILLS) {
    if (some(raised)) return B.HILLS;
    if (some(isMountains)) return B.ROLLING_HILLS;
  } else if (c === B.DEEP_OCEAN_TRENCH && some(v => !isOcean(v))) return B.OCEAN;
  return c;
}

/** TFCLayers.createRegionBiomeLayer. Return value is sampled in quart coordinates. */
export function regionBiomeLayer(seed: bigint, regionBiome: Area): Area {
  const random = new JavaRandom(seed);
  random.nextLong(); // RegionLayer's seed is unused, but the draw shifts all later layers.
  let area = cachedArea(regionBiome);
  random.nextLong(); // RegionEdgeBiomeLayer has no random choices.
  area = adjacent(area, edgeBiome);
  area = zoomArea(random.nextLong(), area);
  random.nextLong(); // ShoreLayer has no random choices.
  area = adjacent(area, (n, e, s, w, c) => !isOcean(c) && hasShore(c) && (isOcean(n) || isOcean(e) || isOcean(s) || isOcean(w)) ? shoreFor(c) : c);
  random.nextLong(); // MoreShoresLayer has no random choices.
  area = adjacent(area, (n, e, s, w, c) => c === B.OCEAN && (n === B.SHORE || e === B.SHORE || s === B.SHORE || w === B.SHORE) && !(isMountains(n) || isMountains(e) || isMountains(s) || isMountains(w)) ? B.TIDAL_FLATS : c);
  for (let i = 0; i < 4; i++) area = zoomArea(random.nextLong(), area);
  return smoothArea(random.nextLong(), area);
}

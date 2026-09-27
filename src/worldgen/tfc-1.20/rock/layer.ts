/**
 * `net.dries007.tfc.world.layer.TFCLayers.createOverworldRockLayer` — the horizontal (x, z)
 * blending of `ChooseRocks`'s grid-scale `Region.Point.rock` assignment down to **block**
 * resolution (unlike the biome layer, which stops at quart resolution — see
 * `../biome/layers.ts`'s header). This is only the lateral pass: the real game layers this with
 * `RegionGenerator.surfaceRockAt` adds the real lateral skew for TFC's special layer-zero
 * surface-rock query.
 *
 * Fixture-verified bit-exact against real compiled TFC source, including the exact
 * `RegionChunkDataGenerator.create` seed re-derivation (`../region/generator.ts`) —
 * tests/parity/tfc-1.20-rocks.parity.test.ts, tests/fixtures/tfc-1.20/rocks.json.
 *
 * Reuses `../biome/area.ts`'s generic `cachedArea`/`zoomArea`/`smoothArea` — the same
 * `AreaContext`/zoom/smooth machinery `createRegionBiomeLayer` is built from, just with a
 * genuinely different (and stranger) real seeding pattern: every `ZoomLayer.NORMAL`/`SmoothLayer`
 * call in the real method reuses the *same* raw `seed` parameter, rather than drawing a fresh
 * `random.nextLong()` per step the way `createRegionBiomeLayer` does. Confirmed by reading the
 * real source twice over — not a transcription slip on this port's part.
 */
import { JavaRandom } from '@core/random';
import { cachedArea, zoomArea, smoothArea, type Area } from '../biome/area';
import { GRID_BITS } from '../region/units';

/** `TFCLayers.createOverworldRockLayer(RegionGenerator, long)`. `regionRock` samples
 * `Region.Point.rock` at **grid** coordinates (`RegionLayer` + `RegionRockLayer`, folded into one
 * function here exactly as `../biome/layers.ts`'s `regionBiomeLayer` folds its own equivalents). */
export function overworldRockLayer(seed: bigint, regionRock: Area): Area {
  const random = new JavaRandom(seed);
  random.nextLong(); // RegionLayer's own seed draw — RegionLayer has no randomness of its own.
  let area = cachedArea(regionRock);
  // `for (i = 0; i < Units.GRID_BITS - 1; i++) layer = ZoomLayer.NORMAL.apply(seed, layer);` —
  // grid (128 blocks) down to 2 blocks/unit; every call below reuses the same `seed`, not a fresh
  // draw, per this file's header.
  for (let i = 0; i < GRID_BITS - 1; i++) {
    area = zoomArea(seed, area);
  }
  area = smoothArea(seed, area);
  area = zoomArea(seed, area); // 2 blocks/unit -> 1 block/unit: block resolution from here on.
  area = smoothArea(seed, area);
  return area;
}

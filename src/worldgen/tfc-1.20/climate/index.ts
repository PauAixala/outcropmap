/**
 * Turns the region grid's per-point `temperature`/`rainfall` into the value at an arbitrary block
 * position — the climate-relevant slice of
 * `net.dries007.tfc.world.chunkdata.RegionChunkDataGenerator.generate(ChunkData)`, plus
 * `net.dries007.tfc.world.chunkdata.LerpFloatLayer` and `Helpers.lerp4`/`Helpers.lerp`.
 *
 * The real method also (a) lets nearby wide rivers locally raise rainfall, and (b) attaches
 * forest/rock data — both out of scope for Phase 3 (rivers are Phase 4, rock is Phase 5), and
 * `RegionChunkDataGenerator` never applies an equivalent adjustment to temperature. Skipping the
 * river step means rainfall near a wide river will read slightly low compared to the real game;
 * everything else in this function is a full, direct port. Declared in `docs/PARITY.md`.
 *
 * Values are interpolated at **chunk** granularity, exactly like the game: the four region-grid
 * points (128 blocks apart) surrounding the query position are bilinearly reduced to the four
 * corners of the *chunk* (16 blocks) the position falls in — narrowing each corner to `float`, as
 * Java's `LerpFloatLayer` fields are `float` — and only then is the exact position within that
 * chunk interpolated. This is not an equivalent-but-simpler single bilinear step: the intermediate
 * float rounding at chunk granularity is part of the real algorithm (and part of what
 * `tests/fixtures/tfc-1.20/climate-components.json`'s `"lerp"` cases check).
 */
import { blockToGrid, blockToGridExact } from '../region/units';
import type { RegionGenerator } from '../region/generator';
import type { ClimateSample } from '../../api/types';

/** `Helpers.lerp(double delta, double min, double max)` / `Mth.lerp` — double precision (the
 * double overload is what `Helpers.lerp4(double, ...)` and `LerpFloatLayer` resolve to, since
 * `LerpFloatLayer.scaled`/`getValue` pass `double` deltas — see the file header). */
function lerp(delta: number, min: number, max: number): number {
  return min + (max - min) * delta;
}

/** `Helpers.lerp4(double, double, double, double, double, double)`. */
function lerp4(v00: number, v01: number, v10: number, v11: number, deltaX: number, deltaZ: number): number {
  const value0 = lerp(deltaZ, v00, v01);
  const value1 = lerp(deltaZ, v10, v11);
  return lerp(deltaX, value0, value1);
}

export interface Corners {
  readonly v00: number;
  readonly v01: number;
  readonly v10: number;
  readonly v11: number;
}

/** `LerpFloatLayer.scaled(double originX, double originZ, double width)`: reduces the grid-square
 * corners to the sub-square's corners, narrowing each to `float` (matching the `(float)` cast on
 * every `Helpers.lerp4` call in the real method). */
export function scaledCorners(v00: number, v01: number, v10: number, v11: number, originX: number, originZ: number, width: number): Corners {
  return {
    v00: Math.fround(lerp4(v00, v01, v10, v11, originX, originZ)),
    v01: Math.fround(lerp4(v00, v01, v10, v11, originX, originZ + width)),
    v10: Math.fround(lerp4(v00, v01, v10, v11, originX + width, originZ)),
    v11: Math.fround(lerp4(v00, v01, v10, v11, originX + width, originZ + width)),
  };
}

/** `LerpFloatLayer.getValue(double deltaX, double deltaZ)`. */
export function getValue(corners: Corners, deltaX: number, deltaZ: number): number {
  return Math.fround(lerp4(corners.v00, corners.v01, corners.v10, corners.v11, deltaX, deltaZ));
}

/** `Mth.clamp(float, float, float)` — exact for the `[0, 500]` rainfall bound (no float-precision
 * change from clamping to exactly-representable bounds). */
function clampCorners(corners: Corners, min: number, max: number): Corners {
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  return { v00: clamp(corners.v00), v01: clamp(corners.v01), v10: clamp(corners.v10), v11: clamp(corners.v11) };
}

/**
 * The climate-relevant body of `RegionChunkDataGenerator.generate(ChunkData)` plus
 * `ChunkData.getAverageTemp`/`getRainfall`, folded into a single per-position query (the real game
 * caches the per-chunk `LerpFloatLayer`s in `ChunkData`; this recomputes them per call — cheap,
 * since `RegionGenerator.getOrCreateRegionPoint` itself caches per region).
 */
export function sampleClimate(generator: RegionGenerator, blockX: number, blockZ: number): ClimateSample {
  // `ChunkPos.getMinBlockX()`/`getMinBlockZ()` for the chunk `(blockX, blockZ)` falls in.
  const chunkOriginX = (blockX >> 4) << 4;
  const chunkOriginZ = (blockZ >> 4) << 4;

  const gridX = blockToGrid(chunkOriginX);
  const gridZ = blockToGrid(chunkOriginZ);

  const p00 = generator.getOrCreateRegionPoint(gridX, gridZ);
  const p01 = generator.getOrCreateRegionPoint(gridX, gridZ + 1);
  const p10 = generator.getOrCreateRegionPoint(gridX + 1, gridZ);
  const p11 = generator.getOrCreateRegionPoint(gridX + 1, gridZ + 1);

  const exactGridX = blockToGridExact(chunkOriginX);
  const exactGridZ = blockToGridExact(chunkOriginZ);
  const deltaX = exactGridX - gridX;
  const deltaZ = exactGridZ - gridZ;
  const chunkWidthInGrid = blockToGridExact(16);

  const temperatureCorners = scaledCorners(p00.temperature, p01.temperature, p10.temperature, p11.temperature, deltaX, deltaZ, chunkWidthInGrid);
  const rainfallCorners = clampCorners(
    scaledCorners(p00.rainfall, p01.rainfall, p10.rainfall, p11.rainfall, deltaX, deltaZ, chunkWidthInGrid),
    0,
    500,
  );

  // `(x & 15) / 16f` — the position within the chunk. `&` on a JS number behaves as Java's 32-bit
  // `int &` here (floors correctly for negative coordinates too).
  const withinChunkX = (blockX & 15) / 16;
  const withinChunkZ = (blockZ & 15) / 16;

  return {
    temperature: getValue(temperatureCorners, withinChunkX, withinChunkZ),
    rainfall: getValue(rainfallCorners, withinChunkX, withinChunkZ),
  };
}

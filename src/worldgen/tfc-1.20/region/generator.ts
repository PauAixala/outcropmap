/**
 * `net.dries007.tfc.world.region.RegionGenerator`: owns the region-cell Voronoi noise
 * (`cellNoise`), the climate-relevant composed noise fields (`continentNoise`, `temperatureNoise`,
 * `rainfallNoise`), the biome/rock-assignment `biomeArea`/`rockArea` uniform noise, and
 * builds+caches one `Region` per Voronoi cell by running the biome/rock-relevant task pipeline
 * (`./tasks.ts`, `./terrain-tasks.ts`) against it — `RegionGenerator.Task.values()` up to and
 * including `CHOOSE_ROCKS`. It also builds the per-quart biome lookup
 * (`TFCLayers.createRegionBiomeLayer`, `../biome/layers.ts`) and the per-block rock-category lookup
 * (`TFCLayers.createOverworldRockLayer`, `../rock/layer.ts`) real `TFCChunkGenerator.initRandomState`
 * wires up after constructing the generator.
 *
 * `AddRiversAndLakes` is the one remaining real `Task` and is Phase 6 scope (rivers) — it runs
 * *after* `CHOOSE_ROCKS` and neither `ChooseBiomes` nor `ChooseRocks` reads anything it writes
 * (confirmed by reading both real classes), so skipping it cannot change a biome or rock-category
 * value. It also does not affect `bottom`/`middle`/`top`/`surface` rock sampling: those depend on
 * real surface height (`RegionChunkDataGenerator.generateRock`'s `deltaY`/`layerHeightNoise` walk),
 * which is separately out of scope — see `docs/WORLDGEN-NOTES.md`'s "Rock layers" section and
 * `docs/PARITY.md`, not `AddRiversAndLakes`.
 */
import { overworldForestLayer } from '../chunkdata/forest';
import { XoroshiroRandomSource } from '@core/random';
import { mul64, toInt64 } from '@core/math';
import { Cellular2D, type Cell } from '../noise/cellular-2d';
import { OpenSimplex2D } from '../noise/open-simplex-2d';
import { add, lazyProduct, scaled, type Noise2D } from '../noise/noise2d';
import {
  CELL_WIDTH_IN_GRID,
  CELL_WIDTH_IN_PARTITION,
  GRID_WIDTH_IN_BLOCK,
  PARTITION_BITS,
  PARTITION_BIT_MASK,
  cellToGrid,
  cellToPart,
  gridToCell,
  gridToPart,
} from './units';
import type { RiverEdge } from '../river/river-edge';
import { Region, type RegionPoint } from './region';
import {
  addContinents,
  addIslands,
  annotateClimate,
  annotateDistanceToCellEdge,
  annotateDistanceToOcean,
  createFootprint,
  floodFillSmallOceans,
  shrinkToCell,
  type RegionBuildContext,
} from './tasks';
import { annotateBaseLandHeight, addMountains, annotateBiomeAltitude } from './terrain-tasks';
import { addRiversAndLakes } from './add-rivers-and-lakes';
import { uniformArea, type Area } from '../biome/area';
import { regionBiomeLayer } from '../biome/layers';

/** `RegionChunkDataGenerator.LAYER_OFFSET_BITS`: only the low three bits of a layer index pick an
 * offset pair, so deep layers reuse the same eight offsets. */
const LAYER_OFFSET_MASK = (1 << 3) - 1;

const ROCK_LAYER_OFFSETS = (() => {
  const random = XoroshiroRandomSource.fromSeed(1923874192341n);
  return Array.from({ length: 16 }, () => random.nextInt(100_000));
})();
import { chooseBiomes, chooseRocks } from '../biome/choose';
import { overworldRockLayer } from '../rock/layer';

/** The world-preset fields `RegionGenerator`'s constructor actually reads
 * (`net.dries007.tfc.world.settings.Settings`), restricted to what climate needs. Defaults match
 * `data/tfc/worldgen/world_preset/overworld.json`: `temperature_scale`/`rainfall_scale` 20000,
 * `continentalness` 0.5, `temperature_constant`/`rainfall_constant` unset (Settings' codec default
 * 0). */
export interface RegionGeneratorSettings {
  readonly temperatureScale: number;
  readonly temperatureConstant: number;
  readonly rainfallScale: number;
  readonly rainfallConstant: number;
  readonly continentalness: number;
}

/** `RegionPartition.index`: the packed (partX, partZ) key, masked to the cell's own partition grid. */
function partitionIndex(partX: number, partZ: number): number {
  return (partX & PARTITION_BIT_MASK) | ((partZ & PARTITION_BIT_MASK) << PARTITION_BITS);
}

/** Shared empty result, so the common "no rivers here" case allocates nothing. */
const NO_RIVERS: readonly RiverEdge[] = [];

/** `RegionGenerator.triangle(double, double)`: a private static helper backing `baseNoise`. */
function triangle(frequency: number, value: number): number {
  return Math.abs(4 * frequency * value + 1 - 4 * Math.floor(frequency * value + 0.75)) - 1;
}

/** `RegionGenerator.baseNoise(boolean axisIsX, float scale, float constant)`. `frequency` is a
 * Java `float` local — `Math.fround`ed once here, then used in `triangle`'s (genuinely
 * double-precision — `triangle(double, double)`) formula, matching Java's own float-to-double
 * widening at the call site. */
export function baseNoise(axisIsX: boolean, scale: number, constant: number): Noise2D {
  if (scale === 0) {
    return () => constant;
  }
  const frequency = Math.fround(GRID_WIDTH_IN_BLOCK / Math.fround(2 * scale));
  return axisIsX ? (x) => triangle(frequency, x) : (_x, z) => triangle(frequency, z);
}

/** `java.lang.Float.floatToIntBits(float)`, restricted to the finite (non-NaN) domain this
 * generator ever calls it on (a `Cellular2D.Cell.noise` value, always in `[-1, 1)`). */
function floatToIntBitsFinite(value: number): number {
  FLOAT_SCRATCH[0] = value;
  return INT_SCRATCH[0] ?? 0;
}
const FLOAT_SCRATCH = new Float32Array(1);
const INT_SCRATCH = new Int32Array(FLOAT_SCRATCH.buffer);

/** `RegionGenerator.Context`'s per-region seed derivation:
 * `seed ^ Float.floatToIntBits((float) regionCell.noise()) * 7189234123L`, where `seed` is
 * `RegionGenerator.this.seed` (the generator's own first `nextLong()` draw, not the world seed). */
export function regionSeedFor(generatorSeed: bigint, cell: Cell): bigint {
  const bits = BigInt(floatToIntBitsFinite(cell.noise));
  return toInt64(generatorSeed ^ mul64(bits, 7189234123n));
}

export class RegionGenerator {
  private static readonly MAX_CACHED_REGIONS = 256;
  /** One partition per cell, and a cell is 96 grid across, so a handful covers any viewport. */
  private static readonly MAX_CACHED_PARTITIONS = 32;
  protected readonly seed: bigint;
  private readonly cellNoise: Cellular2D;
  protected readonly continentNoise: Noise2D;
  protected readonly temperatureNoise: Noise2D;
  protected readonly rainfallNoise: Noise2D;
  protected readonly biomeArea: Area;
  protected readonly rockArea: Area;
  /** `TFCLayers.createRegionBiomeLayer(this, random.nextLong())`'s result: a per-quart biome id
   * lookup (see `../biome/layers.ts`'s header for the scale it operates in). */
  private readonly biomeLayerArea: Area;
  /** `TFCLayers.createOverworldRockLayer(this, ...)`'s result: a per-**block** rock-category
   * lookup (see `../rock/layer.ts`'s header for the scale it operates in and what it does not
   * cover). */
  private readonly rockLayerArea: Area;
  private readonly layerHeightNoise: OpenSimplex2D;
  private readonly surfaceRockSkewX: OpenSimplex2D;
  private readonly surfaceRockSkewZ: OpenSimplex2D;
  private readonly regionCache = new Map<string, Region>();
  private readonly partitionCache = new Map<string, Map<number, RiverEdge[]>>();
  private lastPartitionCellX = Number.NaN;
  private lastPartitionCellZ = Number.NaN;
  private lastPartition: Map<number, RiverEdge[]> | null = null;

  constructor(worldSeed: bigint, settings: RegionGeneratorSettings) {
    const random = XoroshiroRandomSource.fromSeed(worldSeed);

    this.seed = random.nextLong();
    // Every `Math.fround` below emulates a Java `f`-suffixed literal argument being widened to
    // `double` at the call site — e.g. `.spread(1f / Units.CELL_WIDTH_IN_GRID)`: the literal is
    // *already* rounded to float32 at compile time, so the double actually passed in is
    // `(double) floatValue`, not whatever double `1 / CELL_WIDTH_IN_GRID` would give directly (a
    // strictly more precise value). Confirmed against a real-JVM trace during Phase 3 — omitting
    // this rounding was silently wrong in every one of these spots, not just cosmetically off.
    this.cellNoise = new Cellular2D(random.nextLong()).spread(Math.fround(1 / CELL_WIDTH_IN_GRID));

    const continentMin = Math.fround(Math.fround(settings.continentalness * 10) - 2.5);
    // `0.37f + c.f2()`: the float literal widens to double before adding the (already-double) `f2`.
    const continentBase = this.cellNoise.then((c) => 1 - c.f1 / (Math.fround(0.37) + c.f2));
    // `.spread(0.24f).scaled(min, 8.7f)` — `min` is already a Java `float` local (correctly
    // rounded), so it needs no further treatment; the two literals do.
    const continentSimplex = new OpenSimplex2D(random.nextLong())
      .spread(Math.fround(0.24))
      .scaled(continentMin, Math.fround(8.7))
      .octaves(4);
    this.continentNoise = lazyProduct(continentBase, (x, z) => continentSimplex.noise(x, z));

    const temperatureBase = baseNoise(
      false,
      settings.temperatureScale,
      settings.temperatureConstant,
    );
    // `.spread(0.15f).scaled(-3f, 3f)` — `-3f`/`3f` are exact integers in float32, so plain `-3`/`3`
    // already equal their widened value and need no `Math.fround`.
    const temperatureSimplex = new OpenSimplex2D(random.nextInt())
      .octaves(2)
      .spread(Math.fround(0.15))
      .scaled(-3, 3);
    this.temperatureNoise = add(scaled(temperatureBase, -20, 30), (x, z) =>
      temperatureSimplex.noise(x, z),
    );

    const rainfallBase = baseNoise(true, settings.rainfallScale, settings.rainfallConstant);
    // `.spread(0.15f).scaled(-80f, 40f)` — same reasoning as above for the exact-integer bounds.
    const rainfallSimplex = new OpenSimplex2D(random.nextInt())
      .octaves(2)
      .spread(Math.fround(0.15))
      .scaled(-80, 40);
    this.rainfallNoise = add(scaled(rainfallBase, 0, 500), (x, z) => rainfallSimplex.noise(x, z));

    // `final AreaFactory biomeAreaFactory = TFCLayers.createUniformLayer(random, 2);` — the Area
    // `ChooseBiomes.apply` reads via `context.generator().biomeArea.get()`. Java's field is a
    // `ThreadLocal<Area>` (a fresh `Area` per thread, all functionally identical since the seed is
    // fixed); this generator is single-instance per worker, so one `Area` suffices.
    this.biomeArea = uniformArea(random, 2);
    // `final AreaFactory rockAreaFactory = TFCLayers.createUniformLayer(random, 3);` — the Area
    // `ChooseRocks.apply` reads via `context.generator().rockArea.get()`, same reasoning as
    // `biomeArea` above (a plain field stands in for Java's `ThreadLocal`).
    this.rockArea = uniformArea(random, 3);

    // `RegionChunkDataGenerator.create(long worldSeed, ...)` draws one more long from the shared
    // stream immediately after `RegionGenerator`'s own constructor returns
    // (`TFCChunkGenerator.initRandomState`), then re-derives its *own*, independent seed from it —
    // reproduced exactly below, since `createOverworldRockLayer`'s seed comes from that derived
    // value, not from `random` directly. `RegionChunkDataGenerator.create`'s own random is a brand
    // new `XoroshiroRandomSource` instance, so none of this touches `random`'s position beyond the
    // one draw for `chunkDataSeed` — `random.nextLong()` for the biome layer seed below still comes
    // strictly after it, exactly as the real `initRandomState` draws it.
    const chunkDataSeed = random.nextLong();
    const biomeLayerSeed = random.nextLong();
    this.biomeLayerArea = this.createBiomeLayer(biomeLayerSeed);

    // `RegionChunkDataGenerator.create`: `RandomSource random = new XoroshiroRandomSource(worldSeed);
    // random.setSeed(worldSeed ^ random.nextLong());` — draws once, then re-seeds the *same* object
    // with `worldSeed ^ thatDraw`, before drawing again for `createOverworldRockLayer`'s seed.
    const chunkRandom = XoroshiroRandomSource.fromSeed(chunkDataSeed);
    const chunkReseed = toInt64(chunkDataSeed ^ chunkRandom.nextLong());
    chunkRandom.setSeed(chunkReseed);
    const rockLayerSeed = chunkRandom.nextLong();
    this.rockLayerArea = overworldRockLayer(
      rockLayerSeed,
      (gridX, gridZ) => this.getOrCreateRegionPoint(gridX, gridZ).rock,
    );
    // `layerHeightNoise`: how thick each rock layer is at a position. Kept now — `rockAtY` walks
    // down through it to find which layer a Y sits in, which `getSurfaceRock` never needed because
    // it always stops in layer zero.
    this.layerHeightNoise = new OpenSimplex2D(chunkRandom.nextInt())
      .octaves(3)
      .scaled(43, 63)
      .spread(Math.fround(0.014));
    this.surfaceRockSkewX = new OpenSimplex2D(chunkRandom.nextInt())
      .octaves(2)
      .scaled(Math.fround(-1.8), Math.fround(1.8))
      .spread(Math.fround(0.01));
    this.surfaceRockSkewZ = new OpenSimplex2D(chunkRandom.nextInt())
      .octaves(2)
      .scaled(Math.fround(-1.8), Math.fround(1.8))
      .spread(Math.fround(0.01));
    // `// Flora`: `TFCLayers.createOverworldForestLayer(random.nextLong(), ...)` is the very next
    // draw from the same chunk-data random, right after the three layer noises above.
    this.forestLayer = overworldForestLayer(chunkRandom.nextLong());
  }

  /** Chunk-data forest type at a chunk (`ForestType` ordinal, `../chunkdata/forest.ts`). @unverified */
  private readonly forestLayer: Area;
  forestTypeAt(chunkX: number, chunkZ: number): number {
    return this.forestLayer(chunkX, chunkZ);
  }

  protected createBiomeLayer(seed: bigint): Area {
    return regionBiomeLayer(seed, (x, z) => this.getOrCreateRegionPoint(x, z).biome);
  }

  /** `RegionGenerator.sampleCell(int, int)`. */
  sampleCell(gridX: number, gridZ: number): Cell {
    return this.cellNoise.cell(gridX, gridZ);
  }

  /** `RegionGenerator.getOrCreateRegion(int, int)` (the `@VisibleForTesting` grid-coordinate
   * overload). */
  getOrCreateRegion(gridX: number, gridZ: number): Region {
    return this.getOrCreateRegionByCell(this.sampleCell(gridX, gridZ));
  }

  /** `RegionGenerator.getOrCreateRegionPoint(int, int)`. */
  getOrCreateRegionPoint(gridX: number, gridZ: number): RegionPoint {
    return this.getOrCreateRegion(gridX, gridZ).requireAt(gridX, gridZ);
  }

  /**
   * Cheap membership check for the hover readout's fast path (`Tfc120Generator.probeFast`): true
   * when the region owning `(gridX, gridZ)` is already built and cached. Only ever reads
   * `cellNoise` (a Voronoi lookup, not the task pipeline) and the cache map — never builds a
   * region, unlike every other public method here. Not a bump of the LRU order: a mere readiness
   * check should not itself keep an otherwise-cold region alive.
   */
  isRegionCached(gridX: number, gridZ: number): boolean {
    const cell = this.sampleCell(gridX, gridZ);
    return this.regionCache.has(`${cell.cx},${cell.cy}`);
  }

  /**
   * `RegionGenerator.getOrCreatePartitionPoint(gridX, gridZ)` — the river segments that may
   * influence this grid position.
   *
   * A `Region` owns one cell, but a river edge near a cell boundary reaches into its neighbours, so
   * the partition is built from the **3×3 cell neighbourhood** (`getAllRegionsIn3x3CellArea`) and
   * not from the local region alone. Scanning only the owning region would drop exactly the rivers
   * that cross a boundary.
   *
   * Each edge already carries the partition box it can affect (`RiverEdge.minPartX` and friends,
   * computed in its constructor), so this only has to bucket them.
   */
  riversAtGrid(gridX: number, gridZ: number): readonly RiverEdge[] {
    const cellX = gridToCell(gridX);
    const cellZ = gridToCell(gridZ);
    // Single-entry memo before the keyed cache. A cell is 96 grid (12 288 blocks) across, so a tile
    // scan asks about the same cell thousands of times in a row; without this, every one of those
    // allocates a key string and walks the Map. That is the whole cost of the river lookup on the
    // tile path.
    if (cellX === this.lastPartitionCellX && cellZ === this.lastPartitionCellZ) {
      const cached = this.lastPartition;
      if (cached !== null) {
        return cached.get(partitionIndex(gridToPart(gridX), gridToPart(gridZ))) ?? NO_RIVERS;
      }
    }
    const key = `${cellX},${cellZ}`;
    let partition = this.partitionCache.get(key);
    if (partition === undefined) {
      partition = this.createPartition(cellX, cellZ);
      this.partitionCache.set(key, partition);
      if (this.partitionCache.size > RegionGenerator.MAX_CACHED_PARTITIONS) {
        const oldest = this.partitionCache.keys().next().value;
        if (oldest !== undefined) this.partitionCache.delete(oldest);
      }
    }
    this.lastPartitionCellX = cellX;
    this.lastPartitionCellZ = cellZ;
    this.lastPartition = partition;
    return partition.get(partitionIndex(gridToPart(gridX), gridToPart(gridZ))) ?? NO_RIVERS;
  }

  /** `RegionGenerator.createPartition`. Keyed by the same packed index Java uses. */
  private createPartition(cellX: number, cellZ: number): Map<number, RiverEdge[]> {
    const partition = new Map<number, RiverEdge[]>();
    const minPartX = cellToPart(cellX);
    const minPartZ = cellToPart(cellZ);
    const isIn = (partX: number, partZ: number): boolean => {
      const localX = partX - minPartX;
      const localZ = partZ - minPartZ;
      return (
        localX >= 0 &&
        localZ >= 0 &&
        localX < CELL_WIDTH_IN_PARTITION &&
        localZ < CELL_WIDTH_IN_PARTITION
      );
    };

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const region = this.getOrCreateRegion(cellToGrid(cellX + dx), cellToGrid(cellZ + dz));
        // `Region.rivers` is `unknown[]` on purpose: TFC and TFG store different edge shapes in
        // that one slot, so each profile casts on read rather than one pretending to be the other
        // (docs/PARITY.md). These are the ones `addRiversAndLakes` above put there.
        for (const edge of region.rivers as readonly RiverEdge[]) {
          for (let partX = edge.minPartX; partX <= edge.maxPartX; partX++) {
            for (let partZ = edge.minPartZ; partZ <= edge.maxPartZ; partZ++) {
              if (!isIn(partX, partZ)) continue;
              const index = partitionIndex(partX, partZ);
              const bucket = partition.get(index);
              if (bucket) bucket.push(edge);
              else partition.set(index, [edge]);
            }
          }
        }
      }
    }
    return partition;
  }

  /** `RegionBiomeSource.getNoiseBiome(int quartX, int quartZ)`: `biomeLayer.get(quartX, quartZ)`,
   * the fully-zoomed `TFCLayers.createRegionBiomeLayer` output — quart coordinates (1 unit = 4
   * blocks), returning a `TFCLayers` biome layer id (see `../biome/ids.ts`'s `Biome` enum /
   * `biomeId`, in the same registration order). */
  biomeAtQuart(quartX: number, quartZ: number): number {
    return this.biomeLayerArea(quartX, quartZ);
  }

  /** `RegionChunkDataGenerator.generateRock`'s `rockLayerArea.get().get(skewX, skewZ)` lookup, but
   * without the lateral skew (`layerSkewXNoise`/`layerSkewZNoise`, real but harmless to omit here —
   * they nudge which nearby block's rock category applies by at most a few blocks, and always by a
   * fully-`@fixed` real 2D noise field, not a per-Y-level effect) and without picking a recursion
   * *depth* by real surface height, which is out of scope — see `../rock/layer-settings.ts` and
   * `docs/PARITY.md`. Returns the raw `pointRock` value (`ChooseRocks`'s packed
   * category+area-seed int, see `../biome/choose.ts`) at **block** coordinates. */
  rockAt(blockX: number, blockZ: number): number {
    return this.rockLayerArea(blockX, blockZ);
  }

  /**
   * `RegionChunkDataGenerator.generateRock`: which rock layer, and which rock point, applies at a
   * given block position.
   *
   * ```java
   * float adjustedSurfaceY = surfaceY;
   * if (adjustedSurfaceY > 125) adjustedSurfaceY = 125 + 0.3f * (surfaceY - 125);
   * int layer = 0;
   * float deltaY = adjustedSurfaceY - y;
   * do {
   *     layerHeight = (float) layerHeightNoise.noise(x + getOffsetX(layer), z + getOffsetZ(layer));
   *     if (deltaY <= layerHeight) break;
   *     deltaY -= layerHeight;
   *     layer++;
   * } while (deltaY > 0);
   * final int skewX = x + (int) (skewNoiseX * (deltaY + DELTA_Y_OFFSET));
   * ```
   *
   * The layer index is what decides the rock: `sampleAtLayer(point, layer)` walks the profile's own
   * rock list that many steps down. Without this, everything below the surface layer was a guess —
   * see docs/WORLDGEN-NOTES.md, "A vein needs its host rock".
   */
  rockLayerAtY(
    blockX: number,
    y: number,
    blockZ: number,
    surfaceY: number,
  ): { readonly point: number; readonly layer: number } {
    const adjusted = surfaceY > 125 ? Math.fround(125 + Math.fround(0.3) * (surfaceY - 125)) : surfaceY;
    let layer = 0;
    let deltaY = Math.fround(adjusted - y);
    for (;;) {
      const layerX = blockX + (ROCK_LAYER_OFFSETS[(layer & LAYER_OFFSET_MASK) << 1] ?? 0);
      const layerZ = blockZ + (ROCK_LAYER_OFFSETS[((layer & LAYER_OFFSET_MASK) << 1) | 1] ?? 0);
      const layerHeight = Math.fround(this.layerHeightNoise.noise(layerX, layerZ));
      if (deltaY <= layerHeight) break;
      deltaY = Math.fround(deltaY - layerHeight);
      layer++;
      if (deltaY <= 0) break;
    }
    const offsetX = blockX + (ROCK_LAYER_OFFSETS[(layer & LAYER_OFFSET_MASK) << 1] ?? 0);
    const offsetZ = blockZ + (ROCK_LAYER_OFFSETS[((layer & LAYER_OFFSET_MASK) << 1) | 1] ?? 0);
    const skewX =
      blockX + Math.trunc(Math.fround(this.surfaceRockSkewX.noise(offsetX, offsetZ)) * (deltaY + 12));
    const skewZ =
      blockZ + Math.trunc(Math.fround(this.surfaceRockSkewZ.noise(offsetX, offsetZ)) * (deltaY + 12));
    return { point: this.rockLayerArea(skewX, skewZ), layer };
  }

  /** `RockData.getSurfaceRock`: layer zero with `RegionChunkDataGenerator`'s lateral skew. */
  surfaceRockAt(blockX: number, blockZ: number): number {
    const offsetX = blockX + (ROCK_LAYER_OFFSETS[0] ?? 0);
    const offsetZ = blockZ + (ROCK_LAYER_OFFSETS[1] ?? 0);
    const skewX =
      blockX + Math.trunc(Math.fround(this.surfaceRockSkewX.noise(offsetX, offsetZ)) * 12);
    const skewZ =
      blockZ + Math.trunc(Math.fround(this.surfaceRockSkewZ.noise(offsetX, offsetZ)) * 12);
    return this.rockLayerArea(skewX, skewZ);
  }

  private getOrCreateRegionByCell(cell: Cell): Region {
    // Java caches by `Float.floatToIntBits` of the cell's jittered centre coordinates. Caching by
    // the integer lattice cell (`cx`, `cy`) that deterministically produced that centre is
    // equivalent and simpler — see the same reasoning in `tasks.ts`' `addContinents`.
    const key = `${cell.cx},${cell.cy}`;
    let region = this.regionCache.get(key);
    if (region) {
      this.regionCache.delete(key);
      this.regionCache.set(key, region);
      return region;
    }
    region = this.createRegion(cell);
    this.regionCache.set(key, region);
    while (this.regionCache.size > RegionGenerator.MAX_CACHED_REGIONS) {
      const oldest = this.regionCache.keys().next().value;
      if (oldest === undefined) break;
      this.regionCache.delete(oldest);
    }
    return region;
  }

  /** Exposed for diagnostics and focused cache-bound tests; does not affect generation. */
  get cachedRegionCount(): number {
    return this.regionCache.size;
  }

  /** `RegionGenerator.createRegion(Cellular2D.Cell)` / `Context.runTasks()`, restricted to the
   * biome-relevant task subset — see this file's header, `./tasks.ts` and `./terrain-tasks.ts`. */
  protected createRegion(cell: Cell): Region {
    const region = new Region(cell);
    const random = XoroshiroRandomSource.fromSeed(regionSeedFor(this.seed, cell));

    const ctx: RegionBuildContext = {
      region,
      regionCell: cell,
      random,
      sampleCell: (x, z) => this.sampleCell(x, z),
      continentNoise: this.continentNoise,
      temperatureNoise: this.temperatureNoise,
      rainfallNoise: this.rainfallNoise,
      ...createFootprint(),
    };

    addContinents(ctx);
    shrinkToCell(ctx);
    annotateDistanceToCellEdge(ctx);
    floodFillSmallOceans(ctx);
    addIslands(ctx);
    annotateDistanceToOcean(ctx);
    annotateBaseLandHeight(ctx);
    addMountains(ctx);
    annotateBiomeAltitude(ctx);
    annotateClimate(ctx);
    // `ANNOTATE_RAINFALL` is a real `RegionGenerator.Task` but its `RegionTask` is a no-op
    // (`c -> {}`) — nothing to port.
    chooseBiomes(ctx, this.biomeArea);
    chooseRocks(ctx, this.rockArea);
    // `ADD_RIVERS_AND_LAKES` runs last, after `CHOOSE_ROCKS` (plan section 7). It both fills
    // `region.rivers` and mutates points in place — marking river mouths, and swapping some biomes
    // for their lake variants, which is why it has to run after biomes are chosen.
    addRiversAndLakes(region, random);

    return region;
  }
}

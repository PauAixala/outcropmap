/** TFG Core Modern 0.9.21 Overworld v1 regional pipeline. EUPL-1.2. */
import { XoroshiroRandomSource } from '@core/random';
import {
  RegionGenerator,
  regionSeedFor,
  type RegionGeneratorSettings,
} from '../../tfc-1.20/region/generator';
import type { Cell } from '../../tfc-1.20/noise/cellular-2d';
import { OpenSimplex2D } from '../../tfc-1.20/noise/open-simplex-2d';
import {
  annotateDistanceToCellEdge,
  floodFillSmallOceans,
  createFootprint,
  type RegionBuildContext,
} from '../../tfc-1.20/region/tasks';
import {
  annotateBaseLandHeight,
  addMountains,
  annotateBiomeAltitude,
} from '../../tfc-1.20/region/terrain-tasks';
import { tfgRocks } from '../rocks';
import { TFGRegion, initializeRegion, addContinents } from './initialization';
import {
  addIslands,
  addHotspots,
  annotateDistanceToOcean,
  annotateDistanceToWestCoast,
  annotateClimate,
  chooseRocks,
} from './tasks';
import { hotspotFields } from '../noise/hotspots';
import { chooseBiomes } from '../biome/choose';
import { regionBiomeLayer } from '../biome/layers';
import { addRiversAndLakes, riverDistanceSq, type TFGRiverEdge } from './rivers';
import { B, NO_RIVERS } from '../biome/ids';
import type { Area } from '../../tfc-1.20/biome/area';

const NO_EDGES: readonly TFGRiverEdge[] = [];

export class TFGRegionGenerator extends RegionGenerator {
  private readonly hotspots: ReturnType<typeof hotspotFields>;
  private readonly ocean: OpenSimplex2D;
  constructor(
    seed: bigint,
    private readonly settings: RegionGeneratorSettings,
  ) {
    super(seed, settings);
    this.hotspots = hotspotFields(seed);
    this.ocean = new OpenSimplex2D(seed).spread(Math.fround(0.02));
  }

  // Numeric keys: `riversAt` runs once per quart the biome layer paints, and building "x,z" strings
  // there was a measurable slice of a biome tile. Partition points and cells stay far inside
  // +/-2^20 for any world coordinate Minecraft allows, so `a * 2^21 + b` is collision-free.
  private readonly partitions = new Map<number, Map<number, TFGRiverEdge[]>>();

  riversAt(gridX: number, gridZ: number): readonly TFGRiverEdge[] {
    const cellX = Math.floor(gridX / 96),
      cellZ = Math.floor(gridZ / 96),
      key = cellX * 2097152 + cellZ;
    let partition = this.partitions.get(key);
    if (!partition) {
      partition = new Map();
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const region = this.getOrCreateRegion((cellX + dx) * 96, (cellZ + dz) * 96);
          // `Region.rivers` is typed as TFC's own `RiverEdge` now that section 7 replaced the
          // placeholder. TFG stores its own edge shape in the same slot, so the cast goes through
          // `unknown` rather than pretending the two types overlap.
          for (const edge of region.rivers as unknown as TFGRiverEdge[]) {
            const cx = Math.floor(0.5 * (edge.sourceX + edge.drainX) + 0.5),
              cz = Math.floor(0.5 * (edge.sourceZ + edge.drainZ) + 0.5);
            for (let px = Math.floor((cx - 6) / 3); px <= Math.floor((cx + 6) / 3); px++) {
              for (let pz = Math.floor((cz - 6) / 3); pz <= Math.floor((cz + 6) / 3); pz++) {
                if (
                  px < cellX * 32 ||
                  px >= (cellX + 1) * 32 ||
                  pz < cellZ * 32 ||
                  pz >= (cellZ + 1) * 32
                )
                  continue;
                const k = px * 2097152 + pz,
                  list = partition.get(k) ?? [];
                list.push(edge);
                partition.set(k, list);
              }
            }
          }
        }
      this.partitions.set(key, partition);
      if (this.partitions.size > 64) this.partitions.delete(this.partitions.keys().next().value!);
    }
    return partition.get(Math.floor(gridX / 3) * 2097152 + Math.floor(gridZ / 3)) ?? NO_EDGES;
  }

  /**
   * `BiomeSourceExtension.getBiomeExtensionNoRiver` — the quart biome *before* rivers are carved in.
   *
   * The height path must use this one. `river` has no height factory (TFG registers it with a
   * surface builder and nothing else, exactly as TFC does), so a blend that contains it cannot be
   * evaluated; TFC avoids that by having `TFCChunkGenerator` ask for the no-river biome, and this
   * is the same split.
   */
  biomeAtQuartNoRiver(x: number, z: number): number {
    return super.biomeAtQuart(x, z);
  }

  override biomeAtQuart(x: number, z: number): number {
    const biome = super.biomeAtQuart(x, z);
    if (!NO_RIVERS.has(biome)) {
      for (const edge of this.riversAt(Math.floor(x / 32), Math.floor(z / 32))) {
        if (riverDistanceSq(edge, x / 32, z / 32) < Math.fround(0.08) ** 2) return B.RIVER;
      }
    }
    return biome;
  }

  protected override createBiomeLayer(seed: bigint): Area {
    return regionBiomeLayer(seed, (x, z) => this.getOrCreateRegionPoint(x, z).biome);
  }

  protected override createRegion(cell: Cell): TFGRegion {
    const region = new TFGRegion(cell);
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
    initializeRegion(region, cell, ctx.sampleCell);
    addContinents(region, this.continentNoise);
    annotateDistanceToCellEdge(ctx);
    floodFillSmallOceans(ctx);
    addIslands(region, random);
    addHotspots(region, this.hotspots);
    annotateDistanceToOcean(region);
    annotateBaseLandHeight(ctx);
    annotateDistanceToWestCoast(region, this.settings.temperatureScale);
    addMountains(ctx);
    annotateBiomeAltitude(ctx);
    annotateClimate(region, this.temperatureNoise, this.rainfallNoise, (x, z) =>
      this.ocean.noise(x, z),
    );
    chooseRocks(region, this.rockArea);
    for (const p of region.data)
      if (p)
        p.isSurfaceRockKarst = ['limestone', 'dolomite', 'chalk', 'marble'].includes(
          tfgRocks.sampleAtLayer(p.rock, 0),
        );
    chooseBiomes(region, random, this.biomeArea);
    addRiversAndLakes(region, random);
    return region;
  }
}

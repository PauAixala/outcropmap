import { blockToQuart } from '@core/coords/coords';
import { Biome, riverBlendFor } from './ids';
import {
  RIVER_BLEND_COUNT,
  RiverBlend,
  RiverHeightSamplers,
  sampleRiverEdge,
  type RiverInfo,
} from '../river/river-height';
import type { RiverEdge } from '../river/river-edge';
import { biomeHeightNoise } from './height-noise';
import { sampleBiomeColumn, sampleChunkBiomes, type BiomeWeights } from './chunk-biome-sampler';
import { clamp, mapRange } from '../noise/noise2d';
import { mthClampedMap } from '../region/mth';
import { OpenSimplex2D } from '../noise/open-simplex-2d';

const SEA_LEVEL = 63;
const MAX_CACHED_CHUNKS = 2048;

function isShore(biome: Biome): boolean {
  return biome === Biome.SHORE || biome === Biome.TIDAL_FLATS;
}

/**
 * TFC `ChunkHeightFiller.sampleHeight` through biome blending, shore adjustment and river carving.
 *
 * River carving is applied when the caller supplies a river lookup; without one the sampler is the
 * biome blend alone, which is what a profile with no river graph gets.
 */
export class SurfaceHeightSampler {
  private readonly heights = new Map<Biome, (x: number, z: number) => number>();
  private readonly shoreNoise: OpenSimplex2D;
  private readonly chunks = new Map<string, BiomeWeights[]>();

  private readonly riverSamplers: RiverHeightSamplers;
  private readonly riverBlendWeights = new Float64Array(RIVER_BLEND_COUNT);

  constructor(
    seed: bigint,
    private readonly biomeAtQuart: (quartX: number, quartZ: number) => Biome,
    /**
     * The river edges that can affect a column, or undefined for a profile with no river graph.
     * Taking a lookup rather than the region generator keeps this module free of that dependency.
     */
    private readonly riversAt?: (blockX: number, blockZ: number) => readonly RiverEdge[],
  ) {
    this.riverSamplers = new RiverHeightSamplers(seed);
    for (let biome = Biome.OCEAN; biome <= Biome.PLATEAU_LAKE; biome++) {
      const noise = biomeHeightNoise(biome, seed);
      if (noise) this.heights.set(biome, noise);
    }
    this.shoreNoise = new OpenSimplex2D(seed)
      .octaves(2)
      .spread(Math.fround(0.003))
      .scaled(-0.1, 1.1);
  }

  sample(blockX: number, blockZ: number): number {
    const x = Math.floor(blockX);
    const z = Math.floor(blockZ);
    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    const weights = sampleBiomeColumn(
      this.chunkWeights(chunkX, chunkZ),
      x - chunkX * 16,
      z - chunkZ * 16,
    );

    let height = 0;
    let normalHeight = 0;
    let shoreHeight = 0;
    let shoreWeight = 0;
    let hasShore = false;
    for (const [biome, weight] of weights) {
      const noise = this.heights.get(biome);
      if (!noise) continue;
      const weightedHeight = weight * Math.fround(noise(x, z));
      height += weightedHeight;
      if (isShore(biome)) {
        shoreHeight += weightedHeight;
        shoreWeight += weight;
        hasShore = true;
      } else {
        normalHeight += weightedHeight;
      }
    }

    if (shoreWeight > 0.5 && hasShore) {
      const influence = clamp(
        this.shoreNoise.noise(x, z) + mapRange(height, SEA_LEVEL, SEA_LEVEL + 20, 0, 0.6),
        0,
        1,
      );
      const adjustedInfluence = 1 - (1 - influence) * (1 - influence);
      const x2 = 0.8 + adjustedInfluence * (0.515 - 0.8);
      const y2 = 1.15 - 0.3 * x2;
      const adjustedShoreWeight =
        shoreWeight < x2
          ? mapRange(shoreWeight, 0.5, x2, 0.5, y2)
          : mapRange(shoreWeight, x2, 1, y2, 1);
      const normalWeight = 1 - shoreWeight;
      const adjustedNormalWeight = 1 - adjustedShoreWeight;
      const adjustedHeight = Math.max(
        (adjustedShoreWeight / shoreWeight) * shoreHeight +
          (adjustedNormalWeight / normalWeight) * normalHeight,
        SEA_LEVEL,
      );
      if (adjustedHeight < height) height = adjustedHeight;
    }

    height = this.adjustForRivers(weights, x, z, height);

    // `TFCChunkGenerator.getBaseHeight` casts ChunkHeightFiller's double result to int.
    return Math.trunc(height);
  }

  /**
   * `computeInitialRiverWeights` + `adjustWeightsForRiverCaves` + `adjustHeightForRiverContributions`.
   *
   * The cave adjustment is ported even though the cave *sampler* is not: it redistributes weight
   * away from the other types, so skipping it would over-carve mountain rivers rather than leave
   * them alone.
   */
  private adjustForRivers(
    weights: BiomeWeights,
    blockX: number,
    blockZ: number,
    height: number,
  ): number {
    if (!this.riversAt) return height;
    const info: RiverInfo | null = sampleRiverEdge(this.riversAt(blockX, blockZ), blockX, blockZ);
    if (info === null) return height;

    const blend = this.riverBlendWeights;
    blend.fill(0);
    for (const [biome, weight] of weights) {
      const type = riverBlendFor(biome);
      blend[type] = (blend[type] ?? 0) + weight;
    }

    // `adjustWeightsForRiverCaves`: hand the cave type a sharp cutoff so caves do not pinch a river
    // off at its mouth.
    const initialCaveWeight = blend[RiverBlend.CAVE] ?? 0;
    if (initialCaveWeight > 0) {
      const adjustedCaveWeight =
        initialCaveWeight < 0.25
          ? mthClampedMap(initialCaveWeight, 0, 0.25, 0, 0.1)
          : 1 - (blend[RiverBlend.NONE] ?? 0);
      for (let type = 0; type < RIVER_BLEND_COUNT; type++) {
        blend[type] = ((blend[type] ?? 0) * (1 - adjustedCaveWeight)) / (1 - initialCaveWeight);
      }
      blend[RiverBlend.CAVE] = adjustedCaveWeight;
    }

    return this.riverSamplers.apply(info, [...blend], blockX, blockZ, height);
  }

  private chunkWeights(chunkX: number, chunkZ: number): BiomeWeights[] {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.chunks.get(key);
    if (cached) {
      this.chunks.delete(key);
      this.chunks.set(key, cached);
      return cached;
    }
    const weights = sampleChunkBiomes(chunkX, chunkZ, (x, z) =>
      this.biomeAtQuart(blockToQuart(x), blockToQuart(z)),
    );
    this.chunks.set(key, weights);
    if (this.chunks.size > MAX_CACHED_CHUNKS) {
      const oldest = this.chunks.keys().next().value;
      if (oldest !== undefined) this.chunks.delete(oldest);
    }
    return weights;
  }
}

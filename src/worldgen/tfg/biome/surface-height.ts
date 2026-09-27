/**
 * Surface height for the `tfg` profile — `TFGChunkHeightFiller` through the same 7×7 quart biome
 * blend `tfc-1.20` uses, over TerraFirmaGreg's own 109 biome height factories.
 *
 * ## The rule that shapes this file
 *
 * A column's height is a weighted blend of up to 49 neighbouring quart biomes. If even one of them
 * has no height factory, the blend is not "mostly right" — the weights no longer sum to 1 and the
 * result is wrong by an invisible fraction, which is exactly the plausible-but-false output
 * CLAUDE.md section 2 forbids. So `sample` returns **`null`** unless every biome in the blend
 * resolves, and the caller reports no height rather than a guess.
 *
 * That also makes the port safe to land incrementally: coverage grows as factories are added, and a
 * gap shows up as a blank rather than as wrong terrain.
 *
 * @unverified No JVM fixture. The factories are transcribed from source (see
 * `../noise/biome-noise.ts`) and this file is checked by property. See docs/PARITY.md.
 */
import { blockToQuart } from '@core/coords/coords';
import biomeHeights from '@data/tfg/biome-heights.json';
import type { Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';
import {
  sampleBiomeColumn,
  sampleChunkBiomes,
  type BiomeWeights,
} from '@worldgen/tfc-1.20/biome/chunk-biome-sampler';
import { BIOME_IDS } from './ids';
import type { TFGRiverEdge } from '../region/rivers';
import { riverEdgesNearChunk, sampleTFGRiverEdge } from '../river/river-info';
import {
  createRiverHeightSamplers,
  RIVER_TYPE_CAVE,
  RIVER_TYPE_COUNT,
  RIVER_TYPE_NONE,
  riverTypeIndexOf,
  type RiverHeightSampler,
} from '../river/river-noise';
import { evaluateHeightExpression } from './height-expression';
import { createHeightRegistry } from './height-registry';
import { mapRange } from '@worldgen/tfc-1.20/noise/noise2d';

const MAX_CACHED_CHUNKS = 2048;

interface ExtractedHeights {
  readonly biomes: Readonly<Record<string, { readonly expression: string } | null>>;
}

/** `tfg:earth/plains` -> `plains`, the key the extracted table uses. */
function bareName(biomeId: string): string {
  return biomeId.slice(biomeId.lastIndexOf('/') + 1);
}

export class TFGSurfaceHeightSampler {
  /** Height field per biome index, or `null` where the biome has no usable factory. */
  private readonly heights: (Noise2D | null)[] = [];
  // Numeric keys, not `${x},${z}`: the region generator switched these for the same reason, and
  // this map is asked once per column. Chunk coordinates stay far inside +/-2^20 for any position
  // Minecraft allows, so `a * 2^21 + b` is collision-free.
  private readonly chunks = new Map<number, BiomeWeights[]>();

  /** Biome names whose expression could not be evaluated, for reporting rather than silence. */
  readonly unsupported: readonly string[];

  /** One valley shape per river blend type, in enum order — see `river/river-noise.ts`. */
  private readonly riverSamplers: readonly (RiverHeightSampler | null)[];
  private readonly riverBlendWeights = new Float64Array(RIVER_TYPE_COUNT);
  /** A biome index's valley shape, memoised: `riverTypeIndexOf` parses a string. */
  private readonly riverTypeByBiome: readonly number[];
  /**
   * The rivers that can reach one chunk, cached beside its biome weights. Nine columns in ten have
   * no river in reach, and without this each of them walked the whole partition's edge list.
   */
  private readonly chunkRivers = new Map<number, readonly TFGRiverEdge[]>();

  constructor(
    seed: bigint,
    private readonly biomeAtQuart: (quartX: number, quartZ: number) => number,
    /**
     * The river edges that can affect a column, or undefined for a caller with no river graph.
     * Without it the sampler carves nothing, which is what it did until 2026-09-12 — and a river
     * column then reads about 15 blocks too high.
     */
    private readonly riversAt?: (blockX: number, blockZ: number) => readonly TFGRiverEdge[],
  ) {
    this.riverSamplers = createRiverHeightSamplers(seed);
    this.riverTypeByBiome = BIOME_IDS.map((id) => riverTypeIndexOf(id));
    const table = (biomeHeights as unknown as ExtractedHeights).biomes;
    const registry = createHeightRegistry(seed);
    const unsupported: string[] = [];

    BIOME_IDS.forEach((biomeId, index) => {
      const entry = table[bareName(biomeId)];
      if (!entry) {
        // No `.heightmap(...)` in the source at all — `river` is the only one, as in TFC, where the
        // river carver supplies the height instead.
        this.heights[index] = null;
        return;
      }
      try {
        this.heights[index] = evaluateHeightExpression(entry.expression, seed, registry);
      } catch {
        this.heights[index] = null;
        unsupported.push(bareName(biomeId));
      }
    });

    this.unsupported = unsupported;
  }

  /**
   * The blended surface height at a block, or `null` when any biome in the blend has no factory.
   *
   * `TFGChunkHeightFiller` keeps TFC's structure here: weights come from the same 7×7 quart sampler,
   * and the result is truncated to an int as `TFCChunkGenerator.getBaseHeight` does.
   */
  sample(blockX: number, blockZ: number): number | null {
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
    for (const [biome, weight] of weights) {
      const noise = this.heights[biome];
      // One unresolved biome invalidates the whole column: see this file's header.
      if (!noise) return null;
      height += weight * noise(x, z);
    }
    return Math.trunc(this.carveRivers(weights, chunkX, chunkZ, x, z, height));
  }

  /**
   * `TFGChunkHeightFiller.adjustHeightForRiverContributions`, with `computeInitialRiverWeights` and
   * `adjustWeightsForRiverCaves` ahead of it.
   *
   * Every shape present at the column is sampled once and the results interpolated by weight, with
   * `NONE` contributing the uncarved height. The cave bias is the fiddly part and is TFG's own: past
   * a point the cave carver takes the whole remaining weight, because interpolating a canyon and a
   * cave together pinches the river off at its mouth.
   */
  private carveRivers(
    weights: BiomeWeights,
    chunkX: number,
    chunkZ: number,
    x: number,
    z: number,
    height: number,
  ): number {
    if (!this.riversAt) return height;
    const edges = this.riversNear(chunkX, chunkZ, x, z);
    if (edges.length === 0) return height;
    const info = sampleTFGRiverEdge(edges, x, z);
    if (info === null) return height;

    const blend = this.riverBlendWeights;
    blend.fill(0);
    for (const [biome, weight] of weights) {
      const type = this.riverTypeByBiome[biome] ?? RIVER_TYPE_NONE;
      blend[type] = (blend[type] ?? 0) + weight;
    }

    const initialCaveWeight = blend[RIVER_TYPE_CAVE] ?? 0;
    if (initialCaveWeight > 0) {
      const totalWeight = 1 - (blend[RIVER_TYPE_NONE] ?? 0);
      const adjustedCaveWeight =
        initialCaveWeight < 0.25
          ? mapRange(initialCaveWeight, 0, 0.25, 0, 0.1 * totalWeight)
          : totalWeight;
      for (let type = 0; type < RIVER_TYPE_COUNT; type++) {
        blend[type] = ((blend[type] ?? 0) * (1 - adjustedCaveWeight)) / (1 - initialCaveWeight);
      }
      blend[RIVER_TYPE_CAVE] = adjustedCaveWeight;
    }

    let carved = 0;
    for (let type = 0; type < RIVER_TYPE_COUNT; type++) {
      const weight = blend[type] ?? 0;
      if (weight <= 0) continue;
      const sampler = this.riverSamplers[type];
      carved +=
        weight *
        (sampler
          ? sampler(info, x, z, height, initialCaveWeight, weight)
          : // NONE: the land's own height, uncarved.
            height);
    }
    return carved;
  }

  /** The rivers within reach of a chunk, cached alongside its biome weights. */
  private riversNear(
    chunkX: number,
    chunkZ: number,
    x: number,
    z: number,
  ): readonly TFGRiverEdge[] {
    const key = chunkX * 2097152 + chunkZ;
    const cached = this.chunkRivers.get(key);
    if (cached) return cached;
    const near = riverEdgesNearChunk(this.riversAt!(x, z), chunkX, chunkZ);
    this.chunkRivers.set(key, near);
    if (this.chunkRivers.size > MAX_CACHED_CHUNKS) {
      const oldest = this.chunkRivers.keys().next().value;
      if (oldest !== undefined) this.chunkRivers.delete(oldest);
    }
    return near;
  }

  private chunkWeights(chunkX: number, chunkZ: number): BiomeWeights[] {
    const key = chunkX * 2097152 + chunkZ;
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

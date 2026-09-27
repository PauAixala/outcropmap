/**
 * Per-tile raw-sample cache: caches the rock/climate/biome values a tile's pixels have already
 * been sampled at, keyed by everything that changes those values (seed, profile, dimension,
 * settings, zoom, tile) but explicitly NOT by the active filter. Pau's words
 * (docs/FEEDBACK.md): "al filtrar se recalcula todo y tarda mucho" -- a filter-threshold change
 * used to re-sample every visible pixel through the generator again (`generator.rocks`/
 * `climate`/`biome`, each walking the region/layer/noise pipeline -- see
 * `src/worldgen/tfc-1.20/region/generator.ts`) even though the values themselves had not
 * changed. This cache lets `filterLayer.render` (`raster-layers.ts`) sample a tile's values once
 * and re-evaluate `compileFilterMatcherRaw` (`./filter.ts`) over the cached numbers on every
 * later filter change for that same tile.
 *
 * Lives in `src/layers/`, not `src/workers/`: `filterLayer.render` -- the only consumer -- is
 * defined here, runs inside a worker (`src/workers/tile.worker.ts`), and this cache is pure data
 * with no DOM/worker dependency of its own, so it travels with the layer rather than crossing the
 * worker/layer boundary a second way. One instance lives per worker (`tile.worker.ts` owns it) and
 * is discarded wholesale on session change (seed/profile/dimension/settings) -- never on a filter
 * change, which is the entire point of this cache existing.
 *
 * Memory, said plainly: each cached tile stores one typed-array entry per pixel --
 * Uint16 rock top/middle/bottom ids and a Uint16 biome id (2 bytes each), plus Float32
 * temperature and rainfall (4 bytes each) -- 16 bytes/pixel. At the real tile size (256x256 =
 * 65,536 px, `TILE_SIZE_PX`) that is exactly 16 x 65,536 = 1,048,576 bytes = **1 MiB per cached
 * tile**. `SAMPLE_CACHE_MAX_TILES` (64) bounds one worker's cache at **64 MiB**; with up to 8
 * workers in the pool (`computePoolSize`, `src/workers/pool.ts`) the theoretical worst case
 * across the whole pool is 8 x 64 MiB = **512 MiB**. In practice a worker only ever receives the
 * tiles the spatial routing preference sends it (`workerIndexForTile`), so a single worker rarely
 * fills anywhere close to 64 entries for one viewport -- 64 was chosen to comfortably outlast one
 * full 1080p viewport's tile count (roughly 9x6 = 54 tiles at the default 256px tile size) so
 * panning back a short distance or nudging a filter threshold twice in a row keeps hitting the
 * cache, not to hold the whole world.
 */
import type { ClimateSample, DimensionId, ProfileId, RockStack, WorldGenerator } from '@worldgen/api/types';
import { LruCache } from '@render/tiles/lru-cache';

/** See this file's header for the exact byte accounting behind this bound. */
export const SAMPLE_CACHE_MAX_TILES = 64;

export interface TileSamples {
  readonly size: number;
  readonly rockTop: Uint16Array;
  readonly rockMiddle: Uint16Array;
  readonly rockBottom: Uint16Array;
  readonly temperature: Float32Array;
  readonly rainfall: Float32Array;
  readonly biome: Uint16Array;
}

/** Everything `filterLayer.render` needs to reach the sample cache for one tile request --
 * assembled by `src/workers/tile.worker.ts` from the worker's active session plus the tile
 * request it is currently handling. Not part of `RasterLayer.render`'s cache-key concept (that is
 * `TileKeyParts`, `src/render/tiles/tile-key.ts`, on the main thread) -- this is a second, worker-
 * local cache for raw samples, keyed the same way but never by layer or filter. */
export interface SampleCacheContext {
  readonly cache: TileSampleCache;
  readonly seed: string;
  readonly profile: ProfileId;
  readonly dimension: DimensionId;
  readonly settings: Readonly<Record<string, number>>;
  readonly zoom: number;
  readonly tileX: number;
  readonly tileZ: number;
}

/** 0 means "no value at this pixel" (ocean column -> `rocks()` returned null; `biome()` returned
 * null) -- never a real id's index, since interning starts at 1. */
const NONE = 0;

/** Interns rock/biome registry ids (strings) to small integers so a tile's samples fit in a
 * Uint16Array instead of an array of strings. Every profile's rock/biome registries are small
 * (CLAUDE.md's "Done" log: 20 rocks, 30 biomes for TFC 1.20 plus TFG's additions) so this never
 * grows past a few hundred entries for the life of a session. */
class IdTable {
  private readonly toIndex = new Map<string, number>();
  private readonly toId: string[] = [];

  intern(id: string): number {
    const existing = this.toIndex.get(id);
    if (existing !== undefined) return existing;
    const index = this.toId.length + 1; // 0 is reserved for NONE.
    this.toIndex.set(id, index);
    this.toId.push(id);
    return index;
  }

  idFor(index: number): string | null {
    if (index === NONE) return null;
    return this.toId[index - 1] ?? null;
  }
}

/** Stable string key independent of a settings object's own key insertion order, so two sessions
 * with the same values but differently-ordered `GeneratorSettings` objects still hit the cache. */
function settingsKey(settings: Readonly<Record<string, number>>): string {
  return Object.keys(settings)
    .sort()
    .map((k) => `${k}=${settings[k]}`)
    .join(',');
}

export class TileSampleCache {
  private readonly cache = new LruCache<string, TileSamples>(SAMPLE_CACHE_MAX_TILES);
  private readonly rockIds = new IdTable();
  private readonly biomeIds = new IdTable();

  private key(
    seed: string,
    profile: ProfileId,
    dimension: DimensionId,
    settings: Readonly<Record<string, number>>,
    zoom: number,
    tileX: number,
    tileZ: number,
  ): string {
    // Deliberately mirrors `tileKey` (`src/render/tiles/tile-key.ts`) minus `layer` -- this cache
    // is shared by whatever layer wants raw samples for a tile, and deliberately has no `filter`
    // component at all (see this file's header).
    return `${seed}|${profile}|${dimension}|${settingsKey(settings)}|${zoom}|${tileX}|${tileZ}`;
  }

  rockIdFor(index: number): string | null {
    return this.rockIds.idFor(index);
  }

  biomeIdFor(index: number): string | null {
    return this.biomeIds.idFor(index);
  }

  get(
    seed: string,
    profile: ProfileId,
    dimension: DimensionId,
    settings: Readonly<Record<string, number>>,
    zoom: number,
    tileX: number,
    tileZ: number,
  ): TileSamples | undefined {
    return this.cache.get(this.key(seed, profile, dimension, settings, zoom, tileX, tileZ));
  }

  /**
   * Samples one tile's rock/climate/biome values through the generator -- exactly the calls
   * `rockLayer`/`temperatureLayer`/`rainfallLayer`/`biomeLayer` already make per pixel
   * (`raster-layers.ts`), so there is no second, different sampling route (CLAUDE.md 5) -- and
   * caches the result under this tile's key. Expected to run once per tile per session; later
   * filter-only changes should hit `get` instead of reaching this again.
   */
  buildAndStore(
    seed: string,
    profile: ProfileId,
    dimension: DimensionId,
    settings: Readonly<Record<string, number>>,
    zoom: number,
    tileX: number,
    tileZ: number,
    generator: Pick<WorldGenerator, 'rocks' | 'climate' | 'biome'>,
    originX: number,
    originZ: number,
    size: number,
    blocksPerPixel: number,
  ): TileSamples {
    const count = size * size;
    const rockTop = new Uint16Array(count);
    const rockMiddle = new Uint16Array(count);
    const rockBottom = new Uint16Array(count);
    const temperature = new Float32Array(count);
    const rainfall = new Float32Array(count);
    const biome = new Uint16Array(count);

    let i = 0;
    for (let py = 0; py < size; py++) {
      const blockZ = Math.floor(originZ + py * blocksPerPixel);
      for (let px = 0; px < size; px++) {
        const blockX = Math.floor(originX + px * blocksPerPixel);
        const rocks: RockStack | null = generator.rocks(blockX, blockZ);
        rockTop[i] = rocks ? this.rockIds.intern(rocks.top) : NONE;
        rockMiddle[i] = rocks ? this.rockIds.intern(rocks.middle) : NONE;
        rockBottom[i] = rocks ? this.rockIds.intern(rocks.bottom) : NONE;
        const climate: ClimateSample = generator.climate(blockX, blockZ);
        temperature[i] = climate.temperature;
        rainfall[i] = climate.rainfall;
        const biomeId = generator.biome(blockX, blockZ);
        biome[i] = biomeId !== null ? this.biomeIds.intern(biomeId) : NONE;
        i++;
      }
    }

    const samples: TileSamples = { size, rockTop, rockMiddle, rockBottom, temperature, rainfall, biome };
    this.cache.set(this.key(seed, profile, dimension, settings, zoom, tileX, tileZ), samples);
    return samples;
  }

  /** Drops every cached tile. The worker replaces its `TileSampleCache` instance wholesale on
   * session change instead of calling this (simplest way to also reset the id tables together --
   * see `tile.worker.ts`'s `init` handler) -- exposed for tests and any future caller that wants
   * to drop cached tiles while keeping one instance's id tables around. */
  clear(): void {
    this.cache.clear();
  }

  /** Exposed for tests -- how many tiles are currently cached. */
  get size(): number {
    return this.cache.size;
  }
}

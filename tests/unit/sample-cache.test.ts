import { describe, expect, it } from 'vitest';
import { SAMPLE_CACHE_MAX_TILES, TileSampleCache } from '../../src/layers/sample-cache';
import { compileFilterMatcherRaw, DEFAULT_MAP_FILTER } from '../../src/layers/filter';
import type { MapFilter } from '../../src/layers/filter';
import { filterLayer } from '../../src/layers/raster-layers';
import type {
  BlockBox,
  ClimateSample,
  DimensionId,
  FeatureSet,
  Probe,
  ProfileDescriptor,
  RockStack,
  WorldGenerator,
} from '../../src/worldgen/api/types';

const GRANITE_TOP: RockStack = { bottom: 'gneiss', middle: 'diorite', top: 'granite', surface: null };
const SHALE_TOP: RockStack = { bottom: 'granite', middle: 'shale', top: 'shale', surface: null };
const WARM_WET: ClimateSample = { temperature: 25, rainfall: 400 };

describe('TileSampleCache', () => {
  it('a fresh cache has nothing stored', () => {
    const cache = new TileSampleCache();
    expect(cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('buildAndStore samples the generator once per pixel and caches the result under this tile key', () => {
    const cache = new TileSampleCache();
    const calls = { rocks: 0, climate: 0, biome: 0 };
    const generator = {
      rocks: (): RockStack | null => {
        calls.rocks++;
        return GRANITE_TOP;
      },
      climate: (): ClimateSample => {
        calls.climate++;
        return WARM_WET;
      },
      biome: (): string | null => {
        calls.biome++;
        return 'tfc:plains';
      },
    };
    const size = 4;
    const samples = cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0, generator, 0, 0, size, 1);
    expect(calls).toEqual({ rocks: 16, climate: 16, biome: 16 });
    expect(samples.rockTop).toHaveLength(16);
    expect(samples.temperature[0]).toBe(25);
    expect(samples.rainfall[0]).toBe(400);
    expect(cache.rockIdFor(samples.rockTop[0]!)).toBe('granite');
    expect(cache.rockIdFor(samples.rockMiddle[0]!)).toBe('diorite');
    expect(cache.rockIdFor(samples.rockBottom[0]!)).toBe('gneiss');
    expect(cache.biomeIdFor(samples.biome[0]!)).toBe('tfc:plains');

    // get() returns the same stored samples without calling the generator again.
    const got = cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0);
    expect(got).toBe(samples);
    expect(calls).toEqual({ rocks: 16, climate: 16, biome: 16 }); // unchanged
  });

  it('encodes an unavailable rock/biome (null) as a value that decodes back to null, never a real id', () => {
    const cache = new TileSampleCache();
    const generator = {
      rocks: (): RockStack | null => null,
      climate: (): ClimateSample => WARM_WET,
      biome: (): string | null => null,
    };
    const samples = cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0, generator, 0, 0, 2, 1);
    expect(cache.rockIdFor(samples.rockTop[0]!)).toBeNull();
    expect(cache.biomeIdFor(samples.biome[0]!)).toBeNull();
  });

  it('is keyed by seed, profile, dimension, settings, zoom and tile -- a change to any of them misses', () => {
    const cache = new TileSampleCache();
    const generator = { rocks: () => GRANITE_TOP, climate: () => WARM_WET, biome: () => 'tfc:plains' };
    cache.buildAndStore('1', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 3, 5, 7, generator, 0, 0, 2, 1);

    expect(cache.get('2', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 3, 5, 7)).toBeUndefined(); // seed
    expect(cache.get('1', 'tfg', 'overworld', { temperatureScale: 20000 }, 3, 5, 7)).toBeUndefined(); // profile
    expect(cache.get('1', 'tfc-1.20', 'nether', { temperatureScale: 20000 }, 3, 5, 7)).toBeUndefined(); // dimension
    expect(cache.get('1', 'tfc-1.20', 'overworld', { temperatureScale: 30000 }, 3, 5, 7)).toBeUndefined(); // settings
    expect(cache.get('1', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 4, 5, 7)).toBeUndefined(); // zoom
    expect(cache.get('1', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 3, 6, 7)).toBeUndefined(); // tileX
    expect(cache.get('1', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 3, 5, 8)).toBeUndefined(); // tileZ
    expect(cache.get('1', 'tfc-1.20', 'overworld', { temperatureScale: 20000 }, 3, 5, 7)).toBeDefined(); // exact match
  });

  it('a settings object is keyed by its values, not by key insertion order', () => {
    const cache = new TileSampleCache();
    const generator = { rocks: () => GRANITE_TOP, climate: () => WARM_WET, biome: () => 'tfc:plains' };
    cache.buildAndStore(
      '1', 'tfc-1.20', 'overworld',
      { temperatureScale: 20000, rainfallScale: 10000 },
      0, 0, 0, generator, 0, 0, 2, 1,
    );
    // Same values, keys inserted in the opposite order -- must still hit.
    expect(
      cache.get('1', 'tfc-1.20', 'overworld', { rainfallScale: 10000, temperatureScale: 20000 }, 0, 0, 0),
    ).toBeDefined();
  });

  it('the sample cache has no notion of the filter at all -- there is no filter parameter to key by', () => {
    const cache = new TileSampleCache();
    const generator = { rocks: () => GRANITE_TOP, climate: () => WARM_WET, biome: () => 'tfc:plains' };
    const samples = cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0, generator, 0, 0, 2, 1);
    // The only key inputs are seed/profile/dimension/settings/zoom/tile (checked above); the same
    // call with the same tile identity always returns the same stored samples regardless of
    // whatever filter a caller might separately be evaluating over them.
    expect(cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0)).toBe(samples);
  });

  it('is bounded: evicts the least recently used tile once SAMPLE_CACHE_MAX_TILES is exceeded', () => {
    const cache = new TileSampleCache();
    const generator = { rocks: () => GRANITE_TOP, climate: () => WARM_WET, biome: () => 'tfc:plains' };
    for (let tx = 0; tx < SAMPLE_CACHE_MAX_TILES; tx++) {
      cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, tx, 0, generator, 0, 0, 1, 1);
    }
    expect(cache.size).toBe(SAMPLE_CACHE_MAX_TILES);

    // One more tile pushes it over the bound -- the oldest, untouched since insertion (tx=0), is
    // evicted. (Checking it here first would itself refresh its LRU recency and change which tile
    // gets evicted -- see LruCache's own doc comment -- so this asserts eviction only afterward.)
    cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, SAMPLE_CACHE_MAX_TILES, 0, generator, 0, 0, 1, 1);
    expect(cache.size).toBe(SAMPLE_CACHE_MAX_TILES);
    expect(cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0)).toBeUndefined();
    expect(cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 1, 0)).toBeDefined();
  });

  it('clear() drops every cached tile', () => {
    const cache = new TileSampleCache();
    const generator = { rocks: () => GRANITE_TOP, climate: () => WARM_WET, biome: () => 'tfc:plains' };
    cache.buildAndStore('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0, generator, 0, 0, 1, 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('1', 'tfc-1.20', 'overworld', {}, 0, 0, 0)).toBeUndefined();
  });
});

describe('compileFilterMatcherRaw', () => {
  it('is behaviourally identical to compileFilterMatcher / matchesFilter for the same inputs', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'], rockMatch: 'any', tempMin: 0, biomes: ['tfc:plains'] };
    const raw = compileFilterMatcherRaw(filter);
    expect(raw('granite', 'diorite', 'gneiss', 25, 400, 'tfc:plains')).toBe(true);
    expect(raw('shale', 'granite', 'granite', 25, 400, 'tfc:plains')).toBe(true); // granite in 'any' position
    expect(raw('shale', 'shale', 'shale', 25, 400, 'tfc:plains')).toBe(false); // no granite anywhere
    expect(raw('granite', 'diorite', 'gneiss', 25, 400, 'tfc:hills')).toBe(false); // wrong biome
    expect(raw('granite', 'diorite', 'gneiss', -10, 50, 'tfc:plains')).toBe(false); // wrong climate
    expect(raw(null, null, null, 25, 400, 'tfc:plains')).toBe(false); // rock unavailable
  });
});

/** Generator stub whose rocks/climate/biome calls are spied so tests can assert exactly how many
 * times the sample-cache path reaches into the generator. */
function makeCountingGenerator(
  rocks: RockStack | null,
  climate: ClimateSample,
  biome: string | null,
): WorldGenerator & { calls: { rocks: number; climate: number; biome: number } } {
  const calls = { rocks: 0, climate: 0, biome: 0 };
  const profile: ProfileDescriptor = {
    id: 'tfg',
    label: 'stub',
    mcVersion: 'n/a',
    dimensions: ['overworld'],
    layers: ['filter'],
  };
  return {
    profile,
    seed: 0n,
    dimension: 'overworld' as DimensionId,
    calls,
    climate: () => {
      calls.climate++;
      return climate;
    },
    rocks: () => {
      calls.rocks++;
      return rocks;
    },
    biome: () => {
      calls.biome++;
      return biome;
    },
    surfaceY: () => null,
    probe: (): Probe => {
      throw new Error('not needed by this test');
    },
    features: (_box: BlockBox): FeatureSet => ({ deposits: [], structures: [] }),
  };
}

describe('filterLayer.render with a sample-cache context -- the big win', () => {
  const SIZE = 4;

  it('samples the generator on the first render of a tile, and NOT again after only the filter changes', () => {
    const generator = makeCountingGenerator(GRANITE_TOP, WARM_WET, 'tfc:plains');
    const cache = new TileSampleCache();
    const context = {
      cache,
      seed: '1',
      profile: 'tfc-1.20' as const,
      dimension: 'overworld' as const,
      settings: {},
      zoom: 0,
      tileX: 0,
      tileZ: 0,
    };

    const filterA: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };
    const outA = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(generator, outA, 0, 0, SIZE, 1, {}, filterA, context);
    expect(generator.calls).toEqual({ rocks: SIZE * SIZE, climate: SIZE * SIZE, biome: SIZE * SIZE });

    // A different filter threshold, same tile: TileManager.invalidateLayer('filter') would have
    // dropped only the bitmap, not this sample cache -- render again for the same tile identity.
    const filterB: MapFilter = { ...DEFAULT_MAP_FILTER, tempMin: 30 }; // now nothing matches
    const outB = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(generator, outB, 0, 0, SIZE, 1, {}, filterB, context);

    // No new generator calls -- the second render was served entirely from cached samples.
    expect(generator.calls).toEqual({ rocks: SIZE * SIZE, climate: SIZE * SIZE, biome: SIZE * SIZE });

    // And the two renders still produce different pixels, proving the second filter was actually
    // re-evaluated (not just replaying the first result).
    expect(outA[3]).toBe(0); // filterA matches granite -> transparent
    expect(outB[3]).toBe(255); // filterB (tempMin 30) rejects 25C -> dimmed
  });

  it('a different tile identity is sampled fresh, independent of an already-cached tile', () => {
    const generator = makeCountingGenerator(GRANITE_TOP, WARM_WET, 'tfc:plains');
    const cache = new TileSampleCache();
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };

    filterLayer.render(generator, new Uint8ClampedArray(SIZE * SIZE * 4), 0, 0, SIZE, 1, {}, filter, {
      cache, seed: '1', profile: 'tfc-1.20', dimension: 'overworld', settings: {}, zoom: 0, tileX: 0, tileZ: 0,
    });
    expect(generator.calls.rocks).toBe(SIZE * SIZE);

    filterLayer.render(generator, new Uint8ClampedArray(SIZE * SIZE * 4), 256, 0, SIZE, 1, {}, filter, {
      cache, seed: '1', profile: 'tfc-1.20', dimension: 'overworld', settings: {}, zoom: 0, tileX: 1, tileZ: 0,
    });
    expect(generator.calls.rocks).toBe(2 * SIZE * SIZE); // second tile, sampled fresh
  });

  it('without a sample-cache context, falls back to sampling the generator on every render (unchanged behaviour)', () => {
    const generator = makeCountingGenerator(GRANITE_TOP, WARM_WET, 'tfc:plains');
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };
    filterLayer.render(generator, new Uint8ClampedArray(SIZE * SIZE * 4), 0, 0, SIZE, 1, {}, filter);
    filterLayer.render(generator, new Uint8ClampedArray(SIZE * SIZE * 4), 0, 0, SIZE, 1, {}, filter);
    expect(generator.calls.rocks).toBe(2 * SIZE * SIZE); // sampled both times, no cache in play
  });

  it('produces identical dimming to the no-cache path for the same generator and filter', () => {
    const withCache = makeCountingGenerator(SHALE_TOP, WARM_WET, 'tfc:hills');
    const withoutCache = makeCountingGenerator(SHALE_TOP, WARM_WET, 'tfc:hills');
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'], biomes: ['tfc:plains'] };

    const outWithCache = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(withCache, outWithCache, 0, 0, SIZE, 1, { 'map-bg': 0x112233 }, filter, {
      cache: new TileSampleCache(), seed: '1', profile: 'tfc-1.20', dimension: 'overworld', settings: {}, zoom: 0, tileX: 0, tileZ: 0,
    });
    const outWithoutCache = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(withoutCache, outWithoutCache, 0, 0, SIZE, 1, { 'map-bg': 0x112233 }, filter);

    expect(outWithCache).toEqual(outWithoutCache);
  });
});

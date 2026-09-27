import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_FILTER,
  compileFilterMatcher,
  isFilterActive,
  matchesFilter,
  selectAllIds,
  selectNoneIds,
} from '../../src/layers/filter';
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
const COLD_DRY: ClimateSample = { temperature: -10, rainfall: 50 };

describe('isFilterActive', () => {
  it('is false for the all-default filter', () => {
    expect(isFilterActive(DEFAULT_MAP_FILTER)).toBe(false);
  });

  it('is true once any single criterion is set', () => {
    expect(isFilterActive({ ...DEFAULT_MAP_FILTER, rocks: ['granite'] })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MAP_FILTER, tempMin: 0 })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MAP_FILTER, tempMax: 0 })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MAP_FILTER, rainMin: 0 })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MAP_FILTER, rainMax: 0 })).toBe(true);
  });
});

describe('matchesFilter -- an empty filter matches everything', () => {
  it('matches any rock stack and any climate when no criteria are set', () => {
    expect(matchesFilter(DEFAULT_MAP_FILTER, GRANITE_TOP, WARM_WET)).toBe(true);
    expect(matchesFilter(DEFAULT_MAP_FILTER, SHALE_TOP, COLD_DRY)).toBe(true);
  });

  it('matches even when rock and climate are both unavailable', () => {
    expect(matchesFilter(DEFAULT_MAP_FILTER, null, WARM_WET)).toBe(true);
  });
});

describe('matchesFilter -- rock criterion', () => {
  it("'top' mode matches only when the top layer is selected", () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'], rockMatch: 'top' };
    expect(matchesFilter(filter, GRANITE_TOP, null)).toBe(true);
    // granite is present in SHALE_TOP's stack, but only at the bottom -- 'top' mode rejects it.
    expect(matchesFilter(filter, SHALE_TOP, null)).toBe(false);
  });

  it("'any' mode matches a selected rock anywhere in the stack", () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'], rockMatch: 'any' };
    expect(matchesFilter(filter, GRANITE_TOP, null)).toBe(true);
    expect(matchesFilter(filter, SHALE_TOP, null)).toBe(true); // granite is SHALE_TOP.bottom
  });

  it('rejects a rock stack containing none of the selected rocks', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['basalt', 'schist'], rockMatch: 'any' };
    expect(matchesFilter(filter, GRANITE_TOP, null)).toBe(false);
    expect(matchesFilter(filter, SHALE_TOP, null)).toBe(false);
  });

  it('rejects when rock data is unavailable rather than guessing', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };
    expect(matchesFilter(filter, null, null)).toBe(false);
  });
});

describe('matchesFilter -- temperature criterion', () => {
  it('honours min alone, max alone, and both together', () => {
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, tempMin: 0 }, null, WARM_WET)).toBe(true);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, tempMin: 0 }, null, COLD_DRY)).toBe(false);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, tempMax: 0 }, null, COLD_DRY)).toBe(true);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, tempMax: 0 }, null, WARM_WET)).toBe(false);
    const range: MapFilter = { ...DEFAULT_MAP_FILTER, tempMin: 20, tempMax: 30 };
    expect(matchesFilter(range, null, WARM_WET)).toBe(true);
    expect(matchesFilter(range, null, COLD_DRY)).toBe(false);
  });

  it('rejects when climate is unavailable rather than guessing', () => {
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, tempMin: 0 }, null, null)).toBe(false);
  });

  it('is inclusive at the exact boundary', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, tempMin: 25, tempMax: 25 };
    expect(matchesFilter(filter, null, WARM_WET)).toBe(true);
  });
});

describe('matchesFilter -- rainfall criterion', () => {
  it('honours min alone, max alone, and both together', () => {
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, rainMin: 200 }, null, WARM_WET)).toBe(true);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, rainMin: 200 }, null, COLD_DRY)).toBe(false);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, rainMax: 100 }, null, COLD_DRY)).toBe(true);
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, rainMax: 100 }, null, WARM_WET)).toBe(false);
  });

  it('rejects when climate is unavailable rather than guessing', () => {
    expect(matchesFilter({ ...DEFAULT_MAP_FILTER, rainMax: 100 }, null, null)).toBe(false);
  });
});

describe('matchesFilter -- combinations are AND, not OR', () => {
  it('requires every set criterion to pass', () => {
    const filter: MapFilter = {
      rocks: ['granite'],
      rockMatch: 'top',
      biomes: [],
      tempMin: 20,
      tempMax: null,
      rainMin: 300,
      rainMax: null,
    };
    // Right rock, right climate.
    expect(matchesFilter(filter, GRANITE_TOP, WARM_WET)).toBe(true);
    // Right rock, wrong climate.
    expect(matchesFilter(filter, GRANITE_TOP, COLD_DRY)).toBe(false);
    // Wrong rock, right climate.
    expect(matchesFilter(filter, SHALE_TOP, WARM_WET)).toBe(false);
    // Wrong on both counts.
    expect(matchesFilter(filter, SHALE_TOP, COLD_DRY)).toBe(false);
  });

  it('also requires the biome criterion to pass, alongside rock and climate', () => {
    const filter: MapFilter = {
      rocks: ['granite'],
      rockMatch: 'top',
      biomes: ['tfc:plains'],
      tempMin: null,
      tempMax: null,
      rainMin: null,
      rainMax: null,
    };
    // Right rock, right biome.
    expect(matchesFilter(filter, GRANITE_TOP, null, 'tfc:plains')).toBe(true);
    // Right rock, wrong biome.
    expect(matchesFilter(filter, GRANITE_TOP, null, 'tfc:hills')).toBe(false);
    // Wrong rock, right biome.
    expect(matchesFilter(filter, SHALE_TOP, null, 'tfc:plains')).toBe(false);
  });
});

describe('matchesFilter -- biome criterion', () => {
  it('matches a position whose biome is in the selected set', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains', 'tfc:hills'] };
    expect(matchesFilter(filter, null, null, 'tfc:plains')).toBe(true);
    expect(matchesFilter(filter, null, null, 'tfc:hills')).toBe(true);
  });

  it('rejects a biome not in the selected set', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains'] };
    expect(matchesFilter(filter, null, null, 'tfc:badlands')).toBe(false);
  });

  it('rejects when biome data is unavailable rather than guessing', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains'] };
    expect(matchesFilter(filter, null, null, null)).toBe(false);
  });

  it('is inert (matches everything) when no biome is selected, same as an omitted biome argument', () => {
    expect(matchesFilter(DEFAULT_MAP_FILTER, null, null, 'tfc:plains')).toBe(true);
    expect(matchesFilter(DEFAULT_MAP_FILTER, null, null, null)).toBe(true);
    expect(matchesFilter(DEFAULT_MAP_FILTER, null, null)).toBe(true);
  });
});

describe('compileFilterMatcher', () => {
  it('is behaviourally identical to matchesFilter for the same inputs', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'], rockMatch: 'any', tempMin: 0 };
    const compiled = compileFilterMatcher(filter);
    for (const [rocks, climate] of [
      [GRANITE_TOP, WARM_WET],
      [GRANITE_TOP, COLD_DRY],
      [SHALE_TOP, WARM_WET],
      [null, WARM_WET],
    ] as const) {
      expect(compiled(rocks, climate)).toBe(matchesFilter(filter, rocks, climate));
    }
  });

  it('also compiles the biome criterion identically to matchesFilter', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains'] };
    const compiled = compileFilterMatcher(filter);
    for (const biome of ['tfc:plains', 'tfc:hills', null] as const) {
      expect(compiled(null, null, biome)).toBe(matchesFilter(filter, null, null, biome));
    }
  });
});

describe('selectAllIds / selectNoneIds -- backing the filter panel select-all/none buttons', () => {
  it('selectAllIds returns every given id, deduplicated', () => {
    expect(selectAllIds(['granite', 'basalt', 'granite'])).toEqual(['granite', 'basalt']);
  });

  it('selectAllIds on an empty list returns an empty selection', () => {
    expect(selectAllIds([])).toEqual([]);
  });

  it('selectNoneIds always returns an empty selection', () => {
    expect(selectNoneIds()).toEqual([]);
  });
});

/** Minimal WorldGenerator stub: constant rock/climate everywhere, just enough to drive
 * `filterLayer.render`'s per-pixel loop without a real generator. */
function makeStubGenerator(
  rocks: RockStack | null,
  climate: ClimateSample,
  biome: string | null = null,
): WorldGenerator {
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
    climate: () => climate,
    rocks: () => rocks,
    biome: () => biome,
    surfaceY: () => null,
    probe: (): Probe => {
      throw new Error('not needed by this test');
    },
    features: (_box: BlockBox): FeatureSet => ({ deposits: [], structures: [] }),
  };
}

describe('filterLayer.render', () => {
  const SIZE = 4;

  function renderTile(generator: WorldGenerator, filter: MapFilter | undefined): Uint8ClampedArray {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(generator, out, 0, 0, SIZE, 1, {}, filter);
    return out;
  }

  it('paints a fully transparent tile when the filter is empty -- dims nothing', () => {
    const out = renderTile(makeStubGenerator(GRANITE_TOP, WARM_WET), DEFAULT_MAP_FILTER);
    expect(out.every((byte) => byte === 0)).toBe(true);
  });

  it('paints a fully transparent tile when no filter is passed at all', () => {
    const out = renderTile(makeStubGenerator(GRANITE_TOP, WARM_WET), undefined);
    expect(out.every((byte) => byte === 0)).toBe(true);
  });

  it('leaves matching positions transparent and bakes full alpha onto non-matching ones', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };
    const matching = renderTile(makeStubGenerator(GRANITE_TOP, WARM_WET), filter);
    for (let i = 0; i < matching.length; i += 4) {
      expect(matching[i + 3]).toBe(0);
    }
    const nonMatching = renderTile(makeStubGenerator(SHALE_TOP, WARM_WET), filter);
    for (let i = 0; i < nonMatching.length; i += 4) {
      expect(nonMatching[i + 3]).toBe(255);
    }
  });

  it('dims using the map-bg palette token, never a hardcoded colour', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite'] };
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    filterLayer.render(makeStubGenerator(SHALE_TOP, WARM_WET), out, 0, 0, SIZE, 1, { 'map-bg': 0x112233 }, filter);
    expect(out[0]).toBe(0x11);
    expect(out[1]).toBe(0x22);
    expect(out[2]).toBe(0x33);
    expect(out[3]).toBe(255);
  });

  it('also honours the biome criterion, sampling generator.biome the same way it samples rocks/climate', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains'] };
    const matching = renderTile(makeStubGenerator(null, WARM_WET, 'tfc:plains'), filter);
    for (let i = 0; i < matching.length; i += 4) {
      expect(matching[i + 3]).toBe(0);
    }
    const nonMatching = renderTile(makeStubGenerator(null, WARM_WET, 'tfc:hills'), filter);
    for (let i = 0; i < nonMatching.length; i += 4) {
      expect(nonMatching[i + 3]).toBe(255);
    }
  });
});

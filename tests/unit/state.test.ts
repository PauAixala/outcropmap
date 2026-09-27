import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_STATE,
  createMapStore,
  createStore,
  compactIdList,
  decodeMapStateFromHash,
  encodeMapStateToHash,
  expandIdList,
} from '../../src/app/state';
import type { MapState } from '../../src/app/state';
import { DEFAULT_MAP_FILTER } from '../../src/layers/filter';
import type { MapFilter } from '../../src/layers/filter';

describe('MapState URL hash round trip', () => {
  it('recovers an encoded state exactly (integer camera coords)', () => {
    const state: MapState = {
      seed: 123456789012345n,
      profile: 'tfg',
      dimension: 'nether',
      centerX: 1024,
      centerZ: -2048,
      zoom: -2,
      enabledLayers: ['biome', 'terrain', 'grid'],
      layerOpacity: {},
      settings: {},
      filter: DEFAULT_MAP_FILTER,
    };
    const hash = encodeMapStateToHash(state);
    expect(hash.startsWith('#')).toBe(true);
    const decoded = decodeMapStateFromHash(hash);
    expect(decoded).toEqual(state);
  });

  it('round-trips per-layer opacity overrides alongside enabled state', () => {
    const state: MapState = {
      seed: 42n,
      profile: 'tfg',
      dimension: 'overworld',
      centerX: 0,
      centerZ: 0,
      zoom: 0,
      enabledLayers: ['biome', 'rock', 'temperature', 'grid'],
      layerOpacity: { biome: 1, rock: 0.8, temperature: 0.55 },
      settings: {},
      filter: DEFAULT_MAP_FILTER,
    };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash(state));
    expect(decoded).toEqual(state);
  });

  it('clamps out-of-range opacity values and drops unknown layer ids on decode', () => {
    const decoded = decodeMapStateFromHash('#opacity.biome=4&opacity.rock=-1&opacity.not-a-layer=0.5&opacity.temperature=0.3');
    expect(decoded.layerOpacity).toEqual({ biome: 1, rock: 0, temperature: 0.3 });
  });

  it('round-trips a negative bigint seed', () => {
    const state: MapState = { ...DEFAULT_MAP_STATE, seed: -42n };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash(state));
    expect(decoded.seed).toBe(-42n);
  });

  it('ignores unknown or malformed fields instead of throwing', () => {
    const decoded = decodeMapStateFromHash('#profile=not-a-real-profile&zoom=abc&x=nope&layers=nonsense,biome');
    expect(decoded.profile).toBeUndefined();
    expect(decoded.zoom).toBeUndefined();
    expect(decoded.centerX).toBeUndefined();
    expect(decoded.enabledLayers).toEqual(['biome']);
  });

  it('returns an empty patch for an empty hash', () => {
    expect(decodeMapStateFromHash('')).toEqual({});
    expect(decodeMapStateFromHash('#')).toEqual({});
  });

  it('layers over DEFAULT_MAP_STATE to produce a complete state', () => {
    const merged: MapState = { ...DEFAULT_MAP_STATE, ...decodeMapStateFromHash('#seed=7') };
    expect(merged.seed).toBe(7n);
    expect(merged.profile).toBe(DEFAULT_MAP_STATE.profile);
  });
});

describe('MapFilter permalink round trip', () => {
  it('round-trips a filter with every field set, including biomes', () => {
    const filter: MapFilter = {
      rocks: ['granite', 'basalt', 'schist'],
      rockMatch: 'any',
      biomes: ['tfc:plains', 'tfc:hills', 'tfc:badlands'],
      tempMin: -5,
      tempMax: 22.5,
      rainMin: 100,
      rainMax: 400,
    };
    const state: MapState = { ...DEFAULT_MAP_STATE, filter };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash(state));
    expect(decoded.filter).toEqual(filter);
  });

  it('round-trips a filter with only biomes set, leaving every other field unset', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, biomes: ['tfc:plains'] };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash({ ...DEFAULT_MAP_STATE, filter }));
    expect(decoded.filter).toEqual(filter);
  });

  it('round-trips a filter with nothing set (the default)', () => {
    const state: MapState = { ...DEFAULT_MAP_STATE, filter: DEFAULT_MAP_FILTER };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash(state));
    expect(decoded.filter).toEqual(DEFAULT_MAP_FILTER);
  });

  it('round-trips only a rock match mode change with no other criteria', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, rockMatch: 'any' };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash({ ...DEFAULT_MAP_STATE, filter }));
    expect(decoded.filter).toEqual(filter);
  });

  it('round-trips only a temperature range, leaving rocks and rainfall unset', () => {
    const filter: MapFilter = { ...DEFAULT_MAP_FILTER, tempMin: 10, tempMax: 20 };
    const decoded = decodeMapStateFromHash(encodeMapStateToHash({ ...DEFAULT_MAP_STATE, filter }));
    expect(decoded.filter).toEqual(filter);
  });

  it('drops a malformed numeric filter field instead of throwing', () => {
    const decoded = decodeMapStateFromHash('#filter.tempMin=not-a-number&filter.tempMax=12');
    expect(decoded.filter).toEqual({ ...DEFAULT_MAP_FILTER, tempMax: 12 });
  });

  it('an empty hash still defaults to a fully-unset filter once layered over DEFAULT_MAP_STATE', () => {
    const merged: MapState = { ...DEFAULT_MAP_STATE, ...decodeMapStateFromHash('#seed=1') };
    expect(merged.filter).toEqual(DEFAULT_MAP_FILTER);
  });
});

describe('layer combinations and opacity (ADR 0007)', () => {
  it('allows any combination of raster layers enabled together -- no single-base exclusivity', () => {
    const store = createMapStore({
      ...DEFAULT_MAP_STATE,
      profile: 'tfc-1.20',
      enabledLayers: ['biome', 'rock', 'temperature', 'grid'],
    });
    // All four survive normalisation: two "base" layers and an overlay stacked together is
    // exactly what this slice exists to allow.
    expect(new Set(store.getState().enabledLayers)).toEqual(new Set(['biome', 'rock', 'temperature', 'grid']));
  });

  it('clamps out-of-range layer opacity on construction and on setState', () => {
    const store = createMapStore({
      ...DEFAULT_MAP_STATE,
      layerOpacity: { biome: 5, rock: -3, temperature: 0.4 },
    });
    expect(store.getState().layerOpacity).toEqual({ biome: 1, rock: 0, temperature: 0.4 });

    store.setState({ layerOpacity: { ...store.getState().layerOpacity, rainfall: 2 } });
    expect(store.getState().layerOpacity.rainfall).toBe(1);
  });
});

describe('createStore', () => {
  it('notifies subscribers with the merged state on setState', () => {
    const store = createStore({ a: 1, b: 2 });
    const seen: { a: number; b: number }[] = [];
    store.subscribe((s) => seen.push(s));
    store.setState({ b: 5 });
    expect(seen).toEqual([{ a: 1, b: 5 }]);
    expect(store.getState()).toEqual({ a: 1, b: 5 });
  });

  it('unsubscribe stops further notifications', () => {
    const store = createStore({ a: 1 });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });
    store.setState({ a: 2 });
    unsubscribe();
    store.setState({ a: 3 });
    expect(calls).toBe(1);
  });
});

describe('short links', () => {
  it('writes a shared id prefix once and reads it back exactly', () => {
    const ids = ['tfg:earth/plains', 'tfg:earth/hills', 'tfg:earth/deep_ocean', 'tfc:plains', 'tfc:hills'];
    const text = compactIdList(ids);
    expect(text).toBe('tfg:earth/plains,hills,deep_ocean,tfc:plains,hills');
    expect(expandIdList(text)).toEqual(ids);
  });

  it('writes un-namespaced ids in full, and still reads old full-id links', () => {
    expect(compactIdList(['andesite', 'basalt'])).toBe('andesite,basalt');
    expect(expandIdList('tfg:earth/plains,tfg:earth/hills')).toEqual(['tfg:earth/plains', 'tfg:earth/hills']);
  });

  it('leaves defaults out and does not escape : / , in the fragment', () => {
    const hash = encodeMapStateToHash({
      ...DEFAULT_MAP_STATE,
      filter: { ...DEFAULT_MAP_FILTER, biomes: ['tfg:earth/plains', 'tfg:earth/hills'] },
    });
    expect(hash).not.toContain('%3A');
    expect(hash).not.toContain('layers=');
    expect(hash).not.toContain('filter.rocks');
    expect(hash).toContain('filter.biomes=tfg:earth/plains,hills');
    expect(decodeMapStateFromHash(hash).filter?.biomes).toEqual(['tfg:earth/plains', 'tfg:earth/hills']);
  });
});

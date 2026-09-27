/**
 * Application state shared by the shell and the panels: a tiny observable store (ADR 0003).
 * Serialised into the URL hash for permalinks and into storage for the theme preference.
 */
import { DIMENSION_IDS, LAYER_IDS, PROFILE_IDS } from '@worldgen/api/types';
import type { DimensionId, GeneratorSettings, LayerId, ProfileId } from '@worldgen/api/types';
import { listProfiles } from '@worldgen/registry';
import { normalizeSettings } from '@worldgen/api/settings';
import { DEFAULT_MAP_FILTER } from '@layers/filter';
import type { MapFilter, RockMatchMode } from '@layers/filter';
import type { Waypoint } from './waypoints';

export interface MapState {
  seed: bigint;
  profile: ProfileId;
  dimension: DimensionId;
  centerX: number;
  centerZ: number;
  zoom: number;
  enabledLayers: LayerId[];
  /** Per-layer opacity overrides (0..1), sparse -- a layer absent here paints at its own
   * defaultOpacity (docs/adr/0007-layer-compositing.md, `resolveLayerOpacity`). */
  layerOpacity: Partial<Record<LayerId, number>>;
  settings: GeneratorSettings;
  /** Highlights matching terrain by dimming everything else -- see `@layers/filter` and the
   * `filter` raster layer (docs/adr/0007-layer-compositing.md). An all-default filter matches
   * everything and therefore dims nothing (`isFilterActive`). */
  filter: MapFilter;
  /** User-placed markers for this world (docs/PLAN.md 10b, `@app/waypoints`). Optional in the
   * type so pre-existing state literals keep compiling; after `normalizeMapState` it is always an
   * array. Deliberately not part of the URL hash -- a large set would bloat permalinks.
   */
  waypoints?: readonly Waypoint[];
  /** Which ore/mineral ids the `minerals` layer draws markers for -- ids match `DepositFeature.ore`
   * (e.g. 'tfc:kaolin'), the same ids the filter panel's ore checklist offers (`en.oreNames`'s
   * keys, `tfc:` prefixed). Empty means "show every deposit this port can place" -- not "show
   * none" -- so a fresh session (no criterion chosen yet) already shows markers. Optional in the
   * type for the same pre-existing-literal reason as `waypoints`; after `normalizeMapState` it is
   * always an array.
   */
  oreFilter?: readonly string[];
  /** Which structure sets the `structures` layer draws, by set id. Empty means every set — the
   * same convention as `oreFilter`. Not in the URL hash, for the same reason. */
  structureFilter?: readonly string[];
  /**
   * Hide ore markers whose measured accuracy is below this, from 0 to 1. `0` draws everything.
   *
   * Accuracy is per marker, not per vein type, and mostly a question of depth — see
   * `markerConfidence`. A player who walks to a marker and finds nothing stops trusting the map, so
   * this exists to let them trade coverage for certainty. Not in the URL hash: it is a preference,
   * not a place.
   */
  minMarkerAccuracy?: number;
}

export const DEFAULT_MAP_STATE: MapState = {
  seed: 0n,
  // The developer region overlay stays opt-in; the initial view shows the biome map.
  profile: 'tfc-1.20',
  dimension: 'overworld',
  centerX: 0,
  centerZ: 0,
  zoom: 4,
  // `filter` is always in the default view: an unset filter renders fully transparent (see
  // `filterLayer.render`), so having it enabled from boot costs nothing until Pau actually sets a
  // criterion, at which point the dim just appears without an extra checkbox to remember.
  enabledLayers: ['biome', 'hillshade', 'grid', 'filter'],
  layerOpacity: {},
  settings: {},
  filter: DEFAULT_MAP_FILTER,
  waypoints: [],
  oreFilter: [],
  structureFilter: [],
  /**
   * Ninety per cent, not zero. Measured over 4 733 markers of a real world, this floor keeps 49% of
   * them and **99.9% of what it keeps is backed by real ore** (2 319 of 2 322) against 90.5% with no
   * floor. Half the markers buy the map the one property it cannot do without: walk to one and the
   * ore is there. The control in the ore filter lowers it for anyone who would rather see
   * everything.
   */
  minMarkerAccuracy: 0.9,
};

export interface Store<T> {
  getState(): T;
  setState(patch: Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

/** Validate restored views and profile transitions against the registered capabilities. */
export function normalizeMapState(state: MapState): MapState {
  const profiles = listProfiles();
  const profile =
    profiles.find((p) => p.id === state.profile) ??
    profiles.find((p) => p.id === DEFAULT_MAP_STATE.profile) ??
    profiles[0];
  if (!profile) throw new Error('No world generation profiles registered');
  const layers = [...new Set(state.enabledLayers.filter((id) => profile.layers.includes(id)))];
  if (
    state.enabledLayers.some((id) => !profile.layers.includes(id)) &&
    !layers.some((id) => id !== 'grid')
  ) {
    const raster = profile.layers.find((id) => id !== 'grid');
    if (raster) layers.unshift(raster);
  }
  return {
    ...state,
    profile: profile.id,
    dimension: profile.dimensions.includes(state.dimension)
      ? state.dimension
      : (profile.dimensions[0] ?? 'overworld'),
    enabledLayers: layers,
    layerOpacity: normalizeLayerOpacity(state.layerOpacity),
    settings: normalizeSettings(profile, state.settings),
    filter: normalizeMapFilter(state.filter),
    waypoints: state.waypoints ?? [],
    oreFilter: normalizeIdList(state.oreFilter ?? []),
    structureFilter: normalizeIdList(state.structureFilter ?? []),
  };
}

/**
 * Defensive against hand-crafted permalinks and any caller that bypasses
 * `decodeMapStateFromHash`'s own clamping -- same spirit as `normalizeLayerOpacity`. Rock ids are
 * *not* checked against a profile's known rocks here (unlike `enabledLayers` against
 * `profile.layers`): a profile like `tfg` shares TFC's rock ids without necessarily re-declaring its
 * own palette, so "known to this profile" is not a reliable membership test the way it is for
 * layers or settings.
 */
function normalizeIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
    : [];
}

function normalizeMapFilter(filter: MapFilter | undefined): MapFilter {
  const f = filter ?? DEFAULT_MAP_FILTER;
  const rocks = normalizeIdList(f.rocks);
  const rockMatch: RockMatchMode = f.rockMatch === 'any' ? 'any' : 'top';
  // Biome ids are not checked against a profile's known biomes either, for the same reason rocks
  // aren't (see this function's doc comment above): "known to this profile" is not a reliable
  // membership test across profiles that may share ids without re-declaring a palette.
  const biomes = normalizeIdList(f.biomes);
  const nullableNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    rocks,
    rockMatch,
    biomes,
    tempMin: nullableNumber(f.tempMin),
    tempMax: nullableNumber(f.tempMax),
    rainMin: nullableNumber(f.rainMin),
    rainMax: nullableNumber(f.rainMax),
  };
}

/** Drops unknown layer ids and non-finite values, and clamps the rest into [0, 1]. Defensive
 * against both hand-crafted permalinks and any future caller that bypasses decodeMapStateFromHash's
 * own clamping. */
function normalizeLayerOpacity(
  opacity: Partial<Record<LayerId, number>>,
): Partial<Record<LayerId, number>> {
  const result: Partial<Record<LayerId, number>> = {};
  for (const [id, value] of Object.entries(opacity)) {
    if (!isOneOf(LAYER_IDS, id) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    result[id] = Math.min(1, Math.max(0, value));
  }
  return result;
}

export function createMapStore(initial: MapState): Store<MapState> {
  const store = createStore(normalizeMapState(initial));
  return {
    ...store,
    setState(patch) {
      const previous = store.getState();
      const profileChanged = patch.profile !== undefined && patch.profile !== previous.profile;
      const settings = profileChanged
        ? (patch.settings ?? {})
        : (patch.settings ?? previous.settings);
      // IDs from another profile can silently hide every biome or mineral in the new one.
      const filter =
        patch.filter ??
        (profileChanged ? { ...previous.filter, biomes: [], rocks: [] } : previous.filter);
      const oreFilter = patch.oreFilter ?? (profileChanged ? [] : (previous.oreFilter ?? []));
      // Set ids differ between profiles, so a selection does not carry across a profile change.
      const structureFilter =
        patch.structureFilter ?? (profileChanged ? [] : (previous.structureFilter ?? []));
      store.setState(normalizeMapState({ ...previous, ...patch, settings, filter, oreFilter, structureFilter }));
    },
  };
}

export function mapSessionKey(state: MapState): string {
  const settings = Object.entries(state.settings).sort(([a], [b]) => a.localeCompare(b));
  return `${state.seed}|${state.profile}|${state.dimension}|${JSON.stringify(settings)}`;
}

/** A minimal observable store: shallow-merges patches and notifies subscribers synchronously. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();
  return {
    getState(): T {
      return state;
    },
    setState(patch: Partial<T>): void {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener: (state: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isOneOf<T extends string>(ids: readonly T[], value: string): value is T {
  return (ids as readonly string[]).includes(value);
}

function encodeLayers(layers: readonly LayerId[]): string {
  return layers.join(',');
}

function decodeLayers(text: string): LayerId[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is LayerId => isOneOf(LAYER_IDS, s));
}

/** Unlike `decodeLayers`, rock/biome ids are not checked against a fixed enum -- see
 * `normalizeMapFilter`'s doc comment for why. Just splits, trims and drops empty entries so
 * `''` (an explicitly-empty `filter.rocks`/`filter.biomes` param) decodes to `[]`, not `['']`. */
function decodeIdList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Serialises the shareable parts of MapState into a URL hash, e.g. "#seed=1&profile=debug&...". */
export function encodeMapStateToHash(state: MapState): string {
  const params = new URLSearchParams();
  params.set('seed', state.seed.toString());
  params.set('profile', state.profile);
  params.set('dim', state.dimension);
  params.set('x', String(Math.round(state.centerX)));
  params.set('z', String(Math.round(state.centerZ)));
  params.set('zoom', String(Math.round(state.zoom)));
  // Defaults are left out: a link is copied, pasted and read, and every omitted key decodes back
  // to exactly the default it stood for.
  if (encodeLayers(state.enabledLayers) !== encodeLayers(DEFAULT_MAP_STATE.enabledLayers)) {
    params.set('layers', encodeLayers(state.enabledLayers));
  }
  for (const [id, value] of Object.entries(state.layerOpacity))
    params.set(`opacity.${id}`, String(value));
  for (const [key, value] of Object.entries(state.settings))
    params.set(`setting.${key}`, String(value));
  // Omitted when empty or default: the decoder always assigns a whole filter, so a missing key
  // already means "nothing set".
  if (state.filter.rocks.length > 0) params.set('filter.rocks', state.filter.rocks.join(','));
  if (state.filter.rockMatch !== 'top') params.set('filter.rockMatch', state.filter.rockMatch);
  if (state.filter.biomes.length > 0) {
    params.set('filter.biomes', compactIdList(state.filter.biomes));
  }
  if (state.filter.tempMin !== null) params.set('filter.tempMin', String(state.filter.tempMin));
  if (state.filter.tempMax !== null) params.set('filter.tempMax', String(state.filter.tempMax));
  if (state.filter.rainMin !== null) params.set('filter.rainMin', String(state.filter.rainMin));
  if (state.filter.rainMax !== null) params.set('filter.rainMax', String(state.filter.rainMax));
  // `:`, `/` and `,` are legal as-is in a fragment. URLSearchParams escapes them anyway, which
  // tripled the length of every `tfg:earth/...` id in a biome selection.
  return `#${params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%2C/gi, ',')}`;
}

/**
 * Shortens a list of namespaced ids by writing their shared prefix once: `tfg:earth/plains,hills`
 * means `tfg:earth/plains,tfg:earth/hills`. An entry is only shortened when what is left has no
 * `:` or `/` of its own, so `expandIdList` can always tell a short entry from a full one. Lists
 * with an un-namespaced id are written in full, since those could not be told apart.
 */
export function compactIdList(ids: readonly string[]): string {
  if (!ids.every((id) => id.includes(':'))) return ids.join(',');
  let prefix = '';
  return ids
    .map((id) => {
      const rest = prefix !== '' && id.startsWith(prefix) ? id.slice(prefix.length) : null;
      if (rest !== null && rest !== '' && !rest.includes(':') && !rest.includes('/')) return rest;
      prefix = id.slice(0, Math.max(id.lastIndexOf('/'), id.indexOf(':')) + 1);
      return id;
    })
    .join(',');
}

/** Inverse of `compactIdList`; a list of full ids (older links) passes through unchanged. */
export function expandIdList(text: string): string[] {
  let prefix = '';
  return decodeIdList(text).map((entry) => {
    if (entry.includes(':')) {
      prefix = entry.slice(0, Math.max(entry.lastIndexOf('/'), entry.indexOf(':')) + 1);
      return entry;
    }
    return prefix + entry;
  });
}

/**
 * Parses a URL hash (with or without the leading '#') back into a partial MapState. Anything
 * missing or invalid is simply omitted, so the caller can layer this over sane defaults.
 */
export function decodeMapStateFromHash(hash: string): Partial<MapState> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const result: Partial<MapState> = {};
  if (!raw) return result;

  const params = new URLSearchParams(raw);

  const seedRaw = params.get('seed');
  if (seedRaw !== null && /^-?\d+$/.test(seedRaw)) {
    try {
      result.seed = BigInt(seedRaw);
    } catch {
      // malformed — leave seed at its default
    }
  }

  const profileRaw = params.get('profile');
  if (profileRaw !== null && isOneOf(PROFILE_IDS, profileRaw)) {
    result.profile = profileRaw;
  }

  const dimRaw = params.get('dim');
  if (dimRaw !== null && isOneOf(DIMENSION_IDS, dimRaw)) {
    result.dimension = dimRaw;
  }

  const x = params.get('x');
  if (x !== null && Number.isFinite(Number(x))) result.centerX = Number(x);

  const z = params.get('z');
  if (z !== null && Number.isFinite(Number(z))) result.centerZ = Number(z);

  const zoom = params.get('zoom');
  if (zoom !== null && Number.isInteger(Number(zoom))) result.zoom = Number(zoom);

  const layers = params.get('layers');
  if (layers !== null) {
    const decoded = decodeLayers(layers);
    if (decoded.length > 0 || layers === '') result.enabledLayers = decoded;
  }

  const layerOpacity: Partial<Record<LayerId, number>> = {};
  for (const [key, value] of params) {
    if (!key.startsWith('opacity.')) continue;
    const id = key.slice(8);
    const num = Number(value);
    if (isOneOf(LAYER_IDS, id) && Number.isFinite(num)) {
      layerOpacity[id] = Math.min(1, Math.max(0, num));
    }
  }
  // Always assign, so an encoded state round-trips exactly even with no overrides present.
  result.layerOpacity = layerOpacity;

  const settings: Record<string, number> = {};
  for (const [key, value] of params) {
    if (key.startsWith('setting.') && value.trim() !== '' && Number.isFinite(Number(value))) {
      settings[key.slice(8)] = Number(value);
    }
  }
  // Always assign, so an encoded state round-trips exactly even with no settings present.
  result.settings = settings;

  // Always assign (mirrors layerOpacity/settings above), so a hash with no filter params at all
  // decodes to the same all-default MapFilter that encodeMapStateToHash would have produced for
  // one, rather than leaving `filter` undefined.
  const rockMatchRaw = params.get('filter.rockMatch');
  const tempMin = params.get('filter.tempMin');
  const tempMax = params.get('filter.tempMax');
  const rainMin = params.get('filter.rainMin');
  const rainMax = params.get('filter.rainMax');
  const parseNullableNumber = (value: string | null): number | null =>
    value !== null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  result.filter = {
    rocks: decodeIdList(params.get('filter.rocks') ?? ''),
    rockMatch: rockMatchRaw === 'any' ? 'any' : 'top',
    biomes: expandIdList(params.get('filter.biomes') ?? ''),
    tempMin: parseNullableNumber(tempMin),
    tempMax: parseNullableNumber(tempMax),
    rainMin: parseNullableNumber(rainMin),
    rainMax: parseNullableNumber(rainMax),
  };

  return result;
}

/**
 * Keeps window.location.hash in sync with the store, so the current view is always a shareable
 * permalink. No-op outside a browser (e.g. under Vitest's node environment).
 */
export function bindStateToLocation(store: Store<MapState>): () => void {
  if (typeof window === 'undefined') return () => {};
  // Throttled to a quarter second, not once per microtask: panning changes the store every frame,
  // and browsers rate-limit `history.replaceState` (Safari throws after about 100 calls in 30 s,
  // Chrome starts ignoring them). The hash still lands on the latest state within 250 ms.
  let timer: ReturnType<typeof setTimeout> | null = null;
  return store.subscribe(() => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const next = encodeMapStateToHash(store.getState());
      if (window.location.hash !== next) {
        window.history.replaceState(null, '', next);
      }
    }, 250);
  });
}

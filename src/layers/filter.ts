/**
 * The map filter: highlights matching terrain by dimming everything else (CLAUDE.md 1a "Exposure
 * is a first-class feature" sibling feature -- Pau's request, docs/FEEDBACK.md). Criteria are all
 * optional and combined with AND. Pure data + pure predicates -- no DOM, safe to import from a
 * worker (see `filterLayer`, `raster-layers.ts`) and from `@app/state` for the permalink.
 *
 * Ore is intentionally absent here: deposits are Phase 6 (HANDOFF.md item 6) and do not exist yet.
 * The UI shows a disabled control with a note rather than a fake criterion -- see
 * `src/ui/components/panels.ts`'s `mountFilterPanel`.
 */
import type { ClimateSample, RockStack } from '@worldgen/api/types';

/** Whether a rock match requires only the top (surface-proxy) layer, or any of the three. */
export type RockMatchMode = 'top' | 'any';

export interface MapFilter {
  /** Rock registry ids (e.g. 'granite'). Empty means "no rock criterion". */
  readonly rocks: readonly string[];
  readonly rockMatch: RockMatchMode;
  /** Biome datapack ids (e.g. 'tfc:plains', src/data/tfc-1.20/biomes.json). Empty means "no biome
   * criterion". Combined with the other criteria by AND, same as rocks -- see `biomeMatches`. */
  readonly biomes: readonly string[];
  /** °C. `null` means unset. */
  readonly tempMin: number | null;
  readonly tempMax: number | null;
  /** mm. `null` means unset. */
  readonly rainMin: number | null;
  readonly rainMax: number | null;
}

/** No criteria set: matches everything, so the filter layer dims nothing (see `isFilterActive`). */
export const DEFAULT_MAP_FILTER: MapFilter = {
  rocks: [],
  rockMatch: 'top',
  biomes: [],
  tempMin: null,
  tempMax: null,
  rainMin: null,
  rainMax: null,
};

/** True when at least one criterion is set. An inactive filter should not be sampled at all --
 * see `filterLayer.render`'s early-out in `raster-layers.ts`. */
export function isFilterActive(filter: MapFilter): boolean {
  return (
    filter.rocks.length > 0 ||
    filter.biomes.length > 0 ||
    filter.tempMin !== null ||
    filter.tempMax !== null ||
    filter.rainMin !== null ||
    filter.rainMax !== null
  );
}

/**
 * Rock-criterion match over raw fields rather than a `RockStack` object -- the single source of
 * truth both `rockMatches` (object-based, below) and `compileFilterMatcherRaw`'s hot loop
 * (`src/layers/sample-cache.ts`'s cached ids, decoded back to strings with nothing else allocated)
 * build on, so the two never drift apart.
 */
function rockMatchesRaw(
  filter: MapFilter,
  rockSet: ReadonlySet<string> | null,
  top: string | null,
  middle: string | null,
  bottom: string | null,
): boolean {
  if (!rockSet) return true;
  // Rock data unavailable (e.g. ocean column) never satisfies a rock criterion -- never guessed.
  if (top === null) return false;
  if (filter.rockMatch === 'any') {
    return rockSet.has(top) || (middle !== null && rockSet.has(middle)) || (bottom !== null && rockSet.has(bottom));
  }
  return rockSet.has(top);
}

function rockMatches(filter: MapFilter, rockSet: ReadonlySet<string> | null, rocks: RockStack | null): boolean {
  return rockMatchesRaw(filter, rockSet, rocks?.top ?? null, rocks?.middle ?? null, rocks?.bottom ?? null);
}

/** Same shape as `rockMatchesRaw` but for the single biome at a position -- no "top/any" mode
 * since there is only ever one biome per point, unlike the three-deep rock stack. Already takes
 * raw fields (a biome is just a string), so there is no separate object-based sibling. */
function biomeMatches(biomeSet: ReadonlySet<string> | null, biome: string | null): boolean {
  if (!biomeSet) return true;
  // Biome data unavailable never satisfies a biome criterion -- never guessed.
  if (biome === null) return false;
  return biomeSet.has(biome);
}

/** Climate-criterion match over raw fields -- see `rockMatchesRaw`'s doc comment for why. */
function climateMatchesRaw(filter: MapFilter, temperature: number | null, rainfall: number | null): boolean {
  const hasTemp = filter.tempMin !== null || filter.tempMax !== null;
  const hasRain = filter.rainMin !== null || filter.rainMax !== null;
  if (!hasTemp && !hasRain) return true;
  if (temperature === null || rainfall === null) return false;
  if (filter.tempMin !== null && temperature < filter.tempMin) return false;
  if (filter.tempMax !== null && temperature > filter.tempMax) return false;
  if (filter.rainMin !== null && rainfall < filter.rainMin) return false;
  if (filter.rainMax !== null && rainfall > filter.rainMax) return false;
  return true;
}

function climateMatches(filter: MapFilter, climate: ClimateSample | null): boolean {
  return climateMatchesRaw(filter, climate?.temperature ?? null, climate?.rainfall ?? null);
}

/**
 * The filter predicate: true when this position satisfies every set criterion (AND). An empty
 * filter (`isFilterActive` false) matches everything -- there is nothing to reject.
 *
 * `biome` defaults to `null` (unavailable) so existing call sites that only ever passed rock and
 * climate still compile and behave exactly as before when the filter has no biome criterion set.
 *
 * Allocates `Set`s from `filter.rocks`/`filter.biomes` on every call, which is fine for tests and
 * one-off checks but wasteful inside a per-pixel raster loop -- `compileFilterMatcher`/
 * `compileFilterMatcherRaw` below build those Sets once per tile instead and should be preferred
 * there.
 */
export function matchesFilter(
  filter: MapFilter,
  rocks: RockStack | null,
  climate: ClimateSample | null,
  biome: string | null = null,
): boolean {
  const rockSet = filter.rocks.length > 0 ? new Set(filter.rocks) : null;
  const biomeSet = filter.biomes.length > 0 ? new Set(filter.biomes) : null;
  return rockMatches(filter, rockSet, rocks) && biomeMatches(biomeSet, biome) && climateMatches(filter, climate);
}

/**
 * Same predicate as `matchesFilter`, compiled once per call so a per-pixel raster loop (65,536
 * pixels per 256x256 tile) does not rebuild the rock/biome `Set`s on every pixel (CLAUDE.md 6's
 * "hot loops: avoid allocation" for `src/render/**`/`src/layers/**`-adjacent code).
 */
export function compileFilterMatcher(
  filter: MapFilter,
): (rocks: RockStack | null, climate: ClimateSample | null, biome?: string | null) => boolean {
  const rockSet = filter.rocks.length > 0 ? new Set(filter.rocks) : null;
  const biomeSet = filter.biomes.length > 0 ? new Set(filter.biomes) : null;
  return (rocks, climate, biome = null) =>
    rockMatches(filter, rockSet, rocks) && biomeMatches(biomeSet, biome) && climateMatches(filter, climate);
}

/**
 * Same predicate as `compileFilterMatcher` but over raw sample fields (rock top/middle/bottom
 * ids, temperature, rainfall, biome id) instead of `RockStack`/`ClimateSample` objects. Used by
 * `filterLayer.render`'s sample-cache path (`src/layers/sample-cache.ts`): re-evaluating a
 * filter-threshold change against a tile's already-cached samples allocates nothing per pixel --
 * no `RockStack`/`ClimateSample` object needs reconstructing just to hand it to a predicate that
 * only reads three strings and two numbers out of it anyway.
 */
export function compileFilterMatcherRaw(
  filter: MapFilter,
): (
  rockTop: string | null,
  rockMiddle: string | null,
  rockBottom: string | null,
  temperature: number | null,
  rainfall: number | null,
  biome: string | null,
) => boolean {
  const rockSet = filter.rocks.length > 0 ? new Set(filter.rocks) : null;
  const biomeSet = filter.biomes.length > 0 ? new Set(filter.biomes) : null;
  return (rockTop, rockMiddle, rockBottom, temperature, rainfall, biome) =>
    rockMatchesRaw(filter, rockSet, rockTop, rockMiddle, rockBottom) &&
    biomeMatches(biomeSet, biome) &&
    climateMatchesRaw(filter, temperature, rainfall);
}

/**
 * Shared by the rock and biome checklists' "select all" / "select none" buttons
 * (`src/ui/components/panels.ts`'s `mountFilterPanel`): both go through the exact same
 * `setFilter({ rocks: ... })` / `setFilter({ biomes: ... })` state path a single checkbox click
 * does -- they just set or clear every id at once instead of toggling one.
 */
export function selectAllIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** @see selectAllIds */
export function selectNoneIds(): string[] {
  return [];
}

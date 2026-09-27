/**
 * A layer maps generator output to something drawable. Layers know nothing about how values are
 * produced, and generators know nothing about colour.
 */
import type { LayerId, WorldGenerator } from '@worldgen/api/types';
import type { MapFilter } from './filter';
import type { SampleCacheContext } from './sample-cache';

export type LayerKind = 'raster' | 'vector';

export interface LayerDefinition {
  readonly id: LayerId;
  readonly kind: LayerKind;
  readonly labelKey: string;
  /** Layers are painted in ascending order. */
  readonly order: number;
  readonly defaultEnabled: boolean;
  readonly developer?: boolean;
  /**
   * How this layer composes with the layers below it (docs/adr/0007-layer-compositing.md):
   * `'base'` — categorical data painted opaque by default (biome, rock); `'overlay'` — continuous
   * data, or a diagnostic, painted translucent by default (temperature, rainfall, terrain,
   * region-debug). This only seeds `defaultOpacity` and UI grouping — any combination of layers
   * may be enabled regardless of `blend`; two opaque bases simply alpha-composite in paint order
   * like any other pair of layers.
   */
  readonly blend: 'base' | 'overlay';
  /** Opacity (0..1) used when `MapState.layerOpacity` has no explicit override for this layer. */
  readonly defaultOpacity: number;
  /**
   * The layer draws from the height field, so once everything on screen has loaded it can be
   * re-rendered in the background with a denser height grid (`detail`) — see `TileManager.refine`.
   */
  readonly refinable?: boolean;
}

/**
 * Describes a continuous raster layer's colour ramp for the legend UI — the low/high theme token
 * ids a layer's `render` resolves its ramp from (see `raster-layers.ts`), plus the value range and
 * unit those endpoints represent. The legend reads the *live* tokens itself (`getThemeTokens`) so
 * its gradient always matches what the canvas just painted, theme included.
 */
export interface GradientLegend {
  readonly kind: 'gradient';
  readonly lowToken: string;
  readonly highToken: string;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

/**
 * Describes a multi-stop colour ramp for the legend UI. The ramp defines exact colours and the
 * values they apply to. The legend renders a gradient swatch with labels at each stop.
 */
export interface RampLegend {
  readonly kind: 'ramp';
  readonly stops: ReadonlyArray<{ value: number; color: number }>;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

export interface RasterLayer extends LayerDefinition {
  readonly kind: 'raster';
  /**
   * Fill `out` (RGBA, size * size pixels) for the tile. Runs inside a worker; must not allocate
   * per pixel.
   */
  render(
    generator: WorldGenerator,
    out: Uint8ClampedArray,
    originX: number,
    originZ: number,
    size: number,
    blocksPerPixel: number,
    palette: Record<string, number>,
    /** Only consumed by the `filter` layer (docs/adr/0007-layer-compositing.md's compositing
     * model plus `filter.ts`'s predicate) — every other layer ignores this argument. Not part of
     * the tile cache key (`TileKeyParts`); a filter-value change instead calls
     * `TileManager.invalidateLayer('filter')` explicitly so only this layer's tiles are dropped. */
    filter?: MapFilter,
    /** Only consumed by the `filter` layer's sample-cache path (`src/layers/sample-cache.ts`) —
     * every other layer ignores this argument too. Assembled by `src/workers/tile.worker.ts` from
     * the worker's active session (seed/profile/dimension/settings) plus the tile being rendered,
     * so `filterLayer.render` can sample a tile's rock/climate/biome values once and re-evaluate
     * the filter over cached numbers on every later filter-only change for that same tile. */
    sampleCacheContext?: SampleCacheContext,
    /** Height-field density for `refinable` layers: 0 is the normal grid, and each step doubles the
     * nodes along each axis (`nodesForDetail`). Every other layer ignores it. */
    detail?: number,
  ): void;
  /** Present only for continuous (non-categorical) layers — drives the legend's gradient swatch. */
  readonly legend?: GradientLegend | RampLegend;
}

export interface DepositFilter {
  readonly ores: ReadonlySet<string> | null;
  readonly exposure: ReadonlySet<'surface' | 'cave' | 'buried' | 'unknown'> | null;
  readonly minY: number | null;
  readonly maxY: number | null;
  readonly maxDepthBelowSurface: number | null;
  readonly indicatorOnly: boolean;
}

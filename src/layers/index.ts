// Layer registry: biome, rock, temperature, rainfall, terrain are raster today (Phase 1 debug
// data). ores, minerals, structures and grid are vector/overlay concepts added in later phases.
import type { LayerId } from '@worldgen/api/types';
import { RASTER_LAYERS } from './raster-layers';
import type { RasterLayer } from './types';

const byId = new Map<LayerId, RasterLayer>(RASTER_LAYERS.map((layer) => [layer.id, layer]));

export function getRasterLayer(id: LayerId): RasterLayer | undefined {
  return byId.get(id);
}

export function listRasterLayers(): readonly RasterLayer[] {
  return RASTER_LAYERS;
}

/**
 * Resolves the opacity a layer should paint at: an explicit override from `MapState.layerOpacity`
 * when present and finite, clamped to [0, 1]; otherwise the layer's own `defaultOpacity`
 * (docs/adr/0007-layer-compositing.md). A layer with no registration (e.g. `grid`, which is not a
 * raster layer) falls back to fully opaque.
 */
export function resolveLayerOpacity(id: LayerId, overrides: Partial<Record<LayerId, number>>): number {
  const override = overrides[id];
  if (override !== undefined && Number.isFinite(override)) {
    return Math.min(1, Math.max(0, override));
  }
  return getRasterLayer(id)?.defaultOpacity ?? 1;
}

/**
 * Fixed paint order: ascending by `LayerDefinition.order`, independent of the order layers happen
 * to sit in `MapState.enabledLayers` (docs/adr/0007-layer-compositing.md) -- opaque bases (biome,
 * rock) before translucent overlays (temperature, rainfall, terrain), the diagnostic overlay
 * (region-debug) last. A layer with no registration (e.g. `grid`) sorts after every raster layer.
 * Shared by the canvas painter (bottom-to-top paint order) and the legend (top-to-bottom reading
 * order), so both always agree with each other.
 */
export function orderLayersForPaint(layers: readonly LayerId[]): LayerId[] {
  return [...layers].sort(
    (a, b) => (getRasterLayer(a)?.order ?? Number.POSITIVE_INFINITY) - (getRasterLayer(b)?.order ?? Number.POSITIVE_INFINITY),
  );
}

export * from './types';
export * from './raster-layers';
export * from './filter';
export * from './sample-cache';

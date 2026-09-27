/**
 * Node-side performance measurements. Started in slice 1 (region-cache/zoom-reuse/worker-affinity
 * work) and extended in docs/PLAN.md section 6 ("Performance, round 2") with a region-build vs
 * per-pixel-sampling breakdown, a simulated pan cycle, a simulated zoom cycle, and a direct
 * before/after measurement of the filter sample cache (src/layers/sample-cache.ts).
 *
 * Everything here runs in Node via `vite-node` (`./node_modules/.bin/vite-node
 * tools/benchmark-slice1.ts`) against the real generator and real layer `render` functions -- no
 * mocks. What it cannot measure, honestly: a real browser's Worker `postMessage` transport
 * (structured-clone cost, scheduling) and `<canvas>` drawImage/compositing cost -- both need a
 * browser runtime this Node process does not have. See this file's final `note` field and the
 * report that accompanies it for what stands in for each instead.
 */
import '@worldgen/profiles';
import { createGenerator } from '@worldgen/registry';
import { getRasterLayer, filterLayer } from '@layers/index';
import type { RasterLayer } from '@layers/types';
import { TileSampleCache } from '@layers/sample-cache';
import { DEFAULT_MAP_FILTER, type MapFilter } from '@layers/filter';
import { workerIndexForTile } from '@workers/pool';
import { blocksPerPixel } from '@core/coords/coords';

const palette = { 'map-bg': 0x101010 };
const size = 256;
const out = new Uint8ClampedArray(size * size * 4);
const maybeLayer = getRasterLayer('biome');
if (!maybeLayer) throw new Error('biome layer is not registered');
const layer = maybeLayer;

function render(seed: bigint, zoom: number): number {
  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const start = performance.now();
  layer.render(generator, out, 0, 0, size, blocksPerPixel(zoom), palette);
  return performance.now() - start;
}

// --- slice 1's original measurements (unchanged) ---------------------------------------------

const tileTimings = [3, 4, 5].map((zoom) => {
  const cold = render(42n, zoom);
  const generator = createGenerator('tfc-1.20', { seed: 42n, dimension: 'overworld' });
  const warmOut = new Uint8ClampedArray(size * size * 4);
  layer.render(generator, warmOut, 0, 0, size, blocksPerPixel(zoom), palette);
  const warmStart = performance.now();
  layer.render(generator, warmOut, 0, 0, size, blocksPerPixel(zoom), palette);
  return { zoom, coldMs: cold, warmMs: performance.now() - warmStart };
});
const routingStart = performance.now();
for (let i = 0; i < 100_000; i++) workerIndexForTile({ zoom: i % 8 - 4, tileX: i - 50_000, tileZ: 50_000 - i }, 8);
const routingMs = performance.now() - routingStart;
const distribution = [0, 0, 0, 0];
for (const zoom of [0, 1, 2, 3, 4]) {
  for (let tz = -4; tz <= 4; tz++) for (let tx = -4; tx <= 4; tx++) {
    const index = workerIndexForTile({ zoom, tileX: tx, tileZ: tz }, 4);
    distribution[index] = (distribution[index] ?? 0) + 1;
  }
}

// --- section 6: region build vs per-pixel sampling, isolated ----------------------------------

/**
 * A single `rocks()`/`climate()`/`biome()` call at a never-before-touched coordinate forces one
 * region build (task pipeline: continents, islands, mountains, climate annotation, biome/rock
 * choice -- see src/worldgen/tfc-1.20/region/generator.ts) plus one point sample. The same call
 * repeated at a nearby coordinate inside the same TFC region cell (~12,288 blocks wide, PLAN.md's
 * "Done" log) only pays the point-sample cost, since the region is now cached. The gap between the
 * two approximates the region-build cost in isolation.
 */
function measureRegionBuildVsPointSample(seed: bigint): { coldSingleCallMs: number; warmSingleCallMs: number } {
  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const coldStart = performance.now();
  generator.rocks(0, 0);
  generator.climate(0, 0);
  generator.biome(0, 0);
  const coldSingleCallMs = performance.now() - coldStart;

  const warmStart = performance.now();
  generator.rocks(1, 1); // 1 block away -- same region cell, region cache already warm
  generator.climate(1, 1);
  generator.biome(1, 1);
  const warmSingleCallMs = performance.now() - warmStart;
  return { coldSingleCallMs, warmSingleCallMs };
}
const regionBuildTiming = measureRegionBuildVsPointSample(7n);

/**
 * Per-pixel sampling cost with the region already warm: render a full 256x256 tile (65,536
 * pixels) at zoom 0 (1 block/pixel, so every pixel is a distinct generator call -- no
 * `Math.floor` collisions to skip real work) immediately after one warm-up call into the same
 * area, for every data layer the filter also reads from (biome, rock, temperature via climate,
 * rainfall via climate). This isolates "per-pixel sampling" from "region build" -- the region for
 * this whole tile (256 blocks, well inside one ~12,288-block region cell) is already cached before
 * timing starts.
 */
function measureWarmPerPixelSampling(seed: bigint): Record<string, { totalMs: number; usPerPixel: number }> {
  const layers = ['biome', 'rock', 'temperature', 'rainfall'] as const;
  const result: Record<string, { totalMs: number; usPerPixel: number }> = {};
  for (const id of layers) {
    const l = getRasterLayer(id);
    if (!l) continue;
    const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
    generator.rocks(0, 0);
    generator.climate(0, 0);
    generator.biome(0, 0); // warm-up: touches this tile's region before timing starts
    const tileOut = new Uint8ClampedArray(size * size * 4);
    const start = performance.now();
    l.render(generator, tileOut, 0, 0, size, blocksPerPixel(0), palette);
    const totalMs = performance.now() - start;
    result[id] = { totalMs, usPerPixel: (totalMs * 1000) / (size * size) };
  }
  return result;
}
const warmPerPixelSampling = measureWarmPerPixelSampling(7n);

// --- section 6: a simulated pan cycle -----------------------------------------------------------

/**
 * Renders 5 adjacent tiles in a row at a fixed zoom, on one generator instance, the way panning
 * right across the map would request them one at a time. Reports each tile's time plus the total,
 * so the report can show how much of a pan is region-build (the first tile touching a new region
 * cell) versus already-warm sampling (later tiles that land in an already-cached region, or that
 * only need the per-pixel cost above).
 */
function measurePanCycle(seed: bigint, zoom: number, tileCount: number, panLayer: RasterLayer = layer): { perTileMs: number[]; totalMs: number } {
  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const span = size * blocksPerPixel(zoom);
  const perTileMs: number[] = [];
  const panOut = new Uint8ClampedArray(size * size * 4);
  const start = performance.now();
  for (let t = 0; t < tileCount; t++) {
    const tileStart = performance.now();
    panLayer.render(generator, panOut, t * span, 0, size, blocksPerPixel(zoom), palette);
    perTileMs.push(performance.now() - tileStart);
  }
  return { perTileMs, totalMs: performance.now() - start };
}
const panCycle = measurePanCycle(7n, 4, 5);
// The `rock` layer specifically -- docs/PLAN.md section 6's new candidate item names this exact
// scenario ("enabling the rock layer ... while panning is today's worst case") as what to fix.
const rockLayerForBench = getRasterLayer('rock');
const rockPanCycle = rockLayerForBench ? measurePanCycle(7n, 4, 5, rockLayerForBench) : null;

// --- section 6: a simulated zoom cycle -----------------------------------------------------------

/**
 * Renders the tile covering the same world origin at progressively closer zoom levels, on one
 * generator instance -- the way zooming in on one spot would request them one at a time. Every
 * level is a distinct tile-cache entry, but they can share the *region* cache underneath (slice
 * 1's zoom-reuse win): this measures whether that sharing actually shows up as faster renders once
 * the first (most zoomed-out) level has warmed the relevant regions.
 */
function measureZoomCycle(seed: bigint, zooms: readonly number[], zoomLayer: RasterLayer = layer): { zoom: number; ms: number }[] {
  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const zoomOut = new Uint8ClampedArray(size * size * 4);
  return zooms.map((zoom) => {
    const start = performance.now();
    zoomLayer.render(generator, zoomOut, 0, 0, size, blocksPerPixel(zoom), palette);
    return { zoom, ms: performance.now() - start };
  });
}
const zoomCycleOutToIn = measureZoomCycle(7n, [6, 5, 4, 3, 2, 1, 0]);
const rockZoomCycleOutToIn = rockLayerForBench ? measureZoomCycle(7n, [6, 5, 4, 3, 2, 1, 0], rockLayerForBench) : null;

// --- section 6: filter sample cache, before/after, measured directly --------------------------

/**
 * The actual regression this slice targets: how long does re-evaluating a filter-threshold change
 * over an already-visible tile take, with and without the sample cache
 * (src/layers/sample-cache.ts)? "Before" renders the filter layer twice with two different filters
 * and no sample-cache context (exactly how every render worked before this slice -- see
 * filterLayer.render's fallback branch); "after" does the same with a `TileSampleCache` supplied,
 * timing only the *second* render in each case, since that is the one a real filter-threshold
 * change triggers (`TileManager.invalidateLayer('filter')` drops only the stale bitmap -- the
 * first render of a tile always has to sample something regardless of this cache).
 */
function measureFilterRerender(seed: bigint): { withoutCacheMs: number; withCacheMs: number; speedup: number } {
  const filterA: MapFilter = { ...DEFAULT_MAP_FILTER, rocks: ['granite', 'basalt', 'shale'] };
  const filterB: MapFilter = { ...DEFAULT_MAP_FILTER, tempMin: -5, tempMax: 20, rainMin: 100 };

  const generatorNoCache = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const noCacheOut = new Uint8ClampedArray(size * size * 4);
  filterLayer.render(generatorNoCache, noCacheOut, 0, 0, size, blocksPerPixel(0), palette, filterA);
  const withoutCacheStart = performance.now();
  filterLayer.render(generatorNoCache, noCacheOut, 0, 0, size, blocksPerPixel(0), palette, filterB);
  const withoutCacheMs = performance.now() - withoutCacheStart;

  const generatorWithCache = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const cache = new TileSampleCache();
  const context = {
    cache,
    seed: seed.toString(),
    profile: 'tfc-1.20' as const,
    dimension: 'overworld' as const,
    settings: {},
    zoom: 0,
    tileX: 0,
    tileZ: 0,
  };
  const cachedOut = new Uint8ClampedArray(size * size * 4);
  filterLayer.render(generatorWithCache, cachedOut, 0, 0, size, blocksPerPixel(0), palette, filterA, context);
  const withCacheStart = performance.now();
  filterLayer.render(generatorWithCache, cachedOut, 0, 0, size, blocksPerPixel(0), palette, filterB, context);
  const withCacheMs = performance.now() - withCacheStart;

  return { withoutCacheMs, withCacheMs, speedup: withoutCacheMs / withCacheMs };
}
const filterRerender = measureFilterRerender(7n);

console.log(JSON.stringify({
  tileTimings,
  routing100kMs: routingMs,
  viewportTileDistribution4Workers: distribution,
  regionBuildVsPointSample: regionBuildTiming,
  warmPerPixelSampling,
  panCycle5TilesZoom4: panCycle,
  zoomCycleOutToIn,
  rockPanCycle5TilesZoom4: rockPanCycle,
  rockZoomCycleOutToIn,
  filterRerenderBeforeAfterSampleCache: filterRerender,
  note:
    'Worker postMessage transport and <canvas> paint/compositing both require a browser runtime ' +
    'this Node process does not have -- not measured here, and not estimated (see the report). ' +
    'Everything above ran directly against the real generator and real RasterLayer.render ' +
    'functions this worker/canvas pipeline actually calls, on this machine, just outside a Worker ' +
    'and without a real <canvas>.',
}, null, 2));

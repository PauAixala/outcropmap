/**
 * Raster layer definitions: how each layer turns generator output into pixels. Runs inside a
 * worker (see src/workers/tile.worker.ts) — no DOM, no canvas, must not allocate per pixel beyond
 * the shared scratch below.
 */
import { categoricalColor, hashString, sequentialColor, sampleRamp } from '@render/colormap';
import { tokenColour } from '@render/tokens';
import { clamp01 } from '@core/math';
import type { RasterLayer } from './types';
import { DEFAULT_MAP_FILTER, compileFilterMatcherRaw, isFilterActive } from './filter';
import temperaturePalette from '@data/palettes/tfc-1.20-temperature.json';
import rainfallPalette from '@data/palettes/tfc-1.20-rainfall.json';
import { nodesForDetail, sampleHeightField } from './height-field';

/** Fills one 256x256 RGBA tile by sampling `colorFor` once per pixel. */
function fillTile(
  out: Uint8ClampedArray,
  size: number,
  originX: number,
  originZ: number,
  blocksPerPixel: number,
  colorFor: (blockX: number, blockZ: number) => number,
): void {
  let i = 0;
  for (let py = 0; py < size; py++) {
    const blockZ = Math.floor(originZ + py * blocksPerPixel);
    for (let px = 0; px < size; px++) {
      const blockX = Math.floor(originX + px * blocksPerPixel);
      const color = colorFor(blockX, blockZ);
      out[i++] = (color >> 16) & 0xff;
      out[i++] = (color >> 8) & 0xff;
      out[i++] = color & 0xff;
      out[i++] = 255;
    }
  }
}

/** `TFCChunkGenerator.SEA_LEVEL_Y` — "Matches vanilla". */
const SEA_LEVEL_Y = 63;

/** Blocks between contour lines when one pixel is one block; it opens up as you zoom out. */
const CONTOUR_INTERVAL_Y = 10;

export const biomeLayer: RasterLayer = {
  id: 'biome',
  kind: 'raster',
  labelKey: 'layerNames.biome',
  order: 10,
  defaultEnabled: true,
  // Categorical -- opaque base (ADR 0007).
  blend: 'base',
  defaultOpacity: 1,
  render(generator, out, originX, originZ, size, bpp, palette) {
    const noData = tokenColour(palette, 'map-bg');
    fillTile(out, size, originX, originZ, bpp, (x, z) => {
      const biome = generator.biome(x, z);
      if (biome === null) return noData;
      return generator.profile.biomePalette?.[biome] ?? categoricalColor(hashString(biome));
    });
  },
};

export const rockLayer: RasterLayer = {
  id: 'rock',
  kind: 'raster',
  labelKey: 'layerNames.rock',
  order: 20,
  defaultEnabled: false,
  // Categorical -- opaque base (ADR 0007).
  blend: 'base',
  defaultOpacity: 1,
  render(generator, out, originX, originZ, size, bpp, palette) {
    const noData = tokenColour(palette, 'map-bg');
    fillTile(out, size, originX, originZ, bpp, (x, z) => {
      const rocks = generator.rocks(x, z);
      if (rocks === null) return noData;
      const rock = rocks.surface ?? rocks.top;
      return generator.profile.rockPalette?.[rock] ?? categoricalColor(hashString(rock));
    });
  },
};

// `temperature` and `rainfall` use multi-stop colour ramps from palette data files. The ramps
// define the exact colours to use and the value range they apply to. `terrain` still uses the
// legacy two-endpoint sequentialColor for now.

export const temperatureLayer: RasterLayer = {
  id: 'temperature',
  kind: 'raster',
  labelKey: 'layerNames.temperature',
  order: 30,
  defaultEnabled: false,
  // Continuous -- translucent overlay, meant to wash over a base (ADR 0007).
  blend: 'overlay',
  defaultOpacity: 0.55,
  legend: { kind: 'ramp', stops: temperaturePalette.stops, min: -30, max: 35, unit: '°C' },
  render(generator, out, originX, originZ, size, bpp) {
    const stops = temperaturePalette.stops;
    fillTile(out, size, originX, originZ, bpp, (x, z) => {
      const temp = generator.climate(x, z).temperature;
      return sampleRamp(stops, temp);
    });
  },
};

export const rainfallLayer: RasterLayer = {
  id: 'rainfall',
  kind: 'raster',
  labelKey: 'layerNames.rainfall',
  order: 40,
  defaultEnabled: false,
  // Continuous -- translucent overlay (ADR 0007).
  blend: 'overlay',
  defaultOpacity: 0.55,
  legend: { kind: 'ramp', stops: rainfallPalette.stops, min: 0, max: 500, unit: 'mm' },
  render(generator, out, originX, originZ, size, bpp) {
    const stops = rainfallPalette.stops;
    fillTile(out, size, originX, originZ, bpp, (x, z) => {
      const rain = generator.climate(x, z).rainfall;
      return sampleRamp(stops, rain);
    });
  },
};

export const terrainLayer: RasterLayer = {
  id: 'terrain',
  kind: 'raster',
  labelKey: 'layerNames.terrain',
  order: 50,
  refinable: true,
  defaultEnabled: false,
  // Continuous -- translucent overlay (ADR 0007).
  blend: 'overlay',
  defaultOpacity: 0.55,
  legend: {
    kind: 'gradient',
    lowToken: 'map-bg',
    highToken: 'map-label',
    min: 40,
    max: 240,
    unit: 'y',
  },
  render(generator, out, originX, originZ, size, bpp, palette, _filter, _sampleCache, detail = 0) {
    const low = tokenColour(palette, 'map-bg');
    const high = tokenColour(palette, 'map-label');
    const water = palette['map-grid-strong'] ?? low;
    // One coarse height field per tile instead of one `surfaceY` per pixel -- see `height-field.ts`
    // for the measurements that forced this (45s for a single tile at 16 blocks per pixel).
    const field = sampleHeightField(generator, originX, originZ, size, bpp, nodesForDetail(detail));
    let i = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        let color = low;
        if (field.available) {
          const y = field.heightAt(px, py);
          // Sea level is a hard break, not a point on the ramp: ground below it is under water, and
          // running one gradient through it hides the single most important contour on the map.
          color =
            y < SEA_LEVEL_Y
              ? sequentialColor(clamp01((y - (SEA_LEVEL_Y - 60)) / 60), low, water)
              : sequentialColor(clamp01((y - SEA_LEVEL_Y) / 160), low, high);
        }
        out[i++] = (color >> 16) & 0xff;
        out[i++] = (color >> 8) & 0xff;
        out[i++] = color & 0xff;
        out[i++] = 255;
      }
    }
  },
};

/**
 * Contour lines every `CONTOUR_INTERVAL_Y` blocks, with sea level always drawn (docs/PLAN.md 11).
 *
 * A contour is where the surface crosses a multiple of the interval, so a pixel is on a line when
 * its own band differs from the band of the pixel before it. That gives a line one pixel wide at
 * any zoom without measuring gradients or tracing paths.
 *
 * The coastline is drawn whatever the interval, and heavier: it is the one contour a player needs
 * at a glance, and it does not generally fall on a multiple of the interval.
 */
export const contourLayer: RasterLayer = {
  id: 'contours',
  kind: 'raster',
  labelKey: 'layerNames.contours',
  order: 56,
  refinable: true,
  defaultEnabled: false,
  blend: 'overlay',
  defaultOpacity: 0.5,
  render(generator, out, originX, originZ, size, bpp, _palette, _filter, _sampleCache, detail = 0) {
    const field = sampleHeightField(generator, originX, originZ, size, bpp, nodesForDetail(detail));
    if (!field.available) {
      out.fill(0);
      return;
    }

    // Below about a block per pixel every contour would be a wide band rather than a line, so the
    // interval opens up with the zoom. Powers of two keep the same lines visible as you zoom.
    const interval = CONTOUR_INTERVAL_Y * Math.max(1, 2 ** Math.floor(Math.log2(Math.max(1, bpp))));
    const band = (px: number, pz: number): number => Math.floor(field.heightAt(px, pz) / interval);
    const wet = (px: number, pz: number): boolean => field.heightAt(px, pz) < SEA_LEVEL_Y;

    let i = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const coast = wet(px, py) !== wet(px - 1, py) || wet(px, py) !== wet(px, py - 1);
        const contour =
          band(px, py) !== band(px - 1, py) || band(px, py) !== band(px, py - 1);
        const alpha = coast ? 255 : contour ? 140 : 0;
        out[i++] = 0;
        out[i++] = 0;
        out[i++] = 0;
        out[i++] = alpha;
      }
    }
  },
};

/**
 * Shaded relief: the shape of the land, lit from the north-west, painted over whatever layer is
 * underneath (docs/PLAN.md section 11).
 *
 * This is the layer that makes terrain readable. A height *ramp* tells you a number; a hillshade
 * tells you where the valleys and ridges are, which is what a player planning a walk actually looks
 * at. It is a pure overlay -- it darkens slopes facing away from the light and lightens those facing
 * it, and leaves flat ground untouched -- so it composes with the biome or rock layer rather than
 * replacing it.
 *
 * Per-pixel alpha carries the shading, so the layer's own opacity control still works on top.
 */
export const hillshadeLayer: RasterLayer = {
  id: 'hillshade',
  kind: 'raster',
  labelKey: 'layerNames.hillshade',
  order: 55,
  refinable: true,
  // On by default: a flat biome map reads as a political map, and the whole point of a TFC map is
  // the terrain you have to walk over. Turning it off gives the flat view back.
  defaultEnabled: true,
  blend: 'overlay',
  // 25%: the gradient is already exaggerated hard below, so the shading carries at a light touch,
  // and the biome colours underneath stay their own colour rather than going grey.
  defaultOpacity: 0.25,
  render(generator, out, originX, originZ, size, bpp, _palette, _filter, _sampleCache, detail = 0) {
    const field = sampleHeightField(generator, originX, originZ, size, bpp, nodesForDetail(detail));
    if (!field.available) {
      out.fill(0);
      return;
    }

    // Light from the north-west at 45 degrees, the cartographic convention: any other direction
    // makes valleys read as ridges to most people.
    const lightX = -Math.SQRT1_2;
    const lightZ = -Math.SQRT1_2;
    // The run over which a height difference is measured. Using the node spacing rather than one
    // pixel keeps the shading identical at every zoom instead of flattening out as you zoom in.
    const run = field.nodeSpacingInBlocks;
    // TFC slopes are gentle over the run we sample, so an honest normal barely shades. Steepening
    // the gradient before lighting it is the standard relief cheat: it exaggerates the *contrast*,
    // never the heights, which the readout and the contour layer still report unchanged.
    const RELIEF_EXAGGERATION = 3.5;

    let i = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const step = Math.max(1, run / bpp);
        const dzdx =
          (RELIEF_EXAGGERATION * (field.heightAt(px + step, py) - field.heightAt(px - step, py))) /
          (2 * run);
        const dzdz =
          (RELIEF_EXAGGERATION * (field.heightAt(px, py + step) - field.heightAt(px, py - step))) /
          (2 * run);

        // Surface normal is (-dz/dx, 1, -dz/dz) before normalising; dot it with the light.
        const norm = Math.sqrt(dzdx * dzdx + dzdz * dzdz + 1);
        const shade = (-dzdx * lightX - dzdz * lightZ) / norm;

        // Positive shade faces the light. Highlights are held well below shadows: relief reads
        // through its shadows, and a bright wash over the base layer just fogs it.
        const alpha = shade < 0 ? Math.min(1, -shade * 2.6) : Math.min(1, shade * 1.5);
        const value = shade < 0 ? 0 : 255;
        out[i++] = value;
        out[i++] = value;
        out[i++] = value;
        out[i++] = Math.round(alpha * 255);
      }
    }
  },
};

/**
 * `filter` highlights matching terrain instead of hiding non-matching layers: it paints a
 * translucent dim over every position that fails the active `MapFilter` and nothing over a match,
 * so it composites on top of whatever data layers the user has enabled (docs/adr/0007's alpha
 * blending) rather than replacing them. `order` is the highest of any raster layer -- above every
 * data layer and the `region-debug` diagnostic -- so the dim always reads as the topmost veil;
 * `grid` still paints after it (`paintFrame` draws the grid separately, unconditionally last).
 *
 * Reuses the same `generator.rocks`/`generator.climate`/`generator.biome` calls the
 * `rock`/`temperature`/`rainfall`/`biome` layers already make -- and therefore the same region
 * cache -- rather than adding a second sampling route (CLAUDE.md 5). An inactive filter
 * (`isFilterActive` false, i.e. every criterion unset) is the common case while Pau is still
 * choosing values, so it short-circuits to a fully transparent tile without touching the
 * generator at all.
 *
 * When a `sampleCacheContext` is supplied (`src/workers/tile.worker.ts` always provides one for a
 * real session), this samples the tile's rock/climate/biome values through the generator **once**
 * and caches them (`src/layers/sample-cache.ts`) -- a later render of the *same* tile after only
 * the filter changed (`TileManager.invalidateLayer('filter')` drops just this layer's bitmap, not
 * the underlying values, which have not changed) hits that cache instead of calling the generator
 * again for all 65,536 pixels (docs/FEEDBACK.md: "al filtrar se recalcula todo y tarda mucho").
 * Without a context (e.g. the unit tests below, which pass a stub generator directly), it falls
 * back to sampling the generator every render, exactly as before this cache existed.
 *
 * The dim colour comes from the `map-bg` token (ADR 0005 -- no hardcoded colours), which fades a
 * non-matching position toward the map's own background in both themes rather than baking in a
 * fixed hex. The alpha baked into non-matching pixels is fixed at fully opaque, the same technique
 * `region-debug` below uses for its boundary pixels: the actual visual strength is left to this
 * layer's own opacity slider (`defaultOpacity`, `resolveLayerOpacity`), exactly like every other
 * overlay -- so raising or lowering "how strong is the dim" never touches the tile cache.
 */
export const filterLayer: RasterLayer = {
  id: 'filter',
  kind: 'raster',
  labelKey: 'layerNames.filter',
  order: 110,
  defaultEnabled: true,
  // Overlay -- a translucent veil over non-matching positions, not categorical data (ADR 0007).
  blend: 'overlay',
  defaultOpacity: 0.6,
  render(generator, out, originX, originZ, size, bpp, palette, filter, sampleCacheContext) {
    const active = filter ?? DEFAULT_MAP_FILTER;
    if (!isFilterActive(active)) {
      // No criteria set -- matches everything, so there is nothing to dim. Skip sampling.
      out.fill(0);
      return;
    }
    const dim = tokenColour(palette, 'map-bg');
    const dr = (dim >> 16) & 0xff;
    const dg = (dim >> 8) & 0xff;
    const db = dim & 0xff;
    const matches = compileFilterMatcherRaw(active);

    // Sample once, from the cache when a previous render of this exact tile (any filter) already
    // populated it, else by sampling the generator now and storing the result -- see this layer's
    // doc comment and src/layers/sample-cache.ts.
    const samples = sampleCacheContext
      ? (sampleCacheContext.cache.get(
          sampleCacheContext.seed,
          sampleCacheContext.profile,
          sampleCacheContext.dimension,
          sampleCacheContext.settings,
          sampleCacheContext.zoom,
          sampleCacheContext.tileX,
          sampleCacheContext.tileZ,
        ) ??
        sampleCacheContext.cache.buildAndStore(
          sampleCacheContext.seed,
          sampleCacheContext.profile,
          sampleCacheContext.dimension,
          sampleCacheContext.settings,
          sampleCacheContext.zoom,
          sampleCacheContext.tileX,
          sampleCacheContext.tileZ,
          generator,
          originX,
          originZ,
          size,
          bpp,
        ))
      : null;
    const cache = sampleCacheContext?.cache;

    let i = 0;
    let p = 0;
    for (let py = 0; py < size; py++) {
      const blockZ = Math.floor(originZ + py * bpp);
      for (let px = 0; px < size; px++) {
        let isMatch: boolean;
        if (samples && cache) {
          isMatch = matches(
            cache.rockIdFor(samples.rockTop[p]!),
            cache.rockIdFor(samples.rockMiddle[p]!),
            cache.rockIdFor(samples.rockBottom[p]!),
            samples.temperature[p]!,
            samples.rainfall[p]!,
            cache.biomeIdFor(samples.biome[p]!),
          );
        } else {
          const blockX = Math.floor(originX + px * bpp);
          const rocks = generator.rocks(blockX, blockZ);
          const climate = generator.climate(blockX, blockZ);
          isMatch = matches(
            rocks?.top ?? null,
            rocks?.middle ?? null,
            rocks?.bottom ?? null,
            climate.temperature,
            climate.rainfall,
            generator.biome(blockX, blockZ),
          );
        }
        if (isMatch) {
          out[i] = 0;
          out[i + 1] = 0;
          out[i + 2] = 0;
          out[i + 3] = 0;
        } else {
          out[i] = dr;
          out[i + 1] = dg;
          out[i + 2] = db;
          out[i + 3] = 255;
        }
        i += 4;
        p++;
      }
    }
  },
};

export const RASTER_LAYERS: readonly RasterLayer[] = [
  biomeLayer,
  rockLayer,
  temperatureLayer,
  rainfallLayer,
  terrainLayer,
  hillshadeLayer,
  contourLayer,
  filterLayer,
  {
    id: 'region-debug',
    kind: 'raster',
    labelKey: 'layerNames.region-debug',
    order: 100,
    defaultEnabled: false,
    developer: true,
    // Diagnostic overlay -- pixels are transparent except at region boundaries, so full alpha is
    // already the readable default (ADR 0007).
    blend: 'overlay',
    defaultOpacity: 1,
    render(generator, out, originX, originZ, size, bpp, palette) {
      out.fill(0);
      if (!generator.regionDebug) return;
      const sample = (x: number, z: number): string => generator.regionDebug!(x, z).id;
      const outline = palette['map-label'] ?? 0;
      // Include the previous row/column outside this tile so boundaries continue across seams.
      // One owner sample per pixel; only the previous row is retained.
      const previous = Array.from({ length: size }, (_, px) =>
        sample(Math.floor(originX + px * bpp), Math.floor(originZ - bpp)),
      );
      for (let pz = 0; pz < size; pz++) {
        const z = Math.floor(originZ + pz * bpp);
        let left = sample(Math.floor(originX - bpp), z);
        for (let px = 0; px < size; px++) {
          const current = sample(Math.floor(originX + px * bpp), z);
          if (current !== left || current !== previous[px]) {
            const offset = (pz * size + px) * 4;
            out[offset] = (outline >> 16) & 255;
            out[offset + 1] = (outline >> 8) & 255;
            out[offset + 2] = outline & 255;
            out[offset + 3] = 255;
          }
          previous[px] = current;
          left = current;
        }
      }
    },
  },
];

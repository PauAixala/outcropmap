/**
 * Canvas painter: draws cached raster tiles for every enabled layer, then the chunk/region grid
 * overlay. All colours come from resolved theme tokens (ADR 0005) — never a hex literal here.
 */
import type { Camera } from '@core/coords/coords';
import {
  CHUNK_SIZE,
  MC_REGION_SIZE,
  TILE_SIZE_PX,
  blockToScreen,
  blocksPerPixel,
  tileOriginBlock,
  tileSpanBlocks,
} from '@core/coords/coords';
import type { DepositFeature, LayerId, StructureFeature } from '@worldgen/api/types';
import type { CachedTile, TileManager } from '@render/tiles/tile-manager';
import { colorToCss } from '@render/colormap';
import { oreMarkerColor } from '@render/markers';
import { tokenColour } from '@render/tokens';
import { en } from '@ui/i18n/en';
import { getRasterLayer, orderLayersForPaint, resolveLayerOpacity } from '@layers/index';
import { maxUsefulDetail } from '@layers/height-field';
import type { MapFilter } from '@layers/filter';
import type { Waypoint } from '@app/waypoints';
import { GLYPHS, traceGlyph } from '@ui/icons/glyphs';
import { structureKindFor } from '@ui/icons/structure-glyphs';
import { clusterStructures } from '@render/structure-clusters';
import { formatBlocks, measureBetween, type MeasurePoint } from '@app/measure';

export interface PaintOptions {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly camera: Camera;
  /** Enabled raster layers. Paint order is fixed by LayerDefinition.order (ADR 0007), independent
   * of this array's order -- see `orderLayersForPaint`. */
  readonly layers: readonly LayerId[];
  readonly showGrid: boolean;
  readonly tiles: TileManager;
  readonly palette: Record<string, number>;
  /** Alpha of translucent tokens (`ThemeTokens.alphas`); the grid's lines are drawn with it. */
  readonly alphas?: Record<string, number>;
  /** Per-layer opacity overrides (0..1); a layer with no entry paints at its own defaultOpacity
   * (ADR 0007, `resolveLayerOpacity`). Omit for every layer at its default. */
  readonly layerOpacity?: Partial<Record<LayerId, number>>;
  /** Current map filter, forwarded to the `filter` layer's tile request only -- every other
   * layer's `render` ignores it. Omit (or leave at `DEFAULT_MAP_FILTER`) for no filter active. */
  readonly filter?: MapFilter;
  /** Whether the `minerals` layer is enabled. `minerals` is a vector overlay, not a raster layer
   * (no `RasterLayer` registration in `@layers/index` -- it never belongs in `layers` above,
   * which drives the raster tile loop only), so it needs its own on/off switch here. */
  readonly showDeposits?: boolean;
  /** Deposit markers to draw when `showDeposits` is true, already resolved by the caller's
   * `FeatureManager` (per-region cache, AGENTS.md section 5) and already filtered to whatever ore
   * ids `MapState.oreFilter` selects -- painting never re-derives either, only draws what it is
   * given. */
  readonly deposits?: readonly DepositFeature[];
  /** Structure starts to draw when `showStructures` is true, already filtered by the caller. */
  readonly showStructures?: boolean;
  readonly structures?: readonly StructureFeature[];
  /** Feature ids the player marked as completed: drawn faded rather than hidden. */
  readonly completedStructures?: ReadonlySet<string>;
  /** Whether idle time may go to relief refinement. Off while higher-value work is loading. */
  readonly refine?: boolean;
  /** User markers are always visible and paint last, above map data and the optional grid. */
  readonly waypoints?: readonly Waypoint[];
  /** The measure tool's two ends, when it is armed (docs/PLAN.md 10d P1). */
  readonly measure?: { readonly a: MeasurePoint | null; readonly b: MeasurePoint | null };
}

// `orderLayersForPaint` (re-exported below) lives in `@layers/index` so the legend can sort its
// list the same way the canvas paints -- see docs/adr/0007-layer-compositing.md. The grid is never
// part of that list: `paintFrame` always draws it after every raster layer, unconditionally, so it
// (and, later, markers) stays on top regardless of what raster layers are enabled.
export { orderLayersForPaint } from '@layers/index';

export function paintFrame(opts: PaintOptions): void {
  const { ctx, width, height, camera, layers, tiles, palette } = opts;
  const layerOpacity = opts.layerOpacity ?? {};
  const bpp = blocksPerPixel(camera.zoom);
  const halfW = (width / 2) * bpp;
  const halfH = (height / 2) * bpp;
  const minBlockX = camera.centerX - halfW;
  const maxBlockX = camera.centerX + halfW;
  const minBlockZ = camera.centerZ - halfH;
  const maxBlockZ = camera.centerZ + halfH;

  ctx.fillStyle = colorToCss(tokenColour(palette, 'map-bg'));
  ctx.fillRect(0, 0, width, height);

  const span = tileSpanBlocks(camera.zoom);
  const drawSize = span / bpp;
  const minTx = Math.floor(minBlockX / span);
  const maxTx = Math.floor(maxBlockX / span);
  const minTz = Math.floor(minBlockZ / span);
  const maxTz = Math.floor(maxBlockZ / span);

  // Layers load in phases, in paint order: nothing is requested for a layer while an earlier one
  // still has tiles in flight. The base map therefore arrives first and is something to look at
  // while the relief on top of it is still being generated, instead of every layer competing for
  // the same workers and all of them landing late. Each finished tile repaints, so the chain
  // advances on its own; a tile that *fails* leaves the in-flight set too, so a broken layer
  // delays the next phase rather than stalling it forever.
  let earlierPhasePending = false;

  for (const layer of orderLayersForPaint(layers)) {
    const opacity = resolveLayerOpacity(layer, layerOpacity);
    if (!earlierPhasePending) {
      tiles.ensureVisible(
        layer,
        camera.zoom,
        minBlockX,
        minBlockZ,
        maxBlockX,
        maxBlockZ,
        palette,
        opts.filter,
      );
    }
    // Keep the last completed zoom visible as a slippy-map placeholder. Clip each fallback to a
    // missing current tile so transparent layers cannot leave stale boundaries over newly rendered
    // pixels, and so an exact tile always wins wherever it exists.
    //
    // *Every* cached tile overlapping the gap is drawn, not just one. Zooming in, one coarser tile
    // covers the whole gap and that is the end of it; zooming out, the tile being replaced is
    // smaller than the gap, so a single source would leave a patch in the middle of an empty square
    // — which is exactly what "it redraws from scratch when I zoom out" looked like. Coarsest first,
    // so finer detail lands on top where both exist.
    //
    // Looked up lazily, on the first missing tile: finding fallbacks scans the whole tile cache, and
    // on a pan over tiles that are already loaded — most frames — nothing is missing at all.
    let cachedFallbacks: CachedTile[] | undefined;
    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tiles.getTile(layer, camera.zoom, tx, tz)) continue;
        cachedFallbacks ??= tiles
          .getCachedTiles(layer, minBlockX, minBlockZ, maxBlockX, maxBlockZ)
          .filter((cached) => cached.zoom !== camera.zoom);
        const targetOriginX = tileOriginBlock(tx, camera.zoom);
        const targetOriginZ = tileOriginBlock(tz, camera.zoom);
        const targetScreen = blockToScreen(camera, width, height, targetOriginX, targetOriginZ);
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.rect(targetScreen.x, targetScreen.y, TILE_SIZE_PX, TILE_SIZE_PX);
        ctx.clip();
        const targetSpan = tileSpanBlocks(camera.zoom);
        const sources = cachedFallbacks
          .filter((cached) => {
            const span = tileSpanBlocks(cached.zoom);
            const originX = tileOriginBlock(cached.tileX, cached.zoom);
            const originZ = tileOriginBlock(cached.tileZ, cached.zoom);
            return (
              originX < targetOriginX + targetSpan &&
              originX + span > targetOriginX &&
              originZ < targetOriginZ + targetSpan &&
              originZ + span > targetOriginZ
            );
          })
          // Coarsest first: a finer tile drawn afterwards replaces the stretched pixels it covers.
          .sort((a, b) => b.zoom - a.zoom);
        for (const source of sources) {
          const sourceBpp = blocksPerPixel(source.zoom);
          const originX = tileOriginBlock(source.tileX, source.zoom);
          const originZ = tileOriginBlock(source.tileZ, source.zoom);
          const screen = blockToScreen(camera, width, height, originX, originZ);
          const drawSize = (TILE_SIZE_PX * sourceBpp) / bpp;
          ctx.drawImage(source.bitmap, screen.x, screen.y, drawSize, drawSize);
        }
        ctx.restore();
      }
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const bitmap = tiles.getTile(layer, camera.zoom, tx, tz);
        if (!bitmap) continue;
        const originX = tileOriginBlock(tx, camera.zoom);
        const originZ = tileOriginBlock(tz, camera.zoom);
        const screen = blockToScreen(camera, width, height, originX, originZ);
        ctx.drawImage(bitmap, screen.x, screen.y, drawSize, drawSize);
      }
    }
    ctx.restore();

    // Whatever this layer left in flight holds back every layer painted above it.
    if (tiles.pendingLayers().includes(layer)) earlierPhasePending = true;
  }

  // The last phase: once nothing at all is loading, spend the idle time re-rendering height-based
  // layers with a denser grid. The tile manager keeps it to a couple of requests at a time, so a
  // sharper picture never costs the whole machine, and a pan that starts new loads pauses it here.
  if (!earlierPhasePending && opts.refine !== false) {
    const maxDetail = maxUsefulDetail(bpp);
    for (const layer of layers) {
      if (getRasterLayer(layer)?.refinable) {
        tiles.refine(layer, camera.zoom, minBlockX, minBlockZ, maxBlockX, maxBlockZ, palette, maxDetail);
      }
    }
  }

  if (opts.showDeposits && opts.deposits && opts.deposits.length > 0) {
    paintDeposits(ctx, camera, width, height, opts.deposits, palette);
  }

  if (opts.showStructures && opts.structures && opts.structures.length > 0) {
    paintStructures(ctx, camera, width, height, opts.structures, opts.completedStructures ?? new Set(), palette);
  }

  if (opts.showGrid) paintGrid(ctx, camera, width, height, palette, opts.alphas ?? {});
  if (opts.waypoints && opts.waypoints.length > 0) {
    paintWaypoints(ctx, camera, width, height, opts.waypoints, palette);
  }
  if (opts.measure?.a && opts.measure.b) {
    paintMeasure(ctx, camera, width, height, opts.measure.a, opts.measure.b, palette);
  }
}

/**
 * Waypoint marker geometry, in CSS pixels and constant at every zoom (docs/DESIGN.md section 6).
 * A 28px square with a 3px bevelled edge and a 16px glyph: square because the Anvil language has no
 * radius, 28 because it is a multiple of the 4px grid and leaves the glyph its 16px rendering size
 * with room to breathe.
 */
const WAYPOINT_MARKER_PX = 28;
const WAYPOINT_EDGE_PX = 3;
const WAYPOINT_GLYPH_PX = 16;
/** Half the marker, for the off-screen cull. */
const WAYPOINT_RADIUS_PX = WAYPOINT_MARKER_PX / 2;

/**
 * Map labels sit on a plate, never directly on a biome (docs/DESIGN.md section 7). This is the fix
 * for the unreadable waypoint names reported on 2026-09-10: a stroked halo cannot survive both a
 * bright rainfall layer and a dark ocean, an opaque plate can.
 */
const LABEL_FONT_PX = 10;
const LABEL_PAD_X = 4;
const LABEL_PAD_Y = 3;
const LABEL_PLATE_EDGE_PX = 2;
const LABEL_GAP_PX = 4;

/**
 * Draws fixed-size user markers and suppresses labels that would overlap an earlier label.
 *
 * The glyph geometry is shared with the side panel's icon picker (`@ui/icons/glyphs`), so the
 * preview the user picks from and the marker drawn here are the same artwork — they used to be two
 * separate hand-written shapes, which is why they disagreed (docs/PLAN.md 10c P1).
 */
/** Structure marker: a bevelled square a little smaller than a waypoint, so the two never read alike. */
export const STRUCTURE_MARKER_PX = 22;
const STRUCTURE_EDGE_PX = 2;
const STRUCTURE_GLYPH_PX = 16;
/** A completed structure stays on the map, faded, so you can still see where you have been. */
const COMPLETED_STRUCTURE_ALPHA = 0.35;

export function paintStructures(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  structures: readonly StructureFeature[],
  completed: ReadonlySet<string>,
  palette: Record<string, number>,
): void {
  const edge = colorToCss(tokenColour(palette, 'bevel-lo'));
  const glyphColour = colorToCss(tokenColour(palette, 'accent-contrast'));
  const badgeText = colorToCss(tokenColour(palette, 'map-label'));
  const badgePlate = colorToCss(tokenColour(palette, 'map-label-plate'));
  const half = STRUCTURE_MARKER_PX / 2;
  const clusters = clusterStructures(
    structures,
    (x, z) => blockToScreen(camera, width, height, x, z),
    STRUCTURE_MARKER_PX,
  );
  ctx.save();
  ctx.font = `${LABEL_FONT_PX}px Silkscreen, 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const cluster of clusters) {
    if (cluster.screenX < -half || cluster.screenX > width + half || cluster.screenY < -half || cluster.screenY > height + half) {
      continue;
    }
    const kind = structureKindFor(cluster.setId);
    const x = Math.round(cluster.screenX - half);
    const y = Math.round(cluster.screenY - half);
    const inner = STRUCTURE_MARKER_PX - STRUCTURE_EDGE_PX * 2;
    // A group only fades once every structure in it is done.
    ctx.globalAlpha = cluster.members.every((m) => completed.has(m.id)) ? COMPLETED_STRUCTURE_ALPHA : 1;
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, STRUCTURE_MARKER_PX, STRUCTURE_MARKER_PX);
    ctx.fillStyle = colorToCss(palette[kind.colour] ?? tokenColour(palette, 'accent'));
    ctx.fillRect(x + STRUCTURE_EDGE_PX, y + STRUCTURE_EDGE_PX, inner, inner);
    ctx.fillStyle = glyphColour;
    traceGlyph(ctx, kind.glyph, x + half, y + half, STRUCTURE_GLYPH_PX);
    ctx.fill('evenodd');

    if (cluster.members.length > 1) {
      // The count sits on the marker's top-right corner, on a plate, so it reads over any biome.
      const label = cluster.members.length > 99 ? '99+' : String(cluster.members.length);
      const badgeWidth = Math.max(12, Math.ceil(ctx.measureText(label).width) + 6);
      const badgeX = x + STRUCTURE_MARKER_PX - badgeWidth / 2;
      const badgeY = y - 2;
      ctx.fillStyle = edge;
      ctx.fillRect(Math.round(badgeX - badgeWidth / 2) - 1, badgeY - 7, badgeWidth + 2, 14);
      ctx.fillStyle = badgePlate;
      ctx.fillRect(Math.round(badgeX - badgeWidth / 2), badgeY - 6, badgeWidth, 12);
      ctx.fillStyle = badgeText;
      ctx.fillText(label, Math.round(badgeX), badgeY + 1);
    }
  }
  ctx.restore();
}

export function paintWaypoints(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  waypoints: readonly Waypoint[],
  palette: Record<string, number>,
): void {
  const edge = colorToCss(tokenColour(palette, 'bevel-lo'));
  const glyphColour = colorToCss(tokenColour(palette, 'accent-contrast'));
  const labelColour = colorToCss(tokenColour(palette, 'map-label'));
  const plateColour = colorToCss(tokenColour(palette, 'map-label-plate'));
  const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  ctx.save();
  ctx.font = `${LABEL_FONT_PX}px Silkscreen, 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const waypoint of waypoints) {
    const screen = blockToScreen(camera, width, height, waypoint.x, waypoint.z);
    if (
      screen.x < -WAYPOINT_RADIUS_PX ||
      screen.x > width + WAYPOINT_RADIUS_PX ||
      screen.y < -WAYPOINT_RADIUS_PX ||
      screen.y > height + WAYPOINT_RADIUS_PX
    )
      continue;

    // Snap to whole pixels: a marker drawn on a half-pixel blurs its own edges, which is the one
    // thing this visual language cannot tolerate.
    const markerX = Math.round(screen.x - WAYPOINT_MARKER_PX / 2);
    const markerY = Math.round(screen.y - WAYPOINT_MARKER_PX / 2);
    const inner = WAYPOINT_MARKER_PX - WAYPOINT_EDGE_PX * 2;

    ctx.fillStyle = edge;
    ctx.fillRect(markerX, markerY, WAYPOINT_MARKER_PX, WAYPOINT_MARKER_PX);
    ctx.fillStyle = colorToCss(tokenColour(palette, waypoint.colour));
    ctx.fillRect(markerX + WAYPOINT_EDGE_PX, markerY + WAYPOINT_EDGE_PX, inner, inner);

    ctx.fillStyle = glyphColour;
    traceGlyph(
      ctx,
      GLYPHS[waypoint.icon],
      markerX + WAYPOINT_MARKER_PX / 2,
      markerY + WAYPOINT_MARKER_PX / 2,
      WAYPOINT_GLYPH_PX,
    );
    ctx.fill('evenodd');

    if (waypoint.label === '') continue;
    const textWidth = ctx.measureText(waypoint.label).width;
    const plateW = Math.round(textWidth) + LABEL_PAD_X * 2;
    const plateH = LABEL_FONT_PX + LABEL_PAD_Y * 2;
    const plateX = markerX + WAYPOINT_MARKER_PX + LABEL_GAP_PX;
    const plateY = Math.round(screen.y - plateH / 2);
    const bounds = { left: plateX, top: plateY, right: plateX + plateW, bottom: plateY + plateH };
    if (
      occupied.some(
        (box) =>
          bounds.left < box.right &&
          bounds.right > box.left &&
          bounds.top < box.bottom &&
          bounds.bottom > box.top,
      )
    )
      continue;
    occupied.push(bounds);

    // Sunken plate: dark edge, then the plate ground, then the text.
    ctx.fillStyle = edge;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.fillStyle = plateColour;
    ctx.fillRect(
      plateX + LABEL_PLATE_EDGE_PX,
      plateY + LABEL_PLATE_EDGE_PX,
      plateW - LABEL_PLATE_EDGE_PX * 2,
      plateH - LABEL_PLATE_EDGE_PX * 2,
    );
    ctx.fillStyle = labelColour;
    ctx.fillText(waypoint.label, plateX + LABEL_PAD_X, plateY + plateH / 2);
  }
  ctx.restore();
}

/**
 * Draws the measure line: a hard 2px line with square end caps and the distance on a sunken plate
 * at its midpoint (docs/DESIGN.md sections 3 and 7 -- nothing blurs, and no text sits directly on a
 * biome). The end markers are squares for the same reason the waypoint markers are.
 */
export function paintMeasure(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  a: MeasurePoint,
  b: MeasurePoint,
  palette: Record<string, number>,
): void {
  const from = blockToScreen(camera, width, height, a.x, a.z);
  const to = blockToScreen(camera, width, height, b.x, b.z);
  const line = colorToCss(tokenColour(palette, 'accent'));
  const edge = colorToCss(tokenColour(palette, 'bevel-lo'));
  const plate = colorToCss(tokenColour(palette, 'map-label-plate'));
  const text = colorToCss(tokenColour(palette, 'map-label'));

  ctx.save();
  // A dark line underneath keeps the accent readable over a light biome as well as a dark one.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = edge;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(Math.round(from.x), Math.round(from.y));
  ctx.lineTo(Math.round(to.x), Math.round(to.y));
  ctx.stroke();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const point of [from, to]) {
    const x = Math.round(point.x) - MEASURE_END_PX / 2;
    const y = Math.round(point.y) - MEASURE_END_PX / 2;
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, MEASURE_END_PX, MEASURE_END_PX);
    ctx.fillStyle = line;
    ctx.fillRect(x + 2, y + 2, MEASURE_END_PX - 4, MEASURE_END_PX - 4);
  }

  // The unit through i18n like every other display string (found 2026-09-25).
  const label = `${formatBlocks(measureBetween(a, b).blocks)} ${en.measure.blocks}`;
  ctx.font = `${LABEL_FONT_PX}px Silkscreen, 'Courier New', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const w = Math.round(ctx.measureText(label).width) + LABEL_PAD_X * 2;
  const h = LABEL_FONT_PX + LABEL_PAD_Y * 2;
  const midX = Math.round((from.x + to.x) / 2 - w / 2);
  const midY = Math.round((from.y + to.y) / 2 - h / 2);
  ctx.fillStyle = edge;
  ctx.fillRect(midX, midY, w, h);
  ctx.fillStyle = plate;
  ctx.fillRect(
    midX + LABEL_PLATE_EDGE_PX,
    midY + LABEL_PLATE_EDGE_PX,
    w - LABEL_PLATE_EDGE_PX * 2,
    h - LABEL_PLATE_EDGE_PX * 2,
  );
  ctx.fillStyle = text;
  ctx.fillText(label, midX + LABEL_PAD_X, midY + h / 2);
  ctx.restore();
}

/** Side of the square drawn at each end of a measure line. */
const MEASURE_END_PX = 10;

/** Radius, in CSS pixels, of a deposit marker dot -- independent of zoom (AGENTS.md 1a: this is a
 * map marker, not a to-scale rendering of the vein's real `size`/`height`, which are recorded on
 * the feature for the click readout instead). */
const DEPOSIT_MARKER_RADIUS_PX = 5;

/**
 * Draws every deposit marker in screen space as a small filled-and-outlined dot -- the outline
 * uses the same `--marker-outline` token every other marker in the project would use (kept
 * distinct from the mineral fill colour so a marker stays legible over both light and dark map
 * tiles). One draw call per marker: the `minerals` layer's marker count per viewport is bounded by
 * the sparse per-chunk rarity check (`docs/WORLDGEN-NOTES.md`'s "Ore veins" section), nowhere near
 * the per-pixel volume the raster loop above has to manage.
 */
function paintDeposits(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  deposits: readonly DepositFeature[],
  palette: Record<string, number>,
): void {
  const outline = colorToCss(tokenColour(palette, 'marker-outline'));
  ctx.save();
  for (const deposit of deposits) {
    const screen = blockToScreen(camera, width, height, deposit.x, deposit.z);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, DEPOSIT_MARKER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = colorToCss(oreMarkerColor(deposit.ore, palette));
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Smallest on-screen gap, in CSS pixels, an adjacent pair of grid lines may have before the grid
 * stops being a readable line spacing and starts being a texture instead (FEEDBACK.md section 5:
 * "at a zoom where the scale bar reads 5k blocks, the grid is drawn so densely it becomes a
 * texture over the whole map"). 24px is chosen, not the bare few pixels anti-aliasing alone would
 * need to keep two 1px strokes visually distinct: the grid draws in *both* directions, so the
 * relevant unit is the resulting cell size, not a single line's gap, and a person needs a cell of
 * a few dozen pixels on a side to read it as "a chunk boundary I could click on", not a moire wash.
 * Below this threshold there is nothing useful left to show at that spacing, so the next coarser
 * level is tried instead of just letting the lines get closer together.
 */
export const MIN_GRID_LINE_SPACING_PX = 24;

export type GridLevel = 'chunk' | 'region' | 'none';

/**
 * Picks how the grid should render at a given zoom: chunk lines (16 blocks) when they are at
 * least `MIN_GRID_LINE_SPACING_PX` apart on screen, else region lines (512 blocks, Minecraft's own
 * region-file grid -- see `MC_REGION_SIZE`'s doc comment) when *those* are far enough apart, else
 * nothing at all rather than a dense wash. Pure function of `blocksPerPixel` so it is unit-testable
 * without a canvas (`tests/unit/painter.test.ts`).
 */
export function chooseGridLevel(bpp: number): GridLevel {
  if (CHUNK_SIZE / bpp >= MIN_GRID_LINE_SPACING_PX) return 'chunk';
  if (MC_REGION_SIZE / bpp >= MIN_GRID_LINE_SPACING_PX) return 'region';
  return 'none';
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  palette: Record<string, number>,
  alphas: Record<string, number>,
): void {
  const bpp = blocksPerPixel(camera.zoom);
  const level = chooseGridLevel(bpp);
  if (level === 'none') return;

  ctx.save();
  ctx.lineWidth = 1;

  if (level === 'chunk') {
    ctx.strokeStyle = colorToCss(palette['map-grid'] ?? 0, alphas['map-grid'] ?? 0.5);
    drawGridLines(ctx, camera, width, height, CHUNK_SIZE, bpp);
  }

  ctx.strokeStyle = colorToCss(palette['map-grid-strong'] ?? 0, alphas['map-grid-strong'] ?? 0.7);
  drawGridLines(ctx, camera, width, height, MC_REGION_SIZE, bpp);

  ctx.restore();
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  spacingBlocks: number,
  bpp: number,
): void {
  const minBlockX = camera.centerX - (width / 2) * bpp;
  const maxBlockX = camera.centerX + (width / 2) * bpp;
  const minBlockZ = camera.centerZ - (height / 2) * bpp;
  const maxBlockZ = camera.centerZ + (height / 2) * bpp;

  ctx.beginPath();
  const startX = Math.floor(minBlockX / spacingBlocks) * spacingBlocks;
  for (let x = startX; x <= maxBlockX; x += spacingBlocks) {
    const sx = (x - camera.centerX) / bpp + width / 2;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }
  const startZ = Math.floor(minBlockZ / spacingBlocks) * spacingBlocks;
  for (let z = startZ; z <= maxBlockZ; z += spacingBlocks) {
    const sy = (z - camera.centerZ) / bpp + height / 2;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();
}

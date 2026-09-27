/**
 * Every coordinate conversion in the project lives here. See docs/ARCHITECTURE.md for the spaces.
 *
 * Zoom is an integer exponent: blocksPerPixel = 2^zoom. Negative zoom magnifies.
 */

export const CHUNK_SIZE = 16;
export const QUART_SIZE = 4;
/** Vanilla region files. TFC's own worldgen region grid is separate and still to be confirmed. */
export const MC_REGION_SIZE = 512;
export const TILE_SIZE_PX = 256;

/** Zoomed out enough that one pixel already covers 1024 blocks. */
export const MAX_ZOOM = 10;
/** Zoomed in enough that one block already covers 16 pixels. */
export const MIN_ZOOM = -4;

/**
 * `floorDiv` / `floorMod` live in `@core/math` (Java numeric semantics helpers) — re-exported here
 * so existing coordinate-space call sites and imports of this module keep working.
 */
export { floorDiv, floorMod } from '@core/math';

export function blockToChunk(block: number): number {
  return block >> 4;
}

export function chunkToBlock(chunk: number): number {
  return chunk << 4;
}

export function blockToQuart(block: number): number {
  return block >> 2;
}

export function blockToMcRegion(block: number): number {
  return block >> 9;
}

export function blocksPerPixel(zoom: number): number {
  return 2 ** zoom;
}

/** Blocks covered by one tile edge at the given zoom. */
export function tileSpanBlocks(zoom: number): number {
  return TILE_SIZE_PX * blocksPerPixel(zoom);
}

export function blockToTile(block: number, zoom: number): number {
  return Math.floor(block / tileSpanBlocks(zoom));
}

export function tileOriginBlock(tile: number, zoom: number): number {
  return tile * tileSpanBlocks(zoom);
}

/**
 * The map camera: world-space centre (in blocks) and an integer zoom exponent
 * (blocksPerPixel = 2^zoom). Pure data — no DOM, no canvas.
 */
export interface Camera {
  readonly centerX: number;
  readonly centerZ: number;
  readonly zoom: number;
}

export interface BlockPoint {
  readonly x: number;
  readonly z: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Converts a canvas-space pixel to the world block position under it. */
export function screenToBlock(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
): BlockPoint {
  const bpp = blocksPerPixel(camera.zoom);
  return {
    x: camera.centerX + (screenX - canvasWidth / 2) * bpp,
    z: camera.centerZ + (screenY - canvasHeight / 2) * bpp,
  };
}

/** Converts a world block position to the canvas-space pixel it paints at. */
export function blockToScreen(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  blockX: number,
  blockZ: number,
): ScreenPoint {
  const bpp = blocksPerPixel(camera.zoom);
  return {
    x: canvasWidth / 2 + (blockX - camera.centerX) / bpp,
    y: canvasHeight / 2 + (blockZ - camera.centerZ) / bpp,
  };
}

/**
 * Returns the camera at `newZoom` such that the world point currently under the cursor
 * (`screenX`, `screenY`) stays under the cursor — the standard "zoom toward cursor" behaviour.
 */
export function zoomAround(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
  newZoom: number,
): Camera {
  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(newZoom)));
  const worldPoint = screenToBlock(camera, canvasWidth, canvasHeight, screenX, screenY);
  const bppNew = blocksPerPixel(clampedZoom);
  return {
    centerX: worldPoint.x - (screenX - canvasWidth / 2) * bppNew,
    centerZ: worldPoint.z - (screenY - canvasHeight / 2) * bppNew,
    zoom: clampedZoom,
  };
}

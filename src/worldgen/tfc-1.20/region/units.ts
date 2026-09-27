/**
 * `net.dries007.tfc.world.region.Units`: coordinate-space conversions for the region generator.
 * CONFIRMED against source (see docs/WORLDGEN-NOTES.md — this replaces the "(unconfirmed)" notes
 * from Phase 1/2):
 *
 * - **Grid**: the smallest unit the region system generates. `1 Grid = 128 Blocks`
 *   (`GRID_BITS = 7`).
 * - **Cell** (= one `Region`'s ownership area): `1 Cell = 96 Grid = 12,288 Blocks`
 *   (`CELL_WIDTH_IN_GRID = 32 * 3`).
 * - **Partition**: `1 Partition = 3 Grid = 384 Blocks` — only used for river bookkeeping
 *   (`RegionPartition`), out of scope for climate (Phase 3); ported here anyway since it is three
 *   constants and keeps this file a complete, citable transcription of `Units.java`.
 * - A `Region` object's *storage* is larger than one cell: `REGION_RADIUS_IN_GRID = 100` grid units
 *   past the cell's nominal centre in every direction (`CELL_WIDTH_IN_GRID + 4`), because
 *   `Region.Point`s are stored for every grid coordinate that *could* belong to the cell before
 *   `ShrinkToCell` crops the array down to the actual owned bounding box.
 */
import { floorDiv } from '@core/math';

export const PARTITION_BITS = 5;
export const PARTITION_BIT_MASK = (1 << PARTITION_BITS) - 1;
export const PARTITION_WIDTH_IN_GRID = 3;

export const CELL_WIDTH_IN_PARTITION = 1 << PARTITION_BITS;
export const CELL_WIDTH_IN_GRID = CELL_WIDTH_IN_PARTITION * PARTITION_WIDTH_IN_GRID;

export const REGION_RADIUS_IN_GRID = CELL_WIDTH_IN_GRID + 4;
export const REGION_WIDTH_IN_GRID = 1 + 2 * REGION_RADIUS_IN_GRID;

export const QUART_BITS = 2;
export const GRID_BITS = 7;

export const GRID_WIDTH_IN_BLOCK = 1 << GRID_BITS;
export const GRID_WIDTH_IN_QUART = 1 << (GRID_BITS - QUART_BITS);

export function cellToPart(cell: number): number {
  return cell << PARTITION_BITS;
}

export function partToCell(part: number): number {
  return part >> PARTITION_BITS;
}

export function gridToCell(grid: number): number {
  return floorDiv(grid, CELL_WIDTH_IN_GRID);
}

export function cellToGrid(cell: number): number {
  return cell * CELL_WIDTH_IN_GRID;
}

export function gridToPart(grid: number): number {
  return floorDiv(grid, PARTITION_WIDTH_IN_GRID);
}

export function partToGrid(part: number): number {
  return part * PARTITION_WIDTH_IN_GRID;
}

export function quartToGrid(quart: number): number {
  return quart >> (GRID_BITS - QUART_BITS);
}

export function quartToGridExact(quart: number): number {
  return quart / GRID_WIDTH_IN_QUART;
}

export function gridToQuart(grid: number): number {
  return grid << (GRID_BITS - QUART_BITS);
}

export function blockToGridExact(block: number): number {
  return block / GRID_WIDTH_IN_BLOCK;
}

export function blockToGrid(block: number): number {
  return block >> GRID_BITS;
}

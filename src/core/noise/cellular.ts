/**
 * Cellular (Worley) noise: distance to the nearest of several pseudo-random feature points, one per
 * grid cell of unit size (scale the input coordinates to change cell size). A general-purpose
 * primitive, not tied to a specific Java/vanilla source — TFC's region generator is described
 * (docs/WORLDGEN-NOTES.md) as plate-tectonics-like, which typically leans on a cellular/Voronoi
 * partition for plate boundaries; the exact algorithm TFC uses is still unconfirmed.
 *
 * Deterministic given `(seed, x, y)`: each cell's feature point comes from hashing the cell's own
 * integer coordinates plus the seed, never from external mutable RNG state, so sampling order and
 * sampling density never change the result — required for a tileable, on-demand map renderer.
 *
 * @unverified General algorithm, no Java source to pin a fixture to.
 */

import { imul32 } from '@core/math';

export interface CellularResult {
  /** Euclidean distance from the sample point to the nearest feature point, in cell units. */
  distance: number;
  /** Integer coordinates of the cell holding the nearest feature point. */
  cellX: number;
  cellY: number;
}

/** A small, fast integer hash (a 32-bit variant in the MurmurHash3-finalizer family). */
function hash2(seed: number, x: number, y: number): number {
  let h = (imul32(x, 0x27d4eb2f) ^ imul32(y, 0x165667b1) ^ imul32(seed, 0x9e3779b1)) | 0;
  h = imul32(h ^ (h >>> 15), 0x85ebca6b);
  h = imul32(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

function featurePoint(seed: number, cellX: number, cellY: number): { x: number; y: number } {
  const h = hash2(seed, cellX, cellY);
  const fx = (h & 0xffff) / 0xffff;
  const fy = ((h >>> 16) & 0xffff) / 0xffff;
  return { x: cellX + fx, y: cellY + fy };
}

/** Samples cellular noise at `(x, y)`. */
export function cellular(seed: number, x: number, y: number): CellularResult {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = Infinity;
  let bestCellX = cx;
  let bestCellY = cy;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const p = featurePoint(seed, gx, gy);
      const ddx = p.x - x;
      const ddy = p.y - y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < best) {
        best = d;
        bestCellX = gx;
        bestCellY = gy;
      }
    }
  }
  return { distance: best, cellX: bestCellX, cellY: bestCellY };
}

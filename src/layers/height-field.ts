/**
 * A tile's surface height, sampled coarsely and interpolated (docs/PLAN.md section 11).
 *
 * ## Why this exists
 *
 * The terrain layer sampled `surfaceY` once per pixel. Measured on seed 0, a 256x256 tile:
 *
 * | blocks per pixel | terrain tile | biome tile, for scale |
 * | ---------------- | ------------ | --------------------- |
 * | 0.25             | 1 334 ms     | 38 ms                 |
 * | 1                | 2 337 ms     | 56 ms                 |
 * | 4                | 4 328 ms     | 257 ms                |
 * | 16               | 45 048 ms    | 749 ms                |
 *
 * Forty-five seconds for one tile. The cause is not the height maths but the per-chunk 7x7 quart
 * biome blend underneath it: a cold chunk costs ~0.55 ms and further columns in that same chunk
 * ~0.02 ms. Zoomed out, consecutive pixels land in different chunks, so every one of the 65 536
 * pixels pays the cold price.
 *
 * This is exactly the case CLAUDE.md section 5 legislates for: "where 1 px covers many blocks,
 * sample at reduced resolution — do not generate 65 536 blocks to paint 256 pixels."
 *
 * ## What it does instead
 *
 * Samples a fixed budget of grid nodes per tile and bilinearly interpolates between them, so tile
 * cost stops depending on zoom. The budget is a count, not a spacing, because the cost that matters
 * is the number of distinct chunks touched.
 *
 * **Nodes are snapped to a global lattice**, not laid out relative to the tile. Two neighbouring
 * tiles therefore sample the *same* node positions along their shared border and interpolate to the
 * same value, so there is no seam. Laying the grid out from each tile's own origin is the obvious
 * implementation and it produces a visible crack down every tile boundary.
 *
 * ## What this costs in accuracy, and where it does not apply
 *
 * Between nodes the height is interpolated, so relief finer than the node spacing is smoothed away.
 * Zoomed in the spacing is a fraction of a block and the field is effectively exact; zoomed out a
 * node covers several pixels, which is invisible for shaded relief and mild for the height ramp.
 *
 * This affects **pictures only**. The probe readout, deposit depth and everything else that reports
 * a number call `generator.surfaceY` directly and get the exact value. Nothing derived from this
 * field is ever presented as an exact height. See docs/PARITY.md.
 */
import type { WorldGenerator } from '@worldgen/api/types';

/**
 * Grid nodes along one edge of a tile. 32 keeps a 256 px tile at ~1 000 samples whatever the zoom,
 * which is the number of chunk builds that sets the cost.
 */
const NODES_PER_TILE = 32;

/**
 * Background refinement steps above the normal grid, each doubling the nodes along a tile edge.
 * A ceiling, not a target: `maxUsefulDetail` stops a tile as soon as another step could not show —
 * one node per pixel, or per block — which at a 256 px tile is detail 3. Past that a step is 4x the
 * work and memory (detail 7 would be a 4096x4096 grid, ~130 MB for one tile) for identical pixels.
 */
export const MAX_TERRAIN_DETAIL = 7;

/** Grid nodes along one tile edge at a refinement `detail` (0 is the normal grid). */
export function nodesForDetail(detail: number): number {
  return NODES_PER_TILE << Math.max(0, Math.min(MAX_TERRAIN_DETAIL, Math.floor(detail)));
}

/**
 * The finest detail worth rendering at a zoom. Zoomed far enough in, a denser grid would put nodes
 * less than a block apart — sampling the same columns again and changing nothing but the cost.
 */
export function maxUsefulDetail(blocksPerPixel: number, size = 256): number {
  let detail = 0;
  while (
    detail < MAX_TERRAIN_DETAIL &&
    nodesForDetail(detail + 1) <= size &&
    (size * blocksPerPixel) / nodesForDetail(detail + 1) >= 1
  ) {
    detail++;
  }
  return detail;
}

/** One margin node on each side, so gradients at the tile edge have neighbours to read. */
const MARGIN = 1;

export interface HeightField {
  /** False when the profile has no height field at all — `tfg` today. Nothing is sampled then. */
  readonly available: boolean;
  /** Interpolated surface height at a pixel centre within the tile. */
  heightAt(pixelX: number, pixelZ: number): number;
  /** Blocks between grid nodes, which is the scale below which relief is smoothed away. */
  readonly nodeSpacingInBlocks: number;
}

const UNAVAILABLE: HeightField = {
  available: false,
  heightAt: () => 0,
  nodeSpacingInBlocks: 0,
};

/**
 * Samples the tile's height field once, up front. Call this at the top of a layer's `render` and
 * then read `heightAt` per pixel.
 */
export function sampleHeightField(
  generator: WorldGenerator,
  originX: number,
  originZ: number,
  size: number,
  blocksPerPixel: number,
  /** Nodes along a tile edge; `nodesForDetail` for a refined render. */
  nodesPerTile: number = NODES_PER_TILE,
): HeightField {
  if (generator.surfaceY(originX, originZ) === null) return UNAVAILABLE;

  // At least one block between nodes: sampling the same column twice buys nothing.
  const spacing = Math.max(1, Math.round((size * blocksPerPixel) / nodesPerTile));
  // Snap to the global lattice so neighbouring tiles share their border nodes exactly.
  const firstNodeX = Math.floor(originX / spacing) - MARGIN;
  const firstNodeZ = Math.floor(originZ / spacing) - MARGIN;
  const nodes = Math.ceil((size * blocksPerPixel) / spacing) + 1 + 2 * MARGIN;

  const heights = new Float64Array(nodes * nodes);
  for (let nz = 0; nz < nodes; nz++) {
    const blockZ = (firstNodeZ + nz) * spacing;
    for (let nx = 0; nx < nodes; nx++) {
      const blockX = (firstNodeX + nx) * spacing;
      heights[nz * nodes + nx] = generator.surfaceY(blockX, blockZ) ?? 0;
    }
  }

  return {
    available: true,
    nodeSpacingInBlocks: spacing,
    heightAt(pixelX, pixelZ) {
      // Where this pixel falls in node space, as a fractional index into the grid.
      const nodeX = (originX + pixelX * blocksPerPixel) / spacing - firstNodeX;
      const nodeZ = (originZ + pixelZ * blocksPerPixel) / spacing - firstNodeZ;

      let x0 = Math.floor(nodeX);
      let z0 = Math.floor(nodeZ);
      const fx = nodeX - x0;
      const fz = nodeZ - z0;
      // Clamp into the grid rather than reading past its edge; the margin makes this rare.
      if (x0 < 0) x0 = 0;
      if (z0 < 0) z0 = 0;
      if (x0 > nodes - 2) x0 = nodes - 2;
      if (z0 > nodes - 2) z0 = nodes - 2;

      const row = z0 * nodes + x0;
      const h00 = heights[row] ?? 0;
      const h10 = heights[row + 1] ?? 0;
      const h01 = heights[row + nodes] ?? 0;
      const h11 = heights[row + nodes + 1] ?? 0;
      const top = h00 + (h10 - h00) * fx;
      const bottom = h01 + (h11 - h01) * fx;
      return top + (bottom - top) * fz;
    },
  };
}

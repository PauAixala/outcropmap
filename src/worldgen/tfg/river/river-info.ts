/**
 * The nearest river to a column, for the `tfg` profile.
 *
 * `TFGChunkHeightFiller.sampleRiverEdge` is character for character TFC's — same limit, same
 * "nearest by distance over width²" rule, same late conversion from grid² to block². What differs is
 * the edge: TerraFirmaGreg builds its own river graph (`region/rivers.ts`), so the distance and
 * bounding tests come from there rather than from TFC's `MidpointFractal`.
 *
 * Nearest by `distance / width²` rather than by distance: a wide river further away shapes a column
 * more than a narrow one nearby, and the plain minimum picks the wrong edge wherever widths differ.
 */
import { lerp } from '@worldgen/tfc-1.20/noise/noise2d';
import { GRID_WIDTH_IN_BLOCK } from '@worldgen/tfc-1.20/region/units';
import type { RiverInfo } from '@worldgen/tfc-1.20/river/river-height';
import { riverDistanceSq, riverMaybeIntersects, type TFGRiverEdge } from '../region/rivers';

/** `50 * 50` blocks, in grid units squared — rivers further away cannot reach the column. */
const LIMIT_DIST_IN_GRID_SQ = (50 * 50) / (GRID_WIDTH_IN_BLOCK * GRID_WIDTH_IN_BLOCK);

/** `Mth.clamp` of the projection of a point onto a line, in [0, 1]. */
function projectAlongLine(
  vx: number,
  vz: number,
  wx: number,
  wz: number,
  px: number,
  pz: number,
): number {
  const l2 = (wx - vx) ** 2 + (wz - vz) ** 2;
  if (l2 === 0) return 0;
  const t = ((px - vx) * (wx - vx) + (pz - vz) * (wz - vz)) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * `RiverEdge.widthSq(double, double)`, TFC's class, which TFG reuses unchanged.
 *
 * **Reproduces an upstream bug on purpose**, the same one `tfc-1.20`'s port records: TFC passes the
 * drain's *z* as both coordinates of the far point, so the projection runs against `(drainZ, drainZ)`
 * rather than against the drain. Correcting it would put our rivers in different valleys from the
 * player's. CLAUDE.md section 2, rule 1.
 */
function widthSqAt(edge: TFGRiverEdge, gridX: number, gridZ: number): number {
  const factor = projectAlongLine(
    edge.sourceX,
    edge.sourceZ,
    edge.drainZ,
    edge.drainZ,
    gridX,
    gridZ,
  );
  const width = lerp(factor, edge.width, edge.downstream?.width ?? edge.width);
  return width * width;
}

/**
 * The edges that could shape any column of one chunk — a conservative filter, run once per chunk
 * instead of the whole partition's list once per column.
 *
 * Measured: 89% of columns have no river in reach, yet each was walking every edge in its partition.
 * The chunk's bounding radius is half its diagonal plus the reach, so anything this drops could not
 * have been the nearest edge for any column in the chunk. Returns the same array when nothing is
 * dropped, so the common "no rivers here at all" case allocates nothing.
 */
export function riverEdgesNearChunk(
  edges: readonly TFGRiverEdge[],
  chunkX: number,
  chunkZ: number,
): readonly TFGRiverEdge[] {
  if (edges.length === 0) return edges;
  // Centre of the chunk in grid units, and a radius covering every column in it.
  const gridX = (chunkX * 16 + 8) / GRID_WIDTH_IN_BLOCK;
  const gridZ = (chunkZ * 16 + 8) / GRID_WIDTH_IN_BLOCK;
  const reach = Math.sqrt(LIMIT_DIST_IN_GRID_SQ) + (8 * Math.SQRT2) / GRID_WIDTH_IN_BLOCK;
  const near: TFGRiverEdge[] = [];
  for (const edge of edges) {
    if (riverMaybeIntersects(edge, gridX, gridZ, reach * reach)) near.push(edge);
  }
  return near.length === edges.length ? edges : near;
}

/** The river that shapes this column, or `null` when none is close enough to matter. */
export function sampleTFGRiverEdge(
  edges: readonly TFGRiverEdge[],
  blockX: number,
  blockZ: number,
): RiverInfo | null {
  let minDist = LIMIT_DIST_IN_GRID_SQ;
  let minDistAdjusted = Number.MAX_VALUE;
  let minEdge: TFGRiverEdge | null = null;

  const gridX = blockX / GRID_WIDTH_IN_BLOCK;
  const gridZ = blockZ / GRID_WIDTH_IN_BLOCK;

  for (const edge of edges) {
    if (!riverMaybeIntersects(edge, gridX, gridZ, minDist)) continue;
    const dist = riverDistanceSq(edge, gridX, gridZ);
    if (dist >= LIMIT_DIST_IN_GRID_SQ) continue;
    const adjusted = dist / (edge.width * edge.width);
    if (adjusted < minDistAdjusted) {
      minDist = dist;
      minDistAdjusted = adjusted;
      minEdge = edge;
    }
  }

  if (minEdge === null) return null;
  return {
    // The valley samplers only read `distSq` and `widthSq`; the edge is carried for parity with
    // TFC's `RiverInfo` shape.
    edge: minEdge as never,
    // Java converts grid² to block² here, and not before.
    distSq: minDist * GRID_WIDTH_IN_BLOCK * GRID_WIDTH_IN_BLOCK,
    widthSq: widthSqAt(minEdge, gridX, gridZ),
  };
}

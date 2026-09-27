/**
 * River contributions to surface height — `ChunkHeightFiller.adjustHeightForRiverContributions`
 * and the four samplers in `net.dries007.tfc.world.river.RiverNoise` (TFC 1.20.x).
 *
 * This is what carves the valley a river runs in. Without it the height field is the biome blend
 * alone, so a river shows on the biome layer while the ground beneath it stays at full height — the
 * declared approximation in `docs/PARITY.md` that this removes.
 *
 * ## What is ported and what is not
 *
 * Each `RiverNoiseSampler` has two halves. `setColumnAndSampleHeight` returns the column's surface
 * height, and `noise(y, noiseIn)` shapes the 3D density above it. **Only the height half is here**,
 * because this project has no 3D density pass — it draws maps, not chunks. The `CAVE` blend type is
 * the one where that matters: its height depends on `caveWeight`, which comes from the cave carvers,
 * and those are not ported. See `riverBlendWeights` below for how that is handled honestly.
 *
 * `RiverInfo.flow` is also omitted: nothing on the height path reads it.
 */
import { OpenSimplex2D } from '../noise/open-simplex-2d';
import { clamp, clamped } from '../noise/noise2d';
import { mthLerp } from '../region/mth';
import { GRID_WIDTH_IN_BLOCK, blockToGridExact } from '../region/units';
import type { RiverEdge } from './river-edge';

/** `TFCChunkGenerator.SEA_LEVEL_Y`. */
const SEA_LEVEL_Y = 63;

/**
 * `ChunkHeightFiller.sampleRiverEdge`'s cutoff: only rivers within 50 blocks can affect a column,
 * expressed as a squared distance in grid units.
 */
const LIMIT_DIST_IN_GRID_SQ = Math.fround(50 * 50) / (GRID_WIDTH_IN_BLOCK * GRID_WIDTH_IN_BLOCK);

/** `RiverHelpers.norm2` — the squared euclidean norm. */
function norm2(x: number, y: number): number {
  return x * x + y * y;
}

/**
 * `RiverHelpers.projectAlongLine`: where a point projects onto segment `v -> w`, clamped to [0, 1].
 */
function projectAlongLine(
  vx: number,
  vy: number,
  wx: number,
  wy: number,
  px: number,
  py: number,
): number {
  const l2 = norm2(vx - wx, vy - wy);
  if (l2 === 0) return l2;
  return clamp(((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2, 0, 1);
}

/**
 * `RiverEdge.widthSq(double, double)`: the width at this point, interpolated from the edge's own
 * width toward the width of whatever it drains into.
 *
 * **Reproduces an upstream bug on purpose.** TFC passes `drain().y(), drain().y()` where the
 * signature wants `wx, wy` — the drain's *y* is used as both coordinates, so the projection is
 * against a line to `(drainY, drainY)` rather than to the drain. That skews the interpolation
 * factor everywhere the drain's x and y differ, which is almost everywhere. It is not our bug to
 * fix: the game generates the terrain this produces, and "correcting" it here would put our rivers
 * in different valleys from the player's. CLAUDE.md section 2, rule 1.
 */
function widthSqAt(edge: RiverEdge, exactGridX: number, exactGridZ: number): number {
  const lerpFactor = projectAlongLine(
    edge.source.x,
    edge.source.y,
    edge.drain.y,
    edge.drain.y,
    exactGridX,
    exactGridZ,
  );
  const realWidth = mthLerp(lerpFactor, edge.width, edge.drainEdge === null ? edge.width : edge.drainEdge.width);
  return realWidth * realWidth;
}

/** `net.dries007.tfc.world.river.RiverInfo`, minus the flow this project does not use. */
export interface RiverInfo {
  readonly edge: RiverEdge;
  /** Squared distance to the river centreline, in **blocks**. */
  readonly distSq: number;
  /** Squared river width at this point, in grid units. */
  readonly widthSq: number;
}

/** `RiverInfo.normDistSq`: 0 at the centre of the river, ~1 at its edge. */
function normDistSq(info: RiverInfo): number {
  return info.distSq / info.widthSq;
}

/**
 * `ChunkHeightFiller.sampleRiverEdge`: the nearest river edge to a column, or `null` when none is
 * close enough to matter.
 *
 * Nearest by `distance / width²`, not by distance: a wide river further away affects a column more
 * than a narrow one nearby, and taking the plain minimum picks the wrong edge wherever widths
 * differ.
 */
export function sampleRiverEdge(
  edges: readonly RiverEdge[],
  blockX: number,
  blockZ: number,
): RiverInfo | null {
  let minDist = LIMIT_DIST_IN_GRID_SQ;
  let minDistAdjusted = Number.MAX_VALUE;
  let minEdge: RiverEdge | null = null;

  const exactGridX = blockToGridExact(blockX);
  const exactGridZ = blockToGridExact(blockZ);

  for (const edge of edges) {
    if (!edge.fractal.maybeIntersect(exactGridX, exactGridZ, minDist)) continue;
    const dist = edge.fractal.intersectDistanceSq(exactGridX, exactGridZ);
    if (dist >= LIMIT_DIST_IN_GRID_SQ) continue;
    const distAdjusted = dist / edge.widthSq;
    if (distAdjusted < minDistAdjusted) {
      minDist = dist;
      minDistAdjusted = distAdjusted;
      minEdge = edge;
    }
  }

  if (minEdge === null) return null;
  return {
    edge: minEdge,
    // Java converts the grid-squared distance to blocks-squared here, and not before.
    distSq: minDist * GRID_WIDTH_IN_BLOCK * GRID_WIDTH_IN_BLOCK,
    widthSq: widthSqAt(minEdge, exactGridX, exactGridZ),
  };
}

/** `net.dries007.tfc.world.river.RiverBlendType`, in declaration order — the array index matters. */
export const enum RiverBlend {
  NONE,
  WIDE,
  CANYON,
  TALL_CANYON,
  CAVE,
}

export const RIVER_BLEND_COUNT = 5;

/** The height half of one `RiverNoiseSampler`. */
type HeightSampler = (info: RiverInfo, x: number, z: number, heightIn: number) => number;

/**
 * The four samplers, built once per seed. Each takes the biome-blended height and returns the
 * height the river carves it down to — always `min(riverHeight, heightIn)`, so a river can only
 * lower ground, never raise it.
 */
export class RiverHeightSamplers {
  private readonly wide: HeightSampler;
  private readonly canyon: HeightSampler;
  private readonly tallCanyon: HeightSampler;

  constructor(seed: bigint) {
    // `RiverNoise.wide`.
    const wideBase = new OpenSimplex2D(seed).octaves(4).spread(Math.fround(0.05)).scaled(-2.5, 1.5);
    const wideDist = new OpenSimplex2D(seed + 71892341n)
      .octaves(4)
      .spread(Math.fround(0.05))
      .scaled(Math.fround(-0.15), Math.fround(0.15));
    this.wide = (info, x, z, heightIn) => {
      const distFac = normDistSq(info) * Math.fround(0.8) + wideDist.noise(x, z);
      return Math.min(58 + distFac * 7 + wideBase.noise(x, z), heightIn);
    };

    // `RiverNoise.canyon`.
    const canyonBase = new OpenSimplex2D(seed).octaves(4).spread(Math.fround(0.05)).scaled(-7, 3);
    const canyonDist = new OpenSimplex2D(seed + 971823749132n)
      .octaves(4)
      .spread(Math.fround(0.05))
      .scaled(Math.fround(-0.3), Math.fround(0.2));
    // `.clamped(0, 1)` is a Noise2D combinator here rather than a builder method on the simplex.
    const canyonCliffRaw = new OpenSimplex2D(seed + 7189234132n).spread(Math.fround(0.0007));
    const canyonCliff = clamped((x, z) => canyonCliffRaw.noise(x, z), 0, 1);
    this.canyon = (info, x, z, heightIn) => {
      const distFac = normDistSq(info) * 1.3 + canyonDist.noise(x, z);
      const adjusted = distFac > 0.6 ? distFac * 0.4 + 0.8 : distFac;
      const riverHeight =
        55 + mthLerp(canyonCliff(x, z), distFac, adjusted) * 16 + canyonBase.noise(x, z);
      return Math.min(riverHeight, heightIn);
    };

    // `RiverNoise.tallCanyon` — the same shape with a harder shoulder and no cliff blend.
    const tallBase = new OpenSimplex2D(seed).octaves(4).spread(Math.fround(0.05)).scaled(-7, 3);
    const tallDist = new OpenSimplex2D(seed + 971823749132n)
      .octaves(4)
      .spread(Math.fround(0.05))
      .scaled(Math.fround(-0.3), Math.fround(0.2));
    this.tallCanyon = (info, x, z, heightIn) => {
      const distFac = normDistSq(info) * 1.3 + tallDist.noise(x, z);
      const adjusted = distFac > 0.32 ? distFac * 0.2 + 1.6 : distFac;
      return Math.min(55 + adjusted * 16 + tallBase.noise(x, z), heightIn);
    };
  }

  /**
   * `adjustHeightForRiverContributions`: blend the biome height with each river type's carved
   * height, weighted by how much of the column's biome mix uses that type.
   *
   * `weights` is indexed by `RiverBlend` and must sum to 1.
   *
   * **`CAVE` is deliberately treated as `NONE` here.** `RiverNoise.cave`'s height depends on
   * `caveWeight`, which comes from the cave carvers this project has not ported; with no carver its
   * own branch returns `heightIn` unchanged for the fully-carved case anyway. Leaving the ground
   * un-carved is the honest failure: it reports terrain that is too *high*, never a valley that is
   * not there. Recorded in docs/PARITY.md.
   */
  apply(
    info: RiverInfo | null,
    weights: readonly number[],
    blockX: number,
    blockZ: number,
    height: number,
  ): number {
    if (info === null) return height;

    let blended = 0;
    for (let type = 0; type < RIVER_BLEND_COUNT; type++) {
      const weight = weights[type] ?? 0;
      if (weight <= 0) continue;
      if (type === RiverBlend.NONE || type === RiverBlend.CAVE) {
        blended += weight * height;
      } else if (type === RiverBlend.WIDE) {
        blended += weight * this.wide(info, blockX, blockZ, height);
      } else if (type === RiverBlend.CANYON) {
        blended += weight * this.canyon(info, blockX, blockZ, height);
      } else {
        blended += weight * this.tallCanyon(info, blockX, blockZ, height);
      }
    }
    return blended;
  }
}

export { SEA_LEVEL_Y };

/**
 * `net.dries007.tfc.world.region.AddRiversAndLakes` (TFC 1.20.x) — the last region task, run after
 * `CHOOSE_ROCKS`. Plan section 7.
 *
 * Three stages:
 *
 * 1. **Initial drains.** Every shore point is a candidate river mouth. The best of its eight
 *    neighbours by "distance to ocean minus how diagonal the step is" picks the starting angle; ties
 *    are broken uniformly by reservoir sampling, then the angle is jittered so rivers do not all
 *    start on exact π/4 increments.
 * 2. **Build.** All rivers grow in parallel through `MultiParallelRiverBuilder`, refusing to cross
 *    each other or to leave land, and each surviving edge becomes a `RiverEdge`.
 * 3. **Annotate.** Edges are linked source→drain, width grows downstream from every headwater, and
 *    lakes are scattered around river sources.
 *
 * Java semantics worth flagging (CLAUDE.md section 2):
 *
 * - The tie-break is `random.nextInt(1 + bestDistanceCount) == 0` **inside** the comparison, so it
 *   consumes a draw on every equal-or-better neighbour, not only on ties. Reordering that changes
 *   every downstream river.
 * - `bestDistanceMetric` starts at `Float.MIN_VALUE`, which in Java is the smallest *positive*
 *   subnormal (~1.4e-45), not negative infinity. A neighbour whose metric is zero or negative
 *   therefore never wins. That looks like a bug and is faithfully preserved.
 * - `placeLakeNear` truncates `(int)(source.x + 0.3f * offset)` toward zero, which is not
 *   `Math.floor` for negative coordinates.
 * - Lake placement bumps rainfall by `0.09f * (500f - rainfall)`, a *proportional* increase toward
 *   500, not a flat one.
 *
 * @unverified No JVM fixture for the river geometry itself. The region-level effects this produces —
 * which points become river or lake, and the resulting biome — are covered by the biome parity
 * suite. See docs/PARITY.md.
 */
import { XoroshiroRandomSource } from '@core/random';
import type { RandomSource } from '@core/random/random-source';
import { hasLake, lakeFor } from '../biome/ids';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  RIVER_DEPTH,
  RIVER_FEATHER,
  RIVER_LENGTH,
  RiverEdge,
} from '../river/river-edge';
import { MultiParallelRiverBuilder, RiverBuilder, type Vertex } from '../river/river';
import type { Region, RegionPoint } from './region';

/**
 * `Float.MIN_VALUE` — the smallest positive subnormal float. Java's `AddRiversAndLakes` seeds its
 * "best metric so far" with this rather than `-Infinity`, so a neighbour with a non-positive metric
 * can never be chosen. Preserved deliberately.
 */
const FLOAT_MIN_VALUE = 1.401298464324817e-45;

/** `findBestStartingAngle`. Returns `NaN` when no neighbour qualifies. */
function findBestStartingAngle(region: Region, random: RandomSource, index: number): number {
  let bestDistanceMetric = FLOAT_MIN_VALUE;
  let bestDistanceCount = 0;
  let bestAngle = Number.NaN;

  for (let dirX = -1; dirX <= 1; dirX++) {
    for (let dirZ = -1; dirZ <= 1; dirZ++) {
      if (dirX === 0 && dirZ === 0) continue;
      const dirIndex = region.offset(index, 4 * dirX, 4 * dirZ);
      if (dirIndex === -1) continue;
      const dirPoint = region.data[dirIndex];
      if (!dirPoint || !dirPoint.land()) continue;

      const metric = dirPoint.distanceToOcean - Math.abs(dirX) - Math.abs(dirZ);
      // The draw happens for every candidate that is at least as good, not only on a tie.
      if (
        metric > bestDistanceMetric ||
        (metric === bestDistanceMetric && random.nextInt(1 + bestDistanceCount) === 0)
      ) {
        if (metric > bestDistanceMetric) {
          bestDistanceMetric = metric;
          bestDistanceCount = 0;
        }
        bestDistanceCount += 1;
        bestAngle = Math.fround(Math.atan2(dirZ, dirX));
      }
    }
  }

  if (!Number.isNaN(bestAngle)) {
    // Each of the eight directions covers ~pi/4; this gives the mouth some wiggle room without
    // losing the general direction.
    //
    // `bestAngle` is a `float` in Java and this is `+=`, so every step is float arithmetic: the
    // product, the subtraction and the accumulation all round to float before the next operation.
    // Doing it in double drifts the starting angle by a few ULPs, which is enough to move a river
    // and therefore the lakes placed at its source.
    bestAngle = Math.fround(
      bestAngle + Math.fround(Math.fround(random.nextFloat() * Math.fround(0.2)) - Math.fround(0.1)),
    );
  }
  return bestAngle;
}

/** `placeLakeNear`. */
function placeLakeNear(region: Region, edge: RiverEdge, offsetX: number, offsetZ: number): void {
  // `(int)` truncates toward zero -- not Math.floor for negative coordinates.
  const gridX = Math.trunc(edge.source.x + Math.fround(0.3) * offsetX);
  const gridZ = Math.trunc(edge.source.y + Math.fround(0.3) * offsetZ);

  const point = region.maybeAt(gridX, gridZ);
  if (
    point &&
    point.land() &&
    point.distanceToOcean >= 2 &&
    point.distanceToEdge >= 2 &&
    hasLake(point.biome)
  ) {
    point.biome = lakeFor(point.biome);
    // Proportional increase toward 500mm, not a flat bump: ~45mm at most.
    point.rainfall += Math.fround(0.09) * (Math.fround(500) - point.rainfall);
  }
}

/** `annotateRiver`: link the edges, grow widths downstream, scatter lakes at sources. */
function annotateRiver(region: Region, random: RandomSource, rivers: readonly RiverEdge[]): void {
  // Map each source vertex to the edge that starts there, then point every edge at whatever drains
  // out of its own drain vertex. Vertices are value-like, so match on coordinates.
  const sourceVertexToEdge = new Map<string, RiverEdge>();
  const key = (v: Vertex): string => `${v.x},${v.y}`;
  for (const edge of rivers) sourceVertexToEdge.set(key(edge.source), edge);
  for (const edge of rivers) edge.linkToDrain(sourceVertexToEdge.get(key(edge.drain)) ?? null);

  // From every headwater, walk downstream widening as we go.
  for (const start of rivers) {
    if (start.sourceEdge) continue;
    let edge: RiverEdge | null = start;
    let width = MIN_WIDTH;
    while (edge !== null) {
      edge.width = Math.max(edge.width, width);
      edge = edge.drainEdge;
      width = Math.min(width + 2, MAX_WIDTH);
    }
  }

  // Lakes around river sources.
  for (const edge of rivers) {
    if (!edge.sourceEdge && random.nextInt(3) === 0) {
      placeLakeNear(region, edge, 1, 1);
      placeLakeNear(region, edge, -1, 1);
      placeLakeNear(region, edge, 1, -1);
      placeLakeNear(region, edge, -1, -1);
    }
  }
}

/**
 * `AddRiversAndLakes.apply`. Populates `region.rivers` and marks river/lake points in place.
 *
 * `isLegal` is `RegionRiverGenerator`'s override: a river must stay on land, must not move closer to
 * the ocean than it already is, and must work its way inland as it lengthens.
 */
export function addRiversAndLakes(region: Region, random: RandomSource): void {
  const vertexToPoint = (vertex: Vertex): RegionPoint | undefined =>
    region.maybeAt(Math.round(vertex.x), Math.round(vertex.y));

  const generator = new MultiParallelRiverBuilder((prev, vertex) => {
    const prevPoint = vertexToPoint(prev);
    const newPoint = vertexToPoint(vertex);
    return (
      newPoint !== undefined &&
      prevPoint !== undefined &&
      newPoint.land() &&
      newPoint.distanceToOcean >= prevPoint.distanceToOcean &&
      // `prev.distance()` is an int, so `/ 2` is **integer division** in Java. Float division here
      // raises the threshold by a half for odd distances, which lets a river continue where the
      // game would stop it (CLAUDE.md section 2).
      newPoint.distanceToOcean >= Math.min(3, Math.trunc(prev.distance / 2))
    );
  });

  // --- createInitialDrains ---
  for (let dx = 0; dx < region.sizeX; dx++) {
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz;
      const point = region.data[index];
      if (!point || !point.shore()) continue;

      const bestAngle = findBestStartingAngle(region, random, index);
      if (Number.isNaN(bestAngle)) continue;

      const rng = XoroshiroRandomSource.fromSeed(random.nextLong());
      generator.add(
        new RiverBuilder(
          rng,
          // `region.minX() + dx + 0.5f` is int + int + float, so Java evaluates it in float.
          Math.fround(region.minX + dx + Math.fround(0.5)),
          Math.fround(region.minZ + dz + Math.fround(0.5)),
          bestAngle,
          RIVER_LENGTH,
          RIVER_DEPTH,
          RIVER_FEATHER,
        ),
      );
      point.setRiver();
    }
  }

  const rivers = generator.build().map((edge) => new RiverEdge(edge, random));
  region.rivers = rivers;
  if (rivers.length > 0) annotateRiver(region, random, rivers);
}

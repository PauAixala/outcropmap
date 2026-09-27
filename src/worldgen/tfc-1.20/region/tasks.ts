/**
 * The climate-relevant slice of `net.dries007.tfc.world.region.RegionGenerator.Task`'s pipeline:
 * `ADD_CONTINENTS`, `SHRINK_TO_CELL`, `ANNOTATE_DISTANCE_TO_CELL_EDGE`, `FLOOD_FILL_SMALL_OCEANS`,
 * `ADD_ISLANDS`, `ANNOTATE_DISTANCE_TO_OCEAN`, `ANNOTATE_CLIMATE`, run in that exact order by
 * `./generator.ts`. `ANNOTATE_BASE_LAND_HEIGHT`, `ADD_MOUNTAINS`, `ANNOTATE_BIOME_ALTITUDE` and
 * everything after `ANNOTATE_CLIMATE` are skipped: none of them write a field `AnnotateClimate`
 * reads (`land`, `distanceToOcean`, `distanceToEdge`), so skipping them cannot change a climate
 * value — see CLAUDE.md's Phase 3 scope note and `docs/WORLDGEN-NOTES.md`.
 *
 * Ported directly from (each function cites its own class):
 *   AddContinents.java, ShrinkToCell.java, AnnotateDistanceToCellEdge.java,
 *   FloodFillSmallOceans.java, AddIslands.java, AnnotateDistanceToOcean.java, AnnotateClimate.java.
 */
import type { RandomSource } from '@core/random';
import type { Cell } from '../noise/cellular-2d';
import type { Noise2D } from '../noise/noise2d';
import { REGION_RADIUS_IN_GRID } from './units';
import { Region, RegionPoint } from './region';
import { mthClampedMap, mthLerp } from './mth';

/** Everything one region-build pass threads through its tasks. Mirrors
 * `RegionGenerator.Context` (the `region`/`regionCell`/`random` fields) plus the three noise
 * fields tasks need read-only access to, and the growing footprint bounding box that
 * `AddContinents` fills in and `ShrinkToCell` consumes (Java's `Context.minX/maxX/minZ/maxZ`). */
export interface RegionBuildContext {
  readonly region: Region;
  readonly regionCell: Cell;
  readonly random: RandomSource;
  readonly sampleCell: (gridX: number, gridZ: number) => Cell;
  readonly continentNoise: Noise2D;
  readonly temperatureNoise: Noise2D;
  readonly rainfallNoise: Noise2D;
  footprintMinX: number;
  footprintMinZ: number;
  footprintMaxX: number;
  footprintMaxZ: number;
}

export function createFootprint(): Pick<RegionBuildContext, 'footprintMinX' | 'footprintMinZ' | 'footprintMaxX' | 'footprintMaxZ'> {
  return {
    footprintMinX: Number.POSITIVE_INFINITY,
    footprintMinZ: Number.POSITIVE_INFINITY,
    footprintMaxX: Number.NEGATIVE_INFINITY,
    footprintMaxZ: Number.NEGATIVE_INFINITY,
  };
}

/** A FIFO queue of array indices, used by every BFS below — a plain array with a head pointer
 * (not `Array.shift()`, which is O(n) and would make these BFS passes O(n^2) over a ~40k-point
 * region array). Not a Java port; an implementation detail with no effect on output. */
class IndexQueue {
  private readonly buf: number[] = [];
  private head = 0;

  enqueue(value: number): void {
    this.buf.push(value);
  }

  dequeue(): number {
    const value = this.buf[this.head++];
    if (value === undefined) throw new Error('IndexQueue.dequeue() called on an empty queue');
    return value;
  }

  get isEmpty(): boolean {
    return this.head >= this.buf.length;
  }
}

/** `AddContinents.apply`. */
export function addContinents(ctx: RegionBuildContext): void {
  const { region, regionCell, sampleCell, continentNoise } = ctx;
  for (let dx = -REGION_RADIUS_IN_GRID; dx <= REGION_RADIUS_IN_GRID; dx++) {
    for (let dz = -REGION_RADIUS_IN_GRID; dz <= REGION_RADIUS_IN_GRID; dz++) {
      const gridX = region.minX + REGION_RADIUS_IN_GRID + dx;
      const gridZ = region.minZ + REGION_RADIUS_IN_GRID + dz;
      const otherCell = sampleCell(gridX, gridZ);

      // Java compares `otherCell.x() == regionCell.x() && otherCell.y() == regionCell.y()` (the
      // jittered centre coordinates). Comparing the integer lattice cell (`cx`/`cy`) that produced
      // that centre is equivalent — both are deterministic functions of the same seed/frequency —
      // and avoids relying on exact floating-point equality of a divided value.
      if (otherCell.cx === regionCell.cx && otherCell.cy === regionCell.cy) {
        const point = region.atInit(gridX, gridZ);
        const continent = continentNoise(gridX, gridZ);
        if (continent > 4.4) {
          point.setLand();
        }
        if (gridX < ctx.footprintMinX) ctx.footprintMinX = gridX;
        if (gridZ < ctx.footprintMinZ) ctx.footprintMinZ = gridZ;
        if (gridX > ctx.footprintMaxX) ctx.footprintMaxX = gridX;
        if (gridZ > ctx.footprintMaxZ) ctx.footprintMaxZ = gridZ;
      }
    }
  }
}

/** `ShrinkToCell.apply`. */
export function shrinkToCell(ctx: RegionBuildContext): void {
  const { region } = ctx;
  const { footprintMinX: minX, footprintMinZ: minZ, footprintMaxX: maxX, footprintMaxZ: maxZ } = ctx;

  const modifiedSizeX = 1 + maxX - minX;
  const modifiedSizeZ = 1 + maxZ - minZ;
  const modifiedPoints = new Array<RegionPoint | undefined>(modifiedSizeX * modifiedSizeZ);

  const offsetX = minX - region.minX;
  const offsetZ = minZ - region.minZ;
  const prevSizeX = region.sizeX;

  for (let dx = 0; dx < modifiedSizeX; dx++) {
    for (let dz = 0; dz < modifiedSizeZ; dz++) {
      modifiedPoints[dx + modifiedSizeX * dz] = region.data[offsetX + dx + prevSizeX * (offsetZ + dz)];
    }
  }

  region.setRegionArea(modifiedPoints, minX, minZ, maxX, maxZ);
}

/** `AnnotateDistanceToCellEdge.apply`. */
export function annotateDistanceToCellEdge(ctx: RegionBuildContext): void {
  const { region } = ctx;
  const total = region.sizeX * region.sizeZ;
  const explored = new Uint8Array(total);
  const queue = new IndexQueue();

  const isUnbounded = (dx: number, dz: number): boolean =>
    dx === 0 || dz === 0 || dx === region.sizeX - 1 || dz === region.sizeZ - 1;

  for (let dx = 0; dx < region.sizeX; dx++) {
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz;
      const point = region.maybeAt(dx + region.minX, dz + region.minZ);
      if (!point || isUnbounded(dx, dz)) {
        explored[index] = 1;
        queue.enqueue(index);
        if (point) point.distanceToEdge = -1;
      }
    }
  }

  while (!queue.isEmpty) {
    const last = queue.dequeue();
    const lastPoint = region.data[last];
    const nextDistance = lastPoint ? lastPoint.distanceToEdge + 1 : 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const next = region.offset(last, dx, dz);
        if (next === -1) continue;
        const point = region.data[next];
        if (point && point.distanceToEdge === 0) {
          if (!explored[next]) {
            point.distanceToEdge = nextDistance;
            queue.enqueue(next);
          }
        }
        // Java sets `explored.set(next)` unconditionally here, outside the `if` above — mirrored
        // exactly, even though it is a no-op for points that were already explored this tick.
        explored[next] = 1;
      }
    }
  }
}

/** `FloodFillSmallOceans.apply`. */
export function floodFillSmallOceans(ctx: RegionBuildContext): void {
  const { region } = ctx;
  const total = region.sizeX * region.sizeZ;
  const explored = new Uint8Array(total);

  for (let dx = 0; dx < region.sizeX; dx++) {
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz;
      const point = region.data[index];
      if (!explored[index] && point && !point.land()) {
        floodFillSmallOcean(region, explored, index);
      }
    }
  }
}

const SMALL_OCEAN_FILL_THRESHOLD = 180;

function floodFillSmallOcean(region: Region, explored: Uint8Array, startIndex: number): void {
  const values = new Set<number>();
  const queue = new IndexQueue();
  queue.enqueue(startIndex);
  values.add(startIndex);
  let unbounded = false;

  while (!queue.isEmpty) {
    const last = queue.dequeue();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const next = region.offset(last, dx, dz);
        if (next === -1) {
          unbounded = true;
          continue;
        }
        const point = region.data[next];
        if (!point) {
          unbounded = true;
          continue;
        }
        if (point.land() || explored[next]) continue;

        explored[next] = 1;
        queue.enqueue(next);
        values.add(next);
      }
    }
  }

  if (values.size < SMALL_OCEAN_FILL_THRESHOLD && !unbounded) {
    for (const i of values) {
      const point = region.data[i];
      if (point) point.setLand();
    }
  }
}

/** `AddIslands.apply`. */
export function addIslands(ctx: RegionBuildContext): void {
  const { region, random } = ctx;
  let placed = 0;
  for (let attempt = 0; attempt < 130 && placed < 15; attempt++) {
    let x = region.minX + random.nextInt(region.sizeX);
    let z = region.minZ + random.nextInt(region.sizeZ);

    let point = region.maybeAt(x, z);
    if (point && !point.land() && !point.shore() && point.distanceToEdge > 2) {
      for (let island = 0; island < 12; island++) {
        point.setLand();
        point.setIsland();

        x += random.nextInt(4) - random.nextInt(4);
        z += random.nextInt(4) - random.nextInt(4);

        point = region.maybeAt(x, z);
        if (!point || (point.land() && !point.island()) || point.distanceToEdge <= 2) {
          break;
        }
      }
      placed += 1;
    }
  }
}

/** `AnnotateDistanceToOcean.apply`. */
export function annotateDistanceToOcean(ctx: RegionBuildContext): void {
  const { region } = ctx;
  const total = region.sizeX * region.sizeZ;
  const explored = new Uint8Array(total);
  const queue = new IndexQueue();

  for (let dx = 0; dx < region.sizeX; dx++) {
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz;
      const point = region.data[index];
      if (point && !point.land()) {
        point.distanceToOcean = -1;
        queue.enqueue(index);
        explored[index] = 1;
      }
    }
  }

  while (!queue.isEmpty) {
    const last = queue.dequeue();
    const lastPoint = region.data[last];
    if (!lastPoint) throw new Error('AnnotateDistanceToOcean: queued index has no point');
    const nextDistance = lastPoint.distanceToOcean + 1;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const next = region.offset(last, dx, dz);
        if (next === -1) continue;
        const point = region.data[next];
        if (point && point.land() && point.distanceToOcean === 0) {
          if (!lastPoint.land() && !point.island()) {
            lastPoint.setShore();
          }
          if (!explored[next]) {
            point.distanceToOcean = nextDistance;
            queue.enqueue(next);
          }
        }
        explored[next] = 1;
      }
    }
  }
}

/** `AnnotateClimate.apply`. Reads the raw `temperatureNoise`/`rainfallNoise` at each point, then
 * biases both towards a "temperate coastal" target the further inland/further-from-ocean a land
 * point is (both distances measured in grid units — 128 blocks each). Ocean points are untouched
 * beyond the raw noise sample. */
export function annotateClimate(ctx: RegionBuildContext): void {
  const { region, temperatureNoise, rainfallNoise } = ctx;

  for (let x = region.minX; x <= region.maxX; x++) {
    for (let z = region.minZ; z <= region.maxZ; z++) {
      const point = region.maybeAt(x, z);
      if (!point) continue;

      point.temperature = Math.fround(temperatureNoise(x, z));
      point.rainfall = Math.fround(rainfallNoise(x, z));

      let bias = 0;
      if (point.land()) {
        const potentialBias = mthClampedMap(point.distanceToEdge, 2, 6, 0, 1);
        const oceanProximityBias = mthClampedMap(point.distanceToOcean, 2, 6, 0, 1);
        bias = Math.min(potentialBias, oceanProximityBias);
      }

      const biasTargetTemperature = mthLerp(bias, 5, point.temperature);
      const biasTargetRainfall = mthLerp(bias, Math.min(Math.fround(point.rainfall + 350), 500), point.rainfall);

      point.temperature = mthLerp(0.23, point.temperature, biasTargetTemperature);
      point.rainfall = mthLerp(0.23, point.rainfall, biasTargetRainfall);
    }
  }
}

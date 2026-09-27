/**
 * Core Modern 0.9.21 (2cf74e6): PointMixin, RegionMixin, TFGInitTask and TFGAddContinents.
 * TFG initializes points after shrinking the region, so their stored indices refer to the
 * final array. The remaining regional tasks and generator integration are separate steps.
 */
import { Region, RegionPoint } from '@worldgen/tfc-1.20/region/region';
import { REGION_RADIUS_IN_GRID, REGION_WIDTH_IN_GRID } from '@worldgen/tfc-1.20/region/units';
import type { Cell } from '@worldgen/tfc-1.20/noise/cellular-2d';
import type { Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';

export class TFGRegionPoint extends RegionPoint {
  distanceToWestCoast = 0;
  isSurfaceRockKarst = false;
  hotSpotAge = 0;

  constructor(
    readonly x: number,
    readonly z: number,
    readonly index: number,
  ) {
    super();
  }
}

/** Reuses TFC storage/flags; only point initialization differs through TFG's mixins. */
export class TFGRegion extends Region {
  declare data: (TFGRegionPoint | undefined)[];

  override atInit(x: number, z: number): TFGRegionPoint {
    const index = this.index(x, z);
    const point = new TFGRegionPoint(x, z, index);
    this.data[index] = point;
    return point;
  }
}

/** TFGInitTask.apply: identify ownership, shrink storage, then initialize indexed points. */
export function initializeRegion(
  region: TFGRegion,
  regionCell: Cell,
  sampleCell: (x: number, z: number) => Cell,
): void {
  const owned = new Uint8Array(region.data.length);
  let minX = 2147483647;
  let minZ = 2147483647;
  let maxX = -2147483648;
  let maxZ = -2147483648;

  for (let dx = 0; dx <= 2 * REGION_RADIUS_IN_GRID; dx++) {
    for (let dz = 0; dz <= 2 * REGION_RADIUS_IN_GRID; dz++) {
      const x = region.minX + dx;
      const z = region.minZ + dz;
      const cell = sampleCell(x, z);
      if (cell.x === regionCell.x && cell.y === regionCell.y) {
        owned[region.index(x, z)] = 1;
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
      }
    }
  }

  const offsetX = minX - region.minX;
  const offsetZ = minZ - region.minZ;
  region.setRegionArea(new Array((maxX - minX + 1) * (maxZ - minZ + 1)), minX, minZ, maxX, maxZ);
  for (let dx = 0; dx < region.sizeX; dx++) {
    for (let dz = 0; dz < region.sizeZ; dz++) {
      if (owned[offsetX + dx + REGION_WIDTH_IN_GRID * (offsetZ + dz)]) {
        region.atInit(minX + dx, minZ + dz);
      }
    }
  }
}

/** TFGAddContinents.apply: iterate the final array in index order; the threshold is strict. */
export function addContinents(region: TFGRegion, continentNoise: Noise2D): void {
  for (const point of region.data) {
    if (point && continentNoise(point.x, point.z) > 4.4) point.setLand();
  }
}

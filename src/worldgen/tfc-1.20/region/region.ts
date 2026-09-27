/**
 * `net.dries007.tfc.world.region.Region` and `Region.Point`. This port only carries the fields
 * Phase 3 (climate) actually reads or writes: `land`/`island`/`shore`, `distanceToOcean`,
 * `distanceToEdge`, `temperature`, `rainfall`. Java's `Point` also has `baseOceanDepth`,
 * `baseLandHeight`, `biomeAltitude`, `mountain`, `coastalMountain`, `river`, `lake`, `biome` and
 * `rock` — those belong to plate tectonics / biomes / rocks (Phase 4/5/6) and are intentionally
 * left out here rather than stubbed; adding them is that phase's job against the real source, not
 * a retrofit of this file.
 *
 * Caveat: Java stores `distanceToOcean`/`distanceToEdge` as `byte` (wraps past ±127). This port
 * uses a plain `number` (no wraparound). `REGION_RADIUS_IN_GRID` is 100, so the true BFS distance
 * in either flood fill never exceeds roughly that — safely inside byte range — so the difference
 * is not expected to matter in practice, but it is a real, undeclared divergence from the byte
 * field if that assumption is ever wrong.
 */
import { fastRound } from '../noise/fast-noise-lite';
import type { Cell } from '../noise/cellular-2d';
import { REGION_RADIUS_IN_GRID, REGION_WIDTH_IN_GRID } from './units';

const FLAG_LAND = 0b1;
const FLAG_ISLAND = 0b10;

/** `Region.Point`: mutable, exactly as Java's tasks mutate points in place while the pipeline runs. */
export class RegionPoint {
  /** Distance to the nearest ocean. Negative values indicate an ocean; `-2` is a shore ocean cell
   * (`Point.setShore`/`shore()`). */
  distanceToOcean = 0;
  /** Distance to the nearest edge of the region's (post-shrink) bounding box. */
  distanceToEdge = 0;
  temperature = 0;
  rainfall = 0;
  baseOceanDepth = 0;
  baseLandHeight = 0;
  biomeAltitude = 0;
  biome = 0;
  rock = 0;
  private flags = 0;

  land(): boolean {
    return (this.flags & FLAG_LAND) !== 0;
  }

  island(): boolean {
    return (this.flags & FLAG_ISLAND) !== 0;
  }

  shore(): boolean {
    return this.distanceToOcean === -2;
  }

  mountain(): boolean { return (this.flags & 16) !== 0; }
  coastalMountain(): boolean { return (this.flags & 32) !== 0; }
  river(): boolean { return (this.flags & 4) !== 0; }
  lake(): boolean { return (this.flags & 8) !== 0; }
  setMountain(): void { this.flags |= 16; }
  setCoastalMountain(): void { this.flags |= 32; }
  setRiver(): void { this.flags |= 4; }
  setLake(): void { this.flags |= 8; }
  discreteBiomeAltitude(): number { return Math.floor(this.biomeAltitude / 4); }

  setLand(): void {
    this.flags |= FLAG_LAND;
  }

  setIsland(): void {
    this.flags |= FLAG_ISLAND;
  }

  setShore(): void {
    this.distanceToOcean = -2;
  }
}

/**
 * `net.dries007.tfc.world.region.Region`: the bounding-box array of `Point`s owned by one Voronoi
 * cell of `RegionGenerator.cellNoise`. Starts as the full square of radius `REGION_RADIUS_IN_GRID`
 * around the cell's (rounded) jittered centre (`new Region(Cellular2D.Cell)`), then `ShrinkToCell`
 * (see `./tasks.ts`) replaces the array with just the actually-owned footprint via
 * {@link setRegionArea}.
 */
export class Region {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  sizeX: number;
  sizeZ: number;
  data: (RegionPoint | undefined)[];
  /**
   * River edges for this region, produced by the last region task.
   *
   * Deliberately untyped at the base: the two profiles put different edge shapes in this one slot —
   * TFC's `RiverEdge` (`../river/river-edge.ts`) and TerraFirmaGreg's own `TFGRiverEdge`, which
   * carries a different set of fields — so each profile casts on read rather than one pretending to
   * be the other. Before section 7 this held a placeholder interface and nothing ever populated it.
   */
  rivers: unknown[] = [];

  constructor(cell: Cell) {
    const cellX = fastRound(cell.x);
    const cellZ = fastRound(cell.y);

    this.minX = cellX - REGION_RADIUS_IN_GRID;
    this.minZ = cellZ - REGION_RADIUS_IN_GRID;
    this.maxX = cellX + REGION_RADIUS_IN_GRID;
    this.maxZ = cellZ + REGION_RADIUS_IN_GRID;

    this.sizeX = 1 + this.maxX - this.minX;
    this.sizeZ = 1 + this.maxZ - this.minZ;

    this.data = new Array<RegionPoint | undefined>(REGION_WIDTH_IN_GRID * REGION_WIDTH_IN_GRID);
  }

  /** `Region.index(int, int)`: local-space index of a global grid coordinate. Caller must ensure
   * the coordinate is within bounds (mirrors Java's assertion, not a runtime check there either). */
  index(gridX: number, gridZ: number): number {
    return gridX - this.minX + this.sizeX * (gridZ - this.minZ);
  }

  /** `Region.isIn(int, int)`. */
  isIn(gridX: number, gridZ: number): boolean {
    return gridX >= this.minX && gridX <= this.maxX && gridZ >= this.minZ && gridZ <= this.maxZ;
  }

  /** `Region.atInit(int, int)`: creates and stores a fresh point (`AddContinents` only). */
  atInit(gridX: number, gridZ: number): RegionPoint {
    const point = new RegionPoint();
    this.data[this.index(gridX, gridZ)] = point;
    return point;
  }

  /** `Region.at(int, int)`. */
  at(gridX: number, gridZ: number): RegionPoint | undefined {
    return this.data[this.index(gridX, gridZ)];
  }

  /** `Region.maybeAt(int, int)`. */
  maybeAt(gridX: number, gridZ: number): RegionPoint | undefined {
    return this.isIn(gridX, gridZ) ? this.data[this.index(gridX, gridZ)] : undefined;
  }

  /** `Region.requireAt(int, int)`. */
  requireAt(gridX: number, gridZ: number): RegionPoint {
    const point = this.at(gridX, gridZ);
    if (!point) {
      throw new Error(`Region does not contain point at (${gridX}, ${gridZ})`);
    }
    return point;
  }

  /** `Region.offset(int index, int offsetX, int offsetZ)`: a neighbour index in the *current*
   * (possibly already-shrunk) bounding box, or `-1` if it falls outside it. */
  offset(index: number, offsetX: number, offsetZ: number): number {
    const localX = offsetX + (index % this.sizeX);
    const localZ = offsetZ + Math.floor(index / this.sizeX);
    return localX >= 0 && localX < this.sizeX && localZ >= 0 && localZ < this.sizeZ
      ? localX + this.sizeX * localZ
      : -1;
  }

  /** `Region.setRegionArea(...)`: `ShrinkToCell`'s replacement of the full square with the actual
   * owned footprint. */
  setRegionArea(data: (RegionPoint | undefined)[], minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.data = data;
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxZ = maxZ;
    this.sizeX = 1 + maxX - minX;
    this.sizeZ = 1 + maxZ - minZ;
  }
}

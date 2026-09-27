/**
 * `net.dries007.tfc.world.region.RiverEdge` (TFC 1.20.x) — one river segment as the region stores
 * it: the straight source→drain chord, the bisected fractal that gives it its wiggle, a width that
 * grows downstream, and the partition bounds used to find it again cheaply.
 *
 * ```java
 * public RiverEdge(River.Edge edge, RandomSource random) {
 *     this.source = edge.source(); this.drain = edge.drain();
 *     this.fractal = edge.fractal(random, 4);
 *     final int centerGridX = (int) Math.round(0.5f * (edge.source().x() + edge.drain().x()));
 *     final int centerGridZ = (int) Math.round(0.5f * (edge.source().y() + edge.drain().y()));
 *     this.minPartX = Units.gridToPart(centerGridX - MAX_AFFECTING_GRID_DISTANCE);
 *     ...
 * }
 * ```
 *
 * `linkToDrain` is what turns the flat edge list into a linked structure: setting an edge's drain
 * also marks the *drain* as having a source, which is how `annotateRiver` later tells a headwater
 * from a confluence.
 *
 * @unverified No JVM fixture yet. See docs/PARITY.md.
 */
import type { RandomSource } from '@core/random/random-source';
import { gridToPart } from '../region/units';
import { createMidpointFractal, type MidpointFractal, type Edge, type Vertex } from './river';

export const MIN_WIDTH = 8;
export const MAX_WIDTH = 24;

/** `AddRiversAndLakes.RIVER_LENGTH`, needed here for the affecting-distance bound. */
export const RIVER_LENGTH = Math.fround(2.7);
export const RIVER_DEPTH = 17;
export const RIVER_FEATHER = Math.fround(0.8);

/** `1 + Mth.ceil(1.5f * RIVER_LENGTH)` — how far, in grid cells, an edge can reach. */
const MAX_AFFECTING_GRID_DISTANCE = 1 + Math.ceil(Math.fround(1.5) * RIVER_LENGTH);

/** How many bisections each edge's fractal gets (`edge.fractal(random, 4)`). */
const EDGE_BISECTIONS = 4;

export class RiverEdge {
  width = MIN_WIDTH;
  readonly source: Vertex;
  readonly drain: Vertex;
  readonly fractal: MidpointFractal;
  readonly minPartX: number;
  readonly minPartZ: number;
  readonly maxPartX: number;
  readonly maxPartZ: number;

  /** True when some other edge drains into this one, i.e. this is not a headwater. */
  sourceEdge = false;
  /** The edge this one drains into, if any. */
  drainEdge: RiverEdge | null = null;

  constructor(edge: Edge, random: RandomSource) {
    this.source = edge.source;
    this.drain = edge.drain;
    this.fractal = createMidpointFractal(
      random,
      EDGE_BISECTIONS,
      edge.source.x,
      edge.source.y,
      edge.drain.x,
      edge.drain.y,
    );

    // Java's `Math.round(float)` returns an int and rounds half *up*; the operand here is a float
    // expression, so this rounds the float-rounded midpoint.
    const centerGridX = Math.round(Math.fround(Math.fround(0.5) * (edge.source.x + edge.drain.x)));
    const centerGridZ = Math.round(Math.fround(Math.fround(0.5) * (edge.source.y + edge.drain.y)));

    this.minPartX = gridToPart(centerGridX - MAX_AFFECTING_GRID_DISTANCE);
    this.minPartZ = gridToPart(centerGridZ - MAX_AFFECTING_GRID_DISTANCE);
    this.maxPartX = gridToPart(centerGridX + MAX_AFFECTING_GRID_DISTANCE);
    this.maxPartZ = gridToPart(centerGridZ + MAX_AFFECTING_GRID_DISTANCE);
  }

  /** `RiverEdge.widthSq()` — the edge's own width squared, before any interpolation. */
  get widthSq(): number {
    return this.width * this.width;
  }

  /** `linkToDrain`: also marks the target as having a source. */
  linkToDrain(edge: RiverEdge | null): void {
    this.drainEdge = edge;
    if (edge !== null) edge.sourceEdge = true;
  }
}

/**
 * River geometry — `net.dries007.tfc.world.river.River` and `MidpointFractal` (TFC 1.20.x).
 *
 * A river is grown backwards from its mouth: a `Builder` walks inland one vertex at a time, queues
 * branch points as it goes, and a `MultiParallelBuilder` interleaves every river on the region so
 * they can refuse to cross each other. Each finished edge is then bisected into a wiggly polyline
 * by `MidpointFractal`.
 *
 * Java semantics that matter here (CLAUDE.md section 2):
 *
 * - **`Mth.cos`/`Mth.sin` take a `float`.** `computeNext` casts the angle down before the
 *   trigonometry, so the position depends on the float-rounded angle, not the double one. The
 *   existing `@core/math/trig` helpers are the ported versions of those, and the cast is applied
 *   explicitly below.
 * - `randomJitter` is `2 * nextDouble() - 1` and then a **sign-dependent** offset, so the result is
 *   never inside `(-JITTER_MIN, JITTER_MIN)`. Simplifying it to a symmetric range would smooth every
 *   river out.
 * - `buildInitialBranch` returns `true` when the branch was **cut short** (and pruned), not when it
 *   succeeded, and `MultiParallelBuilder.build` queues exactly those builders for further work. That
 *   reads backwards and is deliberately preserved.
 * - The working queue is a priority queue ordered by `-edges - 10 * branchQueue`, so long rivers with
 *   few pending branches are extended first. Order changes which rivers win an intersection race, so
 *   it is part of the output, not an optimisation.
 *
 * @unverified No JVM fixture yet. See docs/PARITY.md — river *positions* from this module are not
 * confirmed, though the region-level effects (which points become river or lake) are checked by the
 * biome parity suite.
 */
import type { RandomSource } from '@core/random/random-source';
import { mthCos, mthSin } from '@core/math/trig';

const MIN_BRANCH_ANGLE = Math.fround(0.4);
const MIN_BRANCH_DISTANCE = 2;
const MIN_RIVER_EDGE_COUNT = 6;

export interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly length: number;
  readonly distance: number;
}

export interface Edge {
  readonly source: Vertex;
  readonly drain: Vertex;
}

/** `RiverHelpers.norm2` — squared euclidean length. */
function norm2(x: number, y: number): number {
  return x * x + y * y;
}

/** `RiverHelpers.normInf`. */
export function normInf(x: number, y: number): number {
  return Math.max(Math.abs(x), Math.abs(y));
}

/** `RiverHelpers.projectAlongLine`. */
function projectAlongLine(
  vx: number,
  vy: number,
  wx: number,
  wy: number,
  px: number,
  py: number,
): number {
  const l2 = norm2(vx - wx, vy - wy);
  if (l2 === 0) return 0;
  const t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** `RiverHelpers.distancePointToLineSq`. */
export function distancePointToLineSq(
  vx: number,
  vy: number,
  wx: number,
  wy: number,
  px: number,
  py: number,
): number {
  const t = projectAlongLine(vx, vy, wx, wy, px, py);
  const x0 = vx + t * (wx - vx);
  const y0 = vy + t * (wy - vy);
  return norm2(x0 - px, y0 - py);
}

function distanceEdgeToVertex(edge: Edge, vertex: Vertex): number {
  return distancePointToLineSq(
    edge.source.x,
    edge.source.y,
    edge.drain.x,
    edge.drain.y,
    vertex.x,
    vertex.y,
  );
}

/** `River.orientation`: 0 collinear, 1 clockwise, 2 anticlockwise. */
function orientation(p: Vertex, q: Vertex, r: Vertex): number {
  const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (value === 0) return 0;
  return value > 0 ? 1 : 2;
}

function intersectCollinear(p: Vertex, q: Vertex, r: Vertex): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  );
}

/** `River.intersect`. */
function segmentsIntersect(p1: Vertex, q1: Vertex, p2: Vertex, q2: Vertex): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return (
    (o1 !== o2 && o3 !== o4) ||
    (o1 === 0 && intersectCollinear(p1, p2, q1)) ||
    (o2 === 0 && intersectCollinear(p1, q2, q1)) ||
    (o3 === 0 && intersectCollinear(p2, p1, q2)) ||
    (o4 === 0 && intersectCollinear(p2, q1, q2))
  );
}

// ---------------------------------------------------------------------------
// MidpointFractal
// ---------------------------------------------------------------------------

const JITTER_MAX = Math.fround(0.2);
const JITTER_MIN = Math.fround(0.05);
const MAX_BISECTIONS = 10;

/**
 * `MidpointFractal`'s static `ENCOMPASSING_RANGES` table: the worst-case deviation of a fractal
 * from its straight chord, per bisection count, as a multiple of the chord's inf-norm.
 */
const ENCOMPASSING_RANGES: readonly number[] = (() => {
  const table: number[] = [];
  const sqrt2 = Math.sqrt(2);
  let delta = 0;
  let midpointDelta = 0;
  let norm = 1;
  for (let i = 0; i < MAX_BISECTIONS; i++) {
    table.push(Math.max(delta, midpointDelta));
    const prevMidpoint = midpointDelta;
    midpointDelta = Math.fround(0.5) * (delta + midpointDelta) + sqrt2 * JITTER_MAX * norm;
    delta = Math.max(prevMidpoint, delta);
    norm *= Math.fround(0.5) + JITTER_MAX;
  }
  return table;
})();

/**
 * `MidpointFractal.randomJitter`: in `[-JITTER_MAX, JITTER_MAX]` but never within `JITTER_MIN` of
 * zero — the sign-dependent offset is what keeps every bisection visibly off the chord.
 */
function randomJitter(random: RandomSource): number {
  const value = Math.fround(2) * random.nextDouble() - 1;
  return (JITTER_MAX - JITTER_MIN) * value + (value < 0 ? -JITTER_MIN : JITTER_MIN);
}

export interface MidpointFractal {
  /** `(x0, y0, x1, y1, ... xN, yN)`. */
  readonly segments: readonly number[];
  maybeIntersect(x: number, y: number, distance: number): boolean;
  intersectDistanceSq(x: number, y: number): number;
  /** `MidpointFractal.intersect`: does the point come within `distance` of the fractal? */
  intersect(x: number, y: number, distance: number): boolean;
}

/** `MidpointFractal.bisect`. */
function bisect(random: RandomSource, bisections: number, initial: readonly number[]): number[] {
  let segments = [...initial];
  for (let i = 0; i < bisections; i++) {
    const split = new Array<number>((segments.length << 1) - 2);
    split[0] = segments[0] ?? 0;
    split[1] = segments[1] ?? 0;
    let splitIndex = 2;
    for (let index = 0; index < segments.length - 2; index += 2) {
      const sourceX = segments[index] ?? 0;
      const sourceY = segments[index + 1] ?? 0;
      const drainX = segments[index + 2] ?? 0;
      const drainY = segments[index + 3] ?? 0;
      const norm = normInf(sourceX - drainX, sourceY - drainY);
      const bisectX = randomJitter(random) * norm + (sourceX + drainX) * Math.fround(0.5);
      const bisectY = randomJitter(random) * norm + (sourceY + drainY) * Math.fround(0.5);
      split[splitIndex] = bisectX;
      split[splitIndex + 1] = bisectY;
      split[splitIndex + 2] = drainX;
      split[splitIndex + 3] = drainY;
      splitIndex += 4;
    }
    segments = split;
  }
  return segments;
}

export function createMidpointFractal(
  random: RandomSource,
  bisections: number,
  sourceX: number,
  sourceY: number,
  drainX: number,
  drainY: number,
): MidpointFractal {
  if (bisections < 0 || bisections >= MAX_BISECTIONS) {
    throw new RangeError(`Bisections must be within [0, ${MAX_BISECTIONS})`);
  }
  const segments = bisect(random, bisections, [sourceX, sourceY, drainX, drainY]);
  const norm =
    (ENCOMPASSING_RANGES[bisections] ?? 0) * normInf(sourceX - drainX, sourceY - drainY);

  return {
    segments,
    maybeIntersect(x, y, distance) {
      const d = distancePointToLineSq(
        segments[0] ?? 0,
        segments[1] ?? 0,
        segments[segments.length - 2] ?? 0,
        segments[segments.length - 1] ?? 0,
        x,
        y,
      );
      const t = distance + norm;
      return d <= t * t;
    },
    intersect(x, y, distance) {
      // Java is `maybeIntersect(...) && intersectIndex(...) != -1`. `intersectIndex` returns the
      // first segment whose square distance is under the threshold, which is non-negative exactly
      // when the minimum is — so the cheap bounding test then the same minimum this file already
      // computes.
      return this.maybeIntersect(x, y, distance) && this.intersectDistanceSq(x, y) < distance * distance;
    },
    intersectDistanceSq(x, y) {
      let min = Number.MAX_VALUE;
      for (let i = 0; i < segments.length - 2; i += 2) {
        const d = distancePointToLineSq(
          segments[i] ?? 0,
          segments[i + 1] ?? 0,
          segments[i + 2] ?? 0,
          segments[i + 3] ?? 0,
          x,
          y,
        );
        if (d < min) min = d;
      }
      return min;
    },
  };
}

// ---------------------------------------------------------------------------
// River.Builder / MultiParallelBuilder
// ---------------------------------------------------------------------------

/** `River.Context`. */
export interface RiverContext {
  intersectAny(edge: Edge): boolean;
}

/** `River.Builder`: one river, grown from its mouth inland. */
export class RiverBuilder {
  readonly edges: Edge[] = [];
  private readonly branchQueue: Edge[] = [];
  private readonly branch: Edge[] = [];
  private readonly root: Vertex;
  private readonly featherSq: number;

  constructor(
    private readonly random: RandomSource,
    drainX: number,
    drainY: number,
    angle: number,
    length: number,
    private readonly depth: number,
    feather: number,
  ) {
    this.root = { x: drainX, y: drainY, angle, length, distance: 0 };
    this.featherSq = feather * feather;
  }

  /** Used by `MultiParallelBuilder`'s priority ordering. */
  get pendingBranches(): number {
    return this.branchQueue.length;
  }

  /** `River.Builder.computeNext`. */
  private computeNext(prev: Vertex, length: number, distance: number): Vertex {
    const nextAngle =
      distance === 0
        ? prev.angle
        : prev.angle +
          (this.random.nextDouble() * Math.fround(0.5) + Math.fround(0.2)) *
            (this.random.nextBoolean() ? 1 : -1);
    const nextLength = length * (this.random.nextDouble() * Math.fround(0.08) + Math.fround(0.92));
    // Mth.cos/sin take a float -- the angle is rounded before the trigonometry.
    const dx = mthCos(Math.fround(nextAngle)) * nextLength;
    const dy = mthSin(Math.fround(nextAngle)) * nextLength;
    return {
      x: prev.x + dx,
      y: prev.y + dy,
      angle: nextAngle,
      length: nextLength,
      distance: distance + 1,
    };
  }

  private pruneRiverIfTooShort(): void {
    if (this.edges.length < MIN_RIVER_EDGE_COUNT) {
      this.edges.length = 0;
      this.branchQueue.length = 0;
    }
  }

  /**
   * `buildInitialBranch`. Returns `true` when the branch was cut short by an intersection — which
   * is, counter-intuitively, the case `MultiParallelBuilder.build` queues for further work.
   */
  buildInitialBranch(context: RiverContext): boolean {
    let prev = this.root;
    const length =
      this.depth + this.random.nextInt(1 + Math.trunc(this.depth * Math.fround(0.3)));
    for (let i = 0; i < length; i++) {
      const next = this.computeNext(prev, prev.length, prev.distance);
      const nextEdge: Edge = { source: next, drain: prev };
      if (context.intersectAny(nextEdge)) {
        this.pruneRiverIfTooShort();
        return true;
      }
      this.edges.push(nextEdge);
      prev = next;
      if (prev.distance < this.depth && prev.distance >= MIN_BRANCH_DISTANCE) {
        this.branchQueue.push(nextEdge);
      }
    }
    return false;
  }

  /** `buildBranch`. Returns `true` only when this builder is finished. */
  buildBranch(context: RiverContext): boolean {
    const prevEdge = this.branchQueue.shift();
    if (prevEdge === undefined) {
      this.pruneRiverIfTooShort();
      return true;
    }
    let prev = prevEdge.drain;
    let prevDist = prev.distance + this.random.nextInt(3);
    const branchNext = this.computeNext(prev, prev.length, prevDist);

    // Don't branch in a very similar direction to the existing trunk.
    const deltaAngle = Math.abs(prevEdge.source.angle - branchNext.angle);
    if (deltaAngle < MIN_BRANCH_ANGLE || 2 * Math.PI - deltaAngle < MIN_BRANCH_ANGLE) {
      return false;
    }

    this.branch.length = 0;
    const first: Edge = { source: branchNext, drain: prev };
    if (context.intersectAny(first)) return false;
    this.branch.push(first);

    prev = branchNext;
    // The loop bound is re-evaluated every iteration in the Java (it is a `for` condition calling
    // `random.nextInt`), so it consumes a draw per iteration. Preserved exactly.
    for (
      let i = 0;
      i < this.depth - prev.distance + this.random.nextInt(1 + Math.trunc(this.depth * Math.fround(0.3)));
      i++
    ) {
      const next = this.computeNext(prev, prev.length, prevDist);
      const nextEdge: Edge = { source: next, drain: prev };
      if (context.intersectAny(nextEdge)) break;
      this.branch.push(nextEdge);
      prev = next;
      prevDist = next.distance;
      if (prevDist < this.depth && prevDist >= MIN_BRANCH_DISTANCE) {
        this.branchQueue.push(nextEdge);
      }
    }

    this.edges.push(...this.branch);
    return false;
  }

  intersectAny(edge: Edge): boolean {
    for (const e of this.edges) {
      if (
        e.source !== edge.drain &&
        e.drain !== edge.drain &&
        (distanceEdgeToVertex(e, edge.source) < this.featherSq ||
          segmentsIntersect(e.source, e.drain, edge.source, edge.drain))
      ) {
        return true;
      }
    }
    return false;
  }
}

/**
 * `java.util.PriorityQueue`'s binary heap, ported rather than approximated with a sorted array.
 *
 * This matters more than it looks. The comparator is
 * `Comparator.comparing(b -> -b.edges.size() - 10 * b.branchQueue.size())`, and those scores
 * **change as builders build**, so the heap is re-evaluating a moving key. Two builders with equal
 * scores come out in whatever order the heap's sift operations happen to leave them — which is not
 * the insertion order a stable sort would give. Since the order decides which river wins when two
 * would intersect, an "equivalent" queue produces a different, plausible-looking river network.
 *
 * `siftUp` and `siftDown` below follow the JDK implementation step for step.
 */
class BuilderHeap {
  private readonly values: RiverBuilder[] = [];

  private score(b: RiverBuilder): number {
    return -b.edges.length - 10 * b.pendingBranches;
  }

  push(b: RiverBuilder): void {
    let k = this.values.length;
    this.values.push(b);
    while (k > 0) {
      const parentIndex = (k - 1) >>> 1;
      const parent = this.values[parentIndex]!;
      if (this.score(b) >= this.score(parent)) break;
      this.values[k] = parent;
      k = parentIndex;
    }
    this.values[k] = b;
  }

  pop(): RiverBuilder | undefined {
    const result = this.values[0];
    const last = this.values.pop();
    if (last === undefined || this.values.length === 0) return result;
    let k = 0;
    const half = this.values.length >>> 1;
    while (k < half) {
      let child = 2 * k + 1;
      const right = child + 1;
      if (right < this.values.length && this.score(this.values[child]!) > this.score(this.values[right]!)) {
        child = right;
      }
      if (this.score(last) <= this.score(this.values[child]!)) break;
      this.values[k] = this.values[child]!;
      k = child;
    }
    this.values[k] = last;
    return result;
  }
}

/**
 * `River.MultiParallelBuilder`: interleaves every river on the region so they compete for space.
 *
 * `isLegal` is the subclass hook `AddRiversAndLakes.RegionRiverGenerator` overrides to keep rivers
 * on land and heading inland.
 */
export class MultiParallelRiverBuilder implements RiverContext {
  private readonly builders: RiverBuilder[] = [];

  constructor(private readonly isLegal: (prev: Vertex, vertex: Vertex) => boolean = () => true) {}

  add(builder: RiverBuilder): this {
    this.builders.push(builder);
    return this;
  }

  /**
   * `build`. The working set is a priority queue keyed by `-edges - 10 * pendingBranches`, so the
   * longest rivers with the fewest pending branches are extended first. That ordering decides which
   * river wins when two would intersect, so it is part of the output.
   */
  build(): Edge[] {
    const heap = new BuilderHeap();
    for (const builder of this.builders) {
      if (builder.buildInitialBranch(this)) heap.push(builder);
    }
    for (;;) {
      const builder = heap.pop();
      if (builder === undefined) break;
      if (!builder.buildBranch(this)) heap.push(builder);
    }
    return this.builders.flatMap((b) => b.edges);
  }

  intersectAny(edge: Edge): boolean {
    if (!this.isLegal(edge.drain, edge.source)) return true;
    for (const builder of this.builders) {
      if (builder.intersectAny(edge)) return true;
    }
    return false;
  }
}

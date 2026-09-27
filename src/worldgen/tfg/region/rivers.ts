/** TFGAddRiversAndLakes + unchanged TFC River/ MidpointFractal. EUPL-1.2. */
import { XoroshiroRandomSource } from '@core/random';
import { mthSin, mthCos } from '@core/math/trig';
import { hasLake, lakeFor } from '../biome/ids';
import type { TFGRegion } from './initialization';
const f = Math.fround;
const encompassingRange = (() => {
  let delta = 0, midpoint = 0, norm = 1;
  for (let i = 0; i < 4; i++) {
    const previous = midpoint;
    midpoint = 0.5 * (delta + midpoint) + Math.sqrt(2) * f(0.2) * norm;
    delta = Math.max(previous, delta);
    norm *= 0.5 + f(0.2);
  }
  return Math.max(delta, midpoint);
})();
interface Vertex {
  x: number;
  z: number;
  angle: number;
  length: number;
  distance: number;
}
interface Edge {
  source: Vertex;
  drain: Vertex;
}
export interface TFGRiverEdge extends Edge {
  sourceX: number;
  sourceZ: number;
  drainX: number;
  drainZ: number;
  segments: number[];
  width: number;
  hasSource: boolean;
  downstream?: TFGRiverEdge;
}

export function lineDistanceSq(
  vx: number,
  vz: number,
  wx: number,
  wz: number,
  px: number,
  pz: number,
): number {
  const dx = wx - vx,
    dz = wz - vz,
    l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - vx) * dx + (pz - vz) * dz) / l2));
  const x = vx + t * dx - px,
    z = vz + t * dz - pz;
  return x * x + z * z;
}
function orientation(p: Vertex, q: Vertex, r: Vertex): number {
  const v = (q.z - p.z) * (r.x - q.x) - (q.x - p.x) * (r.z - q.z);
  return v === 0 ? 0 : v > 0 ? 1 : 2;
}
function collinear(p: Vertex, q: Vertex, r: Vertex): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.z <= Math.max(p.z, r.z) &&
    q.z >= Math.min(p.z, r.z)
  );
}
function intersects(a: Edge, b: Edge): boolean {
  const p = a.source,
    q = a.drain,
    r = b.source,
    s = b.drain;
  const o1 = orientation(p, q, r),
    o2 = orientation(p, q, s),
    o3 = orientation(r, s, p),
    o4 = orientation(r, s, q);
  return (
    (o1 !== o2 && o3 !== o4) ||
    (o1 === 0 && collinear(p, r, q)) ||
    (o2 === 0 && collinear(p, s, q)) ||
    (o3 === 0 && collinear(r, p, s)) ||
    (o4 === 0 && collinear(r, q, s))
  );
}
class Builder {
  readonly edges: Edge[] = [];
  readonly queue: Edge[] = [];
  constructor(
    readonly random: XoroshiroRandomSource,
    readonly root: Vertex,
  ) {}
  next(prev: Vertex, distance: number): Vertex {
    const angle =
      distance === 0
        ? prev.angle
        : prev.angle +
          (this.random.nextDouble() * 0.5 + f(0.2)) * (this.random.nextBoolean() ? 1 : -1);
    const length = prev.length * (this.random.nextDouble() * f(0.08) + f(0.92));
    return {
      x: prev.x + mthCos(f(angle)) * length,
      z: prev.z + mthSin(f(angle)) * length,
      angle,
      length,
      distance: distance + 1,
    };
  }
  prune(): void {
    if (this.edges.length < 6) {
      this.edges.length = 0;
      this.queue.length = 0;
    }
  }
  initial(blocked: (e: Edge) => boolean): boolean {
    let prev = this.root;
    const length = 17 + this.random.nextInt(1 + Math.trunc(f(17 * f(0.3))));
    for (let i = 0; i < length; i++) {
      const next = this.next(prev, prev.distance),
        edge = { source: next, drain: prev };
      if (blocked(edge)) {
        this.prune();
        return true;
      }
      this.edges.push(edge);
      prev = next;
      if (prev.distance < 17 && prev.distance >= 2) this.queue.push(edge);
    }
    return false;
  }
  branch(blocked: (e: Edge) => boolean): boolean {
    const previous = this.queue.shift();
    if (!previous) {
      this.prune();
      return true;
    }
    let prev = previous.drain,
      distance = prev.distance + this.random.nextInt(3);
    const next = this.next(prev, distance),
      delta = Math.abs(previous.source.angle - next.angle);
    if (delta < f(0.4) || 2 * Math.PI - delta < f(0.4)) return false;
    const first = { source: next, drain: prev };
    if (blocked(first)) return false;
    const branch = [first];
    prev = next;
    // The Java loop draws again at every condition evaluation.
    for (
      let i = 0;
      i < 17 - prev.distance + this.random.nextInt(1 + Math.trunc(f(17 * f(0.3))));
      i++
    ) {
      const next = this.next(prev, distance),
        edge = { source: next, drain: prev };
      if (blocked(edge)) break;
      branch.push(edge);
      prev = next;
      distance = next.distance;
      if (distance < 17 && distance >= 2) this.queue.push(edge);
    }
    this.edges.push(...branch);
    return false;
  }
  blocked(edge: Edge): boolean {
    return this.edges.some(
      (e) =>
        e.source !== edge.drain &&
        e.drain !== edge.drain &&
        (lineDistanceSq(
          e.source.x,
          e.source.z,
          e.drain.x,
          e.drain.z,
          edge.source.x,
          edge.source.z,
        ) <
          f(0.8) * f(0.8) ||
          intersects(e, edge)),
    );
  }
}
// Java PriorityQueue's tie behavior affects branch order; a stable sort is not equivalent.
class BuilderHeap {
  readonly values: Builder[] = [];
  score(b: Builder): number {
    return -b.edges.length - 10 * b.queue.length;
  }
  push(b: Builder): void {
    let k = this.values.length;
    this.values.push(b);
    while (k > 0) {
      const p = (k - 1) >>> 1,
        parent = this.values[p]!;
      if (this.score(b) >= this.score(parent)) break;
      this.values[k] = parent;
      k = p;
    }
    this.values[k] = b;
  }
  pop(): Builder | undefined {
    const result = this.values[0],
      last = this.values.pop();
    if (!last || this.values.length === 0) return result;
    let k = 0;
    while (k < this.values.length >>> 1) {
      let child = 2 * k + 1;
      if (
        child + 1 < this.values.length &&
        this.score(this.values[child]!) > this.score(this.values[child + 1]!)
      )
        child++;
      if (this.score(last) <= this.score(this.values[child]!)) break;
      this.values[k] = this.values[child]!;
      k = child;
    }
    this.values[k] = last;
    return result;
  }
}
function fractal(edge: Edge, random: XoroshiroRandomSource): number[] {
  let points = [edge.source.x, edge.source.z, edge.drain.x, edge.drain.z];
  const jitter = (): number => {
    const v = 2 * random.nextDouble() - 1;
    return (f(0.2) - f(0.05)) * v + (v < 0 ? -f(0.05) : f(0.05));
  };
  for (let j = 0; j < 4; j++) {
    const split = points.slice(0, 2);
    for (let i = 0; i < points.length - 2; i += 2) {
      const x = points[i]!,
        z = points[i + 1]!,
        dx = points[i + 2]!,
        dz = points[i + 3]!;
      const norm = Math.max(Math.abs(x - dx), Math.abs(z - dz));
      split.push(jitter() * norm + (x + dx) * 0.5, jitter() * norm + (z + dz) * 0.5, dx, dz);
    }
    points = split;
  }
  return points;
}
export function riverDistanceSq(edge: TFGRiverEdge, x: number, z: number): number {
  let distance = Number.MAX_VALUE;
  const p = edge.segments;
  for (let i = 0; i < p.length - 2; i += 2)
    distance = Math.min(distance, lineDistanceSq(p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!, x, z));
  return distance;
}

/** MidpointFractal.maybeIntersect, including its conservative bounding test. */
export function riverMaybeIntersects(edge: TFGRiverEdge, x: number, z: number, radius: number): boolean {
  const norm = encompassingRange * Math.max(Math.abs(edge.sourceX - edge.drainX), Math.abs(edge.sourceZ - edge.drainZ));
  return lineDistanceSq(edge.sourceX, edge.sourceZ, edge.drainX, edge.drainZ, x, z) <= (radius + norm) ** 2;
}
export function addRiversAndLakes(
  region: TFGRegion,
  random: XoroshiroRandomSource,
): TFGRiverEdge[] {
  const builders: Builder[] = [];
  for (const point of region.data) {
    if (!point?.shore()) continue;
    let best = 1.401298464324817e-45,
      count = 0,
      angle = NaN;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const p = region.data[region.offset(point.index, 4 * dx, 4 * dz)];
        if (!p?.land()) continue;
        const metric = p.distanceToOcean - Math.abs(dx) - Math.abs(dz);
        if (metric > best || (metric === best && random.nextInt(1 + count) === 0)) {
          if (metric > best) {
            best = metric;
            count = 0;
          }
          count++;
          angle = f(Math.atan2(dz, dx));
        }
      }
    if (Number.isNaN(angle)) continue;
    angle = f(angle + f(f(random.nextFloat() * f(0.2)) - f(0.1)));
    builders.push(
      new Builder(XoroshiroRandomSource.fromSeed(random.nextLong()), {
        x: f(point.x + 0.5),
        z: f(point.z + 0.5),
        angle,
        length: f(2.7),
        distance: 0,
      }),
    );
    point.setRiver();
  }
  const blocked = (edge: Edge): boolean => {
    const prev = region.maybeAt(Math.floor(edge.drain.x + 0.5), Math.floor(edge.drain.z + 0.5));
    const next = region.maybeAt(Math.floor(edge.source.x + 0.5), Math.floor(edge.source.z + 0.5));
    if (
      !prev ||
      !next?.land() ||
      next.distanceToOcean < prev.distanceToOcean ||
      next.distanceToOcean < Math.min(3, Math.trunc(edge.drain.distance / 2))
    )
      return true;
    return builders.some((b) => b.blocked(edge));
  };
  const heap = new BuilderHeap();
  for (const b of builders) if (b.initial(blocked)) heap.push(b);
  for (let b = heap.pop(); b; b = heap.pop()) if (!b.branch(blocked)) heap.push(b);
  const edges: TFGRiverEdge[] = builders.flatMap((b) =>
    b.edges.map((e) => ({
      ...e,
      sourceX: e.source.x,
      sourceZ: e.source.z,
      drainX: e.drain.x,
      drainZ: e.drain.z,
      segments: fractal(e, random),
      width: 0,
      hasSource: false,
    })),
  );
  const sources = new Map(edges.map((e) => [e.source, e]));
  for (const e of edges) {
    const drain = sources.get(e.drain);
    if (drain) {
      e.downstream = drain;
      drain.hasSource = true;
    }
  }
  for (const e of edges)
    if (!e.hasSource) {
      let width = 8;
      for (let current: TFGRiverEdge | undefined = e; current; current = current.downstream) {
        current.width = Math.max(current.width, width);
        width = Math.min(width + 2, 24);
      }
    }
  for (const e of edges)
    if (!e.hasSource && random.nextInt(3) === 0) {
      for (const [dx, dz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const p = region.maybeAt(
          Math.trunc(e.source.x + f(f(0.3) * dx!)),
          Math.trunc(e.source.z + f(f(0.3) * dz!)),
        );
        if (p?.land() && p.distanceToOcean >= 2 && p.distanceToEdge >= 2 && hasLake(p.biome)) {
          p.biome = lakeFor(p.biome);
          p.rainfall = f(p.rainfall + f(f(0.09) * f(500 - p.rainfall)));
        }
      }
    }
  region.rivers = edges;
  return edges;
}

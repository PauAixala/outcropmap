/** TFC 1.20.x region tasks, revision b158c9c: AnnotateBaseLandHeight, AddMountains,
 * AnnotateBiomeAltitude. Preserve traversal and random draw order, including enqueueFirst.
 * Fixture-verified bit-exact against real compiled TFC source
 * (tests/parity/tfc-1.20-biomes.parity.test.ts, tests/fixtures/tfc-1.20/biomes.json) — see
 * docs/PARITY.md and docs/WORLDGEN-NOTES.md's "Biome assignment" section. */
import type { RandomSource } from '@core/random';
import type { Region } from './region';
import type { RegionBuildContext } from './tasks';

const f = Math.fround;
const byte = (n: number): number => (n << 24) >> 24;

/** A bounded deque for BFS passes: each point is inserted at most once. */
class Deque {
  private readonly values: Int32Array;
  private head: number;
  private tail: number;
  constructor(size: number) { this.values = new Int32Array(2 * size + 1); this.head = this.tail = size; }
  push(n: number): void { this.values[this.tail++] = n; }
  first(n: number): void { this.values[--this.head] = n; }
  pop(): number { return this.values[this.head++]!; }
  get empty(): boolean { return this.head === this.tail; }
}

/** AnnotateBaseLandHeight.apply. */
export function annotateBaseLandHeight({ region, random }: RegionBuildContext): void {
  const explored = new Uint8Array(region.data.length);
  const queue = new Deque(region.data.length);
  const islands: number[] = [];
  for (let x = 0; x < region.sizeX; x++) for (let z = 0; z < region.sizeZ; z++) {
    const i = x + region.sizeX * z, p = region.data[i];
    if (p?.land()) {
      p.baseLandHeight = p.distanceToOcean;
      if (p.baseLandHeight > p.distanceToEdge) p.baseLandHeight = byte(f(f(f(0.3) * p.baseLandHeight) + f(f(0.7) * p.distanceToEdge)));
      explored[i] = 1;
      if (p.island()) { p.baseOceanDepth = 3; islands.push(i); }
      else { p.baseOceanDepth = 0; queue.push(i); }
    }
  }
  while (!queue.empty) {
    const last = queue.pop(), p = region.data[last]!, depth = p.baseOceanDepth + 1;
    if (depth === 3 && islands.length) { for (const i of islands) queue.push(i); islands.length = 0; }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const next = region.offset(last, dx, dz);
      if (next === -1) continue;
      const q = region.data[next];
      if (q && !q.land() && q.baseOceanDepth === 0 && !explored[next]) {
        if (random.nextInt(15) === 0) { q.baseOceanDepth = p.baseOceanDepth; queue.first(next); }
        else { q.baseOceanDepth = byte(depth); queue.push(next); }
      }
      explored[next] = 1;
    }
  }
}

/** AddMountains.placeRange. Set iteration order only writes flags; queue order affects RNG later. */
function placeRange(region: Region, random: RandomSource, origin: number): Set<number> {
  const explored = new Uint8Array(region.data.length), queue = new Deque(region.data.length);
  const range = new Set([origin]);
  queue.push(origin); explored[origin] = 1;
  const height = Math.max(1, region.data[origin]!.baseLandHeight), maxSize = 70 + random.nextInt(40);
  while (!queue.empty) {
    const last = queue.pop(), p = region.data[last]!;
    if (range.size > maxSize) break;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const next = region.offset(last, dx, dz);
      if (next === -1) continue;
      const q = region.data[next];
      if (q?.land() && q.baseLandHeight >= height - 1 && q.baseLandHeight <= height + 1 && (q.baseLandHeight > 2 || q.distanceToOcean < 3) && !explored[next]) {
        if (p.baseLandHeight !== q.baseLandHeight) queue.push(next); else queue.first(next);
        range.add(next);
      }
      explored[next] = 1;
    }
  }
  return range;
}

/** AddMountains.apply. These are height-contour mountain ranges, not a tectonic plate simulation. */
export function addMountains({ region, random }: RegionBuildContext): void {
  for (let attempt = 0, placed = 0; attempt < 40 && placed < 3; attempt++) {
    const x = region.minX + random.nextInt(region.sizeX), z = region.minZ + random.nextInt(region.sizeZ);
    const origin = region.maybeAt(x, z);
    if (origin?.land() && (origin.baseLandHeight <= 1 || (origin.baseLandHeight >= 4 && origin.baseLandHeight <= 11))) {
      const range = placeRange(region, random, region.index(x, z));
      if (range.size > 45) {
        for (const i of range) { const p = region.data[i]!; p.setMountain(); if (origin.baseLandHeight <= 2) p.setCoastalMountain(); }
        placed++;
      }
    }
  }
}

/** AnnotateBiomeAltitude.apply. */
export function annotateBiomeAltitude({ region, random }: RegionBuildContext): void {
  const explored = new Uint8Array(region.data.length), queue = new Deque(region.data.length);
  for (let x = 0; x < region.sizeX; x++) for (let z = 0; z < region.sizeZ; z++) {
    const i = x + region.sizeX * z, p = region.data[i];
    if (p?.land() && p.mountain()) { p.biomeAltitude = 12; queue.push(i); explored[i] = 1; }
  }
  while (!queue.empty) {
    const last = queue.pop(), p = region.data[last]!, altitude = p.biomeAltitude - 1;
    if (altitude < 0) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const next = region.offset(last, dx, dz);
      if (next === -1) continue;
      const q = region.data[next];
      if (q?.land() && q.biomeAltitude === 0 && !explored[next]) {
        if (random.nextInt(13) === 0 && p.biomeAltitude !== 12) { q.biomeAltitude = p.biomeAltitude; queue.first(next); }
        else { q.biomeAltitude = byte(altitude); queue.push(next); }
      }
      explored[next] = 1;
    }
  }
  for (let x = 0; x < region.sizeX; x++) for (let z = 0; z < region.sizeZ; z++) {
    const p = region.data[x + region.sizeX * z];
    if (p?.land() && p.discreteBiomeAltitude() === 0 && p.baseLandHeight >= 4) {
      p.biomeAltitude = 4;
      if (p.baseLandHeight >= 11) p.biomeAltitude = 8;
    }
  }
}

/** TFG Core Modern 0.9.21 regional replacements. Derived from TFC, EUPL-1.2. */
import type { XoroshiroRandomSource } from '@core/random';
import type { Area } from '../../tfc-1.20/biome/area';
import type { Noise2D } from '../../tfc-1.20/noise/noise2d';
import { mthClampedMap as map, mthLerp as lerp } from '../../tfc-1.20/region/mth';
import type { hotspotFields } from '../noise/hotspots';
import { TFGRegion, TFGRegionPoint } from './initialization';

const f = Math.fround;
const byte = (n: number): number => (n << 24) >> 24;
const at = (r: TFGRegion, i: number, dx: number, dz: number): TFGRegionPoint | undefined =>
  r.data[r.offset(i, dx, dz)];

export function addIslands(region: TFGRegion, random: XoroshiroRandomSource): void {
  for (let attempt = 0, placed = 0; attempt < 130 && placed < 15; attempt++) {
    let point = region.data[random.nextInt(region.data.length)];
    if (!point) continue;
    const origin = point; // Upstream retains the initial point throughout the chain.
    if (!point.land() && !point.shore() && point.distanceToEdge > 2) {
      for (let island = 0; island < 12; island++) {
        point.setLand();
        point.setIsland();
        point = region.maybeAt(
          origin.x + random.nextInt(4) - random.nextInt(4),
          origin.z + random.nextInt(4) - random.nextInt(4),
        ) as TFGRegionPoint | undefined;
        if (!point || (point.land() && !point.island()) || point.distanceToEdge <= 2) break;
      }
      placed++;
    }
  }
}

export function addHotspots(region: TFGRegion, noise: ReturnType<typeof hotspotFields>): void {
  const queue: number[] = [];
  // Intensity at each point's centre, by point index. Every point is evaluated in the first pass,
  // and the flood fill asks for exactly those positions again; recomputing them was most of this
  // task's cost (each is four noise fields, three of them domain-warped).
  const intensityByIndex = new Float64Array(region.data.length);
  for (const point of region.data) {
    if (!point) continue;
    const cell = noise.plates.cell(point.x, point.z);
    const values = noise.values(point.x + 0.5, point.z + 0.5);
    const intensity = Math.max(...values);
    intensityByIndex[point.index] = intensity;
    if (intensity > 0.65 && Math.abs(cell.f1 - cell.f2) > 0.05) {
      point.hotSpotAge = byte(Math.trunc(noise.ageOf(values)));
      if (point.hotSpotAge !== 4) point.setLand();
      queue.push(point.index);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!,
      age = region.data[index]!.hotSpotAge;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const next = at(region, index, dx, dz);
        if (!next || next.hotSpotAge !== 0) continue;
        if (intensityByIndex[next.index]! > 0.15) {
          queue.push(next.index);
          next.hotSpotAge = age;
          if (age !== 4) next.setLand();
        } else if (!next.land() && noise.intensity(next.x + 0.5 - dx, next.z + 0.5 - dz) > 0.15) {
          next.hotSpotAge = age;
          if (age !== 4) next.setLand();
        }
      }
  }
}

export function annotateDistanceToOcean(region: TFGRegion): void {
  const explored = new Uint8Array(region.data.length),
    queue: number[] = [];
  for (const point of region.data)
    if (point && !point.land()) {
      point.distanceToOcean = -1;
      queue.push(point.index);
      explored[point.index] = 1;
    }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!,
      last = region.data[index]!,
      distance = last.distanceToOcean + 1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const point = at(region, index, dx, dz);
        if (point && point.land() && point.distanceToOcean === 0) {
          if (!last.land() && !point.island()) last.setShore();
          if (!explored[point.index]) {
            point.distanceToOcean = byte(distance);
            queue.push(point.index);
          }
          explored[point.index] = 1;
        }
      }
  }
}

export function annotateDistanceToWestCoast(region: TFGRegion, scale: number): void {
  for (let dx = 0; dx < region.sizeX; dx++)
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz,
        point = region.data[index];
      if (!point || dx === 0) continue;
      const last = region.data[index - 1];
      if (!last) point.distanceToWestCoast = point.land() ? byte(25 + point.distanceToOcean) : 0;
      else if (!point.land())
        point.distanceToWestCoast = byte(Math.max(last.distanceToWestCoast - 2, 0));
      else {
        const frequency = f(128 / f(2 * scale));
        const wave = f(
          Math.abs(
            f(
              f(f(4 * frequency) * point.z) -
                f(4 * Math.floor(f(f(frequency * point.z) + f(0.75)))),
            ),
          ) - 1,
        );
        const start = -2 + (wave > 0.1 ? 1 : 0),
          end = 2 - (wave < -0.1 ? 1 : 0);
        let sum = 0;
        for (let dz2 = start; dz2 <= end; dz2++)
          sum += at(region, index, -1, dz2)?.distanceToWestCoast ?? last.distanceToWestCoast;
        point.distanceToWestCoast = byte(Math.ceil(f(sum / (1 + end - start))) + 1);
      }
    }
  const explored = new Uint8Array(region.data.length),
    queue: number[] = [];
  for (let dx = 0; dx < region.sizeX; dx++)
    for (let dz = 0; dz < region.sizeZ; dz++) {
      const index = dx + region.sizeX * dz;
      if (region.data[index]?.land()) {
        explored[index] = 1;
        queue.push(index);
      }
    }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!,
      last = region.data[index]!.distanceToWestCoast;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const point = at(region, index, dx, dz);
        if (point && point.distanceToWestCoast === 0) {
          if (!explored[point.index]) {
            point.distanceToWestCoast = byte(last + (last > 40 ? -1 : 1));
            queue.push(point.index);
          }
          explored[point.index] = 1;
        }
      }
  }
}

export function annotateClimate(
  region: TFGRegion,
  temperature: Noise2D,
  rainfall: Noise2D,
  ocean: Noise2D,
): void {
  for (const p of region.data) {
    if (!p) continue;
    p.temperature = f(temperature(p.x, p.z));
    p.rainfall = f(rainfall(p.x, p.z));
    const bias = p.land()
      ? Math.min(map(p.distanceToEdge, 2, 6, 0, 1), map(p.distanceToOcean, 2, 6, 0, 1))
      : 0;
    const targetTemp = lerp(bias, 5, p.temperature);
    const targetRain = lerp(bias, Math.min(f(p.rainfall + 350), 500), p.rainfall);
    const delta = map(f(ocean(p.x, p.z)), f(-0.8), f(0.9), f(-0.07), f(0.23));
    const oldTemp = p.temperature;
    p.temperature = lerp(delta, oldTemp, targetTemp);
    const rainDelta = map(f(p.temperature - oldTemp), -2, 2, 0, 0.25);
    p.rainfall = Math.max(0, Math.min(500, lerp(rainDelta, p.rainfall, targetRain)));
  }
}

export function chooseRocks(region: TFGRegion, area: Area): void {
  for (const center of region.data) {
    if (!center) continue;
    let type = center.land() ? 2 : 0,
      minDist = 2147483647;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const point = at(region, center.index, dx, dz),
          dist = Math.abs(dx) + Math.abs(dz);
        if (point && dist < minDist) {
          if ((point.island() && dist < 4) || point.hotSpotAge > 0) {
            type = 1;
            minDist = dist;
          } else if ((point.mountain() || point.coastalMountain()) && dist < 3) {
            type = 3;
            minDist = dist;
          }
        }
      }
    center.rock = (area(center.x, center.z) << 2) | type;
  }
}

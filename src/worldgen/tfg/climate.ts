/** TFG RegionChunkDataGeneratorMixin rainfall correction, with TFC chunk interpolation. */
import { scaledCorners, getValue } from '../tfc-1.20/climate';
import { mthClampedMap } from '../tfc-1.20/region/mth';
import type { ClimateSample } from '../api/types';
import type { TFGRegionGenerator } from './region/generator';
import { riverDistanceSq, riverMaybeIntersects } from './region/rivers';
const f = Math.fround;

export function sampleClimate(generator: TFGRegionGenerator, x: number, z: number): ClimateSample {
  const ox = (x >> 4) << 4,
    oz = (z >> 4) << 4,
    gx = ox >> 7,
    gz = oz >> 7;
  const p00 = generator.getOrCreateRegionPoint(gx, gz),
    p01 = generator.getOrCreateRegionPoint(gx, gz + 1);
  const p10 = generator.getOrCreateRegionPoint(gx + 1, gz),
    p11 = generator.getOrCreateRegionPoint(gx + 1, gz + 1);
  const dx = ox / 128 - gx,
    dz = oz / 128 - gz;
  const temperature = scaledCorners(
    p00.temperature,
    p01.temperature,
    p10.temperature,
    p11.temperature,
    dx,
    dz,
    0.125,
  );
  const rainfall = {
    ...scaledCorners(p00.rainfall, p01.rainfall, p10.rainfall, p11.rainfall, dx, dz, 0.125),
  };
  for (const edge of generator.riversAt(gx, gz)) {
    if (edge.width < 12 || !riverMaybeIntersects(edge, ox / 128, oz / 128, 0.3125)) continue;
    const width = f((edge.width - 12) / 12);
    for (const [key, cx, cz] of [
      ['v00', ox, oz],
      ['v01', ox, oz + 16],
      ['v10', ox + 16, oz],
      ['v11', ox + 16, oz + 16],
    ] as const) {
      const distance = f(riverDistanceSq(edge, cx / 128, cz / 128));
      const influence = mthClampedMap(distance, 0, f(0.3125 * 0.3125), 1, 0);
      rainfall[key] = Math.max(rainfall[key], f(f(influence * width) * 300));
    }
  }
  for (const key of ['v00', 'v01', 'v10', 'v11'] as const)
    rainfall[key] = Math.min(500, Math.max(0, rainfall[key]));
  return {
    temperature: getValue(temperature, (x & 15) / 16, (z & 15) / 16),
    rainfall: getValue(rainfall, (x & 15) / 16, (z & 15) / 16),
  };
}

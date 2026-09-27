import { describe, expect, it } from 'vitest';
import { sampleBiomeColumn, sampleChunkBiomes } from '@worldgen/tfc-1.20/biome/chunk-biome-sampler';
import { biomeHeightNoise } from '@worldgen/tfc-1.20/biome/height-noise';
import { Biome } from '@worldgen/tfc-1.20/biome/ids';
import { SurfaceHeightSampler } from '@worldgen/tfc-1.20/biome/surface-height';

describe('TFC 1.20 surface height', () => {
  it('preserves a uniform biome through chunk and column blending', () => {
    const corners = sampleChunkBiomes(-2, 3, () => Biome.PLAINS);
    for (const [x, z] of [
      [0, 0],
      [3, 7],
      [15, 15],
    ] as const) {
      const weights = sampleBiomeColumn(corners, x, z);
      expect([...weights.keys()]).toEqual([Biome.PLAINS]);
      expect(weights.get(Biome.PLAINS)).toBeCloseTo(1, 10);
    }
  });

  it('matches the biome height map when the whole neighbourhood is one biome', () => {
    const seed = 123456789n;
    const x = -37;
    const z = 91;
    const expected = biomeHeightNoise(Biome.PLAINS, seed)?.(x, z);
    expect(expected).toBeDefined();
    const sampler = new SurfaceHeightSampler(seed, () => Biome.PLAINS);
    expect(sampler.sample(x, z)).toBe(Math.trunc(Math.fround(expected ?? Number.NaN)));
  });

  it('returns stable integer heights across land, ocean and shore transitions', () => {
    const sampler = new SurfaceHeightSampler(42n, (x) =>
      x < -2 ? Biome.DEEP_OCEAN : x > 2 ? Biome.HILLS : Biome.SHORE,
    );
    const positions = [-512, -64, 0, 64, 512];
    const values = positions.map((x) => sampler.sample(x, 12));
    expect(values.every(Number.isInteger)).toBe(true);
    expect(values[0]).toBeLessThan(SEA_LEVEL_FOR_TEST);
    expect(values.at(-1)).toBeGreaterThan(SEA_LEVEL_FOR_TEST);
    expect(positions.map((x) => sampler.sample(x, 12))).toEqual(values);
  });
});

const SEA_LEVEL_FOR_TEST = 63;

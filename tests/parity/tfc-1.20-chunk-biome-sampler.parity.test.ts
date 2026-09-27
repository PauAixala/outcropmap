import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/tfc-1.20/chunk-biome-sampler.json';
import {
  sampleBiomeColumn,
  sampleChunkBiomes,
  type BiomeWeights,
} from '@worldgen/tfc-1.20/biome/chunk-biome-sampler';
import { Biome } from '@worldgen/tfc-1.20/biome/ids';

interface FixtureCase {
  kind: 'corner' | 'column';
  chunkX: number;
  chunkZ: number;
  index?: number;
  x?: number;
  z?: number;
  weights: [number, number][];
}

function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function biomeAtBlock(x: number, z: number): Biome {
  const quartX = Math.floor(x / 4);
  const quartZ = Math.floor(z / 4);
  return floorMod(quartX * 31 + quartZ * 17 + quartX * quartZ, 30) as Biome;
}

describe('TFC 1.20 ChunkBiomeSampler parity', () => {
  it.each(fixture.cases as unknown as FixtureCase[])('$kind $chunkX,$chunkZ', (testCase) => {
    const corners = sampleChunkBiomes(testCase.chunkX, testCase.chunkZ, biomeAtBlock);
    const actual: BiomeWeights =
      testCase.kind === 'corner'
        ? corners[testCase.index ?? -1]!
        : sampleBiomeColumn(corners, testCase.x ?? 0, testCase.z ?? 0);
    expect(actual.size).toBe(testCase.weights.length);
    for (const [biome, expected] of testCase.weights) {
      expect(actual.get(biome as Biome)).toBeCloseTo(expected, 12);
    }
  });

  it('records the exact upstream source revision', () => {
    expect(fixture.revision).toBe('b158c9c968cad7afb99cea2c937b301ff275e2e6');
  });
});

import { describe, expect, it } from 'vitest';
import { DimensionBiomeSampler, type DimensionClimateData } from '@worldgen/vanilla/dimension-biomes';
import fixture from '../fixtures/tfg/beneath-biomes.json';
import beneath from '@data/tfg/dimensions/beneath.json';

/**
 * The Beneath's biomes, against the biomes a real Beneath has — 2 000 quart cells read straight out
 * of DIM-1's region files, spread over 36 regions and the whole height of the dimension.
 *
 * This is an exact check, not a percentage, and it is the fixture that earned it. Two separate
 * mistakes each produced a field that *looked* right — the same amplitude spread, the same
 * three-layer structure, the layer itself 92% correct — while agreeing with the real world no more
 * often than guessing:
 *
 * 1. `PerlinNoise`'s `lowestFreqInputFactor` is `Math.pow(2.0, -j)` in Java, where `j` is `-firstOctave`.
 *    Porting the minus sign twice put a `firstOctave` of -9 eighteen octaves off.
 * 2. TerraFirmaGreg's Beneath sets `legacy_random_source`, which swaps every noise onto
 *    `LegacyRandomSource` *and* replaces `minecraft:offset` with a zero-amplitude noise, so the
 *    coordinate shift the other dimensions apply is simply absent here.
 *
 * Measured: legacy + zeroed shift 100%; legacy alone 90.3%; Xoroshiro either way 30.9%. Both
 * choices are load-bearing, and neither would have been caught by anything short of a real world.
 */
describe('the Beneath biomes, against a real one', () => {
  const data = fixture as { seed: string; samples: { qx: number; qy: number; qz: number; biome: string }[] };
  const sampler = new DimensionBiomeSampler(
    beneath as unknown as DimensionClimateData,
    BigInt(data.seed),
  );

  it('has a fixture worth checking against', () => {
    expect(data.samples.length).toBeGreaterThan(1000);
    expect(new Set(data.samples.map((s) => s.biome)).size).toBeGreaterThan(8);
  });

  it('matches every sampled cell', () => {
    const wrong: string[] = [];
    for (const s of data.samples) {
      const got = sampler.biomeAtQuart(s.qx, s.qy, s.qz);
      if (got !== s.biome) wrong.push(`(${s.qx},${s.qy},${s.qz}) ${s.biome} -> ${got}`);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(wrong.length).toBe(0);
  });
});

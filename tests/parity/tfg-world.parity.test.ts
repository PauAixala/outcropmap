import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/tfg-world-biomes.json';
import { TFGGenerator } from '../../src/worldgen/tfg';

describe('TFG 0.9.21 saved-world observations', () => {
  const generator = new TFGGenerator({ seed: BigInt(fixture.seed), dimension: 'overworld' });
  it('matches every captured generated quart biome, without exemptions', () => {
    expect(fixture.points.length).toBeGreaterThan(800);
    const mismatches = fixture.points.flatMap((p) => {
      const actual = generator.biome(p.x, p.z);
      return actual === p.biome ? [] : [{ x: p.x, z: p.z, expected: p.biome, actual }];
    });
    expect(mismatches).toEqual([]);
  }, 60000);
  it('matches stored chunk climate, including interpolation and river influence', () => {
    expect(fixture.climateChunks.length).toBeGreaterThan(100);
    const mismatches: unknown[] = [];
    for (const c of fixture.climateChunks) {
      // At the chunk origin the stored 00 corner is returned exactly.
      const actual = generator.climate(c.x, c.z);
      if (actual.temperature !== c.temperature['00'] || actual.rainfall !== c.rainfall['00'])
        mismatches.push({
          x: c.x,
          z: c.z,
          actual,
          temperature: c.temperature['00'],
          rainfall: c.rainfall['00'],
        });
    }
    expect(mismatches).toEqual([]);
  }, 60000);
});

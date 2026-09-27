import '../../src/worldgen/profiles';
import { describe, expect, it, vi } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { discDepositsInBox, filterDiscDepositsByClimate } from '../../src/worldgen/tfc-1.20/features';

describe('kaolin climate eligibility, seed 0', () => {
  const box = { minX: -256, minZ: -256, maxX: 255, maxZ: 255 };
  const candidates = discDepositsInBox(box, 0n, () => 'tfc:highlands');
  const kaolin = candidates.filter((d) => d.ore === 'tfc:kaolin');
  const others = candidates.filter((d) => d.ore !== 'tfc:kaolin');

  it('rejects cold, dry and missing climate; accepts inclusive limits without changing other minerals', () => {
    expect(kaolin.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    for (const climate of [null, { temperature: 17.999, rainfall: 500 }, { temperature: 30, rainfall: 299.999 }]) {
      expect(filterDiscDepositsByClimate(candidates, () => climate)).toEqual(others);
    }
    expect(filterDiscDepositsByClimate(candidates, () => ({ temperature: 18, rainfall: 300 }))).toEqual(candidates);
  });

  it('checks target chunk origins, including negative coordinates and a warm neighbouring chunk', () => {
    const candidate = { ...kaolin[0]!, x: -1, z: -1 };
    const sampled: number[][] = [];
    const result = filterDiscDepositsByClimate([candidate], (x, z) => {
      sampled.push([x, z]);
      return { temperature: x === 16 && z === 16 ? 18 : 17, rainfall: 300 };
    });
    expect(result).toEqual([candidate]);
    expect(sampled).toHaveLength(16);
    expect(sampled[0]).toEqual([-32, -32]);
    expect(sampled.every(([x, z]) => x! % 16 === 0 && z! % 16 === 0)).toBe(true);
  });

  it('applies the climate stage in the public generator while preserving seed-derived candidates', () => {
    const generator = createGenerator('tfc-1.20', { seed: 0n, dimension: 'overworld' });
    vi.spyOn(generator, 'biome').mockReturnValue('tfc:highlands');
    const climate = vi.spyOn(generator, 'climate').mockReturnValue({ temperature: 17, rainfall: 400 });
    // `features()` is more than the climate stage now: it also returns cluster and pipe veins, and
    // it drops deposits that generate no ore (`resolveDepositDepth`). So this compares the *effect*
    // of the climate stage -- which disc ids appear -- rather than the whole list, which would make
    // the test fail every time an unrelated stage is added.
    const discIds = (): string[] =>
      generator
        .features(box)
        .deposits.filter((d) => d.shape === 'disc')
        .map((d) => d.id)
        .sort();
    const cold = discIds();
    climate.mockReturnValue({ temperature: 25, rainfall: 299 });
    expect(discIds()).toEqual(cold);
    expect(cold.some((id) => id.startsWith('kaolin'))).toBe(false);

    climate.mockReturnValue({ temperature: 18, rainfall: 300 });
    const warm = discIds();
    expect(warm.some((id) => id.startsWith('kaolin'))).toBe(true);
    // Warming the climate only ever adds kaolin; it never disturbs the other minerals.
    expect(warm.filter((id) => !id.startsWith('kaolin'))).toEqual(cold);
    vi.restoreAllMocks();
  });

  it('cluster veins are returned alongside the discs and are not climate-filtered', () => {
    const generator = createGenerator('tfc-1.20', { seed: 0n, dimension: 'overworld' });
    vi.spyOn(generator, 'biome').mockReturnValue('tfc:highlands');
    const climate = vi.spyOn(generator, 'climate').mockReturnValue({ temperature: 0, rainfall: 0 });
    const clusters = generator.features(box).deposits.filter((d) => d.shape === 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
    climate.mockReturnValue({ temperature: 30, rainfall: 500 });
    expect(generator.features(box).deposits.filter((d) => d.shape === 'cluster')).toEqual(clusters);
    vi.restoreAllMocks();
  });
});

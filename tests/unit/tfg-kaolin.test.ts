import { describe, expect, it } from 'vitest';
import { KAOLIN_BIOMES, kaolinInBox } from '../../src/worldgen/tfg/kaolin';

describe('TFG kaolin placement gates', () => {
  const box = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };
  const biome = () => 'tfg:earth/plateau_wide';
  it('uses the installed TFG biome additions', () => {
    expect(KAOLIN_BIOMES.has('tfg:earth/plateau_wide')).toBe(true);
    expect(KAOLIN_BIOMES.has('tfg:earth/cenote_highlands')).toBe(true);
    expect(KAOLIN_BIOMES.has('tfg:earth/plains')).toBe(false);
    expect(
      kaolinInBox(
        box,
        42n,
        () => 'tfg:earth/plains',
        () => ({ temperature: 30, rainfall: 500 }),
      ),
    ).toEqual([]);
  });
  it('accepts inclusive climate limits and rejects cold or dry locations', () => {
    const deposits = kaolinInBox(box, 42n, biome, () => ({ temperature: 18, rainfall: 300 }));
    expect(deposits.length).toBeGreaterThan(0);
    expect(kaolinInBox(box, 42n, biome, () => ({ temperature: 17.999, rainfall: 300 }))).toEqual(
      [],
    );
    expect(kaolinInBox(box, 42n, biome, () => ({ temperature: 18, rainfall: 299.999 }))).toEqual(
      [],
    );
    expect(deposits.every((d) => d.surfaceY === null && d.exposure === 'unknown')).toBe(true);
  });
  it('keeps a cross-chunk deposit when an intersected chunk passes climate', () => {
    const all = kaolinInBox(box, 42n, biome, () => ({ temperature: 20, rainfall: 400 }));
    const chosen = all[0]!;
    const cx = (chosen.x - 18) >> 4,
      cz = (chosen.z - 18) >> 4;
    const selected = kaolinInBox(box, 42n, biome, (x, z) => ({
      temperature: 20,
      rainfall: x === cx * 16 && z === cz * 16 ? 400 : 0,
    }));
    expect(selected.some((d) => d.id === chosen.id)).toBe(true);
  });
});

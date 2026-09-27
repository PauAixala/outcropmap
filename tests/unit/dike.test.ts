import { describe, expect, it } from 'vitest';
import '@worldgen/profiles';
import { dikeContains, dikeVeinsFor, dikesInBox } from '@worldgen/tfc-1.20/features/dike';

/**
 * TerraFirmaGreg's overworld adds three of TFC's dikes back to the vein tag. They place raw granite,
 * diorite and gabbro, and our rock model was 79.2% right on those three rocks against 98.3% on every
 * other one until they were modelled. See features/dike.ts and docs/WORLDGEN-NOTES.md.
 */
describe('dikes', () => {
  it('finds the three TFG borrows from TFC, and no ore vein', () => {
    const ids = dikeVeinsFor('tfg').map((vein) => vein.id).sort();
    expect(ids).toEqual(['diorite_dike', 'gabbro_dike', 'granite_dike']);
    for (const vein of dikeVeinsFor('tfg')) expect(vein.produces).toEqual([]);
  });

  it('places them across a region, deterministically', () => {
    const box = { minX: 0, minZ: 0, maxX: 1023, maxZ: 1023 };
    const first = dikesInBox(box, -6696614430994881185n, 'tfg');
    expect(first.length).toBeGreaterThan(0);
    expect(dikesInBox(box, -6696614430994881185n, 'tfg')).toEqual(first);
    for (const dike of first) {
      expect(['granite', 'diorite', 'gabbro']).toContain(dike.rock);
      expect(dikeContains(dike, dike.x, dike.y, dike.z)).toBe(true);
      // Beyond its own height it cannot reach, whatever the lean.
      expect(dikeContains(dike, dike.x, dike.y + dike.height, dike.z)).toBe(false);
      expect(dikeContains(dike, dike.x + dike.radius + dike.skew + 1, dike.y, dike.z)).toBe(false);
    }
  });

  it('leans: the body is not a straight column', () => {
    const box = { minX: -2048, minZ: -2048, maxX: 2047, maxZ: 2047 };
    const dikes = dikesInBox(box, 42n, 'tfg');
    const leaning = dikes.filter((dike) => {
      const high = dikeContains(dike, dike.x, dike.y + dike.height - 2, dike.z);
      const low = dikeContains(dike, dike.x, dike.y - dike.height + 2, dike.z);
      return high !== low;
    });
    expect(leaning.length).toBeGreaterThan(0);
  });
});

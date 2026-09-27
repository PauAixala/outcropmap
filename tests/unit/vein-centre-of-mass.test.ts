import { describe, expect, it } from 'vitest';
import { centreOfMass3D, simpleMetaballs3D } from '@worldgen/tfc-1.20/features/metaballs-3d';
import { centreOfMass2D, simpleMetaballs2D } from '@worldgen/tfc-1.20/features/metaballs-2d';
import { XoroshiroRandomSource } from '@core/random/xoroshiro';

/**
 * A marker points at the ore, not at the `BlockPos` the feature rolled. The body is scattered around
 * that origin, so the two are a mean 5.2 blocks apart horizontally — see `centreOfMass3D`.
 */
describe('the centre of a vein body', () => {
  it('lands inside the body, unlike the rolled origin', () => {
    let insideCentre = 0;
    let insideOrigin = 0;
    for (let i = 0; i < 40; i++) {
      const shape = simpleMetaballs3D(XoroshiroRandomSource.fromSeed(BigInt(i)), 37);
      const c = centreOfMass3D(shape);
      if (shape.inside(c.x, c.y, c.z)) insideCentre++;
      if (shape.inside(0, 0, 0)) insideOrigin++;
    }
    expect(insideCentre).toBeGreaterThan(insideOrigin);
    expect(insideCentre).toBeGreaterThan(35);
  });

  it('stays within the body reach', () => {
    for (let i = 0; i < 20; i++) {
      const size = 20 + i;
      const c = centreOfMass3D(simpleMetaballs3D(XoroshiroRandomSource.fromSeed(BigInt(i)), size));
      expect(Math.hypot(c.x, c.y, c.z)).toBeLessThan(size);
    }
  });

  it('does the same in two dimensions for a disc', () => {
    for (let i = 0; i < 20; i++) {
      const shape = simpleMetaballs2D(XoroshiroRandomSource.fromSeed(BigInt(i)), 24);
      const c = centreOfMass2D(shape);
      expect(shape.inside(c.x, c.z)).toBe(true);
    }
  });
});

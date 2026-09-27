/**
 * Parity for the metaball ports the vein features are built on.
 *
 * Golden values come from `tools/parity/capture-tfc-metaballs.mjs`, which compiles the **verbatim**
 * `Metaballs2D`, `Metaballs3D` and `Helpers` bodies out of the TFC 1.20.x checkout and runs them on
 * a JVM. Anything that disagrees here is a real port bug, not a tolerance question — these are
 * deterministic functions of the seed.
 *
 * What this is really guarding: `simple()` computes `0.1f/0.3f/0.5f * size` in **float** before
 * widening to the `double` constructor, the two classes consume different numbers of RNG draws, and
 * `Metaballs2D.sample` has no `> 1` early exit. Every one of those mistakes produces plausible
 * output, which is exactly why reading the source was never going to be enough.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/tfc-1.20/metaballs.json';
import { simpleMetaballs3D } from '../../src/worldgen/tfc-1.20/features/metaballs-3d';
import { simpleMetaballs2D } from '../../src/worldgen/tfc-1.20/features/metaballs-2d';
import { XoroshiroRandomSource } from '../../src/core/random';

interface Case {
  readonly seedLo: string;
  readonly seedHi: string;
  readonly size: number;
  readonly step3: number;
  readonly step2: number;
  readonly balls3d: readonly (readonly number[])[];
  readonly inside3d: readonly number[];
  readonly insideCount3d: number;
  readonly balls2d: readonly (readonly number[])[];
  readonly sample2d: readonly number[];
  readonly footprint2d: number;
}

const cases = (fixture as unknown as { cases: readonly Case[] }).cases;

function randomFor(c: Case): XoroshiroRandomSource {
  return XoroshiroRandomSource.fromSeed128({ lo: BigInt(c.seedLo), hi: BigInt(c.seedHi) });
}

describe('TFC 1.20 metaballs: parity with real Java', () => {
  it('has fixture cases to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c, i) => [i, c] as const))(
    'case %i: Metaballs3D balls, membership and exact inside-count match',
    (_i, c) => {
      const shape = simpleMetaballs3D(randomFor(c), c.size);

      // Ball count is `uniform(random, 5, 7)` -- five or six, never seven.
      expect(shape.balls.length).toBe(c.balls3d.length);
      shape.balls.forEach((ball, index) => {
        const expected = c.balls3d[index]!;
        expect(ball.x).toBe(expected[0]);
        expect(ball.y).toBe(expected[1]);
        expect(ball.z).toBe(expected[2]);
        // The float-widening trap lives in this value.
        expect(ball.weight).toBe(expected[3]);
      });

      const membership: number[] = [];
      for (let x = -c.size; x <= c.size; x += c.step3)
        for (let y = -c.size; y <= c.size; y += c.step3)
          for (let z = -c.size; z <= c.size; z += c.step3)
            membership.push(shape.inside(x, y, z) ? 1 : 0);
      expect(membership).toEqual([...c.inside3d]);

      let insideCount = 0;
      for (let x = -c.size; x <= c.size; x++)
        for (let y = -c.size; y <= c.size; y++)
          for (let z = -c.size; z <= c.size; z++) if (shape.inside(x, y, z)) insideCount++;
      // This is the number `typicalVeinBlocks` multiplies by density, so it is the figure the UI
      // ultimately shows.
      expect(insideCount).toBe(c.insideCount3d);
    },
  );

  it.each(cases.map((c, i) => [i, c] as const))(
    'case %i: Metaballs2D balls, sampled magnitudes and footprint match',
    (_i, c) => {
      const shape = simpleMetaballs2D(randomFor(c), c.size);

      // Ball count is `uniform(random, 3, 8)` -- three to seven, a different count *and* a
      // different number of draws from the 3D version.
      expect(shape.balls.length).toBe(c.balls2d.length);
      shape.balls.forEach((ball, index) => {
        const expected = c.balls2d[index]!;
        expect(ball.x).toBe(expected[0]);
        expect(ball.z).toBe(expected[1]);
        // 2D draws its weight from `minSize`, not from zero.
        expect(ball.weight).toBe(expected[2]);
      });

      // Magnitudes, not just membership: both disc chance functions scale by the sampled value.
      const samples: number[] = [];
      for (let x = -c.size; x <= c.size; x += c.step2)
        for (let z = -c.size; z <= c.size; z += c.step2) samples.push(shape.sample(x, z));
      expect(samples).toEqual([...c.sample2d]);

      let footprint = 0;
      for (let x = -c.size; x <= c.size; x++)
        for (let z = -c.size; z <= c.size; z++) if (shape.sample(x, z) > 1) footprint++;
      expect(footprint).toBe(c.footprint2d);
    },
  );
});

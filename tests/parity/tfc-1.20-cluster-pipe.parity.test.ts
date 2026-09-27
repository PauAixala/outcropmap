/**
 * Parity for cluster and pipe vein **placement**.
 *
 * Golden values come from `tools/parity/capture-tfc-cluster-pipe.mjs`, which compiles the verbatim
 * `ClusterVeinFeature#createVein`, `PipeVeinFeature#createVein` and `VeinFeature#defaultPos` /
 * `#defaultYPos` bodies out of the TFC 1.20.x checkout and runs them on a JVM.
 *
 * The cases start from a given `(lo, hi)` RNG state rather than from a world seed: the seed
 * composition in `VeinFeature#getVeinsAtChunk` is shared by all three vein shapes and is already
 * verified by `tfc-1.20-veins.parity.test.ts`. What is new here is everything built on top of it —
 * the rarity roll and the position draws.
 *
 * The pipe cases exist mainly to pin the draw **order**: `angle` is drawn on the line before the
 * constructor call, so reading the arguments left to right would move that `nextFloat()` after the
 * position and shift every later value, while still producing plausible coordinates. `skew` is
 * checked because the port reports `radius + skew` as the vein's width.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/tfc-1.20/cluster-pipe-veins.json';
import { XoroshiroRandomSource } from '../../src/core/random';
import { defaultYPos } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { simpleMetaballs3D } from '../../src/worldgen/tfc-1.20/features/metaballs-3d';

interface ClusterCase {
  readonly seedLo: string;
  readonly seedHi: string;
  readonly rarity: number;
  readonly minY: number;
  readonly maxY: number;
  readonly size: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly roll: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface PipeCase extends Omit<ClusterCase, 'size'> {
  readonly height: number;
  readonly radius: number;
  readonly minSkew: number;
  readonly maxSkew: number;
  readonly minSlant: number;
  readonly maxSlant: number;
  readonly skew: number;
  readonly slant: number;
}

const data = fixture as unknown as {
  readonly cluster: readonly ClusterCase[];
  readonly pipe: readonly PipeCase[];
};

function randomFor(c: { seedLo: string; seedHi: string }): XoroshiroRandomSource {
  return XoroshiroRandomSource.fromSeed128({ lo: BigInt(c.seedLo), hi: BigInt(c.seedHi) });
}

/** `Helpers.uniform(RandomSource, int, int)` — consumes no draw when the bounds are equal. */
function uniformInt(random: XoroshiroRandomSource, min: number, max: number): number {
  return min === max ? min : min + random.nextInt(max - min);
}

describe('TFC 1.20 cluster vein placement: parity with real Java', () => {
  it('has fixture cases', () => expect(data.cluster.length).toBeGreaterThan(0));

  it.each(data.cluster.map((c, i) => [i, c] as const))(
    'cluster case %i: rarity roll and vein position match',
    (_i, c) => {
      const random = randomFor(c);
      expect(random.nextInt(c.rarity)).toBe(c.roll);

      // Exactly what `findClusterVeinInChunk` does after the roll: X, then Y, then Z, then the
      // metaball (which consumes RNG the real feature also consumes).
      const x = (c.chunkX << 4) + random.nextInt(16);
      const y = defaultYPos(c.size, random, c.minY, c.maxY);
      const z = (c.chunkZ << 4) + random.nextInt(16);
      simpleMetaballs3D(random, c.size);

      expect({ x, y, z }).toEqual({ x: c.x, y: c.y, z: c.z });
    },
  );
});

describe('TFC 1.20 pipe vein placement: parity with real Java', () => {
  it('has fixture cases', () => expect(data.pipe.length).toBeGreaterThan(0));

  it.each(data.pipe.map((c, i) => [i, c] as const))(
    'pipe case %i: draw order, position and skew match',
    (_i, c) => {
      const random = randomFor(c);
      expect(random.nextInt(c.rarity)).toBe(c.roll);

      // The angle is drawn FIRST -- before the position -- because it is computed on the line
      // above the constructor call. This assertion is the whole point of the pipe cases.
      random.nextFloat();
      const x = (c.chunkX << 4) + random.nextInt(16);
      // A pipe's vertical radius is `height`, not `size` as for cluster and disc.
      const y = defaultYPos(c.height, random, c.minY, c.maxY);
      const z = (c.chunkZ << 4) + random.nextInt(16);
      random.nextFloat(); // compared against `sign`
      const skew = uniformInt(random, c.minSkew, 1 + c.maxSkew);
      const slant = uniformInt(random, c.minSlant, 1 + c.maxSlant);

      expect({ x, y, z, skew, slant }).toEqual({
        x: c.x,
        y: c.y,
        z: c.z,
        skew: c.skew,
        slant: c.slant,
      });
    },
  );
});

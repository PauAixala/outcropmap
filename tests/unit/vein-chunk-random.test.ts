import { describe, expect, it } from 'vitest';
import { XoroshiroRandomSource } from '../../src/core/random/xoroshiro';
import { chunkVeinRandom } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { mul64, toInt64 } from '../../src/core/math';

/**
 * The vein chunk generator runs on 32-bit limbs instead of BigInt, which is a performance change
 * only: every vein's position, shape and rarity roll comes out of this stream, so a single bit of
 * drift would move ore across the whole map. This pins it against the BigInt reference — the same
 * formula the limb version replaced — over the draws the vein ports actually make.
 */
function reference(worldSeed: bigint, nameSeed: bigint, chunkX: number, chunkZ: number) {
  const lo = toInt64(toInt64(worldSeed) ^ mul64(BigInt(chunkX), 61728364132n));
  const hi = toInt64(nameSeed ^ mul64(BigInt(chunkZ), 16298364123n));
  return XoroshiroRandomSource.fromSeed128({ lo, hi });
}

const SEEDS = [0n, 1n, -1n, 12345n, -6696614430994881185n, 9007199254740993n];
const NAME_SEEDS = [0n, 7n, -3n, 8465132548789461n, -4102384123n];
const CHUNKS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [-1, -1],
  [37, -412],
  [-2048, 4095],
  [1_000_000, -1_000_000],
];

describe('chunkVeinRandom on limbs', () => {
  it('matches the BigInt reference for every draw the vein ports make', () => {
    for (const worldSeed of SEEDS) {
      for (const nameSeed of NAME_SEEDS) {
        for (const [chunkX, chunkZ] of CHUNKS) {
          const limbs = chunkVeinRandom(worldSeed, nameSeed, chunkX, chunkZ);
          const bigint = reference(worldSeed, nameSeed, chunkX, chunkZ);
          const where = `${worldSeed}/${nameSeed}@${chunkX},${chunkZ}`;
          // The exact mix a vein draws: a rarity roll, positions, then shape values.
          expect(limbs.nextInt(140), where).toBe(bigint.nextInt(140));
          expect(limbs.nextInt(16), where).toBe(bigint.nextInt(16));
          expect(limbs.nextInt(), where).toBe(bigint.nextInt());
          expect(limbs.nextFloat(), where).toBe(bigint.nextFloat());
          expect(limbs.nextDouble(), where).toBe(bigint.nextDouble());
          expect(limbs.nextBoolean(), where).toBe(bigint.nextBoolean());
          expect(limbs.next(24), where).toBe(bigint.next(24));
          expect(limbs.nextLong(), where).toBe(bigint.nextLong());
        }
      }
    }
  });

  it('keeps a long run in step, not just the first few draws', () => {
    const limbs = chunkVeinRandom(-6696614430994881185n, 8465132548789461n, 12, -34);
    const bigint = reference(-6696614430994881185n, 8465132548789461n, 12, -34);
    for (let i = 0; i < 2000; i++) {
      expect(limbs.nextInt(97), `draw ${i}`).toBe(bigint.nextInt(97));
      expect(limbs.nextDouble(), `draw ${i}`).toBe(bigint.nextDouble());
    }
  });
});

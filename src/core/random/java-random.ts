/**
 * Java's `java.util.Random` (JDK 8 through 21; a 48-bit linear congruential generator plus a
 * Marsaglia-polar Gaussian cache), reproduced bit-for-bit. This is the "legacy" random source: the
 * one Minecraft used everywhere before 1.18, and still uses for anything not ported to
 * `XoroshiroRandomSource` (`net.minecraft.world.level.levelgen.LegacyRandomSource` wraps this exact
 * algorithm to satisfy the newer `RandomSource` interface). Every method here must match bit for
 * bit — this is the base of every deterministic value the project produces from a seed. See
 * AGENTS.md section 2.
 *
 * Verified against a real `java.util.Random` (OpenJDK 11) run — see
 * tests/fixtures/core/java-random.json and tests/parity/java-random.parity.test.ts.
 */

import { toFloat32, toInt64 } from '@core/math';
import { DOUBLE_UNIT, GaussianCache, nextIntBounded, type RandomSource } from './random-source';
import { javaStringHashCode } from './seed';
import type { PositionalRandomFactory } from './xoroshiro';

const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;
const MASK = (1n << 48n) - 1n;

export class JavaRandom implements RandomSource {
  private seed = 0n;
  private readonly gaussian = new GaussianCache();

  constructor(seed: bigint | number = 0n) {
    this.setSeed(seed);
  }

  /** `java.util.Random.setSeed(long)`. Also clears the cached Gaussian draw, as Java does. */
  setSeed(seed: bigint | number): void {
    const s = typeof seed === 'bigint' ? seed : BigInt(seed);
    this.seed = (BigInt.asIntN(64, s) ^ MULTIPLIER) & MASK;
    this.gaussian.reset();
  }

  /** `java.util.Random.next(int bits)`: advances the LCG and returns its top `bits` bits. */
  next(bits: number): number {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  /** `java.util.Random.nextInt()` / `java.util.Random.nextInt(int bound)`. */
  nextInt(bound?: number): number {
    if (bound === undefined) {
      return this.next(32);
    }
    return nextIntBounded(() => this.next(31), bound);
  }

  /** `java.util.Random.nextLong()`: two 32-bit draws concatenated into a signed 64-bit long. */
  nextLong(): bigint {
    return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32)));
  }

  /** `java.util.Random.nextBoolean()`. */
  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  /** `java.util.Random.nextFloat()`. */
  nextFloat(): number {
    return toFloat32(this.next(24) / (1 << 24));
  }

  /** `java.util.Random.nextDouble()`. */
  nextDouble(): number {
    const hi = this.next(26);
    const lo = this.next(27);
    return (hi * 0x8000000 + lo) * DOUBLE_UNIT;
  }

  /** `java.util.Random.nextGaussian()`: Marsaglia polar method with the classic cached second value. */
  nextGaussian(): number {
    return this.gaussian.next(() => this.nextDouble());
  }

  /** `LegacyRandomSource.fork()`: a fresh generator seeded from this one's next draw. */
  fork(): JavaRandom {
    return new JavaRandom(this.nextLong());
  }

  /** `LegacyRandomSource.forkPositional()`. Note this *consumes* a draw, so the order in which a
   *  caller forks is part of the seeding and cannot be rearranged. */
  forkPositional(): LegacyPositionalRandomFactory {
    return new LegacyPositionalRandomFactory(this.nextLong());
  }
}

/**
 * `net.minecraft.world.level.levelgen.LegacyRandomSource.LegacyPositionalRandomFactory`.
 *
 * The legacy counterpart of `XoroshiroPositionalRandomFactory`, and much blunter: it XORs the
 * factory's seed with a position hash or a name's `String.hashCode()` rather than mixing 128 bits
 * of SHA-256. TerraFirmaGreg's Beneath needs it because its noise settings ask for
 * `legacy_random_source`, which switches the whole dimension's noise seeding onto this path.
 */
export class LegacyPositionalRandomFactory implements PositionalRandomFactory {
  constructor(private readonly seed: bigint) {}

  at(x: number, y: number, z: number): JavaRandom {
    return new JavaRandom(toInt64(getSeed(x, y, z) ^ this.seed));
  }

  fromHashOf(name: string): JavaRandom {
    return new JavaRandom(toInt64(BigInt(javaStringHashCode(name)) ^ this.seed));
  }
}

/** `Mth.getSeed(int, int, int)`, the position hash the legacy factory mixes in. */
function getSeed(x: number, y: number, z: number): bigint {
  let seed = toInt64(toInt64(BigInt(x) * 3129871n) ^ toInt64(BigInt(z) * 116129781n) ^ BigInt(y));
  seed = toInt64(seed * seed * 42317861n + seed * 11n);
  return toInt64(seed >> 16n);
}

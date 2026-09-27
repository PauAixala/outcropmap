/**
 * Minecraft Java 1.20.1 XoroshiroRandomSource, Xoroshiro128PlusPlus and RandomSupport.
 * Verified against the official server binary, using Mojang mappings and direct JVM invocation
 * in tools/parity/capture-minecraft.mjs. Fixtures cover low-bit integer/boolean draws, Lemire
 * bounded sampling, single-draw doubles, zero-state fallback and MD5 positional name hashing.
 * Gaussian results have a small cross-runtime transcendental tolerance; all other fixture
 * operations are compared exactly. See docs/PARITY.md for provenance and reproduction.
 */

import { imul32, rotateLeft64, toFloat32, toInt64, unsignedRightShift64 } from '@core/math';
import { DOUBLE_UNIT, GaussianCache, type RandomSource } from './random-source';
import { md5 } from './md5';

// `RandomSupport.GOLDEN_RATIO_64` / `SILVER_RATIO_64`: the 64-bit fractional-part constants of the
// golden ratio and of sqrt(2) respectively (standard bit-mixing constants, not game-specific).
const GOLDEN_RATIO_64 = BigInt.asIntN(64, 0x9e3779b97f4a7c15n);
const SILVER_RATIO_64 = BigInt.asIntN(64, 0x6a09e667f3bcc909n);

// David Stafford's "Mix13" 64-bit finalizer constants (`RandomSupport.mixStafford13`).
const MIX13_MULT_A = BigInt.asIntN(64, 0xbf58476d1ce4e5b9n);
const MIX13_MULT_B = BigInt.asIntN(64, 0x94d049bb133111ebn);

export interface Seed128Bit {
  readonly lo: bigint;
  readonly hi: bigint;
}

/** `RandomSupport.mixStafford13(long)`. */
export function mixStafford13(seedIn: bigint): bigint {
  let seed = seedIn;
  seed = toInt64((seed ^ unsignedRightShift64(seed, 30n)) * MIX13_MULT_A);
  seed = toInt64((seed ^ unsignedRightShift64(seed, 27n)) * MIX13_MULT_B);
  return toInt64(seed ^ unsignedRightShift64(seed, 31n));
}

/** `RandomSupport.upgradeSeedTo128bitUnmixed(long)`. */
export function upgradeSeedTo128BitUnmixed(seed: bigint): Seed128Bit {
  const lo = toInt64(seed ^ SILVER_RATIO_64);
  const hi = toInt64(lo + GOLDEN_RATIO_64);
  return { lo, hi };
}

/** `RandomSupport.upgradeSeedTo128bit(long)`: unmix, then run each half through `mixStafford13`. */
export function upgradeSeedTo128Bit(seed: bigint): Seed128Bit {
  const unmixed = upgradeSeedTo128BitUnmixed(seed);
  return { lo: mixStafford13(unmixed.lo), hi: mixStafford13(unmixed.hi) };
}

/** `RandomSupport.seedFromHashOf(String)`: MD5 of the UTF-8 name, read as two big-endian longs. */
export function seedFromHashOf(name: string): Seed128Bit {
  const digest = md5(name);
  return { lo: readInt64BE(digest, 0), hi: readInt64BE(digest, 8) };
}

function readInt64BE(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(bytes[offset + i]!);
  }
  return toInt64(v);
}

/**
 * `Xoroshiro128PlusPlus`'s single state-advance step, factored out of the class so
 * `XoroshiroRandomSource.nextLong()` is a pure function of its two state longs.
 */
function xoroshiroStep(seedLo: bigint, seedHi: bigint): { result: bigint; nextLo: bigint; nextHi: bigint } {
  const lo = seedLo;
  const result = toInt64(rotateLeft64(lo + seedHi, 17n) + lo);
  const hi = toInt64(seedHi ^ lo);
  const nextLo = toInt64(rotateLeft64(lo, 49n) ^ hi ^ (hi << 21n));
  const nextHi = rotateLeft64(hi, 28n);
  return { result, nextLo, nextHi };
}

/**
 * `net.minecraft.util.Mth.getSeed(int, int, int)`: the per-block-position seed salt used by
 * `XoroshiroPositionalRandomFactory.at(x, y, z)`.
 */
export function positionalSeed(x: number, y: number, z: number): bigint {
  const xTerm = BigInt(imul32(x, 3129871));
  const zTerm = toInt64(BigInt(z) * 116129781n);
  let l = toInt64(xTerm ^ zTerm ^ BigInt(y));
  l = toInt64(toInt64(l * l) * 42317861n + toInt64(l * 11n));
  return l >> 16n;
}

/** `net.minecraft.world.level.levelgen.XoroshiroRandomSource`. */
export class XoroshiroRandomSource implements RandomSource {
  private lo: bigint;
  private hi: bigint;
  private readonly gaussian = new GaussianCache();

  private constructor(lo: bigint, hi: bigint) {
    this.lo = toInt64(lo);
    this.hi = toInt64(hi);
    if ((this.lo | this.hi) === 0n) {
      this.lo = GOLDEN_RATIO_64;
      this.hi = SILVER_RATIO_64;
    }
  }

  /** `new XoroshiroRandomSource(long seed)`: upgrades a plain 64-bit seed to the 128-bit state. */
  static fromSeed(seed: bigint | number): XoroshiroRandomSource {
    const s = upgradeSeedTo128Bit(typeof seed === 'bigint' ? seed : BigInt(seed));
    return new XoroshiroRandomSource(s.lo, s.hi);
  }

  /** `new XoroshiroRandomSource(long seedLo, long seedHi)`: the raw two-long constructor. */
  static fromSeed128(seed: Seed128Bit): XoroshiroRandomSource {
    return new XoroshiroRandomSource(seed.lo, seed.hi);
  }

  setSeed(seed: bigint | number): void {
    const s = upgradeSeedTo128Bit(typeof seed === 'bigint' ? seed : BigInt(seed));
    this.lo = s.lo;
    this.hi = s.hi;
    this.gaussian.reset();
  }

  /** `XoroshiroRandomSource.nextLong()`: the primitive this generator is built on. */
  nextLong(): bigint {
    const { result, nextLo, nextHi } = xoroshiroStep(this.lo, this.hi);
    this.lo = nextLo;
    this.hi = nextHi;
    return result;
  }

  /** `XoroshiroRandomSource.next(int bits)`: derived from `nextLong()`, unlike the legacy generator. */
  next(bits: number): number {
    return Number(BigInt.asIntN(32, unsignedRightShift64(this.nextLong(), BigInt(64 - bits))));
  }

  nextInt(bound?: number): number {
    if (bound === undefined) {
      return Number(BigInt.asIntN(32, this.nextLong()));
    }
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff) {
      throw new RangeError('bound must be a positive Java int');
    }
    // Minecraft uses Lemire's unsigned multiply/reject, not the legacy LCG's modulo loop.
    const threshold = ((-bound) >>> 0) % bound;
    let product: bigint;
    do {
      product = BigInt(this.nextInt() >>> 0) * BigInt(bound);
    } while (Number(product & 0xffffffffn) < threshold);
    return Number(product >> 32n);
  }

  nextBoolean(): boolean {
    return (this.nextLong() & 1n) !== 0n;
  }

  nextFloat(): number {
    return toFloat32(this.next(24) / (1 << 24));
  }

  nextDouble(): number {
    return Number(unsignedRightShift64(this.nextLong(), 11n)) * DOUBLE_UNIT;
  }

  nextGaussian(): number {
    return this.gaussian.next(() => this.nextDouble());
  }

  /** `XoroshiroRandomSource.fork()`: a new independent generator seeded from this one's stream. */
  fork(): XoroshiroRandomSource {
    return new XoroshiroRandomSource(this.nextLong(), this.nextLong());
  }

  /** `XoroshiroRandomSource.forkPositional()`. */
  forkPositional(): PositionalRandomFactory {
    return new XoroshiroPositionalRandomFactory(this.nextLong(), this.nextLong());
  }
}

/**
 * `net.minecraft.world.level.levelgen.PositionalRandomFactory`: derives a fresh, independent
 * `RandomSource` from a block position or a stable name, without disturbing the factory's own state
 * (used pervasively by vanilla/TFC feature placement: "the random for the vein rooted at this
 * position", "the random for the decoration named X").
 */
/** A source that can seed a whole family of sub-generators. Both `XoroshiroRandomSource` and
 *  `JavaRandom` (Minecraft's `LegacyRandomSource`) are one; which of the two a dimension uses is
 *  the `legacy_random_source` flag in its noise settings. */
export interface ForkableRandomSource extends RandomSource {
  forkPositional(): PositionalRandomFactory;
}

export interface PositionalRandomFactory {
  at(x: number, y: number, z: number): ForkableRandomSource;
  fromHashOf(name: string): ForkableRandomSource;
}

/** `XoroshiroRandomSource.XoroshiroPositionalRandomFactory`. */
export class XoroshiroPositionalRandomFactory implements PositionalRandomFactory {
  constructor(
    private readonly seedLo: bigint,
    private readonly seedHi: bigint,
  ) {}

  at(x: number, y: number, z: number): XoroshiroRandomSource {
    const posSeed = positionalSeed(x, y, z);
    return XoroshiroRandomSource.fromSeed128({ lo: toInt64(posSeed ^ this.seedLo), hi: this.seedHi });
  }

  fromHashOf(name: string): XoroshiroRandomSource {
    const seed = seedFromHashOf(name);
    return XoroshiroRandomSource.fromSeed128({
      lo: toInt64(seed.lo ^ this.seedLo),
      hi: toInt64(seed.hi ^ this.seedHi),
    });
  }
}

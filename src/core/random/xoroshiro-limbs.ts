/**
 * `Xoroshiro128PlusPlus` with its two state longs held as four unsigned 32-bit numbers, for the
 * hottest callers only.
 *
 * `XoroshiroRandomSource` (./xoroshiro.ts) is the reference and stays the general API: it speaks
 * `bigint`, which is exact and easy to audit, but every operation allocates. The area layer stack
 * reseeds and draws once per quart it evaluates, and profiling a TFG relief tile put ~40% of its
 * time in those BigInt operations and the garbage they leave. This class does the same arithmetic
 * on 32-bit limbs with no allocation at all.
 *
 * Bit-for-bit identical to `XoroshiroRandomSource` for `setSeed`, the raw two-long state
 * (`setState`), `next(bits)`, `nextInt()`, `nextInt(bound)`, `nextBoolean()`, `nextFloat()` and
 * `nextDouble()` — pinned by tests/unit/xoroshiro-limbs.test.ts and
 * tests/unit/vein-chunk-random.test.ts against the reference over random seeds, which is itself
 * fixture-verified against the official server classes.
 */
import { DOUBLE_UNIT, GaussianCache } from './random-source';
import type { RandomSource } from './random-source';

// `RandomSupport.GOLDEN_RATIO_64` and `SILVER_RATIO_64`, split into hi/lo limbs.
const GOLDEN_HI = 0x9e3779b9;
const GOLDEN_LO = 0x7f4a7c15;
const SILVER_HI = 0x6a09e667;
const SILVER_LO = 0xf3bcc909;
// `RandomSupport.mixStafford13` multipliers.
const MIX_A_HI = 0xbf58476d;
const MIX_A_LO = 0x1ce4e5b9;
const MIX_B_HI = 0x94d049bb;
const MIX_B_LO = 0x133111eb;

/** `1.0f / (1 << 24)`, the float unit `nextFloat` scales by. */
const FLOAT_UNIT = Math.pow(2, -24);

// Scratch result of the limb helpers below: one module-level pair instead of a returned object.
let rh = 0;
let rl = 0;

/** Low 64 bits of a 64-bit product, into (rh, rl). */
function mul64(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff;
  const a1 = al >>> 16;
  const b0 = bl & 0xffff;
  const b1 = bl >>> 16;
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  rl = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  // High half of al*bl, then the cross terms; ToUint32 wraps the (exactly representable) sum.
  const carry = (mid >>> 16) + (p01 >>> 16) + (p10 >>> 16) + a1 * b1;
  rh = (carry + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
}

function add64(ah: number, al: number, bh: number, bl: number): void {
  const lo = al + bl;
  rl = lo >>> 0;
  rh = (ah + bh + (lo > 0xffffffff ? 1 : 0)) >>> 0;
}

/** Rotate left by 0 < d < 64, into (rh, rl). */
function rotl64(h: number, l: number, d: number): void {
  if (d < 32) {
    rh = ((h << d) | (l >>> (32 - d))) >>> 0;
    rl = ((l << d) | (h >>> (32 - d))) >>> 0;
  } else {
    const e = d - 32;
    if (e === 0) {
      rh = l;
      rl = h;
    } else {
      rh = ((l << e) | (h >>> (32 - e))) >>> 0;
      rl = ((h << e) | (l >>> (32 - e))) >>> 0;
    }
  }
}

/** `seed ^ (seed >>> n)` for 0 < n < 32, into (rh, rl). */
function xorShiftRight(h: number, l: number, n: number): void {
  rh = (h ^ (h >>> n)) >>> 0;
  rl = (l ^ ((l >>> n) | (h << (32 - n)))) >>> 0;
}

/** `RandomSupport.mixStafford13`, into (rh, rl). */
function mixStafford13(h: number, l: number): void {
  xorShiftRight(h, l, 30);
  mul64(rh, rl, MIX_A_HI, MIX_A_LO);
  xorShiftRight(rh, rl, 27);
  mul64(rh, rl, MIX_B_HI, MIX_B_LO);
  xorShiftRight(rh, rl, 31);
}

/**
 * Low 64 bits of `a * b`, both given as 32-bit limbs; writes `[hi, lo]` into `out`. For callers
 * that build a seed with long arithmetic before handing it to `setSeed`.
 */
export function multiplyLong(ah: number, al: number, bh: number, bl: number, out: Uint32Array): void {
  mul64(ah, al, bh, bl);
  out[0] = rh;
  out[1] = rl;
}

export class XoroshiroLimbs implements RandomSource {
  private loHi = 0;
  private loLo = 0;
  private hiHi = 0;
  private hiLo = 0;
  private readonly gaussian = new GaussianCache();
  /** High limb of the most recent `nextLong`, for tests that compare whole longs. */
  lastHi = 0;

  /**
   * `XoroshiroRandomSource.setSeed(long)`, the long given as signed-or-unsigned 32-bit limbs.
   * The zero-state fallback is unreachable here: both halves come out of a bijective mix of two
   * values that differ by `GOLDEN_RATIO_64`, so they cannot both be zero.
   */
  setSeed(seedHi: number, seedLo: number): void {
    this.gaussian.reset();
    const uh = (seedHi ^ SILVER_HI) >>> 0;
    const ul = (seedLo ^ SILVER_LO) >>> 0;
    add64(uh, ul, GOLDEN_HI, GOLDEN_LO);
    const vh = rh;
    const vl = rl;
    mixStafford13(uh, ul);
    this.loHi = rh;
    this.loLo = rl;
    mixStafford13(vh, vl);
    this.hiHi = rh;
    this.hiLo = rl;
  }

  /** `Xoroshiro128PlusPlus.nextLong()`; returns the low 32 bits unsigned, high in `lastHi`. */
  nextLongLow(): number {
    const lh = this.loHi;
    const ll = this.loLo;
    const mh = this.hiHi;
    const ml = this.hiLo;
    add64(lh, ll, mh, ml);
    rotl64(rh, rl, 17);
    add64(rh, rl, lh, ll);
    this.lastHi = rh;
    const result = rl;

    const xh = (mh ^ lh) >>> 0;
    const xl = (ml ^ ll) >>> 0;
    rotl64(lh, ll, 49);
    // m << 21
    const sh = ((xh << 21) | (xl >>> 11)) >>> 0;
    const sl = (xl << 21) >>> 0;
    this.loHi = (rh ^ xh ^ sh) >>> 0;
    this.loLo = (rl ^ xl ^ sl) >>> 0;
    rotl64(xh, xl, 28);
    this.hiHi = rh;
    this.hiLo = rl;
    return result;
  }

  /**
   * `new XoroshiroRandomSource(long seedLo, long seedHi)`: the raw two-long constructor, which sets
   * the state directly with no mixing — including its all-zero fallback, a state the generator
   * cannot leave.
   */
  setState(loHi: number, loLo: number, hiHi: number, hiLo: number): void {
    this.gaussian.reset();
    if (((loHi | loLo | hiHi | hiLo) >>> 0) === 0) {
      this.loHi = GOLDEN_HI;
      this.loLo = GOLDEN_LO;
      this.hiHi = SILVER_HI;
      this.hiLo = SILVER_LO;
      return;
    }
    this.loHi = loHi >>> 0;
    this.loLo = loLo >>> 0;
    this.hiHi = hiHi >>> 0;
    this.hiLo = hiLo >>> 0;
  }

  /** `XoroshiroRandomSource.next(int bits)`: the top `bits` of a fresh long, as a signed int. */
  next(bits: number): number {
    if (bits > 32) throw new RangeError('XoroshiroLimbs.next: at most 32 bits');
    this.nextLongLow();
    return bits === 32 ? this.lastHi | 0 : (this.lastHi >>> (32 - bits)) | 0;
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.nextLongLow() | 0;
    if (bound <= 0) throw new RangeError('bound must be positive');
    return this.nextIntBounded(bound);
  }

  /** `nextLong()` whole, as a `bigint`. Off the hot path by construction — that is the point of
   * this class — so the allocation here is fine; limb callers use `nextLongLow` and `lastHi`. */
  nextLong(): bigint {
    const lo = this.nextLongLow();
    return BigInt.asIntN(64, (BigInt(this.lastHi) << 32n) | BigInt(lo >>> 0));
  }

  /** `next(24) * 0x1.0p-24f`: the top 24 bits, which live entirely in the high limb. */
  nextFloat(): number {
    this.nextLongLow();
    return Math.fround((this.lastHi >>> 8) * FLOAT_UNIT);
  }

  /** `(nextLong() >>> 11) * 0x1.0p-53`. `hi * 2^21 + (lo >>> 11)` is below 2^53, so this is exact. */
  nextDouble(): number {
    const lo = this.nextLongLow();
    return (this.lastHi * 0x200000 + (lo >>> 11)) * DOUBLE_UNIT;
  }

  nextGaussian(): number {
    return this.gaussian.next(() => this.nextDouble());
  }

  /** Lemire's bounded draw, as `XoroshiroRandomSource.nextInt(bound)`. */
  nextIntBounded(bound: number): number {
    const threshold = ((-bound) >>> 0) % bound;
    // u < 2^32 and bound <= 2^21 keeps u * bound below 2^53, so the product is exact in a double.
    if (bound > 0x1fffff) throw new RangeError('XoroshiroLimbs.nextIntBounded: bound too large');
    for (;;) {
      const product = (this.nextLongLow() >>> 0) * bound;
      if (product % 0x100000000 >= threshold) return Math.floor(product / 0x100000000);
    }
  }

  nextBoolean(): boolean {
    return (this.nextLongLow() & 1) !== 0;
  }
}

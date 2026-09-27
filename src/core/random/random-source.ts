/**
 * Shared TypeScript contract for Java-compatible random sources. Legacy JavaRandom and
 * Minecraft XoroshiroRandomSource have different integer, boolean and double draw algorithms;
 * only the Gaussian transform is shared. Each implementation owns its stream semantics.
 */

export interface RandomSource {
  /** Advances the generator's state and returns the top `bits` bits as a signed 32-bit value. */
  next(bits: number): number;
  /** `RandomSource.nextInt()` — omit `bound` — or `RandomSource.nextInt(int bound)`. */
  nextInt(bound?: number): number;
  nextLong(): bigint;
  nextBoolean(): boolean;
  nextFloat(): number;
  nextDouble(): number;
  nextGaussian(): number;
}

/** Legacy java.util.Random / Minecraft BitRandomSource bounded integer sampler.
 * Xoroshiro uses unsigned multiplication and rejection instead; see xoroshiro.ts.
 */
export function nextIntBounded(next31: () => number, bound: number): number {
  if (bound <= 0) {
    throw new RangeError('bound must be positive');
  }
  if ((bound & -bound) === bound) {
    // Power of two: bound * next31() as a 64-bit product, top bits only — next31() alone would be
    // biased toward even results for non-power-of-two-but-close bounds, this avoids that entirely.
    return Number((BigInt(bound) * BigInt(next31())) >> 31n);
  }
  let bits: number;
  let value: number;
  do {
    bits = next31();
    value = bits % bound;
    // `(bits - value + (bound - 1)) < 0`, evaluated with Java `int` overflow: rejects draws whose
    // bias-correction would wrap a 32-bit int, i.e. `bits` too close to Integer.MAX_VALUE.
  } while (((bits - value + (bound - 1)) | 0) < 0);
  return value;
}

/**
 * `RandomSource`'s cached Marsaglia polar Gaussian (the same algorithm `java.util.Random` has always
 * used for `nextGaussian()`): draws two values on every *other* call, caches the second. `nextDouble`
 * is supplied by the caller so this same cache logic serves both `JavaRandom` and
 * `XoroshiroRandomSource` — they differ in double stream, not in this transform.
 */
export class GaussianCache {
  private haveNext = false;
  private cached = 0;

  next(nextDouble: () => number): number {
    if (this.haveNext) {
      this.haveNext = false;
      return this.cached;
    }
    let v1: number;
    let v2: number;
    let s: number;
    do {
      v1 = 2 * nextDouble() - 1;
      v2 = 2 * nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    this.cached = v2 * multiplier;
    this.haveNext = true;
    return v1 * multiplier;
  }

  /** Clears the cached value — Java's `setSeed` does this so reseeding starts a fresh pair. */
  reset(): void {
    this.haveNext = false;
  }
}

/** The `double` unit used by `nextDouble()`: `1.0 / (1L << 53)`, kept exact as a power of two. */
export const DOUBLE_UNIT = Math.pow(2, -53);

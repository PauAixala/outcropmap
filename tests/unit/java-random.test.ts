import { describe, expect, it } from 'vitest';
import { JavaRandom } from '@core/random';

/**
 * The plain rejection loop, reproduced independently of `nextIntBounded`'s power-of-two branch —
 * used below to check the *general* algorithm never actually rejects for a power-of-two bound
 * (mathematically, for bound = 2^k and a 31-bit draw, `bits - (bits % bound) + (bound - 1)` tops out
 * at `2^31 - 1`, which cannot be negative), i.e. that Java's fast path is a legitimate optimisation
 * and not skipping a case that matters.
 *
 * Note this does NOT produce the same numbers as the fast path for the same input bits — the fast
 * path (`(bound * bits) >> 31`) reads off the *high* bits of the 31-bit draw, while the modulo here
 * reads the *low* bits, so the two are different (each individually uniform) mappings of the same
 * random stream. What must agree is that both consume exactly one `next(31)` per output — verified
 * separately below — and, bit-for-bit against the real JDK, the `nextIntBound bound=16` cases in
 * tests/fixtures/core/java-random.json (16 is a power of two).
 */
function countRejectionLoopIterations(next31: () => number, bound: number): number {
  let iterations = 0;
  let bits: number;
  let value: number;
  do {
    iterations++;
    bits = next31();
    value = bits % bound;
  } while (((bits - value + (bound - 1)) | 0) < 0);
  return iterations;
}

describe('JavaRandom — determinism', () => {
  it('the same seed produces the same sequence', () => {
    const a = new JavaRandom(42n);
    const b = new JavaRandom(42n);
    for (let i = 0; i < 20; i++) {
      expect(a.nextInt()).toBe(b.nextInt());
    }
  });

  it('setSeed resets the stream (and the cached Gaussian)', () => {
    const r = new JavaRandom(1n);
    const first = [r.nextInt(), r.nextInt(), r.nextGaussian()];
    r.setSeed(1n);
    expect([r.nextInt(), r.nextInt(), r.nextGaussian()]).toEqual(first);
  });

  it('accepts a plain number seed as well as a bigint', () => {
    const a = new JavaRandom(7);
    const b = new JavaRandom(7n);
    expect(a.nextInt()).toBe(b.nextInt());
  });
});

describe('JavaRandom — ranges', () => {
  it('nextInt(bound) always stays within [0, bound)', () => {
    const r = new JavaRandom(123n);
    for (const bound of [1, 2, 3, 7, 16, 37, 1000, 1_000_000, 0x7ffffffe]) {
      for (let i = 0; i < 50; i++) {
        const v = r.nextInt(bound);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(bound);
      }
    }
  });

  it('rejects a non-positive bound, like java.util.Random', () => {
    const r = new JavaRandom(1n);
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(-5)).toThrow();
  });

  it('nextFloat() stays within [0, 1)', () => {
    const r = new JavaRandom(9n);
    for (let i = 0; i < 100; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextDouble() stays within [0, 1)', () => {
    const r = new JavaRandom(9n);
    for (let i = 0; i < 100; i++) {
      const v = r.nextDouble();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('JavaRandom — nextInt(bound) power-of-two fast path', () => {
  it('the general rejection loop never actually rejects for a power-of-two bound', () => {
    for (const seed of [0n, 1n, -1n, 42n, 123456789n, -987654321n]) {
      for (const bound of [1, 2, 4, 8, 16, 32, 64, 1024, 1 << 20, 1 << 30]) {
        const r = new JavaRandom(seed);
        for (let i = 0; i < 20; i++) {
          expect(countRejectionLoopIterations(() => r.next(31), bound)).toBe(1);
        }
      }
    }
  });

  it('the fast path itself draws next(31) exactly once per call (no extra state advance)', () => {
    // Two identical generators: one calls nextInt(bound) (the fast path, for a power-of-two
    // bound), the other draws next(31) directly the same number of times we expect the fast path
    // to use (one). If the fast path secretly consumed more or fewer draws, their next() call
    // afterwards would disagree.
    const viaFastPath = new JavaRandom(1n);
    viaFastPath.nextInt(64);
    const drawnOnce = new JavaRandom(1n);
    drawnOnce.next(31);
    expect(viaFastPath.nextInt()).toBe(drawnOnce.nextInt());
  });
});

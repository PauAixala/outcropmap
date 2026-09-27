import { describe, expect, it } from 'vitest';
import {
  XoroshiroPositionalRandomFactory,
  XoroshiroRandomSource,
  mixStafford13,
  positionalSeed,
  upgradeSeedTo128Bit,
} from '@core/random';

describe('XoroshiroRandomSource — determinism', () => {
  it('the same seed produces the same sequence', () => {
    const a = XoroshiroRandomSource.fromSeed(42n);
    const b = XoroshiroRandomSource.fromSeed(42n);
    for (let i = 0; i < 20; i++) {
      expect(a.nextLong()).toBe(b.nextLong());
    }
  });

  it('different seeds diverge', () => {
    const a = XoroshiroRandomSource.fromSeed(1n);
    const b = XoroshiroRandomSource.fromSeed(2n);
    expect(a.nextLong()).not.toBe(b.nextLong());
  });

  it('setSeed resets the stream', () => {
    const r = XoroshiroRandomSource.fromSeed(5n);
    const first = [r.nextLong(), r.nextLong()];
    r.setSeed(5n);
    expect([r.nextLong(), r.nextLong()]).toEqual(first);
  });
});

describe('XoroshiroRandomSource — ranges', () => {
  it('nextInt(bound) always stays within [0, bound)', () => {
    const r = XoroshiroRandomSource.fromSeed(123n);
    for (const bound of [1, 2, 3, 7, 16, 37, 1000, 1_000_000]) {
      for (let i = 0; i < 50; i++) {
        const v = r.nextInt(bound);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(bound);
      }
    }
  });

  it('nextDouble() and nextFloat() stay within [0, 1)', () => {
    const r = XoroshiroRandomSource.fromSeed(9n);
    for (let i = 0; i < 100; i++) {
      expect(r.nextDouble()).toBeGreaterThanOrEqual(0);
      expect(r.nextDouble()).toBeLessThan(1);
      expect(r.nextFloat()).toBeGreaterThanOrEqual(0);
      expect(r.nextFloat()).toBeLessThan(1);
    }
  });
});

describe('RandomSupport seed mixing', () => {
  it('upgradeSeedTo128Bit is deterministic and the two halves differ', () => {
    const a = upgradeSeedTo128Bit(0n);
    const b = upgradeSeedTo128Bit(0n);
    expect(a).toEqual(b);
    expect(a.lo).not.toBe(a.hi);
  });

  it('mixStafford13 is deterministic', () => {
    expect(mixStafford13(0n)).toBe(mixStafford13(0n));
    expect(mixStafford13(12345n)).toBe(mixStafford13(12345n));
  });

  it('mixStafford13 changes a nonzero input (0 is a fixed point of this mixer, as expected)', () => {
    expect(mixStafford13(12345n)).not.toBe(12345n);
    expect(mixStafford13(0n)).toBe(0n);
  });
});

describe('positionalSeed (Mth.getSeed)', () => {
  it('is deterministic and varies with each coordinate', () => {
    const base = positionalSeed(0, 0, 0);
    expect(positionalSeed(0, 0, 0)).toBe(base);
    expect(positionalSeed(1, 0, 0)).not.toBe(base);
    expect(positionalSeed(0, 1, 0)).not.toBe(base);
    expect(positionalSeed(0, 0, 1)).not.toBe(base);
  });

  it('handles negative coordinates without throwing (exercises the int-multiply-overflow path)', () => {
    expect(() => positionalSeed(-2147483648, 0, 2147483647)).not.toThrow();
  });
});

describe('XoroshiroPositionalRandomFactory', () => {
  const base = upgradeSeedTo128Bit(1234n);
  const factory = new XoroshiroPositionalRandomFactory(base.lo, base.hi);

  it('at(x, y, z) is deterministic and position-sensitive', () => {
    const a1 = factory.at(1, 2, 3).nextLong();
    const a2 = factory.at(1, 2, 3).nextLong();
    const b = factory.at(4, 5, 6).nextLong();
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('fromHashOf(name) is deterministic and name-sensitive', () => {
    const a1 = factory.fromHashOf('minecraft:ore_vein').nextLong();
    const a2 = factory.fromHashOf('minecraft:ore_vein').nextLong();
    const b = factory.fromHashOf('tfc:cluster_vein').nextLong();
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("doesn't mutate the factory's own state between calls", () => {
    factory.at(9, 9, 9);
    const a = factory.at(1, 1, 1).nextLong();
    factory.at(9, 9, 9);
    const b = factory.at(1, 1, 1).nextLong();
    expect(a).toBe(b);
  });
});

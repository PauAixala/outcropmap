import { describe, expect, it } from 'vitest';
import { XoroshiroLimbs, XoroshiroRandomSource, multiplyLong } from '@core/random';

// The limb implementation is only allowed to exist because it is indistinguishable from the
// fixture-verified BigInt reference. These pin that over seeds that exercise sign bits, carries
// and the all-ones / zero edges.
const SEEDS: bigint[] = [
  0n,
  1n,
  -1n,
  42n,
  0x7fffffffffffffffn,
  -0x8000000000000000n,
  0x00000000ffffffffn,
  -0x0000000100000000n,
  1234567890123456789n,
  -987654321987654321n,
];
// A cheap deterministic spread of extra seeds, so a failure is reproducible.
for (let i = 0n; i < 40n; i++) SEEDS.push(BigInt.asIntN(64, (i + 1n) * 0x9e3779b97f4a7c15n));

function limbsOf(seed: bigint): [number, number] {
  const u = BigInt.asUintN(64, seed);
  return [Number(u >> 32n), Number(u & 0xffffffffn)];
}

describe('XoroshiroLimbs matches XoroshiroRandomSource bit for bit', () => {
  it('nextLong after setSeed', () => {
    for (const seed of SEEDS) {
      const reference = XoroshiroRandomSource.fromSeed(0n);
      reference.setSeed(seed);
      const fast = new XoroshiroLimbs();
      fast.setSeed(...limbsOf(seed));
      for (let i = 0; i < 20; i++) {
        const low = fast.nextLongLow();
        const whole = BigInt.asIntN(64, (BigInt(fast.lastHi) << 32n) | BigInt(low));
        expect(whole).toBe(reference.nextLong());
      }
    }
  });

  it('nextInt, nextBoolean and bounded nextInt, interleaved', () => {
    const bounds = [1, 2, 3, 4, 7, 10, 1000, 65537, 0x1fffff];
    for (const seed of SEEDS) {
      const reference = XoroshiroRandomSource.fromSeed(0n);
      reference.setSeed(seed);
      const fast = new XoroshiroLimbs();
      fast.setSeed(...limbsOf(seed));
      for (let i = 0; i < 30; i++) {
        expect(fast.nextInt()).toBe(reference.nextInt());
        expect(fast.nextBoolean()).toBe(reference.nextBoolean());
        const bound = bounds[i % bounds.length]!;
        expect(fast.nextIntBounded(bound)).toBe(reference.nextInt(bound));
      }
    }
  });
});

describe('multiplyLong', () => {
  it('is the low 64 bits of the product', () => {
    const out = new Uint32Array(2);
    for (const a of SEEDS) {
      for (const b of SEEDS.slice(0, 12)) {
        const [ah, al] = limbsOf(a);
        const [bh, bl] = limbsOf(b);
        multiplyLong(ah, al, bh, bl, out);
        const expected = BigInt.asUintN(64, a * b);
        expect((BigInt(out[0]!) << 32n) | BigInt(out[1]!)).toBe(expected);
      }
    }
  });
});

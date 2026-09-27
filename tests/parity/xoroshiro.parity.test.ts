import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mthSin, mthCos } from '@core/math/trig';
import {
  XoroshiroPositionalRandomFactory,
  XoroshiroRandomSource,
  positionalSeed,
  upgradeSeedTo128Bit,
} from '@core/random';

interface Case {
  op: string;
  seed?: string;
  baseSeed?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  bound?: number;
  n?: number;
  lo?: string;
  hi?: string;
  angle?: number;
  sin?: number;
  cos?: number;
  out?: Array<number | string | boolean> | string;
}
interface Fixture {
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/xoroshiro.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('Minecraft 1.20.1 parity (actual official server classes)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    switch (c.op) {
      case 'nextInt':
      case 'nextGaussian':
      case 'mixed':
        it(`${c.op} seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          for (const expected of c.out as (number | string)[]) {
            if (c.op === 'nextInt') expect(r.nextInt()).toBe(expected);
            else if (c.op === 'nextGaussian') expect(r.nextGaussian()).toBeCloseTo(expected as number, 14);
            else {
              r.nextBoolean(); r.nextDouble(); r.nextInt(1073741825);
              expect(r.nextLong().toString()).toBe(expected);
            }
          }
        });
        break;
      case 'zeroState':
        it('replaces the all-zero state with Minecraft constants', () => {
          const r = XoroshiroRandomSource.fromSeed128({ lo: 0n, hi: 0n });
          expect((c.out as string[]).map(() => r.nextLong().toString())).toEqual(c.out);
        });
        break;
      case 'trig':
        it(`float lookup trigonometry at ${c.angle}`, () => {
          expect(mthSin(c.angle!)).toBe(c.sin);
          expect(mthCos(c.angle!)).toBe(c.cos);
        });
        break;
      case 'upgradeSeedTo128bit':
        it(`upgradeSeedTo128Bit seed=${c.seed}`, () => {
          const s = upgradeSeedTo128Bit(BigInt(c.seed!));
          expect(s.lo.toString()).toBe(c.lo);
          expect(s.hi.toString()).toBe(c.hi);
        });
        break;

      case 'nextLong':
        it(`nextLong seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          const out = c.out as string[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextLong().toString()).toBe(out[i]);
          }
        });
        break;

      case 'nextIntBound':
        it(`nextInt(${c.bound}) seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          const out = c.out as number[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextInt(c.bound!)).toBe(out[i]);
          }
        });
        break;

      case 'nextDouble':
        it(`nextDouble seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          const out = c.out as number[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextDouble()).toBe(out[i]);
          }
        });
        break;

      case 'nextFloat':
        it(`nextFloat seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          const out = c.out as number[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextFloat()).toBe(Math.fround(out[i]!));
          }
        });
        break;

      case 'nextBoolean':
        it(`nextBoolean seed=${c.seed}`, () => {
          const r = XoroshiroRandomSource.fromSeed(BigInt(c.seed!));
          const out = c.out as boolean[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextBoolean()).toBe(out[i]);
          }
        });
        break;

      case 'positionalSeed':
        it(`positionalSeed(${c.x}, ${c.y}, ${c.z})`, () => {
          expect(positionalSeed(c.x!, c.y!, c.z!).toString()).toBe(c.out as string);
        });
        break;

      case 'positionalFactoryAt':
        it(`PositionalRandomFactory.at(${c.x}, ${c.y}, ${c.z}) baseSeed=${c.baseSeed}`, () => {
          const base = upgradeSeedTo128Bit(BigInt(c.baseSeed!));
          const factory = new XoroshiroPositionalRandomFactory(base.lo, base.hi);
          const r = factory.at(c.x!, c.y!, c.z!);
          const out = c.out as string[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextLong().toString()).toBe(out[i]);
          }
        });
        break;

      case 'positionalFactoryFromHashOf':
        it(`PositionalRandomFactory.fromHashOf(${JSON.stringify(c.name)}) baseSeed=${c.baseSeed}`, () => {
          const base = upgradeSeedTo128Bit(BigInt(c.baseSeed!));
          const factory = new XoroshiroPositionalRandomFactory(base.lo, base.hi);
          const r = factory.fromHashOf(c.name!);
          const out = c.out as string[];
          for (let i = 0; i < c.n!; i++) {
            expect(r.nextLong().toString()).toBe(out[i]);
          }
        });
        break;

      default:
        throw new Error(`unknown op ${c.op}`);
    }
  }
});

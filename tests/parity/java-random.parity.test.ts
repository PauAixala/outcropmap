import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JavaRandom } from '@core/random';

interface Case {
  op: string;
  seed: string;
  n: number;
  bound?: number;
  out: Array<number | string | boolean>;
}
interface Fixture {
  source: string;
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/java-random.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('JavaRandom parity (real java.util.Random, see tests/fixtures/README.md)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    it(`${c.op} seed=${c.seed}${c.bound !== undefined ? ` bound=${c.bound}` : ''}`, () => {
      const random = new JavaRandom(BigInt(c.seed));
      for (let i = 0; i < c.n; i++) {
        const expected = c.out[i]!;
        switch (c.op) {
          case 'nextInt':
            expect(random.nextInt()).toBe(expected);
            break;
          case 'nextIntBound':
            expect(random.nextInt(c.bound!)).toBe(expected);
            break;
          case 'nextLong':
            expect(random.nextLong().toString()).toBe(expected);
            break;
          case 'nextFloat':
            // Java prints the shortest decimal that round-trips as a *float*; re-rounding the
            // fixture value to float32 recovers the exact bit pattern (see docs/PARITY.md).
            expect(random.nextFloat()).toBe(Math.fround(expected as number));
            break;
          case 'nextDouble':
            expect(random.nextDouble()).toBe(expected);
            break;
          case 'nextBoolean':
            expect(random.nextBoolean()).toBe(expected);
            break;
          case 'nextGaussian':
            // sqrt/log are not guaranteed bit-identical across JVM libm and V8 libm — tolerate a
            // few ULPs without masking a real porting bug.
            expect(random.nextGaussian()).toBeCloseTo(expected as number, 9);
            break;
          default:
            throw new Error(`unknown op ${c.op}`);
        }
      }
    });
  }
});

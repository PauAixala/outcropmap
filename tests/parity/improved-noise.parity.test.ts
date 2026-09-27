import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JavaRandom } from '@core/random';
import { ImprovedNoise } from '@core/noise';

interface Case {
  op: 'sample' | 'sampleWithYClamp';
  seed: string;
  yScale?: number;
  yMax?: number;
  points: [number, number, number][];
  out: number[];
}
interface Fixture {
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/improved-noise.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('ImprovedNoise parity (independent Java reimplementation — see improved-noise.ts doc comment)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    it(`${c.op} seed=${c.seed}`, () => {
      const noise = new ImprovedNoise(new JavaRandom(BigInt(c.seed)));
      c.points.forEach(([x, y, z], i) => {
        const actual =
          c.op === 'sample' ? noise.sample(x, y, z) : noise.sampleWithYClamp(x, y, z, c.yScale!, c.yMax!);
        expect(actual).toBe(c.out[i]);
      });
    });
  }
});

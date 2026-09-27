import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JavaRandom } from '@core/random';
import { SimplexNoise } from '@core/noise';

interface Case {
  op: 'sample';
  seed: string;
  points: [number, number][];
  out: number[];
}
interface Fixture {
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/simplex-noise.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('SimplexNoise parity (independent Java reimplementation — see simplex-noise.ts doc comment)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    it(`sample seed=${c.seed}`, () => {
      const noise = new SimplexNoise(new JavaRandom(BigInt(c.seed)));
      c.points.forEach(([x, y], i) => {
        expect(noise.sample(x, y)).toBe(c.out[i]);
      });
    });
  }
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { javaStringHashCode, seedFromString, tryParseJavaLong } from '@core/random';

interface Case {
  input: string;
  hashCode: number;
  parsesAsLong: string | null;
}
interface Fixture {
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/seed.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('seed derivation parity (real String.hashCode / Long.parseLong)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    it(`hashCode(${JSON.stringify(c.input)})`, () => {
      expect(javaStringHashCode(c.input)).toBe(c.hashCode);
    });

    it(`parseLong(${JSON.stringify(c.input)})`, () => {
      const parsed = tryParseJavaLong(c.input);
      expect(parsed === null ? null : parsed.toString()).toBe(c.parsesAsLong);
    });

    it(`seedFromString(${JSON.stringify(c.input)})`, () => {
      const expected = c.parsesAsLong !== null ? BigInt(c.parsesAsLong) : BigInt(c.hashCode);
      expect(seedFromString(c.input)).toBe(expected);
    });
  }
});

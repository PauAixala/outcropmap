import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256, toHex } from '@core/random';

interface Case {
  input: string;
  sha256Hex: string;
}
interface Fixture {
  cases: Case[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/core/sha256.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('SHA-256 parity (real java.security.MessageDigest)', () => {
  if (fixture.cases.length === 0) {
    it.skip('no fixture captured yet — see docs/PARITY.md', () => {
      /* placeholder */
    });
    return;
  }

  for (const c of fixture.cases) {
    it(`sha256(${JSON.stringify(c.input.slice(0, 40))}${c.input.length > 40 ? '…' : ''})`, () => {
      expect(toHex(sha256(c.input))).toBe(c.sha256Hex);
    });
  }
});

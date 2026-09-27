import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, toHex } from '@core/random';

// node:crypto is used here only to cross-check our from-scratch implementation in tests — it is
// never imported from src/, which must run unchanged in a browser web worker (AGENTS.md section 6).

describe('sha256 — known test vectors (FIPS 180-4 / NIST)', () => {
  it('matches the standard empty-string vector', () => {
    expect(toHex(sha256(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the standard "abc" vector', () => {
    expect(toHex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('sha256 — cross-checked against node:crypto', () => {
  const inputs = [
    '',
    'a',
    'abc',
    'The quick brown fox jumps over the lazy dog',
    'TerraFirmaCraft',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(63),
    'x'.repeat(64),
    'x'.repeat(65),
    'x'.repeat(1000),
    'unicode: éèê 😀 中文',
  ];

  for (const input of inputs) {
    it(`matches node:crypto for input of length ${input.length}`, () => {
      const expected = createHash('sha256').update(input, 'utf8').digest('hex');
      expect(toHex(sha256(input))).toBe(expected);
    });
  }
});

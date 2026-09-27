import { describe, expect, it } from 'vitest';
import { javaStringHashCode, mixFeatureSeed, seedFromString, tryParseJavaLong } from '@core/random';

describe('javaStringHashCode', () => {
  it('matches the well-known values for the empty string and single characters', () => {
    expect(javaStringHashCode('')).toBe(0);
    expect(javaStringHashCode('a')).toBe(97);
  });

  it('is deterministic', () => {
    expect(javaStringHashCode('TerraFirmaCraft')).toBe(javaStringHashCode('TerraFirmaCraft'));
  });
});

describe('tryParseJavaLong', () => {
  it('parses plain and signed integer literals', () => {
    expect(tryParseJavaLong('0')).toBe(0n);
    expect(tryParseJavaLong('12345')).toBe(12345n);
    expect(tryParseJavaLong('-12345')).toBe(-12345n);
    expect(tryParseJavaLong('+123')).toBe(123n);
  });

  it('rejects anything that is not a bare long literal', () => {
    expect(tryParseJavaLong('')).toBeNull();
    expect(tryParseJavaLong('12.5')).toBeNull();
    expect(tryParseJavaLong(' 123')).toBeNull();
    expect(tryParseJavaLong('123 ')).toBeNull();
    expect(tryParseJavaLong('my seed')).toBeNull();
  });

  it('rejects a literal that overflows a 64-bit long, like Long.parseLong throwing', () => {
    expect(tryParseJavaLong('9223372036854775807')).toBe(9223372036854775807n);
    expect(tryParseJavaLong('9223372036854775808')).toBeNull();
    expect(tryParseJavaLong('-9223372036854775808')).toBe(-9223372036854775808n);
    expect(tryParseJavaLong('99999999999999999999')).toBeNull();
  });
});

describe('seedFromString', () => {
  it('uses the long value when the string parses as one', () => {
    expect(seedFromString('12345')).toBe(12345n);
    expect(seedFromString('-1')).toBe(-1n);
  });

  it('falls back to the Java String.hashCode() otherwise, sign-extended to a long', () => {
    expect(seedFromString('my cool seed')).toBe(BigInt(javaStringHashCode('my cool seed')));
    expect(seedFromString('99999999999999999999')).toBe(BigInt(javaStringHashCode('99999999999999999999')));
  });
});

describe('mixFeatureSeed', () => {
  it('is deterministic and sensitive to both inputs', () => {
    const a = mixFeatureSeed(42n, 'ore_vein');
    expect(mixFeatureSeed(42n, 'ore_vein')).toBe(a);
    expect(mixFeatureSeed(43n, 'ore_vein')).not.toBe(a);
    expect(mixFeatureSeed(42n, 'clay_deposit')).not.toBe(a);
  });
});

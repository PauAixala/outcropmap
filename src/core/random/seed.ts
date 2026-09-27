/**
 * Seed derivation: turning what a player types into the world seed the generators actually use.
 *
 * Vanilla's world-creation screen (`net.minecraft.client.gui.screens.worldselection.WorldOptionsScreen`
 * / `net.minecraft.world.level.levelgen.WorldOptions.parseSeed`, stable across every Minecraft
 * version consulted) does exactly this: try `Long.parseLong` on the typed string, and if that throws
 * (not a valid `long` literal, or a numeric literal that overflows `long`), fall back to the
 * string's `Object.hashCode()`, i.e. `java.lang.String.hashCode()`.
 *
 * Verified against a real JDK — `Long.parseLong` behaviour and `String.hashCode()` — see
 * tests/fixtures/core/seed.json and tests/parity/seed.parity.test.ts.
 */

import { imul32, toInt64 } from '@core/math';

/** `java.lang.String.hashCode()`: a 32-bit polynomial hash over UTF-16 code units, wrapping on overflow. */
export function javaStringHashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (imul32(31, h) + text.charCodeAt(i)) | 0;
  }
  return h;
}

const LONG_LITERAL = /^[+-]?\d+$/;
const LONG_MIN = -9223372036854775808n;
const LONG_MAX = 9223372036854775807n;

/**
 * `Long.parseLong(text)`, returning `null` instead of throwing `NumberFormatException` — the two
 * failure cases vanilla's fallback covers are "not a `long` literal at all" (letters, whitespace, a
 * decimal point, empty string) and "a valid-looking integer literal that overflows 64 bits".
 */
export function tryParseJavaLong(text: string): bigint | null {
  if (!LONG_LITERAL.test(text)) {
    return null;
  }
  const negative = text.startsWith('-');
  const digits = text.replace(/^[+-]/, '');
  const value = negative ? -BigInt(digits) : BigInt(digits);
  if (value < LONG_MIN || value > LONG_MAX) {
    return null;
  }
  return value;
}

/**
 * The world seed a typed string resolves to: itself as a `long` if it parses as one, otherwise its
 * Java `String.hashCode()` (sign-extended to `long`, as the implicit `int` → `long` widening in
 * `seed = seedString.hashCode()` does).
 */
export function seedFromString(text: string): bigint {
  const asLong = tryParseJavaLong(text);
  if (asLong !== null) {
    return asLong;
  }
  return BigInt(javaStringHashCode(text));
}

/**
 * Combines a world seed with a feature/decorator name into one 64-bit sub-seed, for legacy
 * (pre-1.18) placement code that seeds a `JavaRandom` per feature directly rather than going through
 * a `PositionalRandomFactory` (`xoroshiro.ts`). This is deliberately **not** a port of one specific
 * vanilla method — different legacy features mix their seed slightly differently (structure seeds,
 * decoration seeds and carver seeds each have their own formula) — it is a general-purpose helper
 * for later phases to build the specific formulas on top of, XORing in the feature name's
 * `String.hashCode()` the way most of them do. Not itself subject to a parity fixture.
 */
export function mixFeatureSeed(worldSeed: bigint, featureName: string): bigint {
  return toInt64(worldSeed ^ BigInt(javaStringHashCode(featureName)));
}

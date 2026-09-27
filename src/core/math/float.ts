/**
 * Java `float` truncation. Java has a real single-precision `float` type distinct from `double`;
 * JavaScript only has `number` (IEEE-754 double). Any Java code that declares a value `float` —
 * most of vanilla/TFC's noise and climate math does — rounds every intermediate result to 24 bits
 * of mantissa. Skipping that rounding accumulates drift that silently diverges from the Java output
 * over many operations, so every intermediate that is `float` in the Java source must be passed
 * through {@link toFloat32} at the same point in the JS port.
 */

/**
 * Rounds `value` to the nearest representable IEEE-754 single-precision float, mirroring an
 * implicit or explicit `(float)` cast in Java. Thin wrapper over `Math.fround` for discoverability
 * and to flag, at the call site, exactly which value the Java source declared as `float`.
 */
export function toFloat32(value: number): number {
  return Math.fround(value);
}

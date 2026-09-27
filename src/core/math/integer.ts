/**
 * Java `int`/`long` numeric semantics that plain JavaScript arithmetic does not give you for free.
 * See AGENTS.md section 2 — this file exists specifically to stop those bugs from being reinvented
 * ad hoc in every generator.
 */

/**
 * Mirrors `java.lang.Math.floorDiv(int, int)` / `Math.floorDiv(long, long)`: integer division that
 * rounds toward negative infinity. JavaScript's `/` (and `Math.trunc`) rounds toward zero, which
 * differs from Java for any negative operand — e.g. `-1 / 16` truncates to `0` in JS but Java's
 * `floorDiv(-1, 16)` is `-1`.
 */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * Mirrors `java.lang.Math.floorMod(int, int)` / `Math.floorMod(long, long)`: the result always has
 * the sign of the divisor (or is zero), unlike JavaScript's `%`, which has the sign of the dividend.
 */
export function floorMod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

/** Smallest / largest value a Java `int` can hold. */
export const INT32_MIN = -0x80000000;
export const INT32_MAX = 0x7fffffff;

/**
 * Truncates a JS number to the low 32 bits and reinterprets them as a signed Java `int`, i.e. Java's
 * implicit narrowing/overflow behaviour on `int` arithmetic (`(int) someLongOrDoubleValue`, or the
 * silent wraparound of `int + int`, `int * int`, `int << int`).
 *
 * Only exact for inputs that are themselves integers representable without loss in a JS double
 * (i.e. already the result of integer arithmetic within `Number.MAX_SAFE_INTEGER`) — this does not
 * replicate Java's `double`-to-`int` narrowing-conversion rules (NaN, out-of-range clamping).
 */
export function toInt32(value: number): number {
  return value | 0;
}

/**
 * Mirrors Java's 32-bit `int` multiplication, which silently wraps on overflow. JavaScript's `*`
 * produces a full-precision (or rounded, once outside `Number.MAX_SAFE_INTEGER`) double instead, so
 * a naive port of `a * b` on values that came from `int` fields is wrong the moment the product
 * exceeds 2^31. Thin wrapper over `Math.imul` for discoverability and to make the intent explicit at
 * call sites that are porting Java `int` code.
 */
export function imul32(a: number, b: number): number {
  return Math.imul(a, b);
}

/**
 * Mirrors Java's 32-bit `int` addition overflow (`int + int` wraps, it does not throw or promote).
 * Safe for any pair of values that are themselves valid `int32`s — their sum fits in a JS double
 * without precision loss, so `| 0` alone reproduces the wraparound.
 */
export function addInt32(a: number, b: number): number {
  return (a + b) | 0;
}

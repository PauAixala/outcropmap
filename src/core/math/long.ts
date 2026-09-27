/**
 * Java `long` (64-bit, two's-complement) helpers backed by `BigInt`. JS `number` only carries 53
 * bits of exact integer precision, so any Java `long` arithmetic — and especially the bitwise ops,
 * which Java defines over the full 64-bit two's-complement representation — has to go through
 * `BigInt`, not `number`. See AGENTS.md section 2.
 *
 * Convention used throughout this module and its callers (xoroshiro, seed mixing): intermediate
 * `bigint` values are kept normalized to a proper signed 64-bit range (via {@link toInt64}) at each
 * "publish" point — after every multiply/add, and before returning from a function — mirroring the
 * fact that a Java `long` variable is always exactly 64 bits, so every operation on it wraps
 * immediately. `^`, `|`, `&` and `<<` are safe to chain across several ops before normalizing,
 * because bitwise XOR/OR/AND are bit-position-independent (the low 64 bits of the result depend
 * only on the low 64 bits of the operands) and `<<` is exact multiplication by a power of two in
 * BigInt — but `>>` needs {@link toUint64} first to behave as Java's unsigned `>>>`.
 */

/** Mirrors an implicit/explicit Java `(long)` narrowing/wraparound: reinterprets the low 64 bits as signed. */
export function toInt64(value: bigint): bigint {
  return BigInt.asIntN(64, value);
}

/** The unsigned 64-bit reinterpretation of `value` — the operand form Java's `>>>` conceptually shifts. */
export function toUint64(value: bigint): bigint {
  return BigInt.asUintN(64, value);
}

/** Java's `>>>` (unsigned/logical right shift) on a 64-bit `long`. */
export function unsignedRightShift64(value: bigint, shift: bigint): bigint {
  return toUint64(value) >> shift;
}

/** Java's `Long.rotateLeft(long, int)`. */
export function rotateLeft64(value: bigint, distance: bigint): bigint {
  const d = ((distance % 64n) + 64n) % 64n;
  const v = toUint64(value);
  if (d === 0n) return toInt64(v);
  const mask = (1n << 64n) - 1n;
  return toInt64(((v << d) & mask) | (v >> (64n - d)));
}

/** Mirrors Java's wraparound `long * long`. */
export function mul64(a: bigint, b: bigint): bigint {
  return toInt64(a * b);
}

/** Mirrors Java's wraparound `long + long`. */
export function add64(a: bigint, b: bigint): bigint {
  return toInt64(a + b);
}

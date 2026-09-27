/**
 * `VeinFeature#place`'s `projectOffset`: the deterministic column a projected vein samples the
 * surface at, which is not quite its own column.
 *
 * ```java
 * final RandomSource offsetRandom = new XoroshiroRandomSource(Helpers.hash(182739412341L, pos));
 * offsetX = offsetRandom.nextInt(16) - offsetRandom.nextInt(16);
 * offsetZ = offsetRandom.nextInt(16) - offsetRandom.nextInt(16);
 * ```
 *
 * The offset is in [-15, 15] on each axis and is derived from the vein's own position, so it is
 * stable for a given vein rather than varying across its footprint. Only TFC's three projected disc
 * veins use it; TerraFirmaGreg's 25 all have `project_offset: false`.
 *
 * @unverified No JVM fixture for the offset itself. The hash and the draw order are transcribed
 * from source; see docs/PARITY.md.
 */
import { XoroshiroRandomSource } from '@core/random';

/** `Helpers.PRIME_X` / `PRIME_Y`. */
const PRIME_X = 501125321n;
const PRIME_Y = 1136930381n;

/** `VeinFeature`'s salt. */
const SALT = 182739412341n;

const TWO_64 = 1n << 64n;
const TWO_63 = 1n << 63n;

/** Wraps a BigInt to a signed 64-bit value, the way Java's `long` arithmetic does. */
function toLong(value: bigint): bigint {
  const wrapped = ((value % TWO_64) + TWO_64) % TWO_64;
  return wrapped >= TWO_63 ? wrapped - TWO_64 : wrapped;
}

/**
 * `Helpers.hash(long salt, int x, int y, int z)`.
 *
 * The multiplications are `long` in Java — `(long) x * PRIME_X` widens before multiplying — so this
 * is BigInt throughout, and the result is truncated to `int` at the end, not before.
 */
export function helpersHash(x: number, y: number, z: number): number {
  let hash = toLong(SALT ^ (BigInt(x) * PRIME_X) ^ (BigInt(y) * PRIME_Y) ^ BigInt(z));
  hash = toLong(hash * 0x27d4eb2dn);
  // `(int) hash` keeps the low 32 bits, signed.
  return Number(BigInt.asIntN(32, hash));
}

/** The [-15, 15] offsets a projected vein samples the surface at, relative to its own position. */
export function projectOffset(x: number, y: number, z: number): { dx: number; dz: number } {
  const random = XoroshiroRandomSource.fromSeed(BigInt(helpersHash(x, y, z)));
  // Four draws, in this order. Each pair is `nextInt(16) - nextInt(16)`, so the order matters.
  const dx = random.nextInt(16) - random.nextInt(16);
  const dz = random.nextInt(16) - random.nextInt(16);
  return { dx, dz };
}

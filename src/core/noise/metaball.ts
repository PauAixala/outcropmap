/**
 * Metaball scalar field: each ball contributes a smooth, cubic falloff from 1 at its centre to 0 at
 * its radius; summing several gives the classic "blobby" merged shape. A general geometric
 * primitive, not tied to a specific Java source.
 *
 * TFC's `tfc:cluster_vein` is documented (docs/WORLDGEN-NOTES.md) as "blob-shaped, metaball based" —
 * this is the primitive Phase 6's cluster-vein placement is expected to build on. The exact falloff
 * curve and threshold TFC's generator actually uses are still unconfirmed.
 *
 * @unverified General geometric primitive, no Java source pinned yet.
 */

export interface Metaball {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** Sum of each ball's influence at `(x, y, z)`. */
export function metaballField(x: number, y: number, z: number, balls: readonly Metaball[]): number {
  let sum = 0;
  for (const ball of balls) {
    const dx = x - ball.x;
    const dy = y - ball.y;
    const dz = z - ball.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const radiusSq = ball.radius * ball.radius;
    if (distSq < radiusSq) {
      const t = 1 - distSq / radiusSq;
      sum += t * t * t;
    }
  }
  return sum;
}

/** Whether the summed field at `(x, y, z)` reaches `threshold` — the usual field-to-solid test. */
export function metaballContains(
  x: number,
  y: number,
  z: number,
  balls: readonly Metaball[],
  threshold = 1,
): boolean {
  return metaballField(x, y, z, balls) >= threshold;
}

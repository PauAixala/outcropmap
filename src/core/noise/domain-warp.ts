/**
 * Domain warping: sample a noise field at a position displaced by two other noise fields instead of
 * the raw coordinates. A general composition technique (turns any noise into swirled/turbulent
 * looking output), not tied to a specific Java source.
 */

import type { Noise2D } from './types';

/** Samples `sampler` at `(x, y)` displaced by `(warpX, warpY)` sampled at the same point, scaled by `strength`. */
export function warp2D(
  sampler: Noise2D,
  warpX: Noise2D,
  warpY: Noise2D,
  x: number,
  y: number,
  strength: number,
): number {
  const wx = x + warpX.sample(x, y) * strength;
  const wy = y + warpY.sample(x, y) * strength;
  return sampler.sample(wx, wy);
}

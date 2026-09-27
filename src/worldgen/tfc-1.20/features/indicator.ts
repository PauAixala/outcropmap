/**
 * `net.dries007.tfc.world.feature.vein.Indicator` — the small ore chunks TFC scatters on the ground
 * above a vein. They are how a player finds ore by walking rather than by digging blind, so what the
 * map can say about them is worth getting exactly right.
 *
 * From `VeinFeature.place`:
 *
 * ```java
 * if (indicator.rarity() > 0 && random.nextInt(indicator.rarity()) == 0) // Above-ground indicators
 * {
 *     final int indicatorY = level.getHeight(Heightmap.Types.OCEAN_FLOOR_WG, indicatorX, indicatorZ);
 *     if (Math.abs(indicatorY - maxVeinY) < indicator.depth()) { ... place ... }
 * }
 * ```
 *
 * `maxVeinY` is the highest position where an ore block was **actually placed**, which needs
 * block-by-block generation this project does not do. So the exact position of an indicator is out
 * of reach — but one side of the test is not, and it is the side a player cares about:
 * `maxVeinY` can never exceed the vein's own top, so once the surface is `depth` or more above that
 * top, `Math.abs(indicatorY - maxVeinY) < depth` cannot hold and **no above-ground indicator can
 * spawn**. That is a certainty, not an estimate.
 *
 * `rarity() == 0` short-circuits the whole branch, so such a vein has underground indicators only.
 * Five of TFC's 20 indicator veins are in that state; TFG gives all 76 of its veins an indicator and
 * varies the depth from 1 to 180 blocks, which is why this is read from data and never assumed.
 */

import type { VeinIndicator } from '@worldgen/api/types';

interface RawIndicator {
  readonly rarity?: number;
  readonly depth?: number;
}

/** Reads the `indicator` block of a vein's datapack entry, or `null` when it defines none. */
export function parseIndicator(raw: unknown): VeinIndicator | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { rarity, depth } = raw as RawIndicator;
  if (typeof rarity !== 'number' || typeof depth !== 'number') return null;
  return { rarity, depth };
}


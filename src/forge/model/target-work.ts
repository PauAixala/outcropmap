/**
 * The per-world target work value of an anvil recipe.
 *
 * Port of `net.dries007.tfc.common.recipes.AnvilRecipe#computeTarget` (TFC 1.20.x):
 *
 * ```java
 * return 40 + new XoroshiroRandomSource(inventory.getSeed())
 *     .forkPositional().fromHashOf(id).nextInt(154 - 2 * 40);
 * ```
 *
 * So the number on the anvil screen is fixed for a given (world seed, recipe id) pair — the same
 * recipe reads differently in another save, which is why the calculator asks for the seed. `id` is
 * the recipe's full resource id (`tfc:anvil/steel_mining_hammer_head`), which is why the catalogue
 * data carries `recipeId` next to its short key.
 *
 * Verified against two recipes read off the anvil in a real TFG save
 * (`tests/fixtures/tfg-world-anvil-targets.json`, `tests/parity/anvil-target.parity.test.ts`).
 */
import { XoroshiroRandomSource } from '@core/random/xoroshiro';
import { TARGET_WORK_MIN } from './action-set';

// Defined beside the work bar (./action-set.ts) so the build-time guides can state the range too.
export { TARGET_WORK_MAX, TARGET_WORK_MIN } from './action-set';

export function anvilTargetWork(seed: bigint, recipeId: string): number {
  return (
    TARGET_WORK_MIN +
    XoroshiroRandomSource.fromSeed(seed)
      .forkPositional()
      .fromHashOf(recipeId)
      .nextInt(154 - 2 * TARGET_WORK_MIN)
  );
}

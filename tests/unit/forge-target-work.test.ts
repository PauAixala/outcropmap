import { describe, expect, it } from 'vitest';
import {
  TARGET_WORK_MAX,
  TARGET_WORK_MIN,
  anvilTargetWork,
} from '../../src/forge/model/target-work';

// The values themselves are checked against a real save in tests/parity/anvil-target.parity.test.ts.
// What is pinned here is the shape of AnvilRecipe.computeTarget — fixed per (seed, recipe id),
// inside 40..113 — plus the fact that the full recipe id, not the short catalogue key, is hashed.
describe('anvilTargetWork', () => {
  const seed = -6696614430994881185n;

  it('is fixed for a world and recipe, and differs between worlds', () => {
    const target = anvilTargetWork(seed, 'tfc:anvil/steel_mining_hammer_head');
    expect(anvilTargetWork(seed, 'tfc:anvil/steel_mining_hammer_head')).toBe(target);
    expect(anvilTargetWork(seed + 1n, 'tfc:anvil/steel_mining_hammer_head')).not.toBe(target);
  });

  it('separates recipes that share a name but not a namespace', () => {
    expect(anvilTargetWork(seed, 'tfc:anvil/iron_door')).not.toBe(
      anvilTargetWork(seed, 'createdeco:anvil/iron_door'),
    );
  });

  it('always lands inside the range the anvil can show', () => {
    for (let i = 0; i < 500; i++) {
      const target = anvilTargetWork(BigInt(i) * 7771n - 4000n, `tfc:anvil/recipe_${i}`);
      expect(target).toBeGreaterThanOrEqual(TARGET_WORK_MIN);
      expect(target).toBeLessThanOrEqual(TARGET_WORK_MAX);
      expect(Number.isInteger(target)).toBe(true);
    }
  });
});

/**
 * `AnvilRecipe#computeTarget` against numbers read off the anvil in a real TerraFirmaGreg save
 * (tests/fixtures/tfg-world-anvil-targets.json).
 *
 * Exact, not measured: the Java is a pure function of (world seed, recipe id), so a port that
 * reproduces two independent recipes on the same world reproduces all of them — each case is one
 * draw out of 74, so agreeing twice by chance is about 1 in 5 500.
 *
 * The fixture is hand-read because the value exists nowhere but the anvil screen: no save file or
 * datapack holds it, so there is no tool to capture it with.
 */
import { describe, expect, it } from 'vitest';
import { TARGET_WORK_MAX, TARGET_WORK_MIN, anvilTargetWork } from '../../src/forge/model/target-work';
import fixture from '../fixtures/tfg-world-anvil-targets.json';

describe('anvil target work parity', () => {
  const seed = BigInt(fixture.seed);

  for (const testCase of fixture.cases) {
    it(`${testCase.label} reads ${testCase.target} on the fixture world`, () => {
      expect(anvilTargetWork(seed, testCase.recipeId)).toBe(testCase.target);
    });
  }

  it('keeps every target inside the range the game can produce', () => {
    for (const testCase of fixture.cases) {
      const target = anvilTargetWork(seed, testCase.recipeId);
      expect(target).toBeGreaterThanOrEqual(TARGET_WORK_MIN);
      expect(target).toBeLessThanOrEqual(TARGET_WORK_MAX);
    }
  });
});

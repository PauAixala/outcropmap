/**
 * The anvil's work bar and how a profile's action table becomes `AnvilAction`s, with no data import
 * of its own: `./actions.ts` feeds it the profile tables, and the build-time guide writer
 * (`src/app/site/guide-data.ts`, loaded through vite.config.ts, which resolves no path aliases)
 * feeds it the same JSON by relative path.
 *
 * The deltas are confirmed against `net/dries007/tfc/common/capabilities/forge/ForgeStep.java`;
 * see docs/FORGING-NOTES.md.
 */
import type { AnvilAction, ActionType, HitStrength } from './types';

/**
 * The work bar's bounds. `ForgeStep.LIMIT = 150` and the game accepts a step only when
 * `nextValue >= 0 && nextValue < LIMIT`, so the usable range is [0, 149] — a sequence that leaves
 * it mid-way is invalid, not merely worse (TFC 1.20.x, ForgeStep.java).
 */
export const WORK_MIN = 0;
export const WORK_MAX = 149;

/**
 * `ForgeStep.LIMIT`. The anvil destroys the item when the work goes below 0 or above this
 * (`AnvilBlockEntity`, `forge.getWork() < 0 || forge.getWork() > ForgeStep.LIMIT`), so 150 itself
 * survives; the solver stays within `WORK_MAX`, one short of it, which is conservative.
 */
export const WORK_LIMIT = 150;

/** A fresh item starts at zero work (`Forging.work = 0`). */
export const WORK_START = 0;

/**
 * The inclusive range of a recipe's target (`AnvilRecipe#computeTarget`, ./target-work.ts): `40` in
 * the Java, and `154 - 2 * 40 - 1` above it.
 */
export const TARGET_WORK_MIN = 40;
export const TARGET_WORK_MAX = 113;

/** Data key -> the action it describes. Hit strengths stay distinct all the way through. */
export const ACTION_KEYS: Readonly<Record<string, { type: ActionType; strength?: HitStrength }>> = {
  hit_light: { type: 'HIT', strength: 'LIGHT' },
  hit_medium: { type: 'HIT', strength: 'MEDIUM' },
  hit_hard: { type: 'HIT', strength: 'HARD' },
  draw: { type: 'DRAW' },
  punch: { type: 'PUNCH' },
  bend: { type: 'BEND' },
  upset: { type: 'UPSET' },
  shrink: { type: 'SHRINK' },
};

/** A profile's `actions` table (`src/data/<profile>/anvil.json`) as the solver's action set. */
export function buildActions(deltas: Readonly<Record<string, number>>): readonly AnvilAction[] {
  const actions: AnvilAction[] = [];
  for (const [key, shape] of Object.entries(ACTION_KEYS)) {
    const delta = deltas[key];
    // A profile that does not declare an action simply does not have it; better a smaller action
    // set than an invented delta (AGENTS.md section 2).
    if (typeof delta !== 'number' || !Number.isInteger(delta)) continue;
    actions.push({
      id: key,
      type: shape.type,
      ...(shape.strength ? { strength: shape.strength } : {}),
      delta,
      labelKey: key,
    });
  }
  return actions;
}

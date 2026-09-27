/**
 * The anvil action set per profile, read from `src/data/<profile>/anvil.json` — extracted from the
 * mod, never hand-typed (AGENTS.md section 4). The deltas themselves are confirmed against
 * `net/dries007/tfc/common/capabilities/forge/ForgeStep.java`; see docs/FORGING-NOTES.md.
 */
import tfcAnvil from '@data/tfc-1.20/anvil.json';
import tfgAnvil from '@data/tfg/anvil.json';
import type { AnvilAction, ActionType, HitStrength } from './types';

/**
 * The work bar's bounds. `ForgeStep.LIMIT = 150` and the game accepts a step only when
 * `nextValue >= 0 && nextValue < LIMIT`, so the usable range is [0, 149] — a sequence that leaves
 * it mid-way is invalid, not merely worse (TFC 1.20.x, ForgeStep.java).
 */
export const WORK_MIN = 0;
export const WORK_MAX = 149;

/** A fresh item starts at zero work (`Forging.work = 0`). */
export const WORK_START = 0;

/** Data key -> the action it describes. Hit strengths stay distinct all the way through. */
const ACTION_KEYS: Readonly<Record<string, { type: ActionType; strength?: HitStrength }>> = {
  hit_light: { type: 'HIT', strength: 'LIGHT' },
  hit_medium: { type: 'HIT', strength: 'MEDIUM' },
  hit_hard: { type: 'HIT', strength: 'HARD' },
  draw: { type: 'DRAW' },
  punch: { type: 'PUNCH' },
  bend: { type: 'BEND' },
  upset: { type: 'UPSET' },
  shrink: { type: 'SHRINK' },
};

const SOURCES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'tfc-1.20': tfcAnvil.actions,
  tfg: tfgAnvil.actions,
};

function buildActions(deltas: Readonly<Record<string, number>>): readonly AnvilAction[] {
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

const CACHE = new Map<string, readonly AnvilAction[]>();

/** Actions for a recipe-source id, falling back to TFG (the default catalogue) for unknown ids. */
export function actionsForProfile(profile: string): readonly AnvilAction[] {
  const cached = CACHE.get(profile);
  if (cached) return cached;
  const deltas = SOURCES[profile] ?? SOURCES['tfg'];
  const built = buildActions(deltas ?? {});
  CACHE.set(profile, built);
  return built;
}

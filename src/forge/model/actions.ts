/**
 * The anvil action set per profile, read from `src/data/<profile>/anvil.json` — extracted from the
 * mod, never hand-typed (AGENTS.md section 4). The deltas themselves are confirmed against
 * `net/dries007/tfc/common/capabilities/forge/ForgeStep.java`; see docs/FORGING-NOTES.md.
 *
 * The work bar bounds and the table-to-actions step live in `./action-set.ts`, which imports no
 * data, so the build-time guide writer can use them too.
 */
import tfcAnvil from '@data/tfc-1.20/anvil.json';
import tfgAnvil from '@data/tfg/anvil.json';
import type { AnvilAction } from './types';
import { buildActions } from './action-set';

export { WORK_MAX, WORK_MIN, WORK_START } from './action-set';

const SOURCES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'tfc-1.20': tfcAnvil.actions,
  tfg: tfgAnvil.actions,
};

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

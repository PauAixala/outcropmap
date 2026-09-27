import type { StorageAdapter } from '@platform/storage';
import type { ProfileId } from '@worldgen/api/types';

/**
 * Structures a player has marked as done, per world — the same seed + profile scoping waypoints
 * use, so a finished ruin in one world is not dimmed in another. Stored as feature ids
 * (`<set id>@<chunkX>,<chunkZ>`), which are stable for a given world.
 */
export function structureProgressKey(seed: bigint, profile: ProfileId): string {
  return `structures-done:${seed.toString()}:${profile}`;
}

export async function loadCompletedStructures(
  storage: StorageAdapter,
  seed: bigint,
  profile: ProfileId,
): Promise<string[]> {
  const value = await storage.get<unknown>(structureProgressKey(seed, profile));
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function saveCompletedStructures(
  storage: StorageAdapter,
  seed: bigint,
  profile: ProfileId,
  ids: readonly string[],
): Promise<void> {
  return storage.set(structureProgressKey(seed, profile), [...ids]);
}

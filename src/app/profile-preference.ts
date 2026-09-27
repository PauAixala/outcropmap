import type { StorageAdapter } from '@platform/storage';
import { PROFILE_IDS } from '@worldgen/api/types';
import type { ProfileId } from '@worldgen/api/types';

export const PROFILE_PREFERENCE_STORAGE_KEY = 'profile';

export async function loadProfilePreference(
  storage: StorageAdapter,
): Promise<ProfileId | undefined> {
  const value = await storage.get<unknown>(PROFILE_PREFERENCE_STORAGE_KEY);
  return typeof value === 'string' && (PROFILE_IDS as readonly string[]).includes(value)
    ? (value as ProfileId)
    : undefined;
}

export function saveProfilePreference(storage: StorageAdapter, profile: ProfileId): Promise<void> {
  return storage.set(PROFILE_PREFERENCE_STORAGE_KEY, profile);
}

export const SEED_PREFERENCE_STORAGE_KEY = 'seed';

/**
 * The last seed looked at, so reopening the map lands on the same world. Stored as a decimal
 * string: a seed is a Java `long`, which JSON numbers cannot hold exactly.
 */
export async function loadSeedPreference(storage: StorageAdapter): Promise<bigint | undefined> {
  const value = await storage.get<unknown>(SEED_PREFERENCE_STORAGE_KEY);
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return undefined;
  const seed = BigInt(value);
  // Out of `long` range can only be a corrupted or hand-edited value; ignore it rather than wrap.
  return seed >= -(2n ** 63n) && seed < 2n ** 63n ? seed : undefined;
}

export function saveSeedPreference(storage: StorageAdapter, seed: bigint): Promise<void> {
  return storage.set(SEED_PREFERENCE_STORAGE_KEY, seed.toString());
}

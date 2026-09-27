import { describe, expect, it } from 'vitest';
import {
  PROFILE_PREFERENCE_STORAGE_KEY,
  SEED_PREFERENCE_STORAGE_KEY,
  loadProfilePreference,
  loadSeedPreference,
  saveProfilePreference,
  saveSeedPreference,
} from '../../src/app/profile-preference';
import type { StorageAdapter } from '../../src/platform/storage';

function memoryStorage(): StorageAdapter {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    set: <T>(key: string, value: T) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...values.keys()]),
  };
}

describe('shared profile preference', () => {
  it('round-trips a valid profile and rejects stale values', async () => {
    const storage = memoryStorage();
    await saveProfilePreference(storage, 'tfg');
    expect(await loadProfilePreference(storage)).toBe('tfg');

    await storage.set(PROFILE_PREFERENCE_STORAGE_KEY, 'removed-profile');
    expect(await loadProfilePreference(storage)).toBeUndefined();
  });
});

describe('seed preference', () => {
  it('round-trips a full-range long exactly, which a JSON number could not', async () => {
    const storage = memoryStorage();
    const seed = -9_223_372_036_854_775_807n;
    await saveSeedPreference(storage, seed);
    expect(await loadSeedPreference(storage)).toBe(seed);
  });

  it('ignores anything that is not a long', async () => {
    const storage = memoryStorage();
    for (const bad of ['abc', 42, '9223372036854775808', '']) {
      await storage.set(SEED_PREFERENCE_STORAGE_KEY, bad);
      expect(await loadSeedPreference(storage)).toBeUndefined();
    }
  });
});

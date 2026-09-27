/**
 * World settings panel: the "Advanced world
 * settings" disclosure's open/closed state must round-trip through `@platform/storage`. Tested
 * against a minimal in-memory `StorageAdapter` rather than mounting real DOM -- vitest's default
 * environment here is `node` (vitest's default), so there is no `localStorage`/`details`
 * element to exercise, and the round trip itself has nothing to do with the DOM anyway.
 */
import { describe, expect, it } from 'vitest';
import {
  WORLD_SETTINGS_DISCLOSURE_KEY,
  loadWorldSettingsOpen,
  saveWorldSettingsOpen,
} from '../../src/ui/components/panels';
import type { StorageAdapter } from '../../src/platform/storage';

function makeFakeStorage(): StorageAdapter {
  const data = new Map<string, unknown>();
  return {
    get<T>(key: string): Promise<T | undefined> {
      return Promise.resolve(data.get(key) as T | undefined);
    },
    set<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      data.delete(key);
      return Promise.resolve();
    },
    keys(): Promise<string[]> {
      return Promise.resolve([...data.keys()]);
    },
  };
}

describe('world settings disclosure state (round-trips through @platform/storage)', () => {
  it('defaults to closed when nothing has ever been saved', async () => {
    const storage = makeFakeStorage();
    expect(await loadWorldSettingsOpen(storage)).toBe(false);
  });

  it('remembers true after being saved open', async () => {
    const storage = makeFakeStorage();
    await saveWorldSettingsOpen(storage, true);
    expect(await loadWorldSettingsOpen(storage)).toBe(true);
  });

  it('remembers false after being saved closed again', async () => {
    const storage = makeFakeStorage();
    await saveWorldSettingsOpen(storage, true);
    await saveWorldSettingsOpen(storage, false);
    expect(await loadWorldSettingsOpen(storage)).toBe(false);
  });

  it('writes under the documented storage key, not an ad-hoc one', async () => {
    const storage = makeFakeStorage();
    await saveWorldSettingsOpen(storage, true);
    expect(await storage.get(WORLD_SETTINGS_DISCLOSURE_KEY)).toBe(true);
  });

  it('treats anything other than a literal true as closed (defensive against corrupted storage)', async () => {
    const storage = makeFakeStorage();
    await storage.set(WORLD_SETTINGS_DISCLOSURE_KEY, 'yes');
    expect(await loadWorldSettingsOpen(storage)).toBe(false);
  });
});

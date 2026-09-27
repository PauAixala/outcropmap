import { describe, expect, it } from 'vitest';
import data from '../../src/data/tfg/structures.json';
import { GLYPH_GRID } from '../../src/ui/icons/glyphs';
import { STRUCTURE_KINDS, structureKindFor, structureSetOf, FALLBACK_STRUCTURE_KIND } from '../../src/ui/icons/structure-glyphs';
import { en } from '../../src/ui/i18n/en';
import {
  loadCompletedStructures,
  saveCompletedStructures,
  structureProgressKey,
} from '../../src/app/structure-progress';
import type { StorageAdapter } from '../../src/platform/storage';

// Sets with no structures are carried for their placement alone -- an exclusion zone asks where
// another set could start, never whether anything generates there -- so they never draw a marker
// and never need artwork.
const setIds = (data as unknown as { sets: { id: string; structures: unknown[] }[] }).sets
  .filter((set) => set.structures.length > 0)
  .map((set) => set.id);

describe('structure kinds', () => {
  it('give every placed set its own icon and name, never the fallback', () => {
    // A new set in the extracted data with no drawing or name shows up here, not as a grey diamond.
    for (const id of setIds) {
      expect(structureKindFor(id), `no icon for ${id}`).not.toBe(FALLBACK_STRUCTURE_KIND);
      expect(en.structureKinds[id], `no name for ${id}`).toBeTruthy();
    }
  });

  it('draw every glyph inside the 16x16 grid with whole coordinates', () => {
    for (const [id, kind] of Object.entries(STRUCTURE_KINDS)) {
      for (const subpath of kind.glyph) {
        expect(subpath.length % 2, `${id} has an odd coordinate count`).toBe(0);
        expect(subpath.length, `${id} has a degenerate subpath`).toBeGreaterThanOrEqual(6);
        for (const value of subpath) {
          expect(Number.isInteger(value), `${id} has a non-integer coordinate`).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(GLYPH_GRID);
        }
      }
    }
  });

  it('read the set back out of a feature id', () => {
    expect(structureSetOf('tfc_ruins:ruins@12,-4')).toBe('tfc_ruins:ruins');
  });
});

describe('completed structures', () => {
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

  it('round-trip per world and ignore anything malformed', async () => {
    const storage = memoryStorage();
    await saveCompletedStructures(storage, 42n, 'tfg', ['tfc_ruins:ruins@1,2']);
    expect(await loadCompletedStructures(storage, 42n, 'tfg')).toEqual(['tfc_ruins:ruins@1,2']);
    expect(await loadCompletedStructures(storage, 43n, 'tfg')).toEqual([]);
    await storage.set(structureProgressKey(42n, 'tfg'), 'not a list');
    expect(await loadCompletedStructures(storage, 42n, 'tfg')).toEqual([]);
  });
});

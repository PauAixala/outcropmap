/**
 * Custom recipes (docs/PLAN.md section 14, docs/FORGING-NOTES.md "Custom recipes"): the save/load
 * path through `@platform/storage` must round-trip a recipe EXACTLY — names and notes are free
 * text with quotes and accented characters, and an absent note must stay absent (not become '' or
 * undefined). A malformed import file is rejected as a whole and must leave the stored list
 * untouched. Tested against an in-memory `StorageAdapter` that mirrors `createWebStorage()`'s
 * contract — values are kept as JSON text and parsed back on get, exactly like localStorage — so a
 * "second session" (a fresh adapter over the same backing map) reads what a page reload would see.
 * The model under test is pure: no DOM anywhere in this file (vitest env here is node).
 */
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_RECIPES_STORAGE_KEY,
  loadCustomRecipes,
  parseCustomRecipesFile,
  saveCustomRecipes,
  serializeCustomRecipes,
} from '../../src/forge/model/custom-recipe';
import type { CustomRecipe, CustomRecipesFailure } from '../../src/forge/model/custom-recipe';
import type { StorageAdapter } from '../../src/platform/storage';

/** In-memory stand-in for `createWebStorage()`: JSON text in, parsed value out (cf. localStorage). */
function makeFakeStorage(backing = new Map<string, string>()): StorageAdapter {
  return {
    get<T>(key: string): Promise<T | undefined> {
      const raw = backing.get(key);
      if (raw === undefined) return Promise.resolve(undefined);
      return Promise.resolve(JSON.parse(raw) as T);
    },
    set<T>(key: string, value: T): Promise<void> {
      backing.set(key, JSON.stringify(value));
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      backing.delete(key);
      return Promise.resolve();
    },
    keys(): Promise<string[]> {
      return Promise.resolve([...backing.keys()]);
    },
  };
}

/** The exactness fixture: quotes, accents and a newline in both name and notes; three rules. */
const RECIPE_A: CustomRecipe = {
  id: 'cr-accented',
  name: 'Café "Béton" épée — v2',
  target: 42,
  rules: [
    { type: 'PUNCH', position: 'LAST' },
    { type: 'HIT', position: 'SECOND_LAST', strength: 'HARD' },
    { type: 'DRAW', position: 'NOT_LAST' },
  ],
  notes: 'Écrire à l\'anvil — "with quotes" and a newline:\nsecond line',
};

/** The absence fixture: no `notes` key at all, empty rules. */
const RECIPE_B: CustomRecipe = {
  id: 'cr-plain',
  name: 'Plain recipe',
  target: 7,
  rules: [],
};

describe('custom recipes through @platform/storage (fake adapter)', () => {
  it('round-trips a list exactly, including quotes and accented characters in name and notes', async () => {
    const storage = makeFakeStorage();
    await saveCustomRecipes(storage, [RECIPE_A, RECIPE_B]);
    const loaded = await loadCustomRecipes(storage);

    expect(loaded).toEqual([RECIPE_A, RECIPE_B]);
    // Character-exact on top of deep-equal: the same JSON text comes back that went in.
    expect(JSON.stringify(loaded)).toBe(JSON.stringify([RECIPE_A, RECIPE_B]));
    // toEqual treats `notes: undefined` and an absent key alike; a strict round trip must keep the
    // key ABSENT, so check that explicitly for the no-notes recipe.
    const plain = loaded.find((r) => r.id === RECIPE_B.id);
    if (plain !== undefined) {
      expect('notes' in plain).toBe(false);
    } else {
      throw new Error('the no-notes recipe was lost in the round trip');
    }
  });

  it('survives a page reload: a fresh adapter over the same store reads back what was saved', async () => {
    const backing = new Map<string, string>();
    await saveCustomRecipes(makeFakeStorage(backing), [RECIPE_A, RECIPE_B]);
    // A "new page" is a fresh adapter instance over the same underlying storage.
    expect(await loadCustomRecipes(makeFakeStorage(backing))).toEqual([RECIPE_A, RECIPE_B]);
  });

  it('persists under the documented storage key so a reload can find it', async () => {
    const storage = makeFakeStorage();
    await saveCustomRecipes(storage, [RECIPE_A]);
    expect(await storage.get<unknown>(CUSTOM_RECIPES_STORAGE_KEY)).toEqual([RECIPE_A]);
  });

  it('drops a corrupted entry but keeps the valid ones (defensive load)', async () => {
    const storage = makeFakeStorage();
    await storage.set(CUSTOM_RECIPES_STORAGE_KEY, [RECIPE_A, { id: 'broken' }, RECIPE_B]);
    expect(await loadCustomRecipes(storage)).toEqual([RECIPE_A, RECIPE_B]);
  });

  it('degrades to an empty list when the stored value is not a recipe array', async () => {
    const storage = makeFakeStorage();
    await storage.set(CUSTOM_RECIPES_STORAGE_KEY, { recipes: 'nope' });
    expect(await loadCustomRecipes(storage)).toEqual([]);
  });
});

describe('export/import (serialize + parse)', () => {
  it('serialize -> parse round-trips exactly, keeping quotes and accents', () => {
    const result = parseCustomRecipesFile(serializeCustomRecipes([RECIPE_A, RECIPE_B]));
    expect(result).toEqual({ ok: true, recipes: [RECIPE_A, RECIPE_B] });
  });

  it('accepts a plain JSON array of recipe objects as well (the friendly path)', () => {
    expect(parseCustomRecipesFile(JSON.stringify([RECIPE_A]))).toEqual({
      ok: true,
      recipes: [RECIPE_A],
    });
  });

  it('rejects invalid JSON as a whole', () => {
    expect(parseCustomRecipesFile('{not json')).toEqual({
      ok: false,
      failure: { kind: 'invalid-json' },
    });
  });

  it('rejects the wrong top-level shape without naming an entry', () => {
    const badShapes = [
      '"a string"',
      '42',
      'null',
      '{"kind":"terrafirma-mapviewer-forge-recipes"}', // right kind, no recipes array
      '{"kind":"something-else","recipes":[]}', // wrong kind marker
    ];
    for (const text of badShapes) {
      expect(parseCustomRecipesFile(text), `expected ${text} to be rejected`).toEqual({
        ok: false,
        failure: { kind: 'wrong-shape' },
      });
    }
  });

  it('rejects an entry-level problem as the whole file, naming its position and field', () => {
    const cases: Array<{ readonly doc: unknown; readonly failure: CustomRecipesFailure }> = [
      { doc: ['a string'], failure: { kind: 'bad-recipe', index: 0, field: 'entry' } },
      { doc: [null], failure: { kind: 'bad-recipe', index: 0, field: 'entry' } },
      {
        doc: [{ name: 'no id', target: 1, rules: [] }],
        failure: { kind: 'bad-recipe', index: 0, field: 'id' },
      },
      {
        doc: [{ id: 'a', target: 1, rules: [] }],
        failure: { kind: 'bad-recipe', index: 0, field: 'name' },
      },
      {
        doc: [{ id: 'a', name: '   ', target: 1, rules: [] }],
        failure: { kind: 'bad-recipe', index: 0, field: 'name' },
      },
      {
        doc: [{ id: 'a', name: 'A', target: 1.5, rules: [] }],
        failure: { kind: 'bad-recipe', index: 0, field: 'target' },
      },
      {
        doc: [
          {
            id: 'a',
            name: 'A',
            target: 1,
            rules: [
              { type: 'HIT', position: 'LAST' },
              { type: 'HIT', position: 'LAST' },
              { type: 'HIT', position: 'LAST' },
              { type: 'HIT', position: 'LAST' }, // four rules is too many
            ],
          },
        ],
        failure: { kind: 'bad-recipe', index: 0, field: 'rules' },
      },
      {
        doc: [{ id: 'a', name: 'A', target: 1, rules: [{ type: 'HAMMER', position: 'LAST' }] }],
        failure: { kind: 'bad-recipe', index: 0, field: 'rules' },
      },
      {
        doc: [{ id: 'a', name: 'A', target: 1, notes: 42 }],
        failure: { kind: 'bad-recipe', index: 0, field: 'notes' },
      },
      // A second entry failing keeps the first one from saving either — the whole file is rejected.
      {
        doc: [RECIPE_A, { id: 'b', name: '', target: 3, rules: [] }],
        failure: { kind: 'bad-recipe', index: 1, field: 'name' },
      },
    ];
    for (const c of cases) {
      expect(parseCustomRecipesFile(JSON.stringify(c.doc)), `for ${JSON.stringify(c.doc)}`).toEqual(
        {
          ok: false,
          failure: c.failure,
        },
      );
    }
  });

  it('a rejected import leaves the existing saved recipes byte-identical', async () => {
    const storage = makeFakeStorage();
    await saveCustomRecipes(storage, [RECIPE_A, RECIPE_B]);
    // The stored value is what a reload would read — snapshot it before touching anything.
    const before = await storage.get<unknown>(CUSTOM_RECIPES_STORAGE_KEY);

    for (const text of [
      '{not json', // invalid-json
      '{"kind":"terrafirma-mapviewer-forge-recipes"}', // wrong-shape
      JSON.stringify([{ id: '', name: 'x' }]), // bad entry at index 0
    ]) {
      expect(parseCustomRecipesFile(text), `expected ${text} to be rejected`).toEqual(
        expect.objectContaining({ ok: false }),
      );
    }

    // Byte-identical: the stored text is exactly what was there before the rejected imports.
    expect(JSON.stringify(await storage.get<unknown>(CUSTOM_RECIPES_STORAGE_KEY))).toBe(
      JSON.stringify(before),
    );
    expect(await loadCustomRecipes(storage)).toEqual([RECIPE_A, RECIPE_B]);
  });
});

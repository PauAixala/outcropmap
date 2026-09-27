import { describe, expect, it } from 'vitest';
import {
  CUSTOM_RECIPES_STORAGE_KEY,
  loadCustomRecipeStore,
  normalizeCustomRecipe,
  rulesFromForm,
  saveCustomRecipeStore,
  splitRulesForForm,
} from '@forge/model/custom-recipe';
import type { CustomRecipe } from '@forge/model/custom-recipe';
import { solve } from '@forge/solver/solve';
import { actionsForProfile } from '@forge/model/actions';
import type { ForgeRule } from '@forge/model/types';
import type { StorageAdapter } from '@platform/storage';

/** The same in-memory adapter shape `custom-recipes.test.ts` uses: JSON in, JSON out. */
function makeFakeStorage(backing = new Map<string, string>()): StorageAdapter {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const text = backing.get(key);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
    async set<T>(key: string, value: T): Promise<void> {
      backing.set(key, JSON.stringify(value));
    },
    async remove(key: string): Promise<void> {
      backing.delete(key);
    },
    async keys(): Promise<string[]> {
      return [...backing.keys()];
    },
  };
}

describe('opening a saved custom recipe never loses a rule', () => {
  // A record the editor could write before 2026-09-10: an ANY rule and a second rule for the last step.
  const saved: CustomRecipe = {
    id: 'r1',
    name: 'Greaves, as saved',
    target: 60,
    rules: [
      { type: 'BEND', position: 'ANY' },
      { type: 'HIT', position: 'LAST' },
      { type: 'HIT', position: 'LAST', strength: 'LIGHT' },
    ],
  };

  it('puts what fits in the slots and keeps the rest as read-only extras', () => {
    const split = splitRulesForForm(saved.rules);
    expect(split.slots).toEqual({ THIRD_LAST: null, SECOND_LAST: null, LAST: { type: 'HIT', position: 'LAST' } });
    expect(split.extra).toEqual([
      { type: 'BEND', position: 'ANY' },
      { type: 'HIT', position: 'LAST', strength: 'LIGHT' },
    ]);
  });

  it('round-trips through open, solve and update unchanged', () => {
    const opened = splitRulesForForm(saved.rules);
    // Open: the form shows the slots as they were; nothing is touched.
    const rules = rulesFromForm(opened, opened.slots);
    expect(rules).toEqual(saved.rules);

    // Solve: with the stored rules, not the reduced set the rows could show.
    const actions = actionsForProfile('tfc-1.20');
    const base = { start: 0, target: saved.target, actions, minValue: 0, maxValue: 149, maxSolutions: 3 };
    const withStored = solve({ ...base, rules });
    const withStoredDirect = solve({ ...base, rules: saved.rules });
    expect(withStored.length).toBeGreaterThan(0);
    expect(withStored).toEqual(withStoredDirect);

    // Update: what is written back is the record's own rules.
    const updated = normalizeCustomRecipe({ ...saved, rules });
    expect(updated).toEqual(saved);
  });

  it('changes only the slot the user changed', () => {
    const opened = splitRulesForForm(saved.rules);
    const draw: ForgeRule = { type: 'PUNCH', position: 'SECOND_LAST' };
    expect(rulesFromForm(opened, { ...opened.slots, SECOND_LAST: draw })).toEqual([...saved.rules, draw]);
    expect(rulesFromForm(opened, { ...opened.slots, LAST: null })).toEqual([
      { type: 'BEND', position: 'ANY' },
      { type: 'HIT', position: 'LAST', strength: 'LIGHT' },
    ]);
  });
});

describe('a record that does not validate is kept, not erased', () => {
  const good = { id: 'a', name: 'Good', target: 10, rules: [], profile: 'tfg' };
  const bad = { id: 'b', name: 'Four rules', target: 10, rules: [1, 2, 3, 4] };
  const alsoBad = 'not even an object';

  it('loads the good ones and reports the rest', async () => {
    const backing = new Map([[CUSTOM_RECIPES_STORAGE_KEY, JSON.stringify([good, bad, alsoBad])]]);
    const store = await loadCustomRecipeStore(makeFakeStorage(backing));
    expect(store.recipes).toEqual([good]);
    expect(store.unreadable.map((entry) => entry.raw)).toEqual([bad, alsoBad]);
    expect(store.unreadable.map((entry) => entry.field)).toEqual(['rules', 'entry']);
  });

  it('writes the unreadable ones back verbatim on the next save', async () => {
    const backing = new Map([[CUSTOM_RECIPES_STORAGE_KEY, JSON.stringify([good, bad, alsoBad])]]);
    const storage = makeFakeStorage(backing);
    const store = await loadCustomRecipeStore(storage);
    const added: CustomRecipe = { id: 'c', name: 'New', target: 5, rules: [], profile: 'tfg' };
    await saveCustomRecipeStore(storage, { recipes: [...store.recipes, added], unreadable: store.unreadable });
    expect(JSON.parse(backing.get(CUSTOM_RECIPES_STORAGE_KEY)!)).toEqual([good, added, bad, alsoBad]);
  });

  it('keeps a profile field through a save', async () => {
    const backing = new Map<string, string>();
    const storage = makeFakeStorage(backing);
    await saveCustomRecipeStore(storage, { recipes: [normalizeCustomRecipe(good)!], unreadable: [] });
    expect((await loadCustomRecipeStore(storage)).recipes[0]?.profile).toBe('tfg');
  });
});

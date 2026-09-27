import { describe, expect, it } from 'vitest';
import { matchesSearch, type CatalogRecipe } from '../../src/ui/components/forge-picker';

const spade: CatalogRecipe = {
  id: 'black_steel_spade_head',
  recipeId: 'tfc:anvil/black_steel_spade_head',
  input: { tag: 'forge:double_ingots/black_steel' },
  result: { item: 'tfc:metal/spade_head/black_steel' },
  rules: ['punch_last'],
  tier: 5,
};
const door: CatalogRecipe = {
  id: 'iron_door',
  recipeId: 'tfc:anvil/iron_door',
  input: { tag: 'forge:double_plates/wrought_iron' },
  result: { item: 'minecraft:iron_door' },
  rules: ['hit_last'],
  tier: 3,
};

describe('catalogue search', () => {
  it('matches words in any order, adjacent or not', () => {
    for (const query of ['black sp', 'spade black', 'black steel spade', 'SPADE']) {
      expect(matchesSearch(spade, query), query).toBe(true);
    }
  });

  it('requires every word, so an unrelated one excludes the recipe', () => {
    expect(matchesSearch(spade, 'black copper')).toBe(false);
  });

  it('ignores the mod namespace, which is not part of any item name', () => {
    expect(matchesSearch(door, 'min')).toBe(false);
    expect(matchesSearch(door, 'iron door')).toBe(true);
  });

  it('shows everything for an empty query', () => {
    expect(matchesSearch(spade, '   ')).toBe(true);
  });
});

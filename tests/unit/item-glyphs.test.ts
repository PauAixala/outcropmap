import { describe, expect, it } from 'vitest';
import tfcRecipes from '../../src/data/tfc-1.20/anvil-recipes.json';
import tfgRecipes from '../../src/data/tfg/anvil-recipes.json';
import { ITEM_GLYPHS, itemGlyphFor } from '../../src/ui/icons/item-glyphs';
import { GLYPH_GRID } from '../../src/ui/icons/glyphs';

type RecipeFile = { recipes?: Record<string, { result?: { item?: string } }> };

function resultItems(): string[] {
  const items: string[] = [];
  for (const file of [tfcRecipes, tfgRecipes] as unknown as RecipeFile[]) {
    for (const recipe of Object.values(file.recipes ?? {})) {
      if (recipe.result?.item) items.push(recipe.result.item);
    }
  }
  return items;
}

describe('recipe item glyphs', () => {
  it('gives every real recipe result a specific glyph, never the fallback', () => {
    // The fallback exists so an unknown id degrades gracefully, not so the catalogue can lean on
    // it. If a new item lands with no drawing, this is where it shows up.
    const generic = [...new Set(resultItems().filter((item) => itemGlyphFor(item) === 'generic'))];
    expect(generic, `items with no glyph: ${generic.join(', ')}`).toEqual([]);
  });

  it('actually distinguishes the catalogue rather than reusing a handful of drawings', () => {
    const used = new Set(resultItems().map(itemGlyphFor));
    expect(used.size).toBeGreaterThanOrEqual(30);
  });

  it('every glyph stays inside the 16x16 grid', () => {
    // A stray coordinate reads as a clipped icon in a 32px socket, which is hard to spot by eye.
    for (const [id, glyph] of Object.entries(ITEM_GLYPHS)) {
      for (const subpath of glyph) {
        expect(subpath.length % 2, `${id} has an odd coordinate count`).toBe(0);
        for (const value of subpath) {
          expect(Number.isInteger(value), `${id} has a non-integer coordinate`).toBe(true);
          expect(value, `${id} is outside the grid`).toBeGreaterThanOrEqual(0);
          expect(value, `${id} is outside the grid`).toBeLessThanOrEqual(GLYPH_GRID);
        }
      }
    }
  });
});

describe('TFG anvil catalogue', () => {
  type Recipe = { result: { item: string }; tier?: number; rules?: string[] };
  const recipes = (tfgRecipes as unknown as { recipes: Record<string, Recipe> }).recipes;

  it('carries the KubeJS-defined tool heads with their rules and tier', () => {
    // recipes.material_tfc.js: addAnvilRecipe(miningHammerHead, doubleIngot, ['punch_last', 'shrink_not_last']).
    // The result is the game's own id since the catalogue became a view over the game,
    // not the TFC-shaped display name the extractor used to write.
    expect(recipes['steel_mining_hammer_head']).toMatchObject({
      result: { item: 'gtceu:steel_mining_hammer_head' },
      tier: 4,
      rules: ['punch_last', 'shrink_not_last'],
    });
    expect(recipes['steel_sword_blade']?.rules).toEqual(['punch_last', 'bend_not_last', 'draw_not_last']);
  });

  it('skips recipes the script guards out for iron', () => {
    expect(recipes['createdeco_iron_bars']).toBeUndefined();
    expect(recipes['createdeco_iron_bars_overlay']).toBeDefined();
  });

  it('draws the new outputs with their own glyphs', () => {
    expect(itemGlyphFor('tfc:metal/mining_hammer_head/steel')).toBe('mining_hammer');
    expect(itemGlyphFor('gtceu:steel_mining_hammer_head')).toBe('mining_hammer');
    expect(itemGlyphFor('gtceu:copper_screwdriver_tip')).toBe('screwdriver');
    expect(itemGlyphFor('createdeco:brass_bars')).toBe('bars');
    expect(itemGlyphFor('createdeco:brass_trapdoor')).toBe('trapdoor');
    expect(itemGlyphFor('tfg:bronze_spindle_head')).toBe('spindle');
  });
});

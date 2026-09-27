import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tfcRecipes from '../../src/data/tfc-1.20/anvil-recipes.json';
import tfgRecipes from '../../src/data/tfg/anvil-recipes.json';
import { ORE_TOKEN_NAMES, matchesOreFilter, oreMarkerColor } from '../../src/render/markers';
import { itemGlyphFor } from '../../src/ui/icons/item-glyphs';

describe('UI artwork mappings', () => {
  it('gives every shipped forge result a recognisable item glyph', () => {
    const recipes = [...Object.values(tfcRecipes.recipes), ...Object.values(tfgRecipes.recipes)];
    const generic = recipes
      .map((recipe) => recipe.result.item)
      .filter((item) => itemGlyphFor(item) === 'generic');
    expect([...new Set(generic)]).toEqual([]);
  });

  it('keeps related ores recognisable while assigning distinct stable colours', () => {
    // The palette as the page resolves it: the `--ore-*` tokens in base.css.
    const css = readFileSync(join(process.cwd(), 'src/ui/styles/base.css'), 'utf8');
    const palette: Record<string, number> = {};
    for (const m of css.matchAll(/--(ore-[a-z-]+):\s*#([0-9a-f]{6});/g)) palette[m[1]!] = Number.parseInt(m[2]!, 16);
    for (const token of ORE_TOKEN_NAMES) expect([token, palette[token] !== undefined]).toEqual([token, true]);
    const ores = ['normal_copper', 'rich_copper', 'poor_copper', 'hematite', 'gold', 'sulfur'];
    const colors = ores.map((ore) => oreMarkerColor(ore, palette));
    expect(new Set(colors).size).toBe(ores.length);
    expect(ores.map((ore) => oreMarkerColor(ore, palette))).toEqual(colors);
  });

  it('matches namespaced ore ids against filter values', () => {
    expect(matchesOreFilter('tfg:normal_copper', ['normal_copper'])).toBe(true);
    expect(matchesOreFilter('tfc:normal_copper', ['normal_copper'])).toBe(true);
    expect(matchesOreFilter('tfg:normal_copper', ['cassiterite'])).toBe(false);
  });
});

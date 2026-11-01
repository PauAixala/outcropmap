import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../../src/worldgen/profiles';
import tfcRecipes from '../../src/data/tfc-1.20/anvil-recipes.json';
import tfgRecipes from '../../src/data/tfg/anvil-recipes.json';
import { depositStyle } from '../../src/render/deposit-style';
import { DEPOSIT_MARKER_GEOMETRY, matchesOreFilter } from '../../src/render/markers';
import { itemGlyphFor } from '../../src/ui/icons/item-glyphs';
import { listProfiles } from '../../src/worldgen/registry';
import type { ProfileId } from '../../src/worldgen/api/types';

const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

describe('UI artwork mappings', () => {
  it('gives every shipped forge result a recognisable item glyph', () => {
    const recipes = [...Object.values(tfcRecipes.recipes), ...Object.values(tfgRecipes.recipes)];
    const generic = recipes
      .map((recipe) => recipe.result.item)
      .filter((item) => itemGlyphFor(item) === 'generic');
    expect([...new Set(generic)]).toEqual([]);
  });

  it('gives every deposit kind a profile lists a marker the map can draw, the same every time', () => {
    // Shape and fill come from the profile's own palette (`depositStyle`); the painter and the ore
    // filter's swatch both draw from it, with geometry for exactly these four shapes.
    for (const profile of ['tfc-1.20', 'tfg'] as const satisfies readonly ProfileId[]) {
      const descriptor = listProfiles().find((p) => p.id === profile);
      const ids = new Set<string>(descriptor?.depositOres ?? []);
      for (const list of Object.values(descriptor?.dimensionDepositOres ?? {})) for (const id of list ?? []) ids.add(id);
      expect([profile, ids.size > 10]).toEqual([profile, true]);
      for (const id of ids) {
        const style = depositStyle(profile, id);
        expect([profile, id, style.shape in DEPOSIT_MARKER_GEOMETRY]).toEqual([profile, id, true]);
        expect([profile, id, Number.isInteger(style.color) && style.color >= 0 && style.color <= 0xffffff]).toEqual([
          profile,
          id,
          true,
        ]);
        const again = depositStyle(profile, id);
        expect([again.shape, again.color]).toEqual([style.shape, style.color]);
      }
    }
  });

  it('keeps no per-ore theme token: ore colours are palette data, not theme', () => {
    // The 43 per-ore colour tokens were matched to vein ids by substring and nudged by a hash; they
    // were retired with the per-profile palettes (docs/PLAN.md 20.1). The patterns are assembled
    // here so a plain search for the retired names finds nothing left in src/ or tests/.
    const oreToken = new RegExp(`--${'ore'}-[a-z]`);
    expect(read('src/ui/styles/base.css')).not.toMatch(oreToken);
    const theme = read('src/ui/theme/theme.ts');
    expect(theme).not.toMatch(new RegExp(`${'ORE'}_TOKEN_NAMES|'${'ore'}-`));
    expect(theme).toContain("'marker-halo'");
  });

  it('matches namespaced ore ids against filter values', () => {
    expect(matchesOreFilter('tfg:normal_copper', ['normal_copper'])).toBe(true);
    expect(matchesOreFilter('tfc:normal_copper', ['normal_copper'])).toBe(true);
    expect(matchesOreFilter('tfg:normal_copper', ['cassiterite'])).toBe(false);
  });
});

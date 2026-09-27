import { describe, expect, it } from 'vitest';
import { metalColour, metalOf } from '../../src/ui/icons/metal-colours';
import tfgRecipes from '../../src/data/tfg/anvil-recipes.json';

describe('metal colours', () => {
  it('takes the longest metal name, not the first one it sees', () => {
    // Every one of these contains a shorter metal id as a substring. Matching that instead would
    // paint a third of the catalogue the same grey.
    expect(metalOf('forge:ingots/black_steel')).toBe('black_steel');
    expect(metalOf('forge:ingots/stainless_steel')).toBe('stainless_steel');
    expect(metalOf('tfc:metal/sheet/high_carbon_blue_steel')).toBe('high_carbon_blue_steel');
    expect(metalOf('gtceu:black_bronze_rod')).toBe('black_bronze');
    expect(metalOf('forge:ingots/bismuth_bronze')).toBe('bismuth_bronze');
    expect(metalOf('forge:ingots/rose_gold')).toBe('rose_gold');
    expect(metalOf('forge:ingots/sterling_silver')).toBe('sterling_silver');
  });

  it('reads every form the catalogue writes an input in', () => {
    expect(metalOf('forge:double_sheets/wrought_iron')).toBe('wrought_iron');
    expect(metalOf('tfc:metal/ingot/copper')).toBe('copper');
    expect(metalOf('gtceu:steel_rod')).toBe('steel');
  });

  it('says nothing rather than guessing when there is no metal', () => {
    expect(metalOf('tfc:rock/raw/granite')).toBeNull();
    expect(metalColour('tfc:rock/raw/granite')).toBe('var(--forge-steel)');
  });

  it('only ever names a token, never a colour', () => {
    expect(metalColour('forge:ingots/copper')).toMatch(/^var\(--[a-z-]+\)$/);
  });

  it('finds a metal for most of the real catalogue', () => {
    const recipes = Object.values(
      (tfgRecipes as unknown as { recipes: Record<string, { input: { item?: string; tag?: string } }> }).recipes,
    );
    const withMetal = recipes.filter((r) => metalOf(r.input.item ?? r.input.tag ?? '') !== null);
    // Not all of them: some anvil recipes work stone or a gem. A sharp drop here means the id
    // shapes changed under us, which is how the rod recipes went wrong before.
    expect(withMetal.length / recipes.length).toBeGreaterThan(0.85);
  });
});

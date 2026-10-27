import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { listProfiles } from '../../src/worldgen/registry';
import { formatMaterialName, formatOreName } from '../../src/ui/i18n/ore-names';

/** The same label the filter builds: name plus what the vein yields when the name omits it. */
function oreLabel(id: string, yields: Readonly<Record<string, readonly string[]>>): string {
  const name = formatOreName(id);
  const extras = (yields[id] ?? [])
    .map(formatMaterialName)
    .filter((material) => !name.toLowerCase().includes(material.toLowerCase()));
  return extras.length === 0 ? name : `${name} · ${extras.join(', ')}`;
}

/** The ids whose label contains `query`, as the filter's search box matches them. */
function searcher(profileId: string): (query: string) => string[] {
  const profile = listProfiles().find((p) => p.id === profileId);
  const ores = profile?.depositOres ?? [];
  const yields = profile?.depositYields ?? {};
  return (query) =>
    ores.filter((id) => oreLabel(id, yields).toLowerCase().includes(query.toLowerCase()));
}

describe('searching the ore filter', () => {
  const profile = listProfiles().find((p) => p.id === 'tfg');
  const ores = profile?.depositOres ?? [];
  const matching = searcher('tfg');

  it('has enough ores that a search is the point', () => {
    expect(ores.length).toBeGreaterThan(60);
  });

  it('finds silver through the veins that actually yield it', () => {
    // TerraFirmaGreg has no silver vein at all. Searching the vein *names* would find nothing,
    // which is exactly the dead end Pau hit. The label carries the yields, so the search does too.
    const found = matching('silver');
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((id) => id.includes('galena'))).toBe(true);
    expect(found.every((id) => id.includes('silver'))).toBe(false);
  });

  it('finds an ore by its own name', () => {
    expect(matching('copper').length).toBeGreaterThan(0);
    expect(matching('coal').length).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(matching('GALENA')).toEqual(matching('galena'));
  });

  it('returns nothing for a query that matches no ore', () => {
    expect(matching('zzzznotanore')).toEqual([]);
  });

  it('finds a sand ore by its material, and no stone as if it were an ore', () => {
    expect(matching('basaltic mineral sand')).toContain('sand_basaltic');
    // The Beneath names ores after pyroxenite and dripstone, which hold them but are not them.
    expect(matching('pyroxenite')).toEqual([]);
    expect(matching('dripstone')).toEqual([]);
  });

  it('finds TFC’s native copper deposits, and no rock', () => {
    const tfc = searcher('tfc-1.20');
    expect(tfc('native copper deposit')).toEqual(['surface_native_copper']);
    expect(tfc('cassiterite deposit')).toEqual(['surface_cassiterite']);
    // `tfc:deposit/native_copper/andesite` used to put "Andesite" in copper's label.
    expect(tfc('andesite')).toEqual([]);
    expect(tfc('rhyolite')).toEqual([]);
  });
});

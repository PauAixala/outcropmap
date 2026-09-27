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

describe('searching the ore filter', () => {
  const profile = listProfiles().find((p) => p.id === 'tfg');
  const ores = profile?.depositOres ?? [];
  const yields = profile?.depositYields ?? {};
  const matching = (query: string): string[] =>
    ores.filter((id) => oreLabel(id, yields).toLowerCase().includes(query.toLowerCase()));

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
});

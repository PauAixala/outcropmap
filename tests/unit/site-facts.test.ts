import { describe, expect, it } from 'vitest';
import { JavaRandom } from '@core/random';
import { DEFAULT_MAP_STATE } from '@app/state';
import { discVeinBand, factPlaceholders, formatDelta, siteFacts } from '@app/site/facts';
import { fillPlaceholders, formatList } from '@app/site/markup';
import { defaultYPos } from '@worldgen/tfc-1.20/features/disc-vein';
import { KAOLIN, KAOLIN_BIOMES, kaolinInBox } from '@worldgen/tfg/kaolin';
import { en } from '@ui/i18n/en';
import { enSite, type Block } from '@ui/i18n/en-site';
import tfcRecipes from '@data/tfc-1.20/anvil-recipes.json';
import tfgRecipes from '@data/tfg/anvil-recipes.json';
import tfcAnvil from '@data/tfc-1.20/anvil.json';
import tfgAnvil from '@data/tfg/anvil.json';
import tfcVeins from '@data/tfc-1.20/veins.json';
import tfgKaolin from '@data/tfg/kaolin.json';

/**
 * The numbers the About page quotes come from the data the tools run on (src/app/site/facts.ts);
 * these hold them to what the map and the forge actually do.
 */
const facts = siteFacts();

describe('site facts', () => {
  it('counts the recipes each forge catalogue holds', () => {
    expect(facts.tfcRecipes).toBe(Object.keys(tfcRecipes.recipes).length);
    expect(facts.tfgRecipes).toBe(Object.keys(tfgRecipes.recipes).length);
    expect(facts.tfcRecipes).toBeGreaterThan(100);
  });

  it('lists every anvil action with its step, the same in both profiles', () => {
    expect(facts.actions.map((action) => action.delta).sort((a, b) => a - b)).toEqual(
      Object.values(tfcAnvil.actions).sort((a, b) => a - b),
    );
    // One sentence describes both profiles only while their actions agree.
    expect(tfgAnvil.actions).toEqual(tfcAnvil.actions);
    expect(facts.actions[0]).toEqual({ label: en.forge.hitStrengthNames.LIGHT, delta: -3 });
    expect(formatDelta(-15)).toBe('\u221215');
    expect(formatDelta(2)).toBe('+2');
  });

  it('places the kaolin band where the disc-vein port puts every patch', () => {
    const disc = tfcVeins.veins.kaolin_disc;
    const centre = defaultYPos(disc.size, new JavaRandom(1n), disc.min_y, disc.max_y);
    expect({ minY: facts.kaolin.minY, maxY: facts.kaolin.maxY }).toEqual({
      minY: centre - disc.height,
      maxY: centre + disc.height,
    });
    expect([facts.kaolin.minY, facts.kaolin.maxY]).toEqual([86, 98]);
    // And the map's own deposits, as the probe shows them.
    const box = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };
    const deposits = kaolinInBox(
      box,
      42n,
      () => 'tfg:earth/plateau',
      () => ({ temperature: 25, rainfall: 400 }),
    );
    expect(deposits.length).toBeGreaterThan(0);
    for (const deposit of deposits) {
      expect([deposit.bottomY, deposit.topY]).toEqual([facts.kaolin.minY, facts.kaolin.maxY]);
    }
  });

  it('derives the band the way VeinFeature#defaultYPos does when the range is open', () => {
    const vein = { minY: 0, maxY: 24, size: 10, height: 2 };
    const random = new JavaRandom(7n);
    const centres = new Set<number>();
    for (let i = 0; i < 400; i++) centres.add(defaultYPos(vein.size, random, vein.minY, vein.maxY));
    expect(discVeinBand(vein)).toEqual({
      minY: Math.min(...centres) - vein.height,
      maxY: Math.max(...centres) + vein.height,
    });
  });

  it('keeps one kaolin description true of both profiles', () => {
    const tfc = tfcVeins.veins.kaolin_disc;
    const tfg = tfgKaolin.configuredFeature.config;
    expect([tfg.rarity, tfg.min_y, tfg.max_y, tfg.size, tfg.height]).toEqual([
      tfc.rarity,
      tfc.min_y,
      tfc.max_y,
      tfc.size,
      tfc.height,
    ]);
    expect(facts.kaolin.rarity).toBe(KAOLIN.rarity);
    expect(facts.kaolin.across).toBe(2 * KAOLIN.size + 1);
  });

  it('quotes the climate limits the kaolin port applies', () => {
    const { minTemperature, minRainfall } = facts.kaolin;
    const box = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };
    const biome = (): string => 'tfg:earth/plateau';
    const at = (temperature: number, rainfall: number): number =>
      kaolinInBox(box, 42n, biome, () => ({ temperature, rainfall })).length;
    expect(at(minTemperature, minRainfall)).toBeGreaterThan(0);
    expect(at(minTemperature - 0.001, minRainfall)).toBe(0);
    expect(at(minTemperature, minRainfall - 0.001)).toBe(0);
    expect([minTemperature, minRainfall]).toEqual([18, 300]);
  });

  it('names the biomes kaolin can form in, as the legend names them', () => {
    expect(facts.kaolin.tfcBiomes).toEqual(['Highlands', 'Old Mountains', 'Plateau']);
    const tfgNames = [...KAOLIN_BIOMES]
      .filter((id) => id.startsWith('tfg:'))
      .map((id) => en.biomeNames[id]);
    expect(facts.kaolin.tfgBiomes).toEqual(tfgNames);
    expect(facts.kaolin.tfgBiomes).toContain('Rolling Hills');
  });
});

describe('site text placeholders', () => {
  const values = factPlaceholders(facts);

  /** Every string in the site text, links' words included. */
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
    return [];
  }

  it('has a value for every {placeholder} the site text uses', () => {
    const used = new Set(
      strings(enSite).flatMap((text) => [...text.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!)),
    );
    used.delete('url'); // llms.fullSource's own, filled by crawl-files.ts
    for (const name of used) expect([name, values[name] !== undefined]).toEqual([name, true]);
    expect(() => fillPlaceholders('{nope}', values)).toThrow(/nope/);
  });

  it('quotes the map’s default accuracy floor', () => {
    // en-site.ts writes "(90% by default)"; this is where the 90 comes from.
    const floor = `${Math.round((DEFAULT_MAP_STATE.minMarkerAccuracy ?? 0) * 100)}% by default`;
    const mentions = strings(enSite).filter((text) => /% by default/.test(text));
    expect(mentions.length).toBeGreaterThan(0);
    for (const text of mentions) expect(text).toContain(floor);
  });

  it('writes lists the house way', () => {
    expect(formatList(['A'])).toBe('A');
    expect(formatList(['A', 'B'])).toBe('A and B');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(values['actions']).toBe(
      'Light hit \u22123, Medium hit \u22126, Hard hit \u22129, Draw \u221215, Punch +2, Bend +7, Upset +13 and Shrink +16',
    );
  });

  it('marks ads-only and no-ads text in pairs a reader can follow', () => {
    const conditional = (blocks: readonly Block[]): string[] =>
      blocks.flatMap((block) => ('p' in block && block.when !== undefined ? [block.when] : []));
    const privacy = enSite.about.sections.find((section) => section.id === 'privacy');
    expect(conditional(privacy?.blocks ?? []).sort()).toEqual(['ads', 'noAds']);
  });
});

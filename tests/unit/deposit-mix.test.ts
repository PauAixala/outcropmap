import { describe, expect, it } from 'vitest';
import { veinMaterialMix } from '../../src/worldgen/tfc-1.20/features/vein-materials';
import { TFG_PROFILE } from '../../src/worldgen/tfg/index';

// The filter turns "57% gold" into "about 1,350 gold blocks", so both halves have to be right: the
// mix comes from the datapack's block weights, the count from the vein's own shape.
describe('vein material mix', () => {
  it('splits a vein by its block weights', () => {
    // tfg normal_gold, basalt: gold 4, magnetite 3.
    const mix = veinMaterialMix({
      'minecraft:basalt': [
        { block: 'gtceu:basalt_gold_ore', weight: 4 },
        { block: 'gtceu:basalt_magnetite_ore', weight: 3 },
      ],
    });
    expect(mix.map((entry) => entry.material)).toEqual(['gold', 'magnetite']);
    expect(mix[0]!.share).toBeCloseTo(4 / 7, 6);
    expect(mix[1]!.share).toBeCloseTo(3 / 7, 6);
  });

  it('leaves plain rock out of the total', () => {
    const mix = veinMaterialMix({
      'tfc:rock/raw/granite': [
        { block: 'tfc:ore/native_gold/granite', weight: 1 },
        { block: 'tfc:rock/raw/granite', weight: 3 },
      ],
    });
    expect(mix).toEqual([{ material: 'native_gold', share: 1 }]);
  });

  it('describes every ore the TFG filter lists, and the shares add up', () => {
    const mix = TFG_PROFILE.depositMix ?? {};
    for (const id of TFG_PROFILE.depositOres ?? []) {
      // `kaolin` places clay, not ore, so it has no mix — the row shows none rather than a made-up one.
      if (id === 'kaolin') continue;
      const entries = mix[id];
      expect(entries, id).toBeDefined();
      expect(entries!.reduce((sum, entry) => sum + entry.share, 0), id).toBeCloseTo(1, 6);
    }
  });

  it('sizes a vein from its own shape, cluster, disc and pipe alike', () => {
    const typical = TFG_PROFILE.typicalBlocks!;
    expect(typical('normal_gold')).toBe(2369);
    expect(typical('surface_gold')).toBe(363);
    // A pipe: a tilted, tapering cylinder, averaged over eight rolls of its skew and slant.
    expect(typical('deep_bismuth')).toBeGreaterThan(0);
    // Kaolin is not a vein at all, so it has no count — null, never a guess.
    expect(typical('kaolin')).toBeNull();
  });
});

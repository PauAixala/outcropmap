import { describe, expect, it } from 'vitest';
import {
  collectRockNames,
  hostRockIdsOf,
  knownVeinMaterials,
  veinFilterId,
  veinMaterialMix,
  veinMaterials,
  veinTableNames,
  type RawBlockTable,
} from '../../src/worldgen/tfc-1.20/features/vein-materials';
import {
  RAW_VEINS_BY_PROFILE,
  type VeinProfileId,
} from '../../src/worldgen/tfc-1.20/features/vein-tables';
import { clusterVeinsFor } from '../../src/worldgen/tfc-1.20/features/cluster-vein';
import { discVeinsFor } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { allPipeVeinsFor } from '../../src/worldgen/tfc-1.20/features/pipe-vein';
import { TFC_1_20_PROFILE } from '../../src/worldgen/tfc-1.20/index';
import { TFG_PROFILE } from '../../src/worldgen/tfg/index';
import { formatMaterialName } from '../../src/ui/i18n/ore-names';
import { guideVeins, type VeinSetId } from '../../src/app/site/guide-data';

/**
 * What the ore filter says a vein yields: its "yields" text, its search ("silver" finds galena)
 * and the material rows on hover all read `depositYields` and `depositMix`, built from the vein
 * tables by `veinMaterials` and `veinMaterialMix`. A material named after the stone it sits in
 * reads as a second ore, and one named after nothing sends a search to the wrong vein.
 */

/** A one-table vein named as the profiles and the ports name it: with its rocks and materials. */
function named(table: RawBlockTable): {
  materials: readonly string[];
  mix: ReturnType<typeof veinMaterialMix>;
} {
  const rocks = collectRockNames([table]);
  const known = knownVeinMaterials([table], rocks);
  return {
    materials: veinMaterials(table, rocks, known),
    mix: veinMaterialMix(table, rocks, known),
  };
}

const ALL_SETS: readonly VeinProfileId[] = [
  'tfc-1.20',
  'tfg',
  'tfg-nether',
  'tfg-moon',
  'tfg-mars',
  'tfg-venus',
];

/** Every vein a port builds for a set, dikes and borrowed veins included. */
const portVeins = (set: VeinProfileId) => [
  ...clusterVeinsFor(set),
  ...discVeinsFor(set),
  ...allPipeVeinsFor(set),
];

/** Every material either profile's ore filter shows, with the filter id it shows it under. */
function filterMaterials(): { profile: string; id: string; material: string }[] {
  return [TFC_1_20_PROFILE, TFG_PROFILE].flatMap((profile) => [
    ...Object.entries(profile.depositYields ?? {}).flatMap(([id, list]) =>
      list.map((material) => ({ profile: profile.id, id, material })),
    ),
    ...Object.entries(profile.depositMix ?? {}).flatMap(([id, list]) =>
      list.map((entry) => ({ profile: profile.id, id, material: entry.material })),
    ),
  ]);
}

describe('block id shapes', () => {
  it('names a TFC deposit after its mineral, apart from the ore, and never after the rock', () => {
    // `tfc:deposit/<mineral>/<rock>`: the pannable placer gravel `surface_native_copper` places.
    const { materials } = named({
      'tfc:rock/raw/andesite': [
        { block: 'tfc:ore/poor_native_copper/andesite', weight: 70 },
        { block: 'tfc:deposit/native_copper/andesite', weight: 10 },
      ],
    });
    expect(materials).toEqual(['native_copper_deposit', 'poor_native_copper']);
    expect(formatMaterialName('native_copper_deposit')).toBe('Native Copper Deposit');
    expect(formatMaterialName('cassiterite_deposit')).toBe('Cassiterite Deposit');
  });

  it('keeps TFC’s grades apart: each grade is its own block', () => {
    const { mix } = named({
      'tfc:rock/raw/granite': [
        { block: 'tfc:ore/poor_cassiterite/granite', weight: 1 },
        { block: 'tfc:ore/normal_cassiterite/granite', weight: 1 },
        { block: 'tfc:ore/rich_cassiterite/granite', weight: 2 },
      ],
    });
    expect(mix).toEqual([
      { material: 'rich_cassiterite', share: 0.5 },
      { material: 'normal_cassiterite', share: 0.25 },
      { material: 'poor_cassiterite', share: 0.25 },
    ]);
  });

  it('reads a sand host as the sand, not its colour', () => {
    const table: RawBlockTable = {
      'tfc:sand/black': [{ block: 'gtceu:black_sand_basaltic_mineral_sand_ore', weight: 8 }],
    };
    expect(named(table).materials).toEqual(['basaltic_mineral_sand']);
    expect([...hostRockIdsOf(table)]).toEqual(['black_sand']);
    expect([...collectRockNames([table])]).toEqual(['black_sand']);
  });

  it('never cuts a colour off a material, and takes one stone off at most', () => {
    // With the bare colour `yellow` counted as one of the table's rocks, this read "limonite".
    const { materials } = named({
      'tfc:rock/raw/granite': [{ block: 'gtceu:granite_yellow_limonite_ore', weight: 1 }],
      'tfc:sand/yellow': [{ block: 'gtceu:yellow_sand_garnet_sand_ore', weight: 1 }],
    });
    expect(materials).toEqual(['garnet_sand', 'yellow_limonite']);
  });

  it('strips another rock of the table when the host does not prefix the block', () => {
    // `gtceu:tuff_coal_ore` under a vein with no tuff key, in a table that names tuff elsewhere.
    const vein: RawBlockTable = { 'tfc:rock/raw/granite': [{ block: 'gtceu:tuff_coal_ore' }] };
    const other: RawBlockTable = { 'minecraft:tuff': [{ block: 'gtceu:tuff_lignite_ore' }] };
    const rocks = collectRockNames([vein, other]);
    expect(veinMaterials(vein, rocks, knownVeinMaterials([vein, other], rocks))).toEqual(['coal']);
  });

  it('resolves an ore named after a stone that is not its host, against the table', () => {
    // The Beneath: blackstone holds `pyroxenite_*`, dripstone `dripstone_*`; neither is a host.
    const table: RawBlockTable = {
      'minecraft:basalt': [
        { block: 'gtceu:basalt_bismuth_ore', weight: 1 },
        { block: 'gtceu:basalt_salt_ore', weight: 1 },
        { block: 'gtceu:basalt_rock_salt_ore', weight: 2 },
      ],
      'minecraft:blackstone': [{ block: 'gtceu:pyroxenite_bismuth_ore', weight: 1 }],
      'minecraft:dripstone_block': [
        { block: 'gtceu:dripstone_salt_ore', weight: 1 },
        // Longest match first: rock salt, not salt.
        { block: 'gtceu:dripstone_rock_salt_ore', weight: 2 },
      ],
    };
    expect(named(table).materials).toEqual(['bismuth', 'rock_salt', 'salt']);
    // Without the table's materials the name is kept as found, never guessed at.
    const rocks = collectRockNames([table]);
    expect(veinMaterials(table, rocks)).toContain('pyroxenite_bismuth');
  });

  it('keeps a name that ends with no known material, rather than hiding it', () => {
    const table: RawBlockTable = {
      'minecraft:basalt': [{ block: 'gtceu:basalt_bismuth_ore' }],
      'minecraft:blackstone': [{ block: 'gtceu:pyroxenite_unobtainium_ore' }],
    };
    expect(named(table).materials).toEqual(['bismuth', 'pyroxenite_unobtainium']);
  });

  it('counts a raw ore block as naming its material plainly', () => {
    const table: RawBlockTable = {
      'minecraft:deepslate': [{ block: 'gtceu:raw_alunite_block' }],
      'minecraft:dripstone_block': [{ block: 'gtceu:dripstone_alunite_ore' }],
    };
    const rocks = collectRockNames([table]);
    expect([...knownVeinMaterials([table], rocks)]).toEqual(['alunite']);
    expect(named(table).materials).toEqual(['alunite']);
  });
});

describe('what the ore filter says each vein yields', () => {
  it('gives TFC’s surface native copper a deposit share, and no rock', () => {
    const mix = TFC_1_20_PROFILE.depositMix?.['surface_native_copper'] ?? [];
    // Per host rock: poor 70, normal 25, rich 5 and the deposit 10, out of 110.
    expect(mix.map((entry) => entry.material)).toEqual([
      'poor_native_copper',
      'normal_native_copper',
      'native_copper_deposit',
      'rich_native_copper',
    ]);
    expect(mix.find((entry) => entry.material === 'native_copper_deposit')?.share).toBeCloseTo(
      10 / 110,
      9,
    );
    expect(TFC_1_20_PROFILE.depositYields?.['surface_native_copper']).toEqual([
      'native_copper_deposit',
      'normal_native_copper',
      'poor_native_copper',
      'rich_native_copper',
    ]);
    expect(TFC_1_20_PROFILE.depositYields?.['surface_cassiterite']).toContain(
      'cassiterite_deposit',
    );
  });

  it('never shows one of TFC’s rocks as a TFC material', () => {
    // `tfc:deposit/native_copper/andesite` used to come back as "andesite". (Not asked of
    // TerraFirmaGreg, where quartzite is a GregTech ore as well as a TFC rock.)
    const rocks = veinTableNames(RAW_VEINS_BY_PROFILE['tfc-1.20']).rocks;
    expect(rocks.has('andesite')).toBe(true);
    const offenders = filterMaterials().filter(
      (entry) => entry.profile === 'tfc-1.20' && rocks.has(entry.material),
    );
    expect(offenders).toEqual([]);
  });

  it('names TerraFirmaGreg’s sand ores without the sand they sit in', () => {
    const mix = TFG_PROFILE.depositMix?.['sand_basaltic'] ?? [];
    expect(mix.map((entry) => entry.material)).toEqual([
      'basaltic_mineral_sand',
      'glauconite_sand',
      'garnet_sand',
    ]);
    expect(mix[0]?.share).toBeCloseTo(0.5, 9);
    expect(TFG_PROFILE.depositYields?.['sand_basaltic']).toContain('basaltic_mineral_sand');
    expect(formatMaterialName('basaltic_mineral_sand')).toBe('Basaltic Mineral Sand');
    const offenders = filterMaterials().filter((entry) => /^([a-z]+_)?sand_/.test(entry.material));
    expect(offenders).toEqual([]);
  });

  it('keeps the colour that is part of a GregTech material', () => {
    expect(TFG_PROFILE.depositYields?.['normal_iron']).toEqual(['hematite', 'yellow_limonite']);
    expect(TFG_PROFILE.depositYields?.['deep_sapphire']).toEqual(
      expect.arrayContaining(['green_sapphire', 'sapphire']),
    );
    expect(TFG_PROFILE.depositYields?.['normal_amethyst']).toContain('red_garnet');
  });

  it('resolves the Beneath’s pyroxenite and dripstone ores to the material they hold', () => {
    const beneath = new Set(TFG_PROFILE.dimensionDepositOres?.nether ?? []);
    expect(beneath.size).toBeGreaterThan(20);
    const offenders = filterMaterials().filter((entry) =>
      /^(pyroxenite|dripstone)_/.test(entry.material),
    );
    expect(offenders).toEqual([]);
    expect(TFG_PROFILE.depositYields?.['beneath_bismuth']).toEqual([
      'bismuth',
      'saltpeter',
      'sulfur',
    ]);
    expect(TFG_PROFILE.depositYields?.['beneath_salt']).toEqual(['rock_salt', 'salt', 'trona']);
    // The longest material wins: vanadium magnetite, not magnetite.
    expect(TFG_PROFILE.depositYields?.['beneath_iron_magnetite']).toEqual([
      'gold',
      'magnetite',
      'vanadium_magnetite',
    ]);
    // The shares count the dripstone and blackstone hosts too, so they add up to the whole.
    const mix = TFG_PROFILE.depositMix?.['beneath_bismuth'] ?? [];
    expect(mix.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 9);
  });

  it('names Venus’s dripstone salt as salt', () => {
    const venus = TFG_PROFILE.dimensionDepositOres?.venus ?? [];
    expect(venus).toContain('venus_manual_salt');
    for (const id of venus) {
      const materials = [
        ...(TFG_PROFILE.depositYields?.[id] ?? []),
        ...(TFG_PROFILE.depositMix?.[id] ?? []).map((entry) => entry.material),
      ];
      expect([id, materials.includes('dripstone_salt')]).toEqual([id, false]);
    }
    expect(TFG_PROFILE.depositYields?.['venus_manual_salt']).toEqual([
      'lepidolite',
      'rock_salt',
      'salt',
      'spodumene',
    ]);
  });

  it('gives every port the same names, so a deposit’s `produces` agrees with the filter', () => {
    for (const set of ALL_SETS) {
      const { rocks, materials } = veinTableNames(RAW_VEINS_BY_PROFILE[set]);
      for (const vein of portVeins(set)) {
        const blocks = RAW_VEINS_BY_PROFILE[set][vein.id]?.blocks;
        expect([set, vein.id, vein.produces]).toEqual([
          set,
          vein.id,
          veinMaterials(blocks, rocks, materials),
        ]);
      }
    }
    for (const set of ['tfg-nether', 'tfg-venus'] as const) {
      const stray = portVeins(set).flatMap((vein) =>
        vein.produces.filter((material) => /^(pyroxenite|dripstone)_/.test(material)),
      );
      expect([set, stray]).toEqual([set, []]);
    }
    // And the filter lists what the vein it keys off places.
    for (const set of ALL_SETS) {
      const profile = set === 'tfc-1.20' ? TFC_1_20_PROFILE : TFG_PROFILE;
      for (const vein of portVeins(set)) {
        if (vein.produces.length === 0) continue;
        const id = veinFilterId(vein.ore);
        expect([set, id, profile.depositYields?.[id]]).toEqual([set, id, vein.produces]);
      }
    }
  });

  it('works out each table’s names once', () => {
    const table = RAW_VEINS_BY_PROFILE['tfg-nether'];
    expect(veinTableNames(table)).toBe(veinTableNames(table));
  });
});

describe('the map and the guides name materials alike', () => {
  // The guides (src/app/site/guide-data.ts) fold TFC's grades into one material and mark deposits
  // with a flag; the map keeps grades apart and calls a deposit `<mineral>_deposit`. Past those two
  // conventions, every vein of every table must come out with the same materials and shares.
  const SETS: readonly (readonly [VeinSetId, VeinProfileId])[] = [
    ['tfc', 'tfc-1.20'],
    ['tfg', 'tfg'],
    ['beneath', 'tfg-nether'],
    ['moon', 'tfg-moon'],
    ['mars', 'tfg-mars'],
    ['venus', 'tfg-venus'],
  ];

  for (const [guideSet, set] of SETS) {
    it(`${set}: same materials, same shares`, () => {
      const table = RAW_VEINS_BY_PROFILE[set];
      const { rocks, materials } = veinTableNames(table);
      const veins = guideVeins(guideSet).filter((vein) => table[vein.key]?.type !== 'kaolin_disc');
      expect(veins.length).toBeGreaterThan(0);
      for (const vein of veins) {
        const guide = new Map<string, number>();
        for (const y of vein.yields) {
          const id = y.deposit ? `${y.material}_deposit` : y.material;
          guide.set(id, (guide.get(id) ?? 0) + y.share);
        }
        const map = new Map<string, number>();
        for (const entry of veinMaterialMix(table[vein.key]?.blocks, rocks, materials)) {
          const id =
            set === 'tfc-1.20' && !entry.material.endsWith('_deposit')
              ? entry.material.replace(/^(poor|normal|rich)_/, '')
              : entry.material;
          map.set(id, (map.get(id) ?? 0) + entry.share);
        }
        expect([vein.key, [...map.keys()].sort()]).toEqual([vein.key, [...guide.keys()].sort()]);
        for (const [id, share] of guide) {
          expect([vein.key, id, Math.abs((map.get(id) ?? 0) - share) < 1e-9]).toEqual([
            vein.key,
            id,
            true,
          ]);
        }
      }
    });
  }
});

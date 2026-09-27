import { expect, it } from 'vitest';
import '../../src/worldgen/profiles';
import { getProfile, createGenerator } from '../../src/worldgen/registry';
import {
  createMapStore,
  DEFAULT_MAP_STATE,
  encodeMapStateToHash,
  decodeMapStateFromHash,
} from '../../src/app/state';
import { BIOME_IDS } from '../../src/worldgen/tfg/biome/ids';
import { en } from '../../src/ui/i18n/en';
import { clusterVeinsFor } from '../../src/worldgen/tfc-1.20/features/cluster-vein';
import { discVeinsFor } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { pipeVeinsFor } from '../../src/worldgen/tfc-1.20/features/pipe-vein';

it('registers TFG with its complete biome legend and its deposit controls', () => {
  const profile = getProfile('tfg');
  expect(Object.keys(profile.biomePalette!)).toEqual(BIOME_IDS);
  expect(BIOME_IDS.every((id) => en.biomeNames[id] !== undefined)).toBe(true);
  // Kaolin plus every cluster ore vein. This deliberately replaced the earlier kaolin-only
  // assertion when cluster veins landed (docs/PLAN.md section 10, docs/PARITY.md).
  expect(profile.depositOres?.[0]).toBe('kaolin');
  // Only the veins that place an ore get a marker. TFG's tag borrows five veins from TFC's own
  // data, and three of those -- the dikes -- place raw granite, diorite and gabbro; `gravel` and
  // `kaolin_disc` place no ore either (TFG's kaolin comes from its own KubeJS config). Their real
  // effect on the map is on the host rock, through features/dike.ts.
  const placesOre = <T extends { produces: readonly string[] }>(veins: readonly T[]): T[] =>
    veins.filter((vein) => vein.produces.length > 0);
  // The filter is one list across the whole profile, so it spans every dimension's vein table --
  // an ore that only exists on Mars is still an ore a player can ask the map for.
  const VEIN_SETS = ['tfg', 'tfg-nether', 'tfg-moon', 'tfg-mars', 'tfg-venus'] as const;
  expect(profile.depositOres).toEqual([
    'kaolin',
    ...VEIN_SETS.flatMap((set) => clusterVeinsFor(set).map((vein) => vein.id)),
    ...VEIN_SETS.flatMap((set) => placesOre(discVeinsFor(set)).map((vein) => vein.id)),
    ...VEIN_SETS.flatMap((set) => pipeVeinsFor(set).map((vein) => vein.id)),
  ]);
  // TFG ships 49 cluster and 20 disc veins. Since surface height landed, the 24 surface-relative
  // clusters and the 1 surface-relative disc are placeable, so only the `near_lava` discs -- which
  // this port still has no data to evaluate -- stay out. See docs/PARITY.md.
  expect(clusterVeinsFor('tfg').length).toBe(49);
  // 18 of TFG's own, plus `gravel` and `kaolin_disc` borrowed from TFC and not drawn.
  expect(discVeinsFor('tfg').length).toBe(20);
  expect(placesOre(discVeinsFor('tfg')).length).toBe(18);
  // The surface-relative ones carry the flag, and are what makes every `surface_*` ore reachable.
  expect(clusterVeinsFor('tfg').filter((vein) => vein.project).length).toBe(24);
  // Pipe veins carry TFG's gems (sapphire, lazurite); 7 in the table, all placeable.
  expect(pipeVeinsFor('tfg').length).toBe(7);
  expect(createGenerator('tfg', { seed: 42n, dimension: 'overworld' }).profile.id).toBe('tfg');
});

it('clears stale profile-specific filters when changing from TFC to TFG', () => {
  const store = createMapStore({
    ...DEFAULT_MAP_STATE,
    oreFilter: ['gypsum'],
    filter: { ...DEFAULT_MAP_STATE.filter, biomes: ['tfc:plateau'], rocks: ['shale'], tempMin: 18 },
  });
  store.setState({ profile: 'tfg' });
  expect(store.getState().filter.biomes).toEqual([]);
  expect(store.getState().oreFilter).toEqual([]);
  expect(store.getState().filter.tempMin).toBe(18);
  const decoded = decodeMapStateFromHash(encodeMapStateToHash(store.getState()));
  expect(decoded.profile).toBe('tfg');
});

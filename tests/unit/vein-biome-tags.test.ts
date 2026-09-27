import { describe, expect, it } from 'vitest';
import { biomeTagMembers } from '../../src/worldgen/tfc-1.20/features/biome-tags';
import { clusterVeinsFor } from '../../src/worldgen/tfc-1.20/features/cluster-vein';
import { discVeinsFor } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { pipeVeinsFor } from '../../src/worldgen/tfc-1.20/features/pipe-vein';
import tfgBiomes from '../../src/data/tfg/biomes.json';

/**
 * A vein restricted to a biome tag is placed only where that tag has members, so an unresolvable
 * tag is not a cosmetic problem: the vein disappears from the whole world, silently. That happened
 * twice — TFG's tags were never extracted (they ship in the Core jar, not the modpack repo), and
 * the cluster port kept the datapack's '#' marker in the key it looked up.
 */
describe('vein biome tags', () => {
  for (const profile of ['tfc-1.20', 'tfg'] as const) {
    const veins = [...clusterVeinsFor(profile), ...discVeinsFor(profile), ...pipeVeinsFor(profile)];

    it(`${profile}: every restricted vein resolves to a non-empty tag`, () => {
      const broken = veins
        .filter((vein) => vein.biomeTag !== null)
        .filter((vein) => (biomeTagMembers(vein.biomeTag!)?.size ?? 0) === 0)
        .map((vein) => `${vein.id} -> ${vein.biomeTag}`);
      expect(broken, broken.join(', ')).toEqual([]);
    });

    it(`${profile}: no tag key carries the datapack '#' marker`, () => {
      expect(veins.filter((vein) => vein.biomeTag?.startsWith('#')).map((v) => v.id)).toEqual([]);
    });
  }

  it('tfg: tag members name biomes the profile actually generates', () => {
    const known = new Set(Object.keys((tfgBiomes as { names: Record<string, string> }).names));
    // Only the veins TFG actually draws. `kaolin_disc`, borrowed from TFC's data, carries TFC's own
    // `tfc:kaolin_clay_spawns_in` whose members are TFC biome ids that TFG's biome source never
    // returns -- which is one more reason TFG takes its kaolin from `kaolinInBox` instead.
    const veins = [
      ...clusterVeinsFor('tfg'),
      ...discVeinsFor('tfg').filter((vein) => vein.produces.length > 0),
      ...pipeVeinsFor('tfg'),
    ].filter((vein) => vein.biomeTag !== null);
    expect(veins.length).toBeGreaterThan(0);
    for (const vein of veins) {
      const members = [...(biomeTagMembers(vein.biomeTag!) ?? [])];
      // A member the biome source can never return would narrow the vein by accident.
      expect(members.filter((id) => !known.has(id)), vein.biomeTag!).toEqual([]);
    }
  });
});

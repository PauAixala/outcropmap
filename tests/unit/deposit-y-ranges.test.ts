import { describe, expect, it } from 'vitest';
import { TFC_1_20_PROFILE } from '../../src/worldgen/tfc-1.20/index';
import { TFG_PROFILE, VEIN_SET_BY_DIMENSION } from '../../src/worldgen/tfg/index';
import { clusterVeinsFor } from '../../src/worldgen/tfc-1.20/features/cluster-vein';
import { discVeinBand, discVeinsFor } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import { pipeVeinsFor } from '../../src/worldgen/tfc-1.20/features/pipe-vein';
import { veinFilterId } from '../../src/worldgen/tfc-1.20/features/vein-materials';
import type { VeinProfileId } from '../../src/worldgen/tfc-1.20/features/vein-tables';

// The ore filter shows each vein's depth, which is what decides whether a find is a walk or a
// mineshaft. It comes from the vein tables, so it cannot drift from what the map actually places.
describe('profile deposit Y ranges', () => {
  const profiles = [
    { profile: TFC_1_20_PROFILE, sets: ['tfc-1.20'] as readonly VeinProfileId[] },
    { profile: TFG_PROFILE, sets: Object.values(VEIN_SET_BY_DIMENSION) as VeinProfileId[] },
  ];

  it('covers every ore of both profiles', () => {
    for (const { profile } of profiles) {
      const ranges = profile.depositYRanges ?? {};
      // TerraFirmaGreg's kaolin, which comes from its KubeJS config rather than a vein table, has a
      // range too now: its disc's band.
      const missing = (profile.depositOres ?? []).filter((id) => !ranges[id]);
      expect(missing, `${profile.id}: ${missing.join(', ')}`).toEqual([]);
      for (const [id, range] of Object.entries(ranges)) {
        expect(range.minY, id).toBeLessThanOrEqual(range.maxY);
      }
    }
  });

  it('unions the veins that share one filter id', () => {
    // TFG's deep veins all sit in the same band; the union must not be narrower than any member.
    expect(TFG_PROFILE.depositYRanges?.['deep_iron']).toEqual({
      minY: -50,
      maxY: 20,
      project: false,
    });
  });

  it('shows kaolin where every patch lies, Y 86 to 98, in both profiles', () => {
    // The window is Y 75 to 110, but every patch is centred on Y 92 and is 6 blocks thick either
    // side: the probe says 86 to 98 for each one, and so must the filter.
    for (const { profile } of profiles) {
      expect([profile.id, profile.depositYRanges?.['kaolin']]).toEqual([
        profile.id,
        { minY: 86, maxY: 98, project: false },
      ]);
    }
  });

  it('narrows every disc vein to its own band, measured from the surface where projected', () => {
    expect(TFG_PROFILE.depositYRanges?.['normal_copper']).toEqual({
      minY: 30,
      maxY: 50,
      project: false,
    });
    // Halite is surface-relative: its window is -45..-12 from the surface, its band -32..-24.
    expect(TFC_1_20_PROFILE.depositYRanges?.['halite']).toEqual({
      minY: -32,
      maxY: -24,
      project: true,
    });
    for (const { profile, sets } of profiles) {
      for (const set of sets) {
        for (const vein of discVeinsFor(set)) {
          const id = veinFilterId(vein.ore);
          const range = profile.depositYRanges?.[id];
          // A disc that places no ore is not listed (TerraFirmaGreg's gravel).
          if (range === undefined) continue;
          expect([set, id, range]).toEqual([
            set,
            id,
            { ...discVeinBand(vein), project: vein.project },
          ]);
        }
      }
    }
  });

  it('keeps a cluster or pipe vein’s whole window', () => {
    // TFC's surface native copper is a cluster vein: Y 40 to 130, as configured.
    expect(TFC_1_20_PROFILE.depositYRanges?.['surface_native_copper']).toEqual({
      minY: 40,
      maxY: 130,
      project: false,
    });
    let checked = 0;
    for (const { profile, sets } of profiles) {
      for (const set of sets) {
        for (const vein of [...clusterVeinsFor(set), ...pipeVeinsFor(set)]) {
          const id = veinFilterId(vein.ore);
          expect([set, id, profile.depositYRanges?.[id]]).toEqual([
            set,
            id,
            { minY: vein.minY, maxY: vein.maxY, project: 'project' in vein && vein.project },
          ]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

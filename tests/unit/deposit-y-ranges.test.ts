import { describe, expect, it } from 'vitest';
import { TFC_1_20_PROFILE } from '../../src/worldgen/tfc-1.20/index';
import { TFG_PROFILE } from '../../src/worldgen/tfg/index';

// The ore filter shows each vein's depth, which is what decides whether a find is a walk or a
// mineshaft. It comes from the vein tables, so it cannot drift from what the map actually places.
describe('profile deposit Y ranges', () => {
  it('covers every vein-backed ore of both profiles', () => {
    for (const profile of [TFC_1_20_PROFILE, TFG_PROFILE]) {
      const ranges = profile.depositYRanges ?? {};
      // `kaolin` is TFG's non-vein clay deposit: it has no vein entry, so it has no range, and the
      // row shows none rather than an invented one.
      const missing = (profile.depositOres ?? []).filter((id) => !ranges[id] && id !== 'kaolin');
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
});

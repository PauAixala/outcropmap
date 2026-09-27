import { describe, expect, it } from 'vitest';
import { bandIsAboveGround, SURFACE_MARGIN } from '@worldgen/tfc-1.20/features/vein-materials';
import { clusterVeinsFor } from '@worldgen/tfc-1.20/features';
import '@worldgen/profiles';

/**
 * A vein whose whole band is in the air places nothing: `VeinFeature#place` only replaces raw rock.
 * TerraFirmaGreg writes two such bands on purpose (`high_coal` y 90..160, `high_gypsum` y 90..140),
 * and against Pau's world they were the two worst vein types on the map — 24.6% and 35.8% of their
 * markers backed by real ore, against 83% overall. See docs/WORLDGEN-NOTES.md.
 */
describe('a vein band above the ground', () => {
  it('is dropped, with a margin for our approximate surface height', () => {
    expect(bandIsAboveGround(120, 60)).toBe(true);
    expect(bandIsAboveGround(60, 120)).toBe(false);
    expect(bandIsAboveGround(60 + SURFACE_MARGIN, 60)).toBe(false);
    expect(bandIsAboveGround(60 + SURFACE_MARGIN + 1, 60)).toBe(true);
  });

  it('keeps every vein when the profile cannot answer for its surface height', () => {
    expect(bandIsAboveGround(300, null)).toBe(false);
    expect(bandIsAboveGround(300, undefined)).toBe(false);
  });

  it('is what the two floating TFG bands need', () => {
    const byId = new Map(clusterVeinsFor('tfg').map((vein) => [vein.id, vein]));
    for (const id of ['high_coal', 'high_gypsum']) {
      const vein = byId.get(id);
      expect(vein, id).toBeDefined();
      // Absolute Y (not projected onto the surface) and starting well above sea level.
      expect(vein?.project).toBe(false);
      expect(vein?.minY).toBeGreaterThanOrEqual(90);
    }
  });
});

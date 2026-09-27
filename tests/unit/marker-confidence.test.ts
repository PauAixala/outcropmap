import { describe, expect, it } from 'vitest';
import '@worldgen/profiles';
import { markerConfidence, RELIABILITY_MIN_SAMPLE } from '@worldgen/api/types';
import { TFG_PROFILE } from '@worldgen/tfg/index';
import { DEFAULT_MAP_STATE } from '@app/state';
import verification from '@data/tfg/vein-verification.json';

/**
 * How likely one marker is to hold ore is mostly a question of depth — measured, not assumed. See
 * `markerConfidence` and docs/PARITY.md.
 */
describe('per-marker confidence', () => {
  const reliability = TFG_PROFILE.depositReliability;
  const depth = TFG_PROFILE.depositDepthReliability;

  it('ships the depth measurement with the profile', () => {
    expect(depth).toBeDefined();
    const table = (verification as { depth: Record<string, { checked: number; precision: number }> })
      .depth;
    expect(Object.keys(table).length).toBeGreaterThan(3);
    // Deep is sure, shallow is not, and above the ground is a coin toss at best.
    expect(table['64']!.precision).toBeGreaterThan(0.99);
    expect(table['0']!.precision).toBeLessThan(0.9);
    expect(table['-16']!.precision).toBeLessThan(0.5);
  });

  it('rises with depth', () => {
    const deep = markerConfidence(reliability, depth, 'deep_iron', 90);
    const shallow = markerConfidence(reliability, depth, 'deep_iron', 4);
    expect(deep).not.toBeNull();
    expect(shallow).not.toBeNull();
    expect(deep!).toBeGreaterThan(shallow!);
  });

  it('never rates a marker above its own vein type', () => {
    const vein = (verification as { veins: Record<string, { precision: number; checked: number }> })
      .veins['surface_salpeter'];
    expect(vein!.checked).toBeGreaterThan(RELIABILITY_MIN_SAMPLE);
    // Deep enough that the depth table alone would say 99.8%.
    expect(markerConfidence(reliability, depth, 'surface_salpeter', 90)).toBe(vein!.precision);
  });

  it('says nothing rather than guessing, when there is no measurement', () => {
    expect(markerConfidence(undefined, undefined, 'anything', 40)).toBeNull();
    expect(markerConfidence(reliability, depth, 'not_a_vein', null)).toBeNull();
  });

  it('the map ships the floor that measured 99.9%', () => {
    expect(DEFAULT_MAP_STATE.minMarkerAccuracy).toBe(0.9);
  });
});

import { describe, expect, it } from 'vitest';
import {
  RELIABILITY_MIN_SAMPLE,
  UNRELIABLE_PRECISION,
  veinIsUnreliable,
} from '../../src/worldgen/api/types';
import { TFG_PROFILE } from '../../src/worldgen/tfg/index';
import verification from '../../src/data/tfg/vein-verification.json';

/**
 * The map can only say a vein *should* be there. Whether the game places it is a question only a
 * generated world answers, and TerraFirmaGreg defines at least one vein its own worldgen never
 * places: `normal_tarkianite` is registered, its material has the ore flag, and it appears in none
 * of 5 400 sampled chunks of Pau's world. Markers for that kind of vein are not drawn.
 */
describe('vein reliability, measured against a real world', () => {
  it('ships the measurement with its sample sizes', () => {
    const meta = (verification as { _meta: { checked: number; real: number; seed: string } })._meta;
    expect(meta.checked).toBeGreaterThan(4000);
    expect(meta.real / meta.checked).toBeGreaterThan(0.75);
    expect(meta.seed).toBe('-6696614430994881185');
  });

  it('hides only what a big sample condemns', () => {
    const reliability = TFG_PROFILE.depositReliability;
    expect(reliability).toBeDefined();
    // Measured 4 of 154: defined by the modpack, absent from the world.
    expect(veinIsUnreliable(reliability, 'normal_tarkianite')).toBe(true);
    // Measured well above the threshold, and the ore Pau eventually found.
    expect(veinIsUnreliable(reliability, 'normal_gold')).toBe(false);
  });

  it('never hides a vein on a thin sample, or one it has no measurement for', () => {
    const thin = { checked: RELIABILITY_MIN_SAMPLE - 1, real: 0, precision: 0 };
    expect(veinIsUnreliable({ rare_vein: thin }, 'rare_vein')).toBe(false);
    expect(veinIsUnreliable({}, 'anything')).toBe(false);
    expect(veinIsUnreliable(undefined, 'anything')).toBe(false);
  });

  it('draws the line where the measurement does', () => {
    const sample = RELIABILITY_MIN_SAMPLE + 10;
    const just_under = { checked: sample, real: 1, precision: UNRELIABLE_PRECISION - 0.01 };
    const just_over = { checked: sample, real: 1, precision: UNRELIABLE_PRECISION + 0.01 };
    expect(veinIsUnreliable({ v: just_under }, 'v')).toBe(true);
    expect(veinIsUnreliable({ v: just_over }, 'v')).toBe(false);
  });

  it('every measured vein id is one the profile actually offers', () => {
    const offered = new Set(TFG_PROFILE.depositOres ?? []);
    const measured = Object.keys((verification as { veins: Record<string, unknown> }).veins);
    expect(measured.length).toBeGreaterThan(40);
    expect(measured.filter((id) => !offered.has(id))).toEqual([]);
  });
});

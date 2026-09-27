import { describe, expect, it } from 'vitest';
import {
  CLIMATE_RANGES,
  DAILY_TEMPERATURE_SWING,
  MAXIMUM_RAINFALL,
  baselineHydration,
  evaluateGrowth,
  seasonalAmplitude,
  seasonalTemperatureRange,
  whatGrowsHere,
} from '../../src/app/growth';

describe('climate range data', () => {
  it('loads the extracted ranges', () => {
    expect(CLIMATE_RANGES.length).toBeGreaterThan(30);
    expect(CLIMATE_RANGES.some((r) => r.kind === 'crop')).toBe(true);
    expect(CLIMATE_RANGES.some((r) => r.kind === 'plant')).toBe(true);
  });

  it('every range is well formed', () => {
    for (const range of CLIMATE_RANGES) {
      expect(range.minTemperature).toBeLessThanOrEqual(range.maxTemperature);
      expect(range.minHydration).toBeLessThanOrEqual(range.maxHydration);
      expect(range.hydrationWiggle).toBeGreaterThanOrEqual(0);
      expect(range.temperatureWiggle).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('baselineHydration', () => {
  it('is (int)(60 * rainfall / 500), truncated toward zero as Java does', () => {
    // 60 * 187 / 500 = 22.44 -> 22, not 23.
    expect(baselineHydration(187)).toBe(22);
    expect(baselineHydration(0)).toBe(0);
    expect(baselineHydration(MAXIMUM_RAINFALL)).toBe(60);
  });

  it('clamps rather than exceeding 100 or going negative', () => {
    expect(baselineHydration(10_000)).toBe(100);
    expect(baselineHydration(-50)).toBe(0);
  });

  it('never reaches 100 from rainfall alone', () => {
    // The remaining 40 points can only come from water proximity, which is the player's choice --
    // this is why the UI reports a floor rather than a value.
    expect(baselineHydration(MAXIMUM_RAINFALL)).toBeLessThan(100);
  });
});

describe('seasonal temperature', () => {
  it('swings between 12 and 18 degrees either side of the average', () => {
    // Helpers.triangle(-3f, 15f, ...) is amplitude 3 about a midpoint of 15.
    for (const z of [0, 137, -4096, 12_000, 987_654]) {
      const amplitude = seasonalAmplitude(z, 20_000);
      expect(amplitude).toBeGreaterThanOrEqual(12);
      expect(amplitude).toBeLessThanOrEqual(18);
    }
  });

  it('is flat when the temperature scale is zero', () => {
    // `calculateMonthlyTemperature` short-circuits to 0, so there is no seasonal variation at all.
    expect(seasonalAmplitude(1234, 0)).toBe(0);
    expect(seasonalTemperatureRange(10, 1234, 0)).toEqual({ min: 10, max: 10 });
  });

  it('brackets the average symmetrically', () => {
    const range = seasonalTemperatureRange(12, 320, 20_000);
    expect(range.min).toBeLessThan(12);
    expect(range.max).toBeGreaterThan(12);
    expect(range.max - 12).toBeCloseTo(12 - range.min, 10);
  });

  it('reports daily variation separately from the seasonal band', () => {
    // Weather, not climate -- kept out of the band on purpose.
    expect(DAILY_TEMPERATURE_SWING).toBeGreaterThan(0);
  });
});

describe('evaluateGrowth', () => {
  const range = {
    kind: 'crop',
    id: 'test',
    minHydration: 20,
    maxHydration: 80,
    hydrationWiggle: 0,
    minTemperature: 0,
    maxTemperature: 30,
    temperatureWiggle: 5,
  } as const;

  it('is year-round when the whole season sits inside the band', () => {
    expect(evaluateGrowth(range, { min: 5, max: 25 }, 300).status).toBe('year-round');
  });

  it('is seasonal when only part of the year is in range', () => {
    expect(evaluateGrowth(range, { min: -10, max: 20 }, 300).status).toBe('seasonal');
  });

  it('is marginal when only the wiggle allowance covers it', () => {
    // Season sits just below the band but within the 5-degree survival wiggle.
    expect(evaluateGrowth(range, { min: -8, max: -2 }, 300).status).toBe('marginal');
  });

  it('is never when the season misses the band entirely', () => {
    expect(evaluateGrowth(range, { min: -40, max: -20 }, 300).status).toBe('never');
  });

  it('fails a location already wetter than the plant tolerates', () => {
    // Irrigation raises hydration and nothing lowers it, so too-wet is the one hard no. Reaching it
    // needs a plant drier than anything TFC ships -- see the invariant test below.
    const dryLover = { ...range, maxHydration: 10, hydrationWiggle: 0 };
    const result = evaluateGrowth(dryLover, { min: 5, max: 25 }, MAXIMUM_RAINFALL);
    expect(result.tooWet).toBe(true);
    expect(result.status).toBe('never');
  });

  it('no shipped plant can be ruled out by rainfall alone', () => {
    // Rainfall contributes at most 60 hydration and every TFC range tolerates at least 60, so the
    // wet exclusion never fires on real data. Asserted rather than assumed: if either the formula
    // or the data changes, this is where it shows up.
    const wettest = baselineHydration(MAXIMUM_RAINFALL);
    for (const r of CLIMATE_RANGES) {
      expect(wettest).toBeLessThanOrEqual(r.maxHydration + r.hydrationWiggle);
    }
  });

  it('flags when rainfall alone is not enough but water would fix it', () => {
    const dry = evaluateGrowth(range, { min: 5, max: 25 }, 50);
    expect(dry.hydrationFromRainfallAlone).toBe(false);
    expect(dry.tooWet).toBe(false);
    // Still growable: the player can dig a channel.
    expect(dry.status).toBe('year-round');
  });
});

describe('whatGrowsHere', () => {
  it('drops what cannot grow and puts the best first', () => {
    const results = whatGrowsHere(12, 187, 320, 20_000);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.status !== 'never')).toBe(true);
    const rank = { 'year-round': 0, seasonal: 1, marginal: 2, never: 3 } as const;
    for (let i = 1; i < results.length; i++) {
      expect(rank[results[i]!.status]).toBeGreaterThanOrEqual(rank[results[i - 1]!.status]);
    }
  });

  it('offers strictly less in a cold place than a temperate one', () => {
    const temperate = whatGrowsHere(12, 187, 320, 20_000);
    const cold = whatGrowsHere(-4, 90, 12_000, 20_000);
    expect(cold.length).toBeLessThan(temperate.length);
    const yearRound = (rs: readonly { status: string }[]): number =>
      rs.filter((r) => r.status === 'year-round').length;
    expect(yearRound(cold)).toBeLessThan(yearRound(temperate));
  });
});

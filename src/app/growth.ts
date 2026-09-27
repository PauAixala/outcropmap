/**
 * "What grows here" and the seasonal temperature range (docs/PLAN.md section 13).
 *
 * Pure data and arithmetic — no DOM, no canvas — so it runs unchanged in a Node test.
 *
 * This answers the question a player actually has when picking a base, and it is the reason the
 * annual average alone is not enough: TerraFirmaCraft checks a crop against the temperature *at the
 * time*, which swings by up to ±18 °C over the year. A place whose average suits barley perfectly
 * can still be too cold to plant it for half the year.
 *
 * ## What is exact and what is not
 *
 * **Temperature — exact.** At sea level the game computes
 * `average + monthFactor * L(z) + dailyVariation` (`OverworldClimateModel.getTemperature` via
 * `adjustTemperatureByElevation`), where `monthFactor` runs from −1 in January to +1 in July
 * (`Month`) and `L(z)` is the latitude band below. Both ends of the seasonal swing are therefore
 * computable from the average temperature this project already verifies against real Java.
 *
 * **Hydration — a floor, not a value.** `FarmlandBlock.getHydration` is
 * `clamp((int)(60 * rainfall / 500) + 20 * (5 - waterCost), 0, 100)`, where `waterCost` is the
 * distance to nearby water (0 adjacent, 5 none in range). Only the rainfall half is a property of
 * the location; the rest is up to where the player digs. So this reports the **baseline** hydration
 * with no water nearby, and notes that placing water raises it to 100. Presenting a single hydration
 * number as if the map knew it would be wrong (AGENTS.md section 2).
 *
 * A consequence worth knowing: rainfall contributes **at most 60** hydration
 * (`60 * 500 / 500`), and every range TFC ships tolerates at least 60, so no location is ever too
 * wet for a plant on rainfall alone. Dryness is always fixable by digging; wetness never arises.
 * The `tooWet` branch below is therefore unreachable with the shipped data and is kept only so a
 * modpack that adds a drier plant behaves correctly — `tests/unit/growth.test.ts` asserts the
 * invariant so a change to either side is caught.
 *
 * **Elevation is ignored**, deliberately: above sea level the game subtracts up to 17.8 °C
 * (`0.16225 °C` per block), and this estimate does not read surface height. Everything here is
 * therefore a sea-level figure, and the UI must say so. Subtracting the real elevation term would
 * need the surface height the profiles now provide.
 */
import climateRanges from '@data/tfc-1.20/climate-ranges.json';

/** `ClimateModel.MAXIMUM_RAINFALL`. */
export const MAXIMUM_RAINFALL = 500;

/** `OverworldClimateModel.calculateDailyTemperature`'s stated range, for the caveat text. */
export const DAILY_TEMPERATURE_SWING = 3.9;

export interface ClimateRange {
  readonly kind: 'crop' | 'plant';
  readonly id: string;
  readonly minHydration: number;
  readonly maxHydration: number;
  readonly hydrationWiggle: number;
  readonly minTemperature: number;
  readonly maxTemperature: number;
  readonly temperatureWiggle: number;
}

interface RawRange {
  readonly kind: string;
  readonly id: string;
  readonly min_hydration: number;
  readonly max_hydration: number;
  readonly hydration_wiggle_range: number;
  readonly min_temperature: number;
  readonly max_temperature: number;
  readonly temperature_wiggle_range: number;
}

export const CLIMATE_RANGES: readonly ClimateRange[] = Object.values(
  (climateRanges as unknown as { ranges: Readonly<Record<string, RawRange>> }).ranges,
).map((raw) => ({
  kind: raw.kind === 'plant' ? 'plant' : 'crop',
  id: raw.id,
  minHydration: raw.min_hydration,
  maxHydration: raw.max_hydration,
  hydrationWiggle: raw.hydration_wiggle_range,
  minTemperature: raw.min_temperature,
  maxTemperature: raw.max_temperature,
  temperatureWiggle: raw.temperature_wiggle_range,
}));

/** `RegionGenerator.triangle(double, double)`, reused for the latitude band. */
function triangle(frequency: number, value: number): number {
  return Math.abs(4 * frequency * value + 1 - 4 * Math.floor(frequency * value + 0.75)) - 1;
}

/**
 * `OverworldClimateModel.calculateMonthlyTemperature`'s latitude term, i.e. how large the seasonal
 * swing is at this Z. `Helpers.triangle(-3f, 15f, 1f / (2f * temperatureScale), z)` — amplitude 3
 * about a midpoint of 15, so the swing is between 12 °C and 18 °C either side of the average.
 *
 * A `temperatureScale` of zero means the game applies no monthly variation at all.
 */
export function seasonalAmplitude(z: number, temperatureScale: number): number {
  if (temperatureScale === 0) return 0;
  const frequency = Math.fround(1 / Math.fround(2 * temperatureScale));
  return 15 + -3 * triangle(frequency, z);
}

export interface SeasonalRange {
  /** Coldest monthly average, i.e. January. */
  readonly min: number;
  /** Warmest monthly average, i.e. July. */
  readonly max: number;
}

/**
 * The January-to-July swing at sea level. `monthFactor` is −1 in January and +1 in July
 * (`Month.getTemperatureModifier`), so these are the extremes of the monthly term.
 *
 * Daily variation (±3.9 °C) sits on top of this and is reported separately rather than widened into
 * the band — it is weather, not climate, and a player planning a base wants the seasonal figure.
 */
export function seasonalTemperatureRange(
  averageTemperature: number,
  z: number,
  temperatureScale: number,
): SeasonalRange {
  const amplitude = seasonalAmplitude(z, temperatureScale);
  return { min: averageTemperature - amplitude, max: averageTemperature + amplitude };
}

/**
 * Baseline hydration from rainfall alone, with no water within reach —
 * `(int)(60 * rainfall / MAXIMUM_RAINFALL)`, clamped. Java truncates toward zero.
 */
export function baselineHydration(rainfall: number): number {
  const value = Math.trunc((60 * rainfall) / MAXIMUM_RAINFALL);
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

export type GrowthStatus =
  /** The whole year sits inside the plant's temperature band. */
  | 'year-round'
  /** Part of the year sits inside it — plantable in season. */
  | 'seasonal'
  /** Only inside the band once the wiggle allowance is applied: it survives, it does not thrive. */
  | 'marginal'
  /** Never in range at this location. */
  | 'never';

export interface GrowthResult {
  readonly range: ClimateRange;
  readonly status: GrowthStatus;
  /** True when rainfall alone satisfies the hydration band. */
  readonly hydrationFromRainfallAlone: boolean;
  /** True when the plant needs *less* water than this location provides — irrigation cannot help. */
  readonly tooWet: boolean;
}

/** Whether two inclusive bands overlap at all. */
function overlaps(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax && bMin <= aMax;
}

/**
 * Crosses one climate range with a location's seasonal temperature band and rainfall.
 *
 * Hydration is judged against the achievable interval `[baseline, 100]`: the player can always add
 * water, so a location fails on hydration only when it is already **wetter** than the plant's
 * maximum, which no amount of digging fixes.
 */
export function evaluateGrowth(
  range: ClimateRange,
  season: SeasonalRange,
  rainfall: number,
): GrowthResult {
  const baseline = baselineHydration(rainfall);
  const tooWet = baseline > range.maxHydration + range.hydrationWiggle;
  const hydrationFromRainfallAlone =
    baseline >= range.minHydration && baseline <= range.maxHydration;

  let status: GrowthStatus;
  if (tooWet) {
    status = 'never';
  } else if (season.min >= range.minTemperature && season.max <= range.maxTemperature) {
    status = 'year-round';
  } else if (overlaps(season.min, season.max, range.minTemperature, range.maxTemperature)) {
    status = 'seasonal';
  } else if (
    overlaps(
      season.min,
      season.max,
      range.minTemperature - range.temperatureWiggle,
      range.maxTemperature + range.temperatureWiggle,
    )
  ) {
    status = 'marginal';
  } else {
    status = 'never';
  }

  return { range, status, hydrationFromRainfallAlone, tooWet };
}

/**
 * Every crop and plant that can grow at a location, best first.
 *
 * `never` results are dropped: a list of the 30 things that will not grow is noise, and the ones
 * that will are the answer to the question.
 */
export function whatGrowsHere(
  averageTemperature: number,
  rainfall: number,
  z: number,
  temperatureScale: number,
): readonly GrowthResult[] {
  const season = seasonalTemperatureRange(averageTemperature, z, temperatureScale);
  const order: Record<GrowthStatus, number> = {
    'year-round': 0,
    seasonal: 1,
    marginal: 2,
    never: 3,
  };
  return CLIMATE_RANGES.map((range) => evaluateGrowth(range, season, rainfall))
    .filter((result) => result.status !== 'never')
    .sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        a.range.kind.localeCompare(b.range.kind) ||
        a.range.id.localeCompare(b.range.id),
    );
}

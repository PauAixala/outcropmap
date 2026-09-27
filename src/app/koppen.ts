/**
 * Köppen climate classification (docs/PLAN.md section 13).
 *
 * Port of `net.dries007.tfc.util.climate.KoppenClimateClassification.classify` (TFC 1.20.x).
 *
 * Pure arithmetic on two numbers the map already knows, so it runs unchanged in a Node test.
 *
 * TFC's own comment calls this "purely used for decoration" and "quite simplified from the actual
 * classification" — it has no monthly rainfall variance to work with, only the annual average, which
 * is exactly what this project has too. So this is not the real Köppen system and must not be
 * presented as one: it is the label the *game* would give this spot, which is the useful thing when
 * comparing what you see here against what you see in game.
 *
 * The Java takes `float` arguments but only ever compares them against small integer constants, so
 * there is no float/double divergence to reproduce — every threshold is exactly representable and
 * the comparisons land the same way in both languages. No `Math.fround` needed.
 *
 * The branch order matters and is preserved verbatim: the rainfall < 150 desert test comes *before*
 * the cold tests, so a dry −18 °C spot is a COLD_DESERT rather than TUNDRA. Reordering these reads
 * as tidier and gives different answers.
 */

/** The twelve classes, in the enum's own declaration order. */
export const KOPPEN_CLASSES = [
  'arctic',
  'tundra',
  'subarctic',
  'cold-desert',
  'hot-desert',
  'temperate',
  'subtropical',
  'humid-subtropical',
  'humid-oceanic',
  'humid-subarctic',
  'tropical-savanna',
  'tropical-rainforest',
] as const;

export type KoppenClass = (typeof KOPPEN_CLASSES)[number];

/**
 * `KoppenClimateClassification.classify(float averageTemperature, float rainfall)`.
 *
 * @param averageTemperature Annual average temperature in °C, as the climate layer reports it.
 * @param rainfall Annual rainfall in mm, 0..500.
 */
export function classifyKoppen(averageTemperature: number, rainfall: number): KoppenClass {
  if (averageTemperature < -20) {
    return 'arctic';
  } else if (rainfall < 150) {
    return averageTemperature > 4 ? 'hot-desert' : 'cold-desert';
  } else if (averageTemperature < -14) {
    return rainfall > 300 ? 'subarctic' : 'tundra';
  } else if (averageTemperature > 18) {
    return rainfall > 300 ? 'tropical-rainforest' : 'tropical-savanna';
  } else if (rainfall > 350) {
    if (averageTemperature > 12) return 'humid-subtropical';
    if (averageTemperature > -5) return 'humid-oceanic';
    return 'humid-subarctic';
  } else {
    if (averageTemperature > 12) return 'subtropical';
    if (averageTemperature > -5) return 'temperate';
    return 'subarctic';
  }
}

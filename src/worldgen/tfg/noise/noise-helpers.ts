/**
 * Port of `su.terrafirmagreg.core.world.new_ow_wg.noise.TFGNoiseHelpers` (TFG Core Modern 0.9.21).
 *
 * Free functions over `Noise2D`, rather than methods on it — TFG keeps them separate from the
 * chained combinators because most take more than one field. Transcribed with the same argument
 * order as the Java so call sites read the same.
 *
 * @unverified No JVM fixture. See docs/PARITY.md.
 */
import { clamp, type Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';

/**
 * `clampedScaled(noise, oldMin, oldMax, min, max)`: rescale from one range to another, then clamp
 * to the target.
 *
 * The **source** range comes first, as in `Noise2D.scaled`'s four-argument overload. Note this is
 * not the same as `scaled(...).clamped(...)` in general: the clamp here is always to `[min, max]`,
 * whatever the caller asked for.
 */
export function clampedScaled(
  noise: Noise2D,
  oldMin: number,
  oldMax: number,
  min: number,
  max: number,
): Noise2D {
  const scale = (max - min) / (oldMax - oldMin);
  const shift = min - oldMin * scale;
  return (x, z) => clamp(noise(x, z) * scale + shift, min, max);
}

/** `TFGNoiseHelpers.max`. */
export function maxOf(noise: Noise2D, other: Noise2D): Noise2D {
  return (x, z) => Math.max(noise(x, z), other(x, z));
}

/** `TFGNoiseHelpers.min`. */
export function minOf(noise: Noise2D, other: Noise2D): Noise2D {
  return (x, z) => Math.min(noise(x, z), other(x, z));
}

/**
 * `TFGNoiseHelpers.slopedCliffMap`: adds a cliff of `addendNoise` height wherever the base rises
 * above `compareNoise`, ramped in by `slopeNoise` so the cliff foot is a slope rather than a step.
 *
 * The three-way branch is the whole shape of a stepped mesa and is transcribed exactly.
 */
export function slopedCliffMap(
  thisNoise: Noise2D,
  compareNoise: Noise2D,
  addendNoise: Noise2D,
  slopeNoise: Noise2D,
): Noise2D {
  return (x, z) => {
    const noise = thisNoise(x, z);
    const compare = compareNoise(x, z);
    const addend = addendNoise(x, z);
    const slope = slopeNoise(x, z);
    // Well above the cliff: the full cliff height.
    if (noise > compare + addend) return noise + addend;
    // On the ramp: as much of the cliff as the slope has reached.
    if (noise > compare) return noise + Math.min((noise - compare) * slope, addend);
    return noise;
  };
}

/** `TFGNoiseHelpers.cliffMap`: the unramped version — a hard step at `compare`. */
export function cliffMap(thisNoise: Noise2D, compare: Noise2D, addend: Noise2D): Noise2D {
  return (x, z) => {
    const noise = thisNoise(x, z);
    return noise > compare(x, z) ? noise + addend(x, z) : noise;
  };
}

/** `TFGNoiseHelpers.stretchZ`: stretches the field along Z by dividing the input coordinate. */
export function stretchZ(noise: Noise2D, stretch: number): Noise2D {
  return (x, z) => noise(x, z / stretch);
}

/** `TFGNoiseHelpers.stretchX`. */
export function stretchX(noise: Noise2D, stretch: number): Noise2D {
  return (x, z) => noise(x / stretch, z);
}

/** `TFGNoiseHelpers.addConstant`. */
export function addConstant(noise: Noise2D, constant: number): Noise2D {
  return (x, z) => noise(x, z) + constant;
}

/**
 * `TFGNoiseHelpers.triangle`: a triangle wave of `amplitude` about `midpoint`.
 *
 * `Mth.floor` is a true floor (toward negative infinity), which `Math.floor` matches — unlike the
 * integer truncation that trips this project up elsewhere.
 */
export function triangle(
  amplitude: number,
  midpoint: number,
  frequency: number,
  value: number,
): number {
  return (
    midpoint +
    amplitude *
      (Math.abs(4.0 * frequency * value + 1.0 - 4.0 * Math.floor(frequency * value + 0.75)) - 1.0)
  );
}

/**
 * `TFGNoiseHelpers.diamondAngle`: an approximate angle in `[0, 4]`, where 4 is a full turn.
 *
 * Cheaper than `atan2` and monotonic in the same direction, which is all TFG needs it for.
 */
export function diamondAngle(x: number, y: number): number {
  if (y >= 0) return x >= 0 ? y / (x + y) : 1 - x / (-x + y);
  return x < 0 ? 2 - y / (-x - y) : 3 + x / (x - y);
}

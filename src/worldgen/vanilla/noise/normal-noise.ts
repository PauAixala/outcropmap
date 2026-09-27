/**
 * Vanilla's `PerlinNoise` and `NormalNoise` — the noise every datapack `minecraft:noise` reference
 * resolves to.
 *
 * `src/core/noise/octave-noise.ts` deliberately stopped short of this: its header says a byte-exact
 * port "without the real configuration to check it against" would be the plausible-but-unverified
 * result the review gate exists to catch. The configuration now exists — TerraFirmaGreg ships the
 * `firstOctave`/`amplitudes` for every noise it uses — and so does something better than a fixture:
 * a real Beneath in Pau's save, whose biomes are the output of this noise run through a multi-noise
 * source. `tests/parity/beneath-biome.parity.test.ts` checks against those.
 *
 * ```java
 * // PerlinNoise
 * final PositionalRandomFactory factory = random.forkPositional();
 * for (int k = 0; k < amplitudes.size(); ++k)
 *     if (amplitudes.getDouble(k) != 0.0)
 *         noiseLevels[k] = new ImprovedNoise(factory.fromHashOf("octave_" + (firstOctave + k)));
 * lowestFreqInputFactor = Math.pow(2.0, -j);   // j = -firstOctave, so this is 2^firstOctave
 * lowestFreqValueFactor = Math.pow(2.0, amplitudes.size() - 1) / (Math.pow(2.0, amplitudes.size()) - 1.0);
 *
 * // NormalNoise
 * first = PerlinNoise.create(random, firstOctave, amplitudes);
 * second = PerlinNoise.create(random, firstOctave, amplitudes);   // a second, independent stack
 * valueFactor = (1.0 / 6.0) / (0.1 * (1.0 + 1.0 / (maxOctave - minOctave + 1)));
 * getValue(x, y, z) = (first.getValue(x, y, z)
 *                    + second.getValue(x * 1.0181268882175227, y * …, z * …)) * valueFactor;
 * ```
 *
 * Two details that are easy to lose and impossible to notice afterwards: an amplitude of zero means
 * **no noise object is constructed at all** for that octave — which also means it draws nothing, so
 * the octave numbering, not the array index, is what seeds each layer; and `wrap` folds coordinates
 * back into a range around the origin, so a position far from spawn does not lose precision.
 */
import { ImprovedNoise } from '@core/noise/improved-noise';
import type { ForkableRandomSource } from '@core/random';

/** `NoiseParameters`: the shape a `worldgen/noise/*.json` file carries. */
export interface NoiseParameters {
  readonly firstOctave: number;
  readonly amplitudes: readonly number[];
}

/** `PerlinNoise.wrap`: keeps coordinates near the origin so the lattice stays precise. */
function wrap(value: number): number {
  return value - Math.floor(value / 3.3554432e7 + 0.5) * 3.3554432e7;
}

/** `net.minecraft.world.level.levelgen.synth.PerlinNoise`. */
export class PerlinNoise {
  private readonly levels: (ImprovedNoise | null)[] = [];
  private readonly amplitudes: readonly number[];
  private readonly lowestFreqInputFactor: number;
  private readonly lowestFreqValueFactor: number;

  constructor(random: ForkableRandomSource, firstOctave: number, amplitudes: readonly number[]) {
    this.amplitudes = amplitudes;
    const factory = random.forkPositional();
    for (let i = 0; i < amplitudes.length; i++) {
      // A zero amplitude constructs nothing, and therefore consumes nothing.
      this.levels.push(
        amplitudes[i] === 0 ? null : new ImprovedNoise(factory.fromHashOf(`octave_${firstOctave + i}`)),
      );
    }
    // `Math.pow(2.0, -j)` in Java, where `j` is itself `-firstOctave` — so the sign cancels and the
    // factor is 2^firstOctave. Reading the Java literally and porting `2^-firstOctave` puts a
    // firstOctave of -9 eighteen octaves off, and the field still *looks* right: same amplitude
    // distribution, same shape, no correlation with the real world at all.
    this.lowestFreqInputFactor = Math.pow(2, firstOctave);
    this.lowestFreqValueFactor =
      Math.pow(2, amplitudes.length - 1) / (Math.pow(2, amplitudes.length) - 1);
  }

  getValue(x: number, y: number, z: number): number {
    let total = 0;
    let inputFactor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      if (level != null) {
        total +=
          (this.amplitudes[i] ?? 0) *
          level.sample(wrap(x * inputFactor), wrap(y * inputFactor), wrap(z * inputFactor)) *
          valueFactor;
      }
      inputFactor *= 2;
      valueFactor /= 2;
    }
    return total;
  }
}

/** `NormalNoise.INPUT_FACTOR` — the second stack is sampled at a slightly different scale. */
const INPUT_FACTOR = 1.0181268882175227;

/** `net.minecraft.world.level.levelgen.synth.NormalNoise`. */
export class NormalNoise {
  private readonly first: PerlinNoise;
  private readonly second: PerlinNoise;
  private readonly valueFactor: number;

  constructor(random: ForkableRandomSource, params: NoiseParameters) {
    const { firstOctave, amplitudes } = params;
    this.first = new PerlinNoise(random, firstOctave, amplitudes);
    this.second = new PerlinNoise(random, firstOctave, amplitudes);

    // The spread depends on how many octaves actually carry an amplitude, not on how many are listed.
    let min = Number.MAX_SAFE_INTEGER;
    let max = Number.MIN_SAFE_INTEGER;
    amplitudes.forEach((amplitude, index) => {
      if (amplitude !== 0) {
        min = Math.min(min, index);
        max = Math.max(max, index);
      }
    });
    const expectedDeviation = 0.1 * (1 + 1 / (max - min + 1));
    this.valueFactor = 1 / 6 / expectedDeviation;
  }

  getValue(x: number, y: number, z: number): number {
    return (
      (this.first.getValue(x, y, z) +
        this.second.getValue(x * INPUT_FACTOR, y * INPUT_FACTOR, z * INPUT_FACTOR)) *
      this.valueFactor
    );
  }
}

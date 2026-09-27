/**
 * `net.dries007.tfc.world.noise.OpenSimplex2D`: a small stateful, chainable wrapper TFC uses to
 * configure a `FastNoiseLite` instance for `NoiseType.OpenSimplex2S`. Ported field-for-field
 * because its methods *mutate and return `this`* rather than composing immutably like the generic
 * `Noise2D` default methods — `RegionGenerator` relies on the exact order calls are chained in
 * (e.g. `.spread(0.24f)` then `.octaves(4)` compounds frequency multiplicatively in that order),
 * so this class must mutate the same way, not recompute frequency from scratch.
 */
import { longSeedToInt32Signed, openSimplex2SNoise } from './fast-noise-lite';
import { domainWarpIndependent, type WarpCursor } from './domain-warp';

export class OpenSimplex2D {
  private readonly seed: number;
  private frequency = 1;
  private midpoint = 0;
  private amplitude = 1;
  private octaveCount = 1;

  /** `new OpenSimplex2D(long seed)` folds to int via `(int)(seed ^ (seed >> 32))`; `new
   * OpenSimplex2D(int seed)` uses the int directly — mirror both by accepting either. */
  constructor(seed: bigint | number) {
    this.seed = typeof seed === 'bigint' ? longSeedToInt32Signed(seed) : seed | 0;
  }

  /** `OpenSimplex2D.spread(double scaleFactor)`. */
  spread(scaleFactor: number): this {
    this.frequency *= scaleFactor;
    return this;
  }

  /** `OpenSimplex2D.scaled(double min, double max)` (the 2-arg overload TFC always calls). */
  scaled(min: number, max: number): this {
    this.midpoint = (max + min) / 2;
    this.amplitude = (max - min) / 2;
    return this;
  }

  /** `OpenSimplex2D.octaves(int octaves)`: sets fractal FBm mode and folds in the legacy scale
   * factor `1 / 2^(octaves - 1)` — this multiplies whatever frequency `spread`/the constructor
   * already set, it does not replace it. */
  octaves(octaves: number): this {
    this.octaveCount = octaves;
    this.frequency *= 1 / (1 << (octaves - 1));
    return this;
  }

  /** `OpenSimplex2D.noise(double x, double z)`. */
  noise(x: number, z: number): number {
    return this.midpoint + openSimplex2SNoise(this.seed, this.frequency, this.octaveCount, x, z) * this.amplitude;
  }

  /** As a plain `Noise2D`, for the combinators in `noise2d.ts`. */
  asNoise(): (x: number, z: number) => number {
    return (x, z) => this.noise(x, z);
  }

  /**
   * Displaces `cursor` in place, the way `Noise2D.warped` uses this instance as a warp source.
   *
   * `warped()` sets `DomainWarpAmp` to `getAmplitude() * 2` and the fractal type to
   * `DomainWarpIndependent` before calling `DomainWarp`, so those are applied here rather than
   * being configurable — no other combination is used in TFC.
   */
  warpCursor(cursor: WarpCursor): void {
    domainWarpIndependent(cursor, this.seed, this.amplitude * 2, this.frequency, this.octaveCount);
  }
}

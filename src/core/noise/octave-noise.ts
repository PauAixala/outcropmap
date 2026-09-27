/**
 * Generic multi-octave Perlin summation (persistence/lacunarity layering) built on
 * {@link ImprovedNoise}.
 *
 * This is deliberately **not** a port of vanilla's
 * `net.minecraft.world.level.levelgen.synth.PerlinNoise` — that class's specific octave range,
 * amplitude table, and per-octave seeding (through a `PositionalRandomFactory` keyed by a noise
 * parameter name, e.g. `"minecraft:temperature"`) is worldgen *configuration*, not a fixed
 * algorithm, and TFC's actual octave/amplitude choices are still unconfirmed
 * (docs/WORLDGEN-NOTES.md). Building a byte-exact `PerlinNoise` port now, without the real
 * configuration to check it against, would be exactly the kind of "plausible algorithm, no fixture"
 * result AGENTS.md's review gate exists to catch.
 *
 * What lives here instead is the reusable octave-summation shape — construct N `ImprovedNoise`
 * layers from one `RandomSource` (the same source vanilla draws each octave from) and blend them by
 * lacunarity/persistence. Phase 3/4 wires this to the real TFC noise parameters once they're known.
 *
 * @unverified No parity fixture — this is a generic utility, not a fixed algorithm with one
 * "correct" output to check. Do not use for anything presented as matching vanilla output until a
 * concrete instantiation is checked against real climate/terrain samples.
 */

import type { RandomSource } from '@core/random';
import { ImprovedNoise } from './improved-noise';
import type { Noise3D } from './types';

export interface OctaveNoiseOptions {
  /** Number of `ImprovedNoise` layers to sum. */
  octaves: number;
  /** Per-octave frequency multiplier. Vanilla's octave noise generally uses 2. */
  lacunarity?: number;
  /** Per-octave amplitude multiplier. Vanilla's octave noise generally uses 0.5. */
  persistence?: number;
}

export class OctaveNoise implements Noise3D {
  private readonly layers: readonly ImprovedNoise[];
  private readonly lacunarity: number;
  private readonly persistence: number;

  constructor(random: RandomSource, options: OctaveNoiseOptions) {
    const { octaves, lacunarity = 2, persistence = 0.5 } = options;
    if (!Number.isInteger(octaves) || octaves <= 0) {
      throw new RangeError('octaves must be a positive integer');
    }
    this.lacunarity = lacunarity;
    this.persistence = persistence;
    const layers: ImprovedNoise[] = [];
    for (let i = 0; i < octaves; i++) {
      layers.push(new ImprovedNoise(random));
    }
    this.layers = layers;
  }

  /** Sum of all octaves, normalised by total amplitude so the result stays within roughly [-1, 1]. */
  sample(x: number, y: number, z: number): number {
    let sum = 0;
    let frequency = 1;
    let amplitude = 1;
    let amplitudeSum = 0;
    for (const layer of this.layers) {
      sum += layer.sample(x * frequency, y * frequency, z * frequency) * amplitude;
      amplitudeSum += amplitude;
      frequency *= this.lacunarity;
      amplitude *= this.persistence;
    }
    return amplitudeSum === 0 ? 0 : sum / amplitudeSum;
  }
}

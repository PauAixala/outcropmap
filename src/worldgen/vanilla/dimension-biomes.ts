/**
 * A `minecraft:noise` dimension's biome lookup, built from what
 * `tools/extract-dimension-climate.mjs` pulled out of the pack.
 *
 * Three pieces meet here: `RandomState`, which decides how each noise is seeded from the world
 * seed; the router, six density functions compiled by `density.ts`; and `Climate.Sampler`, which
 * quantizes their output and asks `climate.ts` for the nearest biome.
 *
 * The seeding is the part that repays care. `NoiseGeneratorSettings#getRandomSource` picks between
 * Xoroshiro and the pre-1.18 legacy source on a single datapack flag, and TerraFirmaGreg's Beneath
 * sets it — so the Beneath and the four planets do not share a code path here even though they
 * share every other one. On the legacy path `RandomState` also special-cases three noises, of which
 * only `minecraft:offset` matters to a climate lookup: it becomes a zero-amplitude noise, which is
 * to say the coordinate shift the other dimensions apply is simply absent in the Nether.
 *
 * @unverified until `tests/parity/beneath-biome.parity.test.ts` runs against a real save; the legacy
 * branch above is reconstructed from behaviour, not read off the class.
 */
import { JavaRandom } from '@core/random/java-random';
import { XoroshiroRandomSource, type ForkableRandomSource } from '@core/random';
import { compile, type DensityFunction } from './density';
import { ClimateSearch, quantizeCoord, type ClimateEntry, type ClimateTarget } from './climate';
import { NormalNoise, type NoiseParameters } from './noise/normal-noise';

/** The six router entries, in the order `ClimateTarget` wants them. */
const ROUTER_KEYS = ['temperature', 'vegetation', 'continents', 'erosion', 'depth', 'ridges'] as const;

export interface DimensionClimateData {
  readonly id: string;
  readonly seaLevel: number;
  readonly minY: number;
  readonly height: number;
  readonly legacyRandomSource: boolean;
  readonly router: Readonly<Record<(typeof ROUTER_KEYS)[number], unknown>>;
  readonly noises: Readonly<Record<string, NoiseParameters>>;
  readonly biomes: readonly ClimateEntry[];
}

/** `Noises.SHIFT` — the offset noise every `shift_a`/`shift_b` reads. */
const SHIFT_NOISE = 'minecraft:offset';

export class DimensionBiomeSampler {
  private readonly router: readonly DensityFunction[];
  private readonly search: ClimateSearch;
  readonly data: DimensionClimateData;

  constructor(data: DimensionClimateData, seed: bigint) {
    this.data = data;
    this.search = new ClimateSearch(data.biomes);

    const legacy = data.legacyRandomSource;
    const random: ForkableRandomSource = legacy
      ? new JavaRandom(seed)
      : XoroshiroRandomSource.fromSeed(seed);
    const factory = random.forkPositional();

    const cache = new Map<string, NormalNoise>();
    const lookup = (id: string): NormalNoise | null => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      // The legacy special case: a zero amplitude means the whole stack draws nothing and the
      // shift is flat zero. Keeping the real parameters here would move every biome boundary.
      const params: NoiseParameters | undefined =
        legacy && id === SHIFT_NOISE ? { firstOctave: 0, amplitudes: [0] } : data.noises[id];
      if (params === undefined) return null;
      const noise = new NormalNoise(factory.fromHashOf(id), params);
      cache.set(id, noise);
      return noise;
    };

    this.router = ROUTER_KEYS.map((key) => compile(data.router[key], lookup));
  }

  /** The six climate values at a block position, quantized the way `Climate.target` does. */
  target(x: number, y: number, z: number): ClimateTarget {
    const r = this.router;
    return [
      quantizeCoord(Math.fround(r[0]!(x, y, z))),
      quantizeCoord(Math.fround(r[1]!(x, y, z))),
      quantizeCoord(Math.fround(r[2]!(x, y, z))),
      quantizeCoord(Math.fround(r[3]!(x, y, z))),
      quantizeCoord(Math.fround(r[4]!(x, y, z))),
      quantizeCoord(Math.fround(r[5]!(x, y, z))),
    ];
  }

  /** The biome at a block position. Biomes are stored per quart cell, so this is exact only at
   *  quart-aligned coordinates — `biomeAtQuart` is the one that matches what a chunk holds. */
  biomeAt(x: number, y: number, z: number): string | null {
    return this.search.find(this.target(x, y, z));
  }

  /** `Climate.Sampler#sample(int, int, int)`: quart in, block coordinates out to the router. */
  biomeAtQuart(quartX: number, quartY: number, quartZ: number): string | null {
    return this.biomeAt(quartX << 2, quartY << 2, quartZ << 2);
  }
}

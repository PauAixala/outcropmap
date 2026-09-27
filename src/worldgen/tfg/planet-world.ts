/**
 * The four Ad Astra planets TerraFirmaGreg ships — the Moon, Mars, Venus and Glacio — as
 * `WorldGenerator`s.
 *
 * They are all the same thing: a vanilla `minecraft:noise` generator with a `multi_noise` biome
 * source, differing only in the data `tools/extract-dimension-climate.mjs` pulls out for each. So
 * they get one class and five lines of table rather than four near-identical files.
 *
 * What it answers is biome, sea level and ore veins. Rock and terrain height are real questions with
 * real answers in the pack and neither is modelled here yet — `null` says so, which is the whole
 * point of CLAUDE.md section 1a.
 *
 * The veins are the pack's own `configured_feature/{moon,mars,venus}/vein` folders, in the same
 * shapes the overworld uses. None of the 57 is biome-gated, projected to the surface or `near_lava`,
 * so all of them place — but **neither the host-rock gate nor the above-ground gate can run**,
 * because nothing here models these dimensions' stone or their surface height. Measured against a
 * real Moon and Mars that costs a lot: 85.3% and 67.3% of markers backed by real ore, against the
 * overworld's 90.5%, and the loss is concentrated rather than spread — every `mars_surface_*` vein
 * sits in open air, and a vein whose table names the wrong planet's stone mostly misses.
 *
 * Both are answered by measurement rather than by a model: the per-vein precision in
 * `vein-verification.json` is real data from that world, and the map's own 0.9 confidence floor
 * drops the veins that earn it — 97.3% and 99.5% of what is actually drawn. See docs/PARITY.md.
 *
 * **Height does not change a biome here**, in this pack. Every planet biome claims the same `depth`,
 * so `tools/extract-dimension-climate.mjs` writes that router entry as 0, and a column has one biome
 * at every y (docs/PARITY.md). The map still samples at the dimension's sea level, and `probe()`
 * reports which.
 */
import type {
  BlockBox,
  ClimateSample,
  DimensionId,
  FeatureKind,
  FeatureSet,
  GeneratorOptions,
  Probe,
  ProfileDescriptor,
  RockStack,
  WorldGenerator,
} from '../api/types';
import { blockToChunk } from '@core/coords/coords';
import { DimensionBiomeSampler, type DimensionClimateData } from '@worldgen/vanilla/dimension-biomes';
import { clusterDepositsInBox, clusterVeinsFor } from '../tfc-1.20/features/cluster-vein';
import { discDepositsInBox, discVeinsFor } from '../tfc-1.20/features/disc-vein';
import { pipeDepositsInBox, pipeVeinsFor } from '../tfc-1.20/features/pipe-vein';
import { veinFilterId } from '../tfc-1.20/features/vein-materials';
import type { VeinProfileId } from '../tfc-1.20/features/vein-tables';
import { structuresInBox } from './structures';
import moon from '@data/tfg/dimensions/moon.json';
import mars from '@data/tfg/dimensions/mars.json';
import venus from '@data/tfg/dimensions/venus.json';
import glacio from '@data/tfg/dimensions/glacio.json';

const PLANETS: Partial<Record<DimensionId, DimensionClimateData>> = {
  moon: moon as unknown as DimensionClimateData,
  mars: mars as unknown as DimensionClimateData,
  venus: venus as unknown as DimensionClimateData,
  glacio: glacio as unknown as DimensionClimateData,
};

/** Glacio is absent on purpose: the pack gives it no vein folder at all. */
const VEIN_SETS: Partial<Record<DimensionId, VeinProfileId>> = {
  moon: 'tfg-moon',
  mars: 'tfg-mars',
  venus: 'tfg-venus',
};

export const PLANET_DIMENSIONS = Object.keys(PLANETS) as readonly DimensionId[];

/** Each planet's biome list, deduplicated: a biome claiming two boxes in climate space appears
 *  twice in the datapack and once in a legend. */
export const PLANET_BIOME_IDS: Partial<Record<DimensionId, readonly string[]>> = Object.fromEntries(
  Object.entries(PLANETS).map(([dimension, data]) => [
    dimension,
    [...new Set(data.biomes.map((entry) => entry.biome))].sort(),
  ]),
);

export function isPlanet(dimension: DimensionId): boolean {
  return PLANETS[dimension] !== undefined;
}

/** Ad Astra's own region size, the same 512 blocks the overworld uses for its files. */
const REGION_BLOCKS = 512;

export class PlanetWorldGenerator implements WorldGenerator {
  readonly profile: ProfileDescriptor;
  readonly seed: bigint;
  readonly dimension: DimensionId;
  private readonly sampler: DimensionBiomeSampler;
  /** The height biomes are read at. Configurable because the answer genuinely varies with it. */
  private readonly biomeY: number;

  constructor(profile: ProfileDescriptor, options: GeneratorOptions) {
    const data = PLANETS[options.dimension];
    if (data === undefined) throw new Error(`not a planet: ${options.dimension}`);
    this.profile = profile;
    this.seed = options.seed;
    this.dimension = options.dimension;
    this.sampler = new DimensionBiomeSampler(data, options.seed);
    this.biomeY = options.settings?.['biomeY'] ?? data.seaLevel;
  }

  /** Ad Astra's planets have no TFC climate layer; the pack hands the chunk zeroes for both. */
  climate(): ClimateSample {
    return { temperature: 0, rainfall: 0 };
  }

  /** Not modelled. The planets' stone layers are their own noise, not TFC's rock stack. */
  rocks(): RockStack | null {
    return null;
  }

  biome(x: number, z: number): string | null {
    return this.sampler.biomeAt(Math.floor(x), this.biomeY, Math.floor(z));
  }

  /** Not modelled: this needs the full terrain density chain, not just the climate half. */
  surfaceY(): number | null {
    return null;
  }

  probe(x: number, z: number): Probe {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    return {
      x: bx,
      z: bz,
      chunkX: blockToChunk(bx),
      chunkZ: blockToChunk(bz),
      regionX: Math.floor(bx / REGION_BLOCKS),
      regionZ: Math.floor(bz / REGION_BLOCKS),
      biome: this.biome(bx, bz),
      climate: this.climate(),
      rocks: null,
      terrain: null,
      surfaceY: null,
    };
  }

  probeFast(x: number, z: number): Probe {
    return this.probe(x, z);
  }

  features(
    box: BlockBox,
    kinds: readonly FeatureKind[] = ['deposits', 'structures'],
    ores: readonly string[] = [],
  ): FeatureSet {
    // Only the Moon has a structure set; the others get an empty list from the dimension filter.
    const structures = kinds.includes('structures')
      ? structuresInBox(
          box,
          {
            seed: this.seed,
            biomeAt: (x, z) => this.biome(x, z),
            climateAt: () => null,
            forestAt: () => 0,
            surfaceY: () => null,
          },
          this.dimension,
        )
      : [];
    const set = VEIN_SETS[this.dimension];
    if (set === undefined || !kinds.includes('deposits')) return { deposits: [], structures };
    const wanted = <T extends { readonly ore: string }>(veins: readonly T[]): T[] =>
      ores.length === 0 ? [...veins] : veins.filter((vein) => ores.includes(veinFilterId(vein.ore)));
    const biomeAt = (x: number, z: number, y: number): string | null =>
      this.sampler.biomeAt(Math.floor(x), Math.floor(y), Math.floor(z));
    // No surface height and no rock model: both come back `null`, which the ports read as "cannot
    // tell" and let the vein through rather than inventing a reason to drop it.
    const noSurface = (): number | null => null;
    return {
      deposits: [
        ...clusterDepositsInBox(box, this.seed, biomeAt, wanted(clusterVeinsFor(set)), noSurface),
        ...discDepositsInBox(box, this.seed, biomeAt, wanted(discVeinsFor(set)), noSurface),
        ...pipeDepositsInBox(box, this.seed, biomeAt, wanted(pipeVeinsFor(set))),
      ],
      structures,
    };
  }
}

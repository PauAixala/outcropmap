/**
 * The Beneath as a `WorldGenerator`, so the map can show it.
 *
 * A separate class rather than a dimension branch inside `TFGGenerator`: the two share no
 * machinery at all. The overworld is a regional pipeline with plate tectonics, 109 biomes and a
 * height field; the Beneath is a flat roof at y 208 over a stack of rock bands. Threading `if
 * (dimension === 'nether')` through every method of the overworld generator would cost more than
 * it saves and would make both harder to read.
 *
 * Rock, height, biome, veins, the tower and position are all real.
 *
 * The 29 veins are TerraFirmaGreg's `configured_feature/nether/vein` folder, in the same
 * `tfc:cluster_vein`/`disc_vein`/`pipe_vein` shapes the overworld uses — so the existing ports place
 * them unchanged. Every one of the 29 is absolute-Y and none is `near_lava`, so unlike the overworld
 * nothing is excluded. All 29 *are* biome-gated, which is why the biomes had to come first.
 *
 * **The biome depends on height.** The Beneath is three stacked bands — a bottom of lava floes and
 * ash forest, a middle of springs and brambles, a top of bogs and caverns — separated by the
 * `depth` climate parameter, which is a ramp in y. A 2D map has to pick one, and it picks the top
 * band, where a portal arrives and where a player spends the time. `probe()` reports which y.
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
import { BeneathGenerator, BENEATH_SURFACE_Y } from './beneath';
import { DimensionBiomeSampler, type DimensionClimateData } from '@worldgen/vanilla/dimension-biomes';
import { clusterDepositsInBox, clusterVeinsFor } from '../tfc-1.20/features/cluster-vein';
import { discDepositsInBox, discVeinsFor } from '../tfc-1.20/features/disc-vein';
import { pipeDepositsInBox, pipeVeinsFor } from '../tfc-1.20/features/pipe-vein';
import { veinFilterId } from '../tfc-1.20/features/vein-materials';
import { resolveDepositDepth } from '@worldgen/api/depth';
import { structuresInBox } from './structures';

/** Where the Beneath's one structure set starts: `tfg:beneath/tower` declares
 *  `"start_height": {"absolute": 93}`, and its biome tag covers 11 of the 17 biomes — so the gate
 *  has to be read in the band the tower actually stands in, not at the roof. */
const STRUCTURE_Y = 93;

/** The Beneath's 17 biomes, deduplicated — several claim two boxes in climate space. */
export const BENEATH_BIOME_IDS: readonly string[] = [
  ...new Set((beneathClimate as unknown as DimensionClimateData).biomes.map((entry) => entry.biome)),
].sort();

/** TerraFirmaGreg's own Nether vein folder — see `src/data/tfg/veins-nether.json`. */
const VEIN_SET = 'tfg-nether';
import beneathClimate from '@data/tfg/dimensions/beneath.json';

/** Where the 2D biome layer reads. Inside the top band, clear of the roof's own decoration. */
const BIOME_Y = 195;

/** A region in the overworld's sense is 12 288 blocks; the Beneath has no such thing, so the
 * readout's region fields report the chunk-grid equivalent rather than a number from nowhere. */
const REGION_BLOCKS = 512;

export class BeneathWorldGenerator implements WorldGenerator {
  readonly profile: ProfileDescriptor;
  readonly seed: bigint;
  readonly dimension: DimensionId;
  private readonly beneath = new BeneathGenerator();
  private readonly sampler: DimensionBiomeSampler;
  /** The band biomes are read in. See this file's header for why it is near the roof. */
  private readonly biomeY: number;

  constructor(profile: ProfileDescriptor, options: GeneratorOptions) {
    this.profile = profile;
    this.seed = options.seed;
    this.dimension = options.dimension;
    this.sampler = new DimensionBiomeSampler(
      beneathClimate as unknown as DimensionClimateData,
      options.seed,
    );
    this.biomeY = options.settings?.['biomeY'] ?? BIOME_Y;
  }

  /** No temperature and no rainfall: the pack hands the chunk a zero layer for both. */
  climate(): ClimateSample {
    return this.beneath.climate();
  }

  /**
   * The rock at three depths of one column. There is no bottom/middle/top layer *stack* here the way
   * the overworld has one — the Beneath's rock is a function of depth — so these are samples at the
   * roof, the middle and the floor, which is what the readout can usefully show.
   */
  rocks(x: number, z: number): RockStack | null {
    const top = this.beneath.rockAt(x, BENEATH_SURFACE_Y - 1, z);
    const middle = this.beneath.rockAt(x, BENEATH_SURFACE_Y - 100, z);
    const bottom = this.beneath.rockAt(x, 1, z);
    if (top === null || middle === null || bottom === null) return null;
    return { bottom, middle, top, surface: top };
  }

  biome(x: number, z: number): string | null {
    return this.sampler.biomeAt(Math.floor(x), this.biomeY, Math.floor(z));
  }

  surfaceY(): number {
    return BENEATH_SURFACE_Y;
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
      rocks: this.rocks(bx, bz),
      terrain: null,
      surfaceY: BENEATH_SURFACE_Y,
    };
  }

  /** Nothing here is expensive, so the fast path is the same path. */
  probeFast(x: number, z: number): Probe {
    return this.probe(x, z);
  }

  features(
    box: BlockBox,
    kinds: readonly FeatureKind[] = ['deposits', 'structures'],
    ores: readonly string[] = [],
  ): FeatureSet {
    const structures = kinds.includes('structures')
      ? structuresInBox(
          box,
          {
            seed: this.seed,
            biomeAt: (x, z) => this.sampler.biomeAt(Math.floor(x), STRUCTURE_Y, Math.floor(z)),
            climateAt: () => null,
            forestAt: () => 0,
            surfaceY: () => BENEATH_SURFACE_Y,
          },
          'nether',
        )
      : [];
    if (!kinds.includes('deposits')) return { deposits: [], structures };
    const wanted = <T extends { readonly ore: string }>(veins: readonly T[]): T[] =>
      ores.length === 0 ? [...veins] : veins.filter((vein) => ores.includes(veinFilterId(vein.ore)));
    // The Beneath's biomes are three stacked bands, so the gate has to ask at the vein's own y.
    const biomeAt = (x: number, z: number, y: number): string | null =>
      this.sampler.biomeAt(Math.floor(x), Math.floor(y), Math.floor(z));
    const rockAt = (x: number, y: number, z: number): string | null =>
      this.beneath.rockAt(Math.floor(x), Math.floor(y), Math.floor(z));
    // A flat roof, so `surfaceY` is a constant — which still matters: it is what stops a vein whose
    // band sits in the open air above the roof from being drawn.
    const surfaceY = (): number => BENEATH_SURFACE_Y;
    return {
      deposits: resolveDepositDepth(
        [
          ...clusterDepositsInBox(box, this.seed, biomeAt, wanted(clusterVeinsFor(VEIN_SET)), surfaceY, rockAt),
          ...discDepositsInBox(box, this.seed, biomeAt, wanted(discVeinsFor(VEIN_SET)), surfaceY, rockAt),
          ...pipeDepositsInBox(box, this.seed, biomeAt, wanted(pipeVeinsFor(VEIN_SET)), rockAt),
        ],
        box,
        surfaceY,
      ),
      structures,
    };
  }
}

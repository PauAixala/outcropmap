/** TerraFirmaGreg Core Modern 0.9.21, Overworld generation version 1. */
import { Tfc120Generator, TFC_1_20_PROFILE } from '../tfc-1.20';
import { blockToGrid } from '@worldgen/tfc-1.20/region/units';
import { registerProfile } from '../registry';
import { BeneathWorldGenerator, BENEATH_BIOME_IDS } from './beneath-world';
import {
  isPlanet,
  PLANET_BIOME_IDS,
  PLANET_DIMENSIONS,
  PlanetWorldGenerator,
} from './planet-world';
import type { BlockBox, DimensionId, FeatureSet, ProfileDescriptor } from '../api/types';
import type { RegionGeneratorSettings } from '../tfc-1.20/region/generator';
import { TFGRegionGenerator } from './region/generator';
import { BIOME_IDS } from './biome/ids';
import { sampleClimate } from './climate';
import { kaolinInBox } from './kaolin';
import {
  clusterDepositsInBox,
  clusterVeinsFor,
  rawVeinBlocks,
  typicalVeinBlocks,
} from '../tfc-1.20/features/cluster-vein';
import { discDepositsInBox, discVeinExtent, discVeinsFor } from '../tfc-1.20/features/disc-vein';
import type { VeinProfileId } from '../tfc-1.20/features/vein-tables';
import { DIKE_OVERWRITES, dikeRockAt, dikesInBox } from '../tfc-1.20/features/dike';

/**
 * Disc veins worth a marker. Two of the veins TFG's tag borrows from TFC place no ore at all:
 * `gravel`, and `kaolin_disc` — and TFG's kaolin reaches the map through `kaolinInBox` instead, from
 * the modpack's own KubeJS config. Drawing either as a deposit would promise an ore that is not
 * there.
 */
const oreDiscVeins = (set: VeinProfileId): ReturnType<typeof discVeinsFor> =>
  discVeinsFor(set).filter((vein) => vein.produces.length > 0);

/** Which vein table each dimension draws from. TerraFirmaGreg keeps one folder per dimension and
 *  they share no veins, so a dimension is a table, not a filter over one. */
export const VEIN_SET_BY_DIMENSION: Partial<Record<DimensionId, VeinProfileId>> = {
  overworld: 'tfg',
  nether: 'tfg-nether',
  moon: 'tfg-moon',
  mars: 'tfg-mars',
  venus: 'tfg-venus',
};
import {
  pipeDepositsInBox,
  pipeVeinsFor,
  typicalPipeVeinBlocks,
} from '../tfc-1.20/features/pipe-vein';
import { veinFilterId, veinMaterialMix } from '../tfc-1.20/features/vein-materials';
import { tfgRocks } from './rocks';
import biomes from '@data/tfg/biomes.json';
import veinVerification from '@data/tfg/vein-verification.json';
import { resolveDepositDepth } from '@worldgen/api/depth';
import { TFGSurfaceHeightSampler } from './biome/surface-height';
import { structuresInBox, type StructureContext } from './structures';
import type { FeatureKind, StructureFeature } from '../api/types';

/**
 * `depositOres` and `depositYields` for a profile, from its own vein tables.
 *
 * Both are derived from the same source so they can never disagree — the ore filter keys off the id
 * a deposit reports (`veinFilterId`), and the label needs the materials that id actually places.
 */
/** Pipe veins have no `projectToSurface` in the Java config: their range is always absolute. */
function projected(vein: object): boolean {
  return 'project' in vein && vein.project === true;
}

/**
 * The ore filter list and everything the UI shows beside it, from the vein tables themselves.
 *
 * It takes every vein *set* the profile can show, not just the overworld's: the filter is one list
 * across the whole profile, and an ore that only exists on Mars is still an ore the player can ask
 * the map for. Sets sharing a filter id merge, which is what the depth range's `Math.min` is for.
 */
function depositIndex(
  sets: readonly VeinProfileId[],
  extra: readonly string[] = [],
): {
  ores: string[];
  oresBySet: Partial<Record<VeinProfileId, string[]>>;
  yields: Record<string, readonly string[]>;
  yRanges: Record<string, { minY: number; maxY: number; project: boolean }>;
  mix: Record<string, readonly { material: string; share: number }[]>;
  typicalBlocks: (id: string) => number | null;
} {
  const ores = [...extra];
  // The same ids, split by the table they came from: the filter panel shows one dimension at a
  // time, and offering Mars's ores while looking at the overworld is a control that matches nothing.
  const oresBySet: Partial<Record<VeinProfileId, string[]>> = {};
  const yields: Record<string, readonly string[]> = {};
  const yRanges: Record<string, { minY: number; maxY: number; project: boolean }> = {};
  const mix: Record<string, readonly { material: string; share: number }[]> = {};
  const withSet = <T,>(pick: (set: VeinProfileId) => readonly T[]): { set: VeinProfileId; vein: T }[] =>
    sets.flatMap((set) => pick(set).map((vein) => ({ set, vein })));
  for (const { set, vein } of [
    ...withSet(clusterVeinsFor),
    ...withSet(oreDiscVeins),
    ...withSet(pipeVeinsFor),
  ]) {
    const id = veinFilterId(vein.ore);
    ores.push(id);
    (oresBySet[set] ??= []).push(id);
    if (vein.produces.length > 0) yields[id] = vein.produces;
    const veinMix = veinMaterialMix(rawVeinBlocks(set, vein.id));
    if (veinMix.length > 0) mix[id] = veinMix;
    const known = yRanges[id];
    // Veins sharing a filter id are one entry in the list, so the depths shown have to cover all of
    // them. A mixed group keeps `project` only if every member is projected, since one absolute
    // vein makes the number an absolute Y again.
    yRanges[id] = known
      ? {
          minY: Math.min(known.minY, vein.minY),
          maxY: Math.max(known.maxY, vein.maxY),
          project: known.project && projected(vein),
        }
      : { minY: vein.minY, maxY: vein.maxY, project: projected(vein) };
  }

  // Deferred: each of these walks the vein's bounding box (~150 ms for a whole profile), and both
  // cache inside. Pipe veins have no ported count, so their id is simply absent -> null.
  const counters = new Map<string, () => number | null>();
  for (const set of sets) {
    for (const vein of clusterVeinsFor(set)) {
      counters.set(veinFilterId(vein.ore), () => typicalVeinBlocks(vein));
    }
    for (const vein of oreDiscVeins(set)) {
      counters.set(veinFilterId(vein.ore), () => discVeinExtent(vein).typicalOreBlocks);
    }
    for (const vein of pipeVeinsFor(set)) {
      counters.set(veinFilterId(vein.ore), () => typicalPipeVeinBlocks(vein));
    }
  }
  const typicalBlocks = (id: string): number | null => counters.get(id)?.() ?? null;

  return { ores, oresBySet, yields, yRanges, mix, typicalBlocks };
}

const TFG_DEPOSITS = depositIndex(
  Object.values(VEIN_SET_BY_DIMENSION) as VeinProfileId[],
  ['kaolin'],
);

export const TFG_PROFILE: ProfileDescriptor = {
  ...TFC_1_20_PROFILE,
  id: 'tfg',
  // Structures are placed for this profile only (`./structures.ts`); tfc-1.20 has none yet.
  layers: [...TFC_1_20_PROFILE.layers, 'structures'],
  label: 'TerraFirmaGreg Modern 0.13.8 (Core 0.9.21) · Overworld v1',
  // The Beneath is TFG's rebuilt Nether -- see `beneath.ts` -- and the four planets are Ad Astra's,
  // which TFG ships. Outside the overworld only rock (the Beneath) and biomes are modelled; veins
  // and terrain height are not, and each generator says so rather than inventing them.
  dimensions: ['overworld', 'nether', ...PLANET_DIMENSIONS],
  biomePalette: biomes.colors,
  // The overworld's ids come from its palette; the other dimensions bring their own lists.
  dimensionBiomeIds: {
    overworld: BIOME_IDS,
    nether: BENEATH_BIOME_IDS,
    ...PLANET_BIOME_IDS,
  },
  // Keyed off what a deposit actually reports, not the vein's table key -- the two differ for
  // some veins, and offering the wrong one makes the filter match nothing.
  depositOres: TFG_DEPOSITS.ores,
  dimensionDepositOres: Object.fromEntries(
    Object.entries(VEIN_SET_BY_DIMENSION).map(([dimension, set]) => [
      dimension,
      // Kaolin comes from TFG's own KubeJS config, not a vein table, and only in the overworld.
      dimension === 'overworld'
        ? ['kaolin', ...(TFG_DEPOSITS.oresBySet[set] ?? [])]
        : (TFG_DEPOSITS.oresBySet[set] ?? []),
    ]),
  ) as Partial<Record<DimensionId, readonly string[]>>,
  depositYields: TFG_DEPOSITS.yields,
  depositYRanges: TFG_DEPOSITS.yRanges,
  depositMix: TFG_DEPOSITS.mix,
  depositReliability: (veinVerification as { veins: Record<string, { checked: number; real: number; precision: number }> })
    .veins,
  depositDepthReliability: (
    veinVerification as { depth: Record<string, { checked: number; real: number; precision: number }> }
  ).depth,
  typicalBlocks: TFG_DEPOSITS.typicalBlocks,
};

export class TFGGenerator extends Tfc120Generator {
  override readonly profile = TFG_PROFILE;
  /**
   * TFG's own height sampler. Deliberately *not* the base class's `surfaceHeightSampler`, which is
   * built over TFC's 30 biomes — using that here would silently read TFG's biome indices as TFC's.
   *
   * Built lazily: evaluating 109 height expressions is wasted work for a climate-only query.
   */
  private tfgHeightSampler: TFGSurfaceHeightSampler | null = null;

  private get surfaceHeight(): TFGSurfaceHeightSampler {
    // The no-river layer: `river` has no height factory, so a blend containing it cannot be
    // evaluated. TFC splits the same way (`TFCChunkGenerator` asks for the no-river biome).
    this.tfgHeightSampler ??= new TFGSurfaceHeightSampler(
      this.seed,
      (quartX, quartZ) => this.region.biomeAtQuartNoRiver(quartX, quartZ),
      // River carving. Without it a river column reads ~15 blocks too high -- see river/river-noise.
      // TFG keeps its own river graph, so this is `riversAt`, not TFC's `riversAtGrid`.
      (blockX, blockZ) => this.region.riversAt(blockToGrid(blockX), blockToGrid(blockZ)),
    );
    return this.tfgHeightSampler;
  }

  declare protected readonly region: TFGRegionGenerator;
  protected override createRegionGenerator(
    seed: bigint,
    settings: RegionGeneratorSettings,
  ): TFGRegionGenerator {
    return new TFGRegionGenerator(seed, settings);
  }
  override rocks(x: number, z: number) {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    return {
      ...tfgRocks.rockStackAtPoint(this.region.rockAt(blockX, blockZ)),
      surface: tfgRocks.sampleAtLayer(this.region.surfaceRockAt(blockX, blockZ), 0),
    };
  }
  override biome(x: number, z: number): string | null {
    return BIOME_IDS[this.region.biomeAtQuart(Math.floor(x) >> 2, Math.floor(z) >> 2)] ?? null;
  }
  override climate(x: number, z: number) {
    return sampleClimate(this.region, Math.floor(x), Math.floor(z));
  }
  override surfaceY(x: number, z: number): number | null {
    return this.surfaceHeight.sample(x, z);
  }
  /** Structure starts in a box: villages, camps, mineshafts, ruins (`./structures.ts`). */
  structures(box: BlockBox): StructureFeature[] {
    return structuresInBox(box, this.structureContext());
  }

  /** The generator queries structure placement reads. */
  structureContext(): StructureContext {
    return {
      seed: this.seed,
      biomeAt: (x, z) => this.biome(x, z),
      climateAt: (x, z) => this.climate(x, z),
      forestAt: (chunkX, chunkZ) => this.region.forestTypeAt(chunkX, chunkZ),
      surfaceY: (x, z) => this.surfaceY(x, z),
    };
  }

  override features(
    box: BlockBox,
    kinds: readonly FeatureKind[] = ['deposits', 'structures'],
    ores: readonly string[] = [],
  ): FeatureSet {
    // Only the selected ores' veins are generated; the filter id is what the map filters on.
    const wanted = <T extends { readonly ore: string }>(veins: readonly T[]): T[] =>
      ores.length === 0 ? [...veins] : veins.filter((vein) => ores.includes(veinFilterId(vein.ore)));
    const wantKaolin = ores.length === 0 || ores.includes('kaolin');
    const biomeAt = (x: number, z: number): string | null => this.biome(x, z);
    // TFG has its own rock layers (`tfgRocks`), so the replacement-table check has to ask that
    // table, not TFC's -- see `columnCanHost`.
    // A dike converts every raw rock it crosses into granite, diorite or gabbro, and several veins
    // host in nothing else -- see features/dike.ts. Computed once per box, then asked per position.
    const dikes = dikesInBox(box, this.seed, 'tfg');
    const rockAt = (bx: number, by: number, bz: number): string | null => {
      // A dike decorates after the ore veins and overwrites them -- see DIKE_OVERWRITES.
      if (dikeRockAt(dikes, bx, by, bz) !== null) return DIKE_OVERWRITES;
      const surface = this.surfaceY(bx, bz);
      if (surface === null) return null;
      const { point, layer } = this.region.rockLayerAtY(
        Math.floor(bx),
        Math.floor(by),
        Math.floor(bz),
        surface,
      );
      return tfgRocks.sampleAtLayer(point, layer);
    };
    return {
      // A no-op until `surfaceY` above stops returning null, and then correct without a second
      // edit -- see `resolveDepositDepth`.
      deposits: !kinds.includes('deposits')
        ? []
        : resolveDepositDepth(
        [
          // TFG has no kaolin_disc entry in its vein table -- its kaolin comes from the modpack's
          // own KubeJS config, through this separate path.
          ...(wantKaolin ? kaolinInBox(box, this.seed, biomeAt, (x, z) => this.climate(x, z)) : []),
          // 49 of TFG's 76 veins are clusters, and 20 are discs -- and the discs are the early ores
          // (normal_copper, normal_iron, normal_gold, normal_coal), so leaving them out hid exactly
          // what a player looks for first. Pipe veins (7) are still unported (docs/PLAN.md 10).
          ...clusterDepositsInBox(
            box,
            this.seed,
            biomeAt,
            wanted(clusterVeinsFor('tfg')),
            (bx, bz) => this.surfaceY(bx, bz),
            rockAt,
          ),
          ...discDepositsInBox(
            box,
            this.seed,
            biomeAt,
            wanted(oreDiscVeins('tfg')),
            (bx, bz) => this.surfaceY(bx, bz),
            rockAt,
          ),
          // Pipe veins carry TFG's gems: sapphire, lapis/lazurite, bismuth.
          ...pipeDepositsInBox(box, this.seed, biomeAt, wanted(pipeVeinsFor('tfg')), rockAt),
        ],
        box,
        (x, z) => this.surfaceY(x, z),
      ),
      structures: kinds.includes('structures') ? this.structures(box) : [],
    };
  }
}
registerProfile(TFG_PROFILE, (options) => {
  // The other dimensions share nothing with the overworld but the profile they belong to, so each
  // gets its own generator rather than a dimension branch through every method of this one.
  if (options.dimension === 'nether') return new BeneathWorldGenerator(TFG_PROFILE, options);
  if (isPlanet(options.dimension)) return new PlanetWorldGenerator(TFG_PROFILE, options);
  return new TFGGenerator(options);
});
